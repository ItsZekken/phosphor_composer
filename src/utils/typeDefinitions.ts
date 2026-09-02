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

export type OscWaveType = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'pulse';

export interface OscConfig {
  enabled: boolean;
  waveType: OscWaveType;
  octave: number; // -2, -1, 0, +1, +2
  semi: number;   // -12 to +12
  detune: number; // -50 to +50 cents
  volume: number; // 0.0 to 1.0 (gain/mix knob)
  pulseWidth?: number;
}

export interface SubOscConfig {
  enabled: boolean;
  waveType: 'sine' | 'square';
  octave: -1 | -2;
  volume: number; // 0.0 to 1.0
}

export interface NoiseConfig {
  enabled: boolean;
  type: 'white' | 'pink';
  volume: number; // 0.0 to 1.0
}

export interface ADSRConfig {
  attack: number;  // 0.001 to 4.0s
  decay: number;   // 0.001 to 4.0s
  sustain: number; // 0.0 to 1.0
  release: number; // 0.001 to 8.0s
}

export interface FilterConfig {
  enabled: boolean;
  type: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  frequency: number; // 20 to 20000 Hz
  Q: number;         // 0.1 to 20
  rolloff?: -12 | -24;
  drive?: number;    // 0.0 to 1.0 (analog saturation)
  envAmount?: number; // -1.0 to 1.0 (filter envelope modulation amount)
  keyTracking?: number; // 0.0 to 1.0
}

export interface LFOConfig {
  enabled: boolean;
  waveType: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random';
  rate: number;    // 0.1 to 20 Hz
  depth: number;   // 0.0 to 1.0
  target: 'cutoff' | 'pitch' | 'amp';
}

export interface SynthFXConfig {
  chorus: {
    enabled: boolean;
    depth: number; // 0.0 to 1.0
    rate: number;  // 0.5 to 10 Hz
    mix: number;   // 0.0 to 1.0
  };
  delay: {
    enabled: boolean;
    time: string | number; // '8n', '4n', etc.
    feedback: number; // 0.0 to 0.9
    mix: number;      // 0.0 to 1.0
  };
  reverb: {
    enabled: boolean;
    decay: number; // 0.5 to 5.0s
    mix: number;   // 0.0 to 1.0
  };
}

export interface SynthSettings {
  // Legacy top-level properties for backward compatibility
  waveType: 'sine' | 'triangle' | 'square' | 'sawtooth';
  envelope: ADSRConfig;
  filter: FilterConfig;
  detune: number;

  // Advanced Analog Synthesis fields
  osc1?: OscConfig;
  osc2?: OscConfig;
  subOsc?: SubOscConfig;
  noise?: NoiseConfig;
  filterEnv?: ADSRConfig;
  lfo?: LFOConfig;
  fx?: SynthFXConfig;
  glide?: number; // Portamento time in seconds
  presetName?: string;
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

export interface TempoMarker {
  id: string;
  beat: number;
  bpm: number;
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
  type: 'pattern' | 'group' | 'rest';
  repeatCount: number;  // 1 a 64
  patternIndex?: number; // 0 a N, o -1 para silencio
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
              patternIndex: subItem.type === 'rest' || subItem.patternIndex === -1 ? -1 : (subItem.patternIndex ?? 0),
              originalItemId: subItem.id
            });
          }
        }
      } else {
        result.push({
          patternIndex: item.type === 'rest' || item.patternIndex === -1 ? -1 : (item.patternIndex ?? 0),
          originalItemId: item.id
        });
      }
    }
  }
  return result;
};
