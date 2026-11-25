import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { useSongStore } from '../../../store/songStore';
import { toneEngine } from '../../../audio/toneEngine';
import { liveTelemetryBus } from '../../../core/audio/liveTelemetryBus';

export interface PianoKeyInfo {
  midi: number;
  name: string;
  isBlack: boolean;
}

const normalizeNoteCache = new Map<string, string>();

function normalizeNote(n: string): string {
  if (!n) return '';
  const hit = normalizeNoteCache.get(n);
  if (hit !== undefined) return hit;
  const normalized = n.toUpperCase()
    .replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#')
    .replace('AB', 'G#').replace('BB', 'A#');
  if (normalizeNoteCache.size < 512) normalizeNoteCache.set(n, normalized);
  return normalized;
}

interface PianoRollSidebarProps {
  rowHeight: number;
  pianoKeys: PianoKeyInfo[];
  activeNotes?: string[];
  activeMelodyNotes?: string[];
  scalePitchClasses: Set<number>;
  rootMidiMod: number;
  isScaleHighlightActive: boolean;
}

export const PianoRollSidebar: React.FC<PianoRollSidebarProps> = React.memo(({
  rowHeight,
  pianoKeys,
  scalePitchClasses,
  rootMidiMod,
  isScaleHighlightActive
}) => {
  const activeTrackId = useSongStore((s) => s.activeTrackId);
  const tracks = useSongStore((s) => s.tracks);
  const activeTrack = useMemo(() => (tracks || []).find((t) => t.id === activeTrackId), [tracks, activeTrackId]);
  const currentChannelId = activeTrack ? activeTrack.channelId : 'melody';
  const trackColor = activeTrack?.color;

  const currentChannelIdRef = useRef(currentChannelId);
  currentChannelIdRef.current = currentChannelId;

  const trackColorRef = useRef<string | undefined>(trackColor);
  trackColorRef.current = trackColor;

  const keyRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerKeyRef = useCallback((noteName: string, el: HTMLDivElement | null) => {
    if (el) keyRefs.current.set(noteName, el);
    else keyRefs.current.delete(noteName);
  }, []);

  const activeMouseNoteRef = useRef<string | null>(null);

  const handleStartNote = useCallback((noteName: string) => {
    if (activeMouseNoteRef.current && activeMouseNoteRef.current !== noteName) {
      toneEngine.stopNote(activeMouseNoteRef.current, currentChannelIdRef.current);
    }
    activeMouseNoteRef.current = noteName;
    toneEngine.startNote(noteName, currentChannelIdRef.current);
  }, []);

  const handleStopNote = useCallback((noteName: string) => {
    if (activeMouseNoteRef.current === noteName) {
      toneEngine.stopNote(noteName, currentChannelIdRef.current);
      activeMouseNoteRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (activeMouseNoteRef.current) {
        toneEngine.stopNote(activeMouseNoteRef.current, currentChannelIdRef.current);
        activeMouseNoteRef.current = null;
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // Suscripción imperativa al bus de telemetría en vivo sin re-renders ni Sets efímeros
  const prevHarmonySetRef = useRef<Set<string>>(new Set());
  const prevMelodySetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const updateKeyVisuals = (
      noteName: string,
      isMelody: boolean,
      isHarmony: boolean,
      color?: string
    ) => {
      const el = keyRefs.current.get(noteName);
      if (!el) return;
      const isBlack = el.classList.contains('black');

      if (isMelody) {
        el.classList.add('active', 'active-melody');
        el.classList.remove('active-harmony');
        if (color) {
          el.style.setProperty('--melody-key-color', color);
          el.style.setProperty(
            'background',
            isBlack
              ? `linear-gradient(to right, ${color}33 0%, ${color}88 60%, ${color} 100%)`
              : `linear-gradient(to right, ${color}66 0%, ${color}bb 60%, ${color} 100%)`,
            'important'
          );
          el.style.setProperty('box-shadow', `inset 0 0 6px ${color}, 2px 0 8px ${color}`, 'important');
          el.style.setProperty('border-right-color', '#14111a', 'important');
        }
      } else if (isHarmony) {
        el.classList.add('active', 'active-harmony');
        el.classList.remove('active-melody');
        el.style.removeProperty('--melody-key-color');
        el.style.setProperty(
          'background',
          isBlack
            ? 'linear-gradient(to right, #223a5e 0%, #35507a 60%, #5072a8 100%)'
            : 'linear-gradient(to right, #35507a 0%, #5072a8 60%, #688abf 100%)',
          'important'
        );
        el.style.setProperty(
          'box-shadow',
          isBlack
            ? 'inset 0 0 5px rgba(80, 114, 168, 0.7), 2px 0 5px rgba(80, 114, 168, 0.5)'
            : 'inset 0 0 6px rgba(80, 114, 168, 0.5), 2px 0 6px rgba(80, 114, 168, 0.4)',
          'important'
        );
      } else {
        el.classList.remove('active', 'active-harmony', 'active-melody');
        el.style.removeProperty('--melody-key-color');
        el.style.removeProperty('background');
        el.style.removeProperty('box-shadow');
        el.style.removeProperty('border-right-color');
      }
    };

    const nextHarmonySet = new Set<string>();
    const nextMelodySet = new Set<string>();

    const unsubscribe = liveTelemetryBus.subscribeActiveNotes(({ harmony, melody }) => {
      nextHarmonySet.clear();
      for (let i = 0; i < harmony.length; i++) nextHarmonySet.add(normalizeNote(harmony[i]));
      nextMelodySet.clear();
      for (let i = 0; i < melody.length; i++) nextMelodySet.add(normalizeNote(melody[i]));

      const prevH = prevHarmonySetRef.current;
      const prevM = prevMelodySetRef.current;
      const color = trackColorRef.current;

      prevH.forEach((n) => {
        if (!nextHarmonySet.has(n) || nextMelodySet.has(n)) {
          updateKeyVisuals(n, nextMelodySet.has(n), nextHarmonySet.has(n), color);
        }
      });
      prevM.forEach((n) => {
        if (!nextMelodySet.has(n)) {
          updateKeyVisuals(n, false, nextHarmonySet.has(n), color);
        }
      });
      nextHarmonySet.forEach((n) => {
        if (!prevH.has(n) && !nextMelodySet.has(n)) {
          updateKeyVisuals(n, false, true, color);
        }
      });
      nextMelodySet.forEach((n) => {
        if (!prevM.has(n)) {
          updateKeyVisuals(n, true, nextHarmonySet.has(n), color);
        }
      });

      prevH.clear();
      nextHarmonySet.forEach((n) => prevH.add(n));
      prevM.clear();
      nextMelodySet.forEach((n) => prevM.add(n));
    }, true);

    return () => {
      unsubscribe();
    };
  }, []);

  const totalHeight = (pianoKeys || []).length * rowHeight;

  return (
    <div 
      className="piano-keys-list" 
      style={{ 
        display: 'flex', 
        flexDirection: 'column',
        width: '100%',
        height: `${totalHeight}px`,
        flexShrink: 0
      }}
    >
      {(pianoKeys || []).map((key) => {
        const pitchClass = ((key.midi % 12) + 12) % 12;
        const inScale = scalePitchClasses?.has(pitchClass) ?? false;
        const isRoot = pitchClass === rootMidiMod;

        return (
          <div
            key={key.midi}
            ref={(el) => registerKeyRef(normalizeNote(key.name), el)}
            className={`sidebar-key ${key.isBlack ? 'black' : 'white'}`}
            style={{ 
              height: `${rowHeight}px`,
              minHeight: `${rowHeight}px`,
              maxHeight: `${rowHeight}px`,
              boxSizing: 'border-box',
              flexShrink: 0,
              position: 'relative',
              lineHeight: `${Math.max(10, rowHeight - 1)}px`,
              fontSize: `${Math.min(10, Math.max(7, Math.floor(rowHeight * 0.45)))}px`,
              backgroundColor: isScaleHighlightActive
                ? (isRoot ? (key.isBlack ? '#261c3b' : '#342652') : inScale ? (key.isBlack ? '#1b172a' : '#292240') : (key.isBlack ? '#0c0a12' : '#14111c'))
                : undefined
            }}
            onMouseDown={(e) => {
              if (e.button === 0) {
                handleStartNote(key.name);
              }
            }}
            onMouseEnter={(e) => {
              if (e.buttons === 1) {
                handleStartNote(key.name);
              }
            }}
            onMouseUp={() => handleStopNote(key.name)}
            onMouseLeave={() => handleStopNote(key.name)}
          >
            <span>{key.isBlack ? '' : key.name}</span>
            {isScaleHighlightActive && isRoot && (
              <span style={{ position: 'absolute', right: '3px', width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#ffd875', boxShadow: '0 0 5px #ffd875' }} />
            )}
          </div>
        );
      })}
    </div>
  );
});
