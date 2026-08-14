/**
 * scaleFinder.ts
 * Encuentra y clasifica las escalas musicales que mejor coinciden con un conjunto de clases de pitch (0-11).
 */

import type { NoteClass } from './pitchClass';
import { NOTE_CLASSES, mod12ToNote } from './pitchClass';
import type { ScaleType } from './scaleDefinitions';
import { SCALE_INTERVALS } from './scaleDefinitions';

export interface ScaleMatch {
  key: NoteClass;
  scale: ScaleType;
  label: string;
  matchedCount: number;
  totalNotes: number;
  matchPercentage: number;
  isCurrent: boolean;
}

const SCALE_TYPE_LABELS: Record<ScaleType, string> = {
  major: 'Mayor',
  minor: 'Menor',
  dorian: 'Dórico',
  mixolydian: 'Mixolidio',
  lydian: 'Lidio',
  phrygian: 'Frigio',
  locrian: 'Locrio'
};

/**
 * Encuentra y clasifica las escalas musicales que mejor coinciden con un conjunto de clases de pitch (0-11).
 */
export function findMatchingScales(
  pitchClasses: number[],
  currentKey?: NoteClass,
  currentScale?: ScaleType,
  limit = 5
): ScaleMatch[] {
  if (!pitchClasses || pitchClasses.length === 0) return [];

  const uniquePitches = Array.from(new Set(pitchClasses));
  const results: (ScaleMatch & { score: number })[] = [];

  for (const root of NOTE_CLASSES) {
    const rootVal = NOTE_CLASSES.indexOf(root);
    for (const scaleType of Object.keys(SCALE_INTERVALS) as ScaleType[]) {
      const intervals = SCALE_INTERVALS[scaleType];
      const scalePitches = new Set(intervals.map(i => (rootVal + i) % 12));

      let matchedCount = 0;
      for (const pc of uniquePitches) {
        if (scalePitches.has(pc)) matchedCount++;
      }

      const matchPercentage = Math.round((matchedCount / uniquePitches.length) * 100);

      // Incluir escalas con al menos 50% de coincidencia
      if (matchPercentage >= 50) {
        const isCurrent = root === currentKey && scaleType === currentScale;

        // Puntuación: porcentaje de coincidencia base + bonificación para escalas tradicionales y escala activa
        let score = matchPercentage * 10;
        if (scaleType === 'major' || scaleType === 'minor') score += 5;
        if (isCurrent) score += 2;

        results.push({
          key: root,
          scale: scaleType,
          label: `${root} ${SCALE_TYPE_LABELS[scaleType]}`,
          matchedCount,
          totalNotes: uniquePitches.length,
          matchPercentage,
          isCurrent,
          score
        });
      }
    }
  }

  // Ordenar por score descendente (porcentaje de coincidencia primero)
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

/**
 * Formatea un array de clases de pitch (0-11) a sus nombres de nota legibles (ej: "C, E, G")
 */
export function formatPitchClasses(pitchClasses: number[]): string {
  if (!pitchClasses || pitchClasses.length === 0) return '';
  const unique = Array.from(new Set(pitchClasses)).sort((a, b) => a - b);
  return unique.map(pc => mod12ToNote(pc)).join(', ');
}
