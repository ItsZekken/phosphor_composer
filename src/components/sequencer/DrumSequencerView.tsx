import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { EditorToolbar } from '../shared/EditorToolbar';
import { DrumChannelRow } from './DrumChannelRow';
import { PRESET_DRUM_KITS } from '../../constants/drumKits';
import { PatternChainArranger } from './PatternChainArranger';
import { CopyPatternModal } from '../ui/CopyPatternModal';

export const DrumSequencerView: React.FC = () => {
  const { 
    drumChannels, 
    activeDrumKitId, 
    selectDrumKit, 
    currentDrumPatternEdit, 
    setCurrentDrumPatternEdit, 
    duplicateCurrentPatternToNext,
    channels, 
    toggleMute, 
    toggleSolo 
  } = useSongStore();
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  
  const drumsMixer = channels['drums'] || { muted: false, solo: false };

  const handleToggleExpand = (id: string) => {
    setExpandedChannelId(prev => (prev === id ? null : id));
  };

  return (
    <div className="sequencer-container">
      <EditorToolbar>
        <div className="sequencer-toolbar-content" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span className="toolbar-title">DRUM SEQUENCER</span>
          
          {/* Selector de Kit Principal */}
          <div className="drum-kit-selector-wrapper">
            <span className="drum-kit-label">KIT:</span>
            <select 
              className="drum-kit-select"
              value={activeDrumKitId}
              onChange={(e) => selectDrumKit(e.target.value)}
            >
              {PRESET_DRUM_KITS.map(kit => (
                <option key={kit.id} value={kit.id}>
                  {kit.name}
                </option>
              ))}
              <option value="custom">
                Custom {activeDrumKitId === 'custom' ? '★' : ''}
              </option>
            </select>
          </div>

          {/* Global M/S */}
          <div className="drum-mute-solo" style={{ flexDirection: 'row', marginLeft: '0.5rem' }}>
            <button 
              className={`ms-btn ${drumsMixer.muted ? 'active-mute' : ''}`}
              onClick={() => toggleMute('drums')}
            >M</button>
            <button 
              className={`ms-btn ${drumsMixer.solo ? 'active-solo' : ''}`}
              onClick={() => toggleSolo('drums')}
            >S</button>
          </div>

          <button 
            className="add-channel-btn" 
            onClick={() => alert('Añadir canal (Próximamente)')}
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
                className="add-channel-btn" 
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'rgba(255, 255, 255, 0.08)' }}
                onClick={() => setIsCopyModalOpen(true)}
                title="Copiar patrón a otro número"
              >
                📋 Copiar
              </button>
              <button 
                className="add-channel-btn" 
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'rgba(0, 255, 204, 0.15)', color: 'var(--reposo)', borderColor: 'var(--reposo)' }}
                onClick={() => duplicateCurrentPatternToNext()}
                title={`Duplicar Patrón ${currentDrumPatternEdit + 1} en Patrón ${((currentDrumPatternEdit + 1) % 8) + 1}`}
              >
                ⚡ Duplicar
              </button>
            </div>
          </div>
        </div>
      </EditorToolbar>

      {/* Grid del Secuenciador */}
      <div className="drum-rack">
        {drumChannels.map((channel, idx) => (
          <DrumChannelRow 
            key={channel.id}
            channel={channel}
            channelIndex={idx}
            isExpanded={expandedChannelId === channel.id}
            onToggleExpand={() => handleToggleExpand(channel.id)}
          />
        ))}

        {/* Cadena Visual de Patrones (Arranger) */}
        <PatternChainArranger />
      </div>

      {/* Modal de Copia de Patrón */}
      <CopyPatternModal 
        isOpen={isCopyModalOpen}
        onClose={() => setIsCopyModalOpen(false)}
      />
    </div>
  );
};
