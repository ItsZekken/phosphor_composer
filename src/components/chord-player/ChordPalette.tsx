import React, { useEffect, useMemo, useState } from 'react';
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
  reposo:       { label: 'Reposo',       color: 'var(--role-reposo)',       glow: 'var(--glow-reposo)' },
  subdominante: { label: 'Subdominante', color: 'var(--role-subdominante)', glow: 'var(--glow-subdominante)' },
  tension:      { label: 'Tensión',      color: 'var(--role-tension)',      glow: 'var(--glow-tension)' },
  spicy:        { label: 'Spicy',        color: 'var(--role-spicy)',        glow: 'var(--glow-spicy)' },
  exotic:       { label: 'Exótico',      color: 'var(--role-exotic)',       glow: 'var(--glow-exotic)' },
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

  const handleTouchStart = () => {
    toneEngine.playChordPreviewStart(chord);
    setDraggingChord(chord);
    if (window.__initialDragChordRef) {
      window.__initialDragChordRef.current = chord;
    }
  };

  return (
    <div
      className={`chord-card-matrix ${role} ${small ? 'small' : ''}`}
      data-chord={chord}
      style={cardStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleTouchStart}
      title={`${chord} · Desliza el dedo sobre los acordes para escuchar. Arrastra fuera de la paleta a la línea de tiempo para añadir`}
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

// Declaro ref global accesible por los ChordCard y ChordPalette
declare global {
  interface Window {
    __initialDragChordRef?: React.MutableRefObject<string | null>;
  }
}

// ------- Matrix View (Desktop) -------

interface MatrixViewProps {
  key_: NoteClass;
  scale: ScaleType;
  suggestions: ChordSuggestion[];
}

const MatrixView: React.FC<MatrixViewProps> = ({ key_, scale, suggestions }) => {
  const diatonic = useMemo(() => getDiatonicChords(key_, scale), [key_, scale]);
  const ROMAN_DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

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
              const chordName = `${root}${varSuffix}`;
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

// ------- Transposed Matrix View (Móvil: Grados Verticales, Variaciones Horizontales sin Divisiones) -------

const TransposedMatrixView: React.FC<MatrixViewProps> = ({ key_, scale, suggestions }) => {
  const diatonic = useMemo(() => getDiatonicChords(key_, scale), [key_, scale]);
  const ROMAN_DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  const parseChord = (chord: string) => {
    const m = chord.match(/^([A-G]#?)(m|dim|aug)?$/);
    return { root: m ? m[1] : chord, quality: m ? (m[2] || '') : '' };
  };

  const sugMap = useMemo(() => {
    const m: Record<string, number> = {};
    suggestions.forEach(s => { m[s.chord] = s.probability; });
    return m;
  }, [suggestions]);

  const variations = VARIATION_ROWS;

  return (
    <div className="transposed-matrix-view">
      <div className="transposed-single-grid">
        <div className="transposed-grid-header-corner" />
        {variations.map((v) => (
          <div key={v.suffix} className="transposed-grid-header-cell">
            {v.label}
          </div>
        ))}

        {diatonic.map((baseChord, degreeIdx) => {
          const { root, quality } = parseChord(baseChord);
          return (
            <React.Fragment key={degreeIdx}>
              <div className="transposed-grid-degree-label">
                <span className="degree-roman">{ROMAN_DEGREES[degreeIdx]}</span>
                <span className="degree-base">{baseChord}</span>
              </div>
              {variations.map((row) => {
                const varSuffix = getVariationSuffix(row.suffix, quality);
                const chordName = `${root}${varSuffix}`;
                const role = getChordRole(chordName, key_, scale);
                const prob = sugMap[chordName];
                return (
                  <ChordCard
                    key={`${degreeIdx}-${row.suffix}`}
                    chord={chordName}
                    probability={prob}
                    role={role}
                    small={row.suffix !== ''}
                  />
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

// ------- Main Component -------

export const ChordPalette: React.FC = () => {
  const {
    key,
    scale,
    selectedChordId,
    chordBlocks,
    updateSuggestions,
    chordSuggestions,
    draggingChord,
    setDraggingChord,
    isAutoSuggestions,
    detectedKey,
    isAutoKey
  } = useSongStore(useShallow(state => ({
    key: state.key,
    scale: state.scale,
    selectedChordId: state.selectedChordId,
    chordBlocks: state.chordBlocks,
    updateSuggestions: state.updateSuggestions,
    chordSuggestions: state.chordSuggestions,
    draggingChord: state.draggingChord,
    setDraggingChord: state.setDraggingChord,
    isAutoSuggestions: state.isAutoSuggestions,
    detectedKey: state.detectedKey,
    isAutoKey: state.isAutoKey
  })));

  const [isMouseOutside, setIsMouseOutside] = React.useState(false);
  const [mousePos, setMousePos] = React.useState({ x: 0, y: 0 });
  const [touchPos, setTouchPos] = useState<{ x: number; y: number } | null>(null);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('matrix');

  const lastHoveredTouchChordRef = React.useRef<string | null>(null);
  const initialDragChordRef = React.useRef<string | null>(null);
  window.__initialDragChordRef = initialDragChordRef;

  // P3: Solo actualizar automáticamente si el switch está activado
  useEffect(() => {
    if (isAutoSuggestions) {
      updateSuggestions();
    }
  }, [key, scale, selectedChordId, chordBlocks.length, updateSuggestions, isAutoSuggestions]);

  // Listener global de ratón y táctil para seguir movimiento y manejar drop
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
        initialDragChordRef.current = null;
      }
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      const state = useSongStore.getState();
      if (!state.draggingChord) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      const currentEl = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!currentEl) return;

      const cardEl = currentEl.closest('[data-chord]') as HTMLElement | null;
      const paletteEl = currentEl.closest('.chord-palette');

      if (paletteEl && cardEl) {
        // DENTRO de la paleta: Deslizar entre acordes y hacerlos sonar en tiempo real
        const hoveredChord = cardEl.getAttribute('data-chord');
        if (hoveredChord && hoveredChord !== lastHoveredTouchChordRef.current) {
          lastHoveredTouchChordRef.current = hoveredChord;
          state.setDraggingChord(hoveredChord);
          toneEngine.playChordPreviewStart(hoveredChord);
        }
        setTouchPos(null);
        setIsMouseOutside(false);
        e.preventDefault();
      } else {
        // FUERA de la paleta: Arrastrar hacia la línea de tiempo (mostrar fantasma)
        lastHoveredTouchChordRef.current = null;
        setTouchPos({ x: touch.clientX, y: touch.clientY });
        setIsMouseOutside(true);
        e.preventDefault();
      }
    };

    const handleGlobalTouchEnd = (e: TouchEvent) => {
      const state = useSongStore.getState();
      const initialChord = initialDragChordRef.current || state.draggingChord;
      if (!initialChord) return;

      if (e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const dropEl = document.elementFromPoint(touch.clientX, touch.clientY);
        const timelineViewport = dropEl?.closest('.timeline-viewport') || dropEl?.closest('.timeline-section') || dropEl?.closest('.timeline-canvas');
        
        if (timelineViewport) {
          const canvasEl = document.querySelector('.timeline-canvas');
          if (canvasEl) {
            const rect = canvasEl.getBoundingClientRect();
            const dropX = touch.clientX - rect.left;
            const dropBeat = Math.max(0, Math.round(dropX / 40));
            state.addChordBlock(initialChord, dropBeat, 4);
          }
        }
      }

      toneEngine.playChordPreviewStop();
      state.setDraggingChord(null);
      setIsMouseOutside(false);
      setTouchPos(null);
      lastHoveredTouchChordRef.current = null;
      initialDragChordRef.current = null;
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    window.addEventListener('touchend', handleGlobalTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
    };
  }, [draggingChord, setDraggingChord]);

  const paletteModes: { id: PaletteMode; label: string; icon: string }[] = [
    { id: 'matrix',   label: 'Matriz',   icon: '⊞' },
    { id: 'fifths',   label: 'Quintas',  icon: '◎' },
    { id: 'cadences', label: 'Cadencias', icon: '♩' },
  ];

  const activeGhostChord = initialDragChordRef.current || draggingChord;

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


      </div>

      <div className="palette-body-wrap">
        {paletteMode === 'matrix' && (
          <>
            <div className="desktop-matrix-container">
              <MatrixView key_={key} scale={scale} suggestions={chordSuggestions} />
            </div>
            <div className="mobile-transposed-matrix-container">
              <TransposedMatrixView key_={key} scale={scale} suggestions={chordSuggestions} />
            </div>
          </>
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
      {draggingChord && (isMouseOutside || touchPos) && activeGhostChord && (
        <div 
          className="virtual-drag-ghost"
          style={{
            position: 'fixed',
            left: (touchPos ? touchPos.x : mousePos.x) + 12,
            top: (touchPos ? touchPos.y : mousePos.y) + 12,
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
          ➕ {activeGhostChord}
        </div>
      )}
    </div>
  );
};
