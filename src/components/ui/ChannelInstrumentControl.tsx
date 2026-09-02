import React from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { CustomSelect } from './CustomSelect';
import { Settings, Music } from 'lucide-react';

interface ChannelInstrumentControlProps {
  channelId: string;
  style?: React.CSSProperties;
  selectStyle?: React.CSSProperties;
}

export const ChannelInstrumentControl: React.FC<ChannelInstrumentControlProps> = ({
  channelId,
  style,
  selectStyle
}) => {
  const { channels, setChannelInstrument, openSynthConfigForChannel } = useSongStore(
    useShallow((state) => ({
      channels: state.channels,
      setChannelInstrument: state.setChannelInstrument,
      openSynthConfigForChannel: state.openSynthConfigForChannel
    }))
  );

  const channel = channels[channelId];
  const currentInstrument = channel?.instrument || 'piano';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', ...style }}>
      <Music size={14} color="var(--text-secondary)" />
      <CustomSelect
        value={currentInstrument}
        onChange={(val) => setChannelInstrument(channelId, val as 'piano' | 'synth')}
        options={[
          { value: 'piano', label: 'Piano de Cola' },
          { value: 'synth', label: 'Sintetizador' }
        ]}
        style={{ width: '142px', ...selectStyle }}
      />
      {currentInstrument === 'synth' && (
        <button
          className="control-btn"
          onClick={() => openSynthConfigForChannel(channelId)}
          title="Configurar Sintetizador"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '26px',
            background: 'rgba(168, 85, 247, 0.15)',
            border: '1px solid rgba(168, 85, 247, 0.4)',
            color: '#a855f7',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0
          }}
        >
          <Settings size={14} />
        </button>
      )}
    </div>
  );
};
