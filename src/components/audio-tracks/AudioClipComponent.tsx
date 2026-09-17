/**
 * AudioClipComponent.tsx
 * Visualizador y manipulador no destructivo de un AudioClip individual.
 * Renderiza la forma de onda en Canvas con pirámide de picos (LOD) y provee tiradores de recorte lateral (Trim).
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Scissors, Copy, VolumeX, Volume2, Trash2 } from 'lucide-react';
import type { AudioClip, AudioTrack, AudioSnapGrid } from '../../utils/typeDefinitions';
import { useSongStore } from '../../store/songStore';
import { audioBufferRegistry } from '../../core/audio/audioBufferRegistry';
import { waveformService } from '../../core/audio/waveformService';

interface AudioClipComponentProps {
  clip: AudioClip;
  track: AudioTrack;
  zoomLevel: number; // Píxeles por beat
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}

export const AudioClipComponent: React.FC<AudioClipComponentProps> = ({
  clip,
  track,
  zoomLevel,
  isSelected,
  onSelect
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bpm = useSongStore((state) => state.bpm);
  const snapGrid = useSongStore((state) => state.audioSnapGrid);
  const currentBeat = useSongStore((state) => state.currentBeat);
  const updateAudioClip = useSongStore((state) => state.updateAudioClip);
  const splitAudioClip = useSongStore((state) => state.splitAudioClip);
  const duplicateAudioClip = useSongStore((state) => state.duplicateAudioClip);
  const toggleClipMute = useSongStore((state) => state.toggleClipMute);
  const removeAudioClip = useSongStore((state) => state.removeAudioClip);

  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Calcular dimensiones en píxeles
  const beatsPerSecond = bpm / 60;
  const clipDurationBeats = clip.durationSeconds * beatsPerSecond;
  const leftPx = clip.startBeat * zoomLevel;
  const widthPx = Math.max(12, clipDurationBeats * zoomLevel);

  // 1. Cargar o calcular picos para este clip
  useEffect(() => {
    let isMounted = true;
    const buffer = audioBufferRegistry.getBuffer(clip.bufferId);

    if (buffer) {
      waveformService.getOrGeneratePeaks(clip.bufferId, buffer).then((lodMap) => {
        if (!isMounted) return;
        // Elegir el mejor LOD según el ancho del canvas
        const bestLod = widthPx > 500 ? 64 : widthPx > 200 ? 256 : 1024;
        const targetPeaks = lodMap[bestLod] || lodMap[256] || Object.values(lodMap)[0];
        setPeaks(targetPeaks || null);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [clip.bufferId, widthPx]);

  // 2. Dibujar forma de onda en Canvas
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(widthPx);
    const h = canvas.clientHeight || 38; // Altura disponible dentro del clip adaptada al carril (64px)

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!peaks || peaks.length === 0) {
      // Indicador de carga sutil
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(0, h / 2 - 1, w, 2);
      ctx.restore();
      return;
    }

    const buffer = audioBufferRegistry.getBuffer(clip.bufferId);
    const totalBufferDuration = buffer ? buffer.duration : clip.durationSeconds;

    // Proporciones del recorte dentro del audio completo
    const startNorm = Math.max(0, clip.sourceOffsetSeconds / Math.max(0.01, totalBufferDuration));
    const endNorm = Math.min(1, (clip.sourceOffsetSeconds + clip.durationSeconds) / Math.max(0.01, totalBufferDuration));

    const totalBuckets = peaks.length / 2;
    const startBucket = Math.floor(startNorm * totalBuckets);
    const endBucket = Math.ceil(endNorm * totalBuckets);
    const visibleBuckets = Math.max(1, endBucket - startBucket);

    const midY = h / 2;
    const amp = (h / 2) * (clip.gain ?? 1.0);

    // Relleno semitransparente suave debajo de la onda
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `${track.color || '#e5a93c'}30`);
    grad.addColorStop(0.5, `${track.color || '#e5a93c'}10`);
    grad.addColorStop(1, `${track.color || '#e5a93c'}30`);
    ctx.fillStyle = grad;

    for (let x = 0; x < w; x++) {
      const bucketIdx = startBucket + Math.floor((x / w) * visibleBuckets);
      if (bucketIdx < 0 || bucketIdx >= totalBuckets) continue;

      const minVal = peaks[bucketIdx * 2];
      const maxVal = peaks[bucketIdx * 2 + 1];

      const y1 = midY + minVal * amp;
      const y2 = midY + maxVal * amp;
      const barH = Math.max(1.5, y2 - y1);
      ctx.fillRect(x, y1, 1, barH);
    }

    // Trazo nítido superior
    ctx.strokeStyle = track.color || '#e5a93c';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x < w; x++) {
      const bucketIdx = startBucket + Math.floor((x / w) * visibleBuckets);
      if (bucketIdx < 0 || bucketIdx >= totalBuckets) continue;

      const minVal = peaks[bucketIdx * 2];
      const maxVal = peaks[bucketIdx * 2 + 1];

      const y1 = midY + minVal * amp;
      const y2 = midY + maxVal * amp;

      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
    }
    ctx.stroke();

    ctx.restore();
  }, [widthPx, peaks, clip, track.color]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // 3. Helper de ajuste a la grilla (Snap)
  const snapBeat = (beat: number, grid: AudioSnapGrid): number => {
    if (grid === 'off') return Math.max(0, beat);
    let step = 1;
    if (grid === 'bar') step = 4;
    else if (grid === 'beat') step = 1;
    else if (grid === '1/2') step = 0.5;
    else if (grid === '1/4') step = 0.25;
    else if (grid === '1/8') step = 0.125;
    else if (grid === '1/16') step = 0.0625;
    return Math.max(0, Math.round(beat / step) * step);
  };

  // 4. Arrastre del cuerpo del clip (Move horizontal + Cross-track vertical)
  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).classList.contains('audio-clip-trim-handle')) return;
    if (e.button !== 0) return;
    onSelect(e);

    const startX = e.clientX;
    const initialStartBeat = clip.startBeat;
    const initialTrackId = clip.trackId;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    // Pausar Zundo durante arrastre continuo
    useSongStore.temporal.getState().pause();
    let lastUpdates: Partial<AudioClip> | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaBeat = deltaX / zoomLevel;
      const rawBeat = initialStartBeat + deltaBeat;
      const newBeat = moveEvent.altKey ? Math.max(0, rawBeat) : snapBeat(rawBeat, snapGrid);

      // Detectar carril de destino bajo el cursor
      const elements = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);
      const laneEl = elements.find((node) => (node as HTMLElement).dataset?.trackId) as HTMLElement | undefined;
      const targetTrackId = laneEl?.dataset?.trackId || initialTrackId;

      lastUpdates = { startBeat: newBeat, trackId: targetTrackId };
      updateAudioClip(clip.id, lastUpdates);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      try {
        el.releasePointerCapture(upEvent.pointerId);
      } catch (_) {}

      // Reanudar Zundo y registrar un único estado final
      useSongStore.temporal.getState().resume();
      if (lastUpdates) {
        updateAudioClip(clip.id, lastUpdates);
      }
    };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
  };

  // 5. Tirador de recorte izquierdo (Trim Start) con Snap magnético
  const handleTrimLeftDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const startX = e.clientX;
    const initialStartBeat = clip.startBeat;
    const initialDuration = clip.durationSeconds;
    const initialOffset = clip.sourceOffsetSeconds;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    useSongStore.temporal.getState().pause();
    let lastUpdates: Partial<AudioClip> | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaBeat = deltaX / zoomLevel;
      const rawTargetBeat = initialStartBeat + deltaBeat;
      const targetBeat = moveEvent.altKey ? rawTargetBeat : snapBeat(rawTargetBeat, snapGrid);
      const clampedBeat = Math.max(0, targetBeat);
      const deltaSeconds = (clampedBeat - initialStartBeat) / beatsPerSecond;

      const maxDelta = initialDuration - 0.05;
      const minDelta = -initialOffset;
      const clampedDeltaSec = Math.max(minDelta, Math.min(maxDelta, deltaSeconds));
      const clampedDeltaBeat = clampedDeltaSec * beatsPerSecond;

      lastUpdates = {
        startBeat: initialStartBeat + clampedDeltaBeat,
        sourceOffsetSeconds: initialOffset + clampedDeltaSec,
        durationSeconds: initialDuration - clampedDeltaSec
      };
      updateAudioClip(clip.id, lastUpdates);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      try {
        el.releasePointerCapture(upEvent.pointerId);
      } catch (_) {}

      useSongStore.temporal.getState().resume();
      if (lastUpdates) {
        updateAudioClip(clip.id, lastUpdates);
      }
    };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
  };

  // 6. Tirador de recorte derecho (Trim End) con Snap magnético
  const handleTrimRightDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const startX = e.clientX;
    const initialStartBeat = clip.startBeat;
    const initialDuration = clip.durationSeconds;
    const buffer = audioBufferRegistry.getBuffer(clip.bufferId);
    const maxAllowedDuration = buffer ? buffer.duration - clip.sourceOffsetSeconds : 300;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    useSongStore.temporal.getState().pause();
    let lastUpdates: Partial<AudioClip> | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaBeat = deltaX / zoomLevel;
      const currentEndBeat = initialStartBeat + initialDuration * beatsPerSecond;
      const targetEndBeat = moveEvent.altKey ? currentEndBeat + deltaBeat : snapBeat(currentEndBeat + deltaBeat, snapGrid);
      const newDurationBeats = Math.max(0.05, targetEndBeat - initialStartBeat);
      const newDurationSeconds = newDurationBeats / beatsPerSecond;

      const finalDuration = Math.max(0.05, Math.min(maxAllowedDuration, newDurationSeconds));
      lastUpdates = { durationSeconds: finalDuration };
      updateAudioClip(clip.id, lastUpdates);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      try {
        el.releasePointerCapture(upEvent.pointerId);
      } catch (_) {}

      useSongStore.temporal.getState().resume();
      if (lastUpdates) {
        updateAudioClip(clip.id, lastUpdates);
      }
    };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
  };

  // 7. Menú contextual de click derecho
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(e);
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('contextmenu', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('contextmenu', closeMenu);
    };
  }, [contextMenu]);

  return (
    <>
      <div
        className={`audio-clip ${isSelected ? 'selected' : ''} ${clip.isMuted ? 'muted' : ''}`}
        style={{
          left: leftPx,
          width: widthPx,
          borderColor: isSelected ? 'var(--accent)' : `${track.color}66`
        }}
        onPointerDown={handleBodyPointerDown}
        onContextMenu={handleContextMenu}
      >
        {/* Tirador Izquierdo de Recorte */}
        <div className="audio-clip-trim-handle left" onPointerDown={handleTrimLeftDown} title="Recortar inicio (Mantén Alt para recorte libre)" />

        {/* Cabecera del Clip */}
        <div className="audio-clip-header" style={{ background: `${track.color}22` }}>
          <span className="audio-clip-title">{clip.name}</span>
          <span>{clip.durationSeconds.toFixed(1)}s</span>
        </div>

        {/* Canvas de Forma de Onda */}
        <canvas ref={canvasRef} className="audio-clip-canvas" />

        {/* Tirador Derecho de Recorte */}
        <div className="audio-clip-trim-handle right" onPointerDown={handleTrimRightDown} title="Recortar final (Mantén Alt para recorte libre)" />
      </div>

      {/* Menú contextual flotante */}
      {contextMenu && (
        <div
          className="audio-clip-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              splitAudioClip(clip.id, currentBeat);
              setContextMenu(null);
            }}
          >
            <Scissors size={12} />
            <span>Dividir en cabezal</span>
            <span className="shortcut-hint">S</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              duplicateAudioClip(clip.id);
              setContextMenu(null);
            }}
          >
            <Copy size={12} />
            <span>Duplicar</span>
            <span className="shortcut-hint">Ctrl+D</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              toggleClipMute(clip.id);
              setContextMenu(null);
            }}
          >
            {clip.isMuted ? <Volume2 size={12} /> : <VolumeX size={12} />}
            <span>{clip.isMuted ? 'Activar sonido' : 'Silenciar clip'}</span>
            <span className="shortcut-hint">M</span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => {
              removeAudioClip(clip.id);
              setContextMenu(null);
            }}
          >
            <Trash2 size={12} />
            <span>Eliminar</span>
            <span className="shortcut-hint">Supr</span>
          </button>
        </div>
      )}
    </>
  );
};
