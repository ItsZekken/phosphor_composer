/**
 * voicingEngine.ts
 * Motores de inversión, voicings (Drop 2, Drop 3, Open) y voice leading.
 */

import { noteToMidi, shiftOctave } from './pitchClass';
import { parseChord, getChordNotes } from './chordParser';

export type VoicingType = 'default' | 'open' | 'drop2' | 'drop3';

/**
 * Invierte las notas de un acorde de forma ordenada.
 * Ej: invertChord(["C4", "E4", "G4"], 1) -> ["E4", "G4", "C5"]
 */
export function invertChord(notes: string[], inversion: number): string[] {
  if (!notes || notes.length <= 1 || !inversion || inversion <= 0) {
    return notes ? [...notes] : [];
  }

  const sorted = [...notes].sort((a, b) => noteToMidi(a) - noteToMidi(b));
  const count = inversion % sorted.length;

  for (let i = 0; i < count; i++) {
    const note = sorted.shift()!;
    sorted.push(shiftOctave(note, 1));
  }

  return sorted.sort((a, b) => noteToMidi(a) - noteToMidi(b));
}

/**
 * Aplica voicings armónicos clásicos de piano y guitarra (Drop 2, Drop 3, Open).
 */
export function applyVoicing(notes: string[], voicing?: VoicingType | string): string[] {
  if (!notes || notes.length < 3 || !voicing || voicing === 'default') {
    return notes ? [...notes] : [];
  }

  const voiced = [...notes].sort((a, b) => noteToMidi(a) - noteToMidi(b));

  if (voicing === 'drop2') {
    // Drop 2: La 2da nota más alta se baja una octava
    const idx = voiced.length - 2;
    if (idx >= 0) {
      voiced[idx] = shiftOctave(voiced[idx], -1);
    }
  } else if (voicing === 'drop3') {
    // Drop 3: La 3ra nota más alta se baja una octava
    const idx = voiced.length - 3;
    if (idx >= 0) {
      voiced[idx] = shiftOctave(voiced[idx], -1);
    }
  } else if (voicing === 'open') {
    // Open voicing: Distribución abierta de notas
    if (voiced.length === 3) {
      return [voiced[0], voiced[2], shiftOctave(voiced[1], 1)].sort((a, b) => noteToMidi(a) - noteToMidi(b));
    } else if (voiced.length >= 4) {
      return [
        voiced[0],
        voiced[2],
        shiftOctave(voiced[1], 1),
        shiftOctave(voiced[3], 1)
      ].sort((a, b) => noteToMidi(a) - noteToMidi(b));
    }
  }

  return voiced.sort((a, b) => noteToMidi(a) - noteToMidi(b));
}

/**
 * Procesa un bloque de acorde completo generando sus notas con voicing, inversión y octava.
 */
export function getBlockNotes(options: {
  chord: string;
  voicing?: VoicingType | string;
  inversion?: number;
  octaveShift?: number;
  type?: 'play' | 'silence' | 'break' | 'bass-only' | 'chord-only';
  bassNote?: string;
}): string[] {
  const { chord, voicing = 'default', inversion = 0, octaveShift = 0, type = 'play', bassNote } = options;

  if (type === 'silence' || type === 'break') {
    return [];
  }

  let baseNotes = getChordNotes(chord, 4);
  if (baseNotes.length === 0) return [];

  // Si el acorde original traía slash chord o se definió un bassNote explícito
  const parsed = parseChord(chord);
  const rootNote = parsed ? parsed.root : baseNotes[0].replace(/[0-9-]/g, '');
  const finalBassNote = bassNote ? `${bassNote}2` : parsed?.bass ? `${parsed.bass}2` : `${rootNote}2`;

  if (voicing && voicing !== 'default') {
    baseNotes = applyVoicing(baseNotes, voicing);
  }

  if (inversion && inversion > 0) {
    baseNotes = invertChord(baseNotes, inversion);
  }

  if (octaveShift !== 0) {
    baseNotes = baseNotes.map(n => shiftOctave(n, octaveShift));
  }

  if (type === 'bass-only') {
    return [finalBassNote];
  }

  if (type === 'chord-only') {
    return baseNotes;
  }

  return [finalBassNote, ...baseNotes];
}
