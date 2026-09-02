import { useEffect } from 'react';
import { useSongStore } from '../../../store/songStore';

interface UseTimelineShortcutsProps {
  selectedChordIds: string[];
  copySelectedChords: () => void;
  cutSelectedChords: () => void;
  pasteChords: (beat: number) => void;
  duplicateSelectedChords: () => void;
  selectAllChords: () => void;
  deleteSelectedChords: () => void;
}

export function useTimelineShortcuts({
  selectedChordIds,
  copySelectedChords,
  cutSelectedChords,
  pasteChords,
  duplicateSelectedChords,
  selectAllChords,
  deleteSelectedChords
}: UseTimelineShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isCtrlOrCmd && e.key.toLowerCase() === 'c') {
        if (selectedChordIds.length > 0) {
          e.preventDefault();
          copySelectedChords();
        }
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'x') {
        if (selectedChordIds.length > 0) {
          e.preventDefault();
          cutSelectedChords();
        }
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const currentBeat = useSongStore.getState().currentBeat || 0;
        pasteChords(currentBeat);
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'd') {
        if (selectedChordIds.length > 0) {
          e.preventDefault();
          duplicateSelectedChords();
        }
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllChords();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedChordIds.length > 0) {
          e.preventDefault();
          deleteSelectedChords();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedChordIds,
    copySelectedChords,
    cutSelectedChords,
    pasteChords,
    duplicateSelectedChords,
    selectAllChords,
    deleteSelectedChords
  ]);
}
