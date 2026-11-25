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

export type ActiveView = 'chord' | 'piano-roll' | 'sequencer' | 'visualizer' | 'audio-tracks';

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
  driveType?: 'warm' | 'tube' | 'tape' | 'fuzz';
  envAmount?: number; // -1.0 to 1.0 (filter envelope modulation amount)
  keyTracking?: number; // 0.0 to 1.0
}

export interface SynthEQConfig {
  enabled: boolean;
  low: number;      // -12 to +12 dB (~100 Hz bass shelf)
  lowMid: number;   // -12 to +12 dB (~500 Hz peak)
  highMid: number;  // -12 to +12 dB (~2800 Hz peak)
  high: number;     // -12 to +12 dB (~10000 Hz treble shelf)
}

export interface LFOConfig {
  enabled: boolean;
  waveType: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random';
  rate: number;    // 0.05 to 30 Hz
  depth: number;   // 0.0 to 1.0
  target: 'cutoff' | 'pitch' | 'amp';
}

export interface SynthFXConfig {
  chorus: {
    enabled: boolean;
    depth: number; // 0.0 to 1.0
    rate: number;  // 0.1 to 10 Hz
    mix: number;   // 0.0 to 1.0
  };
  delay: {
    enabled: boolean;
    time: string | number; // '16n', '8n', '8n.', '4n', etc., o milisegundos
    feedback: number; // 0.0 to 0.9
    mix: number;      // 0.0 to 1.0
    sync?: boolean;   // true = sincronizado a BPM, false = milisegundos
    damping?: number; // 0.0 to 1.0 (amortiguación analógica de agudos)
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
  eq?: SynthEQConfig;
  fx?: SynthFXConfig;
  glide?: number; // Portamento time in seconds
  masterGain?: number; // 0.0 to 2.0 (default 1.0 = 0 dB)
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
  repeatCount: number;        // Duración aproximada en compases enteros (retrocompatibilidad)
  patternIndex?: number;      // 0 a N, o -1 para silencio legado
  startMeasure?: number;      // Posición lineal absoluta en compases (base 0, soporta decimales ej: 3.5)
  durationMeasures?: number;  // Duración lineal exacta en compases (ej: 1, 2, 4, 0.5)
  items?: PatternChainItem[]; // Legado (se aplana automáticamente a clips lineales)
}

export interface LinearDrumClip {
  id: string;
  patternIndex: number;
  startMeasure: number;
  durationMeasures: number;
}

export interface FlatChainStep {
  patternIndex: number;
  originalItemId: string; // ID for UI highlighting
}

/**
 * Convierte cualquier cadena de patrones (legada secuencial/grupos o lineal moderna)
 * a una lista ordenada y determinista de clips lineales acoplados al timeline global.
 */
export const normalizePatternChainToLinear = (chain: PatternChainItem[]): LinearDrumClip[] => {
  if (!chain || chain.length === 0) return [];
  const clips: LinearDrumClip[] = [];
  let sequentialCursor = 0;

  for (const item of chain) {
    if (!item) continue;
    const isLinear = typeof item.startMeasure === 'number' && !Number.isNaN(item.startMeasure);

    if (item.type === 'group' && item.items && item.items.length > 0 && !isLinear) {
      const repeats = Math.max(1, item.repeatCount || 1);
      for (let r = 0; r < repeats; r++) {
        for (const sub of item.items) {
          const subDur = Math.max(0.25, sub.durationMeasures ?? (sub.repeatCount || 1));
          const subIsRest = sub.type === 'rest' || sub.patternIndex === -1;
          if (!subIsRest) {
            clips.push({
              id: r === 0 ? sub.id : `${sub.id}_r${r}`,
              patternIndex: Math.max(0, sub.patternIndex ?? 0),
              startMeasure: sequentialCursor,
              durationMeasures: subDur
            });
          }
          sequentialCursor += subDur;
        }
      }
      continue;
    }

    const dur = Math.max(0.25, item.durationMeasures ?? (item.repeatCount || 1));
    const isRest = item.type === 'rest' || item.patternIndex === -1;

    if (isLinear) {
      const start = Math.max(0, item.startMeasure!);
      if (!isRest) {
        clips.push({
          id: item.id,
          patternIndex: Math.max(0, item.patternIndex ?? 0),
          startMeasure: start,
          durationMeasures: dur
        });
      }
      sequentialCursor = Math.max(sequentialCursor, start + dur);
    } else {
      if (!isRest) {
        clips.push({
          id: item.id || `clip_${sequentialCursor}`,
          patternIndex: Math.max(0, item.patternIndex ?? 0),
          startMeasure: sequentialCursor,
          durationMeasures: dur
        });
      }
      sequentialCursor += dur;
    }
  }

  return clips.sort((a, b) => a.startMeasure - b.startMeasure);
};

/**
 * Normaliza PatternChainItem[] in-place de formato legado a objetos PatternChainItem lineales persistibles.
 */
export const normalizePatternChainItems = (chain: PatternChainItem[]): PatternChainItem[] => {
  return normalizePatternChainToLinear(chain).map((clip) => ({
    id: clip.id,
    type: 'pattern' as const,
    patternIndex: clip.patternIndex,
    startMeasure: clip.startMeasure,
    durationMeasures: clip.durationMeasures,
    repeatCount: Math.max(1, Math.round(clip.durationMeasures))
  }));
};

export const flattenPatternChain = (chain: PatternChainItem[]): FlatChainStep[] => {
  const clips = normalizePatternChainToLinear(chain);
  if (clips.length === 0) return [];

  const maxEndMeasure = clips.reduce((max, c) => Math.max(max, c.startMeasure + c.durationMeasures), 0);
  const totalMeasures = Math.max(1, Math.ceil(maxEndMeasure));
  const result: FlatChainStep[] = Array.from({ length: totalMeasures }, () => ({
    patternIndex: -1,
    originalItemId: ''
  }));

  for (const clip of clips) {
    const startM = Math.max(0, Math.floor(clip.startMeasure));
    const endM = Math.min(totalMeasures, Math.ceil(clip.startMeasure + clip.durationMeasures));
    for (let m = startM; m < endM; m++) {
      result[m] = {
        patternIndex: clip.patternIndex,
        originalItemId: clip.id
      };
    }
  }

  return result;
};

export type AudioSnapGrid = 'bar' | 'beat' | '1/2' | '1/4' | '1/8' | '1/16' | 'off';

export interface AudioClip {
  id: string;
  trackId: string;
  bufferId: string; // Referencia al buffer en AudioBufferRegistry / IndexedDB
  name: string;
  startBeat: number; // Posición de inicio en beats musicales
  sourceOffsetSeconds: number; // Desplazamiento inicial dentro del audio
  durationSeconds: number; // Duración visible del clip en segundos
  gain: number; // Multiplicador de ganancia del clip (1.0 = 0 dB)
  fadeInSeconds: number; // Micro-fade de entrada anti-click
  fadeOutSeconds: number; // Micro-fade de salida anti-click
  isMuted: boolean;
}

export interface AudioTrack {
  id: string;
  name: string;
  color: string;
  volume: number; // Decibeles: -60 a +24 dB (0 = 0 dB ganancia unitaria, <= -59 dB es -∞ / silencio)
  pan: number; // -1.0 a 1.0
  muted: boolean;
  solo: boolean;
  isArmed: boolean;
  inputMonitoring: boolean;
}

export interface AudioTracksTimelineViewport {
  scrollLeft: number;
  zoomLevel: number; // Píxeles por beat (default 60)
}
