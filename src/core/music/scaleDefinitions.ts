/**
 * scaleDefinitions.ts
 * Definición de escalas, modos diatónicos, generación de acordes y análisis de grados romanos.
 */

import type { NoteClass } from './pitchClass';
import { normalizePitchClass, noteToMod12, mod12ToNote } from './pitchClass';
import { parseChord, getChordNotes } from './chordParser';

export type ScaleType = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian' | 'phrygian' | 'locrian';

export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10], // natural minor / Aeolian
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  locrian:    [0, 1, 3, 5, 6, 8, 10]
};

export const DIATONIC_CHORDS: Record<ScaleType, string[]> = {
  major:      ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  minor:      ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
  dorian:     ['i', 'ii', 'III', 'IV', 'v', 'vi°', 'VII'],
  mixolydian: ['I', 'ii', 'iii°', 'IV', 'v', 'vi', 'bVII'],
  lydian:     ['I', 'II', 'iii', '#iv°', 'V', 'vi', 'vii'],
  phrygian:   ['i', 'bII', 'III', 'iv', 'v°', 'VI', 'vii'],
  locrian:    ['i°', 'bII', 'biii', 'iv', 'bV', 'VI', 'vii']
};

/**
 * Obtiene las notas con octava correspondientes a una escala dada su tónica y tipo.
 * Ej: getScaleNotes('C', 'major', 4) -> ["C4", "D4", "E4", "F4", "G4", "A4", "B4"]
 */
export function getScaleNotes(key: NoteClass | string, scaleType: ScaleType, octave = 4): string[] {
  const normKey = normalizePitchClass(key);
  const rootValue = noteToMod12(normKey);
  const intervals = SCALE_INTERVALS[scaleType] || SCALE_INTERVALS.major;

  return intervals.map(interval => {
    const val = rootValue + interval;
    const noteClass = mod12ToNote(val);
    const calculatedOctave = octave + Math.floor(val / 12);
    return `${noteClass}${calculatedOctave}`;
  });
}

/**
 * Genera la paleta de acordes diatónicos base para una escala dada.
 * Ej: getDiatonicChords('C', 'major') -> ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]
 */
export function getDiatonicChords(key: NoteClass | string, scaleType: ScaleType): string[] {
  const normKey = normalizePitchClass(key);
  const rootVal = noteToMod12(normKey);
  const intervals = SCALE_INTERVALS[scaleType] || SCALE_INTERVALS.major;

  return intervals.map((interval, index) => {
    const noteVal = (rootVal + interval) % 12;
    const noteName = mod12ToNote(noteVal);

    let suffix = '';
    if (scaleType === 'major') {
      const qualities = ['', 'm', 'm', '', '', 'm', 'dim'];
      suffix = qualities[index];
    } else if (scaleType === 'minor') {
      const qualities = ['m', 'dim', '', 'm', 'm', '', ''];
      suffix = qualities[index];
    } else {
      // Deducir tercera y quinta diatónica para modos
      const thirdInterval = (intervals[(index + 2) % 7] - interval + 12) % 12;
      const fifthInterval = (intervals[(index + 4) % 7] - interval + 12) % 12;

      if (thirdInterval === 3) {
        suffix = fifthInterval === 6 ? 'dim' : 'm';
      } else if (thirdInterval === 4) {
        suffix = fifthInterval === 8 ? 'aug' : '';
      }
    }

    return `${noteName}${suffix}`;
  });
}

/**
 * Verifica si todas las clases de pitch de un acorde pertenecen a la escala actual.
 */
export function isChordInScale(chordName: string, key: NoteClass | string, scaleType: ScaleType): boolean {
  if (!chordName) return true;
  try {
    const chordNotes = getChordNotes(chordName, 3).map(n => noteToMod12(n));
    const scaleNotes = getScaleNotes(key, scaleType, 3).map(n => noteToMod12(n));
    return chordNotes.every(note => scaleNotes.includes(note));
  } catch (_) {
    return false;
  }
}

/**
 * Obtiene variaciones y extensiones armónicas para un acorde base dado.
 */
export function getExtensionsForChord(
  chordName: string,
  key: NoteClass | string,
  scaleType: ScaleType,
  inScaleOnly = true
): string[] {
  const parsed = parseChord(chordName);
  if (!parsed) return [];

  const root = parsed.root;
  const allExtensions = [
    root,                      // Tríada Mayor
    `${root}m`,                // Menor
    `${root}maj7`,             // Séptima Mayor
    `${root}m7`,               // Séptima Menor
    `${root}7`,                // Séptima Dominante
    `${root}sus4`,             // Suspendido 4
    `${root}sus2`,             // Suspendido 2
    `${root}dim`,              // Disminuido
    `${root}m7b5`              // Semidisminuido
  ];

  const uniqueExts = Array.from(new Set(allExtensions)).filter(ext => ext !== chordName);
  if (inScaleOnly) {
    return uniqueExts.filter(ext => isChordInScale(ext, key, scaleType));
  }
  return uniqueExts;
}

/**
 * Calcula el análisis de grado romano (ej: "I", "ii", "IV", "V7", "bVI", "bVII") de un acorde
 * en el contexto de una escala y tónica.
 */
export function getChordRomanDegree(chordName: string, key: NoteClass | string, scaleType: ScaleType): string {
  const parsed = parseChord(chordName);
  if (!parsed) return '';

  const rootVal = noteToMod12(parsed.root);
  const keyVal = noteToMod12(key);
  const interval = (rootVal - keyVal + 12) % 12;

  const scaleIntervals = SCALE_INTERVALS[scaleType] || SCALE_INTERVALS.major;
  const diatonicChords = DIATONIC_CHORDS[scaleType] || DIATONIC_CHORDS.major;

  const idx = scaleIntervals.indexOf(interval);
  if (idx !== -1) {
    return diatonicChords[idx];
  }

  // Acordes cromáticos y de intercambio modal
  const chromaticMap: Record<number, string> = {
    1: 'bII',
    3: 'bIII',
    6: '#IV',
    8: 'bVI',
    10: 'bVII'
  };

  const baseDegree = chromaticMap[interval] || 'X';
  const isMinor = parsed.quality === 'minor' || parsed.quality === 'minor7' || parsed.quality === 'diminished' || parsed.quality === 'halfDiminished';

  return isMinor ? baseDegree.toLowerCase() : baseDegree;
}
