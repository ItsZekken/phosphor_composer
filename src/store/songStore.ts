import { create } from 'zustand';
import { temporal } from 'zundo';
import type { NoteClass, ScaleType, ChordBlock, MelodyNote, GhostNote, ChordSuggestion, ActiveView } from '../utils/typeDefinitions';
import { getHarmonicSuggestions } from '../engine/harmonyEngine';
import { detectKey } from '../engine/keyDetector';
import { toneEngine } from '../audio/toneEngine';
import type { PatternDef } from '../patterns/patternTypes';
import { loadCustomPatterns, invalidatePatternCache } from '../patterns/patternLoader';

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
  selectedChordId: string | null;
  chordSuggestions: ChordSuggestion[];
  ghostNotes: GhostNote[];
  isLooping: boolean;
  isMetronomeActive: boolean;
  metroSubdivision: '4n' | '8n' | '16n';
  metroVolume: number;
  isAudioLoading: boolean;
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

  setBpm: (bpm: number) => void;
  setKey: (key: NoteClass) => void;
  setScale: (scale: ScaleType) => void;
  setIsAutoKey: (auto: boolean) => void;
  setPaletteMode: (mode: PaletteMode) => void;
  setActiveView: (view: ActiveView) => void;
  setPlaying: (isPlaying: boolean) => void;
  setCurrentBeat: (beat: number) => void;
  setLooping: (isLooping: boolean) => void;
  setMetronomeActive: (isActive: boolean) => void;
  setMetroSubdivision: (subdivision: '4n' | '8n' | '16n') => void;
  setMetroVolume: (volume: number) => void;
  setIsAudioLoading: (loading: boolean) => void;
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
  }) => void;
}

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
  selectedChordId: null,
  chordSuggestions: [],
  ghostNotes: [],
  isLooping: true,
  isMetronomeActive: false,
  metroSubdivision: '4n',
  metroVolume: 50,
  isAudioLoading: false,
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
  setLooping: (isLooping) => set({ isLooping }),
  setMetronomeActive: (isMetronomeActive) => set({ isMetronomeActive }),
  setMetroSubdivision: (metroSubdivision) => set({ metroSubdivision }),
  setMetroVolume: (metroVolume) => set({ metroVolume }),
  setIsAudioLoading: (isAudioLoading) => set({ isAudioLoading }),
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
    selectedChordId: null,
    currentBeat: 0,
    isPlaying: false,
    detectedKey: null
  }),

  importSong: (session) => {
    toneEngine.stop();
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
      chordOctaveShift: session.chordOctaveShift ?? 0
    });
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
  }),
}
)
);
