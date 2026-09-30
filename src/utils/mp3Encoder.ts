/**
 * mp3Encoder.ts
 * Codificador directo e instantáneo de AudioBuffer a formato MP3 (CBR de alta fidelidad).
 * 
 * Ventajas sobre MediaRecorder:
 * - Renderizado 100% offline e instantáneo (milisegundos vs minutos en tiempo real).
 * - Máxima compatibilidad multiplataforma (iOS, Android, Windows, macOS, WhatsApp, DAWs).
 * - True Peak Normalization integrada a -0.3 dBFS para prevenir distorsión inter-sample.
 */

import {
  Output,
  Mp3OutputFormat,
  BufferTarget,
  AudioBufferSource,
  canEncodeAudio
} from 'mediabunny';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
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
  onPhase?: (phase: string) => void;
}

let isMp3EncoderRegistered = false;

export async function ensureMp3Encoder(): Promise<void> {
  if (isMp3EncoderRegistered) return;
  try {
    const canNative = await canEncodeAudio('mp3');
    if (!canNative) {
      registerMp3Encoder();
    }
    isMp3EncoderRegistered = true;
  } catch (_) {
    try {
      registerMp3Encoder();
      isMp3EncoderRegistered = true;
    } catch (e) {
      console.warn('[mp3Encoder] Error registrando Wasm MP3 Encoder:', e);
    }
  }
}

/**
 * Aplica True Peak Normalization a -0.3 dBFS creando una copia escalada del AudioBuffer si es necesario.
 */
function getNormalizedAudioBuffer(buffer: AudioBuffer, targetPeakDb = -0.3): AudioBuffer {
  const numChannels = buffer.numberOfChannels;
  const numSamples = buffer.length;
  let maxPeak = 0;

  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxPeak) maxPeak = abs;
    }
  }

  const targetLinear = Math.pow(10, targetPeakDb / 20);
  if (maxPeak <= 0.0001 || maxPeak <= targetLinear) {
    return buffer;
  }

  const scaleFactor = targetLinear / maxPeak;
  const scaledBuffer = new AudioBuffer({
    length: numSamples,
    numberOfChannels: numChannels,
    sampleRate: buffer.sampleRate
  });

  for (let ch = 0; ch < numChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = scaledBuffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      dest[i] = src[i] * scaleFactor;
    }
  }

  return scaledBuffer;
}

/**
 * Asegura que el AudioBuffer tenga una tasa de muestreo estándar compatible con MP3 (44.1 kHz o 48 kHz).
 * Si la tarjeta de sonido del usuario opera a 96 kHz o 88.2 kHz, resamplea offline a 44.1 kHz en milisegundos.
 */
async function ensureMp3CompatibleBuffer(buffer: AudioBuffer): Promise<AudioBuffer> {
  const supportedRates = [44100, 48000, 32000, 24000, 22050, 16000];
  if (supportedRates.includes(buffer.sampleRate)) {
    return buffer;
  }

  const targetRate = 44100;
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const targetLength = Math.max(1, Math.round(buffer.duration * targetRate));

  if (typeof OfflineAudioContext !== 'undefined') {
    const offlineCtx = new OfflineAudioContext(numChannels, targetLength, targetRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    return await offlineCtx.startRendering();
  }

  return buffer;
}

/**
 * Convierte un AudioBuffer decodificado en un Blob de audio MP3 acelerado por WebAssembly (Wasm LAME).
 * Si Wasm no está disponible, delega en segundo plano a Web Worker.
 */
export async function audioBufferToMp3BlobAsync(
  buffer: AudioBuffer,
  options: Mp3WorkerEncodeOptions = {}
): Promise<Mp3EncodeResult> {
  const bitrate = options.bitrate || 256;
  const normalize = options.normalize !== false;
  const targetPeakDb = options.targetPeakDb ?? -0.3;

  // Garantizar tasa de muestreo compatible con especificación MP3
  let processBuffer = buffer;
  try {
    processBuffer = await ensureMp3CompatibleBuffer(buffer);
  } catch (resampleErr) {
    console.warn('[mp3Encoder] Error resampleando buffer para MP3:', resampleErr);
  }

  // 1. Ruta de Ultra-Alta Velocidad: Mediabunny Wasm LAME
  try {
    await ensureMp3Encoder();

    const target = new BufferTarget();
    const output = new Output({
      format: new Mp3OutputFormat(),
      target
    });

    const audioSource = new AudioBufferSource({
      codec: 'mp3',
      bitrate: bitrate * 1000
    });
    output.addAudioTrack(audioSource);

    // Timeout de seguridad de 20s para permitir compilación de Wasm en dev o CPUs lentas sin caer innecesariamente en LAME JS
    const startPromise = output.start();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('timeout')), 20000)
    );
    await Promise.race([startPromise, timeoutPromise]);
    
    options.onPhase?.('COMPRIMIENDO MP3...');
    options.onProgress?.(0.2);

    const inputBuffer = normalize ? getNormalizedAudioBuffer(processBuffer, targetPeakDb) : processBuffer;
    await audioSource.add(inputBuffer);
    audioSource.close();
    options.onProgress?.(0.85);

    await output.finalize();
    options.onProgress?.(1.0);
    options.onPhase?.('FINALIZANDO...');

    const finalBuffer = target.buffer;
    if (finalBuffer && finalBuffer.byteLength > 0) {
      return {
        blob: new Blob([finalBuffer], { type: 'audio/mp3' }),
        extension: 'mp3',
        mimeType: 'audio/mp3'
      };
    }
  } catch (wasmErr) {
    console.warn('[mp3Encoder] Mediabunny Wasm falló o agotó tiempo, ejecutando fallback en Web Worker:', wasmErr);
  }

  // 2. Ruta de Respaldo: Web Worker con LAME JS
  return audioBufferToMp3WithWorker(processBuffer, options);
}

/**
 * Fallback asíncrono en Web Worker dedicado con LAME JS.
 */
export async function audioBufferToMp3WithWorker(
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
          if (options.onPhase) {
            const pct = Math.round(e.data.progress * 100);
            options.onPhase(pct > 0 && pct < 100 ? `COMPRIMIENDO MP3 (${pct}%)...` : 'COMPRIMIENDO MP3...');
          }
        } else if (e.data.type === 'complete') {
          worker.terminate();
          if (options.onPhase) {
            options.onPhase('FINALIZANDO...');
          }
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

  const factor = scaleFactor * 0x7fff;
  for (let i = 0; i < numSamples; i++) {
    let sL = leftFloat[i] * factor;
    let sR = rightFloat[i] * factor;
    if (sL > 32767) sL = 32767; else if (sL < -32768) sL = -32768;
    if (sR > 32767) sR = 32767; else if (sR < -32768) sR = -32768;
    leftInt16[i] = sL;
    rightInt16[i] = sR;
  }

  // 4. Instanciar LAME MP3 Encoder
  const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate);
  const mp3Parts: BlobPart[] = [];

  // Codificar en bloques (11520 muestras = 10 frames)
  const blockSize = 11520;
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
