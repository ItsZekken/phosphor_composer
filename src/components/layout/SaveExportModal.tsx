import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Package,
  FileCode,
  Sliders,
  Disc,
  Music,
  Video,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Smartphone
} from 'lucide-react';
import { toneEngine } from '../../audio/toneEngine';
import { useSongStore } from '../../store/songStore';
import type { VisualizerMode } from '../visualizer/StageTelemetryHUD';

export interface SaveExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportProject: () => void;
  onExportJson: () => void;
  onExportMidi: () => void;
  onExportAudio: (realtime?: boolean) => void;
  onExportCompressedAudio: (format: 'mp3' | 'm4a', realtime?: boolean) => void;
  isExporting?: boolean;
}

export const SaveExportModal: React.FC<SaveExportModalProps> = ({
  isOpen,
  onClose,
  onExportProject,
  onExportJson,
  onExportMidi,
  onExportAudio,
  onExportCompressedAudio,
  isExporting = false
}) => {
  const isCrtGlobal = useSongStore((state) => state.isCrtEnabled);

  // Vistas internas del modal: 'formats' (menú principal) | 'video' (configuración y render de video)
  const [currentView, setCurrentView] = useState<'formats' | 'video'>('formats');
  const [realtimeExport, setRealtimeExport] = useState(true); // Default a true para evitar tiempos offline muy largos

  // Ajustes de video
  const [resolution, setResolution] = useState<'1080p' | '720p'>('1080p');
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('oscilloscope');
  const [isCrtEnabled, setIsCrtEnabled] = useState<boolean>(isCrtGlobal);

  // Estado de exportación de video
  const [isVideoExporting, setIsVideoExporting] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoPhase, setVideoPhase] = useState('');
  const [videoElapsed, setVideoElapsed] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Reiniciar a la vista de formatos al abrir el modal
  useEffect(() => {
    if (isOpen) {
      setCurrentView('formats');
      setIsCrtEnabled(isCrtGlobal);
      setVideoError(null);
    }
  }, [isOpen, isCrtGlobal]);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isVideoExporting) {
        if (currentView === 'video') {
          setCurrentView('formats');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, currentView, isVideoExporting]);

  if (!isOpen) return null;

  const handleStartVideoExport = async () => {
    setIsVideoExporting(true);
    setVideoProgress(0);
    setVideoPhase('Iniciando...');
    setVideoError(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const blob = await toneEngine.exportStageVideo({
        resolution,
        visualizerMode,
        isCrtEnabled,
        signal: abortController.signal,
        onProgress: (p, phase, elapsedMs) => {
          setVideoProgress(p);
          setVideoPhase(phase);
          setVideoElapsed(Math.round(elapsedMs / 1000));
        }
      });

      downloadVideoBlob(blob);
      setIsVideoExporting(false);
      onClose();
    } catch (err: any) {
      if (abortController.signal.aborted) {
        setVideoPhase('Exportación cancelada.');
      } else {
        setVideoError(err?.message || 'Error al exportar video.');
      }
      setIsVideoExporting(false);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleCancelVideoExport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const downloadVideoBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Phosphor_Stage_${resolution}_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const sections = [
    {
      title: 'PROYECTO',
      items: [
        {
          label: 'Phosphor',
          ext: '.phos',
          icon: Package,
          color: '#ffd875',
          action: () => {
            onClose();
            onExportProject();
          }
        },
        {
          label: 'JSON',
          ext: '.json',
          icon: FileCode,
          color: '#4ade80',
          action: () => {
            onClose();
            onExportJson();
          }
        },
        {
          label: 'MIDI',
          ext: '.mid',
          icon: Sliders,
          color: '#fb923c',
          action: () => {
            onClose();
            onExportMidi();
          }
        }
      ]
    },
    {
      title: 'AUDIO',
      items: [
        {
          label: 'WAV',
          ext: '.wav',
          icon: Disc,
          color: '#38bdf8',
          action: () => {
            onClose();
            onExportAudio(realtimeExport);
          }
        },
        {
          label: 'MP3',
          ext: '.mp3',
          icon: Music,
          color: '#c084fc',
          action: () => {
            onClose();
            onExportCompressedAudio('mp3', realtimeExport);
          }
        },
        {
          label: 'M4A',
          ext: '.m4a',
          icon: Smartphone,
          color: '#f472b6',
          action: () => {
            onClose();
            onExportCompressedAudio('m4a', realtimeExport);
          }
        }
      ]
    },
    {
      title: 'VIDEO',
      items: [
        {
          label: 'Stage',
          ext: '.mp4',
          icon: Video,
          color: '#f43f5e',
          action: () => {
            setCurrentView('video');
          }
        }
      ]
    }
  ];

  return (
    <div
      className="save-export-overlay"
      onClick={() => {
        if (!isVideoExporting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99990,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(6, 4, 10, 0.78)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        padding: '16px'
      }}
    >
      <div
        className="save-export-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '560px',
          maxWidth: '100%',
          backgroundColor: '#130f1c',
          border: '1px solid rgba(132, 112, 204, 0.22)',
          borderRadius: '8px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.85), 0 0 20px rgba(132, 112, 204, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Cabecera minimalista con botón de volver si estamos en vista de video */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.07)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {currentView === 'video' && (
              <button
                disabled={isVideoExporting}
                onClick={() => setCurrentView('formats')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary, #9ca3af)',
                  cursor: isVideoExporting ? 'not-allowed' : 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Volver"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: '0.82rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: currentView === 'video' ? '#f43f5e' : 'var(--reposo, #ffd875)'
              }}
            >
              {currentView === 'video' ? 'EXPORTAR VIDEO (.MP4)' : 'EXPORTAR'}
            </span>
          </div>

          <button
            onClick={onClose}
            disabled={isVideoExporting}
            className="save-export-close-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #9ca3af)',
              cursor: isVideoExporting ? 'not-allowed' : 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* VISTA 1: MENÚ PRINCIPAL DE FORMATOS */}
        {currentView === 'formats' && (
          <>
            <div
              className="save-export-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                padding: '16px'
              }}
            >
              {sections.map((sec) => (
                <div
                  key={sec.title}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'Share Tech Mono', monospace",
                      fontSize: '0.64rem',
                      letterSpacing: '0.14em',
                      color: 'rgba(255, 255, 255, 0.45)',
                      marginBottom: '2px',
                      paddingLeft: '2px'
                    }}
                  >
                    {sec.title}
                  </div>

                  {sec.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.ext}
                        disabled={isExporting}
                        onClick={item.action}
                        className="save-export-item-btn"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '9px 10px',
                          borderRadius: '5px',
                          backgroundColor: 'rgba(255, 255, 255, 0.025)',
                          border: '1px solid rgba(255, 255, 255, 0.07)',
                          cursor: isExporting ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s ease',
                          outline: 'none'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Icon size={14} style={{ color: item.color }} />
                          <span
                            style={{
                              fontFamily: "'Outfit', system-ui, sans-serif",
                              fontWeight: 600,
                              fontSize: '0.80rem',
                              color: '#f3f0ff'
                            }}
                          >
                            {item.label}
                          </span>
                        </div>

                        <span
                          style={{
                            fontFamily: "'Share Tech Mono', monospace",
                            fontSize: '0.65rem',
                            color: item.color,
                            letterSpacing: '0.04em'
                          }}
                        >
                          {item.ext}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Toggle de Modo de Renderizado (Offline vs Tiempo Real) para AUDIO */}
            <div
              style={{
                margin: '0 16px 16px 16px',
                padding: '10px 12px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                userSelect: 'none'
              }}
              onClick={() => setRealtimeExport(!realtimeExport)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span
                  style={{
                    fontFamily: "'Outfit', system-ui, sans-serif",
                    fontWeight: 600,
                    fontSize: '0.78rem',
                    color: '#f3f0ff'
                  }}
                >
                  Exportar en Tiempo Real (1x)
                </span>
                <span
                  style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: '0.62rem',
                    color: 'rgba(255, 255, 255, 0.5)',
                  }}
                >
                  {realtimeExport 
                    ? 'Graba la salida principal mientras reproduce.'
                    : 'Renderizado offline ultra-preciso (MUY lento).'}
                </span>
              </div>
              
              <div
                style={{
                  width: '32px',
                  height: '18px',
                  borderRadius: '10px',
                  backgroundColor: realtimeExport ? '#10b981' : 'rgba(255, 255, 255, 0.2)',
                  position: 'relative',
                  transition: 'all 0.2s ease',
                  flexShrink: 0
                }}
              >
                <div
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: '#fff',
                    position: 'absolute',
                    top: '2px',
                    left: realtimeExport ? '16px' : '2px',
                    transition: 'all 0.2s ease'
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* VISTA 2: MENÚ DE CONFIGURACIÓN Y RENDER DE VIDEO */}
        {currentView === 'video' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {!isVideoExporting && (
              <>
                {/* 1. Resolución */}
                <div>
                  <div
                    style={{
                      fontFamily: "'Share Tech Mono', monospace",
                      fontSize: '0.64rem',
                      letterSpacing: '0.14em',
                      color: 'rgba(255, 255, 255, 0.45)',
                      marginBottom: '6px'
                    }}
                  >
                    RESOLUCIÓN
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {(['1080p', '720p'] as const).map((res) => {
                      const isSelected = resolution === res;
                      return (
                        <button
                          key={res}
                          type="button"
                          onClick={() => setResolution(res)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: '5px',
                            border: isSelected ? '1px solid #f43f5e' : '1px solid rgba(255, 255, 255, 0.08)',
                            background: isSelected ? 'rgba(244, 63, 94, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                            color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '0.80rem' }}>
                            {res === '1080p' ? '1080p Full HD' : '720p HD'}
                          </span>
                          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '0.65rem', opacity: 0.7 }}>
                            {res === '1080p' ? '1920×1080' : '1280×720'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Visualizador */}
                <div>
                  <div
                    style={{
                      fontFamily: "'Share Tech Mono', monospace",
                      fontSize: '0.64rem',
                      letterSpacing: '0.14em',
                      color: 'rgba(255, 255, 255, 0.45)',
                      marginBottom: '6px'
                    }}
                  >
                    VISUALIZADOR
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                    {(['oscilloscope', 'spectrum', 'lissajous'] as const).map((m) => {
                      const isSelected = visualizerMode === m;
                      const label = m === 'oscilloscope' ? 'Osciloscopio' : m === 'spectrum' ? 'Espectro' : 'Lissajous';
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setVisualizerMode(m)}
                          style={{
                            padding: '7px 8px',
                            fontSize: '0.76rem',
                            fontFamily: "'Outfit', sans-serif",
                            fontWeight: isSelected ? 600 : 400,
                            borderRadius: '5px',
                            border: isSelected ? '1px solid #f43f5e' : '1px solid rgba(255, 255, 255, 0.08)',
                            background: isSelected ? 'rgba(244, 63, 94, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                            color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            textAlign: 'center',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. CRT Scanlines Toggle */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)'
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Share Tech Mono', monospace",
                      fontSize: '0.68rem',
                      letterSpacing: '0.08em',
                      color: 'rgba(255, 255, 255, 0.7)'
                    }}
                  >
                    SCANLINES CRT
                  </span>
                  <label className="switch" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={isCrtEnabled}
                      onChange={(e) => setIsCrtEnabled(e.target.checked)}
                    />
                    <span className="slider-toggle" />
                  </label>
                </div>

                {/* Mensaje de error si falla */}
                {videoError && (
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
                      fontSize: '0.72rem'
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{videoError}</span>
                  </div>
                )}

                {/* Botón de Iniciar Exportación */}
                <button
                  type="button"
                  onClick={handleStartVideoExport}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    borderRadius: '5px',
                    border: '1px solid #f43f5e',
                    background: '#f43f5e',
                    color: '#ffffff',
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    marginTop: '2px',
                    boxShadow: '0 2px 10px rgba(244, 63, 94, 0.25)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Video size={16} />
                  Exportar Video (.mp4)
                </button>
              </>
            )}

            {/* Progreso de renderizado de video */}
            {isVideoExporting && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#f3f0ff' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f43f5e' }}>
                    <Loader2 size={13} className="animate-spin" />
                    {videoPhase || 'Renderizando fotogramas...'}
                  </span>
                  <span style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 'bold' }}>
                    {Math.round(videoProgress * 100)}%
                  </span>
                </div>

                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    border: '1px solid rgba(255, 255, 255, 0.1)'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      background: '#f43f5e',
                      width: `${Math.min(100, Math.max(3, videoProgress * 100))}%`,
                      transition: 'width 0.2s ease'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                  <span>{videoElapsed}s</span>
                  <span>1080p 30 FPS • H.264</span>
                </div>

                <button
                  type="button"
                  onClick={handleCancelVideoExport}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    marginTop: '6px',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: '0.70rem',
                    cursor: 'pointer'
                  }}
                >
                  CANCELAR
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
