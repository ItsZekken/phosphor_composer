import { useEffect, useState, useCallback, useRef } from 'react';
import { useStore } from 'zustand';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { toneEngine } from '../../audio/toneEngine';
import { NOTE_CLASSES, SCALE_INTERVALS } from '../../core/music';
import type { NoteClass, ScaleType } from '../../utils/typeDefinitions';
import { Play, Square, Trash2, RefreshCw, Bell, Settings as SettingsIcon, Sliders, FolderOpen, Save, RotateCcw, RotateCw } from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

import { exportSessionToMidi, importMidiToSession } from '../../utils/midiService';
import { exportSessionToJson } from '../../core/session';
import { ExportProgressModal } from '../ui/ExportProgressModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { PhosphorLogo } from '../ui/PhosphorLogo';

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
    isMixerOpen,
    setMixerOpen,
    isExporting,
    exportProgress,
    timeSignature,
    pattern,
    instrumentType,
    customPatterns
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
    isMixerOpen: state.isMixerOpen,
    setMixerOpen: state.setMixerOpen,
    isExporting: state.isExporting,
    exportProgress: state.exportProgress,
    timeSignature: state.timeSignature,
    pattern: state.pattern,
    instrumentType: state.instrumentType,
    customPatterns: state.customPatterns
  })));

  // Estado local del BPM — solo escribe al store en onBlur/Enter
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const [confirmModalConfig, setConfirmModalConfig] = useState<{isOpen: boolean}>({isOpen: false});

  // Sincronizar si el store cambia externamente (ej: Tap BPM)
  useEffect(() => {
    setBpmInput(String(bpm));
  }, [bpm]);

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
    setConfirmModalConfig({ isOpen: true });
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
  const cancelExportRef = useRef<(() => void) | null>(null);
  const [exportElapsed, setExportElapsed] = useState(0);
  const [exportTotal, setExportTotal] = useState(0);

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

    const jsonString = exportSessionToJson(state, {
      title: `Phosphor Project ${key} ${scale}`
    });
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `phosphor_project_${key}_${scale}_${bpm}bpm.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportAudio = async () => {
    setExportDropdownOpen(false);
    if (chordBlocks.length === 0 && melodyNotes.length === 0) {
      alert('La canción está vacía. Agrega notas o acordes primero.');
      return;
    }

    setExportElapsed(0);
    setExportTotal(0);

    const cancelFn = toneEngine.exportToWav(
      (elapsed, total) => {
        setExportElapsed(elapsed);
        setExportTotal(total);
      },
      (wavBlob) => {
        cancelExportRef.current = null;
        const url = URL.createObjectURL(wavBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `phosphor_${key}_${scale}_${bpm}bpm_render.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
      (err) => {
        cancelExportRef.current = null;
        alert('Error al exportar audio: ' + err.message);
      }
    );

    cancelExportRef.current = cancelFn;
  };

  const handleExportCompressedAudio = async () => {
    setExportDropdownOpen(false);
    if (chordBlocks.length === 0 && melodyNotes.length === 0) {
      alert('La canción está vacía. Agrega notas o acordes primero.');
      return;
    }

    setExportElapsed(0);
    setExportTotal(0);

    const cancelFn = toneEngine.exportToCompressed(
      (elapsed, total) => {
        setExportElapsed(elapsed);
        setExportTotal(total);
      },
      ({ blob, extension }) => {
        cancelExportRef.current = null;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `phosphor_${key}_${scale}_${bpm}bpm_render.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
      (err) => {
        cancelExportRef.current = null;
        alert('Error al exportar audio comprimido: ' + err.message);
      }
    );

    cancelExportRef.current = cancelFn;
  };

  const handleCancelExport = () => {
    if (cancelExportRef.current) {
      cancelExportRef.current();
      cancelExportRef.current = null;
    }
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
          importSong(jsonStr);
        } catch (err) {
          alert('Error leyendo proyecto JSON: ' + (err as Error).message);
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
              chordOctaveShift: (result as any).chordOctaveShift ?? 0,
              channels: result.channels,
              drumChannels: result.drumChannels,
              patternChain: result.patternChain,
              isPatternRepeatOn: result.isPatternRepeatOn,
              activeDrumKitId: result.activeDrumKitId
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
    <>
    <header className="app-header">
      <div className="header-brand">
        <h1 className="phosphor-text">
          <PhosphorLogo size={22} style={{ marginRight: '6px' }} />
          PHOSPHOR
        </h1>
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
            Cargando...
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
                Auto{detectedKey ? ` · ${detectedKey}` : ''}
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

        {/* Botones de Deshacer (Undo) y Rehacer (Redo) de íconos limpios */}
        {(() => {
          const temporalStore = useStore(useSongStore.temporal);
          const canUndo = temporalStore.pastStates.length > 0;
          const canRedo = temporalStore.futureStates.length > 0;

          return (
            <div className="control-group undo-redo-group" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button
                className="control-btn undo-btn"
                onClick={() => temporalStore.undo()}
                disabled={!canUndo || isAudioLoading}
                title={canUndo ? 'Deshacer acción (Ctrl+Z)' : 'Nada que deshacer'}
                style={{ opacity: canUndo ? 1 : 0.4, width: '34px', height: '34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <RotateCcw size={16} />
              </button>
              <button
                className="control-btn redo-btn"
                onClick={() => temporalStore.redo()}
                disabled={!canRedo || isAudioLoading}
                title={canRedo ? 'Rehacer acción (Ctrl+Y)' : 'Nada que rehacer'}
                style={{ opacity: canRedo ? 1 : 0.4, width: '34px', height: '34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <RotateCw size={16} />
              </button>
            </div>
          );
        })()}

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
            disabled={isAudioLoading || isExporting}
            onClick={(e) => {
              e.stopPropagation();
              setExportDropdownOpen(!exportDropdownOpen);
            }}
            title={isExporting ? 'Exportando audio...' : 'Exportar'}
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
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
              <button className="export-dropdown-item" onClick={handleExportAudio}>
                Exportar Audio (.wav)
              </button>
              <button className="export-dropdown-item" onClick={handleExportCompressedAudio}>
                Exportar Audio Comprimido (.ogg / .webm)
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

    {/* Modal de progreso de export de audio */}
    {isExporting && (
      <ExportProgressModal
        progress={exportProgress}
        elapsed={exportElapsed}
        total={exportTotal}
        onCancel={handleCancelExport}
      />
    )}

    <ConfirmModal
      isOpen={confirmModalConfig.isOpen}
      title="Limpiar Canción"
      message="¿Estás seguro de que quieres limpiar toda la canción? Se perderán todos los datos actuales."
      confirmText="Limpiar Todo"
      cancelText="Cancelar"
      onConfirm={() => {
        clearSong();
        toneEngine.stop();
        setConfirmModalConfig({ isOpen: false });
      }}
      onCancel={() => setConfirmModalConfig({ isOpen: false })}
    />
  </>  
  );
};
