/**
 * audioTrackSlice.ts
 * Slice de Zustand para la gestión de pistas multitrack y clips de audio no destructivos.
 */

import type { StateCreator } from 'zustand';
import type { SongStore } from '../types';
import type {
  AudioTrack,
  AudioClip,
  AudioSnapGrid,
  AudioTracksTimelineViewport
} from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';
import { createTempoMap } from '../../core/music';
import { audioRecorder } from '../../core/audio/engine/AudioRecorder';

export const TRACK_COLORS = [
  '#e5a93c', // Ámbar Phosphor
  '#38bdf8', // Celeste Cyan
  '#a855f7', // Púrpura Neón
  '#22c55e', // Verde Esmeralda
  '#f43f5e', // Carmesí
  '#eab308'  // Oro
];

export const DEFAULT_AUDIO_TRACKS: AudioTrack[] = [
  {
    id: 'audio_track_1',
    name: 'Audio 1',
    color: TRACK_COLORS[0],
    volume: 0, // 0 dB (ganancia unitaria)
    pan: 0,
    muted: false,
    solo: false,
    isArmed: false,
    inputMonitoring: false
  }
];

export interface AudioTrackState {
  audioTracks: AudioTrack[];
  audioClips: AudioClip[];
  selectedClipIds: string[];
  selectedTrackId: string | null;
  armedTrackId: string | null;
  isRecordingAudio: boolean;
  recordingRms: number;
  audioSnapGrid: AudioSnapGrid;
  audioTimelineViewport: AudioTracksTimelineViewport;
  audioLatencyCalibrationMs: number;
  isLatencyModalOpen: boolean;
}

export interface AudioTrackActions {
  addAudioTrack: (name?: string, color?: string) => string;
  removeAudioTrack: (id: string) => void;
  updateAudioTrack: (id: string, updates: Partial<AudioTrack>) => void;
  setSelectedTrackId: (id: string | null) => void;
  addAudioClip: (clip: AudioClip) => void;
  removeAudioClip: (id: string) => void;
  updateAudioClip: (id: string, updates: Partial<AudioClip>) => void;
  splitAudioClip: (clipId: string, splitBeat: number) => void;
  selectClip: (id: string, multi?: boolean) => void;
  clearClipSelection: () => void;
  setArmedTrackId: (id: string | null) => void;
  setIsRecordingAudio: (isRecording: boolean) => void;
  setRecordingRms: (rms: number) => void;
  setAudioSnapGrid: (grid: AudioSnapGrid) => void;
  setAudioTimelineViewport: (viewport: Partial<AudioTracksTimelineViewport>) => void;
  setAudioLatencyCalibrationMs: (ms: number) => void;
  setIsLatencyModalOpen: (open: boolean) => void;
  startAudioRecording: () => Promise<boolean>;
  stopAudioRecording: () => Promise<void>;
}

export const initialAudioTrackState: AudioTrackState = {
  audioTracks: DEFAULT_AUDIO_TRACKS,
  audioClips: [],
  selectedClipIds: [],
  selectedTrackId: 'audio_track_1',
  armedTrackId: null,
  isRecordingAudio: false,
  recordingRms: 0,
  audioSnapGrid: 'beat',
  audioTimelineViewport: { scrollLeft: 0, zoomLevel: 60 },
  audioLatencyCalibrationMs: 20, // Calibración por defecto razonable (20 ms)
  isLatencyModalOpen: false
};

export const createAudioTrackSlice: StateCreator<
  SongStore,
  [],
  [],
  AudioTrackState & AudioTrackActions
> = (set, get) => ({
  ...initialAudioTrackState,

  addAudioTrack: (name, color) => {
    const state = get();
    const index = state.audioTracks.length;
    const id = `audio_track_${generateId()}`;
    const newTrack: AudioTrack = {
      id,
      name: name || `Audio ${index + 1}`,
      color: color || TRACK_COLORS[index % TRACK_COLORS.length],
      volume: 0, // 0 dB
      pan: 0,
      muted: false,
      solo: false,
      isArmed: false,
      inputMonitoring: false
    };

    set({
      audioTracks: [...state.audioTracks, newTrack],
      selectedTrackId: id
    });
    return id;
  },

  removeAudioTrack: (id) => {
    set((state) => {
      const remainingTracks = state.audioTracks.filter((t) => t.id !== id);
      const nextSelected = state.selectedTrackId === id
        ? (remainingTracks[0]?.id || null)
        : state.selectedTrackId;

      return {
        audioTracks: remainingTracks,
        audioClips: state.audioClips.filter((c) => c.trackId !== id),
        armedTrackId: state.armedTrackId === id ? null : state.armedTrackId,
        selectedTrackId: nextSelected
      };
    });
  },

  updateAudioTrack: (id, updates) => {
    set((state) => ({
      audioTracks: state.audioTracks.map((t) => (t.id === id ? { ...t, ...updates } : t))
    }));
  },

  setSelectedTrackId: (id) => {
    set({ selectedTrackId: id });
  },

  addAudioClip: (clip) => {
    set((state) => ({
      audioClips: [...state.audioClips, clip]
    }));
  },

  removeAudioClip: (id) => {
    set((state) => ({
      audioClips: state.audioClips.filter((c) => c.id !== id),
      selectedClipIds: state.selectedClipIds.filter((cid) => cid !== id)
    }));
  },

  updateAudioClip: (id, updates) => {
    set((state) => ({
      audioClips: state.audioClips.map((c) => (c.id === id ? { ...c, ...updates } : c))
    }));
  },

  /**
   * Corte no destructivo (Split): divide un clip en dos en el compás especificado sin duplicar datos en memoria.
   */
  splitAudioClip: (clipId, splitBeat) => {
    const state = get();
    const clip = state.audioClips.find((c) => c.id === clipId);
    if (!clip) return;

    const tempoMap = createTempoMap(state.bpm, state.tempoMarkers);
    const clipStartSec = tempoMap.beatToSeconds(clip.startBeat);
    const splitSec = tempoMap.beatToSeconds(splitBeat);
    const deltaSec = splitSec - clipStartSec;

    // Verificar que el corte cae estrictamente dentro del cuerpo del clip
    if (deltaSec <= 0.02 || deltaSec >= clip.durationSeconds - 0.02) {
      return;
    }

    const updatedLeftClip: AudioClip = {
      ...clip,
      durationSeconds: deltaSec,
      fadeOutSeconds: 0.003
    };

    const newRightClip: AudioClip = {
      id: `clip_${generateId()}`,
      trackId: clip.trackId,
      bufferId: clip.bufferId,
      name: `${clip.name} (corte)`,
      startBeat: splitBeat,
      sourceOffsetSeconds: clip.sourceOffsetSeconds + deltaSec,
      durationSeconds: clip.durationSeconds - deltaSec,
      gain: clip.gain,
      fadeInSeconds: 0.003,
      fadeOutSeconds: clip.fadeOutSeconds,
      isMuted: clip.isMuted
    };

    set({
      audioClips: state.audioClips.map((c) => (c.id === clipId ? updatedLeftClip : c)).concat(newRightClip),
      selectedClipIds: [newRightClip.id]
    });
  },

  selectClip: (id, multi = false) => {
    set((state) => {
      if (multi) {
        const exists = state.selectedClipIds.includes(id);
        return {
          selectedClipIds: exists
            ? state.selectedClipIds.filter((cid) => cid !== id)
            : [...state.selectedClipIds, id]
        };
      }
      return { selectedClipIds: [id] };
    });
  },

  clearClipSelection: () => {
    set({ selectedClipIds: [] });
  },

  setArmedTrackId: (id) => {
    set((state) => {
      const nextArmed = state.armedTrackId === id ? null : id;
      return {
        armedTrackId: nextArmed,
        audioTracks: state.audioTracks.map((t) => ({
          ...t,
          isArmed: t.id === nextArmed
        }))
      };
    });
  },

  setIsRecordingAudio: (isRecording) => {
    set({ isRecordingAudio: isRecording });
  },

  setRecordingRms: (rms) => {
    set({ recordingRms: rms });
  },

  setAudioSnapGrid: (grid) => {
    set({ audioSnapGrid: grid });
  },

  setAudioTimelineViewport: (viewport) => {
    set((state) => ({
      audioTimelineViewport: { ...state.audioTimelineViewport, ...viewport }
    }));
  },

  setAudioLatencyCalibrationMs: (ms) => {
    set({ audioLatencyCalibrationMs: ms });
  },

  setIsLatencyModalOpen: (open) => {
    set({ isLatencyModalOpen: open });
  },

  /**
   * Inicia la grabación sincronizada de la pista armada.
   */
  startAudioRecording: async () => {
    const state = get();
    if (!state.armedTrackId) {
      // Si no hay pista armada, armar la primera disponible
      const firstTrack = state.audioTracks[0];
      if (firstTrack) {
        get().setArmedTrackId(firstTrack.id);
      } else {
        const newId = get().addAudioTrack();
        get().setArmedTrackId(newId);
      }
    }

    const currentStartBeat = state.currentBeat;

    audioRecorder.setOnMeter((rms) => {
      get().setRecordingRms(rms);
    });

    const ok = await audioRecorder.startRecording(currentStartBeat);
    if (ok) {
      set({ isRecordingAudio: true });
      if (!state.isPlaying) {
        state.setPlaying(true);
      }
      return true;
    }
    return false;
  },

  /**
   * Detiene la grabación y crea el nuevo AudioClip compensado en la pista correspondiente.
   */
  stopAudioRecording: async () => {
    const state = get();
    if (!state.isRecordingAudio) return;

    set({ isRecordingAudio: false, recordingRms: 0 });

    const result = await audioRecorder.stopRecording(state.audioLatencyCalibrationMs);
    if (!result) return;

    const targetTrackId = state.armedTrackId || state.audioTracks[0]?.id;
    if (!targetTrackId) return;

    const newClip: AudioClip = {
      id: `clip_${generateId()}`,
      trackId: targetTrackId,
      bufferId: result.bufferId,
      name: `Toma ${state.audioClips.length + 1}`,
      startBeat: result.startBeat,
      sourceOffsetSeconds: 0,
      durationSeconds: result.durationSeconds,
      gain: 1.0,
      fadeInSeconds: 0.005,
      fadeOutSeconds: 0.005,
      isMuted: false
    };

    get().addAudioClip(newClip);
    get().selectClip(newClip.id);
  }
});
