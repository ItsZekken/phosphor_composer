import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { CustomSelect } from './CustomSelect';
import { Sliders, Music, Copy, ClipboardPaste, Check } from 'lucide-react';

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
          { value: 'piano', label: 'PIANO' },
          { value: 'synth', label: 'SYNTH' }
        ]}
        style={{ width: '92px', ...selectStyle }}
      />
      {currentInstrument === 'synth' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <button
            type="button"
            className="physical-btn"
            onClick={() => openSynthConfigForChannel(channelId)}
            title="Configurar sintetizador"
            style={{ height: '24px', padding: '0 7px' }}
          >
            <Sliders size={12} />
          </button>
          <button
            type="button"
            className={`physical-btn ${copied ? 'active' : ''}`}
            onClick={handleCopy}
            title={copied ? "¡Parche Copiado!" : "Copiar parche de sintetizador"}
            style={{ height: '24px', padding: '0 7px' }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            className="physical-btn"
            onClick={handlePaste}
            disabled={!synthClipboard}
            title={synthClipboard ? `Pegar parche: ${synthClipboard.presetName || 'Preset'}` : "Portapapeles de sintetizador vacío"}
            style={{ height: '24px', padding: '0 7px' }}
          >
            <ClipboardPaste size={12} />
          </button>
        </div>
      )}
    </div>
  );
};
