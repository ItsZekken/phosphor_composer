/**
 * pitchTrackerWorker.ts
 * Web Worker dedicado para la detección de pitch en tiempo real.
 * Libera al hilo principal de los cálculos de autocorrelación (O(N^2)).
 */

export interface PitchDetectRequest {
  id: number;
  buffer: Float32Array;
  sampleRate: number;
}

export interface PitchDetectResponse {
  id: number;
  result: {
    midi: number;
    frequency: number;
    clarity: number;
  } | null;
}

function detectPitch(buffer: Float32Array, sampleRate: number): { midi: number; frequency: number; clarity: number } | null {
  const size = buffer.length;
  let rms = 0;
  for (let i = 0; i < size; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / size);

  // Umbral de silencio
  if (rms < 0.015) {
    return null;
  }

  // Autocorrelación normalizada
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size - i; j++) {
      c[i] = c[i] + buffer[j] * buffer[j + i];
    }
  }

  // Encontrar primer mínimo local
  let d = 0;
  while (d < size - 1 && c[d] > c[d + 1]) {
    d++;
  }

  let maxVal = -1;
  let maxPos = -1;
  for (let i = d; i < size; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i];
      maxPos = i;
    }
  }

  if (maxPos <= 0 || c[0] <= 0) return null;

  const clarity = maxVal / c[0];
  if (clarity < 0.70) return null;

  let T0 = maxPos;
  // Interpolación parabólica
  const x1 = c[T0 - 1] || 0;
  const x2 = c[T0];
  const x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a !== 0) {
    T0 = T0 - b / (2 * a);
  }

  const frequency = sampleRate / T0;
  if (frequency < 70 || frequency > 1200) return null;

  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  return { midi, frequency, clarity };
}

self.onmessage = (e: MessageEvent<PitchDetectRequest>) => {
  const { id, buffer, sampleRate } = e.data;
  const result = detectPitch(buffer, sampleRate);
  const response: PitchDetectResponse = { id, result };
  self.postMessage(response);
};
