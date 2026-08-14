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
    const list: StageRenderNote[] = [];

    // 1. Compilar notas de acordes (Armonía)
    const chordChannel = channels.chords || {
      id: 'chords',
      name: 'Harmony',
      color: '#5a9e7a'
    };

    chordBlocks.forEach((block) => {
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
          color: chordChannel.color || '#5a9e7a',
          type: 'harmony'
        });
      });
    });

    // 2. Compilar notas de pistas melódicas (Piano Roll)
    tracks.forEach((track) => {
      const channel = channels[track.channelId] || {
        id: track.channelId,
        name: track.name,
        color: track.color || '#82a5f5'
      };

      (track.notes || []).forEach((n) => {
        list.push({
          id: `track-${track.id}-${n.id}`,
          midi: n.midi || noteToMidi(n.note),
          pitchName: n.note,
          startBeat: n.startBeat,
          durationBeats: n.durationBeats,
          velocity: n.velocity || 0.8,
          channelId: track.channelId,
          trackName: track.name || channel.name || 'Lead',
          color: track.color || channel.color || '#82a5f5',
          type: 'melody'
        });
      });
    });

    // Ordenar por startBeat ascendente
    list.sort((a, b) => a.startBeat - b.startBeat);
    return list;
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
