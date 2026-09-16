/**
 * harmonyAdvisor.ts
 * Motor de sugerencias armónicas contextuales (Markov + Teoría Funcional + Restricciones Melódicas).
 */

import type { NoteClass } from './pitchClass';
import { noteToMod12, mod12ToNote } from './pitchClass';
import { parseChord, getChordNotes } from './chordParser';
import type { ScaleType } from './scaleDefinitions';
import { getDiatonicChords, getChordRomanDegree, getModalBorrowChords } from './scaleDefinitions';
import chordModelData from './chordModel.json';

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
 * Genera el set completo de variaciones para un acorde base según su rol en la paleta.
 * Cubre las filas de la matriz: Tríada, 7th, sus2, sus4, 6th, aug, modal.
 */
function getChordVariations(chordBase: string, isDominant: boolean, isDiminished: boolean): { chord: string; factor: number }[] {
  const parsed = parseChord(chordBase);
  if (!parsed) return [{ chord: chordBase, factor: 1.0 }];
  const root = parsed.root;
  const isMinor = parsed.quality === 'minor';

  if (isDiminished) {
    return [
      { chord: chordBase, factor: 1.0 },
      { chord: `${root}m7b5`, factor: 0.95 },
      { chord: `${root}dim`, factor: 0.90 },
      { chord: `${root}sus4`, factor: 0.65 },
      { chord: `${root}sus2`, factor: 0.65 },
      { chord: `${root}m`, factor: 0.70 }
    ];
  }

  if (isMinor) {
    return [
      { chord: chordBase, factor: 1.0 },
      { chord: `${root}m7`, factor: 0.95 },
      { chord: `${root}sus2`, factor: 0.85 },
      { chord: `${root}sus4`, factor: 0.82 },
      { chord: `${root}m6`, factor: 0.80 },
      { chord: `${root}`, factor: 0.68 },
      { chord: `${root}aug`, factor: 0.50 }
    ];
  }

  if (isDominant) {
    return [
      { chord: chordBase, factor: 1.0 },
      { chord: `${root}7`, factor: 0.98 },
      { chord: `${root}sus4`, factor: 0.84 },
      { chord: `${root}sus2`, factor: 0.82 },
      { chord: `${root}6`, factor: 0.78 },
      { chord: `${root}m`, factor: 0.60 },
      { chord: `${root}aug`, factor: 0.55 }
    ];
  }

  // Acordes mayores diatónicos (I, IV, etc.)
  return [
    { chord: chordBase, factor: 1.0 },
    { chord: `${root}maj7`, factor: 0.94 },
    { chord: `${root}sus4`, factor: 0.83 },
    { chord: `${root}sus2`, factor: 0.85 },
    { chord: `${root}6`, factor: 0.80 },
    { chord: `${root}m`, factor: 0.60 },
    { chord: `${root}aug`, factor: 0.50 }
  ];
}

/**
 * Calcula las notas comunes compartidas entre dos acordes para bonificar
 * la conducción suave de voces (Voice Leading).
 */
function getSharedPitchClassesCount(chordA: string, chordB: string): number {
  try {
    const notesA = getChordNotes(chordA, 3);
    const notesB = getChordNotes(chordB, 3);
    const pcsA = new Set(notesA.map(n => noteToMod12(n)));
    let shared = 0;
    notesB.forEach(n => {
      if (pcsA.has(noteToMod12(n))) shared++;
    });
    return shared;
  } catch {
    return 0;
  }
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
  const modalBorrow = getModalBorrowChords(currentKey, currentScale);

  // Extraer el acorde previo y el anterior para contexto de Markov
  const validChords = (chordProgression || []).filter(c => !!c && c.trim().length > 0);
  const last1 = validChords.length > 0 ? validChords[validChords.length - 1].trim() : null;
  const last2 = validChords.length > 1 ? validChords[validChords.length - 2].trim() : null;

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

  if (!transitions && rom1 && CHORD_MODEL.bigrams) {
    if (CHORD_MODEL.bigrams[rom1]) {
      transitions = CHORD_MODEL.bigrams[rom1];
    } else {
      // Intentar con el grado base si el acorde tenía sufijo (ej: V7 -> V)
      const baseRom = rom1.replace(/7|sus[24]|maj7|m7|m6|6|aug/g, '');
      if (baseRom && CHORD_MODEL.bigrams[baseRom]) {
        transitions = CHORD_MODEL.bigrams[baseRom];
      }
    }
  }

  const maxTrans = transitions && Object.keys(transitions).length > 0
    ? Math.max(...Object.values(transitions))
    : 0.5;

  const rawSuggestions: { chord: string; baseProb: number; category: ChordSuggestion['category'] }[] = [];

  // 3. Procesar acordes diatónicos base
  diatonicBases.forEach((chordBase, index) => {
    let category: ChordSuggestion['category'];
    const isDominant = index === 4;
    const isDiminished = index === 6 || (currentScale === 'minor' && index === 1);

    if (currentScale === 'major') {
      if (index === 0 || index === 2 || index === 5) category = 'reposo'; // I, iii, vi
      else if (index === 3 || index === 1) category = 'subdominante'; // IV, ii
      else category = 'tensión'; // V, vii°
    } else {
      if (index === 0 || index === 2 || index === 5) category = 'reposo'; // i, III, VI
      else if (index === 3 || index === 1) category = 'subdominante'; // iv, ii°
      else category = 'tensión'; // v/V, VII
    }

    const chordRom = getChordRomanDegree(chordBase, currentKey, currentScale);

    // Calcular probabilidad base del grado según contexto
    let degreeProb = 0.5;

    if (!last1) {
      // Sin acordes previos: sugerencias de apertura según función tonal
      if (currentScale === 'major') {
        if (index === 0) degreeProb = 0.92;      // I
        else if (index === 5) degreeProb = 0.78; // vi
        else if (index === 3) degreeProb = 0.74; // IV
        else if (index === 4) degreeProb = 0.65; // V
        else if (index === 1) degreeProb = 0.55; // ii
        else if (index === 2) degreeProb = 0.45; // iii
        else degreeProb = 0.22;                  // vii°
      } else {
        if (index === 0) degreeProb = 0.92;      // i
        else if (index === 5) degreeProb = 0.78; // VI
        else if (index === 3) degreeProb = 0.74; // iv
        else if (index === 4) degreeProb = 0.70; // V / v
        else if (index === 2) degreeProb = 0.55; // III
        else if (index === 6) degreeProb = 0.50; // VII
        else degreeProb = 0.25;                  // ii°
      }
    } else {
      // Con acordes previos: evaluar modelo de transición de Markov
      if (transitions && transitions[chordRom] !== undefined) {
        const transVal = transitions[chordRom];
        // Escalar relativamente al valor máximo de transición para dar claridad a la recomendación
        degreeProb = (transVal / maxTrans) * 0.92;
        if (isTrigramMatch) {
          degreeProb = Math.min(0.98, degreeProb + 0.08);
        }
      } else {
        // Acorde diatónico fuera de la tabla de transición inmediata
        if (last1 === chordBase) {
          // Penalización de repetición inmediata
          degreeProb = 0.18;
        } else if (isDominant && (rom1 === 'IV' || rom1 === 'ii')) {
          // Resolución armónica clásica hacia dominante
          degreeProb = 0.82;
        } else if ((chordRom === 'I' || chordRom === 'i') && (rom1 === 'V' || rom1 === 'V7' || rom1 === 'vii°')) {
          // Resolución cadencial perfecta
          degreeProb = 0.95;
        } else {
          degreeProb = Math.max(0.15, 0.32 - index * 0.02);
        }
      }
    }

    // Generar variaciones de la matriz para este grado
    const variations = getChordVariations(chordBase, isDominant, isDiminished);
    variations.forEach(v => {
      let finalProb = degreeProb * v.factor;

      // Bonificación de conducción de voces (Voice Leading suave con last1)
      if (last1 && v.chord !== last1) {
        const sharedPcs = getSharedPitchClassesCount(last1, v.chord);
        finalProb += Math.min(0.06, sharedPcs * 0.02);
      }

      rawSuggestions.push({
        chord: v.chord,
        baseProb: finalProb,
        category
      });
    });
  });

  // 4. Agregar acordes de intercambio modal clasificados
  modalBorrow.forEach(mb => {
    let prob = 0.32;
    if (transitions && transitions[mb.roman] !== undefined) {
      prob = (transitions[mb.roman] / maxTrans) * 0.88;
    } else if (last1) {
      // Si comparte notas con el último acorde, suena más musical
      const shared = getSharedPitchClassesCount(last1, mb.chord);
      prob += shared * 0.04;
    }

    rawSuggestions.push({
      chord: mb.chord,
      baseProb: Math.min(0.75, prob),
      category: 'spicy'
    });
  });

  // 5. Agregar cromatismos y paso si hay acorde previo
  if (last1) {
    const parsedLast = parseChord(last1);
    if (parsedLast) {
      const lastRootVal = noteToMod12(parsedLast.root);

      // Aumentado interno (Line cliché: ej C -> Caug o Dm -> Daug)
      rawSuggestions.push({
        chord: `${parsedLast.root}aug`,
        baseProb: 0.34,
        category: 'spicy'
      });

      // Disminuido de paso
      const sharpRoot = mod12ToNote((lastRootVal + 1) % 12);
      rawSuggestions.push({
        chord: `${sharpRoot}dim`,
        baseProb: 0.28,
        category: 'tensión'
      });

      // Acorde napolitano / aproximación cromática superior
      const upperApproach = mod12ToNote((lastRootVal + 1) % 12);
      rawSuggestions.push({
        chord: upperApproach,
        baseProb: 0.25,
        category: 'spicy'
      });
    }
  }

  // 6. Deduplicación conservando la mayor probabilidad asignada
  const sugMap = new Map<string, { prob: number; category: ChordSuggestion['category'] }>();

  rawSuggestions.forEach(item => {
    const existing = sugMap.get(item.chord);
    if (!existing || item.baseProb > existing.prob) {
      sugMap.set(item.chord, { prob: item.baseProb, category: item.category });
    }
  });

  const suggestions: ChordSuggestion[] = [];
  sugMap.forEach((val, chord) => {
    suggestions.push({
      chord,
      probability: val.prob,
      category: val.category
    });
  });

  // 7. Bonificación por notas melódicas activas concurrentes
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
          const bonus = (matches / melodyPitchClasses.length) * 0.15;
          sug.probability += bonus;
        }
      } catch (_) {}
    });
  }

  // 8. Normalizar al rango [0.05, 0.99] y ordenar descendente
  suggestions.forEach(sug => {
    sug.probability = Math.max(0.05, Math.min(0.99, Math.round(sug.probability * 100) / 100));
  });

  return suggestions.sort((a, b) => b.probability - a.probability);
}
