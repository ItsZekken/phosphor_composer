import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useStore } from 'zustand';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { toneEngine } from '../../audio/toneEngine';
import { NOTE_CLASSES, SCALE_INTERVALS, createTempoMap } from '../../core/music';
import type { NoteClass, ScaleType } from '../../utils/typeDefinitions';
import {
  Play,
  Pause,
  Square,
  Trash2,
  RefreshCw,
  Settings as SettingsIcon,
  Sliders,
  FolderOpen,
  Save,
  RotateCcw,
  RotateCw,
  Command,
  Check,
  Pencil
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';
import { MetronomeIcon } from '../ui/MetronomeIcon';

import { exportSessionToMidi } from '../../utils/midiService';
import { exportSessionToJson, exportProjectToPhosBundle } from '../../core/session';
import { importProjectFile, sanitizeExportBaseName } from '../../core/session/projectFileImport';
import { notify } from '../../core/ui/toastBus';
import { ExportProgressModal } from '../ui/ExportProgressModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { PhosphorLogo } from '../ui/PhosphorLogo';
import { SaveExportModal } from './SaveExportModal';

type TimeDisplayMode = 'beat' | 'bar' | 'time';

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const BeatDisplay = () => {
  const spanRef = useRef<HTMLButtonElement>(null);
  const isPlaying = useSongStore((state) => state.isPlaying);
  const staticBeat = useSongStore((state) => state.currentBeat);
  const timeSignature = useSongStore((state) => state.timeSignature || '4/4');
  const bpm = useSongStore((state) => state.bpm || 120);
  const tempoMarkers = useSongStore((state) => state.tempoMarkers || []);
  const [displayMode, setDisplayMode] = useState<TimeDisplayMode>('beat');

  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;

  const formatReadout = useCallback(
    (beat: number, seconds?: number) => {
      const safeBeat = Math.max(0, beat);
      if (displayMode === 'bar') {
        const bar = Math.floor(safeBeat / beatsPerMeasure) + 1;
        const sub = Math.floor(safeBeat % beatsPerMeasure) + 1;
        return `Bar ${String(bar).padStart(2, '0')}.${sub}`;
      }
      if (displayMode === 'time') {
        const sec = seconds !== undefined ? seconds : createTempoMap(bpm, tempoMarkers).beatToSeconds(safeBeat);
        return `Time ${formatClock(sec)}`;
      }
      return `Beat: ${safeBeat.toFixed(2)}`;
    },
    [displayMode, beatsPerMeasure, bpm, tempoMarkers]
  );

  useEffect(() => {
    if (!isPlaying) {
      if (spanRef.current) {
        spanRef.current.textContent = formatReadout(staticBeat);
      }
      return;
    }

    let rafId = 0;
    const update = () => {
      if (spanRef.current) {
        const liveBeat = toneEngine.getLiveBeat();
        const liveSec = displayMode === 'time' ? toneEngine.getLiveSeconds() : undefined;
        spanRef.current.textContent = formatReadout(liveBeat, liveSec);
      }
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, staticBeat, formatReadout, displayMode]);

  const cycleMode = () => {
    setDisplayMode((prev) => (prev === 'beat' ? 'bar' : prev === 'bar' ? 'time' : 'beat'));
  };

  return (
    <button
      ref={spanRef}
      type="button"
      className="beat-display beat-display-btn"
      onClick={cycleMode}
      title="Clic para alternar formato: Beat · Compás · Tiempo (mm:ss)"
      style={{ fontFamily: '"Share Tech Mono", monospace' }}
    >
      {formatReadout(staticBeat)}
    </button>
  );
};

export const Header = () => {
  const {
    projectTitle,
    setProjectTitle,
    lastSavedAt,
    setCommandPaletteMode,
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
    clearSong,
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
    exportPhase,
    customPatterns
  } = useSongStore(
    useShallow((state) => ({
      projectTitle: state.projectTitle || 'Sin título',
      setProjectTitle: state.setProjectTitle,
      lastSavedAt: state.lastSavedAt,
      setCommandPaletteMode: state.setCommandPaletteMode,
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
      clearSong: state.clearSong,
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
      exportPhase: state.exportPhase,
      customPatterns: state.customPatterns
    }))
  );

  // Selector booleano ligero: mover faders/pan/knobs no re-renderiza el Header
  const { hasAnySolo, hasAnyMute } = useSongStore(
    useShallow((state) => {
      let solo = false;
      let mute = false;
      const chs = state.channels || {};
      for (const id in chs) {
        const ch = chs[id];
        if (!ch || ch.id === 'master') continue;
        if (ch.solo) solo = true;
        if (ch.muted) mute = true;
      }
      const audioTracks = state.audioTracks || [];
      for (let i = 0; i < audioTracks.length; i++) {
        if (audioTracks[i].solo) solo = true;
        if (audioTracks[i].muted) mute = true;
      }
      return { hasAnySolo: solo, hasAnyMute: mute };
    })
  );

  // Edición inline del título de proyecto
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(projectTitle);
  const [showSavedPulse, setShowSavedPulse] = useState(false);

  useEffect(() => {
    setTitleDraft(projectTitle);
  }, [projectTitle]);

  useEffect(() => {
    if (!lastSavedAt) return;
    setShowSavedPulse(true);
    const t = window.setTimeout(() => setShowSavedPulse(false), 2200);
    return () => window.clearTimeout(t);
  }, [lastSavedAt]);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    setProjectTitle(trimmed || 'Sin título');
    setTitleDraft(trimmed || 'Sin título');
    setIsEditingTitle(false);
  };

  // Estado local del BPM + soporte de arrastre vertical estilo DAW
  const liveBpm = useSongStore((state) => state.liveBpm);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const [isDraggingBpm, setIsDraggingBpm] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{ isOpen: boolean }>({ isOpen: false });
  const bpmDragRef = useRef<{ startY: number; startBpm: number; moved: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isDraggingBpm) {
      setBpmInput(String(isPlaying ? liveBpm || bpm : bpm));
    }
  }, [bpm, liveBpm, isPlaying, isDraggingBpm]);

  const commitBpm = useCallback(
    (raw: string) => {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed)) {
        const clamped = Math.max(15, Math.min(999, parsed));
        setBpm(clamped);
        setBpmInput(String(clamped));
      } else {
        setBpmInput(String(bpm));
      }
    },
    [bpm, setBpm]
  );

  const handleBpmPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (isAudioLoading || e.button !== 0) return;
    bpmDragRef.current = { startY: e.clientY, startBpm: bpm, moved: false };
    const target = e.currentTarget;

    const onMove = (ev: PointerEvent) => {
      const state = bpmDragRef.current;
      if (!state) return;
      const dy = state.startY - ev.clientY;
      if (!state.moved && Math.abs(dy) < 4) return;
      if (!state.moved) {
        state.moved = true;
        setIsDraggingBpm(true);
        target.blur();
      }
      const sensitivity = ev.shiftKey ? 0.15 : 0.6;
      const nextBpm = Math.max(15, Math.min(999, Math.round(state.startBpm + dy * sensitivity)));
      setBpmInput(String(nextBpm));
      setBpm(nextBpm);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (bpmDragRef.current?.moved) {
        setIsDraggingBpm(false);
      }
      bpmDragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Historial de clicks para Tap BPM
  const [tapTimes, setTapTimes] = useState<number[]>([]);

  const handlePlayToggle = async () => {
    try {
      await toneEngine.init(true);
      const current = useSongStore.getState().isPlaying;
      setPlaying(!current);
    } catch (e) {
      console.error('[Header] Error al iniciar/pausar reproducción:', e);
    }
  };

  const handleStop = () => {
    toneEngine.stop();
  };

  const handleClear = () => {
    setConfirmModalConfig({ isOpen: true });
  };

  const handleTapBPM = () => {
    setTapFlash(true);
    window.setTimeout(() => setTapFlash(false), 140);

    const now = Date.now();
    const filteredTimes = tapTimes.filter((t) => now - t < 2000);
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

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const cancelExportRef = useRef<(() => void) | null>(null);
  const [exportElapsed, setExportElapsed] = useState(0);
  const [exportTotal, setExportTotal] = useState(0);

  const isSongEmpty = (state: ReturnType<typeof useSongStore.getState>, includeAudio = true): boolean => {
    const hasChords = Boolean(state.chordBlocks && state.chordBlocks.length > 0);
    const hasTracks = Boolean(state.tracks && state.tracks.some((t) => t.notes && t.notes.length > 0));
    const hasMelody = Boolean(state.melodyNotes && state.melodyNotes.length > 0);
    const hasDrums =
      Boolean(state.drumChannels && state.drumChannels.some((ch) => ch.patterns && ch.patterns.some((p) => p.some((s) => s?.isActive)))) ||
      Boolean(state.patternChain && state.patternChain.length > 0);
    const hasAudioClips = includeAudio && Boolean(state.audioClips && state.audioClips.length > 0);
    return !hasChords && !hasTracks && !hasMelody && !hasDrums && !hasAudioClips;
  };

  const getExportBaseName = useCallback(
    (state: ReturnType<typeof useSongStore.getState>) => {
      const hasCustomTitle = Boolean(state.projectTitle && state.projectTitle !== 'Sin título');
      if (hasCustomTitle) {
        return sanitizeExportBaseName(state.projectTitle);
      }
      return `phosphor_${state.key}_${state.scale}_${state.bpm}bpm`;
    },
    []
  );

  const handleExportNormal = () => {
    setIsSaveModalOpen(false);
    const state = useSongStore.getState();
    if (isSongEmpty(state, false)) {
      notify.warning('La canción está vacía', 'Agrega notas, acordes o patrones de batería primero.');
      return;
    }

    const midiArray = exportSessionToMidi(
      {
        bpm: state.bpm,
        tempoMarkers: state.tempoMarkers || [],
        timeSignature: state.timeSignature,
        key: state.key,
        scale: state.scale,
        pattern: state.pattern,
        chordOctaveShift: state.chordOctaveShift,
        chordBlocks: state.chordBlocks,
        styleMarkers: state.styleMarkers || [],
        tracks: state.tracks,
        melodyNotes: state.melodyNotes,
        drumChannels: state.drumChannels,
        patternChain: state.patternChain,
        isPatternRepeatOn: state.isPatternRepeatOn,
        patternLengths: state.patternLengths,
        currentDrumPatternEdit: state.currentDrumPatternEdit,
        channels: state.channels,
        customPatterns: state.customPatterns,
        activeDrumKitId: state.activeDrumKitId
      },
      'normal'
    );

    const filename = `${getExportBaseName(state)}.mid`;
    downloadMidiFile(midiArray, filename);
    notify.success('MIDI exportado', filename);
  };

  const handleExportProject = useCallback(async () => {
    setIsSaveModalOpen(false);
    const state = useSongStore.getState();
    if (isSongEmpty(state, true)) {
      notify.warning('La canción está vacía', 'Agrega notas, acordes, batería o pistas de audio primero.');
      return;
    }

    try {
      const titleForMeta =
        state.projectTitle && state.projectTitle !== 'Sin título'
          ? state.projectTitle
          : `Phosphor Project ${state.key} ${state.scale}`;
      const result = await exportProjectToPhosBundle(state, { title: titleForMeta });
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify.success('Paquete .phos exportado', result.filename);
    } catch (err) {
      notify.error('Error al exportar paquete .phos', (err as Error).message);
    }
  }, []);

  const handleExportJson = () => {
    setIsSaveModalOpen(false);
    const state = useSongStore.getState();
    if (isSongEmpty(state, true)) {
      notify.warning('La canción está vacía', 'Agrega notas, acordes, batería o pistas de audio primero.');
      return;
    }

    const titleForMeta =
      state.projectTitle && state.projectTitle !== 'Sin título'
        ? state.projectTitle
        : `Phosphor Project ${state.key} ${state.scale}`;
    const jsonString = exportSessionToJson(state, { title: titleForMeta });
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `${getExportBaseName(state)}.json`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    notify.success('Proyecto JSON exportado', filename);
  };

  const handleExportAudio = async (realtime?: boolean) => {
    setIsSaveModalOpen(false);
    const state = useSongStore.getState();
    if (isSongEmpty(state, true)) {
      notify.warning('La canción está vacía', 'Agrega notas, acordes, batería o pistas de audio primero.');
      return;
    }

    setExportElapsed(0);
    setExportTotal(0);
    const filename = `${getExportBaseName(state)}.wav`;

    const cancelFn = toneEngine.exportToWav(
      realtime,
      (elapsed, total) => {
        setExportElapsed(elapsed);
        setExportTotal(total);
      },
      (wavBlob) => {
        cancelExportRef.current = null;
        const url = URL.createObjectURL(wavBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        notify.success('Audio WAV exportado', filename);
      },
      (err) => {
        cancelExportRef.current = null;
        notify.error('Error al exportar audio WAV', err.message);
      }
    );

    cancelExportRef.current = cancelFn;
  };

  const handleExportCompressedAudio = async (format: 'mp3' | 'm4a', realtime?: boolean) => {
    setIsSaveModalOpen(false);
    const state = useSongStore.getState();
    if (isSongEmpty(state, true)) {
      notify.warning('La canción está vacía', 'Agrega notas, acordes, batería o pistas de audio primero.');
      return;
    }

    setExportElapsed(0);
    setExportTotal(0);
    const baseName = getExportBaseName(state);

    const cancelFn = toneEngine.exportToCompressed(
      format,
      realtime,
      (elapsed, total) => {
        setExportElapsed(elapsed);
        setExportTotal(total);
      },
      ({ blob, extension }) => {
        cancelExportRef.current = null;
        const filename = `${baseName}.${extension}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        notify.success(`Audio ${extension.toUpperCase()} exportado`, filename);
      },
      (err) => {
        cancelExportRef.current = null;
        notify.error('Error al exportar audio comprimido', err.message);
      }
    );

    cancelExportRef.current = cancelFn;
  };

  const handleCancelExport = () => {
    if (cancelExportRef.current) {
      cancelExportRef.current();
      cancelExportRef.current = null;
      notify.info('Exportación cancelada');
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
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importProjectFile(file);
    e.target.value = '';
  };

  // Escuchar atajos globales Ctrl+S / Ctrl+Shift+S / Ctrl+O desde App y CommandPalette
  useEffect(() => {
    const onOpenSave = () => setIsSaveModalOpen(true);
    const onQuickSavePhos = () => {
      handleExportProject();
    };
    const onOpenImport = () => fileInputRef.current?.click();

    window.addEventListener('phosphor-open-save-modal', onOpenSave);
    window.addEventListener('phosphor-quick-save-phos', onQuickSavePhos);
    window.addEventListener('phosphor-open-import-file', onOpenImport);
    return () => {
      window.removeEventListener('phosphor-open-save-modal', onOpenSave);
      window.removeEventListener('phosphor-quick-save-phos', onQuickSavePhos);
      window.removeEventListener('phosphor-open-import-file', onOpenImport);
    };
  }, [handleExportProject]);

  useEffect(() => {
    toneEngine.init(false);
  }, []);

  // Mantener referencia a customPatterns para reactividad si cambia
  void customPatterns;

  return (
    <>
      <header className="app-header">
        <div className="header-brand">
          <h1 className="phosphor-text">
            <PhosphorLogo size={22} style={{ marginRight: '6px' }} />
            PHOSPHOR
          </h1>

          {/* Nombre editable del proyecto + indicador sutil de autoguardado */}
          <div className="header-project-meta">
            {isEditingTitle ? (
              <input
                type="text"
                className="header-project-title-input"
                value={titleDraft}
                maxLength={48}
                autoFocus
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') {
                    setTitleDraft(projectTitle);
                    setIsEditingTitle(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="header-project-title-btn"
                onClick={() => setIsEditingTitle(true)}
                title="Clic para renombrar el proyecto (se usa al exportar)"
              >
                <span className="header-project-title-text">{projectTitle}</span>
                <Pencil size={10} className="header-title-edit-icon" />
              </button>
            )}
            {showSavedPulse && (
              <span className="header-autosave-pill" title="Sesión guardada automáticamente en este navegador">
                <Check size={10} />
              </span>
            )}
          </div>

          {isAudioLoading && (
            <span
              className="audio-loading-indicator"
              style={{
                fontSize: '11px',
                color: '#a855f7',
                marginLeft: '10px',
                background: 'rgba(168, 85, 247, 0.1)',
                padding: '2px 8px',
                borderRadius: '4px',
                border: '1px solid rgba(168, 85, 247, 0.2)',
                animation: 'pulse-badge 1.5s infinite'
              }}
            >
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
              title={isAudioLoading ? 'Cargando samples...' : 'Reproducir / Pausar (Espacio)'}
            >
              {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} />}
            </button>
            <button
              className="control-btn stop"
              onClick={handleStop}
              disabled={isAudioLoading}
              title={isAudioLoading ? 'Cargando...' : 'Detener y volver al inicio (W / Home)'}
            >
              <Square size={17} fill="currentColor" />
            </button>
            <button
              className={`control-btn loop-toggle ${isLooping ? 'active' : ''}`}
              onClick={() => setLooping(!isLooping)}
              disabled={isAudioLoading}
              title={isAudioLoading ? 'Cargando...' : 'Repeat / Loop (R)'}
            >
              <RefreshCw size={16} />
            </button>

            {/* Botón Metrónomo */}
            <button
              className={`control-btn metro-toggle ${isMetronomeActive ? 'active' : ''}`}
              onClick={() => setMetronomeActive(!isMetronomeActive)}
              disabled={isAudioLoading}
              title={isAudioLoading ? 'Cargando...' : 'Metrónomo (K)'}
            >
              <MetronomeIcon size={16} />
            </button>
          </div>

          {/* BPM Arrastrable + Tap Tempo */}
          <div className="control-group text-input bpm-container">
            <label>BPM</label>
            <input
              type="text"
              inputMode="numeric"
              className={`bpm-drag-input ${isDraggingBpm ? 'dragging' : ''}`}
              value={bpmInput}
              disabled={isAudioLoading}
              title="Arrastra arriba/abajo para cambiar BPM (Shift = fino) · Clic para escribir"
              onPointerDown={handleBpmPointerDown}
              onChange={(e) => setBpmInput(e.target.value)}
              onBlur={(e) => commitBpm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitBpm((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              style={{ width: '52px', textAlign: 'center' }}
            />
            <button
              className={`tap-bpm-btn ${tapFlash ? 'tap-flash' : ''}`}
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
                options={NOTE_CLASSES.map((n) => ({ value: n, label: n }))}
                style={{ minWidth: '50px' }}
              />
              <CustomSelect
                value={scale}
                disabled={isAudioLoading}
                onChange={(val) => setScale(val as ScaleType)}
                options={Object.keys(SCALE_INTERVALS).map((s) => ({ value: s, label: s }))}
                style={{ minWidth: '85px' }}
              />
            </div>
          </div>

          {/* Botones de Deshacer (Undo) y Rehacer (Redo) */}
          {(() => {
            const temporalStore = useStore(useSongStore.temporal);
            const canUndo = temporalStore.pastStates.length > 0;
            const canRedo = temporalStore.futureStates.length > 0;

            return (
              <div className="control-group undo-redo-group" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <button
                  className="control-btn undo-btn"
                  onClick={() => {
                    if (canUndo) {
                      temporalStore.undo();
                      notify.info('Acción deshecha', undefined, 1600);
                    }
                  }}
                  disabled={!canUndo || isAudioLoading}
                  title={canUndo ? 'Deshacer acción (Ctrl+Z)' : 'Nada que deshacer'}
                  style={{ opacity: canUndo ? 1 : 0.4, width: '34px', height: '34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  className="control-btn redo-btn"
                  onClick={() => {
                    if (canRedo) {
                      temporalStore.redo();
                      notify.info('Acción rehecha', undefined, 1600);
                    }
                  }}
                  disabled={!canRedo || isAudioLoading}
                  title={canRedo ? 'Rehacer acción (Ctrl+Shift+Z / Ctrl+Y)' : 'Nada que rehacer'}
                  style={{ opacity: canRedo ? 1 : 0.4, width: '34px', height: '34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <RotateCw size={16} />
                </button>
              </div>
            );
          })()}

          {/* Display Beat / Compás / Tiempo */}
          <BeatDisplay />
        </div>

        <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            id="import-midi"
            accept=".phos,.zip,.json,.mid,.midi,.wav,.mp3,.ogg,.flac"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <label htmlFor="import-midi" className="action-btn" title="Importar proyecto o audio (Ctrl+O)">
            <FolderOpen size={16} />
          </label>

          <button
            className={`action-btn export ${isSaveModalOpen ? 'active' : ''}`}
            disabled={isAudioLoading || isExporting}
            onClick={() => setIsSaveModalOpen(true)}
            title={isExporting ? 'Exportando audio...' : 'Guardar / Exportar (Ctrl+S · Ctrl+Shift+S = .phos)'}
          >
            <Save size={16} />
          </button>

          <button className="action-btn clear" disabled={isAudioLoading} onClick={handleClear} title="Limpiar composición">
            <Trash2 size={16} />
          </button>

          <div className="mock-sep" style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

          {/* Paleta de Comandos y Atajos */}
          <button
            className="control-btn"
            onClick={() => setCommandPaletteMode('commands')}
            title="Paleta de Comandos y Atajos (Ctrl+K / ?)"
            style={{ width: '36px', height: '36px' }}
          >
            <Command size={15} />
          </button>

          {/* Botón de Mezclador de Audio con badge de Solo/Mute */}
          <button
            className={`control-btn mixer-header-btn ${isMixerOpen ? 'active' : ''}`}
            onClick={() => setMixerOpen(!isMixerOpen)}
            title={
              hasAnySolo
                ? 'Mezclador de Audio (Shift+M) · Hay pistas en SOLO'
                : hasAnyMute
                ? 'Mezclador de Audio (Shift+M) · Hay pistas silenciadas (MUTE)'
                : 'Mezclador de Audio (Shift+M)'
            }
            style={{ width: '36px', height: '36px', position: 'relative' }}
          >
            <Sliders size={16} />
            {hasAnySolo ? (
              <span className="mixer-status-badge badge-solo">S</span>
            ) : hasAnyMute ? (
              <span className="mixer-status-badge badge-mute">M</span>
            ) : null}
          </button>

          {/* Botón de Configuración lateral */}
          <button
            className={`control-btn ${isSettingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen(!isSettingsOpen)}
            title="Ajustes (Monitor CRT, Teclado, Compás, Ritmo)"
            style={{ width: '36px', height: '36px' }}
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {/* Modal de progreso de export de audio */}
      {isExporting && (
        <ExportProgressModal
          phase={exportPhase}
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
          notify.info('Proyecto reiniciado');
        }}
        onCancel={() => setConfirmModalConfig({ isOpen: false })}
      />

      <SaveExportModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onExportProject={handleExportProject}
        onExportJson={handleExportJson}
        onExportMidi={handleExportNormal}
        onExportAudio={handleExportAudio}
        onExportCompressedAudio={handleExportCompressedAudio}
        isExporting={isExporting}
      />
    </>
  );
};
