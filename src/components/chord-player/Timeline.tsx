import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import type { ChordBlock } from '../../utils/typeDefinitions';
import { ChordPropertiesPanel } from './ChordPropertiesPanel';
import { CustomSelect } from '../ui/CustomSelect';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import {
  Plus,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Trash2,
  Grid,
  Copy,
  Scissors,
  Clipboard,
  Layers,
  Magnet,
  Maximize2,
  Wand2
} from 'lucide-react';
import { getDiatonicChords, type ScaleType } from '../../core/music';
import { notify } from '../../core/ui/toastBus';
import { toneEngine } from '../../audio/toneEngine';
import { ChannelQuickControl } from '../ui/ChannelQuickControl';
import { ChannelInstrumentControl } from '../ui/ChannelInstrumentControl';
import { UnifiedToolbar } from '../shared/UnifiedToolbar';
import { PhysicalZoomControl } from '../shared/PhysicalZoomControl';
import { useTimelineNavigation } from '../../hooks/useTimelineNavigation';

import { TimelinePlayhead } from './timeline/TimelinePlayhead';
import { TimelineBlock } from './timeline/TimelineBlock';
import { TimelineMarkerTrack } from './timeline/TimelineMarkerTrack';
import { useTimelineShortcuts } from './hooks/useTimelineShortcuts';

interface DragState {
  id: string;
  type: 'move' | 'resize_left' | 'resize_right' | 'move_marker' | 'move_tempo_marker';
  isCloneDrag?: boolean;
  startX: number;
  initialStartBeat: number;
  initialDurationBeats: number;
  currentStartBeat: number;
  currentDurationBeats: number;
  groupSnapshots?: Map<string, { startBeat: number; durationBeats: number; block: ChordBlock }>;
}

interface LassoState {
  isActive: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function startHorizontalEdgeAutoScroll(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  getClientX: () => number,
  onScrollTick: () => void
): () => void {
  let rafId = 0;
  const EDGE_PX = 36;
  const MAX_SPEED = 14;

  const tick = () => {
    const vp = viewportRef.current;
    if (vp) {
      const rect = vp.getBoundingClientRect();
      const x = getClientX();
      let dx = 0;
      if (x < rect.left + EDGE_PX) {
        dx = -Math.ceil(((rect.left + EDGE_PX - x) / EDGE_PX) * MAX_SPEED);
      } else if (x > rect.right - EDGE_PX) {
        dx = Math.ceil(((x - (rect.right - EDGE_PX)) / EDGE_PX) * MAX_SPEED);
      }
      if (dx !== 0) {
        const prev = vp.scrollLeft;
        vp.scrollLeft = Math.max(0, prev + dx);
        if (vp.scrollLeft !== prev) {
          onScrollTick();
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
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
    updateChordBlocksBatch,
    addChordBlocksBatch,
    splitChordBlock,
    clearChordBlocks,
    addChordBlock,
    bpm,
    tempoMarkers,
    addTempoMarker,
    removeTempoMarker,
    updateTempoMarker,
    key,
    scale,
    timeSignature,
    chordOctaveShift,
    transposeSong,
    styleMarkers,
    addStyleMarker,
    removeStyleMarker,
    updateStyleMarker,
    customPatterns,
    draggingChord,
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
    updateChordBlocksBatch: state.updateChordBlocksBatch,
    addChordBlocksBatch: state.addChordBlocksBatch,
    splitChordBlock: state.splitChordBlock,
    clearChordBlocks: state.clearChordBlocks,
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
    chordOctaveShift: state.chordOctaveShift || 0,
    transposeSong: state.transposeSong,
    styleMarkers: state.styleMarkers || [],
    addStyleMarker: state.addStyleMarker,
    removeStyleMarker: state.removeStyleMarker,
    updateStyleMarker: state.updateStyleMarker,
    customPatterns: state.customPatterns || [],
    draggingChord: state.draggingChord,
    setDraggingStyle: state.setDraggingStyle,
    chordTimelineViewport: state.chordTimelineViewport,
    setChordTimelineViewport: state.setChordTimelineViewport
  })));

  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;

  const isMajorFamily = scale === 'major' || scale === 'lydian' || scale === 'mixolydian';
  const starterLabel = isMajorFamily ? 'I–V–vi–IV' : 'i–VI–III–VII';

  const handleInsertStarterProgression = useCallback(() => {
    const diatonic = getDiatonicChords(key, (scale as ScaleType) || 'major');
    const degrees = isMajorFamily ? [0, 4, 5, 3] : [0, 5, 2, 6];
    const chords = degrees.map((deg) => diatonic[deg] || `${key}${isMajorFamily ? '' : 'm'}`);
    addChordBlocksBatch(
      chords.map((chord, idx) => ({
        chord,
        startBeat: idx * beatsPerMeasure,
        durationBeats: beatsPerMeasure
      }))
    );
    notify.success(`Progresión inicial añadida (${chords.join(' – ')})`);
  }, [key, scale, isMajorFamily, beatsPerMeasure, addChordBlocksBatch]);

  const [trackContextMenu, setTrackContextMenu] = useState<{ x: number; y: number; beat: number } | null>(null);
  const [blockContextMenu, setBlockContextMenu] = useState<{ x: number; y: number; block: ChordBlock; beat: number } | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  const [selectedStyleToDrag, setSelectedStyleToDrag] = useState<string>('hold');
  const [zoomLevel, setZoomLevel] = useState<number>(chordTimelineViewport?.zoomLevel || 1.0);
  const [lastChordDuration, setLastChordDuration] = useState<number>(beatsPerMeasure);
  const [isSliceToolActive, setIsSliceToolActive] = useState(false);
  const [slicePreviewBeat, setSlicePreviewBeat] = useState<number | null>(null);
  const [hoverDropBeat, setHoverDropBeat] = useState<number | null>(null);

  useEffect(() => {
    setChordTimelineViewport({ zoomLevel });
  }, [zoomLevel, setChordTimelineViewport]);

  const snapStep =
    chordGridSnap === 'off' ? 0.25 :
    chordGridSnap === '1/4' ? 0.25 :
    chordGridSnap === '1/2' ? 0.5 :
    1;

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

  const maxChordBeat = chordBlocks.reduce((max, b) => Math.max(max, b.startBeat + b.durationBeats), 0);
  const rawBeatsNeeded = Math.max(48, maxChordBeat + 24);
  const TOTAL_BEATS = Math.ceil(rawBeatsNeeded / beatsPerMeasure) * beatsPerMeasure;

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(chordTimelineViewport?.scrollLeft || 0);
  const [viewportWidth, setViewportWidth] = useState(1200);
  const [popoverChordId, setPopoverChordId] = useState<string | null>(null);
  const scrollPersistTimerRef = useRef<number | null>(null);

  const persistScrollLeft = useCallback((nextLeft: number) => {
    if (scrollPersistTimerRef.current !== null) {
      window.clearTimeout(scrollPersistTimerRef.current);
    }
    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null;
      setChordTimelineViewport({ scrollLeft: nextLeft });
    }, 150);
  }, [setChordTimelineViewport]);

  useEffect(() => {
    return () => {
      if (scrollPersistTimerRef.current !== null) {
        window.clearTimeout(scrollPersistTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const updateWidth = () => {
      setViewportWidth(el.clientWidth || 1200);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (viewportRef.current) {
      const targetLeft = chordTimelineViewport?.scrollLeft ?? 0;
      if (Math.abs(viewportRef.current.scrollLeft - targetLeft) > 2) {
        viewportRef.current.scrollLeft = targetLeft;
        setScrollLeft(targetLeft);
      }
    }
  }, [chordTimelineViewport?.scrollLeft]);

  const [activeDrag, setActiveDrag] = useState<DragState | null>(null);
  const [lasso, setLasso] = useState<LassoState>({ isActive: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });

  // Navegación unificada: Ctrl/Alt+Rueda Zoom al cursor, Shift+Rueda scroll, Middle-click pan
  useTimelineNavigation({
    viewportRef,
    baseBeatWidth: 40,
    zoomLevel,
    minZoom: 0.4,
    maxZoom: 3.0,
    onZoomChange: setZoomLevel,
    onScrollChange: useCallback((nextLeft: number) => {
      setScrollLeft(nextLeft);
      persistScrollLeft(nextLeft);
    }, [persistScrollLeft])
  });

  const selectedChordIdSet = useMemo(() => new Set(selectedChordIds), [selectedChordIds]);
  const visibleChordBlocks = useMemo(() => {
    const padBeats = 8;
    const minBeat = scrollLeft / BEAT_WIDTH - padBeats;
    const maxBeat = (scrollLeft + viewportWidth) / BEAT_WIDTH + padBeats;
    return chordBlocks.filter((block) => {
      if (
        block.id === popoverChordId ||
        block.id === activeDrag?.id ||
        selectedChordIdSet.has(block.id) ||
        activeDrag?.groupSnapshots?.has(block.id)
      ) {
        return true;
      }
      return block.startBeat + block.durationBeats >= minBeat && block.startBeat <= maxBeat;
    });
  }, [chordBlocks, scrollLeft, viewportWidth, BEAT_WIDTH, popoverChordId, activeDrag, selectedChordIdSet]);

  // Zoom to Fit (Ctrl+0): encuadra todos los acordes en pantalla
  const handleZoomToFit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const blocks = useSongStore.getState().chordBlocks || [];
    if (blocks.length === 0) {
      setZoomLevel(1.0);
      requestAnimationFrame(() => {
        if (viewportRef.current) viewportRef.current.scrollLeft = 0;
      });
      return;
    }

    const minBeat = Math.min(...blocks.map(b => b.startBeat));
    const maxBeat = Math.max(...blocks.map(b => b.startBeat + b.durationBeats));
    const spanBeats = Math.max(4, maxBeat - minBeat + 1);
    const viewW = Math.max(240, vp.clientWidth - 36);
    const nextPxPerBeat = viewW / spanBeats;
    const nextZoom = Math.max(0.4, Math.min(3.0, parseFloat((nextPxPerBeat / 40).toFixed(2))));

    setZoomLevel(nextZoom);
    requestAnimationFrame(() => {
      if (!viewportRef.current) return;
      const newLeft = Math.max(0, minBeat * (40 * nextZoom) - 16);
      viewportRef.current.scrollLeft = newLeft;
      setScrollLeft(newLeft);
    });
  }, []);

  const handleEscape = useCallback(() => {
    if (popoverChordId) {
      setPopoverChordId(null);
    } else if (isSliceToolActive) {
      setIsSliceToolActive(false);
      setSlicePreviewBeat(null);
    } else if (selectedChordIds.length > 0) {
      setSelectedChordIds([]);
    }
  }, [popoverChordId, isSliceToolActive, selectedChordIds.length, setSelectedChordIds]);

  const handleToggleSliceTool = useCallback(() => {
    setIsSliceToolActive(prev => {
      if (prev) setSlicePreviewBeat(null);
      return !prev;
    });
  }, []);

  useTimelineShortcuts({
    selectedChordIds,
    copySelectedChords,
    cutSelectedChords,
    pasteChords,
    duplicateSelectedChords,
    selectAllChords,
    deleteSelectedChords,
    snapStep,
    onToggleSliceTool: handleToggleSliceTool,
    onZoomToFit: handleZoomToFit,
    onEscape: handleEscape
  });

  // Limpiar hover drop ghost cuando termina drag de paleta
  useEffect(() => {
    if (!draggingChord) {
      setHoverDropBeat(null);
    }
  }, [draggingChord]);

  // Cierre de popovers y menús contextuales al hacer clic fuera
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

  // Interacción en bloques de acordes: Selección, Corte, Audición, Move, Shift+Drag Clone, Resize + Auto-Scroll
  const handleBlockMouseDown = (e: React.MouseEvent, block: ChordBlock) => {
    e.stopPropagation();

    // Shift + Right-Click rápido para dividir acorde
    if (e.button === 2 && e.shiftKey) {
      e.preventDefault();
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        const beatRaw = (e.clientX - canvasRect.left) / BEAT_WIDTH;
        const cutStep = chordGridSnap === 'off' ? 0.25 : snapStep;
        const cutBeat = Math.round(beatRaw / cutStep) * cutStep;
        splitChordBlock(block.id, cutBeat);
      }
      return;
    }

    if (e.button !== 0) return;
    e.preventDefault();

    // Modo Slice Tool (C): cortar directamente el acorde al hacer click
    if (isSliceToolActive) {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        const beatRaw = (e.clientX - canvasRect.left) / BEAT_WIDTH;
        const cutStep = chordGridSnap === 'off' ? 0.25 : snapStep;
        const cutBeat = Math.round(beatRaw / cutStep) * cutStep;
        if (cutBeat > block.startBeat + 0.05 && cutBeat < block.startBeat + block.durationBeats - 0.05) {
          splitChordBlock(block.id, cutBeat);
          setSlicePreviewBeat(null);
          return;
        }
      }
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickXRelative = e.clientX - rect.left;
    const isNearLeftEdge = clickXRelative < 10;
    const isNearRightEdge = rect.width - clickXRelative < 10;

    const isResize = isNearLeftEdge || isNearRightEdge;
    const isCloneDrag = !isResize && e.shiftKey;
    const isMultiKey = (e.ctrlKey || e.metaKey) || (e.shiftKey && !selectedChordIds.includes(block.id) && selectedChordIds.length > 0);

    if (e.ctrlKey || e.metaKey) {
      toggleSelectChordId(block.id, true);
    } else if (!selectedChordIds.includes(block.id)) {
      if (isMultiKey && !isCloneDrag) {
        toggleSelectChordId(block.id, true);
      } else {
        setSelectedChordId(block.id);
      }
    }

    toneEngine.seekToBeat(block.startBeat);
    toneEngine.playChordPreview(block.chord, chordOctaveShift);

    const type: 'move' | 'resize_left' | 'resize_right' = isNearLeftEdge
      ? 'resize_left'
      : isNearRightEdge
      ? 'resize_right'
      : 'move';

    const groupSnapshots = new Map<string, { startBeat: number; durationBeats: number; block: ChordBlock }>();
    const effectiveSelectedIds = selectedChordIds.includes(block.id)
      ? selectedChordIds
      : [block.id];

    chordBlocks.forEach((b) => {
      if (effectiveSelectedIds.includes(b.id)) {
        groupSnapshots.set(b.id, {
          startBeat: b.startBeat,
          durationBeats: b.durationBeats,
          block: b
        });
      }
    });

    const startClientX = e.clientX;
    let latestClientX = e.clientX;
    let latestAltKey = e.altKey;
    let lastComputedDeltaBeats = 0;

    setActiveDrag({
      id: block.id,
      type,
      isCloneDrag,
      startX: startClientX,
      initialStartBeat: block.startBeat,
      initialDurationBeats: block.durationBeats,
      currentStartBeat: block.startBeat,
      currentDurationBeats: block.durationBeats,
      groupSnapshots
    });

    const initialScrollLeft = viewportRef.current?.scrollLeft || 0;

    const updateDragFromClientX = (clientX: number, altKey: boolean) => {
      const currentScroll = viewportRef.current?.scrollLeft || 0;
      const scrollDelta = currentScroll - initialScrollLeft;
      const totalDeltaX = (clientX - startClientX) + scrollDelta;
      const activeSnap = altKey ? 0.125 : snapStep;
      const minDur = altKey ? 0.25 : Math.max(0.25, snapStep);

      const rawBeats = totalDeltaX / BEAT_WIDTH;
      const deltaBeats = Math.round(rawBeats / activeSnap) * activeSnap;
      lastComputedDeltaBeats = deltaBeats;

      setActiveDrag(prev => {
        if (!prev) return null;
        if (prev.type === 'move') {
          const newStart = Math.max(0, prev.initialStartBeat + deltaBeats);
          return { ...prev, currentStartBeat: newStart };
        }
        if (prev.type === 'resize_right') {
          const newDuration = Math.max(minDur, prev.initialDurationBeats + deltaBeats);
          return { ...prev, currentDurationBeats: newDuration };
        }
        if (prev.type === 'resize_left') {
          const initialEnd = prev.initialStartBeat + prev.initialDurationBeats;
          const maxStart = initialEnd - minDur;
          const newStart = Math.min(maxStart, Math.max(0, prev.initialStartBeat + deltaBeats));
          const newDuration = Math.max(minDur, initialEnd - newStart);
          return {
            ...prev,
            currentStartBeat: newStart,
            currentDurationBeats: newDuration
          };
        }
        return prev;
      });
    };

    const stopAutoScroll = startHorizontalEdgeAutoScroll(
      viewportRef,
      () => latestClientX,
      () => updateDragFromClientX(latestClientX, latestAltKey)
    );

    const handleMouseMove = (moveEvent: MouseEvent) => {
      window.getSelection()?.removeAllRanges();
      latestClientX = moveEvent.clientX;
      latestAltKey = moveEvent.altKey;
      updateDragFromClientX(moveEvent.clientX, moveEvent.altKey);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      stopAutoScroll();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      latestClientX = upEvent.clientX;
      latestAltKey = upEvent.altKey;
      updateDragFromClientX(upEvent.clientX, upEvent.altKey);

      const finalScroll = viewportRef.current?.scrollLeft || 0;
      const totalDistanceX = Math.abs((upEvent.clientX - startClientX) + (finalScroll - initialScrollLeft));
      const minDur = upEvent.altKey ? 0.25 : Math.max(0.25, snapStep);
      const deltaBeats = lastComputedDeltaBeats;

      if (totalDistanceX >= 4) {
        if (type === 'resize_right') {
          const finalDuration = Math.max(minDur, block.durationBeats + deltaBeats);
          setLastChordDuration(finalDuration);
          updateChordBlock(block.id, { durationBeats: finalDuration });
        } else if (type === 'resize_left') {
          const initialEnd = block.startBeat + block.durationBeats;
          const maxStart = initialEnd - minDur;
          const finalStart = Math.min(maxStart, Math.max(0, block.startBeat + deltaBeats));
          const finalDuration = Math.max(minDur, initialEnd - finalStart);
          setLastChordDuration(finalDuration);
          updateChordBlock(block.id, { startBeat: finalStart, durationBeats: finalDuration });
        } else if (type === 'move' && groupSnapshots.size > 0 && deltaBeats !== 0) {
          const minStart = Array.from(groupSnapshots.values()).reduce((min, s) => Math.min(min, s.startBeat), Infinity);
          const safeDelta = Math.max(-minStart, deltaBeats);

          if (safeDelta !== 0) {
            if (isCloneDrag) {
              const clonesToAdd: Array<Omit<ChordBlock, 'id'>> = [];
              groupSnapshots.forEach((snapshot) => {
                const { id: _ignored, ...rest } = snapshot.block;
                clonesToAdd.push({
                  ...rest,
                  startBeat: Math.max(0, snapshot.startBeat + safeDelta)
                });
              });
              addChordBlocksBatch(clonesToAdd);
            } else {
              const updates: Array<{ id: string; changes: Partial<Omit<ChordBlock, 'id'>> }> = [];
              groupSnapshots.forEach((snapshot, bId) => {
                updates.push({
                  id: bId,
                  changes: { startBeat: Math.max(0, snapshot.startBeat + safeDelta) }
                });
              });
              updateChordBlocksBatch(updates);
            }
          }
        }
      }

      setActiveDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleBlockMouseMove = useCallback((e: React.MouseEvent, block: ChordBlock) => {
    if (!isSliceToolActive) {
      if (slicePreviewBeat !== null) setSlicePreviewBeat(null);
      return;
    }
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const beatRaw = (e.clientX - canvasRect.left) / BEAT_WIDTH;
    const cutStep = chordGridSnap === 'off' ? 0.25 : snapStep;
    const cutBeat = Math.round(beatRaw / cutStep) * cutStep;
    if (cutBeat > block.startBeat + 0.05 && cutBeat < block.startBeat + block.durationBeats - 0.05) {
      setSlicePreviewBeat(cutBeat);
    } else {
      setSlicePreviewBeat(null);
    }
  }, [isSliceToolActive, slicePreviewBeat, BEAT_WIDTH, chordGridSnap, snapStep]);

  const handleBlockContextMenu = (e: React.MouseEvent, block: ChordBlock) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) return;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const rawBeat = canvasRect ? (e.clientX - canvasRect.left) / BEAT_WIDTH : block.startBeat + block.durationBeats / 2;
    const snappedBeat = Math.round(rawBeat / snapStep) * snapStep;

    if (!selectedChordIds.includes(block.id)) {
      setSelectedChordId(block.id);
      setSelectedChordIds([block.id]);
    }
    setBlockContextMenu({ x: e.clientX, y: e.clientY, block, beat: snappedBeat });
  };

  // Lasso / Marquee Selection en el Canvas con Edge Auto-Scroll
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
    const initialSelected = [...selectedChordIds];

    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setSelectedChordIds([]);
    }

    const clickedBeat = Math.max(0, Math.round((startX / BEAT_WIDTH) / snapStep) * snapStep);
    toneEngine.seekToBeat(clickedBeat);

    let latestClientX = e.clientX;
    let latestClientY = e.clientY;
    setLasso({ isActive: true, startX, startY, currentX: startX, currentY: startY });

    const updateLassoFromClient = (clientX: number, clientY: number, additive: boolean) => {
      const rectNow = canvasRef.current?.getBoundingClientRect();
      if (!rectNow) return;
      const currentX = clientX - rectNow.left;
      const currentY = clientY - rectNow.top;
      setLasso(prev => ({ ...prev, currentX, currentY }));

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
        if (bLeft < maxX && bRight > minX && bTop < maxY && bBottom > minY) {
          intersectingIds.push(b.id);
        }
      });

      if (additive) {
        setSelectedChordIds(Array.from(new Set([...initialSelected, ...intersectingIds])));
      } else {
        setSelectedChordIds(intersectingIds);
      }
    };

    const stopAutoScroll = startHorizontalEdgeAutoScroll(
      viewportRef,
      () => latestClientX,
      () => updateLassoFromClient(latestClientX, latestClientY, e.shiftKey || e.ctrlKey || e.metaKey)
    );

    const handleLassoMove = (moveEvent: MouseEvent) => {
      window.getSelection()?.removeAllRanges();
      latestClientX = moveEvent.clientX;
      latestClientY = moveEvent.clientY;
      updateLassoFromClient(
        moveEvent.clientX,
        moveEvent.clientY,
        moveEvent.shiftKey || moveEvent.ctrlKey || moveEvent.metaKey
      );
    };

    const handleLassoUp = () => {
      stopAutoScroll();
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

  // Posición del popover flotante
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

  // Bloques fantasma de clonado (Shift + Drag)
  const clonePreviewBlocks: Array<{ id: string; chord: string; startBeat: number; durationBeats: number }> = [];
  if (activeDrag?.isCloneDrag && activeDrag.groupSnapshots) {
    const delta = activeDrag.currentStartBeat - activeDrag.initialStartBeat;
    const minStart = Array.from(activeDrag.groupSnapshots.values()).reduce((m, s) => Math.min(m, s.startBeat), Infinity);
    const safeDelta = Math.max(-minStart, delta);
    if (safeDelta !== 0) {
      activeDrag.groupSnapshots.forEach((snap, bId) => {
        clonePreviewBlocks.push({
          id: bId,
          chord: snap.block.chord,
          startBeat: Math.max(0, snap.startBeat + safeDelta),
          durationBeats: snap.durationBeats
        });
      });
    }
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
            {/* Subdivisión de Cuadrícula con Magnet Snap */}
            <div className="physical-segment-tray" title="Subdivisión magnética de Grid (Mantén Alt al arrastrar para ajuste fino)">
              <button
                type="button"
                className={`physical-segment-btn ${chordGridSnap === 'off' ? '' : 'active'}`}
                onClick={() => setChordGridSnap(chordGridSnap === 'off' ? '1' : 'off')}
                title={chordGridSnap === 'off' ? 'Grid Snap desactivado' : 'Grid Snap activo (Alt para bypass temporal)'}
              >
                <Magnet size={12} style={{ color: chordGridSnap === 'off' ? 'var(--text-secondary)' : '#ffd875' }} />
              </button>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {/* Herramienta Corte / Slice (C) */}
            <button
              type="button"
              className={`physical-btn ${isSliceToolActive ? 'active' : ''}`}
              onClick={handleToggleSliceTool}
              title="Herramienta Corte / Slice (C · también Shift+Click derecho sobre acorde)"
              style={isSliceToolActive ? { borderColor: 'rgba(255, 107, 107, 0.55)', boxShadow: 'inset 0 0 8px rgba(255, 107, 107, 0.2)' } : undefined}
            >
              <Scissors size={13} style={{ color: isSliceToolActive ? '#ff6b6b' : 'var(--text-secondary)' }} />
            </button>

            {/* Zoom to Fit (Ctrl+0) */}
            <button
              type="button"
              className="physical-btn"
              onClick={handleZoomToFit}
              title="Encuadrar progresión completa (Ctrl+0)"
            >
              <Maximize2 size={13} />
            </button>

            {/* Limpiar acordes */}
            <button
              type="button"
              className="physical-btn"
              onClick={() => { if (chordBlocks.length > 0) setIsClearConfirmOpen(true); }}
              disabled={chordBlocks.length === 0}
              title="Limpiar todos los acordes de la pista armónica"
            >
              <Trash2 size={13} style={{ color: '#ef5350' }} />
            </button>

            <PhysicalZoomControl
              zoomLevel={zoomLevel}
              onZoomChange={setZoomLevel}
              minZoom={0.4}
              maxZoom={3.0}
              step={0.15}
            />
          </div>
        }
      />

      <div 
        className="timeline-viewport" 
        ref={viewportRef}
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        onScroll={(e) => {
          const left = e.currentTarget.scrollLeft;
          setScrollLeft(left);
          persistScrollLeft(left);
        }}
      >
        <div 
          ref={canvasRef}
          className="timeline-canvas" 
          style={{ width: `${TOTAL_BEATS * BEAT_WIDTH}px`, height: '84px', position: 'relative', userSelect: 'none', WebkitUserSelect: 'none' }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={(e) => {
            if (draggingChord) {
              const canvasRect = e.currentTarget.getBoundingClientRect();
              const hoverX = e.clientX - canvasRect.left;
              const beat = Math.max(0, Math.round((hoverX / BEAT_WIDTH) / snapStep) * snapStep);
              setHoverDropBeat(beat);
            }
          }}
          onMouseLeave={() => {
            setHoverDropBeat(null);
            setSlicePreviewBeat(null);
          }}
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
              addChordBlock(chord, dropBeat, lastChordDuration);
              setHoverDropBeat(null);
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
            const { draggingChord: activeDragChord, setDraggingChord, draggingStyle, setDraggingStyle, addChordBlock: addBlock, setSelectedChordId: setSelId } = useSongStore.getState();
            const canvasRect = e.currentTarget.getBoundingClientRect();
            const dropX = e.clientX - canvasRect.left;
            const dropBeat = Math.max(0, Math.round((dropX / BEAT_WIDTH) / snapStep) * snapStep);
            
            if (activeDragChord) {
              setSelId(null);
              addBlock(activeDragChord, dropBeat, lastChordDuration);
              toneEngine.playChordPreviewStop(activeDragChord);
              setDraggingChord(null);
              setHoverDropBeat(null);
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

          {/* Preview de Drop desde la Paleta */}
          {draggingChord && hoverDropBeat !== null && (
            <div
              className="chord-drop-ghost"
              style={{
                left: `${hoverDropBeat * BEAT_WIDTH}px`,
                width: `${Math.max(18, lastChordDuration * BEAT_WIDTH - 4)}px`
              }}
            >
              <span>{draggingChord}</span>
            </div>
          )}

          {/* Bloques de acordes */}
          {visibleChordBlocks.map((block) => {
            const isSelected = selectedChordIds.includes(block.id);
            const isDraggingThis = activeDrag?.id === block.id;

            let startBeat = block.startBeat;
            let durationBeats = block.durationBeats;

            // Si estamos en Shift+Drag Clone, los originales permanecen fijos y los clones siguen el cursor
            if (activeDrag && !activeDrag.isCloneDrag) {
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
                isDragging={isDraggingThis && !activeDrag?.isCloneDrag}
                isSliceToolActive={isSliceToolActive}
                startBeat={startBeat}
                durationBeats={durationBeats}
                beatWidth={BEAT_WIDTH}
                currentKey={key}
                scale={scale}
                onMouseDown={handleBlockMouseDown}
                onMouseMove={handleBlockMouseMove}
                onMouseLeave={() => { if (slicePreviewBeat !== null) setSlicePreviewBeat(null); }}
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

          {/* Fantasmas de clonación en vivo (Shift + Drag) */}
          {clonePreviewBlocks.map((clone) => (
            <div
              key={`clone-${clone.id}`}
              className="chord-clone-ghost"
              style={{
                left: `${clone.startBeat * BEAT_WIDTH}px`,
                width: `${Math.max(14, clone.durationBeats * BEAT_WIDTH - 4)}px`
              }}
            >
              <span>{clone.chord}</span>
            </div>
          ))}

          {/* Guía visual de corte (Slice Tool) */}
          {isSliceToolActive && slicePreviewBeat !== null && (
            <div
              className="chord-slice-guide"
              style={{ left: `${slicePreviewBeat * BEAT_WIDTH}px` }}
            />
          )}

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

        {/* Estado vacío interactivo centrado en el viewport visible (sin bloquear drag & drop) */}
        {chordBlocks.length === 0 && !draggingChord && (
          <div className="timeline-empty-anchor" aria-live="polite">
            <div className="timeline-empty-state">
              <span className="timeline-empty-hint">
                Arrastra acordes desde la paleta o empieza al instante:
              </span>
              <button
                type="button"
                className="timeline-starter-btn"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleInsertStarterProgression}
                title={`Insertar progresión ${starterLabel} en ${key} ${scale}`}
              >
                <Wand2 size={12} />
                <span>Insertar {starterLabel} ({key} {scale})</span>
              </button>
            </div>
          </div>
        )}
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
              const blk = blockContextMenu.block;
              const mid = blk.startBeat + blk.durationBeats / 2;
              const targetSplit =
                blockContextMenu.beat > blk.startBeat + 0.05 && blockContextMenu.beat < blk.startBeat + blk.durationBeats - 0.05
                  ? blockContextMenu.beat
                  : mid;
              splitChordBlock(blk.id, targetSplit);
              setBlockContextMenu(null);
            }}
            disabled={blockContextMenu.block.durationBeats <= 0.5}
          >
            <Scissors size={13} /> Dividir acorde aquí (C)
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
              addChordBlock('C', trackContextMenu.beat, lastChordDuration);
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
              setIsClearConfirmOpen(true);
              setTrackContextMenu(null);
            }}
          >
            <Trash2 size={14} /> Limpiar Pista Armónica
          </button>
        </ContextMenuContainer>
      )}

      <ConfirmModal
        isOpen={isClearConfirmOpen}
        title="Limpiar Pista Armónica"
        message="¿Estás seguro de que quieres eliminar todos los acordes del timeline armónico?"
        confirmText="Limpiar Acordes"
        cancelText="Cancelar"
        onConfirm={() => {
          clearChordBlocks();
          setIsClearConfirmOpen(false);
        }}
        onCancel={() => setIsClearConfirmOpen(false)}
      />
    </div>
  );
};
