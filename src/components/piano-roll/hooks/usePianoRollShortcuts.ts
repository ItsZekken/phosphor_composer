import { useEffect } from 'react';
import { useSongStore } from '../../../store/songStore';
import { toneEngine } from '../../../audio/toneEngine';
import { isTypingTarget } from '../../../core/shortcuts/isTypingTarget';
import type { MelodyNote } from '../../../utils/typeDefinitions';
import type { PianoRollGridSnap } from '../../../store/types';
import {
  MIN_MIDI,
  MAX_MIDI,
  getSnapStepBeats,
  midiToNoteName,
  type PianoRollTool
} from '../utils/pianoRollUtils';
import type { TransformTab } from '../tools/PianoRollTransformsPopover';

interface UsePianoRollShortcutsProps {
  selectedNoteIds: string[];
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<string[]>>;
  melodyNotes: MelodyNote[];
  removeMelodyNote?: (id: string) => void;
  updateMelodyNote?: (id: string, updates: Partial<MelodyNote>) => void;
  removeMelodyNotesBatch: (ids: string[]) => void;
  updateMelodyNotesBatch: (updates: Array<{ id: string; changes: Partial<MelodyNote> }>) => void;
  setMelodyNotes: (notes: MelodyNote[]) => void;
  clipboardNotes: MelodyNote[];
  setClipboardNotes: (notes: MelodyNote[]) => void;
  currentChannelId: string;
  gridSnap: PianoRollGridSnap;
  onToggleVelocityLane?: () => void;
  onToggleGhostNotes?: () => void;
  onSelectTool?: (tool: PianoRollTool) => void;
  onOpenTransforms?: (tab: TransformTab) => void;
  onZoomToFit?: () => void;
  onEscape?: () => void;
}

export function usePianoRollShortcuts({
  selectedNoteIds,
  setSelectedNoteIds,
  melodyNotes,
  removeMelodyNotesBatch,
  updateMelodyNotesBatch,
  setMelodyNotes,
  clipboardNotes,
  setClipboardNotes,
  currentChannelId,
  gridSnap,
  onToggleVelocityLane,
  onToggleGhostNotes,
  onSelectTool,
  onOpenTransforms,
  onZoomToFit,
  onEscape
}: UsePianoRollShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useSongStore.getState();
      if (
        (state.activeView !== 'piano-roll' && (state.activeView as string) !== 'piano') ||
        state.isSynthModalOpen ||
        state.isSettingsOpen
      ) {
        return;
      }

      if (isTypingTarget(e.target)) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const snapStep = getSnapStepBeats(gridSnap);
      const keyLower = e.key.toLowerCase();

      // Escape: cerrar popovers / desactivar Slice Tool / deseleccionar
      if (e.key === 'Escape') {
        e.preventDefault();
        if (onEscape) {
          onEscape();
        } else {
          setSelectedNoteIds([]);
        }
        return;
      }

      // Ctrl+0: Zoom to Fit
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        onZoomToFit?.();
        return;
      }

      // Alt+S / Alt+R / Alt+U: Transformadores musicales (Strum / Humanize / Chop)
      if (e.altKey && !isCtrlOrCmd) {
        if (keyLower === 's') {
          e.preventDefault();
          onOpenTransforms?.('strum');
          return;
        }
        if (keyLower === 'r') {
          e.preventDefault();
          onOpenTransforms?.('humanize');
          return;
        }
        if (keyLower === 'u') {
          e.preventDefault();
          onOpenTransforms?.('chop');
          return;
        }
      }

      // Atajos de una sola letra SOLO cuando el teclado melódico QWERTY está desactivado
      if (!state.isKeyboardMelodyEnabled && !isCtrlOrCmd && !e.altKey && !e.shiftKey) {
        if (keyLower === 'v') {
          e.preventDefault();
          onToggleVelocityLane?.();
          return;
        }
        if (keyLower === 'g') {
          e.preventDefault();
          onToggleGhostNotes?.();
          return;
        }
        if (keyLower === 'p') {
          e.preventDefault();
          onSelectTool?.('pencil');
          return;
        }
        if (keyLower === 'c') {
          e.preventDefault();
          onSelectTool?.('slice');
          return;
        }
        if (keyLower === 'e') {
          e.preventDefault();
          onSelectTool?.('select');
          return;
        }
        if (keyLower === 'm' && selectedNoteIds.length > 0) {
          e.preventDefault();
          const selected = (melodyNotes || []).filter((n) => selectedNoteIds.includes(n.id));
          if (selected.length > 0) {
            const allMuted = selected.every((n) => Boolean(n.muted));
            updateMelodyNotesBatch(
              selected.map((n) => ({ id: n.id, changes: { muted: !allMuted ? true : undefined } }))
            );
          }
          return;
        }
      }

      // Delete / Backspace: eliminar notas seleccionadas en una sola operación atómica
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          removeMelodyNotesBatch(selectedNoteIds);
          setSelectedNoteIds([]);
        }
        return;
      }

      // Ctrl+A: Seleccionar todas las notas
      if (isCtrlOrCmd && keyLower === 'a') {
        e.preventDefault();
        setSelectedNoteIds((melodyNotes || []).map(n => n.id));
        return;
      }

      // Ctrl+C: Copiar notas seleccionadas
      if (isCtrlOrCmd && keyLower === 'c') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
          if (selected.length > 0) {
            setClipboardNotes(selected);
          }
        }
        return;
      }

      // Ctrl+X: Cortar notas seleccionadas
      if (isCtrlOrCmd && keyLower === 'x') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
          if (selected.length > 0) {
            setClipboardNotes(selected);
            removeMelodyNotesBatch(selectedNoteIds);
            setSelectedNoteIds([]);
          }
        }
        return;
      }

      // Ctrl+V: Pegar notas en la posición del playhead
      if (isCtrlOrCmd && keyLower === 'v') {
        if (clipboardNotes && clipboardNotes.length > 0) {
          e.preventDefault();
          const currentPlayheadBeat = useSongStore.getState().currentBeat ?? 0;
          const minStartBeat = Math.min(...clipboardNotes.map(n => n.startBeat));

          const pastedNotes: MelodyNote[] = clipboardNotes.map(n => {
            const relativeOffset = n.startBeat - minStartBeat;
            return {
              id: `pasted_${Math.random().toString(36).substr(2, 9)}`,
              note: n.note,
              midi: n.midi,
              startBeat: currentPlayheadBeat + relativeOffset,
              durationBeats: n.durationBeats,
              velocity: n.velocity ?? 0.8
            };
          });

          const newMelodyNotes = [...(melodyNotes || []), ...pastedNotes];
          setMelodyNotes(newMelodyNotes);
          setSelectedNoteIds(pastedNotes.map(n => n.id));
          if (pastedNotes.length > 0) {
            toneEngine.playNotePreview(pastedNotes[0].note, currentChannelId, pastedNotes[0].velocity ?? 0.8);
          }
        }
        return;
      }

      // Ctrl+D: Duplicar notas seleccionadas inmediatamente a continuación
      if (isCtrlOrCmd && keyLower === 'd') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
          if (selected.length === 0) return;

          const minStart = Math.min(...selected.map(n => n.startBeat));
          const maxEnd = Math.max(...selected.map(n => n.startBeat + n.durationBeats));
          const span = Math.max(snapStep, maxEnd - minStart);

          const duplicatedNotes: MelodyNote[] = selected.map(n => ({
            id: `dup_${Math.random().toString(36).substr(2, 9)}`,
            note: n.note,
            midi: n.midi,
            startBeat: n.startBeat + span,
            durationBeats: n.durationBeats,
            velocity: n.velocity ?? 0.8
          }));

          setMelodyNotes([...(melodyNotes || []), ...duplicatedNotes]);
          setSelectedNoteIds(duplicatedNotes.map(n => n.id));
          if (duplicatedNotes.length > 0) {
            toneEngine.playNotePreview(duplicatedNotes[0].note, currentChannelId, duplicatedNotes[0].velocity ?? 0.8);
          }
        }
        return;
      }

      // Ctrl+L: Legato Automático (extender cada nota hasta el inicio de la siguiente)
      if (isCtrlOrCmd && keyLower === 'l') {
        if (selectedNoteIds.length > 1) {
          e.preventDefault();
          const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id)).sort((a, b) => a.startBeat - b.startBeat);
          const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];

          for (let i = 0; i < selected.length - 1; i++) {
            const cur = selected[i];
            const next = selected[i + 1];
            if (next.startBeat > cur.startBeat) {
              const newDuration = next.startBeat - cur.startBeat;
              updates.push({ id: cur.id, changes: { durationBeats: newDuration } });
            }
          }

          if (updates.length > 0) {
            updateMelodyNotesBatch(updates);
          }
        }
        return;
      }

      // Cuantizar (Ctrl+Q o Q): Cuantizar notas seleccionadas al gridSnap de forma atómica
      if ((isCtrlOrCmd && keyLower === 'q') || (keyLower === 'q' && !isCtrlOrCmd && !e.shiftKey && !e.altKey)) {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];

          selectedNoteIds.forEach(id => {
            const note = (melodyNotes || []).find(n => n.id === id);
            if (note) {
              const snappedStart = Math.round(note.startBeat / snapStep) * snapStep;
              const snappedDuration = Math.max(snapStep, Math.round(note.durationBeats / snapStep) * snapStep);
              updates.push({ id, changes: { startBeat: snappedStart, durationBeats: snappedDuration } });
            }
          });

          if (updates.length > 0) {
            updateMelodyNotesBatch(updates);
          }
        }
        return;
      }

      // Transposición con Flechas Arriba / Abajo
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
          let previewNoteName = '';
          let previewVel = 0.8;
          const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];

          selectedNoteIds.forEach(id => {
            const note = (melodyNotes || []).find(n => n.id === id);
            if (note) {
              const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, note.midi + delta));
              const newName = midiToNoteName(newMidi);
              previewNoteName = newName;
              previewVel = note.velocity ?? 0.8;
              updates.push({ id, changes: { midi: newMidi, note: newName } });
            }
          });

          if (updates.length > 0) {
            updateMelodyNotesBatch(updates);
          }

          if (previewNoteName) {
            toneEngine.playNotePreview(previewNoteName, currentChannelId, previewVel);
          }
        }
        return;
      }

      // Nudge / Trim de duración con Flechas Izquierda / Derecha
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const delta = (e.key === 'ArrowRight' ? 1 : -1) * snapStep;
          const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];

          if (e.shiftKey) {
            selectedNoteIds.forEach(id => {
              const note = (melodyNotes || []).find(n => n.id === id);
              if (note) {
                const newDuration = Math.max(snapStep, note.durationBeats + delta);
                updates.push({ id, changes: { durationBeats: newDuration } });
              }
            });
          } else {
            selectedNoteIds.forEach(id => {
              const note = (melodyNotes || []).find(n => n.id === id);
              if (note) {
                const newStart = Math.max(0, note.startBeat + delta);
                updates.push({ id, changes: { startBeat: newStart } });
              }
            });
          }

          if (updates.length > 0) {
            updateMelodyNotesBatch(updates);
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedNoteIds,
    setSelectedNoteIds,
    melodyNotes,
    removeMelodyNotesBatch,
    updateMelodyNotesBatch,
    setMelodyNotes,
    clipboardNotes,
    setClipboardNotes,
    currentChannelId,
    gridSnap,
    onToggleVelocityLane,
    onToggleGhostNotes,
    onSelectTool,
    onOpenTransforms,
    onZoomToFit,
    onEscape
  ]);
}
