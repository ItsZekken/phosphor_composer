/**
 * AudioTracksView.tsx
 * Estación unificada de TRACKS 1:1 en Phosphor:
 * - ARMONÍA (1:1 con Chord Palette -> `chordBlocks` y `channels.chords`)
 * - PIANO ROLL (1:1 por cada canal de instrumento -> `tracks[].notes` + `regions`)
 * - BATERÍA (1:1 con Drum Sequencer -> `patternChain` y `channels.drums`)
 * - AUDIO MULTITRACK (`audioTracks` y `audioClips`)
 *
 * Todas las ediciones en Tracks (pintar, mover, recortar, estirar/repetir, dividir,
 * copiar/pegar, duplicar, silenciar, borrar, selección Lasso y atajos de teclado)
 * mutan directamente las fuentes únicas de verdad con historial Zundo atómico.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import './audioTracks.css';
import { Upload, Mic, Plus } from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { toneEngine } from '../../audio/toneEngine';
import { AudioTracksToolbar } from './AudioTracksToolbar';
import { AudioTimelineRuler } from './AudioTimelineRuler';
import { AudioPlayhead } from './AudioPlayhead';
import { AudioTrackHeader, AudioTrackLane } from './AudioTrackLane';
import { HarmonyTrackHeader, HarmonyTrackLane } from './HarmonyTrackLane';
import { MelodyTrackHeader, MelodyTrackLane } from './MelodyTrackLane';
import { DrumTrackHeader, DrumTrackLane } from './DrumTrackLane';
import { PatternPickerSidebar } from './PatternPickerSidebar';
import { AudioLatencyModal } from './AudioLatencyModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useTimelineNavigation } from '../../hooks/useTimelineNavigation';
import { isTypingTarget, isModalBlockingShortcuts } from '../../core/shortcuts/isTypingTarget';
import { importAudioFilesToTracks, isSupportedAudioFile } from '../../core/session/projectFileImport';
import { getBeatsPerMeasure } from '../../core/audio/arrangementResolver';
import {
  deleteMelodyRegions,
  duplicateMelodyRegions,
  extractMelodyRegionClipboard,
  moveOrCloneMelodyRegions,
  pasteMelodyRegions,
  reconcileTrackRegions,
  roundBeat,
  toggleMuteMelodyRegions
} from '../../core/audio/melodyRegionUtils';
import {
  MAX_DRUM_LANES,
  getEffectiveDrumLaneCount,
  normalizePatternChainItems,
  normalizePatternChainToLinear,
  type AudioClip,
  type ChordBlock,
  type PatternChainItem,
  type SelectedMelodyRegionRef
} from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';

interface MarqueeRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const AudioTracksView: React.FC = () => {
  const {
    chordBlocks,
    tracks,
    patternChain,
    drumLaneCount,
    audioTracks,
    audioClips,
    bpm,
    timeSignature,
    recordingRms,
    audioTimelineViewport,
    playlistTool,
    addPianoRollTrack,
    removePianoRollTrack,
    addDrumLane,
    removeDrumLane,
    addAudioTrack,
    splitChordBlock,
    splitMelodyRegion,
    splitChainItem,
    splitAudioClip,
    clearAllPlaylistSelections,
    setAudioTimelineViewport,
    startAudioRecording,
    setPlaylistTool
  } = useSongStore(
    useShallow((state) => ({
      chordBlocks: state.chordBlocks || [],
      tracks: state.tracks || [],
      patternChain: state.patternChain || [],
      drumLaneCount: state.drumLaneCount || 1,
      audioTracks: state.audioTracks || [],
      audioClips: state.audioClips || [],
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      recordingRms: state.recordingRms,
      audioTimelineViewport: state.audioTimelineViewport,
      playlistTool: state.playlistTool,
      addPianoRollTrack: state.addPianoRollTrack,
      removePianoRollTrack: state.removePianoRollTrack,
      addDrumLane: state.addDrumLane,
      removeDrumLane: state.removeDrumLane,
      addAudioTrack: state.addAudioTrack,
      splitChordBlock: state.splitChordBlock,
      splitMelodyRegion: state.splitMelodyRegion,
      splitChainItem: state.splitChainItem,
      splitAudioClip: state.splitAudioClip,
      clearAllPlaylistSelections: state.clearAllPlaylistSelections,
      setAudioTimelineViewport: state.setAudioTimelineViewport,
      startAudioRecording: state.startAudioRecording,
      setPlaylistTool: state.setPlaylistTool
    }))
  );

  const effectiveDrumLaneCount = useMemo(
    () => getEffectiveDrumLaneCount(patternChain, drumLaneCount),
    [patternChain, drumLaneCount]
  );

  const headersListRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const lanesContainerRef = useRef<HTMLDivElement | null>(null);
  const emptyFileInputRef = useRef<HTMLInputElement | null>(null);
  const isSyncingScrollRef = useRef(false);
  const suppressNextBgClickRef = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [trackPendingDelete, setTrackPendingDelete] = useState<{ id: string; name: string } | null>(
    null
  );
  const [drumLanePendingDelete, setDrumLanePendingDelete] = useState<{
    laneIndex: number;
    clipCount: number;
  } | null>(null);

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);

  // Calcular longitud total de la línea de tiempo abarcando las 4 capas 1:1
  const maxContentEndBeat = useMemo(() => {
    let maxEnd = 32;
    for (const cb of chordBlocks) {
      const end = cb.startBeat + cb.durationBeats;
      if (end > maxEnd) maxEnd = end;
    }
    for (const t of tracks) {
      for (const n of t.notes || []) {
        const end = n.startBeat + n.durationBeats;
        if (end > maxEnd) maxEnd = end;
      }
      for (const r of t.regions || []) {
        const end = r.startBeat + r.durationBeats;
        if (end > maxEnd) maxEnd = end;
      }
    }
    for (const d of normalizePatternChainToLinear(patternChain)) {
      const end = (d.startMeasure + d.durationMeasures) * beatsPerMeasure;
      if (end > maxEnd) maxEnd = end;
    }
    for (const clip of audioClips) {
      const end = clip.startBeat + clip.durationSeconds * (bpm / 60);
      if (end > maxEnd) maxEnd = end;
    }
    return maxEnd;
  }, [chordBlocks, tracks, patternChain, audioClips, bpm, beatsPerMeasure]);

  const totalBeats = Math.max(
    64,
    Math.ceil((maxContentEndBeat + 16) / beatsPerMeasure) * beatsPerMeasure
  );
  const zoomLevel = audioTimelineViewport.zoomLevel || 60;
  const totalTimelineWidth = totalBeats * zoomLevel;

  const isTimelineCompletelyEmpty = useMemo(
    () =>
      chordBlocks.length === 0 &&
      tracks.every((t) => !t.notes || t.notes.length === 0) &&
      patternChain.length === 0 &&
      audioClips.length === 0,
    [chordBlocks, tracks, patternChain, audioClips]
  );

  // 1. Sincronización bidireccional del scroll vertical entre Cabeceras y Carriles
  const handleTimelineScroll = useCallback(() => {
    if (isSyncingScrollRef.current) return;
    if (!timelineViewportRef.current || !headersListRef.current) return;

    isSyncingScrollRef.current = true;
    headersListRef.current.scrollTop = timelineViewportRef.current.scrollTop;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  }, []);

  const handleHeadersScroll = useCallback(() => {
    if (isSyncingScrollRef.current) return;
    if (!timelineViewportRef.current || !headersListRef.current) return;

    isSyncingScrollRef.current = true;
    timelineViewportRef.current.scrollTop = headersListRef.current.scrollTop;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  }, []);

  // 2. Atajos de teclado unificados 1:1 para todas las capas (Armonía, Piano Roll, Batería, Audio)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useSongStore.getState();
      if (state.activeView !== 'audio-tracks' || isModalBlockingShortcuts(state)) {
        return;
      }
      if (isTypingTarget(e.target)) {
        return;
      }

      const keyLower = e.key.toLowerCase();
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const barBeats = getBeatsPerMeasure(state.timeSignature);
      const hasChordSel = state.selectedChordIds.length > 0;
      const hasMelodySel = state.selectedMelodyRegionRefs.length > 0;
      const hasDrumSel = state.selectedChainIds.length > 0;
      const hasAudioSel = state.selectedClipIds.length > 0;
      const hasAnySel = hasChordSel || hasMelodySel || hasDrumSel || hasAudioSel;

      // Herramientas rápidas (P = Pincel, C = Navaja, E = Seleccionar)
      if (!isCtrlOrCmd && !e.altKey && !e.shiftKey) {
        if (keyLower === 'p') {
          e.preventDefault();
          setPlaylistTool('paint');
          return;
        }
        if (keyLower === 'c') {
          e.preventDefault();
          setPlaylistTool(state.playlistTool === 'slice' ? 'paint' : 'slice');
          return;
        }
        if (keyLower === 'e') {
          e.preventDefault();
          setPlaylistTool(state.playlistTool === 'select' ? 'paint' : 'select');
          return;
        }
      }

      // Tecla S: Dividir bloques/regiones/clips seleccionados (o bajo el cabezal) en currentBeat
      if (keyLower === 's' && !isCtrlOrCmd && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const curBeat = state.currentBeat;
        const curMeasure = curBeat / barBeats;
        const linearDrums = normalizePatternChainToLinear(state.patternChain);

        if (hasAnySel) {
          state.selectedChordIds.forEach((id) => {
            const b = state.chordBlocks.find((c) => c.id === id);
            if (b && curBeat > b.startBeat + 0.06 && curBeat < b.startBeat + b.durationBeats - 0.06) {
              splitChordBlock(id, curBeat);
            }
          });
          state.selectedMelodyRegionRefs.forEach((ref) => {
            const tr = state.tracks.find((t) => t.id === ref.trackId);
            if (!tr) return;
            const reg = reconcileTrackRegions(tr.id, tr.notes, tr.regions, barBeats).find(
              (r) => r.id === ref.regionId
            );
            if (reg && curBeat > reg.startBeat + 0.06 && curBeat < reg.startBeat + reg.durationBeats - 0.06) {
              splitMelodyRegion(ref.trackId, ref.regionId, curBeat);
            }
          });
          state.selectedChainIds.forEach((id) => {
            const d = linearDrums.find((c) => c.id === id);
            if (d && curMeasure > d.startMeasure + 0.05 && curMeasure < d.startMeasure + d.durationMeasures - 0.05) {
              splitChainItem(id, curMeasure);
            }
          });
          state.selectedClipIds.forEach((id) => {
            const c = state.audioClips.find((a) => a.id === id);
            if (
              c &&
              curBeat > c.startBeat + 0.06 &&
              curBeat < c.startBeat + (c.durationSeconds * state.bpm) / 60 - 0.06
            ) {
              splitAudioClip(id, curBeat);
            }
          });
        } else if (state.selectedPlaylistTrack.kind === 'harmony') {
          const b = state.chordBlocks.find(
            (c) => curBeat > c.startBeat + 0.06 && curBeat < c.startBeat + c.durationBeats - 0.06
          );
          if (b) splitChordBlock(b.id, curBeat);
        } else if (state.selectedPlaylistTrack.kind === 'melody') {
          const melodyTrackId = state.selectedPlaylistTrack.trackId;
          const tr = state.tracks.find((t) => t.id === melodyTrackId);
          if (tr) {
            const reg = reconcileTrackRegions(tr.id, tr.notes, tr.regions, barBeats).find(
              (r) => curBeat > r.startBeat + 0.06 && curBeat < r.startBeat + r.durationBeats - 0.06
            );
            if (reg) splitMelodyRegion(tr.id, reg.id, curBeat);
          }
        } else if (state.selectedPlaylistTrack.kind === 'drums') {
          const laneIdx = state.selectedPlaylistTrack.laneIndex ?? 0;
          const d = linearDrums.find(
            (c) =>
              c.laneIndex === laneIdx &&
              curMeasure > c.startMeasure + 0.05 &&
              curMeasure < c.startMeasure + c.durationMeasures - 0.05
          );
          if (d) splitChainItem(d.id, curMeasure);
        } else {
          const audioTrackId = state.selectedPlaylistTrack.trackId || state.selectedTrackId;
          const c = state.audioClips.find(
            (a) =>
              a.trackId === audioTrackId &&
              curBeat > a.startBeat + 0.06 &&
              curBeat < a.startBeat + (a.durationSeconds * state.bpm) / 60 - 0.06
          );
          if (c) splitAudioClip(c.id, curBeat);
        }
        return;
      }

      // Helper de borrado atómico en las 4 capas (compartido por Supr/Backspace y Ctrl+X)
      const deleteAllSelectedAtomic = () => {
        const chordSet = new Set(state.selectedChordIds);
        const drumSet = new Set(state.selectedChainIds);
        const audioSet = new Set(state.selectedClipIds);

        const nextChordBlocks = hasChordSel
          ? state.chordBlocks.filter((b) => !chordSet.has(b.id))
          : state.chordBlocks;
        const nextTracks = hasMelodySel
          ? deleteMelodyRegions(state.tracks, state.selectedMelodyRegionRefs, barBeats)
          : state.tracks;
        const nextActiveTrack = nextTracks.find((t) => t.id === state.activeTrackId);
        const nextPatternChain = hasDrumSel
          ? normalizePatternChainItems(state.patternChain).filter((c) => !drumSet.has(c.id))
          : state.patternChain;
        const nextAudioClips = hasAudioSel
          ? state.audioClips.filter((c) => !audioSet.has(c.id))
          : state.audioClips;

        useSongStore.setState({
          chordBlocks: nextChordBlocks,
          tracks: nextTracks,
          melodyNotes: nextActiveTrack ? nextActiveTrack.notes : state.melodyNotes,
          patternChain: nextPatternChain,
          audioClips: nextAudioClips,
          selectedChordIds: [],
          selectedChordId: null,
          selectedMelodyRegionRefs: [],
          selectedChainIds: [],
          selectedClipIds: []
        });
        if (state.isAutoSuggestions) useSongStore.getState().updateSuggestions();
      };

      // Teclas Supr / Backspace: Eliminar selección en todas las capas (1 paso Undo)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (hasAnySel) {
          e.preventDefault();
          deleteAllSelectedAtomic();
        }
        return;
      }

      // Ctrl+A: Seleccionar todo en las 4 capas
      if (isCtrlOrCmd && keyLower === 'a') {
        e.preventDefault();
        const allChordIds = state.chordBlocks.map((b) => b.id);
        const allMelodyRefs: SelectedMelodyRegionRef[] = [];
        for (const tr of state.tracks) {
          for (const reg of reconcileTrackRegions(tr.id, tr.notes, tr.regions, barBeats)) {
            allMelodyRefs.push({ trackId: tr.id, regionId: reg.id });
          }
        }
        const allDrumIds = normalizePatternChainToLinear(state.patternChain).map((c) => c.id);
        const allAudioIds = state.audioClips.map((c) => c.id);

        useSongStore.setState({
          selectedChordIds: allChordIds,
          selectedChordId: allChordIds.length === 1 ? allChordIds[0] : null,
          selectedMelodyRegionRefs: allMelodyRefs,
          selectedChainIds: allDrumIds,
          selectedClipIds: allAudioIds
        });
        return;
      }

      // Ctrl+C / Ctrl+X: Copiar o Cortar todas las capas seleccionadas juntas
      if (isCtrlOrCmd && (keyLower === 'c' || keyLower === 'x') && hasAnySel) {
        e.preventDefault();
        const chordClip = hasChordSel
          ? state.chordBlocks
              .filter((b) => state.selectedChordIds.includes(b.id))
              .sort((a, b) => a.startBeat - b.startBeat)
              .map((b) => ({ ...b }))
          : [];
        const melodyClip = hasMelodySel
          ? extractMelodyRegionClipboard(state.tracks, state.selectedMelodyRegionRefs, barBeats)
          : [];
        const drumClip = hasDrumSel
          ? normalizePatternChainItems(state.patternChain)
              .filter((c) => state.selectedChainIds.includes(c.id))
              .sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0))
              .map((c) => ({ ...c }))
          : [];
        const audioClip = hasAudioSel
          ? state.audioClips
              .filter((c) => state.selectedClipIds.includes(c.id))
              .sort((a, b) => a.startBeat - b.startBeat)
              .map((c) => ({ ...c }))
          : [];

        useSongStore.setState({
          chordClipboard: chordClip,
          melodyRegionClipboard: melodyClip,
          chainClipboard: drumClip,
          audioClipClipboard: audioClip
        });

        if (keyLower === 'x') {
          deleteAllSelectedAtomic();
        }
        return;
      }

      // Ctrl+V: Pegar todas las capas copiadas en el cabezal conservando alineación relativa (1 paso Undo)
      if (isCtrlOrCmd && keyLower === 'v') {
        const hasChordCb = state.chordClipboard.length > 0;
        const hasMelodyCb = state.melodyRegionClipboard.length > 0;
        const hasDrumCb = state.chainClipboard.length > 0;
        const hasAudioCb = state.audioClipClipboard.length > 0;

        if (hasChordCb || hasMelodyCb || hasDrumCb || hasAudioCb) {
          e.preventDefault();
          const targetBeat = Math.max(0, roundBeat(state.currentBeat || 0));

          const chordOrigin = hasChordCb
            ? Math.min(...state.chordClipboard.map((b) => b.startBeat))
            : Infinity;
          const melodyOrigin = hasMelodyCb
            ? Math.min(
                ...state.melodyRegionClipboard.map(
                  (m) => m.originalStartBeat ?? m.relativeStartBeat
                )
              )
            : Infinity;
          const drumCbLinear = hasDrumCb ? normalizePatternChainToLinear(state.chainClipboard) : [];
          const drumOrigin = hasDrumCb
            ? Math.min(...drumCbLinear.map((d) => d.startMeasure * barBeats))
            : Infinity;
          const audioOrigin = hasAudioCb
            ? Math.min(...state.audioClipClipboard.map((a) => a.startBeat))
            : Infinity;

          const globalOrigin = Math.min(chordOrigin, melodyOrigin, drumOrigin, audioOrigin);

          // 1. Pegar acordes
          let nextChordBlocks = state.chordBlocks;
          const pastedChordIds: string[] = [];
          if (hasChordCb) {
            const addedChords: ChordBlock[] = state.chordClipboard.map((b) => {
              const id = generateId();
              pastedChordIds.push(id);
              return {
                ...b,
                id,
                startBeat: Math.max(0, roundBeat(targetBeat + (b.startBeat - globalOrigin)))
              };
            });
            nextChordBlocks = [...state.chordBlocks, ...addedChords].sort(
              (a, b) => a.startBeat - b.startBeat
            );
          }

          // 2. Pegar regiones melódicas (materializa notas reales 1:1 en tracks)
          let nextTracks = state.tracks;
          let pastedMelodyRefs: SelectedMelodyRegionRef[] = [];
          if (hasMelodyCb) {
            const melodyBaseBeat = Math.max(
              0,
              roundBeat(targetBeat + (melodyOrigin - globalOrigin))
            );
            const fallbackTrackId =
              state.selectedPlaylistTrack.kind === 'melody'
                ? state.selectedPlaylistTrack.trackId
                : state.activeTrackId;
            const res = pasteMelodyRegions(
              state.tracks,
              state.melodyRegionClipboard,
              melodyBaseBeat,
              fallbackTrackId,
              barBeats
            );
            nextTracks = res.tracks;
            pastedMelodyRefs = res.nextSelectedRefs;
          }

          // 3. Pegar clips de batería
          let nextPatternChain = state.patternChain;
          const pastedDrumIds: string[] = [];
          if (hasDrumCb) {
            const baseChain = normalizePatternChainItems(state.patternChain);
            const addedDrums: PatternChainItem[] = drumCbLinear.map((d) => {
              const id = `chain-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              pastedDrumIds.push(id);
              const nextStartBeat = Math.max(
                0,
                roundBeat(targetBeat + (d.startMeasure * barBeats - globalOrigin))
              );
              const nextStartMeasure = Math.round((nextStartBeat / barBeats) * 16) / 16;
              return {
                id,
                type: 'pattern',
                patternIndex: d.patternIndex,
                startMeasure: nextStartMeasure,
                durationMeasures: d.durationMeasures,
                repeatCount: Math.max(1, Math.round(d.durationMeasures)),
                ...(d.laneIndex > 0 ? { laneIndex: d.laneIndex } : {}),
                ...(d.isMuted ? { isMuted: true } : {})
              };
            });
            nextPatternChain = [...baseChain, ...addedDrums].sort(
              (a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0)
            );
          }

          // 4. Pegar clips de audio
          let nextAudioClips = state.audioClips;
          const pastedAudioIds: string[] = [];
          if (hasAudioCb) {
            const validTrackIds = new Set(state.audioTracks.map((t) => t.id));
            const fallbackAudioTrack =
              state.selectedPlaylistTrack.kind === 'audio'
                ? state.selectedPlaylistTrack.trackId
                : state.selectedTrackId || state.audioTracks[0]?.id;

            const addedAudio: AudioClip[] = state.audioClipClipboard
              .filter((a) => validTrackIds.has(a.trackId) || Boolean(fallbackAudioTrack))
              .map((a) => {
                const id = `clip_${generateId()}`;
                pastedAudioIds.push(id);
                return {
                  ...a,
                  id,
                  trackId: validTrackIds.has(a.trackId)
                    ? a.trackId
                    : (fallbackAudioTrack as string),
                  startBeat: Math.max(0, roundBeat(targetBeat + (a.startBeat - globalOrigin)))
                };
              });
            nextAudioClips = [...state.audioClips, ...addedAudio];
          }

          const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);
          useSongStore.setState({
            chordBlocks: nextChordBlocks,
            tracks: nextTracks,
            melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
            patternChain: nextPatternChain,
            audioClips: nextAudioClips,
            selectedChordIds: pastedChordIds,
            selectedChordId: pastedChordIds.length === 1 ? pastedChordIds[0] : null,
            selectedMelodyRegionRefs: pastedMelodyRefs,
            selectedChainIds: pastedDrumIds,
            selectedClipIds: pastedAudioIds
          });
          if (state.isAutoSuggestions) useSongStore.getState().updateSuggestions();
        }
        return;
      }

      // Ctrl+D: Duplicar selección combinada a continuación (1 paso Undo)
      if (isCtrlOrCmd && keyLower === 'd' && hasAnySel) {
        e.preventDefault();
        let minStart = Infinity;
        let maxEnd = 0;

        const selChords = state.chordBlocks.filter((b) => state.selectedChordIds.includes(b.id));
        selChords.forEach((b) => {
          minStart = Math.min(minStart, b.startBeat);
          maxEnd = Math.max(maxEnd, b.startBeat + b.durationBeats);
        });

        state.selectedMelodyRegionRefs.forEach((ref) => {
          const tr = state.tracks.find((t) => t.id === ref.trackId);
          if (!tr) return;
          const reg = reconcileTrackRegions(tr.id, tr.notes, tr.regions, barBeats).find(
            (r) => r.id === ref.regionId
          );
          if (reg) {
            minStart = Math.min(minStart, reg.startBeat);
            maxEnd = Math.max(maxEnd, reg.startBeat + reg.durationBeats);
          }
        });

        const linearDrums = normalizePatternChainToLinear(state.patternChain);
        const selDrums = linearDrums.filter((d) => state.selectedChainIds.includes(d.id));
        selDrums.forEach((d) => {
          minStart = Math.min(minStart, d.startMeasure * barBeats);
          maxEnd = Math.max(maxEnd, (d.startMeasure + d.durationMeasures) * barBeats);
        });

        const selAudio = state.audioClips.filter((c) => state.selectedClipIds.includes(c.id));
        selAudio.forEach((c) => {
          minStart = Math.min(minStart, c.startBeat);
          maxEnd = Math.max(maxEnd, c.startBeat + (c.durationSeconds * state.bpm) / 60);
        });

        if (!Number.isFinite(minStart)) return;
        const spanBeats = Math.max(0.25, roundBeat(maxEnd - minStart));

        // 1. Duplicar acordes
        let nextChordBlocks = state.chordBlocks;
        const dupChordIds: string[] = [];
        if (selChords.length > 0) {
          const clones: ChordBlock[] = selChords.map((b) => {
            const id = generateId();
            dupChordIds.push(id);
            return { ...b, id, startBeat: roundBeat(b.startBeat + spanBeats) };
          });
          nextChordBlocks = [...state.chordBlocks, ...clones].sort(
            (a, b) => a.startBeat - b.startBeat
          );
        }

        // 2. Duplicar regiones de Piano Roll
        let nextTracks = state.tracks;
        let dupMelodyRefs: SelectedMelodyRegionRef[] = [];
        if (hasMelodySel) {
          const res = duplicateMelodyRegions(
            state.tracks,
            state.selectedMelodyRegionRefs,
            barBeats,
            spanBeats
          );
          nextTracks = res.tracks;
          dupMelodyRefs = res.nextSelectedRefs;
        }

        // 3. Duplicar clips de batería
        let nextPatternChain = state.patternChain;
        const dupDrumIds: string[] = [];
        if (selDrums.length > 0) {
          const baseChain = normalizePatternChainItems(state.patternChain);
          const spanMeasures = spanBeats / barBeats;
          const clones: PatternChainItem[] = selDrums.map((d) => {
            const id = `chain-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            dupDrumIds.push(id);
            return {
              id,
              type: 'pattern',
              patternIndex: d.patternIndex,
              startMeasure: Math.round((d.startMeasure + spanMeasures) * 16) / 16,
              durationMeasures: d.durationMeasures,
              repeatCount: Math.max(1, Math.round(d.durationMeasures)),
              ...(d.laneIndex > 0 ? { laneIndex: d.laneIndex } : {}),
              ...(d.isMuted ? { isMuted: true } : {})
            };
          });
          nextPatternChain = [...baseChain, ...clones].sort(
            (a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0)
          );
        }

        // 4. Duplicar clips de audio
        let nextAudioClips = state.audioClips;
        const dupAudioIds: string[] = [];
        if (selAudio.length > 0) {
          const clones: AudioClip[] = selAudio.map((c) => {
            const id = `clip_${generateId()}`;
            dupAudioIds.push(id);
            return { ...c, id, startBeat: roundBeat(c.startBeat + spanBeats) };
          });
          nextAudioClips = [...state.audioClips, ...clones];
        }

        const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);
        useSongStore.setState({
          chordBlocks: nextChordBlocks,
          tracks: nextTracks,
          melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
          patternChain: nextPatternChain,
          audioClips: nextAudioClips,
          selectedChordIds: dupChordIds,
          selectedChordId: dupChordIds.length === 1 ? dupChordIds[0] : null,
          selectedMelodyRegionRefs: dupMelodyRefs,
          selectedChainIds: dupDrumIds,
          selectedClipIds: dupAudioIds
        });
        if (state.isAutoSuggestions) useSongStore.getState().updateSuggestions();
        return;
      }

      // M: Silenciar / reactivar bloques/regiones/clips seleccionados en todas las capas (1 paso Undo)
      if (keyLower === 'm' && !isCtrlOrCmd && !e.altKey && !e.shiftKey && hasAnySel) {
        e.preventDefault();
        const chordSet = new Set(state.selectedChordIds);
        const drumSet = new Set(state.selectedChainIds);
        const audioSet = new Set(state.selectedClipIds);

        let nextChordBlocks = state.chordBlocks;
        if (hasChordSel) {
          const sel = state.chordBlocks.filter((b) => chordSet.has(b.id));
          const anyActive = sel.some((b) => b.type !== 'silence' && b.type !== 'break');
          nextChordBlocks = state.chordBlocks.map((b) =>
            chordSet.has(b.id) ? { ...b, type: anyActive ? 'silence' : 'play' } : b
          );
        }

        const nextTracks = hasMelodySel
          ? toggleMuteMelodyRegions(state.tracks, state.selectedMelodyRegionRefs, barBeats)
          : state.tracks;

        let nextPatternChain = state.patternChain;
        if (hasDrumSel) {
          const normalized = normalizePatternChainItems(state.patternChain);
          const sel = normalized.filter((c) => drumSet.has(c.id));
          const anyActive = sel.some((c) => !c.isMuted);
          nextPatternChain = normalized.map((c) =>
            drumSet.has(c.id) ? { ...c, isMuted: anyActive } : c
          );
        }

        let nextAudioClips = state.audioClips;
        if (hasAudioSel) {
          const sel = state.audioClips.filter((c) => audioSet.has(c.id));
          const anyActive = sel.some((c) => !c.isMuted);
          nextAudioClips = state.audioClips.map((c) =>
            audioSet.has(c.id) ? { ...c, isMuted: anyActive } : c
          );
        }

        const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);
        useSongStore.setState({
          chordBlocks: nextChordBlocks,
          tracks: nextTracks,
          melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
          patternChain: nextPatternChain,
          audioClips: nextAudioClips
        });
        return;
      }

      // Flechas Izquierda / Derecha: Desplazar toda la selección por el snap activo (1 paso Undo)
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isCtrlOrCmd && hasAnySel) {
        e.preventDefault();
        const snapStep = e.altKey
          ? 0.25
          : state.audioSnapGrid === 'bar'
          ? barBeats
          : state.audioSnapGrid === '1/2'
          ? 0.5
          : state.audioSnapGrid === '1/4'
          ? 0.25
          : state.audioSnapGrid === '1/8'
          ? 0.125
          : state.audioSnapGrid === '1/16'
          ? 0.0625
          : 1;
        const rawDelta = (e.key === 'ArrowRight' ? 1 : -1) * snapStep;

        let minStart = Infinity;
        state.chordBlocks
          .filter((b) => state.selectedChordIds.includes(b.id))
          .forEach((b) => {
            minStart = Math.min(minStart, b.startBeat);
          });
        state.selectedMelodyRegionRefs.forEach((ref) => {
          const tr = state.tracks.find((t) => t.id === ref.trackId);
          if (!tr) return;
          const reg = reconcileTrackRegions(tr.id, tr.notes, tr.regions, barBeats).find(
            (r) => r.id === ref.regionId
          );
          if (reg) minStart = Math.min(minStart, reg.startBeat);
        });
        const linearDrums = normalizePatternChainToLinear(state.patternChain);
        linearDrums
          .filter((d) => state.selectedChainIds.includes(d.id))
          .forEach((d) => {
            minStart = Math.min(minStart, d.startMeasure * barBeats);
          });
        state.audioClips
          .filter((c) => state.selectedClipIds.includes(c.id))
          .forEach((c) => {
            minStart = Math.min(minStart, c.startBeat);
          });

        if (!Number.isFinite(minStart)) return;
        const safeDelta = roundBeat(Math.max(-minStart, rawDelta));
        if (Math.abs(safeDelta) < 0.0001) return;

        const chordSet = new Set(state.selectedChordIds);
        const drumSet = new Set(state.selectedChainIds);
        const audioSet = new Set(state.selectedClipIds);

        const nextChordBlocks = hasChordSel
          ? state.chordBlocks
              .map((b) =>
                chordSet.has(b.id)
                  ? { ...b, startBeat: Math.max(0, roundBeat(b.startBeat + safeDelta)) }
                  : b
              )
              .sort((a, b) => a.startBeat - b.startBeat)
          : state.chordBlocks;

        let nextTracks = state.tracks;
        let nextMelodyRefs = state.selectedMelodyRegionRefs;
        if (hasMelodySel) {
          const res = moveOrCloneMelodyRegions(
            state.tracks,
            state.selectedMelodyRegionRefs,
            safeDelta,
            0,
            false,
            barBeats
          );
          nextTracks = res.tracks;
          nextMelodyRefs = res.nextSelectedRefs;
        }

        const nextPatternChain = hasDrumSel
          ? normalizePatternChainItems(state.patternChain)
              .map((c) =>
                drumSet.has(c.id)
                  ? {
                      ...c,
                      startMeasure: Math.max(
                        0,
                        Math.round(((c.startMeasure ?? 0) + safeDelta / barBeats) * 16) / 16
                      )
                    }
                  : c
              )
              .sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0))
          : state.patternChain;

        const nextAudioClips = hasAudioSel
          ? state.audioClips.map((c) =>
              audioSet.has(c.id)
                ? { ...c, startBeat: Math.max(0, roundBeat(c.startBeat + safeDelta)) }
                : c
            )
          : state.audioClips;

        const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId);
        useSongStore.setState({
          chordBlocks: nextChordBlocks,
          tracks: nextTracks,
          melodyNotes: activeTrack ? activeTrack.notes : state.melodyNotes,
          patternChain: nextPatternChain,
          audioClips: nextAudioClips,
          selectedMelodyRegionRefs: nextMelodyRefs
        });
        return;
      }

      // Ctrl+0: Zoom to Fit abarcando todas las capas
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        const viewport = timelineViewportRef.current;
        const starts: number[] = [];
        const ends: number[] = [];
        state.chordBlocks.forEach((b) => {
          starts.push(b.startBeat);
          ends.push(b.startBeat + b.durationBeats);
        });
        state.tracks.forEach((tr) => {
          reconcileTrackRegions(tr.id, tr.notes, tr.regions, barBeats).forEach((r) => {
            starts.push(r.startBeat);
            ends.push(r.startBeat + r.durationBeats);
          });
        });
        normalizePatternChainToLinear(state.patternChain).forEach((d) => {
          starts.push(d.startMeasure * barBeats);
          ends.push((d.startMeasure + d.durationMeasures) * barBeats);
        });
        state.audioClips.forEach((c) => {
          starts.push(c.startBeat);
          ends.push(c.startBeat + (c.durationSeconds * state.bpm) / 60);
        });

        if (!viewport || starts.length === 0) {
          setAudioTimelineViewport({ zoomLevel: 60, scrollLeft: 0 });
          if (viewport) viewport.scrollLeft = 0;
          return;
        }
        const minBeat = Math.min(...starts);
        const maxBeat = Math.max(...ends);
        const spanBeats = Math.max(4, maxBeat - minBeat + 2);
        const viewW = Math.max(300, viewport.clientWidth - 40);
        const nextZoom = Math.max(20, Math.min(180, Math.floor(viewW / spanBeats)));
        setAudioTimelineViewport({ zoomLevel: nextZoom });
        requestAnimationFrame(() => {
          if (timelineViewportRef.current) {
            timelineViewportRef.current.scrollLeft = Math.max(0, minBeat * nextZoom - 16);
          }
        });
        return;
      }

      // Escape: Volver a herramienta Pincel o limpiar selección
      if (e.key === 'Escape') {
        if (state.playlistTool !== 'paint') {
          setPlaylistTool('paint');
        } else {
          clearAllPlaylistSelections();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    splitChordBlock,
    splitMelodyRegion,
    splitChainItem,
    splitAudioClip,
    clearAllPlaylistSelections,
    setAudioTimelineViewport,
    setPlaylistTool
  ]);

  // 3. Navegación unificada: Ctrl/Alt+Rueda Zoom al cursor, Shift+Rueda scroll, Middle-click pan
  useTimelineNavigation({
    viewportRef: timelineViewportRef,
    baseBeatWidth: 60,
    zoomLevel: zoomLevel / 60,
    minZoom: 20 / 60,
    maxZoom: 3.0,
    onZoomChange: useCallback(
      (nextScale: number) => {
        setAudioTimelineViewport({
          zoomLevel: Math.max(20, Math.min(180, Math.round(nextScale * 60)))
        });
      },
      [setAudioTimelineViewport]
    ),
    onScrollChange: useCallback(
      (nextLeft: number) => {
        setAudioTimelineViewport({ scrollLeft: nextLeft });
      },
      [setAudioTimelineViewport]
    )
  });

  // 4. Selección por área (Marquee / Lasso) unificada across Armonía, Piano Roll, Batería y Audio
  const handleLanesPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.midi-pattern-clip') || target.closest('.audio-clip')) return;

    const isLassoTrigger = playlistTool === 'select' || e.ctrlKey || e.metaKey;
    if (!isLassoTrigger) return;

    const container = lanesContainerRef.current;
    if (!container) return;

    e.preventDefault();
    const startRect = container.getBoundingClientRect();
    const startX = e.clientX - startRect.left;
    const startY = e.clientY - startRect.top;

    const isAdditive = e.shiftKey;
    const initialState = useSongStore.getState();
    const baseChordSel = isAdditive ? [...initialState.selectedChordIds] : [];
    const baseMelodySel = isAdditive ? [...initialState.selectedMelodyRegionRefs] : [];
    const baseDrumSel = isAdditive ? [...initialState.selectedChainIds] : [];
    const baseAudioSel = isAdditive ? [...initialState.selectedClipIds] : [];

    let didMarqueeDrag = false;
    setMarquee({ x1: startX, y1: startY, x2: startX, y2: startY });

    const onMove = (me: PointerEvent) => {
      const curRect = container.getBoundingClientRect();
      const curX = me.clientX - curRect.left;
      const curY = me.clientY - curRect.top;
      if (!didMarqueeDrag && (Math.abs(curX - startX) > 3 || Math.abs(curY - startY) > 3)) {
        didMarqueeDrag = true;
      }
      setMarquee({ x1: startX, y1: startY, x2: curX, y2: curY });

      const minX = Math.min(startX, curX);
      const maxX = Math.max(startX, curX);
      const minY = Math.min(startY, curY);
      const maxY = Math.max(startY, curY);

      const state = useSongStore.getState();
      const barBeats = getBeatsPerMeasure(state.timeSignature);
      const laneNodes = container.querySelectorAll<HTMLElement>(
        '[data-harmony-lane], [data-melody-track-id], [data-drum-lane], [data-track-id]'
      );

      const hitChordSet = new Set<string>(baseChordSel);
      const hitMelodyMap = new Map<string, SelectedMelodyRegionRef>();
      baseMelodySel.forEach((r) => hitMelodyMap.set(`${r.trackId}::${r.regionId}`, r));
      const hitDrumSet = new Set<string>(baseDrumSel);
      const hitAudioSet = new Set<string>(baseAudioSel);

      laneNodes.forEach((laneEl) => {
        const laneTop = laneEl.offsetTop;
        const laneBottom = laneTop + laneEl.offsetHeight;
        if (laneBottom < minY || laneTop > maxY) return;

        if (laneEl.dataset.harmonyLane) {
          state.chordBlocks.forEach((b) => {
            const cx1 = b.startBeat * zoomLevel;
            const cx2 = cx1 + b.durationBeats * zoomLevel;
            if (cx2 >= minX && cx1 <= maxX) hitChordSet.add(b.id);
          });
        }

        const melodyTrackId = laneEl.dataset.melodyTrackId;
        if (melodyTrackId) {
          const tr = state.tracks.find((t) => t.id === melodyTrackId);
          if (tr) {
            reconcileTrackRegions(tr.id, tr.notes, tr.regions, barBeats).forEach((reg) => {
              const cx1 = reg.startBeat * zoomLevel;
              const cx2 = cx1 + reg.durationBeats * zoomLevel;
              if (cx2 >= minX && cx1 <= maxX) {
                hitMelodyMap.set(`${tr.id}::${reg.id}`, { trackId: tr.id, regionId: reg.id });
              }
            });
          }
        }

        if (laneEl.dataset.drumLane) {
          const laneIdx = Number(laneEl.dataset.drumLaneIndex ?? 0);
          normalizePatternChainToLinear(state.patternChain)
            .filter((d) => d.laneIndex === laneIdx)
            .forEach((d) => {
              const cx1 = d.startMeasure * barBeats * zoomLevel;
              const cx2 = cx1 + d.durationMeasures * barBeats * zoomLevel;
              if (cx2 >= minX && cx1 <= maxX) hitDrumSet.add(d.id);
            });
        }

        const audioTrackId = laneEl.dataset.trackId;
        if (audioTrackId) {
          state.audioClips
            .filter((c) => c.trackId === audioTrackId)
            .forEach((c) => {
              const cx1 = c.startBeat * zoomLevel;
              const cx2 = cx1 + c.durationSeconds * (state.bpm / 60) * zoomLevel;
              if (cx2 >= minX && cx1 <= maxX) hitAudioSet.add(c.id);
            });
        }
      });

      const nextChordIds = Array.from(hitChordSet);
      useSongStore.setState({
        selectedChordIds: nextChordIds,
        selectedChordId: nextChordIds.length === 1 ? nextChordIds[0] : null,
        selectedMelodyRegionRefs: Array.from(hitMelodyMap.values()),
        selectedChainIds: Array.from(hitDrumSet),
        selectedClipIds: Array.from(hitAudioSet)
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setMarquee(null);
      if (didMarqueeDrag) {
        suppressNextBgClickRef.current = true;
        window.setTimeout(() => {
          suppressNextBgClickRef.current = false;
        }, 60);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // 5. Deselección al hacer clic en espacio vacío
  const handleTimelineBackgroundClick = (e: React.MouseEvent) => {
    if (suppressNextBgClickRef.current) {
      suppressNextBgClickRef.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    if (
      e.target === e.currentTarget ||
      target.classList.contains('audio-track-lane') ||
      target.classList.contains('audio-lanes-container') ||
      target.classList.contains('tracks-empty-lane-hint')
    ) {
      clearAllPlaylistSelections();
    }
  };

  // 6. Soporte Drag & Drop de archivos de audio externos
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(isSupportedAudioFile);
    if (files.length === 0) return;

    await importAudioFilesToTracks(files);
  };

  const handleEmptyImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(isSupportedAudioFile);
    if (files.length > 0) {
      await importAudioFilesToTracks(files);
    }
    if (emptyFileInputRef.current) {
      emptyFileInputRef.current.value = '';
    }
  };

  return (
    <div
      className={`audio-tracks-container ${dragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Barra de herramientas superior unificada */}
      <AudioTracksToolbar />

      {/* Espacio de trabajo: Paleta & Patrones (Izq) + Cabeceras 1:1 (Centro-Izq) + Timeline (Der) */}
      <div className="audio-workspace">
        <PatternPickerSidebar />

        {/* Columna de Cabeceras de Pistas fijas con scroll vertical sincronizado */}
        <div className="audio-headers-column">
          <div className="audio-headers-top-spacer">
            <span>TRACKS · 1:1</span>
            <span className="headers-count-badge">
              {tracks.length}PR · {audioTracks.length}A
            </span>
          </div>
          <div
            ref={headersListRef}
            className="audio-headers-list"
            onScroll={handleHeadersScroll}
          >
            {/* 1. ARMONÍA (Chord Palette 1:1) */}
            <div className="tracks-section-bar harmony-section-bar">
              <span>ARMONÍA · CHORD PALETTE</span>
            </div>
            <HarmonyTrackHeader />

            {/* 2. PIANO ROLL (Canales de Instrumento 1:1) */}
            <div className="tracks-section-bar melody-section-bar">
              <span>PIANO ROLL · MELODÍAS</span>
              <button
                type="button"
                className="tracks-section-add-btn"
                onClick={() => addPianoRollTrack()}
                title="Añadir nueva pista de Piano Roll"
              >
                <Plus size={11} />
              </button>
            </div>
            {tracks.map((track) => (
              <MelodyTrackHeader
                key={track.id}
                track={track}
                canDelete={tracks.length > 1}
                onRequestDeleteTrack={(id, name) => setTrackPendingDelete({ id, name })}
              />
            ))}

            {/* 3. BATERÍA (Drum Sequencer 1:1 — multi-capa) */}
            <div className="tracks-section-bar drum-section-bar">
              <span>
                BATERÍA · DRUM SEQUENCER
                {effectiveDrumLaneCount > 1 ? ` (${effectiveDrumLaneCount})` : ''}
              </span>
              <button
                type="button"
                className="tracks-section-add-btn"
                onClick={() => addDrumLane()}
                disabled={effectiveDrumLaneCount >= MAX_DRUM_LANES}
                title={
                  effectiveDrumLaneCount >= MAX_DRUM_LANES
                    ? `Máximo ${MAX_DRUM_LANES} capas de batería`
                    : 'Añadir capa de batería en paralelo (1:1 con Drum Sequencer)'
                }
              >
                <Plus size={11} />
              </button>
            </div>
            {Array.from({ length: effectiveDrumLaneCount }).map((_, laneIdx) => (
              <DrumTrackHeader
                key={`drum_hdr_${laneIdx}`}
                laneIndex={laneIdx}
                laneCount={effectiveDrumLaneCount}
                onRequestDeleteLane={(idx, clipCount) =>
                  setDrumLanePendingDelete({ laneIndex: idx, clipCount })
                }
              />
            ))}

            {/* 4. AUDIO MULTITRACK */}
            <div className="tracks-section-bar audio-section-bar">
              <span>AUDIO MULTITRACK</span>
              <button
                type="button"
                className="tracks-section-add-btn"
                onClick={() => addAudioTrack()}
                title="Añadir pista de audio"
              >
                <Plus size={11} />
              </button>
            </div>
            {audioTracks.map((track) => (
              <AudioTrackHeader
                key={track.id}
                track={track}
                liveRms={track.isArmed ? recordingRms : 0}
              />
            ))}
          </div>
        </div>

        {/* Columna Derecha: Regla, Playhead y Carriles 1:1 sincronizados */}
        <div
          ref={timelineViewportRef}
          className="audio-timeline-viewport"
          onClick={handleTimelineBackgroundClick}
          onScroll={handleTimelineScroll}
        >
          <div className="audio-timeline-inner" style={{ width: totalTimelineWidth }}>
            {/* Regla de compases */}
            <AudioTimelineRuler
              totalBeats={totalBeats}
              zoomLevel={zoomLevel}
              onSeek={(beat) => toneEngine.seekToBeat(beat)}
            />

            {/* Cabezal de reproducción animado a 60 FPS */}
            <AudioPlayhead zoomLevel={zoomLevel} />

            {/* Carriles sincronizados (Armonía -> Piano Roll -> Batería -> Audio) */}
            <div
              ref={lanesContainerRef}
              className="audio-lanes-container"
              onPointerDown={handleLanesPointerDown}
            >
              {/* 1. Separador + Carril ARMONÍA */}
              <div
                className="tracks-lane-section-spacer harmony-spacer"
                style={{ width: totalTimelineWidth }}
              />
              <HarmonyTrackLane zoomLevel={zoomLevel} totalWidth={totalTimelineWidth} />

              {/* 2. Separador + Carriles PIANO ROLL */}
              <div
                className="tracks-lane-section-spacer melody-spacer"
                style={{ width: totalTimelineWidth }}
              />
              {tracks.map((track) => (
                <MelodyTrackLane
                  key={track.id}
                  track={track}
                  zoomLevel={zoomLevel}
                  totalWidth={totalTimelineWidth}
                />
              ))}

              {/* 3. Separador + Carriles BATERÍA (multi-capa 1:1) */}
              <div
                className="tracks-lane-section-spacer drum-spacer"
                style={{ width: totalTimelineWidth }}
              />
              {Array.from({ length: effectiveDrumLaneCount }).map((_, laneIdx) => (
                <DrumTrackLane
                  key={`drum_lane_${laneIdx}`}
                  laneIndex={laneIdx}
                  zoomLevel={zoomLevel}
                  totalWidth={totalTimelineWidth}
                />
              ))}

              {/* 4. Separador + Carriles AUDIO MULTITRACK */}
              <div
                className="tracks-lane-section-spacer audio-spacer"
                style={{ width: totalTimelineWidth }}
              />
              {audioTracks.map((track) => {
                const trackClips = audioClips.filter((c) => c.trackId === track.id);
                return (
                  <AudioTrackLane
                    key={track.id}
                    track={track}
                    clips={trackClips}
                    zoomLevel={zoomLevel}
                    totalWidth={totalTimelineWidth}
                  />
                );
              })}

              {/* Rectángulo de selección Lasso/Marquee */}
              {marquee && (
                <div
                  className="playlist-marquee-rect"
                  style={{
                    left: Math.min(marquee.x1, marquee.x2),
                    top: Math.min(marquee.y1, marquee.y2),
                    width: Math.abs(marquee.x2 - marquee.x1),
                    height: Math.abs(marquee.y2 - marquee.y1)
                  }}
                />
              )}
            </div>

            {/* Guía compacta debajo de las pistas cuando el proyecto está vacío */}
            {isTimelineCompletelyEmpty && (
              <div className="audio-tracks-empty-watermark compact-playlist-hint">
                <input
                  ref={emptyFileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleEmptyImportChange}
                />
                <div className="watermark-title">VISTA GENERAL DE TRACKS (1:1)</div>
                <div className="watermark-subtitle">
                  <strong>Armonía</strong>, cada canal de <strong>Piano Roll</strong> y{' '}
                  <strong>Batería</strong> comparten exactamente la misma línea de tiempo con sus
                  editores. Pinta acordes o patrones desde el panel izquierdo, haz doble clic en
                  cualquier pista para abrir su editor, o importa / graba audio.
                </div>
                <div className="audio-tracks-empty-actions">
                  <button
                    type="button"
                    className="audio-empty-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      emptyFileInputRef.current?.click();
                    }}
                  >
                    <Upload size={13} />
                    <span>IMPORTAR AUDIO</span>
                  </button>
                  <button
                    type="button"
                    className="audio-empty-action-btn record-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      startAudioRecording();
                    }}
                  >
                    <Mic size={13} />
                    <span>GRABAR (R)</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de confirmación para eliminar canal de Piano Roll con notas */}
      <ConfirmModal
        isOpen={Boolean(trackPendingDelete)}
        title="Eliminar Pista de Piano Roll"
        message={
          trackPendingDelete
            ? `¿Seguro que deseas eliminar la pista "${trackPendingDelete.name}" y todas sus notas? Esta acción también eliminará su canal en el Mixer.`
            : ''
        }
        confirmText="Eliminar Pista"
        cancelText="Cancelar"
        isDanger={true}
        onConfirm={() => {
          if (trackPendingDelete) {
            removePianoRollTrack(trackPendingDelete.id);
          }
          setTrackPendingDelete(null);
        }}
        onCancel={() => setTrackPendingDelete(null)}
      />

      {/* Modal de confirmación para eliminar capa de batería con clips */}
      <ConfirmModal
        isOpen={Boolean(drumLanePendingDelete)}
        title="Eliminar Capa de Batería"
        message={
          drumLanePendingDelete
            ? `¿Seguro que deseas eliminar la Capa C${drumLanePendingDelete.laneIndex + 1} de batería y sus ${drumLanePendingDelete.clipCount} clips? (Puedes deshacer con Ctrl+Z)`
            : ''
        }
        confirmText="Eliminar Capa"
        cancelText="Cancelar"
        isDanger={true}
        onConfirm={() => {
          if (drumLanePendingDelete) {
            removeDrumLane(drumLanePendingDelete.laneIndex);
          }
          setDrumLanePendingDelete(null);
        }}
        onCancel={() => setDrumLanePendingDelete(null)}
      />

      {/* Modal de Calibración de Latencia */}
      <AudioLatencyModal />
    </div>
  );
};
