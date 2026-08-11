import React, { useEffect, useState, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Sliders, Music, Plus, Settings } from 'lucide-react';
import type { ChannelInstrument } from '../../utils/typeDefinitions';
import { CustomSelect } from './CustomSelect';
import { toneEngine } from '../../audio/toneEngine';

const INSTRUMENT_LABELS: Record<ChannelInstrument, string> = {
  piano: 'Piano de Cola',
  synth: 'Sintetizador Virtual',
  sampler: 'Sampler Batería'
};

const DB_SCALE_MARKS = [
  { label: '+6', pct: 100 },
  { label: '0',  pct: 80 },
  { label: '-6', pct: 65 },
  { label: '-12', pct: 50 },
  { label: '-24', pct: 30 },
  { label: '-48', pct: 10 },
  { label: '-inf', pct: 0 }
];

export const MixerDrawer: React.FC = () => {
  const {
    isMixerOpen,
    setMixerOpen,
    channels,
    toggleMute,
    toggleSolo,
    setChannelVolume,
    setChannelPan,
    setChannelInstrument,
    addPianoRollTrack,
    openSynthConfigForChannel,
    isPlaying
  } = useSongStore(
    useShallow((state) => ({
      isMixerOpen: state.isMixerOpen,
      setMixerOpen: state.setMixerOpen,
      channels: state.channels,
      toggleMute: state.toggleMute,
      toggleSolo: state.toggleSolo,
      setChannelVolume: state.setChannelVolume,
      setChannelPan: state.setChannelPan,
      setChannelInstrument: state.setChannelInstrument,
      addPianoRollTrack: state.addPianoRollTrack,
      openSynthConfigForChannel: state.openSynthConfigForChannel,
      isPlaying: state.isPlaying
    }))
  );

  // Niveles de VU en dB y estados de Clipping enganchado (clip latch)
  const [vuDbLevels, setVuDbLevels] = useState<Record<string, number>>({});
  const [clippingLatches, setClippingLatches] = useState<Record<string, boolean>>({});

  const clearClipping = useCallback((id: string) => {
    setClippingLatches((prev) => ({ ...prev, [id]: false }));
  }, []);

  useEffect(() => {
    if (!isMixerOpen) return;

    const interval = setInterval(() => {
      const newDbLevels: Record<string, number> = {};
      const newClips: Record<string, boolean> = {};

      Object.keys(channels).forEach((id) => {
        const ch = channels[id];
        if (ch.muted) {
          newDbLevels[id] = -Infinity;
          return;
        }

        let db = toneEngine.getChannelMeterLevel(id);
        
        // Si no está sonando nada o ToneEngine devuelve -Infinity, simular sutil piso de ruido si isPlaying
        if (!isPlaying || !isFinite(db) || db < -70) {
          if (isPlaying) {
            // Fluctuación dinámica vinculada al volumen
            const baseVolRatio = ch.volume / 100;
            const simDb = -48 + baseVolRatio * 40 + (Math.random() * 6 - 3);
            db = Math.max(-60, simDb);
          } else {
            db = -Infinity;
          }
        }

        newDbLevels[id] = db;

        // Detección de clipping (> 0 dB) con retención (latch)
        if (db > 0.1) {
          newClips[id] = true;
        }
      });

      setVuDbLevels(newDbLevels);
      if (Object.keys(newClips).length > 0) {
        setClippingLatches((prev) => ({ ...prev, ...newClips }));
      }
    }, 60);

    return () => clearInterval(interval);
  }, [isMixerOpen, isPlaying, channels]);

  if (!isMixerOpen) return null;

  // Organizar canales: MASTER a la extrema izquierda, luego los demás
  const masterChannel = channels['master'] || {
    id: 'master',
    name: 'MASTER',
    type: 'master',
    instrument: 'synth' as ChannelInstrument,
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
    color: '#ffaa00'
  };

  const otherChannels = Object.values(channels).filter((c) => c.id !== 'master');
  const orderedChannels = [masterChannel, ...otherChannels];
  const anySolo = otherChannels.some((c) => c.solo);

  return (
    <div className="mixer-overlay" onClick={() => setMixerOpen(false)}>
      <div className="mixer-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Cabecera del Mezclador */}
        <div className="mixer-header">
          <div className="mixer-header-title">
            <Sliders className="mixer-header-icon" size={20} />
            <h2>MEZCLADOR CONSOLA MULTICANAL</h2>
            <span className="mixer-subtitle">ANALÓGICO VCF // METRIC PRO dB</span>
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
          {orderedChannels.map((ch) => {
            const isMaster = ch.type === 'master';
            const isSilenced = !isMaster && (ch.muted || (anySolo && !ch.solo));
            const currentDb = vuDbLevels[ch.id] ?? -Infinity;
            const isClipping = clippingLatches[ch.id] || false;

            // Calcular porcentaje del VU Meter según la escala calibrada (-48dB a +6dB)
            let vuPct = 0;
            if (isFinite(currentDb)) {
              if (currentDb <= -48) {
                vuPct = Math.max(0, ((currentDb + 70) / 22) * 10);
              } else {
                vuPct = 10 + ((currentDb + 48) / 54) * 90;
              }
            }
            vuPct = Math.max(0, Math.min(100, vuPct));

            const dbReadout = ch.volume <= 0 ? '-∞ dB' : `${(Math.round(((ch.volume - 80) / 80) * 30 * 10) / 10).toFixed(1)} dB`;

            return (
              <div
                key={ch.id}
                className={`mixer-strip ${isMaster ? 'is-master' : ''} ${ch.muted ? 'is-muted' : ''} ${ch.solo ? 'is-solo' : ''} ${isSilenced ? 'is-silenced' : ''}`}
                style={{ '--channel-color': isMaster ? '#ffaa00' : ch.color } as React.CSSProperties}
              >
                {/* Indicador de Clipping Enganchado (LED Neón Rojo) */}
                <div
                  className={`clip-indicator-led ${isClipping ? 'active-clipping' : ''}`}
                  onClick={() => clearClipping(ch.id)}
                  title={isClipping ? '¡ALERTA DE CLIPPING! Clic para limpiar indicador' : 'Indicador de Recorte (0 dB Peak)'}
                >
                  <span className="clip-label">CLIP</span>
                </div>

                {/* Encabezado del Canal */}
                <div className="strip-header">
                  <span className="strip-color-badge" style={{ backgroundColor: isMaster ? '#ffaa00' : ch.color }} />
                  <span className="strip-name">{ch.name}</span>
                </div>

                {/* Seleccionador de Instrumento / Botón de Sintetizador */}
                {!isMaster && ch.type !== 'drums' ? (
                  <div className="strip-instrument-select" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Music size={12} className="strip-inst-icon" />
                    <CustomSelect
                      value={ch.instrument}
                      onChange={(val) => setChannelInstrument(ch.id, val as ChannelInstrument)}
                      options={Object.entries(INSTRUMENT_LABELS).map(([key, label]) => ({
                        value: key,
                        label
                      }))}
                      className="strip-select"
                      style={{ flex: 1 }}
                    />
                    {ch.instrument === 'synth' && (
                      <button
                        className="strip-synth-btn"
                        onClick={() => openSynthConfigForChannel(ch.id)}
                        title="Configurar Sintetizador de este canal"
                      >
                        <Settings size={12} />
                      </button>
                    )}
                  </div>
                ) : isMaster ? (
                  <div className="strip-instrument-select">
                    <span className="strip-select master-badge">MASTER BUS</span>
                  </div>
                ) : (
                  <div className="strip-instrument-select">
                    <Music size={12} className="strip-inst-icon" />
                    <span className="strip-select" style={{ display: 'inline-block', lineHeight: '24px', opacity: 0.7 }}>Drum Machine</span>
                  </div>
                )}

                {/* Botones Mute y Solo (Deshabilitados para Master) */}
                {!isMaster ? (
                  <div className="strip-ms-buttons">
                    <button
                      className={`btn-mute ${ch.muted ? 'active' : ''}`}
                      onClick={() => toggleMute(ch.id)}
                      title={ch.muted ? 'Desmutear' : 'Silenciar canal (Mute)'}
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
                ) : (
                  <div className="strip-ms-buttons master-placeholder">
                    <span className="master-bus-label">BUS GENERAL</span>
                  </div>
                )}

                {/* Sección Fader Analógico + Vúmetro dB Metering */}
                <div className="strip-fader-section">
                  {/* Marcas de Decibelios */}
                  <div className="db-scale-marks">
                    {DB_SCALE_MARKS.map((m) => (
                      <span key={m.label} style={{ bottom: `${m.pct}%` }} className="db-mark-label">
                        {m.label}
                      </span>
                    ))}
                  </div>

                  {/* Barra Vúmetro (VU Meter) */}
                  <div className="strip-vu-meter">
                    <div
                      className="strip-vu-fill"
                      style={{
                        height: `${vuPct}%`,
                        backgroundColor: vuPct > 80 ? '#ff3366' : isMaster ? '#ffaa00' : ch.color
                      }}
                    />
                  </div>

                  {/* Riel & Fader Analógico con Perilla Táctil */}
                  <div className="strip-fader-container">
                    <div className="analog-fader-rail" />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={ch.volume}
                      onDoubleClick={() => setChannelVolume(ch.id, 80)}
                      onChange={(e) => setChannelVolume(ch.id, Number(e.target.value))}
                      className="strip-fader-input analog-fader"
                      title="Doble click en la perilla para resetear a 0 dB"
                    />
                  </div>
                </div>

                {/* Lectura de dB */}
                <div className="strip-db-readout" onDoubleClick={() => setChannelVolume(ch.id, 80)}>
                  {dbReadout}
                </div>

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

          {/* Botón para Añadir Nuevo Canal / Pista Piano Roll */}
          <div className="mixer-strip-add">
            <button
              className="btn-add-channel"
              title="Añadir nueva pista de Piano Roll con canal en el mezclador"
              onClick={() => addPianoRollTrack()}
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
            ) : Object.values(clippingLatches).some(Boolean) ? (
              <span className="status-solo-warning" style={{ color: '#ff3366' }}>⚠️ ALERTA: RECORTE / CLIPPING DETECTADO</span>
            ) : (
              <span className="status-ok">ESTADO AUDIO: NOMINAL // MASTER CALIBRADO 0 dB</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
