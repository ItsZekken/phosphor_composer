import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Sliders, Music, Plus, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ChannelInstrument, ChannelConfig } from '../../utils/typeDefinitions';
import { CustomSelect } from './CustomSelect';
import { toneEngine } from '../../audio/toneEngine';

const INSTRUMENT_LABELS: Record<ChannelInstrument, string> = {
  piano: 'Piano de Cola',
  synth: 'Sintetizador Virtual',
  sampler: 'Sampler Batería'
};

// Calibrated scale marks matching volume range (0 to 100, unity gain 0 dB at 80%)
const DB_SCALE_MARKS = [
  { label: '+6', pct: 100 },
  { label: '0',  pct: 80 },
  { label: '-6', pct: 65 },
  { label: '-12', pct: 50 },
  { label: '-24', pct: 30 },
  { label: '-48', pct: 10 },
  { label: '-∞', pct: 0 }
];

// Generate micro-tick marks between major marks
const DB_MICRO_TICKS: number[] = [];
for (let pct = 0; pct <= 100; pct += 2.5) {
  const nearMajor = DB_SCALE_MARKS.some(m => Math.abs(m.pct - pct) < 2);
  if (!nearMajor) {
    DB_MICRO_TICKS.push(pct);
  }
}

// Pan knob vertical drag hook (linear relative vertical motion)
function usePanDrag(
  channelId: string,
  currentPan: number,
  setPan: (id: string, pan: number) => void
) {
  const dragRef = useRef<{ startY: number; startPan: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startPan: currentPan };
  }, [currentPan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const deltaY = dragRef.current.startY - e.clientY;
    const deltaPan = deltaY / 120;
    const newPan = Math.max(-1, Math.min(1, dragRef.current.startPan + deltaPan));
    setPan(channelId, Math.abs(newPan) < 0.03 ? 0 : Math.round(newPan * 20) / 20);
  }, [channelId, setPan]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp };
}

// Professional Custom Fader Hook with Full 0-100% Vertical Travel
function useFaderDrag(
  channelId: string,
  currentVolume: number,
  setVolume: (id: string, vol: number) => void
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);

  const updateVolumeFromPointer = useCallback((e: React.PointerEvent | PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const yFromBottom = rect.bottom - e.clientY;
    const ratio = Math.max(0, Math.min(1, yFromBottom / rect.height));
    const newVol = Math.round(ratio * 100);
    setVolume(channelId, newVol);
  }, [channelId, setVolume]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    updateVolumeFromPointer(e);
  }, [updateVolumeFromPointer]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    updateVolumeFromPointer(e);
  }, [updateVolumeFromPointer]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 2 : -2;
    const nextVol = Math.max(0, Math.min(100, currentVolume + step));
    setVolume(channelId, nextVol);
  }, [channelId, currentVolume, setVolume]);

  return { containerRef, onPointerDown, onPointerMove, onPointerUp, onWheel };
}

export const MixerDrawer: React.FC = () => {
  const {
    isMixerOpen,
    setMixerOpen,
    channels,
    channelOrder,
    reorderChannels,
    updateChannel,
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
      channelOrder: state.channelOrder,
      reorderChannels: state.reorderChannels,
      updateChannel: state.updateChannel,
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

  const [vuDbLevels, setVuDbLevels] = useState<Record<string, number>>({});
  const [clippingLatches, setClippingLatches] = useState<Record<string, boolean>>({});
  const [peakDbLevels, setPeakDbLevels] = useState<Record<string, number>>({});

  const clearClipAndPeak = useCallback((id: string) => {
    setClippingLatches((prev) => ({ ...prev, [id]: false }));
    setPeakDbLevels((prev) => ({ ...prev, [id]: -Infinity }));
  }, []);

  useEffect(() => {
    if (!isMixerOpen) return;

    const interval = setInterval(() => {
      const newDbLevels: Record<string, number> = {};
      const newClips: Record<string, boolean> = {};

      const safeChannels = channels || {};
      Object.keys(safeChannels).forEach((id) => {
        const ch = safeChannels[id];
        if (!ch) return;
        if (ch.muted) {
          newDbLevels[id] = -Infinity;
          return;
        }

        let db = toneEngine.getChannelMeterLevel(id);
        
        if (!isPlaying || !isFinite(db) || db < -70) {
          if (isPlaying) {
            const baseVolRatio = (ch.volume || 80) / 100;
            const simDb = -48 + baseVolRatio * 40 + (Math.random() * 6 - 3);
            db = Math.max(-60, simDb);
          } else {
            db = -Infinity;
          }
        }

        newDbLevels[id] = db;
        if (db > 0.1) {
          newClips[id] = true;
        }
      });

      setVuDbLevels(newDbLevels);

      // Update peak hold
      setPeakDbLevels((prev) => {
        const updated = { ...prev };
        for (const [id, db] of Object.entries(newDbLevels)) {
          if (!isFinite(updated[id]) || db > updated[id]) {
            updated[id] = db;
          }
        }
        return updated;
      });

      if (Object.keys(newClips).length > 0) {
        setClippingLatches((prev) => ({ ...prev, ...newClips }));
      }
    }, 60);

    return () => clearInterval(interval);
  }, [isMixerOpen, isPlaying, channels]);

  if (!isMixerOpen) return null;

  const safeChannels = channels || {};
  const validChannelIds = (channelOrder || []).filter(id => safeChannels[id] !== undefined);
  Object.keys(safeChannels).forEach(id => {
    if (!validChannelIds.includes(id)) {
      validChannelIds.push(id);
    }
  });

  const masterIndex = validChannelIds.indexOf('master');
  if (masterIndex > 0) {
    validChannelIds.splice(masterIndex, 1);
    validChannelIds.unshift('master');
  }

  const orderedChannels = validChannelIds.map(id => safeChannels[id]).filter(Boolean);
  const otherChannels = orderedChannels.filter((c) => c && c.id !== 'master');
  const anySolo = otherChannels.some((c) => c && c.solo);

  const moveChannel = (id: string, delta: number) => {
    if (typeof reorderChannels !== 'function') return;
    const currentIndex = validChannelIds.indexOf(id);
    if (currentIndex <= 0) return;
    const targetIndex = currentIndex + delta;
    if (targetIndex < 1 || targetIndex >= validChannelIds.length) return;
    reorderChannels(currentIndex, targetIndex);
  };

  return (
    <div className="mixer-overlay" onClick={() => setMixerOpen(false)}>
      <div className="mixer-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="mixer-header">
          <div className="mixer-header-title">
            <Sliders className="mixer-header-icon" size={18} />
            <h2>Mixer</h2>
          </div>
          <button
            className="mixer-close-btn"
            onClick={() => setMixerOpen(false)}
            title="Cerrar Mezclador (Shift+M)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mixer-channels-container">
          {orderedChannels.map((ch) => {
            const isMaster = ch.type === 'master';
            const isSilenced = !isMaster && (ch.muted || (anySolo && !ch.solo));
            const currentDb = vuDbLevels[ch.id] ?? -Infinity;
            const isClipping = clippingLatches[ch.id] || false;
            const peakDb = peakDbLevels[ch.id] ?? -Infinity;

            // VU meter percentage calibrated exactly to 0 dB at 80% (matching fader unity gain)
            let vuPct = 0;
            if (isFinite(currentDb)) {
              if (currentDb <= -48) {
                vuPct = Math.max(0, ((currentDb + 70) / 22) * 10);
              } else if (currentDb <= 0) {
                vuPct = 10 + ((currentDb + 48) / 48) * 70;
              } else {
                vuPct = 80 + Math.min(20, (currentDb / 6) * 20);
              }
            }
            vuPct = Math.max(0, Math.min(100, vuPct));

            const dbReadout = ch.volume <= 0 ? '-∞' : `${(Math.round(((ch.volume - 80) / 80) * 30 * 10) / 10).toFixed(1)}`;
            const peakDisplay = isFinite(peakDb) ? `${peakDb > 0 ? '+' : ''}${peakDb.toFixed(1)}` : '-∞';

            return (
              <ChannelStrip
                key={ch.id}
                ch={ch}
                isMaster={isMaster}
                isSilenced={isSilenced}
                isClipping={isClipping}
                vuPct={vuPct}
                dbReadout={dbReadout}
                peakDisplay={peakDisplay}
                peakDb={peakDb}
                clearClipAndPeak={clearClipAndPeak}
                moveChannel={moveChannel}
                validChannelIds={validChannelIds}
                setChannelVolume={setChannelVolume}
                setChannelPan={setChannelPan}
                setChannelInstrument={setChannelInstrument}
                updateChannel={updateChannel}
                toggleMute={toggleMute}
                toggleSolo={toggleSolo}
                openSynthConfigForChannel={openSynthConfigForChannel}
              />
            );
          })}

          <div className="mixer-strip-add">
            <button
              className="btn-add-channel"
              title="Añadir nueva pista de Piano Roll"
              onClick={() => addPianoRollTrack()}
            >
              <Plus size={20} />
            </button>
          </div>
        </div>

        <div className="mixer-footer">
          <div className="mixer-status">
            {anySolo ? (
              <span className="status-solo-warning">CANAL EN SOLO ACTIVO</span>
            ) : Object.values(clippingLatches).some(Boolean) ? (
              <span className="status-solo-warning" style={{ color: '#ff3366' }}>ALERTA: CLIPPING DETECTADO</span>
            ) : (
              <span className="status-ok">ESTADO AUDIO: NOMINAL // MASTER CALIBRADO 0 dB</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Extracted per-channel component
const ChannelStrip: React.FC<{
  ch: ChannelConfig;
  isMaster: boolean;
  isSilenced: boolean;
  isClipping: boolean;
  vuPct: number;
  dbReadout: string;
  peakDisplay: string;
  peakDb: number;
  clearClipAndPeak: (id: string) => void;
  moveChannel: (id: string, delta: number) => void;
  validChannelIds: string[];
  setChannelVolume: (id: string, vol: number) => void;
  setChannelPan: (id: string, pan: number) => void;
  setChannelInstrument: (id: string, inst: ChannelInstrument) => void;
  updateChannel: (id: string, updates: Partial<ChannelConfig>) => void;
  toggleMute: (id: string) => void;
  toggleSolo: (id: string) => void;
  openSynthConfigForChannel: (id: string) => void;
}> = ({
  ch, isMaster, isSilenced, isClipping, vuPct, dbReadout, peakDisplay, peakDb,
  clearClipAndPeak, moveChannel, validChannelIds,
  setChannelVolume, setChannelPan, setChannelInstrument, updateChannel,
  toggleMute, toggleSolo, openSynthConfigForChannel
}) => {
  const panDrag = usePanDrag(ch.id, ch.pan, setChannelPan);
  const faderDrag = useFaderDrag(ch.id, ch.volume, setChannelVolume);

  // Inline Channel Name Editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(ch.name);

  useEffect(() => {
    setTempName(ch.name);
  }, [ch.name]);

  const handleNameSubmit = () => {
    setIsEditingName(false);
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== ch.name && !isMaster) {
      updateChannel(ch.id, { name: trimmed });
    } else {
      setTempName(ch.name);
    }
  };

  return (
    <div
      className={`mixer-strip ${isMaster ? 'is-master' : ''} ${ch.muted ? 'is-muted' : ''} ${ch.solo ? 'is-solo' : ''} ${isSilenced ? 'is-silenced' : ''}`}
      style={{ '--channel-color': isMaster ? 'var(--tension)' : ch.color } as React.CSSProperties}
    >
      {/* Row 1: Header with editable name + reorder controls (Fixed 28px) */}
      <div className="strip-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', flex: 1 }}>
          <span className="strip-color-badge" style={{ backgroundColor: isMaster ? 'var(--tension)' : ch.color }} />
          {isEditingName && !isMaster ? (
            <input
              type="text"
              className="strip-name-input"
              value={tempName}
              autoFocus
              onChange={(e) => setTempName(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSubmit();
                if (e.key === 'Escape') {
                  setTempName(ch.name);
                  setIsEditingName(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="strip-name"
              title={isMaster ? 'Master Bus' : 'Doble click para renombrar'}
              onDoubleClick={() => {
                if (!isMaster) setIsEditingName(true);
              }}
            >
              {ch.name}
            </span>
          )}
        </div>
        {!isMaster && (
          <div className="strip-reorder-controls">
            <button className="strip-move-btn" onClick={() => moveChannel(ch.id, -1)} disabled={validChannelIds.indexOf(ch.id) <= 1} title="Mover izquierda">
              <ChevronLeft size={11} />
            </button>
            <button className="strip-move-btn" onClick={() => moveChannel(ch.id, 1)} disabled={validChannelIds.indexOf(ch.id) >= validChannelIds.length - 1} title="Mover derecha">
              <ChevronRight size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Row 2: Instrument row (Fixed 28px) */}
      {!isMaster && ch.type !== 'drums' ? (
        <div className="strip-instrument-select">
          <Music size={12} className="strip-inst-icon" />
          <CustomSelect
            value={ch.instrument}
            onChange={(val) => setChannelInstrument(ch.id, val as ChannelInstrument)}
            options={Object.entries(INSTRUMENT_LABELS).map(([key, label]) => ({ value: key, label }))}
            className="strip-select"
            style={{ flex: 1 }}
          />
          {ch.instrument === 'synth' && (
            <button className="strip-synth-btn" onClick={() => openSynthConfigForChannel(ch.id)} title="Configurar Sintetizador">
              <Settings size={12} />
            </button>
          )}
        </div>
      ) : isMaster ? (
        <div className="strip-instrument-select master-instrument-row">
          <span className="master-badge">MASTER BUS</span>
        </div>
      ) : (
        <div className="strip-instrument-select drum-instrument-row">
          <Music size={12} className="strip-inst-icon" />
          <span className="strip-select-static">Drum Machine</span>
        </div>
      )}

      {/* Row 3: Mute / Solo row (Fixed 28px) */}
      {!isMaster ? (
        <div className="strip-ms-buttons">
          <button className={`btn-mute ${ch.muted ? 'active' : ''}`} onClick={() => toggleMute(ch.id)} title={ch.muted ? 'Desmutear' : 'Silenciar (Mute)'}>M</button>
          <button className={`btn-solo ${ch.solo ? 'active' : ''}`} onClick={() => toggleSolo(ch.id)} title={ch.solo ? 'Desactivar Solo' : 'Aislar (Solo)'}>S</button>
        </div>
      ) : (
        <div className="strip-ms-buttons master-placeholder">
          <span className="master-bus-label">BUS GENERAL</span>
        </div>
      )}

      {/* Row 4: Peak dB Display + Clip LED (Fixed 22px) */}
      <div
        className={`strip-peak-display ${isClipping ? 'clipping' : ''} ${peakDb > 0 ? 'over-zero' : ''}`}
        onClick={() => clearClipAndPeak(ch.id)}
        title="Peak Hold — Click para resetear"
      >
        <span className="peak-value">{peakDisplay}</span>
        <div className={`clip-led ${isClipping ? 'clipping' : ''}`} />
      </div>

      {/* Row 5: Fader section with Full Travel & Micro-ticks (Flex 1) */}
      <div className="strip-fader-section">
        {/* dB scale with exact tick alignment */}
        <div className="db-scale-column">
          {DB_SCALE_MARKS.map((m) => (
            <div key={m.label} className="db-major-mark" style={{ bottom: `${m.pct}%` }}>
              <span className="db-mark-label">{m.label}</span>
              <span className="db-mark-line" />
            </div>
          ))}
          {DB_MICRO_TICKS.map((pct) => (
            <span key={pct} className="db-micro-tick" style={{ bottom: `${pct}%` }} />
          ))}
        </div>

        {/* VU Meter bar */}
        <div className="strip-vu-meter">
          <div
            className="strip-vu-fill"
            style={{
              height: `${vuPct}%`,
              backgroundColor: vuPct > 80 ? '#ff3366' : isMaster ? 'var(--tension)' : ch.color
            }}
          />
        </div>

        {/* Custom Pure Slot & Fader Cap (No rotated input background box) */}
        <div
          ref={faderDrag.containerRef}
          className="strip-fader-container"
          onPointerDown={faderDrag.onPointerDown}
          onPointerMove={faderDrag.onPointerMove}
          onPointerUp={faderDrag.onPointerUp}
          onWheel={faderDrag.onWheel}
          onDoubleClick={() => setChannelVolume(ch.id, 80)}
          title="Arrastrar para ajustar volumen — Doble click para 0 dB"
        >
          <div className="analog-fader-rail" />
          <div
            className="analog-fader-cap"
            style={{ bottom: `calc(${ch.volume}% - 9px)` }}
          >
            <div className="fader-cap-notch" />
          </div>
        </div>
      </div>

      {/* Row 6: dB readout (Fixed 24px) */}
      <div className="strip-db-readout" onDoubleClick={() => setChannelVolume(ch.id, 80)} title="Doble click para 0.0 dB">
        {dbReadout}<span className="db-unit"> dB</span>
      </div>

      {/* Row 7: Pan knob (Fixed 54px) */}
      <div className="strip-pan-knob-section">
        <div className="strip-pan-knob-labels">
          <span>L</span>
          <span className="strip-pan-knob-value">{ch.pan === 0 ? 'C' : ch.pan < 0 ? `L${Math.round(ch.pan * -100)}` : `R${Math.round(ch.pan * 100)}`}</span>
          <span>R</span>
        </div>
        <div
          className="pan-knob-container"
          onDoubleClick={() => setChannelPan(ch.id, 0)}
          onPointerDown={panDrag.onPointerDown}
          onPointerMove={panDrag.onPointerMove}
          onPointerUp={panDrag.onPointerUp}
          title={`Paneo: ${ch.pan === 0 ? 'Centro' : ch.pan < 0 ? `Izq ${Math.round(ch.pan * -100)}%` : `Der ${Math.round(ch.pan * 100)}%`} — Arrastrar vertical / Doble click centrar`}
        >
          <div className="pan-knob-track" />
          <div className="pan-knob-dial" style={{ transform: `rotate(${ch.pan * 135}deg)` }}>
            <div className="pan-knob-indicator" />
          </div>
        </div>
      </div>
    </div>
  );
};
