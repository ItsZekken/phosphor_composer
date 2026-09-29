/**
 * PhosphorWorkletProcessor.ts
 * Procesador de síntesis analógica en tiempo real ejecutado en el AudioWorklet (hilo de audio del SO).
 * Latencia ultra-baja (128 samples / ~2.9ms), cero interferencia de la UI y memoria 100% pre-asignada.
 *
 * Características:
 * - Osciladores con Anti-Aliasing PolyBLEP (Saw, Square, Triangle, Sine).
 * - Sub-oscilador multiforma (Sine, Triangle, Square).
 * - Generador de ruido blanco y rosa (filtro 1/f de 3 polos).
 * - Envolventes ADSR con constante matemática canónica T60 (-60 dB).
 * - Pool de voces polifónicas con voice-stealing inteligente (LRU) y reseteo estricto de memoria.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void;

declare const sampleRate: number;

interface Voice {
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
  // SVF filter state variables
  ic1eq: number;
  ic2eq: number;
  // Pink noise filter states per voice
  b0: number;
  b1: number;
  b2: number;
  age: number;
}

interface SynthParams {
  // OSC 1
  osc1Wave: 'sine' | 'square' | 'triangle' | 'sawtooth';
  osc1Vol: number;
  osc1Octave: number;
  osc1Semi: number;
  osc1Detune: number;
  // OSC 2
  osc2Enabled: boolean;
  osc2Wave: 'sine' | 'square' | 'triangle' | 'sawtooth';
  osc2Vol: number;
  osc2Octave: number;
  osc2Semi: number;
  osc2Detune: number;
  // SUB & NOISE
  subEnabled: boolean;
  subWave: 'sine' | 'square' | 'triangle';
  subVol: number;
  subOctave: number;
  noiseEnabled: boolean;
  noiseType: 'white' | 'pink';
  noiseVol: number;
  // VCF FILTER
  filterEnabled: boolean;
  filterType: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  filterFreq: number;
  filterQ: number;
  filterDrive: number;
  filterDriveType?: 'tube' | 'tape' | 'fuzz' | 'warm';
  // ADSR
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  // Glide / Portamento
  glide: number;
  // LFO MODULATION
  lfoEnabled: boolean;
  lfoWave: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random';
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: 'cutoff' | 'pitch' | 'amp';
  // 4-BAND GRAPHIC / PARAMETRIC EQ
  eqEnabled?: boolean;
  eqLow?: number;
  eqLowMid?: number;
  eqHighMid?: number;
  eqHigh?: number;
  // Master
  gain: number;
  pan: number;
}

// PolyBLEP anti-aliasing residual helper
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

export class PhosphorWorkletProcessor extends AudioWorkletProcessor {
  private voices: Voice[] = [];
  private maxVoices = 32;
  private ageCounter = 0;
  private currentSample = 0;
  private lfoPhase = 0;
  private lfoRandVal = 0;

  // Coeficientes y estados para Ecualizador Gráfico de 4 Bandas (Direct Form II Transpuesto)
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

  constructor() {
    super();

    // Pre-asignar todas las voces para evitar recolección de basura en process()
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

    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;

      switch (data.type) {
        case 'noteOn':
          this.noteOn(data.midi, data.velocity ?? 0.8, data.durationSeconds, data.delaySamples);
          break;
        case 'noteOff':
          this.noteOff(data.midi, data.delaySamples);
          break;
        case 'allNotesOff':
          this.allNotesOff(data.delaySamples);
          break;
        case 'setParams':
          if (data.params) {
            Object.assign(this.params, data.params);
            this.updateEqCoefficients();
            if (!this.params.noiseEnabled || this.params.noiseVol <= 0.0001) {
              for (let i = 0; i < this.maxVoices; i++) {
                this.voices[i].b0 = 0;
                this.voices[i].b1 = 0;
                this.voices[i].b2 = 0;
              }
            }
          }
          break;
      }
    };
  }

  private updateEqCoefficients() {
    if (!this.params.eqEnabled) {
      this.eqAllBypassed = true;
      return;
    }

    const sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
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

  private noteOn(midi: number, velocity: number, durationSeconds?: number, delaySamples?: number) {
    let targetVoice: Voice | null = null;

    // 1. Buscar voz libre
    for (let i = 0; i < this.maxVoices; i++) {
      if (!this.voices[i].active || this.voices[i].envStage === 'idle') {
        targetVoice = this.voices[i];
        break;
      }
    }

    // 2. Voice-Stealing (Voz más antigua / menor nivel de envolvente)
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

    // Reseteo estricto de memoria de estados
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
        ? targetStart + Math.floor(durationSeconds * sampleRate)
        : -1;
  }

  private noteOff(midi: number, delaySamples?: number) {
    const releaseSample = delaySamples && delaySamples > 0 ? this.currentSample + Math.floor(delaySamples) : this.currentSample;
    for (let i = 0; i < this.maxVoices; i++) {
      if (this.voices[i].active && this.voices[i].midi === midi && this.voices[i].envStage !== 'release' && this.voices[i].envStage !== 'idle') {
        if (delaySamples && delaySamples > 0) {
          this.voices[i].targetReleaseSample = releaseSample;
        } else {
          this.voices[i].envStage = 'release';
          this.voices[i].targetReleaseSample = -1;
        }
      }
    }
  }

  private allNotesOff(delaySamples?: number) {
    const releaseSample = delaySamples && delaySamples > 0 ? this.currentSample + Math.floor(delaySamples) : this.currentSample;
    for (let i = 0; i < this.maxVoices; i++) {
      if (this.voices[i].active && this.voices[i].envStage !== 'idle') {
        if (delaySamples && delaySamples > 0) {
          this.voices[i].targetReleaseSample = releaseSample;
        } else {
          this.voices[i].envStage = 'release';
          this.voices[i].targetReleaseSample = -1;
        }
      }
    }
  }

  // Generador de oscilador individual por muestra con PolyBLEP
  private sampleOsc(wave: string, phase: number, dt: number): number {
    switch (wave) {
      case 'sine':
        return Math.sin(phase * 2 * Math.PI);
      case 'sawtooth':
      case 'saw': {
        const raw = 2.0 * phase - 1.0;
        return raw - polyBlep(phase, dt);
      }
      case 'square':
      case 'pulse': {
        const raw = phase < 0.5 ? 1.0 : -1.0;
        return raw + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1.0, dt);
      }
      case 'triangle':
      case 'tri': {
        const saw = 2.0 * phase - 1.0 - polyBlep(phase, dt);
        return 2.0 * Math.abs(saw) - 1.0;
      }
      default:
        return 0;
    }
  }

  public process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;
    const blockSize = outL.length;

    // Limpiar buffers de salida
    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    const sr = sampleRate;
    const dtBase = 1.0 / sr;

    // Coeficientes canónicos de envolvente ADSR con factor T60 (-60 dB)
    const TIME_FACTOR = -6.907755;
    const attackStep = dtBase / Math.max(0.001, this.params.attack);
    const decayFactor = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.001, this.params.decay));
    const releaseFactor = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.001, this.params.release));
    const sustainLevel = Math.max(0, Math.min(1, this.params.sustain));
    const glideFactor = this.params.glide > 0.001 ? Math.exp(-dtBase / Math.max(0.005, this.params.glide)) : 0;

    // Precalcular factores de transposición de osciladores (0 Math.pow por muestra)
    const osc1PitchFactor = Math.pow(2, (this.params.osc1Octave * 12 + this.params.osc1Semi + this.params.osc1Detune / 100) / 12);
    const osc2PitchFactor = this.params.osc2Enabled ? Math.pow(2, (this.params.osc2Octave * 12 + this.params.osc2Semi + this.params.osc2Detune / 100) / 12) : 1;
    const subPitchFactor = this.params.subEnabled ? Math.pow(2, (this.params.subOctave * 12) / 12) : 0.5;

    // Pre-filtrar índices de voces activas o pendientes en el bloque
    const activeIndices: number[] = [];
    for (let v = 0; v < this.maxVoices; v++) {
      if (this.voices[v].active && this.voices[v].envStage !== 'idle') {
        activeIndices.push(v);
      }
    }
    if (activeIndices.length === 0) {
      this.currentSample += blockSize;
      return true;
    }

    // Coeficientes del Filtro SVF (Solo calculados si filterEnabled es true)
    let a1 = 0, a2 = 0, a3 = 0, k = 1;
    if (this.params.filterEnabled) {
      const cutoffClamped = Math.max(20, Math.min(sr * 0.49, this.params.filterFreq));
      const g = Math.tan((Math.PI * cutoffClamped) / sr);
      k = 1.0 / Math.max(0.1, this.params.filterQ);
      a1 = 1.0 / (1.0 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }

    const pan = Math.max(-1, Math.min(1, this.params.pan));
    const gainL = this.params.gain * (pan <= 0 ? 1 : 1 - pan);
    const gainR = this.params.gain * (pan >= 0 ? 1 : 1 + pan);
    const activeCount = activeIndices.length;

    // LFO Setup
    const isLfoActive = Boolean(this.params.lfoEnabled && (this.params.lfoDepth ?? 0) > 0.001);
    const lfoRate = Math.max(0.1, Math.min(20, this.params.lfoRate ?? 2.5));
    const lfoDepth = Math.max(0, Math.min(1, this.params.lfoDepth ?? 0.25));
    const lfoTarget = this.params.lfoTarget || 'cutoff';
    const lfoWave = this.params.lfoWave || 'sine';
    const lfoStep = lfoRate * dtBase;

    for (let s = 0; s < blockSize; s++) {
      this.currentSample++;
      let sampleSumL = 0;
      let sampleSumR = 0;

      // 0. LFO Sample Calculation
      let lfoVal = 0;
      if (isLfoActive) {
        const prevPhase = this.lfoPhase;
        this.lfoPhase = (this.lfoPhase + lfoStep) % 1.0;
        if (this.lfoPhase < prevPhase) {
          this.lfoRandVal = Math.random() * 2.0 - 1.0;
        }

        switch (lfoWave) {
          case 'triangle':
            lfoVal = 2.0 * Math.abs(2.0 * this.lfoPhase - 1.0) - 1.0;
            break;
          case 'sawtooth':
            lfoVal = 1.0 - 2.0 * this.lfoPhase;
            break;
          case 'square':
            lfoVal = this.lfoPhase < 0.5 ? 1.0 : -1.0;
            break;
          case 'random':
            lfoVal = this.lfoRandVal;
            break;
          case 'sine':
          default:
            lfoVal = Math.sin(this.lfoPhase * 2.0 * Math.PI);
            break;
        }
      }

      // Modulación de tono (Pitch Vibrato)
      const lfoPitchMult = (isLfoActive && lfoTarget === 'pitch')
        ? (1.0 + lfoVal * lfoDepth * 0.086)
        : 1.0;

      // Modulación de filtro VCF (Cutoff) actualizada cada 4 muestras
      if (this.params.filterEnabled && isLfoActive && lfoTarget === 'cutoff') {
        if ((s & 3) === 0) {
          const modFactor = Math.pow(2.0, lfoVal * lfoDepth * 3.5);
          const modCutoff = Math.max(20, Math.min(sr * 0.49, this.params.filterFreq * modFactor));
          const g = Math.tan((Math.PI * modCutoff) / sr);
          a1 = 1.0 / (1.0 + g * (g + k));
          a2 = g * a1;
          a3 = g * a2;
        }
      }

      for (let i = 0; i < activeCount; i++) {
        const voice = this.voices[activeIndices[i]];
        if (!voice.active || voice.envStage === 'idle') {
          continue;
        }

        // 0. Inicio programado por Lookahead Scheduler
        if (voice.envStage === 'pending') {
          if (this.currentSample >= voice.startSample) {
            voice.envStage = 'attack';
          } else {
            continue;
          }
        }

        // 1. Auto-release para duraciones programadas
        if (voice.targetReleaseSample > 0 && this.currentSample >= voice.targetReleaseSample) {
          voice.envStage = 'release';
          voice.targetReleaseSample = -1;
        }

        // 2. Cálculo de Envolvente ADSR con curvas analógicas T60
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

        // 2.5 Glide / Portamento
        if (glideFactor > 0) {
          voice.frequency = voice.targetFrequency + (voice.frequency - voice.targetFrequency) * glideFactor;
        } else {
          voice.frequency = voice.targetFrequency;
        }

        // 3. OSC 1
        const dt1 = voice.frequency * osc1PitchFactor * lfoPitchMult * dtBase;
        voice.phase1 = (voice.phase1 + dt1) % 1.0;
        let voiceSample = this.sampleOsc(this.params.osc1Wave, voice.phase1, dt1) * this.params.osc1Vol;

        // OSC 2
        if (this.params.osc2Enabled && this.params.osc2Vol > 0.0001) {
          const dt2 = voice.frequency * osc2PitchFactor * lfoPitchMult * dtBase;
          voice.phase2 = (voice.phase2 + dt2) % 1.0;
          voiceSample += this.sampleOsc(this.params.osc2Wave, voice.phase2, dt2) * this.params.osc2Vol;
        }

        // Sub-Oscilador multiforma
        if (this.params.subEnabled && this.params.subVol > 0.0001) {
          const dtSub = voice.frequency * subPitchFactor * lfoPitchMult * dtBase;
          voice.phaseSub = (voice.phaseSub + dtSub) % 1.0;
          voiceSample += this.sampleOsc(this.params.subWave || 'sine', voice.phaseSub, dtSub) * this.params.subVol;
        }

        // Generador de Ruido (Blanco y Rosa 1/f)
        if (this.params.noiseEnabled && this.params.noiseVol > 0.0001) {
          const white = Math.random() * 2.0 - 1.0;
          if (this.params.noiseType === 'pink') {
            voice.b0 = 0.99765 * voice.b0 + white * 0.0990460;
            voice.b1 = 0.96300 * voice.b1 + white * 0.2965164;
            voice.b2 = 0.57000 * voice.b2 + white * 1.0526913;
            const pink = voice.b0 + voice.b1 + voice.b2 + white * 0.1848;
            voiceSample += pink * 0.18 * this.params.noiseVol;
          } else {
            voiceSample += white * this.params.noiseVol;
          }
        }

        // 4. Filtro SVF Cytomic opcional
        if (this.params.filterEnabled) {
          const v0 = voiceSample;
          const v1 = a1 * voice.ic1eq + a2 * (v0 - voice.ic2eq);
          const v2 = voice.ic2eq + a2 * voice.ic1eq + a3 * (v0 - voice.ic2eq);
          voice.ic1eq = 2.0 * v1 - voice.ic1eq;
          voice.ic2eq = 2.0 * v2 - voice.ic2eq;

          if (this.params.filterType === 'lowpass') {
            voiceSample = v2;
          } else if (this.params.filterType === 'bandpass') {
            voiceSample = v1;
          } else if (this.params.filterType === 'highpass') {
            voiceSample = v0 - k * v1 - v2;
          } else if (this.params.filterType === 'notch') {
            voiceSample = v0 - k * v1;
          }
        }

        // 4.5. Etapa de Overdrive Analógico con Preservación de Graves y Ganancia Activa
        if (this.params.filterDrive > 0.005) {
          const drive = this.params.filterDrive;
          const dType = this.params.filterDriveType || 'tube';
          const preGain = 1.0 + drive * 2.8;
          const s = voiceSample * preGain;
          let sat = s;

          if (dType === 'warm') {
            // Saturación sutil analógica con armónicos impares suaves (no comprime en exceso ni aplasta el bajo)
            if (s > 1.25) sat = 1.0;
            else if (s < -1.25) sat = -1.0;
            else sat = s - (s * s * s) * 0.2;
          } else if (dType === 'tube') {
            // Válvula triodo analógica: asimetría armónica cálida sin offset DC
            if (s >= 0) {
              sat = s / (1.0 + 0.45 * s);
            } else {
              const neg = -s;
              sat = -neg / (1.0 + 0.7 * neg);
            }
          } else if (dType === 'tape') {
            // Saturación de cinta magnética suave (Pade tanh simétrica)
            const s2 = s * s;
            sat = (s * (27.0 + s2)) / (27.0 + 9.0 * s2);
          } else if (dType === 'fuzz') {
            // Fuzz de germanio con garra y cuerpo armónico
            sat = (1.35 * s) / Math.sqrt(1.0 + s * s * 0.75);
          }

          // Aumento real de volumen y presencia al subir Drive
          const driveBoost = 1.0 + drive * 0.85;

          // Anclaje de graves: mezcla el núcleo limpio fundamental para que el bajo no pierda cuerpo
          const dryBassAnchor = 0.28 * (1.0 - drive * 0.4);
          const wetSatMix = 1.0 - dryBassAnchor;
          voiceSample = (sat * wetSatMix + voiceSample * dryBassAnchor) * driveBoost;
        }

        // 5. Acumular en la mezcla estéreo
        const amp = voiceSample * voice.envLevel * voice.velocity;
        sampleSumL += amp;
        sampleSumR += amp;
      }

      // Modulación de Amplitud (Tremolo)
      const lfoAmpGain = (isLfoActive && lfoTarget === 'amp')
        ? Math.max(0, 1.0 - lfoDepth * 0.5 * (1.0 - lfoVal))
        : 1.0;

      let finalL = sampleSumL * gainL * lfoAmpGain;
      let finalR = sampleSumR * gainR * lfoAmpGain;

      // 6. Ecualizador Gráfico Paramétrico de 4 Bandas (Direct Form II Transpuesto)
      if (this.params.eqEnabled && !this.eqAllBypassed) {
        for (let b = 0; b < 4; b++) {
          if (this.eqBypass[b]) continue;
          const b0 = this.eqB0[b], b1 = this.eqB1[b], b2 = this.eqB2[b];
          const a1 = this.eqA1[b], a2 = this.eqA2[b];

          const yL = b0 * finalL + this.eqL1[b];
          this.eqL1[b] = b1 * finalL - a1 * yL + this.eqL2[b];
          this.eqL2[b] = b2 * finalL - a2 * yL;
          finalL = yL;

          const yR = b0 * finalR + this.eqR1[b];
          this.eqR1[b] = b1 * finalR - a1 * yR + this.eqR2[b];
          this.eqR2[b] = b2 * finalR - a2 * yR;
          finalR = yR;
        }
      }

      outL[s] = finalL;
      if (outR !== outL) {
        outR[s] = finalR;
      }
    }

    return true;
  }
}

try {
  registerProcessor('phosphor-synth-processor', PhosphorWorkletProcessor);
} catch (_) {}
