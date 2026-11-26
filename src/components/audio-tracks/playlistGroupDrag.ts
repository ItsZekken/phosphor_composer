/**
 * playlistGroupDrag.ts
 * Motor unificado de arrastre y clonado en grupo 1:1 para TODAS las capas de Phosphor en Tracks:
 * - Armonía (ChordBlock en `chordBlocks`)
 * - Melodías (MelodyRegion + notas reales en `tracks`)
 * - Batería (PatternChainItem lineal en `patternChain`)
 * - Audio (AudioClip en `audioClips`)
 *
 * Permite mover o clonar (Shift+Drag) secciones enteras sincronizadas a través de todas las pistas
 * con una única entrada atómica en el historial Zundo (un solo Ctrl+Z revierte todo el bloque).
 */

import type React from 'react';
import { useSongStore } from '../../store/songStore';
import {
  normalizePatternChainItems,
  type AudioClip,
  type AudioSnapGrid,
  type ChordBlock,
  type PatternChainItem,
  type PianoRollTrack,
  type SelectedMelodyRegionRef
} from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';
import {
  moveOrCloneMelodyRegions,
  reconcileTrackRegions,
  roundBeat
} from '../../core/audio/melodyRegionUtils';

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
  return Math.max(0, roundBeat(Math.round(beat / step) * step));
}

export type PlaylistDragAnchorKind = 'chord' | 'melody' | 'drum' | 'audio';

export interface StartPlaylistGroupDragParams {
  e: React.PointerEvent<HTMLDivElement>;
  anchorKind: PlaylistDragAnchorKind;
  anchorClipId: string;
  anchorTrackId?: string; // Requerido cuando anchorKind === 'melody'
  zoomLevel: number;
  beatsPerMeasure: number;
  snapGrid: AudioSnapGrid;
}

export function startPlaylistGroupDrag({
  e,
  anchorKind,
  anchorClipId,
  anchorTrackId,
  zoomLevel,
  beatsPerMeasure,
  snapGrid
}: StartPlaylistGroupDragParams): void {
  const storeBefore = useSongStore.getState();
  const isToggleMulti = e.ctrlKey || e.metaKey;
  const isCloneDrag = e.shiftKey && !isToggleMulti;

  const isSelectedBefore = (): boolean => {
    if (anchorKind === 'chord') return storeBefore.selectedChordIds.includes(anchorClipId);
    if (anchorKind === 'melody') {
      return storeBefore.selectedMelodyRegionRefs.some(
        (r) => r.trackId === anchorTrackId && r.regionId === anchorClipId
      );
    }
    if (anchorKind === 'drum') return storeBefore.selectedChainIds.includes(anchorClipId);
    return storeBefore.selectedClipIds.includes(anchorClipId);
  };

  const wasAlreadySelected = isSelectedBefore();
  let collapseSelectionOnClick = false;

  if (isToggleMulti) {
    if (anchorKind === 'chord') {
      const next = wasAlreadySelected
        ? storeBefore.selectedChordIds.filter((id) => id !== anchorClipId)
        : [...storeBefore.selectedChordIds, anchorClipId];
      useSongStore.setState({ selectedChordIds: next, selectedChordId: next[0] || null });
    } else if (anchorKind === 'melody' && anchorTrackId) {
      const next = wasAlreadySelected
        ? storeBefore.selectedMelodyRegionRefs.filter(
            (r) => !(r.trackId === anchorTrackId && r.regionId === anchorClipId)
          )
        : [...storeBefore.selectedMelodyRegionRefs, { trackId: anchorTrackId, regionId: anchorClipId }];
      useSongStore.setState({ selectedMelodyRegionRefs: next });
    } else if (anchorKind === 'drum') {
      const next = wasAlreadySelected
        ? storeBefore.selectedChainIds.filter((id) => id !== anchorClipId)
        : [...storeBefore.selectedChainIds, anchorClipId];
      useSongStore.setState({ selectedChainIds: next });
    } else {
      const next = wasAlreadySelected
        ? storeBefore.selectedClipIds.filter((id) => id !== anchorClipId)
        : [...storeBefore.selectedClipIds, anchorClipId];
      useSongStore.setState({ selectedClipIds: next });
    }

    if (wasAlreadySelected) {
      return;
    }
  } else if (!wasAlreadySelected) {
    useSongStore.setState({
      selectedChordIds: anchorKind === 'chord' ? [anchorClipId] : [],
      selectedChordId: anchorKind === 'chord' ? anchorClipId : null,
      selectedMelodyRegionRefs:
        anchorKind === 'melody' && anchorTrackId
          ? [{ trackId: anchorTrackId, regionId: anchorClipId }]
          : [],
      selectedChainIds: anchorKind === 'drum' ? [anchorClipId] : [],
      selectedClipIds: anchorKind === 'audio' ? [anchorClipId] : []
    });
  } else {
    const totalSelected =
      storeBefore.selectedChordIds.length +
      storeBefore.selectedMelodyRegionRefs.length +
      storeBefore.selectedChainIds.length +
      storeBefore.selectedClipIds.length;
    collapseSelectionOnClick = !isCloneDrag && totalSelected > 1;
  }

  const state = useSongStore.getState();

  // Instantáneas inmutables de las 4 fuentes canónicas
  const initialChords: ChordBlock[] = state.chordBlocks;
  const initialTracks: PianoRollTrack[] = state.tracks;
  const initialActiveTrackId = state.activeTrackId;
  const initialMelodyNotes = state.melodyNotes;
  const initialPatternChain: PatternChainItem[] = normalizePatternChainItems(state.patternChain);
  const initialAudioClips: AudioClip[] = state.audioClips;

  const initialSelChordIds = [...state.selectedChordIds];
  const initialSelMelodyRefs: SelectedMelodyRegionRef[] = [...state.selectedMelodyRegionRefs];
  const initialSelDrumIds = [...state.selectedChainIds];
  const initialSelAudioIds = [...state.selectedClipIds];

  const selectedChords = initialChords.filter((b) => initialSelChordIds.includes(b.id)).map((b) => ({ ...b }));
  const selectedDrums = initialPatternChain.filter((c) => initialSelDrumIds.includes(c.id)).map((c) => ({ ...c }));
  const selectedAudios = initialAudioClips.filter((c) => initialSelAudioIds.includes(c.id)).map((c) => ({ ...c }));

  const chordSnapMap = new Map(selectedChords.map((b) => [b.id, b]));
  const drumSnapMap = new Map(selectedDrums.map((c) => [c.id, c]));
  const audioSnapMap = new Map(selectedAudios.map((c) => [c.id, c]));

  // Resolver startBeat del ancla y límites mínimos para evitar coordenadas negativas
  let anchorStartBeat: number | null = null;
  let minStartBeat = Infinity;

  for (const c of selectedChords) {
    if (c.startBeat < minStartBeat) minStartBeat = c.startBeat;
    if (anchorKind === 'chord' && c.id === anchorClipId) anchorStartBeat = c.startBeat;
  }

  const melodyTrackIndexMap = new Map(initialTracks.map((t, idx) => [t.id, idx]));
  let minMelodyTrackIdx = Infinity;
  let maxMelodyTrackIdx = -Infinity;
  let anchorMelodyTrackIdx = 0;

  for (const ref of initialSelMelodyRefs) {
    const tIdx = melodyTrackIndexMap.get(ref.trackId);
    if (tIdx === undefined) continue;
    const track = initialTracks[tIdx];
    const regions = reconcileTrackRegions(track.id, track.notes, track.regions, beatsPerMeasure);
    const region = regions.find((r) => r.id === ref.regionId);
    if (!region) continue;
    if (region.startBeat < minStartBeat) minStartBeat = region.startBeat;
    if (tIdx < minMelodyTrackIdx) minMelodyTrackIdx = tIdx;
    if (tIdx > maxMelodyTrackIdx) maxMelodyTrackIdx = tIdx;
    if (anchorKind === 'melody' && ref.trackId === anchorTrackId && ref.regionId === anchorClipId) {
      anchorStartBeat = region.startBeat;
      anchorMelodyTrackIdx = tIdx;
    }
  }

  for (const d of selectedDrums) {
    const dStartBeat = (d.startMeasure ?? 0) * beatsPerMeasure;
    if (dStartBeat < minStartBeat) minStartBeat = dStartBeat;
    if (anchorKind === 'drum' && d.id === anchorClipId) anchorStartBeat = dStartBeat;
  }

  const audioTracks = state.audioTracks || [];
  const audioTrackIndexMap = new Map(audioTracks.map((t, idx) => [t.id, idx]));
  let minAudioTrackIdx = Infinity;
  let maxAudioTrackIdx = -Infinity;
  let anchorAudioTrackIdx = 0;

  for (const a of selectedAudios) {
    if (a.startBeat < minStartBeat) minStartBeat = a.startBeat;
    const idx = audioTrackIndexMap.get(a.trackId) ?? 0;
    if (idx < minAudioTrackIdx) minAudioTrackIdx = idx;
    if (idx > maxAudioTrackIdx) maxAudioTrackIdx = idx;
    if (anchorKind === 'audio' && a.id === anchorClipId) {
      anchorStartBeat = a.startBeat;
      anchorAudioTrackIdx = idx;
    }
  }

  if (anchorStartBeat === null) return;
  if (!isFinite(minStartBeat)) minStartBeat = 0;

  const el = e.currentTarget;
  const viewportEl = el.closest('.audio-timeline-viewport') as HTMLElement | null;
  const startX = e.clientX;
  const startY = e.clientY;
  const initialScrollLeft = viewportEl?.scrollLeft || 0;
  const initialScrollTop = viewportEl?.scrollTop || 0;

  // Pausar historial Zundo durante el arrastre para grabar una única entrada atómica al soltar
  useSongStore.temporal.getState().pause();

  let didMove = false;
  let clonedChordIds: string[] = [];
  let clonedDrumIds: string[] = [];
  let clonedAudioIds: string[] = [];
  let lastDeltaBeat = 0;
  let lastMelodyTrackDelta = 0;
  let lastAudioTrackDelta = 0;

  const computeNextState = (
    safeDeltaBeat: number,
    safeMelodyTrackDelta: number,
    safeAudioTrackDelta: number,
    isFinalCommit: boolean
  ) => {
    const deltaMeasures = safeDeltaBeat / beatsPerMeasure;

    // 1. Acordes (ChordBlocks)
    let nextChords = initialChords;
    let nextSelChordIds = initialSelChordIds;
    if (selectedChords.length > 0) {
      if (isCloneDrag) {
        const clones: ChordBlock[] = selectedChords.map((b, idx) => ({
          ...b,
          id: clonedChordIds[idx],
          startBeat: Math.max(0, roundBeat(b.startBeat + safeDeltaBeat))
        }));
        const newStarts = new Set(clones.map((c) => c.startBeat));
        nextChords = [
          ...initialChords.filter((b) => !newStarts.has(b.startBeat)),
          ...clones
        ].sort((a, b) => a.startBeat - b.startBeat);
        nextSelChordIds = clonedChordIds;
      } else {
        nextChords = initialChords
          .map((b) => {
            const snap = chordSnapMap.get(b.id);
            if (!snap) return b;
            return { ...b, startBeat: Math.max(0, roundBeat(snap.startBeat + safeDeltaBeat)) };
          })
          .sort((a, b) => a.startBeat - b.startBeat);
      }
    }

    // 2. Melodías (PianoRollTrack notes + regions 1:1)
    let nextTracks = initialTracks;
    let nextSelMelodyRefs = initialSelMelodyRefs;
    if (initialSelMelodyRefs.length > 0) {
      const moved = moveOrCloneMelodyRegions(
        initialTracks,
        initialSelMelodyRefs,
        safeDeltaBeat,
        safeMelodyTrackDelta,
        isCloneDrag,
        beatsPerMeasure,
        isFinalCommit
      );
      nextTracks = moved.tracks;
      nextSelMelodyRefs = moved.nextSelectedRefs;
    }

    // 3. Batería (PatternChainItem)
    let nextPatternChain = initialPatternChain;
    let nextSelDrumIds = initialSelDrumIds;
    if (selectedDrums.length > 0) {
      if (isCloneDrag) {
        const clones: PatternChainItem[] = selectedDrums.map((d, idx) => ({
          ...d,
          id: clonedDrumIds[idx],
          startMeasure: Math.max(0, roundBeat((d.startMeasure ?? 0) + deltaMeasures))
        }));
        nextPatternChain = [...initialPatternChain, ...clones].sort(
          (a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0)
        );
        nextSelDrumIds = clonedDrumIds;
      } else {
        nextPatternChain = initialPatternChain
          .map((d) => {
            const snap = drumSnapMap.get(d.id);
            if (!snap) return d;
            return {
              ...d,
              startMeasure: Math.max(0, roundBeat((snap.startMeasure ?? 0) + deltaMeasures))
            };
          })
          .sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0));
      }
    }

    // 4. Audio Clips
    let nextAudioClips = initialAudioClips;
    let nextSelAudioIds = initialSelAudioIds;
    if (selectedAudios.length > 0) {
      if (isCloneDrag) {
        const clones: AudioClip[] = selectedAudios.map((a, idx) => {
          const nextIdx = (audioTrackIndexMap.get(a.trackId) ?? 0) + safeAudioTrackDelta;
          return {
            ...a,
            id: clonedAudioIds[idx],
            startBeat: Math.max(0, roundBeat(a.startBeat + safeDeltaBeat)),
            trackId: audioTracks[nextIdx]?.id || a.trackId
          };
        });
        nextAudioClips = [...initialAudioClips, ...clones];
        nextSelAudioIds = clonedAudioIds;
      } else {
        nextAudioClips = initialAudioClips.map((a) => {
          const snap = audioSnapMap.get(a.id);
          if (!snap) return a;
          const nextIdx = (audioTrackIndexMap.get(snap.trackId) ?? 0) + safeAudioTrackDelta;
          return {
            ...a,
            startBeat: Math.max(0, roundBeat(snap.startBeat + safeDeltaBeat)),
            trackId: audioTracks[nextIdx]?.id || snap.trackId
          };
        });
      }
    }

    const activeTrack = nextTracks.find((t) => t.id === initialActiveTrackId) || nextTracks[0];
    return {
      chordBlocks: nextChords,
      tracks: nextTracks,
      melodyNotes: activeTrack ? activeTrack.notes : initialMelodyNotes,
      patternChain: nextPatternChain,
      audioClips: nextAudioClips,
      selectedChordIds: nextSelChordIds,
      selectedChordId: nextSelChordIds[0] || null,
      selectedMelodyRegionRefs: nextSelMelodyRefs,
      selectedChainIds: nextSelDrumIds,
      selectedClipIds: nextSelAudioIds,
      ...(selectedDrums.length > 0 ? { isPatternRepeatOn: false } : {})
    };
  };

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
        clonedChordIds = selectedChords.map(() => generateId('cb'));
        clonedDrumIds = selectedDrums.map(() => generateId('chain'));
        clonedAudioIds = selectedAudios.map(() => `clip_${generateId()}`);
      }
    }

    // 1. Delta horizontal compartido por todo el grupo
    const rawTargetStart = anchorStartBeat! + dx / zoomLevel;
    const snappedTargetStart = moveEvent.altKey
      ? Math.max(0, rawTargetStart)
      : snapPlaylistBeat(rawTargetStart, snapGrid, beatsPerMeasure);
    const rawDeltaBeat = roundBeat(snappedTargetStart - anchorStartBeat!);
    const safeDeltaBeat = roundBeat(Math.max(-minStartBeat, rawDeltaBeat));

    // 2. Delta vertical (solo dentro del mismo tipo: melodía -> melodía, audio -> audio)
    let rawTrackDelta = Math.round(dy / TRACK_ROW_HEIGHT_PX);
    const elements = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);

    if (anchorKind === 'melody') {
      const laneEl = elements.find((node) => (node as HTMLElement).dataset?.melodyTrackId) as HTMLElement | undefined;
      if (laneEl?.dataset?.melodyTrackId && melodyTrackIndexMap.has(laneEl.dataset.melodyTrackId)) {
        rawTrackDelta = (melodyTrackIndexMap.get(laneEl.dataset.melodyTrackId) ?? anchorMelodyTrackIdx) - anchorMelodyTrackIdx;
      }
    } else if (anchorKind === 'audio') {
      const laneEl = elements.find((node) => (node as HTMLElement).dataset?.trackId) as HTMLElement | undefined;
      if (laneEl?.dataset?.trackId && audioTrackIndexMap.has(laneEl.dataset.trackId)) {
        rawTrackDelta = (audioTrackIndexMap.get(laneEl.dataset.trackId) ?? anchorAudioTrackIdx) - anchorAudioTrackIdx;
      }
    }

    const safeMelodyTrackDelta =
      anchorKind === 'melody' && initialSelMelodyRefs.length > 0 && initialTracks.length > 0
        ? Math.max(-minMelodyTrackIdx, Math.min(initialTracks.length - 1 - maxMelodyTrackIdx, rawTrackDelta))
        : 0;

    const safeAudioTrackDelta =
      anchorKind === 'audio' && selectedAudios.length > 0 && audioTracks.length > 0
        ? Math.max(-minAudioTrackIdx, Math.min(audioTracks.length - 1 - maxAudioTrackIdx, rawTrackDelta))
        : 0;

    lastDeltaBeat = safeDeltaBeat;
    lastMelodyTrackDelta = safeMelodyTrackDelta;
    lastAudioTrackDelta = safeAudioTrackDelta;

    const previewPatch = computeNextState(
      safeDeltaBeat,
      safeMelodyTrackDelta,
      safeAudioTrackDelta,
      false
    );
    useSongStore.setState(previewPatch);
  };

  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    if (didMove) {
      // Restaurar el estado inicial con Zundo pausado, reanudar y aplicar el estado final en una sola transacción
      useSongStore.setState({
        chordBlocks: initialChords,
        tracks: initialTracks,
        melodyNotes: initialMelodyNotes,
        patternChain: initialPatternChain,
        audioClips: initialAudioClips
      });
      useSongStore.temporal.getState().resume();
      const finalPatch = computeNextState(
        lastDeltaBeat,
        lastMelodyTrackDelta,
        lastAudioTrackDelta,
        true
      );
      useSongStore.setState(finalPatch);
      if (useSongStore.getState().isAutoKey || useSongStore.getState().isAutoSuggestions) {
        useSongStore.getState().updateSuggestions();
      }
    } else {
      useSongStore.temporal.getState().resume();
      if (collapseSelectionOnClick) {
        useSongStore.setState({
          selectedChordIds: anchorKind === 'chord' ? [anchorClipId] : [],
          selectedChordId: anchorKind === 'chord' ? anchorClipId : null,
          selectedMelodyRegionRefs:
            anchorKind === 'melody' && anchorTrackId
              ? [{ trackId: anchorTrackId, regionId: anchorClipId }]
              : [],
          selectedChainIds: anchorKind === 'drum' ? [anchorClipId] : [],
          selectedClipIds: anchorKind === 'audio' ? [anchorClipId] : []
        });
      }
    }
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}
