import React, { useRef, useEffect } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { useStageTimelineNotes } from './hooks/useStageTimelineNotes';
import { renderStageFrame } from '../../core/stage/stageRenderer';
import type { StageParticle, KeyLuminanceEntry } from '../../core/stage/stageRenderer';
import type { VisualizerMode } from './StageTelemetryHUD';

interface StageCanvasProps {
  mode: VisualizerMode;
}

/**
 * StageCanvas: Lienzo unificado a 60 FPS del Stage Visualizer.
 * Ejecuta el mismo motor gráfico puro (renderStageFrame) que el exportador de video MP4.
 */
export const StageCanvas: React.FC<StageCanvasProps> = React.memo(({ mode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { notes } = useStageTimelineNotes();
  const notesRef = useRef(notes);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Buffer secundario para la estela analógica de fósforo
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = canvas.width || 1920;
    bgCanvas.height = canvas.height || 1080;
    const bgCtx = bgCanvas.getContext('2d');
    if (!bgCtx) return;

    const particles: StageParticle[] = [];
    const keyLuminanceMap = new Map<number, KeyLuminanceEntry>();
    const waveformBuffer = new Float32Array(512);

    let animId: number;
    let isFirstFrame = true;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Asegurar sincronización de dimensiones en el buffer de fósforo
      if (bgCanvas.width !== width || bgCanvas.height !== height) {
        bgCanvas.width = width;
        bgCanvas.height = height;
        isFirstFrame = true;
      }

      if (width > 0 && height > 0) {
        const store = useSongStore.getState();
        const isPlaying = store.isPlaying;
        const liveBeat = isPlaying ? toneEngine.getLiveBeat() : (store.currentBeat ?? 0);
        const waveform = toneEngine.getWaveformData(waveformBuffer);

        renderStageFrame(ctx, width, height, {
          beat: liveBeat,
          waveform,
          notes: notesRef.current,
          drumChannels: store.drumChannels,
          patternChain: store.patternChain,
          isPatternRepeatOn: store.isPatternRepeatOn,
          currentDrumPatternEdit: store.currentDrumPatternEdit ?? 0,
          chordBlocks: store.chordBlocks,
          visualizerMode: mode,
          isCrtEnabled: store.isCrtEnabled,
          isPlaying,
          particles,
          keyLuminanceMap,
          bgCanvas,
          bgCtx,
          isFirstFrame
        });

        if (isFirstFrame) isFirstFrame = false;
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [mode]);

  // ResizeObserver para alta resolución DPR
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const rect = entry.contentRect;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

  // Interactividad: Clic en la cinta armónica para salto temporal (seek)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const kbHeight = 22;
    const ribbonHeight = 32;
    const ribbonY = rect.height - kbHeight - 24 - ribbonHeight;

    // Detectar si el clic ocurrió dentro de la zona de la cinta de acordes
    if (clickY >= ribbonY && clickY <= ribbonY + ribbonHeight) {
      const store = useSongStore.getState();
      const chordBlocks = store.chordBlocks;
      if (!chordBlocks || chordBlocks.length === 0) return;

      const ribbonMarginX = 12;
      const ribbonWidth = rect.width - ribbonMarginX * 2;
      const beatWidth = 40;
      const songStartBeat = chordBlocks[0]?.startBeat ?? 0;
      const lastBlock = chordBlocks[chordBlocks.length - 1];
      const songTotalBeats = lastBlock ? (lastBlock.startBeat + lastBlock.durationBeats) - songStartBeat : 16;
      const totalTrackWidth = songTotalBeats * beatWidth;

      const currentBeat = store.isPlaying ? toneEngine.getLiveBeat() : (store.currentBeat ?? 0);
      const playheadRelX = (currentBeat - songStartBeat) * beatWidth;
      let scrollX = 0;
      if (totalTrackWidth > ribbonWidth) {
        const focalOffset = ribbonWidth * 0.35;
        const maxScroll = totalTrackWidth - ribbonWidth;
        scrollX = Math.max(0, Math.min(maxScroll, playheadRelX - focalOffset));
      }

      const relativeX = clickX - ribbonMarginX + scrollX;
      const targetBeat = Math.max(0, songStartBeat + relativeX / beatWidth);

      toneEngine.seekToBeat(targetBeat);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        cursor: 'default'
      }}
      onClick={handleCanvasClick}
    />
  );
});
