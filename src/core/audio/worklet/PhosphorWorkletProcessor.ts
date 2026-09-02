/**
 * PhosphorWorkletProcessor.ts
 * Procesador de síntesis analógica en tiempo real ejecutado en el AudioWorklet (hilo de audio del SO).
 * Latencia ultra-baja (128 samples / ~2.9ms), cero interferencia de la UI y memoria 100% pre-asignada.
 *
 * Características:
 * - Osciladores con Anti-Aliasing PolyBLEP (Saw, Square, Triangle, Sine, Noise).
 * - Filtro State Variable Filter (SVF) de 2 polos lineal y estable (Lowpass, Highpass, Bandpass).
 * - Envolventes ADSR calculadas por muestra.
 * - Pool de 32 voces polifónicas con voice-stealing inteligente (LRU).
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
  velocity: number;
  phase1: number;
  phase2: number;
  phaseSub: number;
  envStage: 'idle' | 'attack' | 'decay' | 'sustain' | 'release';
  envLevel: number;
  targetReleaseSample: number;
  // SVF filter state variables
  ic1eq: number;
  ic2eq: number;
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
  subVol: number;
  subOctave: number;
  noiseEnabled: boolean;
  noiseVol: number;
  // VCF FILTER
  filterEnabled: boolean;
  filterType: 'lowpass' | 'highpass' | 'bandpass';
  filterFreq: number;
  filterQ: number;
  filterDrive: number;
  // ADSR
  attack: number;
  decay: number;
  sustain: number;
  release: number;
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

  private params: SynthParams = {
    osc1Wave: 'sawtooth',
    osc1Vol: 0.8,
    osc1Octave: 0,
    osc1Semi: 0,
    osc1Detune: 0,
    osc2Enabled: false,
    osc2Wave: 'square',
    osc2Vol: 0.5,
    osc2Octave: 0,
    osc2Semi: 0,
    osc2Detune: 5,
    subEnabled: false,
    subVol: 0.4,
    subOctave: -1,
    noiseEnabled: false,
    noiseVol: 0.2,
    filterEnabled: true,
    filterType: 'lowpass',
    filterFreq: 2500,
    filterQ: 1.5,
    filterDrive: 0.0,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
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
        velocity: 0.8,
        phase1: 0,
        phase2: 0,
        phaseSub: 0,
        envStage: 'idle',
        envLevel: 0,
        targetReleaseSample: -1,
        ic1eq: 0,
        ic2eq: 0,
        age: 0
      });
    }

    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;

      switch (data.type) {
        case 'noteOn':
          this.noteOn(data.midi, data.velocity ?? 0.8, data.durationSeconds);
          break;
        case 'noteOff':
          this.noteOff(data.midi);
          break;
        case 'allNotesOff':
          this.allNotesOff();
          break;
        case 'setParams':
          if (data.params) {
            Object.assign(this.params, data.params);
          }
          break;
      }
    };
  }

  private noteOn(midi: number, velocity: number, durationSeconds?: number) {
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
    targetVoice.active = true;
    targetVoice.midi = midi;
    targetVoice.frequency = freq;
    targetVoice.velocity = velocity;
    targetVoice.envStage = 'attack';
    targetVoice.age = ++this.ageCounter;
    targetVoice.targetReleaseSample =
      durationSeconds && durationSeconds > 0
        ? this.currentSample + Math.floor(durationSeconds * sampleRate)
        : -1;
  }

  private noteOff(midi: number) {
    for (let i = 0; i < this.maxVoices; i++) {
      if (this.voices[i].active && this.voices[i].midi === midi && this.voices[i].envStage !== 'release') {
        this.voices[i].envStage = 'release';
      }
    }
  }

  private allNotesOff() {
    for (let i = 0; i < this.maxVoices; i++) {
      if (this.voices[i].active) {
        this.voices[i].envStage = 'release';
      }
    }
  }

  // Generador de oscilador individual por muestra con PolyBLEP
  private sampleOsc(wave: 'sine' | 'square' | 'triangle' | 'sawtooth', phase: number, dt: number): number {
    switch (wave) {
      case 'sine':
        return Math.sin(phase * 2 * Math.PI);
      case 'sawtooth': {
        const raw = 2.0 * phase - 1.0;
        return raw - polyBlep(phase, dt);
      }
      case 'square': {
        const raw = phase < 0.5 ? 1.0 : -1.0;
        return raw + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1.0, dt);
      }
      case 'triangle': {
        const saw = 2.0 * phase - 1.0 - polyBlep(phase, dt);
        // Integración aproximada para triángulo suave
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

    // Coeficientes de envolvente por bloque
    const attackStep = dtBase / Math.max(0.001, this.params.attack);
    const decayFactor = Math.exp(-dtBase / Math.max(0.001, this.params.decay));
    const releaseFactor = Math.exp(-dtBase / Math.max(0.001, this.params.release));
    const sustainLevel = this.params.sustain;

    // Coeficientes del Filtro SVF (Cytomic / Andrew Simper)
    const cutoffClamped = Math.max(20, Math.min(sr * 0.49, this.params.filterFreq));
    const g = Math.tan((Math.PI * cutoffClamped) / sr);
    const k = 1.0 / Math.max(0.1, this.params.filterQ);
    const a1 = 1.0 / (1.0 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;

    const pan = Math.max(-1, Math.min(1, this.params.pan));
    const gainL = this.params.gain * (pan <= 0 ? 1 : 1 - pan);
    const gainR = this.params.gain * (pan >= 0 ? 1 : 1 + pan);

    for (let s = 0; s < blockSize; s++) {
      this.currentSample++;
      let sampleSumL = 0;
      let sampleSumR = 0;

      for (let v = 0; v < this.maxVoices; v++) {
        const voice = this.voices[v];
        if (!voice.active || voice.envStage === 'idle') continue;

        // 1. Auto-release para duraciones programadas
        if (voice.targetReleaseSample > 0 && this.currentSample >= voice.targetReleaseSample) {
          voice.envStage = 'release';
          voice.targetReleaseSample = -1;
        }

        // 2. Cálculo de Envolvente ADSR
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
            break;
          case 'sustain':
            voice.envLevel = sustainLevel;
            break;
          case 'release':
            voice.envLevel *= releaseFactor;
            if (voice.envLevel < 0.0001) {
              voice.envLevel = 0;
              voice.envStage = 'idle';
              voice.active = false;
              continue;
            }
            break;
        }

        // 3. Cálculo de Osciladores
        const f1 = voice.frequency * Math.pow(2, (this.params.osc1Octave * 12 + this.params.osc1Semi + this.params.osc1Detune / 100) / 12);
        const dt1 = f1 / sr;
        voice.phase1 = (voice.phase1 + dt1) % 1.0;
        let voiceSample = this.sampleOsc(this.params.osc1Wave, voice.phase1, dt1) * this.params.osc1Vol;

        // OSC 2
        if (this.params.osc2Enabled) {
          const f2 = voice.frequency * Math.pow(2, (this.params.osc2Octave * 12 + this.params.osc2Semi + this.params.osc2Detune / 100) / 12);
          const dt2 = f2 / sr;
          voice.phase2 = (voice.phase2 + dt2) % 1.0;
          voiceSample += this.sampleOsc(this.params.osc2Wave, voice.phase2, dt2) * this.params.osc2Vol;
        }

        // Sub-Osc (Onda cuadrada pura 1 o 2 octavas abajo)
        if (this.params.subEnabled) {
          const fSub = voice.frequency * Math.pow(2, (this.params.subOctave * 12) / 12);
          const dtSub = fSub / sr;
          voice.phaseSub = (voice.phaseSub + dtSub) % 1.0;
          voiceSample += (voice.phaseSub < 0.5 ? 1.0 : -1.0) * this.params.subVol;
        }

        // Generador de Ruido
        if (this.params.noiseEnabled) {
          voiceSample += (Math.random() * 2.0 - 1.0) * this.params.noiseVol;
        }

        // 4. Filtro SVF Cytomic
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
          }
        }

        // 5. Acumular en la mezcla estéreo
        const amp = voiceSample * voice.envLevel * voice.velocity;
        sampleSumL += amp;
        sampleSumR += amp;
      }

      outL[s] = sampleSumL * gainL;
      if (outR !== outL) {
        outR[s] = sampleSumR * gainR;
      }
    }

    return true;
  }
}

try {
  registerProcessor('phosphor-synth-processor', PhosphorWorkletProcessor);
} catch (_) {}
