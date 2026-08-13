/**
 * keyAnalyzer.ts
 * Detección y análisis tonal de progresiones de acordes y notas melódicas.
 */

import type { NoteClass } from './pitchClass';
import { NOTE_CLASSES, noteToMod12 } from './pitchClass';
import { parseChord } from './chordParser';
import type { ScaleType } from './scaleDefinitions';
import { SCALE_INTERVALS } from './scaleDefinitions';

export interface KeyCandidate {
  key: NoteClass;
  scale: ScaleType;
  score: number;
  matchedChords: number;
  totalChords: number;
}

/**
 * Extrae las clases de pitch (0..11) contenidas en un acorde por su nombre.
 * Soporta sostenidos y bemoles sin fallar.
 */
export function getChordPitchClasses(chordName: string): number[] {
  const parsed = parseChord(chordName);
  if (!parsed) return [];

  const rootVal = noteToMod12(parsed.root);
  return parsed.intervals.map(i => (rootVal + i) % 12);
}

/**
 * Obtiene el conjunto de clases de pitch (0..11) de una escala.
 */
export function getScalePitchClasses(key: NoteClass | string, scale: ScaleType): Set<number> {
  const rootVal = noteToMod12(key);
  const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.major;
  const set = new Set<number>();
  intervals.forEach(i => set.add((rootVal + i) % 12));
  return set;
}

/**
 * Detecta la tonalidad y escala más probable a partir de una lista de acordes.
 * Soporta bemoles (Eb, Bb, Ab), modos diatónicos y bonificaciones tonales.
 */
export function detectKey(chordNames: string[]): { key: NoteClass; scale: ScaleType } | null {
  if (!chordNames || chordNames.length === 0) return null;

  const validChords = chordNames.filter(c => !!c && c.trim().length > 0);
  if (validChords.length === 0) return null;

  // Extraer todas las clases de pitch presentes
  const usedPitchClasses = new Set<number>();
  validChords.forEach(chord => {
    getChordPitchClasses(chord).forEach(pc => usedPitchClasses.add(pc));
  });

  const candidates: KeyCandidate[] = [];
  const scalesToEvaluate: ScaleType[] = ['major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian'];

  for (const scale of scalesToEvaluate) {
    for (const key of NOTE_CLASSES) {
      const scalePCs = getScalePitchClasses(key, scale);

      // Cuántas notas usadas encajan en esta escala
      let matchedNotes = 0;
      usedPitchClasses.forEach(pc => {
        if (scalePCs.has(pc)) matchedNotes++;
      });

      // Cuántos acordes encajan completamente
      let matchedChords = 0;
      validChords.forEach(chord => {
        const chordPCs = getChordPitchClasses(chord);
        const allFit = chordPCs.length > 0 && chordPCs.every(pc => scalePCs.has(pc));
        if (allFit) matchedChords++;
      });

      const noteScore = usedPitchClasses.size > 0 ? matchedNotes / usedPitchClasses.size : 0;
      const chordScore = validChords.length > 0 ? matchedChords / validChords.length : 0;

      // El primer acorde otorga una fuerte pista de tónica
      const firstParsed = parseChord(validChords[0]);
      const tonicBonus = (firstParsed && firstParsed.root === key) ? 0.18 : 0;

      // El último acorde también sugiere resolución cadencial
      const lastParsed = parseChord(validChords[validChords.length - 1]);
      const cadenceBonus = (lastParsed && lastParsed.root === key) ? 0.08 : 0;

      // Ligera preferencia por tonalidades mayores/menores tradicionales
      const simplicityBonus = (scale === 'major' || scale === 'minor') ? 0.05 : 0;

      const score = (noteScore * 0.35) + (chordScore * 0.40) + tonicBonus + cadenceBonus + simplicityBonus;

      candidates.push({
        key,
        scale,
        score,
        matchedChords,
        totalChords: validChords.length
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.25) return null;

  return { key: best.key, scale: best.scale };
}
