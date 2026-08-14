import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { toneEngine } from '../../audio/toneEngine';
import { NOTE_CLASSES, generateMelody } from '../../core/music';
import { LivePitchTracker } from '../../core/audio';
import type { MelodyNote } from '../../utils/typeDefinitions';
import { Mic, Trash, Sparkles, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Copy, Trash2, Search, ChevronRight, Plus } from 'lucide-react';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { ScaleFinderSection } from './ScaleFinderSection';
import { ChannelQuickControl } from '../ui/ChannelQuickControl';
import { useGridZoom } from '../../hooks/useGridZoom';
import { SharedTimelineRuler } from '../shared/SharedTimelineRuler';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ChannelInstrumentControl } from '../ui/ChannelInstrumentControl';

const MIN_MIDI = 24; // C1
const MAX_MIDI = 96; // C7
const NOTE_COUNT = MAX_MIDI - MIN_MIDI + 1;

function midiToNoteName(midi: number): string {
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_CLASSES[noteIndex]}${octave}`;
}

function normalizeNote(n: string): string {
  return n.toUpperCase()
    .replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#')
    .replace('AB', 'G#').replace('BB', 'A#');
}

const PianoSidebar: React.FC<{
  rowHeight: number;
  pianoKeys: any[];
  activeNotes: string[];
  activeMelodyNotes: string[];
}> = React.memo(({ rowHeight, pianoKeys, activeNotes, activeMelodyNotes }) => {
  const [activeMouseKey, setActiveMouseKey] = useState<number | null>(null);

  const harmonyActiveSet = useMemo(() => new Set(activeNotes.map(normalizeNote)), [activeNotes]);
  const melodyActiveSet = useMemo(() => new Set(activeMelodyNotes.map(normalizeNote)), [activeMelodyNotes]);

  const activeTrackId = useSongStore((s) => s.activeTrackId);
  const tracks = useSongStore((s) => s.tracks);
  const activeTrack = tracks.find((t) => t.id === activeTrackId);
  const currentChannelId = activeTrack ? activeTrack.channelId : 'melody';

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setActiveMouseKey(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  return (
    <div className="piano-keys-list" style={{ display: 'flex', flexDirection: 'column' }}>
      {pianoKeys.map((key) => {
        const normalized = normalizeNote(key.name);
        const isMelodyActive = melodyActiveSet.has(normalized);
        const isHarmonyActive = harmonyActiveSet.has(normalized);
        const isMouseActive = activeMouseKey === key.midi;
        let activeClass = '';
        if (isMouseActive || isMelodyActive) activeClass = 'active-melody';
        else if (isHarmonyActive) activeClass = 'active-harmony';

        return (
          <div
            key={key.midi}
            className={`sidebar-key ${key.isBlack ? 'black' : 'white'} ${activeClass}`}
            style={{ height: `${rowHeight}px` }}
            onMouseDown={() => {
              setActiveMouseKey(key.midi);
              toneEngine.playNotePreview(key.name, currentChannelId);
            }}
            onMouseEnter={(e) => {
              if (e.buttons === 1) {
                setActiveMouseKey(key.midi);
                toneEngine.playNotePreview(key.name, currentChannelId);
              }
            }}
            onMouseUp={() => setActiveMouseKey(null)}
            onMouseLeave={() => setActiveMouseKey(null)}
          >
            <span>{key.isBlack ? '' : key.name}</span>
          </div>
        );
      })}
    </div>
  );
});
const PianoRollCanvas: React.FC<{
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  beatWidth: number;
  rowHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  TOTAL_BEATS: number;
  selectedNoteIds: string[];
  lassoRect: any;
  tempNote: any;
  livePitch?: { midi: number; note: string; clarity: number } | null;
  handleMouseDown: any;
  handleMouseMoveIdle: any;
}> = ({
  canvasRef,
  beatWidth,
  rowHeight,
  canvasWidth,
  canvasHeight,
  TOTAL_BEATS,
  selectedNoteIds,
  lassoRect,
  tempNote,
  livePitch,
  handleMouseDown,
  handleMouseMoveIdle
}) => {
  const currentBeat = useSongStore(state => state.currentBeat);
  const melodyNotes = useSongStore(state => state.melodyNotes);
  const ghostNotes = useSongStore(state => state.ghostNotes);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f0f15';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Dibujar cuadrícula horizontal y líneas de notas
    for (let i = 0; i < NOTE_COUNT; i++) {
      const midi = MAX_MIDI - i;
      const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
      
      ctx.fillStyle = isBlack ? '#151522' : '#1d1d2b';
      ctx.fillRect(0, i * rowHeight, canvasWidth, rowHeight);

      ctx.strokeStyle = '#28283d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, (i + 1) * rowHeight);
      ctx.lineTo(canvasWidth, (i + 1) * rowHeight);
      ctx.stroke();
    }

    // Dibujar cuadrícula vertical
    const GRID_SNAP = 0.25;
    const subdivs = TOTAL_BEATS / GRID_SNAP;
    for (let step = 0; step <= subdivs; step++) {
      const beat = step * GRID_SNAP;
      const x = beat * beatWidth;
      const isMeasure = beat % 4 === 0;
      const isBeat = beat % 1 === 0;

      if (isMeasure) {
        ctx.strokeStyle = '#52527a';
        ctx.lineWidth = 1.5;
      } else if (isBeat) {
        ctx.strokeStyle = '#383857';
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = '#222235';
        ctx.lineWidth = 0.5;
      }

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    // Dibujar notas fantasma (Magenta)
    ghostNotes.forEach((note) => {
      const row = MAX_MIDI - note.midi;
      if (row >= 0 && row < NOTE_COUNT) {
        const x = note.startBeat * beatWidth;
        const y = row * rowHeight;
        const width = note.durationBeats * beatWidth;

        ctx.fillStyle = 'rgba(124, 58, 237, 0.15)';
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
        ctx.lineWidth = 1.5;
        
        ctx.fillRect(x + 2, y + 2, width - 4, rowHeight - 4);
        ctx.strokeRect(x + 2, y + 2, width - 4, rowHeight - 4);
      }
    });

    // Dibujar nota temporal en creación por arrastre
    if (tempNote) {
      const row = MAX_MIDI - tempNote.midi;
      if (row >= 0 && row < NOTE_COUNT) {
        const x = tempNote.startBeat * beatWidth;
        const y = row * rowHeight;
        const width = tempNote.durationBeats * beatWidth;

        ctx.fillStyle = 'rgba(0, 229, 255, 0.4)';
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.5;
        
        ctx.fillRect(x + 1, y + 1, width - 2, rowHeight - 2);
        ctx.strokeRect(x + 1, y + 1, width - 2, rowHeight - 2);

        // Nombre de nota provisional
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px sans-serif';
        ctx.fillText(midiToNoteName(tempNote.midi), x + 6, y + (rowHeight / 2 + 4));
      }
    }

    // Dibujar notas reales
    melodyNotes.forEach((note) => {
      const row = MAX_MIDI - note.midi;
      if (row >= 0 && row < NOTE_COUNT) {
        const x = note.startBeat * beatWidth;
        const y = row * rowHeight;
        const width = note.durationBeats * beatWidth;
        const isSelected = selectedNoteIds.includes(note.id);

        const gradient = ctx.createLinearGradient(x, y, x + width, y);
        if (isSelected) {
          gradient.addColorStop(0, '#facc15');
          gradient.addColorStop(1, '#eab308');
        } else {
          gradient.addColorStop(0, '#a855f7');
          gradient.addColorStop(1, '#ec4899');
        }
        ctx.fillStyle = gradient;
        
        ctx.fillRect(x + 1, y + 1, width - 2, rowHeight - 2);

        // Borde
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(x + 1, y + 1, width - 2, rowHeight - 2);

        // Texto
        ctx.fillStyle = isSelected ? '#111111' : '#ffffff';
        ctx.font = '10px sans-serif';
        ctx.fillText(note.note, x + 6, y + (rowHeight / 2 + 4));
      }
    });

    // Dibujar Lasso Rect
    if (lassoRect) {
      const lx = Math.min(lassoRect.x1, lassoRect.x2);
      const ly = Math.min(lassoRect.y1, lassoRect.y2);
      const lw = Math.abs(lassoRect.x2 - lassoRect.x1);
      const lh = Math.abs(lassoRect.y2 - lassoRect.y1);

      ctx.fillStyle = 'rgba(0, 229, 255, 0.15)';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.5;
      ctx.fillRect(lx, ly, lw, lh);
      ctx.strokeRect(lx, ly, lw, lh);
    }

    // Dibujar Live Pitch detectado por micrófono en tiempo real
    if (livePitch && livePitch.midi >= MIN_MIDI && livePitch.midi <= MAX_MIDI) {
      const row = MAX_MIDI - livePitch.midi;
      const x = currentBeat * beatWidth;
      const y = row * rowHeight;
      const width = Math.max(beatWidth * 0.5, 20);

      ctx.fillStyle = 'rgba(255, 0, 128, 0.7)';
      ctx.strokeStyle = '#ff00aa';
      ctx.lineWidth = 2;
      ctx.fillRect(x - 2, y + 1, width, rowHeight - 2);
      ctx.strokeRect(x - 2, y + 1, width, rowHeight - 2);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(livePitch.note, x + 4, y + (rowHeight / 2 + 4));
    }

    // Dibujar Playhead
    const playheadX = currentBeat * beatWidth;
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, canvasHeight);
    ctx.stroke();

  }, [melodyNotes, ghostNotes, currentBeat, canvasWidth, canvasHeight, selectedNoteIds, lassoRect, tempNote, livePitch, rowHeight, beatWidth]);

  const handleTouchCanvas = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length !== 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const touchY = e.touches[0].clientY - rect.top;

    const GRID_SNAP = 0.25;
    const clickBeat = Math.floor((touchX / beatWidth) / GRID_SNAP) * GRID_SNAP;
    const clickedRow = Math.floor(touchY / rowHeight);
    const clickMidi = MAX_MIDI - clickedRow;

    const store = useSongStore.getState();
    const existingNote = store.melodyNotes.find(n => {
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
  );
};

export const PianoRollView = () => {
  const {
    melodyNotes,
    addMelodyNote,
    removeMelodyNote,
    updateMelodyNote,
    setMelodyNotes,
    setCurrentBeat,
    ghostNotes,
    setGhostNotes,
    isPlaying,
    bpm,
    key,
    scale,
    setKey,
    setScale,
    chordBlocks,
    activeNotes,
    activeMelodyNotes,
    isAutoSuggestions,
    tracks,
    activeTrackId,
    addPianoRollTrack,
    removePianoRollTrack,
    renamePianoRollTrack,
    setActiveTrackId,
    updateTrackViewport,
    clipboardNotes,
    setClipboardNotes
  } = useSongStore(useShallow(state => ({
    melodyNotes: state.melodyNotes,
    addMelodyNote: state.addMelodyNote,
    removeMelodyNote: state.removeMelodyNote,
    updateMelodyNote: state.updateMelodyNote,
    setMelodyNotes: state.setMelodyNotes,
    setCurrentBeat: state.setCurrentBeat,
    ghostNotes: state.ghostNotes,
    setGhostNotes: state.setGhostNotes,
    isPlaying: state.isPlaying,
    bpm: state.bpm,
    key: state.key,
    scale: state.scale,
    setKey: state.setKey,
    setScale: state.setScale,
    chordBlocks: state.chordBlocks,
    activeNotes: state.activeNotes,
    activeMelodyNotes: state.activeMelodyNotes,
    isAutoSuggestions: state.isAutoSuggestions,
    tracks: state.tracks,
    activeTrackId: state.activeTrackId,
    addPianoRollTrack: state.addPianoRollTrack,
    removePianoRollTrack: state.removePianoRollTrack,
    renamePianoRollTrack: state.renamePianoRollTrack,
    setActiveTrackId: state.setActiveTrackId,
    updateTrackViewport: state.updateTrackViewport,
    clipboardNotes: state.clipboardNotes,
    setClipboardNotes: state.setClipboardNotes
  })));

  const containerRef = useRef<HTMLDivElement>(null);
  const pianoRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentTrack = tracks.find(t => t.id === activeTrackId);
  const currentChannelId = currentTrack?.channelId || 'melody';

  // Estados de control
  const [selectedNoteLength, setSelectedNoteLength] = useState<number>(1);
  const [isRecording, setIsRecording] = useState(false);
  const [snapToScale, setSnapToScale] = useState(true);
  const [livePitch, setLivePitch] = useState<{ midi: number; note: string; clarity: number } | null>(null);
  const [isGeneratingGhost, setIsGeneratingGhost] = useState(false);

  // UX de Selección y Arrastre
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [lassoRect, setLassoRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  
  // Nota temporal en creación interactiva por arrastre
  const [tempNote, setTempNote] = useState<{ midi: number; startBeat: number; durationBeats: number } | null>(null);

  // Menú contextual flotante del Piano Roll
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'notes' | 'canvas'; beat?: number; midi?: number } | null>(null);
  const [isScaleFinderOpen, setIsScaleFinderOpen] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{isOpen: boolean, trackId: string, trackName: string, type: 'track' | 'clear'}>({isOpen: false, trackId: '', trackName: '', type: 'track'});
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState<string>('');

  // Referencias para la grabación de audio con LivePitchTracker
  const livePitchTrackerRef = useRef<LivePitchTracker | null>(null);

  // Reemplazando lógica de zoom por el custom hook
  const { rowHeight, beatWidth, setRowHeight, setBeatWidth, TOTAL_BEATS } = useGridZoom();
  const GRID_SNAP = 0.25; // Semicorcheas

  const canvasWidth = TOTAL_BEATS * beatWidth;
  const canvasHeight = NOTE_COUNT * rowHeight;

  const pianoKeys = useMemo(() => {
    const keys = [];
    for (let m = MAX_MIDI; m >= MIN_MIDI; m--) {
      const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
      keys.push({
        midi: m,
        name: midiToNoteName(m),
        isBlack
      });
    }
    return keys;
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (pianoRef.current) {
      pianoRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    const target = e.currentTarget;
    if (activeTrackId) {
      updateTrackViewport(activeTrackId, {
        scrollLeft: target.scrollLeft,
        scrollTop: target.scrollTop
      });
    }
  };

  // Restauración de Viewport y Zoom al alternar de pista activa
  useEffect(() => {
    const activeTrack = tracks.find(t => t.id === activeTrackId);
    if (activeTrack && activeTrack.viewport && containerRef.current) {
      containerRef.current.scrollLeft = activeTrack.viewport.scrollLeft ?? 0;
      containerRef.current.scrollTop = activeTrack.viewport.scrollTop ?? 600;
      if (pianoRef.current) {
        pianoRef.current.scrollTop = activeTrack.viewport.scrollTop ?? 600;
      }
    }
  }, [activeTrackId, tracks, updateTrackViewport]);

  // Atajos de teclado QoL: Ctrl+C, Ctrl+V y Tecla Supr / Delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // Tecla Supr / Delete / Backspace: eliminar notas seleccionadas
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          selectedNoteIds.forEach(id => removeMelodyNote(id));
          setSelectedNoteIds([]);
        }
      }

      // Ctrl+C / Cmd+C: Copiar notas seleccionadas
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const selected = melodyNotes.filter(n => selectedNoteIds.includes(n.id));
          if (selected.length > 0) {
            setClipboardNotes(selected);
          }
        }
      }

      // Ctrl+V / Cmd+V: Pegar notas comenzando en la posición del playhead
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        if (clipboardNotes && clipboardNotes.length > 0) {
          e.preventDefault();
          const currentPlayheadBeat = useSongStore.getState().currentBeat;
          const minStartBeat = Math.min(...clipboardNotes.map(n => n.startBeat));
          
          const pastedNotes: MelodyNote[] = clipboardNotes.map(n => {
            const relativeOffset = n.startBeat - minStartBeat;
            return {
              id: `pasted_${Math.random().toString(36).substr(2, 9)}`,
              note: n.note,
              midi: n.midi,
              startBeat: currentPlayheadBeat + relativeOffset,
              durationBeats: n.durationBeats,
              velocity: n.velocity
            };
          });

          const newMelodyNotes = [...melodyNotes, ...pastedNotes];
          setMelodyNotes(newMelodyNotes);
          setSelectedNoteIds(pastedNotes.map(n => n.id));
          if (pastedNotes.length > 0) {
            toneEngine.playNotePreview(pastedNotes[0].note);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNoteIds, melodyNotes, removeMelodyNote, setMelodyNotes, clipboardNotes, setClipboardNotes]);

  // 1. Generador Melódico Algorítmico Inteligente
  const fetchGhostNotes = React.useCallback(async () => {
    setIsGeneratingGhost(true);
    try {
      const suggestions = generateMelody({
        key,
        scale,
        chordBlocks,
        totalBeats: TOTAL_BEATS,
        style: 'catchy'
      });
      setGhostNotes(suggestions);
    } catch (err) {
      console.error('Error generando sugerencias melódicas:', err);
    } finally {
      setIsGeneratingGhost(false);
    }
  }, [chordBlocks, TOTAL_BEATS, key, scale, setGhostNotes]);

  // Solo disparo automático cuando isAutoSuggestions está activo
  useEffect(() => {
    if (!isAutoSuggestions) return;
    let active = true;
    const timer = setTimeout(() => {
      if (!active) return;
      setIsGeneratingGhost(true);
      try {
        const suggestions = generateMelody({
          key,
          scale,
          chordBlocks,
          totalBeats: TOTAL_BEATS,
          style: 'catchy'
        });
        if (active) setGhostNotes(suggestions);
      } catch (err) {
        console.error('Error generando sugerencias melódicas:', err);
      } finally {
        if (active) setIsGeneratingGhost(false);
      }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [chordBlocks, TOTAL_BEATS, key, scale, setGhostNotes, isAutoSuggestions]);

  // 5. Sistema de Zoom interactivo mediante Ctrl+Scroll (horizontal) y Alt+Scroll (vertical)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        // Zoom Horizontal (ancho de beat)
        e.preventDefault();
        setBeatWidth((prev) => {
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          const next = Math.round(prev * factor);
          return Math.max(48, Math.min(240, next));
        });
      } else if (e.altKey) {
        // Zoom Vertical (alto de fila / teclas)
        e.preventDefault();
        setRowHeight((prev) => {
          const delta = e.deltaY < 0 ? 2 : -2;
          const next = prev + delta;
          return Math.max(14, Math.min(48, next));
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);



  // 4. UX Interactiva de Ratón Refinada
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    // Detectar si hacemos clic en alguna nota existente
    let clickedNote: MelodyNote | null = null;
    let mode: 'move' | 'resize' | 'lasso' | 'create_drag' = 'lasso';

    for (const note of melodyNotes) {
      const row = MAX_MIDI - note.midi;
      const ny = row * rowHeight;
      const nx = note.startBeat * beatWidth;
      const nw = note.durationBeats * beatWidth;

      if (startX >= nx && startX <= nx + nw && startY >= ny && startY <= ny + rowHeight) {
        clickedNote = note;
        const isNearRightEdge = (nx + nw) - startX < 12;
        mode = isNearRightEdge ? 'resize' : 'move';
        break;
      }
    }

    // -------------------------------------------------------------
    // CASO A: CLICK DERECHO
    // -------------------------------------------------------------
    if (e.button === 2) {
      e.preventDefault();
      if (clickedNote) {
        // A1. Click derecho sobre nota existente: abrir menú contextual de notas en el ratón
        const isAlreadySelected = selectedNoteIds.includes(clickedNote.id);
        if (!isAlreadySelected) {
          setSelectedNoteIds([clickedNote.id]);
        }
        
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          type: 'notes'
        });
        
        const closeMenu = () => {
          setContextMenu(null);
          window.removeEventListener('click', closeMenu);
        };
        window.addEventListener('click', closeMenu);
      } else {
        // A2. Click derecho sobre espacio vacío: iniciar selección por Lasso o abrir menú si no hay arrastre
        let hasMoved = false;
        const handleMouseMoveLasso = (moveEvent: MouseEvent) => {
          const dx = Math.abs(moveEvent.clientX - e.clientX);
          const dy = Math.abs(moveEvent.clientY - e.clientY);
          if (dx > 4 || dy > 4) {
            hasMoved = true;
          }
          const currentRect = canvas.getBoundingClientRect();
          const curX = moveEvent.clientX - currentRect.left;
          const curY = moveEvent.clientY - currentRect.top;

          setLassoRect({
            x1: startX,
            y1: startY,
            x2: curX,
            y2: curY
          });

          // Buscar notas que colisionan con el rectángulo de selección en tiempo real
          const lx1 = Math.min(startX, curX);
          const ly1 = Math.min(startY, curY);
          const lx2 = Math.max(startX, curX);
          const ly2 = Math.max(startY, curY);

          const intersectingIds: string[] = [];

          melodyNotes.forEach(note => {
            const row = MAX_MIDI - note.midi;
            const ny1 = row * rowHeight;
            const ny2 = ny1 + rowHeight;
            const nx1 = note.startBeat * beatWidth;
            const nx2 = (note.startBeat + note.durationBeats) * beatWidth;

            if (nx1 < lx2 && nx2 > lx1 && ny1 < ly2 && ny2 > ly1) {
              intersectingIds.push(note.id);
            }
          });

          if (moveEvent.ctrlKey) {
            const combined = Array.from(new Set([...selectedNoteIds, ...intersectingIds]));
            setSelectedNoteIds(combined);
          } else {
            setSelectedNoteIds(intersectingIds);
          }
        };

        const handleMouseUpLasso = () => {
          window.removeEventListener('mousemove', handleMouseMoveLasso);
          window.removeEventListener('mouseup', handleMouseUpLasso);
          setLassoRect(null);

          if (!hasMoved) {
            const clickBeat = Math.floor(startX / beatWidth);
            const clickMidi = MAX_MIDI - Math.floor(startY / rowHeight);
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              type: 'canvas',
              beat: clickBeat,
              midi: clickMidi
            });

            const closeMenu = () => {
              setContextMenu(null);
              window.removeEventListener('click', closeMenu);
            };
            window.addEventListener('click', closeMenu);
          }
        };

        window.addEventListener('mousemove', handleMouseMoveLasso);
        window.addEventListener('mouseup', handleMouseUpLasso);
      }
      return;
    }

    // -------------------------------------------------------------
    // CASO B: CLICK IZQUIERDO
    // -------------------------------------------------------------
    if (e.button === 0) {
      if (clickedNote) {
        // B1. Doble click izquierdo sobre nota existente: ELIMINAR NOTA
        if (e.detail === 2) {
          removeMelodyNote(clickedNote.id);
          setSelectedNoteIds(selectedNoteIds.filter(id => id !== clickedNote!.id));
          return;
        }

        // B2. Click simple izquierdo sobre nota: iniciar arrastre / redimensión
        const isAlreadySelected = selectedNoteIds.includes(clickedNote.id);
        let newSelection = [...selectedNoteIds];

        if (e.ctrlKey) {
          if (isAlreadySelected) {
            newSelection = newSelection.filter(id => id !== clickedNote!.id);
          } else {
            newSelection.push(clickedNote.id);
          }
        } else {
          if (!isAlreadySelected) {
            newSelection = [clickedNote.id];
          }
        }

        setSelectedNoteIds(newSelection);
        toneEngine.playNotePreview(clickedNote.note, currentChannelId);

        const initialNotesState = melodyNotes
          .filter(n => newSelection.includes(n.id))
          .map(n => ({ id: n.id, midi: n.midi, startBeat: n.startBeat, durationBeats: n.durationBeats }));

        // Llevar la cuenta del último tono sonado del acorde principal del drag para feedback auditivo reactivo
        let lastPlayedMidi = clickedNote.midi;

        const handleMouseMoveDrag = (moveEvent: MouseEvent) => {
          const currentRect = canvas.getBoundingClientRect();
          const curX = moveEvent.clientX - currentRect.left;
          const curY = moveEvent.clientY - currentRect.top;

          const deltaX = curX - startX;
          const deltaY = curY - startY;

          if (mode === 'move') {
            const deltaBeats = Math.round((deltaX / beatWidth) / GRID_SNAP) * GRID_SNAP;
            const deltaMidi = -Math.round(deltaY / rowHeight);

            let primaryNewMidi = clickedNote!.midi;

            initialNotesState.forEach(initNote => {
              const newStartBeat = Math.max(0, initNote.startBeat + deltaBeats);
              const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, initNote.midi + deltaMidi));
              const newNoteName = midiToNoteName(newMidi);
              
              if (initNote.id === clickedNote!.id) {
                primaryNewMidi = newMidi;
              }

              updateMelodyNote(initNote.id, {
                startBeat: newStartBeat,
                midi: newMidi,
                note: newNoteName
              });
            });

            // Feedback auditivo reactivo al mover verticalmente (cada semitono nuevo)
            if (primaryNewMidi !== lastPlayedMidi) {
              lastPlayedMidi = primaryNewMidi;
              toneEngine.playNotePreview(midiToNoteName(primaryNewMidi), currentChannelId);
            }

          } else if (mode === 'resize') {
            const deltaBeats = Math.round((deltaX / beatWidth) / GRID_SNAP) * GRID_SNAP;

            initialNotesState.forEach(initNote => {
              const newDuration = Math.max(GRID_SNAP, initNote.durationBeats + deltaBeats);
              updateMelodyNote(initNote.id, { durationBeats: newDuration });
            });
          }
        };

        const handleMouseUpDrag = () => {
          window.removeEventListener('mousemove', handleMouseMoveDrag);
          window.removeEventListener('mouseup', handleMouseUpDrag);
        };

        window.addEventListener('mousemove', handleMouseMoveDrag);
        window.addEventListener('mouseup', handleMouseUpDrag);

      } else {
        // B3. Doble click izquierdo en fondo vacío: CREAR NOTA DE DURACIÓN FIJA
        if (e.detail === 2) {
          const clickedRow = Math.floor(startY / rowHeight);
          const clickedMidi = MAX_MIDI - clickedRow;
          const snappedBeat = Math.floor(startX / beatWidth / GRID_SNAP) * GRID_SNAP;
          
          const noteName = midiToNoteName(clickedMidi);
          toneEngine.playNotePreview(noteName, currentChannelId);

          addMelodyNote({
            note: noteName,
            midi: clickedMidi,
            startBeat: snappedBeat,
            durationBeats: selectedNoteLength,
            velocity: 0.8
          });
          return;
        }

        // B4. Click simple en fondo vacío: Deseleccionar todo y preparar posible creación por arrastre
        setSelectedNoteIds([]);
        const clickedRow = Math.floor(startY / rowHeight);
        const clickedMidi = MAX_MIDI - clickedRow;
        const snappedStartBeat = Math.floor(startX / beatWidth / GRID_SNAP) * GRID_SNAP;

        let hasStartedDrag = false;

        const handleMouseMoveCreate = (moveEvent: MouseEvent) => {
          const currentRect = canvas.getBoundingClientRect();
          const curX = moveEvent.clientX - currentRect.left;
          const distance = Math.abs(curX - startX);

          // Solo activamos la creación e inicializamos tempNote si se arrastra más de 8px
          if (distance > 8) {
            hasStartedDrag = true;
            const currentBeatSnapped = Math.max(snappedStartBeat + GRID_SNAP, Math.floor(curX / beatWidth / GRID_SNAP) * GRID_SNAP);
            const duration = currentBeatSnapped - snappedStartBeat;

            setTempNote({
              midi: clickedMidi,
              startBeat: snappedStartBeat,
              durationBeats: duration
            });
          }
        };

        const handleMouseUpCreate = (upEvent: MouseEvent) => {
          window.removeEventListener('mousemove', handleMouseMoveCreate);
          window.removeEventListener('mouseup', handleMouseUpCreate);

          // Obtener la posición final al soltar
          const currentRect = canvas.getBoundingClientRect();
          const curX = upEvent.clientX - currentRect.left;
          const distance = Math.abs(curX - startX);

          // Si el arrastre fue insignificante (click seco), movemos el cursor (playhead)
          if (!hasStartedDrag || distance <= 8) {
            toneEngine.seekToBeat(snappedStartBeat);
          } else {
            // Si hubo arrastre significativo, creamos la nota con la duración del arrastre
            const currentBeatSnapped = Math.max(snappedStartBeat + GRID_SNAP, Math.floor(curX / beatWidth / GRID_SNAP) * GRID_SNAP);
            const finalDuration = currentBeatSnapped - snappedStartBeat;

            const noteName = midiToNoteName(clickedMidi);
            toneEngine.playNotePreview(noteName, currentChannelId);

            addMelodyNote({
              note: noteName,
              midi: clickedMidi,
              startBeat: snappedStartBeat,
              durationBeats: finalDuration,
              velocity: 0.8
            });
          }

          setTempNote(null);
        };

        window.addEventListener('mousemove', handleMouseMoveCreate);
        window.addEventListener('mouseup', handleMouseUpCreate);
      }
    }
  };

  // Cambiar cursor en IDLE
  const handleMouseMoveIdle = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;

    let hoverMode: 'move' | 'resize' | 'crosshair' = 'crosshair';

    for (const note of melodyNotes) {
      const row = MAX_MIDI - note.midi;
      const ny = row * rowHeight;
      const nx = note.startBeat * beatWidth;
      const nw = note.durationBeats * beatWidth;

      if (curX >= nx && curX <= nx + nw && curY >= ny && curY <= ny + rowHeight) {
        const isNearRightEdge = (nx + nw) - curX < 12;
        hoverMode = isNearRightEdge ? 'resize' : 'move';
        break;
      }
    }

    if (hoverMode === 'resize') {
      canvas.style.cursor = 'ew-resize';
    } else if (hoverMode === 'move') {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  };

  // Operaciones grupales desde el click derecho
  const handleContextAction = (action: 'delete' | 'duplicate' | 'transpose' | 'deselect', value = 0) => {
    if (action === 'deselect') {
      setSelectedNoteIds([]);
      return;
    }

    if (action === 'delete') {
      if (selectedNoteIds.length > 0) {
        selectedNoteIds.forEach(id => removeMelodyNote(id));
        setSelectedNoteIds([]);
      }
    } else if (action === 'duplicate') {
      if (selectedNoteIds.length > 0) {
        let maxEnd = 0;
        selectedNoteIds.forEach(id => {
          const n = melodyNotes.find(note => note.id === id);
          if (n) maxEnd = Math.max(maxEnd, n.startBeat + n.durationBeats);
        });

        const duplicates: MelodyNote[] = [];
        selectedNoteIds.forEach(id => {
          const n = melodyNotes.find(note => note.id === id);
          if (n) {
            duplicates.push({
              id: Math.random().toString(36).substr(2, 9),
              note: n.note,
              midi: n.midi,
              startBeat: n.startBeat + maxEnd,
              durationBeats: n.durationBeats,
              velocity: n.velocity
            });
          }
        });

        // Feedback sonoro del acorde duplicado
        if (duplicates.length > 0) {
          toneEngine.playNotePreview(duplicates[0].note);
        }

        setMelodyNotes([...melodyNotes, ...duplicates]);
        setSelectedNoteIds(duplicates.map(d => d.id));
      }
    } else if (action === 'transpose') {
      if (selectedNoteIds.length > 0) {
        let sampleNoteName = '';
        selectedNoteIds.forEach(id => {
          const n = melodyNotes.find(note => note.id === id);
          if (n) {
            const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, n.midi + value));
            sampleNoteName = midiToNoteName(newMidi);
            updateMelodyNote(id, {
              midi: newMidi,
              note: sampleNoteName
            });
          }
        });

        // Feedback sonoro reactivo al transponer en bloque
        if (sampleNoteName) {
          toneEngine.playNotePreview(sampleNoteName);
        }
      }
    }
  };

  // Convertir las notas fantasma en notas reales
  const acceptGhostNotes = () => {
    if (ghostNotes.length === 0) return;
    ghostNotes.forEach(gn => {
      const duplicate = melodyNotes.some(
        n => n.midi === gn.midi && n.startBeat === gn.startBeat
      );
      if (!duplicate) {
        addMelodyNote({
          note: gn.note,
          midi: gn.midi,
          startBeat: gn.startBeat,
          durationBeats: gn.durationBeats,
          velocity: 0.7
        });
      }
    });
    setGhostNotes([]);
  };

  // Transcripción de audio / Live Vocal-to-MIDI
  const startRecording = async () => {
    try {
      if (!isPlaying) {
        await toneEngine.init();
        useSongStore.getState().setPlaying(true);
      }

      const currentTransportSec = (useSongStore.getState().currentBeat * 60) / bpm;
      const tracker = new LivePitchTracker({
        minMidi: MIN_MIDI,
        maxMidi: MAX_MIDI,
        clarityThreshold: 0.80,
        onLivePitch: (p) => setLivePitch(p)
      });
      livePitchTrackerRef.current = tracker;

      await tracker.start(currentTransportSec);
      setIsRecording(true);

    } catch (err) {
      console.error('Error accediendo al micrófono:', err);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setLivePitch(null);

    const tracker = livePitchTrackerRef.current;
    if (!tracker) return;

    const rawSamples = tracker.stop();
    livePitchTrackerRef.current = null;

    if (rawSamples.length === 0) return;

    const transcribedNotes = tracker.processRecordedNotes(rawSamples, bpm, {
      snapToScale,
      key,
      scale,
      gridSnap: GRID_SNAP,
      minDurationSec: 0.08
    });

    transcribedNotes.forEach((n) => {
      addMelodyNote({
        note: n.note,
        midi: n.midi,
        startBeat: n.startBeat,
        durationBeats: n.durationBeats,
        velocity: 0.8
      });
    });
  };

  const handleClearMelody = () => {
    setConfirmModalConfig({ isOpen: true, trackId: '', trackName: '', type: 'clear' });
  };


  return (
    <div className="piano-roll-view">
      {/* Barra de Pistas Multicanal de Piano Roll */}
      <div className="piano-roll-tabs-bar" style={{ display: 'flex', gap: '4px', padding: '8px 12px', background: 'rgba(15, 15, 22, 0.95)', borderBottom: '1px solid var(--border-color)', alignItems: 'center', flexWrap: 'wrap' }}>
        {tracks.map((track) => {
          const isActive = track.id === activeTrackId;
          return (
            <div
              key={track.id}
              className={`piano-track-tab ${isActive ? 'active' : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                background: isActive ? 'rgba(30, 32, 40, 1)' : 'rgba(0,0,0,0.3)',
                borderTop: isActive ? `2px solid ${track.color}` : '1px solid rgba(255,255,255,0.06)',
                borderRight: '1px solid rgba(255,255,255,0.06)',
                borderLeft: '1px solid rgba(255,255,255,0.06)',
                borderBottom: isActive ? 'none' : '1px solid rgba(255,255,255,0.06)',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontFamily: "'Share Tech Mono', monospace",
                transition: 'background 0.15s ease'
              }}
              onClick={() => setActiveTrackId(track.id)}
            >
              <span className="track-tab-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: track.color, boxShadow: isActive ? `0 0 6px ${track.color}` : 'none' }} />
              {editingTrackId === track.id ? (
                <input
                  type="text"
                  value={editingTrackName}
                  onChange={(e) => setEditingTrackName(e.target.value)}
                  onBlur={() => {
                    if (editingTrackName.trim()) {
                      renamePianoRollTrack(track.id, editingTrackName.trim());
                    }
                    setEditingTrackId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editingTrackName.trim()) {
                        renamePianoRollTrack(track.id, editingTrackName.trim());
                      }
                      setEditingTrackId(null);
                    } else if (e.key === 'Escape') {
                      setEditingTrackId(null);
                    }
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid #00e5ff',
                    color: 'inherit',
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                    outline: 'none',
                    width: `${Math.max(50, editingTrackName.length * 8)}px`,
                    padding: '0 2px'
                  }}
                />
              ) : (
                <span
                  className="track-tab-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingTrackId(track.id);
                    setEditingTrackName(track.name);
                  }}
                  title="Doble click para renombrar pista"
                >
                  {track.name}
                </span>
              )}
              {tracks.length > 1 && (
                <button
                  className="track-tab-close-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (track.notes.length === 0) {
                      const trackIndex = tracks.findIndex(t => t.id === track.id);
                      if (isActive) {
                        const newActiveTrack = tracks[trackIndex - 1] || tracks[trackIndex + 1];
                        if (newActiveTrack) setActiveTrackId(newActiveTrack.id);
                      }
                      removePianoRollTrack(track.id);
                    } else {
                      setConfirmModalConfig({ isOpen: true, trackId: track.id, trackName: track.name, type: 'track' });
                    }
                  }}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
                  title="Eliminar esta pista"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <button
          className="piano-track-add-btn"
          onClick={() => addPianoRollTrack()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 10px',
            background: 'rgba(0, 229, 255, 0.1)',
            border: '1px solid rgba(0, 229, 255, 0.3)',
            color: '#00e5ff',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontFamily: "'Share Tech Mono', monospace"
          }}
          title="Añadir nueva pista"
        >
          <Plus size={14} />
          <span>Nueva Pista</span>
        </button>

        {(() => {
          const activeTrack = tracks.find(t => t.id === activeTrackId);
          const activeChannelId = activeTrack ? activeTrack.channelId : 'melody';
          return <ChannelInstrumentControl channelId={activeChannelId} style={{ marginLeft: 'auto' }} />;
        })()}
      </div>

      {/* Barra de herramientas */}
      <div className="piano-roll-toolbar">
        {(() => {
          const activeTrack = tracks.find(t => t.id === activeTrackId);
          return <ChannelQuickControl channelId={activeTrack ? activeTrack.channelId : 'melody'} />;
        })()}

        {/* Segmento de Duración de Nota por Defecto (5 Estados sin texto) */}

        <div className="toolbar-group note-length-segment">
          <button 
            className={`segment-btn ${selectedNoteLength === 4 ? 'active' : ''}`}
            onClick={() => setSelectedNoteLength(4)}
            title="Redonda (4 beats)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" style={{ transform: 'rotate(-20deg)' }}>
              <ellipse cx="12" cy="12" rx="7" ry="4.5" />
            </svg>
          </button>
          <button 
            className={`segment-btn ${selectedNoteLength === 2 ? 'active' : ''}`}
            onClick={() => setSelectedNoteLength(2)}
            title="Blanca (2 beats)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <ellipse cx="9" cy="15" rx="5" ry="3.5" stroke="currentColor" strokeWidth="2" transform="rotate(-20 9 15)" />
              <line x1="13.5" y1="15" x2="13.5" y2="4" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button 
            className={`segment-btn ${selectedNoteLength === 1 ? 'active' : ''}`}
            onClick={() => setSelectedNoteLength(1)}
            title="Negra (1 beat)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <ellipse cx="9" cy="15" rx="5" ry="3.5" transform="rotate(-20 9 15)" />
              <line x1="13.5" y1="15" x2="13.5" y2="4" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button 
            className={`segment-btn ${selectedNoteLength === 0.5 ? 'active' : ''}`}
            onClick={() => setSelectedNoteLength(0.5)}
            title="Corchea (1/2 beat)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <ellipse cx="8" cy="15" rx="4.5" ry="3" transform="rotate(-20 8 15)" />
              <line x1="12.2" y1="15" x2="12.2" y2="4" stroke="currentColor" strokeWidth="2" />
              <path d="M12.2,4 Q16.5,7 15.5,11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button 
            className={`segment-btn ${selectedNoteLength === 0.25 ? 'active' : ''}`}
            onClick={() => setSelectedNoteLength(0.25)}
            title="Semicorchea (1/4 beat)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <ellipse cx="8" cy="15" rx="4.5" ry="3" transform="rotate(-20 8 15)" />
              <line x1="12.2" y1="15" x2="12.2" y2="4" stroke="currentColor" strokeWidth="2" />
              <path d="M12.2,4 Q16.5,7 15.5,11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M12.2,7 Q16.5,10 15.5,14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Acciones de la Melodía */}
        <div className="toolbar-group tool-actions-group">
          {/* Botón Grabar Tarareo (Mic) */}
          <button 
            className={`control-btn mic-record-btn ${isRecording ? 'active' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            title={isRecording ? "Detener y procesar tarareo" : "Grabar tarareo silbando/cantando durante la reproducción"}
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Mic size={16} />
            <span className={`record-led ${isRecording ? 'recording' : ''}`} />
          </button>

          {/* Selector de Modo de Afinación: Escala vs Cromático */}
          <button
            className={`control-btn scale-snap-toggle ${snapToScale ? 'active' : ''}`}
            onClick={() => setSnapToScale(!snapToScale)}
            title={snapToScale ? "Modo Mic: Acoplado a la Escala Activa (clic para cambiar a Cromático)" : "Modo Mic: Cromático Libre (clic para acoplar a la Escala)"}
            style={{
              padding: '2px 8px',
              fontSize: '0.72rem',
              fontWeight: 'bold',
              fontFamily: "'Share Tech Mono', monospace",
              letterSpacing: '0.5px',
              color: snapToScale ? '#00e5ff' : '#a855f7',
              borderColor: snapToScale ? 'rgba(0, 229, 255, 0.4)' : 'rgba(168, 85, 247, 0.4)',
              background: snapToScale ? 'rgba(0, 229, 255, 0.08)' : 'rgba(168, 85, 247, 0.08)'
            }}
          >
            {snapToScale ? 'ESCALA' : 'CROM'}
          </button>

          {/* Botón actualizar sugerencias melódicas (modo manual) */}
          {!isAutoSuggestions && (
            <button
              className="control-btn refresh-suggestions-btn"
              onClick={fetchGhostNotes}
              title="Generar sugerencias melódicas algorítmicas"
              style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span style={{ fontSize: '14px', lineHeight: 1 }}>🔄</span>
            </button>
          )}

          {/* Botón Aceptar Sugerencias (Sparkles) */}
          {ghostNotes.length > 0 && (
            <button 
              className="control-btn accept-sug-btn" 
              onClick={acceptGhostNotes} 
              title={`Aceptar sugerencias melódicas (${ghostNotes.length} notas)`}
              style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Sparkles size={16} style={{ color: 'var(--accent)' }} />
              <span className="suggestion-badge">{ghostNotes.length}</span>
            </button>
          )}
          
          {/* Botón Limpiar Melodía (Trash) */}
          <button 
            className="control-btn clear-melody-btn" 
            onClick={handleClearMelody}
            title="Limpiar todas las notas de la melodía"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash size={16} style={{ color: '#ef5350' }} />
          </button>
        </div>
      </div>

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
            {/* Espaciador de alineación vertical con la regla del canvas - sticky dentro del contenedor de scroll */}
            <div 
              className="sidebar-spacer" 
              style={{ 
                height: '42px', 
                position: 'sticky', 
                top: 0, 
                zIndex: 15, 
                backgroundColor: '#121614', 
                borderBottom: '2px solid var(--border-color)', 
                borderRight: '1px solid var(--border-color)',
                flexShrink: 0
              }} 
            />
            
            <PianoSidebar 
              rowHeight={rowHeight}
              pianoKeys={pianoKeys}
              activeNotes={activeNotes}
              activeMelodyNotes={activeMelodyNotes}
            />
          </div>
        </div>

        <div 
          className="canvas-container" 
          ref={containerRef} 
          onScroll={handleScroll}
          style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'auto' }}
        >
          <SharedTimelineRuler
            TOTAL_BEATS={TOTAL_BEATS}
            beatWidth={beatWidth}
            canvasWidth={canvasWidth}
            chordBlocks={chordBlocks}
            setCurrentBeat={setCurrentBeat}
          />

          <PianoRollCanvas
            canvasRef={canvasRef}
            beatWidth={beatWidth}
            rowHeight={rowHeight}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            TOTAL_BEATS={TOTAL_BEATS}
            selectedNoteIds={selectedNoteIds}
            lassoRect={lassoRect}
            tempNote={tempNote}
            livePitch={livePitch}
            handleMouseDown={handleMouseDown}
            handleMouseMoveIdle={handleMouseMoveIdle}
          />
        </div>
      </div>
      
      {isGeneratingGhost && <div className="generating-indicator">IA analizando melodía...</div>}

      {/* Menú Contextual Local del Piano Roll */}
      {contextMenu && contextMenu.type === 'notes' && (
        <ContextMenuContainer x={contextMenu.x} y={contextMenu.y}>
          <div className="menu-header">Edición de Notas ({selectedNoteIds.length} sel)</div>
          
          {/* Barra de Acciones Rápidas estilo Windows 11 */}
          <div className="menu-quick-actions">
            <button
              type="button"
              className="quick-action-btn"
              title="Transponer -1 Semitono"
              onClick={() => handleContextAction('transpose', -1)}
              disabled={selectedNoteIds.length === 0}
            >
              <ArrowDown size={14} />
              <span className="btn-subtext">-1</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              title="Transponer +1 Semitono"
              onClick={() => handleContextAction('transpose', 1)}
              disabled={selectedNoteIds.length === 0}
            >
              <ArrowUp size={14} />
              <span className="btn-subtext">+1</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              title="Bajar 1 Octava (-12)"
              onClick={() => handleContextAction('transpose', -12)}
              disabled={selectedNoteIds.length === 0}
            >
              <ChevronsDown size={14} />
              <span className="btn-subtext">-12</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              title="Subir 1 Octava (+12)"
              onClick={() => handleContextAction('transpose', 12)}
              disabled={selectedNoteIds.length === 0}
            >
              <ChevronsUp size={14} />
              <span className="btn-subtext">+12</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              title="Duplicar notas seleccionadas"
              onClick={() => handleContextAction('duplicate')}
              disabled={selectedNoteIds.length === 0}
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              className="quick-action-btn danger"
              title="Eliminar selección"
              onClick={() => handleContextAction('delete')}
              disabled={selectedNoteIds.length === 0}
            >
              <Trash2 size={14} />
            </button>
          </div>

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
              onSelectScale={(newKey, newScale) => {
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
            onClick={() => handleContextAction('deselect')}
            disabled={selectedNoteIds.length === 0}
          >
            Deseleccionar todo
          </button>
        </ContextMenuContainer>
      )}

      {contextMenu && contextMenu.type === 'canvas' && (
        <ContextMenuContainer x={contextMenu.x} y={contextMenu.y}>
          <div className="menu-header">Pista Melódica</div>

          {contextMenu.midi !== undefined && contextMenu.beat !== undefined && (
            <button
              type="button"
              onClick={() => {
                const noteName = midiToNoteName(contextMenu.midi!);
                addMelodyNote({
                  note: noteName,
                  midi: contextMenu.midi!,
                  startBeat: contextMenu.beat!,
                  durationBeats: 1,
                  velocity: 80
                });
                toneEngine.playNotePreview(noteName);
                setContextMenu(null);
              }}
            >
              <Plus size={14} /> Insertar Nota ({midiToNoteName(contextMenu.midi)})
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setSelectedNoteIds(melodyNotes.map(n => n.id));
              setContextMenu(null);
            }}
          >
            Seleccionar todas las notas
          </button>

          <hr className="menu-separator" />

          <button
            type="button"
            className="menu-danger"
            onClick={() => {
              setConfirmModalConfig({isOpen: true, trackId: '', trackName: '', type: 'clear'});
              setContextMenu(null);
            }}
          >
            <Trash2 size={14} /> Limpiar Pista Melódica
          </button>
        </ContextMenuContainer>
      )}

      <ConfirmModal
        isOpen={confirmModalConfig.isOpen}
        title={confirmModalConfig.type === 'clear' ? 'Borrar Melodía' : 'Eliminar Pista'}
        message={confirmModalConfig.type === 'clear' 
          ? '¿Estás seguro que deseas borrar todas las notas de la melodía actual? Las notas se perderán.'
          : `¿Estás seguro que deseas eliminar la pista "${confirmModalConfig.trackName}"? Las notas que contiene se perderán.`}
        confirmText={confirmModalConfig.type === 'clear' ? 'Borrar todo' : 'Eliminar'}
        cancelText="Cancelar"
        onConfirm={() => {
          if (confirmModalConfig.type === 'clear') {
            useSongStore.setState({ melodyNotes: [] });
            setMelodyNotes([]);
          } else {
            const trackIndex = tracks.findIndex(t => t.id === confirmModalConfig.trackId);
            if (activeTrackId === confirmModalConfig.trackId) {
              const newActiveTrack = tracks[trackIndex - 1] || tracks[trackIndex + 1];
              if (newActiveTrack) setActiveTrackId(newActiveTrack.id);
            }
            removePianoRollTrack(confirmModalConfig.trackId);
          }
          setConfirmModalConfig({ isOpen: false, trackId: '', trackName: '', type: 'track' });
        }}
        onCancel={() => setConfirmModalConfig({ isOpen: false, trackId: '', trackName: '', type: 'track' })}
      />
    </div>
  );
};
