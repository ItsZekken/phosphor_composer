/**
 * stageVideoExporter.ts
 * Orquestador de exportación de video offline en formato universal MP4 (1080p @ 30 FPS).
 * 
 * - Renderiza el audio maestro con renderSessionToAudioBuffer.
 * - Procesa fotograma a fotograma el Stage Visualizer con stageVideoRenderer.
 * - Codifica con WebCodecs nativo (H.264 + AAC) mediante Mediabunny.
 * - Emite progreso detallado y soporte para cancelación en cualquier momento.
 */

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  canEncodeAudio
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import type { SessionV2 } from '../session';
import type { PatternDef } from '../../patterns/patternTypes';
import { renderSessionToAudioBuffer } from '../audio/offlineRenderer';
import { createTempoMap } from '../music';
import { extractStageTimelineNotes } from '../../components/visualizer/hooks/useStageTimelineNotes';
import { renderStageFrame, type StageParticle } from '../stage/stageRenderer';

let aacRegistered = false;

async function ensureAacEncoder() {
  if (aacRegistered) return;
  try {
    const canNative = await canEncodeAudio('aac');
    if (!canNative) {
      registerAacEncoder();
    }
    aacRegistered = true;
  } catch (_) {
    try {
      registerAacEncoder();
      aacRegistered = true;
    } catch (e) {
      console.warn('[StageVideoExporter] Error registrando AAC encoder:', e);
    }
  }
}

export interface StageVideoExportOptions {
  width?: number;
  height?: number;
  fps?: number;
  visualizerMode?: 'oscilloscope' | 'spectrum' | 'lissajous';
  isCrtEnabled?: boolean;
  drumBuffers?: Map<string, any>;
  onProgress?: (progress: number, phase: string, elapsedMs: number) => void;
  signal?: AbortSignal;
}

/**
 * Exporta el Stage Visualizer como video MP4 Full HD de alta calidad.
 */
export async function exportStageToMp4(
  session: SessionV2,
  customPatterns: PatternDef[] = [],
  options: StageVideoExportOptions = {}
): Promise<Blob> {
  const {
    width = 1920,
    height = 1080,
    fps = 30,
    visualizerMode = 'oscilloscope',
    isCrtEnabled = true,
    drumBuffers,
    onProgress,
    signal
  } = options;

  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Tu navegador no soporta WebCodecs VideoEncoder para exportación directa de MP4.');
  }

  // 1. Asegurar codificador de audio AAC
  await ensureAacEncoder();

  if (signal?.aborted) {
    throw new Error('Exportación cancelada.');
  }

  const exportStartTime = performance.now();

  // 2. FASE 1: Renderizado de Audio Maestro Offline
  onProgress?.(0.02, 'Renderizando audio maestro estéreo...', 0);

  const audioBuffer = await renderSessionToAudioBuffer(session, customPatterns, {
    drumBuffers,
    normalize: true,
    targetPeakDb: -0.3,
    onProgress: (elapsed, total) => {
      if (signal?.aborted) return;
      const p = total > 0 ? 0.02 + (elapsed / total) * 0.22 : 0.02;
      onProgress?.(p, 'Renderizando audio maestro estéreo...', performance.now() - exportStartTime);
    }
  });

  if (signal?.aborted) {
    throw new Error('Exportación cancelada.');
  }

  const totalDurationSeconds = Math.max(1, audioBuffer.duration);
  const totalFrames = Math.max(1, Math.ceil(totalDurationSeconds * fps));

  // 3. FASE 2: Preparación del Entorno Gráfico y Mediabunny
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat(),
    target
  });

  // Configurar e inicializar pista de audio AAC
  const audioSource = new AudioBufferSource({
    codec: 'aac',
    bitrate: 192_000
  });
  output.addAudioTrack(audioSource);

  // Instanciar lienzo de dibujo principal (OffscreenCanvas preferido)
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  // Instanciar lienzo secundario para persistencia analógica de fósforo
  let bgCanvas: HTMLCanvasElement | OffscreenCanvas;
  let bgCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d');
    bgCanvas = new OffscreenCanvas(width, height);
    bgCtx = bgCanvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = width;
    bgCanvas.height = height;
    bgCtx = bgCanvas.getContext('2d');
  }

  if (!ctx || !bgCtx) {
    throw new Error('No se pudo inicializar el contexto gráfico para renderizar el video.');
  }

  // Agregar pista de video H.264 optimizada con bitrate por hardware
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: 6_000_000,
    bitrateMode: 'variable'
  });
  output.addVideoTrack(videoSource);

  // Inicializar contenedor
  await output.start();

  // Inyectar el buffer de audio a la pista y cerrar el source de audio
  await audioSource.add(audioBuffer);
  audioSource.close();

  // Pre-calcular metadatos visuales
  const tempoMap = createTempoMap(
    session.transport.bpm || 120,
    session.transport.tempoMarkers || []
  );

  const notes = extractStageTimelineNotes({
    chordBlocks: session.harmony.chordBlocks,
    chordOctaveShift: session.harmony.chordOctaveShift,
    tracks: session.tracks,
    channels: session.mixer.channels
  });

  const particles: StageParticle[] = [];
  const keyLuminanceMap = new Map<number, { color: string; alpha: number }>();
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const waveformSlice = new Float32Array(512);
  const frameDuration = 1 / fps;

  // 4. FASE 3: Bucle de Renderizado y Codificación Cuadro a Cuadro 1:1
  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) {
      throw new Error('Exportación cancelada por el usuario.');
    }

    const t = i * frameDuration;
    const beat = tempoMap.secondsToBeat(t);

    // Extraer ventana de 512 muestras de la forma de onda en t
    const sampleCenter = Math.floor(t * sampleRate);
    const startSample = Math.max(0, sampleCenter - 256);
    for (let s = 0; s < 512; s++) {
      waveformSlice[s] = channelData[startSample + s] ?? 0;
    }

    // Dibujar fotograma Full HD 1:1 en el lienzo con el motor compartido
    renderStageFrame(ctx, width, height, {
      t,
      beat,
      totalDurationSeconds,
      totalBeats: tempoMap.secondsToBeat(totalDurationSeconds),
      notes,
      waveform: waveformSlice,
      drumChannels: session.drums.drumChannels,
      patternChain: session.drums.patternChain,
      isPatternRepeatOn: session.drums.isPatternRepeatOn,
      currentDrumPatternEdit: session.drums.currentDrumPatternEdit ?? 0,
      chordBlocks: session.harmony.chordBlocks,
      visualizerMode,
      isCrtEnabled,
      particles,
      keyLuminanceMap,
      bgCanvas,
      bgCtx,
      isFirstFrame: i === 0
    });

    // Enviar fotograma al codificador WebCodecs
    await videoSource.add(t, frameDuration);

    // Notificar progreso periódicamente y ceder el hilo
    if (i % 15 === 0 || i === totalFrames - 1) {
      const progress = 0.25 + (i / totalFrames) * 0.70;
      const elapsed = performance.now() - exportStartTime;
      onProgress?.(
        progress,
        `Generando video MP4 a ${fps} FPS (Fotograma ${i + 1}/${totalFrames})...`,
        elapsed
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // 5. FASE 4: Finalización del Contenedor MP4
  onProgress?.(0.96, 'Finalizando y empaquetando MP4...', performance.now() - exportStartTime);
  await output.finalize();

  const finalBuffer = target.buffer;
  if (!finalBuffer) {
    throw new Error('Error generando el archivo MP4 final.');
  }

  const mp4Blob = new Blob([finalBuffer], { type: 'video/mp4' });
  onProgress?.(1.0, '¡Exportación completada!', performance.now() - exportStartTime);

  return mp4Blob;
}
