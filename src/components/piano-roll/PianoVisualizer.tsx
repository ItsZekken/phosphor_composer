import React, { useMemo } from 'react';
import { useSongStore } from '../../store/songStore';

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
  style 
}: { 
  keyDef: KeyDef, 
  isMelody: boolean, 
  isHarmony: boolean, 
  style?: React.CSSProperties 
}) => {
  const activeClass = isMelody ? 'active-melody' : isHarmony ? 'active' : '';
  const isBlack = keyDef.isBlack;
  const className = `top-piano-key ${isBlack ? 'black' : 'white'} ${activeClass}`;
  
  return (
    <div
      className={className}
      style={style}
      title={keyDef.noteName}
    >
      {!isBlack && keyDef.label && <span className="key-label">{keyDef.label}</span>}
    </div>
  );
});

export const PianoVisualizer: React.FC = () => {
  const activeNotes = useSongStore(state => state.activeNotes);
  const activeMelodyNotes = useSongStore(state => state.activeMelodyNotes);

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
            
            return (
              <PianoKey 
                key={key.midi}
                keyDef={key}
                isMelody={isMelody}
                isHarmony={isHarmony}
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
                style={style}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
