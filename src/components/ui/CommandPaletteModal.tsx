import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Command,
  Keyboard,
  X,
  Play,
  Pause,
  Square,
  RefreshCw,
  Sliders,
  Settings,
  Tv,
  Save,
  Package,
  FolderOpen,
  RotateCcw,
  RotateCw,
  LayoutGrid,
  Music,
  Grid3X3,
  AudioWaveform,
  Sparkles,
  Wand2,
  Activity
} from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { getDiatonicChords } from '../../core/music';
import { notify } from '../../core/ui/toastBus';
import { MetronomeIcon } from './MetronomeIcon';

interface CommandAction {
  id: string;
  label: string;
  category: string;
  keywords: string;
  shortcut?: string;
  icon: React.ReactNode;
  run: () => void;
}

interface ShortcutEntry {
  keys: string[];
  desc: string;
}

interface ShortcutGroup {
  title: string;
  accent: string;
  items: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global y Transporte',
    accent: '#82a5f5',
    items: [
      { keys: ['Space'], desc: 'Reproducir / Pausar' },
      { keys: ['L'], desc: 'Alternar modo PAT (patrón) / SONG (canción)' },
      { keys: ['W', 'Home'], desc: 'Detener y volver al inicio' },
      { keys: ['R'], desc: 'Alternar Loop (en Tracks: Grabar)' },
      { keys: ['K'], desc: 'Alternar Metrónomo' },
      { keys: ['Alt', '1–5'], desc: 'Cambiar de vista (Palette · Piano · Drums · Tracks · Stage)' },
      { keys: ['Shift', 'M'], desc: 'Abrir / cerrar Mezclador' },
      { keys: ['Ctrl', 'K'], desc: 'Paleta de Comandos' },
      { keys: ['?'], desc: 'Abrir esta Guía de Atajos' },
      { keys: ['Ctrl', 'S'], desc: 'Abrir Guardar / Exportar' },
      { keys: ['Ctrl', 'Shift', 'S'], desc: 'Exportar paquete .phos rápido' },
      { keys: ['Ctrl', 'O'], desc: 'Importar proyecto (.phos / .json / .mid)' },
      { keys: ['Ctrl', 'Z / Y'], desc: 'Deshacer / Rehacer' },
      { keys: ['Esc'], desc: 'Cerrar modal / limpiar selección' }
    ]
  },
  {
    title: 'Scrubber Global (Barra Inferior)',
    accent: '#00e5ff',
    items: [
      { keys: ['Clic / Arrastrar'], desc: 'Saltar o deslizar a cualquier punto del proyecto' },
      { keys: ['Shift', 'Arrastrar'], desc: 'Ajuste fino de posición' },
      { keys: ['Doble clic'], desc: 'Volver al compás 1 (Beat 0)' }
    ]
  },
  {
    title: 'Piano Roll',
    accent: '#a855f7',
    items: [
      { keys: ['P'], desc: 'Herramienta Lápiz (dibujar / editar notas)' },
      { keys: ['C'], desc: 'Herramienta Navaja / Corte (Shift+Arrastrar vertical)' },
      { keys: ['E'], desc: 'Herramienta Seleccionar (caja de selección múltiple)' },
      { keys: ['Ctrl', 'Arrastrar'], desc: 'Selección rápida por área desde modo Lápiz' },
      { keys: ['V'], desc: 'Mostrar / ocultar panel de Velocidad' },
      { keys: ['Alt', 'Arrastrar'], desc: 'Mover / estirar notas sin snap a la grilla' },
      { keys: ['Shift', 'Arrastrar'], desc: 'Clonar notas seleccionadas' },
      { keys: ['Ctrl', 'L'], desc: 'Legato automático en notas seleccionadas' },
      { keys: ['Ctrl', 'Q'], desc: 'Cuantizar selección a la grilla' },
      { keys: ['Ctrl', 'A / C / V / D'], desc: 'Seleccionar todo / Copiar / Pegar / Duplicar' },
      { keys: ['Ctrl', '0'], desc: 'Zoom to Fit (encuadrar composición)' }
    ]
  },
  {
    title: 'Chord Palette y Timeline',
    accent: '#60a5fa',
    items: [
      { keys: ['Shift', '↑ / ↓'], desc: 'Transponer canción completa (±1 semitono)' },
      { keys: ['C'], desc: 'Herramienta Corte sobre bloques de acordes' },
      { keys: ['Shift', 'Arrastrar'], desc: 'Clonar bloques de acordes' },
      { keys: ['Ctrl', 'Wheel'], desc: 'Zoom horizontal anclado al cursor' },
      { keys: ['Shift', 'Wheel'], desc: 'Desplazamiento horizontal suave' }
    ]
  },
  {
    title: 'Drum Sequencer y Tracks (Playlist)',
    accent: '#e5a93c',
    items: [
      { keys: ['P / C / E'], desc: 'Herramientas Playlist: Pincel · Navaja · Seleccionar' },
      { keys: ['S'], desc: 'Dividir clip MIDI o Audio en el cabezal' },
      { keys: ['Shift', 'Arrastrar'], desc: 'Clonar clips de patrón MIDI' },
      { keys: ['R'], desc: 'Iniciar / detener grabación en pista armada (Tracks)' },
      { keys: ['Ctrl', 'C / V / D'], desc: 'Copiar / Pegar / Duplicar clips seleccionados' },
      { keys: ['Supr'], desc: 'Eliminar selección activa' }
    ]
  },
  {
    title: 'Stage Visualizer',
    accent: '#5a9e7a',
    items: [
      { keys: ['1 / 2 / 3'], desc: 'Cambiar modo: Osciloscopio · Espectro · Lissajous' },
      { keys: ['F'], desc: 'Alternar pantalla completa (Modo Zen)' }
    ]
  }
];

export const CommandPaletteModal: React.FC = () => {
  const mode = useSongStore((s) => s.commandPaletteMode);
  const setMode = useSongStore((s) => s.setCommandPaletteMode);
  const isPlaying = useSongStore((s) => s.isPlaying);
  const isLooping = useSongStore((s) => s.isLooping);
  const isMetronomeActive = useSongStore((s) => s.isMetronomeActive);
  const isCrtEnabled = useSongStore((s) => s.isCrtEnabled);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode !== 'closed') {
      setQuery('');
      setSelectedIndex(0);
      if (mode === 'commands') {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }, [mode]);

  const close = () => setMode('closed');

  const actions = useMemo<CommandAction[]>(() => {
    const store = useSongStore.getState;
    const openActiveSynth = () => {
      const s = store();
      const activeTrack = s.tracks.find((t) => t.id === s.activeTrackId);
      const targetChannel =
        s.activeView === 'chord'
          ? 'chords'
          : activeTrack?.channelId || 'melody';
      s.openSynthConfigForChannel(targetChannel);
    };

    const insertStarterProgression = () => {
      const s = store();
      const diatonic = getDiatonicChords(s.key, s.scale);
      if (diatonic.length < 6) return;
      const progression =
        s.scale === 'minor'
          ? [diatonic[0], diatonic[5], diatonic[2], diatonic[6]] // i - VI - III - VII
          : [diatonic[0], diatonic[4], diatonic[5], diatonic[3]]; // I - V - vi - IV
      const startBeat = s.chordBlocks.reduce((m, b) => Math.max(m, b.startBeat + b.durationBeats), 0);
      s.addChordBlocksBatch(
        progression.map((chord, idx) => ({
          chord,
          startBeat: startBeat + idx * 4,
          durationBeats: 4,
          voicing: 'default',
          inversion: 0
        }))
      );
      s.setActiveView('chord');
      notify.success(`Progresión añadida (${progression.join(' – ')})`);
    };

    return [
      // Navegación
      {
        id: 'view-chord',
        label: 'Ir a Chord Palette',
        category: 'Navegación',
        keywords: 'acordes matriz armonia palette view',
        shortcut: 'Alt+1',
        icon: <LayoutGrid size={14} />,
        run: () => store().setActiveView('chord')
      },
      {
        id: 'view-piano',
        label: 'Ir a Piano Roll',
        category: 'Navegación',
        keywords: 'melodia notas piano roll midi editor',
        shortcut: 'Alt+2',
        icon: <Music size={14} />,
        run: () => store().setActiveView('piano-roll')
      },
      {
        id: 'view-drums',
        label: 'Ir a Drum Sequencer',
        category: 'Navegación',
        keywords: 'bateria ritmo patrones drums sequencer',
        shortcut: 'Alt+3',
        icon: <Grid3X3 size={14} />,
        run: () => store().setActiveView('sequencer')
      },
      {
        id: 'view-tracks',
        label: 'Ir a Tracks / Playlist (MIDI & Audio)',
        category: 'Navegación',
        keywords: 'audio midi tracks playlist patrones fl studio grabar wav multitrack',
        shortcut: 'Alt+4',
        icon: <AudioWaveform size={14} />,
        run: () => store().setActiveView('audio-tracks')
      },
      {
        id: 'view-stage',
        label: 'Ir a Stage Visualizer',
        category: 'Navegación',
        keywords: 'visualizador stage osciloscopio video zen',
        shortcut: 'Alt+5',
        icon: <Sparkles size={14} />,
        run: () => store().setActiveView('visualizer')
      },
      // Transporte
      {
        id: 'toggle-play',
        label: isPlaying ? 'Pausar reproducción' : 'Iniciar reproducción',
        category: 'Transporte',
        keywords: 'play pause reproducir pausar',
        shortcut: 'Space',
        icon: isPlaying ? <Pause size={14} /> : <Play size={14} />,
        run: () => {
          toneEngine.init(true).then(() => {
            const s = store();
            s.setPlaying(!s.isPlaying);
          });
        }
      },
      {
        id: 'stop',
        label: 'Detener y volver al inicio',
        category: 'Transporte',
        keywords: 'stop inicio beat 0 rewind',
        shortcut: 'W',
        icon: <Square size={14} />,
        run: () => toneEngine.stop()
      },
      {
        id: 'toggle-playback-mode',
        label: 'Alternar modo PAT / SONG (FL Studio)',
        category: 'Transporte',
        keywords: 'pat song patron playlist modo reproduccion fl',
        shortcut: 'L',
        icon: <Grid3X3 size={14} />,
        run: () => {
          const s = store();
          const next = s.playbackMode === 'pattern' ? 'song' : 'pattern';
          s.setPlaybackMode(next);
          notify.info(next === 'pattern' ? 'Modo PAT (Bucle de Patrón)' : 'Modo SONG (Playlist Completa)');
        }
      },
      {
        id: 'toggle-loop',
        label: isLooping ? 'Desactivar Loop / Repeat' : 'Activar Loop / Repeat',
        category: 'Transporte',
        keywords: 'loop repeat bucle',
        shortcut: 'R',
        icon: <RefreshCw size={14} />,
        run: () => {
          const next = !store().isLooping;
          store().setLooping(next);
          notify.info(next ? 'Loop activado' : 'Loop desactivado');
        }
      },
      {
        id: 'toggle-metro',
        label: isMetronomeActive ? 'Desactivar Metrónomo' : 'Activar Metrónomo',
        category: 'Transporte',
        keywords: 'metronomo click pulso tiempo',
        shortcut: 'K',
        icon: <MetronomeIcon size={14} />,
        run: () => {
          const next = !store().isMetronomeActive;
          store().setMetronomeActive(next);
          notify.info(next ? 'Metrónomo activado' : 'Metrónomo desactivado');
        }
      },
      // Estudio & Herramientas
      {
        id: 'toggle-mixer',
        label: 'Abrir / cerrar Mezclador (Mixer)',
        category: 'Estudio',
        keywords: 'mixer consola volumen faders pan mute solo',
        shortcut: 'Shift+M',
        icon: <Sliders size={14} />,
        run: () => store().setMixerOpen(!store().isMixerOpen)
      },
      {
        id: 'open-synth',
        label: 'Abrir Sintetizador del canal activo',
        category: 'Estudio',
        keywords: 'sinte synth preset oscilador filtro fx',
        icon: <Activity size={14} />,
        run: openActiveSynth
      },
      {
        id: 'open-settings',
        label: 'Abrir panel de Ajustes',
        category: 'Estudio',
        keywords: 'settings ajustes compas swing sustain teclado crt',
        icon: <Settings size={14} />,
        run: () => store().setSettingsOpen(!store().isSettingsOpen)
      },
      {
        id: 'toggle-crt',
        label: isCrtEnabled ? 'Desactivar efecto Monitor CRT' : 'Activar efecto Monitor CRT',
        category: 'Estudio',
        keywords: 'crt retro pantalla filtro scanlines',
        icon: <Tv size={14} />,
        run: () => {
          const next = !store().isCrtEnabled;
          store().setCrtEnabled(next);
          notify.info(next ? 'Monitor CRT activado' : 'Monitor CRT desactivado');
        }
      },
      {
        id: 'starter-progression',
        label: 'Insertar progresión inicial (I–V–vi–IV)',
        category: 'Composición',
        keywords: 'acordes progresion idea rapida armonia',
        icon: <Wand2 size={14} />,
        run: insertStarterProgression
      },
      // Proyecto & Archivo
      {
        id: 'save-modal',
        label: 'Guardar / Exportar proyecto, audio o video',
        category: 'Proyecto',
        keywords: 'guardar exportar wav mp3 m4a midi mp4 phos json',
        shortcut: 'Ctrl+S',
        icon: <Save size={14} />,
        run: () => window.dispatchEvent(new CustomEvent('phosphor-open-save-modal'))
      },
      {
        id: 'quick-save-phos',
        label: 'Exportar paquete .phos rápido',
        category: 'Proyecto',
        keywords: 'descargar backup phos rapido',
        shortcut: 'Ctrl+Shift+S',
        icon: <Package size={14} />,
        run: () => window.dispatchEvent(new CustomEvent('phosphor-quick-save-phos'))
      },
      {
        id: 'import-file',
        label: 'Importar proyecto (.phos / .json / .mid)',
        category: 'Proyecto',
        keywords: 'abrir cargar importar archivo midi',
        shortcut: 'Ctrl+O',
        icon: <FolderOpen size={14} />,
        run: () => window.dispatchEvent(new CustomEvent('phosphor-open-import-file'))
      },
      {
        id: 'undo',
        label: 'Deshacer última acción',
        category: 'Edición',
        keywords: 'undo deshacer atras',
        shortcut: 'Ctrl+Z',
        icon: <RotateCcw size={14} />,
        run: () => {
          if (useSongStore.temporal.getState().pastStates.length > 0) {
            useSongStore.temporal.getState().undo();
            notify.info('Acción deshecha');
          }
        }
      },
      {
        id: 'redo',
        label: 'Rehacer acción',
        category: 'Edición',
        keywords: 'redo rehacer adelante',
        shortcut: 'Ctrl+Y',
        icon: <RotateCw size={14} />,
        run: () => {
          if (useSongStore.temporal.getState().futureStates.length > 0) {
            useSongStore.temporal.getState().redo();
            notify.info('Acción rehecha');
          }
        }
      }
    ];
  }, [isPlaying, isLooping, isMetronomeActive, isCrtEnabled]);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const hay = `${a.label} ${a.category} ${a.keywords} ${a.shortcut || ''}`.toLowerCase();
      return q.split(/\s+/).every((part) => hay.includes(part));
    });
  }, [actions, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (mode === 'closed') return null;

  const executeSelected = (action?: CommandAction) => {
    const target = action || filteredActions[selectedIndex];
    if (!target) return;
    close();
    requestAnimationFrame(() => target.run());
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredActions.length > 0 ? (prev + 1) % filteredActions.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredActions.length > 0 ? (prev - 1 + filteredActions.length) % filteredActions.length : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="command-palette-backdrop" onClick={close}>
      <div
        className={`command-palette-dialog ${mode === 'shortcuts' ? 'shortcuts-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'commands' ? 'Paleta de Comandos' : 'Guía de Atajos'}
      >
        {/* Cabecera con pestañas Comandos / Atajos */}
        <div className="command-palette-header">
          <div className="command-palette-tabs">
            <button
              type="button"
              className={`cp-tab-btn ${mode === 'commands' ? 'active' : ''}`}
              onClick={() => setMode('commands')}
            >
              <Command size={13} />
              <span>COMANDOS</span>
              <kbd className="cp-kbd-mini">Ctrl+K</kbd>
            </button>
            <button
              type="button"
              className={`cp-tab-btn ${mode === 'shortcuts' ? 'active' : ''}`}
              onClick={() => setMode('shortcuts')}
            >
              <Keyboard size={13} />
              <span>ATAJOS</span>
              <kbd className="cp-kbd-mini">?</kbd>
            </button>
          </div>
          <button
            type="button"
            className="cp-close-btn"
            onClick={close}
            title="Cerrar (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {mode === 'commands' ? (
          <>
            <div className="cp-search-bar">
              <Search size={15} className="cp-search-icon" />
              <input
                ref={inputRef}
                type="text"
                className="cp-search-input"
                placeholder="Buscar comando, vista o acción..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
              />
            </div>

            <div className="cp-results-list">
              {filteredActions.length === 0 ? (
                <div className="cp-empty">Sin coincidencias para &ldquo;{query}&rdquo;</div>
              ) : (
                filteredActions.map((action, idx) => (
                  <button
                    key={action.id}
                    type="button"
                    className={`cp-result-row ${idx === selectedIndex ? 'selected' : ''}`}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => executeSelected(action)}
                  >
                    <span className="cp-result-icon">{action.icon}</span>
                    <span className="cp-result-label">{action.label}</span>
                    <span className="cp-result-cat">{action.category}</span>
                    {action.shortcut && <kbd className="cp-kbd">{action.shortcut}</kbd>}
                  </button>
                ))
              )}
            </div>

            <div className="cp-footer-hints">
              <span><kbd className="cp-kbd-mini">↑↓</kbd> navegar</span>
              <span><kbd className="cp-kbd-mini">Enter</kbd> ejecutar</span>
              <span><kbd className="cp-kbd-mini">Esc</kbd> cerrar</span>
            </div>
          </>
        ) : (
          <div className="cp-shortcuts-grid">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title} className="cp-shortcut-card">
                <div className="cp-shortcut-card-title" style={{ borderLeftColor: group.accent }}>
                  {group.title}
                </div>
                <div className="cp-shortcut-rows">
                  {group.items.map((item) => (
                    <div key={item.desc} className="cp-shortcut-row">
                      <span className="cp-shortcut-desc">{item.desc}</span>
                      <span className="cp-shortcut-keys">
                        {item.keys.map((k, i) => (
                          <React.Fragment key={k}>
                            {i > 0 && <span className="cp-key-plus">+</span>}
                            <kbd className="cp-kbd">{k}</kbd>
                          </React.Fragment>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
