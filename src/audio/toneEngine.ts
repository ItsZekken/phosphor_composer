/**
 * toneEngine.ts
 * Fachada principal y orquestador del Motor de Audio de Phosphor.
 * Arquitectura modular y determinista con Pre-Scheduling en Tone.Transport.
 * Delega en subsistemas especializados: MixerGraph, ChannelInstrumentManager, DrumSoundManager, PreviewManager y AudioTransport.
 */

import * as Tone from 'tone';
import { useSongStore } from '../store/songStore';
import { NOTE_CLASSES, SCALE_INTERVALS } from '../core/music';
import { renderSessionToWav, renderSessionToCompressed, scheduleSessionTimeline } from '../core/audio';
import { serializeSession } from '../core/session';
import { MixerGraph, faderToDb } from '../core/audio/engine/MixerGraph';
import { ChannelInstrumentManager } from '../core/audio/engine/ChannelInstrumentManager';
import { DrumSoundManager } from '../core/audio/engine/DrumSoundManager';
import { PreviewManager } from '../core/audio/engine/PreviewManager';
import { AudioTransport } from '../core/audio/engine/AudioTransport';
import { LookaheadScheduler } from '../core/audio/lookaheadScheduler';
import { flattenPatternChain, type ChannelConfig, type SynthSettings } from '../utils/typeDefinitions';
import type { PatternDef } from '../patterns/patternTypes';
import { exportStageToMp4 } from '../core/video/stageVideoExporter';

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
  private instrumentManager: ChannelInstrumentManager;
  private drumManager: DrumSoundManager;
  private previewManager: PreviewManager;
  private transportManager: AudioTransport;
  private lookaheadScheduler: LookaheadScheduler;

  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  private cachedIsKeyboardMelodyEnabled = false;
  private cachedIsKeyboardChromatic = false;
  private cachedKeyboardCenterNote = 'C4';
  private cachedKey = 'C';
  private cachedScale = 'major';
  private cachedBpm = 120;
  private cachedMaxBeat = 16;

  private unsubscribeStore: (() => void) | null = null;
  private playheadRafId: number | null = null;
  private syncTimelineDebounced: () => void;

  private activePlaybackChordNotes = new Map<string, number>();
  private activePlaybackMelodyNotes = new Map<string, number>();
  private visualNotesTimerId: number | null = null;

  constructor() {
    this.mixerGraph = new MixerGraph();
    this.instrumentManager = new ChannelInstrumentManager(this.mixerGraph);
    this.drumManager = new DrumSoundManager(this.mixerGraph);
    this.previewManager = new PreviewManager({
      instrumentManager: this.instrumentManager,
      onActiveNotesChange: (notes) => useSongStore.getState().setActiveNotes(notes),
      onActiveMelodyNotesChange: (notes) => useSongStore.getState().setActiveMelodyNotes(notes)
    });
    this.transportManager = new AudioTransport();

    // Lookahead Scheduler en tiempo real (Zero Audio Glitches en edición interactiva)
    this.lookaheadScheduler = new LookaheadScheduler({
      onTriggerChord: (evt, time) => {
        const isPiano = useSongStore.getState().channels.chords?.instrument === 'piano';
        this.instrumentManager.triggerAttackRelease('chords', isPiano, evt.note, evt.durationSeconds, time, evt.velocity);
        this.scheduleVisualNote(evt.note, false, time, evt.durationSeconds);
      },
      onTriggerTrack: (evt, time) => {
        const channelConfig = useSongStore.getState().channels[evt.channelId];
        const isPiano = channelConfig?.instrument === 'piano';
        this.instrumentManager.triggerAttackRelease(evt.channelId, isPiano, evt.note, evt.durationSeconds, time, evt.velocity);
        this.scheduleVisualNote(evt.note, true, time, evt.durationSeconds);
      },
      onTriggerDrum: (evt, time) => {
        const volDb = Tone.gainToDb((evt.volume / 100) * evt.velocity);
        this.drumManager.triggerDrumSound(evt.channelId, evt.sampleUrl, volDb, evt.pan, time);
      },
      onTriggerMetronome: (freq, volumeFactor, time) => {
        this.transportManager.triggerMetroClick(freq, volumeFactor, time);
      },
      onTempoChange: (newBpm, beat, audioTime) => {
        this.cachedBpm = newBpm;
        Tone.Transport.bpm.value = newBpm;
        this.transportManager.setBpm(newBpm);
        useSongStore.getState().setLiveBpm(newBpm);

        // Despachar evento global del DOM para toda la aplicación
        window.dispatchEvent(new CustomEvent('phosphor-tempo-change', {
          detail: { bpm: newBpm, beat, audioTime }
        }));
      },
      onStepChange: (beat) => {
        const state = useSongStore.getState();
        if (!state.isPlaying) return;

        let patternIndex = state.currentDrumPatternEdit;
        let localStepIndex = 0;
        let currentChainItemId: string | null = null;
        const globalStepIndex = Math.floor(beat * 4);

        if (!state.isPatternRepeatOn && state.patternChain && state.patternChain.length > 0) {
          const flatChain = flattenPatternChain(state.patternChain);
          const totalChainSteps = flatChain.length * 16;
          if (totalChainSteps > 0) {
            const wrappedStep = globalStepIndex % totalChainSteps;
            const flatIdx = Math.floor(wrappedStep / 16);
            const step = flatChain[flatIdx];
            if (step) {
              patternIndex = step.patternIndex;
              localStepIndex = wrappedStep % 16;
              currentChainItemId = step.originalItemId;
            }
          }
        } else {
          localStepIndex = globalStepIndex % 16;
          patternIndex = state.currentDrumPatternEdit;
        }

        if (!state.isPatternRepeatOn) {
          state.setCurrentChainItemId(currentChainItemId);
          if (!state.isLiveFollowLocked && state.patternChain && state.patternChain.length > 0) {
            state.setCurrentDrumPatternEditLive(patternIndex);
          }
        }
        if (state.currentDrumPatternEdit === patternIndex || state.activeView === 'visualizer') {
          state.setPlaybackStep(localStepIndex);
        } else {
          state.setPlaybackStep(-1);
        }
      },
      onSongEnd: () => {
        const state = useSongStore.getState();
        if (!state.isLooping) {
          this.stop();
        }
      }
    });

    this.syncTimelineDebounced = debounce(() => {
      this.syncTimeline();
    }, 50);
  }

  private scheduleVisualNote(note: string, isMelody: boolean, triggerAudioTime: number, durationSeconds: number) {
    if (!note) return;
    const now = Tone.now();
    const delayMs = Math.max(0, (triggerAudioTime - now) * 1000);
    const durationMs = Math.max(80, Math.min(3000, durationSeconds * 1000));

    window.setTimeout(() => {
      if (!useSongStore.getState().isPlaying) return;

      const map = isMelody ? this.activePlaybackMelodyNotes : this.activePlaybackChordNotes;
      map.set(note, (map.get(note) || 0) + 1);
      this.flushVisualNotes();

      window.setTimeout(() => {
        const count = map.get(note) || 0;
        if (count <= 1) {
          map.delete(note);
        } else {
          map.set(note, count - 1);
        }
        this.flushVisualNotes();
      }, durationMs);
    }, delayMs);
  }

  private flushVisualNotes() {
    if (this.visualNotesTimerId !== null) return;
    this.visualNotesTimerId = window.requestAnimationFrame(() => {
      this.visualNotesTimerId = null;
      const state = useSongStore.getState();
      const chordNotes = Array.from(this.activePlaybackChordNotes.keys());
      const melodyNotes = Array.from(this.activePlaybackMelodyNotes.keys());
      state.setActiveNotes(chordNotes);
      state.setActiveMelodyNotes(melodyNotes);
    });
  }

  public clearActivePlaybackNotes() {
    this.activePlaybackChordNotes.clear();
    this.activePlaybackMelodyNotes.clear();
    const state = useSongStore.getState();
    if (state.activeNotes.length > 0) state.setActiveNotes([]);
    if (state.activeMelodyNotes.length > 0) state.setActiveMelodyNotes([]);
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

    const initialState = useSongStore.getState();
    const initialBpm = initialState.bpm || 120;
    this.cachedBpm = initialBpm;
    this.transportManager.setBpm(initialBpm);
    Tone.Transport.bpm.value = initialBpm;

    this.cachedIsKeyboardMelodyEnabled = initialState.isKeyboardMelodyEnabled;
    this.cachedIsKeyboardChromatic = initialState.isKeyboardChromatic;
    this.cachedKeyboardCenterNote = initialState.keyboardCenterNote || 'C4';
    this.cachedKey = initialState.key;
    this.cachedScale = initialState.scale;

    let prevBpm = initialBpm;
    let prevIsPlaying = initialState.isPlaying;
    let prevChannels = initialState.channels;
    let prevDrumChannels = initialState.drumChannels;
    let prevPatternChain = initialState.patternChain;
    let prevIsPatternRepeatOn = initialState.isPatternRepeatOn;
    let prevCurrentDrumPatternEdit = initialState.currentDrumPatternEdit;
    let prevChordBlocks = initialState.chordBlocks;
    let prevStyleMarkers = initialState.styleMarkers;
    let prevChordOctaveShift = initialState.chordOctaveShift;
    let prevTracks = initialState.tracks;
    let prevMelodyNotes = initialState.melodyNotes;
    let prevCustomPatterns = initialState.customPatterns;
    let prevIsLooping = initialState.isLooping;
    let prevIsMetronomeActive = initialState.isMetronomeActive;
    let prevMetroSubdivision = initialState.metroSubdivision;
    let prevMetroVolume = initialState.metroVolume;
    let prevTimeSignature = initialState.timeSignature;
    let prevPattern = initialState.pattern;
    let prevSwing = initialState.swing;
    let prevSustain = initialState.sustain;
    let prevTempoMarkers = initialState.tempoMarkers;

    this.unsubscribeStore = useSongStore.subscribe((state) => {
      this.cachedIsKeyboardMelodyEnabled = state.isKeyboardMelodyEnabled;
      this.cachedIsKeyboardChromatic = state.isKeyboardChromatic;
      this.cachedKey = state.key;
      this.cachedScale = state.scale;
      this.cachedBpm = state.bpm;

      let musicalContentChanged = false;

      // 1. Armonía y Acordes
      if (state.chordBlocks !== prevChordBlocks) {
        prevChordBlocks = state.chordBlocks;
        musicalContentChanged = true;
      }
      if (state.styleMarkers !== prevStyleMarkers) {
        prevStyleMarkers = state.styleMarkers;
        musicalContentChanged = true;
      }
      if (state.chordOctaveShift !== prevChordOctaveShift) {
        prevChordOctaveShift = state.chordOctaveShift;
        musicalContentChanged = true;
      }
      if (state.pattern !== prevPattern) {
        prevPattern = state.pattern;
        musicalContentChanged = true;
      }

      // 2. Piano Roll y Pistas Melódicas
      if (state.tracks !== prevTracks || state.melodyNotes !== prevMelodyNotes) {
        prevTracks = state.tracks;
        prevMelodyNotes = state.melodyNotes;
        musicalContentChanged = true;
      }

      // 3. Batería: Canales, Pasos y Cadena
      if (state.drumChannels !== prevDrumChannels) {
        prevDrumChannels = state.drumChannels;
        this.drumManager.preloadChannels(state.drumChannels);
        musicalContentChanged = true;
      }
      if (state.patternChain !== prevPatternChain) {
        prevPatternChain = state.patternChain;
        musicalContentChanged = true;
      }
      if (state.isPatternRepeatOn !== prevIsPatternRepeatOn) {
        prevIsPatternRepeatOn = state.isPatternRepeatOn;
        musicalContentChanged = true;
      }
      if (state.currentDrumPatternEdit !== prevCurrentDrumPatternEdit) {
        prevCurrentDrumPatternEdit = state.currentDrumPatternEdit;
        if (state.isPatternRepeatOn) {
          musicalContentChanged = true;
        }
      }

      // 4. Patrones rítmicos personalizados
      if (state.customPatterns !== prevCustomPatterns) {
        prevCustomPatterns = state.customPatterns;
        musicalContentChanged = true;
      }

      // 5. Estructura de Transporte y Tempo
      if (state.isLooping !== prevIsLooping) {
        prevIsLooping = state.isLooping;
        musicalContentChanged = true;
      }
      if (state.tempoMarkers !== prevTempoMarkers) {
        prevTempoMarkers = state.tempoMarkers;
        musicalContentChanged = true;
      }
      if (state.bpm !== prevBpm) {
        prevBpm = state.bpm;
        this.cachedBpm = state.bpm;
        this.transportManager.setBpm(state.bpm);
        Tone.Transport.bpm.value = state.bpm;
        musicalContentChanged = true;
      }

      // 6. Mezclador (Mute, Solo, Volumen)
      if (state.channels !== prevChannels) {
        prevChannels = state.channels;
        this.syncChannels(state.channels);
        musicalContentChanged = true;
      }

      // 7. Configuración de Metrónomo
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
        this.lookaheadScheduler.setMetronomeConfig(
          state.isMetronomeActive,
          state.metroSubdivision,
          state.timeSignature
        );
        this.transportManager.syncMetronome(
          state.isMetronomeActive,
          state.metroVolume
        );
      }

      // 8. Control de Reproducción (Play / Stop)
      if (state.isPlaying !== prevIsPlaying) {
        prevIsPlaying = state.isPlaying;
        if (state.isPlaying) {
          this.syncTimeline();
          this.lookaheadScheduler.start(state.currentBeat, state.bpm, state.tempoMarkers);
          const liveSec = this.lookaheadScheduler.getLiveSeconds();
          this.transportManager.start(state.currentBeat, state.bpm, liveSec);
        } else {
          this.lookaheadScheduler.stop();
          this.transportManager.pause();
          this.silence();
        }
      }

      // 9. Hot-Reloading: sincronización continua en caliente si hay reproducción activa
      if (musicalContentChanged && state.isPlaying) {
        this.syncTimelineDebounced();
      }

      // 10. Modulaciones globales (Swing, Sustain)
      if (state.swing !== prevSwing) {
        prevSwing = state.swing;
        Tone.Transport.swing = state.swing;
        Tone.Transport.swingSubdivision = '16n';
      }
      if (state.sustain !== prevSustain) {
        prevSustain = state.sustain;
        this.updateSustain(state.sustain);
      }
    });

    this.lookaheadScheduler.setMetronomeConfig(
      initialState.isMetronomeActive,
      initialState.metroSubdivision,
      initialState.timeSignature
    );
    this.transportManager.syncMetronome(
      initialState.isMetronomeActive,
      initialState.metroVolume
    );
    this.syncChannels(initialState.channels);
    this.updateSustain(initialState.sustain);
  }

  public getAnalyser(): Tone.Analyser {
    return this.mixerGraph.getAnalyser();
  }

  public getFftAnalyser(): Tone.Analyser {
    return this.mixerGraph.getFftAnalyser();
  }

  public getLiveBeat(): number {
    if (!this.isInitialized) return 0;
    return this.lookaheadScheduler.getLiveBeat();
  }

  public getLiveBpm(): number {
    if (!this.isInitialized) return this.cachedBpm;
    return this.lookaheadScheduler.getLiveBpm();
  }

  public getMaxBeat(): number {
    return this.cachedMaxBeat;
  }

  public getWaveformData(target?: Float32Array): Float32Array {
    return this.mixerGraph.getWaveformData(target);
  }

  public getFrequencyData(target?: Float32Array): Float32Array {
    return this.mixerGraph.getFrequencyData(target);
  }

  public getChannelMeterLevel(id: string): number {
    return this.mixerGraph.getChannelMeterLevel(id);
  }

  public updateSynthSettings(settings: Partial<SynthSettings>, channelId?: string) {
    this.instrumentManager.updateSynthSettings(settings, channelId);
  }

  public getChannelWaveformData(channelId: string, target?: Float32Array): Float32Array {
    return this.instrumentManager.getChannelWaveform(channelId, target);
  }

  public getChannelFrequencyData(channelId: string, target?: Float32Array): Float32Array {
    return this.instrumentManager.getChannelFrequency(channelId, target);
  }

  public disconnectSynthAnalysers() {
    this.instrumentManager.disconnectAnalysers();
  }

  public isPianoLoaded(channelId = 'melody'): boolean {
    return this.instrumentManager.isPianoLoaded(channelId);
  }

  public isPianoLoading(channelId = 'melody'): boolean {
    return this.instrumentManager.isPianoLoading(channelId);
  }

  public async loadPiano(channelId = 'melody'): Promise<boolean> {
    const piano = this.instrumentManager.getChannelPiano(channelId);
    return piano.load();
  }

  public async preloadProjectAudio(
    channels?: Record<string, ChannelConfig>,
    drumChannels?: Array<{ id: string; sampleUrl: string; pan?: number }>
  ): Promise<void> {
    if (!this.isInitialized) await this.init();
    const state = useSongStore.getState();
    const targetChannels = channels || state.channels;
    const targetDrumChannels = drumChannels || state.drumChannels;

    if (state.bpm) {
      this.transportManager.setBpm(state.bpm);
      Tone.Transport.bpm.value = state.bpm;
      this.cachedBpm = state.bpm;
    }
    this.syncChannels(targetChannels);

    const instrumentPreload = this.instrumentManager.preloadChannelInstruments(targetChannels);
    const drumPreload = this.drumManager.preloadChannels(targetDrumChannels || []);
    await Promise.allSettled([instrumentPreload, drumPreload]);
  }

  public syncChannels(channels: Record<string, ChannelConfig>) {
    if (!channels) return;
    this.mixerGraph.syncChannels(channels);
    this.instrumentManager.syncActiveChannels(Object.keys(channels));
    this.instrumentManager.preloadChannelInstruments(channels);
  }

  public playNotePreview(note: string, channelId: string = 'melody') {
    const isPiano = useSongStore.getState().channels[channelId]?.instrument === 'piano';
    this.previewManager.playNotePreview(note, channelId, isPiano);
  }

  public playChordPreview(chordName: string, chordOctaveShift = 0) {
    this.previewManager.playChordPreview(chordName, chordOctaveShift);
  }

  public playChordPreviewStart(
    chordName: string,
    options?: {
      pattern?: string;
      chordOctaveShift?: number;
      bpm?: number;
      customPatterns?: PatternDef[];
    }
  ) {
    const state = useSongStore.getState();
    this.previewManager.playChordPreviewStart(chordName, {
      pattern: options?.pattern || state.pattern || 'hold',
      chordOctaveShift: options?.chordOctaveShift ?? state.chordOctaveShift ?? 0,
      bpm: options?.bpm ?? state.bpm ?? 120,
      customPatterns: options?.customPatterns || state.customPatterns || []
    });
  }

  public playChordPreviewStop(_chordName?: string) {
    this.previewManager.playChordPreviewStop();
  }

  public startNote(note: string, channelId = 'melody') {
    const isPiano = useSongStore.getState().channels[channelId]?.instrument === 'piano';
    this.previewManager.startNote(note, channelId, isPiano);
  }

  public stopNote(note: string, channelId = 'melody') {
    const isPiano = useSongStore.getState().channels[channelId]?.instrument === 'piano';
    this.previewManager.stopNote(note, channelId, isPiano);
  }

  public silence() {
    this.clearActivePlaybackNotes();
    this.instrumentManager.releaseAll();
    this.previewManager.dispose();
    this.drumManager.stopAll();
  }

  public stop() {
    this.lookaheadScheduler.stop();
    this.transportManager.stop();
    this.silence();
    const state = useSongStore.getState();
    state.setPlaying(false);
    state.setCurrentBeat(0);
    state.setPlaybackStep(-1);
    state.setCurrentChainItemId(null);
    state.setLiveBpm(state.bpm);
  }

  public setVolume(val: number) {
    const masterNode = this.mixerGraph.getChannelNode('master');
    masterNode.volumeNode.volume.value = faderToDb(val);
  }

  public getLiveSeconds(): number {
    if (!this.isInitialized) return 0;
    return this.lookaheadScheduler.getLiveSeconds();
  }

  public setSeconds(seconds: number) {
    Tone.Transport.seconds = seconds;
    const currentBeat = seconds * (useSongStore.getState().bpm / 60);
    useSongStore.getState().setCurrentBeat(currentBeat);
  }

  public seekToBeat(beat: number) {
    if (!this.isInitialized) this.init();
    this.lookaheadScheduler.seek(beat);
    const bpmAtBeat = this.lookaheadScheduler.getLiveBpm();
    this.cachedBpm = bpmAtBeat;
    Tone.Transport.bpm.value = bpmAtBeat;
    const liveSec = this.lookaheadScheduler.getLiveSeconds();
    this.transportManager.seek(beat, bpmAtBeat, liveSec);
    useSongStore.getState().setCurrentBeat(beat);
    useSongStore.getState().setLiveBpm(bpmAtBeat);
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

  /**
   * Sincronización continua de la sesión en el LookaheadScheduler (Zero Audio Glitches).
   */
  private syncTimeline() {
    if (!this.isInitialized) return;

    const state = useSongStore.getState();
    const bpm = state.bpm || 120;
    this.cachedBpm = bpm;

    this.transportManager.setBpm(bpm);
    Tone.Transport.bpm.value = bpm;

    const session = serializeSession(state);
    const scheduled = scheduleSessionTimeline(session, state.customPatterns || []);
    this.cachedMaxBeat = scheduled.totalBeats;

    this.lookaheadScheduler.setEvents(scheduled, bpm, state.isLooping, state.tempoMarkers);

    const loopEndSeconds = scheduled.totalDurationSeconds - 2.0;
    this.transportManager.setLoop(state.isLooping, 0, loopEndSeconds);
  }

  private updateSustain(sustain: boolean) {
    this.instrumentManager.updateSustain(sustain);
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

  public async exportStageVideo(
    options: {
      resolution?: '1080p' | '720p';
      visualizerMode?: 'oscilloscope' | 'spectrum' | 'lissajous';
      isCrtEnabled?: boolean;
      onProgress?: (progress: number, phase: string, elapsedMs: number) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<Blob> {
    const state = useSongStore.getState();
    const session = serializeSession(state);
    const drumBuffers = this.drumManager.getLoadedBuffers();

    const width = options.resolution === '720p' ? 1280 : 1920;
    const height = options.resolution === '720p' ? 720 : 1080;

    return exportStageToMp4(session, state.customPatterns || [], {
      width,
      height,
      fps: 30,
      visualizerMode: options.visualizerMode || 'oscilloscope',
      isCrtEnabled: options.isCrtEnabled ?? true,
      drumBuffers,
      onProgress: options.onProgress,
      signal: options.signal
    });
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
    this.instrumentManager.dispose();
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
