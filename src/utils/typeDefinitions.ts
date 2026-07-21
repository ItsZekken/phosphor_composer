export type NoteClass = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type ScaleType = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian' | 'phrygian' | 'locrian';

export interface ChordBlock {
  id: string;
  chord: string; // Ej: "C", "Dm", "G", "Am"
  startBeat: number;
  durationBeats: number;
  bassNote?: string; // Ej: "E" en C/E
  type?: 'play' | 'silence' | 'break' | 'bass-only' | 'chord-only';
  section?: string; // Ej: "Intro", "Chorus"
  inversion?: number;
  voicing?: 'default' | 'open' | 'drop2' | 'drop3';
}

export interface MelodyNote {
  id: string;
  note: string; // Ej: "C4"
  midi: number; // Ej: 60
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

export interface GhostNote {
  id: string;
  note: string;
  midi: number;
  startBeat: number;
  durationBeats: number;
}

export interface ChordSuggestion {
  chord: string;
  probability: number;
  category: 'reposo' | 'tensión' | 'spicy' | 'subdominante' | 'exotic';
}

export type ActiveView = 'chord' | 'piano-roll';
