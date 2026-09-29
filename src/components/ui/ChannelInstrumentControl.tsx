import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { CustomSelect } from './CustomSelect';
import { Settings, Music, Copy, ClipboardPaste, Check } from 'lucide-react';

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
  const {
    channels,
    setChannelInstrument,
    openSynthConfigForChannel,
    copySynthSettings,
    pasteSynthSettings,
    synthClipboard
  } = useSongStore(
    useShallow((state) => ({
      channels: state.channels,
      setChannelInstrument: state.setChannelInstrument,
      openSynthConfigForChannel: state.openSynthConfigForChannel,
      copySynthSettings: state.copySynthSettings,
      pasteSynthSettings: state.pasteSynthSettings,
      synthClipboard: state.synthClipboard
    }))
  );

  const [copied, setCopied] = useState(false);
  const channel = channels[channelId];
  const currentInstrument = channel?.instrument || 'piano';

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    copySynthSettings(channelId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handlePaste = (e: React.MouseEvent) => {
    e.stopPropagation();
    pasteSynthSettings(channelId);
  };

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
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
          <button
            className="control-btn"
            onClick={handleCopy}
            title={copied ? "¡Parche Copiado!" : "Copiar parche de sintetizador"}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '26px',
              height: '26px',
              background: copied ? 'rgba(56, 189, 248, 0.35)' : 'rgba(56, 189, 248, 0.12)',
              border: `1px solid ${copied ? '#38bdf8' : 'rgba(56, 189, 248, 0.35)'}`,
              color: copied ? '#fff' : '#38bdf8',
              borderRadius: '4px',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              transition: 'all 0.15s ease'
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button
            className="control-btn"
            onClick={handlePaste}
            disabled={!synthClipboard}
            title={synthClipboard ? `Pegar parche: ${synthClipboard.presetName || 'Preset'}` : "Portapapeles de sintetizador vacío"}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '26px',
              height: '26px',
              background: synthClipboard ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${synthClipboard ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255, 255, 255, 0.1)'}`,
              color: synthClipboard ? '#10b981' : 'rgba(255, 255, 255, 0.25)',
              borderRadius: '4px',
              cursor: synthClipboard ? 'pointer' : 'not-allowed',
              padding: 0,
              flexShrink: 0,
              opacity: synthClipboard ? 1 : 0.45,
              transition: 'all 0.15s ease'
            }}
          >
            <ClipboardPaste size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
