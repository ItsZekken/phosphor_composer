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
  const currentBeat = useSongStore((state) => state.currentBeat);
  const bpm = useSongStore((state) => state.bpm);
  const liveBpm = useSongStore((state) => state.liveBpm || state.bpm);
  const currentBpm = isPlaying ? liveBpm : bpm;
  const key = useSongStore((state) => state.key);
  const scale = useSongStore((state) => state.scale);

  // Formato Bar.Beat y Tiempo mm:ss sincronizado a tiempo real con el motor de audio
  const [hudTime, setHudTime] = React.useState({ barStr: '01', beatStr: '1', timeStr: '00:00' });

  React.useEffect(() => {
    if (!isPlaying) {
      const totalBeats = Math.max(0, currentBeat);
      const bar = Math.floor(totalBeats / 4) + 1;
      const beat = (Math.floor(totalBeats) % 4) + 1;
      const secondsTotal = toneEngine.getLiveSeconds();
      const mins = Math.floor(secondsTotal / 60);
      const secs = Math.floor(secondsTotal % 60);
      setHudTime({
        barStr: bar.toString().padStart(2, '0'),
        beatStr: beat.toString(),
        timeStr: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      });
      return;
    }

    let animId: number;
    let lastSecond = -1;
    let lastBeatInt = -1;

    const tick = () => {
      const liveBeat = Math.max(0, toneEngine.getLiveBeat());
      const bar = Math.floor(liveBeat / 4) + 1;
      const beat = (Math.floor(liveBeat) % 4) + 1;
      const secondsTotal = Math.max(0, toneEngine.getLiveSeconds());
      const secInt = Math.floor(secondsTotal);

      if (secInt !== lastSecond || beat !== lastBeatInt) {
        lastSecond = secInt;
        lastBeatInt = beat;
        const mins = Math.floor(secondsTotal / 60);
        const secs = Math.floor(secondsTotal % 60);
        setHudTime({
          barStr: bar.toString().padStart(2, '0'),
          beatStr: beat.toString(),
          timeStr: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        });
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, currentBeat]);

  const handleTogglePlay = async () => {
    await toneEngine.init();
    setPlaying(!isPlaying);
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
          <span className="stage-lcd-segment">{hudTime.barStr}</span>
          <span className="stage-lcd-dot">.</span>
          <span className="stage-lcd-segment">{hudTime.beatStr}</span>
        </div>

        {/* Tiempo transcurrido */}
        <div className="stage-hud-pill">
          <span className="stage-hud-digits">{hudTime.timeStr}</span>
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
            title="Oscilloscope"
          >
            <Activity size={14} />
          </button>
          <button
            className={`stage-mode-btn ${visualizerMode === 'spectrum' ? 'active' : ''}`}
            onClick={() => onSelectMode('spectrum')}
            title="Spectrum"
          >
            <AudioLines size={14} />
          </button>
          <button
            className={`stage-mode-btn ${visualizerMode === 'lissajous' ? 'active' : ''}`}
            onClick={() => onSelectMode('lissajous')}
            title="Phase Scope"
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
          title={isZenMode ? 'Restore View' : 'Zen Stage'}
        >
          {isZenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
});
