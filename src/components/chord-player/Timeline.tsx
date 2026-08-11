import React, { useRef, useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import type { ChordBlock } from '../../utils/typeDefinitions';
import { isChordInScale, getChordRomanDegree } from '../../engine/scaleDefinitions';
import { getChordRole } from './ChordPalette';
import { ChordPropertiesPanel } from './ChordPropertiesPanel';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { Plus, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Trash2 } from 'lucide-react';
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
    updateStyleMarker
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
    updateStyleMarker: state.updateStyleMarker
  })));

  const [trackContextMenu, setTrackContextMenu] = useState<{ x: number; y: number; beat: number } | null>(null);

  const BEAT_WIDTH = 40; // píxeles por beat

  // Determinar la duración del compás en beats
  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;

  // Calcular de forma dinámica el total de beats necesarios (infinito)
  const maxChordBeat = chordBlocks.reduce((max, b) => Math.max(max, b.startBeat + b.durationBeats), 0);
  const maxMelodyBeat = melodyNotes.reduce((max, n) => Math.max(max, n.startBeat + n.durationBeats), 0);
  const maxContentBeat = Math.max(maxChordBeat, maxMelodyBeat);
  
  // Siempre dar al menos 16 beats de espacio adicional a la derecha
  const rawBeatsNeeded = Math.max(32, maxContentBeat + 16, coarseBeat + 8);
  const TOTAL_BEATS = Math.ceil(rawBeatsNeeded / beatsPerMeasure) * beatsPerMeasure;

  const viewportRef = useRef<HTMLDivElement>(null);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [popoverChordId, setPopoverChordId] = useState<string | null>(null);

  // Listener global para deseleccionar acorde al hacer click en cualquier parte de la pantalla (fuera de popovers y bloques)
  React.useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (!selectedChordId) return;

      const target = e.target as HTMLElement;
      
      // Comprobar si el click ocurrió dentro del popover o un bloque de acorde
      const clickedPopover = target.closest('.chord-properties-popover');
      const clickedBlock = target.closest('.chord-block');

      if (!clickedPopover && !clickedBlock) {
        setSelectedChordId(null);
        setPopoverChordId(null);
      }
    };

    window.addEventListener('mousedown', handleGlobalClick);
    return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, [selectedChordId, setSelectedChordId]);

  // Estados locales para arrastre fluido
  const [activeDrag, setActiveDrag] = useState<{
    id: string;
    type: 'move' | 'resize';
    startX: number;
    initialStartBeat: number;
    initialDurationBeats: number;
    currentStartBeat: number;
    currentDurationBeats: number;
  } | null>(null);



  const handleMouseDown = (e: React.MouseEvent, block: ChordBlock) => {
    e.stopPropagation();
    if (e.button !== 0) return; // solo click izquierdo

    const rect = e.currentTarget.getBoundingClientRect();
    const clickXRelative = e.clientX - rect.left;
    const isNearRightEdge = rect.width - clickXRelative < 12; // cerca del borde derecho

    // Mover playhead de inmediato al inicio del acorde
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

    // Agregar listeners globales para seguimiento fluido
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - e.clientX;
      const deltaBeatsRaw = deltaX / BEAT_WIDTH;
      // Snap a 1 beat para acordes
      const deltaBeats = Math.round(deltaBeatsRaw);

      setActiveDrag(prev => {
        if (!prev) return null;
        if (prev.type === 'move') {
          const newStart = Math.max(0, prev.initialStartBeat + deltaBeats);
          return {
            ...prev,
            currentStartBeat: newStart
          };
        } else {
          // Duración mínima de 1 beat
          const newDuration = Math.max(1, prev.initialDurationBeats + deltaBeats);
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
      const deltaBeats = Math.round(deltaX / BEAT_WIDTH);
      const distanceX = Math.abs(upEvent.clientX - e.clientX);

      if (distanceX < 4) {
        // Click seco: diferenciar click simple de doble click
        if (clickTimeoutRef.current) {
          // Es un doble click: cancelar la selección y eliminar el acorde
          clearTimeout(clickTimeoutRef.current);
          clickTimeoutRef.current = null;
          setSelectedChordId(null);
          setPopoverChordId(null);
          removeChordBlock(block.id);
        } else {
          // Iniciar temporizador para el click simple
          clickTimeoutRef.current = setTimeout(() => {
            // Seleccionar acorde (el playhead ya se movió en el mouseDown)
            setSelectedChordId(block.id);
            setPopoverChordId(null); // No abre popover en click izquierdo seco
            clickTimeoutRef.current = null;
          }, 240); // 240ms es un excelente margen para doble click
        }
      } else {
        // Se movió: realizar el cambio de duración o posición
        if (isNearRightEdge) {
          const finalDuration = Math.max(1, block.durationBeats + deltaBeats);
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



  // Generar cuadrícula de beats (líneas de compás)
  const gridLines = [];
  for (let i = 0; i < TOTAL_BEATS; i++) {
    const isMeasure = i % beatsPerMeasure === 0;
    gridLines.push(
      <div 
        key={i} 
        className={`grid-tick ${isMeasure ? 'measure' : ''}`}
        style={{ left: `${i * BEAT_WIDTH}px` }}
      >
        {isMeasure ? <span className="measure-num">{Math.floor(i / beatsPerMeasure) + 1}</span> : null}
      </div>
    );
  }

  // Playhead visual se maneja en el subcomponente TimelinePlayhead

  // Calcular posición del popover flotante en base al bloque seleccionado y el scroll
  const selectedBlock = chordBlocks.find(b => b.id === selectedChordId);
  let popoverLeft = 0;
  if (selectedBlock) {
    const blockLeft = selectedBlock.startBeat * BEAT_WIDTH;
    const blockWidth = selectedBlock.durationBeats * BEAT_WIDTH;
    popoverLeft = blockLeft + (blockWidth / 2) - 130 - scrollLeft;
    popoverLeft += 12; // Compensación de padding-left de la sección (.timeline-section)
    const sectionWidth = viewportRef.current?.getBoundingClientRect().width || 800;
    popoverLeft = Math.max(10, popoverLeft);
    popoverLeft = Math.min(sectionWidth - 270, popoverLeft);
  }

  return (
    <div className="timeline-section">
      <div className="timeline-header-row">
        <div className="title-undo-group">
          <h2>Línea de Tiempo de Acordes</h2>
        </div>
        <ChannelQuickControl channelId="chords" />
        <span className="ux-tip">Arrastra acordes • Marcadores de estilo arriba • Click derecho para editar</span>
      </div>

      
      <div 
        className="timeline-viewport" 
        ref={viewportRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
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
            if (!chord) return;
            const canvasRect = e.currentTarget.getBoundingClientRect();
            const dropX = e.clientX - canvasRect.left;
            const dropBeat = Math.max(0, Math.round(dropX / BEAT_WIDTH));
            addChordBlock(chord, dropBeat, 4);
          }}
          onMouseUp={(e) => {
            const { draggingChord, setDraggingChord, addChordBlock, setSelectedChordId } = useSongStore.getState();
            if (draggingChord) {
              setSelectedChordId(null);
              const canvasRect = e.currentTarget.getBoundingClientRect();
              const dropX = e.clientX - canvasRect.left;
              const dropBeat = Math.max(0, Math.round(dropX / BEAT_WIDTH));
              addChordBlock(draggingChord, dropBeat, 4);
              toneEngine.playChordPreviewStop(draggingChord);
              setDraggingChord(null);
            }
          }}
          onContextMenu={(e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.chord-block') && !target.closest('.chord-properties-popover')) {
              e.preventDefault();
              e.stopPropagation();
              const canvasRect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - canvasRect.left;
              const beat = Math.max(0, Math.floor(clickX / BEAT_WIDTH));
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
            // Permitir click en la cuadrícula o fondo para cambiar de beat, ignorando bloques de acordes o popovers
            if (!target.closest('.chord-block') && !target.closest('.chord-properties-popover')) {
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
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const beat = Math.max(0, Math.floor(clickX / BEAT_WIDTH));
              const existing = styleMarkers.find((m) => m.beat === beat);
              if (!existing) {
                addStyleMarker({
                  id: `sm_${Math.random().toString(36).substr(2, 9)}`,
                  beat,
                  pattern: 'quarters'
                });
              }
            }}
            title="Haz clic para agregar un marcador de estilo en este beat"
          >
            {styleMarkers.map((marker) => {
              const markerLeft = marker.beat * BEAT_WIDTH;
              return (
                <div
                  key={marker.id}
                  className="style-marker-flag"
                  style={{
                    position: 'absolute',
                    left: `${markerLeft}px`,
                    top: '2px',
                    height: '16px',
                    padding: '0 6px',
                    borderRadius: '3px',
                    background: 'rgba(0, 229, 255, 0.25)',
                    border: '1px solid #00e5ff',
                    color: '#00e5ff',
                    fontSize: '0.65rem',
                    fontFamily: "'Share Tech Mono', monospace",
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    zIndex: 6
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const patterns: ('hold' | 'quarters' | 'eighths' | 'pop' | 'arpeggio' | 'strum')[] = ['hold', 'quarters', 'eighths', 'pop', 'arpeggio', 'strum'];
                    const currentIndex = patterns.indexOf(marker.pattern as any);
                    const nextPattern = patterns[(currentIndex + 1) % patterns.length];
                    updateStyleMarker(marker.id, { pattern: nextPattern });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeStyleMarker(marker.id);
                  }}
                  title={`Marcador: ${marker.pattern} en Beat ${marker.beat} — Click para cambiar estilo, Clic Derecho para eliminar`}
                >
                  <span>📍 {marker.pattern}</span>
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

            // Renderizar la posición arrastrada local en tiempo real o la real del store
            const startBeat = isDraggingThis && activeDrag.type === 'move'
              ? activeDrag.currentStartBeat
              : block.startBeat;

            const durationBeats = isDraggingThis && activeDrag.type === 'resize'
              ? activeDrag.currentDurationBeats
              : block.durationBeats;

            const left = startBeat * BEAT_WIDTH;
            const width = durationBeats * BEAT_WIDTH;

            // Calcular nombre a mostrar y si está en la escala
            const inScale = isChordInScale(block.chord, key, scale);
            const displayChord = block.bassNote ? `${block.chord}/${block.bassNote}` : block.chord;

            const ROLE_COLORS: Record<string, string> = {
              reposo:       'var(--role-reposo)',
              subdominante: 'var(--role-subdominante)',
              tension:      'var(--role-tension)',
              spicy:        'var(--role-spicy)',
              exotic:       'var(--role-exotic)',
            };
            const ROLE_GLOWS: Record<string, string> = {
              reposo:       'var(--glow-reposo)',
              subdominante: 'var(--glow-subdominante)',
              tension:      'var(--glow-tension)',
              spicy:        'var(--glow-spicy)',
              exotic:       'var(--glow-exotic)',
            };
            const role = getChordRole(block.chord, key, scale);
            const roleColor = ROLE_COLORS[role] || 'var(--accent)';
            const roleGlow = ROLE_GLOWS[role] || 'rgba(112, 96, 176, 0.45)';

            const romanDegree = block.type !== 'silence' && block.type !== 'break'
              ? getChordRomanDegree(block.chord, key, scale)
              : '';

            return (
              <React.Fragment key={block.id}>
                {/* Etiqueta de Sección */}
                {block.section && (
                  <div
                    className="timeline-section-label"
                    style={{
                      left: `${left}px`,
                      position: 'absolute',
                      top: '2px',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      color: '#00e5ff',
                      backgroundColor: 'rgba(0, 229, 255, 0.1)',
                      border: '1px solid rgba(0, 229, 255, 0.2)',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                      zIndex: 3
                    }}
                  >
                    {block.section}
                  </div>
                )}
                
                <div
                  className={`chord-block ${isSelected ? 'selected' : ''} ${isDraggingThis ? 'dragging' : ''} ${block.type || 'play'}`}
                  style={{
                    left: `${left}px`,
                    width: `${width}px`,
                    height: '48px',
                    top: '22px',
                    position: 'absolute',
                    // Inyectar variables de color de rol para CSS
                    ['--role-color' as any]: roleColor,
                    ['--role-glow' as any]: roleGlow,
                  }}
                  onMouseDown={(e) => handleMouseDown(e, block)}
                  onContextMenu={(e) => handleContextMenu(e, block)}
                >
                  <div className="block-content-only">
                    <span className="block-name" style={{ fontSize: '1rem', fontWeight: 700 }}>
                      {block.type === 'silence' ? (
                        <span className="block-meta-text">🔇 Silencio</span>
                      ) : block.type === 'break' ? (
                        <span className="block-meta-text">⏸️ Break</span>
                      ) : (
                        <>
                          {displayChord}
                          {!inScale && (
                            <span 
                              className="out-of-scale-warning" 
                              title="Este acorde contiene notas fuera de la escala actual"
                              style={{ marginLeft: '4px', cursor: 'help' }}
                            >
                              ⚠️
                            </span>
                          )}
                        </>
                      )}
                    </span>
                    <span className="block-duration-label" style={{ fontSize: '0.65rem', opacity: 0.85 }}>
                      {block.type === 'bass-only' ? '🎸 Bajo · ' : block.type === 'chord-only' ? '🎹 Acorde · ' : ''}
                      {romanDegree ? romanDegree : `${durationBeats} ${durationBeats === 1 ? 'beat' : 'beats'}`}
                    </span>
                  </div>

                  {/* Detalle ligero: barrita de color sutil del rol armónico en la base */}
                  {block.type !== 'silence' && block.type !== 'break' && (
                    <div 
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '3px',
                        backgroundColor: roleColor,
                        opacity: 0.95
                      }}
                    />
                  )}
                  
                  {/* Handle invisible de redimensión a la derecha */}
                  <div className="resize-handle" />
                </div>
              </React.Fragment>
            );
          })}

          {/* Playhead */}
          <TimelinePlayhead beatWidth={BEAT_WIDTH} />
        </div>
      </div>

      {/* Popover flotante del editor de propiedades del acorde (se activa con click derecho) */}
      {selectedBlock && popoverChordId === selectedBlock.id && (
        <ChordPropertiesPanel popoverLeft={popoverLeft} />
      )}

      {/* Menú Contextual de Pista Armónica */}
      {trackContextMenu && (
        <ContextMenuContainer x={trackContextMenu.x} y={trackContextMenu.y}>
          <div className="menu-header">Pista Armónica (Beat {trackContextMenu.beat + 1})</div>
          
          <button
            type="button"
            onClick={() => {
              addChordBlock(key, trackContextMenu.beat, 4);
              setTrackContextMenu(null);
            }}
          >
            <Plus size={14} /> Insertar Acorde {key}
          </button>

          <hr className="menu-separator" />

          <div className="menu-quick-actions">
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
