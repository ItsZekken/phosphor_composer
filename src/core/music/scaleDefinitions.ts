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
    `${root}aug`,              // Aumentado
    `${root}dim`,              // Disminuido
    `${root}m7b5`,             // Semidisminuido
    `${root}sus4`,             // Suspendido 4
    `${root}sus2`,             // Suspendido 2
    `${root}6`,                // Sexta Mayor
    `${root}m6`,               // Sexta Menor
  ];

  const uniqueExts = Array.from(new Set(allExtensions)).filter(ext => ext !== chordName);
  if (inScaleOnly) {
    return uniqueExts.filter(ext => isChordInScale(ext, key, scaleType));
  }
  return uniqueExts;
}

export interface ModalBorrowChord {
  chord: string;
  sourceMode: string;
  roman: string;
  label: string;
  emotion: string;
  role: 'reposo' | 'tension' | 'subdominante' | 'spicy' | 'exotic';
}

export interface SecondaryDominantChord {
  chord: string;
  targetChord: string;
  targetDegree: string;
  label: string;
  type: 'secondary_dominant' | 'tritone_sub';
  role: 'tension' | 'spicy';
}

export interface ChromaticPassingChord {
  chord: string;
  approachTo: string;
  type: 'line_cliche' | 'chromatic_approach' | 'passing_dim';
  label: string;
  role: 'spicy' | 'exotic' | 'tension';
}

/**
 * Obtiene acordes de intercambio modal clasificados con intención emocional.
 */
export function getModalBorrowChords(key: NoteClass | string, scaleType: ScaleType = 'major'): ModalBorrowChord[] {
  const normKey = normalizePitchClass(key);
  const rootVal = noteToMod12(normKey);

  if (scaleType === 'major') {
    // En Mayor: Préstamos del Menor Paralelo (Eólico), Dórico, Frigio, Lidio
    const bVI_root = mod12ToNote((rootVal + 8) % 12);
    const bVII_root = mod12ToNote((rootVal + 10) % 12);
    const iv_root = mod12ToNote((rootVal + 5) % 12);
    const bIII_root = mod12ToNote((rootVal + 3) % 12);
    const bII_root = mod12ToNote((rootVal + 1) % 12);
    const ii_root = mod12ToNote((rootVal + 2) % 12);

    return [
      {
        chord: bVI_root,
        sourceMode: 'Menor Eólico',
        roman: 'bVI',
        label: 'Submediante Bemol (Épico / Cinemático)',
        emotion: 'Épico y Majestuoso',
        role: 'spicy'
      },
      {
        chord: bVII_root,
        sourceMode: 'Menor / Mixolidio',
        roman: 'bVII',
        label: 'Subtónica Bemol (Rock / Himno)',
        emotion: 'Aventura y Fuerza',
        role: 'subdominante'
      },
      {
        chord: `${iv_root}m`,
        sourceMode: 'Menor Eólico',
        roman: 'iv',
        label: 'Subdominante Menor (Melancólico)',
        emotion: 'Nostalgia y Despedida',
        role: 'subdominante'
      },
      {
        chord: bIII_root,
        sourceMode: 'Menor Eólico',
        roman: 'bIII',
        label: 'Mediante Bemol (Profundo)',
        emotion: 'Fantasía y Misterio',
        role: 'spicy'
      },
      {
        chord: bII_root,
        sourceMode: 'Frigio / Napolitano',
        roman: 'bII',
        label: 'Acorde Napolitano (Dramático)',
        emotion: 'Drama Intenso',
        role: 'exotic'
      },
      {
        chord: `${ii_root}`,
        sourceMode: 'Lidio',
        roman: 'II',
        label: 'Segundo Mayor (Brillo Lidio)',
        emotion: 'Mágico y Optimista',
        role: 'spicy'
      }
    ];
  } else {
    // En Menor: Préstamos del Mayor Paralelo, Dórico, Frigio
    const I_root = mod12ToNote(rootVal);
    const IV_root = mod12ToNote((rootVal + 5) % 12);
    const vi_root = mod12ToNote((rootVal + 9) % 12);
    const V_root = mod12ToNote((rootVal + 7) % 12);
    const bII_root = mod12ToNote((rootVal + 1) % 12);

    return [
      {
        chord: I_root,
        sourceMode: 'Mayor Paralelo',
        roman: 'I',
        label: 'Tercera de Picardía (Luz Final)',
        emotion: 'Triunfo y Resolución',
        role: 'reposo'
      },
      {
        chord: IV_root,
        sourceMode: 'Dórico',
        roman: 'IV',
        label: 'Subdominante Mayor (Funk / Dórico)',
        emotion: 'Misterio y Groove',
        role: 'subdominante'
      },
      {
        chord: `${V_root}7`,
        sourceMode: 'Menor Armónica',
        roman: 'V7',
        label: 'Dominante Mayor Armónica',
        emotion: 'Tensión Fuerte hacia la Tónica',
        role: 'tension'
      },
      {
        chord: `${vi_root}m`,
        sourceMode: 'Mayor Paralelo',
        roman: 'vi',
        label: 'Sexto Menor',
        emotion: 'Melancolía Alternativa',
        role: 'spicy'
      },
      {
        chord: bII_root,
        sourceMode: 'Frigio / Napolitano',
        roman: 'bII',
        label: 'Napolitano Frigio',
        emotion: 'Tensión Oscura',
        role: 'exotic'
      }
    ];
  }
}

/**
 * Obtiene dominantes secundarias y sustituciones tritonales para los grados de la tonalidad.
 */
export function getSecondaryDominants(key: NoteClass | string, scaleType: ScaleType = 'major'): SecondaryDominantChord[] {
  const normKey = normalizePitchClass(key);
  const diatonic = getDiatonicChords(normKey, scaleType);

  const targets = scaleType === 'major'
    ? [
        { degIndex: 1, name: 'ii', desc: diatonic[1] },
        { degIndex: 2, name: 'iii', desc: diatonic[2] },
        { degIndex: 3, name: 'IV', desc: diatonic[3] },
        { degIndex: 4, name: 'V', desc: diatonic[4] },
        { degIndex: 5, name: 'vi', desc: diatonic[5] },
      ]
    : [
        { degIndex: 2, name: 'III', desc: diatonic[2] },
        { degIndex: 3, name: 'iv', desc: diatonic[3] },
        { degIndex: 4, name: 'V', desc: diatonic[4] },
        { degIndex: 5, name: 'VI', desc: diatonic[5] },
        { degIndex: 6, name: 'VII', desc: diatonic[6] },
      ];

  const results: SecondaryDominantChord[] = [];

  targets.forEach(target => {
    const parsedTarget = parseChord(target.desc);
    if (!parsedTarget) return;

    const targetRootVal = noteToMod12(parsedTarget.root);

    // Dominante secundaria V7/X: Quinta arriba (o cuarta abajo: +7 semitonos)
    const v7Root = mod12ToNote((targetRootVal + 7) % 12);
    results.push({
      chord: `${v7Root}7`,
      targetChord: target.desc,
      targetDegree: target.name,
      label: `V7/${target.name} (Hacia ${target.desc})`,
      type: 'secondary_dominant',
      role: 'tension'
    });

    // Sustituto tritonal subV7/X: Un semitono arriba de la tónica destino (+1 semitono)
    const subV7Root = mod12ToNote((targetRootVal + 1) % 12);
    results.push({
      chord: `${subV7Root}7`,
      targetChord: target.desc,
      targetDegree: target.name,
      label: `subV7/${target.name} (Tritono hacia ${target.desc})`,
      type: 'tritone_sub',
      role: 'spicy'
    });
  });

  return results;
}

/**
 * Genera acordes de paso cromático y secuencias de line cliché para un acorde dado o la tonalidad.
 */
export function getChromaticPassingChords(
  chordName?: string,
  key: NoteClass | string = 'C',
  _scaleType: ScaleType = 'major'
): ChromaticPassingChord[] {
  const targetChord = chordName || key;
  const parsed = parseChord(targetChord);
  if (!parsed) return [];

  const root = parsed.root;
  const rootVal = noteToMod12(root);
  const isMinor = parsed.quality === 'minor' || parsed.quality === 'minor7';

  const results: ChromaticPassingChord[] = [];

  // 1. Line Cliché para menores o mayores (ej: Dm -> Dbaug -> Dm7 -> Dm6)
  if (isMinor) {
    const semitoneBelow = mod12ToNote((rootVal + 11) % 12);
    results.push({
      chord: `${semitoneBelow}aug`,
      approachTo: targetChord,
      type: 'line_cliche',
      label: `Línea cromática menor (${targetChord} → ${semitoneBelow}aug)`,
      role: 'spicy'
    });
    results.push({
      chord: `${root}aug`,
      approachTo: targetChord,
      type: 'line_cliche',
      label: `Aumentado interno (${root}aug)`,
      role: 'spicy'
    });
  } else {
    results.push({
      chord: `${root}aug`,
      approachTo: targetChord,
      type: 'line_cliche',
      label: `Tensión aumentada (${root} → ${root}aug)`,
      role: 'spicy'
    });
  }

  // 2. Disminuido de paso ascendente (#i° -> ii, #iv° -> V, etc.)
  const sharpRoot = mod12ToNote((rootVal + 1) % 12);
  results.push({
    chord: `${sharpRoot}dim`,
    approachTo: targetChord,
    type: 'passing_dim',
    label: `Paso disminuido (${sharpRoot}dim)`,
    role: 'tension'
  });

  // 3. Aproximación cromática de medio tono superior e inferior
  const upperHalf = mod12ToNote((rootVal + 1) % 12);
  const lowerHalf = mod12ToNote((rootVal + 11) % 12);

  results.push({
    chord: upperHalf,
    approachTo: targetChord,
    type: 'chromatic_approach',
    label: `Aproximación descendente (${upperHalf} → ${targetChord})`,
    role: 'spicy'
  });

  results.push({
    chord: lowerHalf,
    approachTo: targetChord,
    type: 'chromatic_approach',
    label: `Aproximación ascendente (${lowerHalf} → ${targetChord})`,
    role: 'spicy'
  });

  return results;
}

/**
 * Genera la paleta de 12 grados cromáticos relativos a la tónica.
 */
export function getChromaticDegreePalette(key: NoteClass | string): { degree: string; root: NoteClass }[] {
  const normKey = normalizePitchClass(key);
  const rootVal = noteToMod12(normKey);

  const degrees = [
    { degree: 'I', semitones: 0 },
    { degree: 'bII', semitones: 1 },
    { degree: 'II', semitones: 2 },
    { degree: 'bIII', semitones: 3 },
    { degree: 'III', semitones: 4 },
    { degree: 'IV', semitones: 5 },
    { degree: '#IV/bV', semitones: 6 },
    { degree: 'V', semitones: 7 },
    { degree: 'bVI', semitones: 8 },
    { degree: 'VI', semitones: 9 },
    { degree: 'bVII', semitones: 10 },
    { degree: 'VII', semitones: 11 },
  ];

  return degrees.map(d => ({
    degree: d.degree,
    root: mod12ToNote((rootVal + d.semitones) % 12)
  }));
}

/**
 * Calcula el análisis de grado romano (ej: "I", "ii", "IV", "V7", "bVI", "bVII", "Iaug") de un acorde
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
  let baseDegree = '';

  if (idx !== -1) {
    baseDegree = diatonicChords[idx];
  } else {
    // Acordes cromáticos y de intercambio modal
    const chromaticMap: Record<number, string> = {
      1: 'bII',
      3: 'bIII',
      6: '#IV',
      8: 'bVI',
      10: 'bVII',
      11: 'VII'
    };
    baseDegree = chromaticMap[interval] || 'X';
    const isMinor = parsed.quality === 'minor' || parsed.quality === 'minor7' || parsed.quality === 'diminished' || parsed.quality === 'halfDiminished';
    baseDegree = isMinor ? baseDegree.toLowerCase() : baseDegree;
  }

  // Sufijo específico para aumentados o séptimas cuando alteran la cualidad diatónica
  if (parsed.quality === 'augmented') {
    return `${baseDegree.replace(/°|m/g, '')}aug`;
  }
  if (parsed.quality === 'dominant7' && !baseDegree.endsWith('7')) {
    return `${baseDegree}7`;
  }

  return baseDegree;
}

