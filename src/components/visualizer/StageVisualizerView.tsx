import React, { useState } from 'react';
import { StageTelemetryHUD } from './StageTelemetryHUD';
import type { VisualizerMode } from './StageTelemetryHUD';
import { MasterAudioVisualizer } from './MasterAudioVisualizer';
import { MidiWaterfallCanvas } from './MidiWaterfallCanvas';
import { ChannelActivityDeck } from './ChannelActivityDeck';
import { ArrangementMacroTracker } from './ArrangementMacroTracker';

export const StageVisualizerView: React.FC = () => {
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('oscilloscope');
  const [isZenMode, setIsZenMode] = useState(false);

  return (
    <div className={`stage-view-container ${isZenMode ? 'zen-mode' : ''}`}>
      {/* 1. Telemetría de Cabina Superior */}
      <StageTelemetryHUD
        visualizerMode={visualizerMode}
        onSelectMode={setVisualizerMode}
        isZenMode={isZenMode}
        onToggleZen={() => setIsZenMode(!isZenMode)}
      />

      {/* 2. Escenario Audiovisual Principal */}
      <div className="stage-hero-grid">
        {/* Visualizador de Audio Maestro (Osciloscopio / FFT / Lissajous) */}
        <div className="stage-hero-scope">
          <MasterAudioVisualizer mode={visualizerMode} />
        </div>

        {/* Cascada MIDI Multi-Canal a 60 FPS */}
        <div className="stage-hero-waterfall">
          <MidiWaterfallCanvas />
        </div>
      </div>

      {/* 3. Tira de Actividad de Canales (VU Meters y Notas en Vivo) */}
      <div className="stage-deck-section">
        <ChannelActivityDeck />
      </div>

      {/* 4. Secuenciador y Arranger Ultrasimplificado en Vivo */}
      <div className="stage-tracker-section">
        <ArrangementMacroTracker />
      </div>
    </div>
  );
};
