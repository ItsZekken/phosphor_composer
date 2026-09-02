import React, { useRef, useState, useEffect } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import type { ChordBlock } from '../../utils/typeDefinitions';
import { ChordPropertiesPanel } from './ChordPropertiesPanel';
import { CustomSelect } from '../ui/CustomSelect';
import { ChannelInstrumentControl } from '../ui/ChannelInstrumentControl';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { Plus, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Trash2, Grid, Copy, Scissors, Clipboard, Layers } from 'lucide-react';
import { toneEngine } from '../../audio/toneEngine';
import { ChannelQuickControl } from '../ui/ChannelQuickControl';
import { UnifiedToolbar } from '../shared/UnifiedToolbar';
import { PhysicalZoomControl } from '../shared/PhysicalZoomControl';

import { TimelinePlayhead } from './timeline/TimelinePlayhead';
import { TimelineBlock } from './timeline/TimelineBlock';
import { TimelineMarkerTrack } from './timeline/TimelineMarkerTrack';
import { useTimelineShortcuts } from './hooks/useTimelineShortcuts';

interface DragState {
  id: string;
  type: 'move' | 'resize_left' | 'resize_right' | 'move_marker' | 'move_tempo_marker';
  startX: number;
  initialStartBeat: number;
  initialDurationBeats: number;
  currentStartBeat: number;
  currentDurationBeats: number;
  groupSnapshots?: Map<string, { startBeat: number; durationBeats: number }>;
}

interface LassoState {
  isActive: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export const Timeline: React.FC = () => {
  const {
    chordBlocks,
    selectedChordId,
    selectedChordIds,
    setSelectedChordId,
    setSelectedChordIds,
    toggleSelectChordId,
    selectAllChords,
    chordGridSnap,
    setChordGridSnap,
    copySelectedChords,
    cutSelectedChords,
    pasteChords,
    duplicateSelectedChords,
    deleteSelectedChords,
    updateChordBlock,
    removeChordBlock,
    addChordBlock,
    bpm,
    tempoMarkers,
    addTempoMarker,
    removeTempoMarker,
    updateTempoMarker,
    key,
    scale,
    timeSignature,
    transposeSong,
    styleMarkers,
    addStyleMarker,
    removeStyleMarker,
    updateStyleMarker,
    customPatterns,
    setDraggingStyle,
    chordTimelineViewport,
    setChordTimelineViewport
  } = useSongStore(useShallow(state => ({
    chordBlocks: state.chordBlocks || [],
    selectedChordId: state.selectedChordId,
    selectedChordIds: state.selectedChordIds || [],
    setSelectedChordId: state.setSelectedChordId,
    setSelectedChordIds: state.setSelectedChordIds,
    toggleSelectChordId: state.toggleSelectChordId,
    selectAllChords: state.selectAllChords,
    chordGridSnap: state.chordGridSnap || '1',
    setChordGridSnap: state.setChordGridSnap,
    copySelectedChords: state.copySelectedChords,
    cutSelectedChords: state.cutSelectedChords,
    pasteChords: state.pasteChords,
    duplicateSelectedChords: state.duplicateSelectedChords,
    deleteSelectedChords: state.deleteSelectedChords,
    updateChordBlock: state.updateChordBlock,
    removeChordBlock: state.removeChordBlock,
    addChordBlock: state.addChordBlock,
    bpm: state.bpm || 120,
    tempoMarkers: state.tempoMarkers || [],
    addTempoMarker: state.addTempoMarker,
    removeTempoMarker: state.removeTempoMarker,
    updateTempoMarker: state.updateTempoMarker,
    key: state.key || 'C',
    scale: state.scale || 'major',
    timeSignature: state.timeSignature || '4/4',
    transposeSong: state.transposeSong,
    styleMarkers: state.styleMarkers || [],
    addStyleMarker: state.addStyleMarker,
    removeStyleMarker: state.removeStyleMarker,
    updateStyleMarker: state.updateStyleMarker,
    customPatterns: state.customPatterns || [],
    setDraggingStyle: state.setDraggingStyle,
    chordTimelineViewport: state.chordTimelineViewport,
    setChordTimelineViewport: state.setChordTimelineViewport
  })));

  const [trackContextMenu, setTrackContextMenu] = useState<{ x: number; y: number; beat: number } | null>(null);
  const [blockContextMenu, setBlockContextMenu] = useState<{ x: number; y: number; block: ChordBlock } | null>(null);

  const [selectedStyleToDrag, setSelectedStyleToDrag] = useState<string>('hold');
  const [zoomLevel, setZoomLevel] = useState<number>(chordTimelineViewport?.zoomLevel || 1.0);

  // Sincronizar cambios de zoom con el store
  useEffect(() => {
    setChordTimelineViewport({ zoomLevel });
  }, [zoomLevel, setChordTimelineViewport]);

  const snapStep = chordGridSnap === '1/4' ? 0.25 : chordGridSnap === '1/2' ? 0.5 : 1;
  const BEAT_WIDTH = Math.max(16, Math.round(40 * zoomLevel));

  const basicStyles = [
    { id: 'hold', label: 'Hold' },
    { id: 'quarters', label: 'Negras' },
    { id: 'eighths', label: 'Corcheas' },
    { id: 'pop', label: 'Pop' },
    { id: 'arpeggio', label: 'Arpegio' },
    { id: 'strum', label: 'Strum' },
  ];

  const customStyleItems = (customPatterns || [])
    .filter((p: any) => p && p.name)
    .map((p: any) => ({ id: p.name, label: p.name }));

  const styleGroups = [
    {
      label: 'Estilos Básicos',
      options: basicStyles.map(s => ({ value: s.id, label: s.label }))
    },
    ...(customStyleItems.length > 0 ? [{
      label: `Patrones MIDI (${customStyleItems.length})`,
      options: customStyleItems.map(s => ({ value: s.id, label: s.label }))
    }] : [])
  ];

  // Handler para cambiar estilo desde el dropdown
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

  // Cálculo generoso de longitud total
  const maxChordBeat = chordBlocks.reduce((max, b) => Math.max(max, b.startBeat + b.durationBeats), 0);
  const rawBeatsNeeded = Math.max(48, maxChordBeat + 24);
  const TOTAL_BEATS = Math.ceil(rawBeatsNeeded / beatsPerMeasure) * beatsPerMeasure;

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollLeft, setScrollLeft] = useState(chordTimelineViewport?.scrollLeft || 0);
  const [popoverChordId, setPopoverChordId] = useState<string | null>(null);

  // Restaurar y reaccionar a cambios de scrollLeft del store (ej. reseteo con tecla W a 0)
  useEffect(() => {
    if (viewportRef.current) {
      const targetLeft = chordTimelineViewport?.scrollLeft ?? 0;
      viewportRef.current.scrollLeft = targetLeft;
      setScrollLeft(targetLeft);
    }
  }, [chordTimelineViewport?.scrollLeft]);

  // Estados de arrastre y selección Lasso
  const [activeDrag, setActiveDrag] = useState<DragState | null>(null);
  const [lasso, setLasso] = useState<LassoState>({ isActive: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });

  // Zoom con Alt + Rueda y Scroll horizontal con Shift + Rueda
  useEffect(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -0.12 : 0.12;
        setZoomLevel(z => Math.max(0.4, Math.min(3.0, parseFloat((z + delta).toFixed(2)))));
      } else if (e.shiftKey) {
        e.preventDefault();
        viewportEl.scrollLeft += e.deltaY;
      }
    };

    viewportEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      viewportEl.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Hook de atajos de teclado DAW
  useTimelineShortcuts({
    selectedChordIds,
    copySelectedChords,
    cutSelectedChords,
    pasteChords,
    duplicateSelectedChords,
    selectAllChords,
    deleteSelectedChords
  });

  // Listener global para cerrar popovers y menús contextuales al hacer clic fuera
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const clickedPopover = target.closest('.chord-properties-popover');
      const clickedBlock = target.closest('.chord-block');
      const clickedContextMenu = target.closest('.custom-context-menu');

      if (blockContextMenu && !clickedContextMenu) {
        setBlockContextMenu(null);
      }
      if (trackContextMenu && !clickedContextMenu) {
        setTrackContextMenu(null);
      }

      if (!clickedPopover && !clickedBlock && !clickedContextMenu && !lasso.isActive) {
        if (selectedChordIds.length > 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          setSelectedChordIds([]);
          setPopoverChordId(null);
        }
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
  }, [selectedChordIds, setSelectedChordIds, lasso.isActive, blockContextMenu, trackContextMenu]);

  // Manejo de interacción de Bloques de Acordes (Mover, Estirar Izquierda, Estirar Derecha)
  const handleBlockMouseDown = (e: React.MouseEvent, block: ChordBlock) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const clickXRelative = e.clientX - rect.left;
    const isNearLeftEdge = clickXRelative < 10;
    const isNearRightEdge = rect.width - clickXRelative < 10;

    const isMultiKey = e.shiftKey || e.ctrlKey || e.metaKey;

    if (isMultiKey) {
      toggleSelectChordId(block.id, true);
    } else {
      if (!selectedChordIds.includes(block.id)) {
        setSelectedChordId(block.id);
      }
    }

    toneEngine.seekToBeat(block.startBeat);

    const type: 'move' | 'resize_left' | 'resize_right' = isNearLeftEdge
      ? 'resize_left'
      : isNearRightEdge
      ? 'resize_right'
      : 'move';

    // Snapshot del grupo si se arrastra en modo mover
    const groupSnapshots = new Map<string, { startBeat: number; durationBeats: number }>();
    const effectiveSelectedIds = selectedChordIds.includes(block.id)
      ? selectedChordIds
      : [block.id];

    chordBlocks.forEach((b) => {
      if (effectiveSelectedIds.includes(b.id)) {
        groupSnapshots.set(b.id, { startBeat: b.startBeat, durationBeats: b.durationBeats });
      }
    });

    setActiveDrag({
      id: block.id,
      type,
      startX: e.clientX,
      initialStartBeat: block.startBeat,
      initialDurationBeats: block.durationBeats,
      currentStartBeat: block.startBeat,
      currentDurationBeats: block.durationBeats,
      groupSnapshots
    });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      window.getSelection()?.removeAllRanges();
      const deltaX = moveEvent.clientX - e.clientX;
      const deltaBeatsRaw = deltaX / BEAT_WIDTH;
      const deltaBeats = Math.round(deltaBeatsRaw / snapStep) * snapStep;

      setActiveDrag(prev => {
        if (!prev) return null;

        if (prev.type === 'move') {
          const newStart = Math.max(0, prev.initialStartBeat + deltaBeats);
          return { ...prev, currentStartBeat: newStart };
        } else if (prev.type === 'resize_right') {
          const newDuration = Math.max(snapStep, prev.initialDurationBeats + deltaBeats);
          return { ...prev, currentDurationBeats: newDuration };
        } else if (prev.type === 'resize_left') {
          const initialEnd = prev.initialStartBeat + prev.initialDurationBeats;
          const maxStart = initialEnd - snapStep;
          const newStart = Math.min(maxStart, Math.max(0, prev.initialStartBeat + deltaBeats));
          const newDuration = Math.max(snapStep, initialEnd - newStart);
          return {
            ...prev,
            currentStartBeat: newStart,
            currentDurationBeats: newDuration
          };
        }
        return prev;
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      const deltaX = (window.event as MouseEvent)?.clientX ? (window.event as MouseEvent).clientX - e.clientX : 0;
      const deltaBeats = Math.round((deltaX / BEAT_WIDTH) / snapStep) * snapStep;
      const distanceX = Math.abs(deltaX);

      if (distanceX < 4) {
        if (!isMultiKey) {
          if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current);
            clickTimeoutRef.current = null;
            removeChordBlock(block.id);
          } else {
            clickTimeoutRef.current = setTimeout(() => {
              setSelectedChordId(block.id);
              setPopoverChordId(null);
              clickTimeoutRef.current = null;
            }, 240);
          }
        }
      } else {
        if (type === 'resize_right') {
          const finalDuration = Math.max(snapStep, block.durationBeats + deltaBeats);
          updateChordBlock(block.id, { durationBeats: finalDuration });
        } else if (type === 'resize_left') {
          const initialEnd = block.startBeat + block.durationBeats;
          const maxStart = initialEnd - snapStep;
          const finalStart = Math.min(maxStart, Math.max(0, block.startBeat + deltaBeats));
          const finalDuration = Math.max(snapStep, initialEnd - finalStart);
          updateChordBlock(block.id, { startBeat: finalStart, durationBeats: finalDuration });
        } else if (type === 'move') {
          if (groupSnapshots.size > 0 && deltaBeats !== 0) {
            const minStart = Array.from(groupSnapshots.values()).reduce((min, s) => Math.min(min, s.startBeat), Infinity);
            const safeDelta = Math.max(-minStart, deltaBeats);

            groupSnapshots.forEach((snapshot, bId) => {
              updateChordBlock(bId, { startBeat: Math.max(0, snapshot.startBeat + safeDelta) });
            });
          }
        }
      }

      setActiveDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Menú contextual en Bloque
  const handleBlockContextMenu = (e: React.MouseEvent, block: ChordBlock) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedChordIds.includes(block.id)) {
      setSelectedChordId(block.id);
      setSelectedChordIds([block.id]);
    }
    setBlockContextMenu({ x: e.clientX, y: e.clientY, block });
  };

  // Lasso / Marquee Selection en el Canvas
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.chord-block') || target.closest('.chord-properties-popover') || target.closest('.style-marker-flag')) {
      return;
    }

    if (e.button !== 0) return;
    e.preventDefault();

    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    const canvasRect = canvasEl.getBoundingClientRect();
    const startX = e.clientX - canvasRect.left;
    const startY = e.clientY - canvasRect.top;

    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setSelectedChordIds([]);
    }

    const clickedBeat = Math.max(0, Math.floor(startX / BEAT_WIDTH));
    toneEngine.seekToBeat(clickedBeat);

    setLasso({ isActive: true, startX, startY, currentX: startX, currentY: startY });

    const handleLassoMove = (moveEvent: MouseEvent) => {
      // Garantizar que no se inicie selección de texto nativa del navegador durante el arrastre
      window.getSelection()?.removeAllRanges();

      const currentX = moveEvent.clientX - canvasRect.left;
      const currentY = moveEvent.clientY - canvasRect.top;

      setLasso(prev => ({ ...prev, currentX, currentY }));

      // Calcular intersecciones con los bloques
      const minX = Math.min(startX, currentX);
      const maxX = Math.max(startX, currentX);
      const minY = Math.min(startY, currentY);
      const maxY = Math.max(startY, currentY);

      const intersectingIds: string[] = [];

      chordBlocks.forEach((b) => {
        const bLeft = b.startBeat * BEAT_WIDTH;
        const bRight = bLeft + b.durationBeats * BEAT_WIDTH;
        const bTop = 24;
        const bBottom = 76;

        const overlapsX = bLeft < maxX && bRight > minX;
        const overlapsY = bTop < maxY && bBottom > minY;

        if (overlapsX && overlapsY) {
          intersectingIds.push(b.id);
        }
      });

      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const merged = Array.from(new Set([...selectedChordIds, ...intersectingIds]));
        setSelectedChordIds(merged);
      } else {
        setSelectedChordIds(intersectingIds);
      }
    };

    const handleLassoUp = () => {
      window.removeEventListener('mousemove', handleLassoMove);
      window.removeEventListener('mouseup', handleLassoUp);
      setLasso({ isActive: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
    };

    window.addEventListener('mousemove', handleLassoMove);
    window.addEventListener('mouseup', handleLassoUp);
  };

  // Dibujar cuadrícula
  const gridLines = [];
  for (let beat = 0; beat < TOTAL_BEATS; beat += snapStep) {
    const isMeasure = beat % beatsPerMeasure === 0;
    const isBeat = beat % 1 === 0;
    gridLines.push(
      <div
        key={`grid-${beat}`}
        className={`grid-tick ${isMeasure ? 'measure' : ''}`}
        style={{
          left: `${beat * BEAT_WIDTH}px`,
          backgroundColor: isMeasure ? 'rgba(112, 96, 176, 0.25)' : isBeat ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 216, 117, 0.04)',
          width: isMeasure ? '2px' : '1px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          pointerEvents: 'none'
        }}
      >
        {isMeasure ? (
          <span
            className="measure-num"
            style={{
              userSelect: 'none',
              WebkitUserSelect: 'none',
              pointerEvents: 'none'
            }}
          >
            {Math.round(beat / beatsPerMeasure) + 1}
          </span>
        ) : null}
      </div>
    );
  }

  // Calcular posición del popover flotante
  const activePopoverBlock = chordBlocks.find(b => b.id === popoverChordId) || chordBlocks.find(b => b.id === selectedChordId);
  let popoverLeft = 0;
  if (activePopoverBlock) {
    const blockLeft = activePopoverBlock.startBeat * BEAT_WIDTH;
    const blockWidth = activePopoverBlock.durationBeats * BEAT_WIDTH;
    popoverLeft = blockLeft + (blockWidth / 2) - 130 - scrollLeft;
    popoverLeft += 12;
    const sectionWidth = viewportRef.current?.getBoundingClientRect().width || 800;
    popoverLeft = Math.max(10, popoverLeft);
    popoverLeft = Math.min(sectionWidth - 270, popoverLeft);
  }

  return (
    <div className="timeline-section">
      <UnifiedToolbar
        left={
          <>
            <ChannelQuickControl channelId="chords" />
            <ChannelInstrumentControl channelId="chords" />
          </>
        }
        center={
          <>
            {/* Subdivisión de Cuadrícula */}
            <div className="physical-segment-tray" title="Subdivisión magnética de Grid">
              <button
                type="button"
                className={`physical-segment-btn ${chordGridSnap === '1' ? 'active' : ''}`}
                onClick={() => setChordGridSnap('1')}
                title="Grid 1/1 (Negras)"
              >
                1/1
              </button>
              <button
                type="button"
                className={`physical-segment-btn ${chordGridSnap === '1/2' ? 'active' : ''}`}
                onClick={() => setChordGridSnap('1/2')}
                title="Grid 1/2 (Corcheas)"
              >
                1/2
              </button>
              <button
                type="button"
                className={`physical-segment-btn ${chordGridSnap === '1/4' ? 'active' : ''}`}
                onClick={() => setChordGridSnap('1/4')}
                title="Grid 1/4 (Semicorcheas)"
              >
                1/4
              </button>
            </div>

            {/* Style Dragger */}
            <div className="timeline-style-dragger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.68rem', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-secondary)' }}>PATRÓN:</span>
              <CustomSelect
                value={selectedStyleToDrag}
                onChange={handleStyleSelectChange}
                groups={styleGroups}
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
          </>
        }
        right={
          <PhysicalZoomControl
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            minZoom={0.4}
            maxZoom={3.0}
            step={0.15}
          />
        }
      />

      <div 
        className="timeline-viewport" 
        ref={viewportRef}
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        onScroll={(e) => {
          const left = e.currentTarget.scrollLeft;
          setScrollLeft(left);
          setChordTimelineViewport({ scrollLeft: left });
        }}
      >
        <div 
          ref={canvasRef}
          className="timeline-canvas" 
          style={{ width: `${TOTAL_BEATS * BEAT_WIDTH}px`, height: '84px', position: 'relative', userSelect: 'none', WebkitUserSelect: 'none' }}
          onMouseDown={handleCanvasMouseDown}
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
            const { draggingChord, setDraggingChord, draggingStyle, setDraggingStyle, addChordBlock: addBlock, setSelectedChordId: setSelId } = useSongStore.getState();
            const canvasRect = e.currentTarget.getBoundingClientRect();
            const dropX = e.clientX - canvasRect.left;
            const dropBeat = Math.max(0, Math.round((dropX / BEAT_WIDTH) / snapStep) * snapStep);
            
            if (draggingChord) {
              setSelId(null);
              addBlock(draggingChord, dropBeat, 4);
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
        >
          {/* Pista de Marcadores de Estilo y Tempo */}
          <TimelineMarkerTrack
            styleMarkers={styleMarkers}
            styleGroups={styleGroups}
            tempoMarkers={tempoMarkers}
            beatWidth={BEAT_WIDTH}
            snapStep={snapStep}
            activeDrag={activeDrag}
            setActiveDrag={setActiveDrag}
            updateStyleMarker={updateStyleMarker}
            removeStyleMarker={removeStyleMarker}
            addStyleMarker={addStyleMarker}
            updateTempoMarker={updateTempoMarker}
            removeTempoMarker={removeTempoMarker}
          />

          {/* Líneas de cuadrícula */}
          {gridLines}

          {/* Líneas guía verticales de cambios de tempo */}
          {tempoMarkers.map((tm) => (
            <div
              key={`tm-guide-${tm.id}`}
              style={{
                position: 'absolute',
                left: `${tm.beat * BEAT_WIDTH}px`,
                top: 0,
                bottom: 0,
                width: '1px',
                borderLeft: '1px dashed rgba(0, 229, 255, 0.45)',
                pointerEvents: 'none',
                zIndex: 2
              }}
            />
          ))}

          {/* Bloques de acordes */}
          {chordBlocks.map((block) => {
            const isSelected = selectedChordIds.includes(block.id);
            const isDraggingThis = activeDrag?.id === block.id;

            let startBeat = block.startBeat;
            let durationBeats = block.durationBeats;

            if (activeDrag) {
              if (activeDrag.id === block.id) {
                if (activeDrag.type === 'move' || activeDrag.type === 'resize_left') {
                  startBeat = activeDrag.currentStartBeat;
                }
                if (activeDrag.type === 'resize_left' || activeDrag.type === 'resize_right') {
                  durationBeats = activeDrag.currentDurationBeats;
                }
              } else if (activeDrag.type === 'move' && activeDrag.groupSnapshots?.has(block.id)) {
                const snapshot = activeDrag.groupSnapshots.get(block.id)!;
                const delta = activeDrag.currentStartBeat - activeDrag.initialStartBeat;
                startBeat = Math.max(0, snapshot.startBeat + delta);
              }
            }

            return (
              <TimelineBlock
                key={block.id}
                block={block}
                isSelected={isSelected}
                isDragging={isDraggingThis}
                startBeat={startBeat}
                durationBeats={durationBeats}
                beatWidth={BEAT_WIDTH}
                currentKey={key}
                scale={scale}
                onMouseDown={handleBlockMouseDown}
                onContextMenu={handleBlockContextMenu}
                onDoubleClick={(e, b) => {
                  e.stopPropagation();
                  setSelectedChordId(b.id);
                  setSelectedChordIds([b.id]);
                  setPopoverChordId(b.id);
                }}
              />
            );
          })}

          {/* Caja de Selección Lasso */}
          {lasso.isActive && (
            <div
              className="timeline-lasso-box"
              style={{
                position: 'absolute',
                left: `${Math.min(lasso.startX, lasso.currentX)}px`,
                top: `${Math.min(lasso.startY, lasso.currentY)}px`,
                width: `${Math.abs(lasso.currentX - lasso.startX)}px`,
                height: `${Math.abs(lasso.currentY - lasso.startY)}px`,
                border: '1px dashed rgba(255, 216, 117, 0.7)',
                backgroundColor: 'rgba(255, 216, 117, 0.1)',
                pointerEvents: 'none',
                zIndex: 20
              }}
            />
          )}

          <TimelinePlayhead beatWidth={BEAT_WIDTH} />
        </div>
      </div>

      {/* Popover de Propiedades */}
      {popoverChordId && activePopoverBlock && (
        <ChordPropertiesPanel
          popoverLeft={popoverLeft}
          blockId={activePopoverBlock.id}
          onClose={() => setPopoverChordId(null)}
        />
      )}

      {/* Menú Contextual de Bloque(s) */}
      {blockContextMenu && (
        <ContextMenuContainer
          x={blockContextMenu.x}
          y={blockContextMenu.y}
        >
          <div className="menu-header">
            <span>{selectedChordIds.length > 1 ? `${selectedChordIds.length} ACORDES SELECCIONADOS` : `ACORDE · ${blockContextMenu.block.chord}`}</span>
          </div>

          <button
            type="button"
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation();
              copySelectedChords();
              setBlockContextMenu(null);
            }}
          >
            <Copy size={13} /> Copiar (Ctrl+C)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation();
              duplicateSelectedChords();
              setBlockContextMenu(null);
            }}
          >
            <Layers size={13} /> Duplicar (Ctrl+D)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation();
              cutSelectedChords();
              setBlockContextMenu(null);
            }}
          >
            <Scissors size={13} /> Cortar (Ctrl+X)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedChordId(blockContextMenu.block.id);
              setSelectedChordIds([blockContextMenu.block.id]);
              setPopoverChordId(blockContextMenu.block.id);
              setBlockContextMenu(null);
            }}
          >
            <Grid size={13} /> Propiedades / Voicing
          </button>

          <hr className="menu-separator" />

          <button
            type="button"
            className="menu-danger"
            onClick={(e) => {
              e.stopPropagation();
              deleteSelectedChords();
              setBlockContextMenu(null);
            }}
          >
            <Trash2 size={13} /> Eliminar {selectedChordIds.length > 1 ? `(${selectedChordIds.length})` : ''}
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

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              addTempoMarker({
                id: Math.random().toString(36).substr(2, 9),
                beat: trackContextMenu.beat,
                bpm: bpm || 120
              });
              setTrackContextMenu(null);
            }}
          >
            <span style={{ color: 'var(--accent)', fontWeight: 'bold', marginRight: '4px', fontSize: '13px' }}>♩</span> Insertar Marcador de Tempo ({bpm || 120} BPM)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              pasteChords(trackContextMenu.beat);
              setTrackContextMenu(null);
            }}
          >
            <Clipboard size={14} /> Pegar aquí (Ctrl+V)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              selectAllChords();
              setTrackContextMenu(null);
            }}
          >
            <Layers size={14} /> Seleccionar Todo (Ctrl+A)
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
