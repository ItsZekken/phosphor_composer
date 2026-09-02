import { useMemo } from 'react';
import { useSongStore } from '../../../store/songStore';
import { getBlockNotes, noteToMidi } from '../../../core/music';

export interface StageRenderNote {
  id: string;
  midi: number;
  pitchName: string;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  channelId: string;
  trackName: string;
  color: string;
  type: 'harmony' | 'melody' | 'drum';
}

// Paleta de colores diferenciados de baja saturación para las pistas de Piano Roll
const LOW_SAT_TRACK_PALETTE = [
  '#6880ad', // Slate Blue
  '#a36d83', // Dusty Rose
  '#b09058', // Warm Ochre
  '#7e6899', // Muted Lavender
  '#50828a', // Misty Teal
  '#a87060', // Soft Terracotta
  '#607890', // Steel Blue
  '#928458', // Olive Khaki
  '#846e91'  // Heather Violet
];

export const HARMONY_NOTE_COLOR = '#446454';

/**
 * Función pura que compila y normaliza las notas de armonía y melodía
 * para su visualización en el Waterfall (tanto en vivo como en renderizado de video).
 */
export function extractStageTimelineNotes(params: {
  chordBlocks: any[];
  chordOctaveShift?: number;
  tracks: any[];
  channels: Record<string, any>;
}): StageRenderNote[] {
  const { chordBlocks, chordOctaveShift = 0, tracks, channels } = params;
  const list: StageRenderNote[] = [];

  const chordChannel = channels.chords || {
    id: 'chords',
    name: 'Harmony',
    color: HARMONY_NOTE_COLOR
  };

  (chordBlocks || []).forEach((block) => {
    const notes = getBlockNotes({
      chord: block.chord,
      voicing: block.voicing,
      inversion: block.inversion,
      octaveShift: chordOctaveShift || 0,
      type: block.type,
      bassNote: block.bassNote
    });

    notes.forEach((pitch, i) => {
      const midi = noteToMidi(pitch);
      list.push({
        id: `chord-${block.id}-${i}-${pitch}`,
        midi,
        pitchName: pitch,
        startBeat: block.startBeat,
        durationBeats: block.durationBeats,
        velocity: 0.7,
        channelId: 'chords',
        trackName: chordChannel.name || 'Harmony',
        color: HARMONY_NOTE_COLOR,
        type: 'harmony'
      });
    });
  });

  (tracks || []).forEach((track, trackIdx) => {
    const channel = channels[track.channelId];
    const trackColor = LOW_SAT_TRACK_PALETTE[trackIdx % LOW_SAT_TRACK_PALETTE.length];

    (track.notes || []).forEach((n: any) => {
      list.push({
        id: `track-${track.id}-${n.id}`,
        midi: n.midi || noteToMidi(n.note),
        pitchName: n.note,
        startBeat: n.startBeat,
        durationBeats: n.durationBeats,
        velocity: n.velocity || 0.8,
        channelId: track.channelId,
        trackName: track.name || channel?.name || 'Lead',
        color: trackColor,
        type: 'melody'
      });
    });
  });

  list.sort((a, b) => a.startBeat - b.startBeat);
  return list;
}

/**
 * Hook que extrae, normaliza e indexa todas las notas de la canción (armonía, melodía y pistas)
 * en una estructura plana optimizada para el renderizado del Waterfall a 60 FPS.
 */
export function useStageTimelineNotes() {
  const chordBlocks = useSongStore((state) => state.chordBlocks);
  const chordOctaveShift = useSongStore((state) => state.chordOctaveShift);
  const tracks = useSongStore((state) => state.tracks);
  const channels = useSongStore((state) => state.channels);

  const compiledNotes = useMemo<StageRenderNote[]>(() => {
    return extractStageTimelineNotes({
      chordBlocks,
      chordOctaveShift,
      tracks,
      channels
    });
  }, [chordBlocks, chordOctaveShift, tracks, channels]);

  // Calcular longitud máxima de la canción en compases/beats
  const maxBeat = useMemo(() => {
    let max = 16;
    compiledNotes.forEach((n) => {
      const end = n.startBeat + n.durationBeats;
      if (end > max) max = end;
    });
    return Math.ceil(max / 4) * 4;
  }, [compiledNotes]);

  return {
    notes: compiledNotes,
    maxBeat
  };
}
