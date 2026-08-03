import React, { useEffect, useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import type { ChordSuggestion } from '../../utils/typeDefinitions';
import type { PaletteMode } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { NOTE_CLASSES, getDiatonicChords } from '../../engine/scaleDefinitions';
import type { NoteClass, ScaleType } from '../../utils/typeDefinitions';
import { CircleFifthsView } from './CircleFifthsView';
import { CadencesView } from './CadencesView';

// ------- Helpers -------

/** Función hash del chord a color de función armónica */
export function getChordRole(chord: string, key: NoteClass, _scale: ScaleType): 'reposo' | 'tension' | 'subdominante' | 'spicy' | 'exotic' {
  const NOTE_IDX = NOTE_CLASSES;
  const match = chord.match(/^([A-G]#?)(m|maj7|min7|7|maj|min|dim|aug|m7b5|sus4|sus2)?$/);
  if (!match) return 'spicy';
  const rootNote = match[1] as NoteClass;
  const type = match[2] || '';

  const rootVal = NOTE_IDX.indexOf(rootNote);
  const keyVal = NOTE_IDX.indexOf(key);
  const interval = ((rootVal - keyVal) + 12) % 12;

  // Basado en grados clásicos de la escala mayor
  const roleMap: Record<number, 'reposo' | 'tension' | 'subdominante' | 'spicy' | 'exotic'> = {
    0: 'reposo',     // I
    2: 'subdominante', // II
    4: 'reposo',     // III
    5: 'subdominante', // IV
    7: 'tension',    // V
    9: 'reposo',     // VI
    11: 'tension',   // VII
  };

  // Si es disminuido, aumentado o m7b5 → más spicy
  if (type === 'dim' || type === 'aug' || type === 'm7b5') return 'spicy';

  const baseRole = roleMap[interval];
  if (!baseRole) return 'exotic'; // nota fuera de la escala → exotic
  return baseRole;
}

const ROLE_CONFIG = {
  reposo:       { label: '🏠 Reposo',       color: 'var(--role-reposo)',       glow: 'var(--glow-reposo)' },
  subdominante: { label: '🌊 Subdominante',  color: 'var(--role-subdominante)', glow: 'var(--glow-subdominante)' },
  tension:      { label: '⚡ Tensión',       color: 'var(--role-tension)',      glow: 'var(--glow-tension)' },
  spicy:        { label: '🌶️ Spicy',         color: 'var(--role-spicy)',        glow: 'var(--glow-spicy)' },
  exotic:       { label: '✨ Exótico',       color: 'var(--role-exotic)',       glow: 'var(--glow-exotic)' },
};

// Variaciones de acordes para la matriz por grado
const VARIATION_ROWS: { label: string; suffix: string }[] = [
  { label: 'sus2', suffix: 'sus2' },
  { label: 'sus4', suffix: 'sus4' },
  { label: 'Tríada', suffix: '' },
  { label: '7th',   suffix: '7th' }, // resuelto dinámicamente
  { label: 'Modal', suffix: 'modal' }, // intercambio modal dinámico
];

function getVariationSuffix(baseSuffix: string, baseQuality: string): string {
  if (baseSuffix === '') return baseQuality; // Tríada base
  if (baseSuffix === 'sus2') return `${baseSuffix}`;
  if (baseSuffix === 'sus4') return `${baseSuffix}`;
  if (baseSuffix === '7th') {
    if (baseQuality === '') return 'maj7';
    if (baseQuality === 'm') return 'm7';
    if (baseQuality === 'dim') return 'm7b5';
    return 'maj7';
  }
  if (baseSuffix === 'modal') {
    // Intercambio modal: mayor→menor y viceversa
    if (baseQuality === '') return 'm';
    if (baseQuality === 'm') return '';
    return 'dim';
  }
  return baseQuality;
}

const ROLE_RGB = {
  reposo:       '90, 158, 122',
  subdominante: '80, 114, 168',
  tension:      '176, 144, 64',
  spicy:        '160, 80, 128',
  exotic:       '112, 96, 176',
};

interface ChordCardProps {
  chord: string;
  probability?: number;
  role: 'reposo' | 'tension' | 'subdominante' | 'spicy' | 'exotic';
  small?: boolean;
}

const ChordCard: React.FC<ChordCardProps> = ({ chord, probability = 0, role, small }) => {
  const draggingChord = useSongStore(state => state.draggingChord);
  const setDraggingChord = useSongStore(state => state.setDraggingChord);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // solo click izquierdo
    toneEngine.playChordPreviewStart(chord);
    setDraggingChord(chord);
  };

  const handleMouseEnter = (e: React.MouseEvent) => {
    // Si el botón izquierdo está presionado (deslizando click)
    if (e.buttons === 1) {
      // Solo actualizamos las notas activas; el loop del patrón continúa sin reiniciarse
      toneEngine.playChordPreviewStart(chord);
      if (!draggingChord) {
        setDraggingChord(chord);
      }
    }
  };

  const rgb = ROLE_RGB[role];

  // Estilo de tarjeta con intensidad de color de fondo y borde según la probabilidad (0 a 1)
  const cardStyle = {
    backgroundColor: `rgba(${rgb}, ${0.07 + probability * 0.72})`,
    borderColor: `rgba(${rgb}, ${0.15 + probability * 0.65})`,
    boxShadow: probability > 0.5 ? `0 0 10px rgba(${rgb}, ${probability * 0.35})` : 'none',
    color: '#F3F4F6'
  };

  return (
    <div
      className={`chord-card-matrix ${role} ${small ? 'small' : ''}`}
      style={cardStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      title={`${chord} · Mantén para escuchar · Arrastra fuera de la paleta para añadir`}
    >
      <span className="chord-matrix-name">{chord}</span>
      {probability > 0.02 && (
        <span className="chord-matrix-pct" style={{ color: '#fff', opacity: 0.85 }}>
          {Math.round(probability * 100)}%
        </span>
      )}
    </div>
  );
};

// ------- Matrix View -------

interface MatrixViewProps {
  key_: NoteClass;
  scale: ScaleType; // usado en getDiatonicChords y getChordRole
  suggestions: ChordSuggestion[];
}

const MatrixView: React.FC<MatrixViewProps> = ({ key_, scale, suggestions }) => {  // eslint-disable-line @typescript-eslint/no-unused-vars
  const diatonic = useMemo(() => getDiatonicChords(key_, scale), [key_, scale]);
  const ROMAN_DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  // Extraer la raíz y la calidad de cada acorde diatónico
  const parseChord = (chord: string) => {
    const m = chord.match(/^([A-G]#?)(m|dim|aug)?$/);
    return { root: m ? m[1] : chord, quality: m ? (m[2] || '') : '' };
  };

  const sugMap = useMemo(() => {
    const m: Record<string, number> = {};
    suggestions.forEach(s => { m[s.chord] = s.probability; });
    return m;
  }, [suggestions]);

  const rows = VARIATION_ROWS;

  return (
    <div className="matrix-view">
      <div className="matrix-grid" style={{ 
        gridTemplateColumns: `80px repeat(${diatonic.length}, 1fr)`,
        gridTemplateRows: `auto repeat(${rows.length}, 1fr)`
      }}>
        <div className="matrix-row-label" />
        {diatonic.map((_, idx) => (
          <div key={idx} className="matrix-degree-header">
            {ROMAN_DEGREES[idx]}
          </div>
        ))}

        {rows.map((row) => (
          <React.Fragment key={row.suffix}>
            <div className="matrix-row-label">{row.label}</div>
            {diatonic.map((baseChord, colIdx) => {
              const { root, quality } = parseChord(baseChord);
              const varSuffix = getVariationSuffix(row.suffix, quality);
              let chordName: string;
              if (row.suffix === '' || row.suffix === 'modal') {
                chordName = `${root}${varSuffix}`;
              } else {
                chordName = `${root}${varSuffix}`;
              }
              const role = getChordRole(chordName, key_, scale);
              const prob = sugMap[chordName];
              return (
                <ChordCard
                  key={`${row.suffix}-${colIdx}`}
                  chord={chordName}
                  probability={prob}
                  role={role}
                  small={row.suffix !== ''}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// ------- Main Component -------

export const ChordPalette: React.FC = () => {
  const {
    key,
    scale,
    chordSuggestions,
    updateSuggestions,
    chordBlocks,
    selectedChordId,
    paletteMode,
    setPaletteMode,
    detectedKey,
    isAutoKey,
    draggingChord,
    setDraggingChord,
    isAutoSuggestions
  } = useSongStore(useShallow(state => ({
    key: state.key,
    scale: state.scale,
    chordSuggestions: state.chordSuggestions,
    updateSuggestions: state.updateSuggestions,
    chordBlocks: state.chordBlocks,
    selectedChordId: state.selectedChordId,
    paletteMode: state.paletteMode,
    setPaletteMode: state.setPaletteMode,
    detectedKey: state.detectedKey,
    isAutoKey: state.isAutoKey,
    draggingChord: state.draggingChord,
    setDraggingChord: state.setDraggingChord,
    isAutoSuggestions: state.isAutoSuggestions
  })));

  const [isMouseOutside, setIsMouseOutside] = React.useState(false);
  const [mousePos, setMousePos] = React.useState({ x: 0, y: 0 });

  // P3: Solo actualizar automáticamente si el switch está activado
  useEffect(() => {
    if (isAutoSuggestions) {
      updateSuggestions();
    }
  }, [key, scale, selectedChordId, chordBlocks.length, updateSuggestions, isAutoSuggestions]);

  // Listener global de ratón para seguir el movimiento del mouse y manejar el drop global
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (draggingChord) {
        setMousePos({ x: e.clientX, y: e.clientY });
      }
    };

    const handleGlobalMouseUp = () => {
      if (draggingChord) {
        toneEngine.playChordPreviewStop(draggingChord);
        setDraggingChord(null);
        setIsMouseOutside(false);
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingChord, setDraggingChord]);

  const paletteModes: { id: PaletteMode; label: string; icon: string }[] = [
    { id: 'matrix',   label: 'Matriz',   icon: '⊞' },
    { id: 'fifths',   label: 'Quintas',  icon: '◎' },
    { id: 'cadences', label: 'Cadencias', icon: '♩' },
  ];

  return (
    <div 
      className="chord-palette"
      onMouseLeave={() => {
        if (draggingChord) {
          setIsMouseOutside(true);
        }
      }}
      onMouseEnter={() => {
        setIsMouseOutside(false);
      }}
    >
      <div className="palette-header">
        <div className="palette-title-row">
          <h2 className="palette-title">
            Acordes{' '}
            {isAutoKey && detectedKey ? (
              <span className="palette-key-badge">{detectedKey}</span>
            ) : (
              <span className="palette-key-badge manual">{key} {scale}</span>
            )}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Selector de vista */}
            <div className="palette-mode-tabs">
              {paletteModes.map(m => (
                <button
                  key={m.id}
                  className={`palette-mode-tab ${paletteMode === m.id ? 'active' : ''}`}
                  onClick={() => setPaletteMode(m.id)}
                  title={m.label}
                >
                  <span className="tab-icon">{m.icon}</span>
                  <span className="tab-label">{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="palette-hint">
          💡 <strong>Mantén y desliza</strong> para escuchar · <strong>Saca el cursor con click presionado</strong> hacia la timeline para añadir
        </div>
      </div>

      <div className="palette-body-wrap">
        {paletteMode === 'matrix' && (
          <MatrixView key_={key} scale={scale} suggestions={chordSuggestions} />
        )}
        {paletteMode === 'fifths' && (
          <CircleFifthsView currentKey={key} scale={scale} suggestions={chordSuggestions} />
        )}
        {paletteMode === 'cadences' && (
          <CadencesView currentKey={key} scale={scale} suggestions={chordSuggestions} />
        )}
      </div>

      {/* Leyenda de colores */}
      <div className="palette-legend">
        {Object.entries(ROLE_CONFIG).map(([role, conf]) => (
          <div key={role} className={`legend-item ${role}`}>
            <span className="legend-dot" style={{ background: conf.color }} />
            <span className="legend-label">{conf.label}</span>
          </div>
        ))}
      </div>

      {/* Fantasma visual flotante de arrastre */}
      {draggingChord && isMouseOutside && (
        <div 
          className="virtual-drag-ghost"
          style={{
            position: 'fixed',
            left: mousePos.x + 12,
            top: mousePos.y + 12,
            pointerEvents: 'none',
            zIndex: 9999,
            background: 'var(--accent)',
            border: '1px solid rgba(255,255,255,0.25)',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '4px',
            fontWeight: 'bold',
            boxShadow: '0 4px 15px rgba(0,0,0,0.6)',
            fontSize: '0.85rem',
            transform: 'translate(-50%, -50%)'
          }}
        >
          ➕ {draggingChord}
        </div>
      )}
    </div>
  );
};
