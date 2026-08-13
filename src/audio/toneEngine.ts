import * as Tone from 'tone';
import { Piano } from '@tonejs/piano';
import { useSongStore } from '../store/songStore';
import {
  getChordNotes,
  NOTE_CLASSES,
  SCALE_INTERVALS,
  shiftOctave,
  getBlockNotes,
  resolvePatternNoteToChord
} from '../core/music';
import type { PatternDef } from '../patterns/patternTypes';
import { flattenPatternChain } from '../utils/typeDefinitions';
import { renderSessionToWav } from '../core/audio';
import { serializeSession } from '../core/session';

const shiftNoteOctave = shiftOctave;

// Helper debounce simple para evitar llamadas excesivas a syncTimeline
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, delay);
  }) as T;
}

// --- MONKEYPATCH ToneAudioBuffer.load to resolve [mp3|ogg] wildcards for Tone.js v15 ---
if (Tone.ToneAudioBuffer && typeof Tone.ToneAudioBuffer.load === 'function') {
  const originalLoad = Tone.ToneAudioBuffer.load;
  Tone.ToneAudioBuffer.load = function (url: string) {
    const matches = url.match(/\[(.+?)\]/);
    if (matches) {
      const extensions = matches[1].split("|");
      const extension = extensions.find(ext => {
        if (typeof document !== 'undefined') {
          const response = document.createElement("audio").canPlayType("audio/" + ext);
          return response !== "";
        }
        return ext === 'mp3';
      }) || extensions[0];
      url = url.replace(matches[0], extension);
    }
    return originalLoad.call(this, url);
  };
}

// Mapeos para entrada de teclado (melodía)
const DIATONIC_KEY_MAP: Record<string, number> = {
  'z': 0, 'x': 1, 'c': 2, 'v': 3, 'b': 4, 'n': 5, 'm': 6,
  'a': 7, 's': 8, 'd': 9, 'f': 10, 'g': 11, 'h': 12, 'j': 13, 'k': 14, 'l': 15, ';': 16, 'ñ': 16, '´': 17
};

const CHROMATIC_KEY_MAP: Record<string, number> = {
  'a': 0,  // C4
  's': 2,  // D4
  'd': 4,  // E4
  'f': 5,  // F4
  'g': 7,  // G4
  'h': 9,  // A4
  'j': 11, // B4
  'k': 12, // C5
  'l': 14, // D5
  ';': 16, // E5
  'ñ': 16, // E5
  'w': 1,  // C#4
  'e': 3,  // D#4
  't': 6,  // F#4
  'y': 8,  // G#4
  'u': 10, // A#4
  'o': 13, // C#5
  'p': 15  // D#5
};

class ToneEngine {
  private chordSynth: Tone.PolySynth;
  private melodySynth: Tone.PolySynth;
  private metroSynth: Tone.Synth; // Synth dedicado para el metrónomo
  private chordsPiano: Piano | null = null;
  private melodyPiano: Piano | null = null;
  private synthFilter: Tone.Filter;
  private isInitialized = false;

  private drumSynths = new Map<string, Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth>();
  private drumPlayers = new Map<string, { player: Tone.Player, sampleUrl: string }>();
  private drumChannelNodes = new Map<string, { volumeNode: Tone.Volume; pannerNode: Tone.Panner }>();

  private channelNodes = new Map<string, { volumeNode: Tone.Volume; pannerNode: Tone.Panner }>();
  private cachedChannels: Record<string, any> | null = null;
  private scheduledEvents: number[] = [];
  private metroEventId: number | null = null;
  private activePreviewChord: string | null = null;
  private activePreviewNotes: string[] = [];
  private previewTimer: any = null;
  // Estado del secuenciador de previsualización — persiste entre cambios de acorde para legato
  private previewStep = 0;
  private previewNotes: string[] = [];
  private lastTriggeredBeat = -1;
  private lastTriggeredChordId = '';
  private lastTriggeredChordName = '';
  private lastTriggeredVoicing = '';
  private lastTriggeredInversion = 0;
  // Seguimiento en tiempo real de notas activas para el visualizador
  private activeNotesSet = new Set<string>();
  private noteActiveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Seguimiento separado para notas de melodía (color de énfasis distinto)
  private activeMelodyNotesSet = new Set<string>();
  private melodyNoteActiveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private activePressedNotes = new Set<string>();
  private activePressedNotesList: string[] = [];

  // --- Caché de estado del store para el hot path de audio (evita getState() en keyDown/keyUp) ---
  private cachedIsKeyboardMelodyEnabled = true;
  private cachedIsKeyboardChromatic = false;
  private cachedKeyboardCenterNote = 'C4';
  private cachedKey = 'C';
  private cachedScale = 'major';
  private cachedBpm = 120;
  // P2: maxBeat cacheado — se actualiza solo cuando cambian los bloques, no en cada tick
  private cachedMaxBeat = 4;
  private cachedChordsMaxBeat = 4;
  private cachedMelodyMaxBeat = 4;
  // rAF handle para el update de UI del playhead
  private playheadRafId: number | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private initPromise: Promise<void> | null = null;

  // Versión incremental para detectar cambios en synthSettings sin JSON.stringify
  private synthSettingsVersion = 0;

  public _getInternalDebugState() {
    return [this.playheadRafId];
  }

  private updateCachedMaxBeat(state?: any) {
    const s = state || useSongStore.getState();
    let chordsMax = 4;
    (s.chordBlocks || []).forEach((b: any) => { chordsMax = Math.max(chordsMax, b.startBeat + b.durationBeats); });
    let melodyMax = 4;
    const allTracks = (s.tracks && s.tracks.length > 0) ? s.tracks : [{ notes: s.melodyNotes || [] }];
    allTracks.forEach((t: any) => {
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

  // syncTimeline con debounce para evitar reconstrucciones excesivas durante edición
  private syncTimelineDebounced: () => void;

  private channelMeters = new Map<string, Tone.Meter>();
  private analyserNode: Tone.Analyser = new Tone.Analyser('waveform', 512);
  private trackSynths = new Map<string, Tone.PolySynth>();
  private trackFilters = new Map<string, Tone.Filter>();

  private getChannelNode(id: string) {
    let node = this.channelNodes.get(id);
    if (!node) {
      const volumeNode = new Tone.Volume(0);
      const pannerNode = new Tone.Panner({ pan: 0 });
      const meterNode = new Tone.Meter({ smoothing: 0.8 });

      volumeNode.connect(pannerNode);

      if (id === 'master') {
        pannerNode.toDestination();
        pannerNode.connect(meterNode);
        pannerNode.connect(this.analyserNode);
      } else {
        const masterNode = this.getChannelNode('master');
        pannerNode.connect(masterNode.volumeNode);
        pannerNode.connect(meterNode);
      }

      // Enforce explicit 2-channel stereo on Web Audio nodes to prevent mono downmixing
      try {
        const rawVol = (volumeNode as any).input || (volumeNode as any)._gainNode || volumeNode;
        if (rawVol) {
          rawVol.channelCount = 2;
          rawVol.channelCountMode = 'explicit';
          rawVol.channelInterpretation = 'speakers';
        }
        const rawPan = (pannerNode as any).output || (pannerNode as any)._panner || pannerNode;
        if (rawPan) {
          rawPan.channelCount = 2;
          rawPan.channelCountMode = 'explicit';
          rawPan.channelInterpretation = 'speakers';
        }
      } catch (_) {}

      node = { volumeNode, pannerNode };
      this.channelNodes.set(id, node);
      this.channelMeters.set(id, meterNode);
    }
    return node;
  }

  public getChannelMeterLevel(id: string): number {
    const meter = this.channelMeters.get(id);
    if (!meter) return -Infinity;
    try {
      const val = meter.getValue();
      return typeof val === 'number' ? val : Array.isArray(val) ? (val as number[])[0] : -Infinity;
    } catch (_) {
      return -Infinity;
    }
  }

  public getWaveformData(): Float32Array {
    try {
      return this.analyserNode.getValue() as Float32Array;
    } catch (_) {
      return new Float32Array(512);
    }
  }

  constructor() {
    // Inicializar syncTimelineDebounced antes de cualquier uso
    this.syncTimelineDebounced = debounce(() => this.syncTimeline(), 50);

    const chordsChannelNode = this.getChannelNode('chords');
    const melodyChannelNode = this.getChannelNode('melody');
    const drumsChannelNode = this.getChannelNode('drums');

    this.synthFilter = new Tone.Filter({
      frequency: 20000,
      type: 'lowpass',
      Q: 1
    }).connect(chordsChannelNode.volumeNode);

    // Sintetizadores originales por defecto para evitar descargas pesadas
    this.chordSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.1,
        decay: 0.3,
        sustain: 0.4,
        release: 0.8
      }
    });
    this.chordSynth.connect(this.synthFilter);
    this.chordSynth.volume.value = -12;

    this.melodySynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.05,
        decay: 0.2,
        sustain: 0.6,
        release: 0.4
      }
    });
    this.melodySynth.connect(melodyChannelNode.volumeNode);
    this.melodySynth.volume.value = -6;


    // Metrónomo click con envolvente muy corta percusiva (tipo woodblock)
    this.metroSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.04,
        sustain: 0,
        release: 0.04
      }
    }).toDestination();
    
    // Volumen inicial (50%)
    this.metroSynth.volume.value = Tone.gainToDb(0.5);

    // Sintetizadores de batería
    this.drumSynths.set('kick1.mp3', new Tone.MembraneSynth().connect(drumsChannelNode.volumeNode));
    this.drumSynths.set('snare1.mp3', new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.2 }
    }).connect(drumsChannelNode.volumeNode));
    this.drumSynths.set('hihat_closed1.mp3', new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.1, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5
    }).connect(drumsChannelNode.volumeNode));
    this.drumSynths.set('hihat_open1.mp3', new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.5, release: 0.1 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5
    }).connect(drumsChannelNode.volumeNode));
  }

  public async init() {
    if (this.isInitialized) return;
    // Evitar inicializaciones concurrentes (P1: garantía de single-init)
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

    // P1: Limpiar cualquier evento residual en el Transport debido a HMR (Hot Module Replacement)
    Tone.Transport.cancel(0);

    Tone.Transport.scheduleRepeat(() => {
      const maxBeat = this.cachedMaxBeat;
      const currentBeat = Tone.Transport.seconds * this.cachedBpm / 60;
      if (currentBeat >= maxBeat) {
        const state = useSongStore.getState();
        if (!state.isLooping) {
          this.stop();
        }
      }
    }, '8n');

    // P2: Update de UI del playhead vía requestAnimationFrame — fuera del audio thread
    const updatePlayheadUI = () => {
      if (useSongStore.getState().isPlaying) {
        const beat = Tone.Transport.seconds * this.cachedBpm / 60;
        useSongStore.getState().setCurrentBeat(beat);
      }
      this.playheadRafId = requestAnimationFrame(updatePlayheadUI);
    };
    this.playheadRafId = requestAnimationFrame(updatePlayheadUI);

    // Bucle dinámico para disparo de acordes en tiempo real (legato y al vuelo)
    Tone.Transport.scheduleRepeat((time) => {
      this.triggerChordTick(time);
      this.triggerDrumTick(time);
    }, '16n');

    // Inicializar caché con el estado actual
    const initialState = useSongStore.getState();
    this.cachedIsKeyboardMelodyEnabled = initialState.isKeyboardMelodyEnabled;
    this.cachedIsKeyboardChromatic = initialState.isKeyboardChromatic;
    this.cachedKeyboardCenterNote = initialState.keyboardCenterNote || 'C4';
    this.cachedKey = initialState.key;
    this.cachedScale = initialState.scale;
    this.cachedBpm = initialState.bpm;
    this.updateCachedMaxBeat(initialState);

    // Suscripción manual a los cambios del store
    let prevBpm = initialState.bpm;
    let prevIsPlaying = initialState.isPlaying;
    let prevChordBlocks = initialState.chordBlocks;
    let prevMelodyNotes = initialState.melodyNotes;
    let prevIsLooping = initialState.isLooping;
    let prevIsMetronomeActive = initialState.isMetronomeActive;
    let prevMetroSubdivision = initialState.metroSubdivision;
    let prevMetroVolume = initialState.metroVolume;
    let prevTimeSignature = initialState.timeSignature;
    let prevPattern = initialState.pattern;
    let prevSwing = initialState.swing;
    let prevSustain = initialState.sustain;
    // Usamos versión incremental en lugar de JSON.stringify para detectar cambios en synthSettings
    // (synthSettingsVersion se incrementa desde setSynthSettings en el store)
    let prevSynthSettingsVersion = this.synthSettingsVersion;

    this.unsubscribeStore = useSongStore.subscribe((state) => {
      // --- Actualizar caché de hot path ---
      this.cachedIsKeyboardMelodyEnabled = state.isKeyboardMelodyEnabled;
      this.cachedIsKeyboardChromatic = state.isKeyboardChromatic;
      this.cachedKey = state.key;
      this.cachedScale = state.scale;
      this.cachedBpm = state.bpm;

      if (state.bpm !== prevBpm) {
        prevBpm = state.bpm;
        Tone.Transport.bpm.value = state.bpm;
        this.syncTimelineDebounced();
      }
      if (state.isLooping !== prevIsLooping) {
        prevIsLooping = state.isLooping;
        Tone.Transport.loop = state.isLooping;
        this.syncTimelineDebounced();
      }
      if (state.isMetronomeActive !== prevIsMetronomeActive || state.metroSubdivision !== prevMetroSubdivision) {
        prevIsMetronomeActive = state.isMetronomeActive;
        prevMetroSubdivision = state.metroSubdivision;
        this.syncTimelineDebounced();
      }
      if (state.metroVolume !== prevMetroVolume) {
        prevMetroVolume = state.metroVolume;
        const gain = state.metroVolume / 100;
        this.metroSynth.volume.value = gain === 0 ? -Infinity : Tone.gainToDb(gain);
      }
      if (state.isPlaying !== prevIsPlaying) {
        prevIsPlaying = state.isPlaying;
        if (state.isPlaying) {
          // Sincronizar el transporte con el beat actual antes de iniciar
          const currentBeat = state.currentBeat;
          const bpm = state.bpm;
          Tone.Transport.seconds = currentBeat * (60 / bpm);
          // S2: Forzar BPM siempre antes de arrancar — corrige bug de sincronización al iniciar
          Tone.Transport.bpm.value = bpm;
          this.syncTimeline(); // Llamada directa (no debounced) al arrancar
          Tone.Transport.start();
        } else {
          Tone.Transport.pause();
          this.silence();
        }
      }
      if (state.timeSignature !== prevTimeSignature) {
        prevTimeSignature = state.timeSignature;
        this.syncTimelineDebounced();
      }
      if (state.pattern !== prevPattern) {
        prevPattern = state.pattern;
        this.syncTimelineDebounced();
      }
      if (state.swing !== prevSwing) {
        prevSwing = state.swing;
        Tone.Transport.swing = state.swing / 100;
        Tone.Transport.swingSubdivision = '16n';
      }
      if (state.sustain !== prevSustain) {
        prevSustain = state.sustain;
        this.updateSustain(state.sustain);
      }
      if (state.chordBlocks !== prevChordBlocks || state.melodyNotes !== prevMelodyNotes) {
        prevChordBlocks = state.chordBlocks;
        prevMelodyNotes = state.melodyNotes;
        this.updateCachedMaxBeat(state);
        this.syncTimelineDebounced();
      }
      // S7: Comparar versión incremental en lugar de JSON.stringify
      if (this.synthSettingsVersion !== prevSynthSettingsVersion) {
        prevSynthSettingsVersion = this.synthSettingsVersion;
        this.updateSynthSettings(state.synthSettings);
      }
    });

    // Cargar configuraciones iniciales del sintetizador y canales
    this.updateSynthSettings(useSongStore.getState().synthSettings);
    this.syncChannels(useSongStore.getState().channels);
    const defaultInstrument = useSongStore.getState().instrumentType;
    if (defaultInstrument === 'piano') {
      this.setInstrument('piano');
    }
  }

  public syncChannels(channels: Record<string, any>) {
    if (!channels) return;
    this.cachedChannels = channels;
    const channelList = Object.values(channels);
    const anySolo = channelList.some((ch: any) => ch.solo);

    for (const ch of channelList as any[]) {
      const node = this.getChannelNode(ch.id);
      const isSilenced = ch.muted || (anySolo && !ch.solo);
      node.volumeNode.mute = isSilenced;

      if (!isSilenced) {
        if (ch.volume <= 0) {
          node.volumeNode.volume.value = -Infinity;
        } else {
          const db = ((ch.volume - 80) / 80) * 30;
          node.volumeNode.volume.value = Math.max(-60, Math.min(6, db));
        }
      }
      const clampedPan = Math.max(-1, Math.min(1, ch.pan));
      node.pannerNode.pan.value = clampedPan;
      const nativePanner = (node.pannerNode as any).output || (node.pannerNode as any)._panner;
      if (nativePanner && nativePanner.pan) {
        try { nativePanner.pan.cancelScheduledValues(0); } catch (_) {}
        nativePanner.pan.value = clampedPan;
      }

      if (ch.instrument === 'piano' && (!this.chordsPiano || !this.melodyPiano)) {
        this.setInstrument('piano');
      }
    }
  }

  private isChordPianoActive(): boolean {
    const chordsInst = this.cachedChannels?.chords?.instrument || 'piano';
    return chordsInst === 'piano' && !!this.chordsPiano && this.chordsPiano.loaded;
  }

  private isMelodyPianoActive(): boolean {
    const melodyInst = this.cachedChannels?.melody?.instrument || 'synth';
    return melodyInst === 'piano' && !!this.melodyPiano && this.melodyPiano.loaded;
  }

  /**
   * Incrementa el contador de versión de synthSettings para que la suscripción del store
   * detecte el cambio sin usar JSON.stringify en cada tick (S7).
   */
  public bumpSynthSettingsVersion() {
    this.synthSettingsVersion++;
  }

  /**
   * Actualiza los parámetros de sonido del Sintetizador Virtual de forma reactiva.
   */
  public updateSynthSettings(settings: any, channelId?: string) {
    if (!this.isInitialized) return;
    
    try {
      const applyToSynthAndFilter = (synth: Tone.PolySynth, filter?: Tone.Filter) => {
        synth.set({
          oscillator: { type: settings.waveType },
          envelope: {
            attack: settings.envelope.attack,
            decay: settings.envelope.decay,
            sustain: settings.envelope.sustain,
            release: settings.envelope.release
          },
          detune: settings.detune
        });
        if (filter) {
          if (settings.filter && settings.filter.enabled) {
            filter.type = settings.filter.type;
            filter.frequency.value = settings.filter.frequency;
            filter.Q.value = settings.filter.Q;
          } else {
            filter.type = 'lowpass';
            filter.frequency.value = 20000;
            filter.Q.value = 1;
          }
        }
      };

      if (channelId) {
        const synth = this.getChannelSynth(channelId);
        const filter = this.trackFilters.get(channelId);
        applyToSynthAndFilter(synth, filter);
      } else {
        applyToSynthAndFilter(this.chordSynth, this.synthFilter);
        applyToSynthAndFilter(this.melodySynth, this.synthFilter);
        this.trackSynths.forEach((synth, chId) => {
          const filter = this.trackFilters.get(chId);
          applyToSynthAndFilter(synth, filter);
        });
      }
    } catch (e) {
      console.error('Error actualizando ajustes del sintetizador:', e);
    }
  }

  /**
   * Configura o carga el instrumento correspondiente de forma asíncrona
   */
  public async setInstrument(type: 'synth' | 'piano') {
    if (!this.isInitialized) await this.init();

    if (type === 'piano' && (!this.chordsPiano || !this.melodyPiano)) {
      useSongStore.getState().setIsAudioLoading(true);
      
      try {
        const chordsNode = this.getChannelNode('chords');
        const melodyNode = this.getChannelNode('melody');

        if (!this.chordsPiano) {
          this.chordsPiano = new Piano({ velocities: 5, url: '/piano/' }).connect(chordsNode.volumeNode);
          if ((this.chordsPiano as any)._keybed) (this.chordsPiano as any)._keybed._internalLoad = () => Promise.resolve();
          if ((this.chordsPiano as any)._harmonics) (this.chordsPiano as any)._harmonics._internalLoad = () => Promise.resolve();
        }

        if (!this.melodyPiano) {
          this.melodyPiano = new Piano({ velocities: 5, url: '/piano/' }).connect(melodyNode.volumeNode);
          if ((this.melodyPiano as any)._keybed) (this.melodyPiano as any)._keybed._internalLoad = () => Promise.resolve();
          if ((this.melodyPiano as any)._harmonics) (this.melodyPiano as any)._harmonics._internalLoad = () => Promise.resolve();
        }

        const timeoutPromise = new Promise((resolve) => {
          setTimeout(() => {
            console.warn('Timeout de carga de piano superado, forzando inicio...');
            resolve(true);
          }, 12000);
        });

        await Promise.race([
          Promise.all([this.chordsPiano.load(), this.melodyPiano.load()]),
          timeoutPromise
        ]);
      } catch (e) {
        console.error('Error inicializando el piano:', e);
      } finally {
        useSongStore.getState().setIsAudioLoading(false);
      }
    }

    this.syncTimeline();
  }


  /**
   * Silencia de forma limpia todas las voces activas
   */
  public silence() {
    try {
      this.chordSynth.releaseAll();
    } catch (_) {}
    try {
      this.melodySynth.releaseAll();
    } catch (_) {}
    if (this.chordsPiano) {
      try {
        this.chordsPiano.stopAll();
      } catch (_) {}
    }
    if (this.melodyPiano) {
      try {
        this.melodyPiano.stopAll();
      } catch (_) {}
    }
    try {
      this.metroSynth.triggerRelease();
    } catch (_) {}
  }


  public playChordPreview(chordName: string) {
    if (!this.isInitialized) this.init();
    const state = useSongStore.getState();
    const chordOctaveShift = state.chordOctaveShift || 0;
    const usePiano = this.isChordPianoActive();
    
    try {
      let notes = getChordNotes(chordName, 4);
      if (chordOctaveShift !== 0) {
        notes = notes.map(note => shiftNoteOctave(note, chordOctaveShift));
      }
      if (notes.length > 0) {
        if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
          const now = Tone.now();
          notes.forEach(note => {
            this.chordsPiano!.keyDown({ note, time: now, velocity: 0.7 });
            this.chordsPiano!.keyUp({ note, time: now + 1.0 });
          });
        } else {
          this.chordSynth.triggerAttackRelease(notes, '2n');
        }
      }
    } catch (e) {
      console.warn('Error tocando acorde preview:', e);
    }
  }

  public playChordPreviewStart(chordName: string) {
    if (!this.isInitialized) this.init();
    const state = useSongStore.getState();
    const pattern = state.pattern || 'hold';
    const chordOctaveShift = state.chordOctaveShift || 0;

    let baseNotes = getChordNotes(chordName, 4);
    if (baseNotes.length === 0) return;

    if (chordOctaveShift !== 0) {
      baseNotes = baseNotes.map(n => shiftNoteOctave(n, chordOctaveShift));
    }

    // Tónica del acorde como bajo por defecto
    const rootNoteMatch = chordName.split('/')[0].match(/^([A-G]#?)/);
    const defaultBass = rootNoteMatch ? `${rootNoteMatch[1]}2` : baseNotes[0].replace(/[0-9]/g, '2');
    const bassNote = chordName.includes('/') ? `${chordName.split('/')[1]}2` : defaultBass;
    const notes = [bassNote, ...baseNotes];

    // -- LEGATO: si ya hay un patrón corriendo, solo cambia las notas sin reiniciar el step
    const isPatternRunning = this.activePreviewChord !== null && this.previewTimer !== null;
    
    this.activePreviewChord = chordName;
    this.previewNotes = notes; // Las funciones del loop leen estas notas en cada tick

    // Si el patrón ya corría, no hay nada más que hacer: el loop activo leerá previewNotes actualizado
    if (isPatternRunning) {
      return;
    }

    // Primera vez: inicializar el secuenciador desde cero
    this.previewStep = 0;
    const bpm = state.bpm;
    const beatDurationMs = (60 / bpm) * 1000;
    const usePiano = this.isChordPianoActive();

    const playNoteImmediate = (note: string, durationMs: number, velocity = 0.6) => {
      const now = Tone.now();
      const durSec = durationMs / 1000;
      if (!this.activePreviewNotes.includes(note)) {
        this.activePreviewNotes.push(note);
      }
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        try {
          this.chordsPiano.keyDown({ note, time: now, velocity });
          this.chordsPiano.keyUp({ note, time: now + durSec });
        } catch (e) { console.error(e); }
      } else {
        try {
          this.chordSynth.triggerAttackRelease(note, durSec, now, velocity);
        } catch (e) { console.error(e); }
      }
      this.trackNote(note, durSec, undefined, 'harmony');
    };


    const playChordImmediate = (durationMs: number, velocity = 0.6) => {
      const now = Tone.now();
      const durSec = durationMs / 1000;
      this.previewNotes.forEach(note => {
        if (!this.activePreviewNotes.includes(note)) {
          this.activePreviewNotes.push(note);
        }
      });
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        this.previewNotes.forEach(note => {
          try {
            this.chordsPiano!.keyDown({ note, time: now, velocity });
            this.chordsPiano!.keyUp({ note, time: now + durSec });
          } catch (e) { console.error(e); }
          this.trackNote(note, durSec, undefined, 'harmony');
        });
      } else {
        try {
          this.chordSynth.triggerAttackRelease(this.previewNotes, durSec, now, velocity);
        } catch (e) { console.error(e); }
        this.previewNotes.forEach(note => this.trackNote(note, durSec, undefined, 'harmony'));
      }
    };

    // Redefinir playNoteImmediate para que use this.previewNotes[0] como bajo
    const playBassImmediate = (durationMs: number, velocity = 0.7) => {
      if (this.previewNotes.length > 0) {
        playNoteImmediate(this.previewNotes[0], durationMs, velocity);
      }
    };

    if (pattern === 'hold') {
      playChordImmediate(1500, 0.65);
      return;
    }

    if (pattern === 'strum') {
      this.previewNotes.forEach((note, index) => {
        setTimeout(() => {
          if (this.activePreviewChord !== chordName) return;
          playNoteImmediate(note, 1500 - index * 25, 0.65 - index * 0.05);
        }, index * 25);
      });
      return;
    }

    // Comprobar si es un patrón custom (PatternDef desde MIDI)
    const customPattern = useSongStore.getState().customPatterns?.find(
      (p: { name: string }) => p.name === pattern
    );

    if (customPattern) {
      // Para patrones custom usamos un loop basado en el totalBeats del patrón.
      // Resolvemos las notas usando la misma lógica que resolvePatternNoteToChord.
      const cycleDurationMs = customPattern.totalBeats * beatDurationMs;

      const runCycle = () => {
        if (this.activePreviewChord === null) return;

        // Programar cada nota del patrón como un setTimeout relativo al inicio del ciclo
        for (const pn of customPattern.notes) {
          const delayMs = pn.beatOffset * beatDurationMs;
          const durMs = pn.durationBeats * beatDurationMs;

          setTimeout(() => {
            if (this.activePreviewChord === null) return;
            // Rederivamos el nombre de nota en el momento de ejecución para capturar cambios de acorde
            const currentChord = this.activePreviewChord || chordName;
            const refOctave = pn.voice === 'bass' ? 2 : 4;
            const resolvedNote = this.resolvePatternNoteToChord(pn, currentChord, refOctave);
            playNoteImmediate(resolvedNote, durMs, pn.velocity);
          }, delayMs);
        }

        // Repetir el ciclo cuando termine
        this.previewTimer = setTimeout(runCycle, cycleDurationMs);
      };

      runCycle();
      return;
    }

    // Loop continuo para quarters, eighths, pop, arpeggio
    const runStep = () => {
      if (this.activePreviewChord === null) return; // detenido

      const nextIntervalMs = this.triggerPreviewPatternStep(
        pattern,
        this.previewNotes,       // siempre lee el acorde más reciente
        this.previewStep,
        beatDurationMs,
        playNoteImmediate,
        playChordImmediate,
        playBassImmediate
      );

      this.previewStep++;
      this.previewTimer = setTimeout(runStep, nextIntervalMs);
    };

    runStep();
  }


  private triggerPreviewPatternStep(
    pattern: string,
    notes: string[],
    step: number,
    beatDurationMs: number,
    playNote: (note: string, durMs: number, vel?: number) => void,
    playChord: (durMs: number, vel?: number) => void,
    playBass: (durMs: number, vel?: number) => void
  ): number {
    if (pattern === 'quarters') {
      playChord(beatDurationMs * 0.8, 0.6);
      return beatDurationMs;
    } 

    if (pattern === 'eighths') {
      playChord(beatDurationMs * 0.4, 0.55);
      return beatDurationMs * 0.5;
    }

    if (pattern === 'pop') {
      const stepInPattern = step % 4;
      if (stepInPattern === 0) {
        playChord(beatDurationMs * 0.8, 0.6);
        return beatDurationMs * 1.5;
      } else if (stepInPattern === 1) {
        playChord(beatDurationMs * 0.4, 0.55);
        return beatDurationMs * 1.0;
      } else if (stepInPattern === 2) {
        playChord(beatDurationMs * 0.7, 0.6);
        return beatDurationMs * 1.0;
      } else {
        playChord(beatDurationMs * 0.4, 0.55);
        return beatDurationMs * 0.5;
      }
    }

    if (pattern === 'arpeggio') {
      // Disparar bajo cada 8 pasos (4 beats) para continuidad
      if (step % 8 === 0) {
        playBass(beatDurationMs * 4, 0.7);
      }

      const arpNotes = notes.length > 1 ? notes.slice(1) : notes;
      const period = (arpNotes.length - 1) * 2;
      let noteIndex = 0;

      if (period > 0) {
        const mod = step % period;
        noteIndex = mod < arpNotes.length ? mod : period - mod;
      }

      playNote(arpNotes[noteIndex], beatDurationMs * 0.4, 0.55);
      return beatDurationMs * 0.5;
    }

    return beatDurationMs;
  }

  public playChordPreviewStop(_chordName?: string) {
    this.activePreviewChord = null;
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    
    // Apagar selectivamente únicamente las notas de preescucha
    const now = Tone.now();
    const usePiano = this.isChordPianoActive();
    this.activePreviewNotes.forEach(note => {
      try {
        if (usePiano) {
          this.chordsPiano!.keyUp({ note, time: now });
        } else {
          this.chordSynth.triggerRelease(note, now);
        }
      } catch (_) {}
      
      // Quitar del visualizador de piano
      this.activeNotesSet.delete(note);
      const timer = this.noteActiveTimers.get(note);
      if (timer) {
        clearTimeout(timer);
        this.noteActiveTimers.delete(note);
      }
    });
    this.activePreviewNotes = [];
    useSongStore.getState().setActiveNotes(Array.from(this.activeNotesSet));
  }

  public getChannelSynth(channelId: string): Tone.PolySynth {
    if (channelId === 'melody') return this.melodySynth;
    let synth = this.trackSynths.get(channelId);
    if (!synth) {
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4 }
      });
      const filter = new Tone.Filter({
        type: 'lowpass',
        frequency: 5000,
        Q: 1
      });
      const channelNode = this.getChannelNode(channelId);
      synth.connect(filter);
      filter.connect(channelNode.volumeNode);
      this.trackSynths.set(channelId, synth);
      this.trackFilters.set(channelId, filter);
    }
    return synth;
  }

  public playNotePreview(noteName: string, channelId?: string) {
    if (!this.isInitialized) this.init();
    const state = useSongStore.getState();
    const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
    const targetChannelId = channelId || (activeTrack ? activeTrack.channelId : 'melody');
    const channelConfig = state.channels[targetChannelId];
    const usePiano = channelConfig ? channelConfig.instrument === 'piano' : this.isMelodyPianoActive();

    try {
      if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
        const now = Tone.now();
        this.melodyPiano.keyDown({ note: noteName, time: now, velocity: 0.8 });
        this.melodyPiano.keyUp({ note: noteName, time: now + 0.3 });
      } else {
        const synth = this.getChannelSynth(targetChannelId);
        synth.triggerAttackRelease(noteName, '8n');
      }
      this.trackNote(noteName, 0.3, undefined, targetChannelId);
    } catch (e) {
      console.warn('Error tocando nota preview:', e);
    }
  }

  public stop() {
    Tone.Transport.stop();
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
    // Limpiar visualizador de armonía
    this.activeNotesSet.clear();
    this.noteActiveTimers.forEach(t => clearTimeout(t));
    this.noteActiveTimers.clear();
    useSongStore.getState().setActiveNotes([]);
    // Limpiar visualizador de melodía
    this.activeMelodyNotesSet.clear();
    this.melodyNoteActiveTimers.forEach(t => clearTimeout(t));
    this.melodyNoteActiveTimers.clear();
    useSongStore.getState().setActiveMelodyNotes([]);
  }

  public setSeconds(seconds: number) {
    Tone.Transport.seconds = seconds;
    const currentBeat = seconds * (useSongStore.getState().bpm / 60);
    useSongStore.getState().setCurrentBeat(currentBeat);
  }

  public seekToBeat(beat: number) {
    if (!this.isInitialized) this.init();
    const bpm = useSongStore.getState().bpm;
    const seconds = beat * (60 / bpm);
    
    this.lastTriggeredBeat = -1;
    this.lastTriggeredChordId = '';
    this.lastTriggeredChordName = '';
    
    Tone.Transport.seconds = seconds;
    useSongStore.getState().setCurrentBeat(beat);

    if (!useSongStore.getState().isPlaying) {
      this.silence();
    }
  }

  public startNote(noteName: string) {
    if (!this.isInitialized) {
      this.init().then(() => {
        this.startNote(noteName);
      });
      return;
    }

    try {
      this.activePressedNotes.add(noteName);
      this.activePressedNotesList = this.activePressedNotesList.filter(n => n !== noteName);
      this.activePressedNotesList.push(noteName);

      const state = useSongStore.getState();
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const targetChannelId = activeTrack ? activeTrack.channelId : 'melody';
      const channelConfig = state.channels[targetChannelId];
      const usePiano = channelConfig ? channelConfig.instrument === 'piano' : this.isMelodyPianoActive();

      if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
        this.melodyPiano.keyDown({ note: noteName, time: Tone.now(), velocity: 0.8 });
      } else {
        const synth = this.getChannelSynth(targetChannelId);
        synth.triggerAttack(noteName, Tone.now());
      }
      this.trackNoteStart(noteName);
    } catch (e) {
      console.warn('Error starting note:', e);
    }
  }

  public stopNote(noteName: string) {
    if (!this.isInitialized) return;
    
    try {
      this.activePressedNotes.delete(noteName);
      this.activePressedNotesList = this.activePressedNotesList.filter(n => n !== noteName);

      const state = useSongStore.getState();
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const targetChannelId = activeTrack ? activeTrack.channelId : 'melody';
      const channelConfig = state.channels[targetChannelId];
      const usePiano = channelConfig ? channelConfig.instrument === 'piano' : this.isMelodyPianoActive();

      if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
        this.melodyPiano.keyUp({ note: noteName, time: Tone.now() });
      } else {
        const synth = this.getChannelSynth(targetChannelId);
        if (this.activePressedNotes.size === 0) {
          synth.releaseAll();
        } else {
          synth.triggerRelease(noteName, Tone.now());
          const nextNote = this.activePressedNotesList[this.activePressedNotesList.length - 1];
          synth.triggerAttack(nextNote, Tone.now());
        }
      }
      this.trackNoteStop(noteName);
    } catch (e) {
      console.warn('Error stopping note:', e);
    }
  }


  private trackNoteStart(note: string) {
    const state = useSongStore.getState();
    const existingTimer = this.melodyNoteActiveTimers.get(note);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.melodyNoteActiveTimers.delete(note);
    }
    this.activeMelodyNotesSet.add(note);
    state.setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));
  }

  private trackNoteStop(note: string) {
    const state = useSongStore.getState();
    const offTimer = setTimeout(() => {
      this.activeMelodyNotesSet.delete(note);
      state.setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));
      this.melodyNoteActiveTimers.delete(note);
    }, 150);
    this.melodyNoteActiveTimers.set(note, offTimer);
  }

  public handleKeyDown(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    // S4: Leer de caché en lugar de getState() — elimina overhead en el hot path de teclado
    if (!this.cachedIsKeyboardMelodyEnabled) return;
    if (e.repeat) return;

    const key = e.key.toLowerCase();
    const state = useSongStore.getState();
    if (state.isKeyboardMelodyEnabled !== this.cachedIsKeyboardMelodyEnabled ||
          state.isKeyboardChromatic !== this.cachedIsKeyboardChromatic ||
          state.keyboardCenterNote !== this.cachedKeyboardCenterNote) {
        this.cachedIsKeyboardMelodyEnabled = state.isKeyboardMelodyEnabled;
        this.cachedIsKeyboardChromatic = state.isKeyboardChromatic;
        this.cachedKeyboardCenterNote = state.keyboardCenterNote || 'C4';
      }
    const centerMidi = Tone.Frequency(this.cachedKeyboardCenterNote || 'C4').toMidi();
    const offsetSemitones = centerMidi - 60; // Offset relativo a C4

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

  private lastTriggeredDrumStep = -1;
  private lastTriggeredDrumBeat = -1;

  private getChannelAudioNode(channelId: string, pan: number) {
    const clampedPan = Math.max(-1, Math.min(1, typeof pan === 'number' ? pan : 0));
    let node = this.drumChannelNodes.get(channelId);
    if (!node) {
      const drumsMaster = this.getChannelNode('drums');
      const pannerNode = new Tone.Panner({ pan: clampedPan }).connect(drumsMaster.volumeNode);
      const volumeNode = new Tone.Volume(0).connect(pannerNode);

      try {
        const rawVol = (volumeNode as any).input || (volumeNode as any)._gainNode || volumeNode;
        if (rawVol) {
          rawVol.channelCount = 2;
          rawVol.channelCountMode = 'explicit';
          rawVol.channelInterpretation = 'speakers';
        }
        const rawPan = (pannerNode as any).output || (pannerNode as any)._panner || pannerNode;
        if (rawPan) {
          rawPan.channelCount = 2;
          rawPan.channelCountMode = 'explicit';
          rawPan.channelInterpretation = 'speakers';
        }
      } catch (_) {}

      const nativePanner = (pannerNode as any).output || (pannerNode as any)._panner;
      if (nativePanner && nativePanner.pan) {
        try { nativePanner.pan.cancelScheduledValues(0); } catch (_) {}
        nativePanner.pan.value = clampedPan;
      }

      node = { volumeNode, pannerNode };
      this.drumChannelNodes.set(channelId, node);
    } else {
      try { node.pannerNode.pan.cancelScheduledValues(0); } catch (_) {}
      node.pannerNode.pan.value = clampedPan;
      const nativePanner = (node.pannerNode as any).output || (node.pannerNode as any)._panner;
      if (nativePanner && nativePanner.pan) {
        try { nativePanner.pan.cancelScheduledValues(0); } catch (_) {}
        nativePanner.pan.value = clampedPan;
      }
    }
    return node;
  }

  public updateDrumChannelPan(channelId: string, pan: number) {
    this.getChannelAudioNode(channelId, pan);
  }

  public removeDrumPlayer(channelId: string) {
    const cachedPlayer = this.drumPlayers.get(channelId);
    if (cachedPlayer) {
      try { cachedPlayer.player.dispose(); } catch (_) {}
      this.drumPlayers.delete(channelId);
    }
    const cachedNode = this.drumChannelNodes.get(channelId);
    if (cachedNode) {
      try { cachedNode.volumeNode.dispose(); } catch (_) {}
      try { cachedNode.pannerNode.dispose(); } catch (_) {}
      this.drumChannelNodes.delete(channelId);
    }
  }

  private getOrCreateDrumPlayer(channelId: string, sampleUrl: string, pan: number): { player: Tone.Player | null, channelNode: { volumeNode: Tone.Volume, pannerNode: Tone.Panner } } {
    const channelNode = this.getChannelAudioNode(channelId, pan);
    const cached = this.drumPlayers.get(channelId);

    if (cached) {
      if (cached.sampleUrl === sampleUrl) {
        return { player: cached.player, channelNode };
      }
      // If sampleUrl changed for this channel, dispose old player
      try { cached.player.dispose(); } catch (_) {}
      this.drumPlayers.delete(channelId);
    }

    if (sampleUrl.startsWith('/') || sampleUrl.endsWith('.wav') || sampleUrl.endsWith('.mp3')) {
      const player = new Tone.Player({
        url: sampleUrl,
        autostart: false,
        onerror: (err) => {
          console.warn(`[ToneEngine] Error cargando sample de batería: ${sampleUrl}`, err);
        }
      }).connect(channelNode.volumeNode);

      this.drumPlayers.set(channelId, { player, sampleUrl });
      return { player, channelNode };
    }

    return { player: null, channelNode };
  }

  private triggerDrumSound(channelId: string, sampleUrl: string, volDb: number, pan: number, time?: number) {
    const { player, channelNode } = this.getOrCreateDrumPlayer(channelId, sampleUrl, pan);

    // Update channel node volume for this trigger
    channelNode.volumeNode.volume.value = volDb;

    if (player && player.loaded) {
      if (time !== undefined) {
        player.start(time);
      } else {
        player.start();
      }
      return;
    }

    // Fallback sintético si el sample está cargando o no se pudo cargar
    let synth = this.drumSynths.get(sampleUrl);
    if (!synth) {
      const urlLower = sampleUrl.toLowerCase();
      if (urlLower.includes('snare') || urlLower.includes('clap')) {
        synth = this.drumSynths.get('snare1.mp3');
      } else if (urlLower.includes('hihat') || urlLower.includes('crash')) {
        synth = this.drumSynths.get('hihat_closed1.mp3');
      } else {
        synth = this.drumSynths.get('kick1.mp3');
      }
    }

    if (synth) {

      if (time !== undefined) {
        if (synth instanceof Tone.MembraneSynth) {
          synth.triggerAttackRelease('C1', '8n', time);
        } else if (synth instanceof Tone.NoiseSynth) {
          (synth as any).triggerAttackRelease('16n', time);
        } else if (synth instanceof Tone.MetalSynth) {
          (synth as any).triggerAttackRelease('16n', time);
        }
      } else {
        if (synth instanceof Tone.MembraneSynth) {
          synth.triggerAttackRelease('C1', '8n');
        } else if (synth instanceof Tone.NoiseSynth) {
          (synth as any).triggerAttackRelease('16n');
        } else if (synth instanceof Tone.MetalSynth) {
          (synth as any).triggerAttackRelease('16n');
        }
      }
    }
  }

  public playDrumPreview(channelId: string, customVelocity?: number) {
    const state = useSongStore.getState();
    const channel = state.drumChannels.find(c => c.id === channelId);
    if (!channel || channel.muted) return;

    const velocity = customVelocity !== undefined ? customVelocity : 0.8;
    const volDb = Tone.gainToDb((channel.volume / 100) * velocity);

    this.triggerDrumSound(channel.id, channel.sampleUrl, volDb, channel.pan ?? 0);
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
      // Usar flattenPatternChain importada al principio del archivo
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
      // Modo Normal: Bucle de 16 pasos del patrón actualmente seleccionado
      globalStepIndex = Math.round(beat / 0.25) % 16;
      patternIndex = state.currentDrumPatternEdit;
      localStepIndex = globalStepIndex;
    }
    
    if (this.lastTriggeredDrumStep === globalStepIndex && Math.abs(beat - this.lastTriggeredDrumBeat) < 0.1) {
      return; 
    }
    
    this.lastTriggeredDrumStep = globalStepIndex;
    this.lastTriggeredDrumBeat = beat;

    const globalDrumsChannel = state.channels['drums'];
    const isGlobalDrumsSilenced = globalDrumsChannel 
      ? globalDrumsChannel.muted || (Object.values(state.channels).some((c: any) => c.solo) && !globalDrumsChannel.solo)
      : false;

    state.drumChannels.forEach(channel => {
      if (isGlobalDrumsSilenced) return;
      if (channel.muted) return;
      
      const isAnySolo = state.drumChannels.some(c => c.solo);
      if (isAnySolo && !channel.solo) return;

      if (!channel.patterns || !channel.patterns[patternIndex]) return;
      const step = channel.patterns[patternIndex][localStepIndex];
      if (step && step.isActive) {
        const volDb = Tone.gainToDb((channel.volume / 100) * step.velocity);
        this.triggerDrumSound(channel.id, channel.sampleUrl, volDb, channel.pan ?? 0, time);
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
    // S5: Leer el estado una sola vez en lugar de múltiples llamadas a getState()
    const state = useSongStore.getState();
    if (!state.isPlaying) return;

    const bpm = Tone.Transport.bpm.value;
    const beat = Tone.Transport.getSecondsAtTime(time) * (bpm / 60);
    // Redondear a la semicorchea más cercana (0.25 beats)
    const tickBeat = Math.round(beat * 4) / 4;
    
    // Wrap to chord loop length if shorter than max beat
    let localTickBeat = tickBeat;
    if (this.cachedChordsMaxBeat > 0 && this.cachedChordsMaxBeat < this.cachedMaxBeat) {
      localTickBeat = tickBeat % this.cachedChordsMaxBeat;
    }

    // Si retrocedemos en loop, reseteamos la última marca
    if (localTickBeat < this.lastTriggeredBeat) {
      this.lastTriggeredBeat = -1;
      this.lastTriggeredChordId = '';
      this.lastTriggeredChordName = '';
    }

    if (localTickBeat === this.lastTriggeredBeat) return;
    this.lastTriggeredBeat = localTickBeat;

    // Buscar si hay un bloque activo en este beat
    const block = state.chordBlocks.find(b => 
      localTickBeat >= b.startBeat && localTickBeat < b.startBeat + b.durationBeats
    );
    if (!block) return;

    const activeMarker = (state.styleMarkers || [])
      .filter((m: any) => localTickBeat >= m.beat)
      .pop();
    const pattern = activeMarker ? activeMarker.pattern : (state.pattern || 'hold');
    const relativeBeat = localTickBeat - block.startBeat;
    const usePiano = this.isChordPianoActive();
    const beatDuration = 60 / bpm;

    const notes = this.getBlockNotes(block, state.chordOctaveShift || 0);
    if (notes.length === 0) return;

    const currentVoicing = block.voicing || 'default';
    const currentInversion = block.inversion || 0;

    const hasChordChanged = 
      block.id !== this.lastTriggeredChordId || 
      block.chord !== this.lastTriggeredChordName || 
      currentVoicing !== this.lastTriggeredVoicing || 
      currentInversion !== this.lastTriggeredInversion;

    if (hasChordChanged) {
      // Liberar notas activas anteriores para evitar amontonamiento
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        try {
          this.chordsPiano.stopAll();
        } catch (_) {}
      } else {
        try {
          this.chordSynth.releaseAll();
        } catch (_) {}
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
          this.chordSynth.triggerAttackRelease(note, durSec, time, velocity);
        } catch (e) { console.error(e); }
      }
      this.trackNote(note, durSec, time, 'harmony');
    };

    const playChord = (durBeats: number, velocity = 0.6) => {
      const durSec = durBeats * beatDuration;
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        notes.forEach(note => {
          try {
            this.chordsPiano!.keyDown({ note, time, velocity });
            this.chordsPiano!.keyUp({ note, time: time + durSec });
          } catch (e) { console.error(e); }
          this.trackNote(note, durSec, time, 'harmony');
        });
      } else {
        try {
          this.chordSynth.triggerAttackRelease(notes, durSec, time, velocity);
        } catch (e) { console.error(e); }
        notes.forEach(note => this.trackNote(note, durSec, time, 'harmony'));
      }
    };

    if (pattern === 'hold') {
      if (relativeBeat === 0 || hasChordChanged) {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          playChord(remainingBeats, 0.6);
        }
      }
    } 
    else if (pattern === 'quarters') {
      if (relativeBeat % 1 === 0) {
        playChord(0.8, 0.6);
      }
    } 
    else if (pattern === 'eighths') {
      if (relativeBeat % 0.5 === 0) {
        playChord(0.4, 0.55);
      }
    } 
    else if (pattern === 'pop') {
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
    } 
    else if (pattern === 'arpeggio') {
      // Bajo en beat 0 y sostiene
      if ((relativeBeat === 0 || hasChordChanged) && notes.length > 1 && block.type !== 'chord-only') {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          playNote(notes[0], remainingBeats, 0.7);
        }
      }

      // Arpegiar las notas del acorde (excluyendo el bajo)
      if (relativeBeat % 0.5 === 0) {
        const arpNotes = (notes.length > 1 && block.type !== 'chord-only') ? notes.slice(1) : notes;
        const period = (arpNotes.length - 1) * 2;
        const step = Math.round(relativeBeat / 0.5);
        let noteIndex = 0;

        if (period > 0) {
          const mod = step % period;
          noteIndex = mod < arpNotes.length ? mod : period - mod;
        }

        playNote(arpNotes[noteIndex], 0.4, 0.55);
      }
    } 
    else if (pattern === 'strum') {
      if (relativeBeat === 0 || hasChordChanged) {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          notes.forEach((note, index) => {
            const strumOffset = index * 0.025; // 25ms de desfase
            const noteTime = time + strumOffset;
            const noteDur = (remainingBeats * beatDuration) - strumOffset;

            if (usePiano) {
              try {
                this.chordsPiano!.keyDown({ note, time: noteTime, velocity: 0.6 - index * 0.05 });
                this.chordsPiano!.keyUp({ note, time: noteTime + noteDur });
              } catch (e) {
                console.error(e);
              }
            } else {
              try {
                this.chordSynth.triggerAttackRelease(note, noteDur, noteTime, 0.6 - index * 0.05);
              } catch (e) {
                console.error(e);
              }
            }
          });
        }
      }
    }
    else {
      // Patrón custom (PatternDef desde MIDI)
      const customPattern = state.customPatterns?.find((p: { name: string }) => p.name === pattern);
      if (customPattern) {
        this.playCustomPatternTick(
          customPattern, relativeBeat, block, notes, time, beatDuration, usePiano, hasChordChanged
        );
      }
    }
  }

  private resolvePatternNoteToChord(
    pn: { semitoneFromRoot: number; octaveOffset: number; voice: string },
    chordName: string,
    refOctave: number
  ): string {
    const chordOctaveShift = useSongStore.getState().chordOctaveShift || 0;
    return resolvePatternNoteToChord(pn, chordName, refOctave, chordOctaveShift);
  }

  /**
   * Dispara las notas de un PatternDef custom para el beat actual.
   * Filtra las notas del patrón que deben sonar en este tick (beatOffset == relativeBeat % totalBeats).
   */
  private playCustomPatternTick(
    customPattern: PatternDef,
    relativeBeat: number,
    block: any,
    _notes: string[],
    time: number,
    beatDuration: number,
    usePiano: boolean | null,
    _hasChordChanged: boolean
  ) {
    const cycleOffset = relativeBeat % customPattern.totalBeats;
    const tickBeatRounded = Math.round(cycleOffset * 4) / 4;

    // Filtrar las notas del patrón que comienzan en este tick
    const toPlay = customPattern.notes.filter(pn => {
      const beatRounded = Math.round(pn.beatOffset * 4) / 4;
      return beatRounded === tickBeatRounded;
    });

    if (toPlay.length === 0) return;

    for (const pn of toPlay) {
      // Si el bloque es bass-only, solo reproducir notas de bajo; si es chord-only solo acordes
      if (block.type === 'bass-only' && pn.voice !== 'bass') continue;
      if (block.type === 'chord-only' && pn.voice !== 'chord') continue;

      const refOctave = pn.voice === 'bass' ? 2 : 4;
      const noteName = this.resolvePatternNoteToChord(pn, block.chord, refOctave);
      const durSec = pn.durationBeats * beatDuration;

      if (usePiano) {
        try {
          this.chordsPiano!.keyDown({ note: noteName, time, velocity: pn.velocity });
          this.chordsPiano!.keyUp({ note: noteName, time: time + durSec });
        } catch (e) { console.error(e); }
      } else {
        try {
          this.chordSynth.triggerAttackRelease(noteName, durSec, time, pn.velocity);
        } catch (e) { console.error(e); }
      }
      this.trackNote(noteName, durSec, time, 'harmony');
    }
  }

  private getBlockNotes(block: any, chordOctaveShift = 0): string[] {
    return getBlockNotes({
      chord: block.chord,
      voicing: block.voicing,
      inversion: block.inversion,
      octaveShift: chordOctaveShift,
      type: block.type,
      bassNote: block.bassNote
    });
  }

  private syncTimeline() {
    if (!this.isInitialized) return;

    const state = useSongStore.getState();
    const bpm = state.bpm;
    const beatDuration = 60 / bpm;
    const currentPos = Tone.Transport.seconds;
    
    // Limpiar únicamente los eventos de acordes y notas musicales programados previamente
    this.scheduledEvents.forEach((id) => {
      try {
        Tone.Transport.clear(id);
      } catch (e) {
        console.warn('Error clearing event:', e);
      }
    });
    this.scheduledEvents = [];

    const usePiano = this.isMelodyPianoActive();

    // --- LIBERAR NOTAS DE MELODÍA O ARMONÍA ELIMINADAS O LIMPIADAS ---
    const currentBeat = state.currentBeat;
    const now = Tone.now();

    // 1. Liberar notas de melodía que ya no están programadas en ninguna pista para este beat
    const allMelodyNotes = (state.tracks && state.tracks.length > 0)
      ? state.tracks.flatMap((t: any) => t.notes || [])
      : (state.melodyNotes || []);

    const stillActiveMelodyNotes = new Set(
      allMelodyNotes
        .filter((n: any) => currentBeat >= n.startBeat && currentBeat < n.startBeat + n.durationBeats)
        .map((n: any) => n.note)
    );

    Array.from(this.activeMelodyNotesSet).forEach(note => {
      if (!stillActiveMelodyNotes.has(note)) {
        try {
          if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
            this.melodyPiano.keyUp({ note, time: now });
          }
        } catch (_) {}
        this.activeMelodyNotesSet.delete(note);
        const timer = this.melodyNoteActiveTimers.get(note);
        if (timer) {
          clearTimeout(timer);
          this.melodyNoteActiveTimers.delete(note);
        }
      }
    });

    if (!usePiano && this.activeMelodyNotesSet.size === 0) {
      try {
        this.melodySynth.releaseAll();
      } catch (_) {}
    }
    useSongStore.getState().setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));

    // 2. Liberar notas de armonía si no hay un bloque de acorde activo o si se limpiaron todos los bloques
    const activeBlock = state.chordBlocks.find(b => 
      currentBeat >= b.startBeat && currentBeat < b.startBeat + b.durationBeats
    );
    if (!activeBlock || state.chordBlocks.length === 0) {
      Array.from(this.activeNotesSet).forEach(note => {
        try {
          if (this.chordsPiano && this.chordsPiano.loaded) {
            this.chordsPiano.keyUp({ note, time: now });
          }
        } catch (_) {}
      });
      try {
        this.chordSynth.releaseAll();
      } catch (_) {}
      this.activeNotesSet.clear();
      this.noteActiveTimers.forEach(t => clearTimeout(t));
      this.noteActiveTimers.clear();
      useSongStore.getState().setActiveNotes([]);
    }

    // 1. Programar acordes (Deshabilitado: los acordes se programan dinámicamente al vuelo en triggerChordTick)

    // 2. Programar notas de melodía
    const repeats = this.cachedMelodyMaxBeat > 0 && this.cachedMelodyMaxBeat < this.cachedMaxBeat 
      ? Math.ceil(this.cachedMaxBeat / this.cachedMelodyMaxBeat) 
      : 1;

    const tracksToPlay = (state.tracks && state.tracks.length > 0)
      ? state.tracks
      : [{ id: 'melody', name: 'Melodía', channelId: 'melody', notes: state.melodyNotes }];

    for (let r = 0; r < repeats; r++) {
      const offsetBeat = r * this.cachedMelodyMaxBeat;
      tracksToPlay.forEach((track) => {
        const channelConfig = state.channels[track.channelId];
        if (channelConfig && channelConfig.muted) return;
        const isAnySolo = Object.values(state.channels).some((c: any) => c.solo);
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
              } catch (e) {
                console.error('Error tocando nota de piano:', e);
              }
            } else {
              const synth = this.getChannelSynth(track.channelId);

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
              } catch (e) {
                console.error('Error tocando sintetizador de pista:', e);
              }
            }
            this.trackNote(note.note, durationSeconds, time, 'melody');
          }, startTimeSeconds);
          this.scheduledEvents.push(id);
        });
      });
    }


    // 3. Programar clicks del metrónomo de forma aislada y sample-accurate
    if (this.metroEventId !== null) {
      try {
        Tone.Transport.clear(this.metroEventId);
      } catch (_) {}
      this.metroEventId = null;
    }

    if (state.isMetronomeActive) {
      this.metroEventId = Tone.Transport.scheduleRepeat((time) => {
        try {
          const ticks = Tone.Transport.getTicksAtTime(time);
          const currentBeat = Math.round((ticks / Tone.Transport.PPQ) * 100) / 100;
          
          const timeSignature = useSongStore.getState().timeSignature || '4/4';
          const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
          
          const isMeasureStart = (currentBeat % beatsPerMeasure) === 0;
          const isBeat = (currentBeat % 1) === 0;
          
          let frequency = 400;
          if (isMeasureStart) {
            frequency = 1200;
          } else if (isBeat) {
            frequency = 800;
          }
          
          const volumeFactor = (isMeasureStart || isBeat) ? 1 : 0.5;
          const gain = state.metroVolume / 100 * volumeFactor;
          const db = gain === 0 ? -Infinity : Tone.gainToDb(gain);
          
          this.metroSynth.volume.value = db;
          this.metroSynth.triggerAttackRelease(frequency, '32n', time);
        } catch (e) {
          console.error('Error en metrónomo:', e);
        }
      }, state.metroSubdivision);
    }

    // 4. Calcular la duración total de la canción para el bucle
    const maxBeat = this.updateCachedMaxBeat(state);

    const loopEndSeconds = maxBeat * beatDuration;

    Tone.Transport.loop = state.isLooping; // Enable native loop for seamless looping
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = loopEndSeconds;

    // Solo reajustamos seconds si la posición actual excede los límites (evitando stutters al reproducir y editar)
    if (currentPos > loopEndSeconds) {
      Tone.Transport.seconds = loopEndSeconds;
    }
  }

  /**
   * Registra y gestiona una nota activa para actualizar la UI en tiempo real
   * mediante un setTimeout preciso sincronizado con la reproducción de Tone.js.
   */
  private trackNote(note: string, durationSeconds: number, startTime?: number, type: 'harmony' | 'melody' | string = 'harmony') {
    const now = Tone.now();
    const delayMs = startTime !== undefined ? Math.max(0, (startTime - now) * 1000) : 0;
    const durationMs = durationSeconds * 1000;

    setTimeout(() => {
      // Si la previsualización o reproducción se detuvo, no activar
      const state = useSongStore.getState();
      if (!state.isPlaying && this.activePreviewChord === null) {
        return;
      }

      if (type !== 'harmony') {
        // --- Melodía: usa el set y timers separados ---
        const existingTimer = this.melodyNoteActiveTimers.get(note);
        if (existingTimer) clearTimeout(existingTimer);

        this.activeMelodyNotesSet.add(note);
        state.setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));

        const offTimer = setTimeout(() => {
          this.activeMelodyNotesSet.delete(note);
          state.setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));
          this.melodyNoteActiveTimers.delete(note);
        }, durationMs);

        this.melodyNoteActiveTimers.set(note, offTimer);
      } else {
        // --- Armonía: comportamiento original ---
        const existingTimer = this.noteActiveTimers.get(note);
        if (existingTimer) clearTimeout(existingTimer);

        this.activeNotesSet.add(note);
        state.setActiveNotes(Array.from(this.activeNotesSet));

        const offTimer = setTimeout(() => {
          this.activeNotesSet.delete(note);
          state.setActiveNotes(Array.from(this.activeNotesSet));
          this.noteActiveTimers.delete(note);
        }, durationMs);

        this.noteActiveTimers.set(note, offTimer);
      }
    }, delayMs);
  }

  private updateSustain(sustain: boolean) {
    const releaseTime = sustain ? 2.5 : 0.8;
    this.chordSynth.set({
      envelope: { release: releaseTime }
    });
    [this.chordsPiano, this.melodyPiano].forEach(piano => {
      if (piano) {
        try {
          if (sustain) {
            piano.pedalDown();
          } else {
            piano.pedalUp();
          }
        } catch (e) {
          console.error('Error al aplicar pedal de sustain en el piano:', e);
        }
      }
    });
  }

  /**
   * Exporta la composición completa como WAV PCM 16-bit.
   *
   * DISEÑO:
   *  - Devuelve cancel() de forma SÍNCRONA para que el botón Cancelar del modal
   *    funcione desde el primer instante, sin esperar a que la grabación arranque.
   *  - La grabación se conecta directamente a las salidas nativas (StereoPannerNode)
   *    de cada canal, fan-out al MediaStreamDestinationNode en paralelo a los altavoces.
   *  - Toda la lógica async corre en un IIFE interno con try-catch total; si algo
   *    falla, cleanup() restaura la UI y se llama onError() sin dejar la app colgada.
   *
   * @returns Función cancel() para abortar el proceso (disponible inmediatamente).
   */
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
        const wavBlob = await renderSessionToWav(session, state.customPatterns || [], {
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

  public dispose() {
    this.stop();
    Tone.Transport.cancel(0);
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
  }


}

export const toneEngine = new ToneEngine();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    toneEngine.dispose();
  });
}
