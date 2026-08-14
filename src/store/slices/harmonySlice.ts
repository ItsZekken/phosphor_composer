import type { SliceCreator, HarmonyState, HarmonyActions } from '../types';
import type { ChordBlock } from '../../utils/typeDefinitions';
import { getHarmonicSuggestions, detectKey } from '../../core/music';
import { loadCustomPatterns, invalidatePatternCache } from '../../patterns/patternLoader';
import { generateId } from '../../utils/idGenerator';

export const initialHarmonyState: HarmonyState = {
  chordBlocks: [],
  selectedChordId: null,
  chordSuggestions: [],
  ghostNotes: [],
  paletteMode: 'matrix',
  pattern: 'hold',
  customPatterns: [],
  chordOctaveShift: 0,
  styleMarkers: [],
  isAutoSuggestions: false,
  draggingChord: null,
  draggingStyle: null,
};

export const createHarmonySlice: SliceCreator<HarmonyState & HarmonyActions> = (set, get) => ({
  ...initialHarmonyState,

  setPaletteMode: (paletteMode) => set({ paletteMode }),
  setPattern: (pattern) => set({ pattern }),
  setCustomPatterns: (customPatterns) => set({ customPatterns }),
  setChordOctaveShift: (chordOctaveShift) => set({ chordOctaveShift }),
  setGhostNotes: (ghostNotes) => set({ ghostNotes }),
  setAutoSuggestions: (isAutoSuggestions) => set({ isAutoSuggestions }),
  setDraggingChord: (draggingChord) => set({ draggingChord }),
  setDraggingStyle: (draggingStyle) => set({ draggingStyle }),

  addChordBlock: (chord, startBeat, durationBeats = 4) => {
    const newBlock: ChordBlock = {
      id: generateId('cb'),
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

  addStyleMarker: (marker) => set((state) => ({
    styleMarkers: [...state.styleMarkers.filter(m => m.beat !== marker.beat), marker].sort((a, b) => a.beat - b.beat)
  })),

  removeStyleMarker: (id) => set((state) => ({
    styleMarkers: state.styleMarkers.filter(m => m.id !== id)
  })),

  updateStyleMarker: (id, updates) => set((state) => ({
    styleMarkers: state.styleMarkers.map(m => m.id === id ? { ...m, ...updates } : m)
  })),

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

  updateSuggestions: () => {
    const state = get();
    const { chordBlocks, tracks, activeTrackId, selectedChordId, currentBeat } = state;
    let { key, scale } = state;

    // --- Auto-detección de tonalidad ---
    if (state.isAutoKey && chordBlocks.length > 0) {
      const chordNames = chordBlocks.map(b => b.chord);
      const detected = detectKey(chordNames);
      if (detected) {
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

    // --- Extraer notas melódicas del compás activo desde la fuente única (tracks) ---
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
      chordProgression = chordBlocks.map(b => b.chord);
    }

    const currentTrack = tracks.find(t => t.id === activeTrackId) || tracks[0];
    const trackNotes = currentTrack ? currentTrack.notes : [];

    const activeMelodyNotes = trackNotes.filter(n => {
      const noteEnd = n.startBeat + n.durationBeats;
      return n.startBeat < endRange && noteEnd > startRange;
    });

    const uniquePitchClasses = Array.from(new Set(activeMelodyNotes.map(n => n.midi % 12)));
    const suggestions = getHarmonicSuggestions(key, scale, chordProgression, uniquePitchClasses);

    const currentSuggestions = state.chordSuggestions;
    const isSame = currentSuggestions.length === suggestions.length &&
      currentSuggestions.every((s, i) => s.chord === suggestions[i].chord && s.probability === suggestions[i].probability);

    if (!isSame) {
      set({ chordSuggestions: suggestions });
    }
  },
});
