/**
 * AudioTracksToolbar.tsx
 * Barra superior de herramientas y controles para la estación de trabajo de pistas de audio (Tracks).
 * Sigue la suite unificada de hardware analógico de Phosphor (UnifiedToolbar, botones físicos, bandejas táctiles)
 * y mantiene consistencia absoluta con los botones Mute/Solo de cabecera a la izquierda.
 */

import React, { useRef } from 'react';
import {
  Plus,
  Mic,
  Upload,
  Scissors,
  Sliders
} from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import type { AudioSnapGrid } from '../../utils/typeDefinitions';
import { UnifiedToolbar } from '../shared/UnifiedToolbar';
import { PhysicalZoomControl } from '../shared/PhysicalZoomControl';
import { CustomSelect } from '../ui/CustomSelect';
import { audioBufferRegistry } from '../../core/audio/audioBufferRegistry';
import { waveformService } from '../../core/audio/waveformService';
import { getNativeAudioContext } from '../../core/audio/worklet/PhosphorWorkletNode';
import { generateId } from '../../utils/idGenerator';

export const AudioTracksToolbar: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const audioTracks = useSongStore((state) => state.audioTracks);
  const audioClips = useSongStore((state) => state.audioClips);
  const bpm = useSongStore((state) => state.bpm);
  const timeSignature = useSongStore((state) => state.timeSignature);
  const selectedTrackId = useSongStore((state) => state.selectedTrackId);
  const selectedClipIds = useSongStore((state) => state.selectedClipIds);
  const currentBeat = useSongStore((state) => state.currentBeat);
  const isRecordingAudio = useSongStore((state) => state.isRecordingAudio);
  const armedTrackId = useSongStore((state) => state.armedTrackId);
  const audioSnapGrid = useSongStore((state) => state.audioSnapGrid);
  const audioTimelineViewport = useSongStore((state) => state.audioTimelineViewport);
  const audioLatencyCalibrationMs = useSongStore((state) => state.audioLatencyCalibrationMs);

  const addAudioTrack = useSongStore((state) => state.addAudioTrack);
  const updateAudioTrack = useSongStore((state) => state.updateAudioTrack);
  const setSelectedTrackId = useSongStore((state) => state.setSelectedTrackId);
  const addAudioClip = useSongStore((state) => state.addAudioClip);
  const splitAudioClip = useSongStore((state) => state.splitAudioClip);
  const setAudioSnapGrid = useSongStore((state) => state.setAudioSnapGrid);
  const setAudioTimelineViewport = useSongStore((state) => state.setAudioTimelineViewport);
  const setIsLatencyModalOpen = useSongStore((state) => state.setIsLatencyModalOpen);
  const startAudioRecording = useSongStore((state) => state.startAudioRecording);
  const stopAudioRecording = useSongStore((state) => state.stopAudioRecording);

  // Determinar pista activa para los controles rápidos M/S de cabecera
  const activeTrack = audioTracks.find((t) => t.id === selectedTrackId) || audioTracks[0];
  const isMuted = activeTrack?.muted ?? false;
  const isSolo = activeTrack?.solo ?? false;

  const handleToggleMute = () => {
    if (activeTrack) {
      updateAudioTrack(activeTrack.id, { muted: !activeTrack.muted });
    }
  };

  const handleToggleSolo = () => {
    if (activeTrack) {
      updateAudioTrack(activeTrack.id, { solo: !activeTrack.solo });
    }
  };

  // 1. Manejo de grabación
  const handleToggleRecord = async () => {
    if (isRecordingAudio) {
      await stopAudioRecording();
    } else {
      await startAudioRecording();
    }
  };

  // 2. Manejo de importación de audio local (WAV, MP3, OGG, FLAC)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const nativeCtx = getNativeAudioContext();
      if (!nativeCtx) return;

      const audioBuffer = await nativeCtx.decodeAudioData(arrayBuffer);
      const bufferId = audioBufferRegistry.registerBuffer(audioBuffer);
      audioBufferRegistry.saveBufferToIndexedDB(bufferId, audioBuffer).catch(() => {});
      waveformService.getOrGeneratePeaks(bufferId, audioBuffer).catch(() => {});

      let targetTrackId = armedTrackId || selectedTrackId || audioTracks[0]?.id;
      if (!targetTrackId) {
        targetTrackId = addAudioTrack(file.name.replace(/\.[^/.]+$/, ''));
      }

      const newClip = {
        id: `clip_${generateId()}`,
        trackId: targetTrackId,
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
      console.warn('[AudioTracksToolbar] Error importando archivo de audio:', err);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 3. Herramienta Split (Cortar clips seleccionados o el clip bajo el cabezal en la pista activa)
  const clipUnderPlayhead = activeTrack
    ? audioClips.find(
        (c) =>
          c.trackId === activeTrack.id &&
          currentBeat >= c.startBeat &&
          currentBeat <= c.startBeat + (c.durationSeconds * bpm) / 60
      )
    : undefined;

  const canSplit = selectedClipIds.length > 0 || Boolean(clipUnderPlayhead);

  const handleSplitAtPlayhead = () => {
    if (selectedClipIds.length > 0) {
      selectedClipIds.forEach((id) => splitAudioClip(id, currentBeat));
    } else if (clipUnderPlayhead) {
      splitAudioClip(clipUnderPlayhead.id, currentBeat);
    }
  };

  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
  const measureNum = Math.floor(currentBeat / beatsPerMeasure) + 1;
  const beatInMeasure = Math.floor(currentBeat % beatsPerMeasure) + 1;

  // Opciones de pistas para el selector de hardware
  const trackOptions = audioTracks.map((t) => ({
    value: t.id,
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '2px',
            backgroundColor: t.color,
            display: 'inline-block'
          }}
        />
        {t.name}
      </span>
    )
  }));

  const snapOptions: { id: AudioSnapGrid; label: string }[] = [
    { id: 'bar', label: 'BAR' },
    { id: 'beat', label: '1/1' },
    { id: '1/2', label: '1/2' },
    { id: '1/4', label: '1/4' },
    { id: '1/8', label: '1/8' },
    { id: 'off', label: 'OFF' }
  ];

  return (
    <UnifiedToolbar
      left={
        <>
          {/* Botones M y S estándar a la izquierda con diseño unificado */}
          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
            <button
              type="button"
              className={`control-btn mute-toggle ${isMuted ? 'active' : ''}`}
              onClick={handleToggleMute}
              disabled={!activeTrack}
              title={isMuted ? 'Desmutear pista activa' : 'Silenciar pista activa (Mute)'}
              style={{
                width: '28px',
                height: '28px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                fontFamily: "'Share Tech Mono', monospace"
              }}
            >
              M
            </button>
            <button
              type="button"
              className={`control-btn solo-toggle ${isSolo ? 'active' : ''}`}
              onClick={handleToggleSolo}
              disabled={!activeTrack}
              title={isSolo ? 'Desactivar Solo de pista activa' : 'Aislar pista activa (Solo)'}
              style={{
                width: '28px',
                height: '28px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                fontFamily: "'Share Tech Mono', monospace"
              }}
            >
              S
            </button>
          </div>

          {/* Selector de Pista Activa */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                fontSize: '0.68rem',
                fontFamily: "'Share Tech Mono', monospace",
                color: 'var(--text-secondary)'
              }}
            >
              PISTA:
            </span>
            <CustomSelect
              value={activeTrack?.id || ''}
              onChange={(val) => setSelectedTrackId(val)}
              options={trackOptions}
              style={{ minWidth: '115px' }}
            />
          </div>

          {/* Botón físico para añadir pista */}
          <button
            type="button"
            className="physical-btn"
            onClick={() => addAudioTrack()}
            title="Añadir nueva pista de audio"
          >
            <Plus size={13} />
          </button>
        </>
      }
      center={
        <>
          {/* Botón de Grabación Analógica con LED indicador */}
          <button
            type="button"
            className={`physical-btn ${isRecordingAudio ? 'active' : ''}`}
            onClick={handleToggleRecord}
            title={isRecordingAudio ? 'Detener grabación (Tecla R)' : 'Grabar en pista armada (Tecla R)'}
            style={{
              borderColor: isRecordingAudio ? 'rgba(239, 68, 68, 0.7)' : undefined,
              color: isRecordingAudio ? '#fca5a5' : undefined
            }}
          >
            <Mic size={13} style={{ color: isRecordingAudio ? '#ef4444' : 'inherit' }} />
            <span>{isRecordingAudio ? 'DETENER' : 'GRABAR'}</span>
            <span className={`physical-led-dot ${isRecordingAudio ? 'lit-red' : ''}`} />
          </button>

          {/* Botón Importar Archivo de Audio */}
          <button
            type="button"
            className="physical-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Importar archivo de audio (WAV, MP3, FLAC, OGG)"
          >
            <Upload size={13} />
            <span>CARGAR</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* Botón de Corte (Split) */}
          <button
            type="button"
            className="physical-btn"
            onClick={handleSplitAtPlayhead}
            disabled={!canSplit}
            title={canSplit ? "Dividir clip en el cabezal (Tecla S)" : "Selecciona un clip o sitúa el cabezal sobre una pista con audio (Tecla S)"}
          >
            <Scissors size={13} />
            <span>SPLIT</span>
          </button>

          {/* Bandeja segmentada física de Snap magnético */}
          <div className="physical-segment-tray" title="Ajuste magnético a la cuadrícula (Snap)">
            <span
              style={{
                fontSize: '0.62rem',
                fontFamily: "'Share Tech Mono', monospace",
                color: 'var(--text-secondary)',
                padding: '0 4px'
              }}
            >
              SNAP:
            </span>
            {snapOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`physical-segment-btn ${audioSnapGrid === opt.id ? 'active' : ''}`}
                onClick={() => setAudioSnapGrid(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      }
      right={
        <>
          {/* Display LCD de Compás y Beat */}
          <div className="audio-display-badge" title="Posición actual del cabezal">
            <span>COMPÁS {measureNum}.{beatInMeasure}</span>
          </div>

          {/* Botón de Calibración de Latencia de Hardware */}
          <button
            type="button"
            className="physical-btn"
            onClick={() => setIsLatencyModalOpen(true)}
            title="Calibración de latencia de interfaz de audio"
          >
            <Sliders size={13} />
            <span>{audioLatencyCalibrationMs}ms</span>
          </button>

          {/* Control de Zoom Físico Analógico */}
          <PhysicalZoomControl
            zoomLevel={audioTimelineViewport.zoomLevel / 60}
            onZoomChange={(newZoom) =>
              setAudioTimelineViewport({ zoomLevel: Math.max(20, Math.round(newZoom * 60)) })
            }
            minZoom={0.4}
            maxZoom={2.5}
            step={0.15}
          />
        </>
      }
    />
  );
};
