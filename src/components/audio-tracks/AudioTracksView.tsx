/**
 * AudioTracksView.tsx
 * Estación unificada de Playlist / Tracks (MIDI Tracks de Patrones estilo FL Studio + Audio Tracks multitrack).
 * Orquesta el Pattern Picker lateral, la barra de herramientas, la regla musical con acordes,
 * los carriles MIDI y de Audio sincronizados, selección por caja (Lasso) y atajos de teclado DAW.
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
import { MidiTrackHeader, MidiTrackLane } from './MidiTrackLane';
import { PatternPickerSidebar } from './PatternPickerSidebar';
import { AudioLatencyModal } from './AudioLatencyModal';
import { useTimelineNavigation } from '../../hooks/useTimelineNavigation';
import { isTypingTarget, isModalBlockingShortcuts } from '../../core/shortcuts/isTypingTarget';
import { importAudioFilesToTracks, isSupportedAudioFile } from '../../core/session/projectFileImport';
import { getBeatsPerMeasure } from '../../core/audio/arrangementResolver';

interface MarqueeRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const AudioTracksView: React.FC = () => {
  const {
    audioTracks,
    audioClips,
    midiTracks,
    midiClips,
    chordBlocks,
    tracks,
    bpm,
    timeSignature,
    recordingRms,
    audioTimelineViewport,
    playlistTool,
    addMidiTrack,
    addAudioTrack,
    splitAudioClip,
    splitMidiClip,
    duplicateAudioClip,
    duplicateSelectedMidiClips,
    toggleClipMute,
    toggleMidiClipMute,
    removeAudioClip,
    removeMidiClipsBatch,
    clearClipSelection,
    clearMidiClipSelection,
    copySelectedMidiClips,
    pasteMidiClips,
    setAudioTimelineViewport,
    startAudioRecording,
    setPlaylistTool
  } = useSongStore(
    useShallow((state) => ({
      audioTracks: state.audioTracks,
      audioClips: state.audioClips,
      midiTracks: state.midiTracks,
      midiClips: state.midiClips,
      chordBlocks: state.chordBlocks,
      tracks: state.tracks,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      recordingRms: state.recordingRms,
      audioTimelineViewport: state.audioTimelineViewport,
      playlistTool: state.playlistTool,
      addMidiTrack: state.addMidiTrack,
      addAudioTrack: state.addAudioTrack,
      splitAudioClip: state.splitAudioClip,
      splitMidiClip: state.splitMidiClip,
      duplicateAudioClip: state.duplicateAudioClip,
      duplicateSelectedMidiClips: state.duplicateSelectedMidiClips,
      toggleClipMute: state.toggleClipMute,
      toggleMidiClipMute: state.toggleMidiClipMute,
      removeAudioClip: state.removeAudioClip,
      removeMidiClipsBatch: state.removeMidiClipsBatch,
      clearClipSelection: state.clearClipSelection,
      clearMidiClipSelection: state.clearMidiClipSelection,
      copySelectedMidiClips: state.copySelectedMidiClips,
      pasteMidiClips: state.pasteMidiClips,
      setAudioTimelineViewport: state.setAudioTimelineViewport,
      startAudioRecording: state.startAudioRecording,
      setPlaylistTool: state.setPlaylistTool
    }))
  );

  const headersListRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const lanesContainerRef = useRef<HTMLDivElement | null>(null);
  const emptyFileInputRef = useRef<HTMLInputElement | null>(null);
  const isSyncingScrollRef = useRef(false);
  const suppressNextBgClickRef = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);

  // Calcular longitud total de la línea de tiempo abarcando MIDI clips, Audio clips, Acordes y Melodías
  const maxContentEndBeat = useMemo(() => {
    let maxEnd = 32;
    for (const clip of audioClips) {
      const end = clip.startBeat + clip.durationSeconds * (bpm / 60);
      if (end > maxEnd) maxEnd = end;
    }
    for (const clip of midiClips) {
      const end = clip.startBeat + clip.durationBeats;
      if (end > maxEnd) maxEnd = end;
    }
    for (const cb of chordBlocks) {
      const end = cb.startBeat + cb.durationBeats;
      if (end > maxEnd) maxEnd = end;
    }
    for (const t of tracks) {
      for (const n of t.notes || []) {
        const end = n.startBeat + n.durationBeats;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd;
  }, [audioClips, midiClips, chordBlocks, tracks, bpm]);

  const totalBeats = Math.max(64, Math.ceil((maxContentEndBeat + 16) / beatsPerMeasure) * beatsPerMeasure);
  const zoomLevel = audioTimelineViewport.zoomLevel || 60;
  const totalTimelineWidth = totalBeats * zoomLevel;

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

  // 2. Atajos de teclado unificados estilo DAW / FL Studio Playlist
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

      // Herramientas rápidas (P = Pintar, C = Navaja, E = Seleccionar)
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

      // Tecla S: Dividir clip MIDI o Audio seleccionado (o bajo el cabezal) en la posición del cabezal
      if (keyLower === 's' && !isCtrlOrCmd && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (state.selectedMidiClipIds.length > 0) {
          state.selectedMidiClipIds.forEach((id) => splitMidiClip(id, state.currentBeat));
        } else if (state.selectedClipIds.length > 0) {
          state.selectedClipIds.forEach((id) => splitAudioClip(id, state.currentBeat));
        } else if (state.selectedPlaylistTrackKind === 'midi' && state.selectedMidiTrackId) {
          const midiClip = state.midiClips.find(
            (c) =>
              c.midiTrackId === state.selectedMidiTrackId &&
              state.currentBeat > c.startBeat + 0.06 &&
              state.currentBeat < c.startBeat + c.durationBeats - 0.06
          );
          if (midiClip) splitMidiClip(midiClip.id, state.currentBeat);
        } else if (state.selectedTrackId) {
          const trackClip = state.audioClips.find(
            (c) =>
              c.trackId === state.selectedTrackId &&
              state.currentBeat >= c.startBeat &&
              state.currentBeat <= c.startBeat + (c.durationSeconds * state.bpm) / 60
          );
          if (trackClip) splitAudioClip(trackClip.id, state.currentBeat);
        }
        return;
      }

      // Teclas Supr / Backspace: Eliminar clips MIDI y/o Audio seleccionados
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const hasMidiSel = state.selectedMidiClipIds.length > 0;
        const hasAudioSel = state.selectedClipIds.length > 0;
        if (hasMidiSel || hasAudioSel) {
          e.preventDefault();
          if (hasMidiSel) removeMidiClipsBatch(state.selectedMidiClipIds);
          if (hasAudioSel) state.selectedClipIds.forEach((id) => removeAudioClip(id));
        }
        return;
      }

      // Ctrl+A: Seleccionar todos los clips
      if (isCtrlOrCmd && keyLower === 'a') {
        e.preventDefault();
        useSongStore.setState({
          selectedMidiClipIds: state.midiClips.map((c) => c.id),
          selectedClipIds: state.audioClips.map((c) => c.id)
        });
        return;
      }

      // Ctrl+C / Ctrl+V: Copiar y Pegar clips MIDI
      if (isCtrlOrCmd && keyLower === 'c' && state.selectedMidiClipIds.length > 0) {
        e.preventDefault();
        copySelectedMidiClips();
        return;
      }

      if (isCtrlOrCmd && keyLower === 'v' && state.midiClipClipboard.length > 0) {
        e.preventDefault();
        pasteMidiClips();
        return;
      }

      // Ctrl+0: Zoom to Fit (encuadrar todos los clips MIDI y Audio)
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        const viewport = timelineViewportRef.current;
        const starts: number[] = [];
        const ends: number[] = [];
        state.audioClips.forEach((c) => {
          starts.push(c.startBeat);
          ends.push(c.startBeat + (c.durationSeconds * state.bpm) / 60);
        });
        state.midiClips.forEach((c) => {
          starts.push(c.startBeat);
          ends.push(c.startBeat + c.durationBeats);
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

      // Ctrl+D: Duplicar clips seleccionados (MIDI y/o Audio)
      if (isCtrlOrCmd && keyLower === 'd') {
        const hasMidiSel = state.selectedMidiClipIds.length > 0;
        const hasAudioSel = state.selectedClipIds.length > 0;
        if (hasMidiSel || hasAudioSel) {
          e.preventDefault();
          if (hasMidiSel) duplicateSelectedMidiClips();
          if (hasAudioSel) state.selectedClipIds.forEach((id) => duplicateAudioClip(id));
        }
        return;
      }

      // M: Silenciar / activar clips seleccionados
      if (keyLower === 'm' && !isCtrlOrCmd && !e.altKey && !e.shiftKey) {
        const hasMidiSel = state.selectedMidiClipIds.length > 0;
        const hasAudioSel = state.selectedClipIds.length > 0;
        if (hasMidiSel || hasAudioSel) {
          e.preventDefault();
          if (hasMidiSel) state.selectedMidiClipIds.forEach((id) => toggleMidiClipMute(id));
          if (hasAudioSel) state.selectedClipIds.forEach((id) => toggleClipMute(id));
        }
        return;
      }

      // Flechas Izquierda / Derecha: Mover clips seleccionados por el snap activo
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !isCtrlOrCmd &&
        (state.selectedMidiClipIds.length > 0 || state.selectedClipIds.length > 0)
      ) {
        e.preventDefault();
        const barBeats = getBeatsPerMeasure(state.timeSignature);
        const snapStep =
          e.altKey ? 0.25 :
          state.audioSnapGrid === 'bar' ? barBeats :
          state.audioSnapGrid === '1/2' ? 0.5 :
          state.audioSnapGrid === '1/4' ? 0.25 :
          state.audioSnapGrid === '1/8' ? 0.125 :
          state.audioSnapGrid === '1/16' ? 0.0625 :
          1;
        const delta = (e.key === 'ArrowRight' ? 1 : -1) * snapStep;

        if (state.selectedMidiClipIds.length > 0) {
          const selected = state.midiClips.filter((c) => state.selectedMidiClipIds.includes(c.id));
          const minStart = selected.reduce((m, c) => Math.min(m, c.startBeat), Infinity);
          const safeDelta = Math.max(-minStart, delta);
          if (safeDelta !== 0) {
            state.updateMidiClipsBatch(
              selected.map((c) => ({
                id: c.id,
                changes: { startBeat: Math.max(0, c.startBeat + safeDelta) }
              }))
            );
          }
        }
        if (state.selectedClipIds.length > 0) {
          const updateClip = state.updateAudioClip;
          state.selectedClipIds.forEach((clipId) => {
            const clip = state.audioClips.find((c) => c.id === clipId);
            if (clip) {
              updateClip(clipId, { startBeat: Math.max(0, clip.startBeat + delta) });
            }
          });
        }
        return;
      }

      // Escape: Volver a herramienta Pincel o deseleccionar clips
      if (e.key === 'Escape') {
        if (state.playlistTool !== 'paint') {
          setPlaylistTool('paint');
        } else {
          clearClipSelection();
          clearMidiClipSelection();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    splitAudioClip,
    splitMidiClip,
    removeAudioClip,
    removeMidiClipsBatch,
    duplicateAudioClip,
    duplicateSelectedMidiClips,
    toggleClipMute,
    toggleMidiClipMute,
    clearClipSelection,
    clearMidiClipSelection,
    copySelectedMidiClips,
    pasteMidiClips,
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
    onZoomChange: useCallback((nextScale: number) => {
      setAudioTimelineViewport({ zoomLevel: Math.max(20, Math.min(180, Math.round(nextScale * 60))) });
    }, [setAudioTimelineViewport]),
    onScrollChange: useCallback((nextLeft: number) => {
      setAudioTimelineViewport({ scrollLeft: nextLeft });
    }, [setAudioTimelineViewport])
  });

  // 4. Selección por área (Marquee / Lasso) en modo Seleccionar o Ctrl+Arrastrar
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
    const baseMidiSel = isAdditive ? [...initialState.selectedMidiClipIds] : [];
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
      const laneNodes = container.querySelectorAll<HTMLElement>('[data-midi-track-id], [data-track-id]');
      const hitMidiSet = new Set<string>(baseMidiSel);
      const hitAudioSet = new Set<string>(baseAudioSel);

      laneNodes.forEach((laneEl) => {
        const laneTop = laneEl.offsetTop;
        const laneBottom = laneTop + laneEl.offsetHeight;
        if (laneBottom < minY || laneTop > maxY) return;

        const midiTrackId = laneEl.dataset.midiTrackId;
        if (midiTrackId) {
          state.midiClips
            .filter((c) => c.midiTrackId === midiTrackId)
            .forEach((c) => {
              const cx1 = c.startBeat * zoomLevel;
              const cx2 = cx1 + c.durationBeats * zoomLevel;
              if (cx2 >= minX && cx1 <= maxX) hitMidiSet.add(c.id);
            });
        }
        const audioTrackId = laneEl.dataset.trackId;
        if (audioTrackId) {
          state.audioClips
            .filter((c) => c.trackId === audioTrackId)
            .forEach((c) => {
              const cx1 = c.startBeat * zoomLevel;
              const cx2 = cx1 + (c.durationSeconds * (state.bpm / 60)) * zoomLevel;
              if (cx2 >= minX && cx1 <= maxX) hitAudioSet.add(c.id);
            });
        }
      });

      useSongStore.setState({
        selectedMidiClipIds: Array.from(hitMidiSet),
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

  // 5. Deselección al hacer click en espacio vacío
  const handleTimelineBackgroundClick = (e: React.MouseEvent) => {
    if (suppressNextBgClickRef.current) {
      suppressNextBgClickRef.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    if (
      e.target === e.currentTarget ||
      target.classList.contains('audio-track-lane') ||
      target.classList.contains('audio-lanes-container')
    ) {
      clearClipSelection();
      clearMidiClipSelection();
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

      {/* Espacio de trabajo: Pattern Picker (Izq) + Cabeceras (Centro-Izq) + Timeline (Der) */}
      <div className="audio-workspace">
        {/* Panel Selector de Patrones MIDI y Clips de Audio estilo FL Studio */}
        <PatternPickerSidebar />

        {/* Columna de Cabeceras de Pistas fijas con scroll vertical sincronizado */}
        <div className="audio-headers-column">
          <div className="audio-headers-top-spacer">
            <span>PISTAS / PLAYLIST</span>
            <span className="headers-count-badge">
              {midiTracks.length}M · {audioTracks.length}A
            </span>
          </div>
          <div
            ref={headersListRef}
            className="audio-headers-list"
            onScroll={handleHeadersScroll}
          >
            {/* Cabecera de sección MIDI TRACKS */}
            <div className="tracks-section-bar midi-section-bar">
              <span>MIDI / PATRONES</span>
              <button
                type="button"
                className="tracks-section-add-btn"
                onClick={() => addMidiTrack()}
                title="Añadir pista MIDI"
              >
                <Plus size={11} />
              </button>
            </div>
            {midiTracks.map((track) => {
              const count = midiClips.filter((c) => c.midiTrackId === track.id).length;
              return <MidiTrackHeader key={track.id} track={track} clipCount={count} />;
            })}

            {/* Cabecera de sección AUDIO TRACKS */}
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

        {/* Columna Derecha: Regla, Playhead y Carriles MIDI + Audio */}
        <div
          ref={timelineViewportRef}
          className="audio-timeline-viewport"
          onClick={handleTimelineBackgroundClick}
          onScroll={handleTimelineScroll}
        >
          <div className="audio-timeline-inner" style={{ width: totalTimelineWidth }}>
            {/* Regla de compases con referencia armónica */}
            <AudioTimelineRuler
              totalBeats={totalBeats}
              zoomLevel={zoomLevel}
              onSeek={(beat) => toneEngine.seekToBeat(beat)}
            />

            {/* Cabezal de reproducción animado a 60 FPS */}
            <AudioPlayhead zoomLevel={zoomLevel} />

            {/* Carriles sincronizados (MIDI Tracks arriba + Audio Tracks abajo) */}
            <div
              ref={lanesContainerRef}
              className="audio-lanes-container"
              onPointerDown={handleLanesPointerDown}
            >
              {/* Separador alineado con tracks-section-bar MIDI (22px) */}
              <div className="tracks-lane-section-spacer midi-spacer" style={{ width: totalTimelineWidth }} />

              {midiTracks.map((track) => {
                const trackClips = midiClips.filter((c) => c.midiTrackId === track.id);
                return (
                  <MidiTrackLane
                    key={track.id}
                    track={track}
                    clips={trackClips}
                    zoomLevel={zoomLevel}
                    totalWidth={totalTimelineWidth}
                  />
                );
              })}

              {/* Separador alineado con tracks-section-bar AUDIO (22px) */}
              <div className="tracks-lane-section-spacer audio-spacer" style={{ width: totalTimelineWidth }} />

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

            {/* Guía compacta debajo de las pistas cuando la Playlist está vacía */}
            {midiClips.length === 0 && audioClips.length === 0 && (
              <div className="audio-tracks-empty-watermark compact-playlist-hint">
                <input
                  ref={emptyFileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleEmptyImportChange}
                />
                <div className="watermark-title">PLAYLIST DE PATRONES MIDI &amp; AUDIO</div>
                <div className="watermark-subtitle">
                  Selecciona un patrón de <strong>Drum Machine</strong> o <strong>Melodía</strong> en el panel izquierdo y haz clic o arrastra sobre cualquier <strong>Track MIDI</strong> para secuenciarlo (doble clic en un clip para editarlo). También puedes importar audio o pulsar <strong>R</strong> para grabar.
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

      {/* Modal de Calibración de Latencia */}
      <AudioLatencyModal />
    </div>
  );
};
