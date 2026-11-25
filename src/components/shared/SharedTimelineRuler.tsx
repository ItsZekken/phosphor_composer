import React, { useRef, useEffect, useCallback } from 'react';
import { toneEngine } from '../../audio/toneEngine';

interface SharedTimelineRulerProps {
  TOTAL_BEATS: number;
  beatWidth: number;
  canvasWidth: number;
  chordBlocks: any[];
  setCurrentBeat: (beat: number) => void;
  beatsPerMeasure?: number;
}

export const SharedTimelineRuler: React.FC<SharedTimelineRulerProps> = React.memo(({ 
  TOTAL_BEATS, 
  beatWidth, 
  canvasWidth, 
  chordBlocks = [], 
  setCurrentBeat,
  beatsPerMeasure = 4
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isScrubbingRef = useRef(false);

  const drawRuler = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvasWidth;
    const height = 22;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.textBaseline = 'middle';

    for (let b = 0; b <= TOTAL_BEATS; b++) {
      const isMeasureStart = b % beatsPerMeasure === 0;
      const x = b * beatWidth;

      if (isMeasureStart) {
        const measureNumber = Math.floor(b / beatsPerMeasure) + 1;

        // Línea principal de compás
        ctx.strokeStyle = 'rgba(255, 216, 117, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();

        // Número de compás c.${bar}
        ctx.font = 'bold 10px "Share Tech Mono", monospace';
        ctx.fillStyle = '#ffd875';
        ctx.fillText(`c.${measureNumber}`, x + 4, 11);
        const mWidth = ctx.measureText(`c.${measureNumber}`).width;

        // Pulso inicial (b.${beat})
        if (beatWidth >= 24) {
          ctx.font = '9px "Share Tech Mono", monospace';
          ctx.fillStyle = 'rgba(255, 216, 117, 0.55)';
          ctx.fillText(`(b.${b})`, x + 4 + mWidth + 4, 11);
        }
      } else {
        // Línea de pulso intermedia
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 8);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();

        // Número de pulso
        if (beatWidth >= 16) {
          ctx.font = '9px "Share Tech Mono", monospace';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.fillText(`${b}`, x + 4, 11);
        }
      }
    }

    ctx.restore();
  }, [canvasWidth, TOTAL_BEATS, beatWidth, beatsPerMeasure]);

  useEffect(() => {
    drawRuler();
  }, [drawRuler]);

  const updateBeatFromPointer = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickBeat = clickX / beatWidth;
    const snappedBeat = Math.round(clickBeat / 0.25) * 0.25;
    const targetBeat = Math.max(0, Math.min(TOTAL_BEATS, snappedBeat));
    setCurrentBeat(targetBeat);
    toneEngine.seekToBeat(targetBeat);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isScrubbingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateBeatFromPointer(e.clientX, e.currentTarget);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return;
    updateBeatFromPointer(e.clientX, e.currentTarget);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  return (
    <div 
      className="piano-roll-ruler" 
      style={{ 
        width: `${canvasWidth}px`, 
        height: '42px', 
        minHeight: '42px',
        maxHeight: '42px',
        boxSizing: 'border-box',
        position: 'sticky', 
        top: 0, 
        zIndex: 10,
        backgroundColor: '#1c1924',
        borderBottom: '2px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        userSelect: 'none',
        pointerEvents: 'auto',
        cursor: 'pointer',
        flexShrink: 0
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Carril Superior de Bloques de Acordes (20px) */}
      <div 
        className="ruler-chords-layer" 
        style={{ 
          height: '20px', 
          position: 'relative', 
          width: '100%', 
          borderBottom: '1px solid rgba(255, 216, 117, 0.2)', 
          overflow: 'hidden' 
        }}
      >
        {chordBlocks.map((block) => (
          <div
            key={block.id}
            className="ruler-chord-block"
            style={{
              position: 'absolute',
              left: `${block.startBeat * beatWidth}px`,
              width: `${block.durationBeats * beatWidth}px`,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(132, 112, 204, 0.22)',
              borderRight: '1px solid rgba(255, 216, 117, 0.65)',
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '0.68rem',
              color: '#ffd875',
              fontWeight: 'bold',
              boxSizing: 'border-box'
            }}
            title={`Acorde: ${block.chord}`}
          >
            {block.chord}
          </div>
        ))}
      </div>

      {/* Carril Inferior de Compases y Pulsos en Canvas (22px) */}
      <div 
        className="ruler-beats-layer" 
        style={{ 
          height: '22px', 
          position: 'relative', 
          width: '100%',
          overflow: 'hidden'
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ 
            width: `${canvasWidth}px`, 
            height: '22px', 
            display: 'block' 
          }}
        />
      </div>
    </div>
  );
});
