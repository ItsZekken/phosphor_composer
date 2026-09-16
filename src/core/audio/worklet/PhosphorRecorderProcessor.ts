/**
 * PhosphorRecorderProcessor.ts
 * Procesador de captura de audio PCM en tiempo real para AudioWorklet.
 * Captura audio sin compresión a nivel de muestra desde getUserMedia con mínima latencia
 * y emite bloques con transferencia de memoria (zero-copy) junto con telemetría RMS para vúmetro.
 */

import { getNativeAudioContext } from './PhosphorWorkletNode';

const RECORDER_PROCESSOR_JS = `
class PhosphorRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    this.bufferSize = 2048;
    this.bufferIndex = 0;
    this.channelBufferL = new Float32Array(this.bufferSize);
    this.channelBufferR = new Float32Array(this.bufferSize);

    this.port.onmessage = (e) => {
      const data = e.data;
      if (data.type === 'START') {
        this.isRecording = true;
        this.bufferIndex = 0;
      } else if (data.type === 'STOP') {
        if (this.isRecording && this.bufferIndex > 0) {
          this.flush(this.bufferIndex);
        }
        this.isRecording = false;
        this.bufferIndex = 0;
      }
    };
  }

  flush(length) {
    const chunkL = this.channelBufferL.slice(0, length);
    const chunkR = this.channelBufferR.slice(0, length);
    
    // Cálculo de RMS para vúmetro de entrada
    let sumSquares = 0;
    for (let i = 0; i < length; i++) {
      const s = chunkL[i];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, length));

    this.port.postMessage(
      { type: 'DATA', chunkL, chunkR, rms },
      [chunkL.buffer, chunkR.buffer]
    );

    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const inputL = input[0];
    const inputR = input[1] || inputL;
    const numSamples = inputL.length;

    if (!this.isRecording) {
      // Si no está grabando pero está activo el nodo, calcular RMS ligero para monitor
      if (numSamples > 0 && Math.random() < 0.1) {
        let sum = 0;
        for (let i = 0; i < numSamples; i++) sum += inputL[i] * inputL[i];
        const rms = Math.sqrt(sum / numSamples);
        this.port.postMessage({ type: 'METER', rms });
      }
      return true;
    }

    for (let i = 0; i < numSamples; i++) {
      this.channelBufferL[this.bufferIndex] = inputL[i];
      this.channelBufferR[this.bufferIndex] = inputR[i];
      this.bufferIndex++;

      if (this.bufferIndex >= this.bufferSize) {
        this.flush(this.bufferSize);
      }
    }

    return true;
  }
}

registerProcessor('phosphor-recorder-processor', PhosphorRecorderProcessor);
`;

const registeredContexts = new WeakSet<AudioContext>();
const contextRegisterPromises = new WeakMap<AudioContext, Promise<boolean>>();

export async function ensurePhosphorRecorderWorkletRegistered(context?: any): Promise<boolean> {
  const nativeCtx = getNativeAudioContext(context);
  if (!nativeCtx || typeof nativeCtx.audioWorklet?.addModule !== 'function') return false;
  if (registeredContexts.has(nativeCtx)) return true;
  const existing = contextRegisterPromises.get(nativeCtx);
  if (existing) return existing;

  const promise = (async () => {
    try {
      if (nativeCtx.state === 'suspended') {
        try {
          await nativeCtx.resume();
        } catch (_) {}
      }

      const blob = new Blob([RECORDER_PROCESSOR_JS], { type: 'application/javascript; charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      await nativeCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      registeredContexts.add(nativeCtx);
      return true;
    } catch (err) {
      console.warn('[PhosphorRecorderProcessor] Error registrando AudioWorklet de grabación:', err);
      return false;
    }
  })();

  contextRegisterPromises.set(nativeCtx, promise);
  return promise;
}
