import React, { useRef, useEffect } from 'react';
import { useSongStore } from '../../store/songStore';
import { useStageTimelineNotes } from './hooks/useStageTimelineNotes';
import type { StageRenderNote } from './hooks/useStageTimelineNotes';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  size: number;
  decay: number;
}

export const MidiWaterfallCanvas: React.FC = React.memo(() => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { notes } = useStageTimelineNotes();
  const notesRef = useRef<StageRenderNote[]>(notes);
  notesRef.current = notes;

  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animId: number;

    // Rango MIDI visible (C1: 24 a C8: 108 -> 84 notas)
    const minMidi = 24;
    const maxMidi = 108;
    const totalPitches = maxMidi - minMidi + 1;

    // Beats visibles antes del horizonte (cuántos beats caen por pantalla)
    const lookAheadBeats = 6;
    const lookBehindBeats = 1.5;

    const render = () => {
      const { width, height } = canvas;
      if (width === 0 || height === 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      // Fondo oscuro
      ctx.fillStyle = '#14111a';
      ctx.fillRect(0, 0, width, height);

      const currentBeat = useSongStore.getState().currentBeat;
      const isPlaying = useSongStore.getState().isPlaying;

      const impactY = height - 28; // Línea base de impacto
      const noteSpeed = (impactY - 20) / lookAheadBeats; // Píxeles por beat
      const keyWidth = width / totalPitches;

      // 1. Dibujar líneas verticales tenues de las teclas (rejilla de pitch)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1;
      for (let m = minMidi; m <= maxMidi; m++) {
        const isOctaveC = m % 12 === 0;
        if (isOctaveC) {
          ctx.strokeStyle = 'rgba(130, 165, 245, 0.08)';
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        }
        const x = (m - minMidi) * keyWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, impactY);
        ctx.stroke();
      }

      // 2. Dibujar horizonte de impacto
      ctx.strokeStyle = 'rgba(130, 165, 245, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, impactY);
      ctx.lineTo(width, impactY);
      ctx.stroke();

      // 3. Filtrar y dibujar notas visibles
      const visibleMinBeat = currentBeat - lookBehindBeats;
      const visibleMaxBeat = currentBeat + lookAheadBeats;

      const currentNotes = notesRef.current;
      const activeStrikes: { x: number; color: string; width: number }[] = [];

      for (let i = 0; i < currentNotes.length; i++) {
        const note = currentNotes[i];
        const noteEndBeat = note.startBeat + note.durationBeats;

        // Descartar notas fuera de la ventana
        if (noteEndBeat < visibleMinBeat || note.startBeat > visibleMaxBeat) continue;

        // Calcular posición X
        const clampedMidi = Math.max(minMidi, Math.min(maxMidi, note.midi));
        const noteX = (clampedMidi - minMidi) * keyWidth + 1;
        const noteW = Math.max(4, keyWidth - 2);

        // Calcular posición Y (la nota cae de arriba hacia impactY)
        // Cuando currentBeat == note.startBeat, la parte inferior de la nota está en impactY
        const beatsFromImpactHead = note.startBeat - currentBeat;
        const beatsFromImpactTail = noteEndBeat - currentBeat;

        const bottomY = impactY - beatsFromImpactHead * noteSpeed;
        const topY = impactY - beatsFromImpactTail * noteSpeed;

        const noteH = Math.max(6, bottomY - topY);

        // Está activa en este instante?
        const isActive = currentBeat >= note.startBeat && currentBeat <= noteEndBeat;

        // Estilo de la nota
        ctx.fillStyle = note.color;
        ctx.shadowColor = note.color;
        ctx.shadowBlur = isActive ? 14 : 4;

        // Dibujar bloque de nota con bordes suaves
        ctx.beginPath();
        ctx.roundRect(noteX, topY, noteW, noteH, 3);
        ctx.fill();

        // Si está activa, registrar para destello y partículas
        if (isActive && isPlaying) {
          activeStrikes.push({ x: noteX + noteW / 2, color: note.color, width: noteW });

          // Emitir partículas ocasionales
          if (Math.random() < 0.3) {
            particlesRef.current.push({
              x: noteX + noteW / 2 + (Math.random() - 0.5) * noteW,
              y: impactY,
              vx: (Math.random() - 0.5) * 3,
              vy: -Math.random() * 3 - 1,
              color: note.color,
              alpha: 1.0,
              size: Math.random() * 2.5 + 1.5,
              decay: 0.04 + Math.random() * 0.04
            });
          }
        }
      }

      ctx.shadowBlur = 0;

      // 4. Dibujar destellos de impacto en el horizonte
      for (const strike of activeStrikes) {
        // Resplandor en la base
        const grad = ctx.createRadialGradient(
          strike.x, impactY, 0,
          strike.x, impactY, strike.width * 3
        );
        grad.addColorStop(0, strike.color);
        grad.addColorStop(1, 'transparent');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(strike.x, impactY, strike.width * 3, 0, Math.PI * 2);
        ctx.fill();

        // Destello brillante blanco central
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(strike.x - strike.width / 2, impactY - 2, strike.width, 4);
      }

      // 5. Renderizar y actualizar partículas
      const particles = particlesRef.current;
      for (let p = particles.length - 1; p >= 0; p--) {
        const pt = particles[p];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.alpha -= pt.decay;

        if (pt.alpha <= 0) {
          particles.splice(p, 1);
          continue;
        }

        ctx.globalAlpha = pt.alpha;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;

      // 6. Mini teclado / LEDs en el fondo inferior
      const kbY = height - 20;
      const kbH = 16;
      ctx.fillStyle = '#0f0c14';
      ctx.fillRect(0, kbY, width, kbH);

      for (let m = minMidi; m <= maxMidi; m++) {
        const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
        const x = (m - minMidi) * keyWidth;

        // Comprobar si esta nota está activa
        const isKeyActive = activeStrikes.some((s) => Math.abs(s.x - (x + keyWidth / 2)) < keyWidth);

        if (isKeyActive) {
          ctx.fillStyle = '#bbf5d8';
          ctx.shadowColor = '#5a9e7a';
          ctx.shadowBlur = 8;
        } else {
          ctx.fillStyle = isBlack ? '#1a1622' : '#2b2438';
          ctx.shadowBlur = 0;
        }

        ctx.fillRect(x + 0.5, kbY, keyWidth - 1, kbH);
      }
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // ResizeObserver con DPR
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

  return (
    <div className="midi-waterfall-card">
      <canvas ref={canvasRef} className="midi-waterfall-canvas" />
    </div>
  );
});
