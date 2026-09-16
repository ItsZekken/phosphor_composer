/**
 * waveformWorker.ts
 * Web Worker dedicado para el cálculo en segundo plano de la pirámide de picos (LOD).
 * Genera min/max pares para visualización de formas de onda en Canvas sin congelar el hilo principal.
 */

export interface WaveformWorkerRequest {
  id: string;
  channelData: Float32Array;
  lodLevels?: number[]; // [64, 256, 1024, 4096]
}

export interface WaveformWorkerResponse {
  id: string;
  peaksByLod: Record<number, Float32Array>;
}

self.onmessage = (e: MessageEvent<WaveformWorkerRequest>) => {
  const { id, channelData, lodLevels = [64, 256, 1024, 4096] } = e.data;
  const peaksByLod: Record<number, Float32Array> = {};
  const transferables: ArrayBuffer[] = [];

  const totalSamples = channelData.length;

  for (const bucketSize of lodLevels) {
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

    peaksByLod[bucketSize] = peaks;
    transferables.push(peaks.buffer);
  }

  const response: WaveformWorkerResponse = { id, peaksByLod };
  (postMessage as any)(response, transferables);
};
