import { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { ViewToggle } from './components/layout/ViewToggle';
import { ChordPlayerView } from './components/chord-player/ChordPlayerView';
import { PianoRollView } from './components/piano-roll/PianoRollView';
import { DrumSequencerView } from './components/sequencer/DrumSequencerView';
import { useSongStore } from './store/songStore';
import { toneEngine } from './audio/toneEngine';
import { loadCustomPatterns } from './patterns/patternLoader';
import { PianoVisualizer } from './components/piano-roll/PianoVisualizer';
import { CRTOverlay } from './components/ui/CRTOverlay';
import { SettingsPanel } from './components/ui/SettingsPanel';
import { SynthConfigModal } from './components/ui/SynthConfigModal';
import { MixerDrawer } from './components/ui/MixerDrawer';
import { GlobalLoader } from './components/ui/GlobalLoader';

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
        const parsed = JSON.parse(saved);
        const currentState = useSongStore.getState();
        if (parsed.channels && typeof parsed.channels === 'object') {
          parsed.channels = { ...currentState.channels, ...parsed.channels };
        }
        if (parsed.drumChannels) {
          if (Array.isArray(parsed.drumChannels)) {
            parsed.drumChannels = parsed.drumChannels;
          } else if (typeof parsed.drumChannels === 'object') {
            parsed.drumChannels = Object.values(parsed.drumChannels);
          }
        }
        useSongStore.setState(parsed);
      } catch (e) {
        console.error("Error cargando sesión persistida", e);
      }
    }
    setIsLoaded(true);

    loadCustomPatterns().then(patterns => {
      if (patterns.length > 0) setCustomPatterns(patterns);
    });
  }, [setCustomPatterns]);

  // Guardar estado reactivamente en localStorage con debounce
  useEffect(() => {
    if (!isLoaded) return;
    let timeoutId: number;
    const unsubscribe = useSongStore.subscribe((state) => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const sessionToSave = {
          bpm: state.bpm,
          key: state.key,
          scale: state.scale,
          chordBlocks: state.chordBlocks,
          melodyNotes: state.melodyNotes,
          timeSignature: state.timeSignature,
          pattern: state.pattern,
          isCrtEnabled: state.isCrtEnabled,
          crtParams: state.crtParams,
          synthSettings: state.synthSettings,
          channels: state.channels,
          drumChannels: state.drumChannels,
          patternChain: state.patternChain,
          isPatternRepeatOn: state.isPatternRepeatOn,
          activeDrumKitId: state.activeDrumKitId,
          currentDrumPatternEdit: state.currentDrumPatternEdit,
          isKeyboardMelodyEnabled: state.isKeyboardMelodyEnabled,
          isKeyboardChromatic: state.isKeyboardChromatic,
          isAutoSuggestions: state.isAutoSuggestions
        };
        localStorage.setItem('phosphor_session', JSON.stringify(sessionToSave));
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

      if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
        // En modo teclado melódico + cromático, W es Do#4, así que se desactiva como parada de reproducción
        if (store.isKeyboardMelodyEnabled && store.isKeyboardChromatic) {
          // Dejar pasar al trigger de la nota
        } else {
          e.preventDefault();
          toneEngine.stop();
          return;
        }
      }

      // Atajo alternativo para detener/reiniciar (Q) cuando W está ocupado por la nota Do#
      if (e.key.toLowerCase() === 'q' && store.isKeyboardMelodyEnabled && store.isKeyboardChromatic && !e.shiftKey) {
        e.preventDefault();
        toneEngine.stop();
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
          <MixerDrawer />
          
          <div className="crt-screen-content">
            <PianoVisualizer />
            <Header />
            <ViewToggle />
            <main className="app-main">
              {activeView === 'chord' && <ChordPlayerView />}
              {activeView === 'piano-roll' && <PianoRollView />}
              {activeView === 'sequencer' && <DrumSequencerView />}
            </main>
          </div>

          <SettingsPanel />
          <SynthConfigModal />
        </div>
      </div>
    </div>
    </>
  );

}
