import React, { useRef, useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import type { ChordBlock } from '../../utils/typeDefinitions';
import { isChordInScale, getChordRomanDegree } from '../../engine/scaleDefinitions';
import { getChordRole } from './ChordPalette';
import { ChordPropertiesPanel } from './ChordPropertiesPanel';
import { CustomSelect } from '../ui/CustomSelect';
import { ChannelInstrumentControl } from '../ui/ChannelInstrumentControl';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { Plus, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Trash2, ZoomIn, ZoomOut, Grid } from 'lucide-react';
import { toneEngine } from '../../audio/toneEngine';
import { ChannelQuickControl } from '../ui/ChannelQuickControl';

const TimelinePlayhead: React.FC<{ beatWidth: number }> = ({ beatWidth }) => {
  const currentBeat = useSongStore(state => state.currentBeat);
  const playheadLeft = currentBeat * beatWidth;
  return (
    <div 
      className="playhead"
      style={{
        left: `${playheadLeft}px`,
        height: '100%',
        width: '2px',
        backgroundColor: '#00e5ff',
        position: 'absolute',
        top: 0,
        zIndex: 10,
        pointerEvents: 'none'
      }}
    />
  );
};

export const Timeline: React.FC = () => {
  const {
    chordBlocks,
    melodyNotes,
    selectedChordId,
    setSelectedChordId,
    updateChordBlock,
    removeChordBlock,
    addChordBlock,
    key,
    scale,
    timeSignature,
    coarseBeat,
    transposeSong,
    styleMarkers,
    addStyleMarker,
    removeStyleMarker,
    updateStyleMarker,
    customPatterns,
    setDraggingStyle
  } = useSongStore(useShallow(state => ({
    chordBlocks: state.chordBlocks,
    melodyNotes: state.melodyNotes,
    selectedChordId: state.selectedChordId,
    setSelectedChordId: state.setSelectedChordId,
    updateChordBlock: state.updateChordBlock,
    removeChordBlock: state.removeChordBlock,
    addChordBlock: state.addChordBlock,
    key: state.key,
    scale: state.scale,
    timeSignature: state.timeSignature,
    coarseBeat: Math.floor(state.currentBeat / 4) * 4,
    transposeSong: state.transposeSong,
    styleMarkers: state.styleMarkers,
    addStyleMarker: state.addStyleMarker,
    removeStyleMarker: state.removeStyleMarker,
    updateStyleMarker: state.updateStyleMarker,
    customPatterns: state.customPatterns,
    setDraggingStyle: state.setDraggingStyle
  })));

  const [trackContextMenu, setTrackContextMenu] = useState<{ x: number; y: number; beat: number } | null>(null);
  const [styleMarkerMenu, setStyleMarkerMenu] = useState<{
    markerId: string;
    x: number;
    y: number;
    currentPattern: string;
    beat: number;
  } | null>(null);

  const [selectedStyleToDrag, setSelectedStyleToDrag] = useState<string>('hold');
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [gridSnap, setGridSnap] = useState<'1' | '1/2' | '1/4'>('1');

  const snapStep = gridSnap === '1/4' ? 0.25 : gridSnap === '1/2' ? 0.5 : 1;
  const BEAT_WIDTH = Math.max(16, Math.round(40 * zoomLevel));

  const allStyles = [
    { id: 'hold', label: 'Hold' },
    { id: 'quarters', label: 'Negras' },
    { id: 'eighths', label: 'Corcheas' },
    { id: 'pop', label: 'Pop' },
    { id: 'arpeggio', label: 'Arpegio' },
    { id: 'strum', label: 'Strum' },
    ...customPatterns.filter((p: any) => p && p.name).map((p: any) => ({ id: p.name, label: p.name }))
  ];

  // Handler para cambiar estilo desde el dropdown: actualiza o crea marcador en beat 0
  const handleStyleSelectChange = (val: string) => {
    setSelectedStyleToDrag(val);
    const existingBeat0 = styleMarkers.find(m => m.beat === 0);
    if (existingBeat0) {
      updateStyleMarker(existingBeat0.id, { pattern: val });
    } else {
      addStyleMarker({ id: Math.random().toString(36).substr(2, 9), beat: 0, pattern: val });
    }
    useSongStore.getState().setPattern(val);
  };

  // Determinar la duración del compás en beats
  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;

  // Calcular de forma dinámica el total de beats necesarios
  const maxChordBeat = chordBlocks.reduce((max, b) => Math.max(max, b.startBeat + b.durationBeats), 0);
  const maxMelodyBeat = melodyNotes.reduce((max, n) => Math.max(max, n.startBeat + n.durationBeats), 0);
  const maxContentBeat = Math.max(maxChordBeat, maxMelodyBeat);
  
  const rawBeatsNeeded = Math.max(32, maxContentBeat + 16, coarseBeat + 8);
  const TOTAL_BEATS = Math.ceil(rawBeatsNeeded / beatsPerMeasure) * beatsPerMeasure;

  const viewportRef = useRef<HTMLDivElement>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [popoverChordId, setPopoverChordId] = useState<string | null>(null);

  // Listener global para deseleccionar acorde
  React.useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (!selectedChordId) return;

      const target = e.target as HTMLElement;
      const clickedPopover = target.closest('.chord-properties-popover');
      const clickedBlock = target.closest('.chord-block');

      if (!clickedPopover && !clickedBlock) {
        setSelectedChordId(null);
        setPopoverChordId(null);
      }
    };

    window.addEventListener('mousedown', handleGlobalClick);
    const handleGlobalMouseUp = () => {
      if (useSongStore.getState().draggingStyle) {
        useSongStore.getState().setDraggingStyle(null);
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousedown', handleGlobalClick);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [selectedChordId, setSelectedChordId]);

  // Listener global para cerrar menú contextual de marcador de estilo
  React.useEffect(() => {
    if (!styleMarkerMenu) return;
    const handleCloseStyleMenu = () => {
      setStyleMarkerMenu(null);
    };
    window.addEventListener('click', handleCloseStyleMenu);
    return () => window.removeEventListener('click', handleCloseStyleMenu);
  }, [styleMarkerMenu]);

  // Estados locales para arrastre fluido
  const [activeDrag, setActiveDrag] = useState<{
    id: string;
    type: 'move' | 'resize' | 'move_marker';
    startX: number;
    initialStartBeat: number;
    initialDurationBeats: number;
    currentStartBeat: number;
    currentDurationBeats: number;
  } | null>(null);

  const handleMouseDown = (e: React.MouseEvent, block: ChordBlock) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickXRelative = e.clientX - rect.left;
    const isNearRightEdge = rect.width - clickXRelative < 12;

    toneEngine.seekToBeat(block.startBeat);

    setActiveDrag({
      id: block.id,
      type: isNearRightEdge ? 'resize' : 'move',
      startX: e.clientX,
      initialStartBeat: block.startBeat,
      initialDurationBeats: block.durationBeats,
      currentStartBeat: block.startBeat,
      currentDurationBeats: block.durationBeats
    });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - e.clientX;
      const deltaBeatsRaw = deltaX / BEAT_WIDTH;
      const deltaBeats = Math.round(deltaBeatsRaw / snapStep) * snapStep;

      setActiveDrag(prev => {
        if (!prev) return null;
        if (prev.type === 'move') {
          const newStart = Math.max(0, prev.initialStartBeat + deltaBeats);
          return {
            ...prev,
            currentStartBeat: newStart
          };
        } else {
          const newDuration = Math.max(snapStep, prev.initialDurationBeats + deltaBeats);
          return {
            ...prev,
            currentDurationBeats: newDuration
          };
        }
      });
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      const deltaX = upEvent.clientX - e.clientX;
      const deltaBeats = Math.round((deltaX / BEAT_WIDTH) / snapStep) * snapStep;
      const distanceX = Math.abs(upEvent.clientX - e.clientX);

      if (distanceX < 4) {
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
          clickTimeoutRef.current = null;
          setSelectedChordId(null);
          setPopoverChordId(null);
          removeChordBlock(block.id);
        } else {
          clickTimeoutRef.current = setTimeout(() => {
            setSelectedChordId(block.id);
            setPopoverChordId(null);
            clickTimeoutRef.current = null;
          }, 240);
        }
      } else {
        if (isNearRightEdge) {
          const finalDuration = Math.max(snapStep, block.durationBeats + deltaBeats);
          updateChordBlock(block.id, { durationBeats: finalDuration });
        } else {
          const finalStart = Math.max(0, block.startBeat + deltaBeats);
          updateChordBlock(block.id, { startBeat: finalStart });
        }
      }

      setActiveDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleContextMenu = (e: React.MouseEvent, block: ChordBlock) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedChordId(block.id);
    setPopoverChordId(block.id);
  };

  // Generar cuadrícula de compases, beats y subdivisiones
  const totalSubdivisions = Math.round(TOTAL_BEATS / snapStep);
  const gridLines = [];
  for (let s = 0; s <= totalSubdivisions; s++) {
    const beat = s * snapStep;
    const isMeasure = Math.abs(beat % beatsPerMeasure) < 0.001;
    const isBeat = Math.abs(beat % 1) < 0.001;

    gridLines.push(
      <div 
        key={`grid-${s}`} 
        className={`grid-tick ${isMeasure ? 'measure' : isBeat ? 'beat' : 'subdivision'}`}
        style={{ 
          left: `${beat * BEAT_WIDTH}px`,
          backgroundColor: isMeasure ? 'rgba(112, 96, 176, 0.25)' : isBeat ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 229, 255, 0.06)',
          width: isMeasure ? '2px' : '1px'
        }}
      >
        {isMeasure ? <span className="measure-num">{Math.round(beat / beatsPerMeasure) + 1}</span> : null}
      </div>
    );
  }

  // Calcular posición del popover flotante
  const selectedBlock = chordBlocks.find(b => b.id === selectedChordId);
  let popoverLeft = 0;
  if (selectedBlock) {
    const blockLeft = selectedBlock.startBeat * BEAT_WIDTH;
    const blockWidth = selectedBlock.durationBeats * BEAT_WIDTH;
    popoverLeft = blockLeft + (blockWidth / 2) - 130 - scrollLeft;
    popoverLeft += 12;
    const sectionWidth = viewportRef.current?.getBoundingClientRect().width || 800;
    popoverLeft = Math.max(10, popoverLeft);
    popoverLeft = Math.min(sectionWidth - 270, popoverLeft);
  }

  return (
    <div className="timeline-section">
      <div className="timeline-header-row">
        <h2 className="timeline-title">Línea de Tiempo de Acordes</h2>
        
        {/* Selector de Instrumento */}
        <ChannelInstrumentControl channelId="chords" />

        {/* Zoom Controls */}
        <div className="timeline-zoom-group" style={{ display: 'flex', alignItems: 'center', gap: '3px', marginLeft: '12px', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            type="button"
            className="action-btn"
            style={{ padding: '2px 4px', minHeight: '22px', fontSize: '0.7rem' }}
            title="Reducir Zoom (Ctrl + Rueda Abajo)"
            onClick={() => setZoomLevel(z => Math.max(0.5, parseFloat((z - 0.15).toFixed(2))))}
          >
            <ZoomOut size={13} />
          </button>
          <span
            style={{ fontSize: '0.7rem', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-secondary)', padding: '0 4px', minWidth: '38px', textAlign: 'center', cursor: 'pointer' }}
            title="Hacer clic para restaurar 100%"
            onClick={() => setZoomLevel(1.0)}
          >
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            className="action-btn"
            style={{ padding: '2px 4px', minHeight: '22px', fontSize: '0.7rem' }}
            title="Aumentar Zoom (Ctrl + Rueda Arriba)"
            onClick={() => setZoomLevel(z => Math.min(2.5, parseFloat((z + 0.15).toFixed(2))))}
          >
            <ZoomIn size={13} />
          </button>
        </div>

        {/* Subdivisión de Cuadrícula */}
        <button
          type="button"
          className="action-btn timeline-grid-toggle"
          style={{
            padding: '2px 8px',
            minHeight: '24px',
            fontSize: '0.72rem',
            fontFamily: "'Share Tech Mono', monospace",
            background: gridSnap !== '1' ? 'rgba(0, 229, 255, 0.15)' : 'rgba(0,0,0,0.3)',
            borderColor: gridSnap !== '1' ? 'rgba(0, 229, 255, 0.4)' : 'rgba(255,255,255,0.08)',
            color: gridSnap !== '1' ? '#00e5ff' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          title="Alternar subdivisión y ajuste de cuadrícula (1 Beat / 1/2 Beat / 1/4 Beat)"
          onClick={() => {
            setGridSnap(prev => prev === '1' ? '1/2' : prev === '1/2' ? '1/4' : '1');
          }}
        >
          <Grid size={13} />
          GRID: {gridSnap === '1' ? '1/1' : gridSnap === '1/2' ? '1/2' : '1/4'}
        </button>

        {/* Style Dragger */}
        <div className="timeline-style-dragger">
          <span className="timeline-style-label">ESTILO:</span>
          <CustomSelect
            value={selectedStyleToDrag}
            onChange={handleStyleSelectChange}
            options={allStyles.map(s => ({ value: s.id, label: s.label }))}
            draggable={true}
            onMouseDown={() => setDraggingStyle(selectedStyleToDrag)}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/style-pattern', selectedStyleToDrag);
              e.dataTransfer.effectAllowed = 'copy';
              setDraggingStyle(selectedStyleToDrag);
            }}
            onOptionMouseDown={(val) => setDraggingStyle(val)}
            onOptionDragStart={(val, e) => {
              e.dataTransfer.setData('text/style-pattern', val);
              e.dataTransfer.effectAllowed = 'copy';
              setDraggingStyle(val);
            }}
          />
        </div>

        <ChannelQuickControl channelId="chords" />
      </div>

      <div 
        className="timeline-viewport" 
        ref={viewportRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setZoomLevel(z => Math.max(0.5, Math.min(2.5, parseFloat((z + delta).toFixed(2)))));
          }
        }}
      >
        <div 
          className="timeline-canvas" 
          style={{ width: `${TOTAL_BEATS * BEAT_WIDTH}px`, height: '80px', position: 'relative' }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const chord = e.dataTransfer.getData('text/plain');
            const canvasRect = e.currentTarget.getBoundingClientRect();
            const dropX = e.clientX - canvasRect.left;
            const dropBeat = Math.max(0, Math.round((dropX / BEAT_WIDTH) / snapStep) * snapStep);
            
            if (chord) {
              addChordBlock(chord, dropBeat, 4);
              return;
            }
            
            const stylePattern = e.dataTransfer.getData('text/style-pattern') || useSongStore.getState().draggingStyle;
            if (stylePattern) {
              const existing = styleMarkers.find(m => Math.abs(m.beat - dropBeat) < 0.001);
              if (!existing) {
                addStyleMarker({ id: Math.random().toString(36).substr(2, 9), beat: dropBeat, pattern: stylePattern });
              } else {
                updateStyleMarker(existing.id, { pattern: stylePattern });
              }
              setDraggingStyle(null);
            }
          }}
          onMouseUp={(e) => {
            const { draggingChord, setDraggingChord, draggingStyle, setDraggingStyle, addChordBlock, setSelectedChordId } = useSongStore.getState();
            const canvasRect = e.currentTarget.getBoundingClientRect();
            const dropX = e.clientX - canvasRect.left;
            const dropBeat = Math.max(0, Math.round((dropX / BEAT_WIDTH) / snapStep) * snapStep);
            
            if (draggingChord) {
              setSelectedChordId(null);
              addChordBlock(draggingChord, dropBeat, 4);
              toneEngine.playChordPreviewStop(draggingChord);
              setDraggingChord(null);
            } else if (draggingStyle) {
              const existing = styleMarkers.find(m => Math.abs(m.beat - dropBeat) < 0.001);
              if (!existing) {
                addStyleMarker({ id: Math.random().toString(36).substr(2, 9), beat: dropBeat, pattern: draggingStyle });
              } else {
                updateStyleMarker(existing.id, { pattern: draggingStyle });
              }
              setDraggingStyle(null);
            }
          }}
          onContextMenu={(e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.chord-block') && !target.closest('.chord-properties-popover') && !target.closest('.style-marker-flag')) {
              e.preventDefault();
              e.stopPropagation();
              const canvasRect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - canvasRect.left;
              const beat = Math.max(0, Math.floor((clickX / BEAT_WIDTH) / snapStep) * snapStep);
              setTrackContextMenu({ x: e.clientX, y: e.clientY, beat });
              
              const closeMenu = () => {
                setTrackContextMenu(null);
                window.removeEventListener('click', closeMenu);
              };
              window.addEventListener('click', closeMenu);
            }
          }}
          onMouseDown={(e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.chord-block') && !target.closest('.chord-properties-popover') && !target.closest('.style-marker-flag')) {
              setSelectedChordId(null);
              const canvasRect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - canvasRect.left;
              const clickedBeat = Math.max(0, Math.floor(clickX / BEAT_WIDTH));
              toneEngine.seekToBeat(clickedBeat);
            }
          }}
        >
          {/* Pista de Marcadores de Estilo (Timeline Style Markers) */}
          <div
            className="style-markers-ruler"
            style={{
              position: 'absolute',
              top: '0px',
              left: 0,
              right: 0,
              height: '20px',
              background: 'rgba(0, 0, 0, 0.4)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              zIndex: 5,
              cursor: 'pointer'
            }}
            title="Arrastra estilos aquí o haz clic derecho sobre un marcador para cambiarlo"
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
                const dropBeat = Math.max(0, Math.round((dropX / BEAT_WIDTH) / snapStep) * snapStep);
                const existing = styleMarkers.find(m => Math.abs(m.beat - dropBeat) < 0.001);
                if (!existing) {
                  addStyleMarker({ id: Math.random().toString(36).substr(2, 9), beat: dropBeat, pattern: stylePattern });
                } else {
                  updateStyleMarker(existing.id, { pattern: stylePattern });
                }
                setDraggingStyle(null);
              }
            }}
            onMouseUp={(e) => {
              const { draggingStyle, setDraggingStyle } = useSongStore.getState();
              if (draggingStyle) {
                const canvasRect = e.currentTarget.getBoundingClientRect();
                const dropX = e.clientX - canvasRect.left;
                const dropBeat = Math.max(0, Math.round((dropX / BEAT_WIDTH) / snapStep) * snapStep);
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
            {styleMarkers.map((marker) => {
              const markerLeft = marker.beat * BEAT_WIDTH;
              const isDragging = activeDrag?.id === marker.id && activeDrag?.type === 'move_marker';
              const displayLeft = isDragging ? activeDrag.currentStartBeat * BEAT_WIDTH : markerLeft;
              
              return (
                <div
                  key={marker.id}
                  className="style-marker-flag"
                  style={{
                    position: 'absolute',
                    left: `${displayLeft}px`,
                    top: '2px',
                    height: '16px',
                    padding: '0 5px',
                    borderRadius: '2px',
                    background: 'rgba(0, 229, 255, 0.12)',
                    borderLeft: '2px solid #00e5ff',
                    color: '#00e5ff',
                    fontSize: '0.65rem',
                    fontFamily: "'Share Tech Mono', monospace",
                    display: 'flex',
                    alignItems: 'center',
                    zIndex: 6,
                    cursor: 'ew-resize',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.5)'
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const startX = e.clientX;
                    
                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      const deltaX = moveEvent.clientX - startX;
                      const deltaBeats = Math.round((deltaX / BEAT_WIDTH) / snapStep) * snapStep;
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
                      const state = useSongStore.getState();
                      const deltaX = upEvent.clientX - startX;
                      const deltaBeats = Math.round((deltaX / BEAT_WIDTH) / snapStep) * snapStep;
                      const newBeat = Math.max(0, marker.beat + deltaBeats);
                      
                      const existing = state.styleMarkers.find((m) => Math.abs(m.beat - newBeat) < 0.001 && m.id !== marker.id);
                      if (!existing && newBeat !== marker.beat) {
                        updateStyleMarker(marker.id, { beat: newBeat });
                      }
                      setActiveDrag(null);
                    };
                    
                    window.addEventListener('mousemove', handleMouseMove);
                    window.addEventListener('mouseup', handleMouseUp);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setStyleMarkerMenu({
                      markerId: marker.id,
                      x: e.clientX,
                      y: e.clientY,
                      currentPattern: marker.pattern,
                      beat: marker.beat
                    });
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    removeStyleMarker(marker.id);
                  }}
                  title={`Marcador: ${marker.pattern} en Beat ${marker.beat} — Click derecho para cambiar estilo, Doble Click para eliminar`}
                >
                  {marker.pattern}
                </div>
              );
            })}
          </div>

          {/* Líneas de cuadrícula */}
          {gridLines}

          {/* Bloques de acordes */}
          {chordBlocks.map((block) => {
            const isSelected = block.id === selectedChordId;
            const isDraggingThis = activeDrag?.id === block.id;

            const startBeat = isDraggingThis && activeDrag.type === 'move'
              ? activeDrag.currentStartBeat
              : block.startBeat;

            const durationBeats = isDraggingThis && activeDrag.type === 'resize'
              ? activeDrag.currentDurationBeats
              : block.durationBeats;

            const left = startBeat * BEAT_WIDTH;
            const width = durationBeats * BEAT_WIDTH;

            const isDiad = isChordInScale(block.chord, key, scale);
            const romanDegree = isDiad ? getChordRomanDegree(block.chord, key, scale) : '';
            const role = getChordRole(block.chord, key, scale);
            const inScale = isDiad;

            return (
              <div
                key={block.id}
                className={`chord-block ${isSelected ? 'selected' : ''} ${isDraggingThis ? 'dragging' : ''}`}
                style={{
                  position: 'absolute',
                  left: `${left}px`,
                  top: '24px',
                  width: `${Math.max(16, width - 4)}px`,
                  height: '52px',
                  zIndex: isSelected || isDraggingThis ? 10 : 3,
                  cursor: isDraggingThis ? 'grabbing' : 'grab'
                }}
                onMouseDown={(e) => handleMouseDown(e, block)}
                onContextMenu={(e) => handleContextMenu(e, block)}
              >
                <div className="block-content-only">
                  <span className="block-name" style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                    {block.chord}
                    {!inScale && (
                      <span 
                        className="out-of-scale-warning" 
                        title="Este acorde contiene notas fuera de la escala actual"
                        style={{ marginLeft: '4px', cursor: 'help' }}
                      >
                        ⚠️
                      </span>
                    )}
                  </span>
                  <span className="block-duration-label" style={{ fontSize: '0.65rem', opacity: 0.85 }}>
                    {romanDegree ? romanDegree : `${durationBeats} ${durationBeats === 1 ? 'beat' : 'beats'}`}
                  </span>
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
                
                <div 
                  className="resize-handle right"
                  title="Arrastra para redimensionar duración"
                />
              </div>
            );
          })}

          <TimelinePlayhead beatWidth={BEAT_WIDTH} />
        </div>
      </div>

      {/* Popover de Propiedades */}
      {selectedBlock && popoverChordId === selectedBlock.id && (
        <ChordPropertiesPanel popoverLeft={popoverLeft} />
      )}

      {/* Menú Contextual del Marcador de Estilo */}
      {styleMarkerMenu && (
        <ContextMenuContainer
          x={styleMarkerMenu.x}
          y={styleMarkerMenu.y}
        >
          <div className="menu-header" style={{ padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.72rem', color: '#00e5ff', fontFamily: "'Share Tech Mono', monospace", fontWeight: 'bold' }}>
              CAMBIAR ESTILO (BEAT {styleMarkerMenu.beat})
            </span>
          </div>
          <div className="style-marker-menu-list" style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {allStyles.map(s => (
              <button
                key={s.id}
                type="button"
                className={`menu-item ${styleMarkerMenu.currentPattern === s.id ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  padding: '5px 8px',
                  background: styleMarkerMenu.currentPattern === s.id ? 'rgba(0, 229, 255, 0.15)' : 'transparent',
                  color: styleMarkerMenu.currentPattern === s.id ? '#00e5ff' : 'var(--text-primary)',
                  fontSize: '0.8rem',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onClick={() => {
                  updateStyleMarker(styleMarkerMenu.markerId, { pattern: s.id });
                  setStyleMarkerMenu(null);
                }}
              >
                <span>{s.label}</span>
                {styleMarkerMenu.currentPattern === s.id && (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#00e5ff' }} />
                )}
              </button>
            ))}
          </div>
          <hr className="menu-separator" style={{ margin: '4px 0', borderColor: 'rgba(255,255,255,0.08)' }} />
          <button
            type="button"
            className="menu-danger"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              width: '100%',
              padding: '6px 8px',
              background: 'rgba(255, 51, 102, 0.1)',
              color: '#ff3366',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '0.78rem'
            }}
            onClick={() => {
              removeStyleMarker(styleMarkerMenu.markerId);
              setStyleMarkerMenu(null);
            }}
          >
            <Trash2 size={13} /> Eliminar Marcador
          </button>
        </ContextMenuContainer>
      )}

      {/* Menú Contextual de Pista (Right-click en fondo) */}
      {trackContextMenu && (
        <ContextMenuContainer
          x={trackContextMenu.x}
          y={trackContextMenu.y}
        >
          <div className="menu-header">
            <span>PISTA ARMÓNICA · BEAT {trackContextMenu.beat}</span>
          </div>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              addChordBlock('C', trackContextMenu.beat, 4);
              setTrackContextMenu(null);
            }}
          >
            <Plus size={14} /> Insertar Acorde (C)
          </button>

          <hr className="menu-separator" />

          <div className="menu-subheader">Transponer Todo</div>
          <div className="menu-quick-row">
            <button
              type="button"
              className="quick-action-btn"
              title="Transponer -1 Semitono"
              onClick={() => transposeSong(-1)}
            >
              <ArrowDown size={14} />
              <span className="btn-subtext">-1</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              title="Transponer +1 Semitono"
              onClick={() => transposeSong(1)}
            >
              <ArrowUp size={14} />
              <span className="btn-subtext">+1</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              title="Bajar 1 Octava (-12)"
              onClick={() => transposeSong(-12)}
            >
              <ChevronsDown size={14} />
              <span className="btn-subtext">-12</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              title="Subir 1 Octava (+12)"
              onClick={() => transposeSong(12)}
            >
              <ChevronsUp size={14} />
              <span className="btn-subtext">+12</span>
            </button>
          </div>

          <hr className="menu-separator" />

          <button
            type="button"
            className="menu-danger"
            onClick={() => {
              if (window.confirm('¿Borrar todos los acordes de la pista armónica?')) {
                chordBlocks.forEach(b => removeChordBlock(b.id));
              }
              setTrackContextMenu(null);
            }}
          >
            <Trash2 size={14} /> Limpiar Pista Armónica
          </button>
        </ContextMenuContainer>
      )}
    </div>
  );
};
