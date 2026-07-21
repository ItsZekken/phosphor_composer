import type { NoteClass, ScaleType, ChordSuggestion } from '../utils/typeDefinitions';
import { getDiatonicChords, getChordNotes, noteToMod12, getChordRomanDegree } from './scaleDefinitions';
import chordModelData from './chordModel.json';

const CHORD_MODEL = chordModelData as any;

/**
 * Obtiene las variaciones de un acorde base diatónico de forma realista.
 */
function getChordVariations(chordBase: string, isDominant: boolean, isDiminished: boolean): string[] {
  // Extraer tónica del acorde (ej: C, C#, D)
  const match = chordBase.match(/^([A-G]#?|b?)/);
  if (!match) return [chordBase];
  const root = match[1];

  if (isDiminished) {
    return [chordBase, `${root}m7b5`].filter(Boolean);
  }

  if (chordBase.endsWith('m') || chordBase.endsWith('min')) {
    // Para menores
    return [chordBase, `${root}m7`, `${root}sus2`].filter(Boolean);
  }

  // Para mayores
  if (isDominant) {
    return [chordBase, `${root}7`, `${root}sus4`].filter(Boolean);
  } else {
    return [chordBase, `${root}maj7`, `${root}sus4`, `${root}sus2`].filter(Boolean);
  }
}

/**
 * Clasifica y sugiere continuaciones armónicas a partir de la progresión actual, la tonalidad, las notas de la melodía
 * e incluyendo un modelo estadístico pre-entrenado (Markov).
 */
export function getHarmonicSuggestions(
  currentKey: NoteClass,
  currentScale: ScaleType,
  chordProgression: string[],
  melodyPitchClasses?: number[]
): ChordSuggestion[] {
  // 1. Obtener acordes diatónicos base de la escala actual
  const diatonicBases = getDiatonicChords(currentKey, currentScale);
  
  // 2. Determinar la escala paralela para los acordes "Spicy" (Intercambio Modal)
  const parallelScale: ScaleType = currentScale === 'major' ? 'minor' : 'major';
  const parallelDiatonicBases = getDiatonicChords(currentKey, parallelScale);

  const rawSuggestions: { chord: string; baseProb: number; category: 'reposo' | 'tensión' | 'spicy' }[] = [];

  // Mapear los acordes diatónicos base y sus variaciones
  diatonicBases.forEach((chordBase, index) => {
    let category: 'reposo' | 'tensión' | 'spicy';
    let baseProb = 0.5;

    // Clasificación de funciones tonales base
    if (index === 0 || index === 2 || index === 5) {
      category = 'reposo';
      baseProb = index === 0 ? 0.8 : 0.65;
    } else {
      category = 'tensión';
      baseProb = index === 4 ? 0.75 : 0.55;
    }

    const isDominant = index === 4;
    const isDiminished = index === 6;

    // Generar variaciones del acorde base diatónico
    const variations = getChordVariations(chordBase, isDominant, isDiminished);
    variations.forEach((varChord, varIndex) => {
      // La variación principal tiene más peso, las secundarias disminuyen levemente la probabilidad
      const probPenalty = varIndex * 0.08;
      rawSuggestions.push({
        chord: varChord,
        baseProb: Math.max(0.2, baseProb - probPenalty),
        category
      });
    });
  });

  // Agregar acordes de intercambio modal ("Spicy") y sus variaciones
  parallelDiatonicBases.forEach((chordBase, index) => {
    // Si la base no está en la escala diatónica principal, sugerirla
    if (!diatonicBases.includes(chordBase)) {
      const isDominant = index === 4;
      const isDiminished = index === 6;
      const variations = getChordVariations(chordBase, isDominant, isDiminished);
      
      variations.forEach((varChord, varIndex) => {
        const probPenalty = varIndex * 0.05;
        rawSuggestions.push({
          chord: varChord,
          baseProb: Math.max(0.15, 0.35 - probPenalty),
          category: 'spicy'
        });
      });
    }
  });

  // Eliminar duplicaciones de acordes
  const seenChords = new Set<string>();
  const suggestions: ChordSuggestion[] = [];

  rawSuggestions.forEach(item => {
    if (!seenChords.has(item.chord)) {
      seenChords.add(item.chord);
      suggestions.push({
        chord: item.chord,
        probability: item.baseProb,
        category: item.category
      });
    }
  });

  // 3. Modificar probabilidades usando el modelo de datos pre-entrenado (Cadenas de Markov)
  if (chordProgression && chordProgression.length > 0) {
    const lastChord1 = chordProgression[chordProgression.length - 1];
    const lastChord2 = chordProgression.length > 1 ? chordProgression[chordProgression.length - 2] : null;

    const rom1 = getChordRomanDegree(lastChord1, currentKey, currentScale);
    const rom2 = lastChord2 ? getChordRomanDegree(lastChord2, currentKey, currentScale) : null;

    let transitions: Record<string, number> | null = null;
    let isTrigramMatch = false;

    // Tratar de coincidir con un Trigram (N-Gram de orden 2: contexto de 2 acordes)
    if (rom1 && rom2) {
      const trigramKey = `${rom2},${rom1}`;
      if (CHORD_MODEL.trigrams[trigramKey]) {
        transitions = CHORD_MODEL.trigrams[trigramKey];
        isTrigramMatch = true;
      }
    }

    // Backoff a Bigram (N-Gram de orden 1) si no hay Trigram
    if (!transitions && rom1 && CHORD_MODEL.bigrams[rom1]) {
      transitions = CHORD_MODEL.bigrams[rom1];
    }

    if (transitions) {
      suggestions.forEach(sug => {
        const sugRom = getChordRomanDegree(sug.chord, currentKey, currentScale);
        if (sugRom && transitions![sugRom] !== undefined) {
          // El modelo dicta la probabilidad fuertemente
          sug.probability = transitions![sugRom];
          // Añadimos un pequeño bono si es un match de orden alto
          if (isTrigramMatch) {
            sug.probability = Math.min(0.99, sug.probability + 0.1);
          }
        } else {
          // Penalizar si no es probable según el dataset
          sug.probability *= 0.3;
        }
      });
    }

    // Identificar si el último acorde era dominante puro por si acaso el modelo no lo cazó bien
    const lastChordClean = lastChord1.trim();
    const isDominantLast = lastChordClean.includes('7') || lastChordClean.endsWith('sus4');
    
    suggestions.forEach(sug => {
      // Regla funcional de rescate: Favorecer resolución a tónica si es dominante
      if (isDominantLast && !transitions && (sug.chord === diatonicBases[0] || sug.chord === `${diatonicBases[0]}maj7`)) {
        sug.probability += 0.15; 
      }
      // Evitar sugerir exactamente el mismo acorde repitiéndolo consecutivamente
      if (sug.chord === lastChordClean) {
        sug.probability -= 0.35; 
      }
    });
  }

  // 4. Inteligencia Armónica Melódica: Modificar probabilidades en base a las notas de la melodía en el compás
  if (melodyPitchClasses && melodyPitchClasses.length > 0) {
    suggestions.forEach(sug => {
      try {
        const chordNotes = getChordNotes(sug.chord, 3);
        const chordPitchClasses = chordNotes.map(n => noteToMod12(n));
        
        let matches = 0;
        melodyPitchClasses.forEach(pc => {
          if (chordPitchClasses.includes(pc)) {
            matches++;
          }
        });
        
        if (matches > 0) {
          // Bonus proporcional a las coincidencias melódicas (Constraint multiplier)
          const bonus = (matches / melodyPitchClasses.length) * 0.45;
          sug.probability += bonus;
        }
      } catch (e) {
        // En caso de que sea un acorde extendido complejo y falle parsing
      }
    });
  }

  // Normalizar y limitar el rango final de probabilidad [0.05, 0.99]
  suggestions.forEach(sug => {
    sug.probability = Math.max(0.05, Math.min(0.99, sug.probability));
  });

  // Ordenar de mayor a menor probabilidad
  return suggestions.sort((a, b) => b.probability - a.probability);
}
