import type { SliceCreator, TransportState, TransportActions } from '../types';

export const initialTransportState: TransportState = {
  bpm: 120,
  liveBpm: 120,
  tempoMarkers: [],
  key: 'C',
  scale: 'major',
  isAutoKey: true,
  detectedKey: null,
  timeSignature: '4/4',
  isPlaying: false,
  currentBeat: 0,
  playbackStep: 0,
  isLooping: true,
  isMetronomeActive: false,
  metroSubdivision: '4n',
  metroVolume: 50,
  swing: 0,
  sustain: false,
  isAudioLoading: false,
  isEngineReady: false,
  isExporting: false,
  exportProgress: 0,
};

export const createTransportSlice: SliceCreator<TransportState & TransportActions> = (set, get) => ({
  ...initialTransportState,

  setBpm: (bpm) => set((state) => ({ bpm, liveBpm: state.isPlaying ? state.liveBpm : bpm })),
  setLiveBpm: (liveBpm) => set({ liveBpm }),

  addTempoMarker: (marker) => set((state) => ({
    tempoMarkers: [...state.tempoMarkers.filter(m => m.id !== marker.id), marker]
      .sort((a, b) => a.beat - b.beat)
  })),

  removeTempoMarker: (id) => set((state) => ({
    tempoMarkers: state.tempoMarkers.filter((m) => m.id !== id)
  })),

  updateTempoMarker: (id, updates) => set((state) => ({
    tempoMarkers: state.tempoMarkers
      .map((m) => (m.id === id ? { ...m, ...updates } : m))
      .sort((a, b) => a.beat - b.beat)
  })),

  setTempoMarkers: (tempoMarkers) => set({
    tempoMarkers: [...tempoMarkers].sort((a, b) => a.beat - b.beat)
  }),

  setKey: (key) => {
    set({ key, isAutoKey: false });
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

  setTimeSignature: (timeSignature) => set({ timeSignature }),

  setPlaying: (isPlaying) => set((state) => {
    if (!isPlaying) {
      return {
        isPlaying: false,
        isLiveFollowLocked: false,
        currentDrumPatternEdit: state.userDrumPatternEdit,
        playbackStep: -1
      };
    } else {
      return {
        isPlaying: true,
        isLiveFollowLocked: false,
        userDrumPatternEdit: state.currentDrumPatternEdit
      };
    }
  }),

  setCurrentBeat: (currentBeat) => {
    const oldBeat = get().currentBeat;
    set({ currentBeat });
    if (get().isPlaying) return;
    if (!get().selectedChordId) {
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
  setSwing: (swing) => set({ swing }),
  setSustain: (sustain) => set({ sustain }),
  setIsAudioLoading: (isAudioLoading) => set({ isAudioLoading }),
  setIsEngineReady: (isEngineReady) => set({ isEngineReady }),
  setIsExporting: (isExporting) => set({ isExporting }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
});
