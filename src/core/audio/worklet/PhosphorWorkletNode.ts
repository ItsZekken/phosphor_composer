/**
 * PhosphorWorkletNode.ts
 * Nodo cliente que encapsula el PhosphorWorkletProcessor en el hilo principal.
 * Conecta el sistema de instrumentos de Phosphor con el motor de síntesis AudioWorklet de ultra-baja latencia.
 */

import * as Tone from 'tone';
import type { SynthSettings } from '../../../utils/typeDefinitions';
import { noteToMidi } from '../../music/pitchClass';

const registeredContexts = new WeakSet<AudioContext>();
const contextRegisterPromises = new WeakMap<AudioContext, Promise<boolean>>();
let isProcessorModuleRegistered = false;
const registrationCallbacks = new Set<() => void>();

export function onPhosphorWorkletReady(cb: () => void): () => void {
  registrationCallbacks.add(cb);
  return () => registrationCallbacks.delete(cb);
}

// Código JavaScript puro del procesador para fallback instantáneo mediante Blob URL en Vite / Dev / Offline
const PHOSPHOR_PROCESSOR_CODE_JS = `
function polyBlep(t, dt) {
  if (t < dt) {
    const v = t / dt;
    return v + v - v * v - 1.0;
  } else if (t > 1.0 - dt) {
    const v = (t - 1.0) / dt;
    return v * v + v + v + 1.0;
  }
  return 0.0;
}

class PhosphorWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.maxVoices = 16;
    this.ageCounter = 0;
    this.currentSample = 0;

    this.params = {
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
      attack: 0.04,
      decay: 0.25,
      sustain: 0.65,
      release: 0.6,

      glide: 0.0,
      gain: 0.7,
      pan: 0.0
    };

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

    this.port.onmessage = (e) => {
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

  noteOn(midi, velocity, durationSeconds, delaySamples) {
    let targetVoice = null;
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
        ? targetStart + Math.floor(durationSeconds * sampleRate)
        : -1;
  }

  noteOff(midi, delaySamples) {
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

  allNotesOff(delaySamples) {
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

  sampleOsc(wave, phase, dt) {
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

  process(_inputs, outputs, _parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;
    const blockSize = outL.length;

    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    const sr = sampleRate;
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

    const activeIndices = [];
    for (let v = 0; v < this.maxVoices; v++) {
      if (this.voices[v].active && this.voices[v].envStage !== 'idle') {
        activeIndices.push(v);
      }
    }
    if (activeIndices.length === 0) {
      this.currentSample += blockSize;
      return true;
    }

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

    for (let s = 0; s < blockSize; s++) {
      this.currentSample++;
      let sampleSumL = 0;
      let sampleSumR = 0;

      for (let i = 0; i < activeCount; i++) {
        const voice = this.voices[activeIndices[i]];
        if (!voice.active || voice.envStage === 'idle') continue;

        if (voice.envStage === 'pending') {
          if (this.currentSample >= voice.startSample) {
            voice.envStage = 'attack';
          } else {
            continue;
          }
        }

        if (voice.targetReleaseSample > 0 && this.currentSample >= voice.targetReleaseSample) {
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

        const dt1 = voice.frequency * osc1PitchFactor * dtBase;
        voice.phase1 = (voice.phase1 + dt1) % 1.0;
        let voiceSample = this.sampleOsc(this.params.osc1Wave, voice.phase1, dt1) * this.params.osc1Vol;

        if (this.params.osc2Enabled && this.params.osc2Vol > 0.0001) {
          const dt2 = voice.frequency * osc2PitchFactor * dtBase;
          voice.phase2 = (voice.phase2 + dt2) % 1.0;
          voiceSample += this.sampleOsc(this.params.osc2Wave, voice.phase2, dt2) * this.params.osc2Vol;
        }

        if (this.params.subEnabled && this.params.subVol > 0.0001) {
          const dtSub = voice.frequency * subPitchFactor * dtBase;
          voice.phaseSub = (voice.phaseSub + dtSub) % 1.0;
          voiceSample += this.sampleOsc(this.params.subWave || 'sine', voice.phaseSub, dtSub) * this.params.subVol;
        }

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
`;

/**
 * Obtiene el AudioContext nativo del navegador subyacente, desenpaquetando cualquier
 * wrapper de Tone.js o standardized-audio-context.
 */
export function getNativeAudioContext(ctx?: any): AudioContext {
  const raw = ctx || (Tone.getContext().rawContext as any);
  return raw?._nativeAudioContext || raw?._nativeContext || raw;
}

/**
 * Obtiene el AudioNode nativo del navegador, desenpaquetando cualquier wrapper de
 * ToneAudioNode, Gain, Filter, Volume o standardized-audio-context.
 */
export function getNativeAudioNode(node: any): AudioNode | null {
  if (!node) return null;
  if (node instanceof AudioNode) return node;
  if (node.input && node.input !== node) {
    const fromInput = getNativeAudioNode(node.input);
    if (fromInput) return fromInput;
  }
  if (node._nativeAudioNode instanceof AudioNode) return node._nativeAudioNode;
  if (node._nativeGainNode instanceof AudioNode) return node._nativeGainNode;
  if (node._nativeNode instanceof AudioNode) return node._nativeNode;
  if (node._nativeEventTarget instanceof AudioNode) return node._nativeEventTarget;
  for (const k of Object.getOwnPropertyNames(node)) {
    try {
      if (node[k] instanceof AudioNode) return node[k];
    } catch (_) {}
  }
  return null;
}

export async function ensurePhosphorWorkletRegistered(context?: any): Promise<boolean> {
  const nativeCtx = getNativeAudioContext(context);
  if (!nativeCtx || typeof nativeCtx.audioWorklet?.addModule !== 'function') return false;
  if (registeredContexts.has(nativeCtx) || isProcessorModuleRegistered) return true;
  const existingPromise = contextRegisterPromises.get(nativeCtx);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    try {
      // Si el contexto está suspendido, intentar activarlo si ya hay un user gesture
      if (nativeCtx.state === 'suspended') {
        try {
          await nativeCtx.resume();
        } catch (_) {}
      }

      const addModuleWithTimeout = (url: string) => {
        return Promise.race([
          nativeCtx.audioWorklet.addModule(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout cargando worklet desde ${url}`)), 1500))
        ]);
      };

      // 1. Cargar archivo estático desde public/worklets/phosphor-processor.js
      try {
        const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
        const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        const staticUrl = `${cleanBase}worklets/phosphor-processor.js`;
        await addModuleWithTimeout(staticUrl);
        registeredContexts.add(nativeCtx);
        isProcessorModuleRegistered = true;
        registrationCallbacks.forEach((cb) => {
          try { cb(); } catch (_) {}
        });
        return true;
      } catch (staticErr) {
        console.warn('[PhosphorWorkletNode] addModule(staticUrl) no respondió o falló, usando Blob inline:', staticErr);
      }

      // 2. Fallback con Blob URL inline
      try {
        const blob = new Blob([PHOSPHOR_PROCESSOR_CODE_JS], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        await addModuleWithTimeout(blobUrl);
        setTimeout(() => {
          try { URL.revokeObjectURL(blobUrl); } catch (_) {}
        }, 30000);
        registeredContexts.add(nativeCtx);
        isProcessorModuleRegistered = true;
        registrationCallbacks.forEach((cb) => {
          try { cb(); } catch (_) {}
        });
        return true;
      } catch (blobErr) {
        console.warn('[PhosphorWorkletNode] No se pudo registrar AudioWorklet module vía Blob:', blobErr);
        return false;
      }
    } finally {
      // Si la promesa no culminó en registro exitoso, eliminar del mapa para permitir reintento en el próximo user gesture
      if (!registeredContexts.has(nativeCtx) && !isProcessorModuleRegistered) {
        contextRegisterPromises.delete(nativeCtx);
      }
    }
  })();

  contextRegisterPromises.set(nativeCtx, promise);
  return promise;
}

export class PhosphorWorkletNode {
  public readonly id: string;
  private workletNode: AudioWorkletNode | null = null;
  private context: AudioContext;
  private nativeContext: AudioContext;
  private isReady = false;
  private pendingQueue: Array<(node: AudioWorkletNode) => void> = [];
  private unsubscribeReady: (() => void) | null = null;

  constructor(id: string, context?: any) {
    this.id = id;
    this.context = context || (Tone.getContext().rawContext as AudioContext);
    this.nativeContext = getNativeAudioContext(this.context);

    // Escuchar el evento de registro exitoso para auto-activarse sin demoras
    this.unsubscribeReady = onPhosphorWorkletReady(() => {
      this.tryInstantiate();
    });

    // Escuchar si el contexto cambia de suspended a running al interactuar el usuario
    if (this.nativeContext && this.nativeContext.state === 'suspended') {
      const onResume = () => {
        if (this.nativeContext.state === 'running') {
          this.nativeContext.removeEventListener('statechange', onResume);
          this.init();
        }
      };
      this.nativeContext.addEventListener('statechange', onResume);
    }

    // Si ya está registrado el procesador en el contexto, instanciar inmediatamente sin diferir
    this.tryInstantiate();

    if (!this.isReady) {
      this.init();
    }
  }

  public tryInstantiate(): boolean {
    if (this.isReady && this.workletNode) return true;
    const ctx = this.nativeContext || getNativeAudioContext(this.context);
    if (!ctx || typeof ctx.audioWorklet?.addModule !== 'function') return false;

    if (registeredContexts.has(ctx) || isProcessorModuleRegistered) {
      try {
        this.workletNode = new AudioWorkletNode(ctx, 'phosphor-synth-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        this.isReady = true;
        const queue = [...this.pendingQueue];
        this.pendingQueue = [];
        queue.forEach((fn) => fn(this.workletNode!));
        return true;
      } catch (err) {
        console.warn('[PhosphorWorkletNode] Error instanciando AudioWorkletNode:', err);
      }
    }
    return false;
  }

  public get ready(): boolean {
    if (this.isReady && this.workletNode) return true;
    return this.tryInstantiate();
  }

  public async init(): Promise<boolean> {
    if (this.isReady && this.workletNode) return true;
    try {
      const registered = await ensurePhosphorWorkletRegistered(this.nativeContext || this.context);
      if (!registered) return false;
      return this.tryInstantiate();
    } catch (err) {
      console.warn('[PhosphorWorkletNode] No se pudo instanciar el AudioWorklet:', err);
      return false;
    }
  }

  public connect(destination: AudioNode | Tone.ToneAudioNode): void {
    const doConnect = (node: AudioWorkletNode) => {
      try {
        const nativeDest = getNativeAudioNode(destination);
        if (nativeDest) {
          node.connect(nativeDest);
        } else {
          Tone.connect(node, destination);
        }
      } catch (err) {
        console.warn('[PhosphorWorkletNode] Error conectando a destino:', err);
      }
    };

    if (this.isReady && this.workletNode) {
      doConnect(this.workletNode);
    } else {
      this.pendingQueue.push(doConnect);
    }
  }

  public disconnect(): void {
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch (_) {}
    }
  }

  public triggerAttack(notes: string | number | (string | number)[], time?: number, velocity = 0.8): void {
    const noteArray = Array.isArray(notes) ? notes : [notes];
    const ctx = this.nativeContext || this.context;
    const now = ctx.currentTime;
    const delaySec = time !== undefined ? Math.max(0, time - now) : 0;
    const delaySamples = Math.round(delaySec * (ctx.sampleRate || 44100));

    noteArray.forEach((n) => {
      const midi = typeof n === 'number' ? n : noteToMidi(n);
      this.postMessage({ type: 'noteOn', midi, velocity, delaySamples });
    });
  }

  public triggerRelease(notes?: string | number | (string | number)[], time?: number): void {
    const ctx = this.nativeContext || this.context;
    const now = ctx.currentTime;
    const delaySec = time !== undefined ? Math.max(0, time - now) : 0;
    const delaySamples = Math.round(delaySec * (ctx.sampleRate || 44100));

    if (!notes) {
      this.allNotesOff(time);
      return;
    }

    const noteArray = Array.isArray(notes) ? notes : [notes];
    noteArray.forEach((n) => {
      const midi = typeof n === 'number' ? n : noteToMidi(n);
      this.postMessage({ type: 'noteOff', midi, delaySamples });
    });
  }

  public triggerAttackRelease(
    notes: string | number | (string | number)[],
    durationSeconds: number,
    time?: number,
    velocity = 0.8
  ): void {
    const noteArray = Array.isArray(notes) ? notes : [notes];
    const ctx = this.nativeContext || this.context;
    const now = ctx.currentTime;
    const delaySec = time !== undefined ? Math.max(0, time - now) : 0;
    const delaySamples = Math.round(delaySec * (ctx.sampleRate || 44100));

    noteArray.forEach((n) => {
      const midi = typeof n === 'number' ? n : noteToMidi(n);
      this.postMessage({ type: 'noteOn', midi, velocity, durationSeconds, delaySamples });
    });
  }

  public allNotesOff(time?: number): void {
    const ctx = this.nativeContext || this.context;
    const now = ctx.currentTime;
    const delaySec = time !== undefined ? Math.max(0, time - now) : 0;
    const delaySamples = Math.round(delaySec * (ctx.sampleRate || 44100));
    this.postMessage({ type: 'allNotesOff', delaySamples });
  }

  public setSettings(settings: SynthSettings): void {
    const params = {
      osc1Wave: settings.osc1?.waveType || settings.waveType || 'triangle',
      osc1Vol: settings.osc1?.enabled !== false ? (settings.osc1?.volume ?? 0.8) : 0,
      osc1Octave: settings.osc1?.octave ?? 0,
      osc1Semi: settings.osc1?.semi ?? 0,
      osc1Detune: settings.osc1?.detune ?? 0,

      osc2Enabled: settings.osc2?.enabled ?? false,
      osc2Wave: settings.osc2?.waveType || 'sawtooth',
      osc2Vol: settings.osc2?.volume ?? 0.4,
      osc2Octave: settings.osc2?.octave ?? 0,
      osc2Semi: settings.osc2?.semi ?? 0,
      osc2Detune: settings.osc2?.detune ?? 0,

      subEnabled: settings.subOsc?.enabled ?? false,
      subWave: settings.subOsc?.waveType || 'sine',
      subVol: settings.subOsc?.enabled ? (settings.subOsc?.volume ?? 0.0) : 0,
      subOctave: settings.subOsc?.octave ?? -1,

      noiseEnabled: settings.noise?.enabled ?? false,
      noiseType: settings.noise?.type || 'white',
      noiseVol: settings.noise?.enabled ? (settings.noise?.volume ?? 0.0) : 0,

      filterEnabled: settings.filter?.enabled !== false,
      filterType: settings.filter?.type || 'lowpass',
      filterFreq: settings.filter?.enabled ? Math.max(20, Math.min(20000, settings.filter?.frequency ?? 6500)) : 20000,
      filterQ: Math.max(0.1, Math.min(20, settings.filter?.Q ?? 1.5)),
      filterDrive: Math.max(0, Math.min(1, settings.filter?.drive ?? 0.1)),

      attack: Math.max(0.001, settings.envelope?.attack ?? 0.04),
      decay: Math.max(0.001, settings.envelope?.decay ?? 0.25),
      sustain: Math.max(0, Math.min(1, settings.envelope?.sustain ?? 0.65)),
      release: Math.max(0.001, settings.envelope?.release ?? 0.6),

      glide: settings.glide || 0.0,
      gain: 0.7,
      pan: 0.0
    };

    this.postMessage({ type: 'setParams', params });
  }

  private postMessage(msg: any): void {
    if (this.isReady && this.workletNode) {
      this.workletNode.port.postMessage(msg);
    } else {
      this.pendingQueue.push((node) => {
        node.port.postMessage(msg);
      });
    }
  }

  public dispose(): void {
    if (this.unsubscribeReady) {
      this.unsubscribeReady();
      this.unsubscribeReady = null;
    }
    this.allNotesOff();
    this.disconnect();
    this.workletNode = null;
    this.pendingQueue = [];
    this.isReady = false;
  }
}
