import { useEffect } from 'react';
import { useSongStore } from '../../../store/songStore';
import { isTypingTarget, isModalBlockingShortcuts } from '../../../core/shortcuts/isTypingTarget';
import { transposeChordName } from '../../../core/music';
import { toneEngine } from '../../../audio/toneEngine';

interface UseTimelineShortcutsProps {
  selectedChordIds: string[];
  copySelectedChords: () => void;
  cutSelectedChords: () => void;
  pasteChords: (beat: number) => void;
  duplicateSelectedChords: () => void;
  selectAllChords: () => void;
  deleteSelectedChords: () => void;
  snapStep: number;
  onToggleSliceTool?: () => void;
  onZoomToFit?: () => void;
  onEscape?: () => void;
}

export function useTimelineShortcuts({
  selectedChordIds,
  copySelectedChords,
  cutSelectedChords,
  pasteChords,
  duplicateSelectedChords,
  selectAllChords,
  deleteSelectedChords,
  snapStep,
  onToggleSliceTool,
  onZoomToFit,
  onEscape
}: UseTimelineShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useSongStore.getState();
      if (state.activeView !== 'chord' || isModalBlockingShortcuts(state)) {
        return;
      }

      if (isTypingTarget(e.target)) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const keyLower = e.key.toLowerCase();

      // Escape: cerrar popovers / salir de herramienta slice / deseleccionar
      if (e.key === 'Escape') {
        e.preventDefault();
        if (onEscape) {
          onEscape();
        } else {
          state.setSelectedChordIds([]);
        }
        return;
      }

      // Ctrl+0: Zoom to Fit (encuadrar progresión completa)
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        onZoomToFit?.();
        return;
      }

      // C (sin teclado virtual melódico): Alternar herramienta de corte (Slice)
      if (!state.isKeyboardMelodyEnabled && !isCtrlOrCmd && !e.altKey && !e.shiftKey && keyLower === 'c') {
        e.preventDefault();
        onToggleSliceTool?.();
        return;
      }

      if (isCtrlOrCmd && keyLower === 'c') {
        if (selectedChordIds.length > 0) {
          e.preventDefault();
          copySelectedChords();
        }
        return;
      }

      if (isCtrlOrCmd && keyLower === 'x') {
        if (selectedChordIds.length > 0) {
          e.preventDefault();
          cutSelectedChords();
        }
        return;
      }

      if (isCtrlOrCmd && keyLower === 'v') {
        e.preventDefault();
        const currentBeat = useSongStore.getState().currentBeat || 0;
        pasteChords(currentBeat);
        return;
      }

      if (isCtrlOrCmd && keyLower === 'd') {
        if (selectedChordIds.length > 0) {
          e.preventDefault();
          duplicateSelectedChords();
        }
        return;
      }

      if (isCtrlOrCmd && keyLower === 'a') {
        e.preventDefault();
        selectAllChords();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedChordIds.length > 0) {
          e.preventDefault();
          deleteSelectedChords();
        }
        return;
      }

      // Flechas Izquierda / Derecha: Nudge o ajuste de duración de acordes seleccionados
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isCtrlOrCmd && selectedChordIds.length > 0) {
        e.preventDefault();
        const effectiveStep = e.altKey ? 0.25 : Math.max(0.25, snapStep);
        const delta = (e.key === 'ArrowRight' ? 1 : -1) * effectiveStep;
        const blocks = state.chordBlocks.filter(b => selectedChordIds.includes(b.id));
        if (blocks.length === 0) return;

        if (e.shiftKey) {
          const updates = blocks.map(b => ({
            id: b.id,
            changes: { durationBeats: Math.max(0.25, b.durationBeats + delta) }
          }));
          state.updateChordBlocksBatch(updates);
        } else {
          const minStart = blocks.reduce((m, b) => Math.min(m, b.startBeat), Infinity);
          const safeDelta = Math.max(-minStart, delta);
          if (safeDelta !== 0) {
            const updates = blocks.map(b => ({
              id: b.id,
              changes: { startBeat: Math.max(0, b.startBeat + safeDelta) }
            }));
            state.updateChordBlocksBatch(updates);
          }
        }
        return;
      }

      // Flechas Arriba / Abajo: Transponer acordes seleccionados ±1 semitono (con preescucha)
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isCtrlOrCmd && selectedChordIds.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.key === 'ArrowUp' ? 1 : -1;
        const firstBlock = state.chordBlocks.find(b => selectedChordIds.includes(b.id));
        state.transposeChordBlocks(selectedChordIds, delta);
        if (firstBlock) {
          const transposed = transposeChordName(firstBlock.chord, delta);
          toneEngine.playChordPreview(transposed, state.chordOctaveShift);
        }
        return;
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
    deleteSelectedChords,
    snapStep,
    onToggleSliceTool,
    onZoomToFit,
    onEscape
  ]);
}
