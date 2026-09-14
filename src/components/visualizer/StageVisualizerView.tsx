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

  // Alternar pantalla completa real del navegador (F11) acoplada al modo Zen del Stage
  const handleToggleZen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
        setIsZenMode(true);
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
        setIsZenMode(false);
      }
    } catch (err) {
      console.warn('Error al alternar pantalla completa:', err);
      setIsZenMode((prev) => !prev);
    }
  };

  // Sincronizar estado cuando el usuario presiona Escape o F11 en el navegador
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFs = Boolean(document.fullscreenElement);
      setIsZenMode(isNativeFs);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      // Salir de pantalla completa si el usuario cambia de vista
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
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
          onToggleZen={handleToggleZen}
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
