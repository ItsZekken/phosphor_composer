/**
 * arrangementResolver.ts
 * Utilidades compartidas de compás, paleta de patrones de batería y migración retrocompatible
 * de sesiones que usaban el formato legado de MIDI Tracks (playlist separada) hacia el modelo 1:1 unificado.
 */

import type {
  MelodyNote,
  MelodyPattern,
  MelodyRegion,
  MidiPatternClip,
  MidiTrack,
  PatternChainItem,
  PianoRollTrack,
  TimeSignature
} from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';
import { reconcileTrackRegions, roundBeat } from './melodyRegionUtils';

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

function getLegacyMelodyPatternLengthBeats(
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

function expandLegacyMelodyClipNotes(
  clip: MidiPatternClip,
  pattern: MelodyPattern,
  beatsPerMeasure: number
): MelodyNote[] {
  const notes = pattern.notes || [];
  if (notes.length === 0) return [];

  const patLen = Math.max(0.25, getLegacyMelodyPatternLengthBeats(pattern, beatsPerMeasure));
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
      const effectiveDur = Math.max(0.04, Math.min(note.durationBeats, remainingInClip));
      const songStart = roundBeat(clip.startBeat + (localStart - winStart));

      expanded.push({
        id: generateId('mn'),
        note: note.note,
        midi: note.midi,
        startBeat: songStart,
        durationBeats: roundBeat(effectiveDur),
        velocity: typeof note.velocity === 'number' ? note.velocity : 0.8,
        ...(clip.isMuted ? { muted: true } : {})
      });
    }
  }

  return expanded;
}

/**
 * Migra sesiones guardadas con el antiguo modelo de `midiTracks`/`midiClips` (playlist desconectada)
 * al modelo 1:1 unificado:
 * - Clips de melodía -> notas reales en `track.notes` + límites en `track.regions`.
 * - Clips de batería -> `PatternChainItem[]` lineales en `patternChain` (y desactiva repeat si había clips).
 */
export function materializeLegacyMidiArrangement(params: {
  tracks: PianoRollTrack[];
  patternChain: PatternChainItem[];
  isPatternRepeatOn: boolean;
  drumArrangementMode?: 'sequencer' | 'playlist';
  midiTracks?: MidiTrack[];
  midiClips?: MidiPatternClip[];
  timeSignature?: TimeSignature | string;
}): {
  tracks: PianoRollTrack[];
  patternChain: PatternChainItem[];
  isPatternRepeatOn: boolean;
} {
  const {
    tracks,
    patternChain,
    isPatternRepeatOn,
    drumArrangementMode,
    midiTracks = [],
    midiClips = [],
    timeSignature
  } = params;

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);

  // Construir mapa de audibilidad de carriles MIDI legados
  const midiTrackMap = new Map(midiTracks.map((t) => [t.id, t]));
  const anyMidiSolo = midiTracks.some((t) => t.solo);
  const isLegacyTrackAudible = (midiTrackId: string): boolean => {
    const mt = midiTrackMap.get(midiTrackId);
    if (!mt) return true;
    if (mt.muted) return false;
    if (anyMidiSolo && !mt.solo) return false;
    return true;
  };

  // 1. Materializar pistas de Piano Roll
  const nextTracks: PianoRollTrack[] = tracks.map((track) => {
    const legacyClips = midiClips.filter(
      (c) => c.sourceType === 'melody' && c.melodyTrackId === track.id
    );

    const patterns = Array.isArray(track.patterns) && track.patterns.length > 0 ? track.patterns : null;
    const { patterns: _p, activePatternId: _a, arrangementMode: _m, ...cleanTrack } = track;

    if (legacyClips.length === 0) {
      let notes = Array.isArray(track.notes) ? track.notes : [];
      if (notes.length === 0 && patterns && patterns.length > 0) {
        const activePat =
          patterns.find((p) => p.id === track.activePatternId) ||
          patterns.find((p) => Array.isArray(p.notes) && p.notes.length > 0) ||
          patterns[0];
        if (activePat && Array.isArray(activePat.notes)) {
          notes = activePat.notes;
        }
      }
      const regions = Array.isArray(track.regions) && track.regions.length > 0
        ? reconcileTrackRegions(track.id, notes, track.regions, beatsPerMeasure)
        : undefined;
      return {
        ...cleanTrack,
        notes,
        ...(regions && regions.length > 0 ? { regions } : {})
      };
    }

    const patternMap = new Map((patterns || []).map((p) => [p.id, p]));
    const fallbackPattern: MelodyPattern =
      (patterns && patterns[0]) || { id: 'pat_1', name: 'Patrón 1', notes: track.notes || [] };

    const materializedNotes: MelodyNote[] = [];
    const materializedRegions: MelodyRegion[] = [];

    for (let i = 0; i < legacyClips.length; i++) {
      const clip = legacyClips[i];
      const mutedByTrack = !isLegacyTrackAudible(clip.midiTrackId);
      const effectiveClip = mutedByTrack ? { ...clip, isMuted: true } : clip;
      const pat = (clip.melodyPatternId && patternMap.get(clip.melodyPatternId)) || fallbackPattern;
      const expanded = expandLegacyMelodyClipNotes(effectiveClip, pat, beatsPerMeasure);
      materializedNotes.push(...expanded);

      const patLen = getLegacyMelodyPatternLengthBeats(pat, beatsPerMeasure);
      materializedRegions.push({
        id: generateId('mreg'),
        startBeat: Math.max(0, roundBeat(clip.startBeat)),
        durationBeats: Math.max(0.25, roundBeat(clip.durationBeats)),
        ...(clip.durationBeats > patLen + 1e-4 ? { loopLengthBeats: patLen } : {})
      });
    }

    materializedNotes.sort((a, b) => a.startBeat - b.startBeat);
    const regions = reconcileTrackRegions(track.id, materializedNotes, materializedRegions, beatsPerMeasure);
    return {
      ...cleanTrack,
      notes: materializedNotes,
      regions
    };
  });

  // 2. Materializar clips de batería legados en patternChain si estaban en modo playlist o había clips
  const legacyDrumClips = midiClips.filter((c) => c.sourceType === 'drums');
  let nextPatternChain = patternChain;
  let nextIsRepeatOn = isPatternRepeatOn;

  if (legacyDrumClips.length > 0 && (drumArrangementMode === 'playlist' || patternChain.length === 0)) {
    nextPatternChain = legacyDrumClips
      .map((clip): PatternChainItem => {
        const startMeasure = Math.max(0, roundBeat(clip.startBeat / beatsPerMeasure));
        const durationMeasures = Math.max(0.25, roundBeat(clip.durationBeats / beatsPerMeasure));
        const muted = Boolean(clip.isMuted) || !isLegacyTrackAudible(clip.midiTrackId);
        return {
          id: generateId('chain'),
          type: 'pattern',
          patternIndex: Math.max(0, clip.drumPatternIndex ?? 0),
          startMeasure,
          durationMeasures,
          repeatCount: Math.max(1, Math.round(durationMeasures)),
          ...(muted ? { isMuted: true } : {})
        };
      })
      .sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0));
    nextIsRepeatOn = false;
  }

  return {
    tracks: nextTracks,
    patternChain: nextPatternChain,
    isPatternRepeatOn: nextIsRepeatOn
  };
}
