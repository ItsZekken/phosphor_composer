/**
 * AudioTimelineRuler.tsx
 * Regla superior de la línea de tiempo sincronizada con los compases musicales.
 * Dibuja marcas de compás/beat en Canvas y permite arrastre/click para desplazar el cabezal (Seek).
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';

interface AudioTimelineRulerProps {
  totalBeats: number;
  zoomLevel: number; // Píxeles por beat
  onSeek?: (beat: number) => void;
}

export const AudioTimelineRuler: React.FC<AudioTimelineRulerProps> = ({
  totalBeats,
  zoomLevel,
  onSeek
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isScrubbingRef = useRef(false);

  const timeSignature = useSongStore((state) => state.timeSignature);
  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;

  const totalWidth = Math.max(1200, totalBeats * zoomLevel);

  const drawRuler = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = totalWidth;
    const height = 28;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Fondo de la regla
    ctx.fillStyle = '#221d2c';
    ctx.fillRect(0, 0, width, height);

    ctx.font = '10px "Share Tech Mono", monospace';
    ctx.textBaseline = 'middle';

    const numMeasures = Math.ceil(totalBeats / beatsPerMeasure) + 4;

    for (let m = 0; m < numMeasures; m++) {
      const measureBeat = m * beatsPerMeasure;
      const measureX = measureBeat * zoomLevel;

      // Línea principal de compás
      ctx.strokeStyle = '#4a3f5a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(measureX, 0);
      ctx.lineTo(measureX, height);
      ctx.stroke();

      // Número de compás
      ctx.fillStyle = '#a89fc0';
      ctx.fillText(`${m + 1}`, measureX + 4, 12);

      // Ticks de beats dentro del compás
      for (let b = 1; b < beatsPerMeasure; b++) {
        const beatX = (measureBeat + b) * zoomLevel;
        ctx.strokeStyle = '#322b40';
        ctx.beginPath();
        ctx.moveTo(beatX, height - 8);
        ctx.lineTo(beatX, height);
        ctx.stroke();
      }
    }

    // Línea divisoria inferior
    ctx.strokeStyle = '#38304a';
    ctx.beginPath();
    ctx.moveTo(0, height - 1);
    ctx.lineTo(width, height - 1);
    ctx.stroke();

    ctx.restore();
  }, [totalWidth, totalBeats, beatsPerMeasure, zoomLevel]);

  useEffect(() => {
    drawRuler();
  }, [drawRuler]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const beat = Math.max(0, x / zoomLevel);

    isScrubbingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);

    toneEngine.seekToBeat(beat);
    onSeek?.(beat);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScrubbingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const beat = Math.max(0, x / zoomLevel);

    toneEngine.seekToBeat(beat);
    onSeek?.(beat);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isScrubbingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  return (
    <div className="audio-timeline-ruler" style={{ width: totalWidth }}>
      <canvas
        ref={canvasRef}
        className="audio-ruler-canvas"
        style={{ width: totalWidth, height: 28 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
};
