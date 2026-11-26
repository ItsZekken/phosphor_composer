import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { ConfirmModal } from '../ui/ConfirmModal';
import { PhysicalZoomControl } from '../shared/PhysicalZoomControl';
import { useTimelineNavigation } from '../../hooks/useTimelineNavigation';
import { isTypingTarget, isModalBlockingShortcuts } from '../../core/shortcuts/isTypingTarget';
import { toneEngine } from '../../audio/toneEngine';
import { liveTelemetryBus } from '../../core/audio/liveTelemetryBus';
import {
  MAX_DRUM_LANES,
  getEffectiveDrumLaneCount,
  normalizePatternChainToLinear,
  type LinearDrumClip
} from '../../utils/typeDefinitions';
import {
  Copy,
  Scissors,
  Clipboard,
  Layers,
  Trash2,
  Magnet,
  Maximize2,
  Repeat,
  Wand2,
  Sparkles,
  Play,
  VolumeX,
  Volume2,
  Plus,
  X
} from 'lucide-react';

const PATTERN_PALETTE = [
  '#5a9e7a', // P1 Reposo Verde
  '#d4a843', // P2 Ámbar
  '#5e87d6', // P3 Azul
  '#c45d9c', // P4 Magenta
  '#8c73e6', // P5 Violeta
  '#45b8ac', // P6 Turquesa
  '#e06c6c', // P7 Coral
  '#7d98b3', // P8 Acero
  '#b8a04b', // P9 Ocre
  '#a270b5', // P10 Orquídea
  '#6fa882', // P11 Menta
  '#e5a93c'  // P12 Oro
];

type DrumSnapGrid = '1' | '0.5' | '0.25' | 'off';

interface DragClipState {
  id: string;
  mode: 'move' | 'resize_left' | 'resize_right';
  isCloneDrag: boolean;
  initialStartMeasure: number;
  initialDurationMeasures: number;
  initialLaneIndex: number;
  currentStartMeasure: number;
  currentDurationMeasures: number;
  currentLaneDelta: number;
  snapshots: Map<string, LinearDrumClip>;
}

interface LassoState {
  isActive: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function startDrumEdgeAutoScroll(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  getClientX: () => number,
  onScrolled: () => void
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
          onScrolled();
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

const formatMeasureRange = (startM: number, durM: number): string => {
  const startDisp = Math.round(startM * 100) / 100 + 1;
  const endM = startM + durM;
  if (Math.abs(durM - 1) < 0.01 && Number.isInteger(startM)) {
    return `c.${startDisp}`;
  }
  const endDisp = Math.round(endM * 100) / 100;
  return `c.${startDisp}–${Number.isInteger(endM) ? endDisp : endDisp.toFixed(1)}`;
};

export const PatternChainArranger: React.FC = () => {
  const {
    patternChain,
    drumLaneCount,
    drumLaneMuted,
    drumChannels,
    patternLengths,
    chordBlocks,
    tracks,
    timeSignature,
    isPatternRepeatOn,
    setPatternRepeatOn,
    currentDrumPatternEdit,
    setCurrentDrumPatternEdit,
    isPlaying,
    selectedChainIds,
    setSelectedChainIds,
    toggleSelectChainId,
    selectAllChainItems,
    copySelectedChainItems,
    cutSelectedChainItems,
    pasteChainItems,
    duplicateSelectedChainItems,
    deleteSelectedChainItems,
    addDrumLane,
    removeDrumLane,
    toggleMuteDrumLane,
    addChainItem,
    addChainItemsBatch,
    updateChainItem,
    updateChainItemsBatch,
    splitChainItem,
    makeChainItemUnique,
    fillChainToSong,
    clearPatternChain,
    removeChainItem,
    toggleMuteChainItem,
    chainClipboard,
    drumTimelineViewport,
    setDrumTimelineViewport
  } = useSongStore(useShallow(state => ({
    patternChain: state.patternChain || [],
    drumLaneCount: state.drumLaneCount || 1,
    drumLaneMuted: state.drumLaneMuted || [],
    drumChannels: state.drumChannels || [],
    patternLengths: state.patternLengths || [],
    chordBlocks: state.chordBlocks || [],
    tracks: state.tracks || [],
    timeSignature: state.timeSignature || '4/4',
    isPatternRepeatOn: state.isPatternRepeatOn,
    setPatternRepeatOn: state.setPatternRepeatOn,
    currentDrumPatternEdit: state.currentDrumPatternEdit,
    setCurrentDrumPatternEdit: state.setCurrentDrumPatternEdit,
    isPlaying: state.isPlaying,
    selectedChainIds: state.selectedChainIds || [],
    setSelectedChainIds: state.setSelectedChainIds,
    toggleSelectChainId: state.toggleSelectChainId,
    selectAllChainItems: state.selectAllChainItems,
    copySelectedChainItems: state.copySelectedChainItems,
    cutSelectedChainItems: state.cutSelectedChainItems,
    pasteChainItems: state.pasteChainItems,
    duplicateSelectedChainItems: state.duplicateSelectedChainItems,
    deleteSelectedChainItems: state.deleteSelectedChainItems,
    addDrumLane: state.addDrumLane,
    removeDrumLane: state.removeDrumLane,
    toggleMuteDrumLane: state.toggleMuteDrumLane,
    addChainItem: state.addChainItem,
    addChainItemsBatch: state.addChainItemsBatch,
    updateChainItem: state.updateChainItem,
    updateChainItemsBatch: state.updateChainItemsBatch,
    splitChainItem: state.splitChainItem,
    makeChainItemUnique: state.makeChainItemUnique,
    fillChainToSong: state.fillChainToSong,
    clearPatternChain: state.clearPatternChain,
    removeChainItem: state.removeChainItem,
    toggleMuteChainItem: state.toggleMuteChainItem,
    chainClipboard: state.chainClipboard || [],
    drumTimelineViewport: state.drumTimelineViewport,
    setDrumTimelineViewport: state.setDrumTimelineViewport
  })));

  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
  const totalPatterns = drumChannels[0]?.patterns?.length || 8;
  const linearClips = useMemo(() => normalizePatternChainToLinear(patternChain), [patternChain]);
  const effectiveLaneCount = useMemo(
    () => getEffectiveDrumLaneCount(patternChain, drumLaneCount),
    [patternChain, drumLaneCount]
  );
  const isMultiLane = effectiveLaneCount > 1;
  const laneHeightPx = isMultiLane ? 60 : 76;

  const [zoomLevel, setZoomLevel] = useState<number>(drumTimelineViewport?.zoomLevel || 1.0);
  const [snapGrid, setSnapGrid] = useState<DrumSnapGrid>('1');
  const [isSliceToolActive, setIsSliceToolActive] = useState(false);
  const [slicePreviewMeasure, setSlicePreviewMeasure] = useState<number | null>(null);
  const [draggingBrushIdx, setDraggingBrushIdx] = useState<number | null>(null);
  const [hoverDrop, setHoverDrop] = useState<{ measure: number; laneIndex: number } | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragClipState | null>(null);
  const [lasso, setLasso] = useState<LassoState>({ isActive: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [lanePendingDelete, setLanePendingDelete] = useState<{ laneIndex: number; clipCount: number } | null>(null);

  const [clipContextMenu, setClipContextMenu] = useState<{ x: number; y: number; clip: LinearDrumClip; measure: number } | null>(null);
  const [trackContextMenu, setTrackContextMenu] = useState<{ x: number; y: number; measure: number; laneIndex: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const lanesStackRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  const BASE_MEASURE_WIDTH = 96;
  const MEASURE_WIDTH = Math.max(44, Math.round(BASE_MEASURE_WIDTH * zoomLevel));
  const snapMeasures = snapGrid === 'off' ? 0.25 : Number(snapGrid);

  // Calcular longitud total en compases acoplada a Acordes, Melodías y Clips de Batería
  const songSpanMeasures = useMemo(() => {
    const maxChordBeat = chordBlocks.reduce((m, b) => Math.max(m, b.startBeat + b.durationBeats), 0);
    const maxMelodyBeat = tracks.reduce(
      (m, t) => Math.max(m, (t.notes || []).reduce((nm, n) => Math.max(nm, n.startBeat + n.durationBeats), 0)),
      0
    );
    const songBeats = Math.max(maxChordBeat, maxMelodyBeat);
    return Math.ceil(songBeats / beatsPerMeasure);
  }, [chordBlocks, tracks, beatsPerMeasure]);

  const maxClipEndMeasure = useMemo(
    () => linearClips.reduce((m, c) => Math.max(m, c.startMeasure + c.durationMeasures), 0),
    [linearClips]
  );

  const totalMeasures = Math.max(16, songSpanMeasures + 4, Math.ceil(maxClipEndMeasure) + 6);
  const canvasWidth = totalMeasures * MEASURE_WIDTH;

  useEffect(() => {
    setDrumTimelineViewport({ zoomLevel });
  }, [zoomLevel, setDrumTimelineViewport]);

  useEffect(() => {
    if (viewportRef.current) {
      const targetLeft = drumTimelineViewport?.scrollLeft ?? 0;
      if (Math.abs(viewportRef.current.scrollLeft - targetLeft) > 2) {
        viewportRef.current.scrollLeft = targetLeft;
      }
    }
  }, [drumTimelineViewport?.scrollLeft]);

  const clipRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const activePlayingClipIdsRef = useRef<Set<string>>(new Set());
  const scrollPersistTimerRef = useRef<number | null>(null);

  const persistScrollLeft = useCallback((nextLeft: number) => {
    if (scrollPersistTimerRef.current !== null) {
      window.clearTimeout(scrollPersistTimerRef.current);
    }
    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null;
      setDrumTimelineViewport({ scrollLeft: nextLeft });
    }, 150);
  }, [setDrumTimelineViewport]);

  useEffect(() => {
    return () => {
      if (scrollPersistTimerRef.current !== null) {
        window.clearTimeout(scrollPersistTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const clearAllPlaying = () => {
      activePlayingClipIdsRef.current.forEach((id) => {
        const el = clipRefs.current.get(id);
        if (el) {
          el.classList.remove('playing');
          const icon = el.querySelector('.drum-clip-play-icon') as HTMLElement | null;
          if (icon) icon.style.display = 'none';
        }
      });
      activePlayingClipIdsRef.current.clear();
    };

    if (!isPlaying || isPatternRepeatOn) {
      clearAllPlaying();
      return;
    }

    return liveTelemetryBus.subscribeDrumStep(({ activeChainItemIds }) => {
      const nextSet = new Set(activeChainItemIds);
      activePlayingClipIdsRef.current.forEach((prevId) => {
        if (!nextSet.has(prevId)) {
          const prevEl = clipRefs.current.get(prevId);
          if (prevEl) {
            prevEl.classList.remove('playing');
            const prevIcon = prevEl.querySelector('.drum-clip-play-icon') as HTMLElement | null;
            if (prevIcon) prevIcon.style.display = 'none';
          }
        }
      });
      nextSet.forEach((id) => {
        const nextEl = clipRefs.current.get(id);
        if (nextEl) {
          nextEl.classList.add('playing');
          const nextIcon = nextEl.querySelector('.drum-clip-play-icon') as HTMLElement | null;
          if (nextIcon) nextIcon.style.display = 'inline-block';
        }
      });
      activePlayingClipIdsRef.current = nextSet;
    });
  }, [isPlaying, isPatternRepeatOn, linearClips, selectedChainIds]);

  // Navegación unificada: Ctrl/Alt+Wheel anchored zoom, Shift+Wheel scroll, Middle-click pan
  useTimelineNavigation({
    viewportRef,
    baseBeatWidth: BASE_MEASURE_WIDTH / beatsPerMeasure,
    zoomLevel,
    minZoom: 0.45,
    maxZoom: 2.5,
    onZoomChange: setZoomLevel,
    onScrollChange: useCallback((nextLeft: number) => {
      persistScrollLeft(nextLeft);
    }, [persistScrollLeft])
  });

  // Playhead de alta frecuencia (60 FPS sin causar re-renders en React)
  useEffect(() => {
    const updatePos = () => {
      if (playheadRef.current) {
        const beat = isPlaying ? toneEngine.getLiveBeat() : (useSongStore.getState().currentBeat || 0);
        const measure = beat / beatsPerMeasure;
        playheadRef.current.style.transform = `translate3d(${measure * MEASURE_WIDTH}px, 0, 0)`;
      }
    };

    if (!isPlaying) {
      updatePos();
      const unsub = useSongStore.subscribe((s) => {
        if (!s.isPlaying && playheadRef.current) {
          playheadRef.current.style.transform = `translate3d(${((s.currentBeat || 0) / beatsPerMeasure) * MEASURE_WIDTH}px, 0, 0)`;
        }
      });
      return unsub;
    }

    let rafId = 0;
    const loop = () => {
      updatePos();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, MEASURE_WIDTH, beatsPerMeasure]);

  // Precomputar matriz compacta de hits por patrón para miniaturas visuales en clips
  const patternPreviewHits = useMemo(() => {
    const previewMap = new Map<number, Array<Array<{ stepIdx: number; totalSteps: number; rowIdx: number }>>>();
    const visibleChannels = drumChannels.slice(0, 6);
    for (let p = 0; p < totalPatterns; p++) {
      const patLen = patternLengths[p] || 16;
      const rows: Array<Array<{ stepIdx: number; totalSteps: number; rowIdx: number }>> = [];
      visibleChannels.forEach((ch, rIdx) => {
        const rowHits: Array<{ stepIdx: number; totalSteps: number; rowIdx: number }> = [];
        const steps = ch.patterns?.[p] || [];
        for (let s = 0; s < Math.min(patLen, steps.length); s++) {
          if (steps[s]?.isActive) {
            rowHits.push({ stepIdx: s, totalSteps: patLen, rowIdx: rIdx });
          }
        }
        if (rowHits.length > 0) rows.push(rowHits);
      });
      previewMap.set(p, rows);
    }
    return previewMap;
  }, [drumChannels, patternLengths, totalPatterns]);

  // Zoom to Fit (Ctrl+0)
  const handleZoomToFit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const span = Math.max(4, songSpanMeasures, maxClipEndMeasure);
    const viewW = Math.max(300, vp.clientWidth - 24);
    const nextZoom = Math.max(0.45, Math.min(2.5, parseFloat(((viewW / span) / BASE_MEASURE_WIDTH).toFixed(2))));
    setZoomLevel(nextZoom);
    requestAnimationFrame(() => {
      if (viewportRef.current) viewportRef.current.scrollLeft = 0;
    });
  }, [songSpanMeasures, maxClipEndMeasure]);

  // Cierre de menús al hacer clic fuera
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.custom-context-menu')) {
        setClipContextMenu(null);
        setTrackContextMenu(null);
      }
      if (
        !target.closest('.drum-linear-clip') &&
        !target.closest('.custom-context-menu') &&
        !target.closest('.pattern-chain-header') &&
        !lasso.isActive
      ) {
        if (selectedChainIds.length > 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          setSelectedChainIds([]);
        }
      }
    };
    window.addEventListener('mousedown', handleGlobalClick);
    return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, [selectedChainIds.length, setSelectedChainIds, lasso.isActive]);

  // Atajos unificados del Timeline de Batería (guarded por activeView === 'sequencer')
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useSongStore.getState();
      if (state.activeView !== 'sequencer' || isModalBlockingShortcuts(state)) {
        return;
      }
      if (isTypingTarget(e.target)) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const keyLower = e.key.toLowerCase();

      if (e.key === 'Escape') {
        e.preventDefault();
        if (isSliceToolActive) {
          setIsSliceToolActive(false);
          setSlicePreviewMeasure(null);
        } else if (clipContextMenu || trackContextMenu) {
          setClipContextMenu(null);
          setTrackContextMenu(null);
        } else if (selectedChainIds.length > 0) {
          setSelectedChainIds([]);
        }
        return;
      }

      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        handleZoomToFit();
        return;
      }

      if (!isCtrlOrCmd && !e.altKey && !e.shiftKey && keyLower === 'c') {
        e.preventDefault();
        setIsSliceToolActive(prev => !prev);
        return;
      }

      if (!isCtrlOrCmd && !e.altKey && !e.shiftKey && keyLower === 'm' && selectedChainIds.length > 0) {
        e.preventDefault();
        selectedChainIds.forEach((cid) => toggleMuteChainItem(cid));
        return;
      }

      if (isCtrlOrCmd && keyLower === 'c') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          copySelectedChainItems();
        }
        return;
      }
      if (isCtrlOrCmd && keyLower === 'x') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          cutSelectedChainItems();
        }
        return;
      }
      if (isCtrlOrCmd && keyLower === 'v') {
        e.preventDefault();
        pasteChainItems();
        return;
      }
      if (isCtrlOrCmd && keyLower === 'd') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          duplicateSelectedChainItems();
        }
        return;
      }
      if (isCtrlOrCmd && keyLower === 'a') {
        e.preventDefault();
        selectAllChainItems();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          deleteSelectedChainItems();
        }
        return;
      }

      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isCtrlOrCmd && selectedChainIds.length > 0) {
        e.preventDefault();
        const step = e.altKey ? 0.25 : snapMeasures;
        const delta = (e.key === 'ArrowRight' ? 1 : -1) * step;
        const selected = linearClips.filter(c => selectedChainIds.includes(c.id));
        if (selected.length === 0) return;

        if (e.shiftKey) {
          updateChainItemsBatch(
            selected.map(c => ({
              id: c.id,
              changes: { durationMeasures: Math.max(0.25, c.durationMeasures + delta) }
            }))
          );
        } else {
          const minStart = selected.reduce((m, c) => Math.min(m, c.startMeasure), Infinity);
          const safeDelta = Math.max(-minStart, delta);
          if (safeDelta !== 0) {
            updateChainItemsBatch(
              selected.map(c => ({
                id: c.id,
                changes: { startMeasure: Math.max(0, c.startMeasure + safeDelta) }
              }))
            );
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isSliceToolActive,
    clipContextMenu,
    trackContextMenu,
    selectedChainIds,
    setSelectedChainIds,
    linearClips,
    snapMeasures,
    handleZoomToFit,
    copySelectedChainItems,
    cutSelectedChainItems,
    pasteChainItems,
    duplicateSelectedChainItems,
    selectAllChainItems,
    deleteSelectedChainItems,
    updateChainItemsBatch,
    toggleMuteChainItem
  ]);

  // Scrubbing desde regla de compases
  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const seekFromClientX = (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, clientX - rect.left);
      const rawMeasure = x / MEASURE_WIDTH;
      const snappedMeasure = Math.max(0, Math.round(rawMeasure / 0.25) * 0.25);
      toneEngine.seekToBeat(snappedMeasure * beatsPerMeasure);
    };

    seekFromClientX(e.clientX);
    const onMove = (me: MouseEvent) => seekFromClientX(me.clientX);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Interacción sobre clip lineal: Move, Shift+Drag Clone, Resize L/R, Slice
  const handleClipMouseDown = (e: React.MouseEvent, clip: LinearDrumClip) => {
    e.stopPropagation();

    if (e.button === 2 && e.shiftKey) {
      e.preventDefault();
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        const mRaw = (e.clientX - canvasRect.left) / MEASURE_WIDTH;
        const splitM = Math.round(mRaw / snapMeasures) * snapMeasures;
        splitChainItem(clip.id, splitM);
      }
      return;
    }

    if (e.button !== 0) return;
    e.preventDefault();

    if (isSliceToolActive) {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        const mRaw = (e.clientX - canvasRect.left) / MEASURE_WIDTH;
        const cutStep = snapGrid === 'off' ? 0.25 : snapMeasures;
        const cutM = Math.round(mRaw / cutStep) * cutStep;
        if (cutM > clip.startMeasure + 0.125 && cutM < clip.startMeasure + clip.durationMeasures - 0.125) {
          splitChainItem(clip.id, cutM);
          setSlicePreviewMeasure(null);
          return;
        }
      }
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const isNearLeft = relX < 9;
    const isNearRight = rect.width - relX < 9;
    const mode: 'move' | 'resize_left' | 'resize_right' =
      isNearLeft ? 'resize_left' : isNearRight ? 'resize_right' : 'move';
    const isCloneDrag = mode === 'move' && e.shiftKey;

    if (e.ctrlKey || e.metaKey) {
      toggleSelectChainId(clip.id, true);
    } else if (!selectedChainIds.includes(clip.id)) {
      setSelectedChainIds([clip.id]);
    }

    setCurrentDrumPatternEdit(clip.patternIndex);

    const effectiveSelectedIds = selectedChainIds.includes(clip.id) ? selectedChainIds : [clip.id];
    const snapshots = new Map<string, LinearDrumClip>();
    let minSnapLane = Infinity;
    let maxSnapLane = -Infinity;
    linearClips.forEach(c => {
      if (effectiveSelectedIds.includes(c.id)) {
        snapshots.set(c.id, { ...c });
        if (c.laneIndex < minSnapLane) minSnapLane = c.laneIndex;
        if (c.laneIndex > maxSnapLane) maxSnapLane = c.laneIndex;
      }
    });
    if (!Number.isFinite(minSnapLane)) {
      minSnapLane = clip.laneIndex;
      maxSnapLane = clip.laneIndex;
    }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let latestClientX = e.clientX;
    let latestClientY = e.clientY;
    let latestAlt = e.altKey;
    let lastDeltaMeasures = 0;
    let lastLaneDelta = 0;
    const initialScrollLeft = viewportRef.current?.scrollLeft || 0;

    setActiveDrag({
      id: clip.id,
      mode,
      isCloneDrag,
      initialStartMeasure: clip.startMeasure,
      initialDurationMeasures: clip.durationMeasures,
      initialLaneIndex: clip.laneIndex,
      currentStartMeasure: clip.startMeasure,
      currentDurationMeasures: clip.durationMeasures,
      currentLaneDelta: 0,
      snapshots
    });

    const computeUpdate = (clientX: number, clientY: number, altKey: boolean) => {
      const currentScroll = viewportRef.current?.scrollLeft || 0;
      const totalDx = (clientX - startClientX) + (currentScroll - initialScrollLeft);
      const totalDy = clientY - startClientY;
      const step = altKey ? 0.25 : snapMeasures;
      const minDur = Math.max(0.25, step);
      const deltaM = Math.round((totalDx / MEASURE_WIDTH) / step) * step;
      const rawLaneDelta = mode === 'move' && effectiveLaneCount > 1
        ? Math.round(totalDy / laneHeightPx)
        : 0;
      const clampedLaneDelta = Math.max(
        -minSnapLane,
        Math.min(effectiveLaneCount - 1 - maxSnapLane, rawLaneDelta)
      );
      lastDeltaMeasures = deltaM;
      lastLaneDelta = clampedLaneDelta;

      setActiveDrag(prev => {
        if (!prev) return null;
        if (prev.mode === 'move') {
          return {
            ...prev,
            currentStartMeasure: Math.max(0, prev.initialStartMeasure + deltaM),
            currentLaneDelta: clampedLaneDelta
          };
        }
        if (prev.mode === 'resize_right') {
          return { ...prev, currentDurationMeasures: Math.max(minDur, prev.initialDurationMeasures + deltaM) };
        }
        const initialEnd = prev.initialStartMeasure + prev.initialDurationMeasures;
        const maxStart = initialEnd - minDur;
        const newStart = Math.min(maxStart, Math.max(0, prev.initialStartMeasure + deltaM));
        const newDur = Math.max(minDur, initialEnd - newStart);
        return { ...prev, currentStartMeasure: newStart, currentDurationMeasures: newDur };
      });
    };

    const stopAutoScroll = startDrumEdgeAutoScroll(
      viewportRef,
      () => latestClientX,
      () => computeUpdate(latestClientX, latestClientY, latestAlt)
    );

    const onMove = (me: MouseEvent) => {
      window.getSelection()?.removeAllRanges();
      latestClientX = me.clientX;
      latestClientY = me.clientY;
      latestAlt = me.altKey;
      computeUpdate(me.clientX, me.clientY, me.altKey);
    };

    const onUp = (ue: MouseEvent) => {
      stopAutoScroll();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      latestClientX = ue.clientX;
      latestClientY = ue.clientY;
      latestAlt = ue.altKey;
      computeUpdate(ue.clientX, ue.clientY, ue.altKey);

      const finalScroll = viewportRef.current?.scrollLeft || 0;
      const movedPx = Math.abs((ue.clientX - startClientX) + (finalScroll - initialScrollLeft));
      const movedY = Math.abs(ue.clientY - startClientY);
      const minDur = Math.max(0.25, ue.altKey ? 0.25 : snapMeasures);
      const deltaM = lastDeltaMeasures;
      const laneDelta = lastLaneDelta;

      if (movedPx >= 4 || (mode === 'move' && movedY >= 8)) {
        if (mode === 'resize_right') {
          const finalDur = Math.max(minDur, clip.durationMeasures + deltaM);
          updateChainItem(clip.id, { durationMeasures: finalDur });
        } else if (mode === 'resize_left') {
          const initialEnd = clip.startMeasure + clip.durationMeasures;
          const maxStart = initialEnd - minDur;
          const finalStart = Math.min(maxStart, Math.max(0, clip.startMeasure + deltaM));
          const finalDur = Math.max(minDur, initialEnd - finalStart);
          updateChainItem(clip.id, { startMeasure: finalStart, durationMeasures: finalDur });
        } else if (mode === 'move' && (deltaM !== 0 || laneDelta !== 0)) {
          const minStart = Array.from(snapshots.values()).reduce((m, s) => Math.min(m, s.startMeasure), Infinity);
          const safeDelta = Math.max(-minStart, deltaM);
          if (safeDelta !== 0 || laneDelta !== 0) {
            if (isCloneDrag) {
              const clones = Array.from(snapshots.values()).map(s => ({
                patternIndex: s.patternIndex,
                startMeasure: Math.max(0, s.startMeasure + safeDelta),
                durationMeasures: s.durationMeasures,
                laneIndex: Math.max(0, Math.min(effectiveLaneCount - 1, s.laneIndex + laneDelta))
              }));
              addChainItemsBatch(clones);
            } else {
              updateChainItemsBatch(
                Array.from(snapshots.values()).map(s => ({
                  id: s.id,
                  changes: {
                    startMeasure: Math.max(0, s.startMeasure + safeDelta),
                    laneIndex: Math.max(0, Math.min(effectiveLaneCount - 1, s.laneIndex + laneDelta))
                  }
                }))
              );
            }
          }
        }
      }

      setActiveDrag(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Click / Lasso en carriles vacíos del timeline de batería (multi-capa 1:1)
  const handleLaneMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.drum-linear-clip')) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const stackEl = lanesStackRef.current || e.currentTarget;
    const laneRect = stackEl.getBoundingClientRect();
    const startX = e.clientX - laneRect.left;
    const startY = e.clientY - laneRect.top;
    const startMeasure = Math.max(0, Math.floor((startX / MEASURE_WIDTH) / snapMeasures) * snapMeasures);
    const clickedLane = Math.max(0, Math.min(effectiveLaneCount - 1, Math.floor(startY / laneHeightPx)));
    const initialSelected = [...selectedChainIds];

    // Con Ctrl/Meta inicia selección Lasso sin pintar; click simple sin arrastre pinta patrón activo
    const isLassoOnly = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!isLassoOnly) {
      setSelectedChainIds([]);
    }

    let didDrag = false;
    let latestClientX = e.clientX;
    let latestClientY = e.clientY;

    const updateLasso = (clientX: number, clientY: number) => {
      const rectNow = (lanesStackRef.current || stackEl).getBoundingClientRect();
      if (!rectNow) return;
      const curX = clientX - rectNow.left;
      const curY = clientY - rectNow.top;
      if (!didDrag && (Math.abs(curX - startX) > 6 || Math.abs(curY - startY) > 6)) {
        didDrag = true;
      }
      if (!didDrag) return;

      setLasso({ isActive: true, startX, startY, currentX: curX, currentY: curY });
      const minX = Math.min(startX, curX);
      const maxX = Math.max(startX, curX);
      const minY = Math.min(startY, curY);
      const maxY = Math.max(startY, curY);

      const hits: string[] = [];
      linearClips.forEach(c => {
        const cLeft = c.startMeasure * MEASURE_WIDTH;
        const cRight = cLeft + c.durationMeasures * MEASURE_WIDTH;
        const cTop = c.laneIndex * laneHeightPx;
        const cBottom = cTop + laneHeightPx;
        if (cLeft < maxX && cRight > minX && cTop < maxY && cBottom > minY) {
          hits.push(c.id);
        }
      });
      setSelectedChainIds(isLassoOnly ? Array.from(new Set([...initialSelected, ...hits])) : hits);
    };

    const stopAutoScroll = startDrumEdgeAutoScroll(
      viewportRef,
      () => latestClientX,
      () => updateLasso(latestClientX, latestClientY)
    );

    const onMove = (me: MouseEvent) => {
      window.getSelection()?.removeAllRanges();
      latestClientX = me.clientX;
      latestClientY = me.clientY;
      updateLasso(me.clientX, me.clientY);
    };

    const onUp = () => {
      stopAutoScroll();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setLasso({ isActive: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });

      if (!didDrag && !isLassoOnly) {
        // Click limpio en hueco vacío: pintar clip del patrón en edición sobre la capa pulsada
        const clipDur = Math.max(1, snapMeasures);
        addChainItem(currentDrumPatternEdit, clipDur, startMeasure, clickedLane);
        if (isPatternRepeatOn) {
          setPatternRepeatOn(false);
        }
        toneEngine.seekToBeat(startMeasure * beatsPerMeasure);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Clone Ghost Previews during Shift+Drag
  const cloneGhostClips: LinearDrumClip[] = [];
  if (activeDrag?.isCloneDrag) {
    const delta = activeDrag.currentStartMeasure - activeDrag.initialStartMeasure;
    const minStart = Array.from(activeDrag.snapshots.values()).reduce((m, s) => Math.min(m, s.startMeasure), Infinity);
    const safeDelta = Math.max(-minStart, delta);
    if (safeDelta !== 0 || activeDrag.currentLaneDelta !== 0) {
      activeDrag.snapshots.forEach((snap) => {
        cloneGhostClips.push({
          ...snap,
          startMeasure: Math.max(0, snap.startMeasure + safeDelta),
          laneIndex: Math.max(0, Math.min(effectiveLaneCount - 1, snap.laneIndex + activeDrag.currentLaneDelta))
        });
      });
    }
  }

  return (
    <div className="pattern-chain-container drum-linear-container">
      {/* Toolbar superior unificada del Arreglador Lineal de Batería */}
      <div className="pattern-chain-header">
        <div className="chain-title-group">
          <div className="physical-segment-tray" title="Modo de reproducción de batería">
            <button
              type="button"
              className={`physical-segment-btn ${!isPatternRepeatOn ? 'active' : ''}`}
              onClick={() => setPatternRepeatOn(false)}
              title="Reproducir secuencia lineal de clips acoplada al timeline global"
              style={{ fontSize: '0.68rem', padding: '0 8px' }}
            >
              TIMELINE LINEAL
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${isPatternRepeatOn ? 'active' : ''}`}
              onClick={() => setPatternRepeatOn(true)}
              title="Bucle continuo del patrón actual (ignora clips lineales)"
              style={{ fontSize: '0.68rem', padding: '0 8px', gap: '4px' }}
            >
              <Repeat size={11} />
              <span>LOOP P{currentDrumPatternEdit + 1}</span>
            </button>
          </div>

          <span className="chain-meta-summary">
            {linearClips.length} {linearClips.length === 1 ? 'clip' : 'clips'} · {Math.ceil(maxClipEndMeasure)} c.
            {isMultiLane ? ` · ${effectiveLaneCount} capas` : ''}
          </span>
        </div>

        {/* Brocha de Patrones (Click selecciona, Drag suelta en el timeline) */}
        <div className="drum-brush-tray" title="Selecciona un patrón para pintar al hacer click en el timeline, o arrástralo directamente a cualquier compás">
          <span className="drum-brush-label">PINCEL:</span>
          {Array.from({ length: totalPatterns }).map((_, idx) => {
            const color = PATTERN_PALETTE[idx % PATTERN_PALETTE.length];
            const isActiveBrush = currentDrumPatternEdit === idx;
            return (
              <button
                key={idx}
                type="button"
                draggable
                onDragStart={(e) => {
                  setDraggingBrushIdx(idx);
                  e.dataTransfer.setData('text/drum-pattern', String(idx));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => {
                  setDraggingBrushIdx(null);
                  setHoverDrop(null);
                }}
                onClick={() => setCurrentDrumPatternEdit(idx)}
                className={`drum-brush-pill ${isActiveBrush ? 'active' : ''}`}
                style={{
                  '--brush-color': color,
                  borderColor: isActiveBrush ? color : undefined,
                  color: isActiveBrush ? '#ffffff' : undefined
                } as React.CSSProperties}
                title={`Patrón P${idx + 1} — Click para pintar / Arrastra a un compás`}
              >
                <span className="brush-swatch" style={{ backgroundColor: color }} />
                P{idx + 1}
              </button>
            );
          })}
        </div>

        {/* Controles derechos: Snap, Slice, Auto-Fill, Clear, Zoom */}
        <div className="chain-actions">
          <div className="physical-segment-tray" title="Ajuste de rejilla por compases">
            <button
              type="button"
              className={`physical-segment-btn ${snapGrid !== 'off' ? 'active' : ''}`}
              onClick={() => setSnapGrid(snapGrid === 'off' ? '1' : 'off')}
              title="Activar/desactivar ajuste magnético (Mantén Alt para ajuste fino)"
            >
              <Magnet size={12} style={{ color: snapGrid === 'off' ? 'var(--text-secondary)' : '#ffd875' }} />
            </button>
            {(['1', '0.5', '0.25'] as const).map(val => (
              <button
                key={val}
                type="button"
                className={`physical-segment-btn ${snapGrid === val ? 'active' : ''}`}
                onClick={() => setSnapGrid(val)}
                style={{ fontSize: '10px', padding: '0 5px' }}
                title={val === '1' ? '1 Compás' : val === '0.5' ? '1/2 Compás' : '1/4 Compás (Fills)'}
              >
                {val === '1' ? '1B' : val === '0.5' ? '1/2' : '1/4'}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`physical-btn ${isSliceToolActive ? 'active' : ''}`}
            onClick={() => {
              setIsSliceToolActive(prev => !prev);
              setSlicePreviewMeasure(null);
            }}
            title="Herramienta Corte / Slice (C · también Shift+Click derecho en clip)"
            style={isSliceToolActive ? { borderColor: 'rgba(255, 107, 107, 0.55)', boxShadow: 'inset 0 0 8px rgba(255, 107, 107, 0.2)' } : undefined}
          >
            <Scissors size={13} style={{ color: isSliceToolActive ? '#ff6b6b' : 'var(--text-secondary)' }} />
          </button>

          <button
            type="button"
            className="physical-btn"
            disabled={effectiveLaneCount >= MAX_DRUM_LANES}
            onClick={() => addDrumLane()}
            title={
              effectiveLaneCount >= MAX_DRUM_LANES
                ? `Máximo ${MAX_DRUM_LANES} capas de batería`
                : 'Añadir capa de batería en paralelo (superponer patrones/fills · 1:1 con Tracks)'
            }
            style={{ gap: '4px', padding: '0 8px', fontSize: '0.68rem' }}
          >
            <Plus size={12} style={{ color: '#2dd4bf' }} />
            <span>Capa</span>
          </button>

          <button
            type="button"
            className="physical-btn"
            onClick={() => {
              const targetMeasures = Math.max(4, songSpanMeasures || 8);
              fillChainToSong(currentDrumPatternEdit, targetMeasures, 0);
            }}
            title={`Extender Patrón P${currentDrumPatternEdit + 1} por toda la canción (${Math.max(4, songSpanMeasures || 8)} compases)`}
            style={{ gap: '4px', padding: '0 8px', fontSize: '0.68rem' }}
          >
            <Wand2 size={12} style={{ color: '#ffd875' }} />
            <span>Auto-Fill</span>
          </button>

          <button
            type="button"
            className="physical-btn"
            onClick={handleZoomToFit}
            title="Encuadrar secuencia completa (Ctrl+0)"
          >
            <Maximize2 size={13} />
          </button>

          <button
            type="button"
            className="physical-btn"
            disabled={linearClips.length === 0}
            onClick={() => setIsClearConfirmOpen(true)}
            title="Limpiar timeline de batería"
          >
            <Trash2 size={13} style={{ color: '#ef5350' }} />
          </button>

          <PhysicalZoomControl
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            minZoom={0.45}
            maxZoom={2.5}
            step={0.15}
          />
        </div>
      </div>

      {/* Contenedor sincronizado: Gutter de capas (cuando hay >1 capa) + Viewport Lineal */}
      <div className={`drum-linear-shell ${isMultiLane ? 'is-multi-lane' : ''}`}>
        {isMultiLane && (
          <div className="drum-lanes-gutter" aria-label="Capas de batería">
            <div className="drum-lanes-gutter-top">CAPAS</div>
            {Array.from({ length: effectiveLaneCount }).map((_, laneIdx) => {
              const isLaneMuted = Boolean(drumLaneMuted[laneIdx]);
              const laneClipCount = linearClips.filter((c) => c.laneIndex === laneIdx).length;
              return (
                <div
                  key={`gutter_${laneIdx}`}
                  className={`drum-lanes-gutter-row ${isLaneMuted ? 'is-muted' : ''}`}
                  style={{ height: `${laneHeightPx}px` }}
                >
                  <span className="drum-gutter-label" title={`Capa de batería C${laneIdx + 1}`}>
                    C{laneIdx + 1}
                  </span>
                  <div className="drum-gutter-actions">
                    <button
                      type="button"
                      className={`drum-gutter-btn ${isLaneMuted ? 'active-mute' : ''}`}
                      onClick={() => toggleMuteDrumLane(laneIdx)}
                      title={isLaneMuted ? `Activar capa C${laneIdx + 1}` : `Silenciar capa C${laneIdx + 1}`}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      className="drum-gutter-btn danger"
                      onClick={() => {
                        if (laneClipCount > 0) {
                          setLanePendingDelete({ laneIndex: laneIdx, clipCount: laneClipCount });
                        } else {
                          removeDrumLane(laneIdx);
                        }
                      }}
                      title={`Eliminar capa C${laneIdx + 1}`}
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Viewport Lineal Sincronizado */}
        <div
          ref={viewportRef}
          className="drum-linear-viewport"
          onScroll={(e) => {
            persistScrollLeft(e.currentTarget.scrollLeft);
          }}
        >
          <div
            ref={canvasRef}
            className="drum-linear-canvas"
            style={{ width: `${canvasWidth}px` }}
          >
            {/* Fila 1: Regla de Compases */}
            <div
              className="drum-linear-ruler"
              onMouseDown={handleRulerMouseDown}
              title="Click o arrastra para mover el cabezal de reproducción"
            >
              {Array.from({ length: totalMeasures }).map((_, m) => (
                <div
                  key={m}
                  className="drum-ruler-measure"
                  style={{ left: `${m * MEASURE_WIDTH}px`, width: `${MEASURE_WIDTH}px` }}
                >
                  <span className="drum-ruler-num">c.{m + 1}</span>
                </div>
              ))}
            </div>

            {/* Fila 2: Referencia Armónica Sincronizada (Acordes del proyecto bar-for-bar) */}
            <div className="drum-chord-reference-strip" title="Acordes de referencia del proyecto (acoplados por compás)">
              <span className="drum-ref-watermark">ACORDES REF</span>
              {Array.from({ length: totalMeasures }).map((_, m) => (
                <div
                  key={m}
                  className="drum-ref-gridline"
                  style={{ left: `${m * MEASURE_WIDTH}px` }}
                />
              ))}
              {chordBlocks.map(cb => {
                const leftPx = (cb.startBeat / beatsPerMeasure) * MEASURE_WIDTH;
                const widthPx = Math.max(20, (cb.durationBeats / beatsPerMeasure) * MEASURE_WIDTH - 2);
                return (
                  <div
                    key={cb.id}
                    className="drum-ref-chord-pill"
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  >
                    {cb.chord}
                  </div>
                );
              })}
            </div>

            {/* Fila 3: Pila de Carriles (1..N capas en paralelo, 1:1 con Tracks) */}
            <div
              ref={lanesStackRef}
              className={`drum-linear-lane ${isPatternRepeatOn ? 'is-bypassed' : ''} ${isMultiLane ? 'multi-lane' : ''}`}
              style={{ height: `${effectiveLaneCount * laneHeightPx}px` }}
              onMouseDown={handleLaneMouseDown}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                const rect = lanesStackRef.current?.getBoundingClientRect();
                if (rect) {
                  const rawM = (e.clientX - rect.left) / MEASURE_WIDTH;
                  const snapped = Math.max(0, Math.round(rawM / snapMeasures) * snapMeasures);
                  const laneIdx = Math.max(
                    0,
                    Math.min(effectiveLaneCount - 1, Math.floor((e.clientY - rect.top) / laneHeightPx))
                  );
                  setHoverDrop({ measure: snapped, laneIndex: laneIdx });
                }
              }}
              onDragLeave={() => setHoverDrop(null)}
              onDrop={(e) => {
                e.preventDefault();
                const patStr = e.dataTransfer.getData('text/drum-pattern');
                const patIdx = patStr !== '' ? Number(patStr) : draggingBrushIdx;
                const rect = lanesStackRef.current?.getBoundingClientRect();
                if (rect && patIdx !== null && !Number.isNaN(patIdx)) {
                  const rawM = (e.clientX - rect.left) / MEASURE_WIDTH;
                  const snapped = Math.max(0, Math.round(rawM / snapMeasures) * snapMeasures);
                  const laneIdx = Math.max(
                    0,
                    Math.min(effectiveLaneCount - 1, Math.floor((e.clientY - rect.top) / laneHeightPx))
                  );
                  addChainItem(patIdx, Math.max(1, snapMeasures), snapped, laneIdx);
                  setCurrentDrumPatternEdit(patIdx);
                  if (isPatternRepeatOn) setPatternRepeatOn(false);
                }
                setDraggingBrushIdx(null);
                setHoverDrop(null);
              }}
              onContextMenu={(e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('.drum-linear-clip')) {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = lanesStackRef.current?.getBoundingClientRect();
                  const clickX = rect ? e.clientX - rect.left : 0;
                  const clickY = rect ? e.clientY - rect.top : 0;
                  const m = Math.max(0, Math.floor((clickX / MEASURE_WIDTH) / snapMeasures) * snapMeasures);
                  const laneIdx = Math.max(
                    0,
                    Math.min(effectiveLaneCount - 1, Math.floor(clickY / laneHeightPx))
                  );
                  setTrackContextMenu({ x: e.clientX, y: e.clientY, measure: m, laneIndex: laneIdx });
                }
              }}
            >
              {/* Filas visuales de fondo por capa (divisores horizontales + estado mute por capa) */}
              {Array.from({ length: effectiveLaneCount }).map((_, laneIdx) => {
                const isLaneMuted = Boolean(drumLaneMuted[laneIdx]);
                return (
                  <div
                    key={`lane_bg_${laneIdx}`}
                    className={`drum-linear-lane-row ${isLaneMuted ? 'lane-muted' : ''}`}
                    style={{
                      top: `${laneIdx * laneHeightPx}px`,
                      height: `${laneHeightPx}px`
                    }}
                  />
                );
              })}

              {/* Líneas de cuadrícula de compás */}
              {Array.from({ length: totalMeasures }).map((_, m) => (
                <div
                  key={m}
                  className="drum-lane-measure-cell"
                  style={{ left: `${m * MEASURE_WIDTH}px`, width: `${MEASURE_WIDTH}px` }}
                />
              ))}

              {/* Hint sutil cuando la pista está vacía */}
              {linearClips.length === 0 && (
                <div className="drum-linear-empty-hint">
                  Haz click en cualquier compás para colocar P{currentDrumPatternEdit + 1}, o usa <strong>Auto-Fill</strong>
                </div>
              )}

              {/* Drop ghost al arrastrar P# desde la brocha */}
              {hoverDrop !== null && draggingBrushIdx !== null && (
                <div
                  className="drum-clip-ghost"
                  style={{
                    left: `${hoverDrop.measure * MEASURE_WIDTH}px`,
                    top: `${hoverDrop.laneIndex * laneHeightPx + 5}px`,
                    height: `${laneHeightPx - 10}px`,
                    bottom: 'auto',
                    width: `${Math.max(24, Math.max(1, snapMeasures) * MEASURE_WIDTH - 2)}px`,
                    borderColor: PATTERN_PALETTE[draggingBrushIdx % PATTERN_PALETTE.length]
                  }}
                >
                  P{draggingBrushIdx + 1}
                </div>
              )}

              {/* Clips Lineales de Batería (en todas las capas 1:1) */}
              {linearClips.map(clip => {
                const color = PATTERN_PALETTE[clip.patternIndex % PATTERN_PALETTE.length];
                const isSelected = selectedChainIds.includes(clip.id);
                const isPlayingClip =
                  isPlaying && !isPatternRepeatOn && activePlayingClipIdsRef.current.has(clip.id);
                const isClipLaneMuted = Boolean(drumLaneMuted[clip.laneIndex]);

                let renderStart = clip.startMeasure;
                let renderDur = clip.durationMeasures;
                let renderLane = clip.laneIndex;

                if (activeDrag && !activeDrag.isCloneDrag) {
                  if (activeDrag.id === clip.id) {
                    if (activeDrag.mode === 'move' || activeDrag.mode === 'resize_left') {
                      renderStart = activeDrag.currentStartMeasure;
                    }
                    if (activeDrag.mode === 'resize_left' || activeDrag.mode === 'resize_right') {
                      renderDur = activeDrag.currentDurationMeasures;
                    }
                    if (activeDrag.mode === 'move') {
                      renderLane = Math.max(
                        0,
                        Math.min(effectiveLaneCount - 1, activeDrag.initialLaneIndex + activeDrag.currentLaneDelta)
                      );
                    }
                  } else if (activeDrag.mode === 'move' && activeDrag.snapshots.has(clip.id)) {
                    const snap = activeDrag.snapshots.get(clip.id)!;
                    const delta = activeDrag.currentStartMeasure - activeDrag.initialStartMeasure;
                    renderStart = Math.max(0, snap.startMeasure + delta);
                    renderLane = Math.max(
                      0,
                      Math.min(effectiveLaneCount - 1, snap.laneIndex + activeDrag.currentLaneDelta)
                    );
                  }
                }

                const leftPx = renderStart * MEASURE_WIDTH;
                const widthPx = Math.max(22, renderDur * MEASURE_WIDTH - 2);
                const topPx = renderLane * laneHeightPx + 5;
                const heightPx = laneHeightPx - 10;
                const previewRows = patternPreviewHits.get(clip.patternIndex) || [];
                const wholeRepeats = Math.max(1, Math.ceil(renderDur));

                return (
                  <div
                    key={clip.id}
                    ref={(el) => {
                      if (el) clipRefs.current.set(clip.id, el);
                      else clipRefs.current.delete(clip.id);
                    }}
                    className={`drum-linear-clip ${isSelected ? 'selected' : ''} ${isPlayingClip ? 'playing' : ''}`}
                    style={{
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                      bottom: 'auto',
                      width: `${widthPx}px`,
                      borderColor: isSelected ? '#ffd875' : color,
                      backgroundColor: `${color}24`,
                      opacity: clip.isMuted || isClipLaneMuted ? 0.42 : 1,
                      filter: clip.isMuted || isClipLaneMuted ? 'saturate(0.3)' : undefined,
                      cursor: isSliceToolActive ? 'crosshair' : 'grab',
                      '--clip-color': color
                    } as React.CSSProperties}
                    onMouseDown={(e) => handleClipMouseDown(e, clip)}
                    onMouseMove={(e) => {
                      if (!isSliceToolActive) {
                        if (slicePreviewMeasure !== null) setSlicePreviewMeasure(null);
                        return;
                      }
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const rawM = (e.clientX - rect.left) / MEASURE_WIDTH;
                      const cutStep = snapGrid === 'off' ? 0.25 : snapMeasures;
                      const cutM = Math.round(rawM / cutStep) * cutStep;
                      if (cutM > clip.startMeasure + 0.125 && cutM < clip.startMeasure + clip.durationMeasures - 0.125) {
                        setSlicePreviewMeasure(cutM);
                      } else {
                        setSlicePreviewMeasure(null);
                      }
                    }}
                    onMouseLeave={() => { if (slicePreviewMeasure !== null) setSlicePreviewMeasure(null); }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setCurrentDrumPatternEdit(clip.patternIndex);
                      setSelectedChainIds([clip.id]);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.shiftKey) return;
                      const rect = canvasRef.current?.getBoundingClientRect();
                      const rawM = rect ? (e.clientX - rect.left) / MEASURE_WIDTH : clip.startMeasure + clip.durationMeasures / 2;
                      const snappedM = Math.round(rawM / snapMeasures) * snapMeasures;
                      if (!selectedChainIds.includes(clip.id)) {
                        setSelectedChainIds([clip.id]);
                      }
                      setClipContextMenu({ x: e.clientX, y: e.clientY, clip, measure: snappedM });
                    }}
                    title={`P${clip.patternIndex + 1} · ${formatMeasureRange(renderStart, renderDur)}${isMultiLane ? ` · Capa C${renderLane + 1}` : ''} · Doble click para editar · Shift+Arrastrar para clonar`}
                  >
                    {/* Cabecera del clip con franja de color */}
                    <div className="drum-clip-header" style={{ backgroundColor: `${color}45` }}>
                      <span className="drum-clip-title">
                        <Play
                          size={9}
                          fill="currentColor"
                          className="drum-clip-play-icon"
                          style={{ marginRight: '3px', display: isPlayingClip ? 'inline-block' : 'none' }}
                        />
                        P{clip.patternIndex + 1}
                      </span>
                      {widthPx > 62 && (
                        <span className="drum-clip-span">
                          {clip.isMuted ? 'MUTE' : formatMeasureRange(renderStart, renderDur)}
                        </span>
                      )}
                    </div>

                    {/* Divisiones internas cuando un clip dura varios compases + puntos de actividad */}
                    <div className="drum-clip-body">
                      {Array.from({ length: wholeRepeats }).map((_, repIdx) => {
                        const tileLeftPct = (repIdx / renderDur) * 100;
                        const tileWidthPct = (Math.min(1, renderDur - repIdx) / renderDur) * 100;
                        if (tileWidthPct <= 0) return null;
                        return (
                          <div
                            key={repIdx}
                            className="drum-clip-tile"
                            style={{
                              left: `${tileLeftPct}%`,
                              width: `${tileWidthPct}%`,
                              borderLeft: repIdx > 0 ? '1px dashed rgba(255,255,255,0.22)' : 'none'
                            }}
                          >
                            {previewRows.map((rowHits, rI) => (
                              <div
                                key={rI}
                                className="drum-mini-row"
                                style={{ top: `${15 + rI * 13}%` }}
                              >
                                {rowHits.map(hit => {
                                  const frac = hit.stepIdx / hit.totalSteps;
                                  const visibleLimit = Math.min(1, renderDur - repIdx);
                                  if (frac >= visibleLimit) return null;
                                  return (
                                    <span
                                      key={hit.stepIdx}
                                      className="drum-mini-dot"
                                      style={{
                                        left: `${(frac / visibleLimit) * 100}%`,
                                        backgroundColor: color
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>

                    {/* Tiradores laterales de redimensionado */}
                    <div className="drum-clip-handle left" title="Ajustar inicio" />
                    <div className="drum-clip-handle right" title="Extender/acortar compases" />
                  </div>
                );
              })}

              {/* Fantasmas de clonación en vivo (Shift+Drag) */}
              {cloneGhostClips.map((g) => (
                <div
                  key={`ghost-${g.id}`}
                  className="drum-clip-ghost"
                  style={{
                    left: `${g.startMeasure * MEASURE_WIDTH}px`,
                    top: `${g.laneIndex * laneHeightPx + 5}px`,
                    height: `${laneHeightPx - 10}px`,
                    bottom: 'auto',
                    width: `${Math.max(22, g.durationMeasures * MEASURE_WIDTH - 2)}px`
                  }}
                >
                  P{g.patternIndex + 1}
                </div>
              ))}

              {/* Guía de corte (Slice Tool) */}
              {isSliceToolActive && slicePreviewMeasure !== null && (
                <div
                  className="drum-slice-guide"
                  style={{ left: `${slicePreviewMeasure * MEASURE_WIDTH}px` }}
                />
              )}

              {/* Caja de selección Lasso */}
              {lasso.isActive && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${Math.min(lasso.startX, lasso.currentX)}px`,
                    top: `${Math.min(lasso.startY, lasso.currentY)}px`,
                    width: `${Math.abs(lasso.currentX - lasso.startX)}px`,
                    height: `${Math.abs(lasso.currentY - lasso.startY)}px`,
                    border: '1px dashed #ffd875',
                    backgroundColor: 'rgba(255, 216, 117, 0.12)',
                    pointerEvents: 'none',
                    zIndex: 30
                  }}
                />
              )}
            </div>

            {/* Cabezal de reproducción en vivo (60fps) */}
            <div ref={playheadRef} className="drum-linear-playhead" />
          </div>
        </div>
      </div>

      {/* Menú Contextual de Clip */}
      {clipContextMenu && (
        <ContextMenuContainer x={clipContextMenu.x} y={clipContextMenu.y}>
          <div className="menu-header">
            <span>CLIP · P{clipContextMenu.clip.patternIndex + 1} ({formatMeasureRange(clipContextMenu.clip.startMeasure, clipContextMenu.clip.durationMeasures)})</span>
          </div>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              makeChainItemUnique(clipContextMenu.clip.id);
              setClipContextMenu(null);
            }}
          >
            <Sparkles size={13} style={{ color: '#ffd875' }} /> Hacer Único (Crear Fill)
          </button>

          <button
            type="button"
            className="menu-item"
            disabled={clipContextMenu.clip.durationMeasures <= 0.25}
            onClick={() => {
              const c = clipContextMenu.clip;
              const mid = c.startMeasure + c.durationMeasures / 2;
              const targetSplit =
                clipContextMenu.measure > c.startMeasure + 0.125 && clipContextMenu.measure < c.startMeasure + c.durationMeasures - 0.125
                  ? clipContextMenu.measure
                  : mid;
              splitChainItem(c.id, targetSplit);
              setClipContextMenu(null);
            }}
          >
            <Scissors size={13} /> Dividir Aquí (C)
          </button>

          <div className="menu-subheader">Asignar Patrón</div>
          <div className="drum-ctx-pattern-grid">
            {Array.from({ length: totalPatterns }).map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`drum-ctx-pat-btn ${clipContextMenu.clip.patternIndex === idx ? 'active' : ''}`}
                style={{ '--pat-col': PATTERN_PALETTE[idx % PATTERN_PALETTE.length] } as React.CSSProperties}
                onClick={() => {
                  updateChainItem(clipContextMenu.clip.id, { patternIndex: idx });
                  setCurrentDrumPatternEdit(idx);
                  setClipContextMenu(null);
                }}
              >
                P{idx + 1}
              </button>
            ))}
          </div>

          <hr className="menu-separator" />

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              copySelectedChainItems();
              setClipContextMenu(null);
            }}
          >
            <Copy size={13} /> Copiar (Ctrl+C)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              duplicateSelectedChainItems();
              setClipContextMenu(null);
            }}
          >
            <Layers size={13} /> Duplicar (Ctrl+D)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              toggleMuteChainItem(clipContextMenu.clip.id);
              setClipContextMenu(null);
            }}
          >
            {clipContextMenu.clip.isMuted ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {clipContextMenu.clip.isMuted ? 'Activar clip (M)' : 'Silenciar clip (M)'}
          </button>

          <hr className="menu-separator" />

          <button
            type="button"
            className="menu-danger"
            onClick={() => {
              if (selectedChainIds.length > 1) {
                deleteSelectedChainItems();
              } else {
                removeChainItem(clipContextMenu.clip.id);
              }
              setClipContextMenu(null);
            }}
          >
            <Trash2 size={13} /> Eliminar {selectedChainIds.length > 1 ? `(${selectedChainIds.length})` : ''}
          </button>
        </ContextMenuContainer>
      )}

      {/* Menú Contextual de Fondo */}
      {trackContextMenu && (
        <ContextMenuContainer x={trackContextMenu.x} y={trackContextMenu.y}>
          <div className="menu-header">
            <span>
              TIMELINE BATERÍA · c.{trackContextMenu.measure + 1}
              {isMultiLane ? ` · C${trackContextMenu.laneIndex + 1}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              addChainItem(
                currentDrumPatternEdit,
                1,
                trackContextMenu.measure,
                trackContextMenu.laneIndex
              );
              if (isPatternRepeatOn) setPatternRepeatOn(false);
              setTrackContextMenu(null);
            }}
          >
            Insertar P{currentDrumPatternEdit + 1} aquí
          </button>
          <button
            type="button"
            className="menu-item"
            disabled={!chainClipboard || chainClipboard.length === 0}
            onClick={() => {
              pasteChainItems(undefined, trackContextMenu.measure);
              setTrackContextMenu(null);
            }}
          >
            <Clipboard size={13} /> Pegar aquí (Ctrl+V)
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              selectAllChainItems();
              setTrackContextMenu(null);
            }}
          >
            <Layers size={13} /> Seleccionar Todo (Ctrl+A)
          </button>
        </ContextMenuContainer>
      )}

      <ConfirmModal
        isOpen={isClearConfirmOpen}
        title="Limpiar Secuencia Lineal"
        message="¿Estás seguro de que quieres eliminar todos los clips del timeline de batería? Tus patrones P1..PN permanecerán intactos."
        confirmText="Limpiar Timeline"
        cancelText="Cancelar"
        onConfirm={() => {
          clearPatternChain();
          setIsClearConfirmOpen(false);
        }}
        onCancel={() => setIsClearConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={Boolean(lanePendingDelete)}
        title="Eliminar Capa de Batería"
        message={
          lanePendingDelete
            ? `¿Seguro que deseas eliminar la Capa C${lanePendingDelete.laneIndex + 1} y sus ${lanePendingDelete.clipCount} clips? (Puedes deshacer con Ctrl+Z)`
            : ''
        }
        confirmText="Eliminar Capa"
        cancelText="Cancelar"
        isDanger={true}
        onConfirm={() => {
          if (lanePendingDelete) {
            removeDrumLane(lanePendingDelete.laneIndex);
          }
          setLanePendingDelete(null);
        }}
        onCancel={() => setLanePendingDelete(null)}
      />
    </div>
  );
};
