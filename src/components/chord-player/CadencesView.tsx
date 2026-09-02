/**
 * CadencesView.tsx
 * Vista de progresiones / cadencias comunes, organizadas por emoción.
 * Permite preescuchar y arrastrar a la timeline.
 */

import React, { useMemo } from 'react';
import type { NoteClass, ScaleType, ChordSuggestion } from '../../utils/typeDefinitions';
import { toneEngine } from '../../audio/toneEngine';
import { NOTE_CLASSES } from '../../core/music';
import { useSongStore } from '../../store/songStore';

interface CadencesViewProps {
  currentKey: NoteClass;
  scale: ScaleType;
  suggestions: ChordSuggestion[];
}

interface Cadence {
  name: string;
  tag: string;
  role: 'reposo' | 'tension' | 'subdominante' | 'spicy' | 'exotic';
  // Grados en semitones desde la tónica + calidad
  degrees: Array<{ interval: number; quality: string }>;
}

const CADENCES: Cadence[] = [
  {
    name: 'i – aug – VI – ivm (Line Cliché)',
    tag: 'Line Cliché',
    role: 'spicy',
    degrees: [
      { interval: 0, quality: 'm' },
      { interval: 11, quality: 'aug' },
      { interval: 8, quality: '' },
      { interval: 8, quality: 'm' },
    ]
  },
  {
    name: 'I – VII(bII) – bVI – bVII (Cromática)',
    tag: 'Cromática',
    role: 'spicy',
    degrees: [
      { interval: 0, quality: '' },
      { interval: 11, quality: '' },
      { interval: 8, quality: '' },
      { interval: 10, quality: '' },
    ]
  },
  {
    name: 'I – Iaug – IV – iv (Soul / Pop)',
    tag: 'Pop Soul',
    role: 'spicy',
    degrees: [
      { interval: 0, quality: '' },
      { interval: 0, quality: 'aug' },
      { interval: 5, quality: '' },
      { interval: 5, quality: 'm' },
    ]
  },
  {
    name: 'bVI – bVII – I (Épico / Cine)',
    tag: 'Cinemática',
    role: 'subdominante',
    degrees: [
      { interval: 8, quality: '' },
      { interval: 10, quality: '' },
      { interval: 0, quality: '' },
    ]
  },
  {
    name: 'i – bVII – bVI – V (Andaluza)',
    tag: 'Flamenco',
    role: 'tension',
    degrees: [
      { interval: 0, quality: 'm' },
      { interval: 10, quality: '' },
      { interval: 8, quality: '' },
      { interval: 7, quality: '' },
    ]
  },
  {
    name: 'ii – subV7 – I (Tritono Jazz)',
    tag: 'Jazz',
    role: 'tension',
    degrees: [
      { interval: 2, quality: 'm7' },
      { interval: 1, quality: '7' },
      { interval: 0, quality: 'maj7' },
    ]
  },
  {
    name: 'I – V – vi – IV (Pop Hit)',
    tag: 'Pop',
    role: 'reposo',
    degrees: [
      { interval: 0, quality: '' },
      { interval: 7, quality: '' },
      { interval: 9, quality: 'm' },
      { interval: 5, quality: '' },
    ]
  },
  {
    name: 'I – IV – V – I (Clásica)',
    tag: 'Clásica',
    role: 'reposo',
    degrees: [
      { interval: 0, quality: '' },
      { interval: 5, quality: '' },
      { interval: 7, quality: '' },
      { interval: 0, quality: '' },
    ]
  },
  {
    name: 'ii – V – I (Jazz 2-5-1)',
    tag: 'Jazz',
    role: 'tension',
    degrees: [
      { interval: 2, quality: 'm' },
      { interval: 7, quality: '7' },
      { interval: 0, quality: 'maj7' },
    ]
  },
  {
    name: 'I – vi – IV – V (Doo-Wop 50s)',
    tag: 'Vintage',
    role: 'reposo',
    degrees: [
      { interval: 0, quality: '' },
      { interval: 9, quality: 'm' },
      { interval: 5, quality: '' },
      { interval: 7, quality: '' },
    ]
  },
  {
    name: 'i – VII – VI – VII (Natural)',
    tag: 'Modal',
    role: 'spicy',
    degrees: [
      { interval: 0, quality: 'm' },
      { interval: 10, quality: '' },
      { interval: 8, quality: '' },
      { interval: 10, quality: '' },
    ]
  },
  {
    name: 'I – III – IV – iv (Radiohead / Creep)',
    tag: 'Alternativo',
    role: 'spicy',
    degrees: [
      { interval: 0, quality: '' },
      { interval: 4, quality: '' },
      { interval: 5, quality: '' },
      { interval: 5, quality: 'm' },
    ]
  },
  {
    name: 'vi – IV – I – V (Himno Melancólico)',
    tag: 'Himno',
    role: 'subdominante',
    degrees: [
      { interval: 9, quality: 'm' },
      { interval: 5, quality: '' },
      { interval: 0, quality: '' },
      { interval: 7, quality: '' },
    ]
  },
  {
    name: 'I – bVII – IV – I (Rock Clásico)',
    tag: 'Rock',
    role: 'exotic',
    degrees: [
      { interval: 0, quality: '' },
      { interval: 10, quality: '' },
      { interval: 5, quality: '' },
      { interval: 0, quality: '' },
    ]
  },
  {
    name: 'i – VI – III – VII (Oscuridad Épica)',
    tag: 'Dark Fantasy',
    role: 'tension',
    degrees: [
      { interval: 0, quality: 'm' },
      { interval: 8, quality: '' },
      { interval: 3, quality: '' },
      { interval: 10, quality: '' },
    ]
  },
  {
    name: 'I – V – vi – iii – IV (Canon Pachelbel)',
    tag: 'Canon',
    role: 'reposo',
    degrees: [
      { interval: 0, quality: '' },
      { interval: 7, quality: '' },
      { interval: 9, quality: 'm' },
      { interval: 4, quality: 'm' },
      { interval: 5, quality: '' },
    ]
  },
];

const ROLE_COLORS: Record<string, string> = {
  reposo:       'var(--role-reposo)',
  subdominante: 'var(--role-subdominante)',
  tension:      'var(--role-tension)',
  spicy:        'var(--role-spicy)',
  exotic:       'var(--role-exotic)',
};

function buildCadenceChords(cadence: Cadence, key: NoteClass): string[] {
  const keyIdx = NOTE_CLASSES.indexOf(key);
  return cadence.degrees.map(d => {
    const noteIdx = (keyIdx + d.interval) % 12;
    return `${NOTE_CLASSES[noteIdx]}${d.quality}`;
  });
}

interface CadenceCardProps {
  cadence: Cadence;
  chords: string[];
  sugMap: Record<string, number>;
}

const CadenceCard: React.FC<CadenceCardProps> = ({ cadence, chords, sugMap }) => {
  const draggingChord = useSongStore(state => state.draggingChord);
  const setDraggingChord = useSongStore(state => state.setDraggingChord);

  const handleMouseEnter = (e: React.MouseEvent, chord: string) => {
    if (e.buttons === 1) {
      toneEngine.silence();
      toneEngine.playChordPreviewStart(chord);
      if (!draggingChord) {
        setDraggingChord(chord);
      }
    }
  };

  const avgProb = chords.reduce((sum, c) => sum + (sugMap[c] ?? 0), 0) / chords.length;

  return (
    <div
      className="cadence-card"
      style={{ '--role-color': ROLE_COLORS[cadence.role] } as React.CSSProperties}
    >
      <div className="cadence-header">
        <span className="cadence-style-tag">{cadence.tag}</span>
        <span className="cadence-name">{cadence.name}</span>
        {avgProb > 0.2 && (
          <span className="cadence-match">
            {Math.round(avgProb * 100)}%
          </span>
        )}
      </div>
      <div className="cadence-chords">
        {chords.map((chord, i) => (
          <div
            key={i}
            className="cadence-chord-chip"
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              toneEngine.silence();
              toneEngine.playChordPreviewStart(chord);
              setDraggingChord(chord);
            }}
            onMouseEnter={(e) => handleMouseEnter(e, chord)}
            title={`${chord} · Mantén para escuchar · Arrastra fuera de la paleta para añadir`}
          >
            {chord}
          </div>
        ))}
      </div>
    </div>
  );
};

export const CadencesView: React.FC<CadencesViewProps> = ({ currentKey, suggestions }) => {
  const sugMap = useMemo(() => {
    const m: Record<string, number> = {};
    suggestions.forEach(s => { m[s.chord] = s.probability; });
    return m;
  }, [suggestions]);

  const cadencesWithChords = useMemo(() =>
    CADENCES.map(cadence => ({
      cadence,
      chords: buildCadenceChords(cadence, currentKey),
    })),
    [currentKey]
  );

  // Ordenar por afinidad promedio con las sugerencias
  const sorted = [...cadencesWithChords].sort((a, b) => {
    const avgA = a.chords.reduce((s, c) => s + (sugMap[c] ?? 0), 0) / a.chords.length;
    const avgB = b.chords.reduce((s, c) => s + (sugMap[c] ?? 0), 0) / b.chords.length;
    return avgB - avgA;
  });

  return (
    <div className="cadences-view">
      <p className="cadences-hint">
        Arrastra los acordes individuales o toda la cadencia a la timeline. Ordenadas por afinidad con tu melodía activa.
      </p>
      <div className="cadences-list">
        {sorted.map(({ cadence, chords }) => (
          <CadenceCard
            key={cadence.name}
            cadence={cadence}
            chords={chords}
            sugMap={sugMap}
          />
        ))}
      </div>
    </div>
  );
};
