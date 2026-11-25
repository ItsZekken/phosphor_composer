import React, { useEffect, useMemo, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { Drum } from 'lucide-react';
import { normalizePatternChainToLinear } from '../../utils/typeDefinitions';
import { liveTelemetryBus } from '../../core/audio/liveTelemetryBus';

const DRUM_PATTERN_COLORS = [
  '#5a9e7a',
  '#d4a843',
  '#5e87d6',
  '#c45d9c',
  '#8c73e6',
  '#45b8ac',
  '#e06c6c',
  '#7d98b3'
];

export const DrumChainLiveTracker: React.FC = React.memo(() => {
  const patternChain = useSongStore((state) => state.patternChain);
  const isPatternRepeatOn = useSongStore((state) => state.isPatternRepeatOn);
  const currentDrumPatternEdit = useSongStore((state) => state.currentDrumPatternEdit);
  const isPlaying = useSongStore((state) => state.isPlaying);

  const clipRefs = useRef<Map<string, { root: HTMLDivElement; strip: HTMLDivElement | null; color: string }>>(new Map());
  const activeClipIdRef = useRef<string | null>(null);
  const activeStepRef = useRef<number>(-1);

  const linearClips = useMemo(() => {
    return normalizePatternChainToLinear(patternChain || []);
  }, [patternChain]);

  const totalMeasures = useMemo(() => {
    return Math.ceil(linearClips.reduce((m, c) => Math.max(m, c.startMeasure + c.durationMeasures), 0));
  }, [linearClips]);

  useEffect(() => {
    const clearClip = (id: string | null) => {
      if (!id) return;
      const entry = clipRefs.current.get(id);
      if (!entry) return;
      entry.root.classList.remove('active');
      entry.root.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      entry.root.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
      if (entry.strip) {
        entry.strip.style.display = 'none';
        const prevStep = activeStepRef.current;
        if (prevStep >= 0 && prevStep < entry.strip.children.length) {
          const stEl = entry.strip.children[prevStep] as HTMLElement;
          stEl.classList.remove('active');
          stEl.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        }
      }
    };

    const applyTelemetry = (step: number, chainItemId: string | null) => {
      const targetClipId = isPlaying && !isPatternRepeatOn ? chainItemId : null;

      if (activeClipIdRef.current !== targetClipId) {
        clearClip(activeClipIdRef.current);
        activeClipIdRef.current = targetClipId;
        activeStepRef.current = -1;

        if (targetClipId) {
          const entry = clipRefs.current.get(targetClipId);
          if (entry) {
            entry.root.classList.add('active');
            entry.root.style.borderColor = entry.color;
            entry.root.style.backgroundColor = `${entry.color}24`;
            if (entry.strip) entry.strip.style.display = 'flex';
          }
        }
      }

      if (targetClipId) {
        const entry = clipRefs.current.get(targetClipId);
        if (entry && entry.strip) {
          const prevStep = activeStepRef.current;
          if (prevStep >= 0 && prevStep < entry.strip.children.length) {
            const oldEl = entry.strip.children[prevStep] as HTMLElement;
            oldEl.classList.remove('active');
            oldEl.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
          }
          if (step >= 0 && step < entry.strip.children.length) {
            const newEl = entry.strip.children[step] as HTMLElement;
            newEl.classList.add('active');
            newEl.style.backgroundColor = entry.color;
          }
          activeStepRef.current = step;
        }
      }
    };

    return liveTelemetryBus.subscribeDrumStep(({ step, chainItemId }) => {
      applyTelemetry(step, chainItemId);
    }, true);
  }, [isPlaying, isPatternRepeatOn, linearClips]);

  if (linearClips.length === 0) {
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
            TIMELINE DE BATERÍA ({linearClips.length} {linearClips.length === 1 ? 'clip' : 'clips'} · {totalMeasures} {totalMeasures === 1 ? 'compás' : 'compases'})
          </span>
        </div>
        {isPatternRepeatOn && (
          <span className="stage-chain-repeat-warning" title="El botón 'Loop Patrón' está activo: ignorando el timeline lineal">
            [MODO LOOP P{currentDrumPatternEdit + 1} ACTIVO]
          </span>
        )}
      </div>

      <div className="stage-drum-chain-blocks">
        {linearClips.map((clip) => {
          const patternIdx = clip.patternIndex;
          const color = DRUM_PATTERN_COLORS[patternIdx % DRUM_PATTERN_COLORS.length];
          const startBar = Math.round(clip.startMeasure * 10) / 10 + 1;

          return (
            <div
              key={clip.id}
              ref={(el) => {
                if (el) {
                  const strip = el.querySelector('.stage-mini-step-strip') as HTMLDivElement | null;
                  clipRefs.current.set(clip.id, { root: el, strip, color });
                } else {
                  clipRefs.current.delete(clip.id);
                }
              }}
              className="stage-drum-chain-item"
              style={{
                borderColor: 'rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(255, 255, 255, 0.02)'
              }}
            >
              <div className="stage-drum-chain-tag">
                <span className="stage-drum-chip" style={{ backgroundColor: color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  P{patternIdx + 1}
                </span>
                <span className="stage-repeat-count">c.{startBar} ({clip.durationMeasures}B)</span>
              </div>

              <div className="stage-mini-step-strip" style={{ display: 'none' }}>
                {Array.from({ length: 16 }).map((_, stepIdx) => (
                  <span
                    key={stepIdx}
                    className="stage-mini-step"
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
