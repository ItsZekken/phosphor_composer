import { BufferTarget, Output, Mp4OutputFormat, AudioBufferSource, canEncodeAudio } from 'mediabunny';

export async function audioBufferToM4aBlobAsync(
  buffer: AudioBuffer,
  options: {
    bitrate?: number;
    onProgress?: (p: number) => void;
    onPhase?: (phase: string) => void;
  } = {}
) {
  const bitrate = options.bitrate || 128;
  
  if (!(await canEncodeAudio('aac'))) {
    throw new Error('Tu navegador no soporta compresión AAC.');
  }

  options.onPhase?.('COMPRIMIENDO M4A (AAC)...');
  options.onProgress?.(0.1);

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat(),
    target
  });

  const audioSource = new AudioBufferSource({
    codec: 'aac',
    bitrate: bitrate * 1000
  });
  output.addAudioTrack(audioSource);

  await output.start();
  options.onProgress?.(0.3);

  await audioSource.add(buffer);
  audioSource.close();
  options.onProgress?.(0.9);

  await output.finalize();
  options.onProgress?.(1.0);

  const finalBuffer = target.buffer;
  if (!finalBuffer || finalBuffer.byteLength === 0) {
    throw new Error('Error al generar el archivo M4A.');
  }

  return {
    blob: new Blob([finalBuffer], { type: 'audio/mp4' }),
    extension: 'm4a',
    mimeType: 'audio/mp4'
  };
}
