import React from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import {
  Play,
  Pause,
  Square,
  Repeat,
  Activity,
  AudioLines,
  Radio,
  Maximize2,
  Minimize2,
  Music2,
  Video
} from 'lucide-react';

export type VisualizerMode = 'oscilloscope' | 'spectrum' | 'lissajous';

interface StageTelemetryHUDProps {
  visualizerMode: VisualizerMode;
  onSelectMode: (mode: VisualizerMode) => void;
  isZenMode: boolean;
  onToggleZen: () => void;
  onOpenExportVideo?: () => void;
}

export const StageTelemetryHUD: React.FC<StageTelemetryHUDProps> = React.memo(({
  visualizerMode,
  onSelectMode,
  isZenMode,
  onToggleZen,
  onOpenExportVideo
}) => {
  const isPlaying = useSongStore((state) => state.isPlaying);
  const setPlaying = useSongStore((state) => state.setPlaying);
  const isLooping = useSongStore((state) => state.isLooping);
  const setLooping = useSongStore((state) => state.setLooping);
  const bpm = useSongStore((state) => state.bpm);
  const liveBpm = useSongStore((state) => state.liveBpm || state.bpm);
  const currentBpm = isPlaying ? liveBpm : bpm;
  const key = useSongStore((state) => state.key);
  const scale = useSongStore((state) => state.scale);

  const barRef = React.useRef<HTMLSpanElement | null>(null);
  const beatRef = React.useRef<HTMLSpanElement | null>(null);
  const timeRef = React.useRef<HTMLSpanElement | null>(null);

  // Sincronización directa vía refs DOM (0 re-renders de React en barra/beat/tiempo)
  React.useEffect(() => {
    let animId = 0;
    let lastBar = -1;
    let lastBeat = -1;
    let lastSecInt = -1;

    const writeClock = (totalBeatsInput: number, secondsTotalInput: number) => {
      const totalBeats = Math.max(0, totalBeatsInput);
      const bar = Math.floor(totalBeats / 4) + 1;
      const beat = (Math.floor(totalBeats) % 4) + 1;
      const secondsTotal = Math.max(0, secondsTotalInput);
      const secInt = Math.floor(secondsTotal);

      if (bar !== lastBar) {
        lastBar = bar;
        if (barRef.current) barRef.current.textContent = bar.toString().padStart(2, '0');
      }
      if (beat !== lastBeat) {
        lastBeat = beat;
        if (beatRef.current) beatRef.current.textContent = beat.toString();
      }
      if (secInt !== lastSecInt) {
        lastSecInt = secInt;
        const mins = Math.floor(secInt / 60);
        const secs = secInt % 60;
        if (timeRef.current) {
          timeRef.current.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
      }
    };

    if (!isPlaying) {
      writeClock(useSongStore.getState().currentBeat || 0, toneEngine.getLiveSeconds());
      const unsub = useSongStore.subscribe((state, prev) => {
        if (!state.isPlaying && state.currentBeat !== prev.currentBeat) {
          writeClock(state.currentBeat || 0, toneEngine.getLiveSeconds());
        }
      });
      return () => unsub();
    }

    const tick = () => {
      writeClock(toneEngine.getLiveBeat(), toneEngine.getLiveSeconds());
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  const handleTogglePlay = async () => {
    try {
      await toneEngine.init();
      const current = useSongStore.getState().isPlaying;
      setPlaying(!current);
    } catch (e) {
      console.error('[StageTelemetryHUD] Error al iniciar/pausar reproducción:', e);
    }
  };

  const handleStop = () => {
    toneEngine.stop();
  };

  return (
    <div className="stage-telemetry-hud">
      {/* Zona Izquierda: Transporte Minimalista & Pulso BPM */}
      <div className="stage-hud-section stage-hud-left">
        <button
          className={`stage-hud-btn ${isPlaying ? 'active' : ''}`}
          onClick={handleTogglePlay}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          className="stage-hud-btn"
          onClick={handleStop}
          title="Stop"
        >
          <Square size={13} />
        </button>
        <button
          className={`stage-hud-btn ${isLooping ? 'active' : ''}`}
          onClick={() => setLooping(!isLooping)}
          title="Loop"
        >
          <Repeat size={13} />
        </button>

        <div className="stage-hud-divider" />

        {/* LED Pulso BPM & BPM Numérico Dinámico */}
        <div className="stage-hud-pill">
          <span
            className={`stage-bpm-led ${isPlaying ? 'pulsing' : ''}`}
            style={{
              animationDuration: isPlaying ? `${60 / currentBpm}s` : '0s'
            }}
          />
          <span className="stage-hud-digits">{currentBpm}</span>
        </div>
      </div>

      {/* Zona Central: Contadores Digitales */}
      <div className="stage-hud-section stage-hud-center">
        {/* Contador de Compás / Beat */}
        <div className="stage-lcd-display">
          <span ref={barRef} className="stage-lcd-segment">01</span>
          <span className="stage-lcd-dot">.</span>
          <span ref={beatRef} className="stage-lcd-segment">1</span>
        </div>

        {/* Tiempo transcurrido */}
        <div className="stage-hud-pill">
          <span ref={timeRef} className="stage-hud-digits">00:00</span>
        </div>

        {/* Tonalidad */}
        <div className="stage-hud-pill" title={`${key} ${scale}`}>
          <Music2 size={12} style={{ opacity: 0.7 }} />
          <span className="stage-hud-code">{key} {scale === 'minor' ? 'm' : ''}</span>
        </div>
      </div>

      {/* Zona Derecha: Selectores de Modo Gráfico & Modo Zen */}
      <div className="stage-hud-section stage-hud-right">
        <div className="stage-mode-group">
          <button
            className={`stage-mode-btn ${visualizerMode === 'oscilloscope' ? 'active' : ''}`}
            onClick={() => onSelectMode('oscilloscope')}
            title="Oscilloscope (1)"
          >
            <Activity size={14} />
          </button>
          <button
            className={`stage-mode-btn ${visualizerMode === 'spectrum' ? 'active' : ''}`}
            onClick={() => onSelectMode('spectrum')}
            title="Spectrum (2)"
          >
            <AudioLines size={14} />
          </button>
          <button
            className={`stage-mode-btn ${visualizerMode === 'lissajous' ? 'active' : ''}`}
            onClick={() => onSelectMode('lissajous')}
            title="Phase Scope / Lissajous (3)"
          >
            <Radio size={14} />
          </button>
        </div>

        <div className="stage-hud-divider" />

        {onOpenExportVideo && (
          <button
            className="stage-hud-btn"
            onClick={onOpenExportVideo}
            title="Exportar Video MP4 (1080p)"
          >
            <Video size={14} />
          </button>
        )}

        <button
          className={`stage-hud-btn ${isZenMode ? 'active' : ''}`}
          onClick={onToggleZen}
          title={isZenMode ? 'Salir de Pantalla Completa (F11)' : 'Pantalla Completa (F11)'}
        >
          {isZenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
});
