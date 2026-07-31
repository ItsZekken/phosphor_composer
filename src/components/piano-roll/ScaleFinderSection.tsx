import React, { useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import type { MelodyNote, NoteClass, ScaleType } from '../../utils/typeDefinitions';
import { findMatchingScales, formatPitchClasses } from '../../engine/scaleFinder';

interface ScaleFinderSectionProps {
  selectedNoteIds: string[];
  melodyNotes: MelodyNote[];
  currentKey: NoteClass;
  currentScale: ScaleType;
  onSelectScale: (key: NoteClass, scale: ScaleType) => void;
}

export const ScaleFinderSection: React.FC<ScaleFinderSectionProps> = ({
  selectedNoteIds,
  melodyNotes,
  currentKey,
  currentScale,
  onSelectScale
}) => {
  const selectedNotes = useMemo(() => {
    return melodyNotes.filter(n => selectedNoteIds.includes(n.id));
  }, [melodyNotes, selectedNoteIds]);

  const targetNotes = selectedNotes.length > 0 ? selectedNotes : melodyNotes;

  const pitchClasses = useMemo(() => {
    const pcs = new Set<number>();
    targetNotes.forEach(n => pcs.add(n.midi % 12));
    return Array.from(pcs);
  }, [targetNotes]);

  const formattedPitches = useMemo(() => formatPitchClasses(pitchClasses), [pitchClasses]);

  const scaleMatches = useMemo(() => {
    return findMatchingScales(pitchClasses, currentKey, currentScale, 5);
  }, [pitchClasses, currentKey, currentScale]);

  return (
    <div className="scale-finder-section">
      <div className="scale-finder-header">
        <Search size={13} />
        <span>Scale Finder</span>
        {formattedPitches && <span className="pitch-list">({formattedPitches})</span>}
      </div>

      {targetNotes.length === 0 ? (
        <div className="scale-finder-empty">
          Selecciona o crea notas para buscar la escala adecuada
        </div>
      ) : scaleMatches.length === 0 ? (
        <div className="scale-finder-empty">No se encontraron escalas coincidentes</div>
      ) : (
        <div className="scale-finder-list">
          <div className="scale-finder-subtext">
            {selectedNotes.length > 0
              ? `${selectedNotes.length} nota(s) seleccionada(s)`
              : `Basado en ${melodyNotes.length} nota(s) de la melodía`}
          </div>
          {scaleMatches.map((match) => (
            <button
              key={`${match.key}-${match.scale}`}
              type="button"
              className={`scale-match-item ${match.isCurrent ? 'active-scale' : ''}`}
              onClick={() => onSelectScale(match.key, match.scale)}
              title={`Establecer tonalidad y escala a ${match.label}`}
            >
              <span className="scale-name">
                {match.isCurrent && <Check size={12} className="check-icon" />}
                {match.label}
                {match.isCurrent && <span className="current-badge">(Actual)</span>}
              </span>
              <span className={`match-badge ${match.matchPercentage === 100 ? 'full-match' : 'partial-match'}`}>
                {match.matchPercentage}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
