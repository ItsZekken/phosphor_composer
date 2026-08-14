import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { EditorToolbar } from '../shared/EditorToolbar';
import { DrumChannelRow } from './DrumChannelRow';
import { PRESET_DRUM_KITS } from '../../constants/drumKits';
import { PatternChainArranger } from './PatternChainArranger';

import { CustomSelect } from '../ui/CustomSelect';
import { Copy, ClipboardPaste, Repeat } from 'lucide-react';
import { type DrumChannel } from '../../utils/typeDefinitions';

export const DrumSequencerView: React.FC = () => {
  const { 
    drumChannels, 
    activeDrumKitId, 
    selectDrumKit, 
    currentDrumPatternEdit, 
    setCurrentDrumPatternEdit, 
    copyDrumPattern,
    pasteDrumPattern,
    clipboardPattern,
    isPatternRepeatOn,
    setPatternRepeatOn,
    channels, 
    toggleMute, 
    toggleSolo,
    addDrumChannel,
    reorderDrumChannels
  } = useSongStore();
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  const drumsMixer = channels['drums'] || { muted: false, solo: false };

  const handleToggleExpand = (id: string) => {
    setExpandedChannelId(prev => (prev === id ? null : id));
  };

  const handleDragStartRow = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOverRow = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDropRow = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndexStr = e.dataTransfer.getData('text/plain');
    const sourceIndex = sourceIndexStr !== '' ? Number(sourceIndexStr) : draggedIndex;
    if (sourceIndex !== null && !isNaN(sourceIndex) && sourceIndex !== targetIndex) {
      reorderDrumChannels(sourceIndex, targetIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEndRow = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleAddChannel = () => {
    const newId = `custom_drum_${Date.now()}`;
    const newChannel: DrumChannel = {
      id: newId,
      name: `Custom ${drumChannels.length + 1}`,
      sampleUrl: PRESET_DRUM_KITS[0].samples['kick'] || '',
      patterns: Array(8).fill(null).map(() => Array(16).fill({ isActive: false, velocity: 0.8 })),
      volume: 80,
      pan: 0,
      muted: false,
      solo: false,
    };
    addDrumChannel(newChannel);
  };

  return (
    <div className="sequencer-container">
      <EditorToolbar>
        <div className="sequencer-toolbar-content" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span className="toolbar-title">DRUM SEQUENCER</span>
          
          {/* Selector de Kit Principal */}
          <div className="drum-kit-selector-wrapper">
            <span className="drum-kit-label">KIT:</span>
            <CustomSelect
              value={activeDrumKitId}
              onChange={selectDrumKit}
              options={[
                ...PRESET_DRUM_KITS.map(kit => ({ value: kit.id, label: kit.name })),
                { value: 'custom', label: `Custom ${activeDrumKitId === 'custom' ? '★' : ''}` }
              ]}
              style={{ marginLeft: '0.5rem', minWidth: '120px' }}
            />
          </div>

          {/* Global M/S */}
          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', marginLeft: '0.5rem' }}>
            <button 
              className={`ms-btn ${drumsMixer.muted ? 'active-mute' : ''}`}
              onClick={() => toggleMute('drums')}
              style={{ width: '28px', height: '28px', fontSize: '0.72rem', fontWeight: 'bold' }}
              title={drumsMixer.muted ? 'Desmutear batería' : 'Silenciar batería (Mute)'}
            >M</button>
            <button 
              className={`ms-btn ${drumsMixer.solo ? 'active-solo' : ''}`}
              onClick={() => toggleSolo('drums')}
              style={{ width: '28px', height: '28px', fontSize: '0.72rem', fontWeight: 'bold' }}
              title={drumsMixer.solo ? 'Desactivar Solo' : 'Aislar batería (Solo)'}
            >S</button>
          </div>

          <button 
            className="action-btn add-channel-btn" 
            onClick={handleAddChannel}
          >
            + ADD CHANNEL
          </button>

          {/* Pattern Pagination & Copy Tools */}
          <div className="pattern-pagination-container" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className="pattern-pagination">
              {Array.from({ length: 8 }).map((_, i) => (
                <button 
                  key={i}
                  className={`pattern-btn ${currentDrumPatternEdit === i ? 'active' : ''}`}
                  onClick={() => setCurrentDrumPatternEdit(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            <div className="pattern-copy-tools" style={{ display: 'flex', gap: '0.3rem' }}>
              <button 
                className="action-btn" 
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'rgba(255, 255, 255, 0.08)' }}
                onClick={() => copyDrumPattern(currentDrumPatternEdit)}
                title="Copiar patrón actual"
              >
                <Copy size={14} />
              </button>
              <button 
                className="action-btn" 
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: clipboardPattern ? 'rgba(0, 255, 204, 0.15)' : 'transparent', color: clipboardPattern ? 'var(--reposo)' : 'var(--text-secondary)', borderColor: clipboardPattern ? 'var(--reposo)' : 'var(--border-color)', opacity: clipboardPattern ? 1 : 0.5, cursor: clipboardPattern ? 'pointer' : 'not-allowed' }}
                onClick={() => { if (clipboardPattern) pasteDrumPattern(currentDrumPatternEdit); }}
                title="Pegar patrón"
                disabled={!clipboardPattern}
              >
                <ClipboardPaste size={14} />
              </button>
              
              <button
                className={`action-btn ${isPatternRepeatOn ? 'active' : ''}`}
                style={{ 
                  padding: '0.3rem 0.6rem', 
                  fontSize: '0.75rem', 
                  marginLeft: '0.5rem',
                  background: isPatternRepeatOn ? 'rgba(255, 100, 200, 0.15)' : 'transparent', 
                  color: isPatternRepeatOn ? '#ff64c8' : 'var(--text-secondary)', 
                  borderColor: isPatternRepeatOn ? '#ff64c8' : 'var(--border-color)' 
                }}
                onClick={() => setPatternRepeatOn(!isPatternRepeatOn)}
                title="Repetir patrón actual"
              >
                <Repeat size={14} />
              </button>
            </div>
          </div>
        </div>
      </EditorToolbar>

      {/* Grid del Secuenciador */}
      <div className="drum-rack">
        {(Array.isArray(drumChannels) ? drumChannels : []).map((channel, idx) => (
          <DrumChannelRow 
            key={channel.id}
            channel={channel}
            channelIndex={idx}
            isExpanded={expandedChannelId === channel.id}
            onToggleExpand={() => handleToggleExpand(channel.id)}
            onDragStartRow={handleDragStartRow}
            onDragOverRow={handleDragOverRow}
            onDropRow={handleDropRow}
            onDragEndRow={handleDragEndRow}
            isDragging={draggedIndex === idx}
            isDragOver={dragOverIndex === idx && draggedIndex !== idx}
          />
        ))}

        {/* Cadena Visual de Patrones (Arranger) */}
        <PatternChainArranger />
      </div>
    </div>
  );
};
