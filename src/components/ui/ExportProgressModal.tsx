import React, { useEffect, useRef } from 'react';
import { PhosphorLogo } from './PhosphorLogo';

interface ExportProgressModalProps {
  /** Progreso de 0.0 a 1.0 (opcional para mantener compatibilidad) */
  progress?: number;
  /** Segundos transcurridos */
  elapsed?: number;
  /** Duración total esperada en segundos */
  total?: number;
  /** Callback para cancelar el export */
  onCancel: () => void;
}

export const ExportProgressModal: React.FC<ExportProgressModalProps> = ({ onCancel }) => {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="export-modal-overlay"
      onClick={() => cancelRef.current()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(7, 5, 10, 0.88)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      {/* Contenedor Central con Logo y Circulito de Carga */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '24px',
          pointerEvents: 'none'
        }}
      >
        {/* Logo con Halo Neón Giratorio */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100px',
            height: '100px'
          }}
        >
          <PhosphorLogo size={76} animated />

          {/* Circulito de Carga Giratorio Neón */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '2px solid transparent',
              borderTopColor: '#00e5ff',
              borderRightColor: '#863bff',
              animation: 'spin 0.9s linear infinite',
              filter: 'drop-shadow(0 0 10px rgba(0, 229, 255, 0.45))'
            }}
          />
        </div>

        {/* Texto de Exportando */}
        <span
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: '15px',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#00e5ff',
            textShadow: '0 0 12px rgba(0, 229, 255, 0.6)'
          }}
        >
          EXPORTANDO...
        </span>
      </div>
    </div>
  );
};
