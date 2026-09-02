import React, { useState, useRef, useEffect } from 'react';
import { useSongStore } from '../../../store/songStore';
import type { StyleMarker, TempoMarker } from '../../../utils/typeDefinitions';
import { CustomSelect } from '../../ui/CustomSelect';
import type { SelectGroup } from '../../ui/CustomSelect';

export interface DragMarkerState {
  id: string;
  type: string;
  startX: number;
  initialStartBeat: number;
  initialDurationBeats: number;
  currentStartBeat: number;
  currentDurationBeats: number;
}

interface TimelineMarkerTrackProps {
  styleMarkers: StyleMarker[];
  styleGroups: SelectGroup[];
  tempoMarkers: TempoMarker[];
  beatWidth: number;
  snapStep: number;
  activeDrag: DragMarkerState | null;
  setActiveDrag: React.Dispatch<React.SetStateAction<any>>;
  updateStyleMarker: (id: string, updates: Partial<StyleMarker>) => void;
  removeStyleMarker: (id: string) => void;
  addStyleMarker: (marker: StyleMarker) => void;
  updateTempoMarker: (id: string, updates: Partial<TempoMarker>) => void;
  removeTempoMarker: (id: string) => void;
}

export const TimelineMarkerTrack: React.FC<TimelineMarkerTrackProps> = React.memo(({
  styleMarkers = [],
  styleGroups = [],
  tempoMarkers = [],
  beatWidth,
  snapStep,
  activeDrag,
  setActiveDrag,
  updateStyleMarker,
  removeStyleMarker,
  addStyleMarker,
  updateTempoMarker,
  removeTempoMarker,
}) => {
  const [editingTempoId, setEditingTempoId] = useState<string | null>(null);
  const [editingBpmValue, setEditingBpmValue] = useState<string>('120');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingTempoId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTempoId]);

  const commitBpmEdit = (id: string) => {
    const val = parseInt(editingBpmValue, 10);
    if (!isNaN(val) && val >= 30 && val <= 360) {
      updateTempoMarker(id, { bpm: val });
    }
    setEditingTempoId(null);
  };

  return (
    <div
      className="style-markers-ruler"
      style={{
        position: 'absolute',
        top: '0px',
        left: 0,
        right: 0,
        height: '24px',
        background: 'rgba(10, 7, 16, 0.75)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        zIndex: 15,
        cursor: 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }}
      title="Regla de Marcadores: Clic derecho en el canvas para agregar marcadores de tempo"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const stylePattern = e.dataTransfer.getData('text/style-pattern') || useSongStore.getState().draggingStyle;
        if (stylePattern) {
          const canvasRect = e.currentTarget.getBoundingClientRect();
          const dropX = e.clientX - canvasRect.left;
          const dropBeat = Math.max(0, Math.round((dropX / beatWidth) / snapStep) * snapStep);
          const existing = styleMarkers.find(m => Math.abs(m.beat - dropBeat) < 0.001);
          if (!existing) {
            addStyleMarker({ id: Math.random().toString(36).substr(2, 9), beat: dropBeat, pattern: stylePattern });
          } else {
            updateStyleMarker(existing.id, { pattern: stylePattern });
          }
          useSongStore.getState().setDraggingStyle(null);
        }
      }}
      onMouseUp={(e) => {
        const { draggingStyle, setDraggingStyle } = useSongStore.getState();
        if (draggingStyle) {
          const canvasRect = e.currentTarget.getBoundingClientRect();
          const dropX = e.clientX - canvasRect.left;
          const dropBeat = Math.max(0, Math.round((dropX / beatWidth) / snapStep) * snapStep);
          const existing = styleMarkers.find(m => Math.abs(m.beat - dropBeat) < 0.001);
          if (!existing) {
            addStyleMarker({ id: Math.random().toString(36).substr(2, 9), beat: dropBeat, pattern: draggingStyle });
          } else {
            updateStyleMarker(existing.id, { pattern: draggingStyle });
          }
          setDraggingStyle(null);
        }
      }}
    >
      {/* 1. Marcadores de Tempo (BPM) */}
      {tempoMarkers.map((marker) => {
        const markerLeft = marker.beat * beatWidth;
        const isDragging = activeDrag?.id === marker.id && activeDrag?.type === 'move_tempo_marker';
        const displayLeft = isDragging ? activeDrag.currentStartBeat * beatWidth : markerLeft;
        const isEditing = editingTempoId === marker.id;

        return (
          <div
            key={`tempo-${marker.id}`}
            style={{
              position: 'absolute',
              left: `${displayLeft}px`,
              top: '2px',
              zIndex: 20
            }}
          >
            {isEditing ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#161220',
                  border: '1px solid var(--accent)',
                  borderRadius: '3px',
                  padding: '1px 4px',
                  boxShadow: '0 2px 10px rgba(132, 112, 204, 0.4)',
                  zIndex: 30
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span style={{ fontSize: '0.65rem', color: 'var(--accent)', marginRight: '4px', fontFamily: 'monospace' }}>♩</span>
                <input
                  ref={editInputRef}
                  type="text"
                  inputMode="numeric"
                  value={editingBpmValue}
                  onChange={(e) => setEditingBpmValue(e.target.value)}
                  onBlur={() => commitBpmEdit(marker.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitBpmEdit(marker.id);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingTempoId(null);
                    }
                  }}
                  style={{
                    width: '38px',
                    height: '16px',
                    fontSize: '0.68rem',
                    fontFamily: "'Share Tech Mono', monospace",
                    textAlign: 'center',
                    background: '#0d0a14',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '2px',
                    color: '#ffffff',
                    outline: 'none'
                  }}
                />
                <span style={{ fontSize: '0.62rem', color: '#9585a8', marginLeft: '3px', fontFamily: 'monospace' }}>BPM</span>
              </div>
            ) : (
              <div
                className="tempo-marker-flag"
                style={{
                  height: '18px',
                  padding: '0 6px',
                  borderRadius: '3px',
                  background: 'rgba(132, 112, 204, 0.18)',
                  border: '1px solid rgba(132, 112, 204, 0.45)',
                  borderLeft: '3px solid var(--accent)',
                  color: 'var(--text-primary)',
                  fontSize: '0.68rem',
                  fontFamily: "'Share Tech Mono', monospace",
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  cursor: 'ew-resize',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
                  userSelect: 'none',
                  whiteSpace: 'nowrap'
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return; // Solo clic izquierdo para arrastrar
                  e.preventDefault();
                  e.stopPropagation();
                  const startX = e.clientX;
                  let hasMoved = false;

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    window.getSelection()?.removeAllRanges();
                    const deltaX = moveEvent.clientX - startX;
                    if (Math.abs(deltaX) > 3) hasMoved = true;
                    const deltaBeats = Math.round((deltaX / beatWidth) / snapStep) * snapStep;
                    const newBeat = Math.max(0, marker.beat + deltaBeats);
                    setActiveDrag({
                      id: marker.id,
                      type: 'move_tempo_marker',
                      startX,
                      initialStartBeat: marker.beat,
                      initialDurationBeats: 0,
                      currentStartBeat: newBeat,
                      currentDurationBeats: 0
                    });
                  };

                  const handleMouseUp = (upEvent: MouseEvent) => {
                    window.removeEventListener('mousemove', handleMouseMove);
                    window.removeEventListener('mouseup', handleMouseUp);
                    const deltaX = upEvent.clientX - startX;
                    const deltaBeats = Math.round((deltaX / beatWidth) / snapStep) * snapStep;
                    const newBeat = Math.max(0, marker.beat + deltaBeats);

                    const existing = tempoMarkers.find((m) => Math.abs(m.beat - newBeat) < 0.001 && m.id !== marker.id);
                    if (!existing && newBeat !== marker.beat && hasMoved) {
                      updateTempoMarker(marker.id, { beat: newBeat });
                    }
                    setActiveDrag(null);
                  };

                  window.addEventListener('mousemove', handleMouseMove);
                  window.addEventListener('mouseup', handleMouseUp);
                }}
                onContextMenu={(e) => {
                  // Clic derecho exclusivo para editar
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingTempoId(marker.id);
                  setEditingBpmValue(marker.bpm.toString());
                }}
                onDoubleClick={(e) => {
                  // Doble clic izquierdo exclusivo para eliminar
                  e.stopPropagation();
                  removeTempoMarker(marker.id);
                }}
                title={`Marcador de Tempo: ${marker.bpm} BPM en Beat ${marker.beat} — [Clic y arrastra para mover] · [Clic derecho para editar] · [Doble clic para eliminar]`}
              >
                <span style={{ color: 'var(--accent)' }}>♩</span>
                <span>{marker.bpm}</span>
                <span style={{ fontSize: '0.55rem', opacity: 0.8 }}>BPM</span>
              </div>
            )}
          </div>
        );
      })}

      {/* 2. Marcadores de Estilo / Patrón Rítmico */}
      {styleMarkers.map((marker) => {
        const markerLeft = marker.beat * beatWidth;
        const isDragging = activeDrag?.id === marker.id && activeDrag?.type === 'move_marker';
        const displayLeft = isDragging ? activeDrag.currentStartBeat * beatWidth : markerLeft;
        
        return (
          <div
            key={`style-${marker.id}`}
            style={{
              position: 'absolute',
              left: `${displayLeft}px`,
              top: '2px',
              zIndex: 10
            }}
          >
            <CustomSelect
              value={marker.pattern}
              groups={styleGroups}
              onChange={(newPattern) => updateStyleMarker(marker.id, { pattern: newPattern })}
              renderButton={(selectedOption) => (
                <div
                  className="style-marker-flag"
                  style={{
                    height: '18px',
                    padding: '0 5px',
                    borderRadius: '2px',
                    background: 'rgba(255, 216, 117, 0.15)',
                    border: '1px solid rgba(255, 216, 117, 0.3)',
                    borderLeft: '3px solid #ffd875',
                    color: '#ffd875',
                    fontSize: '0.65rem',
                    fontFamily: "'Share Tech Mono', monospace",
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'ew-resize',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const startX = e.clientX;
                    let hasMoved = false;
                    
                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      window.getSelection()?.removeAllRanges();
                      const deltaX = moveEvent.clientX - startX;
                      if (Math.abs(deltaX) > 3) hasMoved = true;
                      const deltaBeats = Math.round((deltaX / beatWidth) / snapStep) * snapStep;
                      const newBeat = Math.max(0, marker.beat + deltaBeats);
                      setActiveDrag({ 
                        id: marker.id, 
                        type: 'move_marker', 
                        startX,
                        initialStartBeat: marker.beat,
                        initialDurationBeats: 0,
                        currentStartBeat: newBeat, 
                        currentDurationBeats: 0 
                      });
                    };
                    
                    const handleMouseUp = (upEvent: MouseEvent) => {
                      window.removeEventListener('mousemove', handleMouseMove);
                      window.removeEventListener('mouseup', handleMouseUp);
                      const deltaX = upEvent.clientX - startX;
                      const deltaBeats = Math.round((deltaX / beatWidth) / snapStep) * snapStep;
                      const newBeat = Math.max(0, marker.beat + deltaBeats);
                      
                      const existing = styleMarkers.find((m) => Math.abs(m.beat - newBeat) < 0.001 && m.id !== marker.id);
                      if (!existing && newBeat !== marker.beat && hasMoved) {
                        updateStyleMarker(marker.id, { beat: newBeat });
                      }
                      setActiveDrag(null);
                    };
                    
                    window.addEventListener('mousemove', handleMouseMove);
                    window.addEventListener('mouseup', handleMouseUp);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    removeStyleMarker(marker.id);
                  }}
                  title={`Marcador de patrón: ${marker.pattern} en Beat ${marker.beat} — Click para cambiar, Arrastra para mover, Doble Click para eliminar`}
                >
                  {selectedOption?.label || marker.pattern}
                </div>
              )}
            />
          </div>
        );
      })}
    </div>
  );
});

