/**
 * DrumOfflineRenderer.ts
 * Renderizador de percusión offline ultrarrápido, determinista y de alta fidelidad.
 * 
 * Mezcla directamente en memoria todas las muestras de batería (WAV/MP3) a un único AudioBuffer estéreo.
 * - Cero sintetizadores de fallback: DEBEN sonar las muestras reales del kit.
 * - Si alguna muestra obligatoria no se puede cargar, LANZA UN ERROR explícito y descriptivo.
 * - Resampling lineal de alta fidelidad si la frecuencia de muestreo del sample difiere de la del render.
 * - Evita programar miles de nodos en el OfflineAudioContext, reduciendo el tiempo de render a milisegundos.
 */

import * as Tone from 'tone';
import type { ScheduledDrumEvent } from '../audioTypes';
import { createAudioBufferFromChannels } from './PhosphorDSPKernel';

function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  const cleanUrl = url.replace(/\\/g, '/');
  const baseUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const formattedUrl = cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`;
  return cleanBase ? `${cleanBase}${formattedUrl}` : formattedUrl;
}

/**
 * Carga un AudioBuffer de muestra de batería y lanza un error estricto si falla.
 */
async function loadDrumSampleBuffer(url: string): Promise<AudioBuffer> {
  const resolvedUrl = resolveAssetUrl(url);
  try {
    const toneBuffer = await Tone.ToneAudioBuffer.fromUrl(resolvedUrl);
    const audioBuf = toneBuffer.get();
    if (!audioBuf || audioBuf.length === 0) {
      throw new Error(`Buffer vacío o corrupto`);
    }
    return audioBuf as AudioBuffer;
  } catch (err: any) {
    throw new Error(
      `[Exportación de Audio] Error crítico: No se pudo cargar la muestra de batería obligatoria "${url}" (URL resuelta: "${resolvedUrl}"). Causa: ${err?.message || err}. Verifica que el archivo exista en public/ y sea accesible.`
    );
  }
}

/**
 * Renderiza de forma ultra-rápida (puro PCM mix en Float32Array) todos los eventos de batería.
 * Devuelve un AudioBuffer estéreo listo para inyectarse como un único buffer en Tone.Offline.
 */
export async function renderDrumsOffline(
  drumEvents: ScheduledDrumEvent[],
  totalDurationSeconds: number,
  sampleRate = 44100,
  preloadedBuffers?: Map<string, any>
): Promise<AudioBuffer> {
  const totalSamples = Math.ceil(Math.max(1, totalDurationSeconds) * sampleRate);
  const outL = new Float32Array(totalSamples);
  const outR = new Float32Array(totalSamples);

  if (!drumEvents || drumEvents.length === 0) {
    return createAudioBufferFromChannels([outL, outR], sampleRate);
  }

  // 1. Recopilar todas las URLs de muestras de batería únicas requeridas
  const uniqueUrls = Array.from(new Set(drumEvents.map((e) => e.sampleUrl).filter(Boolean)));

  // 2. Cargar todas las muestras en paralelo (usando la caché previa si está lista)
  const sampleMap = new Map<string, AudioBuffer>();
  const loadTasks = uniqueUrls.map(async (url) => {
    const normUrl = url.replace(/\\/g, '/');
    const cached =
      preloadedBuffers?.get(normUrl) ||
      preloadedBuffers?.get(normUrl.startsWith('/') ? normUrl.slice(1) : `/${normUrl}`) ||
      preloadedBuffers?.get(url);

    if (cached) {
      if ((cached as any).loaded && typeof (cached as any).get === 'function') {
        const buf = (cached as any).get();
        if (buf && buf.length > 0) {
          sampleMap.set(url, buf);
          return;
        }
      } else if (typeof (cached as any).getChannelData === 'function') {
        sampleMap.set(url, cached as AudioBuffer);
        return;
      }
    }
    // Si no está en caché previa, cargarlo directamente desde el servidor
    const loadedBuf = await loadDrumSampleBuffer(url);
    sampleMap.set(url, loadedBuf);
  });

  await Promise.all(loadTasks);

  // 3. Pre-extraer canales Float32 y pre-resamplear una sola vez por muestra única
  interface PreparedSample {
    srcL: Float32Array;
    srcR: Float32Array;
    length: number;
  }
  const preparedMap = new Map<string, PreparedSample>();

  for (const [url, sampleBuffer] of sampleMap.entries()) {
    const numChannels = sampleBuffer.numberOfChannels;
    const rawL = sampleBuffer.getChannelData(0);
    const rawR = numChannels > 1 ? sampleBuffer.getChannelData(1) : rawL;

    if (sampleBuffer.sampleRate === sampleRate) {
      preparedMap.set(url, {
        srcL: rawL,
        srcR: rawR,
        length: sampleBuffer.length
      });
    } else {
      // Pre-resampling lineal de alta fidelidad una sola vez
      const step = sampleBuffer.sampleRate / sampleRate;
      const srcLen = sampleBuffer.length;
      const targetLen = Math.floor(srcLen / step);
      const resampledL = new Float32Array(targetLen);
      const resampledR = new Float32Array(targetLen);

      for (let i = 0; i < targetLen; i++) {
        const srcPos = i * step;
        const idx = Math.floor(srcPos);
        const frac = srcPos - idx;
        const nextIdx = Math.min(srcLen - 1, idx + 1);
        resampledL[i] = rawL[idx] * (1 - frac) + rawL[nextIdx] * frac;
        resampledR[i] = rawR[idx] * (1 - frac) + rawR[nextIdx] * frac;
      }

      preparedMap.set(url, {
        srcL: resampledL,
        srcR: resampledR,
        length: targetLen
      });
    }
  }

  // 4. Mezclar cada golpe de batería en los canales estéreo outL / outR (Zero Web Audio nodes, suma plana ultrarrápida)
  for (let e = 0; e < drumEvents.length; e++) {
    const evt = drumEvents[e];
    const sample = preparedMap.get(evt.sampleUrl);
    if (!sample) {
      throw new Error(`[Exportación de Audio] La muestra de batería "${evt.sampleUrl}" no fue cargada.`);
    }

    const startSample = Math.round(evt.timeSeconds * sampleRate);
    if (startSample >= totalSamples) continue;

    const gainFactor = (evt.volume / 100) * evt.velocity;
    const pan = Math.max(-1, Math.min(1, evt.pan || 0));
    const gainL = gainFactor * (pan <= 0 ? 1 : 1 - pan);
    const gainR = gainFactor * (pan >= 0 ? 1 : 1 + pan);

    const srcL = sample.srcL;
    const srcR = sample.srcR;
    const len = Math.min(sample.length, totalSamples - startSample);

    for (let i = 0; i < len; i++) {
      outL[startSample + i] += srcL[i] * gainL;
      outR[startSample + i] += srcR[i] * gainR;
    }
  }

  return createAudioBufferFromChannels([outL, outR], sampleRate);
}

