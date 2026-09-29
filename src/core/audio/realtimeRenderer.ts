import * as Tone from 'tone';
import { useSongStore } from '../../store/songStore';

/**
 * Renderiza la sesión en tiempo real (1x) capturando la salida maestra con Tone.Recorder.
 * Garantiza paridad acústica exacta con lo que el usuario escucha y ve durante el playback.
 */
export async function renderSessionRealtime(
  durationSeconds: number,
  onProgress: (elapsed: number, total: number) => void
): Promise<AudioBuffer> {
  const songStore = useSongStore.getState();
  const wasLooping = songStore.isLooping;
  const wasMetronome = songStore.isMetronomeActive;

  if (!Tone.Recorder.supported) {
    throw new Error('La grabación en tiempo real no está soportada en este entorno (MediaRecorder no disponible).');
  }

  const recorder = new Tone.Recorder();
  Tone.getDestination().connect(recorder);

  try {
    // 1. Preparar estados para exportación limpia sin metrónomo ni loop infinito
    if (wasLooping) {
      songStore.setLooping(false);
    }
    if (wasMetronome) {
      songStore.setMetronomeActive(false);
    }

    // Asegurar rebobinado a beat 0
    songStore.setCurrentBeat(0);
    try {
      Tone.Transport.stop();
      Tone.Transport.seconds = 0;
    } catch (_) {}

    // 2. Iniciar grabadora maestra y arrancar el motor de reproducción
    await recorder.start();
    useSongStore.getState().setPlaying(true);

    const startTime = performance.now();

    // 3. Monitorear progreso en tiempo real hasta alcanzar durationSeconds
    await new Promise<void>((resolve, reject) => {
      const interval = setInterval(() => {
        // Si el usuario canceló la exportación desde la UI
        if (!useSongStore.getState().isExporting) {
          clearInterval(interval);
          reject(new Error('Exportación cancelada.'));
          return;
        }

        const elapsedSeconds = (performance.now() - startTime) / 1000;
        const boundedElapsed = Math.min(durationSeconds, elapsedSeconds);
        onProgress(boundedElapsed, durationSeconds);

        if (elapsedSeconds >= durationSeconds) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    // 4. Detener reproducción
    useSongStore.getState().setPlaying(false);
    try {
      Tone.Transport.stop();
      Tone.Transport.seconds = 0;
    } catch (_) {}
    songStore.setCurrentBeat(0);

    // 5. Finalizar grabación y obtener el Blob
    const recordingBlob = await recorder.stop();

    // 6. Decodificar el flujo grabado a un AudioBuffer PCM nativo de alta calidad
    const arrayBuffer = await recordingBlob.arrayBuffer();
    const audioBuffer = await Tone.getContext().decodeAudioData(arrayBuffer);

    return audioBuffer;
  } finally {
    // 7. Limpieza y restauración de estados
    try {
      Tone.getDestination().disconnect(recorder);
      recorder.dispose();
    } catch (_) {}

    if (wasLooping) {
      useSongStore.getState().setLooping(true);
    }
    if (wasMetronome) {
      useSongStore.getState().setMetronomeActive(true);
    }
    useSongStore.getState().setPlaying(false);
  }
}
