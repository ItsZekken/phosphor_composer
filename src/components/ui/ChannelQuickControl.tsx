import React from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';

interface ChannelQuickControlProps {
  channelId: string;
}

export const ChannelQuickControl: React.FC<ChannelQuickControlProps> = ({ channelId }) => {
  const { channels, toggleMute, toggleSolo } = useSongStore(
    useShallow((state) => ({
      channels: state.channels,
      toggleMute: state.toggleMute,
      toggleSolo: state.toggleSolo
    }))
  );

  const channel = channels[channelId];
  if (!channel) return null;

  return (
    <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
      <button
        className={`control-btn mute-toggle ${channel.muted ? 'active' : ''}`}
        onClick={() => toggleMute(channelId)}
        title={channel.muted ? 'Desmutear canal' : 'Silenciar canal (Mute)'}
        style={{ width: '28px', height: '28px', fontSize: '0.7rem', fontWeight: 'bold', fontFamily: "'Share Tech Mono', monospace" }}
      >
        M
      </button>
      <button
        className={`control-btn solo-toggle ${channel.solo ? 'active' : ''}`}
        onClick={() => toggleSolo(channelId)}
        title={channel.solo ? 'Desactivar Solo' : 'Aislar canal (Solo)'}
        style={{ width: '28px', height: '28px', fontSize: '0.7rem', fontWeight: 'bold', fontFamily: "'Share Tech Mono', monospace" }}
      >
        S
      </button>
    </div>
  );
};
