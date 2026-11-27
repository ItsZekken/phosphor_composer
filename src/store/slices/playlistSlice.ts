/**
 * playlistSlice.ts
 * Slice de coordinación UI / selección / edición 1:1 para la vista unificada de TRACKS.
 * NO duplica datos musicales: toda edición muta directamente las fuentes únicas de verdad:
 * - Armonía -> `chordBlocks` (Chord Palette)
 * - Melodías -> `tracks[i].notes` + `tracks[i].regions` (Piano Roll)
 * - Batería -> `patternChain` (Drum Sequencer)
 * - Audio -> `audioTracks` + `audioClips`
 */

import type { StateCreator } from 'zustand';
import type { SongStore } from '../types';
import type {
  AudioClip,
  MelodyRegionClipboardItem,
  PlaylistTool,
  PlaylistTrackSelection,
  SelectedMelodyRegionRef
} from '../../utils/typeDefinitions';
import { getBeatsPerMeasure } from '../../core/audio/arrangementResolver';
import {
  deleteMelodyRegions,
  duplicateMelodyRegions,
  extractMelodyRegionClipboard,
  pasteMelodyRegions,
  reconcileTrackRegions,
  repeatMelodyRegionOnce,
  splitRegionInTrack,
  toggleMuteMelodyRegions
} from '../../core/audio/melodyRegionUtils';

export interface PlaylistState {
  playlistTool: PlaylistTool;
  isPickerOpen: boolean;
  pickerTab: 'palette' | 'audio';
  selectedPlaylistTrack: PlaylistTrackSelection;
  selectedHarmonyBrushChord: string;
  selectedMelodyRegionRefs: SelectedMelodyRegionRef[];
  melodyRegionClipboard: MelodyRegionClipboardItem[];
  audioClipClipboard: AudioClip[];
}

export interface PlaylistActions {
  setPlaylistTool: (tool: PlaylistTool) => void;
  setIsPickerOpen: (open: boolean) => void;
  setPickerTab: (tab: 'palette' | 'audio') => void;
  setSelectedPlaylistTrack: (sel: PlaylistTrackSelection) => void;
  setSelectedHarmonyBrushChord: (chord: string) => void;
  selectMelodyRegion: (trackId: string, regionId: string, multi?: boolean) => void;
  setSelectedMelodyRegionRefs: (refs: SelectedMelodyRegionRef[]) => void;
  clearAllPlaylistSelections: () => void;
  splitMelodyRegion: (trackId: string, regionId: string, splitBeat: number) => void;
  repeatMelodyRegion: (trackId: string, regionId: string) => void;
  duplicateSelectedMelodyRegions: (customSpanBeats?: number) => SelectedMelodyRegionRef[];
  deleteSelectedMelodyRegions: () => void;
  toggleMuteSelectedMelodyRegions: () => void;
  copySelectedMelodyRegions: () => void;
  pasteMelodyRegionsAt: (targetBeat?: number) => void;
  jumpToHarmonyEditor: (chordId?: string) => void;
  jumpToMelodyEditor: (trackId: string, beat?: number) => void;
  jumpToDrumEditor: (patternIndex?: number) => void;
}

export const initialPlaylistState: PlaylistState = {
  playlistTool: 'paint',
  isPickerOpen: true,
  pickerTab: 'palette',
  selectedPlaylistTrack: { kind: 'harmony' },
  selectedHarmonyBrushChord: 'C',
  selectedMelodyRegionRefs: [],
  melodyRegionClipboard: [],
  audioClipClipboard: []
};

export const createPlaylistSlice: StateCreator<
  SongStore,
  [],
  [],
  PlaylistState & PlaylistActions
> = (set, get) => ({
  ...initialPlaylistState,

  setPlaylistTool: (playlistTool) => set({ playlistTool }),

  setIsPickerOpen: (isPickerOpen) => set({ isPickerOpen }),

  setPickerTab: (pickerTab) => set({ pickerTab }),

  setSelectedPlaylistTrack: (selectedPlaylistTrack) =>
    set((state) => ({
      selectedPlaylistTrack,
      ...(selectedPlaylistTrack.kind === 'audio'
        ? { selectedTrackId: selectedPlaylistTrack.trackId }
        : selectedPlaylistTrack.kind === 'melody'
        ? {
            activeTrackId: selectedPlaylistTrack.trackId,
            melodyNotes:
              state.tracks.find((t) => t.id === selectedPlaylistTrack.trackId)?.notes ||
              state.melodyNotes
          }
        : {})
    })),

  setSelectedHarmonyBrushChord: (selectedHarmonyBrushChord) => set({ selectedHarmonyBrushChord }),

  selectMelodyRegion: (trackId, regionId, multi = false) =>
    set((state) => {
      if (multi) {
        const exists = state.selectedMelodyRegionRefs.some(
          (r) => r.trackId === trackId && r.regionId === regionId
        );
        return {
          selectedMelodyRegionRefs: exists
            ? state.selectedMelodyRegionRefs.filter(
                (r) => !(r.trackId === trackId && r.regionId === regionId)
              )
            : [...state.selectedMelodyRegionRefs, { trackId, regionId }]
        };
      }
      return {
        selectedMelodyRegionRefs: [{ trackId, regionId }],
        selectedChordIds: [],
        selectedChordId: null,
        selectedChainIds: [],
        selectedClipIds: []
      };
    }),

  setSelectedMelodyRegionRefs: (selectedMelodyRegionRefs) => set({ selectedMelodyRegionRefs }),

  clearAllPlaylistSelections: () =>
    set({
      selectedChordIds: [],
      selectedChordId: null,
      selectedMelodyRegionRefs: [],
      selectedChainIds: [],
      selectedClipIds: []
    }),

  splitMelodyRegion: (trackId, regionId, splitBeat) => {
    const state = get();
    const targetTrack = state.tracks.find((t) => t.id === trackId);
    if (!targetTrack) return;
    const barBeats = getBeatsPerMeasure(state.timeSignature);
    const res = splitRegionInTrack(targetTrack, regionId, splitBeat, barBeats);
    if (!res) return;

    const nextTracks = state.tracks.map((t) =>
      t.id === trackId ? { ...t, notes: res.notes, regions: res.regions } : t
    );
    const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);

    set({
      tracks: nextTracks,
      melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
      selectedMelodyRegionRefs: res.rightRegionId
        ? [{ trackId, regionId: res.rightRegionId }]
        : [{ trackId, regionId: res.leftRegionId }]
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  repeatMelodyRegion: (trackId, regionId) => {
    const state = get();
    const targetTrack = state.tracks.find((t) => t.id === trackId);
    if (!targetTrack) return;
    const barBeats = getBeatsPerMeasure(state.timeSignature);
    const res = repeatMelodyRegionOnce(targetTrack, regionId, barBeats);
    if (!res) return;

    const nextTracks = state.tracks.map((t) =>
      t.id === trackId ? { ...t, notes: res.notes, regions: res.regions } : t
    );
    const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);

    set({
      tracks: nextTracks,
      melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
      selectedMelodyRegionRefs: [{ trackId, regionId: res.regionId }]
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  duplicateSelectedMelodyRegions: (customSpanBeats) => {
    const state = get();
    if (state.selectedMelodyRegionRefs.length === 0) return [];
    const barBeats = getBeatsPerMeasure(state.timeSignature);
    const { tracks: nextTracks, nextSelectedRefs } = duplicateMelodyRegions(
      state.tracks,
      state.selectedMelodyRegionRefs,
      barBeats,
      customSpanBeats
    );
    const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);
    set({
      tracks: nextTracks,
      melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
      selectedMelodyRegionRefs: nextSelectedRefs
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
    return nextSelectedRefs;
  },

  deleteSelectedMelodyRegions: () => {
    const state = get();
    if (state.selectedMelodyRegionRefs.length === 0) return;
    const barBeats = getBeatsPerMeasure(state.timeSignature);
    const nextTracks = deleteMelodyRegions(state.tracks, state.selectedMelodyRegionRefs, barBeats);
    const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);
    set({
      tracks: nextTracks,
      melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
      selectedMelodyRegionRefs: []
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  toggleMuteSelectedMelodyRegions: () => {
    const state = get();
    if (state.selectedMelodyRegionRefs.length === 0) return;
    const barBeats = getBeatsPerMeasure(state.timeSignature);
    const nextTracks = toggleMuteMelodyRegions(
      state.tracks,
      state.selectedMelodyRegionRefs,
      barBeats
    );
    const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);
    set({
      tracks: nextTracks,
      melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes
    });
  },

  copySelectedMelodyRegions: () => {
    const state = get();
    if (state.selectedMelodyRegionRefs.length === 0) return;
    const barBeats = getBeatsPerMeasure(state.timeSignature);
    const items = extractMelodyRegionClipboard(
      state.tracks,
      state.selectedMelodyRegionRefs,
      barBeats
    );
    set({ melodyRegionClipboard: items });
  },

  pasteMelodyRegionsAt: (targetBeat) => {
    const state = get();
    if (!state.melodyRegionClipboard || state.melodyRegionClipboard.length === 0) return;
    const barBeats = getBeatsPerMeasure(state.timeSignature);
    const baseBeat =
      typeof targetBeat === 'number'
        ? Math.max(0, targetBeat)
        : Math.max(0, Math.round((state.currentBeat || 0) * 4) / 4);

    const fallbackTrackId =
      state.selectedPlaylistTrack.kind === 'melody'
        ? state.selectedPlaylistTrack.trackId
        : state.activeTrackId;

    const { tracks: nextTracks, nextSelectedRefs } = pasteMelodyRegions(
      state.tracks,
      state.melodyRegionClipboard,
      baseBeat,
      fallbackTrackId,
      barBeats
    );
    const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);
    set({
      tracks: nextTracks,
      melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
      selectedMelodyRegionRefs: nextSelectedRefs
    });
    if (get().isAutoSuggestions) get().updateSuggestions();
  },

  jumpToHarmonyEditor: (chordId) => {
    const state = get();
    if (chordId) {
      state.setSelectedChordId(chordId);
    }
    state.setActiveView('chord');
  },

  jumpToMelodyEditor: (trackId, beat) => {
    const state = get();
    state.setActiveTrackId(trackId);
    if (typeof beat === 'number' && !Number.isNaN(beat)) {
      const targetTrack = state.tracks.find((t) => t.id === trackId);
      const bw = targetTrack?.viewport?.beatWidth || 80;
      const targetScroll = Math.max(0, Math.floor(beat * bw - 48));
      state.updateTrackViewport(trackId, { scrollLeft: targetScroll });
      state.setCurrentBeat(Math.max(0, beat));
    }
    state.setActiveView('piano-roll');
  },

  jumpToDrumEditor: (patternIndex) => {
    const state = get();
    if (typeof patternIndex === 'number' && patternIndex >= 0) {
      state.setCurrentDrumPatternEdit(patternIndex);
    }
    state.setActiveView('sequencer');
  }
});

export { reconcileTrackRegions };
