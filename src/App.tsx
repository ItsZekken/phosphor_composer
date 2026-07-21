import { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { ViewToggle } from './components/layout/ViewToggle';
import { ChordPlayerView } from './components/chord-player/ChordPlayerView';
import { PianoRollView } from './components/piano-roll/PianoRollView';
import { useSongStore } from './store/songStore';
import { toneEngine } from './audio/toneEngine';
import { ArrowUp, ArrowDown, RefreshCw, Trash2 } from 'lucide-react';
import { loadCustomPatterns } from './patterns/patternLoader';
import { PianoVisualizer } from './components/piano-roll/PianoVisualizer';
import { CRTOverlay } from './components/ui/CRTOverlay';
import { SettingsPanel } from './components/ui/SettingsPanel';
import { SynthConfigModal } from './components/ui/SynthConfigModal';

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

  // Guardar estado reactivamente en localStorage
  useEffect(() => {
    if (!isLoaded) return;
    const unsubscribe = useSongStore.subscribe((state) => {
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
        isKeyboardMelodyEnabled: state.isKeyboardMelodyEnabled,
        isKeyboardChromatic: state.isKeyboardChromatic,
        isAutoSuggestions: state.isAutoSuggestions
      };
      localStorage.setItem('phosphor_session', JSON.stringify(sessionToSave));
    });
    return unsubscribe;
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

      if (e.key === ' ') {
        e.preventDefault();
        toneEngine.init();
        store.setPlaying(!store.isPlaying);
        return;
      }

      if (e.key.toLowerCase() === 'w') {
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
      if (e.key.toLowerCase() === 'q' && store.isKeyboardMelodyEnabled && store.isKeyboardChromatic) {
        e.preventDefault();
        toneEngine.stop();
        return;
      }

      if (e.key.toLowerCase() === 'r') {
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
    <div className={`crt-bezel ${isCrtEnabled ? '' : 'disabled'}`}>
      <div className="crt-chassis">
        <div id="crt-root" className={isCrtEnabled ? 'enabled' : ''}>
          <CRTOverlay />
          
          <div className="crt-screen-content">
            <PianoVisualizer />
            <Header />
            <ViewToggle />
            <main className="app-main">
              {activeView === 'chord' ? <ChordPlayerView /> : <PianoRollView />}
            </main>

            {/* Menú Contextual Flotante Personalizado */}
            {contextMenu.visible && (
              <div 
                className="custom-context-menu"
                style={{ 
                  top: `${contextMenu.y}px`, 
                  left: `${contextMenu.x}px`,
                  position: 'fixed'
                }}
                onClick={e => e.stopPropagation()}
              >
                <div className="menu-header">Herramientas del DAW</div>
                <button onClick={() => handleContextTranspose(1)}>
                  <ArrowUp size={14} /> Transponer +1 Semitono
                </button>
                <button onClick={() => handleContextTranspose(-1)}>
                  <ArrowDown size={14} /> Transponer -1 Semitono
                </button>
                <button onClick={() => handleContextTranspose(12)}>
                  <ArrowUp size={14} /> Subir 1 Octava (+12)
                </button>
                <button onClick={() => handleContextTranspose(-12)}>
                  <ArrowDown size={14} /> Bajar 1 Octava (-12)
                </button>
                <button onClick={() => setLooping(!isLooping)}>
                  <RefreshCw size={14} /> Repeat / Loop: {isLooping ? 'ON' : 'OFF'}
                </button>
                <hr className="menu-separator" />
                <button className="menu-danger" onClick={handleContextClear}>
                  <Trash2 size={14} /> Limpiar Todo
                </button>
              </div>
            )}
          </div>

          <SettingsPanel />
          <SynthConfigModal />
        </div>
      </div>
    </div>
  );
}
