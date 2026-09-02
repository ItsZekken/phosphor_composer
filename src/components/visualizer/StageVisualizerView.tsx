import React, { useState, useEffect, useRef } from 'react';
import { StageTelemetryHUD } from './StageTelemetryHUD';
import type { VisualizerMode } from './StageTelemetryHUD';
import { StageCanvas } from './StageCanvas';
import { StageExportModal } from './StageExportModal';

export const StageVisualizerView: React.FC = () => {
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('oscilloscope');
  const [isZenMode, setIsZenMode] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  // Ocultar la barra superior tras 2.5 segundos de inactividad del cursor
  const handleMouseMove = () => {
    setIsControlsVisible(true);
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      setIsControlsVisible(false);
    }, 2500);
  };

  useEffect(() => {
    idleTimerRef.current = window.setTimeout(() => {
      setIsControlsVisible(false);
    }, 3000);

    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, []);

  return (
    <div
      className={`stage-stage-wrapper ${isZenMode ? 'zen-mode' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseMove}
    >
      {/* LIENZO UNIFICADO: Ejecuta las 4 capas del Stage con el mismo motor gráfico puro */}
      <StageCanvas mode={visualizerMode} />

      {/* HUD de Telemetría Superior (se oculta automáticamente por inactividad) */}
      <div className={`stage-floating-top-bar ${!isControlsVisible ? 'idle-hidden' : ''}`}>
        <StageTelemetryHUD
          visualizerMode={visualizerMode}
          onSelectMode={setVisualizerMode}
          isZenMode={isZenMode}
          onToggleZen={() => setIsZenMode(!isZenMode)}
          onOpenExportVideo={() => setIsExportModalOpen(true)}
        />
      </div>

      {/* Panel Lateral de Exportación de Video */}
      <StageExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        defaultVisualizerMode={visualizerMode}
      />
    </div>
  );
};
