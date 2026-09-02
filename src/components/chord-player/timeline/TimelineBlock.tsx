import React from 'react';
import type { ChordBlock, NoteClass, ScaleType } from '../../../utils/typeDefinitions';
import { isChordInScale, getChordRomanDegree } from '../../../core/music';
import { getChordRole } from '../ChordPalette';

interface TimelineBlockProps {
  block: ChordBlock;
  isSelected: boolean;
  isDragging: boolean;
  startBeat: number;
  durationBeats: number;
  beatWidth: number;
  currentKey: NoteClass;
  scale: ScaleType;
  onMouseDown: (e: React.MouseEvent, block: ChordBlock) => void;
  onContextMenu: (e: React.MouseEvent, block: ChordBlock) => void;
  onDoubleClick?: (e: React.MouseEvent, block: ChordBlock) => void;
}

export const TimelineBlock: React.FC<TimelineBlockProps> = React.memo(({
  block,
  isSelected,
  isDragging,
  startBeat,
  durationBeats,
  beatWidth,
  currentKey,
  scale,
  onMouseDown,
  onContextMenu,
  onDoubleClick
}) => {
  const left = startBeat * beatWidth;
  const width = durationBeats * beatWidth;

  const isDiad = isChordInScale(block.chord, currentKey, scale);
  const romanDegree = isDiad ? getChordRomanDegree(block.chord, currentKey, scale) : '';
  const role = getChordRole(block.chord, currentKey, scale);
  const inScale = isDiad;

  const blockWidth = Math.max(14, width - 4);
  const isCompact = blockWidth < 50;
  const isMicro = blockWidth < 28;
  const fontSize = isMicro ? '0.65rem' : isCompact ? '0.78rem' : '0.95rem';

  return (
    <div
      className={`chord-block ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: '24px',
        width: `${blockWidth}px`,
        height: '52px',
        zIndex: isSelected || isDragging ? 10 : 3,
        cursor: isDragging ? 'grabbing' : 'grab',
        padding: isMicro ? '0.2rem 2px' : isCompact ? '0.25rem 4px' : '0.4rem 0.6rem',
        overflow: 'hidden'
      }}
      onMouseDown={(e) => onMouseDown(e, block)}
      onContextMenu={(e) => onContextMenu(e, block)}
      onDoubleClick={(e) => onDoubleClick?.(e, block)}
      title={`${block.chord} (${durationBeats} beats)${romanDegree ? ` · Grado ${romanDegree}` : ''}`}
    >
      {/* Tirador de Resize Izquierdo */}
      <div 
        className="resize-handle left"
        title="Arrastra para ajustar el inicio del acorde"
      />

      <div 
        className="block-content-only"
        style={{
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: isMicro ? 'center' : 'flex-start'
        }}
      >
        <span 
          className="block-name" 
          style={{ 
            fontSize, 
            fontWeight: 700,
            width: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: isMicro ? 'center' : 'left'
          }}
        >
          {block.chord}
          {!inScale && !isMicro && (
            <span 
              className="out-of-scale-warning" 
              title="Este acorde contiene notas fuera de la escala actual"
              style={{ marginLeft: '2px', cursor: 'help', fontSize: '0.6rem' }}
            >
              ⚠️
            </span>
          )}
        </span>
        
        {!isCompact && (
          <span 
            className="block-duration-label" 
            style={{ 
              fontSize: '0.62rem', 
              opacity: 0.85,
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {romanDegree ? romanDegree : `${durationBeats} ${durationBeats === 1 ? 'beat' : 'beats'}`}
          </span>
        )}
      </div>

      {/* Barrita de color del rol armónico en la base */}
      <div 
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '3px',
          backgroundColor: `var(--role-${role})`,
          opacity: 0.95
        }}
      />
      
      {/* Tirador de Resize Derecho */}
      <div 
        className="resize-handle right"
        title="Arrastra para ajustar la duración del acorde"
      />
    </div>
  );
});
