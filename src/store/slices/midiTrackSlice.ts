/**
 * midiTrackSlice.ts
 * Slice de Zustand para la estación de MIDI Tracks / Playlist de Patrones estilo FL Studio.
 * Permite secuenciar patrones de Drum Machine y de cada Melodía (Piano Roll) en carriles multipista.
 */

import type { StateCreator } from 'zustand';
import type { SongStore } from '../types';
import {
  normalizePatternChainToLinear,
  type MidiTrack,
  type MidiPatternClip,
  type SelectedPatternRef,
  type PlaylistTool
} from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';
import { getBeatsPerMeasure } from '../../core/audio/arrangementResolver';

export const MIDI_TRACK_COLORS = [
  '#2dd4bf', // Turquesa Phosphor
  '#a78bfa', // Violeta Neón
  '#60a5fa', // Azul Cielo
  '#5a9e7a', // Verde Salvia
  '#c45d9c', // Magenta
  '#e5a93c'  // Ámbar
];

export const DEFAULT_MIDI_TRACKS: MidiTrack[] = [
  {
    id: 'midi_track_1',
    name: 'Track 1',
    color: MIDI_TRACK_COLORS[0],
    muted: false,
    solo: false
  },
  {
    id: 'midi_track_2',
    name: 'Track 2',
    color: MIDI_TRACK_COLORS[1],
    muted: false,
    solo: false
  },
  {
    id: 'midi_track_3',
    name: 'Track 3',
    color: MIDI_TRACK_COLORS[2],
    muted: false,
    solo: false
  }
];

export interface MidiTrackState {
  midiTracks: MidiTrack[];
  midiClips: MidiPatternClip[];
  selectedMidiClipIds: string[];
  selectedMidiTrackId: string | null;
  selectedPlaylistTrackKind: 'midi' | 'audio';
  selectedPatternRef: SelectedPatternRef;
  playlistTool: PlaylistTool;
  isPickerOpen: boolean;
  pickerTab: 'patterns' | 'audio';
  midiClipClipboard: MidiPatternClip[];
}

export interface MidiTrackActions {
  addMidiTrack: (name?: string, color?: string) => string;
  removeMidiTrack: (id: string) => void;
  updateMidiTrack: (id: string, updates: Partial<MidiTrack>) => void;
  setSelectedMidiTrackId: (id: string | null) => void;
  setSelectedPlaylistTrackKind: (kind: 'midi' | 'audio') => void;
  setSelectedPatternRef: (ref: SelectedPatternRef) => void;
  setPlaylistTool: (tool: PlaylistTool) => void;
  setIsPickerOpen: (open: boolean) => void;
  setPickerTab: (tab: 'patterns' | 'audio') => void;
  addMidiClip: (clip: Omit<MidiPatternClip, 'id'>) => string;
  addMidiClipsBatch: (clips: Array<Omit<MidiPatternClip, 'id'>>) => string[];
  updateMidiClip: (id: string, updates: Partial<MidiPatternClip>) => void;
  updateMidiClipsBatch: (updates: Array<{ id: string; changes: Partial<MidiPatternClip> }>) => void;
  removeMidiClip: (id: string) => void;
  removeMidiClipsBatch: (ids: string[]) => void;
  splitMidiClip: (clipId: string, splitBeat: number) => void;
  duplicateMidiClip: (id: string) => string | null;
  duplicateSelectedMidiClips: () => string[];
  makeMidiClipUnique: (clipId: string) => boolean;
  toggleMidiClipMute: (id: string) => void;
  selectMidiClip: (id: string, multi?: boolean) => void;
  setSelectedMidiClipIds: (ids: string[]) => void;
  clearMidiClipSelection: () => void;
  copySelectedMidiClips: () => void;
  pasteMidiClips: (targetBeat?: number) => void;
  importDrumChainToMidiTrack: (midiTrackId?: string) => number;
  jumpToPatternEditor: (source: SelectedPatternRef) => void;
}

export const initialMidiTrackState: MidiTrackState = {
  midiTracks: DEFAULT_MIDI_TRACKS,
  midiClips: [],
  selectedMidiClipIds: [],
  selectedMidiTrackId: 'midi_track_1',
  selectedPlaylistTrackKind: 'midi',
  selectedPatternRef: { sourceType: 'drums', drumPatternIndex: 0 },
  playlistTool: 'paint',
  isPickerOpen: true,
  pickerTab: 'patterns',
  midiClipClipboard: []
};

export const createMidiTrackSlice: StateCreator<
  SongStore,
  [],
  [],
  MidiTrackState & MidiTrackActions
> = (set, get) => ({
  ...initialMidiTrackState,

  addMidiTrack: (name, color) => {
    const state = get();
    const index = state.midiTracks.length;
    const id = `midi_track_${generateId()}`;
    const newTrack: MidiTrack = {
      id,
      name: name || `Track ${index + 1}`,
      color: color || MIDI_TRACK_COLORS[index % MIDI_TRACK_COLORS.length],
      muted: false,
      solo: false
    };

    set({
      midiTracks: [...state.midiTracks, newTrack],
      selectedMidiTrackId: id,
      selectedPlaylistTrackKind: 'midi'
    });
    return id;
  },

  removeMidiTrack: (id) => {
    set((state) => {
      const remaining = state.midiTracks.filter((t) => t.id !== id);
      const removedClipIds = new Set(
        state.midiClips.filter((c) => c.midiTrackId === id).map((c) => c.id)
      );
      const nextSelected = state.selectedMidiTrackId === id
        ? (remaining[0]?.id || null)
        : state.selectedMidiTrackId;

      return {
        midiTracks: remaining,
        midiClips: state.midiClips.filter((c) => c.midiTrackId !== id),
        selectedMidiClipIds: state.selectedMidiClipIds.filter((cid) => !removedClipIds.has(cid)),
        selectedMidiTrackId: nextSelected
      };
    });
  },

  updateMidiTrack: (id, updates) => {
    set((state) => ({
      midiTracks: state.midiTracks.map((t) => (t.id === id ? { ...t, ...updates } : t))
    }));
  },

  setSelectedMidiTrackId: (id) => {
    set({
      selectedMidiTrackId: id,
      ...(id ? { selectedPlaylistTrackKind: 'midi' as const } : {})
    });
  },

  setSelectedPlaylistTrackKind: (selectedPlaylistTrackKind) => {
    set({ selectedPlaylistTrackKind });
  },

  setSelectedPatternRef: (selectedPatternRef) => {
    set({ selectedPatternRef });
  },

  setPlaylistTool: (playlistTool) => {
    set({ playlistTool });
  },

  setIsPickerOpen: (isPickerOpen) => {
    set({ isPickerOpen });
  },

  setPickerTab: (pickerTab) => {
    set({ pickerTab });
  },

  addMidiClip: (clipData) => {
    const id = `mclip_${generateId()}`;
    const newClip: MidiPatternClip = {
      ...clipData,
      id,
      startBeat: Math.max(0, clipData.startBeat),
      durationBeats: Math.max(0.25, clipData.durationBeats),
      offsetBeats: Math.max(0, clipData.offsetBeats || 0),
      isMuted: Boolean(clipData.isMuted)
    };

    set((state) => {
      const nextDrumArrangementMode =
        newClip.sourceType === 'drums' ? 'playlist' : state.drumArrangementMode;
      const nextTracks =
        newClip.sourceType === 'melody' && newClip.melodyTrackId
          ? state.tracks.map((t) =>
              t.id === newClip.melodyTrackId && t.arrangementMode !== 'playlist'
                ? { ...t, arrangementMode: 'playlist' as const }
                : t
            )
          : state.tracks;

      return {
        midiClips: [...state.midiClips, newClip],
        drumArrangementMode: nextDrumArrangementMode,
        tracks: nextTracks
      };
    });

    return id;
  },

  addMidiClipsBatch: (clipsData) => {
    if (!clipsData || clipsData.length === 0) return [];
    const created: MidiPatternClip[] = clipsData.map((clipData) => ({
      ...clipData,
      id: `mclip_${generateId()}`,
      startBeat: Math.max(0, clipData.startBeat),
      durationBeats: Math.max(0.25, clipData.durationBeats),
      offsetBeats: Math.max(0, clipData.offsetBeats || 0),
      isMuted: Boolean(clipData.isMuted)
    }));

    const hasDrumClip = created.some((c) => c.sourceType === 'drums');
    const melodyTrackIds = new Set(
      created
        .filter((c) => c.sourceType === 'melody' && c.melodyTrackId)
        .map((c) => c.melodyTrackId as string)
    );

    set((state) => ({
      midiClips: [...state.midiClips, ...created],
      drumArrangementMode: hasDrumClip ? 'playlist' : state.drumArrangementMode,
      tracks:
        melodyTrackIds.size > 0
          ? state.tracks.map((t) =>
              melodyTrackIds.has(t.id) && t.arrangementMode !== 'playlist'
                ? { ...t, arrangementMode: 'playlist' as const }
                : t
            )
          : state.tracks
    }));

    return created.map((c) => c.id);
  },

  updateMidiClip: (id, updates) => {
    set((state) => ({
      midiClips: state.midiClips.map((c) => (c.id === id ? { ...c, ...updates } : c))
    }));
  },

  updateMidiClipsBatch: (updates) => {
    if (!updates || updates.length === 0) return;
    const map = new Map(updates.map((u) => [u.id, u.changes]));
    set((state) => ({
      midiClips: state.midiClips.map((c) => {
        const chg = map.get(c.id);
        return chg ? { ...c, ...chg } : c;
      })
    }));
  },

  removeMidiClip: (id) => {
    set((state) => ({
      midiClips: state.midiClips.filter((c) => c.id !== id),
      selectedMidiClipIds: state.selectedMidiClipIds.filter((cid) => cid !== id)
    }));
  },

  removeMidiClipsBatch: (ids) => {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    set((state) => ({
      midiClips: state.midiClips.filter((c) => !idSet.has(c.id)),
      selectedMidiClipIds: state.selectedMidiClipIds.filter((cid) => !idSet.has(cid))
    }));
  },

  splitMidiClip: (clipId, splitBeat) => {
    const state = get();
    const clip = state.midiClips.find((c) => c.id === clipId);
    if (!clip) return;

    const deltaBeats = splitBeat - clip.startBeat;
    if (deltaBeats <= 0.06 || deltaBeats >= clip.durationBeats - 0.06) {
      return;
    }

    const leftClip: MidiPatternClip = {
      ...clip,
      durationBeats: deltaBeats
    };

    const rightClip: MidiPatternClip = {
      ...clip,
      id: `mclip_${generateId()}`,
      startBeat: splitBeat,
      durationBeats: clip.durationBeats - deltaBeats,
      offsetBeats: (clip.offsetBeats || 0) + deltaBeats
    };

    set({
      midiClips: state.midiClips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
      selectedMidiClipIds: [rightClip.id]
    });
  },

  duplicateMidiClip: (id) => {
    const state = get();
    const clip = state.midiClips.find((c) => c.id === id);
    if (!clip) return null;

    const newClip: MidiPatternClip = {
      ...clip,
      id: `mclip_${generateId()}`,
      startBeat: clip.startBeat + clip.durationBeats
    };

    set({
      midiClips: [...state.midiClips, newClip],
      selectedMidiClipIds: [newClip.id]
    });
    return newClip.id;
  },

  duplicateSelectedMidiClips: () => {
    const state = get();
    if (state.selectedMidiClipIds.length === 0) return [];
    const selected = state.midiClips.filter((c) => state.selectedMidiClipIds.includes(c.id));
    if (selected.length === 0) return [];

    const minStart = Math.min(...selected.map((c) => c.startBeat));
    const maxEnd = Math.max(...selected.map((c) => c.startBeat + c.durationBeats));
    const span = Math.max(0.25, maxEnd - minStart);

    const clones: MidiPatternClip[] = selected.map((c) => ({
      ...c,
      id: `mclip_${generateId()}`,
      startBeat: c.startBeat + span
    }));

    const cloneIds = clones.map((c) => c.id);
    set({
      midiClips: [...state.midiClips, ...clones],
      selectedMidiClipIds: cloneIds
    });
    return cloneIds;
  },

  makeMidiClipUnique: (clipId) => {
    const state = get();
    const clip = state.midiClips.find((c) => c.id === clipId);
    if (!clip) return false;

    if (clip.sourceType === 'drums') {
      const sourceIdx = Math.max(0, clip.drumPatternIndex ?? 0);
      const newPatternIdx = get().duplicateDrumPattern(sourceIdx);
      set((s) => ({
        midiClips: s.midiClips.map((c) =>
          c.id === clipId ? { ...c, drumPatternIndex: newPatternIdx } : c
        ),
        selectedPatternRef: { sourceType: 'drums', drumPatternIndex: newPatternIdx }
      }));
      return true;
    }

    if (clip.sourceType === 'melody' && clip.melodyTrackId && clip.melodyPatternId) {
      const newPatternId = get().duplicateMelodyPattern(clip.melodyTrackId, clip.melodyPatternId);
      if (!newPatternId) return false;
      set((s) => ({
        midiClips: s.midiClips.map((c) =>
          c.id === clipId ? { ...c, melodyPatternId: newPatternId } : c
        ),
        selectedPatternRef: {
          sourceType: 'melody',
          melodyTrackId: clip.melodyTrackId!,
          melodyPatternId: newPatternId
        }
      }));
      return true;
    }

    return false;
  },

  toggleMidiClipMute: (id) => {
    set((state) => ({
      midiClips: state.midiClips.map((c) => (c.id === id ? { ...c, isMuted: !c.isMuted } : c))
    }));
  },

  selectMidiClip: (id, multi = false) => {
    set((state) => {
      if (multi) {
        const exists = state.selectedMidiClipIds.includes(id);
        return {
          selectedMidiClipIds: exists
            ? state.selectedMidiClipIds.filter((cid) => cid !== id)
            : [...state.selectedMidiClipIds, id]
        };
      }
      return {
        selectedMidiClipIds: [id],
        selectedClipIds: []
      };
    });
  },

  setSelectedMidiClipIds: (selectedMidiClipIds) => {
    set({ selectedMidiClipIds });
  },

  clearMidiClipSelection: () => {
    set({ selectedMidiClipIds: [] });
  },

  copySelectedMidiClips: () => {
    const state = get();
    if (state.selectedMidiClipIds.length === 0) return;
    const selected = state.midiClips
      .filter((c) => state.selectedMidiClipIds.includes(c.id))
      .map((c) => ({ ...c }));
    set({ midiClipClipboard: selected });
  },

  pasteMidiClips: (targetBeat) => {
    const state = get();
    if (!state.midiClipClipboard || state.midiClipClipboard.length === 0) return;
    const minStart = Math.min(...state.midiClipClipboard.map((c) => c.startBeat));
    const baseBeat =
      typeof targetBeat === 'number'
        ? Math.max(0, targetBeat)
        : Math.max(0, Math.round((state.currentBeat || 0) * 4) / 4);

    const existingTrackIds = new Set(state.midiTracks.map((t) => t.id));
    const fallbackTrackId = state.selectedMidiTrackId || state.midiTracks[0]?.id;
    if (!fallbackTrackId) return;

    const pasted: MidiPatternClip[] = state.midiClipClipboard.map((c) => ({
      ...c,
      id: `mclip_${generateId()}`,
      midiTrackId: existingTrackIds.has(c.midiTrackId) ? c.midiTrackId : fallbackTrackId,
      startBeat: Math.max(0, baseBeat + (c.startBeat - minStart))
    }));

    set({
      midiClips: [...state.midiClips, ...pasted],
      selectedMidiClipIds: pasted.map((c) => c.id)
    });
  },

  importDrumChainToMidiTrack: (midiTrackId) => {
    const state = get();
    const linear = normalizePatternChainToLinear(state.patternChain);
    if (linear.length === 0) return 0;

    let targetTrackId = midiTrackId || state.selectedMidiTrackId || state.midiTracks[0]?.id;
    if (!targetTrackId) {
      targetTrackId = get().addMidiTrack('Drums', MIDI_TRACK_COLORS[0]);
    }

    const beatsPerMeasure = getBeatsPerMeasure(state.timeSignature);
    const clipsToCreate: Array<Omit<MidiPatternClip, 'id'>> = linear.map((item) => ({
      midiTrackId: targetTrackId!,
      sourceType: 'drums',
      drumPatternIndex: item.patternIndex,
      startBeat: item.startMeasure * beatsPerMeasure,
      durationBeats: item.durationMeasures * beatsPerMeasure,
      offsetBeats: 0,
      isMuted: false
    }));

    get().addMidiClipsBatch(clipsToCreate);
    return clipsToCreate.length;
  },

  jumpToPatternEditor: (source) => {
    const state = get();
    if (source.sourceType === 'drums') {
      state.setCurrentDrumPatternEdit(source.drumPatternIndex);
      state.setActiveView('sequencer');
      return;
    }

    if (source.sourceType === 'melody') {
      state.setActiveTrackId(source.melodyTrackId);
      state.setActiveTrackPattern(source.melodyTrackId, source.melodyPatternId);
      state.setActiveView('piano-roll');
    }
  }
});
