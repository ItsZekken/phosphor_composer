/**
 * AudioPlayhead.tsx
 * Cabezal de reproducción animado a 60 FPS con precisión de muestra.
 * Utiliza translate3d directo en el DOM y requestAnimationFrame sincronizado con Tone.js AudioContext,
 * eliminando re-renderizados innecesarios del árbol de React durante la reproducción y el scrubbing.
 */

import React, { useRef, useEffect } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';

interface AudioPlayheadProps {
  zoomLevel: number; // Píxeles por beat
  height?: number | string;
}

export const AudioPlayhead: React.FC<AudioPlayheadProps> = React.memo(({ zoomLevel, height = '100%' }) => {
  const playheadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let animId: number;

    const updatePlayhead = () => {
      const isPlaying = useSongStore.getState().isPlaying;
      const beat = isPlaying ? toneEngine.getLiveBeat() : (useSongStore.getState().currentBeat ?? 0);
      const x = beat * zoomLevel;

      if (playheadRef.current) {
        playheadRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
      }

      if (isPlaying) {
        animId = requestAnimationFrame(updatePlayhead);
      }
    };

    let prevBeat = useSongStore.getState().currentBeat;
    let prevIsPlaying = useSongStore.getState().isPlaying;

    const unsub = useSongStore.subscribe((state) => {
      if (state.currentBeat !== prevBeat || state.isPlaying !== prevIsPlaying) {
        const wasPlaying = prevIsPlaying;
        prevBeat = state.currentBeat;
        prevIsPlaying = state.isPlaying;

        updatePlayhead();
        if (state.isPlaying && !wasPlaying) {
          cancelAnimationFrame(animId);
          animId = requestAnimationFrame(updatePlayhead);
        }
      }
    });

    updatePlayhead();
    if (useSongStore.getState().isPlaying) {
      animId = requestAnimationFrame(updatePlayhead);
    }

    return () => {
      unsub();
      cancelAnimationFrame(animId);
    };
  }, [zoomLevel]);

  return (
    <div
      ref={playheadRef}
      className="audio-playhead-wrapper"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        height,
        zIndex: 25,
        pointerEvents: 'none',
        willChange: 'transform'
      }}
    >
      {/* Cabezal tipo puntero de hardware sobre la regla */}
      <div className="audio-playhead-cap" />
      {/* Haz luminoso vertical que atraviesa las pistas */}
      <div className="audio-playhead-beam" />
    </div>
  );
});
