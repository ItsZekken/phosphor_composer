import { useMemo } from 'react';
import { useSongStore } from '../../../store/songStore';
import { noteToMidi, renderChordPattern, segmentChordBlockByStyleMarkers } from '../../../core/music';
import type { StyleMarker } from '../../../utils/typeDefinitions';
import type { PatternDef } from '../../../patterns/patternTypes';

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

// Paleta de colores diferenciados y estéticos para las pistas de Piano Roll
export const PIANO_ROLL_COLOR_PALETTE = [
  '#6880ad', // Slate Blue
  '#a36d83', // Dusty Rose
  '#b09058', // Warm Ochre
  '#7e6899', // Muted Lavender
  '#50828a', // Misty Teal
  '#a87060', // Soft Terracotta
  '#607890', // Steel Blue
  '#928458', // Olive Khaki
  '#846e91', // Heather Violet
  '#5a9e7a', // Sage Green
  '#d97762', // Warm Coral
  '#6b7280'  // Neutral Slate
];

export const HARMONY_NOTE_COLOR = '#4d627d';

export interface ExtractStageTimelineNotesParams {
  chordBlocks: any[];
  chordOctaveShift?: number;
  tracks: any[];
  channels: Record<string, any>;
  pattern?: string;
  styleMarkers?: StyleMarker[];
  customPatterns?: PatternDef[];
}

/**
 * Función pura que compila y normaliza las notas de armonía y melodía
 * para su visualización en el Waterfall (tanto en vivo como en renderizado de video),
 * resolviendo con precisión los patrones rítmicos y marcadores de estilo en la línea de tiempo.
 */
export function extractStageTimelineNotes(params: ExtractStageTimelineNotesParams): StageRenderNote[] {
  const {
    chordBlocks,
    chordOctaveShift = 0,
    tracks,
    channels,
    pattern = 'hold',
    styleMarkers = [],
    customPatterns = []
  } = params;
  const list: StageRenderNote[] = [];

  const chordChannel = channels.chords || {
    id: 'chords',
    name: 'Harmony',
    color: HARMONY_NOTE_COLOR
  };

  // Reemplazar azul chillón (#00ffcc o #00e5ff) por color suave si viene de sesiones previas
  const chordColor = (chordChannel.color === '#00ffcc' || chordChannel.color === '#00e5ff')
    ? HARMONY_NOTE_COLOR
    : (chordChannel.color || HARMONY_NOTE_COLOR);

  (chordBlocks || []).forEach((block) => {
    const segments = segmentChordBlockByStyleMarkers(block, styleMarkers, pattern);

    segments.forEach((seg, segIdx) => {
      const rendered = renderChordPattern(
        seg.block,
        seg.pattern,
        customPatterns,
        chordOctaveShift
      );

      rendered.forEach((rn, rnIdx) => {
        const midi = noteToMidi(rn.name);
        list.push({
          id: `chord-${block.id}-${segIdx}-${rnIdx}-${rn.name}-${rn.timeBeats}`,
          midi,
          pitchName: rn.name,
          startBeat: rn.timeBeats,
          durationBeats: rn.durationBeats,
          velocity: rn.velocity,
          channelId: 'chords',
          trackName: chordChannel.name || 'Harmony',
          color: chordColor,
          type: 'harmony'
        });
      });
    });
  });

  (tracks || []).forEach((track, trackIdx) => {
    const channel = channels[track.channelId];
    const trackColor = track.color || channel?.color || PIANO_ROLL_COLOR_PALETTE[trackIdx % PIANO_ROLL_COLOR_PALETTE.length];

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
  const pattern = useSongStore((state) => state.pattern);
  const styleMarkers = useSongStore((state) => state.styleMarkers);
  const customPatterns = useSongStore((state) => state.customPatterns);
  const tracks = useSongStore((state) => state.tracks);
  const channels = useSongStore((state) => state.channels);

  const compiledNotes = useMemo<StageRenderNote[]>(() => {
    return extractStageTimelineNotes({
      chordBlocks,
      chordOctaveShift,
      tracks,
      channels,
      pattern,
      styleMarkers,
      customPatterns
    });
  }, [chordBlocks, chordOctaveShift, tracks, channels, pattern, styleMarkers, customPatterns]);

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

