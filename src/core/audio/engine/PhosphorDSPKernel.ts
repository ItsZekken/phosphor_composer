/**
 * PhosphorDSPKernel.ts
 * Motor de síntesis analógica pura de alta velocidad para renderizado offline y exportación.
 * 
 * Este kernel replica al 100% el comportamiento acústico y DSP de PhosphorWorkletProcessor
 * pero sin requerir AudioWorkletProcessor ni depender del emulador de standardized-audio-context.
 * 
 * - Osciladores con Anti-Aliasing PolyBLEP (Saw, Square, Triangle, Sine)
 * - Sub-oscilador multiforma y generador de ruido blanco/rosa (1/f de 3 polos)
 * - Filtro SVF Cytomic (Lowpass, Bandpass, Highpass, Notch) con saturación analógica
 * - Envolvente ADSR con curvas analógicas T60 (-60 dB)
 * - Ecualizador Gráfico Paramétrico de 4 bandas (Direct Form II Transpuesto)
 * - Modulación LFO (Pitch, Cutoff, Amp)
 * - Cero asignaciones en el bucle caliente (Hot Loop)
 */

import * as Tone from 'tone';
import type { SynthSettings } from '../../../utils/typeDefinitions';
import { noteToMidi } from '../../music/pitchClass';

export interface Voice {
  active: boolean;
  midi: number;
  frequency: number;
  targetFrequency: number;
  velocity: number;
  phase1: number;
  phase2: number;
  phaseSub: number;
  envStage: 'idle' | 'pending' | 'attack' | 'decay' | 'sustain' | 'release';
  envLevel: number;
  startSample: number;
  targetReleaseSample: number;
  ic1eq: number;
  ic2eq: number;
  b0: number;
  b1: number;
  b2: number;
  age: number;
}

export interface SynthParams {
  osc1Wave: 'sine' | 'square' | 'triangle' | 'sawtooth';
  osc1Vol: number;
  osc1Octave: number;
  osc1Semi: number;
  osc1Detune: number;
  osc2Enabled: boolean;
  osc2Wave: 'sine' | 'square' | 'triangle' | 'sawtooth';
  osc2Vol: number;
  osc2Octave: number;
  osc2Semi: number;
  osc2Detune: number;
  subEnabled: boolean;
  subWave: 'sine' | 'square' | 'triangle';
  subVol: number;
  subOctave: number;
  noiseEnabled: boolean;
  noiseType: 'white' | 'pink';
  noiseVol: number;
  filterEnabled: boolean;
  filterType: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  filterFreq: number;
  filterQ: number;
  filterDrive: number;
  filterDriveType?: 'tube' | 'tape' | 'fuzz' | 'warm';
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  glide: number;
  lfoEnabled: boolean;
  lfoWave: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random';
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: 'cutoff' | 'pitch' | 'amp';
  eqEnabled?: boolean;
  eqLow?: number;
  eqLowMid?: number;
  eqHighMid?: number;
  eqHigh?: number;
  gain: number;
  pan: number;
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const v = t / dt;
    return v + v - v * v - 1.0;
  } else if (t > 1.0 - dt) {
    const v = (t - 1.0) / dt;
    return v * v + v + v + 1.0;
  }
  return 0.0;
}

export class PhosphorDSPKernel {
  private voices: Voice[] = [];
  private maxVoices = 32;
  private ageCounter = 0;
  private currentSample = 0;
  private lfoPhase = 0;
  private lfoRandVal = 0;
  private sampleRate: number;

  private activeVoiceIndices = new Int32Array(32);
  private osc1WaveCode = 3; // triangle
  private osc2WaveCode = 1; // sawtooth
  private subWaveCode = 0;  // sine
  private lfoWaveCode = 0;  // sine
  private filterTypeCode = 0; // lowpass: 0, bandpass: 1, highpass: 2, notch: 3
  private driveTypeCode = 0;  // tube: 0, tape: 1, fuzz: 2, warm: 3
  private noiseTypeCode = 0;  // white: 0, pink: 1
  private lfoTargetCode = 0;  // cutoff: 0, pitch: 1, amp: 2

  private eqB0 = new Float32Array(4);
  private eqB1 = new Float32Array(4);
  private eqB2 = new Float32Array(4);
  private eqA1 = new Float32Array(4);
  private eqA2 = new Float32Array(4);
  private eqBypass = [true, true, true, true];
  private eqAllBypassed = true;
  private eqL1 = new Float32Array(4);
  private eqL2 = new Float32Array(4);
  private eqR1 = new Float32Array(4);
  private eqR2 = new Float32Array(4);

  private params: SynthParams = {
    osc1Wave: 'triangle',
    osc1Vol: 0.8,
    osc1Octave: 0,
    osc1Semi: 0,
    osc1Detune: 0,
    osc2Enabled: true,
    osc2Wave: 'sawtooth',
    osc2Vol: 0.4,
    osc2Octave: 0,
    osc2Semi: 0,
    osc2Detune: 0,
    subEnabled: false,
    subWave: 'sine',
    subVol: 0.0,
    subOctave: -1,
    noiseEnabled: false,
    noiseType: 'white',
    noiseVol: 0.0,
    filterEnabled: true,
    filterType: 'lowpass',
    filterFreq: 6500,
    filterQ: 1.5,
    filterDrive: 0.1,
    filterDriveType: 'tube',
    attack: 0.04,
    decay: 0.25,
    sustain: 0.65,
    release: 0.6,
    glide: 0.0,
    lfoEnabled: false,
    lfoWave: 'sine',
    lfoRate: 2.5,
    lfoDepth: 0.25,
    lfoTarget: 'cutoff',
    eqEnabled: false,
    eqLow: 0,
    eqLowMid: 0,
    eqHighMid: 0,
    eqHigh: 0,
    gain: 0.7,
    pan: 0.0
  };

  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;

    for (let i = 0; i < this.maxVoices; i++) {
      this.voices.push({
        active: false,
        midi: 0,
        frequency: 440,
        targetFrequency: 440,
        velocity: 0.8,
        phase1: 0,
        phase2: 0,
        phaseSub: 0,
        envStage: 'idle',
        envLevel: 0,
        startSample: -1,
        targetReleaseSample: -1,
        ic1eq: 0,
        ic2eq: 0,
        b0: 0,
        b1: 0,
        b2: 0,
        age: 0
      });
    }

    this.updateEqCoefficients();
  }

  private waveToCode(w?: string): number {
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

  private filterToCode(t?: string): number {
    switch (t) {
      case 'lowpass': return 0;
      case 'bandpass': return 1;
      case 'highpass': return 2;
      case 'notch': return 3;
      default: return 0;
    }
  }

  private driveToCode(d?: string): number {
    switch (d) {
      case 'tube': return 0;
      case 'tape': return 1;
      case 'fuzz': return 2;
      case 'warm': return 3;
      default: return 0;
    }
  }

  private lfoWaveToCode(w?: string): number {
    switch (w) {
      case 'sine': return 0;
      case 'sawtooth': return 1;
      case 'square': return 2;
      case 'triangle': return 3;
      case 'random': return 4;
      default: return 0;
    }
  }

  private lfoTargetToCode(t?: string): number {
    switch (t) {
      case 'cutoff': return 0;
      case 'pitch': return 1;
      case 'amp': return 2;
      default: return 0;
    }
  }

  public setSettings(settings: Partial<SynthSettings>) {
    const s = settings;
    const osc1 = s.osc1;
    const osc2 = s.osc2;
    const sub = s.subOsc;
    const noise = s.noise;
    const filter = s.filter;
    const env = s.envelope;
    const lfo = s.lfo;
    const eq = s.eq;

    this.params = {
      osc1Wave: (osc1?.waveType || s.waveType || 'triangle') as any,
      osc1Vol: osc1?.enabled !== false ? (osc1?.volume ?? 0.8) : 0,
      osc1Octave: osc1?.octave ?? 0,
      osc1Semi: osc1?.semi ?? 0,
      osc1Detune: osc1?.detune ?? 0,

      osc2Enabled: osc2?.enabled ?? false,
      osc2Wave: (osc2?.waveType || 'sawtooth') as any,
      osc2Vol: osc2?.volume ?? 0.4,
      osc2Octave: osc2?.octave ?? 0,
      osc2Semi: osc2?.semi ?? 0,
      osc2Detune: osc2?.detune ?? 0,

      subEnabled: sub?.enabled ?? false,
      subWave: (sub?.waveType || 'sine') as any,
      subVol: sub?.enabled ? (sub?.volume ?? 0.0) : 0,
      subOctave: sub?.octave ?? -1,

      noiseEnabled: noise?.enabled ?? false,
      noiseType: (noise?.type || 'white') as any,
      noiseVol: noise?.enabled ? (noise?.volume ?? 0.0) : 0,

      filterEnabled: filter?.enabled !== false,
      filterType: (filter?.type || 'lowpass') as any,
      filterFreq: filter?.enabled ? Math.max(20, Math.min(20000, filter?.frequency ?? 6500)) : 20000,
      filterQ: Math.max(0.1, Math.min(20, filter?.Q ?? 1.5)),
      filterDrive: Math.max(0, Math.min(1, filter?.drive ?? 0.1)),
      filterDriveType: filter?.driveType || 'tube',

      attack: Math.max(0.001, env?.attack ?? 0.04),
      decay: Math.max(0.001, env?.decay ?? 0.25),
      sustain: Math.max(0, Math.min(1, env?.sustain ?? 0.65)),
      release: Math.max(0.001, env?.release ?? 0.6),

      glide: s.glide || 0.0,
      lfoEnabled: Boolean(lfo?.enabled),
      lfoWave: (lfo?.waveType || 'sine') as any,
      lfoRate: Math.max(0.05, Math.min(30, lfo?.rate ?? 2.5)),
      lfoDepth: Math.max(0, Math.min(1, lfo?.depth ?? 0.25)),
      lfoTarget: lfo?.target || 'cutoff',

      eqEnabled: Boolean(eq?.enabled),
      eqLow: eq?.low ?? 0,
      eqLowMid: eq?.lowMid ?? 0,
      eqHighMid: eq?.highMid ?? 0,
      eqHigh: eq?.high ?? 0,

      gain: 0.7 * (s.masterGain ?? 1.0),
      pan: 0.0
    };

    this.osc1WaveCode = this.waveToCode(this.params.osc1Wave);
    this.osc2WaveCode = this.waveToCode(this.params.osc2Wave);
    this.subWaveCode = this.waveToCode(this.params.subWave);
    this.filterTypeCode = this.filterToCode(this.params.filterType);
    this.driveTypeCode = this.driveToCode(this.params.filterDriveType);
    this.noiseTypeCode = this.params.noiseType === 'pink' ? 1 : 0;
    this.lfoWaveCode = this.lfoWaveToCode(this.params.lfoWave);
    this.lfoTargetCode = this.lfoTargetToCode(this.params.lfoTarget);

    this.updateEqCoefficients();
    if (!this.params.noiseEnabled || this.params.noiseVol <= 0.0001) {
      for (let i = 0; i < this.maxVoices; i++) {
        this.voices[i].b0 = 0;
        this.voices[i].b1 = 0;
        this.voices[i].b2 = 0;
      }
    }
  }

  private updateEqCoefficients() {
    if (!this.params.eqEnabled) {
      this.eqAllBypassed = true;
      return;
    }

    const sr = this.sampleRate;
    const bands: { type: 'lowshelf' | 'peaking' | 'highshelf'; f0: number; Q: number; gainDb: number }[] = [
      { type: 'lowshelf', f0: 100, Q: 1.0, gainDb: this.params.eqLow ?? 0 },
      { type: 'peaking', f0: 500, Q: 1.0, gainDb: this.params.eqLowMid ?? 0 },
      { type: 'peaking', f0: 2800, Q: 1.0, gainDb: this.params.eqHighMid ?? 0 },
      { type: 'highshelf', f0: 10000, Q: 1.0, gainDb: this.params.eqHigh ?? 0 }
    ];

    let anyActive = false;
    for (let i = 0; i < 4; i++) {
      const b = bands[i];
      if (Math.abs(b.gainDb) < 0.05) {
        this.eqB0[i] = 1;
        this.eqB1[i] = 0;
        this.eqB2[i] = 0;
        this.eqA1[i] = 0;
        this.eqA2[i] = 0;
        this.eqBypass[i] = true;
      } else {
        anyActive = true;
        this.eqBypass[i] = false;
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
        } else if (b.type === 'highshelf') {
          const alpha = (sinW / 2) * Math.SQRT2;
          const aPlus1 = A + 1;
          const aMinus1 = A - 1;
          const twoSqrtAlpha = 2 * Math.sqrt(A) * alpha;

          b0 = A * (aPlus1 + aMinus1 * cosW + twoSqrtAlpha);
          b1 = -2 * A * (aMinus1 + aPlus1 * cosW);
          b2 = A * (aPlus1 - aMinus1 * cosW - twoSqrtAlpha);
          a0 = aPlus1 - aMinus1 * cosW + twoSqrtAlpha;
          a1 = 2 * (aMinus1 - aPlus1 * cosW);
          a2 = aPlus1 - aMinus1 * cosW - twoSqrtAlpha;
        }

        const invA0 = 1.0 / a0;
        this.eqB0[i] = b0 * invA0;
        this.eqB1[i] = b1 * invA0;
        this.eqB2[i] = b2 * invA0;
        this.eqA1[i] = a1 * invA0;
        this.eqA2[i] = a2 * invA0;
      }
    }

    this.eqAllBypassed = !anyActive;
  }

  public noteOn(midi: number, velocity: number, durationSeconds?: number, delaySamples?: number) {
    let targetVoice: Voice | null = null;

    for (let i = 0; i < this.maxVoices; i++) {
      if (!this.voices[i].active || this.voices[i].envStage === 'idle') {
        targetVoice = this.voices[i];
        break;
      }
    }

    if (!targetVoice) {
      let oldestAge = Infinity;
      for (let i = 0; i < this.maxVoices; i++) {
        if (this.voices[i].age < oldestAge) {
          oldestAge = this.voices[i].age;
          targetVoice = this.voices[i];
        }
      }
    }

    if (!targetVoice) return;

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const startDelay = delaySamples && delaySamples > 0 ? Math.floor(delaySamples) : 0;
    const targetStart = this.currentSample + startDelay;

    targetVoice.active = true;
    targetVoice.midi = midi;
    targetVoice.targetFrequency = freq;
    if (this.params.glide <= 0.001 || targetVoice.envStage === 'idle' || !targetVoice.frequency) {
      targetVoice.frequency = freq;
    }
    targetVoice.velocity = velocity;
    targetVoice.startSample = targetStart;
    targetVoice.age = ++this.ageCounter;

    targetVoice.phase1 = 0;
    targetVoice.phase2 = 0;
    targetVoice.phaseSub = 0;
    targetVoice.ic1eq = 0;
    targetVoice.ic2eq = 0;
    targetVoice.b0 = 0;
    targetVoice.b1 = 0;
    targetVoice.b2 = 0;

    if (startDelay > 0) {
      targetVoice.envStage = 'pending';
      targetVoice.envLevel = 0;
    } else {
      targetVoice.envStage = 'attack';
    }

    targetVoice.targetReleaseSample =
      durationSeconds && durationSeconds > 0
        ? targetStart + Math.floor(durationSeconds * this.sampleRate)
        : -1;
  }

  public noteOff(midi: number, delaySamples?: number) {
    const releaseSample = delaySamples && delaySamples > 0 ? this.currentSample + Math.floor(delaySamples) : this.currentSample;
    for (let i = 0; i < this.maxVoices; i++) {
      const v = this.voices[i];
      if (v.active && v.midi === midi && v.envStage !== 'idle' && v.envStage !== 'release') {
        if (delaySamples && delaySamples > 0) {
          v.targetReleaseSample = releaseSample;
        } else {
          v.envStage = 'release';
        }
      }
    }
  }

  public allNotesOff(delaySamples?: number) {
    const releaseSample = delaySamples && delaySamples > 0 ? this.currentSample + Math.floor(delaySamples) : this.currentSample;
    for (let i = 0; i < this.maxVoices; i++) {
      const v = this.voices[i];
      if (v.active && v.envStage !== 'idle' && v.envStage !== 'release') {
        if (delaySamples && delaySamples > 0) {
          v.targetReleaseSample = releaseSample;
        } else {
          v.envStage = 'release';
        }
      }
    }
  }

  private sampleOsc(waveCode: number, phase: number, dt: number): number {
    switch (waveCode) {
      case 0: // sine
        return Math.sin(phase * 6.283185307179586);
      case 1: { // sawtooth
        const raw = 2.0 * phase - 1.0;
        return raw - polyBlep(phase, dt);
      }
      case 2: { // square
        const raw = phase < 0.5 ? 1.0 : -1.0;
        return raw + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1.0, dt);
      }
      case 3: { // triangle
        const saw = 2.0 * phase - 1.0 - polyBlep(phase, dt);
        return 2.0 * Math.abs(saw) - 1.0;
      }
      default:
        return 0;
    }
  }

  public process(outL: Float32Array, outR: Float32Array, blockSize: number): boolean {
    outL.fill(0);
    outR.fill(0);

    const sr = this.sampleRate;
    const dtBase = 1.0 / sr;

    const TIME_FACTOR = -6.907755;
    const attackStep = dtBase / Math.max(0.001, this.params.attack);
    const decayFactor = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.001, this.params.decay));
    const releaseFactor = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.001, this.params.release));
    const sustainLevel = Math.max(0, Math.min(1, this.params.sustain));
    const glideFactor = this.params.glide > 0.001 ? Math.exp(-dtBase / Math.max(0.005, this.params.glide)) : 0;

    const osc1PitchFactor = Math.pow(2, (this.params.osc1Octave * 12 + this.params.osc1Semi + this.params.osc1Detune / 100) / 12);
    const osc2PitchFactor = this.params.osc2Enabled ? Math.pow(2, (this.params.osc2Octave * 12 + this.params.osc2Semi + this.params.osc2Detune / 100) / 12) : 1;
    const subPitchFactor = this.params.subEnabled ? Math.pow(2, (this.params.subOctave * 12) / 12) : 0.5;

    let activeCount = 0;
    const voices = this.voices;
    const activeIndices = this.activeVoiceIndices;
    for (let v = 0; v < this.maxVoices; v++) {
      if (voices[v].active && voices[v].envStage !== 'idle') {
        activeIndices[activeCount++] = v;
      }
    }
    if (activeCount === 0) {
      this.currentSample += blockSize;
      return false;
    }

    let a1 = 0, a2 = 0, a3 = 0, k = 1;
    const filterEnabled = this.params.filterEnabled;
    const filterFreq = this.params.filterFreq;
    const filterTypeCode = this.filterTypeCode;
    if (filterEnabled) {
      const cutoffClamped = Math.max(20, Math.min(sr * 0.49, filterFreq));
      const g = Math.tan((Math.PI * cutoffClamped) / sr);
      k = 1.0 / Math.max(0.1, this.params.filterQ);
      a1 = 1.0 / (1.0 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }

    const pan = Math.max(-1, Math.min(1, this.params.pan));
    const gainL = this.params.gain * (pan <= 0 ? 1 : 1 - pan);
    const gainR = this.params.gain * (pan >= 0 ? 1 : 1 + pan);

    const isLfoActive = Boolean(this.params.lfoEnabled && (this.params.lfoDepth ?? 0) > 0.001);
    const lfoRate = Math.max(0.1, Math.min(20, this.params.lfoRate ?? 2.5));
    const lfoDepth = Math.max(0, Math.min(1, this.params.lfoDepth ?? 0.25));
    const lfoTargetCode = this.lfoTargetCode;
    const lfoWaveCode = this.lfoWaveCode;
    const lfoStep = lfoRate * dtBase;

    const osc1Vol = this.params.osc1Vol;
    const osc1WaveCode = this.osc1WaveCode;
    const osc2Enabled = this.params.osc2Enabled && this.params.osc2Vol > 0.0001;
    const osc2Vol = this.params.osc2Vol;
    const osc2WaveCode = this.osc2WaveCode;
    const subEnabled = this.params.subEnabled && this.params.subVol > 0.0001;
    const subVol = this.params.subVol;
    const subWaveCode = this.subWaveCode;
    const noiseEnabled = this.params.noiseEnabled && this.params.noiseVol > 0.0001;
    const noiseVol = this.params.noiseVol;
    const isPinkNoise = this.noiseTypeCode === 1;

    const filterDrive = this.params.filterDrive;
    const filterDriveActive = filterDrive > 0.005;
    const driveTypeCode = this.driveTypeCode;
    const drivePreGain = 1.0 + filterDrive * 2.8;
    const driveBoost = 1.0 + filterDrive * 0.85;
    const dryBassAnchor = 0.28 * (1.0 - filterDrive * 0.4);
    const wetSatMix = 1.0 - dryBassAnchor;

    const eqEnabled = this.params.eqEnabled && !this.eqAllBypassed;
    const eqBypass = this.eqBypass;
    const eqB0 = this.eqB0, eqB1 = this.eqB1, eqB2 = this.eqB2;
    const eqA1 = this.eqA1, eqA2 = this.eqA2;
    const eqL1 = this.eqL1, eqL2 = this.eqL2;
    const eqR1 = this.eqR1, eqR2 = this.eqR2;

    let currentSample = this.currentSample;

    for (let s = 0; s < blockSize; s++) {
      currentSample++;
      let sampleSumL = 0;
      let sampleSumR = 0;

      let lfoVal = 0;
      if (isLfoActive) {
        const prevPhase = this.lfoPhase;
        this.lfoPhase = (this.lfoPhase + lfoStep) % 1.0;
        if (this.lfoPhase < prevPhase) {
          this.lfoRandVal = Math.random() * 2.0 - 1.0;
        }

        switch (lfoWaveCode) {
          case 3: // triangle
            lfoVal = 2.0 * Math.abs(2.0 * this.lfoPhase - 1.0) - 1.0;
            break;
          case 1: // sawtooth
            lfoVal = 1.0 - 2.0 * this.lfoPhase;
            break;
          case 2: // square
            lfoVal = this.lfoPhase < 0.5 ? 1.0 : -1.0;
            break;
          case 4: // random
            lfoVal = this.lfoRandVal;
            break;
          case 0: // sine
          default:
            lfoVal = Math.sin(this.lfoPhase * 6.283185307179586);
            break;
        }
      }

      const lfoPitchMult = (isLfoActive && lfoTargetCode === 1)
        ? (1.0 + lfoVal * lfoDepth * 0.086)
        : 1.0;

      if (filterEnabled && isLfoActive && lfoTargetCode === 0) {
        if ((s & 3) === 0) {
          const modFactor = Math.pow(2.0, lfoVal * lfoDepth * 3.5);
          const modCutoff = Math.max(20, Math.min(sr * 0.49, filterFreq * modFactor));
          const g = Math.tan((Math.PI * modCutoff) / sr);
          a1 = 1.0 / (1.0 + g * (g + k));
          a2 = g * a1;
          a3 = g * a2;
        }
      }

      for (let i = 0; i < activeCount; i++) {
        const voice = voices[activeIndices[i]];
        if (!voice.active || voice.envStage === 'idle') {
          continue;
        }

        if (voice.envStage === 'pending') {
          if (currentSample >= voice.startSample) {
            voice.envStage = 'attack';
          } else {
            continue;
          }
        }

        if (voice.targetReleaseSample > 0 && currentSample >= voice.targetReleaseSample) {
          voice.envStage = 'release';
          voice.targetReleaseSample = -1;
        }

        switch (voice.envStage) {
          case 'attack':
            voice.envLevel += attackStep;
            if (voice.envLevel >= 1.0) {
              voice.envLevel = 1.0;
              voice.envStage = 'decay';
            }
            break;
          case 'decay':
            voice.envLevel = sustainLevel + (voice.envLevel - sustainLevel) * decayFactor;
            if (sustainLevel <= 0.001 && voice.envLevel < 0.0005) {
              voice.envLevel = 0;
              voice.envStage = 'idle';
              voice.active = false;
              voice.ic1eq = 0;
              voice.ic2eq = 0;
              continue;
            }
            break;
          case 'sustain':
            voice.envLevel = sustainLevel;
            break;
          case 'release':
            voice.envLevel *= releaseFactor;
            if (voice.envLevel < 0.0005) {
              voice.envLevel = 0;
              voice.envStage = 'idle';
              voice.active = false;
              voice.ic1eq = 0;
              voice.ic2eq = 0;
              continue;
            }
            break;
        }

        if (glideFactor > 0) {
          voice.frequency = voice.targetFrequency + (voice.frequency - voice.targetFrequency) * glideFactor;
        } else {
          voice.frequency = voice.targetFrequency;
        }

        const dt1 = voice.frequency * osc1PitchFactor * lfoPitchMult * dtBase;
        voice.phase1 = (voice.phase1 + dt1) % 1.0;
        let voiceSample = this.sampleOsc(osc1WaveCode, voice.phase1, dt1) * osc1Vol;

        if (osc2Enabled) {
          const dt2 = voice.frequency * osc2PitchFactor * lfoPitchMult * dtBase;
          voice.phase2 = (voice.phase2 + dt2) % 1.0;
          voiceSample += this.sampleOsc(osc2WaveCode, voice.phase2, dt2) * osc2Vol;
        }

        if (subEnabled) {
          const dtSub = voice.frequency * subPitchFactor * lfoPitchMult * dtBase;
          voice.phaseSub = (voice.phaseSub + dtSub) % 1.0;
          voiceSample += this.sampleOsc(subWaveCode, voice.phaseSub, dtSub) * subVol;
        }

        if (noiseEnabled) {
          const white = Math.random() * 2.0 - 1.0;
          if (isPinkNoise) {
            voice.b0 = 0.99765 * voice.b0 + white * 0.0990460;
            voice.b1 = 0.96300 * voice.b1 + white * 0.2965164;
            voice.b2 = 0.57000 * voice.b2 + white * 1.0526913;
            const pink = voice.b0 + voice.b1 + voice.b2 + white * 0.1848;
            voiceSample += pink * 0.18 * noiseVol;
          } else {
            voiceSample += white * noiseVol;
          }
        }

        if (filterEnabled) {
          const v0 = voiceSample;
          const v1 = a1 * voice.ic1eq + a2 * (v0 - voice.ic2eq);
          const v2 = voice.ic2eq + a2 * voice.ic1eq + a3 * (v0 - voice.ic2eq);
          voice.ic1eq = 2.0 * v1 - voice.ic1eq;
          voice.ic2eq = 2.0 * v2 - voice.ic2eq;

          switch (filterTypeCode) {
            case 0: voiceSample = v2; break;
            case 1: voiceSample = v1; break;
            case 2: voiceSample = v0 - k * v1 - v2; break;
            case 3: voiceSample = v0 - k * v1; break;
          }
        }

        if (filterDriveActive) {
          const sVal = voiceSample * drivePreGain;
          let sat = sVal;

          switch (driveTypeCode) {
            case 0: // tube
              if (sVal >= 0) {
                sat = sVal / (1.0 + 0.45 * sVal);
              } else {
                const neg = -sVal;
                sat = -neg / (1.0 + 0.7 * neg);
              }
              break;
            case 1: { // tape
              const s2 = sVal * sVal;
              sat = (sVal * (27.0 + s2)) / (27.0 + 9.0 * s2);
              break;
            }
            case 2: // fuzz
              sat = (1.35 * sVal) / Math.sqrt(1.0 + sVal * sVal * 0.75);
              break;
            case 3: // warm
              if (sVal > 1.25) sat = 1.0;
              else if (sVal < -1.25) sat = -1.0;
              else sat = sVal - (sVal * sVal * sVal) * 0.2;
              break;
          }

          voiceSample = (sat * wetSatMix + voiceSample * dryBassAnchor) * driveBoost;
        }

        const amp = voiceSample * voice.envLevel * voice.velocity;
        sampleSumL += amp;
        sampleSumR += amp;
      }

      const lfoAmpGain = (isLfoActive && lfoTargetCode === 2)
        ? Math.max(0, 1.0 - lfoDepth * 0.5 * (1.0 - lfoVal))
        : 1.0;

      let finalL = sampleSumL * gainL * lfoAmpGain;
      let finalR = sampleSumR * gainR * lfoAmpGain;

      if (eqEnabled) {
        for (let b = 0; b < 4; b++) {
          if (eqBypass[b]) continue;
          const b0 = eqB0[b], b1 = eqB1[b], b2 = eqB2[b];
          const a1 = eqA1[b], a2 = eqA2[b];

          const yL = b0 * finalL + eqL1[b];
          eqL1[b] = b1 * finalL - a1 * yL + eqL2[b];
          eqL2[b] = b2 * finalL - a2 * yL;
          finalL = yL;

          const yR = b0 * finalR + eqR1[b];
          eqR1[b] = b1 * finalR - a1 * yR + eqR2[b];
          eqR2[b] = b2 * finalR - a2 * yR;
          finalR = yR;
        }
      }

      outL[s] = finalL;
      outR[s] = finalR;
    }

    this.currentSample = currentSample;
    return true;
  }
}

/**
 * Crea un AudioBuffer nativo a partir de canales Float32Array
 */
export function createAudioBufferFromChannels(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const numChannels = channels.length;
  const length = channels[0]?.length || 0;
  let nativeBuffer: AudioBuffer | null = null;

  // 1. Intentar constructor nativo de AudioBuffer (estándar en navegadores modernos)
  if (typeof AudioBuffer !== 'undefined') {
    try {
      nativeBuffer = new AudioBuffer({ length, numberOfChannels: numChannels, sampleRate });
    } catch {}
  }

  // 2. Intentar createBuffer en el contexto nativo de Tone / Web Audio
  if (!nativeBuffer) {
    try {
      const rawCtx = Tone.getContext().rawContext as any;
      if (rawCtx && typeof rawCtx.createBuffer === 'function') {
        nativeBuffer = rawCtx.createBuffer(numChannels, length, sampleRate);
      }
    } catch {}
  }

  // 3. Extraer desde ToneAudioBuffer si Tone.getContext().createBuffer fue usado
  if (!nativeBuffer) {
    try {
      const toneBuf = (Tone.getContext() as any).createBuffer(numChannels, length, sampleRate);
      const inner = (toneBuf?.get && toneBuf.get()) || (toneBuf as any)?._buffer;
      if (inner && typeof inner.getChannelData === 'function') {
        nativeBuffer = inner;
      }
    } catch {}
  }

  // 4. Fallback compatible con AudioBuffer si no hay AudioContext nativo disponible
  if (!nativeBuffer || typeof nativeBuffer.getChannelData !== 'function') {
    const channelArrays = channels.map((c) => new Float32Array(c));
    return {
      numberOfChannels: numChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (ch: number) => channelArrays[ch] || channelArrays[0],
      copyFromChannel: (dest: Float32Array, ch: number, offset = 0) => {
        const src = channelArrays[ch] || channelArrays[0];
        dest.set(src.subarray(offset, offset + dest.length));
      },
      copyToChannel: (src: Float32Array, ch: number, offset = 0) => {
        const dest = channelArrays[ch] || channelArrays[0];
        dest.set(src, offset);
      }
    } as unknown as AudioBuffer;
  }

  for (let ch = 0; ch < numChannels; ch++) {
    nativeBuffer.getChannelData(ch).set(channels[ch]);
  }

  return nativeBuffer;
}

/**
 * Renderiza de forma determinista y offline una lista de eventos de notas
 * directamente a un AudioBuffer estéreo en milisegundos con cero dependencias de AudioWorklet.
 */
export function renderSynthTrackOffline(
  events: Array<{ note: string; timeSeconds: number; durationSeconds: number; velocity: number }>,
  settings: Partial<SynthSettings>,
  totalDurationSeconds: number,
  sampleRate = 44100
): AudioBuffer {
  const totalSamples = Math.ceil(Math.max(1, totalDurationSeconds) * sampleRate);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  if (!events || events.length === 0) {
    return createAudioBufferFromChannels([left, right], sampleRate);
  }

  const sortedEvents = [...events].sort((a, b) => a.timeSeconds - b.timeSeconds);

  const kernel = new PhosphorDSPKernel(sampleRate);
  kernel.setSettings(settings);

  const blockSize = 128;
  const tempL = new Float32Array(blockSize);
  const tempR = new Float32Array(blockSize);
  let eventIdx = 0;
  const numEvents = sortedEvents.length;

  for (let sampleOffset = 0; sampleOffset < totalSamples; sampleOffset += blockSize) {
    const blockEndSample = sampleOffset + blockSize;
    const blockEndTime = blockEndSample / sampleRate;

    while (eventIdx < numEvents && sortedEvents[eventIdx].timeSeconds < blockEndTime) {
      const evt = sortedEvents[eventIdx];
      const midi = noteToMidi(evt.note);
      const noteStartSample = Math.round(evt.timeSeconds * sampleRate);
      const delaySamples = Math.max(0, noteStartSample - sampleOffset);
      kernel.noteOn(midi, evt.velocity ?? 0.8, evt.durationSeconds, delaySamples);
      eventIdx++;
    }

    const hasAudio = kernel.process(tempL, tempR, blockSize);
    if (hasAudio) {
      const count = Math.min(blockSize, totalSamples - sampleOffset);
      if (count === blockSize) {
        left.set(tempL, sampleOffset);
        right.set(tempR, sampleOffset);
      } else {
        left.set(tempL.subarray(0, count), sampleOffset);
        right.set(tempR.subarray(0, count), sampleOffset);
      }
    } else if (eventIdx >= numEvents) {
      // Todas las notas han terminado y sus colas de release llegaron a reposo.
      // El resto del buffer Float32Array ya contiene ceros deterministas (silencio).
      break;
    }
  }

  return createAudioBufferFromChannels([left, right], sampleRate);
}
