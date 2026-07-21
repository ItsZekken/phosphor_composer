import type { NoteClass, ScaleType } from '../utils/typeDefinitions';
import { NOTE_CLASSES, SCALE_INTERVALS } from './scaleDefinitions';

interface KeyCandidate {
  key: NoteClass;
  scale: ScaleType;
  score: number;
  matchedChords: number;
  totalChords: number;
}

/**
 * Extrae las clases de pitch (0-11) de las notas que forman un acorde.
 * Soporta: C, Cm, Cmaj7, C7, Csus4, Csus2, Cdim, Caug, Cm7, Cm7b5
 */
function chordToPitchClasses(chordName: string): number[] {
  const match = chordName.match(/^([A-G]#?)(m|maj7|min7|7|maj|min|dim|aug|m7b5|sus4|sus2)?$/);
  if (!match) return [];
  const rootNote = match[1] as NoteClass;
  const type = match[2] || '';

  const rootVal = NOTE_CLASSES.indexOf(rootNote);
  if (rootVal === -1) return [];

  let intervals = [0, 4, 7];
  switch (type) {
    case 'm': case 'min': intervals = [0, 3, 7]; break;
    case 'dim': intervals = [0, 3, 6]; break;
    case 'aug': intervals = [0, 4, 8]; break;
    case '7': intervals = [0, 4, 7, 10]; break;
    case 'maj7': case 'maj': intervals = [0, 4, 7, 11]; break;
    case 'm7': case 'min7': intervals = [0, 3, 7, 10]; break;
    case 'm7b5': intervals = [0, 3, 6, 10]; break;
    case 'sus4': intervals = [0, 5, 7]; break;
    case 'sus2': intervals = [0, 2, 7]; break;
  }

  return intervals.map(i => (rootVal + i) % 12);
}

/**
 * Obtiene las clases de pitch de todos los notas de la escala dada
 */
function getScalePitchClasses(key: NoteClass, scale: ScaleType): Set<number> {
  const rootVal = NOTE_CLASSES.indexOf(key);
  const intervals = SCALE_INTERVALS[scale];
  const set = new Set<number>();
  intervals.forEach(i => set.add((rootVal + i) % 12));
  return set;
}

/**
 * Detecta la tonalidad y escala más probable a partir de los acordes de la timeline.
 * Prioriza las escalas con mayor número de acordes que encajan de forma diatónica.
 * Devuelve null si hay menos de 1 acorde en la timeline.
 */
export function detectKey(chordNames: string[]): { key: NoteClass; scale: ScaleType } | null {
  if (chordNames.length === 0) return null;

  // Extraer las clases de pitch usadas en la canción
  const usedPitchClasses = new Set<number>();
  chordNames.forEach(chord => {
    chordToPitchClasses(chord).forEach(pc => usedPitchClasses.add(pc));
  });

  const candidates: KeyCandidate[] = [];

  // Solo evaluar mayor y menor para claridad y rendimiento
  const scalesToEvaluate: ScaleType[] = ['major', 'minor', 'dorian', 'mixolydian'];

  for (const scale of scalesToEvaluate) {
    for (const key of NOTE_CLASSES) {
      const scalePCs = getScalePitchClasses(key, scale);
      
      // Cuántas notas usadas caben en esta escala
      let matchedNotes = 0;
      usedPitchClasses.forEach(pc => {
        if (scalePCs.has(pc)) matchedNotes++;
      });

      // Cuántos acordes encajan completamente en esta escala
      let matchedChords = 0;
      chordNames.forEach(chord => {
        const chordPCs = chordToPitchClasses(chord);
        const allFit = chordPCs.every(pc => scalePCs.has(pc));
        if (allFit) matchedChords++;
      });

      // Score: combinación de notas y acordes que encajan
      const noteScore = usedPitchClasses.size > 0 
        ? matchedNotes / usedPitchClasses.size 
        : 0;
      const chordScore = chordNames.length > 0 
        ? matchedChords / chordNames.length 
        : 0;
      
      // El primer acorde sugiere la tónica con fuerza
      const firstChordRoot = chordNames[0]?.match(/^([A-G]#?)/)?.[1];
      const tonicBonus = firstChordRoot === key ? 0.15 : 0;
      
      // Preferir major/minor sobre modos más raros
      const simplicityBonus = (scale === 'major' || scale === 'minor') ? 0.05 : 0;

      const score = noteScore * 0.4 + chordScore * 0.45 + tonicBonus + simplicityBonus;

      candidates.push({ key: key as NoteClass, scale, score, matchedChords, totalChords: chordNames.length });
    }
  }

  // Ordenar por score descendente
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.3) return null;

  return { key: best.key as NoteClass, scale: best.scale };
}
