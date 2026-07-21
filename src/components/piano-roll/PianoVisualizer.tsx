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

export const PianoVisualizer: React.FC = () => {
  const activeNotes = useSongStore(state => state.activeNotes);
  const activeMelodyNotes = useSongStore(state => state.activeMelodyNotes);

  // Generar 61 notas desde C2 (36) hasta C7 (96)
  const keys = useMemo(() => {
    const list: KeyDef[] = [];
    for (let m = 36; m <= 96; m++) {
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
            // La melodía tiene prioridad de color
            const activeClass = isMelody ? 'active-melody' : isHarmony ? 'active' : '';
            return (
              <div
                key={key.midi}
                className={`top-piano-key white ${activeClass}`}
                title={key.noteName}
              >
                {key.label && <span className="key-label">{key.label}</span>}
                <div className={`key-led ${isMelody ? 'active melody' : isHarmony ? 'active' : ''}`} />
              </div>
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
            const activeClass = isMelody ? 'active-melody' : isHarmony ? 'active' : '';

            // Ajuste fino para centrar la tecla negra
            const style = {
              left: `calc(${leftPercent}% - (${widthPercent}% * 0.3))`,
              width: `calc(${widthPercent}% * 0.6)`
            };

            return (
              <div
                key={key.midi}
                className={`top-piano-key black ${activeClass}`}
                style={style}
                title={key.noteName}
              >
                <div className={`key-led ${isMelody ? 'active melody' : isHarmony ? 'active' : ''}`} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
