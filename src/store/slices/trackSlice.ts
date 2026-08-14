import type { SliceCreator, TrackState, TrackActions } from '../types';
import type { MelodyNote, PianoRollTrack, ChannelConfig } from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';

const DEFAULT_TRACK_ID = 'track_melody_1';
const DEFAULT_CHANNEL_ID = 'melody';

export const initialTrackState: TrackState = {
  tracks: [
    {
      id: DEFAULT_TRACK_ID,
      name: 'Melodía 1',
      channelId: DEFAULT_CHANNEL_ID,
      color: '#ff00aa',
      notes: [],
      viewport: { scrollLeft: 0, scrollTop: 600, beatWidth: 40, rowHeight: 20 }
    }
  ],
  activeTrackId: DEFAULT_TRACK_ID,
  clipboardNotes: [],
  melodyNotes: []
};

export const createTrackSlice: SliceCreator<TrackState & TrackActions> = (set, get) => ({
  ...initialTrackState,

  addPianoRollTrack: (name) => set((state) => {
    const trackNum = state.tracks.length + 1;
    const trackId = generateId('track');
    const channelId = `ch_${trackId}`;
    const trackName = name || `Melodía ${trackNum}`;
    const trackColor = ['#00e5ff', '#ff00aa', '#a855f7', '#ffaa00', '#00ffcc', '#ff3366'][state.tracks.length % 6];

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
    return {
      tracks: nextTracks,
      activeTrackId: nextActiveId,
      melodyNotes: nextActiveTrack ? nextActiveTrack.notes : [],
      channels: nextChannels,
      channelOrder: nextChannelOrder
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

  setActiveTrackId: (id) => set((state) => {
    const activeTrack = state.tracks.find(t => t.id === id);
    return {
      activeTrackId: id,
      melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes
    };
  }),

  updateTrackViewport: (id, viewport) => set((state) => ({
    tracks: state.tracks.map(t => t.id === id ? { ...t, viewport: { ...t.viewport, ...viewport } } : t)
  })),

  setTrackNotes: (trackId, notes) => set((state) => ({
    tracks: state.tracks.map(t => t.id === trackId ? { ...t, notes } : t),
    melodyNotes: state.activeTrackId === trackId ? notes : state.melodyNotes
  })),

  addMelodyNote: (noteData) => {
    const newNote: MelodyNote = { id: generateId('mn'), ...noteData };
    set((state) => {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const currentNotes = activeTrack ? activeTrack.notes : state.melodyNotes;
      const nextNotes = [...currentNotes, newNote];
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? { ...t, notes: nextNotes } : t);
      return { melodyNotes: nextNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  updateMelodyNote: (id, updates) => {
    set((state) => {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const currentNotes = activeTrack ? activeTrack.notes : state.melodyNotes;
      const nextNotes = currentNotes.map(n => n.id === id ? { ...n, ...updates } : n);
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? { ...t, notes: nextNotes } : t);
      return { melodyNotes: nextNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  removeMelodyNote: (id) => {
    set((state) => {
      const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
      const currentNotes = activeTrack ? activeTrack.notes : state.melodyNotes;
      const nextNotes = currentNotes.filter(n => n.id !== id);
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? { ...t, notes: nextNotes } : t);
      return { melodyNotes: nextNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setMelodyNotes: (melodyNotes) => {
    set((state) => {
      const nextTracks = state.tracks.map(t => t.id === state.activeTrackId ? { ...t, notes: melodyNotes } : t);
      return { melodyNotes, tracks: nextTracks };
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  setClipboardNotes: (notes) => set({ clipboardNotes: notes }),
});
