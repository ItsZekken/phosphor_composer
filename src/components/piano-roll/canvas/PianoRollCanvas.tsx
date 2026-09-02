import React, { useRef, useEffect } from 'react';
import { useSongStore } from '../../../store/songStore';
import { toneEngine } from '../../../audio/toneEngine';
import { NOTE_CLASSES } from '../../../core/music';

const MIN_MIDI = 24; // C1
const MAX_MIDI = 96; // C7
const NOTE_COUNT = MAX_MIDI - MIN_MIDI + 1;
const GRID_SNAP = 0.25; // Semicorcheas

function midiToNoteName(midi: number): string {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_CLASSES[noteIndex]}${octave}`;
}

export interface LassoRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TempNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
}

export interface LivePitchInfo {
  midi: number;
  note: string;
  clarity: number;
}

interface PianoRollCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  beatWidth: number;
  rowHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  TOTAL_BEATS: number;
  selectedNoteIds: string[];
  lassoRect: LassoRect | null;
  tempNote: TempNote | null;
  livePitch?: LivePitchInfo | null;
  scalePitchClasses: Set<number>;
  rootMidiMod: number;
  isScaleHighlightActive: boolean;
  handleMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleMouseMoveIdle: (e: React.MouseEvent<HTMLCanvasElement>) => void;
}

/**
 * Componente de aguja láser de reproducción aislado y de ultra alto rendimiento.
 * Utiliza aceleración por hardware (transform) y se actualiza a 60 FPS sin provocar
 * el redibujado de la cuadrícula o notas del lienzo principal.
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

    // Suscripción al store para actualizar inmediatamente cuando cambia beat manualmente o se pausa
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

export const PianoRollCanvas: React.FC<PianoRollCanvasProps> = React.memo(({
  canvasRef,
  beatWidth,
  rowHeight,
  canvasWidth,
  canvasHeight,
  TOTAL_BEATS,
  selectedNoteIds = [],
  lassoRect,
  tempNote,
  livePitch,
  scalePitchClasses,
  rootMidiMod,
  isScaleHighlightActive,
  handleMouseDown,
  handleMouseMoveIdle
}) => {
  const melodyNotes = useSongStore(state => state.melodyNotes || []);
  const ghostNotes = useSongStore(state => state.ghostNotes || []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0b0910';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 1. Dibujar cuadrícula horizontal y fondo por filas (Scale Highlighting)
    for (let i = 0; i < NOTE_COUNT; i++) {
      const midi = MAX_MIDI - i;
      const pitchClass = ((midi % 12) + 12) % 12;
      const isBlack = [1, 3, 6, 8, 10].includes(pitchClass);
      const inScale = scalePitchClasses?.has(pitchClass) ?? false;
      const isRoot = pitchClass === rootMidiMod;

      if (isScaleHighlightActive) {
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

      ctx.fillRect(0, i * rowHeight, canvasWidth, rowHeight);

      // Línea divisoria horizontal
      ctx.strokeStyle = isRoot ? 'rgba(255, 216, 117, 0.18)' : 'rgba(255, 255, 255, 0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, (i + 1) * rowHeight);
      ctx.lineTo(canvasWidth, (i + 1) * rowHeight);
      ctx.stroke();
    }

    // 2. Dibujar cuadrícula vertical de compases y subdivisiones
    const subdivs = TOTAL_BEATS / GRID_SNAP;
    for (let step = 0; step <= subdivs; step++) {
      const beat = step * GRID_SNAP;
      const x = beat * beatWidth;
      const isMeasure = Math.abs(beat % 4) < 0.001;
      const isBeat = Math.abs(beat % 1) < 0.001;

      if (isMeasure) {
        ctx.strokeStyle = 'rgba(112, 96, 176, 0.28)';
        ctx.lineWidth = 1.5;
      } else if (isBeat) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 0.5;
      }

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    // 3. Dibujar notas fantasma (Ghost Notes de acordes / armonía)
    (ghostNotes || []).forEach((note) => {
      const row = MAX_MIDI - note.midi;
      if (row >= 0 && row < NOTE_COUNT) {
        const x = note.startBeat * beatWidth;
        const y = row * rowHeight;
        const width = note.durationBeats * beatWidth;

        ctx.fillStyle = 'rgba(168, 85, 247, 0.12)';
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
        ctx.lineWidth = 1.5;
        
        ctx.fillRect(x + 2, y + 2, width - 4, rowHeight - 4);
        ctx.strokeRect(x + 2, y + 2, width - 4, rowHeight - 4);
      }
    });

    // 4. Dibujar nota temporal en creación por arrastre
    if (tempNote) {
      const row = MAX_MIDI - tempNote.midi;
      if (row >= 0 && row < NOTE_COUNT) {
        const x = tempNote.startBeat * beatWidth;
        const y = row * rowHeight;
        const width = tempNote.durationBeats * beatWidth;

        ctx.fillStyle = 'rgba(255, 216, 117, 0.4)';
        ctx.strokeStyle = '#ffd875';
        ctx.lineWidth = 1.5;
        
        ctx.fillRect(x + 1, y + 1, width - 2, rowHeight - 2);
        ctx.strokeRect(x + 1, y + 1, width - 2, rowHeight - 2);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(midiToNoteName(tempNote.midi), x + 5, y + (rowHeight / 2 + 3.5));
      }
    }

    // 5. Dibujar notas reales
    (melodyNotes || []).forEach((note) => {
      const row = MAX_MIDI - note.midi;
      if (row >= 0 && row < NOTE_COUNT) {
        const x = note.startBeat * beatWidth;
        const y = row * rowHeight;
        const width = Math.max(8, note.durationBeats * beatWidth);
        const isSelected = selectedNoteIds.includes(note.id);
        const vel = note.velocity ?? 0.8;

        const gradient = ctx.createLinearGradient(x, y, x + width, y);
        if (isSelected) {
          gradient.addColorStop(0, '#ffd875');
          gradient.addColorStop(1, '#e5be52');
        } else {
          const alpha = 0.55 + vel * 0.45;
          gradient.addColorStop(0, `rgba(168, 85, 247, ${alpha})`);
          gradient.addColorStop(1, `rgba(236, 72, 153, ${alpha})`);
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(x + 1, y + 1, width - 2, rowHeight - 2);

        // Borde y tiradores visuales
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.strokeRect(x + 1, y + 1, width - 2, rowHeight - 2);

        // Indicadores sutiles de tiradores duales si está seleccionada
        if (isSelected && width > 24) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x + 1, y + 2, 2, rowHeight - 4);
          ctx.fillRect(x + width - 3, y + 2, 2, rowHeight - 4);
        }

        // Texto del nombre de la nota
        ctx.fillStyle = isSelected ? '#111111' : '#ffffff';
        ctx.font = 'bold 10px monospace';
        if (width > 20) {
          ctx.fillText(note.note, x + 5, y + (rowHeight / 2 + 3.5));
        }
      }
    });

    // 6. Dibujar Lasso Rect (Área de Selección con Clic Derecho)
    if (lassoRect) {
      const lx = Math.min(lassoRect.x1, lassoRect.x2);
      const ly = Math.min(lassoRect.y1, lassoRect.y2);
      const lw = Math.abs(lassoRect.x2 - lassoRect.x1);
      const lh = Math.abs(lassoRect.y2 - lassoRect.y1);

      ctx.fillStyle = 'rgba(255, 216, 117, 0.12)';
      ctx.strokeStyle = 'rgba(255, 216, 117, 0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.fillRect(lx, ly, lw, lh);
      ctx.strokeRect(lx, ly, lw, lh);
      ctx.setLineDash([]);
    }

    // 7. Dibujar Live Pitch detectado por micrófono
    if (livePitch && livePitch.midi >= MIN_MIDI && livePitch.midi <= MAX_MIDI) {
      const row = MAX_MIDI - livePitch.midi;
      const currentBeat = useSongStore.getState().currentBeat ?? 0;
      const x = currentBeat * beatWidth;
      const y = row * rowHeight;
      const width = Math.max(beatWidth * 0.5, 20);

      ctx.fillStyle = 'rgba(255, 0, 128, 0.7)';
      ctx.strokeStyle = '#ff00aa';
      ctx.lineWidth = 2;
      ctx.fillRect(x - 2, y + 1, width, rowHeight - 2);
      ctx.strokeRect(x - 2, y + 1, width, rowHeight - 2);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(livePitch.note, x + 4, y + (rowHeight / 2 + 4));
    }

  }, [
    canvasRef,
    melodyNotes,
    ghostNotes,
    canvasWidth,
    canvasHeight,
    selectedNoteIds,
    lassoRect,
    tempNote,
    livePitch,
    rowHeight,
    beatWidth,
    scalePitchClasses,
    rootMidiMod,
    isScaleHighlightActive,
    TOTAL_BEATS
  ]);

  const handleTouchCanvas = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length !== 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const touchY = e.touches[0].clientY - rect.top;

    const clickBeat = Math.floor((touchX / beatWidth) / GRID_SNAP) * GRID_SNAP;
    const clickedRow = Math.floor(touchY / rowHeight);
    const clickMidi = MAX_MIDI - clickedRow;

    const store = useSongStore.getState();
    const existingNote = (store.melodyNotes || []).find(n => {
      const row = MAX_MIDI - n.midi;
      const x1 = n.startBeat * beatWidth;
      const x2 = (n.startBeat + n.durationBeats) * beatWidth;
      return clickedRow === row && touchX >= x1 && touchX <= x2;
    });

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
    <div style={{ position: 'relative', width: `${canvasWidth}px`, height: `${canvasHeight}px`, flexShrink: 0 }}>
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMoveIdle}
        onTouchStart={handleTouchCanvas}
        onContextMenu={e => e.preventDefault()}
        style={{ 
          display: 'block', 
          width: `${canvasWidth}px`, 
          height: `${canvasHeight}px`,
          flexShrink: 0 
        }}
      />
      <PianoRollPlayhead beatWidth={beatWidth} height={canvasHeight} />
    </div>
  );
});
