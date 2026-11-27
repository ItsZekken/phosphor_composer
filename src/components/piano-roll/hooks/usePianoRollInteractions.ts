import React, { useState } from 'react';
import { toneEngine } from '../../../audio/toneEngine';
import type { MelodyNote, PianoRollTrack } from '../../../utils/typeDefinitions';
import type { PianoRollGridSnap } from '../../../store/types';
import { generateId } from '../../../utils/idGenerator';
import {
  MIN_MIDI,
  MAX_MIDI,
  NOTE_COUNT,
  getSnapStepBeats,
  midiToNoteName,
  computeSliceMatches,
  type EphemeralDragState,
  type LassoRect,
  type TempNote,
  type PianoRollTool
} from '../utils/pianoRollUtils';

export interface ContextMenuState {
  x: number;
  y: number;
  type: 'notes' | 'canvas';
  beat?: number;
  midi?: number;
}

interface UsePianoRollInteractionsProps {
  contentWrapperRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  pianoRef: React.RefObject<HTMLDivElement | null>;
  melodyNotes: MelodyNote[];
  tracks: PianoRollTrack[];
  activeTrackId: string;
  setActiveTrackId: (id: string) => void;
  addMelodyNote: (note: Omit<MelodyNote, 'id'>) => void;
  removeMelodyNote: (id: string) => void;
  updateMelodyNote: (id: string, updates: Partial<MelodyNote>) => void;
  updateMelodyNotesBatch: (updates: Array<{ id: string; changes: Partial<MelodyNote> }>) => void;
  setMelodyNotes: (notes: MelodyNote[]) => void;
  selectedNoteIds: string[];
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedNoteLength: number;
  setSelectedNoteLength: (len: number) => void;
  beatWidth: number;
  rowHeight: number;
  currentChannelId: string;
  gridSnap: PianoRollGridSnap;
  ephemeralDragRef: React.RefObject<EphemeralDragState | null>;
  triggerNotesRedraw: () => void;
  activeTool: PianoRollTool;
  isGhostNotesActive: boolean;
}

function startEdgeAutoScroll(
  containerRef: React.RefObject<HTMLDivElement | null>,
  pianoRef: React.RefObject<HTMLDivElement | null>,
  getClientPos: () => { x: number; y: number },
  onScrolled: () => void
): () => void {
  let rafId = 0;
  const EDGE_PX = 36;
  const MAX_SPEED = 14;

  const tick = () => {
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const { x, y } = getClientPos();

      let dx = 0;
      let dy = 0;

      if (x < rect.left + EDGE_PX) {
        dx = -Math.ceil(((rect.left + EDGE_PX - x) / EDGE_PX) * MAX_SPEED);
      } else if (x > rect.right - EDGE_PX) {
        dx = Math.ceil(((x - (rect.right - EDGE_PX)) / EDGE_PX) * MAX_SPEED);
      }

      const topEdge = rect.top + 42;
      if (y < topEdge + EDGE_PX) {
        dy = -Math.ceil(((topEdge + EDGE_PX - y) / EDGE_PX) * MAX_SPEED);
      } else if (y > rect.bottom - EDGE_PX) {
        dy = Math.ceil(((y - (rect.bottom - EDGE_PX)) / EDGE_PX) * MAX_SPEED);
      }

      if (dx !== 0 || dy !== 0) {
        const prevLeft = container.scrollLeft;
        const prevTop = container.scrollTop;
        container.scrollLeft = Math.max(0, prevLeft + dx);
        container.scrollTop = Math.max(0, prevTop + dy);
        if (pianoRef.current && container.scrollTop !== prevTop) {
          pianoRef.current.scrollTop = container.scrollTop;
        }
        if (container.scrollLeft !== prevLeft || container.scrollTop !== prevTop) {
          onScrolled();
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

export function usePianoRollInteractions({
  contentWrapperRef,
  containerRef,
  pianoRef,
  melodyNotes,
  tracks,
  activeTrackId,
  setActiveTrackId,
  addMelodyNote,
  removeMelodyNote,
  updateMelodyNote: _updateMelodyNote,
  updateMelodyNotesBatch,
  setMelodyNotes,
  selectedNoteIds,
  setSelectedNoteIds,
  selectedNoteLength,
  setSelectedNoteLength,
  beatWidth,
  rowHeight,
  currentChannelId,
  gridSnap,
  ephemeralDragRef,
  triggerNotesRedraw,
  activeTool,
  isGhostNotesActive
}: UsePianoRollInteractionsProps) {
  const [lassoRect, setLassoRect] = useState<LassoRect | null>(null);
  const [tempNote, setTempNote] = useState<TempNote | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrapper = contentWrapperRef.current;
    const container = containerRef.current;
    if (!wrapper || !container) return;

    const rect = wrapper.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    // 1. Paneo 2D con Botón Central (Middle-Click)
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

    // 2. Herramienta Navaja / Corte (Slice activa + Left-Drag, o Shift + Right-Drag en cualquier momento)
    if ((activeTool === 'slice' && e.button === 0) || (e.shiftKey && e.button === 2)) {
      e.preventDefault();
      const isToolLeftSlice = activeTool === 'slice' && e.button === 0;
      const pointerPos = { x: e.clientX, y: e.clientY };
      let lastAlt = e.altKey;
      let lastShift = isToolLeftSlice && e.shiftKey;
      const selSet = new Set(selectedNoteIds);

      const updateSlice = (altKey: boolean, lockVertical: boolean) => {
        const curRect = wrapper.getBoundingClientRect();
        const rawCurX = pointerPos.x - curRect.left;
        const curX = lockVertical ? startX : rawCurX;
        const curY = pointerPos.y - curRect.top;
        const line = { x1: startX, y1: startY, x2: curX, y2: curY };
        const snapStep = getSnapStepBeats(gridSnap, altKey);
        const matches = computeSliceMatches(melodyNotes || [], selSet, line, beatWidth, rowHeight, snapStep);

        (ephemeralDragRef as { current: EphemeralDragState | null }).current = {
          overrides: new Map(),
          sliceLine: line,
          sliceCuts: matches.map(m => ({ x: m.cutX, y: m.cutY })),
          activeReadout: matches.length > 0 ? { x: curX, y: curY, text: `CORTAR (${matches.length})` } : null
        };
        triggerNotesRedraw();
      };

      updateSlice(lastAlt, lastShift);

      const stopAutoScroll = startEdgeAutoScroll(containerRef, pianoRef, () => pointerPos, () => updateSlice(lastAlt, lastShift));

      const onMoveSlice = (moveEvent: MouseEvent) => {
        pointerPos.x = moveEvent.clientX;
        pointerPos.y = moveEvent.clientY;
        lastAlt = moveEvent.altKey;
        lastShift = isToolLeftSlice && moveEvent.shiftKey;
        updateSlice(lastAlt, lastShift);
      };

      const onUpSlice = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', onMoveSlice);
        window.removeEventListener('mouseup', onUpSlice);
        stopAutoScroll();

        const upRect = wrapper.getBoundingClientRect();
        const lockVertical = isToolLeftSlice && upEvent.shiftKey;
        const curX = lockVertical ? startX : (upEvent.clientX - upRect.left);
        const curY = upEvent.clientY - upRect.top;
        const line = { x1: startX, y1: startY, x2: curX, y2: curY };
        const snapStep = getSnapStepBeats(gridSnap, upEvent.altKey);
        const matches = computeSliceMatches(melodyNotes || [], selSet, line, beatWidth, rowHeight, snapStep);

        if (matches.length > 0) {
          const matchById = new Map(matches.map(m => [m.note.id, m.cutBeat]));
          const nextNotes: MelodyNote[] = [];
          const newIds: string[] = [];

          for (const note of melodyNotes || []) {
            const cutBeat = matchById.get(note.id);
            if (cutBeat === undefined) {
              nextNotes.push(note);
              continue;
            }
            const firstDur = Math.round((cutBeat - note.startBeat) * 10000) / 10000;
            const secondDur = Math.round((note.startBeat + note.durationBeats - cutBeat) * 10000) / 10000;
            const secondId = generateId('slice');

            nextNotes.push({ ...note, durationBeats: firstDur });
            nextNotes.push({
              id: secondId,
              note: note.note,
              midi: note.midi,
              startBeat: cutBeat,
              durationBeats: secondDur,
              velocity: note.velocity ?? 0.8
            });
            newIds.push(note.id, secondId);
          }

          setMelodyNotes(nextNotes);
          if (selectedNoteIds.length > 0) {
            setSelectedNoteIds(Array.from(new Set([...selectedNoteIds, ...newIds])));
          }
        }

        (ephemeralDragRef as { current: EphemeralDragState | null }).current = null;
        triggerNotesRedraw();
      };

      window.addEventListener('mousemove', onMoveSlice);
      window.addEventListener('mouseup', onUpSlice);
      return;
    }

    // Helper compartido de selección por área (Marquee / Lasso) para modo Seleccionar, Ctrl+Arrastre y Clic Derecho
    const startMarqueeSelection = (opts: {
      ctrlTriggersAdditive: boolean;
      openContextMenuOnClick: boolean;
      clickedNote: MelodyNote | null;
    }) => {
      e.preventDefault();
      let hasMoved = false;
      const pointerPos = { x: e.clientX, y: e.clientY };
      const initialSelectedIds = [...selectedNoteIds];
      let lastAdditive = e.shiftKey || (opts.ctrlTriggersAdditive && (e.ctrlKey || e.metaKey));
      const prevBodyCursor = document.body.style.cursor;
      if (!opts.openContextMenuOnClick) {
        document.body.style.cursor = 'crosshair';
      }

      const updateLasso = (additive: boolean) => {
        const currentRect = wrapper.getBoundingClientRect();
        const curX = pointerPos.x - currentRect.left;
        const curY = pointerPos.y - currentRect.top;

        setLassoRect({
          x1: startX,
          y1: startY,
          x2: curX,
          y2: curY
        });

        const lx1 = Math.min(startX, curX);
        const ly1 = Math.min(startY, curY);
        const lx2 = Math.max(startX, curX);
        const ly2 = Math.max(startY, curY);

        const intersectingIds: string[] = [];
        for (const note of melodyNotes || []) {
          const row = MAX_MIDI - note.midi;
          const ny1 = row * rowHeight;
          const ny2 = ny1 + rowHeight;
          const nx1 = note.startBeat * beatWidth;
          const nx2 = (note.startBeat + note.durationBeats) * beatWidth;

          if (nx1 < lx2 && nx2 > lx1 && ny1 < ly2 && ny2 > ly1) {
            intersectingIds.push(note.id);
          }
        }

        if (additive) {
          setSelectedNoteIds(Array.from(new Set([...initialSelectedIds, ...intersectingIds])));
        } else {
          setSelectedNoteIds(intersectingIds);
        }
      };

      const stopAutoScroll = startEdgeAutoScroll(containerRef, pianoRef, () => pointerPos, () => {
        hasMoved = true;
        updateLasso(lastAdditive);
      });

      const handleMouseMoveLasso = (moveEvent: MouseEvent) => {
        pointerPos.x = moveEvent.clientX;
        pointerPos.y = moveEvent.clientY;
        const dx = Math.abs(moveEvent.clientX - e.clientX);
        const dy = Math.abs(moveEvent.clientY - e.clientY);
        if (dx > 3 || dy > 3) {
          hasMoved = true;
        }
        lastAdditive = moveEvent.shiftKey || (opts.ctrlTriggersAdditive && (moveEvent.ctrlKey || moveEvent.metaKey));
        if (hasMoved) {
          updateLasso(lastAdditive);
        }
      };

      const handleMouseUpLasso = () => {
        window.removeEventListener('mousemove', handleMouseMoveLasso);
        window.removeEventListener('mouseup', handleMouseUpLasso);
        stopAutoScroll();
        if (!opts.openContextMenuOnClick) {
          document.body.style.cursor = prevBodyCursor;
        }
        setLassoRect(null);

        if (!hasMoved) {
          if (opts.openContextMenuOnClick) {
            if (opts.clickedNote && !selectedNoteIds.includes(opts.clickedNote.id)) {
              setSelectedNoteIds([opts.clickedNote.id]);
            }
            const snapStep = getSnapStepBeats(gridSnap);
            const clickBeat = Math.floor((startX / beatWidth) / snapStep) * snapStep;
            const clickMidi = MAX_MIDI - Math.floor(startY / rowHeight);
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              type: opts.clickedNote ? 'notes' : 'canvas',
              beat: clickBeat,
              midi: clickMidi
            });

            const closeMenu = () => {
              setContextMenu(null);
              window.removeEventListener('click', closeMenu);
            };
            window.addEventListener('click', closeMenu);
          } else if (!lastAdditive) {
            setSelectedNoteIds([]);
          }
        }
      };

      window.addEventListener('mousemove', handleMouseMoveLasso);
      window.addEventListener('mouseup', handleMouseUpLasso);
    };

    // Detectar si hacemos clic sobre alguna nota existente (de arriba hacia abajo)
    let clickedNote: MelodyNote | null = null;
    let edgeMode: 'move' | 'resize_left' | 'resize_right' = 'move';

    const notesList = melodyNotes || [];
    for (let i = notesList.length - 1; i >= 0; i--) {
      const note = notesList[i];
      const row = MAX_MIDI - note.midi;
      const ny = row * rowHeight;
      const nx = note.startBeat * beatWidth;
      const nw = Math.max(8, note.durationBeats * beatWidth);

      if (startX >= nx && startX <= nx + nw && startY >= ny && startY <= ny + rowHeight) {
        clickedNote = note;
        const clickOffset = startX - nx;
        if (clickOffset < 10 && nw > 20) {
          edgeMode = 'resize_left';
        } else if (nw - clickOffset < 10 && nw > 20) {
          edgeMode = 'resize_right';
        } else {
          edgeMode = 'move';
        }
        break;
      }
    }

    // 3. CASO A: CLICK DERECHO (sin Shift) -> Área de Selección Lasso o Menú Contextual
    if (e.button === 2) {
      startMarqueeSelection({
        ctrlTriggersAdditive: true,
        openContextMenuOnClick: true,
        clickedNote
      });
      return;
    }

    // 4. CASO B: CLICK IZQUIERDO
    if (e.button === 0) {
      if (clickedNote) {
        // B1. Doble clic izquierdo sobre nota existente -> ELIMINAR NOTA (solo en modo Lápiz)
        if (activeTool === 'pencil' && e.detail === 2 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          removeMelodyNote(clickedNote.id);
          setSelectedNoteIds(selectedNoteIds.filter(id => id !== clickedNote!.id));
          return;
        }

        // Smart Note Length: recordar la duración de la nota tocada
        setSelectedNoteLength(clickedNote.durationBeats);

        const isAlreadySelected = selectedNoteIds.includes(clickedNote.id);
        const startedWithShift = e.shiftKey;
        const startedWithCtrl = e.ctrlKey || e.metaKey;
        let dragSelection = [...selectedNoteIds];

        if (startedWithCtrl) {
          dragSelection = isAlreadySelected
            ? dragSelection.filter(id => id !== clickedNote!.id)
            : [...dragSelection, clickedNote.id];
          setSelectedNoteIds(dragSelection);
        } else if (startedWithShift) {
          // Si Shift+Drag: clonar selección actual (o la nota clicada si no estaba seleccionada)
          if (!isAlreadySelected) {
            dragSelection = [clickedNote.id];
          }
        } else if (!isAlreadySelected) {
          dragSelection = [clickedNote.id];
          setSelectedNoteIds(dragSelection);
        }

        // Preescucha instantánea respetando la velocity real de la nota
        const noteVel = clickedNote.velocity ?? 0.8;
        const noteToPlay = clickedNote.note || midiToNoteName(clickedNote.midi);
        toneEngine.startNote(noteToPlay, currentChannelId, noteVel);

        const initialNotesState = (melodyNotes || [])
          .filter(n => dragSelection.includes(n.id))
          .map(n => ({
            id: n.id,
            midi: n.midi,
            note: n.note,
            startBeat: n.startBeat,
            durationBeats: n.durationBeats,
            velocity: n.velocity ?? 0.8
          }));

        let lastPlayedMidi = clickedNote.midi;
        let animFrameId = 0;
        let hasDragged = false;
        let isCloneMode = false;
        let lastSmartDuration = clickedNote.durationBeats;
        const pointerPos = { x: e.clientX, y: e.clientY };
        let lastAlt = e.altKey;

        const applyDragCalculation = (altKey: boolean) => {
          const currentRect = wrapper.getBoundingClientRect();
          const curX = pointerPos.x - currentRect.left;
          const curY = pointerPos.y - currentRect.top;
          const deltaX = curX - startX;
          const deltaY = curY - startY;

          if (!hasDragged && (Math.abs(deltaX) >= 4 || Math.abs(deltaY) >= 4)) {
            hasDragged = true;
            if (startedWithShift && edgeMode === 'move') {
              isCloneMode = true;
            }
          }

          if (!hasDragged) return;

          const snapStep = getSnapStepBeats(gridSnap, altKey);
          const overrides = new Map<string, Partial<MelodyNote>>();
          let clonedPreviewNotes: MelodyNote[] | undefined;
          let activeReadout: { x: number; y: number; text: string } | null = null;

          if (edgeMode === 'move') {
            const deltaBeats = (altKey || gridSnap === 'off')
              ? (deltaX / beatWidth)
              : Math.round((deltaX / beatWidth) / snapStep) * snapStep;
            const deltaMidi = -Math.round(deltaY / rowHeight);

            let primaryNewMidi = clickedNote!.midi;
            let primaryNewStart = clickedNote!.startBeat;

            if (isCloneMode) {
              clonedPreviewNotes = initialNotesState.map(initNote => {
                const newStartBeat = Math.max(0, initNote.startBeat + deltaBeats);
                const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, initNote.midi + deltaMidi));
                const newNoteName = midiToNoteName(newMidi);

                if (initNote.id === clickedNote!.id) {
                  primaryNewMidi = newMidi;
                  primaryNewStart = newStartBeat;
                }

                return {
                  id: `clone_${initNote.id}`,
                  note: newNoteName,
                  midi: newMidi,
                  startBeat: newStartBeat,
                  durationBeats: initNote.durationBeats,
                  velocity: initNote.velocity
                };
              });

              activeReadout = {
                x: primaryNewStart * beatWidth,
                y: (MAX_MIDI - primaryNewMidi) * rowHeight,
                text: `+CLONE · ${midiToNoteName(primaryNewMidi)} · b.${primaryNewStart.toFixed(2)}`
              };
            } else {
              initialNotesState.forEach(initNote => {
                const newStartBeat = Math.max(0, initNote.startBeat + deltaBeats);
                const newMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, initNote.midi + deltaMidi));
                const newNoteName = midiToNoteName(newMidi);

                if (initNote.id === clickedNote!.id) {
                  primaryNewMidi = newMidi;
                  primaryNewStart = newStartBeat;
                }

                overrides.set(initNote.id, {
                  startBeat: newStartBeat,
                  midi: newMidi,
                  note: newNoteName
                });
              });

              activeReadout = {
                x: primaryNewStart * beatWidth,
                y: (MAX_MIDI - primaryNewMidi) * rowHeight,
                text: `${midiToNoteName(primaryNewMidi)} · b.${primaryNewStart.toFixed(2)}`
              };
            }

            if (primaryNewMidi !== lastPlayedMidi) {
              toneEngine.stopNote(midiToNoteName(lastPlayedMidi), currentChannelId);
              lastPlayedMidi = primaryNewMidi;
              toneEngine.startNote(midiToNoteName(primaryNewMidi), currentChannelId, noteVel);
            }
          } else if (edgeMode === 'resize_right') {
            const deltaBeats = (altKey || gridSnap === 'off')
              ? (deltaX / beatWidth)
              : Math.round((deltaX / beatWidth) / snapStep) * snapStep;

            initialNotesState.forEach(initNote => {
              const newDuration = Math.max(snapStep, initNote.durationBeats + deltaBeats);
              overrides.set(initNote.id, { durationBeats: newDuration });
              if (initNote.id === clickedNote!.id) {
                lastSmartDuration = newDuration;
                activeReadout = {
                  x: (initNote.startBeat + newDuration) * beatWidth,
                  y: (MAX_MIDI - initNote.midi) * rowHeight,
                  text: `DUR ${newDuration.toFixed(2)}b`
                };
              }
            });
          } else if (edgeMode === 'resize_left') {
            const deltaBeats = (altKey || gridSnap === 'off')
              ? (deltaX / beatWidth)
              : Math.round((deltaX / beatWidth) / snapStep) * snapStep;

            initialNotesState.forEach(initNote => {
              const endBeat = initNote.startBeat + initNote.durationBeats;
              const maxStart = endBeat - snapStep;
              const newStart = Math.min(maxStart, Math.max(0, initNote.startBeat + deltaBeats));
              const newDuration = Math.max(snapStep, endBeat - newStart);
              overrides.set(initNote.id, { startBeat: newStart, durationBeats: newDuration });
              if (initNote.id === clickedNote!.id) {
                lastSmartDuration = newDuration;
                activeReadout = {
                  x: newStart * beatWidth,
                  y: (MAX_MIDI - initNote.midi) * rowHeight,
                  text: `b.${newStart.toFixed(2)} · ${newDuration.toFixed(2)}b`
                };
              }
            });
          }

          (ephemeralDragRef as { current: EphemeralDragState | null }).current = {
            overrides,
            clonedPreviewNotes,
            activeReadout
          };

          if (!animFrameId) {
            animFrameId = requestAnimationFrame(() => {
              animFrameId = 0;
              triggerNotesRedraw();
            });
          }
        };

        const stopAutoScroll = startEdgeAutoScroll(containerRef, pianoRef, () => pointerPos, () => {
          applyDragCalculation(lastAlt);
        });

        const handleMouseMoveDrag = (moveEvent: MouseEvent) => {
          pointerPos.x = moveEvent.clientX;
          pointerPos.y = moveEvent.clientY;
          lastAlt = moveEvent.altKey;
          applyDragCalculation(lastAlt);
        };

        const handleMouseUpDrag = () => {
          window.removeEventListener('mousemove', handleMouseMoveDrag);
          window.removeEventListener('mouseup', handleMouseUpDrag);
          stopAutoScroll();
          if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = 0;
          }

          toneEngine.stopNote(midiToNoteName(lastPlayedMidi), currentChannelId);

          const ephemeral = ephemeralDragRef.current;
          if (!hasDragged && startedWithShift) {
            // Shift+Click simple sin arrastrar -> alternar selección
            if (isAlreadySelected) {
              setSelectedNoteIds(selectedNoteIds.filter(id => id !== clickedNote!.id));
            } else {
              setSelectedNoteIds([...selectedNoteIds, clickedNote!.id]);
            }
          } else if (isCloneMode && ephemeral?.clonedPreviewNotes && ephemeral.clonedPreviewNotes.length > 0) {
            const finalClones: MelodyNote[] = ephemeral.clonedPreviewNotes.map(c => ({
              ...c,
              id: generateId('note')
            }));
            setMelodyNotes([...(melodyNotes || []), ...finalClones]);
            setSelectedNoteIds(finalClones.map(c => c.id));
          } else if (ephemeral?.overrides && ephemeral.overrides.size > 0) {
            const batchUpdates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];
            ephemeral.overrides.forEach((changes, id) => {
              batchUpdates.push({ id, changes });
            });
            updateMelodyNotesBatch(batchUpdates);

            if (edgeMode === 'resize_left' || edgeMode === 'resize_right') {
              setSelectedNoteLength(lastSmartDuration);
            }
          }

          (ephemeralDragRef as { current: EphemeralDragState | null }).current = null;
          triggerNotesRedraw();
        };

        window.addEventListener('mousemove', handleMouseMoveDrag);
        window.addEventListener('mouseup', handleMouseUpDrag);
      } else {
        // B3. Clic en espacio vacío -> Alt+DobleClic en Ghost Note salta a esa pista
        if (e.detail === 2 && e.altKey && isGhostNotesActive && tracks.length > 1) {
          const clickedRow = Math.max(0, Math.min(NOTE_COUNT - 1, Math.floor(startY / rowHeight)));
          const clickedMidi = MAX_MIDI - clickedRow;
          const clickedBeat = startX / beatWidth;
          const hitTrack = tracks.find(t =>
            t.id !== activeTrackId &&
            (t.notes || []).some(n =>
              n.midi === clickedMidi &&
              clickedBeat >= n.startBeat &&
              clickedBeat <= n.startBeat + n.durationBeats
            )
          );
          if (hitTrack) {
            setActiveTrackId(hitTrack.id);
            return;
          }
        }

        // B4. Modo Seleccionar (E) o Ctrl+Arrastre rápido estilo FL Studio en modo Lápiz -> Caja de selección (Marquee)
        if (activeTool === 'select') {
          startMarqueeSelection({
            ctrlTriggersAdditive: true,
            openContextMenuOnClick: false,
            clickedNote: null
          });
          return;
        }

        if (e.ctrlKey || e.metaKey) {
          startMarqueeSelection({
            ctrlTriggersAdditive: false,
            openContextMenuOnClick: false,
            clickedNote: null
          });
          return;
        }

        if (!e.shiftKey) {
          setSelectedNoteIds([]);
        }

        const snapStep = getSnapStepBeats(gridSnap, e.altKey);
        const snappedStartBeat = (e.altKey || gridSnap === 'off')
          ? Math.max(0, startX / beatWidth)
          : Math.floor((startX / beatWidth) / snapStep) * snapStep;

        const clickedRow = Math.max(0, Math.min(NOTE_COUNT - 1, Math.floor(startY / rowHeight)));
        const clickedMidi = MAX_MIDI - clickedRow;
        const initialDuration = selectedNoteLength || 1;
        const initialNoteName = midiToNoteName(clickedMidi);

        let currentTempMidi = clickedMidi;
        let currentTempDuration = initialDuration;
        const pointerPos = { x: e.clientX, y: e.clientY };
        let lastAlt = e.altKey;

        setTempNote({
          midi: clickedMidi,
          startBeat: snappedStartBeat,
          durationBeats: initialDuration
        });
        toneEngine.startNote(initialNoteName, currentChannelId, 0.8);

        const updateCreate = (altKey: boolean) => {
          const currentRect = wrapper.getBoundingClientRect();
          const curX = pointerPos.x - currentRect.left;
          const curY = pointerPos.y - currentRect.top;
          const currentSnapStep = getSnapStepBeats(gridSnap, altKey);

          const curRow = Math.max(0, Math.min(NOTE_COUNT - 1, Math.floor(curY / rowHeight)));
          const curMidi = MAX_MIDI - curRow;

          if (curMidi !== currentTempMidi) {
            toneEngine.stopNote(midiToNoteName(currentTempMidi), currentChannelId);
            currentTempMidi = curMidi;
            toneEngine.startNote(midiToNoteName(currentTempMidi), currentChannelId, 0.8);
          }

          const currentEndBeat = (altKey || gridSnap === 'off')
            ? (curX / beatWidth)
            : Math.max(snappedStartBeat + currentSnapStep, Math.ceil((curX / beatWidth) / currentSnapStep) * currentSnapStep);

          currentTempDuration = Math.max(currentSnapStep, currentEndBeat - snappedStartBeat);

          setTempNote({
            midi: currentTempMidi,
            startBeat: snappedStartBeat,
            durationBeats: currentTempDuration
          });
        };

        const stopAutoScroll = startEdgeAutoScroll(containerRef, pianoRef, () => pointerPos, () => {
          updateCreate(lastAlt);
        });

        const handleMouseMoveCreate = (moveEvent: MouseEvent) => {
          pointerPos.x = moveEvent.clientX;
          pointerPos.y = moveEvent.clientY;
          lastAlt = moveEvent.altKey;
          updateCreate(lastAlt);
        };

        const handleMouseUpCreate = () => {
          window.removeEventListener('mousemove', handleMouseMoveCreate);
          window.removeEventListener('mouseup', handleMouseUpCreate);
          stopAutoScroll();

          toneEngine.stopNote(midiToNoteName(currentTempMidi), currentChannelId);

          const finalNoteName = midiToNoteName(currentTempMidi);
          setSelectedNoteLength(currentTempDuration);
          addMelodyNote({
            note: finalNoteName,
            midi: currentTempMidi,
            startBeat: snappedStartBeat,
            durationBeats: currentTempDuration,
            velocity: 0.8
          });

          setTempNote(null);
        };

        window.addEventListener('mousemove', handleMouseMoveCreate);
        window.addEventListener('mouseup', handleMouseUpCreate);
      }
    }
  };

  // Cursor inteligente en IDLE (sin secuestrar Alt)
  const handleMouseMoveIdle = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrapper = contentWrapperRef.current;
    if (!wrapper) return;

    if (activeTool === 'slice') {
      wrapper.style.cursor = 'crosshair';
      return;
    }

    const rect = wrapper.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;

    let hoverMode: 'move' | 'resize' | 'empty' = 'empty';

    const notesList = melodyNotes || [];
    for (let i = notesList.length - 1; i >= 0; i--) {
      const note = notesList[i];
      const row = MAX_MIDI - note.midi;
      const ny = row * rowHeight;
      const nx = note.startBeat * beatWidth;
      const nw = Math.max(8, note.durationBeats * beatWidth);

      if (curX >= nx && curX <= nx + nw && curY >= ny && curY <= ny + rowHeight) {
        const clickOffset = curX - nx;
        const isNearEdge = (clickOffset < 10 || nw - clickOffset < 10) && nw > 20;
        hoverMode = isNearEdge ? 'resize' : 'move';
        break;
      }
    }

    if (hoverMode === 'resize') {
      wrapper.style.cursor = 'ew-resize';
    } else if (hoverMode === 'move') {
      wrapper.style.cursor = 'grab';
    } else {
      wrapper.style.cursor = activeTool === 'select' ? 'default' : 'crosshair';
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
