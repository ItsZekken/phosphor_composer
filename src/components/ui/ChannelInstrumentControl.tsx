import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { CustomSelect } from './CustomSelect';
import { Sliders, Music, Copy, ClipboardPaste, Check, HardDrive } from 'lucide-react';
import type { ChannelInstrument } from '../../utils/typeDefinitions';

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
    openSoundFontConfigForChannel,
    copySynthSettings,
    pasteSynthSettings,
    synthClipboard,
    copySoundFontConfig,
    pasteSoundFontConfig,
    soundfontClipboard
  } = useSongStore(
    useShallow((state) => ({
      channels: state.channels,
      setChannelInstrument: state.setChannelInstrument,
      openSynthConfigForChannel: state.openSynthConfigForChannel,
      openSoundFontConfigForChannel: state.openSoundFontConfigForChannel,
      copySynthSettings: state.copySynthSettings,
      pasteSynthSettings: state.pasteSynthSettings,
      synthClipboard: state.synthClipboard,
      copySoundFontConfig: state.copySoundFontConfig,
      pasteSoundFontConfig: state.pasteSoundFontConfig,
      soundfontClipboard: state.soundfontClipboard
    }))
  );

  const [copied, setCopied] = useState(false);
  const channel = channels[channelId];
  const currentInstrument = channel?.instrument || 'piano';
  const sfConfig = channel?.soundfontConfig;

  const handleInstrumentChange = (val: string) => {
    const nextInst = val as ChannelInstrument;
    setChannelInstrument(channelId, nextInst);
    if (nextInst === 'soundfont') {
      // Si el canal todavía no tiene SoundFont asignado (o no hay SoundFonts cargados), abrir el selector automáticamente
      const updatedChannel = useSongStore.getState().channels[channelId];
      if (!updatedChannel?.soundfontConfig?.soundfontId) {
        openSoundFontConfigForChannel(channelId);
      }
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentInstrument === 'soundfont') {
      copySoundFontConfig(channelId);
    } else {
      copySynthSettings(channelId);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handlePaste = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentInstrument === 'soundfont') {
      pasteSoundFontConfig(channelId);
    } else {
      pasteSynthSettings(channelId);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', ...style }}>
      <Music size={14} color="var(--text-secondary)" />
      <CustomSelect
        value={currentInstrument}
        onChange={handleInstrumentChange}
        options={[
          { value: 'piano', label: 'PIANO' },
          { value: 'synth', label: 'SYNTH' },
          { value: 'soundfont', label: 'SOUNDFONT' }
        ]}
        style={{ width: '104px', ...selectStyle }}
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
      {currentInstrument === 'soundfont' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <button
            type="button"
            className={`physical-btn sf-toolbar-patch-btn ${!sfConfig?.soundfontId ? 'needs-sf' : ''}`}
            onClick={() => openSoundFontConfigForChannel(channelId)}
            title={
              sfConfig?.patchName
                ? `SoundFont Patch: ${String(sfConfig.bank).padStart(3, '0')}:${String(sfConfig.program).padStart(3, '0')} ${sfConfig.patchName} (Clic para cambiar o subir SoundFont)`
                : 'Subir SoundFont (.sf2 / .sf3 / WebAudioFont) y seleccionar patch'
            }
            style={{ height: '24px', padding: '0 7px', gap: '5px', maxWidth: '126px' }}
          >
            <HardDrive size={11} style={{ flexShrink: 0, color: sfConfig?.soundfontId ? '#5fab82' : '#ffd875' }} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.66rem',
                fontFamily: "'Share Tech Mono', monospace"
              }}
            >
              {sfConfig?.patchName || 'Cargar SF2...'}
            </span>
          </button>
          <button
            type="button"
            className={`physical-btn ${copied ? 'active' : ''}`}
            onClick={handleCopy}
            disabled={!sfConfig?.soundfontId}
            title={copied ? '¡Patch SoundFont copiado!' : 'Copiar patch SoundFont'}
            style={{ height: '24px', padding: '0 7px' }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            className="physical-btn"
            onClick={handlePaste}
            disabled={!soundfontClipboard}
            title={
              soundfontClipboard
                ? `Pegar patch SoundFont: ${soundfontClipboard.patchName || 'Patch'}`
                : 'Portapapeles de SoundFont vacío'
            }
            style={{ height: '24px', padding: '0 7px' }}
          >
            <ClipboardPaste size={12} />
          </button>
        </div>
      )}
    </div>
  );
};
