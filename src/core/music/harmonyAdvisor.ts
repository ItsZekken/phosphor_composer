/**
 * harmonyAdvisor.ts
 * Motor de sugerencias armónicas contextuales (Markov + Teoría Funcional + Restricciones Melódicas).
 */

import type { NoteClass } from './pitchClass';
import { noteToMod12 } from './pitchClass';
import { parseChord, getChordNotes } from './chordParser';
import type { ScaleType } from './scaleDefinitions';
import { getDiatonicChords, getChordRomanDegree } from './scaleDefinitions';
import chordModelData from '../../engine/chordModel.json';

export interface ChordSuggestion {
  chord: string;
  probability: number;
  category: 'reposo' | 'tensión' | 'spicy' | 'subdominante' | 'exotic';
}

const CHORD_MODEL = chordModelData as {
  unigrams?: Record<string, number>;
  bigrams?: Record<string, Record<string, number>>;
  trigrams?: Record<string, Record<string, number>>;
};

/**
 * Genera variaciones armónicas realistas para un acorde base.
 */
function getChordVariations(chordBase: string, isDominant: boolean, isDiminished: boolean): string[] {
  const parsed = parseChord(chordBase);
  if (!parsed) return [chordBase];
  const root = parsed.root;

  if (isDiminished) {
    return [chordBase, `${root}m7b5`];
  }

  if (parsed.quality === 'minor') {
    return [chordBase, `${root}m7`, `${root}sus2`];
  }

  if (isDominant) {
    return [chordBase, `${root}7`, `${root}sus4`];
  }

  return [chordBase, `${root}maj7`, `${root}sus4`, `${root}sus2`];
}

/**
 * Sugiere continuaciones armónicas optimizadas según la progresión actual,
 * tonalidad, modelo de Markov y notas de la melodía activa.
 */
export function getHarmonicSuggestions(
  currentKey: NoteClass | string,
  currentScale: ScaleType,
  chordProgression: string[] = [],
  melodyPitchClasses?: number[]
): ChordSuggestion[] {
  // 1. Acordes diatónicos base
  const diatonicBases = getDiatonicChords(currentKey, currentScale);

  // 2. Acordes de intercambio modal (Spicy) de la escala paralela
  const parallelScale: ScaleType = currentScale === 'major' ? 'minor' : 'major';
  const parallelDiatonicBases = getDiatonicChords(currentKey, parallelScale);

  const rawSuggestions: { chord: string; baseProb: number; category: ChordSuggestion['category'] }[] = [];

  // Mapear acordes diatónicos base
  diatonicBases.forEach((chordBase, index) => {
    let category: ChordSuggestion['category'];
    let baseProb = 0.5;

    // Tónica, mediante, submediante (reposo / función de tónica)
    if (index === 0 || index === 2 || index === 5) {
      category = 'reposo';
      baseProb = index === 0 ? 0.82 : 0.65;
    } else if (index === 3 || index === 1) {
      // Subdominante / ii
      category = 'subdominante';
      baseProb = index === 3 ? 0.70 : 0.60;
    } else {
      // Dominante / Disminuido
      category = 'tensión';
      baseProb = index === 4 ? 0.75 : 0.55;
    }

    const isDominant = index === 4;
    const isDiminished = index === 6;

    const variations = getChordVariations(chordBase, isDominant, isDiminished);
    variations.forEach((varChord, varIndex) => {
      const probPenalty = varIndex * 0.07;
      rawSuggestions.push({
        chord: varChord,
        baseProb: Math.max(0.2, baseProb - probPenalty),
        category
      });
    });
  });

  // Agregar intercambio modal (Spicy)
  parallelDiatonicBases.forEach((chordBase, index) => {
    if (!diatonicBases.includes(chordBase)) {
      const isDominant = index === 4;
      const isDiminished = index === 6;
      const variations = getChordVariations(chordBase, isDominant, isDiminished);

      variations.forEach((varChord, varIndex) => {
        const probPenalty = varIndex * 0.05;
        rawSuggestions.push({
          chord: varChord,
          baseProb: Math.max(0.18, 0.40 - probPenalty),
          category: 'spicy'
        });
      });
    }
  });

  // Deduplicación inicial
  const seen = new Set<string>();
  const suggestions: ChordSuggestion[] = [];

  rawSuggestions.forEach(item => {
    if (!seen.has(item.chord)) {
      seen.add(item.chord);
      suggestions.push({
        chord: item.chord,
        probability: item.baseProb,
        category: item.category
      });
    }
  });

  // 3. Modulación probabilística con Cadenas de Markov
  if (chordProgression && chordProgression.length > 0) {
    const validChords = chordProgression.filter(c => !!c && c.trim().length > 0);
    const last1 = validChords[validChords.length - 1];
    const last2 = validChords.length > 1 ? validChords[validChords.length - 2] : null;

    const rom1 = last1 ? getChordRomanDegree(last1, currentKey, currentScale) : null;
    const rom2 = last2 ? getChordRomanDegree(last2, currentKey, currentScale) : null;

    let transitions: Record<string, number> | null = null;
    let isTrigramMatch = false;

    if (rom1 && rom2 && CHORD_MODEL.trigrams) {
      const trigramKey = `${rom2},${rom1}`;
      if (CHORD_MODEL.trigrams[trigramKey]) {
        transitions = CHORD_MODEL.trigrams[trigramKey];
        isTrigramMatch = true;
      }
    }

    if (!transitions && rom1 && CHORD_MODEL.bigrams && CHORD_MODEL.bigrams[rom1]) {
      transitions = CHORD_MODEL.bigrams[rom1];
    }

    if (transitions) {
      suggestions.forEach(sug => {
        const sugRom = getChordRomanDegree(sug.chord, currentKey, currentScale);
        if (sugRom && transitions![sugRom] !== undefined) {
          sug.probability = transitions![sugRom];
          if (isTrigramMatch) {
            sug.probability = Math.min(0.99, sug.probability + 0.12);
          }
        } else if (sug.category !== 'spicy') {
          sug.probability *= 0.45;
        }
      });
    }

    // Regla de resolución de dominante a tónica
    if (last1) {
      const lastClean = last1.trim();
      const isDominant = lastClean.includes('7') || lastClean.endsWith('sus4');

      suggestions.forEach(sug => {
        if (isDominant && !transitions && (sug.chord === diatonicBases[0] || sug.chord === `${diatonicBases[0]}maj7`)) {
          sug.probability += 0.20;
        }
        // Penalizar repetición inmediata exacta del mismo acorde
        if (sug.chord === lastClean) {
          sug.probability -= 0.30;
        }
      });
    }
  }

  // 4. Bonificación de notas melódicas concurrentes
  if (melodyPitchClasses && melodyPitchClasses.length > 0) {
    suggestions.forEach(sug => {
      try {
        const chordNotes = getChordNotes(sug.chord, 3);
        const chordPitchClasses = chordNotes.map(n => noteToMod12(n));

        let matches = 0;
        melodyPitchClasses.forEach(pc => {
          if (chordPitchClasses.includes(pc)) matches++;
        });

        if (matches > 0) {
          const bonus = (matches / melodyPitchClasses.length) * 0.40;
          sug.probability += bonus;
        }
      } catch (_) {}
    });
  }

  // Normalizar límites [0.05, 0.99]
  suggestions.forEach(sug => {
    sug.probability = Math.max(0.05, Math.min(0.99, sug.probability));
  });

  return suggestions.sort((a, b) => b.probability - a.probability);
}
