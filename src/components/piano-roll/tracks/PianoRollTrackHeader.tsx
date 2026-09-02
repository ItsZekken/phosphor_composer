import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import type { PianoRollTrack } from '../../../utils/typeDefinitions';

interface PianoRollTrackHeaderProps {
  tracks: PianoRollTrack[];
  activeTrackId: string;
  setActiveTrackId: (id: string) => void;
  addPianoRollTrack: () => void;
  removePianoRollTrack: (id: string) => void;
  renamePianoRollTrack: (id: string, name: string) => void;
  onRequestDeleteTrack: (trackId: string, trackName: string) => void;
}

export const PianoRollTrackHeader: React.FC<PianoRollTrackHeaderProps> = React.memo(({
  tracks = [],
  activeTrackId,
  setActiveTrackId,
  addPianoRollTrack,
  removePianoRollTrack,
  renamePianoRollTrack,
  onRequestDeleteTrack
}) => {
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState<string>('');

  return (
    <div className="piano-track-strip">
      <div className="piano-track-chip-list">
        {tracks.map((track) => {
          const isActive = track.id === activeTrackId;
          const isEditing = editingTrackId === track.id;
          return (
            <div
              key={track.id}
              className={`piano-track-tab-chip ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTrackId(track.id)}
              title="Doble click para renombrar pista"
            >
              <span 
                className="track-dot" 
                style={{ backgroundColor: track.color || '#ff00aa', color: track.color || '#ff00aa' }} 
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
    </div>
  );
});
