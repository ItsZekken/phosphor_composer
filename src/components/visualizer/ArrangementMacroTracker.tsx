import React, { useMemo, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { DrumChainLiveTracker } from './DrumChainLiveTracker';
import type { PianoRollTrack } from '../../utils/typeDefinitions';

export const ArrangementMacroTracker: React.FC = React.memo(() => {
  const chordBlocks = useSongStore((state) => state.chordBlocks);
  const tracks = useSongStore((state) => state.tracks);
  const currentBeat = useSongStore((state) => state.currentBeat);
  const isPlaying = useSongStore((state) => state.isPlaying);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Calcular longitud total en compases
  const totalBeats = useMemo(() => {
    let max = 16;
    chordBlocks.forEach((b) => {
      if (b.startBeat + b.durationBeats > max) max = b.startBeat + b.durationBeats;
    });
    tracks.forEach((t) => {
      (t.notes || []).forEach((n) => {
        if (n.startBeat + n.durationBeats > max) max = n.startBeat + n.durationBeats;
      });
    });
    return Math.ceil(max / 4) * 4;
  }, [chordBlocks, tracks]);

  // Click-to-seek en la línea de tiempo
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = Math.max(0, e.clientX - rect.left);
    const fraction = clickX / rect.width;
    const targetBeat = Math.max(0, Math.min(totalBeats, fraction * totalBeats));
    toneEngine.seekToBeat(targetBeat);
  };

  const playheadRef = useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let animId: number;

    const update = () => {
      const playing = useSongStore.getState().isPlaying;
      const beat = playing ? toneEngine.getLiveBeat() : (useSongStore.getState().currentBeat ?? 0);
      const percent = Math.min(100, Math.max(0, (beat / totalBeats) * 100));

      if (playheadRef.current) {
        playheadRef.current.style.left = `${percent}%`;
      }

      if (playing) {
        animId = requestAnimationFrame(update);
      }
    };

    update();
    if (isPlaying) {
      animId = requestAnimationFrame(update);
    }

    return () => cancelAnimationFrame(animId);
  }, [isPlaying, totalBeats, currentBeat]);

  return (
    <div className="stage-arrangement-tracker">
      {/* Contenedor interactivo del Macro Timeline */}
      <div
        ref={containerRef}
        className="stage-macro-timeline"
        onClick={handleTimelineClick}
      >
        {/* Cursor / Playhead de reproducción */}
        <div
          ref={playheadRef}
          className={`stage-macro-playhead ${isPlaying ? 'moving' : ''}`}
          style={{ left: `${Math.min(100, Math.max(0, (currentBeat / totalBeats) * 100))}%` }}
        />

        {/* 1. Carril de Acordes (Armonía) */}
        <div className="stage-chord-macro-lane">
          {chordBlocks.map((block) => {
            const leftPercent = (block.startBeat / totalBeats) * 100;
            const widthPercent = (block.durationBeats / totalBeats) * 100;
            const isActive = currentBeat >= block.startBeat && currentBeat < block.startBeat + block.durationBeats;

            // Progreso interno dentro del acorde
            const innerProgress = isActive
              ? ((currentBeat - block.startBeat) / block.durationBeats) * 100
              : 0;

            return (
              <div
                key={block.id}
                className={`stage-macro-chord-block ${isActive ? 'active' : ''}`}
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`
                }}
              >
                {/* Relleno animado de progreso */}
                {isActive && (
                  <div
                    className="stage-chord-progress-fill"
                    style={{ width: `${innerProgress}%` }}
                  />
                )}
                <span className="stage-macro-chord-name">{block.chord}</span>
              </div>
            );
          })}
        </div>

        {/* 2. Carriles de Pistas Melódicas (Piano Roll) */}
        <div className="stage-tracks-macro-container">
          {tracks.map((track: PianoRollTrack) => (
            <div key={track.id} className="stage-macro-track-lane">
              {(track.notes || []).map((n) => {
                const leftPercent = (n.startBeat / totalBeats) * 100;
                const widthPercent = Math.max(0.6, (n.durationBeats / totalBeats) * 100);
                const isNoteActive = currentBeat >= n.startBeat && currentBeat <= n.startBeat + n.durationBeats;

                return (
                  <span
                    key={n.id}
                    className={`stage-macro-note-pill ${isNoteActive ? 'active' : ''}`}
                    style={{
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                      backgroundColor: track.color || '#82a5f5',
                      boxShadow: isNoteActive ? `0 0 6px ${track.color || '#82a5f5'}` : undefined
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 3. Tracker de Batería en Vivo */}
      <DrumChainLiveTracker />
    </div>
  );
});
