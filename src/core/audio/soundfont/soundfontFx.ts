/**
 * soundfontFx.ts
 * Cadena de efectos nativa Web Audio (Chorus estéreo en cuadratura + Reverb estéreo por convolución)
 * para canales SoundFont. Funciona de forma 1:1 en AudioContext en vivo y en OfflineAudioContext.
 * Implementa instanciación perezosa y bypass limpio cuando los efectos están desactivados.
 */

import type { SoundFontChorusConfig, SoundFontReverbConfig } from '../../../utils/typeDefinitions';

export const DEFAULT_SOUNDFONT_CHORUS: SoundFontChorusConfig = {
  enabled: false,
  rate: 1.5,
  depth: 0.45,
  mix: 0.35
};

export const DEFAULT_SOUNDFONT_REVERB: SoundFontReverbConfig = {
  enabled: false,
  decay: 2.2,
  mix: 0.3
};

const reverbIrCache = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

/**
 * PRNG determinista (Mulberry32) para garantizar que la respuesta de impulso de la reverb
 * sea idéntica entre la reproducción en vivo y la exportación offline.
 */
function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Genera (y cachea) una respuesta de impulso estéreo de sala/plate con pre-delay,
 * reflexiones tempranas estéreo y absorción progresiva de agudos.
 */
function getOrCreateStereoReverbIR(audioCtx: BaseAudioContext, decaySeconds: number): AudioBuffer {
  const clampedDecay = Math.max(0.3, Math.min(6.0, decaySeconds));
  const decayBucket = Math.round(clampedDecay * 20); // pasos de 0.05s

  let ctxMap = reverbIrCache.get(audioCtx);
  if (!ctxMap) {
    ctxMap = new Map<number, AudioBuffer>();
    reverbIrCache.set(audioCtx, ctxMap);
  }

  const cached = ctxMap.get(decayBucket);
  if (cached) return cached;

  const sampleRate = audioCtx.sampleRate || 44100;
  const preDelaySec = 0.014;
  const totalSec = Math.min(7.5, preDelaySec + clampedDecay * 1.15);
  const length = Math.max(1024, Math.floor(totalSec * sampleRate));
  const preDelayFrames = Math.floor(preDelaySec * sampleRate);

  const irBuffer = audioCtx.createBuffer(2, length, sampleRate);
  const left = irBuffer.getChannelData(0);
  const right = irBuffer.getChannelData(1);

  // Reflexiones tempranas sutiles alternadas L/R para anchura natural
  const earlyTaps = [
    { ms: 16, l: 0.52, r: 0.14 },
    { ms: 23, l: 0.12, r: 0.48 },
    { ms: 31, l: 0.42, r: 0.18 },
    { ms: 42, l: 0.16, r: 0.36 },
    { ms: 54, l: 0.28, r: 0.15 },
    { ms: 67, l: 0.14, r: 0.24 }
  ];
  for (const tap of earlyTaps) {
    const idx = Math.floor((tap.ms / 1000) * sampleRate);
    if (idx >= 0 && idx < length) {
      left[idx] += tap.l * 0.45;
      right[idx] += tap.r * 0.45;
    }
  }

  const rngL = createSeededRng(0x50484f53 + decayBucket * 17);
  const rngR = createSeededRng(0x53463252 + decayBucket * 31);

  // Constante de decaimiento RT60 (-60 dB = e^-6.9078)
  const decayRate = 6.9078 / clampedDecay;

  let lpL = 0;
  let lpR = 0;
  let sumSq = 0;

  for (let i = preDelayFrames; i < length; i++) {
    const t = (i - preDelayFrames) / sampleRate;
    // Envolvente con fade-in suave de 18ms para evitar ataque metálico + caída exponencial
    const attackEnv = t < 0.018 ? t / 0.018 : 1.0;
    const env = attackEnv * Math.exp(-decayRate * t);

    // Absorción progresiva de altas frecuencias (aire de la sala)
    const progress = Math.min(1, t / clampedDecay);
    const cutoffHz = 9500 - progress * 6800; // 9.5 kHz -> 2.7 kHz
    const alpha = Math.min(0.95, (2 * Math.PI * cutoffHz) / (2 * Math.PI * cutoffHz + sampleRate));

    const noiseL = rngL() * 2 - 1;
    const noiseR = rngR() * 2 - 1;

    lpL += alpha * (noiseL - lpL);
    lpR += alpha * (noiseR - lpR);

    const sampleL = lpL * env;
    const sampleR = lpR * env;

    left[i] += sampleL;
    right[i] += sampleR;
    sumSq += sampleL * sampleL + sampleR * sampleR;
  }

  // Normalización RMS equilibrada para mantener volumen consistente en cualquier decay
  const rms = Math.sqrt(sumSq / Math.max(1, (length - preDelayFrames) * 2));
  const targetNorm = rms > 1e-6 ? Math.min(1.8, 0.055 / rms) : 1.0;
  for (let i = 0; i < length; i++) {
    left[i] *= targetNorm;
    right[i] *= targetNorm;
  }

  ctxMap.set(decayBucket, irBuffer);
  return irBuffer;
}

export class SoundFontFxChain {
  private audioCtx: BaseAudioContext;
  private isOffline: boolean;

  public readonly input: GainNode;
  public readonly output: GainNode;

  // Stage intermedio entre Chorus y Reverb
  private postChorusNode: GainNode;

  // Chorus estéreo en cuadratura (creado bajo demanda)
  private chorusDryGain: GainNode;
  private chorusWetGain: GainNode | null = null;
  private chorusDelayL: DelayNode | null = null;
  private chorusDelayR: DelayNode | null = null;
  private chorusPanL: StereoPannerNode | null = null;
  private chorusPanR: StereoPannerNode | null = null;
  private chorusLfo: OscillatorNode | null = null;
  private chorusDepthL: GainNode | null = null;
  private chorusDepthR: GainNode | null = null;
  private chorusInitialized = false;

  // Reverb estéreo por convolución (creada bajo demanda)
  private reverbDryGain: GainNode;
  private reverbSendFilter: BiquadFilterNode | null = null;
  private reverbConvolver: ConvolverNode | null = null;
  private reverbWetGain: GainNode | null = null;
  private reverbInitialized = false;
  private lastReverbDecayBucket = -1;

  constructor(audioCtx: BaseAudioContext, destination: AudioNode) {
    this.audioCtx = audioCtx;
    this.isOffline =
      typeof OfflineAudioContext !== 'undefined' && audioCtx instanceof OfflineAudioContext;

    this.input = audioCtx.createGain();
    this.input.gain.value = 1.0;

    this.chorusDryGain = audioCtx.createGain();
    this.chorusDryGain.gain.value = 1.0;

    this.postChorusNode = audioCtx.createGain();
    this.postChorusNode.gain.value = 1.0;

    this.reverbDryGain = audioCtx.createGain();
    this.reverbDryGain.gain.value = 1.0;

    this.output = audioCtx.createGain();
    this.output.gain.value = 1.0;

    // Ruta seca directa siempre lista (0% overhead de FX cuando están apagados)
    this.input.connect(this.chorusDryGain);
    this.chorusDryGain.connect(this.postChorusNode);
    this.postChorusNode.connect(this.reverbDryGain);
    this.reverbDryGain.connect(this.output);
    this.output.connect(destination);
  }

  private setParam(param: AudioParam, value: number): void {
    const now = this.audioCtx.currentTime;
    if (this.isOffline) {
      param.setValueAtTime(value, 0);
    } else {
      try {
        param.cancelScheduledValues(now);
        param.setTargetAtTime(value, now, 0.018);
      } catch {
        param.value = value;
      }
    }
  }

  private ensureChorusNodes(rate: number, depth: number): void {
    if (this.chorusInitialized) return;
    if (
      typeof this.audioCtx.createDelay !== 'function' ||
      typeof this.audioCtx.createOscillator !== 'function'
    ) {
      return;
    }

    const ctx = this.audioCtx;
    const delayL = ctx.createDelay(0.08);
    const delayR = ctx.createDelay(0.08);
    delayL.delayTime.value = 0.014;
    delayR.delayTime.value = 0.019;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = Math.max(0.1, Math.min(8.0, rate));

    const modAmt = Math.max(0, Math.min(1, depth)) * 0.0045;
    const depthL = ctx.createGain();
    const depthR = ctx.createGain();
    depthL.gain.value = modAmt;
    depthR.gain.value = -modAmt; // 180° en contrafase para amplitud estéreo

    const wetGain = ctx.createGain();
    wetGain.gain.value = 0;

    lfo.connect(depthL);
    lfo.connect(depthR);
    depthL.connect(delayL.delayTime);
    depthR.connect(delayR.delayTime);

    this.input.connect(delayL);
    this.input.connect(delayR);

    if (typeof ctx.createStereoPanner === 'function') {
      const panL = ctx.createStereoPanner();
      const panR = ctx.createStereoPanner();
      panL.pan.value = -0.85;
      panR.pan.value = 0.85;
      delayL.connect(panL);
      delayR.connect(panR);
      panL.connect(wetGain);
      panR.connect(wetGain);
      this.chorusPanL = panL;
      this.chorusPanR = panR;
    } else {
      delayL.connect(wetGain);
      delayR.connect(wetGain);
    }

    wetGain.connect(this.postChorusNode);
    lfo.start(0);

    this.chorusDelayL = delayL;
    this.chorusDelayR = delayR;
    this.chorusLfo = lfo;
    this.chorusDepthL = depthL;
    this.chorusDepthR = depthR;
    this.chorusWetGain = wetGain;
    this.chorusInitialized = true;
  }

  private ensureReverbNodes(decay: number): void {
    if (this.reverbInitialized) return;
    if (typeof this.audioCtx.createConvolver !== 'function') return;

    const ctx = this.audioCtx;
    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = 140;
    hpFilter.Q.value = -3.01;

    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = getOrCreateStereoReverbIR(ctx, decay);

    const wetGain = ctx.createGain();
    wetGain.gain.value = 0;

    this.postChorusNode.connect(hpFilter);
    hpFilter.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(this.output);

    this.reverbSendFilter = hpFilter;
    this.reverbConvolver = convolver;
    this.reverbWetGain = wetGain;
    this.lastReverbDecayBucket = Math.round(Math.max(0.3, Math.min(6.0, decay)) * 20);
    this.reverbInitialized = true;
  }

  public applySettings(
    chorus?: SoundFontChorusConfig,
    reverb?: SoundFontReverbConfig
  ): void {
    // 1. Chorus estéreo
    const chorusActive = Boolean(chorus?.enabled && (chorus.mix ?? 0) > 0.001);
    if (chorusActive && chorus) {
      const rate = Math.max(0.1, Math.min(8.0, chorus.rate ?? DEFAULT_SOUNDFONT_CHORUS.rate));
      const depth = Math.max(0, Math.min(1, chorus.depth ?? DEFAULT_SOUNDFONT_CHORUS.depth));
      const mix = Math.max(0, Math.min(1, chorus.mix ?? DEFAULT_SOUNDFONT_CHORUS.mix));

      this.ensureChorusNodes(rate, depth);
      if (this.chorusInitialized && this.chorusLfo && this.chorusDepthL && this.chorusDepthR && this.chorusWetGain) {
        this.setParam(this.chorusLfo.frequency, rate);
        const modAmt = depth * 0.0045;
        this.setParam(this.chorusDepthL.gain, modAmt);
        this.setParam(this.chorusDepthR.gain, -modAmt);
        this.setParam(this.chorusDryGain.gain, 1.0 - mix * 0.35);
        this.setParam(this.chorusWetGain.gain, mix * 0.72);
      }
    } else {
      this.setParam(this.chorusDryGain.gain, 1.0);
      if (this.chorusWetGain) {
        this.setParam(this.chorusWetGain.gain, 0);
      }
    }

    // 2. Reverb estéreo de convolución
    const reverbActive = Boolean(reverb?.enabled && (reverb.mix ?? 0) > 0.001);
    if (reverbActive && reverb) {
      const decay = Math.max(0.3, Math.min(6.0, reverb.decay ?? DEFAULT_SOUNDFONT_REVERB.decay));
      const mix = Math.max(0, Math.min(1, reverb.mix ?? DEFAULT_SOUNDFONT_REVERB.mix));

      this.ensureReverbNodes(decay);
      if (this.reverbInitialized && this.reverbConvolver && this.reverbWetGain) {
        const nextBucket = Math.round(decay * 20);
        if (nextBucket !== this.lastReverbDecayBucket) {
          this.reverbConvolver.buffer = getOrCreateStereoReverbIR(this.audioCtx, decay);
          this.lastReverbDecayBucket = nextBucket;
        }
        this.setParam(this.reverbDryGain.gain, 1.0 - mix * 0.32);
        this.setParam(this.reverbWetGain.gain, mix * 0.92);
      }
    } else {
      this.setParam(this.reverbDryGain.gain, 1.0);
      if (this.reverbWetGain) {
        this.setParam(this.reverbWetGain.gain, 0);
      }
    }
  }

  public dispose(): void {
    try {
      if (this.chorusLfo) {
        this.chorusLfo.stop();
        this.chorusLfo.disconnect();
      }
    } catch {}
    const nodes: Array<AudioNode | null> = [
      this.input,
      this.chorusDryGain,
      this.chorusWetGain,
      this.chorusDelayL,
      this.chorusDelayR,
      this.chorusPanL,
      this.chorusPanR,
      this.chorusDepthL,
      this.chorusDepthR,
      this.postChorusNode,
      this.reverbDryGain,
      this.reverbSendFilter,
      this.reverbConvolver,
      this.reverbWetGain,
      this.output
    ];
    for (const node of nodes) {
      if (!node) continue;
      try {
        node.disconnect();
      } catch {}
    }
    this.chorusInitialized = false;
    this.reverbInitialized = false;
  }
}
