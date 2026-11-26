/**
 * arrangementResolver.ts
 * Resolutor determinista único (Single Source of Truth) para patrones MIDI (Drums y Melodías)
 * secuenciados en los MIDI Tracks (Playlist estilo FL Studio).
 * Utilizado por timelineScheduler, offlineRenderer, midiService, Stage Visualizer y GlobalScrubber.
 */

import type {
  MelodyNote,
  MelodyPattern,
  MidiPatternClip,
  MidiTrack,
  PianoRollTrack,
  SelectedPatternRef,
  TimeSignature
} from '../../utils/typeDefinitions';

export const DRUM_PATTERN_PALETTE = [
  '#2dd4bf', // P1 Turquesa Phosphor
  '#e5a93c', // P2 Ámbar
  '#60a5fa', // P3 Azul
  '#c45d9c', // P4 Magenta
  '#a78bfa', // P5 Violeta
  '#5a9e7a', // P6 Esmeralda
  '#f87171', // P7 Coral
  '#7d98b3', // P8 Acero
  '#eab308', // P9 Oro
  '#a270b5', // P10 Orquídea
  '#38bdf8', // P11 Cyan
  '#fb923c'  // P12 Naranja
];

export function getBeatsPerMeasure(timeSignature?: TimeSignature | string): number {
  if (timeSignature === '3/4') return 3;
  if (timeSignature === '6/8') return 6;
  return 4;
}

export function getDrumPatternColor(patternIndex: number): string {
  const safe = Math.max(0, Math.floor(patternIndex || 0));
  return DRUM_PATTERN_PALETTE[safe % DRUM_PATTERN_PALETTE.length];
}

export function getDrumPatternName(patternIndex: number, drumPatternNames?: string[]): string {
  const safe = Math.max(0, Math.floor(patternIndex || 0));
  const custom = drumPatternNames?.[safe]?.trim();
  return custom || `Drums P${safe + 1}`;
}

/**
 * Garantiza que cualquier PianoRollTrack (incluso legacy sin .patterns)
 * exponga una lista de patrones válida y un activePattern consistente.
 */
export function ensureTrackPatterns(track: PianoRollTrack): {
  patterns: MelodyPattern[];
  activePatternId: string;
  activePattern: MelodyPattern;
} {
  if (Array.isArray(track.patterns) && track.patterns.length > 0) {
    const active =
      track.patterns.find((p) => p.id === track.activePatternId) ||
      track.patterns[0];
    return {
      patterns: track.patterns,
      activePatternId: active.id,
      activePattern: active
    };
  }

  const fallbackId = track.activePatternId || `pat_${track.id}_1`;
  const fallbackPattern: MelodyPattern = {
    id: fallbackId,
    name: 'Patrón 1',
    notes: Array.isArray(track.notes) ? track.notes : []
  };

  return {
    patterns: [fallbackPattern],
    activePatternId: fallbackId,
    activePattern: fallbackPattern
  };
}

/**
 * Calcula la duración natural en beats de un MelodyPattern:
 * - Si tiene lengthBeats explícito (> 0), lo respeta.
 * - Si no, ajusta automáticamente al múltiplo de compases enteros que cubre sus notas (mínimo 1 compás).
 */
export function getMelodyPatternLengthBeats(
  pattern: Pick<MelodyPattern, 'notes' | 'lengthBeats'> | undefined,
  beatsPerMeasure: number
): number {
  const barBeats = Math.max(1, beatsPerMeasure || 4);
  if (!pattern) return barBeats;

  if (typeof pattern.lengthBeats === 'number' && !Number.isNaN(pattern.lengthBeats) && pattern.lengthBeats > 0) {
    return Math.max(0.25, pattern.lengthBeats);
  }

  const notes = pattern.notes || [];
  let maxEnd = 0;
  for (let i = 0; i < notes.length; i++) {
    const end = (notes[i].startBeat || 0) + (notes[i].durationBeats || 0);
    if (end > maxEnd) maxEnd = end;
  }

  if (maxEnd <= 1e-6) return barBeats;
  return Math.max(barBeats, Math.ceil((maxEnd - 1e-6) / barBeats) * barBeats);
}

/**
 * Evalúa audibilidad (Mute / Solo) para carriles MIDI Track de la Playlist.
 */
export function createMidiTrackAudibilityChecker(midiTracks: MidiTrack[] = []): (midiTrackId: string) => boolean {
  const trackMap = new Map<string, MidiTrack>();
  let anySolo = false;

  for (let i = 0; i < midiTracks.length; i++) {
    const t = midiTracks[i];
    if (!t) continue;
    trackMap.set(t.id, t);
    if (t.solo) anySolo = true;
  }

  return (midiTrackId: string) => {
    const t = trackMap.get(midiTrackId);
    if (!t) return true;
    if (t.muted) return false;
    if (anySolo && !t.solo) return false;
    return true;
  };
}

/**
 * Expande un MidiPatternClip melódico a notas absolutas en el timeline de la canción,
 * soportando offset inicial (recorte izquierdo), duración arbitraria (recorte derecho)
 * y bucle automático (tiling) cuando durationBeats > patternLengthBeats.
 */
export function expandMelodyClipNotes(
  clip: MidiPatternClip,
  pattern: MelodyPattern,
  beatsPerMeasure: number
): MelodyNote[] {
  const notes = pattern.notes || [];
  if (notes.length === 0) return [];

  const patLen = Math.max(0.25, getMelodyPatternLengthBeats(pattern, beatsPerMeasure));
  const winStart = Math.max(0, clip.offsetBeats || 0);
  const dur = Math.max(0, clip.durationBeats || 0);
  const winEnd = winStart + dur;
  if (dur <= 1e-6) return [];

  const firstCycle = Math.floor(winStart / patLen);
  const lastCycle = Math.floor((winEnd - 1e-6) / patLen);
  const expanded: MelodyNote[] = [];

  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    const cycleBase = cycle * patLen;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note.startBeat >= patLen - 1e-6) continue;
      const localStart = cycleBase + note.startBeat;
      if (localStart < winStart - 1e-6 || localStart >= winEnd - 1e-6) continue;

      const remainingInClip = winEnd - localStart;
      const effectiveDur = Math.max(0.02, Math.min(note.durationBeats, remainingInClip));
      const songStart = clip.startBeat + (localStart - winStart);

      expanded.push({
        id: `${clip.id}_c${cycle}_${note.id}`,
        note: note.note,
        midi: note.midi,
        startBeat: songStart,
        durationBeats: effectiveDur,
        velocity: typeof note.velocity === 'number' ? note.velocity : 0.8
      });
    }
  }

  return expanded;
}

/**
 * Resuelve las notas efectivas de una pista melódica en modo SONG:
 * - Si la pista está en modo 'playlist' o tiene clips colocados en MIDI Tracks,
 *   devuelve únicamente la expansión de los clips audibles en los MIDI Tracks.
 * - De lo contrario (modo 'direct' sin clips en Playlist), devuelve sus notas directas (100% retrocompatible).
 */
export function resolveArrangedMelodyTrackNotes(
  track: PianoRollTrack,
  midiTracks: MidiTrack[] = [],
  midiClips: MidiPatternClip[] = [],
  beatsPerMeasure = 4
): { isPlaylistControlled: boolean; notes: MelodyNote[] } {
  const trackClips = midiClips.filter(
    (c) => c.sourceType === 'melody' && c.melodyTrackId === track.id
  );
  const isPlaylistControlled = track.arrangementMode === 'playlist' || trackClips.length > 0;

  if (!isPlaylistControlled) {
    return {
      isPlaylistControlled: false,
      notes: track.notes || []
    };
  }

  if (trackClips.length === 0) {
    return {
      isPlaylistControlled: true,
      notes: []
    };
  }

  const isTrackAudible = createMidiTrackAudibilityChecker(midiTracks);
  const { patterns } = ensureTrackPatterns(track);
  const patternMap = new Map(patterns.map((p) => [p.id, p]));
  const result: MelodyNote[] = [];

  for (let i = 0; i < trackClips.length; i++) {
    const clip = trackClips[i];
    if (clip.isMuted) continue;
    if (!isTrackAudible(clip.midiTrackId)) continue;

    const pattern = (clip.melodyPatternId && patternMap.get(clip.melodyPatternId)) || patterns[0];
    if (!pattern) continue;

    const expanded = expandMelodyClipNotes(clip, pattern, beatsPerMeasure);
    for (let j = 0; j < expanded.length; j++) {
      result.push(expanded[j]);
    }
  }

  result.sort((a, b) => a.startBeat - b.startBeat);
  return {
    isPlaylistControlled: true,
    notes: result
  };
}

/**
 * Determina si la Drum Machine está controlada por clips en MIDI Tracks (Playlist)
 * y devuelve únicamente los clips de batería audibles.
 */
export function resolveArrangedDrumClips(
  midiTracks: MidiTrack[] = [],
  midiClips: MidiPatternClip[] = [],
  drumArrangementMode?: 'sequencer' | 'playlist'
): {
  isPlaylistControlled: boolean;
  allDrumClips: MidiPatternClip[];
  audibleDrumClips: MidiPatternClip[];
} {
  const allDrumClips = midiClips.filter((c) => c.sourceType === 'drums');
  const isPlaylistControlled = drumArrangementMode === 'playlist' || allDrumClips.length > 0;

  if (!isPlaylistControlled || allDrumClips.length === 0) {
    return {
      isPlaylistControlled,
      allDrumClips,
      audibleDrumClips: []
    };
  }

  const isTrackAudible = createMidiTrackAudibilityChecker(midiTracks);
  const audibleDrumClips = allDrumClips.filter(
    (clip) => !clip.isMuted && isTrackAudible(clip.midiTrackId)
  );

  return {
    isPlaylistControlled,
    allDrumClips,
    audibleDrumClips
  };
}

/**
 * Resuelve qué patrón se debe audicionar en bucle cuando playbackMode === 'pattern'.
 */
export function resolvePatternAuditionTarget(params: {
  activeView?: string;
  currentDrumPatternEdit?: number;
  tracks?: PianoRollTrack[];
  activeTrackId?: string;
  selectedPatternRef?: SelectedPatternRef | null;
}): SelectedPatternRef {
  const { activeView, currentDrumPatternEdit = 0, tracks = [], activeTrackId, selectedPatternRef } = params;

  if (activeView === 'sequencer') {
    return { sourceType: 'drums', drumPatternIndex: Math.max(0, currentDrumPatternEdit) };
  }

  if (activeView === 'piano-roll' || activeView === 'piano') {
    const activeTrack = tracks.find((t) => t.id === activeTrackId) || tracks[0];
    if (activeTrack) {
      const { activePatternId } = ensureTrackPatterns(activeTrack);
      return {
        sourceType: 'melody',
        melodyTrackId: activeTrack.id,
        melodyPatternId: activePatternId
      };
    }
  }

  if (selectedPatternRef) {
    if (selectedPatternRef.sourceType === 'drums') {
      return { sourceType: 'drums', drumPatternIndex: Math.max(0, selectedPatternRef.drumPatternIndex) };
    }
    const targetTrack = tracks.find((t) => t.id === selectedPatternRef.melodyTrackId);
    if (targetTrack) {
      const { patterns, activePatternId } = ensureTrackPatterns(targetTrack);
      const validPat = patterns.find((p) => p.id === selectedPatternRef.melodyPatternId);
      return {
        sourceType: 'melody',
        melodyTrackId: targetTrack.id,
        melodyPatternId: validPat ? validPat.id : activePatternId
      };
    }
  }

  return { sourceType: 'drums', drumPatternIndex: Math.max(0, currentDrumPatternEdit) };
}
