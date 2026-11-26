/**
 * playlistGroupDrag.ts
 * Motor unificado de arrastre y clonado en grupo estilo FL Studio Playlist
 * para selecciones múltiples de MIDI Pattern Clips y Audio Clips (horizontal + vertical multi-track)
 * con historial atómico en Zundo (un solo Ctrl+Z deshace todo el movimiento o clonado grupal).
 */

import type React from 'react';
import { useSongStore } from '../../store/songStore';
import type { AudioClip, AudioSnapGrid, MidiPatternClip } from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';

const TRACK_ROW_HEIGHT_PX = 64;

export function snapPlaylistBeat(beat: number, grid: AudioSnapGrid, beatsPerMeasure: number): number {
  if (grid === 'off') return Math.max(0, beat);
  let step = 1;
  if (grid === 'bar') step = beatsPerMeasure;
  else if (grid === 'beat') step = 1;
  else if (grid === '1/2') step = 0.5;
  else if (grid === '1/4') step = 0.25;
  else if (grid === '1/8') step = 0.125;
  else if (grid === '1/16') step = 0.0625;
  return Math.max(0, Math.round(beat / step) * step);
}

export interface StartPlaylistGroupDragParams {
  e: React.PointerEvent<HTMLDivElement>;
  anchorKind: 'midi' | 'audio';
  anchorClipId: string;
  zoomLevel: number;
  beatsPerMeasure: number;
  snapGrid: AudioSnapGrid;
}

export function startPlaylistGroupDrag({
  e,
  anchorKind,
  anchorClipId,
  zoomLevel,
  beatsPerMeasure,
  snapGrid
}: StartPlaylistGroupDragParams): void {
  const storeBefore = useSongStore.getState();
  const isToggleMulti = e.ctrlKey || e.metaKey;
  const isCloneDrag = e.shiftKey && !isToggleMulti;

  const wasAlreadySelected =
    anchorKind === 'midi'
      ? storeBefore.selectedMidiClipIds.includes(anchorClipId)
      : storeBefore.selectedClipIds.includes(anchorClipId);

  let collapseSelectionOnClick = false;

  if (isToggleMulti) {
    // Ctrl/Cmd + Clic alterna este clip dentro de la selección múltiple sin borrar los demás
    if (anchorKind === 'midi') {
      const nextMidiSel = wasAlreadySelected
        ? storeBefore.selectedMidiClipIds.filter((id) => id !== anchorClipId)
        : [...storeBefore.selectedMidiClipIds, anchorClipId];
      useSongStore.setState({ selectedMidiClipIds: nextMidiSel });
    } else {
      const nextAudioSel = wasAlreadySelected
        ? storeBefore.selectedClipIds.filter((id) => id !== anchorClipId)
        : [...storeBefore.selectedClipIds, anchorClipId];
      useSongStore.setState({ selectedClipIds: nextAudioSel });
    }
    // Si acabamos de quitarlo de la selección, no iniciar arrastre
    if (wasAlreadySelected) {
      return;
    }
  } else if (!wasAlreadySelected) {
    // Clic normal sobre un clip no seleccionado: seleccionar solo este clip
    useSongStore.setState({
      selectedMidiClipIds: anchorKind === 'midi' ? [anchorClipId] : [],
      selectedClipIds: anchorKind === 'audio' ? [anchorClipId] : []
    });
  } else {
    // Ya estaba seleccionado: mantener TODO el grupo seleccionado para moverlo o clonarlo junto.
    // Si el usuario suelta sin arrastrar, colapsamos a solo este clip (comportamiento DAW estándar).
    const totalSelected = storeBefore.selectedMidiClipIds.length + storeBefore.selectedClipIds.length;
    collapseSelectionOnClick = !isCloneDrag && totalSelected > 1;
  }

  const state = useSongStore.getState();
  const initialMidiClips = state.midiClips;
  const initialAudioClips = state.audioClips;
  const initialSelectedMidiIds = [...state.selectedMidiClipIds];
  const initialSelectedAudioIds = [...state.selectedClipIds];

  const selectedMidiSnaps: MidiPatternClip[] = initialMidiClips
    .filter((c) => initialSelectedMidiIds.includes(c.id))
    .map((c) => ({ ...c }));
  const selectedAudioSnaps: AudioClip[] = initialAudioClips
    .filter((c) => initialSelectedAudioIds.includes(c.id))
    .map((c) => ({ ...c }));

  const midiSnapMap = new Map(selectedMidiSnaps.map((c) => [c.id, c]));
  const audioSnapMap = new Map(selectedAudioSnaps.map((c) => [c.id, c]));

  const anchorClip =
    anchorKind === 'midi' ? midiSnapMap.get(anchorClipId) : audioSnapMap.get(anchorClipId);
  if (!anchorClip) return;

  const midiTracks = state.midiTracks || [];
  const audioTracks = state.audioTracks || [];
  const midiTrackIndexMap = new Map(midiTracks.map((t, idx) => [t.id, idx]));
  const audioTrackIndexMap = new Map(audioTracks.map((t, idx) => [t.id, idx]));

  const anchorTrackIdx =
    anchorKind === 'midi'
      ? (midiTrackIndexMap.get((anchorClip as MidiPatternClip).midiTrackId) ?? 0)
      : (audioTrackIndexMap.get((anchorClip as AudioClip).trackId) ?? 0);

  let minStartBeat = Infinity;
  for (const s of selectedMidiSnaps) {
    if (s.startBeat < minStartBeat) minStartBeat = s.startBeat;
  }
  for (const s of selectedAudioSnaps) {
    if (s.startBeat < minStartBeat) minStartBeat = s.startBeat;
  }
  if (!isFinite(minStartBeat)) minStartBeat = 0;

  let minMidiTrackIdx = Infinity;
  let maxMidiTrackIdx = -Infinity;
  for (const s of selectedMidiSnaps) {
    const idx = midiTrackIndexMap.get(s.midiTrackId) ?? 0;
    if (idx < minMidiTrackIdx) minMidiTrackIdx = idx;
    if (idx > maxMidiTrackIdx) maxMidiTrackIdx = idx;
  }

  let minAudioTrackIdx = Infinity;
  let maxAudioTrackIdx = -Infinity;
  for (const s of selectedAudioSnaps) {
    const idx = audioTrackIndexMap.get(s.trackId) ?? 0;
    if (idx < minAudioTrackIdx) minAudioTrackIdx = idx;
    if (idx > maxAudioTrackIdx) maxAudioTrackIdx = idx;
  }

  const el = e.currentTarget;
  const viewportEl = el.closest('.audio-timeline-viewport') as HTMLElement | null;
  const startX = e.clientX;
  const startY = e.clientY;
  const initialScrollLeft = viewportEl?.scrollLeft || 0;
  const initialScrollTop = viewportEl?.scrollTop || 0;

  // Pausar Zundo durante el arrastre para grabar una única entrada atómica al soltar
  useSongStore.temporal.getState().pause();

  let didMove = false;
  let clonedMidiIds: string[] = [];
  let clonedAudioIds: string[] = [];
  let latestMidiClips: MidiPatternClip[] | null = null;
  let latestAudioClips: AudioClip[] | null = null;
  let latestSelMidiIds = initialSelectedMidiIds;
  let latestSelAudioIds = initialSelectedAudioIds;

  const onPointerMove = (moveEvent: PointerEvent) => {
    const scrollDx = (viewportEl?.scrollLeft || 0) - initialScrollLeft;
    const scrollDy = (viewportEl?.scrollTop || 0) - initialScrollTop;
    const dx = (moveEvent.clientX - startX) + scrollDx;
    const dy = (moveEvent.clientY - startY) + scrollDy;

    if (!didMove && Math.abs(dx) < 3 && Math.abs(dy) < 6) {
      return;
    }

    if (!didMove) {
      didMove = true;
      if (isCloneDrag) {
        clonedMidiIds = selectedMidiSnaps.map(() => `mclip_${generateId()}`);
        clonedAudioIds = selectedAudioSnaps.map(() => `clip_${generateId()}`);
      }
    }

    // 1. Delta horizontal con Snap magnético compartido por todo el grupo
    const rawTargetStart = anchorClip.startBeat + dx / zoomLevel;
    const snappedTargetStart = moveEvent.altKey
      ? Math.max(0, rawTargetStart)
      : snapPlaylistBeat(rawTargetStart, snapGrid, beatsPerMeasure);
    const rawDeltaBeat = snappedTargetStart - anchorClip.startBeat;
    const safeDeltaBeat = Math.max(-minStartBeat, rawDeltaBeat);

    // 2. Delta vertical en pistas manteniendo la formación relativa del grupo
    let rawTrackDelta = Math.round(dy / TRACK_ROW_HEIGHT_PX);
    const elements = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);
    if (anchorKind === 'midi') {
      const laneEl = elements.find((node) => (node as HTMLElement).dataset?.midiTrackId) as HTMLElement | undefined;
      if (laneEl?.dataset?.midiTrackId && midiTrackIndexMap.has(laneEl.dataset.midiTrackId)) {
        rawTrackDelta = (midiTrackIndexMap.get(laneEl.dataset.midiTrackId) ?? anchorTrackIdx) - anchorTrackIdx;
      }
    } else {
      const laneEl = elements.find((node) => (node as HTMLElement).dataset?.trackId) as HTMLElement | undefined;
      if (laneEl?.dataset?.trackId && audioTrackIndexMap.has(laneEl.dataset.trackId)) {
        rawTrackDelta = (audioTrackIndexMap.get(laneEl.dataset.trackId) ?? anchorTrackIdx) - anchorTrackIdx;
      }
    }

    const safeMidiTrackDelta =
      anchorKind === 'midi' && selectedMidiSnaps.length > 0 && midiTracks.length > 0
        ? Math.max(-minMidiTrackIdx, Math.min(midiTracks.length - 1 - maxMidiTrackIdx, rawTrackDelta))
        : 0;

    const safeAudioTrackDelta =
      anchorKind === 'audio' && selectedAudioSnaps.length > 0 && audioTracks.length > 0
        ? Math.max(-minAudioTrackIdx, Math.min(audioTracks.length - 1 - maxAudioTrackIdx, rawTrackDelta))
        : 0;

    if (isCloneDrag) {
      const clonedMidis: MidiPatternClip[] = selectedMidiSnaps.map((s, idx) => {
        const nextIdx = (midiTrackIndexMap.get(s.midiTrackId) ?? 0) + safeMidiTrackDelta;
        return {
          ...s,
          id: clonedMidiIds[idx],
          startBeat: Math.max(0, s.startBeat + safeDeltaBeat),
          midiTrackId: midiTracks[nextIdx]?.id || s.midiTrackId
        };
      });

      const clonedAudios: AudioClip[] = selectedAudioSnaps.map((s, idx) => {
        const nextIdx = (audioTrackIndexMap.get(s.trackId) ?? 0) + safeAudioTrackDelta;
        return {
          ...s,
          id: clonedAudioIds[idx],
          startBeat: Math.max(0, s.startBeat + safeDeltaBeat),
          trackId: audioTracks[nextIdx]?.id || s.trackId
        };
      });

      latestMidiClips = clonedMidis.length > 0 ? [...initialMidiClips, ...clonedMidis] : initialMidiClips;
      latestAudioClips = clonedAudios.length > 0 ? [...initialAudioClips, ...clonedAudios] : initialAudioClips;
      latestSelMidiIds = clonedMidiIds;
      latestSelAudioIds = clonedAudioIds;

      useSongStore.setState({
        midiClips: latestMidiClips,
        audioClips: latestAudioClips,
        selectedMidiClipIds: latestSelMidiIds,
        selectedClipIds: latestSelAudioIds
      });
    } else {
      const nextMidiClips =
        selectedMidiSnaps.length > 0
          ? initialMidiClips.map((c) => {
              const snap = midiSnapMap.get(c.id);
              if (!snap) return c;
              const nextIdx = (midiTrackIndexMap.get(snap.midiTrackId) ?? 0) + safeMidiTrackDelta;
              return {
                ...c,
                startBeat: Math.max(0, snap.startBeat + safeDeltaBeat),
                midiTrackId: midiTracks[nextIdx]?.id || snap.midiTrackId
              };
            })
          : initialMidiClips;

      const nextAudioClips =
        selectedAudioSnaps.length > 0
          ? initialAudioClips.map((c) => {
              const snap = audioSnapMap.get(c.id);
              if (!snap) return c;
              const nextIdx = (audioTrackIndexMap.get(snap.trackId) ?? 0) + safeAudioTrackDelta;
              return {
                ...c,
                startBeat: Math.max(0, snap.startBeat + safeDeltaBeat),
                trackId: audioTracks[nextIdx]?.id || snap.trackId
              };
            })
          : initialAudioClips;

      latestMidiClips = nextMidiClips;
      latestAudioClips = nextAudioClips;
      latestSelMidiIds = initialSelectedMidiIds;
      latestSelAudioIds = initialSelectedAudioIds;

      useSongStore.setState({
        midiClips: nextMidiClips,
        audioClips: nextAudioClips
      });
    }
  };

  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    if (didMove && latestMidiClips && latestAudioClips) {
      // Restaurar el estado previo mientras Zundo sigue pausado para capturar una única transición atómica S0 -> Sfinal
      useSongStore.setState({
        midiClips: initialMidiClips,
        audioClips: initialAudioClips
      });
      useSongStore.temporal.getState().resume();
      useSongStore.setState({
        midiClips: latestMidiClips,
        audioClips: latestAudioClips,
        selectedMidiClipIds: latestSelMidiIds,
        selectedClipIds: latestSelAudioIds
      });
    } else {
      useSongStore.temporal.getState().resume();
      if (collapseSelectionOnClick) {
        useSongStore.setState({
          selectedMidiClipIds: anchorKind === 'midi' ? [anchorClipId] : [],
          selectedClipIds: anchorKind === 'audio' ? [anchorClipId] : []
        });
      }
    }
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}
