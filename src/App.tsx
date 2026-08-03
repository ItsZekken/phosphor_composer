import { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { ViewToggle } from './components/layout/ViewToggle';
import { ChordPlayerView } from './components/chord-player/ChordPlayerView';
import { PianoRollView } from './components/piano-roll/PianoRollView';
import { DrumSequencerView } from './components/sequencer/DrumSequencerView';
import { useSongStore } from './store/songStore';
import { toneEngine } from './audio/toneEngine';
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, RefreshCw, Trash2 } from 'lucide-react';
import { loadCustomPatterns } from './patterns/patternLoader';
import { PianoVisualizer } from './components/piano-roll/PianoVisualizer';
import { CRTOverlay } from './components/ui/CRTOverlay';
import { SettingsPanel } from './components/ui/SettingsPanel';
import { SynthConfigModal } from './components/ui/SynthConfigModal';
import { ContextMenuContainer } from './components/ui/ContextMenuContainer';
import { MixerDrawer } from './components/ui/MixerDrawer';
import { GlobalLoader } from './components/ui/GlobalLoader';

export default function App() {
  const activeView = useSongStore(state => state.activeView);
  const transposeSong = useSongStore(state => state.transposeSong);
  const clearSong = useSongStore(state => state.clearSong);
  const isLooping = useSongStore(state => state.isLooping);
  const setLooping = useSongStore(state => state.setLooping);
  const setCustomPatterns = useSongStore(state => state.setCustomPatterns);
  const isCrtEnabled = useSongStore(state => state.isCrtEnabled);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });

  const [isLoaded, setIsLoaded] = useState(false);

  // 0. Cargar sesión guardada desde localStorage e inicializar patrones custom
  useEffect(() => {
    const saved = localStorage.getItem('phosphor_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
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

  // 2. Click derecho personalizado
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // No abrir el menú global del DAW en componentes que manejan su propio menú
      if (
        target.closest('canvas') ||
        target.closest('.chord-block') ||
        target.closest('.piano-sidebar')
      ) {
        return;
      }

      const mainWorkspace = document.querySelector('.app-main');
      if (mainWorkspace && mainWorkspace.contains(e.target as Node)) {
        e.preventDefault();
        setContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY
        });
      }
    };

    const handleGlobalClick = () => {
      setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
    };

    window.addEventListener('contextmenu', handleGlobalContextMenu);
    window.addEventListener('click', handleGlobalClick);

    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu);
      window.removeEventListener('click', handleGlobalClick);
    };
  }, []);

  const handleContextTranspose = (semitones: number) => {
    transposeSong(semitones);
  };

  const handleContextClear = () => {
    if (window.confirm('¿Quieres limpiar toda la canción?')) {
      clearSong();
      toneEngine.stop();
    }
  };

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

            {/* Menú Contextual Flotante Personalizado */}
            {contextMenu.visible && (
              <ContextMenuContainer x={contextMenu.x} y={contextMenu.y}>
                <div className="menu-header">Herramientas del DAW</div>
                
                {/* Barra de Acciones Rápidas estilo Windows 11 */}
                <div className="menu-quick-actions">
                  <button
                    type="button"
                    className="quick-action-btn"
                    title="Transponer -1 Semitono"
                    onClick={() => handleContextTranspose(-1)}
                  >
                    <ArrowDown size={14} />
                    <span className="btn-subtext">-1</span>
                  </button>
                  <button
                    type="button"
                    className="quick-action-btn"
                    title="Transponer +1 Semitono"
                    onClick={() => handleContextTranspose(1)}
                  >
                    <ArrowUp size={14} />
                    <span className="btn-subtext">+1</span>
                  </button>
                  <button
                    type="button"
                    className="quick-action-btn"
                    title="Bajar 1 Octava (-12)"
                    onClick={() => handleContextTranspose(-12)}
                  >
                    <ChevronsDown size={14} />
                    <span className="btn-subtext">-12</span>
                  </button>
                  <button
                    type="button"
                    className="quick-action-btn"
                    title="Subir 1 Octava (+12)"
                    onClick={() => handleContextTranspose(12)}
                  >
                    <ChevronsUp size={14} />
                    <span className="btn-subtext">+12</span>
                  </button>
                </div>

                <hr className="menu-separator" />

                <button type="button" onClick={() => setLooping(!isLooping)}>
                  <RefreshCw size={14} /> Repeat / Loop: {isLooping ? 'ON' : 'OFF'}
                </button>
                <hr className="menu-separator" />
                <button type="button" className="menu-danger" onClick={handleContextClear}>
                  <Trash2 size={14} /> Limpiar Todo
                </button>
              </ContextMenuContainer>
            )}
          </div>

          <SettingsPanel />
          <SynthConfigModal />
        </div>
      </div>
    </div>
    </>
  );

}
