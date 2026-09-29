import React, { useState, useEffect } from 'react';
import { Plus, Settings, Copy, ClipboardPaste } from 'lucide-react';
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
}

export const PianoRollTrackHeader: React.FC<PianoRollTrackHeaderProps> = React.memo(({
  tracks = [],
  activeTrackId,
  setActiveTrackId,
  addPianoRollTrack,
  removePianoRollTrack,
  renamePianoRollTrack,
  setTrackColor,
  onRequestDeleteTrack
}) => {
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState<string>('');
  const [colorPickerTarget, setColorPickerTarget] = useState<{ trackId: string; x: number; y: number } | null>(null);

  const openSynthConfigForChannel = useSongStore((state) => state.openSynthConfigForChannel);
  const copySynthSettings = useSongStore((state) => state.copySynthSettings);
  const pasteSynthSettings = useSongStore((state) => state.pasteSynthSettings);
  const synthClipboard = useSongStore((state) => state.synthClipboard);
  const setChannelInstrument = useSongStore((state) => state.setChannelInstrument);

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

      {colorPickerTarget && (
        <ContextMenuContainer
          x={colorPickerTarget.x}
          y={colorPickerTarget.y}
          className="track-color-picker-popover"
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

          {/* Opciones de Sintetizador de la Pista */}
          <div style={{ borderTop: '1px solid #233029', paddingTop: '6px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 'bold', padding: '0 4px', letterSpacing: '0.05em' }}>
              SINTETIZADOR DE PISTA
            </div>
            <button
              type="button"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', padding: '4px 6px', background: 'transparent', border: 'none', color: '#a855f7', cursor: 'pointer', textAlign: 'left', borderRadius: '3px' }}
              onClick={() => {
                const track = tracks.find(t => t.id === colorPickerTarget.trackId);
                if (track) {
                  setChannelInstrument(track.channelId, 'synth');
                  openSynthConfigForChannel(track.channelId);
                }
                setColorPickerTarget(null);
              }}
            >
              <Settings size={12} />
              <span>Configurar Sintetizador...</span>
            </button>
            <button
              type="button"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', padding: '4px 6px', background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', textAlign: 'left', borderRadius: '3px' }}
              onClick={() => {
                const track = tracks.find(t => t.id === colorPickerTarget.trackId);
                if (track) copySynthSettings(track.channelId);
                setColorPickerTarget(null);
              }}
            >
              <Copy size={12} />
              <span>Copiar Sonido Sintetizador</span>
            </button>
            <button
              type="button"
              disabled={!synthClipboard}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', padding: '4px 6px', background: 'transparent', border: 'none', color: synthClipboard ? '#10b981' : 'var(--text-secondary)', opacity: synthClipboard ? 1 : 0.4, cursor: synthClipboard ? 'pointer' : 'not-allowed', textAlign: 'left', borderRadius: '3px' }}
              onClick={() => {
                const track = tracks.find(t => t.id === colorPickerTarget.trackId);
                if (track && synthClipboard) {
                  setChannelInstrument(track.channelId, 'synth');
                  pasteSynthSettings(track.channelId);
                }
                setColorPickerTarget(null);
              }}
            >
              <ClipboardPaste size={12} />
              <span>Pegar Sonido Sintetizador</span>
            </button>
          </div>
        </ContextMenuContainer>
      )}
    </div>
  );
});
