import { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { LayoutGrid, Music, Grid3X3, AudioWaveform, Sparkles } from 'lucide-react';
import { useSongStore } from '../../store/songStore';

const VIEWS = [
  { id: 'chord', label: 'CHORD PALETTE', color: '#60a5fa', shortcut: 'Alt+1', Icon: LayoutGrid },
  { id: 'piano-roll', label: 'PIANO ROLL', color: '#a78bfa', shortcut: 'Alt+2', Icon: Music },
  { id: 'sequencer', label: 'DRUM SEQUENCER', color: '#2dd4bf', shortcut: 'Alt+3', Icon: Grid3X3 },
  { id: 'audio-tracks', label: 'TRACKS', color: '#e5a93c', shortcut: 'Alt+4', Icon: AudioWaveform },
  { id: 'visualizer', label: 'STAGE', color: '#5a9e7a', shortcut: 'Alt+5', Icon: Sparkles },
] as const;

export const ViewToggle = () => {
  const activeView = useSongStore((state) => state.activeView);
  const setActiveView = useSongStore((state) => state.setActiveView);
  const trackRef = useRef<HTMLDivElement>(null);
  const [lensStyle, setLensStyle] = useState<{ left: number; width: number }>({ left: 4, width: 0 });

  const syncLens = () => {
    if (!trackRef.current) return;
    const activeBtn = trackRef.current.querySelector<HTMLButtonElement>('.optical-glass-btn.active');
    if (activeBtn) {
      setLensStyle({
        left: activeBtn.offsetLeft,
        width: activeBtn.offsetWidth,
      });
    }
  };

  useLayoutEffect(() => {
    syncLens();
  }, [activeView]);

  useEffect(() => {
    window.addEventListener('resize', syncLens);
    const el = trackRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(syncLens) : null;
    if (ro && el) ro.observe(el);
    return () => {
      window.removeEventListener('resize', syncLens);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="view-toggle-container">
      <span className="mock-label" style={{ marginRight: '8px', fontSize: '0.65rem', fontFamily: '"Share Tech Mono", monospace' }}>
        SELECCIONAR VISTA:
      </span>
      <div className="optical-glass-track" ref={trackRef}>
        <div
          className="optical-glass-lens"
          style={{
            left: `${lensStyle.left}px`,
            width: `${lensStyle.width}px`,
            opacity: lensStyle.width > 0 ? 1 : 0
          }}
        />
        {VIEWS.map((view) => {
          const isActive = activeView === view.id;
          const ViewIcon = view.Icon;
          return (
            <button
              key={view.id}
              className={`optical-glass-btn ${isActive ? 'active' : ''}`}
              onClick={() => setActiveView(view.id)}
              title={`${view.label} (${view.shortcut})`}
              style={
                isActive
                  ? {
                      textShadow: `0 0 8px ${view.color}aa`,
                      borderBottom: `2px solid ${view.color}`,
                      color: '#f3f1f9'
                    }
                  : undefined
              }
            >
              <ViewIcon
                size={12}
                className="view-tab-icon"
                style={{ color: isActive ? view.color : 'currentColor', opacity: isActive ? 1 : 0.65 }}
              />
              <span>{view.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
