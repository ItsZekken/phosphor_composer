/**
 * mp3EncoderWorker.ts
 * Web Worker dedicado para la codificación MP3 CBR de alta fidelidad con LAME.
 * Ejecuta la compresión en segundo plano e informa del progreso de 0 a 1 sin bloquear la UI.
 */

import { Mp3Encoder } from '@breezystack/lamejs';

export interface Mp3WorkerEncodeRequest {
  leftChannel: Float32Array;
  rightChannel?: Float32Array | null;
  numChannels: number;
  sampleRate: number;
  bitrate?: number;
  normalize?: boolean;
  targetPeakDb?: number;
}

export type Mp3WorkerMessage =
  | { type: 'progress'; progress: number }
  | { type: 'complete'; blob: Blob }
  | { type: 'error'; error: string };

self.onmessage = (e: MessageEvent<Mp3WorkerEncodeRequest>) => {
  try {
    const {
      leftChannel,
      rightChannel,
      numChannels,
      sampleRate,
      bitrate = 256,
      normalize = true,
      targetPeakDb = -0.3
    } = e.data;

    const numSamples = leftChannel.length;
    const rightFloat = numChannels > 1 && rightChannel ? rightChannel : leftChannel;

    // 1. Análisis de Picos y Factor de Escala para Masterizado
    let scaleFactor = 1.0;
    if (normalize && numSamples > 0) {
      let maxPeak = 0;
      for (let i = 0; i < numSamples; i++) {
        const absL = Math.abs(leftChannel[i]);
        const absR = Math.abs(rightFloat[i]);
        if (absL > maxPeak) maxPeak = absL;
        if (absR > maxPeak) maxPeak = absR;
      }

      if (maxPeak > 0.0001) {
        const targetLinear = Math.pow(10, targetPeakDb / 20);
        if (maxPeak > targetLinear) {
          scaleFactor = targetLinear / maxPeak;
        }
      }
    }

    // 2. Conversión Float32 [-1.0, 1.0] a Int16 [-32768, 32767]
    const leftInt16 = new Int16Array(numSamples);
    const rightInt16 = new Int16Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const sL = Math.max(-1, Math.min(1, leftChannel[i] * scaleFactor));
      const sR = Math.max(-1, Math.min(1, rightFloat[i] * scaleFactor));

      leftInt16[i] = sL < 0 ? Math.round(sL * 0x8000) : Math.round(sL * 0x7fff);
      rightInt16[i] = sR < 0 ? Math.round(sR * 0x8000) : Math.round(sR * 0x7fff);
    }

    // 3. Instanciación y codificación con LAME MP3 Encoder
    const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate);
    const mp3Parts: BlobPart[] = [];
    const blockSize = 1152;
    let lastReportedProgress = 0;

    for (let i = 0; i < numSamples; i += blockSize) {
      const leftChunk = leftInt16.subarray(i, i + blockSize);
      const rightChunk = rightInt16.subarray(i, i + blockSize);

      let mp3buf: Uint8Array;
      if (numChannels === 1) {
        mp3buf = encoder.encodeBuffer(leftChunk);
      } else {
        mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
      }

      if (mp3buf && mp3buf.length > 0) {
        const copy = new Uint8Array(mp3buf.length);
        copy.set(mp3buf);
        mp3Parts.push(copy);
      }

      const progress = Math.min(1.0, (i + blockSize) / numSamples);
      if (progress - lastReportedProgress >= 0.05 || progress === 1.0) {
        lastReportedProgress = progress;
        self.postMessage({ type: 'progress', progress });
      }
    }

    // 4. Vaciar buffer final
    const flushBuf = encoder.flush();
    if (flushBuf && flushBuf.length > 0) {
      const copy = new Uint8Array(flushBuf.length);
      copy.set(flushBuf);
      mp3Parts.push(copy);
    }

    const blob = new Blob(mp3Parts, { type: 'audio/mp3' });
    self.postMessage({ type: 'complete', blob });
  } catch (err) {
    self.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
