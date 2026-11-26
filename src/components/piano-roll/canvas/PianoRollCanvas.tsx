import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { useSongStore } from '../../../store/songStore';
import type { PianoRollGridSnap } from '../../../store/types';
import { toneEngine } from '../../../audio/toneEngine';
import type { ChordBlock, MelodyNote } from '../../../utils/typeDefinitions';
import { generateId } from '../../../utils/idGenerator';
import {
  MAX_MIDI,
  NOTE_COUNT,
  getSnapStepBeats,
  midiToNoteName,
  hexToRgba,
  computeChordTonesMap,
  type EphemeralDragState,
  type LassoRect,
  type TempNote,
  type PianoRollTool
} from '../utils/pianoRollUtils';

const PR_BLACK_KEY_MASK = new Uint8Array([0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]);
const rgbaColorCache = new Map<string, string>();
const sortedPrNotesCache = new WeakMap<MelodyNote[], { sorted: MelodyNote[]; maxDur: number }>();

function hexToRgbaCached(hex: string, alpha: number): string {
  const roundedAlpha = Math.round(alpha * 100) / 100;
  const key = `${hex}|${roundedAlpha}`;
  let hit = rgbaColorCache.get(key);
  if (!hit) {
    hit = hexToRgba(hex, roundedAlpha);
    if (rgbaColorCache.size > 512) rgbaColorCache.clear();
    rgbaColorCache.set(key, hit);
  }
  return hit;
}

function getSortedPrNotes(notes: MelodyNote[]): { sorted: MelodyNote[]; maxDur: number } {
  let cached = sortedPrNotesCache.get(notes);
  if (!cached) {
    let maxDur = 0.25;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].durationBeats > maxDur) maxDur = notes[i].durationBeats;
    }
    const sorted = notes.slice().sort((a, b) => a.startBeat - b.startBeat);
    cached = { sorted, maxDur };
    sortedPrNotesCache.set(notes, cached);
  }
  return cached;
}

function prLowerBoundBeat(notes: MelodyNote[], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].startBeat < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface PianoRollCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  contentWrapperRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  beatWidth: number;
  rowHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  TOTAL_BEATS: number;
  beatsPerMeasure: number;
  chordBlocks: ChordBlock[];
  selectedNoteIds: string[];
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<string[]>>;
  activeTool: PianoRollTool;
  lassoRect: LassoRect | null;
  tempNote: TempNote | null;
  scalePitchClasses: Set<number>;
  rootMidiMod: number;
  isScaleHighlightActive: boolean;
  isGhostNotesActive: boolean;
  isChordHighlightActive: boolean;
  gridSnap: PianoRollGridSnap;
  ephemeralDragRef: React.RefObject<EphemeralDragState | null>;
  renderTrigger: number;
  handleMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMouseMoveIdle: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * Aguja láser de reproducción aislada a 60 FPS sin provocar redibujados del lienzo.
 */
export const PianoRollPlayhead: React.FC<{ beatWidth: number; height: number }> = React.memo(({ beatWidth, height }) => {
  const playheadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let animId: number;

    const updatePlayhead = () => {
      const isPlaying = useSongStore.getState().isPlaying;
      const beat = isPlaying ? toneEngine.getLiveBeat() : (useSongStore.getState().currentBeat ?? 0);
      const x = beat * beatWidth;

      if (playheadRef.current) {
        playheadRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
      }

      if (isPlaying) {
        animId = requestAnimationFrame(updatePlayhead);
      }
    };

    let prevBeat = useSongStore.getState().currentBeat;
    let prevIsPlaying = useSongStore.getState().isPlaying;

    const unsub = useSongStore.subscribe((state) => {
      if (state.currentBeat !== prevBeat || state.isPlaying !== prevIsPlaying) {
        const wasPlaying = prevIsPlaying;
        prevBeat = state.currentBeat;
        prevIsPlaying = state.isPlaying;

        updatePlayhead();
        if (state.isPlaying && !wasPlaying) {
          cancelAnimationFrame(animId);
          animId = requestAnimationFrame(updatePlayhead);
        }
      }
    });

    updatePlayhead();
    if (useSongStore.getState().isPlaying) {
      animId = requestAnimationFrame(updatePlayhead);
    }

    return () => {
      unsub();
      cancelAnimationFrame(animId);
    };
  }, [beatWidth]);

  return (
    <div
      ref={playheadRef}
      className="piano-roll-playhead-laser"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '2px',
        height: `${height}px`,
        backgroundColor: '#ffd875',
        boxShadow: '0 0 8px rgba(255, 216, 117, 0.9), 0 0 16px rgba(255, 216, 117, 0.4)',
        zIndex: 10,
        pointerEvents: 'none',
        willChange: 'transform'
      }}
    />
  );
});

const RULER_HEIGHT = 42;

export const PianoRollCanvas: React.FC<PianoRollCanvasProps> = React.memo(({
  canvasRef,
  contentWrapperRef,
  containerRef,
  beatWidth,
  rowHeight,
  canvasWidth,
  canvasHeight,
  TOTAL_BEATS,
  beatsPerMeasure,
  chordBlocks,
  selectedNoteIds = [],
  setSelectedNoteIds,
  activeTool,
  lassoRect,
  tempNote,
  scalePitchClasses,
  rootMidiMod,
  isScaleHighlightActive,
  isGhostNotesActive,
  isChordHighlightActive,
  gridSnap,
  ephemeralDragRef,
  renderTrigger,
  handleMouseDown,
  handleMouseMoveIdle
}) => {
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stickyViewportRef = useRef<HTMLDivElement | null>(null);
  const viewportSizeRef = useRef<{ width: number; height: number }>({ width: 1200, height: 600 });

  const melodyNotes = useSongStore(state => state.melodyNotes || []);
  const tracks = useSongStore(state => state.tracks || []);
  const activeTrackId = useSongStore(state => state.activeTrackId);
  const activeTrack = tracks.find(t => t.id === activeTrackId);
  const activeColor = activeTrack?.color || '#6880ad';

  const chordSpans = useMemo(
    () => (isChordHighlightActive ? computeChordTonesMap(chordBlocks) : []),
    [chordBlocks, isChordHighlightActive]
  );

  // Mantener refs actualizados para redibujado imperativo en scroll sin re-renders
  const drawGridParamsRef = useRef({
    beatWidth,
    rowHeight,
    canvasWidth,
    canvasHeight,
    TOTAL_BEATS,
    beatsPerMeasure,
    scalePitchClasses,
    rootMidiMod,
    isScaleHighlightActive,
    isChordHighlightActive,
    gridSnap,
    chordSpans
  });
  drawGridParamsRef.current = {
    beatWidth,
    rowHeight,
    canvasWidth,
    canvasHeight,
    TOTAL_BEATS,
    beatsPerMeasure,
    scalePitchClasses,
    rootMidiMod,
    isScaleHighlightActive,
    isChordHighlightActive,
    gridSnap,
    chordSpans
  };

  const drawNotesParamsRef = useRef({
    melodyNotes,
    tracks,
    activeTrackId,
    activeColor,
    beatWidth,
    rowHeight,
    canvasWidth,
    canvasHeight,
    selectedNoteIds,
    lassoRect,
    tempNote,
    isGhostNotesActive,
    renderTrigger
  });
  drawNotesParamsRef.current = {
    melodyNotes,
    tracks,
    activeTrackId,
    activeColor,
    beatWidth,
    rowHeight,
    canvasWidth,
    canvasHeight,
    selectedNoteIds,
    lassoRect,
    tempNote,
    isGhostNotesActive,
    renderTrigger
  };

  const getViewportMetrics = useCallback(() => {
    const container = containerRef.current;
    const { width: vw, height: vh } = viewportSizeRef.current;
    const { canvasWidth: cw, canvasHeight: ch } = drawGridParamsRef.current;
    const drawWidth = Math.max(1, Math.min(cw, vw));
    const drawHeight = Math.max(1, Math.min(ch, vh));
    const scrollLeft = container ? container.scrollLeft : 0;
    const scrollTop = container ? container.scrollTop : 0;
    const offsetX = Math.max(0, Math.min(scrollLeft, Math.max(0, cw - drawWidth)));
    const offsetY = Math.max(0, Math.min(scrollTop, Math.max(0, ch - drawHeight)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return { drawWidth, drawHeight, offsetX, offsetY, dpr };
  }, [containerRef]);

  const drawGrid = useCallback(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const {
      beatWidth: bw,
      rowHeight: rh,
      TOTAL_BEATS: totalBeats,
      beatsPerMeasure: bpmMeasure,
      scalePitchClasses: scalePcs,
      rootMidiMod: rootPc,
      isScaleHighlightActive: scaleActive,
      isChordHighlightActive: chordActive,
      gridSnap: snap,
      chordSpans: spans
    } = drawGridParamsRef.current;

    const { drawWidth, drawHeight, offsetX, offsetY, dpr } = getViewportMetrics();
    const targetW = Math.ceil(drawWidth * dpr);
    const targetH = Math.ceil(drawHeight * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${drawWidth}px`;
      canvas.style.height = `${drawHeight}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0910';
    ctx.fillRect(0, 0, drawWidth, drawHeight);
    ctx.translate(-offsetX, -offsetY);

    const firstRow = Math.max(0, Math.floor(offsetY / rh));
    const lastRow = Math.min(NOTE_COUNT - 1, Math.ceil((offsetY + drawHeight) / rh));
    const startBeat = Math.max(0, offsetX / bw);
    const endBeat = Math.min(totalBeats, (offsetX + drawWidth) / bw);

    // 1. Filas horizontales y Scale Highlighting (batch stroke paths en 2 pasadas)
    for (let i = firstRow; i <= lastRow; i++) {
      const midi = MAX_MIDI - i;
      const pitchClass = ((midi % 12) + 12) % 12;
      const isBlack = PR_BLACK_KEY_MASK[pitchClass] === 1;
      const inScale = scalePcs?.has(pitchClass) ?? false;
      const isRoot = pitchClass === rootPc;

      if (scaleActive) {
        if (isRoot) {
          ctx.fillStyle = '#1c162e';
        } else if (inScale) {
          ctx.fillStyle = isBlack ? '#161324' : '#1d192d';
        } else {
          ctx.fillStyle = '#09080e';
        }
      } else {
        ctx.fillStyle = isBlack ? '#13111c' : '#1a1726';
      }

      const rowY = i * rh;
      ctx.fillRect(offsetX, rowY, drawWidth, rh);
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.beginPath();
    for (let i = firstRow; i <= lastRow; i++) {
      const midi = MAX_MIDI - i;
      const pitchClass = ((midi % 12) + 12) % 12;
      if (pitchClass === rootPc) continue;
      const lineY = (i + 1) * rh;
      ctx.moveTo(offsetX, lineY);
      ctx.lineTo(offsetX + drawWidth, lineY);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 216, 117, 0.18)';
    ctx.beginPath();
    for (let i = firstRow; i <= lastRow; i++) {
      const midi = MAX_MIDI - i;
      const pitchClass = ((midi % 12) + 12) % 12;
      if (pitchClass !== rootPc) continue;
      const lineY = (i + 1) * rh;
      ctx.moveTo(offsetX, lineY);
      ctx.lineTo(offsetX + drawWidth, lineY);
    }
    ctx.stroke();

    // 2. Resaltado armónico compás por compás según Chord Timeline (Chord Tones)
    if (chordActive && spans.length > 0) {
      for (const span of spans) {
        if (span.endBeat <= startBeat || span.startBeat >= endBeat) continue;
        const sx1 = Math.max(offsetX, span.startBeat * bw);
        const sx2 = Math.min(offsetX + drawWidth, span.endBeat * bw);
        const sw = sx2 - sx1;
        if (sw <= 0) continue;

        for (let i = firstRow; i <= lastRow; i++) {
          const midi = MAX_MIDI - i;
          const pc = ((midi % 12) + 12) % 12;
          if (pc === span.rootPc) {
            ctx.fillStyle = 'rgba(255, 216, 117, 0.095)';
            ctx.fillRect(sx1, i * rh, sw, rh);
          } else if (span.chordPcs.has(pc)) {
            ctx.fillStyle = 'rgba(116, 168, 224, 0.065)';
            ctx.fillRect(sx1, i * rh, sw, rh);
          }
        }

        const boundaryX = span.startBeat * bw;
        if (boundaryX >= offsetX && boundaryX <= offsetX + drawWidth) {
          ctx.strokeStyle = 'rgba(255, 216, 117, 0.16)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(boundaryX, offsetY);
          ctx.lineTo(boundaryX, offsetY + drawHeight);
          ctx.stroke();
        }
      }
    }

    // 3. Líneas verticales en exactamente 3 pasadas (Subdivisión / Pulso / Compás)
    const snapStep = getSnapStepBeats(snap);
    const drawStep = snap === 'off' ? 0.25 : snapStep;
    const firstStep = Math.max(0, Math.floor(startBeat / drawStep) - 1);
    const lastStep = Math.min(Math.ceil(totalBeats / drawStep), Math.ceil(endBeat / drawStep) + 1);

    // Pasada 3a: Subdivisiones
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.028)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let step = firstStep; step <= lastStep; step++) {
      const beat = step * drawStep;
      if (Math.abs(beat - Math.round(beat)) < 0.002) continue;
      const x = beat * bw;
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + drawHeight);
    }
    ctx.stroke();

    // Pasada 3b: Pulsos (Beats no compás)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.075)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let step = firstStep; step <= lastStep; step++) {
      const beat = step * drawStep;
      const nearestBeat = Math.round(beat);
      if (Math.abs(beat - nearestBeat) >= 0.002) continue;
      if ((((nearestBeat % bpmMeasure) + bpmMeasure) % bpmMeasure) === 0) continue;
      const x = beat * bw;
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + drawHeight);
    }
    ctx.stroke();

    // Pasada 3c: Compases (Measures)
    ctx.strokeStyle = 'rgba(112, 96, 176, 0.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let step = firstStep; step <= lastStep; step++) {
      const beat = step * drawStep;
      const nearestBeat = Math.round(beat);
      if (Math.abs(beat - nearestBeat) >= 0.002) continue;
      if ((((nearestBeat % bpmMeasure) + bpmMeasure) % bpmMeasure) !== 0) continue;
      const x = beat * bw;
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + drawHeight);
    }
    ctx.stroke();
  }, [getViewportMetrics]);

  const drawNotes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const {
      melodyNotes: notes,
      tracks: allTracks,
      activeTrackId: curTrackId,
      activeColor: color,
      beatWidth: bw,
      rowHeight: rh,
      selectedNoteIds: selIds,
      lassoRect: lasso,
      tempNote: creatingNote,
      isGhostNotesActive: ghostActive
    } = drawNotesParamsRef.current;

    const { drawWidth, drawHeight, offsetX, offsetY, dpr } = getViewportMetrics();
    const targetW = Math.ceil(drawWidth * dpr);
    const targetH = Math.ceil(drawHeight * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${drawWidth}px`;
      canvas.style.height = `${drawHeight}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, drawWidth, drawHeight);
    ctx.translate(-offsetX, -offsetY);

    const firstRow = Math.max(0, Math.floor(offsetY / rh) - 1);
    const lastRow = Math.min(NOTE_COUNT - 1, Math.ceil((offsetY + drawHeight) / rh) + 1);
    const startBeat = Math.max(0, offsetX / bw - 1);
    const endBeat = (offsetX + drawWidth) / bw + 1;

    const ephemeral = ephemeralDragRef.current;
    const overrides = ephemeral?.overrides;

    // A. Multi-track Ghost Notes (culling binario O(log N) por pista)
    if (ghostActive && allTracks.length > 1) {
      for (const track of allTracks) {
        if (track.id === curTrackId || !track.notes || track.notes.length === 0) continue;
        const ghostFill = hexToRgbaCached(track.color || '#7c8bb5', 0.14);
        const ghostStroke = hexToRgbaCached(track.color || '#7c8bb5', 0.34);

        const { sorted: sortedGhost, maxDur: ghostMaxDur } = getSortedPrNotes(track.notes);
        let gIdx = prLowerBoundBeat(sortedGhost, startBeat - ghostMaxDur);
        ctx.fillStyle = ghostFill;
        ctx.strokeStyle = ghostStroke;
        ctx.lineWidth = 1;
        for (; gIdx < sortedGhost.length; gIdx++) {
          const gNote = sortedGhost[gIdx];
          if (gNote.startBeat > endBeat) break;
          if (gNote.startBeat + gNote.durationBeats < startBeat) continue;
          const row = MAX_MIDI - gNote.midi;
          if (row < firstRow || row > lastRow) continue;

          const gx = gNote.startBeat * bw;
          const gy = row * rh;
          const gw = Math.max(8, gNote.durationBeats * bw);

          ctx.fillRect(gx + 1, gy + 2, gw - 2, rh - 4);
          ctx.strokeRect(gx + 1, gy + 2, gw - 2, rh - 4);
        }
      }
    }

    ctx.font = 'bold 10px monospace';

    // B. Nota temporal en creación por arrastre
    if (creatingNote) {
      const row = MAX_MIDI - creatingNote.midi;
      if (row >= firstRow && row <= lastRow) {
        const x = creatingNote.startBeat * bw;
        const y = row * rh;
        const width = Math.max(8, creatingNote.durationBeats * bw);

        ctx.fillStyle = 'rgba(255, 216, 117, 0.4)';
        ctx.strokeStyle = '#ffd875';
        ctx.lineWidth = 1.5;

        ctx.fillRect(x + 1, y + 1, width - 2, rh - 2);
        ctx.strokeRect(x + 1, y + 1, width - 2, rh - 2);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(midiToNoteName(creatingNote.midi), x + 5, y + (rh / 2 + 3.5));
      }
    }

    // C. Notas reales de la pista activa fusionadas con overrides efímeros (búsqueda binaria O(log N))
    const selectedSet = new Set(selIds);
    const { sorted: sortedActiveNotes, maxDur: activeMaxDur } = getSortedPrNotes(notes);
    const hasOverrides = Boolean(overrides && overrides.size > 0);
    const drawnIds = hasOverrides ? new Set<string>() : null;

    const drawSingleNote = (note: MelodyNote) => {
      if (note.startBeat + note.durationBeats < startBeat || note.startBeat > endBeat) return;
      const row = MAX_MIDI - note.midi;
      if (row < firstRow || row > lastRow) return;

      const x = note.startBeat * bw;
      const y = row * rh;
      const width = Math.max(8, note.durationBeats * bw);
      const isSelected = selectedSet.has(note.id);
      const isMuted = Boolean(note.muted);
      const vel = note.velocity ?? 0.8;

      if (isSelected) {
        ctx.fillStyle = isMuted ? 'rgba(255, 216, 117, 0.45)' : '#ffd875';
      } else if (isMuted) {
        ctx.fillStyle = hexToRgbaCached(color, 0.18);
      } else {
        const alpha = 0.45 + vel * 0.55;
        ctx.fillStyle = hexToRgbaCached(color, alpha);
      }
      ctx.fillRect(x + 1, y + 1, width - 2, rh - 2);

      // Bisel superior sutil
      if (!isMuted) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fillRect(x + 1, y + 1, width - 2, 1);

        // Barra interna de velocity en la base
        const velBarWidth = Math.max(4, (width - 4) * vel);
        ctx.fillStyle = isSelected ? '#1a1726' : '#ffd875';
        ctx.fillRect(x + 2, y + rh - 3, velBarWidth, 2);
      }

      // Borde exterior (discontinuo si la nota está silenciada)
      if (isMuted) {
        ctx.save();
        ctx.setLineDash([3, 2]);
        ctx.strokeStyle = isSelected ? '#ffd875' : 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, y + 1, width - 2, rh - 2);
        ctx.restore();
      } else {
        ctx.strokeStyle = isSelected ? '#ffffff' : hexToRgbaCached(color, 0.78);
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.strokeRect(x + 1, y + 1, width - 2, rh - 2);
      }

      // Tiradores duales si está seleccionada
      if (isSelected && width > 24) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 1, y + 2, 2, rh - 4);
        ctx.fillRect(x + width - 3, y + 2, 2, rh - 4);
      }

      if (width > 20) {
        ctx.fillStyle = isMuted
          ? 'rgba(255, 255, 255, 0.45)'
          : isSelected
          ? '#111111'
          : '#ffffff';
        ctx.fillText(note.note || midiToNoteName(note.midi), x + 5, y + (rh / 2 + 3.5));
      }
    };

    let nIdx = prLowerBoundBeat(sortedActiveNotes, startBeat - activeMaxDur);
    for (; nIdx < sortedActiveNotes.length; nIdx++) {
      const rawNote = sortedActiveNotes[nIdx];
      if (rawNote.startBeat > endBeat) break;
      const override = overrides?.get(rawNote.id);
      if (override) {
        drawnIds!.add(rawNote.id);
        drawSingleNote({ ...rawNote, ...override });
      } else {
        drawSingleNote(rawNote);
      }
    }

    // Asegurar notas arrastradas desde fuera hacia dentro del viewport visible
    if (hasOverrides && overrides) {
      overrides.forEach((ov, id) => {
        if (drawnIds!.has(id)) return;
        const base = notes.find((n) => n.id === id);
        if (base) drawSingleNote({ ...base, ...ov });
      });
    }

    // D. Clones al vuelo (Shift + Drag)
    const clonedPreview = ephemeral?.clonedPreviewNotes;
    if (clonedPreview && clonedPreview.length > 0) {
      ctx.save();
      ctx.setLineDash([3, 2]);
      for (const cNote of clonedPreview) {
        if (cNote.startBeat + cNote.durationBeats < startBeat || cNote.startBeat > endBeat) continue;
        const row = MAX_MIDI - cNote.midi;
        if (row < firstRow || row > lastRow) continue;

        const cx = cNote.startBeat * bw;
        const cy = row * rh;
        const cw = Math.max(8, cNote.durationBeats * bw);

        ctx.fillStyle = 'rgba(255, 216, 117, 0.55)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.fillRect(cx + 1, cy + 1, cw - 2, rh - 2);
        ctx.strokeRect(cx + 1, cy + 1, cw - 2, rh - 2);

        if (cw > 20) {
          ctx.fillStyle = '#111111';
          ctx.font = 'bold 10px monospace';
          ctx.fillText(cNote.note || midiToNoteName(cNote.midi), cx + 5, cy + (rh / 2 + 3.5));
        }
      }
      ctx.restore();
    }

    // E. Línea láser de corte (Slice Tool) e intersecciones
    const sliceLine = ephemeral?.sliceLine;
    if (sliceLine) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 90, 95, 0.45)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sliceLine.x1, sliceLine.y1);
      ctx.lineTo(sliceLine.x2, sliceLine.y2);
      ctx.stroke();

      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(sliceLine.x1, sliceLine.y1);
      ctx.lineTo(sliceLine.x2, sliceLine.y2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (ephemeral?.sliceCuts) {
        for (const cut of ephemeral.sliceCuts) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#ff4757';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cut.x, cut.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // F. Readout HUD flotante (durante drag/slice/etc.)
    const readout = ephemeral?.activeReadout;
    if (readout) {
      ctx.save();
      ctx.font = 'bold 10px monospace';
      const textMetrics = ctx.measureText(readout.text);
      const pillWidth = textMetrics.width + 12;
      const pillHeight = 16;

      const px = Math.max(offsetX + 4, Math.min(offsetX + drawWidth - pillWidth - 4, readout.x));
      const py = Math.max(offsetY + 4, Math.min(offsetY + drawHeight - pillHeight - 4, readout.y - 20));

      ctx.fillStyle = 'rgba(20, 18, 28, 0.95)';
      ctx.strokeStyle = '#ffd875';
      ctx.lineWidth = 1;

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(px, py, pillWidth, pillHeight, 3);
      } else {
        ctx.rect(px, py, pillWidth, pillHeight);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffd875';
      ctx.fillText(readout.text, px + 6, py + 11.5);
      ctx.restore();
    }

    // G. Marquee / Lasso Rect (Herramienta Seleccionar, Ctrl+Arrastre o Clic Derecho)
    if (lasso) {
      const lx = Math.min(lasso.x1, lasso.x2);
      const ly = Math.min(lasso.y1, lasso.y2);
      const lw = Math.abs(lasso.x2 - lasso.x1);
      const lh = Math.abs(lasso.y2 - lasso.y1);

      if (lw > 1 || lh > 1) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 216, 117, 0.13)';
        ctx.strokeStyle = '#ffd875';
        ctx.lineWidth = 1.75;

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(lx, ly, lw, lh, 4);
        } else {
          ctx.rect(lx, ly, lw, lh);
        }
        ctx.fill();
        ctx.stroke();

        // Etiqueta flotante con contador de notas seleccionadas durante el arrastre
        if (selIds.length > 0 && (lw > 24 || lh > 18)) {
          const badgeText = selIds.length === 1 ? '1 NOTA' : `${selIds.length} NOTAS`;
          ctx.font = 'bold 10px monospace';
          const textW = ctx.measureText(badgeText).width;
          const pillW = textW + 10;
          const pillH = 16;
          const px = Math.max(offsetX + 4, Math.min(offsetX + drawWidth - pillW - 4, lx + lw - pillW));
          const py = Math.max(offsetY + 4, Math.min(offsetY + drawHeight - pillH - 4, ly + lh + 4));

          ctx.fillStyle = 'rgba(20, 18, 28, 0.94)';
          ctx.strokeStyle = 'rgba(255, 216, 117, 0.85)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(px, py, pillW, pillH, 3);
          } else {
            ctx.rect(px, py, pillW, pillH);
          }
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffd875';
          ctx.fillText(badgeText, px + 5, py + 11.5);
        }
        ctx.restore();
      }
    }
  }, [canvasRef, ephemeralDragRef, getViewportMetrics]);

  // Redibujo ante cambios de configuración de la cuadrícula
  useEffect(() => {
    drawGrid();
  }, [
    drawGrid,
    canvasWidth,
    canvasHeight,
    rowHeight,
    beatWidth,
    scalePitchClasses,
    rootMidiMod,
    isScaleHighlightActive,
    isChordHighlightActive,
    gridSnap,
    TOTAL_BEATS,
    beatsPerMeasure,
    chordSpans
  ]);

  // Redibujo ante cambios de notas, selección o overrides efímeros
  useEffect(() => {
    drawNotes();
  }, [
    drawNotes,
    melodyNotes,
    tracks,
    activeTrackId,
    canvasWidth,
    canvasHeight,
    selectedNoteIds,
    lassoRect,
    tempNote,
    rowHeight,
    beatWidth,
    activeColor,
    isGhostNotesActive,
    renderTrigger
  ]);

  // Sincronización virtual 120 FPS ante scroll y resize del contenedor sin re-renders en React
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const w = Math.max(100, container.clientWidth);
      const h = Math.max(100, container.clientHeight - RULER_HEIGHT);
      viewportSizeRef.current = { width: w, height: h };
      if (stickyViewportRef.current) {
        stickyViewportRef.current.style.width = `${Math.min(canvasWidth, w)}px`;
        stickyViewportRef.current.style.height = `${Math.min(canvasHeight, h)}px`;
      }
      drawGrid();
      drawNotes();
    };

    let rafId = 0;
    const handleScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        drawGrid();
        drawNotes();
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    updateSize();
    resizeObserver.observe(container);
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [containerRef, canvasWidth, canvasHeight, drawGrid, drawNotes]);

  const handleTouchCanvas = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const wrapper = contentWrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const touchY = e.touches[0].clientY - rect.top;

    const snapStep = getSnapStepBeats(gridSnap);
    const clickBeat = Math.floor((touchX / beatWidth) / snapStep) * snapStep;
    const clickedRow = Math.floor(touchY / rowHeight);
    const clickMidi = MAX_MIDI - clickedRow;

    const store = useSongStore.getState();
    const existingNote = (store.melodyNotes || []).find(n => {
      const row = MAX_MIDI - n.midi;
      const x1 = n.startBeat * beatWidth;
      const x2 = (n.startBeat + n.durationBeats) * beatWidth;
      return clickedRow === row && touchX >= x1 && touchX <= x2;
    });

    if (activeTool === 'select') {
      if (existingNote) {
        setSelectedNoteIds(prev =>
          prev.includes(existingNote.id)
            ? prev.filter(id => id !== existingNote.id)
            : [...prev, existingNote.id]
        );
      } else {
        setSelectedNoteIds([]);
      }
      return;
    }

    if (activeTool === 'slice') {
      if (existingNote) {
        const rawBeat = touchX / beatWidth;
        const cutBeat = snapStep > 0.015 ? Math.round(rawBeat / snapStep) * snapStep : Math.round(rawBeat * 1000) / 1000;
        if (cutBeat > existingNote.startBeat + 0.02 && cutBeat < existingNote.startBeat + existingNote.durationBeats - 0.02) {
          const firstDur = Math.round((cutBeat - existingNote.startBeat) * 10000) / 10000;
          const secondDur = Math.round((existingNote.startBeat + existingNote.durationBeats - cutBeat) * 10000) / 10000;
          const nextNotes = (store.melodyNotes || []).flatMap(n =>
            n.id === existingNote.id
              ? [
                  { ...n, durationBeats: firstDur },
                  {
                    id: generateId('slice'),
                    note: n.note,
                    midi: n.midi,
                    startBeat: cutBeat,
                    durationBeats: secondDur,
                    velocity: n.velocity ?? 0.8
                  }
                ]
              : [n]
          );
          store.setMelodyNotes(nextNotes);
        }
      }
      return;
    }

    if (existingNote) {
      store.removeMelodyNote(existingNote.id);
    } else {
      const noteName = midiToNoteName(clickMidi);
      toneEngine.playNotePreview(noteName);
      store.addMelodyNote({
        note: noteName,
        midi: clickMidi,
        startBeat: clickBeat,
        durationBeats: 1,
        velocity: 0.8
      });
    }
  };

  return (
    <div
      ref={contentWrapperRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMoveIdle}
      onTouchStart={handleTouchCanvas}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'relative',
        width: `${canvasWidth}px`,
        height: `${canvasHeight}px`,
        flexShrink: 0,
        cursor: activeTool === 'select' ? 'default' : 'crosshair',
        userSelect: 'none'
      }}
    >
      {/* Ventana sticky virtual: mantiene ambos canvas en el área visible a resolución Retina 2x */}
      <div
        ref={stickyViewportRef}
        style={{
          position: 'sticky',
          top: `${RULER_HEIGHT}px`,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'hidden'
        }}
      >
        <canvas
          ref={gridCanvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'block',
            pointerEvents: 'none'
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'block',
            pointerEvents: 'none'
          }}
        />
      </div>

      <PianoRollPlayhead beatWidth={beatWidth} height={canvasHeight} />
    </div>
  );
});
