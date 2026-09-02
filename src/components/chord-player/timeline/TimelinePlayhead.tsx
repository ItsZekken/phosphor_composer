import React, { useRef, useEffect } from 'react';
import { useSongStore } from '../../../store/songStore';
import { toneEngine } from '../../../audio/toneEngine';

interface TimelinePlayheadProps {
  beatWidth: number;
}

export const TimelinePlayhead: React.FC<TimelinePlayheadProps> = React.memo(({ beatWidth }) => {
  const playheadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let animId: number;

    const updatePlayhead = () => {
      const isPlaying = useSongStore.getState().isPlaying;
      const beat = isPlaying ? toneEngine.getLiveBeat() : (useSongStore.getState().currentBeat ?? 0);
      const x = beat * beatWidth;

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
  }, [beatWidth]);

  return (
    <div 
      ref={playheadRef}
      className="playhead"
      style={{
        left: 0,
        height: '100%',
        width: '2px',
        backgroundColor: '#ffd875',
        boxShadow: '0 0 8px rgba(255, 216, 117, 0.8)',
        position: 'absolute',
        top: 0,
        zIndex: 10,
        pointerEvents: 'none',
        willChange: 'transform'
      }}
    />
  );
});
