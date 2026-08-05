import { useEffect, useRef } from 'react';

interface ExportProgressModalProps {
  /** Progreso de 0.0 a 1.0 */
  progress: number;
  /** Segundos transcurridos */
  elapsed: number;
  /** Duración total esperada en segundos */
  total: number;
  /** Callback para cancelar el export */
  onCancel: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ExportProgressModal({
  progress,
  elapsed,
  total,
  onCancel
}: ExportProgressModalProps) {
  const pct = Math.round(Math.min(progress, 1) * 100);
  const isEncoding = progress >= 1;

  // Prevent accidental close with Escape
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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        className="export-modal-card"
        style={{
          background: 'var(--bg-card, #0d0d1a)',
          border: '1px solid var(--accent, #00ffcc)',
          borderRadius: '12px',
          padding: '32px 36px',
          minWidth: '340px',
          maxWidth: '420px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          boxShadow: '0 0 40px rgba(0, 255, 204, 0.15), 0 8px 32px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🎙️</span>
          <div>
            <div style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'var(--accent, #00ffcc)',
              marginBottom: '2px'
            }}>
              {isEncoding ? 'Codificando WAV…' : 'Renderizando audio…'}
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-secondary, #666)',
              fontFamily: "'Share Tech Mono', monospace"
            }}>
              {isEncoding
                ? 'Convirtiendo a WAV PCM 16-bit…'
                : `${formatTime(elapsed)} / ${formatTime(total)}`}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          width: '100%',
          height: '8px',
          background: 'rgba(255,255,255,0.06)',
          borderRadius: '4px',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--accent, #00ffcc), #a855f7)',
              borderRadius: '4px',
              transition: 'width 0.25s ease',
              boxShadow: '0 0 8px var(--accent, #00ffcc)',
            }}
          />
          {/* Animated shimmer */}
          {!isEncoding && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)',
              animation: 'shimmer-bar 1.5s infinite',
            }} />
          )}
        </div>

        {/* Percentage label */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: '24px',
            fontWeight: 700,
            color: 'var(--text-primary, #e0ffe0)',
            letterSpacing: '-0.02em',
          }}>
            {pct}%
          </span>
          <span style={{
            fontSize: '11px',
            color: 'var(--text-secondary, #666)',
            fontFamily: "'Share Tech Mono', monospace"
          }}>
            WAV PCM 16-bit · 44.1kHz
          </span>
        </div>

        {/* Nota informativa */}
        {!isEncoding && (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary, #555)',
            borderLeft: '2px solid var(--accent-dim, rgba(0,255,204,0.25))',
            paddingLeft: '10px',
            lineHeight: '1.5',
          }}>
            El audio se renderiza en tiempo real.<br />
            No modifiques la composición durante el proceso.
          </div>
        )}

        {/* Cancel button */}
        <button
          onClick={onCancel}
          disabled={isEncoding}
          style={{
            alignSelf: 'flex-end',
            padding: '7px 20px',
            background: 'transparent',
            border: '1px solid rgba(255,80,80,0.4)',
            color: isEncoding ? '#444' : '#ff5050',
            borderRadius: '6px',
            cursor: isEncoding ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontFamily: "'Share Tech Mono', monospace",
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            if (!isEncoding) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,80,80,0.08)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          Cancelar
        </button>
      </div>

      {/* Shimmer keyframes (inyectadas inline una sola vez) */}
      <style>{`
        @keyframes shimmer-bar {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
