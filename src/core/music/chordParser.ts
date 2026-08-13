/**
 * chordParser.ts
 * Parser universal de acordes, calidades armónicas y slash chords.
 */

import type { NoteClass } from './pitchClass';
import { normalizePitchClass, noteToMod12, mod12ToNote, NOTE_CLASSES } from './pitchClass';

export type ChordQuality = 
  | 'major' 
  | 'minor' 
  | 'dominant7' 
  | 'major7' 
  | 'minor7' 
  | 'diminished' 
  | 'augmented' 
  | 'halfDiminished' 
  | 'sus4' 
  | 'sus2'
  | 'major6'
  | 'minor6';

export interface ParsedChord {
  raw: string;
  root: NoteClass;
  quality: ChordQuality;
  qualitySuffix: string;
  bass?: NoteClass;
  intervals: number[];
}

/** Mapa de calidades y sus intervalos de semitonos relativos a la tónica */
const CHORD_INTERVAL_MAP: Record<string, { quality: ChordQuality; intervals: number[]; canonicalSuffix: string }> = {
  // Tríadas mayores
  '': { quality: 'major', intervals: [0, 4, 7], canonicalSuffix: '' },
  'maj': { quality: 'major', intervals: [0, 4, 7], canonicalSuffix: '' },
  'M': { quality: 'major', intervals: [0, 4, 7], canonicalSuffix: '' },

  // Tríadas menores
  'm': { quality: 'minor', intervals: [0, 3, 7], canonicalSuffix: 'm' },
  'min': { quality: 'minor', intervals: [0, 3, 7], canonicalSuffix: 'm' },
  '-': { quality: 'minor', intervals: [0, 3, 7], canonicalSuffix: 'm' },

  // Séptima dominante
  '7': { quality: 'dominant7', intervals: [0, 4, 7, 10], canonicalSuffix: '7' },
  'dom7': { quality: 'dominant7', intervals: [0, 4, 7, 10], canonicalSuffix: '7' },

  // Séptima mayor
  'maj7': { quality: 'major7', intervals: [0, 4, 7, 11], canonicalSuffix: 'maj7' },
  'M7': { quality: 'major7', intervals: [0, 4, 7, 11], canonicalSuffix: 'maj7' },
  'Δ': { quality: 'major7', intervals: [0, 4, 7, 11], canonicalSuffix: 'maj7' },

  // Séptima menor
  'm7': { quality: 'minor7', intervals: [0, 3, 7, 10], canonicalSuffix: 'm7' },
  'min7': { quality: 'minor7', intervals: [0, 3, 7, 10], canonicalSuffix: 'm7' },
  '-7': { quality: 'minor7', intervals: [0, 3, 7, 10], canonicalSuffix: 'm7' },

  // Disminuidos
  'dim': { quality: 'diminished', intervals: [0, 3, 6], canonicalSuffix: 'dim' },
  '°': { quality: 'diminished', intervals: [0, 3, 6], canonicalSuffix: 'dim' },

  // Aumentados
  'aug': { quality: 'augmented', intervals: [0, 4, 8], canonicalSuffix: 'aug' },
  '+': { quality: 'augmented', intervals: [0, 4, 8], canonicalSuffix: 'aug' },

  // Semidisminuido / m7b5
  'm7b5': { quality: 'halfDiminished', intervals: [0, 3, 6, 10], canonicalSuffix: 'm7b5' },
  'ø': { quality: 'halfDiminished', intervals: [0, 3, 6, 10], canonicalSuffix: 'm7b5' },
  'half-dim': { quality: 'halfDiminished', intervals: [0, 3, 6, 10], canonicalSuffix: 'm7b5' },

  // Suspendidos
  'sus4': { quality: 'sus4', intervals: [0, 5, 7], canonicalSuffix: 'sus4' },
  'sus': { quality: 'sus4', intervals: [0, 5, 7], canonicalSuffix: 'sus4' },
  'sus2': { quality: 'sus2', intervals: [0, 2, 7], canonicalSuffix: 'sus2' },

  // Sextas
  '6': { quality: 'major6', intervals: [0, 4, 7, 9], canonicalSuffix: '6' },
  'm6': { quality: 'minor6', intervals: [0, 3, 7, 9], canonicalSuffix: 'm6' }
};

/**
 * Parsea una cadena de acorde de forma determinista y tolerante.
 * Soporta tónicas con sostenidos (#) y bemoles (b), calidades y bajos de slash (ej: "Ebmaj7/G").
 */
export function parseChord(chordStr: string): ParsedChord | null {
  if (!chordStr || typeof chordStr !== 'string') return null;
  const clean = chordStr.trim();
  if (!clean) return null;

  // Separar slash chord si existe (ej: "C/E", "F#m7/A")
  const [basePart, bassPart] = clean.split('/');

  // Extraer tónica de la base (soporta A-G con # o b)
  const rootMatch = basePart.match(/^([A-G][#b]?)(.*)$/i);
  if (!rootMatch) return null;

  const rawRoot = rootMatch[1];
  const rawSuffix = rootMatch[2].trim();
  const root = normalizePitchClass(rawRoot);

  const matchedQuality = CHORD_INTERVAL_MAP[rawSuffix] || CHORD_INTERVAL_MAP[rawSuffix.toLowerCase()] || {
    quality: rawSuffix.includes('m') ? 'minor' : 'major',
    intervals: rawSuffix.includes('m') ? [0, 3, 7] : [0, 4, 7],
    canonicalSuffix: rawSuffix
  };

  const bass = bassPart ? normalizePitchClass(bassPart) : undefined;

  return {
    raw: clean,
    root,
    quality: matchedQuality.quality,
    qualitySuffix: matchedQuality.canonicalSuffix,
    bass,
    intervals: matchedQuality.intervals
  };
}

/**
 * Obtiene las notas absolutas de un acorde en una octava base dada.
 * Si incluye bajo de slash chord, lo sitúa una octava por debajo.
 */
export function getChordNotes(chordName: string, baseOctave = 3): string[] {
  const parsed = parseChord(chordName);
  if (!parsed) return [];

  const rootVal = noteToMod12(parsed.root);
  const chordNotes = parsed.intervals.map(interval => {
    const totalVal = rootVal + interval;
    const noteClass = mod12ToNote(totalVal);
    const octave = baseOctave + Math.floor(totalVal / 12);
    return `${noteClass}${octave}`;
  });

  if (parsed.bass) {
    const bassOctave = baseOctave - 1;
    return [`${parsed.bass}${bassOctave}`, ...chordNotes];
  }

  return chordNotes;
}

/**
 * Transpone el nombre de un acorde por un número de semitonos preservando calidad y slash bass.
 * Ej: transposeChordName("C/E", 2) -> "D/F#", transposeChordName("Bbmaj7", 1) -> "Bmaj7"
 */
export function transposeChordName(chordName: string, semitones: number): string {
  if (semitones === 0 || !chordName) return chordName;
  const parsed = parseChord(chordName);
  if (!parsed) return chordName;

  const currentRootVal = NOTE_CLASSES.indexOf(parsed.root);
  const newRootVal = (((currentRootVal + semitones) % 12) + 12) % 12;
  const newRoot = NOTE_CLASSES[newRootVal];

  let result = `${newRoot}${parsed.qualitySuffix}`;

  if (parsed.bass) {
    const currentBassVal = NOTE_CLASSES.indexOf(parsed.bass);
    const newBassVal = (((currentBassVal + semitones) % 12) + 12) % 12;
    result += `/${NOTE_CLASSES[newBassVal]}`;
  }

  return result;
}
