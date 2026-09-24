import React, { useEffect } from 'react';
import {
  X,
  Package,
  FileCode,
  Disc,
  Music,
  Sliders,
  Video,
  ArrowRight,
  HardDrive
} from 'lucide-react';

export interface SaveExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportProject: () => void;
  onExportJson: () => void;
  onExportMidi: () => void;
  onExportAudio: () => void;
  onExportCompressedAudio: () => void;
  onOpenStageVideo: () => void;
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
  onOpenStageVideo,
  isExporting = false
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const exportOptions = [
    {
      id: 'project',
      category: 'PROYECTO INTEGRAL',
      ext: '.PHOS',
      title: 'Proyecto Completo',
      desc: 'Sesión íntegra, notas, pistas grabadas y configuración',
      icon: Package,
      color: '#ffd875',
      glow: 'rgba(255, 216, 117, 0.25)',
      action: () => {
        onClose();
        onExportProject();
      }
    },
    {
      id: 'json',
      category: 'PROYECTO INTEGRAL',
      ext: '.JSON',
      title: 'Estructura JSON',
      desc: 'Datos ligeros de acordes, melodías y secuenciador',
      icon: FileCode,
      color: '#4ade80',
      glow: 'rgba(74, 222, 128, 0.25)',
      action: () => {
        onClose();
        onExportJson();
      }
    },
    {
      id: 'wav',
      category: 'AUDIO MASTER',
      ext: '.WAV',
      title: 'Master de Estudio',
      desc: 'Audio estéreo sin pérdida (PCM 24-bit 44.1 kHz)',
      icon: Disc,
      color: '#38bdf8',
      glow: 'rgba(56, 189, 248, 0.25)',
      action: () => {
        onClose();
        onExportAudio();
      }
    },
    {
      id: 'mp3',
      category: 'AUDIO MASTER',
      ext: '.MP3',
      title: 'Audio Comprimido',
      desc: 'Exportación ligera codificada a 320 kbps',
      icon: Music,
      color: '#c084fc',
      glow: 'rgba(192, 132, 252, 0.25)',
      action: () => {
        onClose();
        onExportCompressedAudio();
      }
    },
    {
      id: 'midi',
      category: 'MULTITRACK & VIDEO',
      ext: '.MID',
      title: 'MIDI Multicanal',
      desc: 'Pistas separadas compatibles con cualquier DAW',
      icon: Sliders,
      color: '#fb923c',
      glow: 'rgba(251, 146, 60, 0.25)',
      action: () => {
        onClose();
        onExportMidi();
      }
    },
    {
      id: 'video',
      category: 'MULTITRACK & VIDEO',
      ext: '.MP4',
      title: 'Video Stage CRT',
      desc: 'Visualizador cinemático 1080p con telemetría en vivo',
      icon: Video,
      color: '#f43f5e',
      glow: 'rgba(244, 63, 94, 0.25)',
      action: () => {
        onClose();
        onOpenStageVideo();
      }
    }
  ];

  return (
    <div
      className="save-export-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99990,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(6, 4, 10, 0.82)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        padding: '16px'
      }}
    >
      <div
        className="save-export-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '680px',
          maxWidth: '100%',
          backgroundColor: '#15111e',
          border: '1px solid rgba(132, 112, 204, 0.28)',
          borderRadius: '12px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(132, 112, 204, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Cabecera del Centro de Guardado */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            backgroundColor: 'rgba(255, 255, 255, 0.02)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 216, 117, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffd875'
              }}
            >
              <HardDrive size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontFamily: "'Outfit', system-ui, sans-serif",
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: '#f3f0ff',
                    letterSpacing: '0.04em'
                  }}
                >
                  CENTRO DE EXPORTACIÓN
                </span>
                <span
                  style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: '0.62rem',
                    color: '#4ade80',
                    backgroundColor: 'rgba(74, 222, 128, 0.12)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    border: '1px solid rgba(74, 222, 128, 0.3)'
                  }}
                >
                  6 FORMATOS
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.72rem',
                  color: 'var(--text-secondary, #9ca3af)',
                  fontFamily: "'Outfit', system-ui, sans-serif"
                }}
              >
                Guarda tu proyecto o exporta stems, audio estéreo y video
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="save-export-close-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #9ca3af)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease'
            }}
            title="Cerrar (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Cuadrícula de Opciones de Exportación */}
        <div
          style={{
            padding: '20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '12px',
            maxHeight: '75vh',
            overflowY: 'auto'
          }}
        >
          {exportOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                disabled={isExporting}
                onClick={opt.action}
                className="save-export-card"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14px',
                  padding: '14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {/* Icono con halo del color del formato */}
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '8px',
                    backgroundColor: `rgba(255, 255, 255, 0.04)`,
                    border: `1px solid ${opt.color}33`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: opt.color,
                    flexShrink: 0,
                    boxShadow: `0 0 12px ${opt.glow}`
                  }}
                >
                  <Icon size={20} />
                </div>

                {/* Contenido Textual Mínimo */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span
                      style={{
                        fontFamily: "'Share Tech Mono', monospace",
                        fontSize: '0.70rem',
                        fontWeight: 700,
                        color: opt.color,
                        letterSpacing: '0.08em'
                      }}
                    >
                      {opt.ext}
                    </span>
                    <span
                      style={{
                        fontFamily: "'Outfit', system-ui, sans-serif",
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        color: '#f3f0ff',
                        letterSpacing: '0.01em'
                      }}
                    >
                      {opt.title}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.72rem',
                      lineHeight: '1.25',
                      color: 'var(--text-secondary, #9ca3af)',
                      fontFamily: "'Outfit', system-ui, sans-serif"
                    }}
                  >
                    {opt.desc}
                  </p>
                </div>

                {/* Flecha indicadora */}
                <div
                  className="card-arrow"
                  style={{
                    color: 'rgba(255, 255, 255, 0.25)',
                    alignSelf: 'center',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <ArrowRight size={15} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Barra Inferior Analógica */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 20px',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            fontSize: '0.68rem',
            fontFamily: "'Share Tech Mono', monospace",
            color: 'rgba(255, 255, 255, 0.4)'
          }}
        >
          <span>PHOSPHOR AUDIO ENGINE v2.0</span>
          <span>[ESC] CERRAR</span>
        </div>
      </div>
    </div>
  );
};
