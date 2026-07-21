/**
 * Algoritmo de autocorrelación para estimar la frecuencia fundamental (Pitch)
 * de un buffer de audio monofónico (adecuado para canto/tarareo).
 */
export function autoCorrelate(buffer: Float32Array, sampleRate: number): number {
  // 1. Calcular la potencia/energía del buffer para descartar silencios
  let size = buffer.length;
  let rms = 0;

  for (let i = 0; i < size; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / size);

  // Si la señal es muy débil (silencio), no detectamos tono (retorna -1)
  if (rms < 0.01) {
    return -1;
  }

  // 2. Recortar la señal para enfocarse en el centro si hay mucho ruido en los extremos
  let r1 = 0;
  let r2 = size - 1;
  const thres = 0.2;
  
  for (let i = 0; i < size / 2; i++) {
    if (Math.abs(buffer[i]) < thres) {
      r1 = i;
    } else {
      break;
    }
  }

  for (let i = size - 1; i >= size / 2; i--) {
    if (Math.abs(buffer[i]) < thres) {
      r2 = i;
    } else {
      break;
    }
  }

  const trimmedBuffer = buffer.subarray(r1, r2);
  size = trimmedBuffer.length;

  // 3. Autocorrelación
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size - i; j++) {
      c[i] = c[i] + trimmedBuffer[j] * trimmedBuffer[j + i];
    }
  }

  // Encontrar el primer pico después de que la autocorrelación empieza a decaer
  let d = 0;
  while (d < size - 1 && c[d] > c[d + 1]) {
    d++;
  }

  let maxval = -1;
  let maxpos = -1;
  
  for (let i = d; i < size; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }

  let T0 = maxpos;

  // Refinamiento parabólico para mayor precisión
  const x1 = c[T0 - 1] || 0;
  const x2 = c[T0];
  const x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) {
    T0 = T0 - b / (2 * a);
  }

  // Frecuencia fundamental en Hz
  const frequency = sampleRate / T0;

  // Validar rango de voz humana común (80Hz a 1000Hz)
  if (frequency > 80 && frequency < 1000) {
    return frequency;
  }

  return -1;
}

/**
 * Convierte una frecuencia en Hz al número de nota MIDI correspondiente
 */
export function hzToMidi(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}
