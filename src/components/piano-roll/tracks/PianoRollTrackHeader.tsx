import React, { useState, useEffect } from 'react';
import { Plus, Settings, Copy, ClipboardPaste, Music } from 'lucide-react';
import type { PianoRollTrack } from '../../../utils/typeDefinitions';
import { ContextMenuContainer } from '../../ui/ContextMenuContainer';
import { PIANO_ROLL_COLOR_PALETTE } from '../../visualizer/hooks/useStageTimelineNotes';
import { useSongStore } from '../../../store/songStore';

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

  const openSynthConfigForChannel = useSongStore((state) => state.openSynthConfigForChannel);
  const copySynthSettings = useSongStore((state) => state.copySynthSettings);
  const pasteSynthSettings = useSongStore((state) => state.pasteSynthSettings);
  const synthClipboard = useSongStore((state) => state.synthClipboard);
  const setChannelInstrument = useSongStore((state) => state.setChannelInstrument);
  const channels = useSongStore((state) => state.channels);

  useEffect(() => {
    if (!colorPickerTarget) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.track-color-picker-popover')) {
        setColorPickerTarget(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColorPickerTarget(null);
    };
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [colorPickerTarget]);

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
    </div>
  );
});
