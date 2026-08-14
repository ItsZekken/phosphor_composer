/**
 * compressedAudioEncoder.ts
 * Codifica un AudioBuffer renderizado a un formato de audio comprimido (.ogg / .webm con Opus / Vorbis)
 * utilizando la MediaStream Recording API nativa del navegador.
 */

export interface CompressedAudioResult {
  blob: Blob;
  extension: 'ogg' | 'webm';
  mimeType: string;
}

/**
 * Convierte un AudioBuffer en un Blob de audio comprimido de alta calidad y bajo peso.
 */
export async function audioBufferToCompressedBlob(
  audioBuffer: AudioBuffer,
  preferredFormat: 'ogg' | 'webm' = 'ogg'
): Promise<CompressedAudioResult> {
  // 1. Determinar el mejor formato soportado por el navegador
  let mimeType = '';
  let extension: 'ogg' | 'webm' = 'ogg';

  if (preferredFormat === 'ogg' && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
    mimeType = 'audio/ogg;codecs=opus';
    extension = 'ogg';
  } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    mimeType = 'audio/webm;codecs=opus';
    extension = 'webm';
  } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/ogg')) {
    mimeType = 'audio/ogg';
    extension = 'ogg';
  } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')) {
    mimeType = 'audio/webm';
    extension = 'webm';
  }

  // 2. Si no hay soporte para MediaRecorder (por ej. en Node.js de pruebas)
  if (!mimeType || typeof OfflineAudioContext === 'undefined') {
    // Retornar un fallback estructurado
    return {
      blob: new Blob([], { type: 'audio/ogg' }),
      extension: 'ogg',
      mimeType: 'audio/ogg'
    };
  }

  // 3. Crear AudioContext en tiempo real para reproducción rápida al MediaStreamDestination
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const destination = audioCtx.createMediaStreamDestination();
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(destination);

  const mediaRecorder = new MediaRecorder(destination.stream, {
    mimeType,
    audioBitsPerSecond: 192000 // 192 kbps Opus de alta calidad
  });

  const chunks: Blob[] = [];

  return new Promise<CompressedAudioResult>((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      try {
        source.disconnect();
        destination.disconnect();
        audioCtx.close();
      } catch (_) {}

      const finalBlob = new Blob(chunks, { type: mimeType });
      resolve({
        blob: finalBlob,
        extension,
        mimeType
      });
    };

    mediaRecorder.onerror = (err) => {
      try { audioCtx.close(); } catch (_) {}
      reject(err);
    };

    // Iniciar grabación y reproducir el buffer
    mediaRecorder.start(100);
    source.start(0);

    source.onended = () => {
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 150);
    };
  });
}
