/**
 * waveformService.ts
 * Servicio para orquestar la generación de pirámides de picos de audio (LOD)
 * delegando en waveformWorker con fallback seguro síncrono.
 */

import { audioBufferRegistry } from './audioBufferRegistry';
import type { WaveformWorkerRequest, WaveformWorkerResponse } from '../../workers/waveformWorker';

export const DEFAULT_LODS = [64, 256, 1024, 4096];

class WaveformService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, (peaks: Record<number, Float32Array>) => void>();

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../../workers/waveformWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<WaveformWorkerResponse>) => {
          const { id, peaksByLod } = e.data;
          // Guardar en el registro
          for (const [lodStr, peaks] of Object.entries(peaksByLod)) {
            audioBufferRegistry.setPeaks(id, Number(lodStr), peaks);
          }
          const callback = this.pendingRequests.get(id);
          if (callback) {
            this.pendingRequests.delete(id);
            callback(peaksByLod);
          }
        };
      } catch (err) {
        console.warn('[WaveformService] No se pudo inicializar Web Worker para waveforms:', err);
        this.worker = null;
      }
    }
  }

  /**
   * Genera o recupera los picos de forma de onda para un buffer registrado.
   */
  public async getOrGeneratePeaks(bufferId: string, buffer: AudioBuffer): Promise<Record<number, Float32Array>> {
    // Si ya tenemos el LOD principal en caché, construir y devolver
    if (audioBufferRegistry.hasPeaks(bufferId)) {
      const result: Record<number, Float32Array> = {};
      for (const lod of DEFAULT_LODS) {
        const p = audioBufferRegistry.getPeaks(bufferId, lod);
        if (p) result[lod] = p;
      }
      if (Object.keys(result).length === DEFAULT_LODS.length) {
        return result;
      }
    }

    const channelData = buffer.getChannelData(0);

    if (this.worker) {
      return new Promise<Record<number, Float32Array>>((resolve) => {
        this.pendingRequests.set(bufferId, resolve);
        // Enviamos una copia de los datos del canal
        const clonedData = new Float32Array(channelData);
        const req: WaveformWorkerRequest = {
          id: bufferId,
          channelData: clonedData,
          lodLevels: DEFAULT_LODS
        };
        this.worker!.postMessage(req, [clonedData.buffer]);
      });
    }

    // Fallback síncrono si el worker no está disponible
    return this.calculateSync(bufferId, channelData);
  }

  private calculateSync(bufferId: string, channelData: Float32Array): Record<number, Float32Array> {
    const result: Record<number, Float32Array> = {};
    const totalSamples = channelData.length;

    for (const bucketSize of DEFAULT_LODS) {
      const numBuckets = Math.ceil(totalSamples / bucketSize);
      const peaks = new Float32Array(numBuckets * 2);

      for (let b = 0; b < numBuckets; b++) {
        const start = b * bucketSize;
        const end = Math.min(start + bucketSize, totalSamples);

        let min = 1.0;
        let max = -1.0;

        for (let s = start; s < end; s++) {
          const val = channelData[s];
          if (val < min) min = val;
          if (val > max) max = val;
        }

        if (min > max) {
          min = 0;
          max = 0;
        }

        peaks[b * 2] = min;
        peaks[b * 2 + 1] = max;
      }

      result[bucketSize] = peaks;
      audioBufferRegistry.setPeaks(bufferId, bucketSize, peaks);
    }

    return result;
  }
}

export const waveformService = new WaveformService();
