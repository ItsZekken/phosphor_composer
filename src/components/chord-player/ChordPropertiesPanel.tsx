import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { NOTE_CLASSES, getExtensionsForChord } from '../../engine/scaleDefinitions';
import type { NoteClass } from '../../utils/typeDefinitions';
import { Trash2, Copy, X } from 'lucide-react';

interface ChordPropertiesPanelProps {
  popoverLeft: number;
}

export const ChordPropertiesPanel: React.FC<ChordPropertiesPanelProps> = ({ popoverLeft }) => {
  const {
    chordBlocks,
    selectedChordId,
    setSelectedChordId,
    updateChordBlock,
    removeChordBlock,
    addChordBlock,
    key,
    scale
  } = useSongStore(useShallow(state => ({
    chordBlocks: state.chordBlocks,
    selectedChordId: state.selectedChordId,
    setSelectedChordId: state.setSelectedChordId,
    updateChordBlock: state.updateChordBlock,
    removeChordBlock: state.removeChordBlock,
    addChordBlock: state.addChordBlock,
    key: state.key,
    scale: state.scale
  })));

  const [chordsInScaleOnly, setChordsInScaleOnly] = useState(true);

  const selectedBlock = chordBlocks.find(b => b.id === selectedChordId);

  if (!selectedBlock) return null;

  const handleChordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateChordBlock(selectedBlock.id, { chord: e.target.value });
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateChordBlock(selectedBlock.id, {
      type: e.target.value as any,
    });
  };

  const handleBassChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    updateChordBlock(selectedBlock.id, {
      bassNote: val === 'none' ? undefined : (val as NoteClass),
    });
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateChordBlock(selectedBlock.id, { section: e.target.value || undefined });
  };

  const handleVoicingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateChordBlock(selectedBlock.id, {
      voicing: e.target.value as any,
    });
  };

  const handleInversionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateChordBlock(selectedBlock.id, {
      inversion: parseInt(e.target.value, 10),
    });
  };

  const handleDuplicate = () => {
    addChordBlock(
      selectedBlock.chord,
      selectedBlock.startBeat + selectedBlock.durationBeats,
      selectedBlock.durationBeats
    );
  };

  const handleDelete = () => {
    removeChordBlock(selectedBlock.id);
  };

  const extensions = getExtensionsForChord(selectedBlock.chord, key, scale, chordsInScaleOnly);

  return (
    <div 
      className="chord-properties-popover"
      style={{
        left: `${popoverLeft}px`,
        position: 'absolute',
        top: '72px', // debajo del bloque (que mide 48px en top 22px)
        zIndex: 50
      }}
      onMouseDown={(e) => e.stopPropagation()} // Evitar arrastres accidentales del canvas
    >
      <div className="popover-header">
        <h4>Propiedades: {selectedBlock.chord}</h4>
        <button className="close-btn" onClick={() => setSelectedChordId(null)}>
          <X size={14} />
        </button>
      </div>

      <div className="popover-body">
        <div className="popover-row">
          <div className="popover-field">
            <label htmlFor="pop-chord">Acorde</label>
            <input
              id="pop-chord"
              type="text"
              value={selectedBlock.chord}
              onChange={handleChordChange}
              placeholder="ej: C, Dm, G7"
              className="popover-input"
            />
          </div>
          <div className="popover-field">
            <label htmlFor="pop-section">Sección</label>
            <input
              id="pop-section"
              type="text"
              value={selectedBlock.section || ''}
              onChange={handleSectionChange}
              placeholder="ej: Coro"
              className="popover-input"
            />
          </div>
        </div>

        <div className="popover-row">
          <div className="popover-field">
            <label htmlFor="pop-type">Tipo</label>
            <select
              id="pop-type"
              value={selectedBlock.type || 'play'}
              onChange={handleTypeChange}
              className="popover-select"
            >
              <option value="play">Play (Todos)</option>
              <option value="chord-only">Sólo Acorde</option>
              <option value="bass-only">Sólo Bajo</option>
              <option value="silence">Silencio</option>
              <option value="break">Break</option>
            </select>
          </div>
          <div className="popover-field">
            <label htmlFor="pop-bass">Bajo</label>
            <select
              id="pop-bass"
              value={selectedBlock.bassNote || 'none'}
              onChange={handleBassChange}
              className="popover-select"
            >
              <option value="none">Tónica</option>
              {NOTE_CLASSES.map(note => (
                <option key={note} value={note}>
                  /{note}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="popover-row">
          <div className="popover-field">
            <label htmlFor="pop-voicing">Voicing</label>
            <select
              id="pop-voicing"
              value={selectedBlock.voicing || 'default'}
              onChange={handleVoicingChange}
              className="popover-select"
            >
              <option value="default">Por defecto</option>
              <option value="open">Abierta</option>
              <option value="drop2">Drop 2</option>
              <option value="drop3">Drop 3</option>
            </select>
          </div>
          <div className="popover-field">
            <label htmlFor="pop-inversion">Inversión</label>
            <select
              id="pop-inversion"
              value={selectedBlock.inversion || 0}
              onChange={handleInversionChange}
              className="popover-select"
            >
              <option value={0}>Fundamental</option>
              <option value={1}>1ra (Primera)</option>
              <option value={2}>2da (Segunda)</option>
              <option value={3}>3ra (Tercera)</option>
            </select>
          </div>
        </div>

        <div className="popover-row" style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '8px', flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Extensiones sugeridas</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.65rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input 
                type="checkbox" 
                checked={chordsInScaleOnly} 
                onChange={(e) => setChordsInScaleOnly(e.target.checked)} 
                style={{ width: '10px', height: '10px', cursor: 'pointer' }}
              />
              En escala
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '60px', overflowY: 'auto', padding: '2px 0' }}>
            {extensions.length === 0 ? (
              <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Sin extensiones</span>
            ) : (
              extensions.map(ext => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => updateChordBlock(selectedBlock.id, { chord: ext })}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    borderRadius: '3px',
                    padding: '2px 5px',
                    fontSize: '0.68rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  {ext}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="popover-actions">
        <button onClick={handleDuplicate} className="popover-btn secondary" title="Duplicar acorde">
          <Copy size={12} /> Duplicar
        </button>
        <button onClick={handleDelete} className="popover-btn danger" title="Eliminar acorde">
          <Trash2 size={12} /> Eliminar
        </button>
      </div>
    </div>
  );
};
