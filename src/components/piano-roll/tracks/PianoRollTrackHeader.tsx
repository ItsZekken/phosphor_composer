import React, { useState, useEffect } from 'react';
import { Plus, Settings, Copy, ClipboardPaste, Music, Layers, Eraser, Trash2, Edit3, ArrowUpRight, Radio } from 'lucide-react';
import type { PianoRollTrack } from '../../../utils/typeDefinitions';
import { ContextMenuContainer } from '../../ui/ContextMenuContainer';
import { PIANO_ROLL_COLOR_PALETTE } from '../../visualizer/hooks/useStageTimelineNotes';
import { useSongStore } from '../../../store/songStore';
import { ensureTrackPatterns, getBeatsPerMeasure, getMelodyPatternLengthBeats } from '../../../core/audio/arrangementResolver';

interface PianoRollTrackHeaderProps {
  tracks: PianoRollTrack[];
  activeTrackId: string;
  setActiveTrackId: (id: string) => void;
  addPianoRollTrack: () => void;
  removePianoRollTrack: (id: string) => void;
  renamePianoRollTrack: (id: string, name: string) => void;
  setTrackColor: (id: string, color: string) => void;
  onRequestDeleteTrack: (trackId: string, trackName: string) => void;
  selectedNoteCount?: number;
  onClearSelection?: () => void;
}

export const PianoRollTrackHeader: React.FC<PianoRollTrackHeaderProps> = React.memo(({
  tracks = [],
  activeTrackId,
  setActiveTrackId,
  addPianoRollTrack,
  removePianoRollTrack,
  renamePianoRollTrack,
  setTrackColor,
  onRequestDeleteTrack,
  selectedNoteCount = 0,
  onClearSelection
}) => {
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState<string>('');
  const [colorPickerTarget, setColorPickerTarget] = useState<{ trackId: string; x: number; y: number } | null>(null);
  const [patternMenuTarget, setPatternMenuTarget] = useState<{ patternId: string; x: number; y: number } | null>(null);
  const [renamingPatternId, setRenamingPatternId] = useState<string | null>(null);
  const [renamingPatternDraft, setRenamingPatternDraft] = useState<string>('');

  const openSynthConfigForChannel = useSongStore((state) => state.openSynthConfigForChannel);
  const copySynthSettings = useSongStore((state) => state.copySynthSettings);
  const pasteSynthSettings = useSongStore((state) => state.pasteSynthSettings);
  const synthClipboard = useSongStore((state) => state.synthClipboard);
  const setChannelInstrument = useSongStore((state) => state.setChannelInstrument);
  const channels = useSongStore((state) => state.channels);
  const timeSignature = useSongStore((state) => state.timeSignature);
  const midiClips = useSongStore((state) => state.midiClips);
  const setActiveTrackPattern = useSongStore((state) => state.setActiveTrackPattern);
  const addMelodyPattern = useSongStore((state) => state.addMelodyPattern);
  const duplicateMelodyPattern = useSongStore((state) => state.duplicateMelodyPattern);
  const renameMelodyPattern = useSongStore((state) => state.renameMelodyPattern);
  const setMelodyPatternLength = useSongStore((state) => state.setMelodyPatternLength);
  const clearMelodyPattern = useSongStore((state) => state.clearMelodyPattern);
  const removeMelodyPattern = useSongStore((state) => state.removeMelodyPattern);
  const setTrackArrangementMode = useSongStore((state) => state.setTrackArrangementMode);
  const setSelectedPatternRef = useSongStore((state) => state.setSelectedPatternRef);
  const setActiveView = useSongStore((state) => state.setActiveView);

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const currentActiveTrack = tracks.find((t) => t.id === activeTrackId) || tracks[0];
  const activeTrackPatInfo = currentActiveTrack ? ensureTrackPatterns(currentActiveTrack) : null;
  const activePattern = activeTrackPatInfo?.activePattern;
  const activePatternBars = activePattern
    ? Math.max(1, Math.round((getMelodyPatternLengthBeats(activePattern, beatsPerMeasure) / beatsPerMeasure) * 10) / 10)
    : 1;
  const activeTrackMidiClipCount = currentActiveTrack
    ? (midiClips || []).filter((c) => c.sourceType === 'melody' && c.melodyTrackId === currentActiveTrack.id).length
    : 0;
  const isPlaylistControlled = currentActiveTrack
    ? currentActiveTrack.arrangementMode === 'playlist' || activeTrackMidiClipCount > 0
    : false;

  useEffect(() => {
    if (!colorPickerTarget && !patternMenuTarget) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.track-color-picker-popover') && !target.closest('.pattern-ctx-popover')) {
        setColorPickerTarget(null);
        setPatternMenuTarget(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setColorPickerTarget(null);
        setPatternMenuTarget(null);
      }
    };
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [colorPickerTarget, patternMenuTarget]);

  return (
    <div className="piano-track-strip">
      <div className="piano-track-chip-list">
        {tracks.map((track) => {
          const isActive = track.id === activeTrackId;
          const isEditing = editingTrackId === track.id;
          const dotColor = track.color || '#6880ad';
          return (
            <div
              key={track.id}
              className={`piano-track-tab-chip ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTrackId(track.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setColorPickerTarget({
                  trackId: track.id,
                  x: e.clientX,
                  y: e.clientY
                });
              }}
              style={{
                borderBottom: isActive ? `2px solid ${dotColor}` : undefined
              }}
              title="Click para seleccionar | Doble click para renombrar | Click derecho para cambiar color"
            >
              <span 
                className="track-dot" 
                style={{ backgroundColor: dotColor, color: dotColor }} 
              />
              {isEditing ? (
                <input
                  type="text"
                  className="track-tab-name-input"
                  value={editingTrackName}
                  autoFocus
                  style={{ width: '70px', height: '18px', fontSize: '0.7rem', background: '#000', border: '1px solid #ffd875', color: '#fff', padding: '0 2px' }}
                  onChange={(e) => setEditingTrackName(e.target.value)}
                  onBlur={() => {
                    if (editingTrackName.trim()) renamePianoRollTrack(track.id, editingTrackName.trim());
                    setEditingTrackId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editingTrackName.trim()) renamePianoRollTrack(track.id, editingTrackName.trim());
                      setEditingTrackId(null);
                    } else if (e.key === 'Escape') {
                      setEditingTrackId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingTrackId(track.id);
                    setEditingTrackName(track.name);
                  }}
                >
                  {track.name}
                </span>
              )}
              {tracks.length > 1 && (
                <button
                  type="button"
                  className="track-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    if ((track.notes || []).length === 0) {
                      const trackIndex = tracks.findIndex(t => t.id === track.id);
                      if (isActive) {
                        const newActiveTrack = tracks[trackIndex - 1] || tracks[trackIndex + 1];
                        if (newActiveTrack) setActiveTrackId(newActiveTrack.id);
                      }
                      removePianoRollTrack(track.id);
                    } else {
                      onRequestDeleteTrack(track.id, track.name);
                    }
                  }}
                  title="Eliminar esta pista"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="physical-btn"
          onClick={() => addPianoRollTrack()}
          title="Añadir nueva pista de melodía"
          style={{ padding: '0 6px', height: '24px', minWidth: '24px' }}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Banco de Patrones FL-Style para la Melodía Activa */}
      {currentActiveTrack && activeTrackPatInfo && (
        <div className="piano-pattern-bank">
          <span className="piano-pattern-bank-label">PATRÓN:</span>
          <div
            className="lcd-pattern-screen"
            style={{ height: '24px' }}
            title="Patrones de esta melodía (Clic derecho para renombrar, duplicar o fijar compases)"
          >
            {activeTrackPatInfo.patterns.map((pat, idx) => {
              const isPatActive = pat.id === activeTrackPatInfo.activePatternId;
              const hasNotes = (pat.notes || []).length > 0;
              const patBars = Math.max(
                1,
                Math.round((getMelodyPatternLengthBeats(pat, beatsPerMeasure) / beatsPerMeasure) * 10) / 10
              );
              return (
                <button
                  key={pat.id}
                  type="button"
                  className={`lcd-pattern-cell ${isPatActive ? 'active' : ''}`}
                  style={{ height: '18px', position: 'relative' }}
                  onClick={() => setActiveTrackPattern(currentActiveTrack.id, pat.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setPatternMenuTarget({ patternId: pat.id, x: e.clientX, y: e.clientY });
                  }}
                  title={`${pat.name} (${patBars}c${pat.lengthBeats ? ' fijo' : ' auto'}) — Clic derecho para opciones`}
                >
                  {idx + 1}
                  {hasNotes && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '1px',
                        width: '4px',
                        height: '2px',
                        borderRadius: '1px',
                        backgroundColor: isPatActive ? '#ffd875' : (currentActiveTrack.color || '#a78bfa'),
                        opacity: isPatActive ? 1 : 0.75
                      }}
                    />
                  )}
                </button>
              );
            })}
            <button
              type="button"
              className="lcd-pattern-cell lcd-action-cell"
              style={{ height: '18px', color: 'var(--accent-hover)', fontWeight: 'bold' }}
              onClick={() => addMelodyPattern(currentActiveTrack.id)}
              title="Crear nuevo patrón vacío para esta melodía"
            >
              <Plus size={11} />
            </button>
          </div>

          {renamingPatternId === activePattern?.id && activePattern ? (
            <input
              type="text"
              className="piano-pattern-rename-input"
              value={renamingPatternDraft}
              autoFocus
              onChange={(e) => setRenamingPatternDraft(e.target.value)}
              onBlur={() => {
                if (renamingPatternDraft.trim()) {
                  renameMelodyPattern(currentActiveTrack.id, activePattern.id, renamingPatternDraft.trim());
                }
                setRenamingPatternId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (renamingPatternDraft.trim()) {
                    renameMelodyPattern(currentActiveTrack.id, activePattern.id, renamingPatternDraft.trim());
                  }
                  setRenamingPatternId(null);
                } else if (e.key === 'Escape') {
                  setRenamingPatternId(null);
                }
              }}
            />
          ) : (
            activePattern && (
              <button
                type="button"
                className="piano-pattern-meta-btn"
                onDoubleClick={() => {
                  setRenamingPatternId(activePattern.id);
                  setRenamingPatternDraft(activePattern.name);
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPatternMenuTarget({ patternId: activePattern.id, x: rect.left, y: rect.bottom + 4 });
                }}
                title="Clic para ajustar duración/opciones · Doble clic para renombrar patrón"
              >
                <span className="piano-pattern-meta-name">{activePattern.name}</span>
                <span className="piano-pattern-meta-len">
                  {activePatternBars}c{activePattern.lengthBeats ? '' : '·A'}
                </span>
              </button>
            )
          )}

          <button
            type="button"
            className={`piano-playlist-link-btn ${isPlaylistControlled ? 'is-playlist' : ''}`}
            onClick={() => {
              if (activePattern) {
                setSelectedPatternRef({
                  sourceType: 'melody',
                  melodyTrackId: currentActiveTrack.id,
                  melodyPatternId: activePattern.id
                });
              }
              setActiveView('audio-tracks');
            }}
            title={
              isPlaylistControlled
                ? `Secuenciado en TRACKS (${activeTrackMidiClipCount} clips) — Clic para ir a TRACKS`
                : 'Enviar / secuenciar este patrón en TRACKS (Playlist)'
            }
          >
            <Radio size={11} />
            <span>{isPlaylistControlled ? `TRACKS (${activeTrackMidiClipCount})` : 'A TRACKS'}</span>
            <ArrowUpRight size={11} />
          </button>
        </div>
      )}

      {selectedNoteCount > 0 && (
        <div className="piano-selection-pill" title="Notas seleccionadas actualmente (Esc para limpiar)">
          <span className="piano-selection-dot" />
          <span>{selectedNoteCount === 1 ? '1 nota seleccionada' : `${selectedNoteCount} notas seleccionadas`}</span>
          {onClearSelection && (
            <button
              type="button"
              className="piano-selection-clear"
              onClick={onClearSelection}
              title="Limpiar selección (Esc)"
              aria-label="Limpiar selección"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {colorPickerTarget && (
        <ContextMenuContainer
          x={colorPickerTarget.x}
          y={colorPickerTarget.y}
          className="track-color-picker-popover custom-context-menu"
        >
          <div className="track-color-picker-header">
            <span>Color de Pista</span>
            <button
              type="button"
              className="track-color-picker-close"
              onClick={() => setColorPickerTarget(null)}
              title="Cerrar"
            >
              ✕
            </button>
          </div>
          <div className="track-color-picker-grid">
            {PIANO_ROLL_COLOR_PALETTE.map((c) => {
              const currentTrack = tracks.find(t => t.id === colorPickerTarget.trackId);
              const isSelected = currentTrack?.color?.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  className={`track-color-swatch ${isSelected ? 'selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setTrackColor(colorPickerTarget.trackId, c);
                    setColorPickerTarget(null);
                  }}
                  title={c}
                >
                  {isSelected && <span className="swatch-check">✓</span>}
                </button>
              );
            })}
          </div>
          <div className="track-color-picker-custom">
            <label className="track-color-picker-custom-label">
              <input
                type="color"
                value={tracks.find(t => t.id === colorPickerTarget.trackId)?.color || '#6880ad'}
                onChange={(e) => {
                  setTrackColor(colorPickerTarget.trackId, e.target.value);
                }}
                className="track-color-picker-input"
              />
              <span>Personalizado</span>
            </label>
          </div>

          {/* Opciones de Instrumento y Sintetizador de la Pista */}
          {(() => {
            const currentTrack = tracks.find(t => t.id === colorPickerTarget.trackId);
            const currentInst = currentTrack ? channels[currentTrack.channelId]?.instrument : 'piano';
            return (
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '6px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 'bold', padding: '0 4px', letterSpacing: '0.05em' }}>
                  INSTRUMENTO DE PISTA
                </div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    if (currentTrack) setChannelInstrument(currentTrack.channelId, 'piano');
                    setColorPickerTarget(null);
                  }}
                >
                  <Music size={12} />
                  <span>Piano {currentInst === 'piano' ? '✓' : ''}</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    if (currentTrack) {
                      setChannelInstrument(currentTrack.channelId, 'synth');
                      openSynthConfigForChannel(currentTrack.channelId);
                    }
                    setColorPickerTarget(null);
                  }}
                >
                  <Settings size={12} />
                  <span>Sintetizador {currentInst === 'synth' ? '✓' : ''}</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    if (currentTrack) copySynthSettings(currentTrack.channelId);
                    setColorPickerTarget(null);
                  }}
                >
                  <Copy size={12} />
                  <span>Copiar Sonido Sintetizador</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={!synthClipboard}
                  onClick={() => {
                    if (currentTrack && synthClipboard) {
                      setChannelInstrument(currentTrack.channelId, 'synth');
                      pasteSynthSettings(currentTrack.channelId);
                    }
                    setColorPickerTarget(null);
                  }}
                >
                  <ClipboardPaste size={12} />
                  <span>Pegar Sonido Sintetizador</span>
                </button>
              </div>
            );
          })()}
        </ContextMenuContainer>
      )}

      {/* Menú contextual de Patrón de Melodía */}
      {patternMenuTarget && currentActiveTrack && activeTrackPatInfo && (() => {
        const targetPat = activeTrackPatInfo.patterns.find((p) => p.id === patternMenuTarget.patternId);
        if (!targetPat) return null;
        const barLengths = [1, 2, 4, 8];
        return (
          <ContextMenuContainer
            x={patternMenuTarget.x}
            y={patternMenuTarget.y}
            className="pattern-ctx-popover custom-context-menu"
          >
            <div className="menu-header">
              <span>{targetPat.name}</span>
            </div>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setActiveTrackPattern(currentActiveTrack.id, targetPat.id);
                setRenamingPatternId(targetPat.id);
                setRenamingPatternDraft(targetPat.name);
                setPatternMenuTarget(null);
              }}
            >
              <Edit3 size={12} /> Renombrar patrón
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                duplicateMelodyPattern(currentActiveTrack.id, targetPat.id);
                setPatternMenuTarget(null);
              }}
            >
              <Layers size={12} /> Duplicar patrón
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setSelectedPatternRef({
                  sourceType: 'melody',
                  melodyTrackId: currentActiveTrack.id,
                  melodyPatternId: targetPat.id
                });
                setActiveView('audio-tracks');
                setPatternMenuTarget(null);
              }}
            >
              <ArrowUpRight size={12} /> Secuenciar en TRACKS
            </button>

            <hr className="menu-separator" />
            <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 700, padding: '2px 8px', letterSpacing: '0.05em' }}>
              DURACIÓN DEL PATRÓN
            </div>
            <div style={{ display: 'flex', gap: '3px', padding: '4px 6px' }}>
              <button
                type="button"
                className={`physical-segment-btn ${!targetPat.lengthBeats ? 'active' : ''}`}
                style={{ fontSize: '0.66rem', padding: '2px 6px', height: '22px' }}
                onClick={() => {
                  setMelodyPatternLength(currentActiveTrack.id, targetPat.id, undefined);
                  setPatternMenuTarget(null);
                }}
              >
                Auto
              </button>
              {barLengths.map((bars) => {
                const beats = bars * beatsPerMeasure;
                const isSelectedLen = targetPat.lengthBeats === beats;
                return (
                  <button
                    key={bars}
                    type="button"
                    className={`physical-segment-btn ${isSelectedLen ? 'active' : ''}`}
                    style={{ fontSize: '0.66rem', padding: '2px 6px', height: '22px' }}
                    onClick={() => {
                      setMelodyPatternLength(currentActiveTrack.id, targetPat.id, beats);
                      setPatternMenuTarget(null);
                    }}
                  >
                    {bars}c
                  </button>
                );
              })}
            </div>

            {isPlaylistControlled && activeTrackMidiClipCount === 0 && (
              <>
                <hr className="menu-separator" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setTrackArrangementMode(currentActiveTrack.id, 'direct');
                    setPatternMenuTarget(null);
                  }}
                >
                  <Radio size={12} /> Volver a reproducción directa
                </button>
              </>
            )}

            <hr className="menu-separator" />
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                clearMelodyPattern(currentActiveTrack.id, targetPat.id);
                setPatternMenuTarget(null);
              }}
            >
              <Eraser size={12} /> Limpiar notas del patrón
            </button>
            {activeTrackPatInfo.patterns.length > 1 && (
              <button
                type="button"
                className="menu-danger"
                onClick={() => {
                  removeMelodyPattern(currentActiveTrack.id, targetPat.id);
                  setPatternMenuTarget(null);
                }}
              >
                <Trash2 size={12} /> Eliminar patrón
              </button>
            )}
          </ContextMenuContainer>
        );
      })()}
    </div>
  );
});
