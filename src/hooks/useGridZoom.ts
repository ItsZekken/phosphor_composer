import { useState, useMemo } from 'react';
import { useSongStore } from '../store/songStore';

interface GridZoomOptions {
  initialRowHeight?: number;
  initialBeatWidth?: number;
}

export function useGridZoom(options?: GridZoomOptions) {
  const [rowHeight, setRowHeight] = useState(options?.initialRowHeight || 24);
  const [beatWidth, setBeatWidth] = useState(options?.initialBeatWidth || 96);
  
  const timeSignature = useSongStore(state => state.timeSignature);
  const melodyNotes = useSongStore(state => state.melodyNotes);
  const chordBlocks = useSongStore(state => state.chordBlocks);
  const currentBeat = useSongStore(state => state.currentBeat);
  
  const coarseBeat = Math.floor(currentBeat / 4) * 4;

  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;

  const TOTAL_BEATS = useMemo(() => {
    const maxMelodyBeat = melodyNotes.reduce((max, note) => Math.max(max, note.startBeat + note.durationBeats), 0);
    const maxChordBeat = chordBlocks.reduce((max, block) => Math.max(max, block.startBeat + block.durationBeats), 0);
    const maxContentBeat = Math.max(maxMelodyBeat, maxChordBeat);

    const rawBeatsNeeded = Math.max(32, maxContentBeat + 16, coarseBeat + 8);
    return Math.ceil(rawBeatsNeeded / beatsPerMeasure) * beatsPerMeasure;
  }, [melodyNotes, chordBlocks, coarseBeat, beatsPerMeasure]);

  const handleZoom = (axis: 'x' | 'y', direction: 'in' | 'out') => {
    if (axis === 'x') {
      setBeatWidth(prev => {
        const next = direction === 'in' ? Math.round(prev * 1.2) : Math.round(prev / 1.2);
        return Math.max(48, Math.min(next, 240));
      });
    } else {
      setRowHeight(prev => {
        const next = direction === 'in' ? Math.round(prev * 1.2) : Math.round(prev / 1.2);
        return Math.max(14, Math.min(next, 48));
      });
    }
  };

  return {
    rowHeight,
    beatWidth,
    TOTAL_BEATS,
    beatsPerMeasure,
    handleZoom,
    setRowHeight,
    setBeatWidth
  };
}
