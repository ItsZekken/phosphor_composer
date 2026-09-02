import React, { useState } from 'react';
import { toneEngine } from '../../../audio/toneEngine';
import { NOTE_CLASSES } from '../../../core/music';
import type { MelodyNote } from '../../../utils/typeDefinitions';
import type { LassoRect, TempNote } from '../canvas/PianoRollCanvas';

const MIN_MIDI = 24;
const MAX_MIDI = 96;
const GRID_SNAP = 0.25;

function midiToNoteName(midi: number): string {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_CLASSES[noteIndex]}${octave}`;
}

export interface ContextMenuState {
  x: number;
  y: number;
  type: 'notes' | 'canvas';
  beat?: number;
  midi?: number;
}

interface UsePianoRollInteractionsProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  pianoRef: React.RefObject<HTMLDivElement | null>;
  melodyNotes: MelodyNote[];
  addMelodyNote: (note: Omit<MelodyNote, 'id'>) => void;
  removeMelodyNote: (id: string) => void;
  updateMelodyNote: (id: string, updates: Partial<MelodyNote>) => void;
  selectedNoteIds: string[];
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedNoteLength: number;
  beatWidth: number;
  rowHeight: number;
  currentChannelId: string;
}

export function usePianoRollInteractions({
  canvasRef,
  containerRef,
  pianoRef,
  melodyNotes,
  addMelodyNote,
  removeMelodyNote,
  updateMelodyNote,
  selectedNoteIds,
  setSelectedNoteIds,
  selectedNoteLength,
  beatWidth,
  rowHeight,
  currentChannelId
}: UsePianoRollInteractionsProps) {
  const [lassoRect, setLassoRect] = useState<LassoRect | null>(null);
  const [tempNote, setTempNote] = useState<TempNote | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = canvas.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    // Paneo 2D con Botón Central (Middle-Click)
    if (e.button === 1) {
      e.preventDefault();
      const startScrollLeft = container.scrollLeft;
      const startScrollTop = container.scrollTop;
      const originX = e.clientX;
      const originY = e.clientY;

      const handlePanMove = (moveEvent: MouseEvent) => {
        container.scrollLeft = startScrollLeft - (moveEvent.clientX - originX);
        container.scrollTop = startScrollTop - (moveEvent.clientY - originY);
        if (pianoRef.current) {
          pianoRef.current.scrollTop = container.scrollTop;
        }
      };

      const handlePanUp = () => {
        window.removeEventListener('mousemove', handlePanMove);
        window.removeEventListener('mouseup', handlePanUp);
      };

      window.addEventListener('mousemove', handlePanMove);
      window.addEventListener('mouseup', handlePanUp);
      return;
    }

    // Detectar si hacemos clic en alguna nota existente
    let clickedNote: MelodyNote | null = null;
    let edgeMode: 'move' | 'resize_left' | 'resize_right' | 'velocity' = 'move';

    for (const note of (melodyNotes || [])) {
      const row = MAX_MIDI - note.midi;
      const ny = row * rowHeight;
      const nx = note.startBeat * beatWidth;
      const nw = Math.max(8, note.durationBeats * beatWidth);

      if (startX >= nx && startX <= nx + nw && startY >= ny && startY <= ny + rowHeight) {
        clickedNote = note;
        const clickOffset = startX - nx;
        if (e.altKey) {
          edgeMode = 'velocity';
        } else if (clickOffset < 10 && nw > 20) {
          edgeMode = 'resize_left';
        } else if (nw - clickOffset < 10 && nw > 20) {
          edgeMode = 'resize_right';
        } else {
          edgeMode = 'move';
        }
        break;
      }
    }

    // CASO A: CLICK DERECHO -> Área de Selección Lasso (o Menú Contextual si es clic seco)
    if (e.button === 2) {
      e.preventDefault();
      let hasMoved = false;

      const handleMouseMoveLasso = (moveEvent: MouseEvent) => {
        const dx = Math.abs(moveEvent.clientX - e.clientX);
        const dy = Math.abs(moveEvent.clientY - e.clientY);
        if (dx > 4 || dy > 4) {
          hasMoved = true;
        }
        const currentRect = canvas.getBoundingClientRect();
        const curX = moveEvent.clientX - currentRect.left;
        const curY = moveEvent.clientY - currentRect.top;

        setLassoRect({
          x1: startX,
          y1: startY,
          x2: curX,
          y2: curY
        });

        // Buscar notas que intersectan el Lasso
        const lx1 = Math.min(startX, curX);
        const ly1 = Math.min(startY, curY);
        const lx2 = Math.max(startX, curX);
        const ly2 = Math.max(startY, curY);

        const intersectingIds: string[] = [];

        (melodyNotes || []).forEach(note => {
          const row = MAX_MIDI - note.midi;
          const ny1 = row * rowHeight;
          const ny2 = ny1 + rowHeight;
          const nx1 = note.startBeat * beatWidth;
          const nx2 = (note.startBeat + note.durationBeats) * beatWidth;

          if (nx1 < lx2 && nx2 > lx1 && ny1 < ly2 && ny2 > ly1) {
            intersectingIds.push(note.id);
          }
        });

        if (moveEvent.ctrlKey || moveEvent.shiftKey) {
          const combined = Array.from(new Set([...selectedNoteIds, ...intersectingIds]));
          setSelectedNoteIds(combined);
        } else {
          setSelectedNoteIds(intersectingIds);
        }
      };

      const handleMouseUpLasso = () => {
        window.removeEventListener('mousemove', handleMouseMoveLasso);
        window.removeEventListener('mouseup', handleMouseUpLasso);
        setLassoRect(null);

        if (!hasMoved) {
          const clickBeat = Math.floor(startX / beatWidth);
          const clickMidi = MAX_MIDI - Math.floor(startY / rowHeight);
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            type: clickedNote ? 'notes' : 'canvas',
            beat: clickBeat,
            midi: clickMidi
          });

          const closeMenu = () => {
            setContextMenu(null);
            window.removeEventListener('click', closeMenu);
          };
          window.addEventListener('click', closeMenu);
        }
      };

      window.addEventListener('mousemove', handleMouseMoveLasso);
      window.addEventListener('mouseup', handleMouseUpLasso);
      return;
    }

    // CASO B: CLICK IZQUIERDO
    if (e.button === 0) {
      if (clickedNote) {
        // B1. Doble click izquierdo sobre nota existente: ELIMINAR NOTA
        if (e.detail === 2) {
          removeMelodyNote(clickedNote.id);
          setSelectedNoteIds(selectedNoteIds.filter(id => id !== clickedNote!.id));
          return;
        }

        // B2. Click simple izquierdo sobre nota: iniciar arrastre / redimensión / velocidad
        const isAlreadySelected = selectedNoteIds.includes(clickedNote.id);
        let newSelection = [...selectedNoteIds];

        if (e.ctrlKey || e.shiftKey) {
          if (isAlreadySelected) {
            newSelection = newSelection.filter(id => id !== clickedNote!.id);
          } else {
            newSelection.push(clickedNote.id);
          }
        } else {
          if (!isAlreadySelected) {
            newSelection = [clickedNote.id];
          }
        }

        setSelectedNoteIds(newSelection);
        toneEngine.playNotePreview(clickedNote.note, currentChannelId);

        const initialNotesState = (melodyNotes || [])
          .filter(n => newSelection.includes(n.id))
          .map(n => ({
            id: n.id,
            midi: n.midi,
            startBeat: n.startBeat,
            durationBeats: n.durationBeats,
            velocity: n.velocity ?? 0.8
          }));

        let lastPlayedMidi = clickedNote.midi;

        const handleMouseMoveDrag = (moveEvent: MouseEvent) => {
          const currentRect = canvas.getBoundingClientRect();
          const curX = moveEvent.clientX - currentRect.left;
          const curY = moveEvent.clientY - currentRect.top;

          const deltaX = curX - startX;
          const deltaY = curY - startY;

          if (edgeMode === 'move') {
            const deltaBeats = Math.round((deltaX / beatWidth) / GRID_SNAP) * GRID_SNAP;
            const deltaMidi = -Math.round(deltaY / rowHeight);

            let primaryNewMidi = clickedNote!.midi;

            initialNotesState.forEach(initNote => {
              const newStartBeat = Math.max(0, initNote.startBeat + deltaBeats);
              const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, initNote.midi + deltaMidi));
              const newNoteName = midiToNoteName(newMidi);
              
              if (initNote.id === clickedNote!.id) {
                primaryNewMidi = newMidi;
              }

              updateMelodyNote(initNote.id, {
                startBeat: newStartBeat,
                midi: newMidi,
                note: newNoteName
              });
            });

            // Feedback auditivo reactivo al mover verticalmente (cada semitono nuevo)
            if (primaryNewMidi !== lastPlayedMidi) {
              lastPlayedMidi = primaryNewMidi;
              toneEngine.playNotePreview(midiToNoteName(primaryNewMidi), currentChannelId);
            }

          } else if (edgeMode === 'resize_right') {
            const deltaBeats = Math.round((deltaX / beatWidth) / GRID_SNAP) * GRID_SNAP;

            initialNotesState.forEach(initNote => {
              const newDuration = Math.max(GRID_SNAP, initNote.durationBeats + deltaBeats);
              updateMelodyNote(initNote.id, { durationBeats: newDuration });
            });
          } else if (edgeMode === 'resize_left') {
            const deltaBeats = Math.round((deltaX / beatWidth) / GRID_SNAP) * GRID_SNAP;

            initialNotesState.forEach(initNote => {
              const endBeat = initNote.startBeat + initNote.durationBeats;
              const maxStart = endBeat - GRID_SNAP;
              const newStart = Math.min(maxStart, Math.max(0, initNote.startBeat + deltaBeats));
              const newDuration = Math.max(GRID_SNAP, endBeat - newStart);
              updateMelodyNote(initNote.id, { startBeat: newStart, durationBeats: newDuration });
            });
          } else if (edgeMode === 'velocity') {
            const deltaVel = -deltaY / 150;
            initialNotesState.forEach(initNote => {
              const newVel = Math.max(0.1, Math.min(1.0, parseFloat((initNote.velocity + deltaVel).toFixed(2))));
              updateMelodyNote(initNote.id, { velocity: newVel });
            });
          }
        };

        const handleMouseUpDrag = () => {
          window.removeEventListener('mousemove', handleMouseMoveDrag);
          window.removeEventListener('mouseup', handleMouseUpDrag);
        };

        window.addEventListener('mousemove', handleMouseMoveDrag);
        window.addEventListener('mouseup', handleMouseUpDrag);

      } else {
        // B3. Click en fondo vacío: Dibujar nota instantáneamente o estirarla con arrastre
        if (!e.ctrlKey && !e.shiftKey) {
          setSelectedNoteIds([]);
        }

        const clickedRow = Math.floor(startY / rowHeight);
        const clickedMidi = MAX_MIDI - clickedRow;
        const snappedStartBeat = Math.floor(startX / beatWidth / GRID_SNAP) * GRID_SNAP;
        const noteName = midiToNoteName(clickedMidi);

        toneEngine.playNotePreview(noteName, currentChannelId);

        let hasStartedDrag = false;

        const handleMouseMoveCreate = (moveEvent: MouseEvent) => {
          const currentRect = canvas.getBoundingClientRect();
          const curX = moveEvent.clientX - currentRect.left;
          const distance = Math.abs(curX - startX);

          if (distance > 6) {
            hasStartedDrag = true;
            const currentBeatSnapped = Math.max(snappedStartBeat + GRID_SNAP, Math.floor(curX / beatWidth / GRID_SNAP) * GRID_SNAP);
            const duration = currentBeatSnapped - snappedStartBeat;

            setTempNote({
              midi: clickedMidi,
              startBeat: snappedStartBeat,
              durationBeats: duration
            });
          }
        };

        const handleMouseUpCreate = (upEvent: MouseEvent) => {
          window.removeEventListener('mousemove', handleMouseMoveCreate);
          window.removeEventListener('mouseup', handleMouseUpCreate);

          const currentRect = canvas.getBoundingClientRect();
          const curX = upEvent.clientX - currentRect.left;
          const distance = Math.abs(curX - startX);

          const finalDuration = hasStartedDrag && distance > 6
            ? Math.max(GRID_SNAP, (Math.floor(curX / beatWidth / GRID_SNAP) * GRID_SNAP) - snappedStartBeat)
            : (selectedNoteLength || 1);

          addMelodyNote({
            note: noteName,
            midi: clickedMidi,
            startBeat: snappedStartBeat,
            durationBeats: finalDuration,
            velocity: 0.8
          });

          setTempNote(null);
        };

        window.addEventListener('mousemove', handleMouseMoveCreate);
        window.addEventListener('mouseup', handleMouseUpCreate);
      }
    }
  };

  // Cambiar cursor en IDLE
  const handleMouseMoveIdle = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;

    let hoverMode: 'move' | 'resize' | 'crosshair' | 'velocity' = 'crosshair';

    for (const note of (melodyNotes || [])) {
      const row = MAX_MIDI - note.midi;
      const ny = row * rowHeight;
      const nx = note.startBeat * beatWidth;
      const nw = Math.max(8, note.durationBeats * beatWidth);

      if (curX >= nx && curX <= nx + nw && curY >= ny && curY <= ny + rowHeight) {
        if (e.altKey) {
          hoverMode = 'velocity';
        } else {
          const clickOffset = curX - nx;
          const isNearEdge = (clickOffset < 10 || nw - clickOffset < 10) && nw > 20;
          hoverMode = isNearEdge ? 'resize' : 'move';
        }
        break;
      }
    }

    if (hoverMode === 'velocity') {
      canvas.style.cursor = 'ns-resize';
    } else if (hoverMode === 'resize') {
      canvas.style.cursor = 'ew-resize';
    } else if (hoverMode === 'move') {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  };

  return {
    lassoRect,
    tempNote,
    contextMenu,
    setContextMenu,
    handleMouseDown,
    handleMouseMoveIdle
  };
}
