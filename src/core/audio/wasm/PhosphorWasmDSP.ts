/**
 * PhosphorWasmDSP.ts
 * Wrapper TypeScript del kernel WebAssembly de síntesis + FX integrado (phosphor-dsp.wasm).
 * Utilizado tanto para síntesis offline como para la compilación compartida con AudioWorklet.
 */

import type { SynthSettings } from '../../../utils/typeDefinitions';
import { PHOSPHOR_DSP_WASM_BYTES } from './phosphorDspWasmBytes';
import {
  WASM_MAX_VOICES,
  WASM_BLOCK_SIZE,
  M_SAMPLE_RATE,
  M_DT_BASE,
  M_FX_TAIL_SILENT,
  M_FX_SILENT_BLOCKS,
  M_OSC1_WAVE_CODE,
  M_OSC1_VOL,
  M_OSC1_PITCH_FACTOR,
  M_OSC2_ENABLED,
  M_OSC2_WAVE_CODE,
  M_OSC2_VOL,
  M_OSC2_PITCH_FACTOR,
  M_SUB_ENABLED,
  M_SUB_WAVE_CODE,
  M_SUB_VOL,
  M_SUB_PITCH_FACTOR,
  M_NOISE_ENABLED,
  M_NOISE_TYPE_CODE,
  M_NOISE_VOL,
  M_OSC_NORM,
  M_FILTER_ENABLED,
  M_FILTER_TYPE_CODE,
  M_FILTER_FREQ,
  M_FILTER_Q,
  M_FILTER_FOUR_POLE,
  M_FILTER_DRIVE,
  M_FILTER_DRIVE_ACTIVE,
  M_FILTER_DRIVE_TYPE,
  M_FILTER_ENV_AMT,
  M_FILTER_KEY_TRACK,
  M_GLIDE_FACTOR,
  M_ATTACK_STEP,
  M_DECAY_FACTOR,
  M_SUSTAIN,
  M_RELEASE_FACTOR,
  M_F_ATTACK_STEP,
  M_F_DECAY_FACTOR,
  M_F_SUSTAIN,
  M_F_RELEASE_FACTOR,
  M_LFO_ENABLED,
  M_LFO_WAVE_CODE,
  M_LFO_STEP,
  M_LFO_DEPTH,
  M_LFO_TARGET_CODE,
  M_GAIN_L,
  M_GAIN_R,
  M_EQ_ENABLED,
  M_HAS_GLIDE,
  M_DRIVE_PRE_GAIN,
  M_DRIVE_POST_COMP,
  M_DRY_BASS_ANCHOR,
  M_WET_SAT_MIX,
  M_EQ_BYPASS,
  M_EQ_B0,
  M_EQ_B1,
  M_EQ_B2,
  M_EQ_A1,
  M_EQ_A2,
  M_FX_CHORUS_ENABLED,
  M_FX_CHORUS_RATE,
  M_FX_CHORUS_DEPTH,
  M_FX_CHORUS_MIX,
  M_FX_DELAY_ENABLED,
  M_FX_DELAY_SAMPLES,
  M_FX_DELAY_FEEDBACK,
  M_FX_DELAY_MIX,
  M_FX_DELAY_DAMP,
  M_FX_REV_ENABLED,
  M_FX_REV_ROOM,
  M_FX_REV_DAMP1,
  M_FX_REV_DAMP2,
  M_FX_REV_MIX,
  V_B0,
  V_B1,
  V_B2,
  M_OUT_L,
  M_OUT_R
} from './phosphorMemoryLayout';

export interface PhosphorWasmExports {
  memory: WebAssembly.Memory;
  init: (sampleRate: number) => void;
  noteOn: (midi: number, velocity: number, durationSeconds: number, delaySamples: number) => void;
  noteOff: (midi: number, delaySamples: number) => void;
  allNotesOff: (delaySamples: number) => void;
  processBlock: (blockSize: number) => number;
}

let compiledModulePromise: Promise<WebAssembly.Module | null> | null = null;
let compiledModuleSync: WebAssembly.Module | null = null;

/**
 * Compila síncronamente el binario WASM integrado en módulo compartible.
 */
export function getCompiledPhosphorWasmModuleSync(): WebAssembly.Module | null {
  if (compiledModuleSync) return compiledModuleSync;
  if (typeof WebAssembly === 'undefined') return null;
  try {
    compiledModuleSync = new WebAssembly.Module(PHOSPHOR_DSP_WASM_BYTES);
    return compiledModuleSync;
  } catch (err) {
    console.warn('[PhosphorWasmDSP] Error compilando módulo WASM síncronamente:', err);
    return null;
  }
}

/**
 * Compila y memoriza una sola vez el WebAssembly.Module para poder transferirlo vía structured-clone a AudioWorklets.
 */
export async function getCompiledPhosphorWasmModule(): Promise<WebAssembly.Module | null> {
  if (compiledModuleSync) return compiledModuleSync;
  if (!compiledModulePromise) {
    compiledModulePromise = (async () => {
      if (typeof WebAssembly === 'undefined') return null;
      try {
        const mod = await WebAssembly.compile(PHOSPHOR_DSP_WASM_BYTES);
        compiledModuleSync = mod;
        return mod;
      } catch (err) {
        console.warn('[PhosphorWasmDSP] Error compilando WebAssembly.Module:', err);
        return null;
      }
    })();
  }
  return compiledModulePromise;
}

/**
 * Convierte notación musical de tiempo de delay ('8n', '8n.', '4n', '16n', '2n', segundos) a segundos reales según BPM.
 */
export function resolveDelayTimeSeconds(time: string | number | undefined, bpm = 120): number {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? Math.max(20, Math.min(300, bpm)) : 120;
  const beatSec = 60.0 / safeBpm;

  if (typeof time === 'number' && Number.isFinite(time)) {
    return Math.max(0.01, Math.min(2.5, time));
  }
  if (typeof time === 'string') {
    const trimmed = time.trim();
    const multMap: Record<string, number> = {
      '32n': 0.125,
      '16n': 0.25,
      '16n.': 0.375,
      '8t': 1 / 3,
      '8n': 0.5,
      '8n.': 0.75,
      '4t': 2 / 3,
      '4n': 1.0,
      '4n.': 1.5,
      '2n': 2.0,
      '2n.': 3.0,
      '1n': 4.0
    };
    if (trimmed in multMap) {
      return Math.max(0.01, Math.min(2.5, multMap[trimmed] * beatSec));
    }
    const parsed = parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return Math.max(0.01, Math.min(2.5, parsed));
    }
  }
  return Math.max(0.01, Math.min(2.5, 0.5 * beatSec));
}

function waveToCode(w?: string): number {
  switch (w) {
    case 'sine': return 0;
    case 'saw':
    case 'sawtooth': return 1;
    case 'pulse':
    case 'square': return 2;
    case 'tri':
    case 'triangle': return 3;
    default: return 0;
  }
}

function filterToCode(t?: string): number {
  switch (t) {
    case 'lowpass': return 0;
    case 'bandpass': return 1;
    case 'highpass': return 2;
    case 'notch': return 3;
    default: return 0;
  }
}

function driveToCode(d?: string): number {
  switch (d) {
    case 'tube': return 0;
    case 'tape': return 1;
    case 'fuzz': return 2;
    case 'warm': return 3;
    default: return 0;
  }
}

function lfoWaveToCode(w?: string): number {
  switch (w) {
    case 'sine': return 0;
    case 'sawtooth': return 1;
    case 'square': return 2;
    case 'triangle': return 3;
    case 'random': return 4;
    default: return 0;
  }
}

function lfoTargetToCode(t?: string): number {
  switch (t) {
    case 'cutoff': return 0;
    case 'pitch': return 1;
    case 'amp': return 2;
    default: return 0;
  }
}

export class PhosphorWasmEngine {
  private readonly exports: PhosphorWasmExports;
  private readonly f32: Float32Array;
  private readonly i32: Int32Array;
  public readonly outL: Float32Array;
  public readonly outR: Float32Array;
  private readonly sampleRate: number;
  private bpm = 120;
  private lastSettings: Partial<SynthSettings> | null = null;
  private lastIncludeFx = true;

  constructor(sampleRate = 44100, wasmModule?: WebAssembly.Module | null) {
    const mod = wasmModule || getCompiledPhosphorWasmModuleSync();
    if (!mod) {
      throw new Error('[PhosphorWasmEngine] No se pudo compilar el módulo WebAssembly de DSP.');
    }

    const instance = new WebAssembly.Instance(mod);
    const exports = instance.exports as unknown as PhosphorWasmExports;
    this.exports = exports;
    const buffer = exports.memory.buffer;
    this.f32 = new Float32Array(buffer);
    this.i32 = new Int32Array(buffer);
    this.outL = new Float32Array(buffer, M_OUT_L, WASM_BLOCK_SIZE);
    this.outR = new Float32Array(buffer, M_OUT_R, WASM_BLOCK_SIZE);
    this.sampleRate = sampleRate;

    exports.init(sampleRate);
  }

  public setBpm(bpm: number): void {
    const safe = Number.isFinite(bpm) && bpm > 0 ? Math.max(20, Math.min(300, bpm)) : 120;
    if (safe === this.bpm) return;
    this.bpm = safe;
    if (this.lastSettings) {
      this.writeFxSettings(this.lastSettings, this.lastIncludeFx);
    }
  }

  public setSettings(settings: Partial<SynthSettings>, includeFx = true): void {
    this.lastSettings = settings;
    this.lastIncludeFx = includeFx;

    const s = settings || {};
    const sr = this.f32[M_SAMPLE_RATE >> 2] || this.sampleRate;
    const dtBase = this.f32[M_DT_BASE >> 2] || (1.0 / sr);
    const f32 = this.f32;
    const i32 = this.i32;

    const osc1 = s.osc1;
    const osc2 = s.osc2;
    const sub = s.subOsc;
    const noise = s.noise;
    const filter = s.filter;
    const filterEnv = s.filterEnv;
    const env = s.envelope;
    const lfo = s.lfo;
    const eq = s.eq;

    const osc1Vol = osc1?.enabled !== false ? (osc1?.volume ?? 0.8) : 0;
    const osc1Octave = osc1?.octave ?? 0;
    const osc1Semi = osc1?.semi ?? 0;
    const osc1Detune = osc1?.detune ?? 0;
    const osc1PitchFactor = Math.pow(2, (osc1Octave * 12 + osc1Semi + osc1Detune / 100) / 12);

    const osc2Vol = osc2?.volume ?? 0.4;
    const osc2Enabled = Boolean(osc2?.enabled) && osc2Vol > 0.0001;
    const osc2Octave = osc2?.octave ?? 0;
    const osc2Semi = osc2?.semi ?? 0;
    const osc2Detune = osc2?.detune ?? 0;
    const osc2PitchFactor = osc2Enabled ? Math.pow(2, (osc2Octave * 12 + osc2Semi + osc2Detune / 100) / 12) : 1;

    const subVol = sub?.enabled ? (sub?.volume ?? 0.0) : 0;
    const subEnabled = Boolean(sub?.enabled) && subVol > 0.0001;
    const subOctave = sub?.octave ?? -1;
    const subPitchFactor = subEnabled ? Math.pow(2, (subOctave * 12) / 12) : 0.5;

    const noiseVol = noise?.enabled ? (noise?.volume ?? 0.0) : 0;
    const noiseEnabled = Boolean(noise?.enabled) && noiseVol > 0.0001;
    const noiseTypeCode = noise?.type === 'pink' ? 1 : 0;

    const activeOscSum = osc1Vol
      + (osc2Enabled ? osc2Vol : 0)
      + (subEnabled ? subVol * 0.7 : 0)
      + (noiseEnabled ? noiseVol * 0.35 : 0);
    const oscNorm = activeOscSum > 1.0 ? (1.0 / Math.pow(activeOscSum, 0.7)) : 1.0;

    i32[M_OSC1_WAVE_CODE >> 2] = waveToCode(osc1?.waveType || s.waveType || 'triangle');
    f32[M_OSC1_VOL >> 2] = osc1Vol;
    f32[M_OSC1_PITCH_FACTOR >> 2] = osc1PitchFactor;

    i32[M_OSC2_ENABLED >> 2] = osc2Enabled ? 1 : 0;
    i32[M_OSC2_WAVE_CODE >> 2] = waveToCode(osc2?.waveType || 'sawtooth');
    f32[M_OSC2_VOL >> 2] = osc2Vol;
    f32[M_OSC2_PITCH_FACTOR >> 2] = osc2PitchFactor;

    i32[M_SUB_ENABLED >> 2] = subEnabled ? 1 : 0;
    i32[M_SUB_WAVE_CODE >> 2] = waveToCode(sub?.waveType || 'sine');
    f32[M_SUB_VOL >> 2] = subVol;
    f32[M_SUB_PITCH_FACTOR >> 2] = subPitchFactor;

    i32[M_NOISE_ENABLED >> 2] = noiseEnabled ? 1 : 0;
    i32[M_NOISE_TYPE_CODE >> 2] = noiseTypeCode;
    f32[M_NOISE_VOL >> 2] = noiseVol;
    f32[M_OSC_NORM >> 2] = oscNorm;

    if (!noiseEnabled) {
      const b0Base = V_B0 >> 2;
      const b1Base = V_B1 >> 2;
      const b2Base = V_B2 >> 2;
      for (let v = 0; v < WASM_MAX_VOICES; v++) {
        f32[b0Base + v] = 0;
        f32[b1Base + v] = 0;
        f32[b2Base + v] = 0;
      }
    }

    const filterEnabled = filter?.enabled !== false;
    const filterFreq = filterEnabled ? Math.max(20, Math.min(20000, filter?.frequency ?? 6500)) : 20000;
    const filterQ = Math.max(0.5, Math.min(10.0, filter?.Q ?? 1.5));
    const filterFourPole = (filter?.rolloff ?? -12) <= -24 ? 1 : 0;
    const filterDrive = Math.max(0, Math.min(1, filter?.drive ?? 0.1));
    const filterDriveActive = filterDrive > 0.005 ? 1 : 0;

    i32[M_FILTER_ENABLED >> 2] = filterEnabled ? 1 : 0;
    i32[M_FILTER_TYPE_CODE >> 2] = filterToCode(filter?.type || 'lowpass');
    f32[M_FILTER_FREQ >> 2] = filterFreq;
    f32[M_FILTER_Q >> 2] = filterQ;
    i32[M_FILTER_FOUR_POLE >> 2] = filterFourPole;
    f32[M_FILTER_DRIVE >> 2] = filterDrive;
    i32[M_FILTER_DRIVE_ACTIVE >> 2] = filterDriveActive;
    i32[M_FILTER_DRIVE_TYPE >> 2] = driveToCode(filter?.driveType || 'tube');
    f32[M_FILTER_ENV_AMT >> 2] = Math.max(-1, Math.min(1, filter?.envAmount ?? 0));
    f32[M_FILTER_KEY_TRACK >> 2] = Math.max(0, Math.min(1, filter?.keyTracking ?? 0));
    f32[M_DRIVE_PRE_GAIN >> 2] = 1.0 + filterDrive * 2.4;
    f32[M_DRIVE_POST_COMP >> 2] = 1.0 / (1.0 + filterDrive * 0.42);
    const dryAnchor = 0.25 * (1.0 - filterDrive * 0.35);
    f32[M_DRY_BASS_ANCHOR >> 2] = dryAnchor;
    f32[M_WET_SAT_MIX >> 2] = 1.0 - dryAnchor;

    const glide = s.glide || 0.0;
    const hasGlide = glide > 0.001 ? 1 : 0;
    i32[M_HAS_GLIDE >> 2] = hasGlide;
    f32[M_GLIDE_FACTOR >> 2] = hasGlide ? Math.exp(-dtBase / Math.max(0.005, glide)) : 0;

    const TIME_FACTOR = -6.907755;
    const attack = Math.max(0.003, env?.attack ?? 0.04);
    const decay = Math.max(0.005, env?.decay ?? 0.25);
    const sustain = Math.max(0, Math.min(1, env?.sustain ?? 0.65));
    const release = Math.max(0.005, env?.release ?? 0.6);

    f32[M_ATTACK_STEP >> 2] = dtBase / attack;
    f32[M_DECAY_FACTOR >> 2] = Math.exp((TIME_FACTOR * dtBase) / decay);
    f32[M_SUSTAIN >> 2] = sustain;
    f32[M_RELEASE_FACTOR >> 2] = Math.exp((TIME_FACTOR * dtBase) / release);

    const fAttack = Math.max(0.003, filterEnv?.attack ?? 0.02);
    const fDecay = Math.max(0.005, filterEnv?.decay ?? 0.35);
    const fSustain = Math.max(0, Math.min(1, filterEnv?.sustain ?? 0.3));
    const fRelease = Math.max(0.005, filterEnv?.release ?? 0.6);

    f32[M_F_ATTACK_STEP >> 2] = dtBase / fAttack;
    f32[M_F_DECAY_FACTOR >> 2] = Math.exp((TIME_FACTOR * dtBase) / fDecay);
    f32[M_F_SUSTAIN >> 2] = fSustain;
    f32[M_F_RELEASE_FACTOR >> 2] = Math.exp((TIME_FACTOR * dtBase) / fRelease);

    const lfoDepth = Math.max(0, Math.min(1, lfo?.depth ?? 0.25));
    const lfoEnabled = Boolean(lfo?.enabled) && lfoDepth > 0.001;
    const lfoRate = Math.max(0.05, Math.min(30, lfo?.rate ?? 2.5));

    i32[M_LFO_ENABLED >> 2] = lfoEnabled ? 1 : 0;
    i32[M_LFO_WAVE_CODE >> 2] = lfoWaveToCode(lfo?.waveType || 'sine');
    f32[M_LFO_STEP >> 2] = lfoRate * dtBase;
    f32[M_LFO_DEPTH >> 2] = lfoDepth;
    i32[M_LFO_TARGET_CODE >> 2] = lfoTargetToCode(lfo?.target || 'cutoff');

    const gain = 0.7 * (s.masterGain ?? 1.0);
    f32[M_GAIN_L >> 2] = gain;
    f32[M_GAIN_R >> 2] = gain;

    this.writeEqSettings(Boolean(eq?.enabled), eq?.low ?? 0, eq?.lowMid ?? 0, eq?.highMid ?? 0, eq?.high ?? 0, sr);
    this.writeFxSettings(s, includeFx);
  }

  private writeEqSettings(
    enabled: boolean,
    eqLow: number,
    eqLowMid: number,
    eqHighMid: number,
    eqHigh: number,
    sr: number
  ): void {
    const f32 = this.f32;
    const i32 = this.i32;

    if (!enabled) {
      i32[M_EQ_ENABLED >> 2] = 0;
      const bypassBase = M_EQ_BYPASS >> 2;
      i32[bypassBase] = 1;
      i32[bypassBase + 1] = 1;
      i32[bypassBase + 2] = 1;
      i32[bypassBase + 3] = 1;
      return;
    }

    const bands: { type: 'lowshelf' | 'peaking' | 'highshelf'; f0: number; Q: number; gainDb: number }[] = [
      { type: 'lowshelf', f0: 100, Q: 1.0, gainDb: eqLow },
      { type: 'peaking', f0: 500, Q: 1.0, gainDb: eqLowMid },
      { type: 'peaking', f0: 2800, Q: 1.0, gainDb: eqHighMid },
      { type: 'highshelf', f0: 10000, Q: 1.0, gainDb: eqHigh }
    ];

    const bypassBase = M_EQ_BYPASS >> 2;
    const b0Base = M_EQ_B0 >> 2;
    const b1Base = M_EQ_B1 >> 2;
    const b2Base = M_EQ_B2 >> 2;
    const a1Base = M_EQ_A1 >> 2;
    const a2Base = M_EQ_A2 >> 2;

    let anyActive = false;
    for (let i = 0; i < 4; i++) {
      const b = bands[i];
      if (Math.abs(b.gainDb) < 0.05) {
        i32[bypassBase + i] = 1;
        f32[b0Base + i] = 1;
        f32[b1Base + i] = 0;
        f32[b2Base + i] = 0;
        f32[a1Base + i] = 0;
        f32[a2Base + i] = 0;
      } else {
        anyActive = true;
        i32[bypassBase + i] = 0;
        const A = Math.pow(10, b.gainDb / 40);
        const w0 = (2 * Math.PI * Math.max(10, Math.min(sr * 0.49, b.f0))) / sr;
        const cosW = Math.cos(w0);
        const sinW = Math.sin(w0);

        let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
        if (b.type === 'peaking') {
          const alpha = sinW / (2 * b.Q);
          b0 = 1 + alpha * A;
          b1 = -2 * cosW;
          b2 = 1 - alpha * A;
          a0 = 1 + alpha / A;
          a1 = -2 * cosW;
          a2 = 1 - alpha / A;
        } else if (b.type === 'lowshelf') {
          const alpha = (sinW / 2) * Math.SQRT2;
          const aPlus1 = A + 1;
          const aMinus1 = A - 1;
          const twoSqrtAlpha = 2 * Math.sqrt(A) * alpha;

          b0 = A * (aPlus1 - aMinus1 * cosW + twoSqrtAlpha);
          b1 = 2 * A * (aMinus1 - aPlus1 * cosW);
          b2 = A * (aPlus1 - aMinus1 * cosW - twoSqrtAlpha);
          a0 = aPlus1 + aMinus1 * cosW + twoSqrtAlpha;
          a1 = -2 * (aMinus1 + aPlus1 * cosW);
          a2 = aPlus1 + aMinus1 * cosW - twoSqrtAlpha;
        } else {
          const alpha = (sinW / 2) * Math.SQRT2;
          const aPlus1 = A + 1;
          const aMinus1 = A - 1;
          const twoSqrtAlpha = 2 * Math.sqrt(A) * alpha;

          b0 = A * (aPlus1 + aMinus1 * cosW + twoSqrtAlpha);
          b1 = -2 * A * (aMinus1 + aPlus1 * cosW);
          b2 = A * (aPlus1 + aMinus1 * cosW - twoSqrtAlpha);
          a0 = aPlus1 - aMinus1 * cosW + twoSqrtAlpha;
          a1 = 2 * (aMinus1 - aPlus1 * cosW);
          a2 = aPlus1 - aMinus1 * cosW - twoSqrtAlpha;
        }

        const invA0 = 1.0 / a0;
        f32[b0Base + i] = b0 * invA0;
        f32[b1Base + i] = b1 * invA0;
        f32[b2Base + i] = b2 * invA0;
        f32[a1Base + i] = a1 * invA0;
        f32[a2Base + i] = a2 * invA0;
      }
    }

    i32[M_EQ_ENABLED >> 2] = anyActive ? 1 : 0;
  }

  private writeFxSettings(s: Partial<SynthSettings>, includeFx: boolean): void {
    const f32 = this.f32;
    const i32 = this.i32;
    const fx = s.fx;

    if (!includeFx || !fx) {
      i32[M_FX_CHORUS_ENABLED >> 2] = 0;
      i32[M_FX_DELAY_ENABLED >> 2] = 0;
      i32[M_FX_REV_ENABLED >> 2] = 0;
      return;
    }

    const sr = f32[M_SAMPLE_RATE >> 2] || this.sampleRate;

    const chorusEnabled = Boolean(fx.chorus?.enabled && (fx.chorus.mix ?? 0) > 0.01);
    i32[M_FX_CHORUS_ENABLED >> 2] = chorusEnabled ? 1 : 0;
    f32[M_FX_CHORUS_RATE >> 2] = Math.max(0.05, Math.min(10, fx.chorus?.rate ?? 1.5));
    f32[M_FX_CHORUS_DEPTH >> 2] = Math.max(0, Math.min(1, fx.chorus?.depth ?? 0.4));
    f32[M_FX_CHORUS_MIX >> 2] = Math.max(0, Math.min(1, fx.chorus?.mix ?? 0.3));

    const delayEnabled = Boolean(fx.delay?.enabled && (fx.delay.mix ?? 0) > 0.01);
    const delaySec = resolveDelayTimeSeconds(fx.delay?.time ?? '8n', this.bpm);
    i32[M_FX_DELAY_ENABLED >> 2] = delayEnabled ? 1 : 0;
    f32[M_FX_DELAY_SAMPLES >> 2] = Math.max(64, Math.min(131000, delaySec * sr));
    f32[M_FX_DELAY_FEEDBACK >> 2] = Math.max(0, Math.min(0.75, fx.delay?.feedback ?? 0.25));
    f32[M_FX_DELAY_MIX >> 2] = Math.max(0, Math.min(0.55, fx.delay?.mix ?? 0.2));
    f32[M_FX_DELAY_DAMP >> 2] = 0.28;

    const revEnabled = Boolean(fx.reverb?.enabled && (fx.reverb.mix ?? 0) > 0.01);
    const roomNorm = Math.max(0.1, Math.min(0.9, (fx.reverb?.decay ?? 1.8) / 4));
    const revRoom = 0.70 + roomNorm * 0.255;
    const revDamp1 = 0.40;
    i32[M_FX_REV_ENABLED >> 2] = revEnabled ? 1 : 0;
    f32[M_FX_REV_ROOM >> 2] = revRoom;
    f32[M_FX_REV_DAMP1 >> 2] = revDamp1;
    f32[M_FX_REV_DAMP2 >> 2] = 1.0 - revDamp1;
    f32[M_FX_REV_MIX >> 2] = Math.max(0, Math.min(0.55, fx.reverb?.mix ?? 0.15));

    if (chorusEnabled || delayEnabled || revEnabled) {
      i32[M_FX_TAIL_SILENT >> 2] = 0;
      i32[M_FX_SILENT_BLOCKS >> 2] = 0;
    }
  }

  public noteOn(midi: number, velocity: number, durationSeconds = -1, delaySamples = 0): void {
    this.exports.noteOn(midi | 0, velocity, durationSeconds, delaySamples | 0);
  }

  public noteOff(midi: number, delaySamples = 0): void {
    this.exports.noteOff(midi | 0, delaySamples | 0);
  }

  public allNotesOff(delaySamples = 0): void {
    this.exports.allNotesOff(delaySamples | 0);
  }

  /**
   * Ejecuta un bloque DSP directamente en memoria WASM (sin copia; leer vía `this.outL`/`this.outR`).
   */
  public processInternal(blockSize: number): boolean {
    return this.exports.processBlock(blockSize | 0) !== 0;
  }

  /**
   * Ejecuta un bloque DSP y copia el resultado estéreo a los buffers destino.
   */
  public process(outL: Float32Array, outR: Float32Array, blockSize: number): boolean {
    const active = this.exports.processBlock(blockSize | 0) !== 0;
    if (!active) {
      outL.fill(0, 0, blockSize);
      if (outR !== outL) outR.fill(0, 0, blockSize);
      return false;
    }
    if (blockSize === WASM_BLOCK_SIZE) {
      outL.set(this.outL);
      if (outR !== outL) outR.set(this.outR);
    } else {
      outL.set(this.outL.subarray(0, blockSize));
      if (outR !== outL) outR.set(this.outR.subarray(0, blockSize));
    }
    return true;
  }
}
