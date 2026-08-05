import { create } from 'zustand';
import { temporal } from 'zundo';
import type { NoteClass, ScaleType, ChordBlock, MelodyNote, GhostNote, ChordSuggestion, ActiveView, ChannelConfig, ChannelInstrument } from '../utils/typeDefinitions';

import { getHarmonicSuggestions } from '../engine/harmonyEngine';
import { detectKey } from '../engine/keyDetector';
import { toneEngine } from '../audio/toneEngine';
import type { PatternDef } from '../patterns/patternTypes';
import { loadCustomPatterns, invalidatePatternCache } from '../patterns/patternLoader';

import { PRESET_DRUM_KITS, findMatchingKitId, inferCategoryFromChannel } from '../constants/drumKits';

const NOTE_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type PaletteMode = 'matrix' | 'fifths' | 'cadences';

function transposeNoteName(noteName: string, semitones: number): string {
  const match = noteName.match(/^([A-G]#?|b?)([0-9])$/);
  if (!match) return noteName;
  const pitchClass = match[1];
  const octave = parseInt(match[2]);
  const currentMidi = 12 * (octave + 1) + NOTE_CLASSES.indexOf(pitchClass);
  const newMidi = currentMidi + semitones;
  const newOctave = Math.floor(newMidi / 12) - 1;
  const newPitchClass = NOTE_CLASSES[((newMidi % 12) + 12) % 12];
  return `${newPitchClass}${newOctave}`;
}

function transposeChordName(chordName: string, semitones: number): string {
  const match = chordName.match(/^([A-G]#?|b?)(m|maj7|min7|7|maj|min|dim|aug|m7b5|sus4|sus2)?$/);
  if (!match) return chordName;
  const root = match[1];
  const type = match[2] || '';
  const rootVal = NOTE_CLASSES.indexOf(root);
  if (rootVal === -1) return chordName;
  const newRootVal = (((rootVal + semitones) % 12) + 12) % 12;
  return `${NOTE_CLASSES[newRootVal]}${type}`;
}

interface SongStore {
  bpm: number;
  key: NoteClass;
  scale: ScaleType;
  isAutoKey: boolean;         // true = la tónica se detecta automáticamente
  detectedKey: string | null; // etiqueta de tonalidad detectada para mostrar en la UI
  activeView: ActiveView;
  paletteMode: PaletteMode;
  chordBlocks: ChordBlock[];
  melodyNotes: MelodyNote[];
  isPlaying: boolean;
  currentBeat: number;
  playbackStep: number;
  selectedChordId: string | null;
  chordSuggestions: ChordSuggestion[];
  ghostNotes: GhostNote[];
  isLooping: boolean;
  isMetronomeActive: boolean;
  metroSubdivision: '4n' | '8n' | '16n';
  metroVolume: number;
  isAudioLoading: boolean;
  isEngineReady: boolean;
  isExporting: boolean;
  exportProgress: number; // 0.0 – 1.0
  instrumentType: 'synth' | 'piano';
  draggingChord: string | null;
  timeSignature: '4/4' | '3/4' | '6/8';
  pattern: string;
  customPatterns: PatternDef[];
  activeNotes: string[]; // Notas de armonía sonando en este momento (para el visualizador de piano)
  activeMelodyNotes: string[]; // Notas de melodía sonando en este momento (color distinto en el visualizador)
  swing: number; // Ratio de swing (0% a 100%)
  sustain: boolean; // Pedal de sustain / resonancia de notas
  chordOctaveShift: number; // Transposición global de acordes por octavas
  isKeyboardMelodyEnabled: boolean;
  isKeyboardChromatic: boolean;
  isSynthModalOpen: boolean;
  synthSettings: {
    waveType: 'sine' | 'triangle' | 'square' | 'sawtooth';
    envelope: {
      attack: number;
      decay: number;
      sustain: number;
      release: number;
    };
    filter: {
      enabled: boolean;
      type: 'lowpass' | 'highpass' | 'bandpass';
      frequency: number;
      Q: number;
    };
    detune: number;
  };
  
  // Ajustes de UI / CRT
  isCrtEnabled: boolean;
  isSettingsOpen: boolean;
  crtParams: {
    scanlineOpacity: number;
    scanlineSize: number;
    curvature: number;
    aberration: number;
    bloom: number;
    svgBlur: number;
    phosphorHue: number;
    phosphorSat: number;
    tintStrength: number;
    noise: number;
    flicker: number;
    vignette: number;
    brightness: number;
    contrast: number;
    saturation: number;
  };

  // Estado del Secuenciador de Batería
  drumChannels: import('../utils/typeDefinitions').DrumChannel[];
  activeDrumKitId: string;
  selectDrumKit: (kitId: string) => void;
  currentDrumPatternEdit: number;
  setCurrentDrumPatternEdit: (pattern: number) => void;
  addDrumChannel: (channel: import('../utils/typeDefinitions').DrumChannel) => void;
  updateDrumChannel: (id: string, updates: Partial<import('../utils/typeDefinitions').DrumChannel>) => void;
  toggleDrumStep: (channelId: string, stepIndex: number, patternIndex: number, forceState?: boolean) => void;
  setDrumStepVelocity: (channelId: string, stepIndex: number, patternIndex: number, velocity: number) => void;

  // Acciones de Copia de Patrón
  clipboardPattern: import('../utils/typeDefinitions').DrumStep[][] | null;
  copyDrumPattern: (sourcePatternIndex: number) => void;
  pasteDrumPattern: (targetPatternIndex: number) => void;

  // Estado de Cadena de Patrones (Pattern Chain / Arranger)
  patternChain: import('../utils/typeDefinitions').PatternChainItem[];
  isPatternRepeatOn: boolean;
  currentChainItemId: string | null;
  setPatternRepeatOn: (active: boolean) => void;
  setCurrentChainItemId: (id: string | null) => void;
  addChainItem: (patternIndex: number, repeatCount?: number) => void;
  updateChainItem: (id: string, updates: Partial<import('../utils/typeDefinitions').PatternChainItem>) => void;
  removeChainItem: (id: string) => void;
  moveChainItem: (fromIndex: number, toIndex: number) => void;
  removeDrumChannel: (id: string) => void;

  // Estado del Mezclador (Mixer)
  isMixerOpen: boolean;
  channels: Record<string, ChannelConfig>;
  setMixerOpen: (open: boolean) => void;
  updateChannel: (id: string, updates: Partial<ChannelConfig>) => void;
  toggleMute: (id: string) => void;
  toggleSolo: (id: string) => void;
  setChannelVolume: (id: string, volume: number) => void;
  setChannelPan: (id: string, pan: number) => void;
  setChannelInstrument: (id: string, instrument: ChannelInstrument) => void;

  setBpm: (bpm: number) => void;

  setKey: (key: NoteClass) => void;
  setScale: (scale: ScaleType) => void;
  setIsAutoKey: (auto: boolean) => void;
  setPaletteMode: (mode: PaletteMode) => void;
  setActiveView: (view: ActiveView) => void;
  setPlaying: (isPlaying: boolean) => void;
  setCurrentBeat: (beat: number) => void;
  setPlaybackStep: (step: number) => void;
  setLooping: (isLooping: boolean) => void;
  setMetronomeActive: (isActive: boolean) => void;
  setMetroSubdivision: (subdivision: '4n' | '8n' | '16n') => void;
  setMetroVolume: (volume: number) => void;
  setIsAudioLoading: (loading: boolean) => void;
  setIsEngineReady: (ready: boolean) => void;
  setIsExporting: (v: boolean) => void;
  setExportProgress: (v: number) => void;
  setInstrumentType: (type: 'synth' | 'piano') => void;
  setDraggingChord: (chord: string | null) => void;
  setTimeSignature: (timeSignature: '4/4' | '3/4' | '6/8') => void;
  setPattern: (pattern: string) => void;
  setCustomPatterns: (patterns: PatternDef[]) => void;
  setActiveNotes: (notes: string[]) => void;
  setActiveMelodyNotes: (notes: string[]) => void;
  setSwing: (swing: number) => void;
  setSustain: (sustain: boolean) => void;
  setChordOctaveShift: (shift: number) => void;
  refreshPatterns: () => Promise<void>;
  setKeyboardMelodyEnabled: (enabled: boolean) => void;
  setKeyboardChromatic: (chromatic: boolean) => void;
  setSynthModalOpen: (open: boolean) => void;
  setSynthSettings: (settings: Partial<SongStore['synthSettings']>) => void;
  isAutoSuggestions: boolean;
  setAutoSuggestions: (v: boolean) => void;
  // Setters de UI / CRT
  setCrtEnabled: (enabled: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCrtParams: (params: Partial<SongStore['crtParams']>) => void;

  addChordBlock: (chord: string, startBeat: number, durationBeats?: number) => void;
  updateChordBlock: (id: string, updates: Partial<Omit<ChordBlock, 'id'>>) => void;
  removeChordBlock: (id: string) => void;
  setSelectedChordId: (id: string | null) => void;

  addMelodyNote: (note: Omit<MelodyNote, 'id'>) => void;
  updateMelodyNote: (id: string, updates: Partial<Omit<MelodyNote, 'id'>>) => void;
  removeMelodyNote: (id: string) => void;
  setMelodyNotes: (notes: MelodyNote[]) => void;

  updateSuggestions: () => void;
  setGhostNotes: (ghostNotes: GhostNote[]) => void;
  transposeSong: (semitones: number) => void;
  clearSong: () => void;
  importSong: (session: {
    bpm: number;
    key: NoteClass;
    scale: ScaleType;
    pattern: string;
    timeSignature: '4/4' | '3/4' | '6/8';
    chordBlocks: ChordBlock[];
    melodyNotes: MelodyNote[];
    isAutoKey?: boolean;
    chordOctaveShift?: number;
    channels?: Record<string, ChannelConfig>;
    drumChannels?: import('../utils/typeDefinitions').DrumChannel[];
    patternChain?: import('../utils/typeDefinitions').PatternChainItem[];
    isPatternRepeatOn?: boolean;
    activeDrumKitId?: string;
  }) => void;
}

export const DEFAULT_CHANNELS: Record<string, ChannelConfig> = {
  chords: {
    id: 'chords',
    name: 'Armonía',
    type: 'chord',
    instrument: 'piano',
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
    color: '#00ffcc'
  },
  melody: {
    id: 'melody',
    name: 'Melodía',
    type: 'melody',
    instrument: 'synth',
    volume: 85,
    pan: 0,
    muted: false,
    solo: false,
    color: '#ff00aa'
  },
  drums: {
    id: 'drums',
    name: 'Batería',
    type: 'drums',
    instrument: 'sampler' as ChannelInstrument,
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
    color: '#00e5ff'
  }
};

const createEmptyPatterns = (numPatterns = 8, length = 16) => 
  Array.from({ length: numPatterns }).map(() => 
    Array.from({ length }).map(() => ({ isActive: false, velocity: 0.8 }))
  );

export const DEFAULT_DRUM_CHANNELS: import('../utils/typeDefinitions').DrumChannel[] = [
  { id: 'kick_1', name: 'Kick', sampleUrl: '/drums/kicks/kick1.wav', patterns: createEmptyPatterns(), volume: 80, pan: 0, muted: false, solo: false },
  { id: 'snare_1', name: 'Snare', sampleUrl: '/drums/snares/snare1.wav', patterns: createEmptyPatterns(), volume: 80, pan: 0, muted: false, solo: false },
  { id: 'hihat_closed', name: 'HiHat (C)', sampleUrl: '/drums/hihats_closed/hihat_closed1.wav', patterns: createEmptyPatterns(), volume: 70, pan: 0, muted: false, solo: false },
  { id: 'hihat_open', name: 'HiHat (O)', sampleUrl: '/drums/hihats_open/hihat_open1.wav', patterns: createEmptyPatterns(), volume: 70, pan: 0, muted: false, solo: false },
  { id: 'clap_1', name: 'Clap', sampleUrl: '/drums/claps/clap1.wav', patterns: createEmptyPatterns(), volume: 75, pan: 0, muted: false, solo: false },
  { id: 'crash_1', name: 'Crash', sampleUrl: '/drums/crashes/crash1.wav', patterns: createEmptyPatterns(), volume: 70, pan: 0, muted: false, solo: false }
];

export const useSongStore = create<SongStore>()(
  temporal(
    (set, get) => ({
  bpm: 120,
  key: 'C',
  scale: 'major',
  isAutoKey: true,
  detectedKey: null,
  activeView: 'chord',
  paletteMode: 'matrix',
  chordBlocks: [],
  melodyNotes: [],
  isPlaying: false,
  currentBeat: 0,
  playbackStep: 0,
  selectedChordId: null,
  chordSuggestions: [],
  ghostNotes: [],
  isLooping: true,
  isMetronomeActive: false,
  metroSubdivision: '4n',
  metroVolume: 50,
  isAudioLoading: false,
  isExporting: false,
  exportProgress: 0,
  isEngineReady: false,
  instrumentType: 'piano',
  timeSignature: '4/4',
  pattern: 'hold',
  customPatterns: [],
  activeNotes: [],
  activeMelodyNotes: [],
  swing: 0,
  sustain: false,
  chordOctaveShift: 0,
  isKeyboardMelodyEnabled: true,
  isKeyboardChromatic: false,
  isSynthModalOpen: false,
  isAutoSuggestions: false,
  isMixerOpen: false,
  clipboardPattern: null,
  channels: DEFAULT_CHANNELS,
  drumChannels: DEFAULT_DRUM_CHANNELS,
  activeDrumKitId: 'kit_1',
  currentDrumPatternEdit: 0,

  selectDrumKit: (kitId) => set((state) => {
    if (kitId === 'custom') {
      return { activeDrumKitId: 'custom' };
    }

    const kit = PRESET_DRUM_KITS.find(k => k.id === kitId);
    if (!kit) return state;

    const nextChannels = state.drumChannels.map(ch => {
      const newSampleUrl = kit.samples[ch.id] || kit.samples[inferCategoryFromChannel(ch)];
      if (newSampleUrl) {
        return { ...ch, sampleUrl: newSampleUrl };
      }
      return ch;
    });

    return {
      drumChannels: nextChannels,
  activeDrumKitId: kitId
    };
  }),

  addDrumChannel: (channel) => set((state) => ({ drumChannels: [...state.drumChannels, channel] })),
  updateDrumChannel: (id, updates) => set((state) => {
    const nextChannels = state.drumChannels.map(ch => ch.id === id ? { ...ch, ...updates } : ch);
    const newKitId = updates.sampleUrl !== undefined ? findMatchingKitId(nextChannels) : state.activeDrumKitId;

    return { 
      drumChannels: nextChannels,
      activeDrumKitId: newKitId
    };
  }),
  removeDrumChannel: (id) => set((state) => ({ drumChannels: state.drumChannels.filter(c => c.id !== id) })),

  setCurrentDrumPatternEdit: (pattern: number) => set({ currentDrumPatternEdit: pattern }),

  // Acciones de Copia de Patrón
  copyDrumPattern: (sourcePatternIndex) => set((state) => {
    // Copiamos la información de TODOS los canales para ese index
    const copiedData = state.drumChannels.map(ch => ch.patterns[sourcePatternIndex]);
    return { clipboardPattern: copiedData };
  }),
  pasteDrumPattern: (targetPatternIndex) => set((state) => {
    if (!state.clipboardPattern) return state;
    
    const nextChannels = state.drumChannels.map((ch, idx) => {
      const nextPatterns = [...ch.patterns];
      if (state.clipboardPattern && state.clipboardPattern[idx]) {
        // Deep copy del pattern pegado
        nextPatterns[targetPatternIndex] = state.clipboardPattern[idx].map(step => ({ ...step }));
      }
      return { ...ch, patterns: nextPatterns };
    });
    return { drumChannels: nextChannels };
  }),

  // Estado de Cadena de Patrones (Pattern Chain)
  patternChain: [],
  isPatternRepeatOn: true,
  currentChainItemId: null,

  setPatternRepeatOn: (active) => set({ isPatternRepeatOn: active }),
  setCurrentChainItemId: (id) => set({ currentChainItemId: id }),

  addChainItem: (patternIndex, repeatCount = 1) => set((state) => ({
    patternChain: [...state.patternChain, { id: `chain_${Date.now()}`, type: 'pattern', patternIndex, repeatCount }]
  })),

  updateChainItem: (id, updates) => set((state) => ({
    patternChain: state.patternChain.map(item => item.id === id ? { ...item, ...updates } : item)
  })),

  removeChainItem: (id) => set((state) => {
    const nextChain = state.patternChain.filter(item => item.id !== id);
    return { patternChain: nextChain };
  }),

  moveChainItem: (fromIndex, toIndex) => set((state) => {
    if (fromIndex < 0 || fromIndex >= state.patternChain.length || toIndex < 0 || toIndex >= state.patternChain.length) return state;
    const nextChain = [...state.patternChain];
    const [moved] = nextChain.splice(fromIndex, 1);
    nextChain.splice(toIndex, 0, moved);
    return { patternChain: nextChain };
  }),

  toggleDrumStep: (channelId, stepIndex, patternIndex, forceState) => set((state) => {
    let becameActive = false;
    const nextChannels = state.drumChannels.map(ch => {
      if (ch.id === channelId) {
        const nextPatterns = [...ch.patterns];
        const nextSteps = [...nextPatterns[patternIndex]];
        if (nextSteps[stepIndex]) {
          const isActivating = forceState !== undefined ? forceState : !nextSteps[stepIndex].isActive;
          nextSteps[stepIndex] = {
            ...nextSteps[stepIndex],
            isActive: isActivating
          };
          if (isActivating) becameActive = true;
        }
        nextPatterns[patternIndex] = nextSteps;
        return { ...ch, patterns: nextPatterns };
      }
      return ch;
    });

    let nextChain = state.patternChain;
    if (becameActive) {
      const isInChain = state.patternChain.some(item => item.patternIndex === patternIndex);
      if (!isInChain) {
        nextChain = [...state.patternChain, { id: `chain_${Date.now()}`, type: 'pattern', patternIndex, repeatCount: 1 }];
      }
    }

    return { drumChannels: nextChannels, patternChain: nextChain };
  }),

  setDrumStepVelocity: (channelId, stepIndex, patternIndex, velocity) => set((state) => {
    const nextChannels = state.drumChannels.map(ch => {
      if (ch.id === channelId) {
        const nextPatterns = [...ch.patterns];
        const nextSteps = [...nextPatterns[patternIndex]];
        if (nextSteps[stepIndex]) {
          nextSteps[stepIndex] = { ...nextSteps[stepIndex], velocity };
        }
        nextPatterns[patternIndex] = nextSteps;
        return { ...ch, patterns: nextPatterns };
      }
      return ch;
    });
    return { drumChannels: nextChannels };
  }),

  setMixerOpen: (isMixerOpen) => set({ isMixerOpen }),
  updateChannel: (id, updates) => set((state) => {
    const existing = state.channels[id];
    if (!existing) return state;
    const updatedChannel = { ...existing, ...updates };
    const newChannels = { ...state.channels, [id]: updatedChannel };
    toneEngine.syncChannels(newChannels);
    return { channels: newChannels };
  }),
  toggleMute: (id) => get().updateChannel(id, { muted: !get().channels[id]?.muted }),
  toggleSolo: (id) => get().updateChannel(id, { solo: !get().channels[id]?.solo }),
  setChannelVolume: (id, volume) => get().updateChannel(id, { volume }),
  setChannelPan: (id, pan) => get().updateChannel(id, { pan }),
  setChannelInstrument: (id, instrument) => {
    get().updateChannel(id, { instrument });
    if (id === 'chords' && (instrument === 'piano' || instrument === 'synth')) {
      set({ instrumentType: instrument });
    }
  },

  synthSettings: {
    waveType: 'triangle',
    envelope: {
      attack: 0.1,
      decay: 0.3,
      sustain: 0.4,
      release: 0.8
    },
    filter: {
      enabled: false,
      type: 'lowpass',
      frequency: 2000,
      Q: 1
    },
    detune: 0
  },

  // Estados CRT por defecto
  isCrtEnabled: true,
  isSettingsOpen: false,
  crtParams: {
    scanlineOpacity: 0.21,
    scanlineSize: 5.0,
    curvature: 29.0,
    aberration: 2.0,
    bloom: 0.5,
    svgBlur: 0.5,
    phosphorHue: 121,
    phosphorSat: 31,
    tintStrength: 0.04,
    noise: 0.025,
    flicker: 0.1,
    vignette: 0.7,
    brightness: 1.13,
    contrast: 1.08,
    saturation: 0.78
  },

  setBpm: (bpm) => set({ bpm }),

  setKey: (key) => {
    set({ key, isAutoKey: false }); // el usuario tomó el control
    get().updateSuggestions();
  },

  setScale: (scale) => {
    set({ scale, isAutoKey: false });
    get().updateSuggestions();
  },

  setIsAutoKey: (isAutoKey) => {
    set({ isAutoKey });
    if (isAutoKey) get().updateSuggestions();
  },

  setPaletteMode: (paletteMode) => set({ paletteMode }),

  setActiveView: (activeView) => set({ activeView }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentBeat: (currentBeat) => {
    const oldBeat = get().currentBeat;
    set({ currentBeat });
    // S9: No recalcular sugerencias durante la reproducción — evita detectKey() cada compas
    if (get().isPlaying) return;
    if (!get().selectedChordId) {
      // Solo actualizamos sugerencias si el compás cambió.
      // El compás depende de beatsPerMeasure, pero dado que updateSuggestions asume compases de 4 beats,
      // usaremos el mismo divisor (4) que usa updateSuggestions internamente para ser consistentes.
      const oldMeasure = Math.floor(oldBeat / 4);
      const newMeasure = Math.floor(currentBeat / 4);
      if (oldMeasure !== newMeasure) {
        get().updateSuggestions();
      }
    }
  },
  setPlaybackStep: (step: number) => set({ playbackStep: step }),
  setLooping: (isLooping) => set({ isLooping }),
  setMetronomeActive: (isMetronomeActive) => set({ isMetronomeActive }),
  setMetroSubdivision: (metroSubdivision) => set({ metroSubdivision }),
  setMetroVolume: (metroVolume) => set({ metroVolume }),
  setIsAudioLoading: (isAudioLoading) => set({ isAudioLoading }),
  setIsEngineReady: (isEngineReady) => set({ isEngineReady }),
  setIsExporting: (isExporting) => set({ isExporting }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  setInstrumentType: (instrumentType) => {
    set({ instrumentType });
    toneEngine.setInstrument(instrumentType);
  },
  draggingChord: null,
  setDraggingChord: (draggingChord) => set({ draggingChord }),
  setTimeSignature: (timeSignature) => set({ timeSignature }),
  setPattern: (pattern) => set({ pattern }),
  setCustomPatterns: (customPatterns) => set({ customPatterns }),
  setActiveNotes: (activeNotes) => set({ activeNotes }),
  setActiveMelodyNotes: (activeMelodyNotes) => set({ activeMelodyNotes }),
  setSwing: (swing) => set({ swing }),
  setSustain: (sustain) => set({ sustain }),
  setChordOctaveShift: (chordOctaveShift) => set({ chordOctaveShift }),
  refreshPatterns: async () => {
    try {
      const response = await fetch('/api/process-patterns');
      if (!response.ok) {
        console.warn('API de procesamiento falló o no está disponible en este entorno.');
      }
    } catch (e) {
      console.warn('No se pudo invocar la API de procesamiento (puede estar en modo producción):', e);
    }
    invalidatePatternCache();
    const newPatterns = await loadCustomPatterns();
    set({ customPatterns: newPatterns });
    get().updateSuggestions();
  },
  setKeyboardMelodyEnabled: (isKeyboardMelodyEnabled) => set({ isKeyboardMelodyEnabled }),
  setKeyboardChromatic: (isKeyboardChromatic) => set({ isKeyboardChromatic }),
  setSynthModalOpen: (isSynthModalOpen) => set({ isSynthModalOpen }),
  setAutoSuggestions: (isAutoSuggestions) => set({ isAutoSuggestions }),
  setSynthSettings: (updates) => set((state) => {
    const newSettings = { ...state.synthSettings };
    if (updates.waveType !== undefined) newSettings.waveType = updates.waveType;
    if (updates.detune !== undefined) newSettings.detune = updates.detune;
    
    if (updates.envelope !== undefined) {
      newSettings.envelope = { ...newSettings.envelope, ...updates.envelope };
    }
    if (updates.filter !== undefined) {
      newSettings.filter = { ...newSettings.filter, ...updates.filter };
    }
    // S7: Notificar al toneEngine que hay nuevos ajustes incrementando la versión
    // (evita JSON.stringify en cada tick del suscriptor)
    toneEngine.bumpSynthSettingsVersion();
    return { synthSettings: newSettings };
  }),

  setCrtEnabled: (isCrtEnabled) => set({ isCrtEnabled }),
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  setCrtParams: (updates) => set((state) => ({ crtParams: { ...state.crtParams, ...updates } })),

  addChordBlock: (chord, startBeat, durationBeats = 4) => {
    const newBlock: ChordBlock = {
      id: Math.random().toString(36).substr(2, 9),
      chord,
      startBeat,
      durationBeats
    };
    set((state) => {
      const filtered = state.chordBlocks.filter(b => b.startBeat !== startBeat);
      return { chordBlocks: [...filtered, newBlock].sort((a, b) => a.startBeat - b.startBeat) };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  updateChordBlock: (id, updates) => {
    set((state) => ({
      chordBlocks: state.chordBlocks.map(b => b.id === id ? { ...b, ...updates } : b)
        .sort((a, b) => a.startBeat - b.startBeat)
    }));
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  removeChordBlock: (id) => {
    set((state) => ({
      chordBlocks: state.chordBlocks.filter(b => b.id !== id),
      selectedChordId: state.selectedChordId === id ? null : state.selectedChordId
    }));
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setSelectedChordId: (selectedChordId) => {
    set({ selectedChordId });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  addMelodyNote: (noteData) => {
    const newNote: MelodyNote = { id: Math.random().toString(36).substr(2, 9), ...noteData };
    set((state) => ({ melodyNotes: [...state.melodyNotes, newNote] }));
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  updateMelodyNote: (id, updates) => {
    set((state) => ({
      melodyNotes: state.melodyNotes.map(n => n.id === id ? { ...n, ...updates } : n)
    }));
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  removeMelodyNote: (id) => {
    set((state) => ({ melodyNotes: state.melodyNotes.filter(n => n.id !== id) }));
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setMelodyNotes: (melodyNotes) => {
    set({ melodyNotes });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  updateSuggestions: () => {
    const state = get();
    const { chordBlocks, melodyNotes, selectedChordId, currentBeat } = state;
    let { key, scale } = state;

    // --- Auto-detección de tonalidad ---
    if (state.isAutoKey && chordBlocks.length > 0) {
      const chordNames = chordBlocks.map(b => b.chord);
      const detected = detectKey(chordNames);
      if (detected) {
        // Solo actualizar si cambia para evitar renders extra
        const detectedLabel = `${detected.key} ${detected.scale}`;
        if (state.detectedKey !== detectedLabel) {
          set({ key: detected.key, scale: detected.scale, detectedKey: detectedLabel });
        }
        key = detected.key;
        scale = detected.scale;
      }
    } else if (state.isAutoKey && chordBlocks.length === 0) {
      set({ detectedKey: null });
    }

    // --- Extraer notas melódicas del compás activo ---
    let chordProgression: string[] = [];
    let startRange = 0;
    let endRange = 16;

    if (selectedChordId) {
      const selectedIdx = chordBlocks.findIndex(b => b.id === selectedChordId);
      if (selectedIdx !== -1) {
        const selected = chordBlocks[selectedIdx];
        chordProgression = chordBlocks.slice(0, selectedIdx + 1).map(b => b.chord);
        startRange = selected.startBeat;
        endRange = selected.startBeat + selected.durationBeats;
      }
    } else {
      const currentMeasure = Math.floor(currentBeat / 4);
      startRange = currentMeasure * 4;
      endRange = startRange + 4;
      
      // Si el usuario no ha seleccionado nada, asumimos que quiere sugerencias
      // para continuar la canción desde el último acorde que exista.
      chordProgression = chordBlocks.map(b => b.chord);
    }

    const activeMelodyNotes = melodyNotes.filter(n => {
      const noteEnd = n.startBeat + n.durationBeats;
      return n.startBeat < endRange && noteEnd > startRange;
    });

    const uniquePitchClasses = Array.from(new Set(activeMelodyNotes.map(n => n.midi % 12)));
    const suggestions = getHarmonicSuggestions(key, scale, chordProgression, uniquePitchClasses);
    
    // Comparar con las sugerencias actuales para evitar actualizar si son idénticas
    const currentSuggestions = state.chordSuggestions;
    const isSame = currentSuggestions.length === suggestions.length &&
      currentSuggestions.every((s, i) => s.chord === suggestions[i].chord && s.probability === suggestions[i].probability);
    
    if (!isSame) {
      set({ chordSuggestions: suggestions });
    }
  },

  setGhostNotes: (ghostNotes) => set({ ghostNotes }),

  transposeSong: (semitones) => {
    set((state) => {
      const newNotes = state.melodyNotes.map(note => ({
        ...note,
        midi: note.midi + semitones,
        note: transposeNoteName(note.note, semitones)
      }));
      const newChords = state.chordBlocks.map(block => ({
        ...block,
        chord: transposeChordName(block.chord, semitones)
      }));
      const keyVal = NOTE_CLASSES.indexOf(state.key);
      const newKey = NOTE_CLASSES[(((keyVal + semitones) % 12) + 12) % 12] as NoteClass;
      if (newNotes.length > 0) toneEngine.playNotePreview(newNotes[0].note);
      return { melodyNotes: newNotes, chordBlocks: newChords, key: newKey };
    });
    get().updateSuggestions();
  },

  clearSong: () => set({
    chordBlocks: [],
    melodyNotes: [],
    drumChannels: DEFAULT_DRUM_CHANNELS,
    currentDrumPatternEdit: 0,
    selectedChordId: null,
    currentBeat: 0,
    isPlaying: false,
    detectedKey: null
  }),

  importSong: (session) => {
    toneEngine.stop();
    const loadedChannels = session.channels ? { ...DEFAULT_CHANNELS, ...session.channels } : get().channels;
    set({
      bpm: session.bpm,
      key: session.key,
      scale: session.scale,
      isAutoKey: session.isAutoKey ?? false,
      detectedKey: null,
      pattern: session.pattern,
      timeSignature: session.timeSignature,
      chordBlocks: session.chordBlocks,
      melodyNotes: session.melodyNotes,
      selectedChordId: null,
      currentBeat: 0,
      isPlaying: false,
      chordOctaveShift: session.chordOctaveShift ?? 0,
      channels: loadedChannels,
      ...(session.drumChannels && { drumChannels: session.drumChannels })
    });
    toneEngine.syncChannels(loadedChannels);
    get().updateSuggestions();
  }
}),
{
  partialize: (state) => ({
    bpm: state.bpm,
    key: state.key,
    scale: state.scale,
    chordBlocks: state.chordBlocks,
    melodyNotes: state.melodyNotes,
    timeSignature: state.timeSignature,
    pattern: state.pattern,
    chordOctaveShift: state.chordOctaveShift,
    synthSettings: state.synthSettings,
    channels: state.channels,
  }),
}
)
);

