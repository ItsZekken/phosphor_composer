import React, { useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { Drum, VolumeX } from 'lucide-react';
import { flattenPatternChain } from '../../utils/typeDefinitions';
import type { PatternChainItem } from '../../utils/typeDefinitions';

const DRUM_PATTERN_COLORS = [
  'var(--reposo)',
  'var(--subdominante)',
  'var(--tension)',
  'var(--spicy)',
  'var(--exotic)',
  '#ff007f',
  '#00bfff',
  '#ffaa00'
];

export const DrumChainLiveTracker: React.FC = React.memo(() => {
  const patternChain = useSongStore((state) => state.patternChain);
  const isPatternRepeatOn = useSongStore((state) => state.isPatternRepeatOn);
  const currentDrumPatternEdit = useSongStore((state) => state.currentDrumPatternEdit);
  const currentChainItemId = useSongStore((state) => state.currentChainItemId);
  const playbackStep = useSongStore((state) => state.playbackStep);
  const isPlaying = useSongStore((state) => state.isPlaying);

  // Determinar número total de pasos de la cadena completa
  const totalMeasures = useMemo(() => {
    return flattenPatternChain(patternChain).length;
  }, [patternChain]);

  // Si no hay cadena o está vacía
  if (!patternChain || patternChain.length === 0) {
    return (
      <div className="stage-drum-chain-tracker empty">
        <div className="stage-drum-chain-meta">
          <Drum size={13} className="stage-drum-icon" />
          <span className="stage-drum-label">PATRÓN ÚNICO P{currentDrumPatternEdit + 1} (LOOP)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="stage-drum-chain-tracker">
      <div className="stage-drum-chain-meta">
        <div className="stage-drum-meta-left">
          <Drum size={13} className="stage-drum-icon" />
          <span className="stage-drum-label">
            CADENA DE BATERÍA ({patternChain.length} {patternChain.length === 1 ? 'bloque' : 'bloques'} · {totalMeasures} {totalMeasures === 1 ? 'compás' : 'compases'})
          </span>
        </div>
        {isPatternRepeatOn && (
          <span className="stage-chain-repeat-warning" title="El botón 'Repetir Patrón' está activo: ignorando la cadena">
            [MODO LOOP 1 PATRÓN ACTIVO]
          </span>
        )}
      </div>

      {/* Cadena visual de bloques de patrones */}
      <div className="stage-drum-chain-blocks">
        {patternChain.map((item: PatternChainItem, idx: number) => {
          const isRest = item.type === 'rest' || item.patternIndex === -1;
          const patternIdx = isRest ? -1 : (item.patternIndex ?? 0);
          const color = isRest ? 'rgba(255, 255, 255, 0.35)' : DRUM_PATTERN_COLORS[patternIdx % DRUM_PATTERN_COLORS.length];
          const isItemActive = item.id === currentChainItemId && isPlaying;

          return (
            <div
              key={item.id || idx}
              className={`stage-drum-chain-item ${isItemActive ? 'active' : ''}`}
              style={{
                borderColor: isItemActive ? color : 'rgba(255, 255, 255, 0.08)',
                backgroundColor: isItemActive ? `${color}20` : 'rgba(255, 255, 255, 0.02)'
              }}
            >
              <div className="stage-drum-chain-tag">
                <span className="stage-drum-chip" style={{ backgroundColor: color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isRest ? (
                    <VolumeX size={11} />
                  ) : (
                    `P${patternIdx + 1}`
                  )}
                </span>
                {item.repeatCount > 1 && (
                  <span className="stage-repeat-count">×{item.repeatCount}</span>
                )}
              </div>

              {/* 16 pasos si este patrón está activo y no es silencio */}
              {isItemActive && !isRest && (
                <div className="stage-mini-step-strip">
                  {Array.from({ length: 16 }).map((_, stepIdx) => (
                    <span
                      key={stepIdx}
                      className={`stage-mini-step ${playbackStep === stepIdx ? 'active' : ''}`}
                      style={{
                        backgroundColor: playbackStep === stepIdx ? color : 'rgba(255, 255, 255, 0.1)'
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
