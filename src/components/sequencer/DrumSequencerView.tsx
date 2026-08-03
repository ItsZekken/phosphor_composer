import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { EditorToolbar } from '../shared/EditorToolbar';
import { DrumChannelRow } from './DrumChannelRow';

export const DrumSequencerView: React.FC = () => {
  const { drumChannels, currentDrumPatternEdit, setCurrentDrumPatternEdit, channels, toggleMute, toggleSolo } = useSongStore();
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  
  const drumsMixer = channels['drums'] || { muted: false, solo: false };

  const handleToggleExpand = (id: string) => {
    setExpandedChannelId(prev => (prev === id ? null : id));
  };

  return (
    <div className="sequencer-container">
      <EditorToolbar>
        <div className="sequencer-toolbar-content" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span className="toolbar-title">DRUM SEQUENCER</span>
          
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

          {/* Pattern Pagination */}
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
        </div>
      </EditorToolbar>

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
      </div>
    </div>
  );
};
