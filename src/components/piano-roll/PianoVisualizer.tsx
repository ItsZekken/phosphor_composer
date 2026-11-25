import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { liveTelemetryBus } from '../../core/audio/liveTelemetryBus';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface KeyDef {
  midi: number;
  noteName: string;
  isBlack: boolean;
  label: string;
}

const normalizeNoteCache = new Map<string, string>();

// Normaliza nombres de notas al formato sostenido (con caché O(1))
function normalizeNote(n: string): string {
  const hit = normalizeNoteCache.get(n);
  if (hit !== undefined) return hit;
  const normalized = n.toUpperCase()
    .replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#')
    .replace('AB', 'G#').replace('BB', 'A#');
  if (normalizeNoteCache.size < 512) normalizeNoteCache.set(n, normalized);
  return normalized;
}

interface PianoKeyProps {
  keyDef: KeyDef;
  isCenterNote: boolean;
  style?: React.CSSProperties;
  onSetCenterNote: (noteName: string) => void;
  registerKeyRef: (note: string, el: HTMLDivElement | null) => void;
  onStartNote: (noteName: string) => void;
  onStopNote: (noteName: string) => void;
}

const PianoKey = React.memo(({ 
  keyDef, 
  isCenterNote,
  style,
  onSetCenterNote,
  registerKeyRef,
  onStartNote,
  onStopNote
}: PianoKeyProps) => {
  const isBlack = keyDef.isBlack;
  const className = `top-piano-key ${isBlack ? 'black' : 'white'}`;

  return (
    <div
      ref={(el) => registerKeyRef(normalizeNote(keyDef.noteName), el)}
      className={className}
      style={style}
      title={`${keyDef.noteName} (Click izq: probar | Click dcho: definir como nota central)`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSetCenterNote(keyDef.noteName);
      }}
      onMouseDown={(e) => {
        if (e.button === 0) {
          onStartNote(keyDef.noteName);
        }
      }}
      onMouseEnter={(e) => {
        if (e.buttons === 1) {
          onStartNote(keyDef.noteName);
        }
      }}
      onMouseUp={() => {
        onStopNote(keyDef.noteName);
      }}
      onMouseLeave={() => {
        onStopNote(keyDef.noteName);
      }}
    >
      {!isBlack && keyDef.label && <span className="key-label">{keyDef.label}</span>}
      {isCenterNote && (
        <span 
          className="center-note-dot" 
          style={{
            position: 'absolute',
            bottom: isBlack ? '4px' : '3px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            backgroundColor: isBlack ? '#9a88b5' : '#382a4d',
            boxShadow: isBlack ? '0 0 2px rgba(255,255,255,0.4)' : '0 0 2px rgba(0,0,0,0.5)',
            zIndex: 15,
            pointerEvents: 'none'
          }} 
        />
      )}
    </div>
  );
});

export const PianoVisualizer: React.FC = () => {
  const keyboardCenterNote = useSongStore(state => state.keyboardCenterNote);
  const setKeyboardCenterNote = useSongStore(state => state.setKeyboardCenterNote);
  const activeTrackId = useSongStore(state => state.activeTrackId);
  const tracks = useSongStore(state => state.tracks);

  const activeTrack = useMemo(() => tracks.find(t => t.id === activeTrackId), [tracks, activeTrackId]);
  const activeChannelId = activeTrack ? activeTrack.channelId : 'melody';
  const melodyColor = activeTrack?.color;

  const keyElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerKeyRef = useCallback((note: string, el: HTMLDivElement | null) => {
    if (el) keyElementsRef.current.set(note, el);
    else keyElementsRef.current.delete(note);
  }, []);

  const activeChannelIdRef = useRef(activeChannelId);
  activeChannelIdRef.current = activeChannelId;

  const melodyColorRef = useRef<string | undefined>(melodyColor);
  melodyColorRef.current = melodyColor;

  const activeMouseNoteRef = useRef<string | null>(null);

  const handleStartNote = useCallback((noteName: string) => {
    if (activeMouseNoteRef.current && activeMouseNoteRef.current !== noteName) {
      toneEngine.stopNote(activeMouseNoteRef.current, activeChannelIdRef.current);
    }
    activeMouseNoteRef.current = noteName;
    toneEngine.startNote(noteName, activeChannelIdRef.current);
  }, []);

  const handleStopNote = useCallback((noteName: string) => {
    if (activeMouseNoteRef.current === noteName) {
      toneEngine.stopNote(noteName, activeChannelIdRef.current);
      activeMouseNoteRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (activeMouseNoteRef.current) {
        toneEngine.stopNote(activeMouseNoteRef.current, activeChannelIdRef.current);
        activeMouseNoteRef.current = null;
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // Suscripción imperativa al bus de telemetría en vivo (cero re-renders, cero allocations por tick)
  const prevHarmonySetRef = useRef<Set<string>>(new Set());
  const prevMelodySetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const applyKeyVisuals = (
      note: string,
      isMelody: boolean,
      isHarmony: boolean,
      color?: string
    ) => {
      const el = keyElementsRef.current.get(note);
      if (!el) return;
      const isBlack = el.classList.contains('black');

      if (isMelody) {
        el.classList.add('active-melody');
        el.classList.remove('active');
        if (color) {
          el.style.setProperty('--melody-key-color', color);
          el.style.setProperty(
            'background',
            isBlack
              ? `linear-gradient(to bottom, ${color} 0%, #15101c 100%)`
              : `linear-gradient(to bottom, ${color} 0%, #201a2c 100%)`,
            'important'
          );
          el.style.setProperty('box-shadow', `inset 0 0 5px ${color}, 0 0 10px ${color}`, 'important');
          el.style.setProperty('border-right-color', '#14111a', 'important');
        }
      } else if (isHarmony) {
        el.classList.add('active');
        el.classList.remove('active-melody');
        el.style.removeProperty('--melody-key-color');
        el.style.removeProperty('background');
        el.style.removeProperty('box-shadow');
        el.style.removeProperty('border-right-color');
      } else {
        el.classList.remove('active');
        el.classList.remove('active-melody');
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
      const color = melodyColorRef.current;

      prevH.forEach((n) => {
        if (!nextHarmonySet.has(n) || nextMelodySet.has(n)) {
          applyKeyVisuals(n, nextMelodySet.has(n), nextHarmonySet.has(n), color);
        }
      });
      prevM.forEach((n) => {
        if (!nextMelodySet.has(n)) {
          applyKeyVisuals(n, false, nextHarmonySet.has(n), color);
        }
      });
      nextHarmonySet.forEach((n) => {
        if (!prevH.has(n) && !nextMelodySet.has(n)) {
          applyKeyVisuals(n, false, true, color);
        }
      });
      nextMelodySet.forEach((n) => {
        if (!prevM.has(n)) {
          applyKeyVisuals(n, true, nextHarmonySet.has(n), color);
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

  useEffect(() => {
    melodyColorRef.current = melodyColor;
    prevMelodySetRef.current.forEach(note => {
      const el = keyElementsRef.current.get(note);
      if (el && el.classList.contains('active-melody')) {
        const isBlack = el.classList.contains('black');
        if (melodyColor) {
          el.style.setProperty('--melody-key-color', melodyColor);
          el.style.setProperty(
            'background',
            isBlack
              ? `linear-gradient(to bottom, ${melodyColor} 0%, #15101c 100%)`
              : `linear-gradient(to bottom, ${melodyColor} 0%, #201a2c 100%)`,
            'important'
          );
          el.style.setProperty('box-shadow', `inset 0 0 5px ${melodyColor}, 0 0 10px ${melodyColor}`, 'important');
        }
      }
    });
  }, [melodyColor]);

  // Generar 85 notas desde C1 (24) hasta C8 (108) (7 octavas completas)
  const keys = useMemo(() => {
    const list: KeyDef[] = [];
    for (let m = 24; m <= 108; m++) {
      const pitchClass = NOTE_NAMES[m % 12];
      const octave = Math.floor(m / 12) - 1;
      const noteName = `${pitchClass}${octave}`;
      const isBlack = pitchClass.includes('#');
      const label = pitchClass === 'C' ? `C${octave}` : '';
      list.push({ midi: m, noteName, isBlack, label });
    }
    return list;
  }, []);

  const normalizedCenter = useMemo(() => normalizeNote(keyboardCenterNote || 'C4'), [keyboardCenterNote]);

  // Agrupar las teclas blancas para calcular el posicionamiento relativo de las negras
  const whiteKeys = useMemo(() => keys.filter(k => !k.isBlack), [keys]);

  return (
    <div className="piano-visualizer-container">
      <div className="piano-keyboard-wrapper">
        <div className="piano-keyboard">
          {/* Teclas Blancas */}
          {whiteKeys.map((key) => {
            const normalized = normalizeNote(key.noteName);
            const isCenterNote = normalized === normalizedCenter;
            
            return (
              <PianoKey 
                key={key.midi}
                keyDef={key}
                isCenterNote={isCenterNote}
                onSetCenterNote={setKeyboardCenterNote}
                registerKeyRef={registerKeyRef}
                onStartNote={handleStartNote}
                onStopNote={handleStopNote}
              />
            );
          })}

          {/* Teclas Negras (Superpuestas) */}
          {keys.map((key, index) => {
            if (!key.isBlack) return null;

            // Encontrar la tecla blanca previa para posicionar la negra encima
            let whiteKeysBefore = 0;
            for (let i = 0; i < index; i++) {
              if (!keys[i].isBlack) whiteKeysBefore++;
            }

            // Ancho de una tecla blanca: 100% / total_white_keys
            const leftPercent = (whiteKeysBefore / whiteKeys.length) * 100;
            const widthPercent = (1 / whiteKeys.length) * 100;

            const normalized = normalizeNote(key.noteName);
            const isCenterNote = normalized === normalizedCenter;

            // Ajuste fino para centrar la tecla negra
            const style = {
              left: `calc(${leftPercent}% - (${widthPercent}% * 0.3))`,
              width: `calc(${widthPercent}% * 0.6)`
            };

            return (
              <PianoKey 
                key={key.midi}
                keyDef={key}
                isCenterNote={isCenterNote}
                style={style}
                onSetCenterNote={setKeyboardCenterNote}
                registerKeyRef={registerKeyRef}
                onStartNote={handleStartNote}
                onStopNote={handleStopNote}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
