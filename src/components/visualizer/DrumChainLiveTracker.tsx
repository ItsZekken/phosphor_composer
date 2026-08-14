import React, { useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { Drum } from 'lucide-react';
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
  const drumChannels = useSongStore((state) => state.drumChannels);

  // Aplanar la cadena de patrones para visualización continua
  const flatChain = useMemo(() => {
    if (!patternChain || patternChain.length === 0) return [];
    return flattenPatternChain(patternChain);
  }, [patternChain]);

  // Si no hay cadena o está en modo repetición de un solo patrón
  if (isPatternRepeatOn || flatChain.length === 0) {
    const activeColor = DRUM_PATTERN_COLORS[currentDrumPatternEdit % DRUM_PATTERN_COLORS.length];

    return (
      <div className="stage-drum-tracker">
        <div className="stage-drum-header">
          <Drum size={12} style={{ color: activeColor }} />
          <span className="stage-drum-num" style={{ color: activeColor }}>
            P{currentDrumPatternEdit + 1}
          </span>
        </div>

        {/* 16 pasos LED en vivo */}
        <div className="stage-step-strip">
          {Array.from({ length: 16 }).map((_, stepIdx) => {
            const isStepActive = playbackStep === stepIdx && isPlaying;
            // Verificar si algún canal tiene golpe en este paso
            const hasHit = drumChannels.some(
              (ch) => ch.patterns?.[currentDrumPatternEdit]?.[stepIdx]?.isActive
            );

            return (
              <span
                key={stepIdx}
                className={`stage-step-dot ${isStepActive ? 'active' : ''} ${hasHit ? 'has-hit' : ''}`}
                style={{
                  backgroundColor: isStepActive
                    ? '#ffffff'
                    : hasHit
                    ? activeColor
                    : 'rgba(255, 255, 255, 0.08)',
                  boxShadow: isStepActive ? `0 0 8px ${activeColor}` : undefined
                }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="stage-drum-tracker">
      <div className="stage-drum-header">
        <Drum size={12} />
      </div>

      {/* Cadena visual de bloques de patrones */}
      <div className="stage-drum-chain-blocks">
        {patternChain.map((item: PatternChainItem, idx: number) => {
          const patternIdx = item.patternIndex ?? 0;
          const color = DRUM_PATTERN_COLORS[patternIdx % DRUM_PATTERN_COLORS.length];
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
                <span className="stage-drum-chip" style={{ backgroundColor: color }}>
                  P{patternIdx + 1}
                </span>
                {item.repeatCount > 1 && (
                  <span className="stage-repeat-count">×{item.repeatCount}</span>
                )}
              </div>

              {/* 16 pasos si este patrón está activo */}
              {isItemActive && (
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
