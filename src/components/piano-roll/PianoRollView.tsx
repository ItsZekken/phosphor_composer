import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { toneEngine } from '../../audio/toneEngine';
import { NOTE_CLASSES, generateMelody, noteToMod12, SCALE_INTERVALS } from '../../core/music';
import { LivePitchTracker } from '../../core/audio';
import type { MelodyNote, NoteClass, ScaleType } from '../../utils/typeDefinitions';
import { Mic, Trash2, Copy, Scissors, Search, ChevronRight, Lightbulb, RefreshCw, Wand2, Layers } from 'lucide-react';
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
import { usePianoRollShortcuts } from './hooks/usePianoRollShortcuts';
import { usePianoRollInteractions } from './hooks/usePianoRollInteractions';

const MIN_MIDI = 24; // C1
const MAX_MIDI = 96; // C7
const NOTE_COUNT = MAX_MIDI - MIN_MIDI + 1;
const GRID_SNAP = 0.25; // Semicorcheas

function midiToNoteName(midi: number): string {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_CLASSES[noteIndex]}${octave}`;
}

export const PianoRollView: React.FC = () => {
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
    melodyNotes: state.melodyNotes || [],
    addMelodyNote: state.addMelodyNote,
    removeMelodyNote: state.removeMelodyNote,
    updateMelodyNote: state.updateMelodyNote,
    setMelodyNotes: state.setMelodyNotes,
    setCurrentBeat: state.setCurrentBeat,
    ghostNotes: state.ghostNotes || [],
    setGhostNotes: state.setGhostNotes,
    isPlaying: state.isPlaying,
    bpm: state.bpm || 120,
    key: state.key || 'C',
    scale: state.scale || 'major',
    setKey: state.setKey,
    setScale: state.setScale,
    chordBlocks: state.chordBlocks || [],
    isAutoSuggestions: state.isAutoSuggestions,
    tracks: state.tracks || [],
    activeTrackId: state.activeTrackId,
    addPianoRollTrack: state.addPianoRollTrack,
    removePianoRollTrack: state.removePianoRollTrack,
    renamePianoRollTrack: state.renamePianoRollTrack,
    setActiveTrackId: state.setActiveTrackId,
    updateTrackViewport: state.updateTrackViewport,
    clipboardNotes: state.clipboardNotes || [],
    setClipboardNotes: state.setClipboardNotes
  })));

  const containerRef = useRef<HTMLDivElement>(null);
  const pianoRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentTrack = (tracks && tracks.length > 0) ? (tracks.find(t => t.id === activeTrackId) || tracks[0]) : null;
  const currentChannelId = currentTrack?.channelId || 'melody';

  // Estados de control
  const [selectedNoteLength, setSelectedNoteLength] = useState<number>(1);
  const [isRecording, setIsRecording] = useState(false);
  const [snapToScale, setSnapToScale] = useState(true);
  const [isScaleHighlightActive, setIsScaleHighlightActive] = useState(true);
  const [livePitch, setLivePitch] = useState<{ midi: number; note: string; clarity: number } | null>(null);
  const [, setIsGeneratingGhost] = useState(false);

  // UX de Selección
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [isScaleFinderOpen, setIsScaleFinderOpen] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{ isOpen: boolean; trackId: string; trackName: string; type: 'track' | 'clear' }>({ isOpen: false, trackId: '', trackName: '', type: 'track' });

  // Referencias para la grabación de audio con LivePitchTracker
  const livePitchTrackerRef = useRef<LivePitchTracker | null>(null);

  // Zoom y dimensiones
  const { rowHeight, beatWidth, setRowHeight, setBeatWidth, TOTAL_BEATS } = useGridZoom();

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

  // Hook de atajos de teclado DAW profesionales
  usePianoRollShortcuts({
    selectedNoteIds,
    setSelectedNoteIds,
    melodyNotes,
    removeMelodyNote,
    updateMelodyNote,
    setMelodyNotes,
    clipboardNotes,
    setClipboardNotes,
    currentChannelId
  });

  // Hook de interacción con ratón y lienzo
  const {
    lassoRect,
    tempNote,
    contextMenu,
    setContextMenu,
    handleMouseDown,
    handleMouseMoveIdle
  } = usePianoRollInteractions({
    canvasRef,
    containerRef,
    pianoRef,
    melodyNotes,
    addMelodyNote,
    removeMelodyNote,
    updateMelodyNote,
    selectedNoteIds,
    setSelectedNoteIds,
    selectedNoteLength,
    beatWidth,
    rowHeight,
    currentChannelId
  });

  // Generador Melódico Algorítmico Inteligente
  const fetchGhostNotes = useCallback(async () => {
    setIsGeneratingGhost(true);
    try {
      const suggestions = generateMelody({
        key: key || 'C',
        scale: scale || 'major',
        chordBlocks: chordBlocks || [],
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

  useEffect(() => {
    if (!isAutoSuggestions) return;
    let active = true;
    const timer = setTimeout(() => {
      if (!active) return;
      setIsGeneratingGhost(true);
      try {
        const suggestions = generateMelody({
          key: key || 'C',
          scale: scale || 'major',
          chordBlocks: chordBlocks || [],
          totalBeats: TOTAL_BEATS,
          style: 'catchy'
        });
        if (active) setGhostNotes(suggestions);
      } catch (err) {
        console.error('Error generando sugerencias automáticas:', err);
      } finally {
        if (active) setIsGeneratingGhost(false);
      }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [chordBlocks, TOTAL_BEATS, key, scale, setGhostNotes, isAutoSuggestions]);

  // Zoom interactivo centrado: Alt+Wheel (horizontal), Ctrl+Wheel (vertical)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
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
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [setBeatWidth, setRowHeight, beatWidth, rowHeight]);

  useEffect(() => {
    if (containerRef.current && pianoRef.current) {
      pianoRef.current.scrollTop = containerRef.current.scrollTop;
    }
  }, [rowHeight]);

  // Convertir las notas fantasma en notas reales
  const acceptGhostNotes = () => {
    if ((ghostNotes || []).length === 0) return;
    (ghostNotes || []).forEach(gn => {
      const duplicate = (melodyNotes || []).some(
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

      const currentTransportSec = ((useSongStore.getState().currentBeat ?? 0) * 60) / (bpm || 120);
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

    const consolidatedNotes: { midi: number; startBeat: number; durationBeats: number }[] = [];
    let currentSegment: { midi: number; startBeat: number; endBeat: number } | null = null;

    rawSamples.forEach((sample) => {
      const beat = (sample.time * (bpm || 120)) / 60;
      const snappedBeat = Math.round(beat / GRID_SNAP) * GRID_SNAP;

      let effectiveMidi = sample.midi;
      if (snapToScale) {
        let bestMidi = sample.midi;
        let minDiff = Infinity;
        for (let offset = -6; offset <= 6; offset++) {
          const testMidi = sample.midi + offset;
          const pitchClass = ((testMidi % 12) + 12) % 12;
          if (scalePitchClasses?.has(pitchClass)) {
            const diff = Math.abs(offset);
            if (diff < minDiff) {
              minDiff = diff;
              bestMidi = testMidi;
            }
          }
        }
        effectiveMidi = bestMidi;
      }

      if (!currentSegment) {
        currentSegment = { midi: effectiveMidi, startBeat: snappedBeat, endBeat: snappedBeat + GRID_SNAP };
      } else if (currentSegment.midi === effectiveMidi && snappedBeat <= currentSegment.endBeat + GRID_SNAP) {
        currentSegment.endBeat = Math.max(currentSegment.endBeat, snappedBeat + GRID_SNAP);
      } else {
        const duration = Math.max(GRID_SNAP, currentSegment.endBeat - currentSegment.startBeat);
        consolidatedNotes.push({ midi: currentSegment.midi, startBeat: currentSegment.startBeat, durationBeats: duration });
        currentSegment = { midi: effectiveMidi, startBeat: snappedBeat, endBeat: snappedBeat + GRID_SNAP };
      }
    });

    if (currentSegment) {
      const seg = currentSegment as { midi: number; startBeat: number; endBeat: number };
      const duration = Math.max(GRID_SNAP, seg.endBeat - seg.startBeat);
      consolidatedNotes.push({ midi: seg.midi, startBeat: seg.startBeat, durationBeats: duration });
    }

    consolidatedNotes.forEach((n) => {
      addMelodyNote({
        note: midiToNoteName(n.midi),
        midi: n.midi,
        startBeat: n.startBeat,
        durationBeats: n.durationBeats,
        velocity: 0.8
      });
    });
  };

  const handleClearMelody = () => {
    if ((melodyNotes || []).length === 0) return;
    setConfirmModalConfig({
      isOpen: true,
      trackId: activeTrackId,
      trackName: currentTrack ? currentTrack.name : 'Melodía',
      type: 'clear'
    });
  };

  return (
    <div className="piano-roll-container">
      {/* Barra de herramientas unificada */}
      <UnifiedToolbar
        left={
          <>
            <ChannelQuickControl channelId={currentChannelId} />
            {(() => {
              const activeTrack = (tracks || []).find(t => t.id === activeTrackId);
              const activeChannelId = activeTrack ? activeTrack.channelId : 'melody';
              return <ChannelInstrumentControl channelId={activeChannelId} />;
            })()}

            {/* Toggle de Resaltado de Escala (Scale Highlighting) */}
            <button
              type="button"
              className={`physical-btn ${isScaleHighlightActive ? 'active' : ''}`}
              onClick={() => setIsScaleHighlightActive(!isScaleHighlightActive)}
              title="Iluminar notas de la escala en cuadrícula y teclado"
            >
              <Lightbulb size={13} style={{ color: isScaleHighlightActive ? '#ffd875' : 'var(--text-secondary)' }} />
              <span className={`physical-led-dot ${isScaleHighlightActive ? 'lit-amber' : ''}`} />
            </button>
          </>
        }
        center={
          /* Segmento de Duración de Nota por Defecto */
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
        }
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {/* Botón Grabar Tarareo (Mic) */}
            <button 
              type="button"
              className={`physical-btn ${isRecording ? 'active' : ''}`}
              onClick={isRecording ? stopRecording : startRecording}
              title={isRecording ? "Detener y procesar tarareo" : "Grabar tarareo silbando/cantando"}
            >
              <Mic size={13} />
              <span className={`physical-led-dot ${isRecording ? 'lit-red' : ''}`} />
            </button>

            {/* Selector de Modo de Afinación: Escala vs Cromático */}
            <button
              type="button"
              className={`physical-btn ${snapToScale ? 'active' : ''}`}
              onClick={() => setSnapToScale(!snapToScale)}
              title={snapToScale ? "Modo Mic: Acoplado a Escala" : "Modo Mic: Cromático Libre"}
            >
              <span>{snapToScale ? 'ESCALA' : 'CROM'}</span>
              <span className={`physical-led-dot ${snapToScale ? 'lit-amber' : 'lit-magenta'}`} />
            </button>

            {/* Botón actualizar sugerencias melódicas (modo manual) */}
            {!isAutoSuggestions && (
              <button
                type="button"
                className="physical-btn"
                onClick={fetchGhostNotes}
                title="Generar sugerencias melódicas algorítmicas"
              >
                <RefreshCw size={13} />
              </button>
            )}

            {/* Botón Aceptar Sugerencias */}
            {(ghostNotes || []).length > 0 && (
              <button 
                type="button"
                className="physical-btn active" 
                onClick={acceptGhostNotes} 
                title={`Aceptar sugerencias melódicas (${ghostNotes.length} notas)`}
              >
                <Wand2 size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: '0.68rem', fontWeight: 'bold', color: '#ffd875' }}>{ghostNotes.length}</span>
              </button>
            )}
            
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

      {/* Franja Independiente de Pistas de Melodía */}
      <PianoRollTrackHeader
        tracks={tracks}
        activeTrackId={activeTrackId}
        setActiveTrackId={setActiveTrackId}
        addPianoRollTrack={addPianoRollTrack}
        removePianoRollTrack={removePianoRollTrack}
        renamePianoRollTrack={renamePianoRollTrack}
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
                backgroundColor: '#121614', 
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

            {/* Espaciador de alineación para compensar la barra de scroll horizontal */}
            <div style={{ height: '24px', flexShrink: 0 }} />
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
            scalePitchClasses={scalePitchClasses}
            rootMidiMod={rootMidiMod}
            isScaleHighlightActive={isScaleHighlightActive}
            handleMouseDown={handleMouseDown}
            handleMouseMoveIdle={handleMouseMoveIdle}
          />

          {/* Espaciador inferior del canvas para evitar solapamiento con el scrollbar */}
          <div style={{ height: '24px', width: `${canvasWidth}px`, flexShrink: 0 }} />
        </div>
      </div>

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
                    selectedNoteIds.forEach(id => removeMelodyNote(id));
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
                    const minStart = Math.min(...selected.map(n => n.startBeat));
                    const maxEnd = Math.max(...selected.map(n => n.startBeat + n.durationBeats));
                    const span = Math.max(GRID_SNAP, maxEnd - minStart);
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
                className="menu-danger"
                onClick={() => {
                  selectedNoteIds.forEach(id => removeMelodyNote(id));
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
