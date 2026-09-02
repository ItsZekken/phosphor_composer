import React, { useState, useEffect, useMemo } from 'react';
import { useSongStore } from '../../../store/songStore';
import { toneEngine } from '../../../audio/toneEngine';

export interface PianoKeyInfo {
  midi: number;
  name: string;
  isBlack: boolean;
}

function normalizeNote(n: string): string {
  if (!n) return '';
  return n.toUpperCase()
    .replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#')
    .replace('AB', 'G#').replace('BB', 'A#');
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
  activeNotes: propActiveNotes,
  activeMelodyNotes: propActiveMelodyNotes,
  scalePitchClasses,
  rootMidiMod,
  isScaleHighlightActive
}) => {
  const storeActiveNotes = useSongStore((s) => s.activeNotes);
  const storeActiveMelodyNotes = useSongStore((s) => s.activeMelodyNotes);

  const [activeMouseKey, setActiveMouseKey] = useState<number | null>(null);

  const harmonyActiveSet = useMemo(
    () => new Set((propActiveNotes || storeActiveNotes || []).map(normalizeNote)),
    [propActiveNotes, storeActiveNotes]
  );
  const melodyActiveSet = useMemo(
    () => new Set((propActiveMelodyNotes || storeActiveMelodyNotes || []).map(normalizeNote)),
    [propActiveMelodyNotes, storeActiveMelodyNotes]
  );

  const activeTrackId = useSongStore((s) => s.activeTrackId);
  const tracks = useSongStore((s) => s.tracks);
  const activeTrack = (tracks || []).find((t) => t.id === activeTrackId);
  const currentChannelId = activeTrack ? activeTrack.channelId : 'melody';

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setActiveMouseKey(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
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
        const normalized = normalizeNote(key.name);
        const isMelodyActive = melodyActiveSet.has(normalized);
        const isHarmonyActive = harmonyActiveSet.has(normalized);
        const isMouseActive = activeMouseKey === key.midi;
        const pitchClass = ((key.midi % 12) + 12) % 12;
        const inScale = scalePitchClasses?.has(pitchClass) ?? false;
        const isRoot = pitchClass === rootMidiMod;

        let activeClass = '';
        if (isMouseActive || isMelodyActive) activeClass = 'active-melody';
        else if (isHarmonyActive) activeClass = 'active-harmony';

        return (
          <div
            key={key.midi}
            className={`sidebar-key ${key.isBlack ? 'black' : 'white'} ${activeClass}`}
            style={{ 
              height: `${rowHeight}px`,
              minHeight: `${rowHeight}px`,
              maxHeight: `${rowHeight}px`,
              boxSizing: 'border-box',
              flexShrink: 0,
              position: 'relative',
              lineHeight: `${Math.max(10, rowHeight - 1)}px`,
              fontSize: `${Math.min(10, Math.max(7, Math.floor(rowHeight * 0.45)))}px`,
              backgroundColor: isScaleHighlightActive && !activeClass
                ? (isRoot ? (key.isBlack ? '#261c3b' : '#342652') : inScale ? (key.isBlack ? '#1b172a' : '#292240') : (key.isBlack ? '#0c0a12' : '#14111c'))
                : undefined
            }}
            onMouseDown={() => {
              setActiveMouseKey(key.midi);
              toneEngine.playNotePreview(key.name, currentChannelId);
            }}
            onMouseEnter={(e) => {
              if (e.buttons === 1) {
                setActiveMouseKey(key.midi);
                toneEngine.playNotePreview(key.name, currentChannelId);
              }
            }}
            onMouseUp={() => setActiveMouseKey(null)}
            onMouseLeave={() => setActiveMouseKey(null)}
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
