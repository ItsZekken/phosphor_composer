import React, { useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface KeyDef {
  midi: number;
  noteName: string;
  isBlack: boolean;
  label: string;
}

// Normaliza nombres de notas al formato sostenido
function normalizeNote(n: string): string {
  return n.toUpperCase()
    .replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#')
    .replace('AB', 'G#').replace('BB', 'A#');
}

const PianoKey = React.memo(({ 
  keyDef, 
  isMelody, 
  isHarmony, 
  isCenterNote,
  style,
  onSetCenterNote,
  activeChannelId
}: { 
  keyDef: KeyDef, 
  isMelody: boolean, 
  isHarmony: boolean, 
  isCenterNote: boolean,
  style?: React.CSSProperties,
  onSetCenterNote: (noteName: string) => void,
  activeChannelId: string
}) => {
  const activeClass = isMelody ? 'active-melody' : isHarmony ? 'active' : '';
  const isBlack = keyDef.isBlack;
  const className = `top-piano-key ${isBlack ? 'black' : 'white'} ${activeClass}`;
  
  return (
    <div
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
          toneEngine.playNotePreview(keyDef.noteName, activeChannelId);
        }
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
  const activeNotes = useSongStore(state => state.activeNotes);
  const activeMelodyNotes = useSongStore(state => state.activeMelodyNotes);
  const keyboardCenterNote = useSongStore(state => state.keyboardCenterNote);
  const setKeyboardCenterNote = useSongStore(state => state.setKeyboardCenterNote);
  const activeTrackId = useSongStore(state => state.activeTrackId);
  const tracks = useSongStore(state => state.tracks);

  const activeTrack = useMemo(() => tracks.find(t => t.id === activeTrackId), [tracks, activeTrackId]);
  const activeChannelId = activeTrack ? activeTrack.channelId : 'melody';

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

  // Sets normalizados para búsqueda rápida O(1)
  const harmonySet = useMemo(() => new Set(activeNotes.map(normalizeNote)), [activeNotes]);
  const melodySet = useMemo(() => new Set(activeMelodyNotes.map(normalizeNote)), [activeMelodyNotes]);
  const normalizedCenter = useMemo(() => normalizeNote(keyboardCenterNote || 'C4'), [keyboardCenterNote]);

  // Agrupar las teclas blancas para calcular el posicionamiento relativo de las negras
  const whiteKeys = keys.filter(k => !k.isBlack);

  return (
    <div className="piano-visualizer-container">
      <div className="piano-keyboard-wrapper">
        <div className="piano-keyboard">
          {/* Teclas Blancas */}
          {whiteKeys.map((key) => {
            const normalized = normalizeNote(key.noteName);
            const isMelody = melodySet.has(normalized);
            const isHarmony = harmonySet.has(normalized);
            const isCenterNote = normalized === normalizedCenter;
            
            return (
              <PianoKey 
                key={key.midi}
                keyDef={key}
                isMelody={isMelody}
                isHarmony={isHarmony}
                isCenterNote={isCenterNote}
                onSetCenterNote={setKeyboardCenterNote}
                activeChannelId={activeChannelId}
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
            const isMelody = melodySet.has(normalized);
            const isHarmony = harmonySet.has(normalized);
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
                isMelody={isMelody}
                isHarmony={isHarmony}
                isCenterNote={isCenterNote}
                style={style}
                onSetCenterNote={setKeyboardCenterNote}
                activeChannelId={activeChannelId}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
