import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { noteToMod12, SCALE_INTERVALS } from '../../core/music';
import type { MelodyNote, NoteClass, ScaleType } from '../../utils/typeDefinitions';
import type { PianoRollGridSnap } from '../../store/types';
import {
  Trash2,
  Copy,
  Scissors,
  Search,
  ChevronRight,
  Layers,
  Lightbulb,
  Magnet,
  Ghost,
  Music,
  Wand2,
  Maximize2,
  Sparkles,
  ArrowUpDown,
  ArrowLeftRight,
  RotateCcw
} from 'lucide-react';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { ScaleFinderSection } from './ScaleFinderSection';
import { ChannelQuickControl } from '../ui/ChannelQuickControl';
import { useGridZoom } from '../../hooks/useGridZoom';
import { SharedTimelineRuler } from '../shared/SharedTimelineRuler';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ChannelInstrumentControl } from '../ui/ChannelInstrumentControl';
import { UnifiedToolbar } from '../shared/UnifiedToolbar';
import { PhysicalZoomControl } from '../shared/PhysicalZoomControl';

import { PianoRollSidebar } from './sidebar/PianoRollSidebar';
import { PianoRollTrackHeader } from './tracks/PianoRollTrackHeader';
import { PianoRollCanvas } from './canvas/PianoRollCanvas';
import { VelocityLane } from './velocity/VelocityLane';
import { PianoRollTransformsPopover, type TransformTab } from './tools/PianoRollTransformsPopover';
import { usePianoRollShortcuts } from './hooks/usePianoRollShortcuts';
import { usePianoRollInteractions } from './hooks/usePianoRollInteractions';
import {
  MIN_MIDI,
  MAX_MIDI,
  NOTE_COUNT,
  getSnapStepBeats,
  midiToNoteName,
  applyFlipTransform,
  type EphemeralDragState
} from './utils/pianoRollUtils';

export const PianoRollView: React.FC = () => {
  const {
    melodyNotes,
    addMelodyNote,
    removeMelodyNote,
    updateMelodyNote,
    removeMelodyNotesBatch,
    updateMelodyNotesBatch,
    setMelodyNotes,
    pianoRollGridSnap,
    setPianoRollGridSnap,
    setCurrentBeat,
    key,
    scale,
    setKey,
    setScale,
    chordBlocks,
    tracks,
    activeTrackId,
    addPianoRollTrack,
    removePianoRollTrack,
    renamePianoRollTrack,
    setTrackColor,
    setActiveTrackId,
    updateTrackViewport,
    clipboardNotes,
    setClipboardNotes
  } = useSongStore(useShallow(state => ({
    melodyNotes: state.melodyNotes || [],
    addMelodyNote: state.addMelodyNote,
    removeMelodyNote: state.removeMelodyNote,
    updateMelodyNote: state.updateMelodyNote,
    removeMelodyNotesBatch: state.removeMelodyNotesBatch,
    updateMelodyNotesBatch: state.updateMelodyNotesBatch,
    setMelodyNotes: state.setMelodyNotes,
    pianoRollGridSnap: state.pianoRollGridSnap || '1/4',
    setPianoRollGridSnap: state.setPianoRollGridSnap,
    setCurrentBeat: state.setCurrentBeat,
    key: state.key || 'C',
    scale: state.scale || 'major',
    setKey: state.setKey,
    setScale: state.setScale,
    chordBlocks: state.chordBlocks || [],
    tracks: state.tracks || [],
    activeTrackId: state.activeTrackId,
    addPianoRollTrack: state.addPianoRollTrack,
    removePianoRollTrack: state.removePianoRollTrack,
    renamePianoRollTrack: state.renamePianoRollTrack,
    setTrackColor: state.setTrackColor,
    setActiveTrackId: state.setActiveTrackId,
    updateTrackViewport: state.updateTrackViewport,
    clipboardNotes: state.clipboardNotes || [],
    setClipboardNotes: state.setClipboardNotes
  })));

  const containerRef = useRef<HTMLDivElement>(null);
  const pianoRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);

  // Arquitectura 0ms: estado efímero en Ref y trigger para re-renderizado aislado
  const ephemeralDragRef = useRef<EphemeralDragState | null>(null);
  const [renderTrigger, setRenderTrigger] = useState(0);
  const triggerNotesRedraw = useCallback(() => {
    setRenderTrigger(prev => (prev + 1) | 0);
  }, []);

  const currentTrack = (tracks && tracks.length > 0) ? (tracks.find(t => t.id === activeTrackId) || tracks[0]) : null;
  const currentChannelId = currentTrack?.channelId || 'melody';

  // Estados de control y herramientas FL Studio+
  const [selectedNoteLength, setSelectedNoteLength] = useState<number>(1);
  const [isScaleHighlightActive, setIsScaleHighlightActive] = useState(true);
  const [isGhostNotesActive, setIsGhostNotesActive] = useState(true);
  const [isChordHighlightActive, setIsChordHighlightActive] = useState(true);
  const [isSliceToolActive, setIsSliceToolActive] = useState(false);

  // Velocity Lane & Transformaciones
  const [isVelocityCollapsed, setIsVelocityCollapsed] = useState(false);
  const [velocityLaneHeight, setVelocityLaneHeight] = useState(110);
  const [isTransformsOpen, setIsTransformsOpen] = useState(false);
  const [transformsTab, setTransformsTab] = useState<TransformTab>('strum');

  // UX de Selección
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [isScaleFinderOpen, setIsScaleFinderOpen] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{ isOpen: boolean; trackId: string; trackName: string; type: 'track' | 'clear' }>({ isOpen: false, trackId: '', trackName: '', type: 'track' });

  // Zoom y dimensiones
  const { rowHeight, beatWidth, setRowHeight, setBeatWidth, TOTAL_BEATS, beatsPerMeasure } = useGridZoom();

  const canvasWidth = TOTAL_BEATS * beatWidth;
  const canvasHeight = NOTE_COUNT * rowHeight;

  // Cálculo de afinaciones de la escala activa
  const rootMidiMod = useMemo(() => noteToMod12(key || 'C'), [key]);
  const scalePitchClasses = useMemo(() => {
    const scaleKey = (scale || 'major') as ScaleType;
    const intervals = (SCALE_INTERVALS && SCALE_INTERVALS[scaleKey]) ? SCALE_INTERVALS[scaleKey] : [0, 2, 4, 5, 7, 9, 11];
    return new Set(intervals.map(i => ((rootMidiMod + i) % 12 + 12) % 12));
  }, [scale, rootMidiMod]);

  const pianoKeys = useMemo(() => {
    const keys = [];
    for (let m = MAX_MIDI; m >= MIN_MIDI; m--) {
      const isBlack = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
      keys.push({
        midi: m,
        name: midiToNoteName(m),
        isBlack
      });
    }
    return keys;
  }, []);

  // Debounce de 200ms para el guardado de scroll en el Store
  const scrollDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollTop } = e.currentTarget;
    if (pianoRef.current) {
      pianoRef.current.scrollTop = scrollTop;
    }

    if (scrollDebounceTimerRef.current) {
      clearTimeout(scrollDebounceTimerRef.current);
    }

    scrollDebounceTimerRef.current = setTimeout(() => {
      const activeId = useSongStore.getState().activeTrackId;
      if (activeId) {
        useSongStore.getState().updateTrackViewport(activeId, {
          scrollLeft,
          scrollTop
        });
      }
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (scrollDebounceTimerRef.current) {
        clearTimeout(scrollDebounceTimerRef.current);
      }
    };
  }, []);

  // 1. Restauración completa de Viewport (Scroll + Zoom) al alternar de pista activa
  const prevActiveTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevActiveTrackIdRef.current === activeTrackId) return;
    prevActiveTrackIdRef.current = activeTrackId;

    const activeTrack = (tracks || []).find(t => t.id === activeTrackId);
    if (activeTrack && activeTrack.viewport) {
      if (typeof activeTrack.viewport.beatWidth === 'number') {
        setBeatWidth(activeTrack.viewport.beatWidth);
      }
      if (typeof activeTrack.viewport.rowHeight === 'number') {
        setRowHeight(activeTrack.viewport.rowHeight);
      }
      if (containerRef.current) {
        containerRef.current.scrollLeft = activeTrack.viewport.scrollLeft ?? 0;
        containerRef.current.scrollTop = activeTrack.viewport.scrollTop ?? 600;
      }
      if (pianoRef.current) {
        pianoRef.current.scrollTop = activeTrack.viewport.scrollTop ?? 600;
      }
    }
  }, [activeTrackId, setBeatWidth, setRowHeight, tracks]);

  // 2. Persistir cambios de Zoom (beatWidth y rowHeight) en la pista activa
  useEffect(() => {
    if (activeTrackId) {
      updateTrackViewport(activeTrackId, { beatWidth, rowHeight });
    }
  }, [beatWidth, rowHeight, activeTrackId, updateTrackViewport]);

  // 3. Reaccionar a reseteo explícito de scrollLeft a 0 (ej. al pulsar la tecla W)
  const currentTrackScrollLeft = currentTrack?.viewport?.scrollLeft;
  useEffect(() => {
    if (currentTrackScrollLeft === 0 && containerRef.current && containerRef.current.scrollLeft !== 0) {
      containerRef.current.scrollLeft = 0;
    }
  }, [currentTrackScrollLeft]);

  // Zoom to Fit (Ctrl+0): encuadra todas las notas de la pista activa en pantalla
  const handleZoomToFit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const notes = useSongStore.getState().melodyNotes || [];
    if (notes.length === 0) {
      setBeatWidth(96);
      setRowHeight(24);
      requestAnimationFrame(() => {
        container.scrollLeft = 0;
        const centerTop = Math.max(0, (MAX_MIDI - 68) * 24);
        container.scrollTop = centerTop;
        if (pianoRef.current) pianoRef.current.scrollTop = centerTop;
      });
      return;
    }

    let minBeat = Infinity;
    let maxBeat = -Infinity;
    let minMidi = Infinity;
    let maxMidi = -Infinity;

    for (const n of notes) {
      if (n.startBeat < minBeat) minBeat = n.startBeat;
      if (n.startBeat + n.durationBeats > maxBeat) maxBeat = n.startBeat + n.durationBeats;
      if (n.midi < minMidi) minMidi = n.midi;
      if (n.midi > maxMidi) maxMidi = n.midi;
    }

    const spanBeats = Math.max(4, maxBeat - minBeat + 1);
    const spanSemitones = Math.max(8, maxMidi - minMidi + 6);

    const viewW = Math.max(300, container.clientWidth - 40);
    const viewH = Math.max(180, container.clientHeight - 60);

    const nextBeatWidth = Math.max(48, Math.min(240, Math.floor(viewW / spanBeats)));
    const nextRowHeight = Math.max(14, Math.min(48, Math.floor(viewH / spanSemitones)));

    setBeatWidth(nextBeatWidth);
    setRowHeight(nextRowHeight);

    requestAnimationFrame(() => {
      const targetLeft = Math.max(0, minBeat * nextBeatWidth - 24);
      const topMidi = Math.min(MAX_MIDI, maxMidi + 3);
      const targetTop = Math.max(0, (MAX_MIDI - topMidi) * nextRowHeight);
      container.scrollLeft = targetLeft;
      container.scrollTop = targetTop;
      if (pianoRef.current) pianoRef.current.scrollTop = targetTop;
    });
  }, [setBeatWidth, setRowHeight]);

  const handleOpenTransforms = useCallback((tab: TransformTab) => {
    setTransformsTab(tab);
    setIsTransformsOpen(true);
  }, []);

  const handleEscape = useCallback(() => {
    if (isTransformsOpen) {
      setIsTransformsOpen(false);
    } else if (isSliceToolActive) {
      setIsSliceToolActive(false);
    } else if (selectedNoteIds.length > 0) {
      setSelectedNoteIds([]);
    }
  }, [isTransformsOpen, isSliceToolActive, selectedNoteIds.length]);

  const handleToggleVelocityLane = useCallback(() => {
    setIsVelocityCollapsed(prev => !prev);
  }, []);

  const handleToggleGhostNotes = useCallback(() => {
    setIsGhostNotesActive(prev => !prev);
  }, []);

  const handleToggleSliceTool = useCallback(() => {
    setIsSliceToolActive(prev => !prev);
  }, []);

  // Hook de atajos de teclado DAW profesionales
  usePianoRollShortcuts({
    selectedNoteIds,
    setSelectedNoteIds,
    melodyNotes,
    removeMelodyNote,
    updateMelodyNote,
    removeMelodyNotesBatch,
    updateMelodyNotesBatch,
    setMelodyNotes,
    clipboardNotes,
    setClipboardNotes,
    currentChannelId,
    gridSnap: pianoRollGridSnap,
    onToggleVelocityLane: handleToggleVelocityLane,
    onToggleGhostNotes: handleToggleGhostNotes,
    onToggleSliceTool: handleToggleSliceTool,
    onOpenTransforms: handleOpenTransforms,
    onZoomToFit: handleZoomToFit,
    onEscape: handleEscape
  });

  // Hook de interacción con ratón y lienzo (0ms latency, clonado Shift+Drag, slice y auto-scroll)
  const {
    lassoRect,
    tempNote,
    contextMenu,
    setContextMenu,
    handleMouseDown,
    handleMouseMoveIdle
  } = usePianoRollInteractions({
    contentWrapperRef,
    containerRef,
    pianoRef,
    melodyNotes,
    tracks,
    activeTrackId,
    setActiveTrackId,
    addMelodyNote,
    removeMelodyNote,
    updateMelodyNote,
    updateMelodyNotesBatch,
    setMelodyNotes,
    selectedNoteIds,
    setSelectedNoteIds,
    selectedNoteLength,
    setSelectedNoteLength,
    beatWidth,
    rowHeight,
    currentChannelId,
    gridSnap: pianoRollGridSnap,
    ephemeralDragRef,
    triggerNotesRedraw,
    isSliceToolActive,
    isGhostNotesActive
  });

  // Zoom interactivo centrado y soporte Shift + Wheel para scroll horizontal
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
        return;
      }

      if (e.altKey) {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const currentBeat = (container.scrollLeft + mouseX) / beatWidth;

        setBeatWidth((prev) => {
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          const next = Math.max(48, Math.min(240, Math.round(prev * factor)));
          if (next === prev) return prev;

          requestAnimationFrame(() => {
            container.scrollLeft = Math.max(0, currentBeat * next - mouseX);
          });
          return next;
        });
      } else if (e.ctrlKey) {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const rulerHeight = 42;
        const currentY = container.scrollTop + mouseY - rulerHeight;
        const currentNoteFraction = currentY / (NOTE_COUNT * rowHeight);

        setRowHeight((prev) => {
          const delta = e.deltaY < 0 ? 2 : -2;
          const next = Math.max(14, Math.min(48, Math.round(prev + delta)));
          if (next === prev) return prev;

          requestAnimationFrame(() => {
            const newY = currentNoteFraction * (NOTE_COUNT * next);
            const newScrollTop = Math.max(0, newY - mouseY + rulerHeight);
            container.scrollTop = newScrollTop;
            if (pianoRef.current) {
              pianoRef.current.scrollTop = newScrollTop;
            }
          });
          return next;
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    const handleMiddleMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = container.scrollLeft;
      const startTop = container.scrollTop;
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = 'grabbing';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        container.scrollLeft = Math.max(0, startLeft - (moveEvent.clientX - startX));
        const nextTop = Math.max(0, startTop - (moveEvent.clientY - startY));
        container.scrollTop = nextTop;
        if (pianoRef.current) {
          pianoRef.current.scrollTop = nextTop;
        }
      };

      const handleMouseUp = () => {
        document.body.style.cursor = prevCursor;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    };

    container.addEventListener('mousedown', handleMiddleMouseDown);
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMiddleMouseDown);
    };
  }, [setBeatWidth, setRowHeight, beatWidth, rowHeight]);

  useEffect(() => {
    if (containerRef.current && pianoRef.current) {
      pianoRef.current.scrollTop = containerRef.current.scrollTop;
    }
  }, [rowHeight]);

  const handleClearMelody = () => {
    if ((melodyNotes || []).length === 0) return;
    setConfirmModalConfig({
      isOpen: true,
      trackId: activeTrackId,
      trackName: currentTrack ? currentTrack.name : 'Melodía',
      type: 'clear'
    });
  };

  // Lógica de Tresillos (3T) en la bandeja de Grid Snap
  const isTripletSnap = pianoRollGridSnap === '1/3' || pianoRollGridSnap === '1/6' || pianoRollGridSnap === '1/12';
  const handleToggleTriplets = () => {
    if (pianoRollGridSnap === '1/2') setPianoRollGridSnap('1/3');
    else if (pianoRollGridSnap === '1/4') setPianoRollGridSnap('1/6');
    else if (pianoRollGridSnap === '1/8') setPianoRollGridSnap('1/12');
    else if (pianoRollGridSnap === '1/3') setPianoRollGridSnap('1/2');
    else if (pianoRollGridSnap === '1/6') setPianoRollGridSnap('1/4');
    else if (pianoRollGridSnap === '1/12') setPianoRollGridSnap('1/8');
    else setPianoRollGridSnap('1/6');
  };

  const snapOptions: PianoRollGridSnap[] = isTripletSnap
    ? ['1', '1/3', '1/6', '1/12', '1/16']
    : ['1', '1/2', '1/4', '1/8', '1/16'];

  const handleQuickFlipFromMenu = (mode: 'vertical' | 'horizontal') => {
    const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
    if (selected.length === 0) return;
    const overrides = applyFlipTransform(selected, mode);
    const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];
    overrides.forEach((changes, id) => updates.push({ id, changes }));
    if (updates.length > 0) updateMelodyNotesBatch(updates);
  };

  return (
    <div className="piano-roll-container" style={{ position: 'relative' }}>
      {/* Barra de herramientas unificada */}
      <UnifiedToolbar
        left={
          <>
            <ChannelQuickControl channelId={currentChannelId} />
            <ChannelInstrumentControl channelId={currentChannelId} />

            {/* Scale Highlighting */}
            <button
              type="button"
              className={`physical-btn ${isScaleHighlightActive ? 'active' : ''}`}
              onClick={() => setIsScaleHighlightActive(!isScaleHighlightActive)}
              title="Iluminar notas de la escala en cuadrícula y teclado"
            >
              <Lightbulb size={13} style={{ color: isScaleHighlightActive ? '#ffd875' : 'var(--text-secondary)' }} />
            </button>

            {/* Ghost Notes (Pistas hermanas) */}
            <button
              type="button"
              className={`physical-btn ${isGhostNotesActive ? 'active' : ''}`}
              onClick={handleToggleGhostNotes}
              title="Mostrar notas fantasma de otras pistas (G · Alt+DobleClick salta de pista)"
              style={isGhostNotesActive ? { borderColor: 'rgba(0, 229, 255, 0.5)', boxShadow: 'inset 0 0 8px rgba(0, 229, 255, 0.16)' } : undefined}
            >
              <Ghost size={13} style={{ color: isGhostNotesActive ? '#00e5ff' : 'var(--text-secondary)' }} />
            </button>

            {/* Chord Tone Highlighting */}
            <button
              type="button"
              className={`physical-btn ${isChordHighlightActive ? 'active' : ''}`}
              onClick={() => setIsChordHighlightActive(!isChordHighlightActive)}
              title="Resaltar notas del acorde activo en la cuadrícula"
            >
              <Music size={13} style={{ color: isChordHighlightActive ? '#ffd875' : 'var(--text-secondary)' }} />
            </button>
          </>
        }
        center={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Segmento de Duración de Nota por Defecto */}
            <div className="physical-segment-tray">
              <button
                type="button"
                className={`physical-segment-btn ${selectedNoteLength === 4 ? 'active' : ''}`}
                onClick={() => setSelectedNoteLength(4)}
                title="Redonda (4 beats)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" style={{ transform: 'rotate(-20deg)' }}>
                  <ellipse cx="12" cy="12" rx="7" ry="4.5" />
                </svg>
              </button>
              <button
                type="button"
                className={`physical-segment-btn ${selectedNoteLength === 2 ? 'active' : ''}`}
                onClick={() => setSelectedNoteLength(2)}
                title="Blanca (2 beats)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                  <ellipse cx="9" cy="15" rx="5" ry="3.5" stroke="currentColor" strokeWidth="2" transform="rotate(-20 9 15)" />
                  <line x1="13.5" y1="15" x2="13.5" y2="4" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                type="button"
                className={`physical-segment-btn ${selectedNoteLength === 1 ? 'active' : ''}`}
                onClick={() => setSelectedNoteLength(1)}
                title="Negra (1 beat)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <ellipse cx="9" cy="15" rx="5" ry="3.5" transform="rotate(-20 9 15)" />
                  <line x1="13.5" y1="15" x2="13.5" y2="4" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                type="button"
                className={`physical-segment-btn ${selectedNoteLength === 0.5 ? 'active' : ''}`}
                onClick={() => setSelectedNoteLength(0.5)}
                title="Corchea (1/2 beat)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <ellipse cx="8" cy="15" rx="4.5" ry="3" transform="rotate(-20 8 15)" />
                  <line x1="12.2" y1="15" x2="12.2" y2="4" stroke="currentColor" strokeWidth="2" />
                  <path d="M12.2,4 Q16.5,7 15.5,11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                className={`physical-segment-btn ${selectedNoteLength === 0.25 ? 'active' : ''}`}
                onClick={() => setSelectedNoteLength(0.25)}
                title="Semicorchea (1/4 beat)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <ellipse cx="8" cy="15" rx="4.5" ry="3" transform="rotate(-20 8 15)" />
                  <line x1="12.2" y1="15" x2="12.2" y2="4" stroke="currentColor" strokeWidth="2" />
                  <path d="M12.2,4 Q16.5,7 15.5,11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M12.2,7 Q16.5,10 15.5,14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="toolbar-divider-vertical" style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color, rgba(255,255,255,0.12))', margin: '0 2px' }} />

            {/* Bandeja de Grid Snap + Tresillos (3T) */}
            <div className="physical-segment-tray">
              <button
                type="button"
                className={`physical-segment-btn ${pianoRollGridSnap === 'off' ? '' : 'active'}`}
                onClick={() => setPianoRollGridSnap(pianoRollGridSnap === 'off' ? '1/4' : 'off')}
                title={pianoRollGridSnap === 'off' ? 'Grid Snap desactivado' : 'Grid Snap activo (mantén Alt para bypass temporal)'}
              >
                <Magnet size={12} style={{ color: pianoRollGridSnap === 'off' ? 'var(--text-secondary)' : '#ffd875' }} />
              </button>
              <button
                type="button"
                className={`physical-segment-btn ${isTripletSnap ? 'active' : ''}`}
                onClick={handleToggleTriplets}
                title="Alternar subdivisión de Tresillos (1/3, 1/6, 1/12)"
                style={{ fontSize: '10px', minWidth: '24px', padding: '0 4px', fontWeight: 700 }}
              >
                3T
              </button>
              {snapOptions.map(snap => (
                <button
                  key={snap}
                  type="button"
                  className={`physical-segment-btn ${pianoRollGridSnap === snap ? 'active' : ''}`}
                  onClick={() => setPianoRollGridSnap(snap)}
                  title={`Grid Snap ${snap}`}
                  style={{ fontSize: '10px', minWidth: '22px', padding: '0 4px', fontWeight: pianoRollGridSnap === snap ? 700 : 500 }}
                >
                  {snap}
                </button>
              ))}
            </div>
          </div>
        }
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {/* Herramienta Slice / Corte (C o Shift+RightDrag) */}
            <button
              type="button"
              className={`physical-btn ${isSliceToolActive ? 'active' : ''}`}
              onClick={handleToggleSliceTool}
              title="Herramienta Corte / Slice (C · también Shift+Click derecho)"
              style={isSliceToolActive ? { borderColor: 'rgba(255, 107, 107, 0.55)', boxShadow: 'inset 0 0 8px rgba(255, 107, 107, 0.2)' } : undefined}
            >
              <Scissors size={13} style={{ color: isSliceToolActive ? '#ff6b6b' : 'var(--text-secondary)' }} />
            </button>

            {/* Transformaciones Musicales (Strum / Humanize / Chop) */}
            <button
              type="button"
              className={`physical-btn ${isTransformsOpen ? 'active' : ''}`}
              onClick={() => setIsTransformsOpen(prev => !prev)}
              title="Transformadores musicales: Strum (Alt+S), Humanize (Alt+R), Chop/Flip (Alt+U)"
            >
              <Wand2 size={13} style={{ color: isTransformsOpen ? '#ffd875' : 'var(--text-secondary)' }} />
            </button>

            {/* Zoom to Fit (Ctrl+0) */}
            <button
              type="button"
              className="physical-btn"
              onClick={handleZoomToFit}
              title="Encuadrar melodía completa (Ctrl+0)"
            >
              <Maximize2 size={13} />
            </button>

            {/* Botón Limpiar Melodía (Trash) */}
            <button
              type="button"
              className="physical-btn"
              onClick={handleClearMelody}
              title="Limpiar todas las notas de la pista activa"
            >
              <Trash2 size={13} style={{ color: '#ef5350' }} />
            </button>

            {/* Control de Zoom Físico */}
            <PhysicalZoomControl
              zoomLevel={beatWidth / 80}
              onZoomIn={() => setBeatWidth(prev => Math.min(240, Math.round(prev * 1.15)))}
              onZoomOut={() => setBeatWidth(prev => Math.max(48, Math.round(prev / 1.15)))}
              onResetZoom={() => setBeatWidth(80)}
            />
          </div>
        }
      />

      {/* Popover flotante de Transformadores Musicales */}
      <PianoRollTransformsPopover
        isOpen={isTransformsOpen}
        activeTab={transformsTab}
        onChangeTab={setTransformsTab}
        onClose={() => setIsTransformsOpen(false)}
        melodyNotes={melodyNotes}
        selectedNoteIds={selectedNoteIds}
        setSelectedNoteIds={setSelectedNoteIds}
        ephemeralDragRef={ephemeralDragRef}
        triggerNotesRedraw={triggerNotesRedraw}
        updateMelodyNotesBatch={updateMelodyNotesBatch}
        setMelodyNotes={setMelodyNotes}
      />

      {/* Franja Independiente de Pistas de Melodía */}
      <PianoRollTrackHeader
        tracks={tracks}
        activeTrackId={activeTrackId}
        setActiveTrackId={setActiveTrackId}
        addPianoRollTrack={addPianoRollTrack}
        removePianoRollTrack={removePianoRollTrack}
        renamePianoRollTrack={renamePianoRollTrack}
        setTrackColor={setTrackColor}
        onRequestDeleteTrack={(trackId, trackName) => {
          setConfirmModalConfig({ isOpen: true, trackId, trackName, type: 'track' });
        }}
      />

      {/* Workspace */}
      <div className="piano-roll-workspace">
        <div className="piano-sidebar-wrapper">
          <div
            className="piano-sidebar"
            ref={pianoRef}
            onWheel={(e) => {
              if (containerRef.current) {
                containerRef.current.scrollTop += e.deltaY;
              }
            }}
            style={{
              height: '100%',
              overflowY: 'hidden',
              position: 'relative'
            }}
          >
            {/* Espaciador de alineación vertical con la regla del canvas */}
            <div
              className="sidebar-spacer"
              style={{
                height: '42px',
                minHeight: '42px',
                maxHeight: '42px',
                boxSizing: 'border-box',
                position: 'sticky',
                top: 0,
                zIndex: 15,
                backgroundColor: '#1c1924',
                borderBottom: '2px solid var(--border-color)',
                borderRight: '1px solid var(--border-color)',
                flexShrink: 0
              }}
            />

            <PianoRollSidebar
              rowHeight={rowHeight}
              pianoKeys={pianoKeys}
              scalePitchClasses={scalePitchClasses}
              rootMidiMod={rootMidiMod}
              isScaleHighlightActive={isScaleHighlightActive}
            />
          </div>
        </div>

        <div
          className="canvas-container"
          ref={containerRef}
          onScroll={handleScroll}
          style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'auto' }}
        >
          {/* Regla de compases compartida y sincronizada */}
          <SharedTimelineRuler
            TOTAL_BEATS={TOTAL_BEATS}
            beatWidth={beatWidth}
            canvasWidth={canvasWidth}
            chordBlocks={chordBlocks}
            setCurrentBeat={setCurrentBeat}
            beatsPerMeasure={beatsPerMeasure}
          />

          <PianoRollCanvas
            canvasRef={canvasRef}
            contentWrapperRef={contentWrapperRef}
            containerRef={containerRef}
            beatWidth={beatWidth}
            rowHeight={rowHeight}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            TOTAL_BEATS={TOTAL_BEATS}
            beatsPerMeasure={beatsPerMeasure}
            chordBlocks={chordBlocks}
            selectedNoteIds={selectedNoteIds}
            lassoRect={lassoRect}
            tempNote={tempNote}
            scalePitchClasses={scalePitchClasses}
            rootMidiMod={rootMidiMod}
            isScaleHighlightActive={isScaleHighlightActive}
            isGhostNotesActive={isGhostNotesActive}
            isChordHighlightActive={isChordHighlightActive}
            gridSnap={pianoRollGridSnap}
            ephemeralDragRef={ephemeralDragRef}
            renderTrigger={renderTrigger}
            handleMouseDown={handleMouseDown}
            handleMouseMoveIdle={handleMouseMoveIdle}
          />
        </div>
      </div>

      {/* Carril inferior dedicado a Velocity (Cero edición accidental) */}
      <VelocityLane
        containerRef={containerRef}
        beatWidth={beatWidth}
        TOTAL_BEATS={TOTAL_BEATS}
        beatsPerMeasure={beatsPerMeasure}
        selectedNoteIds={selectedNoteIds}
        ephemeralDragRef={ephemeralDragRef}
        renderTrigger={renderTrigger}
        triggerNotesRedraw={triggerNotesRedraw}
        updateMelodyNotesBatch={updateMelodyNotesBatch}
        currentChannelId={currentChannelId}
        height={velocityLaneHeight}
        onResizeHeight={setVelocityLaneHeight}
        isCollapsed={isVelocityCollapsed}
        onToggleCollapse={handleToggleVelocityLane}
      />

      {/* Menú Contextual Flotante del Piano Roll */}
      {contextMenu && (
        <ContextMenuContainer
          x={contextMenu.x}
          y={contextMenu.y}
        >
          {contextMenu.type === 'notes' ? (
            <>
              <div className="menu-header">
                <span>{selectedNoteIds.length > 1 ? `${selectedNoteIds.length} NOTAS SELECCIONADAS` : 'NOTA SELECCIONADA'}</span>
              </div>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
                  if (selected.length > 0) setClipboardNotes(selected);
                  setContextMenu(null);
                }}
              >
                <Copy size={13} /> Copiar (Ctrl+C)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
                  if (selected.length > 0) {
                    setClipboardNotes(selected);
                    removeMelodyNotesBatch(selectedNoteIds);
                    setSelectedNoteIds([]);
                  }
                  setContextMenu(null);
                }}
              >
                <Scissors size={13} /> Cortar (Ctrl+X)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
                  if (selected.length > 0) {
                    const snapStep = getSnapStepBeats(pianoRollGridSnap);
                    const minStart = Math.min(...selected.map(n => n.startBeat));
                    const maxEnd = Math.max(...selected.map(n => n.startBeat + n.durationBeats));
                    const span = Math.max(snapStep, maxEnd - minStart);
                    const duplicatedNotes: MelodyNote[] = selected.map(n => ({
                      id: `dup_${Math.random().toString(36).substr(2, 9)}`,
                      note: n.note,
                      midi: n.midi,
                      startBeat: n.startBeat + span,
                      durationBeats: n.durationBeats,
                      velocity: n.velocity ?? 0.8
                    }));
                    setMelodyNotes([...(melodyNotes || []), ...duplicatedNotes]);
                    setSelectedNoteIds(duplicatedNotes.map(n => n.id));
                  }
                  setContextMenu(null);
                }}
              >
                <Layers size={13} /> Duplicar (Ctrl+D)
              </button>

              <hr className="menu-separator" />

              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  handleOpenTransforms('strum');
                  setContextMenu(null);
                }}
              >
                <Wand2 size={13} /> Strum / Rasgueo (Alt+S)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  handleOpenTransforms('humanize');
                  setContextMenu(null);
                }}
              >
                <Sparkles size={13} /> Humanize (Alt+R)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  handleOpenTransforms('chop');
                  setContextMenu(null);
                }}
              >
                <Scissors size={13} /> Chop / Subdividir (Alt+U)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  handleQuickFlipFromMenu('vertical');
                  setContextMenu(null);
                }}
              >
                <ArrowUpDown size={13} /> Flip Pitch (Vertical)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  handleQuickFlipFromMenu('horizontal');
                  setContextMenu(null);
                }}
              >
                <ArrowLeftRight size={13} /> Flip Tiempo (Horizontal)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  updateMelodyNotesBatch(selectedNoteIds.map(id => ({ id, changes: { velocity: 0.8 } })));
                  setContextMenu(null);
                }}
              >
                <RotateCcw size={13} /> Reset Velocity (80%)
              </button>

              <hr className="menu-separator" />
              <button
                type="button"
                className="menu-danger"
                onClick={() => {
                  removeMelodyNotesBatch(selectedNoteIds);
                  setSelectedNoteIds([]);
                  setContextMenu(null);
                }}
              >
                <Trash2 size={13} /> Eliminar ({selectedNoteIds.length})
              </button>
            </>
          ) : (
            <>
              <div className="menu-header">
                <span>PIANO ROLL · BEAT {contextMenu.beat ?? 0}</span>
              </div>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  if (clipboardNotes && clipboardNotes.length > 0) {
                    const targetBeat = contextMenu.beat ?? 0;
                    const minStart = Math.min(...clipboardNotes.map(n => n.startBeat));
                    const pasted = clipboardNotes.map(n => ({
                      id: `pasted_${Math.random().toString(36).substr(2, 9)}`,
                      note: n.note,
                      midi: n.midi,
                      startBeat: targetBeat + (n.startBeat - minStart),
                      durationBeats: n.durationBeats,
                      velocity: n.velocity ?? 0.8
                    }));
                    setMelodyNotes([...(melodyNotes || []), ...pasted]);
                    setSelectedNoteIds(pasted.map(n => n.id));
                  }
                  setContextMenu(null);
                }}
                disabled={!clipboardNotes || clipboardNotes.length === 0}
              >
                <Copy size={13} /> Pegar aquí (Ctrl+V)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setSelectedNoteIds((melodyNotes || []).map(n => n.id));
                  setContextMenu(null);
                }}
              >
                <Layers size={13} /> Seleccionar Todo (Ctrl+A)
              </button>

              <hr className="menu-separator" />

              {/* Opción desplegable del Scale Finder */}
              <button
                type="button"
                className="menu-item-expandable"
                onClick={() => setIsScaleFinderOpen(!isScaleFinderOpen)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Search size={14} />
                  <span>Scale Finder</span>
                </div>
                <ChevronRight size={14} className={`chevron-icon ${isScaleFinderOpen ? 'open' : ''}`} />
              </button>

              {isScaleFinderOpen && (
                <ScaleFinderSection
                  selectedNoteIds={selectedNoteIds}
                  melodyNotes={melodyNotes}
                  currentKey={key}
                  currentScale={scale}
                  onSelectScale={(newKey: NoteClass, newScale: ScaleType) => {
                    setKey(newKey);
                    setScale(newScale);
                    setContextMenu(null);
                    setIsScaleFinderOpen(false);
                  }}
                />
              )}

              <hr className="menu-separator" />

              <button
                type="button"
                className="menu-danger"
                onClick={() => {
                  handleClearMelody();
                  setContextMenu(null);
                }}
              >
                <Trash2 size={13} /> Limpiar Pista Melódica
              </button>
            </>
          )}
        </ContextMenuContainer>
      )}

      {/* Modal de confirmación para eliminar pista o limpiar notas */}
      <ConfirmModal
        isOpen={confirmModalConfig.isOpen}
        title={confirmModalConfig.type === 'track' ? `¿Eliminar "${confirmModalConfig.trackName}"?` : `¿Limpiar notas de "${confirmModalConfig.trackName}"?`}
        message={confirmModalConfig.type === 'track' ? "Esta pista contiene notas. Se borrará permanentemente junto con su contenido." : "Se eliminarán todas las notas de esta pista de forma irreversible."}
        confirmText={confirmModalConfig.type === 'track' ? "Eliminar Pista" : "Limpiar Notas"}
        isDanger={true}
        onConfirm={() => {
          if (confirmModalConfig.type === 'track') {
            const trackIndex = (tracks || []).findIndex(t => t.id === confirmModalConfig.trackId);
            if (activeTrackId === confirmModalConfig.trackId) {
              const newActiveTrack = tracks[trackIndex - 1] || tracks[trackIndex + 1];
              if (newActiveTrack) setActiveTrackId(newActiveTrack.id);
            }
            removePianoRollTrack(confirmModalConfig.trackId);
          } else {
            setMelodyNotes([]);
            setSelectedNoteIds([]);
          }
          setConfirmModalConfig(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmModalConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
