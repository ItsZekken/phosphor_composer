/**
 * pitchClass.ts
 * Dominio canónico para representación de notas, clases de pitch (0..11)
 * y operaciones de afinación / enarmonía.
 */

export type NoteClass = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type EnharmonicFlat = 'Db' | 'Eb' | 'Gb' | 'Ab' | 'Bb';

export type AnyPitchName = NoteClass | EnharmonicFlat | 'Cb' | 'Fb' | 'B#' | 'E#';

/** Array canónico de nombres de notas con sostenidos */
export const NOTE_CLASSES: readonly NoteClass[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
] as const;

/** Mapa de normalización enarmónica hacia sostenidos canónicos */
export const ENHARMONIC_TO_SHARP: Record<string, NoteClass> = {
  'C': 'C',
  'B#': 'C',
  'C#': 'C#',
  'DB': 'C#',
  'Db': 'C#',
  'D': 'D',
  'D#': 'D#',
  'EB': 'D#',
  'Eb': 'D#',
  'E': 'E',
  'FB': 'E',
  'Fb': 'E',
  'F': 'F',
  'E#': 'F',
  'F#': 'F#',
  'GB': 'F#',
  'Gb': 'F#',
  'G': 'G',
  'G#': 'G#',
  'AB': 'G#',
  'Ab': 'G#',
  'A': 'A',
  'A#': 'A#',
  'BB': 'A#',
  'Bb': 'A#',
  'B': 'B',
  'CB': 'B',
  'Cb': 'B'
};

/**
 * Normaliza cualquier nombre de pitch (incluyendo bemoles o enarmonías raras) a su NoteClass canónica.
 * Ej: "Db" -> "C#", "Bb" -> "A#", "c" -> "C"
 */
export function normalizePitchClass(pitch: string): NoteClass {
  if (!pitch) return 'C';
  const clean = pitch.trim();
  const formatted = clean.length > 1
    ? clean[0].toUpperCase() + (clean[1] === 'b' ? 'b' : clean[1] === '#' ? '#' : '')
    : clean.toUpperCase();
  return ENHARMONIC_TO_SHARP[formatted] || ENHARMONIC_TO_SHARP[clean.toUpperCase()] || 'C';
}

/**
 * Convierte un nombre de nota (con o sin octava) a su valor numérico de pitch class (0..11).
 * Ej: "C" -> 0, "C#" -> 1, "Db" -> 1, "A4" -> 9, "Bb3" -> 10
 */
export function noteToMod12(note: string): number {
  if (!note) return 0;
  const pitchOnly = note.replace(/[0-9-]/g, '').trim();
  const normalized = normalizePitchClass(pitchOnly);
  const idx = NOTE_CLASSES.indexOf(normalized);
  return idx !== -1 ? idx : 0;
}

/**
 * Convierte un número mod-12 (o cualquier entero) a su NoteClass correspondiente (0..11).
 * Ej: 0 -> "C", 1 -> "C#", 12 -> "C", -1 -> "B"
 */
export function mod12ToNote(val: number): NoteClass {
  const norm = ((val % 12) + 12) % 12;
  return NOTE_CLASSES[norm];
}

/**
 * Convierte un nombre de nota con octava a su número MIDI absoluto (0..127).
 * Ej: "C4" -> 60, "A4" -> 69, "C-1" -> 0
 */
export function noteToMidi(noteName: string): number {
  if (!noteName) return 60;
  const match = noteName.match(/^([A-G][#b]?)(-?[0-9])$/i);
  if (!match) return 60;

  const pitch = match[1];
  const octave = parseInt(match[2], 10);
  const mod12 = noteToMod12(pitch);

  return 12 * (octave + 1) + mod12;
}

export const noteNameToMidi = noteToMidi;

/**
 * Convierte un número MIDI (0..127) a su nombre de nota estándar con octava.
 * Ej: 60 -> "C4", 69 -> "A4", 61 -> "C#4"
 */
export function midiToNote(midi: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const mod12 = clamped % 12;
  const octave = Math.floor(clamped / 12) - 1;
  return `${NOTE_CLASSES[mod12]}${octave}`;
}

export const midiToNoteName = midiToNote;

/**
 * Desplaza una nota con octava un número dado de octavas enteras.
 * Ej: shiftOctave("C4", 1) -> "C5", shiftOctave("F#3", -2) -> "F#1"
 */
export function shiftOctave(noteName: string, octaveOffset: number): string {
  if (octaveOffset === 0 || !noteName) return noteName;
  const match = noteName.match(/^([A-G][#b]?)(-?[0-9])$/i);
  if (!match) return noteName;

  const pitch = normalizePitchClass(match[1]);
  const octave = parseInt(match[2], 10);
  const newOctave = Math.max(-1, Math.min(9, octave + octaveOffset));
  return `${pitch}${newOctave}`;
}

/**
 * Transpone una nota con octava por un número de semitonos.
 * Ej: transposeNote("C4", 2) -> "D4", transposeNote("C4", -1) -> "B3"
 */
export function transposeNote(noteName: string, semitones: number): string {
  if (semitones === 0 || !noteName) return noteName;
  const midi = noteToMidi(noteName);
  return midiToNote(midi + semitones);
}
