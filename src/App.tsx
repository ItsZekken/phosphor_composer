import React, { useEffect, useState, Suspense } from 'react';
import { Header } from './components/layout/Header';
import { ViewToggle } from './components/layout/ViewToggle';
import { useSongStore } from './store/songStore';
import { toneEngine } from './audio/toneEngine';
import { loadCustomPatterns } from './patterns/patternLoader';
import { PianoVisualizer } from './components/piano-roll/PianoVisualizer';
import { CRTOverlay } from './components/ui/CRTOverlay';
import { GlobalLoader } from './components/ui/GlobalLoader';
import { exportSessionToJson } from './core/session';

// Carga bajo demanda (Code-Splitting) para optimizar memoria y tiempo de carga inicial
const ChordPlayerView = React.lazy(() => import('./components/chord-player/ChordPlayerView').then(m => ({ default: m.ChordPlayerView })));
const PianoRollView = React.lazy(() => import('./components/piano-roll/PianoRollView').then(m => ({ default: m.PianoRollView })));
const DrumSequencerView = React.lazy(() => import('./components/sequencer/DrumSequencerView').then(m => ({ default: m.DrumSequencerView })));
const StageVisualizerView = React.lazy(() => import('./components/visualizer/StageVisualizerView').then(m => ({ default: m.StageVisualizerView })));
const SettingsPanel = React.lazy(() => import('./components/ui/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const SynthConfigModal = React.lazy(() => import('./components/ui/SynthConfigModal').then(m => ({ default: m.SynthConfigModal })));
const MixerDrawer = React.lazy(() => import('./components/ui/MixerDrawer').then(m => ({ default: m.MixerDrawer })));

export default function App() {
  const activeView = useSongStore(state => state.activeView);
  const setCustomPatterns = useSongStore(state => state.setCustomPatterns);
  const isCrtEnabled = useSongStore(state => state.isCrtEnabled);

  const [isLoaded, setIsLoaded] = useState(false);

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

  // Guardar estado reactivamente en localStorage con debounce (solo ante cambios en el modelo musical)
  useEffect(() => {
    if (!isLoaded) return;
    let timeoutId: number;
    let prevModelKey = '';

    const unsubscribe = useSongStore.subscribe((state) => {
      const currentModelKey = `${state.bpm}_${state.key}_${state.scale}_${state.tracks.length}_${state.chordBlocks.length}_${state.drumChannels.length}_${state.patternChain.length}_${state.pattern}`;
      if (currentModelKey === prevModelKey) return;
      prevModelKey = currentModelKey;

      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        try {
          const sessionJson = exportSessionToJson(state);
          localStorage.setItem('phosphor_session', sessionJson);
        } catch (e) {
          console.warn("Error guardando sesión en localStorage", e);
        }
      }, 1000);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [isLoaded]);

  // 1. Atajos de teclado estilo DAW
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const store = useSongStore.getState();

      const isUndoRedo = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y');
      const isSystemModifier = (e.ctrlKey || e.metaKey || e.altKey) && !isUndoRedo;

      if (isSystemModifier) {
        return; // Permitir que el navegador maneje atajos nativos como Ctrl+R
      }

      if (e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        store.setMixerOpen(!store.isMixerOpen);
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        toneEngine.init().then(() => {
          // Obtener el estado fresco dentro de la promesa
          const currentStore = useSongStore.getState();
          currentStore.setPlaying(!currentStore.isPlaying);
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
          const el = document.querySelector('.pattern-chain-track-wrapper');
          if (el) el.scrollLeft = 0;
        }
      };

      if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
        // En modo teclado melódico + cromático, W es Do#4, así que se desactiva como parada de reproducción
        if (store.isKeyboardMelodyEnabled && store.isKeyboardChromatic) {
          // Dejar pasar al trigger de la nota
        } else {
          e.preventDefault();
          handleStopAndResetCurrentView();
          return;
        }
      }

      // Atajo alternativo para detener/reiniciar (Q) cuando W está ocupado por la nota Do#
      if (e.key.toLowerCase() === 'q' && store.isKeyboardMelodyEnabled && store.isKeyboardChromatic && !e.shiftKey) {
        e.preventDefault();
        handleStopAndResetCurrentView();
        return;
      }

      if (e.key.toLowerCase() === 'r' && !e.shiftKey) {
        e.preventDefault();
        store.setLooping(!store.isLooping);
        return;
      }

      if (e.shiftKey && e.key === 'ArrowUp') {
        e.preventDefault();
        store.transposeSong(1);
        return;
      }

      if (e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault();
        store.transposeSong(-1);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        useSongStore.temporal.getState().undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useSongStore.temporal.getState().redo();
        return;
      }

      // P1: Asegurar que el AudioContext esté activo antes de cualquier nota
      // (el primer keydown del usuario sirve como gesture para resumir el contexto)
      toneEngine.init();
      // Procesar entrada de teclado para tocar melodías en tiempo real
      toneEngine.handleKeyDown(e);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      toneEngine.handleKeyUp(e);
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
                {activeView === 'chord' && <ChordPlayerView />}
                {activeView === 'piano-roll' && <PianoRollView />}
                {activeView === 'sequencer' && <DrumSequencerView />}
                {activeView === 'visualizer' && <StageVisualizerView />}
              </Suspense>
            </main>
          </div>

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
