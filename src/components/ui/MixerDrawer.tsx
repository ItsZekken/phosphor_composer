import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import {
  X,
  Sliders,
  Music,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
  Maximize2,
  Minimize2,
  RotateCcw,
  Volume2
} from 'lucide-react';
import type { ChannelInstrument, ChannelConfig, AudioTrack } from '../../utils/typeDefinitions';
import { CustomSelect } from './CustomSelect';
import { toneEngine } from '../../audio/toneEngine';
import {
  dbToFaderPos,
  faderPosToDb,
  normalizeTrackDb,
  formatDb
} from '../../core/audio/engine/audioTrackMath';

const INSTRUMENT_LABELS: Record<ChannelInstrument, string> = {
  piano: 'Piano de Cola',
  synth: 'Sintetizador Virtual',
  soundfont: 'SoundFont (SF2)',
  sampler: 'Sampler Batería'
};

const MELODIC_INSTRUMENT_OPTIONS: Array<{ value: ChannelInstrument; label: string }> = [
  { value: 'piano', label: INSTRUMENT_LABELS.piano },
  { value: 'synth', label: INSTRUMENT_LABELS.synth },
  { value: 'soundfont', label: INSTRUMENT_LABELS.soundfont }
];

const SYNTH_DB_SCALE_MARKS = [
  { label: '+6', pct: 100 },
  { label: '0',  pct: 80 },
  { label: '-6', pct: 65 },
  { label: '-12', pct: 50 },
  { label: '-24', pct: 30 },
  { label: '-48', pct: 10 },
  { label: '-∞', pct: 0 }
];

const AUDIO_DB_SCALE_MARKS = [
  { label: '+24', pct: 100 },
  { label: '0',   pct: 75 },
  { label: '-12', pct: 53 },
  { label: '-24', pct: 38 },
  { label: '-48', pct: 16 },
  { label: '-∞',  pct: 0 }
];

const DB_MICRO_TICKS: number[] = [];
for (let pct = 0; pct <= 100; pct += 4) {
  DB_MICRO_TICKS.push(pct);
}

type MixerCategoryFilter = 'all' | 'instruments' | 'drums' | 'audio';
type MixerDensity = 'compact' | 'standard';

// Pan knob vertical drag hook (with Shift fine precision — zero wheel hijacking)
function usePanDrag(
  id: string,
  currentPan: number,
  onPanChange: (id: string, pan: number) => void
) {
  const dragRef = useRef<{ lastY: number; value: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { lastY: e.clientY, value: currentPan };
  }, [currentPan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const deltaY = dragRef.current.lastY - e.clientY;
    dragRef.current.lastY = e.clientY;
    const sensitivity = e.shiftKey ? 440 : 120;
    const nextPan = Math.max(-1, Math.min(1, dragRef.current.value + deltaY / sensitivity));
    dragRef.current.value = nextPan;
    onPanChange(id, Math.abs(nextPan) < 0.03 ? 0 : Math.round(nextPan * 20) / 20);
  }, [id, onPanChange]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp };
}

// Custom Fader Hook (pointer-only with Shift fine precision, strictly NO wheel handler)
function useFaderDrag(
  id: string,
  currentPosPct: number,
  onPosChange: (id: string, nextPosPct: number) => void
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ lastY: number; valuePct: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !containerRef.current) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const rect = containerRef.current.getBoundingClientRect();
    let initialPct = currentPosPct;
    if (!e.shiftKey) {
      const yFromBottom = rect.bottom - e.clientY;
      const ratio = Math.max(0, Math.min(1, yFromBottom / Math.max(1, rect.height)));
      initialPct = ratio * 100;
      onPosChange(id, initialPct);
    }
    dragRef.current = { lastY: e.clientY, valuePct: initialPct };
  }, [id, currentPosPct, onPosChange]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const height = Math.max(1, rect.height);

    if (e.shiftKey) {
      const deltaY = dragRef.current.lastY - e.clientY;
      const deltaPct = (deltaY / height) * 25;
      const nextPct = Math.max(0, Math.min(100, dragRef.current.valuePct + deltaPct));
      dragRef.current.valuePct = nextPct;
      dragRef.current.lastY = e.clientY;
      onPosChange(id, nextPct);
    } else {
      const yFromBottom = rect.bottom - e.clientY;
      const nextPct = Math.max(0, Math.min(100, (yFromBottom / height) * 100));
      dragRef.current.valuePct = nextPct;
      dragRef.current.lastY = e.clientY;
      onPosChange(id, nextPct);
    }
  }, [id, onPosChange]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
  }, []);

  return { containerRef, onPointerDown, onPointerMove, onPointerUp };
}

interface UnifiedStripDescriptor {
  kind: 'channel' | 'audio';
  id: string;
  name: string;
  color: string;
  category: 'master' | 'instruments' | 'drums' | 'audio';
  faderPct: number;
  unityPct: number;
  dbReadout: string;
  pan: number;
  muted: boolean;
  solo: boolean;
  isMaster: boolean;
  channelConfig?: ChannelConfig;
  audioTrack?: AudioTrack;
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
    openSynthConfigForChannel,
    openSoundFontConfigForChannel,
    audioTracks,
    updateAudioTrack,
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
      openSynthConfigForChannel: state.openSynthConfigForChannel,
      openSoundFontConfigForChannel: state.openSoundFontConfigForChannel,
      audioTracks: state.audioTracks || [],
      updateAudioTrack: state.updateAudioTrack,
      isPlaying: state.isPlaying
    }))
  );

  const stripsScrollRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<MixerCategoryFilter>('all');
  const [manualDensity, setManualDensity] = useState<MixerDensity | null>(null);

  const [vuDbLevels, setVuDbLevels] = useState<Record<string, number>>({});
  const [clippingLatches, setClippingLatches] = useState<Record<string, boolean>>({});
  const [peakDbLevels, setPeakDbLevels] = useState<Record<string, number>>({});

  const clearClipAndPeak = useCallback((id: string) => {
    setClippingLatches((prev) => ({ ...prev, [id]: false }));
    setPeakDbLevels((prev) => ({ ...prev, [id]: -Infinity }));
  }, []);

  const resetAllPeaks = useCallback(() => {
    setClippingLatches({});
    setPeakDbLevels({});
  }, []);

  // Construir lista ordenada unificada (Channels + AudioTracks + Master Dock)
  const { masterStrip, nonMasterStrips, validChannelIds } = useMemo(() => {
    const safeChannels = channels || {};
    const orderedIds = (channelOrder || []).filter(id => safeChannels[id] !== undefined);
    Object.keys(safeChannels).forEach(id => {
      if (!orderedIds.includes(id)) orderedIds.push(id);
    });

    const masterIdx = orderedIds.indexOf('master');
    if (masterIdx > 0) {
      orderedIds.splice(masterIdx, 1);
      orderedIds.unshift('master');
    }

    const toChannelDescriptor = (ch: ChannelConfig): UnifiedStripDescriptor => {
      const isMaster = ch.id === 'master' || ch.type === 'master';
      const dbReadout = ch.volume <= 0 ? '-∞' : `${(Math.round(((ch.volume - 80) / 80) * 30 * 10) / 10).toFixed(1)}`;
      return {
        kind: 'channel',
        id: ch.id,
        name: ch.name,
        color: isMaster ? 'var(--tension)' : ch.color,
        category: isMaster ? 'master' : ch.type === 'drums' ? 'drums' : 'instruments',
        faderPct: ch.volume,
        unityPct: 80,
        dbReadout,
        pan: ch.pan,
        muted: ch.muted,
        solo: ch.solo,
        isMaster,
        channelConfig: ch
      };
    };

    const masterCh = safeChannels['master'];
    const masterDesc = masterCh ? toChannelDescriptor(masterCh) : null;

    const channelStrips = orderedIds
      .filter(id => id !== 'master')
      .map(id => safeChannels[id])
      .filter(Boolean)
      .map(toChannelDescriptor);

    const trackStrips: UnifiedStripDescriptor[] = (audioTracks || []).map(tr => {
      const db = normalizeTrackDb(tr.volume);
      const posPct = dbToFaderPos(db) * 100;
      return {
        kind: 'audio',
        id: tr.id,
        name: tr.name,
        color: tr.color,
        category: 'audio',
        faderPct: posPct,
        unityPct: 75,
        dbReadout: formatDb(db),
        pan: tr.pan,
        muted: tr.muted,
        solo: tr.solo,
        isMaster: false,
        audioTrack: tr
      };
    });

    return {
      masterStrip: masterDesc,
      nonMasterStrips: [...channelStrips, ...trackStrips],
      validChannelIds: orderedIds
    };
  }, [channels, channelOrder, audioTracks]);

  const anySolo = useMemo(
    () => nonMasterStrips.some(s => s.solo),
    [nonMasterStrips]
  );

  const categoryCounts = useMemo(() => {
    let instruments = 0;
    let drums = 0;
    let audio = 0;
    for (const s of nonMasterStrips) {
      if (s.category === 'instruments') instruments++;
      else if (s.category === 'drums') drums++;
      else if (s.category === 'audio') audio++;
    }
    return {
      all: nonMasterStrips.length,
      instruments,
      drums,
      audio
    };
  }, [nonMasterStrips]);

  const filteredStrips = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return nonMasterStrips.filter(s => {
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nonMasterStrips, categoryFilter, searchQuery]);

  // Densidad automática en proyectos grandes (> 8 pistas) salvo override manual del usuario
  const density: MixerDensity = manualDensity ?? (nonMasterStrips.length > 8 ? 'compact' : 'standard');

  // Medición real en tiempo real (RAF throttled ~30fps, cero datos aleatorios falsos)
  const meterIds = useMemo(() => {
    const ids = nonMasterStrips.map(s => ({ id: s.id, muted: s.muted }));
    if (masterStrip) ids.push({ id: masterStrip.id, muted: masterStrip.muted });
    return ids;
  }, [nonMasterStrips, masterStrip]);

  useEffect(() => {
    if (!isMixerOpen) return;

    let rafId = 0;
    let lastSampleTime = 0;

    const tick = (now: number) => {
      if (now - lastSampleTime >= 33) {
        lastSampleTime = now;
        const nextDbLevels: Record<string, number> = {};
        const nextClips: Record<string, boolean> = {};

        for (const item of meterIds) {
          if (item.muted) {
            nextDbLevels[item.id] = -Infinity;
            continue;
          }
          const db = toneEngine.getChannelMeterLevel(item.id);
          const cleanDb = isFinite(db) && db > -72 ? db : -Infinity;
          nextDbLevels[item.id] = cleanDb;
          if (isFinite(cleanDb) && cleanDb > 0.1) {
            nextClips[item.id] = true;
          }
        }

        setVuDbLevels(nextDbLevels);

        setPeakDbLevels((prev) => {
          let changed = false;
          const updated = { ...prev };
          for (const [id, db] of Object.entries(nextDbLevels)) {
            if (isFinite(db) && (!isFinite(updated[id]) || db > updated[id])) {
              updated[id] = db;
              changed = true;
            }
          }
          return changed ? updated : prev;
        });

        if (Object.keys(nextClips).length > 0) {
          setClippingLatches((prev) => ({ ...prev, ...nextClips }));
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isMixerOpen, isPlaying, meterIds]);

  // Rueda del ratón en el área del rack desplaza horizontalmente cuando hay muchas pistas (NUNCA mueve faders)
  useEffect(() => {
    if (!isMixerOpen) return;
    const el = stripsScrollRef.current;
    if (!el) return;

    const handleRackWheel = (e: WheelEvent) => {
      if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', handleRackWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleRackWheel);
  }, [isMixerOpen, density, filteredStrips.length]);

  const handleClearAllSolos = useCallback(() => {
    const state = useSongStore.getState();
    Object.values(state.channels || {}).forEach(ch => {
      if (ch && ch.id !== 'master' && ch.solo) {
        updateChannel(ch.id, { solo: false });
      }
    });
    (state.audioTracks || []).forEach(tr => {
      if (tr.solo) {
        updateAudioTrack(tr.id, { solo: false });
      }
    });
  }, [updateChannel, updateAudioTrack]);

  const moveChannel = useCallback((id: string, delta: number) => {
    if (typeof reorderChannels !== 'function') return;
    const currentIndex = validChannelIds.indexOf(id);
    if (currentIndex <= 0) return;
    const targetIndex = currentIndex + delta;
    if (targetIndex < 1 || targetIndex >= validChannelIds.length) return;
    reorderChannels(currentIndex, targetIndex);
  }, [reorderChannels, validChannelIds]);

  const handleFaderChange = useCallback((stripId: string, nextPosPct: number) => {
    const strip = nonMasterStrips.find(s => s.id === stripId) || (masterStrip?.id === stripId ? masterStrip : null);
    if (!strip) return;
    if (strip.kind === 'audio') {
      const nextDb = faderPosToDb(Math.max(0, Math.min(1, nextPosPct / 100)));
      updateAudioTrack(stripId, { volume: nextDb });
    } else {
      setChannelVolume(stripId, Math.round(Math.max(0, Math.min(100, nextPosPct))));
    }
  }, [nonMasterStrips, masterStrip, updateAudioTrack, setChannelVolume]);

  const handleFaderReset = useCallback((stripId: string) => {
    const strip = nonMasterStrips.find(s => s.id === stripId) || (masterStrip?.id === stripId ? masterStrip : null);
    if (!strip) return;
    if (strip.kind === 'audio') {
      updateAudioTrack(stripId, { volume: 0 });
    } else {
      setChannelVolume(stripId, 80);
    }
  }, [nonMasterStrips, masterStrip, updateAudioTrack, setChannelVolume]);

  const handlePanChange = useCallback((stripId: string, nextPan: number) => {
    const strip = nonMasterStrips.find(s => s.id === stripId) || (masterStrip?.id === stripId ? masterStrip : null);
    if (!strip) return;
    if (strip.kind === 'audio') {
      updateAudioTrack(stripId, { pan: nextPan });
    } else {
      setChannelPan(stripId, nextPan);
    }
  }, [nonMasterStrips, masterStrip, updateAudioTrack, setChannelPan]);

  const handleToggleMute = useCallback((strip: UnifiedStripDescriptor) => {
    if (strip.kind === 'audio') {
      updateAudioTrack(strip.id, { muted: !strip.muted });
    } else {
      toggleMute(strip.id);
    }
  }, [updateAudioTrack, toggleMute]);

  const handleToggleSolo = useCallback((strip: UnifiedStripDescriptor) => {
    if (strip.kind === 'audio') {
      updateAudioTrack(strip.id, { solo: !strip.solo });
    } else {
      toggleSolo(strip.id);
    }
  }, [updateAudioTrack, toggleSolo]);

  const handleRename = useCallback((strip: UnifiedStripDescriptor, newName: string) => {
    if (strip.kind === 'audio') {
      updateAudioTrack(strip.id, { name: newName });
    } else {
      updateChannel(strip.id, { name: newName });
    }
  }, [updateAudioTrack, updateChannel]);

  if (!isMixerOpen) return null;

  const computeVuPct = (db: number, unityPct: number) => {
    if (!isFinite(db)) return 0;
    if (db <= -48) {
      return Math.max(0, ((db + 70) / 22) * 10);
    }
    if (db <= 0) {
      return 10 + ((db + 48) / 48) * (unityPct - 10);
    }
    return Math.min(100, unityPct + (db / 12) * (100 - unityPct));
  };

  return (
    <div className="mixer-overlay" onClick={() => setMixerOpen(false)}>
      <div className="mixer-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header & Escalabilidad para proyectos grandes */}
        <div className="mixer-header">
          <div className="mixer-header-left">
            <div className="mixer-header-title">
              <Sliders className="mixer-header-icon" size={17} />
              <h2>MIXER CONSOLE</h2>
              <span className="mixer-count-badge">{nonMasterStrips.length} CH</span>
            </div>

            {/* Buscador rápido */}
            <div className="mixer-search-box">
              <Search size={13} className="mixer-search-icon" />
              <input
                type="text"
                placeholder="Filtrar canal..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="mixer-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="mixer-search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Limpiar búsqueda"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Filtros de categoría */}
          <div className="mixer-filter-pills">
            {([
              { id: 'all', label: 'Todos', count: categoryCounts.all },
              { id: 'instruments', label: 'Instrumentos', count: categoryCounts.instruments },
              { id: 'drums', label: 'Batería', count: categoryCounts.drums },
              { id: 'audio', label: 'Audio', count: categoryCounts.audio }
            ] as const).map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`mixer-filter-pill ${categoryFilter === tab.id ? 'active' : ''}`}
                onClick={() => setCategoryFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="pill-count">{tab.count}</span>
              </button>
            ))}
          </div>

          <div className="mixer-header-actions">
            {anySolo && (
              <button
                type="button"
                className="mixer-util-btn solo-clear"
                onClick={handleClearAllSolos}
                title="Desactivar Solo en todos los canales"
              >
                Limpiar Solos
              </button>
            )}

            <button
              type="button"
              className="mixer-util-btn"
              onClick={resetAllPeaks}
              title="Reiniciar medidores de picos y alertas de clip"
            >
              <RotateCcw size={12} />
              <span>Peaks</span>
            </button>

            <div className="mixer-density-toggle" title="Cambiar densidad visual para proyectos pequeños o grandes">
              <button
                type="button"
                className={`mixer-density-btn ${density === 'compact' ? 'active' : ''}`}
                onClick={() => setManualDensity('compact')}
                title="Vista Compacta (ideal para muchos tracks)"
              >
                <Minimize2 size={12} />
                <span>Compacto</span>
              </button>
              <button
                type="button"
                className={`mixer-density-btn ${density === 'standard' ? 'active' : ''}`}
                onClick={() => setManualDensity('standard')}
                title="Vista Estándar"
              >
                <Maximize2 size={12} />
                <span>Estándar</span>
              </button>
            </div>

            <button
              className="mixer-close-btn"
              onClick={() => setMixerOpen(false)}
              title="Cerrar Mezclador (Shift+M / Esc)"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Cuerpo de Consola: Rack desplazable a la izquierda + Bus Master fijo a la derecha */}
        <div className="mixer-console-body">
          <div className="mixer-strips-scroll" ref={stripsScrollRef}>
            {filteredStrips.length === 0 ? (
              <div className="mixer-empty-filter">
                <span>No hay canales que coincidan con el filtro actual.</span>
              </div>
            ) : (
              filteredStrips.map((strip) => {
                const isSilenced = strip.muted || (anySolo && !strip.solo);
                const currentDb = vuDbLevels[strip.id] ?? -Infinity;
                const peakDb = peakDbLevels[strip.id] ?? -Infinity;
                const isClipping = clippingLatches[strip.id] || false;
                const vuPct = computeVuPct(currentDb, strip.unityPct);
                const peakDisplay = isFinite(peakDb) ? `${peakDb > 0 ? '+' : ''}${peakDb.toFixed(1)}` : '-∞';

                return (
                  <ChannelStrip
                    key={strip.id}
                    strip={strip}
                    density={density}
                    isSilenced={isSilenced}
                    isClipping={isClipping}
                    vuPct={vuPct}
                    peakDisplay={peakDisplay}
                    peakDb={peakDb}
                    clearClipAndPeak={clearClipAndPeak}
                    moveChannel={moveChannel}
                    validChannelIds={validChannelIds}
                    onFaderChange={handleFaderChange}
                    onFaderReset={handleFaderReset}
                    onPanChange={handlePanChange}
                    onToggleMute={handleToggleMute}
                    onToggleSolo={handleToggleSolo}
                    onRename={handleRename}
                    setChannelInstrument={setChannelInstrument}
                    openSynthConfigForChannel={openSynthConfigForChannel}
                    openSoundFontConfigForChannel={openSoundFontConfigForChannel}
                  />
                );
              })
            )}
          </div>

          {/* Master Bus Dock fijo a la derecha (siempre accesible) */}
          {masterStrip && (
            <div className="mixer-master-dock">
              {(() => {
                const currentDb = vuDbLevels[masterStrip.id] ?? -Infinity;
                const peakDb = peakDbLevels[masterStrip.id] ?? -Infinity;
                const isClipping = clippingLatches[masterStrip.id] || false;
                const vuPct = computeVuPct(currentDb, masterStrip.unityPct);
                const peakDisplay = isFinite(peakDb) ? `${peakDb > 0 ? '+' : ''}${peakDb.toFixed(1)}` : '-∞';

                return (
                  <ChannelStrip
                    strip={masterStrip}
                    density="standard"
                    isSilenced={masterStrip.muted}
                    isClipping={isClipping}
                    vuPct={vuPct}
                    peakDisplay={peakDisplay}
                    peakDb={peakDb}
                    clearClipAndPeak={clearClipAndPeak}
                    moveChannel={moveChannel}
                    validChannelIds={validChannelIds}
                    onFaderChange={handleFaderChange}
                    onFaderReset={handleFaderReset}
                    onPanChange={handlePanChange}
                    onToggleMute={handleToggleMute}
                    onToggleSolo={handleToggleSolo}
                    onRename={handleRename}
                    setChannelInstrument={setChannelInstrument}
                    openSynthConfigForChannel={openSynthConfigForChannel}
                    openSoundFontConfigForChannel={openSoundFontConfigForChannel}
                  />
                );
              })()}
            </div>
          )}
        </div>

        <div className="mixer-footer">
          <div className="mixer-status">
            {anySolo ? (
              <span className="status-solo-warning">CANAL EN SOLO ACTIVO</span>
            ) : Object.values(clippingLatches).some(Boolean) ? (
              <span className="status-solo-warning" style={{ color: '#ff3366' }}>ALERTA: CLIPPING DETECTADO</span>
            ) : (
              <span className="status-ok">AUDIO NOMINAL // SHIFT+ARRASTRAR: AJUSTE FINO · DOBLE CLICK: RESET 0 dB · RUEDA: DESPLAZAR RACK</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Strip unificado (soporta Canales de Instrumentos, Batería, Audio Tracks y Master)
const ChannelStrip: React.FC<{
  strip: UnifiedStripDescriptor;
  density: MixerDensity;
  isSilenced: boolean;
  isClipping: boolean;
  vuPct: number;
  peakDisplay: string;
  peakDb: number;
  clearClipAndPeak: (id: string) => void;
  moveChannel: (id: string, delta: number) => void;
  validChannelIds: string[];
  onFaderChange: (id: string, nextPosPct: number) => void;
  onFaderReset: (id: string) => void;
  onPanChange: (id: string, pan: number) => void;
  onToggleMute: (strip: UnifiedStripDescriptor) => void;
  onToggleSolo: (strip: UnifiedStripDescriptor) => void;
  onRename: (strip: UnifiedStripDescriptor, newName: string) => void;
  setChannelInstrument: (id: string, inst: ChannelInstrument) => void;
  openSynthConfigForChannel: (id: string) => void;
  openSoundFontConfigForChannel: (id: string) => void;
}> = React.memo(({
  strip, density, isSilenced, isClipping, vuPct, peakDisplay, peakDb,
  clearClipAndPeak, moveChannel, validChannelIds,
  onFaderChange, onFaderReset, onPanChange, onToggleMute, onToggleSolo,
  onRename, setChannelInstrument, openSynthConfigForChannel, openSoundFontConfigForChannel
}) => {
  const panDrag = usePanDrag(strip.id, strip.pan, onPanChange);
  const faderDrag = useFaderDrag(strip.id, strip.faderPct, onFaderChange);

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(strip.name);

  useEffect(() => {
    setTempName(strip.name);
  }, [strip.name]);

  const handleNameSubmit = () => {
    setIsEditingName(false);
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== strip.name && !strip.isMaster) {
      onRename(strip, trimmed);
    } else {
      setTempName(strip.name);
    }
  };

  const isCompact = density === 'compact' && !strip.isMaster;
  const scaleMarks = strip.kind === 'audio' ? AUDIO_DB_SCALE_MARKS : SYNTH_DB_SCALE_MARKS;
  const ch = strip.channelConfig;

  return (
    <div
      className={`mixer-strip ${isCompact ? 'compact' : ''} ${strip.isMaster ? 'is-master' : ''} ${strip.muted ? 'is-muted' : ''} ${strip.solo ? 'is-solo' : ''} ${isSilenced ? 'is-silenced' : ''}`}
      style={{ '--channel-color': strip.color } as React.CSSProperties}
    >
      {/* Row 1: Header */}
      <div className="strip-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', flex: 1 }}>
          <span className="strip-color-badge" style={{ backgroundColor: strip.color }} />
          {isEditingName && !strip.isMaster ? (
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
                  setTempName(strip.name);
                  setIsEditingName(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="strip-name"
              title={strip.isMaster ? 'Master Bus' : `${strip.name} · Doble click para renombrar`}
              onDoubleClick={() => {
                if (!strip.isMaster) setIsEditingName(true);
              }}
            >
              {strip.name}
            </span>
          )}
        </div>
        {!isCompact && !strip.isMaster && strip.kind === 'channel' && (
          <div className="strip-reorder-controls">
            <button
              className="strip-move-btn"
              onClick={() => moveChannel(strip.id, -1)}
              disabled={validChannelIds.indexOf(strip.id) <= 1}
              title="Mover izquierda"
            >
              <ChevronLeft size={11} />
            </button>
            <button
              className="strip-move-btn"
              onClick={() => moveChannel(strip.id, 1)}
              disabled={validChannelIds.indexOf(strip.id) >= validChannelIds.length - 1}
              title="Mover derecha"
            >
              <ChevronRight size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Row 2: Instrument / Track Source */}
      {strip.isMaster ? (
        <div className="strip-instrument-select master-instrument-row">
          <span className="master-badge">MASTER BUS</span>
        </div>
      ) : strip.kind === 'audio' ? (
        <div className="strip-instrument-select drum-instrument-row" title="Pista de Audio Multitrack">
          <Volume2 size={11} className="strip-inst-icon" />
          <span className="strip-select-static">{isCompact ? 'AUDIO' : 'Audio Track'}</span>
        </div>
      ) : ch && ch.type !== 'drums' ? (
        isCompact ? (
          <div className="strip-instrument-select">
            <span className="strip-select-static" style={{ flex: 1 }}>
              {ch.instrument === 'piano' ? 'PIANO' : ch.instrument === 'soundfont' ? 'SF2' : 'SYNTH'}
            </span>
            {(ch.instrument === 'synth' || ch.instrument === 'soundfont') && (
              <button
                className="strip-synth-btn"
                onClick={() =>
                  ch.instrument === 'soundfont'
                    ? openSoundFontConfigForChannel(ch.id)
                    : openSynthConfigForChannel(ch.id)
                }
                title={ch.instrument === 'soundfont' ? 'Configurar SoundFont y Patch' : 'Configurar Sintetizador'}
              >
                <Settings size={11} />
              </button>
            )}
          </div>
        ) : (
          <div className="strip-instrument-select">
            <Music size={12} className="strip-inst-icon" />
            <CustomSelect
              value={ch.instrument}
              onChange={(val) => {
                const nextInst = val as ChannelInstrument;
                setChannelInstrument(ch.id, nextInst);
                if (nextInst === 'soundfont' && !useSongStore.getState().channels[ch.id]?.soundfontConfig?.soundfontId) {
                  openSoundFontConfigForChannel(ch.id);
                }
              }}
              options={MELODIC_INSTRUMENT_OPTIONS}
              className="strip-select"
              style={{ flex: 1 }}
            />
            {(ch.instrument === 'synth' || ch.instrument === 'soundfont') && (
              <button
                className="strip-synth-btn"
                onClick={() =>
                  ch.instrument === 'soundfont'
                    ? openSoundFontConfigForChannel(ch.id)
                    : openSynthConfigForChannel(ch.id)
                }
                title={ch.instrument === 'soundfont' ? 'Configurar SoundFont y Patch' : 'Configurar Sintetizador'}
              >
                <Settings size={12} />
              </button>
            )}
          </div>
        )
      ) : (
        <div className="strip-instrument-select drum-instrument-row">
          <Music size={11} className="strip-inst-icon" />
          <span className="strip-select-static">{isCompact ? 'DRUMS' : 'Drum Machine'}</span>
        </div>
      )}

      {/* Row 3: Mute / Solo */}
      {!strip.isMaster ? (
        <div className="strip-ms-buttons">
          <button
            className={`btn-mute ${strip.muted ? 'active' : ''}`}
            onClick={() => onToggleMute(strip)}
            title={strip.muted ? 'Desmutear' : 'Silenciar (Mute)'}
          >
            M
          </button>
          <button
            className={`btn-solo ${strip.solo ? 'active' : ''}`}
            onClick={() => onToggleSolo(strip)}
            title={strip.solo ? 'Desactivar Solo' : 'Aislar (Solo)'}
          >
            S
          </button>
        </div>
      ) : (
        <div className="strip-ms-buttons">
          <button
            className={`btn-mute ${strip.muted ? 'active' : ''}`}
            onClick={() => onToggleMute(strip)}
            title={strip.muted ? 'Desmutear Master' : 'Silenciar Master'}
          >
            MUTE ALL
          </button>
        </div>
      )}

      {/* Row 4: Peak dB Display + Clip LED */}
      <div
        className={`strip-peak-display ${isClipping ? 'clipping' : ''} ${peakDb > 0 ? 'over-zero' : ''}`}
        onClick={() => clearClipAndPeak(strip.id)}
        title="Peak Hold — Click para resetear"
      >
        <span className="peak-value">{peakDisplay}</span>
        <div className={`clip-led ${isClipping ? 'clipping' : ''}`} />
      </div>

      {/* Row 5: Fader & VU */}
      <div className="strip-fader-section">
        {!isCompact && (
          <div className="db-scale-column">
            {scaleMarks.map((m) => (
              <div key={m.label} className="db-major-mark" style={{ bottom: `${m.pct}%` }}>
                <span className="db-mark-label">{m.label}</span>
                <span className="db-mark-line" />
              </div>
            ))}
            {DB_MICRO_TICKS.map((pct) => (
              <span key={pct} className="db-micro-tick" style={{ bottom: `${pct}%` }} />
            ))}
          </div>
        )}

        <div className="strip-vu-meter">
          <div
            className="strip-vu-fill"
            style={{
              height: `${vuPct}%`,
              backgroundColor: vuPct > strip.unityPct ? '#ff3366' : strip.color
            }}
          />
        </div>

        <div
          ref={faderDrag.containerRef}
          className="strip-fader-container"
          onPointerDown={faderDrag.onPointerDown}
          onPointerMove={faderDrag.onPointerMove}
          onPointerUp={faderDrag.onPointerUp}
          onDoubleClick={() => onFaderReset(strip.id)}
          title="Arrastrar para ajustar volumen · Shift+Arrastrar para ajuste fino · Doble click 0 dB"
        >
          <div className="analog-fader-rail" />
          <div
            className="fader-unity-tick"
            style={{ bottom: `${strip.unityPct}%` }}
          />
          <div
            className="analog-fader-cap"
            style={{ bottom: `calc(${strip.faderPct}% - 9px)` }}
          >
            <div className="fader-cap-notch" />
          </div>
        </div>
      </div>

      {/* Row 6: dB readout */}
      <div
        className="strip-db-readout"
        onDoubleClick={() => onFaderReset(strip.id)}
        title="Doble click para 0.0 dB"
      >
        {strip.dbReadout}
        {!isCompact && <span className="db-unit"> dB</span>}
      </div>

      {/* Row 7: Pan knob */}
      <div className="strip-pan-knob-section">
        <div className="strip-pan-knob-labels">
          <span>L</span>
          <span className="strip-pan-knob-value">
            {strip.pan === 0 ? 'C' : strip.pan < 0 ? `L${Math.round(strip.pan * -100)}` : `R${Math.round(strip.pan * 100)}`}
          </span>
          <span>R</span>
        </div>
        <div
          className="pan-knob-container"
          onDoubleClick={() => onPanChange(strip.id, 0)}
          onPointerDown={panDrag.onPointerDown}
          onPointerMove={panDrag.onPointerMove}
          onPointerUp={panDrag.onPointerUp}
          title={`Paneo: ${strip.pan === 0 ? 'Centro' : strip.pan < 0 ? `Izq ${Math.round(strip.pan * -100)}%` : `Der ${Math.round(strip.pan * 100)}%`} · Shift+Arrastrar fino · Doble click centrar`}
        >
          <div className="pan-knob-track" />
          <div className="pan-knob-dial" style={{ transform: `rotate(${strip.pan * 135}deg)` }}>
            <div className="pan-knob-indicator" />
          </div>
        </div>
      </div>
    </div>
  );
});
