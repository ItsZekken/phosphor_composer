/**
 * PatternMiniPreview.tsx
 * Renderizador ligero en Canvas 2D de miniaturas de notas MIDI (Piano Roll) y pasos de batería (Drum Sequencer)
 * para las tarjetas del Pattern Picker y los bloques de patrones en la Playlist estilo FL Studio.
 */

import React, { useRef, useEffect } from 'react';
import type { DrumChannel, MelodyNote } from '../../utils/typeDefinitions';

interface MelodyMiniPreviewProps {
  kind: 'melody';
  notes: MelodyNote[];
  patternLengthBeats: number;
  durationBeats: number;
  offsetBeats?: number;
  color: string;
  width: number;
  height: number;
  showLoopMarkers?: boolean;
}

interface DrumMiniPreviewProps {
  kind: 'drums';
  drumChannels: DrumChannel[];
  patternIndex: number;
  patternSteps: number;
  beatsPerMeasure: number;
  durationBeats: number;
  offsetBeats?: number;
  color: string;
  width: number;
  height: number;
  showLoopMarkers?: boolean;
}

export type PatternMiniPreviewProps = MelodyMiniPreviewProps | DrumMiniPreviewProps;

export const PatternMiniPreview: React.FC<PatternMiniPreviewProps> = React.memo((props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = Math.max(8, Math.floor(props.width));
    const h = Math.max(8, Math.floor(props.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const dur = Math.max(0.25, props.durationBeats);
    const offset = Math.max(0, props.offsetBeats || 0);
    const winStart = offset;
    const winEnd = offset + dur;
    const pxPerBeat = w / dur;

    if (props.kind === 'melody') {
      const notes = props.notes || [];
      const patLen = Math.max(0.25, props.patternLengthBeats);

      // Divisores de bucle si el clip repite el patrón
      if (props.showLoopMarkers && dur > patLen + 0.01) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        const firstMarkerCycle = Math.floor(winStart / patLen) + 1;
        for (let c = firstMarkerCycle; c * patLen < winEnd - 0.01; c++) {
          const x = Math.round((c * patLen - winStart) * pxPerBeat) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (notes.length === 0) {
        // Línea guía sutil cuando el patrón aún está vacío
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(4, Math.floor(h / 2), Math.max(0, w - 8), 1);
        return;
      }

      let minMidi = Infinity;
      let maxMidi = -Infinity;
      for (let i = 0; i < notes.length; i++) {
        const m = notes[i].midi;
        if (m < minMidi) minMidi = m;
        if (m > maxMidi) maxMidi = m;
      }

      const span = Math.max(8, maxMidi - minMidi + 2);
      const centerMidi = (minMidi + maxMidi) / 2;
      const topMidi = centerMidi + span / 2;
      const padY = 3;
      const usableH = Math.max(4, h - padY * 2);
      const noteH = Math.max(2, Math.min(4.5, usableH / Math.min(span, 12)));

      const firstCycle = Math.floor(winStart / patLen);
      const lastCycle = Math.floor((winEnd - 1e-6) / patLen);

      ctx.fillStyle = props.color || '#a78bfa';

      for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
        const cycleBase = cycle * patLen;
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          if (n.startBeat >= patLen - 1e-6) continue;
          const localStart = cycleBase + n.startBeat;
          const localEnd = Math.min(winEnd, localStart + n.durationBeats);
          if (localEnd <= winStart || localStart >= winEnd) continue;

          const clippedStart = Math.max(winStart, localStart);
          const x = (clippedStart - winStart) * pxPerBeat;
          const nw = Math.max(2, (localEnd - clippedStart) * pxPerBeat - 0.5);
          const normY = (topMidi - n.midi) / span;
          const y = padY + normY * (usableH - noteH);

          ctx.globalAlpha = 0.65 + (n.velocity ?? 0.8) * 0.35;
          ctx.fillRect(x, y, nw, noteH);
        }
      }
      ctx.globalAlpha = 1;
      return;
    }

    // --- DRUMS ---
    const patLen = Math.max(1, props.beatsPerMeasure || 4);
    const stepsCount = Math.max(4, props.patternSteps || 16);
    const stepDur = patLen / stepsCount;

    if (props.showLoopMarkers && dur > patLen + 0.01) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      const firstMarkerCycle = Math.floor(winStart / patLen) + 1;
      for (let c = firstMarkerCycle; c * patLen < winEnd - 0.01; c++) {
        const x = Math.round((c * patLen - winStart) * pxPerBeat) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.restore();
    }

    const channels = (props.drumChannels || []).slice(0, 6);
    const activeChannels = channels.filter((ch) => {
      const steps = ch.patterns?.[props.patternIndex];
      return steps && steps.some((s, idx) => idx < stepsCount && s?.isActive);
    });

    if (activeChannels.length === 0) {
      // Marcadores discretos de rejilla para patrón vacío
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      const tickCount = Math.min(16, Math.max(4, Math.floor(w / 10)));
      for (let i = 0; i < tickCount; i++) {
        const x = (i / tickCount) * w + 2;
        ctx.fillRect(x, h - 5, 2, 2);
      }
      return;
    }

    const rowCount = Math.max(1, activeChannels.length);
    const padY = 3;
    const usableH = Math.max(4, h - padY * 2);
    const rowStep = usableH / rowCount;
    const barH = Math.max(2, Math.min(4, rowStep - 1.5));

    const firstCycle = Math.floor(winStart / patLen);
    const lastCycle = Math.floor((winEnd - 1e-6) / patLen);
    const stepW = Math.max(2, Math.min(8, stepDur * pxPerBeat * 0.72));

    for (let r = 0; r < activeChannels.length; r++) {
      const ch = activeChannels[r];
      const steps = ch.patterns?.[props.patternIndex] || [];
      const y = padY + r * rowStep + (rowStep - barH) / 2;

      ctx.fillStyle = r === 0 ? props.color : r === 1 ? '#ffd875' : 'rgba(226, 232, 240, 0.85)';

      for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
        const cycleBase = cycle * patLen;
        for (let s = 0; s < Math.min(stepsCount, steps.length); s++) {
          const st = steps[s];
          if (!st?.isActive) continue;
          const localStart = cycleBase + s * stepDur;
          if (localStart < winStart - 1e-6 || localStart >= winEnd - 1e-6) continue;

          const x = (localStart - winStart) * pxPerBeat;
          ctx.globalAlpha = 0.55 + (st.velocity ?? 0.8) * 0.45;
          ctx.fillRect(x, y, stepW, barH);
        }
      }
    }
    ctx.globalAlpha = 1;
  }, [props]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${Math.max(8, Math.floor(props.width))}px`,
        height: `${Math.max(8, Math.floor(props.height))}px`,
        display: 'block',
        pointerEvents: 'none'
      }}
    />
  );
});
