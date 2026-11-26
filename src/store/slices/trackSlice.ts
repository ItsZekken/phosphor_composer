import type { SliceCreator, TrackState, TrackActions } from '../types';
import type { MelodyNote, MelodyPattern, PianoRollTrack, ChannelConfig } from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';
import { PIANO_ROLL_COLOR_PALETTE } from '../../components/visualizer/hooks/useStageTimelineNotes';
import { ensureTrackPatterns } from '../../core/audio/arrangementResolver';

const DEFAULT_TRACK_ID = 'track_melody_1';
const DEFAULT_CHANNEL_ID = 'melody';
const DEFAULT_PATTERN_ID = 'pat_melody_1_1';

function syncTrackNotes(track: PianoRollTrack, nextNotes: MelodyNote[]): PianoRollTrack {
  const { patterns, activePatternId } = ensureTrackPatterns(track);
  const nextPatterns = patterns.map((p) =>
    p.id === activePatternId ? { ...p, notes: nextNotes } : p
  );
  return {
    ...track,
    notes: nextNotes,
    patterns: nextPatterns,
    activePatternId
  };
}

export const initialTrackState: TrackState = {
  tracks: [
    {
      id: DEFAULT_TRACK_ID,
      name: 'Melodía 1',
      channelId: DEFAULT_CHANNEL_ID,
      color: PIANO_ROLL_COLOR_PALETTE[0] || '#6880ad',
      notes: [],
      patterns: [
        {
          id: DEFAULT_PATTERN_ID,
          name: 'Patrón 1',
          notes: []
        }
      ],
      activePatternId: DEFAULT_PATTERN_ID,
      arrangementMode: 'direct',
      viewport: { scrollLeft: 0, scrollTop: 600, beatWidth: 40, rowHeight: 20 }
    }
  ],
  activeTrackId: DEFAULT_TRACK_ID,
  clipboardNotes: [],
  melodyNotes: [],
  pianoRollGridSnap: '1/4'
};

export const createTrackSlice: SliceCreator<TrackState & TrackActions> = (set, get) => ({
  ...initialTrackState,

  addPianoRollTrack: (name) => set((state) => {
    const trackNum = state.tracks.length + 1;
    const trackId = generateId('track');
    const channelId = `ch_${trackId}`;
    const trackName = name || `Melodía ${trackNum}`;
    const trackColor = PIANO_ROLL_COLOR_PALETTE[state.tracks.length % PIANO_ROLL_COLOR_PALETTE.length];
    const firstPatternId = generateId('mpat');

    const newChannel: ChannelConfig = {
      id: channelId,
      name: trackName,
      type: 'melody',
      instrument: 'synth',
      volume: 80,
      pan: 0,
      muted: false,
      solo: false,
      color: trackColor
    };

    const newTrack: PianoRollTrack = {
      id: trackId,
      name: trackName,
      channelId: channelId,
      color: trackColor,
      notes: [],
      patterns: [
        {
          id: firstPatternId,
          name: 'Patrón 1',
          notes: []
        }
      ],
      activePatternId: firstPatternId,
      arrangementMode: 'direct',
      viewport: { scrollLeft: 0, scrollTop: 600, beatWidth: 40, rowHeight: 20 }
    };

    const currentOrder = state.channelOrder || ['master', 'chords', 'melody', 'drums'];
    return {
      channels: { ...state.channels, [channelId]: newChannel },
      tracks: [...state.tracks, newTrack],
      channelOrder: [...currentOrder, channelId],
      activeTrackId: trackId,
      melodyNotes: []
    };
  }),

  removePianoRollTrack: (id) => set((state) => {
    if (state.tracks.length <= 1) return state;
    const track = state.tracks.find(t => t.id === id);
    const nextTracks = state.tracks.filter(t => t.id !== id);
    const nextActiveId = state.activeTrackId === id ? nextTracks[0].id : state.activeTrackId;
    const nextActiveTrack = nextTracks.find(t => t.id === nextActiveId) || nextTracks[0];
    const nextChannels = { ...state.channels };
    if (track) {
      delete nextChannels[track.channelId];
    }
    const currentOrder = state.channelOrder || Object.keys(state.channels || {});
    const nextChannelOrder = currentOrder.filter(chId => chId !== track?.channelId);

    const removedClipIds = new Set(
      (state.midiClips || [])
        .filter((c) => c.sourceType === 'melody' && c.melodyTrackId === id)
        .map((c) => c.id)
    );
    const nextMidiClips = removedClipIds.size > 0
      ? (state.midiClips || []).filter((c) => !removedClipIds.has(c.id))
      : state.midiClips;
    const nextSelectedMidiClipIds = removedClipIds.size > 0
      ? (state.selectedMidiClipIds || []).filter((cid) => !removedClipIds.has(cid))
      : state.selectedMidiClipIds;
    const nextSelectedPatternRef =
      state.selectedPatternRef?.sourceType === 'melody' && state.selectedPatternRef.melodyTrackId === id
        ? { sourceType: 'drums' as const, drumPatternIndex: state.currentDrumPatternEdit || 0 }
        : state.selectedPatternRef;

    return {
      tracks: nextTracks,
      activeTrackId: nextActiveId,
      melodyNotes: nextActiveTrack ? nextActiveTrack.notes : [],
      channels: nextChannels,
      channelOrder: nextChannelOrder,
      midiClips: nextMidiClips,
      selectedMidiClipIds: nextSelectedMidiClipIds,
      selectedPatternRef: nextSelectedPatternRef
    };
  }),

  renamePianoRollTrack: (id, name) => set((state) => {
    const track = state.tracks.find(t => t.id === id);
    if (!track) return state;
    const nextTracks = state.tracks.map(t => t.id === id ? { ...t, name } : t);
    const nextChannels = { ...state.channels };
    if (nextChannels[track.channelId]) {
      nextChannels[track.channelId] = { ...nextChannels[track.channelId], name };
    }
    return { tracks: nextTracks, channels: nextChannels };
  }),

  setTrackColor: (id, color) => set((state) => {
    const track = state.tracks.find(t => t.id === id);
    if (!track) return state;
    const nextTracks = state.tracks.map(t => t.id === id ? { ...t, color } : t);
    const nextChannels = { ...state.channels };
    if (nextChannels[track.channelId]) {
      nextChannels[track.channelId] = { ...nextChannels[track.channelId], color };
    }
    return { tracks: nextTracks, channels: nextChannels };
  }),

  setActiveTrackId: (id) => set((state) => {
    const activeTrack = state.tracks.find(t => t.id === id);
    if (!activeTrack) return { activeTrackId: id };
    const { activePattern } = ensureTrackPatterns(activeTrack);
    return {
      activeTrackId: id,
      melodyNotes: activePattern.notes
    };
  }),

  updateTrackViewport: (id, viewport) => set((state) => {
    const track = state.tracks.find(t => t.id === id);
    if (!track || !viewport) return state;
    const currentVp = track.viewport || {};
    const hasChange = Object.entries(viewport).some(([k, v]) => (currentVp as any)[k] !== v);
    if (!hasChange) return state;
    return {
      tracks: state.tracks.map(t => t.id === id ? { ...t, viewport: { ...t.viewport, ...viewport } } : t)
    };
  }),

  resetActiveTrackScroll: () => set((state) => ({
    tracks: state.tracks.map(t => t.id === state.activeTrackId ? { ...t, viewport: { ...t.viewport, scrollLeft: 0 } } : t)
  })),

  setTrackNotes: (trackId, notes) => set((state) => ({
    tracks: state.tracks.map(t => t.id === trackId ? syncTrackNotes(t, notes) : t),
    melodyNotes: state.activeTrackId === trackId ? notes : state.melodyNotes
  })),

  addMelodyNote: (noteData) => {
    const newNote: MelodyNote = { id: generateId('mn'), ...noteData };
    set((state) => {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const currentNotes = activeTrack ? activeTrack.notes : state.melodyNotes;
      const nextNotes = [...currentNotes, newNote];
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? syncTrackNotes(t, nextNotes) : t);
      return { melodyNotes: nextNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  updateMelodyNote: (id, updates) => {
    set((state) => {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const currentNotes = activeTrack ? activeTrack.notes : state.melodyNotes;
      const nextNotes = currentNotes.map(n => n.id === id ? { ...n, ...updates } : n);
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? syncTrackNotes(t, nextNotes) : t);
      return { melodyNotes: nextNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  removeMelodyNote: (id) => {
    set((state) => {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const currentNotes = activeTrack ? activeTrack.notes : state.melodyNotes;
      const nextNotes = currentNotes.filter(n => n.id !== id);
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? syncTrackNotes(t, nextNotes) : t);
      return { melodyNotes: nextNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setMelodyNotes: (melodyNotes) => {
    set((state) => {
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? syncTrackNotes(t, melodyNotes) : t);
      return { melodyNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setClipboardNotes: (notes) => set({ clipboardNotes: notes }),

  setPianoRollGridSnap: (pianoRollGridSnap) => set({ pianoRollGridSnap }),

  updateMelodyNotesBatch: (updates) => {
    if (!updates || updates.length === 0) return;
    const updateMap = new Map(updates.map(u => [u.id, u.changes]));
    set((state) => {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const currentNotes = activeTrack ? activeTrack.notes : state.melodyNotes;
      const nextNotes = currentNotes.map(n => {
        const changes = updateMap.get(n.id);
        return changes ? { ...n, ...changes } : n;
      });
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? syncTrackNotes(t, nextNotes) : t);
      return { melodyNotes: nextNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  removeMelodyNotesBatch: (ids) => {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    set((state) => {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const currentNotes = activeTrack ? activeTrack.notes : state.melodyNotes;
      const nextNotes = currentNotes.filter(n => !idSet.has(n.id));
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? syncTrackNotes(t, nextNotes) : t);
      return { melodyNotes: nextNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setActiveTrackPattern: (trackId, patternId) => set((state) => {
    const targetTrack = state.tracks.find((t) => t.id === trackId);
    if (!targetTrack) return state;
    const { patterns } = ensureTrackPatterns(targetTrack);
    const targetPattern = patterns.find((p) => p.id === patternId);
    if (!targetPattern) return state;

    const nextTracks = state.tracks.map((t) =>
      t.id === trackId
        ? { ...t, patterns, activePatternId: targetPattern.id, notes: targetPattern.notes }
        : t
    );

    return {
      tracks: nextTracks,
      ...(state.activeTrackId === trackId ? { melodyNotes: targetPattern.notes } : {})
    };
  }),

  addMelodyPattern: (trackId, name, lengthBeats) => {
    let createdId: string | null = null;
    set((state) => {
      const targetTrack = state.tracks.find((t) => t.id === trackId);
      if (!targetTrack) return state;
      const { patterns } = ensureTrackPatterns(targetTrack);
      const newId = generateId('mpat');
      createdId = newId;
      const newPattern: MelodyPattern = {
        id: newId,
        name: name?.trim() || `Patrón ${patterns.length + 1}`,
        notes: [],
        ...(typeof lengthBeats === 'number' && lengthBeats > 0 ? { lengthBeats } : {})
      };
      const nextPatterns = [...patterns, newPattern];
      const nextTracks = state.tracks.map((t) =>
        t.id === trackId
          ? { ...t, patterns: nextPatterns, activePatternId: newId, notes: [] }
          : t
      );
      return {
        tracks: nextTracks,
        ...(state.activeTrackId === trackId ? { melodyNotes: [] } : {})
      };
    });
    return createdId;
  },

  duplicateMelodyPattern: (trackId, patternId) => {
    let createdId: string | null = null;
    set((state) => {
      const targetTrack = state.tracks.find((t) => t.id === trackId);
      if (!targetTrack) return state;
      const { patterns } = ensureTrackPatterns(targetTrack);
      const source = patterns.find((p) => p.id === patternId) || patterns[0];
      if (!source) return state;

      const newId = generateId('mpat');
      createdId = newId;
      const clonedNotes: MelodyNote[] = (source.notes || []).map((n) => ({
        ...n,
        id: generateId('mn')
      }));
      const newPattern: MelodyPattern = {
        id: newId,
        name: `Patrón ${patterns.length + 1}`,
        notes: clonedNotes,
        ...(typeof source.lengthBeats === 'number' && source.lengthBeats > 0 ? { lengthBeats: source.lengthBeats } : {})
      };
      const nextPatterns = [...patterns, newPattern];
      const nextTracks = state.tracks.map((t) =>
        t.id === trackId
          ? { ...t, patterns: nextPatterns, activePatternId: newId, notes: clonedNotes }
          : t
      );
      return {
        tracks: nextTracks,
        ...(state.activeTrackId === trackId ? { melodyNotes: clonedNotes } : {})
      };
    });
    return createdId;
  },

  renameMelodyPattern: (trackId, patternId, name) => set((state) => {
    const trimmed = name.trim();
    if (!trimmed) return state;
    return {
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const { patterns, activePatternId } = ensureTrackPatterns(t);
        return {
          ...t,
          activePatternId,
          patterns: patterns.map((p) => (p.id === patternId ? { ...p, name: trimmed } : p))
        };
      })
    };
  }),

  setMelodyPatternLength: (trackId, patternId, lengthBeats) => set((state) => ({
    tracks: state.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const { patterns, activePatternId } = ensureTrackPatterns(t);
      return {
        ...t,
        activePatternId,
        patterns: patterns.map((p) => {
          if (p.id !== patternId) return p;
          if (typeof lengthBeats === 'number' && lengthBeats > 0) {
            return { ...p, lengthBeats };
          }
          const { lengthBeats: _removed, ...rest } = p;
          return rest;
        })
      };
    })
  })),

  clearMelodyPattern: (trackId, patternId) => set((state) => {
    let nextActiveMelodyNotes = state.melodyNotes;
    const nextTracks = state.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const { patterns, activePatternId } = ensureTrackPatterns(t);
      const nextPatterns = patterns.map((p) => (p.id === patternId ? { ...p, notes: [] } : p));
      const isClearingActive = activePatternId === patternId;
      if (isClearingActive && state.activeTrackId === trackId) {
        nextActiveMelodyNotes = [];
      }
      return {
        ...t,
        patterns: nextPatterns,
        activePatternId,
        notes: isClearingActive ? [] : t.notes
      };
    });
    return {
      tracks: nextTracks,
      melodyNotes: nextActiveMelodyNotes
    };
  }),

  removeMelodyPattern: (trackId, patternId) => set((state) => {
    const targetTrack = state.tracks.find((t) => t.id === trackId);
    if (!targetTrack) return state;
    const { patterns, activePatternId } = ensureTrackPatterns(targetTrack);
    if (patterns.length <= 1) return state;

    const removeIdx = patterns.findIndex((p) => p.id === patternId);
    if (removeIdx < 0) return state;

    const nextPatterns = patterns.filter((p) => p.id !== patternId);
    const nextActivePattern =
      activePatternId === patternId
        ? nextPatterns[Math.max(0, removeIdx - 1)] || nextPatterns[0]
        : nextPatterns.find((p) => p.id === activePatternId) || nextPatterns[0];

    const nextTracks = state.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            patterns: nextPatterns,
            activePatternId: nextActivePattern.id,
            notes: nextActivePattern.notes
          }
        : t
    );

    const removedClipIds = new Set(
      (state.midiClips || [])
        .filter(
          (c) =>
            c.sourceType === 'melody' &&
            c.melodyTrackId === trackId &&
            c.melodyPatternId === patternId
        )
        .map((c) => c.id)
    );

    const nextMidiClips = removedClipIds.size > 0
      ? (state.midiClips || []).filter((c) => !removedClipIds.has(c.id))
      : state.midiClips;
    const nextSelectedMidiClipIds = removedClipIds.size > 0
      ? (state.selectedMidiClipIds || []).filter((cid) => !removedClipIds.has(cid))
      : state.selectedMidiClipIds;
    const nextSelectedPatternRef =
      state.selectedPatternRef?.sourceType === 'melody' &&
      state.selectedPatternRef.melodyTrackId === trackId &&
      state.selectedPatternRef.melodyPatternId === patternId
        ? { sourceType: 'melody' as const, melodyTrackId: trackId, melodyPatternId: nextActivePattern.id }
        : state.selectedPatternRef;

    return {
      tracks: nextTracks,
      ...(state.activeTrackId === trackId ? { melodyNotes: nextActivePattern.notes } : {}),
      midiClips: nextMidiClips,
      selectedMidiClipIds: nextSelectedMidiClipIds,
      selectedPatternRef: nextSelectedPatternRef
    };
  }),

  setTrackArrangementMode: (trackId, mode) => set((state) => ({
    tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, arrangementMode: mode } : t))
  }))
});
