import React, { useState, useRef, useEffect } from 'react';
import { X, Video, Download, CheckCircle, AlertCircle, Loader2, Tv } from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import type { VisualizerMode } from './StageTelemetryHUD';

interface StageExportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  defaultVisualizerMode?: VisualizerMode;
}

export const StageExportModal: React.FC<StageExportDrawerProps> = ({
  isOpen,
  onClose,
  defaultVisualizerMode = 'oscilloscope'
}) => {
  const isCrtGlobal = useSongStore((state) => state.isCrtEnabled);
  const [resolution, setResolution] = useState<'1080p' | '720p'>('1080p');
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>(defaultVisualizerMode);
  const [isCrtEnabled, setIsCrtEnabled] = useState<boolean>(isCrtGlobal);

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phaseText, setPhaseText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setVisualizerMode(defaultVisualizerMode);
  }, [defaultVisualizerMode]);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExporting, onClose]);

  if (!isOpen) return null;

  const handleStartExport = async () => {
    setIsExporting(true);
    setProgress(0);
    setPhaseText('Iniciando...');
    setErrorMessage(null);
    setGeneratedBlob(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const blob = await toneEngine.exportStageVideo({
        resolution,
        visualizerMode,
        isCrtEnabled,
        signal: abortController.signal,
        onProgress: (p, phase, elapsedMs) => {
          setProgress(p);
          setPhaseText(phase);
          setElapsedSeconds(Math.round(elapsedMs / 1000));
        }
      });

      setGeneratedBlob(blob);
      setIsExporting(false);
      downloadBlob(blob);
    } catch (err: any) {
      if (abortController.signal.aborted) {
        setPhaseText('Exportación cancelada.');
      } else {
        setErrorMessage(err?.message || 'Error al exportar video.');
      }
      setIsExporting(false);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Phosphor_Stage_${resolution}_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const fileSizeMb = generatedBlob ? (generatedBlob.size / (1024 * 1024)).toFixed(1) : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        justifyContent: 'flex-end'
      }}
      onClick={() => {
        if (!isExporting) onClose();
      }}
    >
      <div
        className="settings-sidebar"
        style={{
          position: 'relative',
          height: '100%',
          width: '330px',
          maxWidth: '85vw',
          zIndex: 2501,
          animation: 'slideInRight 0.2s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado del Panel Lateral */}
        <div className="settings-header">
          <h2>
            <Video size={18} style={{ marginRight: '6px', verticalAlign: 'middle', display: 'inline', color: '#a090e0' }} />
            Exportar Video
          </h2>
          <button
            className="settings-close-btn"
            onClick={onClose}
            disabled={isExporting}
            style={{ opacity: isExporting ? 0.3 : 1 }}
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Configuración */}
        {!isExporting && !generatedBlob && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* SECCIÓN 1: RESOLUCIÓN */}
            <div className="settings-section">
              <div className="settings-section-title">Resolución</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setResolution('1080p')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: resolution === '1080p' ? '1px solid #8470cc' : '1px solid var(--border-color)',
                    background: resolution === '1080p' ? 'rgba(132, 112, 204, 0.2)' : 'var(--bg-tertiary)',
                    color: resolution === '1080p' ? '#ffffff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ fontWeight: 'bold', fontSize: '0.82rem' }}>1080p Full HD</span>
                  <span style={{ fontSize: '0.68rem', opacity: 0.7 }}>1920 × 1080</span>
                </button>
                <button
                  type="button"
                  onClick={() => setResolution('720p')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: resolution === '720p' ? '1px solid #8470cc' : '1px solid var(--border-color)',
                    background: resolution === '720p' ? 'rgba(132, 112, 204, 0.2)' : 'var(--bg-tertiary)',
                    color: resolution === '720p' ? '#ffffff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ fontWeight: 'bold', fontSize: '0.82rem' }}>720p HD</span>
                  <span style={{ fontSize: '0.68rem', opacity: 0.7 }}>1280 × 720</span>
                </button>
              </div>
            </div>

            {/* SECCIÓN 2: VISUALIZADOR DE FONDO */}
            <div className="settings-section">
              <div className="settings-section-title">Visualizador de Fondo</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {(['oscilloscope', 'spectrum', 'lissajous'] as const).map((m) => {
                  const isActive = visualizerMode === m;
                  const label = m === 'oscilloscope' ? 'Osciloscopio' : m === 'spectrum' ? 'Espectro' : 'Lissajous';
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setVisualizerMode(m)}
                      style={{
                        padding: '6px 4px',
                        fontSize: '0.72rem',
                        fontWeight: isActive ? 600 : 400,
                        border: isActive ? '1px solid #8470cc' : '1px solid var(--border-color)',
                        background: isActive ? 'rgba(132, 112, 204, 0.2)' : 'var(--bg-tertiary)',
                        color: isActive ? '#ffffff' : 'var(--text-secondary)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        textAlign: 'center',
                        fontFamily: 'inherit',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SECCIÓN 3: MONITOR CRT */}
            <div className="settings-section">
              <div className="settings-section-title">
                <Tv size={12} style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline' }} />
                Efecto CRT
              </div>
              <div className="switch-container">
                <span className="settings-label">Scanlines y viñeteado</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={isCrtEnabled}
                    onChange={(e) => setIsCrtEnabled(e.target.checked)}
                  />
                  <span className="slider-toggle" />
                </label>
              </div>
            </div>

            {/* Error si ocurre */}
            {errorMessage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: '4px',
                  background: 'rgba(224, 108, 117, 0.12)',
                  border: '1px solid rgba(224, 108, 117, 0.3)',
                  color: '#e06c75',
                  fontSize: '0.75rem'
                }}
              >
                <AlertCircle size={15} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Botón de Exportación */}
            <div style={{ paddingTop: '8px' }}>
              <button
                type="button"
                onClick={handleStartExport}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid #9683dc',
                  background: '#8470cc',
                  color: '#ffffff',
                  fontFamily: "'Outfit', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 10px rgba(132, 112, 204, 0.3)',
                  transition: 'background 0.2s, transform 0.1s'
                }}
              >
                <Video size={16} />
                Exportar Video (.mp4)
              </button>
            </div>
          </div>
        )}

        {/* Progreso Activo */}
        {isExporting && (
          <div className="settings-section" style={{ gap: '12px', paddingTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a090e0' }}>
                <Loader2 size={13} className="animate-spin" />
                {phaseText || 'Exportando...'}
              </span>
              <span style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 'bold' }}>
                {Math.round(progress * 100)}%
              </span>
            </div>

            <div
              style={{
                width: '100%',
                height: '6px',
                background: 'var(--bg-tertiary)',
                borderRadius: '3px',
                overflow: 'hidden',
                border: '1px solid var(--border-color)'
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: '#8470cc',
                  width: `${Math.min(100, Math.max(3, progress * 100))}%`,
                  transition: 'width 0.25s ease'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              <span>Transcurrido: {elapsedSeconds}s</span>
              <span>30 FPS • H.264 + AAC</span>
            </div>

            <button
              type="button"
              onClick={handleCancel}
              style={{
                width: '100%',
                padding: '8px 12px',
                marginTop: '8px',
                borderRadius: '4px',
                border: '1px solid rgba(224, 108, 117, 0.4)',
                background: 'rgba(224, 108, 117, 0.1)',
                color: '#e06c75',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Cancelar Exportación
            </button>
          </div>
        )}

        {/* Completado */}
        {generatedBlob && !isExporting && (
          <div className="settings-section" style={{ alignItems: 'center', textAlign: 'center', gap: '14px', padding: '16px 0' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'rgba(95, 171, 130, 0.15)',
                border: '1px solid rgba(95, 171, 130, 0.3)'
              }}
            >
              <CheckCircle size={26} color="#5fab82" />
            </div>

            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#fff' }}>¡Video Listo!</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {resolution} • {fileSizeMb} MB • MP4
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => downloadBlob(generatedBlob)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '9px',
                  borderRadius: '4px',
                  border: '1px solid #9683dc',
                  background: '#8470cc',
                  color: '#fff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Download size={14} />
                Descargar
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '9px 14px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.8rem',
                  cursor: 'pointer'
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
