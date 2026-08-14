import React, { useRef, useEffect } from 'react';
import { useVisualizerAudioData } from './hooks/useVisualizerAudioData';
import type { VisualizerMode } from './StageTelemetryHUD';

interface MasterAudioVisualizerProps {
  mode: VisualizerMode;
}

export const MasterAudioVisualizer: React.FC<MasterAudioVisualizerProps> = React.memo(({ mode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { getAudioFrame } = useVisualizerAudioData();

  // Peak hold array para el modo Spectrum
  const peaksRef = useRef<number[]>(new Array(64).fill(0));
  const peakDecayRef = useRef<number[]>(new Array(64).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const { width, height } = canvas;
      if (width === 0 || height === 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      const frame = getAudioFrame();

      // Fondo oscuro con efecto phosphor decay
      ctx.fillStyle = mode === 'oscilloscope' ? 'rgba(15, 12, 20, 0.28)' : '#100d16';
      ctx.fillRect(0, 0, width, height);

      // Renderizar según modo
      if (mode === 'oscilloscope') {
        drawOscilloscope(ctx, width, height, frame.waveform);
      } else if (mode === 'spectrum') {
        drawSpectrum(ctx, width, height, frame.frequency, peaksRef.current, peakDecayRef.current);
      } else if (mode === 'lissajous') {
        drawLissajous(ctx, width, height, frame.waveform);
      }

      // Dibujar medidores laterales VU estéreo en miniatura
      drawSideMeters(ctx, width, height, frame.masterLevel);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [mode, getAudioFrame]);

  // Manejo de resize con DPI Retina
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
    <div className="master-visualizer-card">
      <canvas ref={canvasRef} className="master-visualizer-canvas" />
    </div>
  );
});

/* =========================================================================
   FUNCIONES DE DIBUJO OPTIMIZADAS A 60 FPS
   ========================================================================= */

function drawOscilloscope(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  waveform: Float32Array
) {
  const centerY = height / 2;

  // Cuadrícula sutil de referencia retro (sin texto)
  ctx.strokeStyle = 'rgba(80, 70, 110, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();

  // Haz de fósforo principal
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#5a9e7a';
  ctx.shadowColor = '#5a9e7a';
  ctx.shadowBlur = 10;

  ctx.beginPath();
  const sliceWidth = width / waveform.length;
  let x = 0;

  for (let i = 0; i < waveform.length; i++) {
    const v = waveform[i];
    // Escalar la amplitud suavemente
    const y = centerY + v * (height * 0.42);

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x += sliceWidth;
  }

  ctx.stroke();

  // Haz brillante interno central (blanco/cian)
  ctx.lineWidth = 1.0;
  ctx.strokeStyle = '#bbf5d8';
  ctx.shadowBlur = 0;
  ctx.stroke();
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frequency: Float32Array,
  peaks: number[],
  peakDecays: number[]
) {
  const numBars = Math.min(36, frequency.length);
  const padding = 2;
  const usableWidth = width - 40; // Espacio para márgenes
  const barWidth = (usableWidth / numBars) - padding;
  const startX = 20;

  // Gradiente retro cyberpunk para las barras
  const gradient = ctx.createLinearGradient(0, height - 10, 0, 10);
  gradient.addColorStop(0, '#5072a8');
  gradient.addColorStop(0.5, '#5a9e7a');
  gradient.addColorStop(0.85, '#b09040');
  gradient.addColorStop(1, '#e88c42');

  ctx.shadowBlur = 0;

  for (let i = 0; i < numBars; i++) {
    // Escalar dB a altura de barra (Tone.js frequency entrega dB de -100 a 0 aprox)
    const valDb = frequency[i];
    const norm = Math.max(0, Math.min(1, (valDb + 90) / 90));
    const barHeight = norm * (height - 24);

    const x = startX + i * (barWidth + padding);
    const y = height - 10 - barHeight;

    // Barra de ecualizador
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth, barHeight);

    // Peak hold line
    if (barHeight > (peaks[i] || 0)) {
      peaks[i] = barHeight;
      peakDecays[i] = 0;
    } else {
      peakDecays[i] = (peakDecays[i] || 0) + 0.5;
      peaks[i] = Math.max(0, (peaks[i] || 0) - peakDecays[i]);
    }

    const peakY = height - 10 - peaks[i];
    ctx.fillStyle = '#f0e6ff';
    ctx.fillRect(x, peakY, barWidth, 2);
  }
}

function drawLissajous(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  waveform: Float32Array
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.38;

  // Círculo base de referencia
  ctx.strokeStyle = 'rgba(112, 96, 176, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Órbita de fase estéreo
  ctx.strokeStyle = '#82a5f5';
  ctx.shadowColor = '#82a5f5';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 1.8;

  ctx.beginPath();
  const len = waveform.length;
  for (let i = 0; i < len; i++) {
    const angle = (i / len) * Math.PI * 2;
    const waveOffset = waveform[i] * (radius * 0.5);
    const r = radius + waveOffset;

    const x = centerX + Math.cos(angle) * r;
    const y = centerY + Math.sin(angle) * r;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.stroke();

  // Núcleo brillante
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSideMeters(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  masterLevel: number
) {
  const meterWidth = 4;
  const meterHeight = height - 20;
  const meterY = 10;

  const leftX = 8;
  const rightX = width - 12;

  // Fondo del medidor
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(leftX, meterY, meterWidth, meterHeight);
  ctx.fillRect(rightX, meterY, meterWidth, meterHeight);

  // Relleno activo
  const fillH = masterLevel * meterHeight;
  const fillY = meterY + (meterHeight - fillH);

  // Color reactivo: Verde -> Amarillo -> Rojo si clipea
  let meterColor = '#5a9e7a';
  if (masterLevel > 0.85) meterColor = '#e88c42';
  if (masterLevel > 0.96) meterColor = '#e04060';

  ctx.fillStyle = meterColor;
  ctx.shadowColor = meterColor;
  ctx.shadowBlur = masterLevel > 0.8 ? 6 : 0;

  ctx.fillRect(leftX, fillY, meterWidth, fillH);
  ctx.fillRect(rightX, fillY, meterWidth, fillH);
  ctx.shadowBlur = 0;
}
