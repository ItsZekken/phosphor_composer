/**
 * ChordBuilderView.tsx
 * Constructor de Acordes Autónomo de 12 Notas, Calidades Ricas y Slash Chords.
 * Diseño minimalista de hardware: cero texto innecesario, máxima densidad táctil.
 */

import React, { useState } from 'react';
import type { NoteClass } from '../../utils/typeDefinitions';
import { NOTE_CLASSES } from '../../core/music';
import { toneEngine } from '../../audio/toneEngine';
import { useSongStore } from '../../store/songStore';
import { Volume2, Plus } from 'lucide-react';

interface ChordBuilderViewProps {
  currentKey: NoteClass;
}

const ENHARMONIC_NAMES: Record<NoteClass, string> = {
  'C': 'C',
  'C#': 'Db',
  'D': 'D',
  'D#': 'Eb',
  'E': 'E',
  'F': 'F',
  'F#': 'Gb',
  'G': 'G',
  'G#': 'Ab',
  'A': 'A',
  'A#': 'Bb',
  'B': 'B'
};

const QUALITIES: { id: string; label: string; suffix: string; category: 'basic' | 'extended' | 'color' }[] = [
  { id: 'major', label: 'Mayor', suffix: '', category: 'basic' },
  { id: 'minor', label: 'Menor', suffix: 'm', category: 'basic' },
  { id: '7', label: '7', suffix: '7', category: 'basic' },
  { id: 'maj7', label: 'maj7', suffix: 'maj7', category: 'extended' },
  { id: 'm7', label: 'm7', suffix: 'm7', category: 'extended' },
  { id: 'aug', label: 'aug (+)', suffix: 'aug', category: 'color' },
  { id: 'dim', label: 'dim (°)', suffix: 'dim', category: 'color' },
  { id: 'dim7', label: 'dim7', suffix: 'dim7', category: 'color' },
  { id: 'm7b5', label: 'm7b5 (ø)', suffix: 'm7b5', category: 'color' },
  { id: 'sus4', label: 'sus4', suffix: 'sus4', category: 'color' },
  { id: 'sus2', label: 'sus2', suffix: 'sus2', category: 'color' },
  { id: '6', label: '6', suffix: '6', category: 'extended' },
  { id: 'm6', label: 'm6', suffix: 'm6', category: 'extended' },
  { id: 'add9', label: 'add9', suffix: 'add9', category: 'extended' },
];

import { useShallow } from 'zustand/react/shallow';

export const ChordBuilderView: React.FC<ChordBuilderViewProps> = ({ currentKey }) => {
  const {
    chordBlocks,
    addChordBlock,
    setDraggingChord
  } = useSongStore(useShallow(state => ({
    chordBlocks: state.chordBlocks || [],
    addChordBlock: state.addChordBlock,
    setDraggingChord: state.setDraggingChord
  })));

  const [selectedRoot, setSelectedRoot] = useState<NoteClass>(currentKey);
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [selectedBass, setSelectedBass] = useState<NoteClass | 'root'>('root');

  const baseChord = `${selectedRoot}${selectedQuality}`;
  const fullChordName = selectedBass === 'root' ? baseChord : `${baseChord}/${selectedBass}`;

  const handlePlayChord = () => {
    toneEngine.playChordPreviewStart(fullChordName);
  };

  const handleMouseDownChord = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    toneEngine.playChordPreviewStart(fullChordName);
    setDraggingChord(fullChordName);
    if (window.__initialDragChordRef) {
      window.__initialDragChordRef.current = fullChordName;
    }
  };

  const handleTouchStartChord = () => {
    toneEngine.playChordPreviewStart(fullChordName);
    setDraggingChord(fullChordName);
    if (window.__initialDragChordRef) {
      window.__initialDragChordRef.current = fullChordName;
    }
  };

  const handleAppendToTimeline = () => {
    const nextBeat = chordBlocks.length > 0
      ? chordBlocks.reduce((max, b) => Math.max(max, b.startBeat + b.durationBeats), 0)
      : 0;
    addChordBlock(fullChordName, nextBeat, 4);
    handlePlayChord();
  };

  return (
    <div className="chord-builder-view">
      <div className="chord-builder-grid">
        {/* Columna 1: Tónica */}
        <div className="builder-deck roots-deck">
          <div className="builder-deck-header">
            <span className="builder-deck-title">TÓNICA</span>
          </div>
          <div className="builder-roots-buttons">
            {NOTE_CLASSES.map((note) => {
              const isSelected = selectedRoot === note;
              const alt = ENHARMONIC_NAMES[note];
              const isEnharmonic = alt !== note;

              return (
                <button
                  key={note}
                  type="button"
                  className={`builder-note-button ${isSelected ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedRoot(note);
                    const newChord = selectedBass === 'root'
                      ? `${note}${selectedQuality}`
                      : `${note}${selectedQuality}/${selectedBass}`;
                    toneEngine.playChordPreviewStart(newChord);
                  }}
                >
                  <span className="builder-note-main">{note}</span>
                  {isEnharmonic && <span className="builder-note-alt">/{alt}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Columna 2: Calidad */}
        <div className="builder-deck qualities-deck">
          <div className="builder-deck-header">
            <span className="builder-deck-title">CALIDAD</span>
          </div>
          <div className="builder-qualities-list">
            {QUALITIES.map((q) => {
              const isSelected = selectedQuality === q.suffix;
              return (
                <button
                  key={q.id}
                  type="button"
                  className={`builder-quality-button ${q.category} ${isSelected ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedQuality(q.suffix);
                    const newChord = selectedBass === 'root'
                      ? `${selectedRoot}${q.suffix}`
                      : `${selectedRoot}${q.suffix}/${selectedBass}`;
                    toneEngine.playChordPreviewStart(newChord);
                  }}
                >
                  <span className="quality-label">{q.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Columna 3: Bajo & Master Pad */}
        <div className="builder-deck result-deck">
          <div className="builder-deck-header">
            <span className="builder-deck-title">BAJO / SLASH</span>
          </div>

          <div className="builder-bass-chips">
            <button
              type="button"
              className={`builder-bass-chip ${selectedBass === 'root' ? 'active' : ''}`}
              onClick={() => setSelectedBass('root')}
            >
              Tónica
            </button>
            {NOTE_CLASSES.map(note => (
              <button
                key={note}
                type="button"
                className={`builder-bass-chip ${selectedBass === note ? 'active' : ''}`}
                onClick={() => {
                  setSelectedBass(note);
                  toneEngine.playChordPreviewStart(`${baseChord}/${note}`);
                }}
              >
                /{note}
              </button>
            ))}
          </div>

          {/* Master Pad de Resultado */}
          <div
            className="builder-master-card"
            data-chord={fullChordName}
            onMouseDown={handleMouseDownChord}
            onTouchStart={handleTouchStartChord}
            title={fullChordName}
          >
            <div className="builder-card-chord-name">{fullChordName}</div>

            <button
              type="button"
              className="builder-preview-sound-btn"
              onClick={(e) => {
                e.stopPropagation();
                handlePlayChord();
              }}
              title="Escuchar"
            >
              <Volume2 size={16} />
            </button>
          </div>

          <button
            type="button"
            className="builder-append-btn"
            onClick={handleAppendToTimeline}
          >
            <Plus size={13} /> Añadir
          </button>
        </div>
      </div>
    </div>
  );
};
