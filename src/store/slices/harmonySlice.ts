import type { SliceCreator, HarmonyState, HarmonyActions } from '../types';
import type { ChordBlock, NoteClass } from '../../utils/typeDefinitions';
import { getHarmonicSuggestions, detectKey } from '../../core/music';
import { loadCustomPatterns, invalidatePatternCache, getDefaultCustomPatterns } from '../../patterns/patternLoader';
import { generateId } from '../../utils/idGenerator';

export const initialHarmonyState: HarmonyState = {
  chordBlocks: [],
  selectedChordId: null,
  selectedChordIds: [],
  chordGridSnap: '1',
  chordClipboard: [],
  chordTimelineViewport: { scrollLeft: 0, zoomLevel: 1.0 },
  chordSuggestions: [],
  ghostNotes: [],
  paletteMode: 'matrix',
  matrixMode: 'diatonic',
  pattern: 'hold',
  customPatterns: getDefaultCustomPatterns(),
  chordOctaveShift: 0,
  styleMarkers: [],
  isAutoSuggestions: false,
  draggingChord: null,
  draggingStyle: null,
};

export const createHarmonySlice: SliceCreator<HarmonyState & HarmonyActions> = (set, get) => ({
  ...initialHarmonyState,

  setPaletteMode: (paletteMode) => set({ paletteMode }),
  setMatrixMode: (matrixMode) => set({ matrixMode }),
  setPattern: (pattern) => set({ pattern }),
  setCustomPatterns: (customPatterns) => set({ customPatterns }),
  setChordOctaveShift: (chordOctaveShift) => set({ chordOctaveShift }),
  setGhostNotes: (ghostNotes) => set({ ghostNotes }),
  setAutoSuggestions: (isAutoSuggestions) => set({ isAutoSuggestions }),
  setDraggingChord: (draggingChord) => set({ draggingChord }),
  setDraggingStyle: (draggingStyle) => set({ draggingStyle }),
  setChordGridSnap: (chordGridSnap) => set({ chordGridSnap }),

  setChordTimelineViewport: (viewport) => set((state) => ({
    chordTimelineViewport: { ...state.chordTimelineViewport, ...viewport }
  })),

  resetChordTimelineScroll: () => set((state) => ({
    chordTimelineViewport: { ...state.chordTimelineViewport, scrollLeft: 0 }
  })),

  addChordBlock: (chord, startBeat, durationBeats = 4) => {
    const newBlock: ChordBlock = {
      id: generateId('cb'),
      chord,
      startBeat,
      durationBeats
    };
    set((state) => {
      const filtered = state.chordBlocks.filter(b => b.startBeat !== startBeat);
      return {
        chordBlocks: [...filtered, newBlock].sort((a, b) => a.startBeat - b.startBeat),
        selectedChordId: newBlock.id,
        selectedChordIds: [newBlock.id]
      };
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
      selectedChordId: state.selectedChordId === id ? null : state.selectedChordId,
      selectedChordIds: state.selectedChordIds.filter(selectedId => selectedId !== id)
    }));
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setSelectedChordId: (selectedChordId) => {
    set({
      selectedChordId,
      selectedChordIds: selectedChordId ? [selectedChordId] : []
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setSelectedChordIds: (selectedChordIds) => {
    set({
      selectedChordIds,
      selectedChordId: selectedChordIds[0] || null
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  toggleSelectChordId: (id, multi = false) => {
    set((state) => {
      if (!multi) {
        return {
          selectedChordId: id,
          selectedChordIds: id ? [id] : []
        };
      }
      const exists = state.selectedChordIds.includes(id);
      const nextIds = exists
        ? state.selectedChordIds.filter(i => i !== id)
        : [...state.selectedChordIds, id];
      return {
        selectedChordIds: nextIds,
        selectedChordId: nextIds[0] || null
      };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  selectAllChords: () => {
    set((state) => ({
      selectedChordIds: state.chordBlocks.map(b => b.id),
      selectedChordId: state.chordBlocks[0]?.id || null
    }));
  },

  copySelectedChords: () => {
    const { chordBlocks, selectedChordIds } = get();
    if (selectedChordIds.length === 0) return;
    const selected = chordBlocks.filter(b => selectedChordIds.includes(b.id));
    if (selected.length === 0) return;
    set({ chordClipboard: JSON.parse(JSON.stringify(selected)) });
  },

  cutSelectedChords: () => {
    const { chordBlocks, selectedChordIds } = get();
    if (selectedChordIds.length === 0) return;
    const selected = chordBlocks.filter(b => selectedChordIds.includes(b.id));
    if (selected.length === 0) return;
    set((state) => ({
      chordClipboard: JSON.parse(JSON.stringify(selected)),
      chordBlocks: state.chordBlocks.filter(b => !selectedChordIds.includes(b.id)),
      selectedChordId: null,
      selectedChordIds: []
    }));
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  pasteChords: (targetBeat) => {
    const { chordClipboard, chordBlocks } = get();
    if (!chordClipboard || chordClipboard.length === 0) return;

    // Determinar beat base de pegado
    const baseBeat = targetBeat !== undefined
      ? targetBeat
      : get().currentBeat || 0;

    const sortedClipboard = [...chordClipboard].sort((a, b) => a.startBeat - b.startBeat);
    const minStart = sortedClipboard[0].startBeat;

    const newBlocks: ChordBlock[] = sortedClipboard.map((b) => {
      const offset = b.startBeat - minStart;
      return {
        ...b,
        id: generateId('cb'),
        startBeat: baseBeat + offset
      };
    });

    const newIds = newBlocks.map(b => b.id);
    const newStartBeats = new Set(newBlocks.map(b => b.startBeat));

    set({
      chordBlocks: [
        ...chordBlocks.filter(b => !newStartBeats.has(b.startBeat)),
        ...newBlocks
      ].sort((a, b) => a.startBeat - b.startBeat),
      selectedChordIds: newIds,
      selectedChordId: newIds[0] || null
    });

    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  duplicateSelectedChords: () => {
    const { chordBlocks, selectedChordIds } = get();
    if (selectedChordIds.length === 0) return;
    const selected = chordBlocks.filter(b => selectedChordIds.includes(b.id));
    if (selected.length === 0) return;

    const sortedSelected = [...selected].sort((a, b) => a.startBeat - b.startBeat);
    const minStart = sortedSelected[0].startBeat;
    const maxEnd = sortedSelected.reduce((max, b) => Math.max(max, b.startBeat + b.durationBeats), 0);
    const totalSpan = maxEnd - minStart;

    const duplicatedBlocks: ChordBlock[] = sortedSelected.map((b) => ({
      ...b,
      id: generateId('cb'),
      startBeat: b.startBeat + totalSpan
    }));

    const newIds = duplicatedBlocks.map(b => b.id);
    const newStartBeats = new Set(duplicatedBlocks.map(b => b.startBeat));

    set({
      chordBlocks: [
        ...chordBlocks.filter(b => !newStartBeats.has(b.startBeat)),
        ...duplicatedBlocks
      ].sort((a, b) => a.startBeat - b.startBeat),
      selectedChordIds: newIds,
      selectedChordId: newIds[0] || null
    });

    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  deleteSelectedChords: () => {
    const { selectedChordIds } = get();
    if (selectedChordIds.length === 0) return;
    set((state) => ({
      chordBlocks: state.chordBlocks.filter(b => !selectedChordIds.includes(b.id)),
      selectedChordId: null,
      selectedChordIds: []
    }));
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  moveSelectedChords: (deltaBeats) => {
    if (deltaBeats === 0) return;
    const { selectedChordIds, chordBlocks } = get();
    if (selectedChordIds.length === 0) return;

    const selected = chordBlocks.filter(b => selectedChordIds.includes(b.id));
    const minStart = selected.reduce((min, b) => Math.min(min, b.startBeat), Infinity);
    const safeDelta = Math.max(-minStart, deltaBeats);

    set((state) => ({
      chordBlocks: state.chordBlocks.map((b) => {
        if (!state.selectedChordIds.includes(b.id)) return b;
        return {
          ...b,
          startBeat: Math.max(0, b.startBeat + safeDelta)
        };
      }).sort((a, b) => a.startBeat - b.startBeat)
    }));

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

    if (chordBlocks.length === 0) {
      set({ chordSuggestions: [], ghostNotes: [] });
      return;
    }

    const currentBlock = selectedChordId
      ? chordBlocks.find((b) => b.id === selectedChordId)
      : chordBlocks.find(
          (b) => currentBeat >= b.startBeat && currentBeat < b.startBeat + b.durationBeats
        ) || chordBlocks[chordBlocks.length - 1];

    if (!currentBlock) {
      set({ chordSuggestions: [] });
      return;
    }

    const effectiveKey = (state.key || detectKey(chordBlocks.map((b) => b.chord))) as NoteClass;
    const suggestions = getHarmonicSuggestions(
      effectiveKey,
      state.scale,
      chordBlocks.map((b) => b.chord)
    );

    const activeTrack = tracks.find((t) => t.id === activeTrackId);
    const activeMelodyNotes = activeTrack ? activeTrack.notes : [];

    const activeNotesAtTime = activeMelodyNotes.filter(
      (n) => n.startBeat >= currentBlock.startBeat && n.startBeat < currentBlock.startBeat + currentBlock.durationBeats
    );

    const ghostNotes = activeNotesAtTime.map((n) => ({
      id: n.id,
      note: n.note,
      midi: n.midi,
      startBeat: n.startBeat,
      durationBeats: n.durationBeats
    }));

    set({ chordSuggestions: suggestions, ghostNotes });
  }
});
