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
  // En tonalidades menores, incluir la 7ma mayor (sensible de la menor armónica)
  // para permitir acordes V mayor y vii° característicos
  if (scale === 'minor') {
    set.add((rootVal + 11) % 12);
  }
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

  // Pre-parsear clases de pitch por acorde UNA sola vez (72x más rápido en canciones largas)
  const chordPcsList: number[][] = [];
  const usedPitchClasses = new Set<number>();
  for (let i = 0; i < validChords.length; i++) {
    const pcs = getChordPitchClasses(validChords[i]);
    chordPcsList.push(pcs);
    for (let j = 0; j < pcs.length; j++) {
      usedPitchClasses.add(pcs[j]);
    }
  }

  const firstParsed = parseChord(validChords[0]);
  const lastParsed = parseChord(validChords[validChords.length - 1]);

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
      for (let i = 0; i < chordPcsList.length; i++) {
        const chordPCs = chordPcsList[i];
        if (chordPCs.length === 0) continue;
        let allFit = true;
        for (let j = 0; j < chordPCs.length; j++) {
          if (!scalePCs.has(chordPCs[j])) {
            allFit = false;
            break;
          }
        }
        if (allFit) matchedChords++;
      }

      const noteScore = usedPitchClasses.size > 0 ? matchedNotes / usedPitchClasses.size : 0;
      const chordScore = validChords.length > 0 ? matchedChords / validChords.length : 0;

      // El primer acorde otorga una fuerte pista de tónica (considerando su modalidad mayor/menor)
      let tonicBonus = 0;
      if (firstParsed && firstParsed.root === key) {
        const isFirstMinor = firstParsed.quality === 'minor' || firstParsed.quality === 'minor7';
        const isScaleMinor = scale === 'minor' || scale === 'dorian' || scale === 'phrygian';
        if (isFirstMinor && isScaleMinor) {
          tonicBonus = 0.22;
        } else if (!isFirstMinor && !isScaleMinor) {
          tonicBonus = 0.22;
        }
      }

      // El último acorde también sugiere resolución cadencial
      let cadenceBonus = 0;
      if (lastParsed && lastParsed.root === key) {
        const isLastMinor = lastParsed.quality === 'minor' || lastParsed.quality === 'minor7';
        const isScaleMinor = scale === 'minor' || scale === 'dorian' || scale === 'phrygian';
        if (isLastMinor && isScaleMinor) {
          cadenceBonus = 0.10;
        } else if (!isLastMinor && !isScaleMinor) {
          cadenceBonus = 0.10;
        }
      }

      // Preferencia por tonalidades mayores/menores tradicionales frente a modos con notas idénticas
      const simplicityBonus = (scale === 'major' || scale === 'minor') ? 0.10 : 0;

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
