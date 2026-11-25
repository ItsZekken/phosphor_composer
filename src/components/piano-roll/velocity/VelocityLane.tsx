import React, { useRef, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useSongStore } from '../../../store/songStore';
import { toneEngine } from '../../../audio/toneEngine';
import type { MelodyNote } from '../../../utils/typeDefinitions';
import {
  midiToNoteName,
  velocityToMidi127,
  type EphemeralDragState
} from '../utils/pianoRollUtils';

interface VelocityLaneProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  beatWidth: number;
  TOTAL_BEATS: number;
  beatsPerMeasure: number;
  selectedNoteIds: string[];
  ephemeralDragRef: React.RefObject<EphemeralDragState | null>;
  renderTrigger: number;
  triggerNotesRedraw: () => void;
  updateMelodyNotesBatch: (updates: Array<{ id: string; changes: Partial<MelodyNote> }>) => void;
  currentChannelId: string;
  height: number;
  onResizeHeight: (nextHeight: number) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const PAD_TOP = 12;
const PAD_BOTTOM = 8;

const sortedVelNotesCache = new WeakMap<MelodyNote[], MelodyNote[]>();

function getSortedVelNotes(notes: MelodyNote[]): MelodyNote[] {
  let cached = sortedVelNotesCache.get(notes);
  if (!cached) {
    cached = notes.slice().sort((a, b) => a.startBeat - b.startBeat);
    sortedVelNotesCache.set(notes, cached);
  }
  return cached;
}

function velLowerBoundBeat(notes: MelodyNote[], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].startBeat < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function getVelocityColor(vel: number, isHovered: boolean): string {
  if (isHovered) return '#ffffff';
  if (vel >= 0.88) return '#ff7a52';
  if (vel >= 0.65) return '#ffd875';
  if (vel >= 0.38) return '#58b58b';
  return '#5490cf';
}

export const VelocityLane: React.FC<VelocityLaneProps> = React.memo(({
  containerRef,
  beatWidth,
  TOTAL_BEATS,
  beatsPerMeasure,
  selectedNoteIds,
  ephemeralDragRef,
  renderTrigger,
  triggerNotesRedraw,
  updateMelodyNotesBatch,
  currentChannelId,
  height,
  onResizeHeight,
  isCollapsed,
  onToggleCollapse
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const hoveredNoteIdRef = useRef<string | null>(null);
  const hoverTooltipRef = useRef<{ x: number; y: number; text: string } | null>(null);
  const lastAudioPreviewRef = useRef<{ time: number; vel: number }>({ time: 0, vel: -1 });

  const melodyNotes = useSongStore(state => state.melodyNotes || []);

  const drawParamsRef = useRef({
    melodyNotes,
    beatWidth,
    TOTAL_BEATS,
    beatsPerMeasure,
    selectedNoteIds,
    height,
    renderTrigger
  });
  drawParamsRef.current = {
    melodyNotes,
    beatWidth,
    TOTAL_BEATS,
    beatsPerMeasure,
    selectedNoteIds,
    height,
    renderTrigger
  };

  const clampVel = (v: number) => Math.max(0.05, Math.min(1.0, Math.round(v * 100) / 100));

  const velToY = (vel: number, h: number) => {
    const usable = Math.max(16, h - PAD_TOP - PAD_BOTTOM);
    return PAD_TOP + (1 - vel) * usable;
  };

  const yToVel = (y: number, h: number) => {
    const usable = Math.max(16, h - PAD_TOP - PAD_BOTTOM);
    return clampVel(1 - (y - PAD_TOP) / usable);
  };

  const getScrollLeft = useCallback(() => {
    return containerRef.current ? containerRef.current.scrollLeft : 0;
  }, [containerRef]);

  const updatePlayheadPosition = useCallback(() => {
    const el = playheadRef.current;
    if (!el) return;
    const isPlaying = useSongStore.getState().isPlaying;
    const beat = isPlaying ? toneEngine.getLiveBeat() : (useSongStore.getState().currentBeat ?? 0);
    const x = beat * drawParamsRef.current.beatWidth - getScrollLeft();
    el.style.transform = `translate3d(${x}px, 0, 0)`;
  }, [getScrollLeft]);

  const drawLane = useCallback(() => {
    if (isCollapsed) return;
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const {
      melodyNotes: notes,
      beatWidth: bw,
      TOTAL_BEATS: totalBeats,
      beatsPerMeasure: bpmMeasure,
      selectedNoteIds: selIds,
      height: h
    } = drawParamsRef.current;

    const viewW = Math.max(100, viewport.clientWidth);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.ceil(viewW * dpr);
    const targetH = Math.ceil(h * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${viewW}px`;
      canvas.style.height = `${h}px`;
    }

    const scrollLeft = getScrollLeft();
    const usableH = Math.max(16, h - PAD_TOP - PAD_BOTTOM);
    const baseY = PAD_TOP + usableH;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c0a12';
    ctx.fillRect(0, 0, viewW, h);

    // Guías horizontales (25%, 50%, 75%, 100%)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1.0].forEach((level) => {
      const gy = Math.round(velToY(level, h)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(viewW, gy);
      ctx.stroke();
    });

    // Línea base 0%
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.beginPath();
    ctx.moveTo(0, Math.round(baseY) + 0.5);
    ctx.lineTo(viewW, Math.round(baseY) + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.translate(-scrollLeft, 0);

    // Líneas verticales de pulso y compás alineadas con el Piano Roll
    const startBeat = Math.max(0, Math.floor(scrollLeft / bw));
    const endBeat = Math.min(totalBeats, Math.ceil((scrollLeft + viewW) / bw));
    for (let b = startBeat; b <= endBeat; b++) {
      const x = b * bw;
      const isMeasure = b % bpmMeasure === 0;
      ctx.strokeStyle = isMeasure ? 'rgba(112, 96, 176, 0.34)' : 'rgba(255, 255, 255, 0.045)';
      ctx.lineWidth = isMeasure ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    const ephemeral = ephemeralDragRef.current;
    const overrides = ephemeral?.overrides;
    const selectedSet = new Set(selIds);
    const hasSelection = selectedSet.size > 0;
    const hoveredId = hoveredNoteIdRef.current;

    // Búsqueda binaria O(log N) para soportar pistas densas de 20,000+ notas sin lag al hacer scroll/hover
    const sortedNotes = getSortedVelNotes(notes);
    const minVisibleBeat = (scrollLeft - 20) / bw;
    const maxVisibleBeat = (scrollLeft + viewW + 20) / bw;
    const hasOverrides = Boolean(overrides && overrides.size > 0);
    const visitedIds = hasOverrides ? new Set<string>() : null;

    const visibleNotes: Array<{ note: MelodyNote; x: number; vel: number; editable: boolean }> = [];
    const pushIfVisible = (rawNote: MelodyNote) => {
      const ov = overrides?.get(rawNote.id);
      const note = ov ? { ...rawNote, ...ov } : rawNote;
      const x = note.startBeat * bw + 5;
      if (x < scrollLeft - 14 || x > scrollLeft + viewW + 14) return;
      const vel = clampVel(note.velocity ?? 0.8);
      const editable = !hasSelection || selectedSet.has(note.id);
      visibleNotes.push({ note, x, vel, editable });
    };

    let idx = velLowerBoundBeat(sortedNotes, minVisibleBeat);
    for (; idx < sortedNotes.length; idx++) {
      const rawNote = sortedNotes[idx];
      if (rawNote.startBeat > maxVisibleBeat) break;
      if (visitedIds) visitedIds.add(rawNote.id);
      pushIfVisible(rawNote);
    }

    if (hasOverrides && overrides && visitedIds) {
      overrides.forEach((_ov, id) => {
        if (visitedIds.has(id)) return;
        const base = notes.find((n) => n.id === id);
        if (base) pushIfVisible(base);
      });
    }

    // 1. Dibujar primero notas atenuadas (cuando hay selección activa)
    for (const item of visibleNotes) {
      if (item.editable) continue;
      const topY = velToY(item.vel, h);
      ctx.strokeStyle = 'rgba(140, 145, 175, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(item.x, baseY);
      ctx.lineTo(item.x, topY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(140, 145, 175, 0.25)';
      ctx.beginPath();
      ctx.arc(item.x, topY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Dibujar notas editables (lollipops activos)
    for (const item of visibleNotes) {
      if (!item.editable) continue;
      const isHovered = item.note.id === hoveredId;
      const topY = velToY(item.vel, h);
      const col = getVelocityColor(item.vel, isHovered);

      // Tallo
      ctx.strokeStyle = col;
      ctx.lineWidth = isHovered ? 3 : 2.5;
      ctx.beginPath();
      ctx.moveTo(item.x, baseY);
      ctx.lineTo(item.x, topY);
      ctx.stroke();

      // Cabeza lollipop
      const radius = isHovered ? 5.5 : 4.2;
      if (isHovered || hasSelection) {
        ctx.fillStyle = 'rgba(255, 216, 117, 0.22)';
        ctx.beginPath();
        ctx.arc(item.x, topY, radius + 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = col;
      ctx.strokeStyle = '#14111a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(item.x, topY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 3. Línea de rampa lineal (Right-Click + Drag)
    const rampLine = ephemeral?.rampLine;
    if (rampLine) {
      ctx.save();
      ctx.strokeStyle = '#ffd875';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(rampLine.x1, rampLine.y1);
      ctx.lineTo(rampLine.x2, rampLine.y2);
      ctx.stroke();
      ctx.setLineDash([]);

      [
        { x: rampLine.x1, y: rampLine.y1 },
        { x: rampLine.x2, y: rampLine.y2 }
      ].forEach(pt => {
        ctx.fillStyle = '#ffd875';
        ctx.strokeStyle = '#14111a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }

    ctx.restore();

    // 4. Tooltip numérico de velocity (coordenadas de viewport)
    const tip = hoverTooltipRef.current;
    if (tip) {
      ctx.save();
      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      const tw = ctx.measureText(tip.text).width + 12;
      const th = 16;
      const px = Math.max(4, Math.min(viewW - tw - 4, tip.x + 10));
      const py = Math.max(4, Math.min(h - th - 4, tip.y - 20));

      ctx.fillStyle = 'rgba(20, 18, 28, 0.96)';
      ctx.strokeStyle = '#ffd875';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(px, py, tw, th, 3);
      } else {
        ctx.rect(px, py, tw, th);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffd875';
      ctx.fillText(tip.text, px + 6, py + 11.5);
      ctx.restore();
    }
  }, [isCollapsed, getScrollLeft, ephemeralDragRef]);

  useEffect(() => {
    drawLane();
  }, [drawLane, melodyNotes, beatWidth, TOTAL_BEATS, beatsPerMeasure, selectedNoteIds, height, renderTrigger, isCollapsed]);

  // Sincronización 120 FPS de scroll horizontal + resize + playhead
  useEffect(() => {
    if (isCollapsed) return;
    const container = containerRef.current;
    const viewport = viewportRef.current;
    if (!container || !viewport) return;

    let rafId = 0;
    const syncAll = () => {
      drawLane();
      updatePlayheadPosition();
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncAll();
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      syncAll();
    });

    syncAll();
    resizeObserver.observe(viewport);
    container.addEventListener('scroll', onScroll, { passive: true });

    // Seguimiento del playhead en vivo
    let playRafId = 0;
    const tickPlayhead = () => {
      updatePlayheadPosition();
      if (useSongStore.getState().isPlaying) {
        playRafId = requestAnimationFrame(tickPlayhead);
      }
    };

    const unsubStore = useSongStore.subscribe((state, prev) => {
      if (state.isPlaying !== prev.isPlaying || state.currentBeat !== prev.currentBeat) {
        updatePlayheadPosition();
        if (state.isPlaying && !prev.isPlaying) {
          cancelAnimationFrame(playRafId);
          playRafId = requestAnimationFrame(tickPlayhead);
        }
      }
    });

    if (useSongStore.getState().isPlaying) {
      playRafId = requestAnimationFrame(tickPlayhead);
    }

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', onScroll);
      unsubStore();
      if (rafId) cancelAnimationFrame(rafId);
      if (playRafId) cancelAnimationFrame(playRafId);
    };
  }, [containerRef, isCollapsed, drawLane, updatePlayheadPosition]);

  const maybePreviewAudio = useCallback((noteName: string, velocity: number, force = false) => {
    const now = performance.now();
    const last = lastAudioPreviewRef.current;
    if (!force && (now - last.time < 110 || Math.abs(velocity - last.vel) < 0.06)) {
      return;
    }
    lastAudioPreviewRef.current = { time: now, vel: velocity };
    toneEngine.playNotePreview(noteName, currentChannelId, velocity);
  }, [currentChannelId]);

  const getEditableNotes = useCallback(() => {
    const notes = useSongStore.getState().melodyNotes || [];
    if (selectedNoteIds.length === 0) return notes;
    const selSet = new Set(selectedNoteIds);
    return notes.filter(n => selSet.has(n.id));
  }, [selectedNoteIds]);

  const findClosestEditableHead = (worldX: number, localY: number, editable: MelodyNote[], bw: number, h: number): MelodyNote | null => {
    let bestNote: MelodyNote | null = null;
    let bestDist = Infinity;

    for (const note of editable) {
      const nx = note.startBeat * bw + 5;
      const dx = Math.abs(worldX - nx);
      if (dx > 8) continue;
      const ny = velToY(note.velocity ?? 0.8, h);
      const dist = Math.hypot(dx, localY - ny);
      if (dist < bestDist) {
        bestDist = dist;
        bestNote = note;
      }
    }
    return bestNote;
  };

  const handleMouseMoveIdle = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const worldX = localX + getScrollLeft();

    const editable = getEditableNotes();
    const hit = findClosestEditableHead(worldX, localY, editable, beatWidth, height);

    const prevHover = hoveredNoteIdRef.current;
    hoveredNoteIdRef.current = hit ? hit.id : null;
    canvas.style.cursor = hit ? 'ns-resize' : 'crosshair';

    if (hit) {
      const v = hit.velocity ?? 0.8;
      hoverTooltipRef.current = {
        x: localX,
        y: velToY(v, height),
        text: `${hit.note || midiToNoteName(hit.midi)} · VEL ${velocityToMidi127(v)} (${Math.round(v * 100)}%)`
      };
    } else {
      hoverTooltipRef.current = null;
    }

    if (prevHover !== hoveredNoteIdRef.current || hit) {
      drawLane();
    }
  };

  const handleMouseLeave = () => {
    if (hoveredNoteIdRef.current || hoverTooltipRef.current) {
      hoveredNoteIdRef.current = null;
      hoverTooltipRef.current = null;
      drawLane();
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (e.button !== 0 && e.button !== 2) return;

    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const startLocalX = e.clientX - rect.left;
    const startLocalY = e.clientY - rect.top;
    const scrollLeft = getScrollLeft();
    const startWorldX = startLocalX + scrollLeft;

    const editable = getEditableNotes();
    if (editable.length === 0) return;

    const initialMap = new Map<string, { note: MelodyNote; vel: number; x: number }>();
    editable.forEach(n => {
      initialMap.set(n.id, {
        note: n,
        vel: n.velocity ?? 0.8,
        x: n.startBeat * beatWidth + 5
      });
    });

    // DOBLE CLIC IZQUIERDO -> Reset rápido a 80%
    if (e.button === 0 && e.detail === 2) {
      const hit = findClosestEditableHead(startWorldX, startLocalY, editable, beatWidth, height);
      if (hit) {
        const targets = selectedNoteIds.length > 0 ? editable : [hit];
        updateMelodyNotesBatch(targets.map(n => ({ id: n.id, changes: { velocity: 0.8 } })));
        toneEngine.playNotePreview(hit.note || midiToNoteName(hit.midi), currentChannelId, 0.8);
      }
      return;
    }

    // CLIC DERECHO ARRASTRANDO -> Rampa lineal (crescendo / decrescendo)
    if (e.button === 2) {
      const startVel = yToVel(startLocalY, height);
      let hasMoved = false;
      const overrides = new Map<string, Partial<MelodyNote>>();

      const onMoveRamp = (moveEvent: MouseEvent) => {
        const curRect = canvas.getBoundingClientRect();
        const curLocalX = moveEvent.clientX - curRect.left;
        const curLocalY = Math.max(0, Math.min(height, moveEvent.clientY - curRect.top));
        const curWorldX = curLocalX + getScrollLeft();
        const curVel = yToVel(curLocalY, height);

        if (Math.hypot(moveEvent.clientX - e.clientX, moveEvent.clientY - e.clientY) > 3) {
          hasMoved = true;
        }

        const minX = Math.min(startWorldX, curWorldX);
        const maxX = Math.max(startWorldX, curWorldX);
        const spanX = curWorldX - startWorldX;

        overrides.clear();
        initialMap.forEach(({ note, x }) => {
          if (x >= minX - 6 && x <= maxX + 6) {
            const t = Math.abs(spanX) < 1 ? 1 : Math.max(0, Math.min(1, (x - startWorldX) / spanX));
            const interpVel = clampVel(startVel + t * (curVel - startVel));
            overrides.set(note.id, { velocity: interpVel });
          }
        });

        hoverTooltipRef.current = {
          x: curLocalX,
          y: curLocalY,
          text: `RAMPA ${Math.round(startVel * 100)}% → ${Math.round(curVel * 100)}%`
        };

        (ephemeralDragRef as { current: EphemeralDragState | null }).current = {
          overrides,
          rampLine: { x1: startWorldX, y1: velToY(startVel, height), x2: curWorldX, y2: velToY(curVel, height) }
        };
        triggerNotesRedraw();
      };

      const onUpRamp = () => {
        window.removeEventListener('mousemove', onMoveRamp);
        window.removeEventListener('mouseup', onUpRamp);

        if (hasMoved && overrides.size > 0) {
          const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];
          overrides.forEach((changes, id) => updates.push({ id, changes }));
          updateMelodyNotesBatch(updates);
        }

        hoverTooltipRef.current = null;
        (ephemeralDragRef as { current: EphemeralDragState | null }).current = null;
        triggerNotesRedraw();
      };

      window.addEventListener('mousemove', onMoveRamp);
      window.addEventListener('mouseup', onUpRamp);
      return;
    }

    // CLIC IZQUIERDO -> Ajuste de nota individual (o relativo con Shift) + transición suave a Paint Sweep
    const capturedNote = findClosestEditableHead(startWorldX, startLocalY, editable, beatWidth, height);
    let mode: 'single' | 'relative' | 'paint' = capturedNote
      ? (e.shiftKey && selectedNoteIds.length > 1 ? 'relative' : 'single')
      : 'paint';

    const overrides = new Map<string, Partial<MelodyNote>>();
    let prevSweepWorldX = startWorldX;
    let lastPreviewNote = capturedNote;

    if (capturedNote) {
      const initVel = yToVel(startLocalY, height);
      if (mode === 'single') {
        overrides.set(capturedNote.id, { velocity: initVel });
        maybePreviewAudio(capturedNote.note || midiToNoteName(capturedNote.midi), initVel, true);
        hoverTooltipRef.current = {
          x: startLocalX,
          y: velToY(initVel, height),
          text: `${capturedNote.note || midiToNoteName(capturedNote.midi)} · VEL ${velocityToMidi127(initVel)} (${Math.round(initVel * 100)}%)`
        };
      } else {
        hoverTooltipRef.current = {
          x: startLocalX,
          y: startLocalY,
          text: `AJUSTE RELATIVO (${editable.length} notas)`
        };
      }
      (ephemeralDragRef as { current: EphemeralDragState | null }).current = { overrides };
      triggerNotesRedraw();
    } else {
      // Pintar inmediatamente si cayó justo sobre una columna en modo Paint
      const initVel = yToVel(startLocalY, height);
      initialMap.forEach(({ note, x }) => {
        if (Math.abs(x - startWorldX) <= 8) {
          overrides.set(note.id, { velocity: initVel });
          lastPreviewNote = note;
        }
      });
      if (overrides.size > 0) {
        if (lastPreviewNote) {
          maybePreviewAudio(lastPreviewNote.note || midiToNoteName(lastPreviewNote.midi), initVel, true);
        }
        (ephemeralDragRef as { current: EphemeralDragState | null }).current = { overrides };
        triggerNotesRedraw();
      }
    }

    const onMoveDrag = (moveEvent: MouseEvent) => {
      const curRect = canvas.getBoundingClientRect();
      const curLocalX = moveEvent.clientX - curRect.left;
      const curLocalY = Math.max(0, Math.min(height, moveEvent.clientY - curRect.top));
      const curWorldX = curLocalX + getScrollLeft();
      const curVel = yToVel(curLocalY, height);

      if (mode === 'single' && Math.abs(curWorldX - startWorldX) > 12) {
        mode = 'paint';
      }

      if (mode === 'single' && capturedNote) {
        overrides.set(capturedNote.id, { velocity: curVel });
        lastPreviewNote = capturedNote;
        maybePreviewAudio(capturedNote.note || midiToNoteName(capturedNote.midi), curVel);
        hoverTooltipRef.current = {
          x: curLocalX,
          y: velToY(curVel, height),
          text: `${capturedNote.note || midiToNoteName(capturedNote.midi)} · VEL ${velocityToMidi127(curVel)} (${Math.round(curVel * 100)}%)`
        };
      } else if (mode === 'relative') {
        const deltaVel = (startLocalY - curLocalY) / Math.max(16, height - PAD_TOP - PAD_BOTTOM);
        initialMap.forEach(({ note, vel }) => {
          overrides.set(note.id, { velocity: clampVel(vel + deltaVel) });
        });
        const sign = deltaVel >= 0 ? '+' : '';
        hoverTooltipRef.current = {
          x: curLocalX,
          y: curLocalY,
          text: `RELATIVO ${sign}${Math.round(deltaVel * 100)}% (${editable.length})`
        };
      } else {
        // Paint Sweep continuo sin saltarse notas en movimientos rápidos
        const sweepMin = Math.min(prevSweepWorldX, curWorldX) - 7;
        const sweepMax = Math.max(prevSweepWorldX, curWorldX) + 7;
        let touched: MelodyNote | null = null;
        initialMap.forEach(({ note, x }) => {
          if (x >= sweepMin && x <= sweepMax) {
            overrides.set(note.id, { velocity: curVel });
            touched = note;
          }
        });
        if (touched) {
          lastPreviewNote = touched;
          maybePreviewAudio((touched as MelodyNote).note || midiToNoteName((touched as MelodyNote).midi), curVel);
        }
        hoverTooltipRef.current = {
          x: curLocalX,
          y: velToY(curVel, height),
          text: `VEL ${velocityToMidi127(curVel)} (${Math.round(curVel * 100)}%)`
        };
      }

      prevSweepWorldX = curWorldX;
      (ephemeralDragRef as { current: EphemeralDragState | null }).current = { overrides };
      triggerNotesRedraw();
    };

    const onUpDrag = () => {
      window.removeEventListener('mousemove', onMoveDrag);
      window.removeEventListener('mouseup', onUpDrag);

      if (overrides.size > 0) {
        const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];
        overrides.forEach((changes, id) => updates.push({ id, changes }));
        updateMelodyNotesBatch(updates);
        if (lastPreviewNote) {
          const finalVel = overrides.get(lastPreviewNote.id)?.velocity;
          if (typeof finalVel === 'number') {
            maybePreviewAudio(lastPreviewNote.note || midiToNoteName(lastPreviewNote.midi), finalVel, true);
          }
        }
      }

      hoverTooltipRef.current = null;
      (ephemeralDragRef as { current: EphemeralDragState | null }).current = null;
      triggerNotesRedraw();
    };

    window.addEventListener('mousemove', onMoveDrag);
    window.addEventListener('mouseup', onUpDrag);
  };

  // Splitter superior para redimensionar altura del Velocity Lane
  const handleSplitterMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;

    const onMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const nextH = Math.max(72, Math.min(220, Math.round(startHeight + deltaY)));
      onResizeHeight(nextH);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (isCollapsed) {
    return (
      <div className="velocity-lane-collapsed">
        <button
          type="button"
          className="velocity-lane-toggle-pill"
          onClick={onToggleCollapse}
          title="Expandir carril de Velocity (V)"
        >
          <ChevronUp size={12} />
          <span>VELOCITY</span>
          {selectedNoteIds.length > 0 && (
            <span className="velocity-scope-badge selected">SEL ({selectedNoteIds.length})</span>
          )}
        </button>
        <span className="velocity-lane-hint">
          Click/Arrastrar: ajustar · Click der. arrastrando: rampa lineal · Doble click: 80%
        </span>
      </div>
    );
  }

  return (
    <div className="velocity-lane-shell">
      <div
        className="velocity-lane-splitter"
        onMouseDown={handleSplitterMouseDown}
        title="Arrastrar para redimensionar altura del Velocity Lane"
      >
        <span className="velocity-splitter-grip" />
      </div>

      <div className="velocity-lane-body" style={{ height: `${height}px` }}>
        <div className="velocity-lane-sidebar">
          <div className="velocity-sidebar-top">
            <span className="velocity-sidebar-title">VEL</span>
            <button
              type="button"
              className="velocity-collapse-btn"
              onClick={onToggleCollapse}
              title="Colapsar carril de Velocity (V)"
            >
              <ChevronDown size={12} />
            </button>
          </div>

          <div className={`velocity-scope-badge ${selectedNoteIds.length > 0 ? 'selected' : ''}`}>
            {selectedNoteIds.length > 0 ? `SEL (${selectedNoteIds.length})` : 'ALL'}
          </div>

          <div className="velocity-scale-marks">
            <span>100</span>
            <span>50</span>
            <span>0</span>
          </div>
        </div>

        <div className="velocity-lane-viewport" ref={viewportRef}>
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMoveIdle}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onContextMenu={e => e.preventDefault()}
            style={{ display: 'block', width: '100%', height: `${height}px` }}
          />
          <div ref={playheadRef} className="velocity-lane-playhead" />
        </div>
      </div>
    </div>
  );
});
