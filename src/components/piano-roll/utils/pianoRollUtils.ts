/**
 * pianoRollUtils.ts
 * Utilidades puras, constantes, cálculos armónicos y transformadores musicales para el Piano Roll.
 */

import type { PianoRollGridSnap } from '../../../store/types';
import type { ChordBlock, MelodyNote } from '../../../utils/typeDefinitions';
import { NOTE_CLASSES, parseChord, getChordNotes, noteToMod12 } from '../../../core/music';
import { generateId } from '../../../utils/idGenerator';

export const MIN_MIDI = 21; // A0 (piano de concierto 88 teclas)
export const MAX_MIDI = 108; // C8
export const NOTE_COUNT = MAX_MIDI - MIN_MIDI + 1;

export interface LassoRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TempNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
}

export interface EphemeralDragState {
  overrides: Map<string, Partial<MelodyNote>>;
  clonedPreviewNotes?: MelodyNote[];
  sliceLine?: { x1: number; y1: number; x2: number; y2: number } | null;
  sliceCuts?: Array<{ x: number; y: number }>;
  rampLine?: { x1: number; y1: number; x2: number; y2: number } | null;
  activeReadout?: { x: number; y: number; text: string } | null;
}

export interface ChordToneSpan {
  id: string;
  chord: string;
  startBeat: number;
  endBeat: number;
  rootPc: number;
  chordPcs: Set<number>;
}

export function getSnapStepBeats(snap: PianoRollGridSnap, altPressed = false): number {
  if (altPressed || snap === 'off') return 0.01;
  switch (snap) {
    case '1': return 1;
    case '1/2': return 0.5;
    case '1/3': return 1 / 3;
    case '1/4': return 0.25;
    case '1/6': return 1 / 6;
    case '1/8': return 0.125;
    case '1/12': return 1 / 12;
    case '1/16': return 0.0625;
    default: return 0.25;
  }
}

export function midiToNoteName(midi: number): string {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_CLASSES[noteIndex]}${octave}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith('#')) return `rgba(104, 128, 173, ${alpha})`;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return `rgba(104, 128, 173, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function velocityToMidi127(vel: number): number {
  return Math.max(1, Math.min(127, Math.round(vel * 127)));
}

export function computeChordTonesMap(chordBlocks: ChordBlock[]): ChordToneSpan[] {
  const spans: ChordToneSpan[] = [];
  for (const block of chordBlocks || []) {
    if (!block || block.type === 'silence' || block.type === 'break') continue;
    try {
      const parsed = parseChord(block.chord);
      const notes = getChordNotes(block.chord, 4);
      if (!parsed || notes.length === 0) continue;

      const rootPc = noteToMod12(parsed.root);
      const chordPcs = new Set<number>(notes.map(n => noteToMod12(n)));
      if (block.bassNote) {
        chordPcs.add(noteToMod12(block.bassNote));
      } else if (parsed.bass) {
        chordPcs.add(noteToMod12(parsed.bass));
      }

      spans.push({
        id: block.id,
        chord: block.chord,
        startBeat: block.startBeat,
        endBeat: block.startBeat + block.durationBeats,
        rootPc,
        chordPcs
      });
    } catch {
      // Ignorar acordes no parseables
    }
  }
  return spans;
}

/**
 * Aplica rasgueo (Strum) agrupando notas simultáneas en acordes.
 */
export function applyStrumTransform(
  notes: MelodyNote[],
  opts: { spreadBeats: number; direction: 'up' | 'down' | 'alternate'; velocitySlope: number }
): Map<string, Partial<MelodyNote>> {
  const overrides = new Map<string, Partial<MelodyNote>>();
  if (!notes || notes.length === 0) return overrides;

  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  const groups: MelodyNote[][] = [];
  let currentGroup: MelodyNote[] = [];
  let groupAnchor = -Infinity;

  for (const note of sorted) {
    if (currentGroup.length === 0 || Math.abs(note.startBeat - groupAnchor) < 0.04) {
      if (currentGroup.length === 0) groupAnchor = note.startBeat;
      currentGroup.push(note);
    } else {
      groups.push(currentGroup);
      currentGroup = [note];
      groupAnchor = note.startBeat;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  groups.forEach((group, gIdx) => {
    if (group.length < 2) return;
    const ascending =
      opts.direction === 'up'
        ? true
        : opts.direction === 'down'
          ? false
          : gIdx % 2 === 0;

    const ordered = [...group].sort((a, b) => (ascending ? a.midi - b.midi : b.midi - a.midi));
    const len = ordered.length;

    ordered.forEach((note, idx) => {
      const tNorm = len > 1 ? idx / (len - 1) : 0;
      const delay = tNorm * Math.max(0, opts.spreadBeats);
      const anchorEnd = note.startBeat + note.durationBeats;
      const newStart = Math.max(0, Math.round((note.startBeat + delay) * 1000) / 1000);
      const newDuration = Math.max(0.0625, Math.round((anchorEnd - newStart) * 1000) / 1000);

      const baseVel = note.velocity ?? 0.8;
      const velShift = (tNorm - 0.5) * opts.velocitySlope;
      const newVel = Math.max(0.05, Math.min(1.0, Math.round((baseVel + velShift) * 100) / 100));

      overrides.set(note.id, {
        startBeat: newStart,
        durationBeats: newDuration,
        velocity: newVel
      });
    });
  });

  return overrides;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Humanización determinista por nota y semilla (timing + velocity).
 */
export function applyHumanizeTransform(
  notes: MelodyNote[],
  opts: { timingJitterBeats: number; velocityVariance: number; seed: number }
): Map<string, Partial<MelodyNote>> {
  const overrides = new Map<string, Partial<MelodyNote>>();
  if (!notes || notes.length === 0) return overrides;

  for (const note of notes) {
    const rng = mulberry32((opts.seed >>> 0) ^ hashString(note.id));
    const rTime = rng() * 2 - 1;
    const rVel = rng() * 2 - 1;

    const timeShift = rTime * Math.max(0, opts.timingJitterBeats);
    const velShift = rVel * Math.max(0, opts.velocityVariance);

    const newStart = Math.max(0, Math.round((note.startBeat + timeShift) * 1000) / 1000);
    const baseVel = note.velocity ?? 0.8;
    const newVel = Math.max(0.05, Math.min(1.0, Math.round((baseVel + velShift) * 100) / 100));

    overrides.set(note.id, {
      startBeat: newStart,
      velocity: newVel
    });
  }

  return overrides;
}

/**
 * Divide las notas objetivo en subdivisiones uniformes de tamaño `stepBeats`.
 */
export function applyQuickChopTransform(
  allNotes: MelodyNote[],
  targetIds: Set<string>,
  stepBeats: number
): { nextNotes: MelodyNote[]; createdIds: string[] } {
  const safeStep = Math.max(0.03125, stepBeats);
  const nextNotes: MelodyNote[] = [];
  const createdIds: string[] = [];

  for (const note of allNotes) {
    if (!targetIds.has(note.id) || note.durationBeats <= safeStep + 0.015) {
      nextNotes.push(note);
      continue;
    }

    let cursor = note.startBeat;
    const endBeat = note.startBeat + note.durationBeats;
    let first = true;

    while (cursor < endBeat - 0.015) {
      const segDur = Math.min(safeStep, endBeat - cursor);
      if (segDur < 0.015) break;

      const id = first ? note.id : generateId('chop');
      first = false;
      createdIds.push(id);
      nextNotes.push({
        id,
        note: note.note,
        midi: note.midi,
        startBeat: Math.round(cursor * 10000) / 10000,
        durationBeats: Math.round(segDur * 10000) / 10000,
        velocity: note.velocity ?? 0.8
      });
      cursor += segDur;
    }
  }

  return { nextNotes, createdIds };
}

/**
 * Invierte verticalmente (espejo de altura) o horizontalmente (retrógrado rítmico).
 */
export function applyFlipTransform(
  notes: MelodyNote[],
  mode: 'vertical' | 'horizontal'
): Map<string, Partial<MelodyNote>> {
  const overrides = new Map<string, Partial<MelodyNote>>();
  if (!notes || notes.length === 0) return overrides;

  if (mode === 'vertical') {
    let minMidi = Infinity;
    let maxMidi = -Infinity;
    for (const n of notes) {
      if (n.midi < minMidi) minMidi = n.midi;
      if (n.midi > maxMidi) maxMidi = n.midi;
    }
    const centerSum = minMidi + maxMidi;
    for (const n of notes) {
      const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, centerSum - n.midi));
      overrides.set(n.id, {
        midi: newMidi,
        note: midiToNoteName(newMidi)
      });
    }
  } else {
    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const n of notes) {
      if (n.startBeat < minStart) minStart = n.startBeat;
      if (n.startBeat + n.durationBeats > maxEnd) maxEnd = n.startBeat + n.durationBeats;
    }
    for (const n of notes) {
      const endBeat = n.startBeat + n.durationBeats;
      const newStart = Math.max(0, Math.round((minStart + (maxEnd - endBeat)) * 10000) / 10000);
      overrides.set(n.id, { startBeat: newStart });
    }
  }

  return overrides;
}

export interface SliceCutMatch {
  note: MelodyNote;
  cutBeat: number;
  cutX: number;
  cutY: number;
}

/**
 * Calcula intersecciones entre la línea de corte (en coordenadas mundo px) y las notas candidatas.
 */
export function computeSliceMatches(
  notes: MelodyNote[],
  selectedIds: Set<string>,
  line: { x1: number; y1: number; x2: number; y2: number },
  beatWidth: number,
  rowHeight: number,
  snapStep: number
): SliceCutMatch[] {
  if (!notes || notes.length === 0) return [];

  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;

  const findSegmentBoxCut = (note: MelodyNote): SliceCutMatch | null => {
    const row = MAX_MIDI - note.midi;
    const ny1 = row * rowHeight;
    const ny2 = ny1 + rowHeight;
    const nx1 = note.startBeat * beatWidth;
    const nx2 = (note.startBeat + note.durationBeats) * beatWidth;

    let t0 = 0;
    let t1 = 1;

    const clipTest = (p: number, q: number): boolean => {
      if (Math.abs(p) < 1e-8) {
        return q >= 0;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };

    if (
      !clipTest(-dx, line.x1 - nx1) ||
      !clipTest(dx, nx2 - line.x1) ||
      !clipTest(-dy, line.y1 - ny1) ||
      !clipTest(dy, ny2 - line.y1)
    ) {
      return null;
    }

    if (t1 < t0) return null;

    const tMid = (t0 + t1) * 0.5;
    const rawCutX = line.x1 + dx * tMid;
    const rawCutY = line.y1 + dy * tMid;
    const rawBeat = rawCutX / beatWidth;
    const cutBeat =
      snapStep > 0.015
        ? Math.round(rawBeat / snapStep) * snapStep
        : Math.round(rawBeat * 1000) / 1000;

    if (cutBeat <= note.startBeat + 0.02 || cutBeat >= note.startBeat + note.durationBeats - 0.02) {
      return null;
    }

    return {
      note,
      cutBeat,
      cutX: cutBeat * beatWidth,
      cutY: Math.max(ny1 + 2, Math.min(ny2 - 2, rawCutY))
    };
  };

  const allMatches: SliceCutMatch[] = [];
  for (const note of notes) {
    const m = findSegmentBoxCut(note);
    if (m) allMatches.push(m);
  }

  if (selectedIds.size > 0) {
    const selectedMatches = allMatches.filter(m => selectedIds.has(m.note.id));
    if (selectedMatches.length > 0) return selectedMatches;
  }

  return allMatches;
}
