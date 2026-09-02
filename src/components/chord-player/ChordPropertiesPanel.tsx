import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { 
  NOTE_CLASSES, 
  getExtensionsForChord, 
  parseChord, 
  getChromaticPassingChords 
} from '../../core/music';
import type { NoteClass } from '../../utils/typeDefinitions';
import { Trash2, Copy, X, Sparkles, Volume2 } from 'lucide-react';
import { toneEngine } from '../../audio/toneEngine';

interface ChordPropertiesPanelProps {
  popoverLeft: number;
  blockId?: string;
  onClose?: () => void;
}

const QUICK_QUALITIES = [
  { label: 'Mayor', suffix: '' },
  { label: 'm', suffix: 'm' },
  { label: '7', suffix: '7' },
  { label: 'maj7', suffix: 'maj7' },
  { label: 'm7', suffix: 'm7' },
  { label: 'aug (+)', suffix: 'aug' },
  { label: 'dim (°)', suffix: 'dim' },
  { label: 'm7b5', suffix: 'm7b5' },
  { label: 'sus4', suffix: 'sus4' },
  { label: 'sus2', suffix: 'sus2' },
  { label: '6', suffix: '6' },
  { label: 'add9', suffix: 'add9' },
];

export const ChordPropertiesPanel: React.FC<ChordPropertiesPanelProps> = ({ popoverLeft, blockId, onClose }) => {
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

  const [chordsInScaleOnly, setChordsInScaleOnly] = useState(false);
  const [showPassingChords, setShowPassingChords] = useState(false);

  const targetId = blockId || selectedChordId;
  const selectedBlock = chordBlocks.find(b => b.id === targetId);

  if (!selectedBlock) return null;

  const parsed = parseChord(selectedBlock.chord);
  const currentRoot = parsed ? parsed.root : 'C';
  const currentQuality = parsed ? parsed.qualitySuffix : '';

  const handleChordChange = (newChord: string) => {
    updateChordBlock(selectedBlock.id, { chord: newChord });
    toneEngine.playChordPreviewStart(newChord);
  };

  const handleRootChange = (newRoot: NoteClass) => {
    const newChord = `${newRoot}${currentQuality}`;
    handleChordChange(newChord);
  };

  const handleQualityChange = (suffix: string) => {
    const newChord = `${currentRoot}${suffix}`;
    handleChordChange(newChord);
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
  const passingChords = getChromaticPassingChords(selectedBlock.chord, key, scale);

  return (
    <div 
      className="chord-properties-popover"
      style={{
        left: `${popoverLeft}px`,
        position: 'absolute',
        top: '72px',
        zIndex: 50
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="popover-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <h4>{selectedBlock.chord}</h4>
          <button 
            type="button"
            className="popover-icon-btn"
            title="Escuchar acorde"
            onClick={() => toneEngine.playChordPreviewStart(selectedBlock.chord)}
          >
            <Volume2 size={13} />
          </button>
        </div>
        <button className="close-btn" onClick={() => { setSelectedChordId(null); onClose?.(); }}>
          <X size={14} />
        </button>
      </div>

      <div className="popover-body">
        {/* Selector Rápido de Tónica (12 Notas) */}
        <div className="popover-field" style={{ marginBottom: '6px' }}>
          <label style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-secondary)' }}>TÓNICA CROMÁTICA</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
            {NOTE_CLASSES.map(note => {
              const isSelected = currentRoot === note;
              return (
                <button
                  key={note}
                  type="button"
                  onClick={() => handleRootChange(note)}
                  style={{
                    flex: '1 0 20px',
                    padding: '2px 0',
                    fontSize: '0.68rem',
                    fontFamily: "'Share Tech Mono', monospace",
                    fontWeight: isSelected ? 'bold' : 'normal',
                    background: isSelected ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: isSelected ? '#000' : 'var(--text-primary)',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}`,
                    borderRadius: '2px',
                    cursor: 'pointer'
                  }}
                >
                  {note}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selector Rápido de Color / Calidad */}
        <div className="popover-field" style={{ marginBottom: '8px' }}>
          <label style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-secondary)' }}>COLOR / CALIDAD</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
            {QUICK_QUALITIES.map(q => {
              const isSelected = currentQuality === q.suffix;
              return (
                <button
                  key={q.suffix}
                  type="button"
                  onClick={() => handleQualityChange(q.suffix)}
                  style={{
                    padding: '2px 6px',
                    fontSize: '0.66rem',
                    fontWeight: isSelected ? 'bold' : 'normal',
                    background: isSelected ? 'var(--role-spicy, #a05080)' : 'var(--bg-tertiary)',
                    color: isSelected ? '#fff' : 'var(--text-primary)',
                    border: `1px solid ${isSelected ? '#e060b0' : 'var(--border-color)'}`,
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="popover-row">
          <div className="popover-field">
            <label htmlFor="pop-chord">Nombre / Texto</label>
            <input
              id="pop-chord"
              type="text"
              value={selectedBlock.chord}
              onChange={(e) => handleChordChange(e.target.value)}
              placeholder="ej: C, Dm, Dbaug"
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
            <label htmlFor="pop-bass">Bajo (Slash)</label>
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

        {/* Sección de Conectores & Paso Cromático */}
        <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <button
              type="button"
              onClick={() => setShowPassingChords(prev => !prev)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: '0.68rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                padding: 0
              }}
            >
              <Sparkles size={11} /> {showPassingChords ? 'Ocultar conectores de paso' : 'Sugerir acordes de paso cromático'}
            </button>
          </div>

          {showPassingChords && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
              {passingChords.map(pc => (
                <button
                  key={pc.chord}
                  type="button"
                  onClick={() => handleChordChange(pc.chord)}
                  style={{
                    background: 'rgba(160, 80, 128, 0.2)',
                    border: '1px solid rgba(160, 80, 128, 0.5)',
                    color: '#ffcce6',
                    borderRadius: '3px',
                    padding: '2px 6px',
                    fontSize: '0.68rem',
                    cursor: 'pointer'
                  }}
                  title={pc.label}
                >
                  {pc.chord} ({pc.label.split('(')[0].trim()})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Extensiones sugeridas */}
        <div className="popover-row" style={{ marginTop: '4px', borderTop: '1px solid var(--border-color)', paddingTop: '6px', flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Extensiones Rápidas</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.65rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input 
                type="checkbox" 
                checked={chordsInScaleOnly} 
                onChange={(e) => setChordsInScaleOnly(e.target.checked)} 
                style={{ width: '10px', height: '10px', cursor: 'pointer' }}
              />
              Solo en escala
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '55px', overflowY: 'auto', padding: '2px 0' }}>
            {extensions.length === 0 ? (
              <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Sin extensiones</span>
            ) : (
              extensions.map(ext => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => handleChordChange(ext)}
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
