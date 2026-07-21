/**
 * CircleFifthsView.tsx
 * Vista interactiva del Círculo de Quintas para la Paleta de Acordes.
 * Muestra los 12 acordes mayores en la rueda exterior y los 12 menores en la interior.
 * El brillo/highlight refleja la probabilidad de la sugerencia armónica activa.
 */

import React, { useMemo } from 'react';
import type { NoteClass, ScaleType, ChordSuggestion } from '../../utils/typeDefinitions';
import { toneEngine } from '../../audio/toneEngine';
import { useSongStore } from '../../store/songStore';

// Orden del Círculo de Quintas (sentido horario desde C)
const FIFTHS_ORDER: NoteClass[] = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];

interface CircleFifthsViewProps {
  currentKey: NoteClass;
  scale: ScaleType;
  suggestions: ChordSuggestion[];
}

interface ArcProps {
  chord: string;
  cx: number;
  cy: number;
  innerR: number;
  outerR: number;
  startAngle: number;
  endAngle: number;
  probability: number;
  isCurrentKey: boolean;
  isMinor?: boolean;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, innerR: number, outerR: number, startAngle: number, endAngle: number) {
  const outer1 = polarToCartesian(cx, cy, outerR, startAngle + 1);
  const outer2 = polarToCartesian(cx, cy, outerR, endAngle - 1);
  const inner1 = polarToCartesian(cx, cy, innerR, endAngle - 1);
  const inner2 = polarToCartesian(cx, cy, innerR, startAngle + 1);
  return `M ${outer1.x} ${outer1.y} A ${outerR} ${outerR} 0 0 1 ${outer2.x} ${outer2.y} L ${inner1.x} ${inner1.y} A ${innerR} ${innerR} 0 0 0 ${inner2.x} ${inner2.y} Z`;
}

const ArcSegment: React.FC<ArcProps> = ({
  chord, cx, cy, innerR, outerR, startAngle, endAngle, probability, isCurrentKey, isMinor
}) => {
  const draggingChord = useSongStore(state => state.draggingChord);
  const setDraggingChord = useSongStore(state => state.setDraggingChord);
  const midAngle = (startAngle + endAngle) / 2;
  const labelR = (innerR + outerR) / 2;
  const labelPos = polarToCartesian(cx, cy, labelR, midAngle);
  const path = describeArc(cx, cy, innerR, outerR, startAngle, endAngle);

  const baseColor = isMinor ? '#7c3aed' : '#1d4ed8';
  const highlightColor = isMinor ? '#a78bfa' : '#60a5fa';
  const activeColor = isCurrentKey ? '#facc15' : (probability > 0.5 ? highlightColor : baseColor);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (e.buttons === 1) {
      toneEngine.silence();
      toneEngine.playChordPreviewStart(chord);
      if (!draggingChord) {
        setDraggingChord(chord);
      }
    }
  };

  return (
    <g
      className="arc-segment"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        toneEngine.silence();
        toneEngine.playChordPreviewStart(chord);
        setDraggingChord(chord);
      }}
      onMouseEnter={handleMouseEnter}
      style={{ cursor: 'grab' }}
    >
      <title>{chord} · Mantén para escuchar · Arrastra fuera de la paleta para añadir</title>
      <path
        d={path}
        fill={activeColor}
        opacity={isCurrentKey ? 1 : (0.35 + probability * 0.65)}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
        style={{ transition: 'fill 0.3s, opacity 0.3s' }}
      />
      {probability > 0.3 && (
        <circle
          cx={labelPos.x}
          cy={labelPos.y}
          r={(outerR - innerR) * 0.35}
          fill={`rgba(255,255,255,${probability * 0.4})`}
        />
      )}
      <text
        x={labelPos.x}
        y={labelPos.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={isMinor ? 9 : 11}
        fontWeight={isCurrentKey ? 700 : (probability > 0.5 ? 600 : 400)}
        fill={isCurrentKey ? '#000' : '#fff'}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {chord}
      </text>
    </g>
  );
};

export const CircleFifthsView: React.FC<CircleFifthsViewProps> = ({ currentKey, scale, suggestions }) => {
  const SIZE = 320;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const OUTER_R = 138;
  const MIDDLE_R = 95;
  const INNER_R = 55;

  const sugMap = useMemo(() => {
    const m: Record<string, number> = {};
    suggestions.forEach(s => { m[s.chord] = s.probability; });
    return m;
  }, [suggestions]);

  const segmentAngle = 360 / 12;

  return (
    <div className="circle-fifths-container">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {FIFTHS_ORDER.map((note, i) => {
          const startAngle = i * segmentAngle;
          const endAngle = (i + 1) * segmentAngle;

          // Mayor (anillo exterior)
          const majorChord = note;
          const minorChord = `${note}m`;

          const majProb = sugMap[majorChord] ?? 0;
          const minProb = sugMap[minorChord] ?? 0;
          const isCurrentKeyMajor = note === currentKey && scale === 'major';
          const isCurrentKeyMinor = note === currentKey && scale === 'minor';

          return (
            <g key={note}>
              {/* Anillo exterior - Mayores */}
              <ArcSegment
                chord={majorChord}
                cx={cx} cy={cy}
                innerR={MIDDLE_R} outerR={OUTER_R}
                startAngle={startAngle} endAngle={endAngle}
                probability={majProb}
                isCurrentKey={isCurrentKeyMajor}
              />
              {/* Anillo interior - Menores */}
              <ArcSegment
                chord={minorChord}
                cx={cx} cy={cy}
                innerR={INNER_R} outerR={MIDDLE_R}
                startAngle={startAngle} endAngle={endAngle}
                probability={minProb}
                isCurrentKey={isCurrentKeyMinor}
                isMinor
              />
            </g>
          );
        })}

        {/* Centro decorativo */}
        <circle cx={cx} cy={cy} r={INNER_R - 2} fill="rgba(15,15,30,0.95)" />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="#94a3b8" fontSize={11}>
          {currentKey}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="#60a5fa" fontSize={9}>
          {scale}
        </text>
      </svg>

      <div className="fifths-legend">
        <span className="fifths-outer-label">Exterior: Mayores</span>
        <span className="fifths-inner-label">Interior: Menores</span>
      </div>
    </div>
  );
};
