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

export type ActiveView = 'chord' | 'piano-roll' | 'sequencer';

export type ChannelInstrument = 'synth' | 'piano';


export interface ChannelConfig {
  id: string; // Ej: 'chords', 'melody', 'drums'
  name: string; // Ej: 'Armonía', 'Melodía'
  type: 'chord' | 'melody' | 'drums' | 'bass';
  instrument: ChannelInstrument;
  volume: number; // 0 a 100
  pan: number; // -1.0 (L) a +1.0 (R)
  muted: boolean;
  solo: boolean;
  color: string;
}

export interface DrumStep {
  isActive: boolean;
  velocity: number;
}

export interface DrumChannel {
  id: string;
  name: string;
  sampleUrl: string;
  patterns: DrumStep[][]; // Array de hasta 8 patrones, cada uno con 16 pasos
  volume: number; // 0 a 100
  pan: number; // -1.0 a 1.0
  muted: boolean;
  solo: boolean;
}
