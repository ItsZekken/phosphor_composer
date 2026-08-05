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

export interface PatternChainItem {
  id: string;
  type: 'pattern' | 'group';
  repeatCount: number;  // 1 a 64
  patternIndex?: number; // 0 a 7
  items?: PatternChainItem[]; // Solo usado si type === 'group'
}

export interface FlatChainStep {
  patternIndex: number;
  originalItemId: string; // ID for UI highlighting
}

export const flattenPatternChain = (chain: PatternChainItem[]): FlatChainStep[] => {
  const result: FlatChainStep[] = [];
  
  for (const item of chain) {
    for (let r = 0; r < item.repeatCount; r++) {
      if (item.type === 'group' && item.items) {
        for (const subItem of item.items) {
          // Asumimos 1 solo nivel de profundidad
          for (let sr = 0; sr < subItem.repeatCount; sr++) {
            result.push({
              patternIndex: subItem.patternIndex ?? 0,
              originalItemId: subItem.id
            });
          }
        }
      } else {
        result.push({
          patternIndex: item.patternIndex ?? 0,
          originalItemId: item.id
        });
      }
    }
  }
  return result;
}
