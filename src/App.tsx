import React, { useEffect, useState, Suspense } from 'react';
import { Header } from './components/layout/Header';
import { ViewToggle } from './components/layout/ViewToggle';
import { GlobalScrubber } from './components/layout/GlobalScrubber';
import { useSongStore } from './store/songStore';
import { toneEngine } from './audio/toneEngine';
import { loadCustomPatterns } from './patterns/patternLoader';
import { PianoVisualizer } from './components/piano-roll/PianoVisualizer';
import { CRTOverlay } from './components/ui/CRTOverlay';
import { GlobalLoader } from './components/ui/GlobalLoader';
import { ToastContainer } from './components/ui/ToastContainer';
import { GlobalDropZone } from './components/ui/GlobalDropZone';
import { CommandPaletteModal } from './components/ui/CommandPaletteModal';
import { exportSessionToJson } from './core/session';
import { isTypingTarget, isModalBlockingShortcuts } from './core/shortcuts/isTypingTarget';
import { notify } from './core/ui/toastBus';

// Carga bajo demanda (Code-Splitting) para optimizar memoria y tiempo de carga inicial
const ChordPlayerView = React.lazy(() => import('./components/chord-player/ChordPlayerView').then(m => ({ default: m.ChordPlayerView })));
const PianoRollView = React.lazy(() => import('./components/piano-roll/PianoRollView').then(m => ({ default: m.PianoRollView })));
const DrumSequencerView = React.lazy(() => import('./components/sequencer/DrumSequencerView').then(m => ({ default: m.DrumSequencerView })));
const AudioTracksView = React.lazy(() => import('./components/audio-tracks/AudioTracksView').then(m => ({ default: m.AudioTracksView })));
const StageVisualizerView = React.lazy(() => import('./components/visualizer/StageVisualizerView').then(m => ({ default: m.StageVisualizerView })));
const SettingsPanel = React.lazy(() => import('./components/ui/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const SynthConfigModal = React.lazy(() => import('./components/ui/SynthConfigModal').then(m => ({ default: m.SynthConfigModal })));
const MixerDrawer = React.lazy(() => import('./components/ui/MixerDrawer').then(m => ({ default: m.MixerDrawer })));

export default function App() {
  const activeView = useSongStore(state => state.activeView);
  const setCustomPatterns = useSongStore(state => state.setCustomPatterns);
  const isCrtEnabled = useSongStore(state => state.isCrtEnabled);

  const [isLoaded, setIsLoaded] = useState(false);
  const [hasVisitedPianoRoll, setHasVisitedPianoRoll] = useState(false);

  const isChordView = activeView === 'chord';
  const isPianoRollView = activeView === 'piano-roll' || (activeView as string) === 'piano';

  useEffect(() => {
    if (isPianoRollView) {
      setHasVisitedPianoRoll(true);
    }
  }, [isPianoRollView]);

  // Pre-montaje Keep-Alive en tiempo de inactividad (idle) para que alternar entre Chord y Piano Roll tome 0ms
  useEffect(() => {
    const idleTimer = window.setTimeout(() => {
      setHasVisitedPianoRoll(true);
    }, 1200);
    return () => {
      window.clearTimeout(idleTimer);
    };
  }, []);

  // 0. Cargar sesión guardada desde localStorage e inicializar patrones custom
  useEffect(() => {
    const saved = localStorage.getItem('phosphor_session');
    if (saved) {
      try {
        useSongStore.getState().importSong(saved);
      } catch (e) {
        console.error("Error cargando sesión persistida", e);
      }
    }
    setIsLoaded(true);

    loadCustomPatterns().then(patterns => {
      if (patterns.length > 0) setCustomPatterns(patterns);
    });
  }, [setCustomPatterns]);

  // Guardar estado reactivamente en localStorage con debounce (ante cualquier cambio real en slices musicales)
  useEffect(() => {
    if (!isLoaded) return;
    let timeoutId: number;

    const getMusicalSnapshot = (state: ReturnType<typeof useSongStore.getState>) => ({
      projectTitle: state.projectTitle,
      bpm: state.bpm,
      tempoMarkers: state.tempoMarkers,
      key: state.key,
      scale: state.scale,
      timeSignature: state.timeSignature,
      swing: state.swing,
      pattern: state.pattern,
      chordBlocks: state.chordBlocks,
      styleMarkers: state.styleMarkers,
      chordOctaveShift: state.chordOctaveShift,
      chordGridSnap: state.chordGridSnap,
      tracks: state.tracks,
      activeTrackId: state.activeTrackId,
      melodyNotes: state.melodyNotes,
      drumChannels: state.drumChannels,
      customDrumSamples: state.customDrumSamples,
      patternLengths: state.patternLengths,
      drumPatternNames: state.drumPatternNames,
      patternChain: state.patternChain,
      isPatternRepeatOn: state.isPatternRepeatOn,
      activeDrumKitId: state.activeDrumKitId,
      channels: state.channels,
      channelOrder: state.channelOrder,
      audioTracks: state.audioTracks,
      audioClips: state.audioClips,
      audioLatencyCalibrationMs: state.audioLatencyCalibrationMs,
    });

    let prevRefs = getMusicalSnapshot(useSongStore.getState());
    const musicalKeys = Object.keys(prevRefs) as Array<keyof typeof prevRefs>;

    const unsubscribe = useSongStore.subscribe((state) => {
      const nextRefs = getMusicalSnapshot(state);
      let changed = false;
      for (const k of musicalKeys) {
        if (nextRefs[k] !== prevRefs[k]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      prevRefs = nextRefs;

      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const persistSnapshot = () => {
          try {
            const currentState = useSongStore.getState();
            const totalNotes = (currentState.tracks || []).reduce(
              (acc, t) => acc + (t.notes?.length || 0),
              0
            );
            // Evitar congelar el hilo principal o exceder la cuota de 5 MB de localStorage en Black MIDIs masivos
            if (totalNotes > 8000) {
              return;
            }
            const sessionJson = exportSessionToJson(currentState);
            if (sessionJson.length > 3_500_000) {
              return;
            }
            localStorage.setItem('phosphor_session', sessionJson);
            currentState.setLastSavedAt(Date.now());
          } catch (e) {
            console.warn("Error guardando sesión en localStorage", e);
          }
        };

        if (typeof (window as any).requestIdleCallback === 'function') {
          (window as any).requestIdleCallback(persistSnapshot, { timeout: 1500 });
        } else {
          persistSnapshot();
        }
      }, 1000);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [isLoaded]);

  // 1. Atajos de teclado unificados estilo DAW
  useEffect(() => {
    const VIEW_SHORTCUTS: Record<string, 'chord' | 'piano-roll' | 'sequencer' | 'audio-tracks' | 'visualizer'> = {
      '1': 'chord',
      '2': 'piano-roll',
      '3': 'sequencer',
      '4': 'audio-tracks',
      '5': 'visualizer'
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) {
        return;
      }

      const store = useSongStore.getState();
      const keyLower = e.key.toLowerCase();
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Escape: Cierre unificado descendente de modales y cajones globales
      if (e.key === 'Escape') {
        if (store.commandPaletteMode !== 'closed') {
          e.preventDefault();
          store.setCommandPaletteMode('closed');
          return;
        }
        if (store.isSynthModalOpen) {
          e.preventDefault();
          store.setSynthModalOpen(false);
          return;
        }
        if (store.isSettingsOpen) {
          e.preventDefault();
          store.setSettingsOpen(false);
          return;
        }
        if (store.isMixerOpen) {
          e.preventDefault();
          store.setMixerOpen(false);
          return;
        }
        // Dejar pasar Escape al editor activo para cerrar popovers/herramientas/selección
        return;
      }

      // Paleta de Comandos (Ctrl+K)
      if (isCtrlOrCmd && !e.altKey && !e.shiftKey && keyLower === 'k') {
        e.preventDefault();
        store.setCommandPaletteMode(store.commandPaletteMode === 'commands' ? 'closed' : 'commands');
        return;
      }

      // Guardar / Exportar (Ctrl+S abre modal; Ctrl+Shift+S descarga .phos rápido)
      if (isCtrlOrCmd && !e.altKey && keyLower === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          window.dispatchEvent(new CustomEvent('phosphor-quick-save-phos'));
        } else {
          window.dispatchEvent(new CustomEvent('phosphor-open-save-modal'));
        }
        return;
      }

      // Abrir / Importar archivo (Ctrl+O)
      if (isCtrlOrCmd && !e.altKey && !e.shiftKey && keyLower === 'o') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('phosphor-open-import-file'));
        return;
      }

      // Cambio rápido de vista con Alt + 1..5
      if (e.altKey && !isCtrlOrCmd && !e.shiftKey && VIEW_SHORTCUTS[e.key]) {
        e.preventDefault();
        store.setActiveView(VIEW_SHORTCUTS[e.key]);
        return;
      }

      // Deshacer / Rehacer unificados (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y)
      if (isCtrlOrCmd && !e.altKey && keyLower === 'z') {
        e.preventDefault();
        const temporal = useSongStore.temporal.getState();
        if (e.shiftKey) {
          if (temporal.futureStates.length > 0) {
            temporal.redo();
            notify.info('Acción rehecha', undefined, 1600);
          }
        } else {
          if (temporal.pastStates.length > 0) {
            temporal.undo();
            notify.info('Acción deshecha', undefined, 1600);
          }
        }
        return;
      }

      if (isCtrlOrCmd && !e.altKey && !e.shiftKey && keyLower === 'y') {
        e.preventDefault();
        const temporal = useSongStore.temporal.getState();
        if (temporal.futureStates.length > 0) {
          temporal.redo();
          notify.info('Acción rehecha', undefined, 1600);
        }
        return;
      }

      if (isCtrlOrCmd || e.altKey) {
        return; // Permitir atajos locales de cada vista o nativos del navegador
      }

      // Guía rápida de atajos (?)
      if (e.key === '?') {
        e.preventDefault();
        store.setCommandPaletteMode(store.commandPaletteMode === 'shortcuts' ? 'closed' : 'shortcuts');
        return;
      }

      if (isModalBlockingShortcuts(store)) {
        return;
      }

      if (e.shiftKey && keyLower === 'm') {
        e.preventDefault();
        store.setMixerOpen(!store.isMixerOpen);
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        toneEngine.init(true).then(() => {
          const currentStore = useSongStore.getState();
          currentStore.setPlaying(!currentStore.isPlaying);
        }).catch((err) => {
          console.error('[App] Error al alternar reproducción con Space:', err);
        });
        return;
      }

      const handleStopAndResetCurrentView = () => {
        toneEngine.stop();
        const currentStore = useSongStore.getState();
        if (currentStore.activeView === 'chord') {
          currentStore.resetChordTimelineScroll();
          const el = document.querySelector('.timeline-viewport');
          if (el) el.scrollLeft = 0;
        } else if (currentStore.activeView === 'piano-roll') {
          currentStore.resetActiveTrackScroll();
          const el = document.querySelector('.piano-roll-container');
          if (el) el.scrollLeft = 0;
        } else if (currentStore.activeView === 'sequencer') {
          currentStore.resetDrumTimelineScroll();
          const el = document.querySelector('.drum-linear-viewport') || document.querySelector('.pattern-chain-track-wrapper');
          if (el) el.scrollLeft = 0;
        } else if (currentStore.activeView === 'audio-tracks') {
          const el = document.querySelector('.audio-timeline-viewport');
          if (el) el.scrollLeft = 0;
          currentStore.setCurrentBeat(0);
        }
      };

      if (e.key === 'Home') {
        e.preventDefault();
        handleStopAndResetCurrentView();
        return;
      }

      if (keyLower === 'w' && !e.shiftKey) {
        if (!(store.isKeyboardMelodyEnabled && store.isKeyboardChromatic)) {
          e.preventDefault();
          handleStopAndResetCurrentView();
          return;
        }
      }

      if (keyLower === 'q' && store.isKeyboardMelodyEnabled && store.isKeyboardChromatic && !e.shiftKey) {
        e.preventDefault();
        handleStopAndResetCurrentView();
        return;
      }

      // K: Alternar metrónomo global (cuando el teclado QWERTY melódico está desactivado)
      if (keyLower === 'k' && !e.shiftKey && !store.isKeyboardMelodyEnabled) {
        e.preventDefault();
        store.setMetronomeActive(!store.isMetronomeActive);
        return;
      }

      // Atajo R: En vista 'audio-tracks' controla la grabación; en las demás alterna bucle (Loop)
      if (keyLower === 'r' && !e.shiftKey) {
        e.preventDefault();
        if (store.activeView === 'audio-tracks') {
          if (store.isRecordingAudio) {
            store.stopAudioRecording();
          } else {
            store.startAudioRecording();
          }
        } else {
          store.setLooping(!store.isLooping);
        }
        return;
      }

      if (keyLower === 'r' && e.shiftKey && store.activeView === 'audio-tracks') {
        e.preventDefault();
        store.setLooping(!store.isLooping);
        return;
      }

      // Transponer canción completa en vista Acordes SOLO cuando no hay acordes seleccionados
      if (e.shiftKey && e.key === 'ArrowUp' && store.activeView === 'chord' && (store.selectedChordIds || []).length === 0) {
        e.preventDefault();
        store.transposeSong(1);
        return;
      }

      if (e.shiftKey && e.key === 'ArrowDown' && store.activeView === 'chord' && (store.selectedChordIds || []).length === 0) {
        e.preventDefault();
        store.transposeSong(-1);
        return;
      }

      // Atajo 'F' para alternar pantalla completa exclusivamente en la vista STAGE
      if (store.activeView === 'visualizer' && keyLower === 'f') {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
        return;
      }

      // Teclado virtual melódico: SOLO activo en vistas 'chord' y 'piano-roll'
      if (store.activeView === 'chord' || store.activeView === 'piano-roll') {
        toneEngine.init(true);
        toneEngine.handleKeyDown(e);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const store = useSongStore.getState();
      if (store.activeView === 'chord' || store.activeView === 'piano-roll') {
        toneEngine.handleKeyUp(e);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Prevent default context menu on app main workspace so components can handle their own right-click actions
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const mainWorkspace = document.querySelector('.app-main');
      if (mainWorkspace && mainWorkspace.contains(e.target as Node)) {
        e.preventDefault();
      }
    };

    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu);
    };
  }, []);

  return (
    <>
      <GlobalLoader />
      <div className={`crt-bezel ${isCrtEnabled ? '' : 'disabled'}`}>
        <div className="crt-chassis">
          <div id="crt-root" className={isCrtEnabled ? 'enabled' : ''}>
          <CRTOverlay />
          <Suspense fallback={null}>
            <MixerDrawer />
          </Suspense>
          
          <div className="crt-screen-content">
            <PianoVisualizer />
            <Header />
            <ViewToggle />
            <main className="app-main">
              <Suspense fallback={<div className="view-loading-fallback" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>Cargando vista...</div>}>
                <div style={{ display: isChordView ? 'contents' : 'none' }}>
                  <ChordPlayerView />
                </div>

                {hasVisitedPianoRoll && (
                  <div style={{ display: isPianoRollView ? 'contents' : 'none' }}>
                    <PianoRollView />
                  </div>
                )}

                {activeView === 'sequencer' && <DrumSequencerView />}
                {activeView === 'audio-tracks' && <AudioTracksView />}
                {activeView === 'visualizer' && <StageVisualizerView />}
              </Suspense>
            </main>
            <GlobalScrubber />
          </div>

          <GlobalDropZone />
          <ToastContainer />
          <CommandPaletteModal />

          <Suspense fallback={null}>
            <SettingsPanel />
            <SynthConfigModal />
          </Suspense>
        </div>
      </div>
    </div>
    </>
  );
}
