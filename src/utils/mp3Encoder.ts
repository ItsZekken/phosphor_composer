/**
 * mp3Encoder.ts
 * Codificador directo e instantáneo de AudioBuffer a formato MP3 (CBR de alta fidelidad).
 * 
 * Ventajas sobre MediaRecorder:
 * - Renderizado 100% offline e instantáneo (milisegundos vs minutos en tiempo real).
 * - Máxima compatibilidad multiplataforma (iOS, Android, Windows, macOS, WhatsApp, DAWs).
 * - True Peak Normalization integrada a -0.3 dBFS para prevenir distorsión inter-sample.
 */

import { Mp3Encoder } from '@breezystack/lamejs';

export interface Mp3EncoderOptions {
  /** Bitrate en kbps (por defecto: 256 kbps) */
  bitrate?: number;
  /** Normalización suave para evitar distorsión por clipping digital (por defecto: true) */
  normalize?: boolean;
  /** Techo de pico en decibeles FS (por defecto: -0.3 dBFS) */
  targetPeakDb?: number;
}

export interface Mp3EncodeResult {
  blob: Blob;
  extension: 'mp3';
  mimeType: 'audio/mp3';
}

export interface Mp3WorkerEncodeOptions extends Mp3EncoderOptions {
  onProgress?: (progress: number) => void;
}

/**
 * Convierte un AudioBuffer decodificado en un Blob de audio MP3 de forma asíncrona en un Web Worker.
 * No bloquea el hilo principal y emite eventos de progreso fluidos.
 */
export async function audioBufferToMp3BlobAsync(
  buffer: AudioBuffer,
  options: Mp3WorkerEncodeOptions = {}
): Promise<Mp3EncodeResult> {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const bitrate = options.bitrate || 256;
  const normalize = options.normalize !== false;
  const targetPeakDb = options.targetPeakDb ?? -0.3;

  // Extraer canales Float32
  const leftFloat = buffer.getChannelData(0);
  const rightFloat = numChannels > 1 ? buffer.getChannelData(1) : null;

  try {
    const worker = new Worker(new URL('../workers/mp3EncoderWorker.ts', import.meta.url), { type: 'module' });

    return await new Promise<Mp3EncodeResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<any>) => {
        if (e.data.type === 'progress') {
          if (options.onProgress) {
            options.onProgress(e.data.progress);
          }
        } else if (e.data.type === 'complete') {
          worker.terminate();
          resolve({
            blob: e.data.blob,
            extension: 'mp3',
            mimeType: 'audio/mp3'
          });
        } else if (e.data.type === 'error') {
          worker.terminate();
          reject(new Error(e.data.error || 'Error en Worker MP3'));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      worker.postMessage({
        leftChannel: leftFloat,
        rightChannel: rightFloat,
        numChannels,
        sampleRate,
        bitrate,
        normalize,
        targetPeakDb
      });
    });
  } catch (workerErr) {
    console.warn('[mp3Encoder] Worker no disponible o falló, ejecutando fallback síncrono:', workerErr);
    return audioBufferToMp3Blob(buffer, options);
  }
}

/**
 * Convierte un AudioBuffer decodificado en un Blob de audio MP3 de 256 kbps estéreo (Fallback síncrono).
 */
export function audioBufferToMp3Blob(
  buffer: AudioBuffer,
  options: Mp3EncoderOptions = {}
): Mp3EncodeResult {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitrate = options.bitrate || 256;

  // 1. Extraer canales Float32
  const leftFloat = buffer.getChannelData(0);
  const rightFloat = numChannels > 1 ? buffer.getChannelData(1) : leftFloat;

  // 2. Normalización de Picos (True Peak Ceiling)
  const shouldNormalize = options.normalize !== false;
  let scaleFactor = 1.0;

  if (shouldNormalize && numSamples > 0) {
    let maxPeak = 0;
    for (let i = 0; i < numSamples; i++) {
      const absL = Math.abs(leftFloat[i]);
      const absR = Math.abs(rightFloat[i]);
      if (absL > maxPeak) maxPeak = absL;
      if (absR > maxPeak) maxPeak = absR;
    }

    if (maxPeak > 0.0001) {
      const targetPeakDb = typeof options.targetPeakDb === 'number' ? options.targetPeakDb : -0.3;
      const targetLinear = Math.pow(10, targetPeakDb / 20);
      if (maxPeak > targetLinear) {
        scaleFactor = targetLinear / maxPeak;
      }
    }
  }

  // 3. Conversión Float32 [-1.0, 1.0] a Int16 [-32768, 32767]
  const leftInt16 = new Int16Array(numSamples);
  const rightInt16 = new Int16Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const sL = Math.max(-1, Math.min(1, leftFloat[i] * scaleFactor));
    const sR = Math.max(-1, Math.min(1, rightFloat[i] * scaleFactor));

    leftInt16[i] = sL < 0 ? Math.round(sL * 0x8000) : Math.round(sL * 0x7fff);
    rightInt16[i] = sR < 0 ? Math.round(sR * 0x8000) : Math.round(sR * 0x7fff);
  }

  // 4. Instanciar LAME MP3 Encoder
  const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate);
  const mp3Parts: BlobPart[] = [];

  // Codificar en bloques de 1152 muestras (tamaño de frame estándar MP3)
  const blockSize = 1152;
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
  }

  // Vaciar y finalizar stream
  const flushBuf = encoder.flush();
  if (flushBuf && flushBuf.length > 0) {
    const copy = new Uint8Array(flushBuf.length);
    copy.set(flushBuf);
    mp3Parts.push(copy);
  }

  const blob = new Blob(mp3Parts, { type: 'audio/mp3' });

  return {
    blob,
    extension: 'mp3',
    mimeType: 'audio/mp3'
  };
}
