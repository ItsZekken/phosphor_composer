import { useEffect } from 'react';
import { useSongStore } from '../../../store/songStore';
import { toneEngine } from '../../../audio/toneEngine';
import { NOTE_CLASSES } from '../../../core/music';
import type { MelodyNote } from '../../../utils/typeDefinitions';

const MIN_MIDI = 24;
const MAX_MIDI = 96;
const GRID_SNAP = 0.25;

function midiToNoteName(midi: number): string {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_CLASSES[noteIndex]}${octave}`;
}

interface UsePianoRollShortcutsProps {
  selectedNoteIds: string[];
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<string[]>>;
  melodyNotes: MelodyNote[];
  removeMelodyNote: (id: string) => void;
  updateMelodyNote: (id: string, updates: Partial<MelodyNote>) => void;
  setMelodyNotes: (notes: MelodyNote[]) => void;
  clipboardNotes: MelodyNote[];
  setClipboardNotes: (notes: MelodyNote[]) => void;
  currentChannelId: string;
}

export function usePianoRollShortcuts({
  selectedNoteIds,
  setSelectedNoteIds,
  melodyNotes,
  removeMelodyNote,
  updateMelodyNote,
  setMelodyNotes,
  clipboardNotes,
  setClipboardNotes,
  currentChannelId
}: UsePianoRollShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Delete / Backspace: eliminar notas seleccionadas
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          selectedNoteIds.forEach(id => removeMelodyNote(id));
          setSelectedNoteIds([]);
        }
        return;
      }

      // Ctrl+A: Seleccionar todas las notas
      if (isCtrlOrCmd && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedNoteIds((melodyNotes || []).map(n => n.id));
        return;
      }

      // Ctrl+C: Copiar notas seleccionadas
      if (isCtrlOrCmd && e.key.toLowerCase() === 'c') {
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
      if (isCtrlOrCmd && e.key.toLowerCase() === 'x') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
          if (selected.length > 0) {
            setClipboardNotes(selected);
            selectedNoteIds.forEach(id => removeMelodyNote(id));
            setSelectedNoteIds([]);
          }
        }
        return;
      }

      // Ctrl+V: Pegar notas en la posición del playhead
      if (isCtrlOrCmd && e.key.toLowerCase() === 'v') {
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
            toneEngine.playNotePreview(pastedNotes[0].note, currentChannelId);
          }
        }
        return;
      }

      // Ctrl+D: Duplicar notas seleccionadas inmediatamente a continuación
      if (isCtrlOrCmd && e.key.toLowerCase() === 'd') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id));
          if (selected.length === 0) return;

          const minStart = Math.min(...selected.map(n => n.startBeat));
          const maxEnd = Math.max(...selected.map(n => n.startBeat + n.durationBeats));
          const span = Math.max(GRID_SNAP, maxEnd - minStart);

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
            toneEngine.playNotePreview(duplicatedNotes[0].note, currentChannelId);
          }
        }
        return;
      }

      // Ctrl+L: Legato Automático (extender cada nota hasta el inicio de la siguiente)
      if (isCtrlOrCmd && e.key.toLowerCase() === 'l') {
        if (selectedNoteIds.length > 1) {
          e.preventDefault();
          const selected = (melodyNotes || []).filter(n => selectedNoteIds.includes(n.id)).sort((a, b) => a.startBeat - b.startBeat);
          for (let i = 0; i < selected.length - 1; i++) {
            const cur = selected[i];
            const next = selected[i + 1];
            if (next.startBeat > cur.startBeat) {
              const newDuration = next.startBeat - cur.startBeat;
              updateMelodyNote(cur.id, { durationBeats: newDuration });
            }
          }
        }
        return;
      }

      // Cuantizar (Ctrl+Q o Q): Cuantizar notas seleccionadas al GRID_SNAP
      if ((isCtrlOrCmd && e.key.toLowerCase() === 'q') || (e.key.toLowerCase() === 'q' && !isCtrlOrCmd && !e.shiftKey)) {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          selectedNoteIds.forEach(id => {
            const note = (melodyNotes || []).find(n => n.id === id);
            if (note) {
              const snappedStart = Math.round(note.startBeat / GRID_SNAP) * GRID_SNAP;
              const snappedDuration = Math.max(GRID_SNAP, Math.round(note.durationBeats / GRID_SNAP) * GRID_SNAP);
              updateMelodyNote(id, { startBeat: snappedStart, durationBeats: snappedDuration });
            }
          });
        }
        return;
      }

      // Transposición con Flechas Arriba / Abajo
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
          let previewNoteName = '';

          selectedNoteIds.forEach(id => {
            const note = (melodyNotes || []).find(n => n.id === id);
            if (note) {
              const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, note.midi + delta));
              const newName = midiToNoteName(newMidi);
              previewNoteName = newName;
              updateMelodyNote(id, { midi: newMidi, note: newName });
            }
          });

          if (previewNoteName) {
            toneEngine.playNotePreview(previewNoteName, currentChannelId);
          }
        }
        return;
      }

      // Nudge / Trim de duración con Flechas Izquierda / Derecha
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const delta = (e.key === 'ArrowRight' ? 1 : -1) * GRID_SNAP;

          if (e.shiftKey) {
            // Trim de duración
            selectedNoteIds.forEach(id => {
              const note = (melodyNotes || []).find(n => n.id === id);
              if (note) {
                const newDuration = Math.max(GRID_SNAP, note.durationBeats + delta);
                updateMelodyNote(id, { durationBeats: newDuration });
              }
            });
          } else {
            // Nudge de posición en el tiempo
            selectedNoteIds.forEach(id => {
              const note = (melodyNotes || []).find(n => n.id === id);
              if (note) {
                const newStart = Math.max(0, note.startBeat + delta);
                updateMelodyNote(id, { startBeat: newStart });
              }
            });
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
    removeMelodyNote,
    updateMelodyNote,
    setMelodyNotes,
    clipboardNotes,
    setClipboardNotes,
    currentChannelId
  ]);
}
