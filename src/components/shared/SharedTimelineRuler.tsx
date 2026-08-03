import React from 'react';
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
  chordBlocks, 
  setCurrentBeat,
  beatsPerMeasure = 4
}) => {
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickBeat = clickX / beatWidth;
    const snappedBeat = Math.round(clickBeat / 0.25) * 0.25;
    const targetBeat = Math.max(0, Math.min(TOTAL_BEATS, snappedBeat));
    setCurrentBeat(targetBeat);
    toneEngine.seekToBeat(targetBeat);
  };

  return (
    <div 
      className="piano-roll-ruler" 
      style={{ 
        width: `${canvasWidth}px`, 
        height: '42px', 
        position: 'sticky', 
        top: 0, 
        zIndex: 10,
        backgroundColor: '#121614',
        borderBottom: '2px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        userSelect: 'none',
        pointerEvents: 'auto',
        cursor: 'pointer',
        flexShrink: 0
      }}
      onClick={handleRulerClick}
    >
      <div className="ruler-chords-layer" style={{ height: '18px', position: 'relative', width: '100%', borderBottom: '1px dashed rgba(0, 229, 255, 0.1)', overflow: 'hidden' }}>
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
              backgroundColor: 'rgba(0, 229, 255, 0.04)',
              borderRight: '1px solid rgba(0, 229, 255, 0.15)',
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '0.68rem',
              color: 'var(--accent)',
              textShadow: '0 0 4px rgba(0, 229, 255, 0.3)',
              fontWeight: 'bold'
            }}
            title={`Acorde: ${block.chord}`}
          >
            {block.chord}
          </div>
        ))}
      </div>

      <div className="ruler-beats-layer" style={{ height: '24px', position: 'relative', width: '100%' }}>
        {Array.from({ length: TOTAL_BEATS }).map((_, b) => {
          const isMeasureStart = b % beatsPerMeasure === 0;
          const measureNumber = Math.floor(b / beatsPerMeasure) + 1;
          return (
            <div
              key={b}
              style={{
                position: 'absolute',
                left: `${b * beatWidth}px`,
                width: `${beatWidth}px`,
                height: '100%',
                borderLeft: isMeasureStart ? '1px solid rgba(0, 229, 255, 0.3)' : '1px solid rgba(255,255,255,0.05)',
                paddingLeft: '6px',
                paddingTop: '3px',
                display: 'flex',
                alignItems: 'baseline',
                gap: '4px',
                boxSizing: 'border-box'
              }}
            >
              {isMeasureStart ? (
                <>
                  <span style={{ fontSize: '0.72rem', fontWeight: 'bold', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-primary)' }}>
                    c.{measureNumber}
                  </span>
                  <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', fontFamily: "'Share Tech Mono', monospace" }}>
                    (b.{b})
                  </span>
                </>
              ) : (
                <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', fontFamily: "'Share Tech Mono', monospace" }}>
                  {b}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
