/**
 * toneEngine.ts
 * Fachada principal y orquestador del Motor de Audio de Phosphor.
 * Delega en subsistemas modulares: MixerGraph, SynthVoiceManager, DrumSoundManager, PreviewManager y AudioTransport.
 */

import * as Tone from 'tone';
import { useSongStore } from '../store/songStore';
import { NOTE_CLASSES, SCALE_INTERVALS, getBlockNotes, resolvePatternNoteToChord } from '../core/music';
import { flattenPatternChain } from '../utils/typeDefinitions';
import { renderSessionToWav, renderSessionToCompressed, PianoSampler } from '../core/audio';
import { serializeSession } from '../core/session';
import { MixerGraph } from '../core/audio/engine/MixerGraph';
import { SynthVoiceManager } from '../core/audio/engine/SynthVoiceManager';
import { DrumSoundManager } from '../core/audio/engine/DrumSoundManager';
import { PreviewManager } from '../core/audio/engine/PreviewManager';
import { AudioTransport } from '../core/audio/engine/AudioTransport';

// Helper debounce simple
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, delay);
  }) as T;
}

// Monkeypatch ToneAudioBuffer.load para resolver comodines [mp3|ogg] de Tone.js v15
if (Tone.ToneAudioBuffer && typeof Tone.ToneAudioBuffer.load === 'function') {
  const originalLoad = Tone.ToneAudioBuffer.load;
  Tone.ToneAudioBuffer.load = function (url: string) {
    const matches = url.match(/\[(.+?)\]/);
    if (matches) {
      const extensions = matches[1].split('|');
      const extension = extensions.find((ext) => {
        if (typeof document !== 'undefined') {
          const response = document.createElement('audio').canPlayType(`audio/${ext}`);
          return response !== '';
        }
        return ext === 'mp3';
      }) || extensions[0];
      url = url.replace(matches[0], extension);
    }
    return originalLoad.call(this, url);
  };
}

const DIATONIC_KEY_MAP: Record<string, number> = {
  z: 0, x: 1, c: 2, v: 3, b: 4, n: 5, m: 6,
  a: 7, s: 8, d: 9, f: 10, g: 11, h: 12, j: 13, k: 14, l: 15, ';': 16, 'ñ': 16, '´': 17
};

const CHROMATIC_KEY_MAP: Record<string, number> = {
  a: 0, s: 2, d: 4, f: 5, g: 7, h: 9, j: 11, k: 12, l: 14, ';': 16, 'ñ': 16,
  w: 1, e: 3, t: 6, y: 8, u: 10, o: 13, p: 15
};

class ToneEngine {
  private mixerGraph: MixerGraph;
  private synthManager: SynthVoiceManager;
  private drumManager: DrumSoundManager;
  private previewManager: PreviewManager;
  private transportManager: AudioTransport;

  private chordsPiano: PianoSampler | null = null;
  private melodyPiano: PianoSampler | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  private scheduledEvents: number[] = [];
  private lastTriggeredBeat = -1;
  private lastTriggeredChordId = '';
  private lastTriggeredChordName = '';
  private lastTriggeredVoicing = '';
  private lastTriggeredInversion = 0;
  private lastTriggeredDrumStep = -1;
  private lastTriggeredDrumBeat = -1;

  private cachedIsKeyboardMelodyEnabled = true;
  private cachedIsKeyboardChromatic = false;
  private cachedKeyboardCenterNote = 'C4';
  private cachedKey = 'C';
  private cachedScale = 'major';
  private cachedBpm = 120;
  private cachedMaxBeat = 4;
  private cachedChordsMaxBeat = 4;
  private cachedMelodyMaxBeat = 4;

  private playheadRafId: number | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private syncTimelineDebounced: () => void;

  constructor() {
    this.mixerGraph = new MixerGraph();
    this.synthManager = new SynthVoiceManager(this.mixerGraph);
    this.drumManager = new DrumSoundManager(this.mixerGraph);
    this.transportManager = new AudioTransport();

    this.previewManager = new PreviewManager({
      synthManager: this.synthManager,
      getChordsPiano: () => this.chordsPiano,
      getMelodyPiano: () => this.melodyPiano,
      isChordPianoActive: () => this.isChordPianoActive(),
      isMelodyPianoActive: () => this.isMelodyPianoActive(),
      onActiveNotesChange: (notes) => useSongStore.getState().setActiveNotes(notes),
      onActiveMelodyNotesChange: (notes) => useSongStore.getState().setActiveMelodyNotes(notes)
    });

    this.syncTimelineDebounced = debounce(() => this.syncTimeline(), 50);
    this.syncChannels(useSongStore.getState().channels);
  }

  private isChordPianoActive(): boolean {
    const chordsInst = useSongStore.getState().channels?.chords?.instrument || 'piano';
    return chordsInst === 'piano' && !!this.chordsPiano && this.chordsPiano.loaded;
  }

  private isMelodyPianoActive(): boolean {
    const melodyInst = useSongStore.getState().channels?.melody?.instrument || 'synth';
    return melodyInst === 'piano' && !!this.melodyPiano && this.melodyPiano.loaded;
  }

  public async init() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 3000));
        await Promise.race([Tone.start(), timeoutPromise]);
      } catch (e) {
        console.warn('Advertencia al iniciar Tone.start():', e);
      }
      this.isInitialized = true;
    })();
    await this.initPromise;

    Tone.Transport.cancel(0);

    Tone.Transport.scheduleRepeat(() => {
      const maxBeat = this.cachedMaxBeat;
      const currentBeat = (Tone.Transport.seconds * this.cachedBpm) / 60;
      if (currentBeat >= maxBeat) {
        const state = useSongStore.getState();
        if (!state.isLooping) {
          this.stop();
        }
      }
    }, '8n');

    const updatePlayheadUI = () => {
      if (useSongStore.getState().isPlaying) {
        const beat = (Tone.Transport.seconds * this.cachedBpm) / 60;
        useSongStore.getState().setCurrentBeat(beat);
      }
      this.playheadRafId = requestAnimationFrame(updatePlayheadUI);
    };
    this.playheadRafId = requestAnimationFrame(updatePlayheadUI);

    Tone.Transport.scheduleRepeat((time) => {
      this.triggerChordTick(time);
      this.triggerDrumTick(time);
    }, '16n');

    const initialState = useSongStore.getState();
    this.cachedIsKeyboardMelodyEnabled = initialState.isKeyboardMelodyEnabled;
    this.cachedIsKeyboardChromatic = initialState.isKeyboardChromatic;
    this.cachedKeyboardCenterNote = initialState.keyboardCenterNote || 'C4';
    this.cachedKey = initialState.key;
    this.cachedScale = initialState.scale;
    this.cachedBpm = initialState.bpm;
    this.updateCachedMaxBeat(initialState);

    let prevBpm = initialState.bpm;
    let prevIsPlaying = initialState.isPlaying;
    let prevChordBlocks = initialState.chordBlocks;
    let prevTracks = initialState.tracks;
    let prevChannels = initialState.channels;
    let prevIsLooping = initialState.isLooping;
    let prevIsMetronomeActive = initialState.isMetronomeActive;
    let prevMetroSubdivision = initialState.metroSubdivision;
    let prevMetroVolume = initialState.metroVolume;
    let prevTimeSignature = initialState.timeSignature;
    let prevPattern = initialState.pattern;
    let prevSwing = initialState.swing;
    let prevSustain = initialState.sustain;

    this.unsubscribeStore = useSongStore.subscribe((state) => {
      this.cachedIsKeyboardMelodyEnabled = state.isKeyboardMelodyEnabled;
      this.cachedIsKeyboardChromatic = state.isKeyboardChromatic;
      this.cachedKey = state.key;
      this.cachedScale = state.scale;
      this.cachedBpm = state.bpm;

      if (state.channels !== prevChannels) {
        prevChannels = state.channels;
        this.syncChannels(state.channels);
      }
      if (state.bpm !== prevBpm) {
        prevBpm = state.bpm;
        this.transportManager.setBpm(state.bpm);
        this.syncTimelineDebounced();
      }
      if (state.isLooping !== prevIsLooping) {
        prevIsLooping = state.isLooping;
        this.syncTimelineDebounced();
      }
      if (
        state.isMetronomeActive !== prevIsMetronomeActive ||
        state.metroSubdivision !== prevMetroSubdivision ||
        state.metroVolume !== prevMetroVolume ||
        state.timeSignature !== prevTimeSignature
      ) {
        prevIsMetronomeActive = state.isMetronomeActive;
        prevMetroSubdivision = state.metroSubdivision;
        prevMetroVolume = state.metroVolume;
        prevTimeSignature = state.timeSignature;
        this.transportManager.syncMetronome(
          state.isMetronomeActive,
          state.metroSubdivision,
          state.timeSignature,
          state.metroVolume
        );
      }
      if (state.isPlaying !== prevIsPlaying) {
        prevIsPlaying = state.isPlaying;
        if (state.isPlaying) {
          this.syncTimeline();
          this.transportManager.start(state.currentBeat, state.bpm);
        } else {
          this.transportManager.pause();
          this.silence();
        }
      }
      if (state.pattern !== prevPattern) {
        prevPattern = state.pattern;
        this.syncTimelineDebounced();
      }
      if (state.swing !== prevSwing) {
        prevSwing = state.swing;
        this.transportManager.setSwing(state.swing);
      }
      if (state.sustain !== prevSustain) {
        prevSustain = state.sustain;
        this.updateSustain(state.sustain);
      }
      if (state.chordBlocks !== prevChordBlocks || state.tracks !== prevTracks) {
        prevChordBlocks = state.chordBlocks;
        prevTracks = state.tracks;
        this.updateCachedMaxBeat(state);
        this.syncTimelineDebounced();
      }
    });

    this.synthManager.updateSynthSettings(initialState.synthSettings);
    this.syncChannels(initialState.channels);
    if (initialState.instrumentType === 'piano') {
      this.setInstrument('piano');
    }
  }

  private updateCachedMaxBeat(state?: any) {
    const s = state || useSongStore.getState();
    let chordsMax = 4;
    (s.chordBlocks || []).forEach((b: any) => { chordsMax = Math.max(chordsMax, b.startBeat + b.durationBeats); });
    let melodyMax = 4;
    (s.tracks || []).forEach((t: any) => {
      (t.notes || []).forEach((n: any) => { melodyMax = Math.max(melodyMax, n.startBeat + n.durationBeats); });
    });

    let newMax = Math.max(chordsMax, melodyMax);
    if (!s.isPatternRepeatOn && s.patternChain && s.patternChain.length > 0) {
      let chainSteps = 0;
      s.patternChain.forEach((item: any) => { chainSteps += item.repeatCount * 16; });
      newMax = Math.max(newMax, chainSteps * 0.25);
    }

    this.cachedChordsMaxBeat = chordsMax;
    this.cachedMelodyMaxBeat = melodyMax;
    this.cachedMaxBeat = newMax;
    return newMax;
  }

  public syncChannels(channels: Record<string, any>) {
    if (!channels) return;
    this.mixerGraph.syncChannels(channels);
    const channelList = Object.values(channels);
    for (const ch of channelList) {
      if (ch.synthSettings) {
        this.synthManager.updateSynthSettings(ch.synthSettings, ch.id);
      }
    }
    if (channelList.some((ch) => ch.instrument === 'piano') && (!this.chordsPiano || !this.melodyPiano)) {
      this.setInstrument('piano');
    }
  }

  public getChannelMeterLevel(id: string): number {
    return this.mixerGraph.getChannelMeterLevel(id);
  }

  public getWaveformData(): Float32Array {
    return this.mixerGraph.getWaveformData();
  }

  public getFrequencyData(): Float32Array {
    return this.mixerGraph.getFrequencyData();
  }

  public updateSynthSettings(settings: any, channelId?: string) {
    this.synthManager.updateSynthSettings(settings, channelId);
  }

  public bumpSynthSettingsVersion() {
    this.synthManager.updateSynthSettings(useSongStore.getState().synthSettings);
  }

  public async setInstrument(type: 'synth' | 'piano') {
    if (!this.isInitialized) await this.init();

    if (type === 'piano') {
      useSongStore.getState().setIsAudioLoading(true);
      try {
        const chordsNode = this.mixerGraph.getChannelNode('chords');
        const melodyNode = this.mixerGraph.getChannelNode('melody');

        if (!this.chordsPiano) {
          this.chordsPiano = new PianoSampler(chordsNode.volumeNode);
        }
        if (!this.melodyPiano) {
          this.melodyPiano = new PianoSampler(melodyNode.volumeNode);
        }
        await Promise.all([this.chordsPiano.load(), this.melodyPiano.load()]);
      } catch (e) {
        console.error('Error inicializando el piano:', e);
      } finally {
        useSongStore.getState().setIsAudioLoading(false);
      }
    }
    this.syncTimeline();
  }

  public silence() {
    this.synthManager.releaseAll();
    if (this.chordsPiano) {
      try { this.chordsPiano.stopAll(); } catch (_) {}
    }
    if (this.melodyPiano) {
      try { this.melodyPiano.stopAll(); } catch (_) {}
    }
    try { this.transportManager.metroSynth.triggerRelease(); } catch (_) {}
  }

  public playChordPreview(chordName: string) {
    if (!this.isInitialized) this.init();
    this.previewManager.playChordPreview(chordName, useSongStore.getState().chordOctaveShift || 0);
  }

  public playChordPreviewStart(chordName: string) {
    if (!this.isInitialized) this.init();
    const state = useSongStore.getState();
    this.previewManager.playChordPreviewStart(chordName, {
      pattern: state.pattern || 'hold',
      chordOctaveShift: state.chordOctaveShift || 0,
      bpm: state.bpm,
      customPatterns: state.customPatterns || []
    });
  }

  public playChordPreviewStop(_chordName?: string) {
    this.previewManager.playChordPreviewStop();
  }

  public getChannelSynth(channelId: string) {
    return this.synthManager.getChannelSynth(channelId);
  }

  public playNotePreview(noteName: string, channelId?: string) {
    if (!this.isInitialized) this.init();
    const state = useSongStore.getState();
    const activeTrack = state.tracks.find((t) => t.id === state.activeTrackId);
    const targetChannelId = channelId || (activeTrack ? activeTrack.channelId : 'melody');
    const channelConfig = state.channels[targetChannelId];
    const usePiano = channelConfig ? channelConfig.instrument === 'piano' : this.isMelodyPianoActive();

    this.previewManager.playNotePreview(noteName, targetChannelId, usePiano);
  }

  public startNote(noteName: string) {
    if (!this.isInitialized) {
      this.init().then(() => this.startNote(noteName));
      return;
    }
    const state = useSongStore.getState();
    const activeTrack = state.tracks.find((t) => t.id === state.activeTrackId);
    const targetChannelId = activeTrack ? activeTrack.channelId : 'melody';
    const channelConfig = state.channels[targetChannelId];
    const usePiano = channelConfig ? channelConfig.instrument === 'piano' : this.isMelodyPianoActive();

    this.previewManager.startNote(noteName, targetChannelId, usePiano);
  }

  public stopNote(noteName: string) {
    if (!this.isInitialized) return;
    const state = useSongStore.getState();
    const activeTrack = state.tracks.find((t) => t.id === state.activeTrackId);
    const targetChannelId = activeTrack ? activeTrack.channelId : 'melody';
    const channelConfig = state.channels[targetChannelId];
    const usePiano = channelConfig ? channelConfig.instrument === 'piano' : this.isMelodyPianoActive();

    this.previewManager.stopNote(noteName, targetChannelId, usePiano);
  }

  public stop() {
    this.transportManager.stop();
    useSongStore.getState().setPlaying(false);
    useSongStore.getState().setCurrentBeat(0);
    this.lastTriggeredBeat = -1;
    this.lastTriggeredChordId = '';
    this.lastTriggeredChordName = '';
    this.lastTriggeredVoicing = '';
    this.lastTriggeredInversion = 0;
    this.lastTriggeredDrumStep = -1;
    this.lastTriggeredDrumBeat = -1;
    this.silence();
    this.previewManager.clearAllActiveNotes();
  }

  public setSeconds(seconds: number) {
    Tone.Transport.seconds = seconds;
    const currentBeat = seconds * (useSongStore.getState().bpm / 60);
    useSongStore.getState().setCurrentBeat(currentBeat);
  }

  public seekToBeat(beat: number) {
    if (!this.isInitialized) this.init();
    this.lastTriggeredBeat = -1;
    this.lastTriggeredChordId = '';
    this.lastTriggeredChordName = '';
    this.transportManager.seek(beat, useSongStore.getState().bpm);
    useSongStore.getState().setCurrentBeat(beat);
    if (!useSongStore.getState().isPlaying) {
      this.silence();
    }
  }

  public handleKeyDown(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (!this.cachedIsKeyboardMelodyEnabled) return;
    if (e.repeat) return;

    const key = e.key.toLowerCase();
    const centerMidi = Tone.Frequency(this.cachedKeyboardCenterNote || 'C4').toMidi();
    const offsetSemitones = centerMidi - 60;

    if (this.cachedIsKeyboardChromatic) {
      const semitones = CHROMATIC_KEY_MAP[key];
      if (semitones !== undefined) {
        e.preventDefault();
        const baseMidi = 60 + semitones + offsetSemitones;
        const noteName = Tone.Frequency(baseMidi, 'midi').toNote();
        this.startNote(noteName);
      }
    } else {
      const scaleIndex = DIATONIC_KEY_MAP[key];
      if (scaleIndex !== undefined) {
        e.preventDefault();
        const baseNote = this.getDiatonicNoteName(this.cachedKey, this.cachedScale, scaleIndex);
        const noteMidi = Tone.Frequency(baseNote).toMidi() + offsetSemitones;
        const noteName = Tone.Frequency(noteMidi, 'midi').toNote();
        this.startNote(noteName);
      }
    }
  }

  public handleKeyUp(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (!this.cachedIsKeyboardMelodyEnabled) return;

    const key = e.key.toLowerCase();
    const centerMidi = Tone.Frequency(this.cachedKeyboardCenterNote || 'C4').toMidi();
    const offsetSemitones = centerMidi - 60;

    if (this.cachedIsKeyboardChromatic) {
      const semitones = CHROMATIC_KEY_MAP[key];
      if (semitones !== undefined) {
        const baseMidi = 60 + semitones + offsetSemitones;
        const noteName = Tone.Frequency(baseMidi, 'midi').toNote();
        this.stopNote(noteName);
      }
    } else {
      const scaleIndex = DIATONIC_KEY_MAP[key];
      if (scaleIndex !== undefined) {
        const baseNote = this.getDiatonicNoteName(this.cachedKey, this.cachedScale, scaleIndex);
        const noteMidi = Tone.Frequency(baseNote).toMidi() + offsetSemitones;
        const noteName = Tone.Frequency(noteMidi, 'midi').toNote();
        this.stopNote(noteName);
      }
    }
  }

  private getDiatonicNoteName(key: string, scaleType: string, index: number): string {
    const rootVal = NOTE_CLASSES.indexOf(key as any);
    const intervals = (SCALE_INTERVALS as Record<string, number[]>)[scaleType] || SCALE_INTERVALS.major;
    const scaleLength = intervals.length;

    const scaleIndex = index % scaleLength;
    const octaveOffset = Math.floor(index / scaleLength);
    const baseOctave = 4;

    const val = rootVal + intervals[scaleIndex];
    const noteClass = NOTE_CLASSES[val % 12];
    const calculatedOctave = baseOctave + octaveOffset + Math.floor(val / 12);

    return `${noteClass}${calculatedOctave}`;
  }

  public updateDrumChannelPan(channelId: string, pan: number) {
    this.drumManager.updateDrumChannelPan(channelId, pan);
  }

  public removeDrumPlayer(channelId: string) {
    this.drumManager.removeDrumPlayer(channelId);
  }

  public playDrumPreview(channelId: string, customVelocity?: number) {
    const state = useSongStore.getState();
    const channel = state.drumChannels.find((c) => c.id === channelId);
    if (!channel || channel.muted) return;

    const velocity = customVelocity !== undefined ? customVelocity : 0.8;
    const volDb = Tone.gainToDb((channel.volume / 100) * velocity);

    this.drumManager.triggerDrumSound(channel.id, channel.sampleUrl, volDb, channel.pan ?? 0);
  }

  private triggerDrumTick(time: number) {
    const state = useSongStore.getState();
    if (!state.isPlaying) return;

    const bpm = Tone.Transport.bpm.value;
    const beat = Tone.Transport.getSecondsAtTime(time) * (bpm / 60);

    let patternIndex = state.currentDrumPatternEdit;
    let localStepIndex = 0;
    let currentChainItemId: string | null = null;
    let globalStepIndex = 0;

    if (!state.isPatternRepeatOn && state.patternChain && state.patternChain.length > 0) {
      const flatChain = flattenPatternChain(state.patternChain);
      const totalChainSteps = flatChain.length * 16;

      if (totalChainSteps > 0) {
        globalStepIndex = Math.round(beat / 0.25) % totalChainSteps;
        const flatIdx = Math.floor(globalStepIndex / 16);
        const step = flatChain[flatIdx];

        if (step) {
          patternIndex = step.patternIndex;
          localStepIndex = globalStepIndex % 16;
          currentChainItemId = step.originalItemId;
        }
      }
    } else {
      globalStepIndex = Math.round(beat / 0.25) % 16;
      patternIndex = state.currentDrumPatternEdit;
      localStepIndex = globalStepIndex;
    }

    if (this.lastTriggeredDrumStep === globalStepIndex && Math.abs(beat - this.lastTriggeredDrumBeat) < 0.1) {
      return;
    }

    this.lastTriggeredDrumStep = globalStepIndex;
    this.lastTriggeredDrumBeat = beat;

    const anyChannelSolo = Object.values(state.channels).filter(c => c.id !== 'master').some((c) => c.solo);
    const globalDrumsChannel = state.channels.drums;
    const isGlobalDrumsSilenced = globalDrumsChannel
      ? globalDrumsChannel.muted || (anyChannelSolo && !globalDrumsChannel.solo)
      : false;

    state.drumChannels.forEach((channel) => {
      if (isGlobalDrumsSilenced) return;
      if (channel.muted) return;

      const isAnySolo = state.drumChannels.some((c) => c.solo);
      if (isAnySolo && !channel.solo) return;

      if (!channel.patterns || !channel.patterns[patternIndex]) return;
      const step = channel.patterns[patternIndex][localStepIndex];
      if (step && step.isActive) {
        const volDb = Tone.gainToDb((channel.volume / 100) * step.velocity);
        this.drumManager.triggerDrumSound(channel.id, channel.sampleUrl, volDb, channel.pan ?? 0, time);
      }
    });

    Tone.Draw.schedule(() => {
      const currentState = useSongStore.getState();
      if (!currentState.isPatternRepeatOn) {
        currentState.setCurrentChainItemId(currentChainItemId);
        if (currentState.isPlaying && !currentState.isLiveFollowLocked && currentState.patternChain && currentState.patternChain.length > 0) {
          currentState.setCurrentDrumPatternEditLive(patternIndex);
        }
      }
      if (useSongStore.getState().currentDrumPatternEdit === patternIndex) {
        useSongStore.getState().setPlaybackStep(localStepIndex);
      } else {
        useSongStore.getState().setPlaybackStep(-1);
      }
    }, time);
  }

  private triggerChordTick(time: number) {
    const state = useSongStore.getState();
    if (!state.isPlaying) return;

    const bpm = Tone.Transport.bpm.value;
    const beat = Tone.Transport.getSecondsAtTime(time) * (bpm / 60);
    const tickBeat = Math.round(beat * 4) / 4;

    let localTickBeat = tickBeat;
    if (this.cachedChordsMaxBeat > 0 && this.cachedChordsMaxBeat < this.cachedMaxBeat) {
      localTickBeat = tickBeat % this.cachedChordsMaxBeat;
    }

    if (localTickBeat < this.lastTriggeredBeat) {
      this.lastTriggeredBeat = -1;
      this.lastTriggeredChordId = '';
      this.lastTriggeredChordName = '';
    }

    if (localTickBeat === this.lastTriggeredBeat) return;
    this.lastTriggeredBeat = localTickBeat;

    const block = state.chordBlocks.find(
      (b) => localTickBeat >= b.startBeat && localTickBeat < b.startBeat + b.durationBeats
    );
    if (!block) return;

    const activeMarker = (state.styleMarkers || [])
      .filter((m) => localTickBeat >= m.beat)
      .pop();
    const pattern = activeMarker ? activeMarker.pattern : state.pattern || 'hold';
    const relativeBeat = localTickBeat - block.startBeat;
    const usePiano = this.isChordPianoActive();
    const beatDuration = 60 / bpm;

    const notes = getBlockNotes({
      chord: block.chord,
      voicing: block.voicing,
      inversion: block.inversion,
      octaveShift: state.chordOctaveShift || 0,
      type: block.type,
      bassNote: block.bassNote
    });
    if (notes.length === 0) return;

    const currentVoicing = block.voicing || 'default';
    const currentInversion = block.inversion || 0;

    const hasChordChanged =
      block.id !== this.lastTriggeredChordId ||
      block.chord !== this.lastTriggeredChordName ||
      currentVoicing !== this.lastTriggeredVoicing ||
      currentInversion !== this.lastTriggeredInversion;

    if (hasChordChanged) {
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        try { this.chordsPiano.stopAll(); } catch (_) {}
      } else {
        try { this.synthManager.chordSynth.releaseAll(); } catch (_) {}
      }
      this.lastTriggeredChordId = block.id;
      this.lastTriggeredChordName = block.chord;
      this.lastTriggeredVoicing = currentVoicing;
      this.lastTriggeredInversion = currentInversion;
    }

    const playNote = (note: string, durBeats: number, velocity = 0.6) => {
      const durSec = durBeats * beatDuration;
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        try {
          this.chordsPiano.keyDown({ note, time, velocity });
          this.chordsPiano.keyUp({ note, time: time + durSec });
        } catch (e) { console.error(e); }
      } else {
        try {
          this.synthManager.chordSynth.triggerAttackRelease(note, durSec, time, velocity);
        } catch (e) { console.error(e); }
      }
      this.previewManager.trackNote(note, durSec, time, 'harmony');
    };

    const playChord = (durBeats: number, velocity = 0.6) => {
      const durSec = durBeats * beatDuration;
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        notes.forEach((note) => {
          try {
            this.chordsPiano!.keyDown({ note, time, velocity });
            this.chordsPiano!.keyUp({ note, time: time + durSec });
          } catch (e) { console.error(e); }
          this.previewManager.trackNote(note, durSec, time, 'harmony');
        });
      } else {
        try {
          this.synthManager.chordSynth.triggerAttackRelease(notes, durSec, time, velocity);
        } catch (e) { console.error(e); }
        notes.forEach((note) => this.previewManager.trackNote(note, durSec, time, 'harmony'));
      }
    };

    if (pattern === 'hold') {
      if (relativeBeat === 0 || hasChordChanged) {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          playChord(remainingBeats, 0.6);
        }
      }
    } else if (pattern === 'quarters') {
      if (relativeBeat % 1 === 0) {
        playChord(0.8, 0.6);
      }
    } else if (pattern === 'eighths') {
      if (relativeBeat % 0.5 === 0) {
        playChord(0.4, 0.55);
      }
    } else if (pattern === 'pop') {
      const beatInPattern = relativeBeat % 4;
      if (beatInPattern === 0) {
        playChord(0.8, 0.6);
      } else if (beatInPattern === 1.5) {
        playChord(0.4, 0.55);
      } else if (beatInPattern === 2.5) {
        playChord(0.7, 0.6);
      } else if (beatInPattern === 3.5) {
        playChord(0.4, 0.55);
      }
    } else if (pattern === 'arpeggio') {
      if ((relativeBeat === 0 || hasChordChanged) && notes.length > 1 && block.type !== 'chord-only') {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          playNote(notes[0], remainingBeats, 0.7);
        }
      }
      if (relativeBeat % 0.5 === 0) {
        const arpNotes = notes.length > 1 && block.type !== 'chord-only' ? notes.slice(1) : notes;
        const period = (arpNotes.length - 1) * 2;
        const step = Math.round(relativeBeat / 0.5);
        let noteIndex = 0;
        if (period > 0) {
          const mod = step % period;
          noteIndex = mod < arpNotes.length ? mod : period - mod;
        }
        playNote(arpNotes[noteIndex], 0.4, 0.55);
      }
    } else if (pattern === 'strum') {
      if (relativeBeat === 0 || hasChordChanged) {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          notes.forEach((note, index) => {
            const strumOffset = index * 0.025;
            const noteTime = time + strumOffset;
            const noteDur = remainingBeats * beatDuration - strumOffset;

            if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
              try {
                this.chordsPiano.keyDown({ note, time: noteTime, velocity: 0.6 - index * 0.05 });
                this.chordsPiano.keyUp({ note, time: noteTime + noteDur });
              } catch (e) { console.error(e); }
            } else {
              try {
                this.synthManager.chordSynth.triggerAttackRelease(note, noteDur, noteTime, 0.6 - index * 0.05);
              } catch (e) { console.error(e); }
            }
          });
        }
      }
    } else {
      const customPattern = state.customPatterns?.find((p) => p.name === pattern);
      if (customPattern) {
        const cycleOffset = relativeBeat % customPattern.totalBeats;
        const tickBeatRounded = Math.round(cycleOffset * 4) / 4;
        const toPlay = customPattern.notes.filter((pn) => Math.round(pn.beatOffset * 4) / 4 === tickBeatRounded);

        for (const pn of toPlay) {
          if (block.type === 'bass-only' && pn.voice !== 'bass') continue;
          if (block.type === 'chord-only' && pn.voice !== 'chord') continue;

          const refOctave = pn.voice === 'bass' ? 2 : 4;
          const noteName = resolvePatternNoteToChord(pn, block.chord, refOctave, state.chordOctaveShift || 0);
          const durSec = pn.durationBeats * beatDuration;

          if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
            try {
              this.chordsPiano.keyDown({ note: noteName, time, velocity: pn.velocity });
              this.chordsPiano.keyUp({ note: noteName, time: time + durSec });
            } catch (e) { console.error(e); }
          } else {
            try {
              this.synthManager.chordSynth.triggerAttackRelease(noteName, durSec, time, pn.velocity);
            } catch (e) { console.error(e); }
          }
          this.previewManager.trackNote(noteName, durSec, time, 'harmony');
        }
      }
    }
  }

  private syncTimeline() {
    if (!this.isInitialized) return;

    const state = useSongStore.getState();
    const bpm = state.bpm;
    const beatDuration = 60 / bpm;
    const currentPos = Tone.Transport.seconds;

    this.scheduledEvents.forEach((id) => {
      try { Tone.Transport.clear(id); } catch (_) {}
    });
    this.scheduledEvents = [];

    const repeats = this.cachedMelodyMaxBeat > 0 && this.cachedMelodyMaxBeat < this.cachedMaxBeat
      ? Math.ceil(this.cachedMaxBeat / this.cachedMelodyMaxBeat)
      : 1;

    const tracksToPlay = state.tracks || [];

    for (let r = 0; r < repeats; r++) {
      const offsetBeat = r * this.cachedMelodyMaxBeat;
      tracksToPlay.forEach((track) => {
        const channelConfig = state.channels[track.channelId];
        if (channelConfig && channelConfig.muted) return;
        const isAnySolo = Object.values(state.channels).filter(c => c.id !== 'master').some((c) => c.solo);
        if (isAnySolo && channelConfig && !channelConfig.solo) return;

        (track.notes || []).forEach((note) => {
          const startTimeSeconds = (note.startBeat + offsetBeat) * beatDuration;
          const durationSeconds = note.durationBeats * beatDuration;

          if (startTimeSeconds >= this.cachedMaxBeat * beatDuration) return;

          const id = Tone.Transport.schedule((time) => {
            const isPiano = channelConfig?.instrument === 'piano';
            if (isPiano && this.melodyPiano && this.melodyPiano.loaded) {
              try {
                this.melodyPiano.keyDown({ note: note.note, time, velocity: note.velocity });
                this.melodyPiano.keyUp({ note: note.note, time: time + durationSeconds });
              } catch (e) { console.error('Error tocando nota de piano:', e); }
            } else {
              const synth = this.synthManager.getChannelSynth(track.channelId);
              if (channelConfig?.synthSettings) {
                try {
                  synth.set({
                    oscillator: { type: channelConfig.synthSettings.waveType },
                    envelope: channelConfig.synthSettings.envelope,
                    detune: channelConfig.synthSettings.detune
                  });
                } catch (_) {}
              }
              try {
                synth.triggerAttackRelease(note.note, durationSeconds, time, note.velocity);
              } catch (e) { console.error('Error tocando sintetizador de pista:', e); }
            }
            this.previewManager.trackNote(note.note, durationSeconds, time, 'melody');
          }, startTimeSeconds);
          this.scheduledEvents.push(id);
        });
      });
    }

    const maxBeat = this.updateCachedMaxBeat(state);
    const loopEndSeconds = maxBeat * beatDuration;

    this.transportManager.setLoop(state.isLooping, 0, loopEndSeconds);

    if (currentPos > loopEndSeconds) {
      Tone.Transport.seconds = loopEndSeconds;
    }
  }

  private updateSustain(sustain: boolean) {
    this.synthManager.updateSustain(sustain);
    [this.chordsPiano, this.melodyPiano].forEach((piano) => {
      if (piano) {
        try {
          if (sustain) piano.pedalDown();
          else piano.pedalUp();
        } catch (e) {
          console.error('Error al aplicar pedal de sustain en el piano:', e);
        }
      }
    });
  }

  public exportToWav(
    onProgress: (elapsed: number, total: number) => void,
    onComplete: (wavBlob: Blob) => void,
    onError: (err: Error) => void
  ): () => void {
    const state = useSongStore.getState();
    state.setIsExporting(true);
    state.setExportProgress(0);

    let cancelled = false;

    (async () => {
      try {
        const session = serializeSession(state);
        const drumBuffers = this.drumManager.getLoadedBuffers();
        const wavBlob = await renderSessionToWav(session, state.customPatterns || [], {
          drumBuffers,
          normalize: true,
          targetPeakDb: -0.3,
          onProgress: (elapsed, total) => {
            if (cancelled) return;
            const progress = total > 0 ? Math.min(1, elapsed / total) : 1;
            onProgress(elapsed, total);
            useSongStore.getState().setExportProgress(progress);
          }
        });

        if (cancelled) return;
        useSongStore.getState().setIsExporting(false);
        useSongStore.getState().setExportProgress(1);
        onComplete(wavBlob);
      } catch (err) {
        if (cancelled) return;
        useSongStore.getState().setIsExporting(false);
        useSongStore.getState().setExportProgress(0);
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      useSongStore.getState().setIsExporting(false);
      useSongStore.getState().setExportProgress(0);
    };
  }

  public exportToCompressed(
    onProgress: (elapsed: number, total: number) => void,
    onComplete: (result: { blob: Blob; extension: string; mimeType: string }) => void,
    onError: (err: Error) => void
  ): () => void {
    const state = useSongStore.getState();
    state.setIsExporting(true);
    state.setExportProgress(0);

    let cancelled = false;

    (async () => {
      try {
        const session = serializeSession(state);
        const drumBuffers = this.drumManager.getLoadedBuffers();
        const compressedResult = await renderSessionToCompressed(session, state.customPatterns || [], {
          drumBuffers,
          normalize: true,
          targetPeakDb: -0.3,
          onProgress: (elapsed, total) => {
            if (cancelled) return;
            const progress = total > 0 ? Math.min(1, elapsed / total) : 1;
            onProgress(elapsed, total);
            useSongStore.getState().setExportProgress(progress);
          }
        });

        if (cancelled) return;
        useSongStore.getState().setIsExporting(false);
        useSongStore.getState().setExportProgress(1);
        onComplete(compressedResult);
      } catch (err) {
        if (cancelled) return;
        useSongStore.getState().setIsExporting(false);
        useSongStore.getState().setExportProgress(0);
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      useSongStore.getState().setIsExporting(false);
      useSongStore.getState().setExportProgress(0);
    };
  }

  public dispose() {
    this.stop();
    Tone.Transport.cancel(0);
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.playheadRafId) {
      cancelAnimationFrame(this.playheadRafId);
      this.playheadRafId = null;
    }
    this.mixerGraph.dispose();
    this.synthManager.dispose();
    this.drumManager.dispose();
    this.previewManager.dispose();
    this.transportManager.dispose();
  }
}

export const toneEngine = new ToneEngine();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    toneEngine.dispose();
  });
}
