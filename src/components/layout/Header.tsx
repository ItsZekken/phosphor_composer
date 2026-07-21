import { useEffect, useState, useCallback, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { toneEngine } from '../../audio/toneEngine';
import { NOTE_CLASSES, SCALE_INTERVALS } from '../../engine/scaleDefinitions';
import type { NoteClass, ScaleType } from '../../utils/typeDefinitions';
import { Play, Square, Trash2, Music, RefreshCw, Bell, Settings as SettingsIcon } from 'lucide-react';
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
    isSynthModalOpen,
    setSynthModalOpen,
    instrumentType,
    setInstrumentType,
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
    refreshPatterns
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
    isSynthModalOpen: state.isSynthModalOpen,
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
    refreshPatterns: state.refreshPatterns
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
    }, 'project');

    downloadMidiFile(midiArray, `phosphor_project_${key}_${scale}_${bpm}bpm.mid`);
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

  const handleImportMIDI = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
            isAutoKey: !result.isProject
          });
          alert(result.message);
        } else {
          alert('Error: ' + result.message);
        }
      } catch (err) {
        console.error(err);
        alert('Ocurrió un error al procesar el archivo MIDI. Verifica que sea un formato MIDI válido.');
      }
    };
    reader.readAsArrayBuffer(file);
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
          <div className="key-selectors-row">
            <div className="custom-select-wrapper">
              <select value={key} disabled={isAudioLoading} onChange={(e) => setKey(e.target.value as NoteClass)}>
                {NOTE_CLASSES.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="custom-select-wrapper">
              <select value={scale} disabled={isAudioLoading} onChange={(e) => setScale(e.target.value as ScaleType)}>
                {Object.keys(SCALE_INTERVALS).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
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

                {styleTab === 'sounds' && (
                  <div className="styles-tab-view">
                    <div className="style-list-group" ref={soundsListRef}>
                      <div className={`style-item-row ${instrumentType === 'synth' ? 'active' : ''}`} onClick={() => setInstrumentType('synth')}>
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
                          {instrumentType === 'synth' && <span className="style-led active" />}
                        </div>
                      </div>
                      <div className={`style-item-row ${instrumentType === 'piano' ? 'active' : ''}`} onClick={() => setInstrumentType('piano')}>
                        <span className="style-name">Piano de Cola</span>
                        {instrumentType === 'piano' && <span className="style-led active" />}
                      </div>
                    </div>
                  </div>
                )}

                {styleTab === 'config' && (
                  <div className="config-tab-view">
                    {/* Compás */}
                    <div className="config-row">
                      <div className="config-field">
                        <label>Compás</label>
                        <div className="custom-select-wrapper">
                          <select 
                            value={timeSignature} 
                            onChange={(e) => setTimeSignature(e.target.value as any)}
                          >
                            <option value="4/4">4/4 Standard</option>
                            <option value="3/4">3/4 Vals</option>
                            <option value="6/8">6/8 Swing</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Transposición de Acordes */}
                    <div className="config-row">
                      <div className="config-field">
                        <label>Transponer Acordes</label>
                        <div className="custom-select-wrapper">
                          <select 
                            value={chordOctaveShift} 
                            onChange={(e) => setChordOctaveShift(parseInt(e.target.value))}
                          >
                            <option value="-2">-2 Octavas</option>
                            <option value="-1">-1 Octava</option>
                            <option value="0">Normal (0)</option>
                            <option value="1">+1 Octava</option>
                            <option value="2">+2 Octavas</option>
                          </select>
                        </div>
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
          accept=".mid,.midi"
          style={{ display: 'none' }}
          id="midi-import-input"
          onChange={handleImportMIDI}
        />
        <label
          htmlFor={isAudioLoading ? undefined : 'midi-import-input'}
          className={`action-btn import`}
          style={{
            opacity: isAudioLoading ? 0.5 : 1,
            cursor: isAudioLoading ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            margin: 0
          }}
          title="Importar archivo MIDI"
        >
          <Music size={16} style={{ marginRight: '6px' }} />
          Importar
        </label>

        <div className="export-dropdown-container" style={{ position: 'relative' }}>
          <button
            className="action-btn export"
            disabled={isAudioLoading}
            onClick={(e) => {
              e.stopPropagation();
              setExportDropdownOpen(!exportDropdownOpen);
            }}
            title="Exportar archivo MIDI"
          >
            <Music size={16} style={{ marginRight: '6px' }} />
            Exportar
          </button>
          {exportDropdownOpen && (
            <div
              className="custom-context-menu"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '8px',
                minWidth: '220px',
                zIndex: 1000
              }}
            >
              <div className="menu-header">Opciones de Exportación</div>
              <button onClick={handleExportNormal}>
                🎹 MIDI Estándar (con Ritmo)
              </button>
              <button onClick={handleExportProject}>
                💾 MIDI de Proyecto (Completo)
              </button>
            </div>
          )}
        </div>

        <button className="action-btn clear" disabled={isAudioLoading} onClick={handleClear} title="Limpiar composición">
          <Trash2 size={16} />
        </button>

        <div className="mock-sep" style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 4px' }}></div>

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
