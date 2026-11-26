/**
 * PatternPickerSidebar.tsx
 * Panel lateral izquierdo de Patrones y Audio estilo FL Studio Picker Panel.
 * Permite seleccionar, arrastrar, crear, duplicar, renombrar y abrir para edición
 * tanto patrones de la Drum Machine como patrones de cada Melodía del Piano Roll.
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  AudioWaveform,
  Plus,
  Edit3,
  Copy,
  Trash2,
  Eraser,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Upload,
  Grid3X3,
  Music,
  Sparkles
} from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import type { SelectedPatternRef } from '../../utils/typeDefinitions';
import {
  ensureTrackPatterns,
  getBeatsPerMeasure,
  getDrumPatternColor,
  getDrumPatternName,
  getMelodyPatternLengthBeats
} from '../../core/audio/arrangementResolver';
import { PatternMiniPreview } from './PatternMiniPreview';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { importAudioFilesToTracks, isSupportedAudioFile } from '../../core/session/projectFileImport';

export const PATTERN_DRAG_MIME = 'application/x-phosphor-pattern';
export const AUDIO_CLIP_DRAG_MIME = 'application/x-phosphor-audio-source';

/** Icono compacto estilo teclado MIDI (inspirado en FL Studio Pattern Clip) */
export const MidiKeysMiniIcon: React.FC<{ color?: string; size?: number }> = ({
  color = 'currentColor',
  size = 12
}) => (
  <svg
    viewBox="0 0 16 14"
    width={size}
    height={Math.round((size * 14) / 16)}
    fill="none"
    style={{ flexShrink: 0 }}
    aria-hidden="true"
  >
    <rect x="0.75" y="0.75" width="14.5" height="12.5" rx="1.6" stroke={color} strokeWidth="1.3" fill="rgba(0,0,0,0.28)" />
    <rect x="3.5" y="1" width="2.2" height="7" fill={color} />
    <rect x="7.0" y="1" width="2.2" height="7" fill={color} />
    <rect x="10.5" y="1" width="2.2" height="7" fill={color} />
  </svg>
);

type PickerFilter = 'all' | 'drums' | 'melodies';

interface PickerContextMenuState {
  x: number;
  y: number;
  source: SelectedPatternRef;
}

export const PatternPickerSidebar: React.FC = () => {
  const {
    isPickerOpen,
    setIsPickerOpen,
    pickerTab,
    setPickerTab,
    selectedPatternRef,
    setSelectedPatternRef,
    drumChannels,
    patternLengths,
    drumPatternNames,
    drumArrangementMode,
    currentDrumPatternEdit,
    patternChain,
    tracks,
    channels,
    midiClips,
    audioClips,
    timeSignature,
    addDrumPattern,
    duplicateDrumPattern,
    renameDrumPattern,
    clearDrumPattern,
    removeDrumPattern,
    addPianoRollTrack,
    addMelodyPattern,
    duplicateMelodyPattern,
    renameMelodyPattern,
    setMelodyPatternLength,
    clearMelodyPattern,
    removeMelodyPattern,
    importDrumChainToMidiTrack,
    jumpToPatternEditor,
    setPlaylistTool
  } = useSongStore(
    useShallow((state) => ({
      isPickerOpen: state.isPickerOpen,
      setIsPickerOpen: state.setIsPickerOpen,
      pickerTab: state.pickerTab,
      setPickerTab: state.setPickerTab,
      selectedPatternRef: state.selectedPatternRef,
      setSelectedPatternRef: state.setSelectedPatternRef,
      drumChannels: state.drumChannels || [],
      patternLengths: state.patternLengths || [],
      drumPatternNames: state.drumPatternNames || [],
      drumArrangementMode: state.drumArrangementMode,
      currentDrumPatternEdit: state.currentDrumPatternEdit,
      patternChain: state.patternChain || [],
      tracks: state.tracks || [],
      channels: state.channels || {},
      midiClips: state.midiClips || [],
      audioClips: state.audioClips || [],
      timeSignature: state.timeSignature || '4/4',
      addDrumPattern: state.addDrumPattern,
      duplicateDrumPattern: state.duplicateDrumPattern,
      renameDrumPattern: state.renameDrumPattern,
      clearDrumPattern: state.clearDrumPattern,
      removeDrumPattern: state.removeDrumPattern,
      addPianoRollTrack: state.addPianoRollTrack,
      addMelodyPattern: state.addMelodyPattern,
      duplicateMelodyPattern: state.duplicateMelodyPattern,
      renameMelodyPattern: state.renameMelodyPattern,
      setMelodyPatternLength: state.setMelodyPatternLength,
      clearMelodyPattern: state.clearMelodyPattern,
      removeMelodyPattern: state.removeMelodyPattern,
      importDrumChainToMidiTrack: state.importDrumChainToMidiTrack,
      jumpToPatternEditor: state.jumpToPatternEditor,
      setPlaylistTool: state.setPlaylistTool
    }))
  );

  const [filter, setFilter] = useState<PickerFilter>('all');
  const [showAllEmptyDrums, setShowAllEmptyDrums] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<PickerContextMenuState | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const totalDrumPatterns = drumChannels[0]?.patterns?.length || 8;

  // Cerrar menú contextual al clicar fuera o pulsar Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.picker-context-menu')) {
        setCtxMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  // Calcular qué patrones de batería tienen pasos activos o clips colocados
  const drumPatternMeta = useMemo(() => {
    const usedInClips = new Map<number, number>();
    for (const c of midiClips) {
      if (c.sourceType === 'drums') {
        const idx = Math.max(0, c.drumPatternIndex ?? 0);
        usedInClips.set(idx, (usedInClips.get(idx) || 0) + 1);
      }
    }

    const list: Array<{
      index: number;
      name: string;
      color: string;
      steps: number;
      hasHits: boolean;
      clipCount: number;
    }> = [];

    for (let i = 0; i < totalDrumPatterns; i++) {
      const steps = patternLengths[i] || 16;
      let hasHits = false;
      for (let c = 0; c < drumChannels.length; c++) {
        const pat = drumChannels[c].patterns?.[i];
        if (pat && pat.some((st, idx) => idx < steps && st?.isActive)) {
          hasHits = true;
          break;
        }
      }
      list.push({
        index: i,
        name: getDrumPatternName(i, drumPatternNames),
        color: getDrumPatternColor(i),
        steps,
        hasHits,
        clipCount: usedInClips.get(i) || 0
      });
    }
    return list;
  }, [drumChannels, patternLengths, drumPatternNames, totalDrumPatterns, midiClips]);

  const visibleDrumPatterns = useMemo(() => {
    if (showAllEmptyDrums) return drumPatternMeta;
    const selectedDrumIdx = selectedPatternRef.sourceType === 'drums' ? selectedPatternRef.drumPatternIndex : -1;
    return drumPatternMeta.filter(
      (p) =>
        p.index === 0 ||
        p.hasHits ||
        p.clipCount > 0 ||
        p.index === currentDrumPatternEdit ||
        p.index === selectedDrumIdx
    );
  }, [drumPatternMeta, showAllEmptyDrums, currentDrumPatternEdit, selectedPatternRef]);

  const hiddenEmptyDrumCount = drumPatternMeta.length - visibleDrumPatterns.length;
  const totalDrumClipsInPlaylist = useMemo(
    () => midiClips.filter((c) => c.sourceType === 'drums').length,
    [midiClips]
  );

  // Biblioteca única de clips/fuentes de audio disponibles en el proyecto
  const uniqueAudioSources = useMemo(() => {
    const map = new Map<string, { bufferId: string; name: string; durationSeconds: number }>();
    for (const c of audioClips) {
      if (!map.has(c.bufferId)) {
        map.set(c.bufferId, {
          bufferId: c.bufferId,
          name: c.name,
          durationSeconds: c.durationSeconds
        });
      }
    }
    return Array.from(map.values());
  }, [audioClips]);

  const handleSelectPattern = (ref: SelectedPatternRef) => {
    setSelectedPatternRef(ref);
    setPlaylistTool('paint');
  };

  const handleAddDrumPatternQuick = () => {
    // Si hay un slot vacío oculto (P2..P8), seleccionarlo primero; si todos tienen contenido, crear uno nuevo
    const firstHiddenEmpty = drumPatternMeta.find(
      (p) => !visibleDrumPatterns.some((v) => v.index === p.index)
    );
    if (firstHiddenEmpty) {
      handleSelectPattern({ sourceType: 'drums', drumPatternIndex: firstHiddenEmpty.index });
    } else {
      const newIdx = addDrumPattern();
      handleSelectPattern({ sourceType: 'drums', drumPatternIndex: newIdx });
    }
  };

  const handleDragPatternStart = (e: React.DragEvent, ref: SelectedPatternRef) => {
    handleSelectPattern(ref);
    e.dataTransfer.setData(PATTERN_DRAG_MIME, JSON.stringify(ref));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleAudioImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(isSupportedAudioFile);
    if (files.length > 0) {
      await importAudioFilesToTracks(files);
    }
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  if (!isPickerOpen) {
    return (
      <div className="pattern-picker-collapsed-rail">
        <button
          type="button"
          className="pattern-picker-expand-btn"
          onClick={() => setIsPickerOpen(true)}
          title="Mostrar Selector de Patrones MIDI y Audio (Picker)"
        >
          <ChevronRight size={14} />
          <span className="pattern-picker-vertical-label">PATRONES</span>
        </button>
      </div>
    );
  }

  return (
    <aside className="pattern-picker-sidebar" aria-label="Selector de patrones MIDI y clips de audio">
      {/* Cabecera de pestañas estilo FL Studio (Patrones MIDI / Clips Audio) */}
      <div className="pattern-picker-tabs">
        <button
          type="button"
          className={`pattern-picker-tab ${pickerTab === 'patterns' ? 'active' : ''}`}
          onClick={() => setPickerTab('patterns')}
          title="Patrones MIDI (Drum Machine y Melodías)"
        >
          <MidiKeysMiniIcon size={14} />
          <span>PATRONES</span>
        </button>
        <button
          type="button"
          className={`pattern-picker-tab ${pickerTab === 'audio' ? 'active' : ''}`}
          onClick={() => setPickerTab('audio')}
          title="Clips de Audio cargados en el proyecto"
        >
          <AudioWaveform size={14} />
          <span>AUDIO</span>
        </button>
        <button
          type="button"
          className="pattern-picker-collapse-btn"
          onClick={() => setIsPickerOpen(false)}
          title="Contraer panel de patrones"
        >
          <ChevronLeft size={13} />
        </button>
      </div>

      {pickerTab === 'patterns' ? (
        <>
          {/* Filtros rápidos */}
          <div className="pattern-picker-filters">
            <button
              type="button"
              className={`picker-filter-pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              TODOS
            </button>
            <button
              type="button"
              className={`picker-filter-pill ${filter === 'drums' ? 'active' : ''}`}
              onClick={() => setFilter('drums')}
            >
              DRUMS
            </button>
            <button
              type="button"
              className={`picker-filter-pill ${filter === 'melodies' ? 'active' : ''}`}
              onClick={() => setFilter('melodies')}
            >
              MELODÍAS
            </button>
          </div>

          <div className="pattern-picker-hint">
            Clic selecciona pincel · Arrastra o haz clic en un MIDI Track para pintar
          </div>

          <div className="pattern-picker-scroll">
            {/* SECCIÓN 1: DRUM MACHINE */}
            {(filter === 'all' || filter === 'drums') && (
              <div className="picker-section">
                <div className="picker-section-header">
                  <div className="picker-section-title">
                    <Grid3X3 size={11} style={{ color: '#2dd4bf' }} />
                    <span>DRUM MACHINE</span>
                    {drumArrangementMode === 'playlist' && totalDrumClipsInPlaylist > 0 && (
                      <span className="picker-section-badge">{totalDrumClipsInPlaylist}</span>
                    )}
                  </div>
                  <div className="picker-section-actions">
                    {patternChain.length > 0 && totalDrumClipsInPlaylist === 0 && (
                      <button
                        type="button"
                        className="picker-mini-text-btn"
                        onClick={() => importDrumChainToMidiTrack()}
                        title="Importar la cadena actual del Drum Sequencer a un MIDI Track"
                      >
                        <Sparkles size={10} />
                        <span>Importar</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="picker-icon-btn"
                      onClick={handleAddDrumPatternQuick}
                      title="Añadir nuevo patrón de batería"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>

                <div className="picker-cards-list">
                  {visibleDrumPatterns.map((dp) => {
                    const isSelected =
                      selectedPatternRef.sourceType === 'drums' &&
                      selectedPatternRef.drumPatternIndex === dp.index;
                    const key = `drum_${dp.index}`;
                    const isRenaming = renamingKey === key;

                    return (
                      <div
                        key={key}
                        draggable={!isRenaming}
                        onDragStart={(e) =>
                          handleDragPatternStart(e, { sourceType: 'drums', drumPatternIndex: dp.index })
                        }
                        onClick={() =>
                          handleSelectPattern({ sourceType: 'drums', drumPatternIndex: dp.index })
                        }
                        onDoubleClick={() =>
                          jumpToPatternEditor({ sourceType: 'drums', drumPatternIndex: dp.index })
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtxMenu({
                            x: e.clientX,
                            y: e.clientY,
                            source: { sourceType: 'drums', drumPatternIndex: dp.index }
                          });
                        }}
                        className={`picker-pattern-card ${isSelected ? 'selected' : ''}`}
                        style={{ '--pattern-accent': dp.color } as React.CSSProperties}
                        title={`${dp.name} (${dp.steps} pasos) — Clic: pincel · Arrastrar: colocar · Doble clic: editar en Drum Sequencer`}
                      >
                        {isSelected && <span className="picker-selected-arrow" aria-hidden="true" />}
                        <div className="picker-card-top">
                          <Grid3X3 size={11} style={{ color: dp.color, flexShrink: 0 }} />
                          {isRenaming ? (
                            <input
                              type="text"
                              className="picker-rename-input"
                              value={renameDraft}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onBlur={() => {
                                renameDrumPattern(dp.index, renameDraft);
                                setRenamingKey(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  renameDrumPattern(dp.index, renameDraft);
                                  setRenamingKey(null);
                                } else if (e.key === 'Escape') {
                                  setRenamingKey(null);
                                }
                              }}
                            />
                          ) : (
                            <span className="picker-card-name">{dp.name}</span>
                          )}
                          <span className="picker-card-meta">1c</span>
                          <button
                            type="button"
                            className="picker-card-edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              jumpToPatternEditor({ sourceType: 'drums', drumPatternIndex: dp.index });
                            }}
                            title="Abrir en Drum Sequencer"
                          >
                            <ExternalLink size={10} />
                          </button>
                        </div>
                        <div className="picker-card-preview">
                          <PatternMiniPreview
                            kind="drums"
                            drumChannels={drumChannels}
                            patternIndex={dp.index}
                            patternSteps={dp.steps}
                            beatsPerMeasure={beatsPerMeasure}
                            durationBeats={beatsPerMeasure}
                            color={dp.color}
                            width={186}
                            height={18}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {hiddenEmptyDrumCount > 0 && (
                  <button
                    type="button"
                    className="picker-show-more-btn"
                    onClick={() => setShowAllEmptyDrums(true)}
                  >
                    + Mostrar {hiddenEmptyDrumCount} patrones vacíos más
                  </button>
                )}
                {showAllEmptyDrums && totalDrumPatterns > 1 && (
                  <button
                    type="button"
                    className="picker-show-more-btn"
                    onClick={() => setShowAllEmptyDrums(false)}
                  >
                    Ocultar patrones vacíos
                  </button>
                )}
              </div>
            )}

            {/* SECCIÓN 2: MELODÍAS (Cada pista del Piano Roll y sus patrones) */}
            {(filter === 'all' || filter === 'melodies') && (
              <div className="picker-section">
                <div className="picker-section-header">
                  <div className="picker-section-title">
                    <Music size={11} style={{ color: '#a78bfa' }} />
                    <span>MELODÍAS (PIANO ROLL)</span>
                  </div>
                  <button
                    type="button"
                    className="picker-mini-text-btn"
                    onClick={() => addPianoRollTrack()}
                    title="Crear una nueva pista de instrumento melódico"
                  >
                    <Plus size={10} />
                    <span>Melodía</span>
                  </button>
                </div>

                {tracks.map((track) => {
                  const { patterns } = ensureTrackPatterns(track);
                  const instType = channels[track.channelId]?.instrument === 'piano' ? 'PIANO' : 'SYNTH';
                  const trackClipCount = midiClips.filter(
                    (c) => c.sourceType === 'melody' && c.melodyTrackId === track.id
                  ).length;

                  return (
                    <div key={track.id} className="picker-melody-group">
                      <div className="picker-melody-group-header">
                        <span
                          className="picker-melody-dot"
                          style={{ backgroundColor: track.color || '#a78bfa' }}
                        />
                        <span className="picker-melody-name">{track.name}</span>
                        <span className="picker-melody-inst">{instType}</span>
                        {trackClipCount > 0 && (
                          <span className="picker-section-badge">{trackClipCount}</span>
                        )}
                        <button
                          type="button"
                          className="picker-icon-btn"
                          onClick={() => {
                            const newPatId = addMelodyPattern(track.id);
                            if (newPatId) {
                              handleSelectPattern({
                                sourceType: 'melody',
                                melodyTrackId: track.id,
                                melodyPatternId: newPatId
                              });
                            }
                          }}
                          title={`Crear nuevo patrón para ${track.name}`}
                        >
                          <Plus size={11} />
                        </button>
                      </div>

                      <div className="picker-cards-list">
                        {patterns.map((pat) => {
                          const isSelected =
                            selectedPatternRef.sourceType === 'melody' &&
                            selectedPatternRef.melodyTrackId === track.id &&
                            selectedPatternRef.melodyPatternId === pat.id;
                          const patLenBeats = getMelodyPatternLengthBeats(pat, beatsPerMeasure);
                          const barsLabel = `${Math.round((patLenBeats / beatsPerMeasure) * 10) / 10}c`;
                          const key = `mel_${track.id}_${pat.id}`;
                          const isRenaming = renamingKey === key;

                          return (
                            <div
                              key={key}
                              draggable={!isRenaming}
                              onDragStart={(e) =>
                                handleDragPatternStart(e, {
                                  sourceType: 'melody',
                                  melodyTrackId: track.id,
                                  melodyPatternId: pat.id
                                })
                              }
                              onClick={() =>
                                handleSelectPattern({
                                  sourceType: 'melody',
                                  melodyTrackId: track.id,
                                  melodyPatternId: pat.id
                                })
                              }
                              onDoubleClick={() =>
                                jumpToPatternEditor({
                                  sourceType: 'melody',
                                  melodyTrackId: track.id,
                                  melodyPatternId: pat.id
                                })
                              }
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  source: {
                                    sourceType: 'melody',
                                    melodyTrackId: track.id,
                                    melodyPatternId: pat.id
                                  }
                                });
                              }}
                              className={`picker-pattern-card ${isSelected ? 'selected' : ''}`}
                              style={{ '--pattern-accent': track.color || '#a78bfa' } as React.CSSProperties}
                              title={`${track.name} · ${pat.name} (${barsLabel}) — Clic: pincel · Arrastrar: colocar · Doble clic: editar en Piano Roll`}
                            >
                              {isSelected && <span className="picker-selected-arrow" aria-hidden="true" />}
                              <div className="picker-card-top">
                                <MidiKeysMiniIcon color={track.color || '#a78bfa'} size={12} />
                                {isRenaming ? (
                                  <input
                                    type="text"
                                    className="picker-rename-input"
                                    value={renameDraft}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setRenameDraft(e.target.value)}
                                    onBlur={() => {
                                      renameMelodyPattern(track.id, pat.id, renameDraft);
                                      setRenamingKey(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        renameMelodyPattern(track.id, pat.id, renameDraft);
                                        setRenamingKey(null);
                                      } else if (e.key === 'Escape') {
                                        setRenamingKey(null);
                                      }
                                    }}
                                  />
                                ) : (
                                  <span className="picker-card-name">{pat.name}</span>
                                )}
                                <span className="picker-card-meta">{barsLabel}</span>
                                <button
                                  type="button"
                                  className="picker-card-edit-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    jumpToPatternEditor({
                                      sourceType: 'melody',
                                      melodyTrackId: track.id,
                                      melodyPatternId: pat.id
                                    });
                                  }}
                                  title="Abrir en Piano Roll"
                                >
                                  <ExternalLink size={10} />
                                </button>
                              </div>
                              <div className="picker-card-preview">
                                <PatternMiniPreview
                                  kind="melody"
                                  notes={pat.notes || []}
                                  patternLengthBeats={patLenBeats}
                                  durationBeats={patLenBeats}
                                  color={track.color || '#a78bfa'}
                                  width={186}
                                  height={18}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        /* PESTAÑA DE AUDIO */
        <div className="pattern-picker-scroll">
          <div className="picker-section">
            <div className="picker-section-header">
              <div className="picker-section-title">
                <AudioWaveform size={11} style={{ color: '#e5a93c' }} />
                <span>CLIPS DE AUDIO</span>
              </div>
              <button
                type="button"
                className="picker-mini-text-btn"
                onClick={() => audioInputRef.current?.click()}
              >
                <Upload size={10} />
                <span>Importar</span>
              </button>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
                multiple
                style={{ display: 'none' }}
                onChange={handleAudioImport}
              />
            </div>

            {uniqueAudioSources.length === 0 ? (
              <div className="picker-empty-audio">
                Sin archivos de audio todavía. Arrastra un WAV/MP3 o graba con <strong>R</strong>.
              </div>
            ) : (
              <div className="picker-cards-list">
                {uniqueAudioSources.map((src) => (
                  <div
                    key={src.bufferId}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(AUDIO_CLIP_DRAG_MIME, JSON.stringify(src));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    className="picker-pattern-card"
                    style={{ '--pattern-accent': '#e5a93c' } as React.CSSProperties}
                    title={`${src.name} (${src.durationSeconds.toFixed(1)}s) — Arrastra sobre un Audio Track`}
                  >
                    <div className="picker-card-top">
                      <AudioWaveform size={11} style={{ color: '#e5a93c', flexShrink: 0 }} />
                      <span className="picker-card-name">{src.name}</span>
                      <span className="picker-card-meta">{src.durationSeconds.toFixed(1)}s</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Menú contextual de Patrón en el Picker */}
      {ctxMenu && (
        <ContextMenuContainer
          x={ctxMenu.x}
          y={ctxMenu.y}
          className="picker-context-menu custom-context-menu"
        >
          {ctxMenu.source.sourceType === 'drums' ? (
            (() => {
              const pIdx = ctxMenu.source.drumPatternIndex;
              const pName = getDrumPatternName(pIdx, drumPatternNames);
              return (
                <>
                  <div className="menu-header">
                    <span>{pName}</span>
                  </div>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      jumpToPatternEditor({ sourceType: 'drums', drumPatternIndex: pIdx });
                      setCtxMenu(null);
                    }}
                  >
                    <ExternalLink size={12} /> Editar en Drum Sequencer
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      setRenamingKey(`drum_${pIdx}`);
                      setRenameDraft(pName);
                      setCtxMenu(null);
                    }}
                  >
                    <Edit3 size={12} /> Renombrar patrón
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      const newIdx = duplicateDrumPattern(pIdx);
                      handleSelectPattern({ sourceType: 'drums', drumPatternIndex: newIdx });
                      setCtxMenu(null);
                    }}
                  >
                    <Copy size={12} /> Duplicar patrón
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      clearDrumPattern(pIdx);
                      setCtxMenu(null);
                    }}
                  >
                    <Eraser size={12} /> Limpiar pasos
                  </button>
                  {totalDrumPatterns > 1 && (
                    <>
                      <hr className="menu-separator" />
                      <button
                        type="button"
                        className="menu-danger"
                        onClick={() => {
                          removeDrumPattern(pIdx);
                          setCtxMenu(null);
                        }}
                      >
                        <Trash2 size={12} /> Eliminar patrón
                      </button>
                    </>
                  )}
                </>
              );
            })()
          ) : (
            (() => {
              const { melodyTrackId, melodyPatternId } = ctxMenu.source;
              const track = tracks.find((t) => t.id === melodyTrackId);
              if (!track) return null;
              const { patterns } = ensureTrackPatterns(track);
              const pat = patterns.find((p) => p.id === melodyPatternId);
              if (!pat) return null;
              return (
                <>
                  <div className="menu-header">
                    <span>{track.name} · {pat.name}</span>
                  </div>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      jumpToPatternEditor({
                        sourceType: 'melody',
                        melodyTrackId,
                        melodyPatternId
                      });
                      setCtxMenu(null);
                    }}
                  >
                    <ExternalLink size={12} /> Editar en Piano Roll
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      setRenamingKey(`mel_${melodyTrackId}_${melodyPatternId}`);
                      setRenameDraft(pat.name);
                      setCtxMenu(null);
                    }}
                  >
                    <Edit3 size={12} /> Renombrar patrón
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      const newId = duplicateMelodyPattern(melodyTrackId, melodyPatternId);
                      if (newId) {
                        handleSelectPattern({
                          sourceType: 'melody',
                          melodyTrackId,
                          melodyPatternId: newId
                        });
                      }
                      setCtxMenu(null);
                    }}
                  >
                    <Copy size={12} /> Duplicar patrón
                  </button>

                  <hr className="menu-separator" />
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 700, padding: '2px 8px' }}>
                    DURACIÓN
                  </div>
                  <div style={{ display: 'flex', gap: '3px', padding: '4px 6px' }}>
                    <button
                      type="button"
                      className={`physical-segment-btn ${!pat.lengthBeats ? 'active' : ''}`}
                      style={{ fontSize: '0.65rem', padding: '2px 5px', height: '21px' }}
                      onClick={() => {
                        setMelodyPatternLength(melodyTrackId, melodyPatternId, undefined);
                        setCtxMenu(null);
                      }}
                    >
                      Auto
                    </button>
                    {[1, 2, 4, 8].map((bars) => {
                      const beats = bars * beatsPerMeasure;
                      return (
                        <button
                          key={bars}
                          type="button"
                          className={`physical-segment-btn ${pat.lengthBeats === beats ? 'active' : ''}`}
                          style={{ fontSize: '0.65rem', padding: '2px 5px', height: '21px' }}
                          onClick={() => {
                            setMelodyPatternLength(melodyTrackId, melodyPatternId, beats);
                            setCtxMenu(null);
                          }}
                        >
                          {bars}c
                        </button>
                      );
                    })}
                  </div>

                  <hr className="menu-separator" />
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      clearMelodyPattern(melodyTrackId, melodyPatternId);
                      setCtxMenu(null);
                    }}
                  >
                    <Eraser size={12} /> Limpiar notas
                  </button>
                  {patterns.length > 1 && (
                    <button
                      type="button"
                      className="menu-danger"
                      onClick={() => {
                        removeMelodyPattern(melodyTrackId, melodyPatternId);
                        setCtxMenu(null);
                      }}
                    >
                      <Trash2 size={12} /> Eliminar patrón
                    </button>
                  )}
                </>
              );
            })()
          )}
        </ContextMenuContainer>
      )}
    </aside>
  );
};
