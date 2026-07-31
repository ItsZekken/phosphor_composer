import React, { useEffect, useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Sliders, Volume2, VolumeX, Radio, Music, Plus, RotateCcw } from 'lucide-react';
import type { ChannelConfig, ChannelInstrument } from '../../utils/typeDefinitions';

const INSTRUMENT_LABELS: Record<ChannelInstrument, string> = {
  piano: 'Piano de Cola',
  synth: 'Sintetizador Virtual'
};


export const MixerDrawer: React.FC = () => {
  const {
    isMixerOpen,
    setMixerOpen,
    channels,
    updateChannel,
    toggleMute,
    toggleSolo,
    setChannelVolume,
    setChannelPan,
    setChannelInstrument,
    isPlaying
  } = useSongStore(
    useShallow((state) => ({
      isMixerOpen: state.isMixerOpen,
      setMixerOpen: state.setMixerOpen,
      channels: state.channels,
      updateChannel: state.updateChannel,
      toggleMute: state.toggleMute,
      toggleSolo: state.toggleSolo,
      setChannelVolume: state.setChannelVolume,
      setChannelPan: state.setChannelPan,
      setChannelInstrument: state.setChannelInstrument,
      isPlaying: state.isPlaying
    }))
  );

  // Animación del VU Meter simulado durante reproducción
  const [vuLevels, setVuLevels] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isPlaying) {
      setVuLevels({});
      return;
    }
    const interval = setInterval(() => {
      const newLevels: Record<string, number> = {};
      Object.keys(channels).forEach((id) => {
        const ch = channels[id];
        if (ch.muted) {
          newLevels[id] = 0;
        } else {
          // Generar nivel dinámico con fluctuación realista basada en el volumen
          const base = (ch.volume / 100) * 0.8;
          const jitter = (Math.random() * 0.35 - 0.175) * base;
          newLevels[id] = Math.max(0, Math.min(1, base + jitter));
        }
      });
      setVuLevels(newLevels);
    }, 80);

    return () => clearInterval(interval);
  }, [isPlaying, channels]);

  if (!isMixerOpen) return null;

  const channelList: ChannelConfig[] = Object.values(channels);
  const anySolo = channelList.some((c) => c.solo);

  return (
    <div className="mixer-overlay" onClick={() => setMixerOpen(false)}>
      <div className="mixer-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Cabecera del Mezclador */}
        <div className="mixer-header">
          <div className="mixer-header-title">
            <Sliders className="mixer-header-icon" size={20} />
            <h2>MEZCLADOR MULTICANAL</h2>
          </div>
          <button
            className="mixer-close-btn"
            onClick={() => setMixerOpen(false)}
            title="Cerrar Mezclador (Shift+M)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Canales de Audio */}
        <div className="mixer-channels-container">
          {channelList.map((ch) => {
            const isSilenced = ch.muted || (anySolo && !ch.solo);
            const level = vuLevels[ch.id] || 0;
            const dbVal = ch.volume <= 0 ? '-∞' : `${Math.round(((ch.volume - 80) / 80) * 30)} dB`;

            return (
              <div
                key={ch.id}
                className={`mixer-strip ${ch.muted ? 'is-muted' : ''} ${ch.solo ? 'is-solo' : ''} ${isSilenced ? 'is-silenced' : ''}`}
                style={{ '--channel-color': ch.color } as React.CSSProperties}
              >
                {/* Nombre de canal e indicador visual */}
                <div className="strip-header">
                  <span className="strip-color-badge" style={{ backgroundColor: ch.color }} />
                  <span className="strip-name">{ch.name}</span>
                </div>

                {/* Seleccionador de Instrumento */}
                <div className="strip-instrument-select">
                  <Music size={12} className="strip-inst-icon" />
                  <select
                    value={ch.instrument}
                    onChange={(e) => setChannelInstrument(ch.id, e.target.value as ChannelInstrument)}
                    className="strip-select"
                  >
                    {Object.entries(INSTRUMENT_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Botones Mute y Solo */}
                <div className="strip-ms-buttons">
                  <button
                    className={`btn-mute ${ch.muted ? 'active' : ''}`}
                    onClick={() => toggleMute(ch.id)}
                    title={ch.muted ? 'Desmutear' : 'Silenciar canal'}
                  >
                    M
                  </button>
                  <button
                    className={`btn-solo ${ch.solo ? 'active' : ''}`}
                    onClick={() => toggleSolo(ch.id)}
                    title={ch.solo ? 'Desactivar Solo' : 'Aislar canal (Solo)'}
                  >
                    S
                  </button>
                </div>

                {/* VU Meter & Fader de Volumen */}
                <div className="strip-fader-section">
                  <div className="strip-vu-meter">
                    <div
                      className="strip-vu-fill"
                      style={{
                        height: `${Math.min(100, level * 100)}%`,
                        backgroundColor: level > 0.85 ? '#ff3366' : ch.color
                      }}
                    />
                  </div>
                  <div className="strip-fader-container">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={ch.volume}
                      onChange={(e) => setChannelVolume(ch.id, Number(e.target.value))}
                      className="strip-fader-input"
                    />
                  </div>
                </div>

                {/* Valor de dB */}
                <div className="strip-db-readout">{dbVal}</div>

                {/* Paneo L/R — Perilla Rotativa */}
                <div className="strip-pan-knob-section">
                  <div className="strip-pan-knob-labels">
                    <span>L</span>
                    <span className="strip-pan-knob-value">{ch.pan === 0 ? 'C' : ch.pan < 0 ? `L${Math.round(ch.pan * -100)}` : `R${Math.round(ch.pan * 100)}`}</span>
                    <span>R</span>
                  </div>
                  <div
                    className="pan-knob-container"
                    onDoubleClick={() => setChannelPan(ch.id, 0)}
                    title={`Paneo: ${ch.pan === 0 ? 'Centro' : ch.pan < 0 ? `Izq ${Math.round(ch.pan * -100)}%` : `Der ${Math.round(ch.pan * 100)}%`} — Doble click para centrar`}
                  >
                    <div className="pan-knob-track" />
                    <div
                      className="pan-knob-dial"
                      style={{ transform: `rotate(${ch.pan * 135}deg)` }}
                    >
                      <div className="pan-knob-indicator" />
                    </div>
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.05"
                      value={ch.pan}
                      onChange={(e) => setChannelPan(ch.id, parseFloat(e.target.value))}
                      className="pan-knob-hidden-input"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Placeholder escalable para agregar nuevos canales (futuro Secuenciador/Drums) */}
          <div className="mixer-strip-add">
            <button
              className="btn-add-channel"
              title="Próximamente: Añadir pista de Percusión o Bajo"
              onClick={() => alert('¡Arquitectura lista! En una próxima actualización podrás agregar secuenciador de percusión y bajo.')}
            >
              <Plus size={24} />
              <span>Nuevo Canal</span>
            </button>
          </div>
        </div>

        {/* Footer / Status */}
        <div className="mixer-footer">
          <div className="mixer-status">
            {anySolo ? (
              <span className="status-solo-warning">⚠️ CANAL EN SOLO ACTIVO</span>
            ) : (
              <span className="status-ok">ESTADO AUDIO: NOMINAL</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
