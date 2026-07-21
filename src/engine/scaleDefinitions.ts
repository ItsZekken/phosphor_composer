import type { NoteClass, ScaleType } from '../utils/typeDefinitions';

export const NOTE_CLASSES: NoteClass[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  locrian:    [0, 1, 3, 5, 6, 8, 10]
};

// Grados romanos asociados a cada escala diatónica clásica
export const DIATONIC_CHORDS: Record<ScaleType, string[]> = {
  major:      ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  minor:      ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'], // menor natural
  dorian:     ['i', 'ii', 'III', 'IV', 'v', 'vi°', 'VII'],
  mixolydian: ['I', 'ii', 'iii°', 'IV', 'v', 'vi', 'bVII'],
  lydian:     ['I', 'II', 'iii', '#iv°', 'V', 'vi', 'vii'],
  phrygian:   ['i', 'bII', 'III', 'iv', 'v°', 'VI', 'vii'],
  locrian:    ['i°', 'bII', 'biii', 'iv', 'bV', 'VI', 'vii']
};

/**
 * Convierte un nombre de nota (ej: "C") a su valor numérico mod-12 (0-11)
 */
export function noteToMod12(note: string): number {
  const cleanNote = note.replace(/[0-9]/g, '').trim().toUpperCase();
  const index = NOTE_CLASSES.indexOf(cleanNote as NoteClass);
  return index !== -1 ? index : 0;
}

/**
 * Convierte un número mod-12 (0-11) a su nombre de nota correspondiente
 */
export function mod12ToNote(val: number): NoteClass {
  const norm = ((val % 12) + 12) % 12;
  return NOTE_CLASSES[norm];
}

/**
 * Obtiene las notas MIDI correspondientes a una escala dada su tónica y tipo
 */
export function getScaleNotes(key: NoteClass, scaleType: ScaleType, octave = 4): string[] {
  const rootValue = noteToMod12(key);
  const intervals = SCALE_INTERVALS[scaleType];
  return intervals.map(interval => {
    const val = rootValue + interval;
    const noteClass = mod12ToNote(val);
    const calculatedOctave = octave + Math.floor(val / 12);
    return `${noteClass}${calculatedOctave}`;
  });
}

/**
 * Obtiene las notas de un acorde por su nombre básico (ej: "C", "Dm", "G7", "Cmaj7")
 * Retorna las notas en un rango de octava específico
 */
export function getChordNotes(chordName: string, baseOctave = 3): string[] {
  if (!chordName) return [];
  
  // Separar acorde base y bajo en caso de slash chords (ej: C/E)
  const parts = chordName.split('/');
  const baseChord = parts[0];
  const bassPart = parts[1];
  
  // Expresión regular para parsear: Tónica + Calidad (soporta bemoles/sostenidos e incluye m7)
  const match = baseChord.match(/^([A-G][#b]?)(m|maj7|min7|m7|7|maj|min|dim|aug|m7b5|sus4|sus2)?$/);
  if (!match) return [];
  
  const root = match[1];
  const type = match[2] || '';
  
  const rootVal = noteToMod12(root);
  let intervals: number[] = [0, 4, 7]; // Mayor por defecto
  
  switch (type) {
    case 'm':
    case 'min':
      intervals = [0, 3, 7];
      break;
    case 'dim':
      intervals = [0, 3, 6];
      break;
    case 'aug':
      intervals = [0, 4, 8];
      break;
    case '7':
      intervals = [0, 4, 7, 10]; // Dominante
      break;
    case 'maj7':
    case 'maj':
      intervals = [0, 4, 7, 11];
      break;
    case 'm7':
    case 'min7':
      intervals = [0, 3, 7, 10];
      break;
    case 'm7b5':
      intervals = [0, 3, 6, 10];
      break;
    case 'sus4':
      intervals = [0, 5, 7];
      break;
    case 'sus2':
      intervals = [0, 2, 7];
      break;
  }
  
  const chordNotes = intervals.map(interval => {
    const val = rootVal + interval;
    const noteClass = mod12ToNote(val);
    const octave = baseOctave + Math.floor(val / 12);
    return `${noteClass}${octave}`;
  });

  if (bassPart) {
    const bassOctave = baseOctave - 1;
    // Retornamos el bajo al principio
    return [`${bassPart}${bassOctave}`, ...chordNotes];
  }
  
  return chordNotes;
}

/**
 * Genera una paleta de acordes diatónicos para una escala dada
 */
export function getDiatonicChords(key: NoteClass, scaleType: ScaleType): string[] {
  const rootVal = noteToMod12(key);
  const intervals = SCALE_INTERVALS[scaleType];
  
  // Reglas diatónicas simples para asignar mayor/menor/disminuido en base al grado de la escala
  // Mapeo genérico para simplificar
  return intervals.map((interval, index) => {
    const noteVal = (rootVal + interval) % 12;
    const noteName = mod12ToNote(noteVal);
    
    // Asignación de tipo de acorde diatónico estándar
    let suffix = '';
    
    if (scaleType === 'major') {
      const qualities = ['', 'm', 'm', '', '', 'm', 'dim'];
      suffix = qualities[index];
    } else if (scaleType === 'minor') {
      const qualities = ['m', 'dim', '', 'm', 'm', '', ''];
      suffix = qualities[index];
    } else {
      // Para otros modos, deducir según los intervalos diatónicos tradicionales
      // Por simplicidad, miramos la tercera y quinta diatónica
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
 * Verifica si un acorde pertenece a la escala actual (si todas sus notas de pitch class están en la escala)
 */
export function isChordInScale(chordName: string, key: NoteClass, scaleType: ScaleType): boolean {
  if (!chordName) return true;
  try {
    const chordNotes = getChordNotes(chordName, 3).map(n => noteToMod12(n));
    const scaleNotes = getScaleNotes(key, scaleType, 3).map(n => noteToMod12(n));
    return chordNotes.every(note => scaleNotes.includes(note));
  } catch (e) {
    return false;
  }
}

/**
 * Obtiene las extensiones sugeridas para un acorde base dado
 */
export function getExtensionsForChord(
  chordName: string,
  key: NoteClass,
  scaleType: ScaleType,
  inScaleOnly = true
): string[] {
  if (!chordName) return [];
  
  // Extraer la raíz
  const match = chordName.match(/^([A-G]#?|b?)/);
  if (!match) return [];
  const root = match[1];

  // Extensiones sugeridas clásicas para cualquier tónica
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

  // Filtrar duplicados y el acorde actual
  const uniqueExts = Array.from(new Set(allExtensions)).filter(ext => ext !== chordName);

  if (inScaleOnly) {
    // Retornar solo aquellos que pertenezcan a la escala actual
    return uniqueExts.filter(ext => isChordInScale(ext, key, scaleType));
  }

  return uniqueExts;
}

/**
 * Obtiene el grado romano de un acorde según la tónica y la escala actual (ej: "I", "ii", "iii")
 */
export function getChordRomanDegree(chordName: string, key: NoteClass, scaleType: ScaleType): string {
  if (!chordName) return '';
  
  // Separar bajo y obtener acorde base
  const baseChord = chordName.split('/')[0];
  const match = baseChord.match(/^([A-G][#b]?)(m|maj7|min7|m7|7|maj|min|dim|aug|m7b5|sus4|sus2)?$/);
  if (!match) return '';
  
  const root = match[1];
  const quality = match[2] || '';
  
  const rootVal = noteToMod12(root);
  const keyVal = noteToMod12(key);
  const interval = (rootVal - keyVal + 12) % 12;
  
  const scaleIntervals = SCALE_INTERVALS[scaleType];
  const diatonicChords = DIATONIC_CHORDS[scaleType];
  
  const idx = scaleIntervals.indexOf(interval);
  if (idx !== -1) {
    return diatonicChords[idx];
  }
  
  // Fuera de la escala (cromático / alterado)
  const chromaticMap: Record<number, string> = {
    1: 'bII',
    3: 'bIII',
    6: '#IV',
    8: 'bVI',
    10: 'bVII'
  };
  
  const baseDegree = chromaticMap[interval] || 'X';
  const isMinor = quality === 'm' || quality === 'min' || quality === 'm7' || quality === 'min7' || quality === 'dim' || quality === 'm7b5';
  
  return isMinor ? baseDegree.toLowerCase() : baseDegree;
}

export function shiftOctave(note: string, offset: number): string {
  const match = note.match(/^([A-G]#?|b?)([0-9])$/);
  if (!match) return note;
  const pitch = match[1];
  const octave = parseInt(match[2]);
  return `${pitch}${octave + offset}`;
}

export function noteToMidi(note: string): number {
  const match = note.match(/^([A-G]#?|b?)([0-9])$/);
  if (!match) return 60; // middle C
  const pitch = match[1];
  const octave = parseInt(match[2]);
  const pitchClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pcIndex = pitchClasses.indexOf(pitch);
  return 12 * (octave + 1) + (pcIndex !== -1 ? pcIndex : 0);
}

export function invertChord(notes: string[], inversion: number): string[] {
  if (notes.length <= 1 || !inversion || inversion <= 0) return notes;
  const inverted = [...notes];
  
  const count = inversion % inverted.length;
  for (let i = 0; i < count; i++) {
    const note = inverted.shift()!;
    inverted.push(shiftOctave(note, 1));
  }
  return inverted.sort((a, b) => noteToMidi(a) - noteToMidi(b));
}

export function applyVoicing(notes: string[], voicing: string): string[] {
  if (notes.length < 3 || !voicing || voicing === 'default') return notes;
  const voiced = [...notes];
  
  if (voicing === 'drop2') {
    const idx = voiced.length - 2;
    voiced[idx] = shiftOctave(voiced[idx], -1);
  } else if (voicing === 'drop3') {
    const idx = voiced.length - 3;
    if (idx >= 0) {
      voiced[idx] = shiftOctave(voiced[idx], -1);
    }
  } else if (voicing === 'open') {
    if (voiced.length === 3) {
      return [voiced[0], voiced[2], shiftOctave(voiced[1], 1)].sort((a, b) => noteToMidi(a) - noteToMidi(b));
    } else if (voiced.length >= 4) {
      return [
        voiced[0],
        voiced[2],
        shiftOctave(voiced[1], 1),
        shiftOctave(voiced[3], 1)
      ].sort((a, b) => noteToMidi(a) - noteToMidi(b));
    }
  }
  
  return voiced.sort((a, b) => noteToMidi(a) - noteToMidi(b));
}

