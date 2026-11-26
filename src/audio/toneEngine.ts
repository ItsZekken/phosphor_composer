/**
 * toneEngine.ts
 * Fachada principal y orquestador del Motor de Audio de Phosphor.
 * Arquitectura modular y determinista con Pre-Scheduling en Tone.Transport.
 * Delega en subsistemas especializados: MixerGraph, ChannelInstrumentManager, DrumSoundManager, PreviewManager y AudioTransport.
 */

import * as Tone from 'tone';
import { useSongStore } from '../store/songStore';
import { NOTE_CLASSES, SCALE_INTERVALS } from '../core/music';
import { renderSessionToWav, renderSessionToCompressed, scheduleStoreTimeline } from '../core/audio';
import { liveTelemetryBus } from '../core/audio/liveTelemetryBus';
import { serializeSession } from '../core/session';
import { MixerGraph, faderToDb } from '../core/audio/engine/MixerGraph';
import { ChannelInstrumentManager } from '../core/audio/engine/ChannelInstrumentManager';
import { DrumSoundManager } from '../core/audio/engine/DrumSoundManager';
import { PreviewManager } from '../core/audio/engine/PreviewManager';
import { AudioTransport } from '../core/audio/engine/AudioTransport';
import { AudioTrackEngine } from '../core/audio/engine/AudioTrackEngine';
import { LookaheadScheduler } from '../core/audio/lookaheadScheduler';
import {
  normalizePatternChainToLinear,
  type ChannelConfig,
  type ChannelSoundFontConfig,
  type SynthSettings,
  type PianoRollTrack
} from '../utils/typeDefinitions';
import type { PatternDef } from '../patterns/patternTypes';
import { exportStageToMp4 } from '../core/video/stageVideoExporter';
import { ensurePhosphorWorkletRegistered, getNativeAudioContext } from '../core/audio/worklet/PhosphorWorkletNode';

// Helper debounce simple
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, delay);
  }) as T;
}

const didTracksMusicalContentChange = (prev: PianoRollTrack[] | undefined, next: PianoRollTrack[] | undefined): boolean => {
  if (prev === next) return false;
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (
      prev[i].id !== next[i].id ||
      prev[i].channelId !== next[i].channelId ||
      prev[i].notes !== next[i].notes
    ) {
      return true;
    }
  }
  return false;
};

const didChannelsAudioRoutingChange = (
  prev: Record<string, ChannelConfig> | undefined,
  next: Record<string, ChannelConfig> | undefined
): boolean => {
  if (prev === next) return false;
  if (!prev || !next) return true;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;
  for (let i = 0; i < nextKeys.length; i++) {
    const id = nextKeys[i];
    const p = prev[id];
    const n = next[id];
    if (!p || !n) return true;
    if (p.instrument !== n.instrument || p.muted !== n.muted || p.solo !== n.solo) {
      return true;
    }
  }
  return false;
};

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
  private audioTrackEngine: AudioTrackEngine;
  private lookaheadScheduler: LookaheadScheduler;

  private isInitialized = false;
  private unlockGestureBound = false;

  private cachedIsKeyboardMelodyEnabled = false;
  private cachedIsKeyboardChromatic = false;
  private cachedKeyboardCenterNote = 'C4';
  private cachedKey = 'C';
  private cachedScale = 'major';
  private cachedBpm = 120;
  private cachedMaxBeat = 16;

  private unsubscribeStore: (() => void) | null = null;
  private hasSubscribedToStore = false;
  private playheadRafId: number | null = null;
  private syncTimelineDebounced: () => void;

  private cachedPatternChainRef: any = null;
  private cachedLinearPatternChain: ReturnType<typeof normalizePatternChainToLinear> = [];
  private cachedSyncedChannelsRef: Record<string, ChannelConfig> | undefined = undefined;

  constructor() {
    this.mixerGraph = new MixerGraph();
    this.instrumentManager = new ChannelInstrumentManager(this.mixerGraph);
    this.drumManager = new DrumSoundManager(this.mixerGraph);
    this.audioTrackEngine = new AudioTrackEngine(this.mixerGraph);
    this.previewManager = new PreviewManager({
      instrumentManager: this.instrumentManager,
      onActiveNotesChange: (notes) => liveTelemetryBus.setManualNotes('harmony', notes),
      onActiveMelodyNotesChange: (notes) => liveTelemetryBus.setManualNotes('melody', notes)
    });
    this.transportManager = new AudioTransport();

    // Lookahead Scheduler en tiempo real (Zero Audio Glitches en edición interactiva)
    this.lookaheadScheduler = new LookaheadScheduler({
      onScheduleWindow: (startSec, endSec, currentAudioSeconds, tempoMap) => {
        this.audioTrackEngine.scheduleWindow(startSec, endSec, currentAudioSeconds, tempoMap);
      },
      onLoopWrap: () => {
        this.audioTrackEngine.onLoopWrap();
      },
      onTriggerChord: (evt, time) => {
        const chordInstrument = useSongStore.getState().channels.chords?.instrument || 'synth';
        this.instrumentManager.triggerAttackRelease('chords', chordInstrument, evt.note, evt.durationSeconds, time, evt.velocity);
        this.scheduleVisualNote(evt.note, false, time, evt.durationSeconds);
      },
      onTriggerTrack: (evt, time) => {
        const channelConfig = useSongStore.getState().channels[evt.channelId];
        const trackInstrument = channelConfig?.instrument || 'synth';
        this.instrumentManager.triggerAttackRelease(evt.channelId, trackInstrument, evt.note, evt.durationSeconds, time, evt.velocity);
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
        try { Tone.Transport.bpm.value = newBpm; } catch (_) {}
        this.transportManager.setBpm(newBpm);
        this.instrumentManager.setBpm(newBpm);
        useSongStore.getState().setLiveBpm(newBpm);

        // Despachar evento global del DOM para toda la aplicación
        window.dispatchEvent(new CustomEvent('phosphor-tempo-change', {
          detail: { bpm: newBpm, beat, audioTime }
        }));
      },
      onStepChange: (beat) => {
        const state = useSongStore.getState();
        if (!state.isPlaying) return;

        const beatsPerMeasure = state.timeSignature === '3/4' ? 3 : state.timeSignature === '6/8' ? 6 : 4;
        let patternIndex = state.currentDrumPatternEdit;
        let localStepIndex = 0;
        let currentChainItemId: string | null = null;
        const activeChainItemIds: string[] = [];

        if (!state.isPatternRepeatOn && state.patternChain && state.patternChain.length > 0) {
          if (state.patternChain !== this.cachedPatternChainRef) {
            this.cachedPatternChainRef = state.patternChain;
            this.cachedLinearPatternChain = normalizePatternChainToLinear(state.patternChain);
          }
          const linearClips = this.cachedLinearPatternChain;
          const laneMuted = state.drumLaneMuted || [];
          const loopBeats = Math.max(beatsPerMeasure, this.cachedMaxBeat || beatsPerMeasure);
          const wrappedBeat = ((beat % loopBeats) + loopBeats) % loopBeats;
          const currentMeasure = wrappedBeat / beatsPerMeasure;
          let primaryActiveClip: typeof linearClips[number] | undefined;
          let matchingEditClip: typeof linearClips[number] | undefined;

          for (let i = 0; i < linearClips.length; i++) {
            const c = linearClips[i];
            if (
              !c.isMuted &&
              !laneMuted[c.laneIndex] &&
              currentMeasure >= c.startMeasure - 1e-6 &&
              currentMeasure < c.startMeasure + c.durationMeasures - 1e-6
            ) {
              activeChainItemIds.push(c.id);
              if (!primaryActiveClip) primaryActiveClip = c;
              if (!matchingEditClip && c.patternIndex === state.currentDrumPatternEdit) {
                matchingEditClip = c;
              }
            }
          }

          const stepClip = matchingEditClip || primaryActiveClip;
          if (stepClip) {
            patternIndex = stepClip.patternIndex;
            currentChainItemId = primaryActiveClip ? primaryActiveClip.id : stepClip.id;
            const beatInMeasure = wrappedBeat - Math.floor(currentMeasure) * beatsPerMeasure;
            const patternLen = state.patternLengths?.[patternIndex] || 16;
            localStepIndex = Math.min(patternLen - 1, Math.max(0, Math.floor((beatInMeasure / beatsPerMeasure) * patternLen)));
          } else {
            patternIndex = state.currentDrumPatternEdit;
            currentChainItemId = null;
            localStepIndex = -1;
          }
        } else {
          patternIndex = state.currentDrumPatternEdit;
          const beatInMeasure = ((beat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
          const patternLen = state.patternLengths?.[patternIndex] || 16;
          localStepIndex = Math.min(patternLen - 1, Math.max(0, Math.floor((beatInMeasure / beatsPerMeasure) * patternLen)));
        }

        if (!state.isPatternRepeatOn && !state.isLiveFollowLocked && state.patternChain && state.patternChain.length > 0) {
          if (state.currentDrumPatternEdit !== patternIndex) {
            state.setCurrentDrumPatternEditLive(patternIndex);
          }
        }
        const emittedStep = (state.currentDrumPatternEdit === patternIndex || state.activeView === 'visualizer')
          ? localStepIndex
          : -1;
        liveTelemetryBus.emitDrumStep(
          emittedStep,
          state.isPatternRepeatOn ? null : currentChainItemId,
          state.isPatternRepeatOn ? [] : activeChainItemIds
        );
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

    this.ensureStoreSubscribed();
    this.bindGlobalGestureUnlock();
  }

  private bindGlobalGestureUnlock() {
    if (this.unlockGestureBound || typeof window === 'undefined') return;
    this.unlockGestureBound = true;

    const handleFirstGesture = () => {
      this.unlockIfSuspended();
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      const nativeCtx = getNativeAudioContext(rawCtx);
      if (nativeCtx?.state === 'running' || rawCtx?.state === 'running') {
        window.removeEventListener('pointerdown', handleFirstGesture, true);
        window.removeEventListener('keydown', handleFirstGesture, true);
        window.removeEventListener('touchstart', handleFirstGesture, true);
      }
    };

    window.addEventListener('pointerdown', handleFirstGesture, { capture: true, passive: true });
    window.addEventListener('keydown', handleFirstGesture, { capture: true, passive: true });
    window.addEventListener('touchstart', handleFirstGesture, { capture: true, passive: true });
  }

  public unlockIfSuspended(): void {
    const rawCtx = Tone.getContext().rawContext as AudioContext;
    const nativeCtx = getNativeAudioContext(rawCtx);

    if (nativeCtx?.state === 'running' || rawCtx?.state === 'running') {
      this.isInitialized = true;
      return;
    }

    try { Tone.start().catch(() => {}); } catch (_) {}
    if (rawCtx && rawCtx.state === 'suspended') {
      try { rawCtx.resume().catch(() => {}); } catch (_) {}
    }
    if (nativeCtx && nativeCtx !== rawCtx && nativeCtx.state === 'suspended') {
      try { nativeCtx.resume().catch(() => {}); } catch (_) {}
    }
  }

  private scheduleVisualNote(note: string, isMelody: boolean, triggerAudioTime: number, durationSeconds: number) {
    if (!note) return;
    liveTelemetryBus.scheduleVisualNote(note, triggerAudioTime, durationSeconds, isMelody ? 'melody' : 'harmony');
  }

  public clearActivePlaybackNotes() {
    liveTelemetryBus.clearScheduledNotes();
  }

  public async init(interactive = true): Promise<boolean> {
    this.ensureStoreSubscribed();

    const rawCtx = Tone.getContext().rawContext as AudioContext;
    const nativeCtx = getNativeAudioContext(rawCtx);
    const isAlreadyRunning = Boolean(nativeCtx?.state === 'running' || rawCtx?.state === 'running');

    // Siempre disparar registro del worklet en segundo plano (funciona aunque esté suspended)
    const workletPromise =
      rawCtx && typeof rawCtx.audioWorklet?.addModule === 'function'
        ? ensurePhosphorWorkletRegistered(rawCtx).catch(() => false)
        : Promise.resolve(false);

    if (isAlreadyRunning) {
      this.isInitialized = true;
      await Promise.race([workletPromise, new Promise((r) => setTimeout(r, 120))]);
      return true;
    }

    if (!interactive) {
      await Promise.race([workletPromise, new Promise((r) => setTimeout(r, 250))]);
      const runningAfter = Boolean(
        getNativeAudioContext(Tone.getContext().rawContext)?.state === 'running' ||
        (Tone.getContext().rawContext as AudioContext)?.state === 'running'
      );
      if (runningAfter) {
        this.isInitialized = true;
      }
      return this.isInitialized;
    }

    // Modo interactivo (dentro de user gesture): disparar Tone.start() y resume() SÍNCRONAMENTE en el call stack actual
    const p1 = (() => {
      try {
        return Tone.start().catch(() => {});
      } catch (_) {
        return Promise.resolve();
      }
    })();
    const p2 = rawCtx?.state === 'suspended' ? rawCtx.resume().catch(() => {}) : Promise.resolve();
    const p3 =
      nativeCtx && nativeCtx !== rawCtx && nativeCtx.state === 'suspended'
        ? nativeCtx.resume().catch(() => {})
        : Promise.resolve();

    await Promise.race([
      Promise.all([p1, p2, p3]),
      new Promise((resolve) => setTimeout(resolve, 450))
    ]);

    await Promise.race([workletPromise, new Promise((resolve) => setTimeout(resolve, 200))]);

    const currentRaw = Tone.getContext().rawContext as AudioContext;
    const currentNative = getNativeAudioContext(currentRaw);
    this.isInitialized = Boolean(currentNative?.state === 'running' || currentRaw?.state === 'running');

    return this.isInitialized;
  }

  private ensureStoreSubscribed() {
    if (this.hasSubscribedToStore) return;
    this.hasSubscribedToStore = true;

    const initialState = useSongStore.getState();
    const initialBpm = initialState.bpm || 120;
    this.cachedBpm = initialBpm;
    this.transportManager.setBpm(initialBpm);
    this.instrumentManager.setBpm(initialBpm);
    try { Tone.Transport.bpm.value = initialBpm; } catch (_) {}

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
    let prevDrumLaneMuted = initialState.drumLaneMuted;
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
    let prevAudioTracks = initialState.audioTracks;
    let prevAudioClips = initialState.audioClips;
    let prevPatternLengths = initialState.patternLengths;

    this.unsubscribeStore = useSongStore.subscribe((state) => {
      this.cachedIsKeyboardMelodyEnabled = state.isKeyboardMelodyEnabled;
      this.cachedIsKeyboardChromatic = state.isKeyboardChromatic;
      this.cachedKeyboardCenterNote = state.keyboardCenterNote || 'C4';
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
      if (didTracksMusicalContentChange(prevTracks, state.tracks) || state.melodyNotes !== prevMelodyNotes) {
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
      if (state.drumLaneMuted !== prevDrumLaneMuted) {
        prevDrumLaneMuted = state.drumLaneMuted;
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
      if (state.patternLengths !== prevPatternLengths) {
        prevPatternLengths = state.patternLengths;
        musicalContentChanged = true;
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
        this.instrumentManager.setBpm(state.bpm);
        try { Tone.Transport.bpm.value = state.bpm; } catch (_) {}
        musicalContentChanged = true;
      }

      // 6. Mezclador (sólo reconstruir timeline si cambia instrumento, mute o solo; faders/pan/knobs son instantáneos)
      if (state.channels !== prevChannels) {
        if (didChannelsAudioRoutingChange(prevChannels, state.channels)) {
          musicalContentChanged = true;
        }
        prevChannels = state.channels;
        this.syncChannels(state.channels);
      }

      // 7. Configuración de Metrónomo
      if (
        state.isMetronomeActive !== prevIsMetronomeActive ||
        state.metroSubdivision !== prevMetroSubdivision ||
        state.metroVolume !== prevMetroVolume ||
        state.timeSignature !== prevTimeSignature
      ) {
        if (state.timeSignature !== prevTimeSignature) {
          musicalContentChanged = true;
        }
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
          const doPlay = () => {
            this.syncTimeline();
            this.lookaheadScheduler.start(state.currentBeat, state.bpm, state.tempoMarkers);
            const liveSec = this.lookaheadScheduler.getLiveSeconds();
            this.transportManager.start(state.currentBeat, state.bpm, liveSec);
          };

          const rawCtx = Tone.getContext().rawContext as AudioContext;
          const nativeCtx = getNativeAudioContext(rawCtx);
          const isRunning = Boolean(nativeCtx?.state === 'running' || rawCtx?.state === 'running');

          if (isRunning) {
            this.isInitialized = true;
            doPlay();
          } else {
            this.init(true).then(() => {
              if (useSongStore.getState().isPlaying) {
                doPlay();
              }
            }).catch((err) => {
              console.error('[ToneEngine] Error al iniciar AudioContext para reproducción:', err);
              useSongStore.getState().setPlaying(false);
            });
          }
        } else {
          this.lookaheadScheduler.stop(false);
          this.transportManager.pause();
          this.silence();
        }
      }

      // 9. Modulaciones globales (Swing, Sustain)
      if (state.swing !== prevSwing) {
        prevSwing = state.swing;
        musicalContentChanged = true;
        try {
          Tone.Transport.swing = state.swing;
          Tone.Transport.swingSubdivision = '16n';
        } catch (_) {}
      }
      if (state.sustain !== prevSustain) {
        prevSustain = state.sustain;
        this.updateSustain(state.sustain);
      }

      // 10. Pistas y Clips de Audio Multitrack
      if (state.audioTracks !== prevAudioTracks) {
        prevAudioTracks = state.audioTracks;
        this.mixerGraph.syncAudioTracks(state.audioTracks || []);
        musicalContentChanged = true;
      }
      if (state.audioClips !== prevAudioClips) {
        prevAudioClips = state.audioClips;
        musicalContentChanged = true;
      }

      // 11. Hot-Reloading: sincronización continua en caliente si hay reproducción activa
      if (musicalContentChanged && state.isPlaying) {
        this.syncTimelineDebounced();
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
    this.mixerGraph.syncAudioTracks(initialState.audioTracks || []);
    this.updateSustain(initialState.sustain);
    this.syncTimeline();
  }

  public getAnalyser(): Tone.Analyser {
    return this.mixerGraph.getAnalyser();
  }

  public getFftAnalyser(): Tone.Analyser {
    return this.mixerGraph.getFftAnalyser();
  }

  public getLiveBeat(): number {
    if (!this.isInitialized && !useSongStore.getState().isPlaying) return useSongStore.getState().currentBeat || 0;
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

  public updateSoundFontConfig(channelId: string, config?: ChannelSoundFontConfig) {
    this.instrumentManager.updateSoundFontConfig(channelId, config);
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
    if (!this.isInitialized) await this.init(false);
    const state = useSongStore.getState();
    const targetChannels = channels || state.channels;
    const targetDrumChannels = drumChannels || state.drumChannels;

    if (state.bpm) {
      this.transportManager.setBpm(state.bpm);
      this.instrumentManager.setBpm(state.bpm);
      try { Tone.Transport.bpm.value = state.bpm; } catch (_) {}
      this.cachedBpm = state.bpm;
    }
    this.syncChannels(targetChannels);

    const instrumentPreload = this.instrumentManager.preloadChannelInstruments(targetChannels);
    const drumPreload = this.drumManager.preloadChannels(targetDrumChannels || []);
    await Promise.allSettled([instrumentPreload, drumPreload]);
  }

  public syncChannels(channels: Record<string, ChannelConfig>) {
    if (!channels) return;
    const prev = this.cachedSyncedChannelsRef;
    this.cachedSyncedChannelsRef = channels;

    this.mixerGraph.syncChannels(channels);

    const routingChanged = !prev || didChannelsAudioRoutingChange(prev, channels);
    if (routingChanged) {
      this.instrumentManager.syncActiveChannels(Object.keys(channels));
      this.instrumentManager.preloadChannelInstruments(channels);
      return;
    }

    // Si solo cambiaron faders/pan/knobs (o undo/redo de synthSettings / soundfontConfig), no recargar todos los instrumentos
    for (const [id, ch] of Object.entries(channels)) {
      if (ch.synthSettings && prev[id]?.synthSettings !== ch.synthSettings && ch.instrument === 'synth') {
        this.instrumentManager.updateSynthSettings(ch.synthSettings, id);
      }
      if (ch.soundfontConfig !== prev[id]?.soundfontConfig && ch.instrument === 'soundfont') {
        this.instrumentManager.updateSoundFontConfig(id, ch.soundfontConfig);
      }
    }
  }

  public playNotePreview(note: string, channelId: string = 'melody', velocity = 0.8) {
    this.unlockIfSuspended();
    const instrument = useSongStore.getState().channels[channelId]?.instrument || 'synth';
    this.previewManager.playNotePreview(note, channelId, instrument, velocity);
  }

  public playChordPreview(chordName: string, chordOctaveShift = 0) {
    this.unlockIfSuspended();
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
    this.unlockIfSuspended();
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

  public startNote(note: string, channelId = 'melody', velocity = 0.8) {
    this.unlockIfSuspended();
    const instrument = useSongStore.getState().channels[channelId]?.instrument || 'synth';
    this.previewManager.startNote(note, channelId, instrument, velocity);
  }

  public stopNote(note: string, channelId = 'melody') {
    const instrument = useSongStore.getState().channels[channelId]?.instrument || 'synth';
    this.previewManager.stopNote(note, channelId, instrument);
  }

  public silence() {
    this.clearActivePlaybackNotes();
    this.instrumentManager.releaseAll();
    this.previewManager.dispose();
    this.drumManager.stopAll();
    this.audioTrackEngine.stop();
  }

  public stop() {
    this.lookaheadScheduler.stop(true);
    this.transportManager.stop();
    this.silence();
    liveTelemetryBus.reset();
    const state = useSongStore.getState();
    state.setPlaying(false);
    state.setCurrentBeat(0);
    state.setLiveBpm(state.bpm);
  }

  public setVolume(val: number) {
    const masterNode = this.mixerGraph.getChannelNode('master');
    masterNode.volumeNode.volume.value = faderToDb(val);
  }

  public getLiveSeconds(): number {
    if (!this.isInitialized && !useSongStore.getState().isPlaying) return 0;
    return this.lookaheadScheduler.getLiveSeconds();
  }

  public setSeconds(seconds: number) {
    Tone.Transport.seconds = seconds;
    const currentBeat = seconds * (useSongStore.getState().bpm / 60);
    useSongStore.getState().setCurrentBeat(currentBeat);
  }

  public seekToBeat(beat: number) {
    this.unlockIfSuspended();
    this.lookaheadScheduler.seek(beat);
    this.audioTrackEngine.seek();
    const bpmAtBeat = this.lookaheadScheduler.getLiveBpm();
    this.cachedBpm = bpmAtBeat;
    this.instrumentManager.setBpm(bpmAtBeat);
    try { Tone.Transport.bpm.value = bpmAtBeat; } catch (_) {}
    const liveSec = this.lookaheadScheduler.getLiveSeconds();
    this.transportManager.seek(beat, bpmAtBeat, liveSec);
    useSongStore.getState().setCurrentBeat(beat);
    useSongStore.getState().setLiveBpm(bpmAtBeat);
    if (!useSongStore.getState().isPlaying) {
      this.silence();
    }
  }

  public getAudioTrackEngine(): AudioTrackEngine {
    return this.audioTrackEngine;
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

  public registerCustomDrumSample(sampleUrl: string, audioBuffer: AudioBuffer) {
    return this.drumManager.registerCustomSampleBuffer(sampleUrl, audioBuffer);
  }

  public removeCachedDrumSample(sampleUrl: string) {
    this.drumManager.removeCachedSample(sampleUrl);
  }

  public preloadDrumSample(sampleUrl: string) {
    return this.drumManager.preloadSample(sampleUrl);
  }

  public playDrumPreview(channelId: string, customVelocity?: number) {
    this.unlockIfSuspended();
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
    const state = useSongStore.getState();
    const bpm = state.bpm || 120;
    this.cachedBpm = bpm;

    this.transportManager.setBpm(bpm);
    this.instrumentManager.setBpm(bpm);
    try { Tone.Transport.bpm.value = bpm; } catch (_) {}

    const scheduled = scheduleStoreTimeline(state);
    this.cachedMaxBeat = scheduled.totalBeats;

    this.lookaheadScheduler.setEvents(scheduled, bpm, state.isLooping, state.tempoMarkers);
    this.mixerGraph.syncAudioTracks(state.audioTracks || []);

    this.transportManager.setLoop(state.isLooping, 0, Math.max(0.1, scheduled.totalDurationSeconds - 2.0));
  }

  private updateSustain(sustain: boolean) {
    this.instrumentManager.updateSustain(sustain);
  }

  public exportToWav(
    realtime: boolean | undefined,
    onProgress: (elapsed: number, total: number) => void,
    onComplete: (wavBlob: Blob) => void,
    onError: (err: Error) => void
  ): () => void {
    const state = useSongStore.getState();
    state.setIsExporting(true);
    state.setExportProgress(0);
    state.setExportPhase('RENDERIZANDO AUDIO...');

    let cancelled = false;

    (async () => {
      try {
        const session = serializeSession(state);
        const drumBuffers = this.drumManager.getLoadedBuffers();
        const wavBlob = await renderSessionToWav(session, state.customPatterns || [], {
          realtime,
          drumBuffers,
          normalize: true,
          targetPeakDb: -0.3,
          onPhase: (phase) => {
            if (!cancelled) useSongStore.getState().setExportPhase(phase);
          },
          onProgress: (elapsed, total) => {
            if (cancelled) return;
            const progress = total > 0 ? Math.min(1, elapsed / total) : 1;
            onProgress(elapsed, total);
            useSongStore.getState().setExportProgress(progress);
          }
        });

        if (cancelled) return;
        useSongStore.getState().setExportPhase('FINALIZANDO...');
        useSongStore.getState().setIsExporting(false);
        useSongStore.getState().setExportProgress(1);
        useSongStore.getState().setExportPhase('');
        onComplete(wavBlob);
      } catch (err) {
        if (cancelled) return;
        useSongStore.getState().setIsExporting(false);
        useSongStore.getState().setExportProgress(0);
        useSongStore.getState().setExportPhase('');
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      useSongStore.getState().setIsExporting(false);
      useSongStore.getState().setExportProgress(0);
      useSongStore.getState().setExportPhase('');
    };
  }

  public exportToCompressed(
    format: 'mp3' | 'm4a',
    realtime: boolean | undefined,
    onProgress: (elapsed: number, total: number) => void,
    onComplete: (result: { blob: Blob; extension: string; mimeType: string }) => void,
    onError: (err: Error) => void
  ): () => void {
    const state = useSongStore.getState();
    state.setIsExporting(true);
    state.setExportProgress(0);
    state.setExportPhase('RENDERIZANDO AUDIO...');

    let cancelled = false;

    (async () => {
      try {
        const session = serializeSession(state);
        const drumBuffers = this.drumManager.getLoadedBuffers();
        const compressedResult = await renderSessionToCompressed(session, state.customPatterns || [], {
          format,
          realtime,
          drumBuffers,
          normalize: true,
          targetPeakDb: -0.3,
          onPhase: (phase) => {
            if (!cancelled) useSongStore.getState().setExportPhase(phase);
          },
          onProgress: (elapsed, total) => {
            if (cancelled) return;
            const progress = total > 0 ? Math.min(1, elapsed / total) : 1;
            onProgress(elapsed, total);
            useSongStore.getState().setExportProgress(progress);
          }
        });

        if (cancelled) return;
        useSongStore.getState().setExportPhase('FINALIZANDO...');
        useSongStore.getState().setIsExporting(false);
        useSongStore.getState().setExportProgress(1);
        useSongStore.getState().setExportPhase('');
        onComplete(compressedResult);
      } catch (err) {
        if (cancelled) return;
        useSongStore.getState().setIsExporting(false);
        useSongStore.getState().setExportProgress(0);
        useSongStore.getState().setExportPhase('');
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      useSongStore.getState().setIsExporting(false);
      useSongStore.getState().setExportProgress(0);
      useSongStore.getState().setExportPhase('');
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
if (typeof window !== 'undefined') {
  (window as any).__toneEngine = toneEngine;
  (window as any).Tone = Tone;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    toneEngine.dispose();
  });
  import.meta.hot.accept(() => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  });
}
