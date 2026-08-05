/**
 * wavEncoder.ts
 * Convierte un AudioBuffer a un archivo WAV PCM 16-bit (RIFF estándar).
 * Sin dependencias externas — solo Web Audio API nativa.
 */

/**
 * Serializa un AudioBuffer como WAV PCM 16-bit estéreo (o mono si numberOfChannels === 1).
 * @returns ArrayBuffer con el archivo WAV completo, listo para descargar.
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = Math.min(buffer.numberOfChannels, 2); // max estéreo
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // --- RIFF Header ---
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);       // ChunkSize
  writeString(view, 8, 'WAVE');

  // --- fmt sub-chunk ---
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                  // Subchunk1Size (PCM = 16)
  view.setUint16(20, 1, true);                   // AudioFormat (PCM = 1)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // --- data sub-chunk ---
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // --- PCM samples (interleaved, clamp float → int16) ---
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = headerSize;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      // Clamp y convertir float32 [-1, 1] → int16
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const int16 = sample < 0
        ? Math.round(sample * 0x8000)
        : Math.round(sample * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
