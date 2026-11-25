import React, { useState, useEffect, useRef } from 'react';
import { StageTelemetryHUD } from './StageTelemetryHUD';
import type { VisualizerMode } from './StageTelemetryHUD';
import { StageCanvas } from './StageCanvas';
import { StageExportModal } from './StageExportModal';
import { useSongStore } from '../../store/songStore';
import { isTypingTarget, isModalBlockingShortcuts } from '../../core/shortcuts/isTypingTarget';

export const StageVisualizerView: React.FC = () => {
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('oscilloscope');
  const [isZenMode, setIsZenMode] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  // Sincronizar visibilidad del HUD con el GlobalScrubber en modo Stage Zen
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('phosphor-stage-hud-visibility', {
        detail: { visible: isControlsVisible }
      })
    );
  }, [isControlsVisible]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent('phosphor-stage-hud-visibility', {
          detail: { visible: true }
        })
      );
    };
  }, []);

  // Atajos 1 / 2 / 3 para cambiar modo de visualización en Stage
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (isExportModalOpen) return;
      if (isModalBlockingShortcuts(useSongStore.getState())) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === '1') {
        e.preventDefault();
        setVisualizerMode('oscilloscope');
      } else if (e.key === '2') {
        e.preventDefault();
        setVisualizerMode('spectrum');
      } else if (e.key === '3') {
        e.preventDefault();
        setVisualizerMode('lissajous');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExportModalOpen]);

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
