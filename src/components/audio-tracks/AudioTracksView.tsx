/**
 * AudioTracksView.tsx
 * Vista principal de la estación de trabajo de pistas de audio (DAW Multitrack) de Phosphor.
 * Orquesta la barra de herramientas, la regla de compases, los carriles multitrack y los atajos de teclado rápidos.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import './audioTracks.css';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { AudioTracksToolbar } from './AudioTracksToolbar';
import { AudioTimelineRuler } from './AudioTimelineRuler';
import { AudioPlayhead } from './AudioPlayhead';
import { AudioTrackHeader, AudioTrackLane } from './AudioTrackLane';
import { AudioLatencyModal } from './AudioLatencyModal';
import { audioBufferRegistry } from '../../core/audio/audioBufferRegistry';
import { waveformService } from '../../core/audio/waveformService';
import { getNativeAudioContext } from '../../core/audio/worklet/PhosphorWorkletNode';
import { generateId } from '../../utils/idGenerator';

export const AudioTracksView: React.FC = () => {
  const audioTracks = useSongStore((state) => state.audioTracks);
  const audioClips = useSongStore((state) => state.audioClips);
  const currentBeat = useSongStore((state) => state.currentBeat);
  const recordingRms = useSongStore((state) => state.recordingRms);
  const audioTimelineViewport = useSongStore((state) => state.audioTimelineViewport);

  const splitAudioClip = useSongStore((state) => state.splitAudioClip);
  const duplicateAudioClip = useSongStore((state) => state.duplicateAudioClip);
  const toggleClipMute = useSongStore((state) => state.toggleClipMute);
  const removeAudioClip = useSongStore((state) => state.removeAudioClip);
  const clearClipSelection = useSongStore((state) => state.clearClipSelection);
  const addAudioTrack = useSongStore((state) => state.addAudioTrack);
  const addAudioClip = useSongStore((state) => state.addAudioClip);
  const setAudioTimelineViewport = useSongStore((state) => state.setAudioTimelineViewport);

  const headersListRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
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

  // 2. Atajos de teclado locales estilo DAW (S = Split, Del = Eliminar, Ctrl+D = Duplicar, M = Mute)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Tecla S: Dividir clip seleccionado en la posición del cabezal (o clip bajo el cabezal en la pista seleccionada)
      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const store = useSongStore.getState();
        const selId = store.selectedClipIds[0];
        if (selId) {
          splitAudioClip(selId, store.currentBeat);
        } else if (store.selectedTrackId) {
          // Buscar clip en la pista seleccionada que intersecte con el cabezal
          const trackClip = store.audioClips.find(
            (c) =>
              c.trackId === store.selectedTrackId &&
              store.currentBeat >= c.startBeat &&
              store.currentBeat <= c.startBeat + (c.durationSeconds * store.bpm) / 60
          );
          if (trackClip) {
            splitAudioClip(trackClip.id, store.currentBeat);
          }
        }
        return;
      }

      // Teclas Supr / Backspace: Eliminar clips seleccionados
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selIds = useSongStore.getState().selectedClipIds;
        if (selIds.length > 0) {
          e.preventDefault();
          selIds.forEach((id) => removeAudioClip(id));
        }
        return;
      }

      // Atajo Ctrl+D / Cmd+D: Duplicar clips seleccionados
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        const selIds = useSongStore.getState().selectedClipIds;
        if (selIds.length > 0) {
          e.preventDefault();
          selIds.forEach((id) => duplicateAudioClip(id));
        }
        return;
      }

      // Atajo M (sin modificadores): Silenciar / Desmutear clip(s) seleccionado(s)
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const selIds = useSongStore.getState().selectedClipIds;
        if (selIds.length > 0) {
          e.preventDefault();
          selIds.forEach((id) => toggleClipMute(id));
        }
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
  }, [splitAudioClip, removeAudioClip, duplicateAudioClip, toggleClipMute, clearClipSelection]);

  // 3. Zoom con Ctrl+Rueda y Scroll Horizontal con Shift+Rueda
  const handleTimelineWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const currentZoom = useSongStore.getState().audioTimelineViewport.zoomLevel || 60;
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const nextZoom = Math.max(20, Math.min(180, Math.round(currentZoom * zoomFactor)));
      setAudioTimelineViewport({ zoomLevel: nextZoom });
    } else if (e.shiftKey) {
      if (timelineViewportRef.current) {
        timelineViewportRef.current.scrollLeft += e.deltaY;
      }
    }
  }, [setAudioTimelineViewport]);

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

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('audio/'));
    if (files.length === 0) return;

    const nativeCtx = getNativeAudioContext();
    if (!nativeCtx) return;

    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await nativeCtx.decodeAudioData(arrayBuffer);
        const bufferId = audioBufferRegistry.registerBuffer(audioBuffer);
        audioBufferRegistry.saveBufferToIndexedDB(bufferId, audioBuffer).catch(() => {});
        waveformService.getOrGeneratePeaks(bufferId, audioBuffer).catch(() => {});

        const trackId = addAudioTrack(file.name.replace(/\.[^/.]+$/, ''));
        const newClip = {
          id: `clip_${generateId()}`,
          trackId,
          bufferId,
          name: file.name.replace(/\.[^/.]+$/, ''),
          startBeat: Math.floor(currentBeat),
          sourceOffsetSeconds: 0,
          durationSeconds: audioBuffer.duration,
          gain: 1.0,
          fadeInSeconds: 0.005,
          fadeOutSeconds: 0.005,
          isMuted: false
        };
        addAudioClip(newClip);
      } catch (err) {
        console.warn('[AudioTracksView] Error importando archivo arrastrado:', err);
      }
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
          onWheel={handleTimelineWheel}
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
                <div className="watermark-icon">✦</div>
                <div className="watermark-title">ESTACIÓN DE AUDIO MULTITRACK</div>
                <div className="watermark-subtitle">
                  Arrastra archivos de audio (WAV, MP3, FLAC) aquí o pulsa <strong>R</strong> para grabar en la pista armada.
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
