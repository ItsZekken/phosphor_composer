import React, { useEffect } from 'react';
import {
  X,
  Package,
  FileCode,
  Sliders,
  Disc,
  Music,
  Video
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
            onExportAudio();
          }
        },
        {
          label: 'MP3',
          ext: '.mp3',
          icon: Music,
          color: '#c084fc',
          action: () => {
            onClose();
            onExportCompressedAudio();
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
            onClose();
            onOpenStageVideo();
          }
        }
      ]
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
        {/* Cabecera minimalista */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.07)'
          }}
        >
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '0.82rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'var(--reposo, #ffd875)'
            }}
          >
            EXPORTAR
          </span>

          <button
            onClick={onClose}
            className="save-export-close-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #9ca3af)',
              cursor: 'pointer',
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

        {/* Secciones: PROYECTO, AUDIO, VIDEO */}
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
      </div>
    </div>
  );
};
