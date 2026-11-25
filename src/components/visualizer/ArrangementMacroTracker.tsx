import React, { useEffect, useMemo, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { DrumChainLiveTracker } from './DrumChainLiveTracker';
import type { PianoRollTrack } from '../../utils/typeDefinitions';

export const ArrangementMacroTracker: React.FC = React.memo(() => {
  const chordBlocks = useSongStore((state) => state.chordBlocks);
  const tracks = useSongStore((state) => state.tracks);
  const isPlaying = useSongStore((state) => state.isPlaying);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  // Calcular longitud total en compases
  const totalBeats = useMemo(() => {
    let max = 16;
    for (let i = 0; i < chordBlocks.length; i++) {
      const b = chordBlocks[i];
      if (b.startBeat + b.durationBeats > max) max = b.startBeat + b.durationBeats;
    }
    for (let t = 0; t < tracks.length; t++) {
      const notes = tracks[t].notes || [];
      for (let n = 0; n < notes.length; n++) {
        const note = notes[n];
        if (note.startBeat + note.durationBeats > max) max = note.startBeat + note.durationBeats;
      }
    }
    return Math.ceil(max / 4) * 4;
  }, [chordBlocks, tracks]);

  // Dibujar mapa macro completo sobre un único canvas (0 nodos DOM por nota)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(100, Math.floor(rect.width));
      const h = Math.max(48, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const pxPerBeat = w / totalBeats;
      const chordLaneH = Math.min(22, Math.floor(h * 0.34));

      // 1. Carril de Acordes
      ctx.font = '600 9px "Share Tech Mono", monospace';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < chordBlocks.length; i++) {
        const b = chordBlocks[i];
        const x = b.startBeat * pxPerBeat;
        const bw = Math.max(2, b.durationBeats * pxPerBeat - 1);
        ctx.fillStyle = 'rgba(77, 98, 125, 0.32)';
        ctx.fillRect(x, 2, bw, chordLaneH - 4);
        ctx.strokeStyle = 'rgba(130, 165, 245, 0.45)';
        ctx.strokeRect(x + 0.5, 2.5, Math.max(1, bw - 1), chordLaneH - 5);
        if (bw > 24) {
          ctx.fillStyle = '#e5ecf7';
          ctx.fillText(b.chord, x + 4, chordLaneH * 0.5);
        }
      }

      // 2. Carriles de Pistas Melódicas
      const trackAreaTop = chordLaneH + 2;
      const trackAreaH = Math.max(12, h - trackAreaTop - 2);
      const trackCount = Math.max(1, tracks.length);
      const laneH = Math.max(3, trackAreaH / trackCount);

      tracks.forEach((track: PianoRollTrack, tIdx: number) => {
        const notes = track.notes || [];
        if (notes.length === 0) return;
        const y = trackAreaTop + tIdx * laneH;
        const barH = Math.max(2, laneH - 2);
        ctx.fillStyle = track.color || '#82a5f5';
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          const nx = n.startBeat * pxPerBeat;
          const nw = Math.max(2, n.durationBeats * pxPerBeat);
          ctx.fillRect(nx, y + 1, nw, barH);
        }
      });

      ctx.restore();
    };

    draw();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    ro?.observe(container);
    return () => ro?.disconnect();
  }, [chordBlocks, tracks, totalBeats]);

  // Playhead GPU-composited sin suscripción React a currentBeat
  useEffect(() => {
    let animId = 0;

    const updatePlayhead = (beat: number) => {
      const container = containerRef.current;
      const head = playheadRef.current;
      if (!container || !head) return;
      const w = container.clientWidth || 1;
      const x = Math.min(w - 2, Math.max(0, (beat / totalBeats) * w));
      head.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    };

    if (!isPlaying) {
      updatePlayhead(useSongStore.getState().currentBeat ?? 0);
      const unsub = useSongStore.subscribe((state, prev) => {
        if (!state.isPlaying && state.currentBeat !== prev.currentBeat) {
          updatePlayhead(state.currentBeat ?? 0);
        }
      });
      return () => unsub();
    }

    const tick = () => {
      updatePlayhead(toneEngine.getLiveBeat());
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, totalBeats]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = Math.max(0, e.clientX - rect.left);
    const fraction = clickX / Math.max(1, rect.width);
    const targetBeat = Math.max(0, Math.min(totalBeats, fraction * totalBeats));
    toneEngine.seekToBeat(targetBeat);
  };

  return (
    <div className="stage-arrangement-tracker">
      <div
        ref={containerRef}
        className="stage-macro-timeline"
        onClick={handleTimelineClick}
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
        />
        <div
          ref={playheadRef}
          className={`stage-macro-playhead ${isPlaying ? 'moving' : ''}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: '2px',
            background: '#ffd875',
            pointerEvents: 'none',
            willChange: 'transform'
          }}
        />
      </div>

      <DrumChainLiveTracker />
    </div>
  );
});
