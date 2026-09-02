/**
 * compressedAudioEncoder.ts
 * Fachada para exportación de audio comprimido de alta fidelidad (MP3 a 256 kbps).
 * Reemplaza la grabación en tiempo real por codificación directa offline.
 */

import { audioBufferToMp3Blob, type Mp3EncoderOptions, type Mp3EncodeResult } from './mp3Encoder';

export interface CompressedAudioResult {
  blob: Blob;
  extension: 'mp3';
  mimeType: 'audio/mp3';
}

/**
 * Convierte un AudioBuffer en un archivo de audio comprimido MP3 de alta fidelidad.
 */
export async function audioBufferToCompressedBlob(
  audioBuffer: AudioBuffer,
  options?: Mp3EncoderOptions
): Promise<CompressedAudioResult> {
  const result: Mp3EncodeResult = audioBufferToMp3Blob(audioBuffer, options);
  return result;
}
