import { useEffect, useState, useCallback, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { toneEngine } from '../../audio/toneEngine';
import { NOTE_CLASSES, SCALE_INTERVALS } from '../../engine/scaleDefinitions';
import type { NoteClass, ScaleType } from '../../utils/typeDefinitions';
import { Play, Square, Trash2, RefreshCw, Bell, Settings as SettingsIcon, Sliders, FolderOpen, Save } from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

import { exportSessionToMidi, importMidiToSession } from '../../utils/midiService';

const BeatDisplay = () => {
  const currentBeat = useSongStore(state => state.currentBeat);
  return (
    <div className="beat-display" style={{ fontFamily: '"Share Tech Mono", monospace' }}>
      Beat: {currentBeat.toFixed(2)}
    </div>
  );
};

export const Header = () => {
  const {
    bpm,
    setBpm,
    key,
    setKey,
    scale,
    setScale,
    isAutoKey,
    setIsAutoKey,
    detectedKey,
    isPlaying,
    setPlaying,
    chordBlocks,
    melodyNotes,
    clearSong,
    importSong,
    isLooping,
    setLooping,
    isMetronomeActive,
    setMetronomeActive,
    isAudioLoading,
    isSettingsOpen,
    setSettingsOpen,
    setSynthModalOpen,
    instrumentType,
    timeSignature,
    setTimeSignature,
    pattern,
    setPattern,
    customPatterns,
    swing,
    setSwing,
    sustain,
    setSustain,
    chordOctaveShift,
    setChordOctaveShift,
    refreshPatterns,
    isMixerOpen,
    setMixerOpen,
    channels,
    activeView,
    setChannelInstrument
  } = useSongStore(useShallow(state => ({
    bpm: state.bpm,
    setBpm: state.setBpm,
    key: state.key,
    setKey: state.setKey,
    scale: state.scale,
    setScale: state.setScale,
    isAutoKey: state.isAutoKey,
    setIsAutoKey: state.setIsAutoKey,
    detectedKey: state.detectedKey,
    isPlaying: state.isPlaying,
    setPlaying: state.setPlaying,
    chordBlocks: state.chordBlocks,
    melodyNotes: state.melodyNotes,
    clearSong: state.clearSong,
    importSong: state.importSong,
    isLooping: state.isLooping,
    setLooping: state.setLooping,
    isMetronomeActive: state.isMetronomeActive,
    setMetronomeActive: state.setMetronomeActive,
    isAudioLoading: state.isAudioLoading,
    isSettingsOpen: state.isSettingsOpen,
    setSettingsOpen: state.setSettingsOpen,
    setSynthModalOpen: state.setSynthModalOpen,
    instrumentType: state.instrumentType,
    setInstrumentType: state.setInstrumentType,
    timeSignature: state.timeSignature,
    setTimeSignature: state.setTimeSignature,
    pattern: state.pattern,
    setPattern: state.setPattern,
    customPatterns: state.customPatterns,
    swing: state.swing,
    setSwing: state.setSwing,
    sustain: state.sustain,
    setSustain: state.setSustain,
    chordOctaveShift: state.chordOctaveShift,
    setChordOctaveShift: state.setChordOctaveShift,
    refreshPatterns: state.refreshPatterns,
    isMixerOpen: state.isMixerOpen,
    setMixerOpen: state.setMixerOpen,
    channels: state.channels,
    activeView: state.activeView,
    setChannelInstrument: state.setChannelInstrument
  })));



  // Estado local del BPM — solo escribe al store en onBlur/Enter
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [styleTab, setStyleTab] = useState<'styles' | 'sounds' | 'config'>('styles');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const stylesListRef = useRef<HTMLDivElement>(null);
  const soundsListRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected style/sound
  useEffect(() => {
    if (styleMenuOpen) {
      const activeRef = styleTab === 'styles' ? stylesListRef : styleTab === 'sounds' ? soundsListRef : null;
      if (activeRef && activeRef.current) {
        const timer = setTimeout(() => {
          const activeEl = activeRef.current?.querySelector('.style-item-row.active');
          if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest' });
          }
        }, 30);
        return () => clearTimeout(timer);
      }
    }
  }, [styleMenuOpen, styleTab, pattern, instrumentType]);

  // Sincronizar si el store cambia externamente (ej: Tap BPM)
  useEffect(() => {
    setBpmInput(String(bpm));
  }, [bpm]);

  const handleRefreshPatterns = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshPatterns();
    } catch (e) {
      console.error('Error al actualizar patrones:', e);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshPatterns]);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (!styleMenuOpen) return;
      const target = e.target as HTMLElement;
      if (!target.closest('.style-dropdown-container')) {
        setStyleMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleGlobalClick);
    return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, [styleMenuOpen]);

  const commitBpm = useCallback((raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.max(40, Math.min(300, parsed));
      setBpm(clamped);
      setBpmInput(String(clamped));
    } else {
      setBpmInput(String(bpm));
    }
  }, [bpm, setBpm]);

  // Historial de clicks para Tap BPM
  const [tapTimes, setTapTimes] = useState<number[]>([]);

  const handlePlayToggle = async () => {
    await toneEngine.init();
    setPlaying(!isPlaying);
  };

  const handleStop = () => {
    toneEngine.stop();
  };

  const handleClear = () => {
    if (window.confirm('¿Estás seguro de que quieres limpiar toda la canción?')) {
      clearSong();
      toneEngine.stop();
    }
  };

  const handleTapBPM = () => {
    const now = Date.now();
    const filteredTimes = tapTimes.filter(t => now - t < 2000);
    const newTimes = [...filteredTimes, now];
    setTapTimes(newTimes);

    if (newTimes.length >= 2) {
      let sumDiffs = 0;
      for (let i = 1; i < newTimes.length; i++) {
        sumDiffs += newTimes[i] - newTimes[i - 1];
      }
      const avgDiff = sumDiffs / (newTimes.length - 1);
      const calculatedBpm = Math.round(60000 / avgDiff);
      const clamped = Math.max(40, Math.min(240, calculatedBpm));
      setBpm(clamped);
    }
  };

  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);

  useEffect(() => {
    if (!exportDropdownOpen) return;
    const closeDropdown = () => setExportDropdownOpen(false);
    window.addEventListener('click', closeDropdown);
    return () => window.removeEventListener('click', closeDropdown);
  }, [exportDropdownOpen]);

  const handleExportNormal = () => {
    if (chordBlocks.length === 0 && melodyNotes.length === 0) {
      alert('La canción está vacía. Agrega notas o acordes primero.');
      return;
    }
    const midiArray = exportSessionToMidi({
      bpm,
      key,
      scale,
      timeSignature,
      pattern,
      instrumentType,
      chordBlocks,
      melodyNotes,
      customPatterns
    }, 'normal');

    downloadMidiFile(midiArray, `phosphor_${key}_${scale}_${bpm}bpm_render.mid`);
  };

  const handleExportProject = () => {
    const state = useSongStore.getState();
    if (chordBlocks.length === 0 && melodyNotes.length === 0 && (!state.patternChain || state.patternChain.length === 0)) {
      alert('La canción está vacía. Agrega notas, acordes o patrones de batería primero.');
      return;
    }

    const projectData = {
      version: '1.0',
      bpm,
      key,
      scale,
      timeSignature,
      pattern,
      instrumentType,
      chordBlocks,
      melodyNotes,
      channels: state.channels,
      drumChannels: state.drumChannels,
      chordOctaveShift: state.chordOctaveShift,
      patternChain: state.patternChain,
      isPatternRepeatOn: state.isPatternRepeatOn,
      activeDrumKitId: state.activeDrumKitId,
    };
    
    const jsonString = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `phosphor_project_${key}_${scale}_${bpm}bpm.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadMidiFile = (midiArray: Uint8Array, fileName: string) => {
    const blob = new Blob([midiArray as any], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const jsonStr = event.target?.result as string;
          const data = JSON.parse(jsonStr);
          importSong({
            bpm: data.bpm || 120,
            key: data.key || 'C',
            scale: data.scale || 'major',
            pattern: data.pattern || 'hold',
            timeSignature: data.timeSignature || '4/4',
            chordBlocks: data.chordBlocks || [],
            melodyNotes: data.melodyNotes || [],
            channels: data.channels,
            drumChannels: data.drumChannels,
            chordOctaveShift: data.chordOctaveShift,
            patternChain: data.patternChain,
            isPatternRepeatOn: data.isPatternRepeatOn,
            activeDrumKitId: data.activeDrumKitId
          });
        } catch (err) {
          alert('Error leyendo proyecto JSON.');
        }
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        if (!arrayBuffer) return;

        try {
          const result = importMidiToSession(arrayBuffer, customPatterns);
          if (result.success) {
            importSong({
              bpm: result.bpm,
              key: result.key as any,
              scale: result.scale as any,
              pattern: result.pattern,
              timeSignature: result.timeSignature,
              chordBlocks: result.chordBlocks,
              melodyNotes: result.melodyNotes,
              isAutoKey: true,
              chordOctaveShift: (result as any).chordOctaveShift ?? 0
            });
            setIsAutoKey(true);
            setKey(result.key as any);
            setScale(result.scale as any);
          } else {
            alert('Error importando MIDI: ' + (result.message || 'Error desconocido'));
          }
        } catch (err) {
          alert('Error al leer archivo MIDI.');
        }
      };
      reader.readAsArrayBuffer(file);
    }
    
    // Limpiar input
    e.target.value = '';
  };

  useEffect(() => {
    toneEngine.init();
  }, []);

  return (
    <header className="app-header">
      <div className="header-brand">
        <h1 className="phosphor-text">🎹 PHOSPHOR</h1>
        {isAudioLoading && (
          <span className="audio-loading-indicator" style={{
            fontSize: '11px',
            color: '#a855f7',
            marginLeft: '12px',
            background: 'rgba(168, 85, 247, 0.1)',
            padding: '2px 8px',
            borderRadius: '4px',
            border: '1px solid rgba(168, 85, 247, 0.2)',
            animation: 'pulse-badge 1.5s infinite'
          }}>
            ⏳ Cargando...
          </span>
        )}
      </div>

      <div className="header-controls">
        {/* Playback Controls */}
        <div className="control-group">
          <button
            className={`control-btn play ${isPlaying ? 'active' : ''}`}
            onClick={handlePlayToggle}
            disabled={isAudioLoading}
            title={isAudioLoading ? "Cargando samples..." : "Reproducir / Pausar (Espacio)"}
          >
            <Play size={18} fill={isPlaying ? 'currentColor' : 'none'} />
          </button>
          <button
            className="control-btn stop"
            onClick={handleStop}
            disabled={isAudioLoading}
            title={isAudioLoading ? "Cargando..." : "Detener y volver al inicio (W)"}
          >
            <Square size={18} fill="currentColor" />
          </button>
          <button
            className={`control-btn loop-toggle ${isLooping ? 'active' : ''}`}
            onClick={() => setLooping(!isLooping)}
            disabled={isAudioLoading}
            title={isAudioLoading ? "Cargando..." : "Repeat / Loop (R)"}
          >
            <RefreshCw size={16} />
          </button>

          {/* Botón Metrónomo */}
          <button
            className={`control-btn metro-toggle ${isMetronomeActive ? 'active' : ''}`}
            onClick={() => setMetronomeActive(!isMetronomeActive)}
            disabled={isAudioLoading}
            title={isAudioLoading ? "Cargando..." : "Metrónomo"}
          >
            <Bell size={16} fill={isMetronomeActive ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* BPM Input + Tap Tempo */}
        <div className="control-group text-input bpm-container">
          <label>BPM</label>
          <input
            type="text"
            inputMode="numeric"
            value={bpmInput}
            disabled={isAudioLoading}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={(e) => commitBpm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitBpm((e.target as HTMLInputElement).value);
            }}
            style={{ width: '52px', textAlign: 'center' }}
          />
          <button
            className="tap-bpm-btn"
            onClick={handleTapBPM}
            disabled={isAudioLoading}
            title="Haz clics seguidos al ritmo que quieras para calcular el BPM"
          >
            TAP
          </button>
        </div>

        {/* Tónica + Escala (con indicador Auto Key) */}
        <div className="control-group key-scale-group">
          <div className="auto-key-header">
            <label>Tonalidad</label>
            {isAutoKey ? (
              <span className="auto-key-badge" title="Tónica detectada automáticamente de los acordes">
                🎯 Auto{detectedKey ? ` · ${detectedKey}` : ''}
              </span>
            ) : (
              <button
                className="auto-key-reset-btn"
                onClick={() => setIsAutoKey(true)}
                disabled={isAudioLoading}
                title="Volver a detección automática de tónica"
              >
                ↺ Auto
              </button>
            )}
          </div>
          <div className="key-selectors-row" style={{ display: 'flex', gap: '4px' }}>
            <CustomSelect
              value={key}
              disabled={isAudioLoading}
              onChange={(val) => setKey(val as NoteClass)}
              options={NOTE_CLASSES.map(n => ({ value: n, label: n }))}
              style={{ minWidth: '50px' }}
            />
            <CustomSelect
              value={scale}
              disabled={isAudioLoading}
              onChange={(val) => setScale(val as ScaleType)}
              options={Object.keys(SCALE_INTERVALS).map(s => ({ value: s, label: s }))}
              style={{ minWidth: '85px' }}
            />
          </div>
        </div>

        {/* Botón de Estilo & Configuración (Dropdown Flotante) */}
        <div className="control-group style-dropdown-container" style={{ position: 'relative' }}>
          <label>Estilo / Config</label>
          <button
            className={`control-btn style-toggle-btn ${styleMenuOpen ? 'active' : ''}`}
            onClick={() => setStyleMenuOpen(!styleMenuOpen)}
            disabled={isAudioLoading}
            style={{ width: 'auto', padding: '0 12px', minWidth: '90px', gap: '4px', fontSize: '0.78rem', fontFamily: "'Share Tech Mono', monospace" }}
          >
            {pattern === 'hold' ? 'Hold ──' :
             pattern === 'quarters' ? 'Negras ♩' :
             pattern === 'eighths' ? 'Corcheas ♪' :
             pattern === 'pop' ? 'Pop 🎹' :
             pattern === 'arpeggio' ? 'Arp ⬈⬊' :
             pattern === 'strum' ? 'Strum 🎸' : pattern}
          </button>

          {styleMenuOpen && (
            <div className="style-popover-panel">
              {/* Pestañas del Popover */}
              <div className="popover-tabs">
                <button
                  className={`popover-tab ${styleTab === 'styles' ? 'active' : ''}`}
                  onClick={() => setStyleTab('styles')}
                >
                  Estilos
                </button>
                <button
                  className={`popover-tab ${styleTab === 'sounds' ? 'active' : ''}`}
                  onClick={() => setStyleTab('sounds')}
                >
                  Sonido
                </button>
                <button
                  className={`popover-tab ${styleTab === 'config' ? 'active' : ''}`}
                  onClick={() => setStyleTab('config')}
                >
                  Configuración
                </button>
              </div>

              <div className="popover-tab-content">
                {styleTab === 'styles' && (
                  <div className="styles-tab-view">
                    <div className="style-list-group" ref={stylesListRef}>
                      <div className={`style-item-row ${pattern === 'hold' ? 'active' : ''}`} onClick={() => setPattern('hold')}>
                        <span className="style-name">Hold ──</span>
                        {pattern === 'hold' && <span className="style-led active" />}
                      </div>
                      <div className={`style-item-row ${pattern === 'quarters' ? 'active' : ''}`} onClick={() => setPattern('quarters')}>
                        <span className="style-name">Negras ♩</span>
                        {pattern === 'quarters' && <span className="style-led active" />}
                      </div>
                      <div className={`style-item-row ${pattern === 'eighths' ? 'active' : ''}`} onClick={() => setPattern('eighths')}>
                        <span className="style-name">Corcheas ♪</span>
                        {pattern === 'eighths' && <span className="style-led active" />}
                      </div>
                      <div className={`style-item-row ${pattern === 'pop' ? 'active' : ''}`} onClick={() => setPattern('pop')}>
                        <span className="style-name">Pop 🎹</span>
                        {pattern === 'pop' && <span className="style-led active" />}
                      </div>
                      <div className={`style-item-row ${pattern === 'arpeggio' ? 'active' : ''}`} onClick={() => setPattern('arpeggio')}>
                        <span className="style-name">Arp ⬈⬊</span>
                        {pattern === 'arpeggio' && <span className="style-led active" />}
                      </div>
                      <div className={`style-item-row ${pattern === 'strum' ? 'active' : ''}`} onClick={() => setPattern('strum')}>
                        <span className="style-name">Strum 🎸</span>
                        {pattern === 'strum' && <span className="style-led active" />}
                      </div>
                      
                      {customPatterns.length > 0 && (
                        <>
                          <div className="styles-separator" />
                          <div className="styles-section-label">Patrones MIDI</div>
                          {customPatterns.map(p => (
                            <div key={p.name} className={`style-item-row ${pattern === p.name ? 'active' : ''}`} onClick={() => setPattern(p.name)}>
                              <span className="style-name">{p.name}</span>
                              {pattern === p.name && <span className="style-led active" />}
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    <button 
                      className={`refresh-styles-btn ${isRefreshing ? 'refreshing' : ''}`}
                      onClick={handleRefreshPatterns}
                    >
                      <RefreshCw size={12} className={isRefreshing ? 'spin-icon' : ''} style={{ marginRight: '6px' }} />
                      {isRefreshing ? 'Buscando...' : 'Actualizar'}
                    </button>
                  </div>
                )}

                {styleTab === 'sounds' && (() => {
                  const currentChannelId = activeView === 'chord' ? 'chords' : 'melody';
                  const currentChannel = channels[currentChannelId];
                  const currentInst = currentChannel?.instrument || 'synth';

                  return (
                    <div className="styles-tab-view">
                      <span style={{ fontSize: '0.68rem', color: 'var(--accent)', marginBottom: '8px', display: 'block', textTransform: 'uppercase', fontFamily: "'Share Tech Mono', monospace" }}>
                        Pista actual: {currentChannelId === 'chords' ? 'Armonía (Acordes)' : 'Melodía'}
                      </span>
                      <div className="style-list-group" ref={soundsListRef}>
                        <div 
                          className={`style-item-row ${currentInst === 'synth' ? 'active' : ''}`} 
                          onClick={() => setChannelInstrument(currentChannelId, 'synth')}
                        >
                          <span className="style-name">Sintetizador Virtual</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              className="synth-config-gear-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSynthModalOpen(true);
                                setStyleMenuOpen(false);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                padding: '2px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginRight: '2px'
                              }}
                              title="Configurar Sonido Sintetizador"
                            >
                              <SettingsIcon size={12} />
                            </button>
                            {currentInst === 'synth' && <span className="style-led active" />}
                          </div>
                        </div>
                        <div 
                          className={`style-item-row ${currentInst === 'piano' ? 'active' : ''}`} 
                          onClick={() => setChannelInstrument(currentChannelId, 'piano')}
                        >
                          <span className="style-name">Piano de Cola</span>
                          {currentInst === 'piano' && <span className="style-led active" />}
                        </div>
                      </div>
                    </div>
                  );
                })()}


                {styleTab === 'config' && (
                  <div className="config-tab-view">
                    {/* Compás */}
                    <div className="config-row">
                      <div className="config-field">
                        <label>Compás</label>
                        <CustomSelect
                          value={timeSignature}
                          onChange={(val) => setTimeSignature(val as any)}
                          options={[
                            { value: '4/4', label: '4/4 Standard' },
                            { value: '3/4', label: '3/4 Vals' },
                            { value: '6/8', label: '6/8 Swing' }
                          ]}
                        />
                      </div>
                    </div>

                    {/* Transposición de Acordes */}
                    <div className="config-row">
                      <div className="config-field">
                        <label>Transponer Acordes</label>
                        <CustomSelect
                          value={chordOctaveShift.toString()}
                          onChange={(val) => setChordOctaveShift(parseInt(val))}
                          options={[
                            { value: '-2', label: '-2 Octavas' },
                            { value: '-1', label: '-1 Octava' },
                            { value: '0', label: 'Normal (0)' },
                            { value: '1', label: '+1 Octava' },
                            { value: '2', label: '+2 Octavas' }
                          ]}
                        />
                      </div>
                    </div>

                    {/* Swing Ratio */}
                    <div className="config-row">
                      <div className="config-field">
                        <div className="label-val-row" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <label>Swing Ratio</label>
                          <span className="config-val-label" style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--accent)' }}>{swing}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={swing}
                          onChange={(e) => setSwing(parseInt(e.target.value))}
                          className="config-slider"
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>

                    {/* Sustain */}
                    <div className="config-row" style={{ marginTop: '10px' }}>
                      <div className="config-field flex-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="label-desc-group">
                          <label style={{ display: 'block', marginBottom: '0px' }}>Pedal Sustain</label>
                          <span className="field-desc" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>Resonancia en acordes</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={sustain}
                          onChange={(e) => setSustain(e.target.checked)}
                          style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: '16px', height: '16px' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Display Beat */}
        <BeatDisplay />
      </div>

      <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="file"
          id="import-midi"
          accept=".mid,.midi,.json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <label htmlFor="import-midi" className="action-btn" title="Importar">
          <FolderOpen size={16} />
        </label>

        <div className="export-dropdown-container" style={{ position: 'relative' }}>
          <button
            className="action-btn export"
            disabled={isAudioLoading}
            onClick={(e) => {
              e.stopPropagation();
              setExportDropdownOpen(!exportDropdownOpen);
            }}
            title="Exportar"
          >
            <Save size={16} />
          </button>
          {exportDropdownOpen && (
            <div className="export-dropdown-menu">
              <button className="export-dropdown-item" onClick={handleExportNormal}>
                Exportar Render (.mid)
              </button>
              <button className="export-dropdown-item" onClick={handleExportProject}>
                Guardar Proyecto (.json)
              </button>
            </div>
          )}
        </div>

        <button className="action-btn clear" disabled={isAudioLoading} onClick={handleClear} title="Limpiar composición">
          <Trash2 size={16} />
        </button>

        <div className="mock-sep" style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 4px' }}></div>

        {/* Botón de Mezclador de Audio */}
        <button
          className={`control-btn ${isMixerOpen ? 'active' : ''}`}
          onClick={() => setMixerOpen(!isMixerOpen)}
          title="Mezclador de Audio (Shift+M)"
          style={{ width: '36px', height: '36px' }}
        >
          <Sliders size={16} />
        </button>

        {/* Botón de Configuración lateral */}
        <button
          className={`control-btn ${isSettingsOpen ? 'active' : ''}`}
          onClick={() => setSettingsOpen(!isSettingsOpen)}
          title="Ajustes (Monitor CRT, Instrumentos, Ritmo)"
          style={{ width: '36px', height: '36px' }}
        >
          <SettingsIcon size={16} />
        </button>

      </div>
    </header>
  );
};
