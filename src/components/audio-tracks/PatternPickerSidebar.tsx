/**
 * PatternPickerSidebar.tsx
 * Panel lateral de bloques Phosphor para la vista Tracks:
 * - Acordes diatónicos de la tonalidad activa (para pintar/arrastrar al track de Armonía 1:1)
 * - Patrones de Drum Machine P1..PN (para pintar/arrastrar al track de Batería 1:1)
 * - Acceso rápido a pistas de Piano Roll
 * - Biblioteca de clips de Audio importados/grabados
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
  LayoutGrid
} from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { getDiatonicChords, getChordRomanDegree } from '../../core/music';
import { getChordRole } from '../chord-player/chordRoleUtils';
import {
  getBeatsPerMeasure,
  getDrumPatternColor,
  getDrumPatternName
} from '../../core/audio/arrangementResolver';
import { normalizePatternChainToLinear } from '../../utils/typeDefinitions';
import { toneEngine } from '../../audio/toneEngine';
import { PatternMiniPreview } from './PatternMiniPreview';
import { CHORD_DRAG_MIME } from './HarmonyTrackLane';
import { DRUM_PATTERN_DRAG_MIME } from './DrumTrackLane';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { importAudioFilesToTracks, isSupportedAudioFile } from '../../core/session/projectFileImport';

export const AUDIO_CLIP_DRAG_MIME = 'application/x-phosphor-audio-source';

/** Icono compacto estilo teclado MIDI */
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

type PickerFilter = 'all' | 'chords' | 'drums';

interface DrumCtxMenuState {
  x: number;
  y: number;
  patternIndex: number;
}

export const PatternPickerSidebar: React.FC = () => {
  const {
    isPickerOpen,
    setIsPickerOpen,
    pickerTab,
    setPickerTab,
    key,
    scale,
    chordOctaveShift,
    selectedHarmonyBrushChord,
    setSelectedHarmonyBrushChord,
    drumChannels,
    patternLengths,
    drumPatternNames,
    currentDrumPatternEdit,
    setCurrentDrumPatternEdit,
    patternChain,
    tracks,
    channels,
    audioClips,
    timeSignature,
    addDrumPattern,
    duplicateDrumPattern,
    renameDrumPattern,
    clearDrumPattern,
    removeDrumPattern,
    addPianoRollTrack,
    jumpToHarmonyEditor,
    jumpToMelodyEditor,
    jumpToDrumEditor,
    setPlaylistTool
  } = useSongStore(
    useShallow((state) => ({
      isPickerOpen: state.isPickerOpen,
      setIsPickerOpen: state.setIsPickerOpen,
      pickerTab: state.pickerTab,
      setPickerTab: state.setPickerTab,
      key: state.key || 'C',
      scale: state.scale || 'major',
      chordOctaveShift: state.chordOctaveShift || 0,
      selectedHarmonyBrushChord: state.selectedHarmonyBrushChord || 'C',
      setSelectedHarmonyBrushChord: state.setSelectedHarmonyBrushChord,
      drumChannels: state.drumChannels || [],
      patternLengths: state.patternLengths || [],
      drumPatternNames: state.drumPatternNames || [],
      currentDrumPatternEdit: state.currentDrumPatternEdit || 0,
      setCurrentDrumPatternEdit: state.setCurrentDrumPatternEdit,
      patternChain: state.patternChain || [],
      tracks: state.tracks || [],
      channels: state.channels || {},
      audioClips: state.audioClips || [],
      timeSignature: state.timeSignature || '4/4',
      addDrumPattern: state.addDrumPattern,
      duplicateDrumPattern: state.duplicateDrumPattern,
      renameDrumPattern: state.renameDrumPattern,
      clearDrumPattern: state.clearDrumPattern,
      removeDrumPattern: state.removeDrumPattern,
      addPianoRollTrack: state.addPianoRollTrack,
      jumpToHarmonyEditor: state.jumpToHarmonyEditor,
      jumpToMelodyEditor: state.jumpToMelodyEditor,
      jumpToDrumEditor: state.jumpToDrumEditor,
      setPlaylistTool: state.setPlaylistTool
    }))
  );

  const [filter, setFilter] = useState<PickerFilter>('all');
  const [showAllEmptyDrums, setShowAllEmptyDrums] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<DrumCtxMenuState | null>(null);
  const [renamingDrumIdx, setRenamingDrumIdx] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const totalDrumPatterns = drumChannels[0]?.patterns?.length || 8;
  const diatonicChords = useMemo(() => getDiatonicChords(key, scale), [key, scale]);

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

  // Calcular metadatos de patrones de batería en la cadena lineal
  const drumPatternMeta = useMemo(() => {
    const linear = normalizePatternChainToLinear(patternChain);
    const usedInClips = new Map<number, number>();
    for (const c of linear) {
      usedInClips.set(c.patternIndex, (usedInClips.get(c.patternIndex) || 0) + 1);
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
  }, [drumChannels, patternLengths, drumPatternNames, totalDrumPatterns, patternChain]);

  const visibleDrumPatterns = useMemo(() => {
    if (showAllEmptyDrums) return drumPatternMeta;
    return drumPatternMeta.filter(
      (p) =>
        p.index === 0 ||
        p.hasHits ||
        p.clipCount > 0 ||
        p.index === currentDrumPatternEdit
    );
  }, [drumPatternMeta, showAllEmptyDrums, currentDrumPatternEdit]);

  const hiddenEmptyDrumCount = drumPatternMeta.length - visibleDrumPatterns.length;

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

  const handleSelectChordBrush = (chord: string) => {
    setSelectedHarmonyBrushChord(chord);
    setPlaylistTool('paint');
    toneEngine.playChordPreview(chord, chordOctaveShift);
  };

  const handleSelectDrumPattern = (idx: number) => {
    setCurrentDrumPatternEdit(idx);
    setPlaylistTool('paint');
  };

  const handleAddDrumPatternQuick = () => {
    const firstHiddenEmpty = drumPatternMeta.find(
      (p) => !visibleDrumPatterns.some((v) => v.index === p.index)
    );
    if (firstHiddenEmpty) {
      handleSelectDrumPattern(firstHiddenEmpty.index);
    } else {
      const newIdx = addDrumPattern();
      handleSelectDrumPattern(newIdx);
    }
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
          title="Mostrar Paleta de Acordes, Batería y Audio"
        >
          <ChevronRight size={14} />
          <span className="pattern-picker-vertical-label">PALETA</span>
        </button>
      </div>
    );
  }

  return (
    <aside className="pattern-picker-sidebar" aria-label="Paleta de Acordes, Patrones de Batería y Clips de Audio">
      {/* Pestañas superiores */}
      <div className="pattern-picker-tabs">
        <button
          type="button"
          className={`pattern-picker-tab ${pickerTab === 'palette' ? 'active' : ''}`}
          onClick={() => setPickerTab('palette')}
          title="Acordes de la escala, Patrones de Batería y Pistas de Piano Roll"
        >
          <LayoutGrid size={13} />
          <span>PALETA</span>
        </button>
        <button
          type="button"
          className={`pattern-picker-tab ${pickerTab === 'audio' ? 'active' : ''}`}
          onClick={() => setPickerTab('audio')}
          title="Clips de Audio cargados en el proyecto"
        >
          <AudioWaveform size={13} />
          <span>AUDIO</span>
        </button>
        <button
          type="button"
          className="pattern-picker-collapse-btn"
          onClick={() => setIsPickerOpen(false)}
          title="Contraer panel lateral"
        >
          <ChevronLeft size={13} />
        </button>
      </div>

      {pickerTab === 'palette' ? (
        <>
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
              className={`picker-filter-pill ${filter === 'chords' ? 'active' : ''}`}
              onClick={() => setFilter('chords')}
            >
              ACORDES
            </button>
            <button
              type="button"
              className={`picker-filter-pill ${filter === 'drums' ? 'active' : ''}`}
              onClick={() => setFilter('drums')}
            >
              DRUMS
            </button>
          </div>

          <div className="pattern-picker-hint">
            Clic selecciona pincel · Arrastra o pinta directamente en su pista 1:1
          </div>

          <div className="pattern-picker-scroll">
            {/* SECCIÓN 1: ACORDES DIATÓNICOS (1:1 con Chord Palette) */}
            {(filter === 'all' || filter === 'chords') && (
              <div className="picker-section">
                <div className="picker-section-header">
                  <div className="picker-section-title">
                    <LayoutGrid size={11} style={{ color: '#60a5fa' }} />
                    <span>ACORDES ({key} {scale})</span>
                  </div>
                  <button
                    type="button"
                    className="picker-icon-btn"
                    onClick={() => jumpToHarmonyEditor()}
                    title="Abrir Chord Palette completa (Alt+1)"
                  >
                    <ExternalLink size={11} />
                  </button>
                </div>

                <div className="picker-chord-grid">
                  {diatonicChords.map((chord) => {
                    const isSelected = selectedHarmonyBrushChord === chord;
                    const degree = getChordRomanDegree(chord, key, scale);
                    const role = getChordRole(chord, key, scale);
                    return (
                      <div
                        key={chord}
                        draggable
                        onDragStart={(e) => {
                          setSelectedHarmonyBrushChord(chord);
                          setPlaylistTool('paint');
                          e.dataTransfer.setData(CHORD_DRAG_MIME, chord);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => handleSelectChordBrush(chord)}
                        className={`picker-chord-chip ${isSelected ? 'selected' : ''}`}
                        style={{ '--role-accent': `var(--role-${role})` } as React.CSSProperties}
                        title={`${chord} (${degree}) — Clic: pincel y audición · Arrastrar: colocar en pista de Armonía`}
                      >
                        <span className="picker-chord-name">{chord}</span>
                        <span className="picker-chord-deg">{degree}</span>
                        <span className="picker-chord-bar" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SECCIÓN 2: DRUM MACHINE (1:1 con Drum Sequencer) */}
            {(filter === 'all' || filter === 'drums') && (
              <div className="picker-section">
                <div className="picker-section-header">
                  <div className="picker-section-title">
                    <Grid3X3 size={11} style={{ color: '#2dd4bf' }} />
                    <span>DRUM MACHINE</span>
                  </div>
                  <div className="picker-section-actions">
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
                    const isSelected = currentDrumPatternEdit === dp.index;
                    const isRenaming = renamingDrumIdx === dp.index;

                    return (
                      <div
                        key={`drum_${dp.index}`}
                        draggable={!isRenaming}
                        onDragStart={(e) => {
                          handleSelectDrumPattern(dp.index);
                          e.dataTransfer.setData(DRUM_PATTERN_DRAG_MIME, String(dp.index));
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => handleSelectDrumPattern(dp.index)}
                        onDoubleClick={() => jumpToDrumEditor(dp.index)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtxMenu({
                            x: e.clientX,
                            y: e.clientY,
                            patternIndex: dp.index
                          });
                        }}
                        className={`picker-pattern-card ${isSelected ? 'selected' : ''}`}
                        style={{ '--pattern-accent': dp.color } as React.CSSProperties}
                        title={`${dp.name} (${dp.steps} pasos) — Clic: pincel · Arrastrar: colocar en pista de Batería · Doble clic: editar en Drum Sequencer`}
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
                                setRenamingDrumIdx(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  renameDrumPattern(dp.index, renameDraft);
                                  setRenamingDrumIdx(null);
                                } else if (e.key === 'Escape') {
                                  setRenamingDrumIdx(null);
                                }
                              }}
                            />
                          ) : (
                            <span className="picker-card-name">{dp.name}</span>
                          )}
                          <span className="picker-card-meta">
                            {dp.clipCount > 0 ? `×${dp.clipCount}` : '1c'}
                          </span>
                          <button
                            type="button"
                            className="picker-card-edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              jumpToDrumEditor(dp.index);
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

            {/* SECCIÓN 3: ACCESO RÁPIDO A CANALES DE PIANO ROLL */}
            {filter === 'all' && (
              <div className="picker-section">
                <div className="picker-section-header">
                  <div className="picker-section-title">
                    <Music size={11} style={{ color: '#a78bfa' }} />
                    <span>PIANO ROLL</span>
                  </div>
                  <button
                    type="button"
                    className="picker-mini-text-btn"
                    onClick={() => addPianoRollTrack()}
                    title="Crear una nueva pista de instrumento en Piano Roll y Tracks"
                  >
                    <Plus size={10} />
                    <span>Pista</span>
                  </button>
                </div>

                <div className="picker-melody-quick-list">
                  {tracks.map((track) => {
                    const rawInst = channels[track.channelId]?.instrument;
                    const inst = rawInst === 'piano' ? 'PIANO' : rawInst === 'soundfont' ? 'SF2' : 'SYNTH';
                    const count = track.notes?.length || 0;
                    return (
                      <button
                        key={track.id}
                        type="button"
                        className="picker-melody-quick-row"
                        onClick={() => jumpToMelodyEditor(track.id)}
                        title={`Abrir ${track.name} en Piano Roll (${count} notas)`}
                      >
                        <span
                          className="picker-melody-dot"
                          style={{ backgroundColor: track.color || '#a78bfa' }}
                        />
                        <span className="picker-melody-name">{track.name}</span>
                        <span className="picker-melody-inst">{inst}</span>
                        <span className="picker-card-meta">{count}n</span>
                        <ExternalLink size={10} style={{ color: '#ffd875', opacity: 0.75 }} />
                      </button>
                    );
                  })}
                </div>
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

      {/* Menú contextual de Patrón de Batería */}
      {ctxMenu && (
        <ContextMenuContainer
          x={ctxMenu.x}
          y={ctxMenu.y}
          className="picker-context-menu custom-context-menu"
        >
          {(() => {
            const pIdx = ctxMenu.patternIndex;
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
                    jumpToDrumEditor(pIdx);
                    setCtxMenu(null);
                  }}
                >
                  <ExternalLink size={12} /> Editar en Drum Sequencer
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setRenamingDrumIdx(pIdx);
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
                    handleSelectDrumPattern(newIdx);
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
          })()}
        </ContextMenuContainer>
      )}
    </aside>
  );
};
