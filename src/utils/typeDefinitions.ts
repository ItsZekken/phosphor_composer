export type NoteClass = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type ScaleType = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian' | 'phrygian' | 'locrian';

export type TimeSignature = '4/4' | '3/4' | '6/8';

export interface CRTParams {
  scanlineOpacity: number;
  scanlineSize: number;
  curvature: number;
  aberration: number;
  bloom: number;
  svgBlur: number;
  phosphorHue: number;
  phosphorSat: number;
  tintStrength: number;
  noise: number;
  flicker: number;
  vignette: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

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

export type ActiveView = 'chord' | 'piano-roll' | 'sequencer' | 'visualizer';

export interface SynthSettings {
  waveType: 'sine' | 'triangle' | 'square' | 'sawtooth';
  envelope: {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
  };
  filter: {
    enabled: boolean;
    type: 'lowpass' | 'highpass' | 'bandpass';
    frequency: number;
    Q: number;
  };
  detune: number;
}

export type ChannelInstrument = 'synth' | 'piano' | 'sampler';

export interface PianoRollTrack {
  id: string;
  name: string;
  color: string;
  channelId: string;
  notes: MelodyNote[];
  synthSettings?: SynthSettings;
  viewport?: {
    scrollLeft?: number;
    scrollTop?: number;
    zoomX?: number;
    zoomY?: number;
    beatWidth?: number;
    rowHeight?: number;
  };
}

export interface StyleMarker {
  id: string;
  beat: number;
  pattern: string;
}

export interface ChannelConfig {
  id: string; // Ej: 'master', 'chords', 'melody', 'drums', 'track_123'
  name: string; // Ej: 'Master', 'Armonía', 'Melodía'
  type: 'master' | 'chord' | 'chords' | 'melody' | 'drums' | 'bass' | 'synth';
  instrument: ChannelInstrument;
  volume: number; // 0 a 100 (80 es nominal 0 dB)
  pan: number; // -1.0 (L) a +1.0 (R)
  muted: boolean;
  solo: boolean;
  color: string;
  synthSettings?: SynthSettings;
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
