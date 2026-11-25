import { NOTE_CLASSES } from '../../core/music';
import type { NoteClass, ScaleType } from '../../utils/typeDefinitions';

export type ChordHarmonicRole = 'reposo' | 'tension' | 'subdominante' | 'spicy' | 'exotic';

/** Función hash del acorde a color de función armónica */
export function getChordRole(
  chord: string,
  key: NoteClass,
  _scale: ScaleType
): ChordHarmonicRole {
  const NOTE_IDX = NOTE_CLASSES;
  const match = chord.match(/^([A-G]#?)(m|maj7|min7|7|maj|min|dim|aug|m7b5|sus4|sus2|6|m6|add9)?$/);
  if (!match) return 'spicy';
  const rootNote = match[1] as NoteClass;
  const type = match[2] || '';

  const rootVal = NOTE_IDX.indexOf(rootNote);
  const keyVal = NOTE_IDX.indexOf(key);
  const interval = ((rootVal - keyVal) + 12) % 12;

  const roleMap: Record<number, ChordHarmonicRole> = {
    0: 'reposo',
    2: 'subdominante',
    4: 'reposo',
    5: 'subdominante',
    7: 'tension',
    9: 'reposo',
    11: 'tension'
  };

  if (type === 'dim' || type === 'aug' || type === 'm7b5') return 'spicy';

  const baseRole = roleMap[interval];
  if (!baseRole) return 'exotic';
  return baseRole;
}
