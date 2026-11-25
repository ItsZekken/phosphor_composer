/**
 * AudioTracksView.tsx
 * Vista principal de la estación de trabajo de pistas de audio (DAW Multitrack) de Phosphor.
 * Orquesta la barra de herramientas, la regla de compases, los carriles multitrack y los atajos de teclado rápidos.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import './audioTracks.css';
import { AudioWaveform, Upload, Mic } from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { AudioTracksToolbar } from './AudioTracksToolbar';
import { AudioTimelineRuler } from './AudioTimelineRuler';
import { AudioPlayhead } from './AudioPlayhead';
import { AudioTrackHeader, AudioTrackLane } from './AudioTrackLane';
import { AudioLatencyModal } from './AudioLatencyModal';
import { useTimelineNavigation } from '../../hooks/useTimelineNavigation';
import { isTypingTarget, isModalBlockingShortcuts } from '../../core/shortcuts/isTypingTarget';
import { importAudioFilesToTracks, isSupportedAudioFile } from '../../core/session/projectFileImport';

export const AudioTracksView: React.FC = () => {
  const audioTracks = useSongStore((state) => state.audioTracks);
  const audioClips = useSongStore((state) => state.audioClips);
  const recordingRms = useSongStore((state) => state.recordingRms);
  const audioTimelineViewport = useSongStore((state) => state.audioTimelineViewport);

  const splitAudioClip = useSongStore((state) => state.splitAudioClip);
  const duplicateAudioClip = useSongStore((state) => state.duplicateAudioClip);
  const toggleClipMute = useSongStore((state) => state.toggleClipMute);
  const removeAudioClip = useSongStore((state) => state.removeAudioClip);
  const clearClipSelection = useSongStore((state) => state.clearClipSelection);
  const setAudioTimelineViewport = useSongStore((state) => state.setAudioTimelineViewport);
  const startAudioRecording = useSongStore((state) => state.startAudioRecording);

  const headersListRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const emptyFileInputRef = useRef<HTMLInputElement | null>(null);
  const isSyncingScrollRef = useRef(false);
  const [dragOver, setDragOver] = useState(false);

  // Calcular compases totales para la anchura de la línea de tiempo
  const bpm = useSongStore((state) => state.bpm);
  const maxClipEndBeat = audioClips.reduce((max, clip) => {
    const clipBeats = clip.durationSeconds * (bpm / 60);
    return Math.max(max, clip.startBeat + clipBeats);
  }, 32);

  const totalBeats = Math.max(64, Math.ceil(maxClipEndBeat + 16));
  const zoomLevel = audioTimelineViewport.zoomLevel || 60;
  const totalTimelineWidth = totalBeats * zoomLevel;

  // 1. Sincronización bidireccional del scroll vertical
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

  // 2. Atajos de teclado locales unificados estilo DAW
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

      // Teclas S o C: Dividir clip seleccionado en la posición del cabezal
      if ((keyLower === 's' || keyLower === 'c') && !isCtrlOrCmd && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const selId = state.selectedClipIds[0];
        if (selId) {
          splitAudioClip(selId, state.currentBeat);
        } else if (state.selectedTrackId) {
          const trackClip = state.audioClips.find(
            (c) =>
              c.trackId === state.selectedTrackId &&
              state.currentBeat >= c.startBeat &&
              state.currentBeat <= c.startBeat + (c.durationSeconds * state.bpm) / 60
          );
          if (trackClip) {
            splitAudioClip(trackClip.id, state.currentBeat);
          }
        }
        return;
      }

      // Teclas Supr / Backspace: Eliminar clips seleccionados
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selIds = state.selectedClipIds;
        if (selIds.length > 0) {
          e.preventDefault();
          selIds.forEach((id) => removeAudioClip(id));
        }
        return;
      }

      // Ctrl+A: Seleccionar todos los clips de audio
      if (isCtrlOrCmd && keyLower === 'a') {
        e.preventDefault();
        useSongStore.setState({ selectedClipIds: state.audioClips.map((c) => c.id) });
        return;
      }

      // Ctrl+0: Zoom to Fit (encuadrar todos los clips)
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        const viewport = timelineViewportRef.current;
        if (!viewport || state.audioClips.length === 0) {
          setAudioTimelineViewport({ zoomLevel: 60, scrollLeft: 0 });
          if (viewport) viewport.scrollLeft = 0;
          return;
        }
        const minBeat = Math.min(...state.audioClips.map((c) => c.startBeat));
        const maxBeat = Math.max(
          ...state.audioClips.map((c) => c.startBeat + (c.durationSeconds * state.bpm) / 60)
        );
        const spanBeats = Math.max(4, maxBeat - minBeat + 1);
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

      // Atajo Ctrl+D / Cmd+D: Duplicar clips seleccionados
      if (isCtrlOrCmd && keyLower === 'd') {
        const selIds = state.selectedClipIds;
        if (selIds.length > 0) {
          e.preventDefault();
          selIds.forEach((id) => duplicateAudioClip(id));
        }
        return;
      }

      // Atajo M (sin modificadores): Silenciar / Desmutear clip(s) seleccionado(s)
      if (keyLower === 'm' && !isCtrlOrCmd && !e.altKey && !e.shiftKey) {
        const selIds = state.selectedClipIds;
        if (selIds.length > 0) {
          e.preventDefault();
          selIds.forEach((id) => toggleClipMute(id));
        }
        return;
      }

      // Flechas Izquierda / Derecha: Mover clips seleccionados por el snap activo
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isCtrlOrCmd && state.selectedClipIds.length > 0) {
        e.preventDefault();
        const snapStep =
          e.altKey ? 0.25 :
          state.audioSnapGrid === 'bar' ? 4 :
          state.audioSnapGrid === '1/2' ? 0.5 :
          state.audioSnapGrid === '1/4' ? 0.25 :
          state.audioSnapGrid === '1/8' ? 0.125 :
          state.audioSnapGrid === '1/16' ? 0.0625 :
          1;
        const delta = (e.key === 'ArrowRight' ? 1 : -1) * snapStep;
        const updateClip = state.updateAudioClip;
        state.selectedClipIds.forEach((clipId) => {
          const clip = state.audioClips.find((c) => c.id === clipId);
          if (clip) {
            updateClip(clipId, { startBeat: Math.max(0, clip.startBeat + delta) });
          }
        });
        return;
      }

      // Tecla Escape: Deseleccionar clips
      if (e.key === 'Escape') {
        clearClipSelection();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [splitAudioClip, removeAudioClip, duplicateAudioClip, toggleClipMute, clearClipSelection, setAudioTimelineViewport]);

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

  // 4. Deselección al hacer click en espacio vacío
  const handleTimelineBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('audio-track-lane')) {
      clearClipSelection();
    }
  };

  // 4. Soporte Drag & Drop de archivos de audio
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
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
      {/* Barra de herramientas superior */}
      <AudioTracksToolbar />

      {/* Espacio de trabajo de pistas */}
      <div className="audio-workspace">
        {/* Columna Izquierda: Cabeceras de Pistas fijas con scroll sincronizado */}
        <div className="audio-headers-column">
          <div className="audio-headers-top-spacer">PISTAS / CONTROL</div>
          <div
            ref={headersListRef}
            className="audio-headers-list"
            onScroll={handleHeadersScroll}
          >
            {audioTracks.map((track) => (
              <AudioTrackHeader
                key={track.id}
                track={track}
                liveRms={track.isArmed ? recordingRms : 0}
              />
            ))}
          </div>
        </div>

        {/* Columna Derecha: Regla y Carriles de Clips con Scroll Sincronizado */}
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

            {/* Carriles de Clips */}
            <div className="audio-lanes-container">
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
            </div>

            {/* Watermark de estado vacío cuando no hay clips */}
            {audioClips.length === 0 && (
              <div className="audio-tracks-empty-watermark">
                <input
                  ref={emptyFileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleEmptyImportChange}
                />
                <div className="watermark-icon">
                  <AudioWaveform size={24} />
                </div>
                <div className="watermark-title">ESTACIÓN DE AUDIO MULTITRACK</div>
                <div className="watermark-subtitle">
                  Arrastra archivos de audio (WAV, MP3, FLAC) en cualquier lugar o pulsa <strong>R</strong> para grabar en la pista armada.
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
