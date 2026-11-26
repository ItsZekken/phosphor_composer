/**
 * AudioTracksToolbar.tsx
 * Barra superior unificada para la estación de Playlist / Tracks (MIDI Tracks de Patrones + Audio Tracks).
 * Sigue la estética de hardware analógico Phosphor (UnifiedToolbar, botones físicos, bandejas táctiles).
 */

import React, { useRef } from 'react';
import {
  Plus,
  Mic,
  Upload,
  Scissors,
  Sliders,
  Magnet,
  Pencil,
  PanelLeft,
  AudioWaveform
} from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { UnifiedToolbar } from '../shared/UnifiedToolbar';
import { PhysicalZoomControl } from '../shared/PhysicalZoomControl';
import { MidiKeysMiniIcon } from './PatternPickerSidebar';
import { audioBufferRegistry } from '../../core/audio/audioBufferRegistry';
import { waveformService } from '../../core/audio/waveformService';
import { getNativeAudioContext } from '../../core/audio/worklet/PhosphorWorkletNode';
import { generateId } from '../../utils/idGenerator';
import { getBeatsPerMeasure } from '../../core/audio/arrangementResolver';

export const AudioTracksToolbar: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    audioTracks,
    audioClips,
    midiTracks,
    midiClips,
    bpm,
    timeSignature,
    selectedTrackId,
    selectedMidiTrackId,
    selectedPlaylistTrackKind,
    selectedClipIds,
    selectedMidiClipIds,
    currentBeat,
    isRecordingAudio,
    armedTrackId,
    audioSnapGrid,
    audioTimelineViewport,
    audioLatencyCalibrationMs,
    playlistTool,
    isPickerOpen,
    addAudioTrack,
    updateAudioTrack,
    addMidiTrack,
    updateMidiTrack,
    addAudioClip,
    splitAudioClip,
    splitMidiClip,
    setAudioSnapGrid,
    setAudioTimelineViewport,
    setIsLatencyModalOpen,
    startAudioRecording,
    stopAudioRecording,
    setPlaylistTool,
    setIsPickerOpen
  } = useSongStore(
    useShallow((state) => ({
      audioTracks: state.audioTracks,
      audioClips: state.audioClips,
      midiTracks: state.midiTracks,
      midiClips: state.midiClips,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      selectedTrackId: state.selectedTrackId,
      selectedMidiTrackId: state.selectedMidiTrackId,
      selectedPlaylistTrackKind: state.selectedPlaylistTrackKind,
      selectedClipIds: state.selectedClipIds,
      selectedMidiClipIds: state.selectedMidiClipIds,
      currentBeat: state.currentBeat,
      isRecordingAudio: state.isRecordingAudio,
      armedTrackId: state.armedTrackId,
      audioSnapGrid: state.audioSnapGrid,
      audioTimelineViewport: state.audioTimelineViewport,
      audioLatencyCalibrationMs: state.audioLatencyCalibrationMs,
      playlistTool: state.playlistTool,
      isPickerOpen: state.isPickerOpen,
      addAudioTrack: state.addAudioTrack,
      updateAudioTrack: state.updateAudioTrack,
      addMidiTrack: state.addMidiTrack,
      updateMidiTrack: state.updateMidiTrack,
      addAudioClip: state.addAudioClip,
      splitAudioClip: state.splitAudioClip,
      splitMidiClip: state.splitMidiClip,
      setAudioSnapGrid: state.setAudioSnapGrid,
      setAudioTimelineViewport: state.setAudioTimelineViewport,
      setIsLatencyModalOpen: state.setIsLatencyModalOpen,
      startAudioRecording: state.startAudioRecording,
      stopAudioRecording: state.stopAudioRecording,
      setPlaylistTool: state.setPlaylistTool,
      setIsPickerOpen: state.setIsPickerOpen
    }))
  );

  // Determinar pista activa (MIDI o Audio) para M/S rápidos
  const activeMidiTrack = midiTracks.find((t) => t.id === selectedMidiTrackId) || midiTracks[0];
  const activeAudioTrack = audioTracks.find((t) => t.id === selectedTrackId) || audioTracks[0];
  const isMidiActive = selectedPlaylistTrackKind === 'midi' && Boolean(activeMidiTrack);
  const activeTrack = isMidiActive ? activeMidiTrack : activeAudioTrack;
  const isMuted = activeTrack?.muted ?? false;
  const isSolo = activeTrack?.solo ?? false;

  const handleToggleMute = () => {
    if (!activeTrack) return;
    if (isMidiActive) {
      updateMidiTrack(activeTrack.id, { muted: !activeTrack.muted });
    } else {
      updateAudioTrack(activeTrack.id, { muted: !activeTrack.muted });
    }
  };

  const handleToggleSolo = () => {
    if (!activeTrack) return;
    if (isMidiActive) {
      updateMidiTrack(activeTrack.id, { solo: !activeTrack.solo });
    } else {
      updateAudioTrack(activeTrack.id, { solo: !activeTrack.solo });
    }
  };

  // Grabación de audio
  const handleToggleRecord = async () => {
    if (isRecordingAudio) {
      await stopAudioRecording();
    } else {
      await startAudioRecording();
    }
  };

  // Importar archivo de audio local
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

  // Split unificado (MIDI clips + Audio clips)
  const audioClipUnderPlayhead = activeAudioTrack
    ? audioClips.find(
        (c) =>
          c.trackId === activeAudioTrack.id &&
          currentBeat >= c.startBeat &&
          currentBeat <= c.startBeat + (c.durationSeconds * bpm) / 60
      )
    : undefined;

  const midiClipUnderPlayhead = activeMidiTrack
    ? midiClips.find(
        (c) =>
          c.midiTrackId === activeMidiTrack.id &&
          currentBeat > c.startBeat + 0.06 &&
          currentBeat < c.startBeat + c.durationBeats - 0.06
      )
    : undefined;

  const canSplit =
    selectedMidiClipIds.length > 0 ||
    selectedClipIds.length > 0 ||
    Boolean(midiClipUnderPlayhead) ||
    Boolean(audioClipUnderPlayhead);

  const handleSplitAtPlayhead = () => {
    if (selectedMidiClipIds.length > 0) {
      selectedMidiClipIds.forEach((id) => splitMidiClip(id, currentBeat));
    } else if (selectedClipIds.length > 0) {
      selectedClipIds.forEach((id) => splitAudioClip(id, currentBeat));
    } else if (isMidiActive && midiClipUnderPlayhead) {
      splitMidiClip(midiClipUnderPlayhead.id, currentBeat);
    } else if (audioClipUnderPlayhead) {
      splitAudioClip(audioClipUnderPlayhead.id, currentBeat);
    } else if (midiClipUnderPlayhead) {
      splitMidiClip(midiClipUnderPlayhead.id, currentBeat);
    }
  };

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const measureNum = Math.floor(currentBeat / beatsPerMeasure) + 1;
  const beatInMeasure = Math.floor(currentBeat % beatsPerMeasure) + 1;

  return (
    <UnifiedToolbar
      left={
        <>
          {/* Toggle Panel de Patrones (Picker FL-Style) */}
          <button
            type="button"
            className={`physical-btn ${isPickerOpen ? 'active' : ''}`}
            onClick={() => setIsPickerOpen(!isPickerOpen)}
            title={isPickerOpen ? 'Ocultar selector de patrones (Picker)' : 'Mostrar selector de patrones (Picker)'}
          >
            <PanelLeft size={13} style={{ color: isPickerOpen ? '#ffd875' : 'var(--text-secondary)' }} />
          </button>

          {/* Botones M y S rápidos para la pista activa */}
          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
            <button
              type="button"
              className={`control-btn mute-toggle ${isMuted ? 'active' : ''}`}
              onClick={handleToggleMute}
              disabled={!activeTrack}
              title={isMuted ? 'Desmutear pista activa' : 'Silenciar pista activa (Mute)'}
              style={{
                width: '26px',
                height: '26px',
                fontSize: '0.68rem',
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
                width: '26px',
                height: '26px',
                fontSize: '0.68rem',
                fontWeight: 'bold',
                fontFamily: "'Share Tech Mono', monospace"
              }}
            >
              S
            </button>
          </div>

          {/* Botón + MIDI Track */}
          <button
            type="button"
            className="physical-btn"
            onClick={() => addMidiTrack()}
            title="Añadir nueva pista MIDI de patrones (Playlist)"
            style={{ gap: '4px', padding: '0 8px' }}
          >
            <Plus size={12} style={{ color: '#2dd4bf' }} />
            <MidiKeysMiniIcon color="#2dd4bf" size={11} />
            <span>MIDI</span>
          </button>

          {/* Botón + Audio Track */}
          <button
            type="button"
            className="physical-btn"
            onClick={() => addAudioTrack()}
            title="Añadir nueva pista de audio"
            style={{ gap: '4px', padding: '0 8px' }}
          >
            <Plus size={12} style={{ color: '#e5a93c' }} />
            <AudioWaveform size={12} style={{ color: '#e5a93c' }} />
            <span>AUDIO</span>
          </button>
        </>
      }
      center={
        <>
          {/* Herramientas de Playlist estilo FL Studio: Pincel · Navaja · Seleccionar */}
          <div className="physical-segment-tray" role="group" aria-label="Herramientas de Playlist">
            <button
              type="button"
              className={`physical-segment-btn ${playlistTool === 'paint' ? 'active' : ''}`}
              onClick={() => setPlaylistTool('paint')}
              title="Pincel / Pintar patrones (P · Clic pinta, arrastrar pinta varios compases)"
              aria-pressed={playlistTool === 'paint'}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${playlistTool === 'slice' ? 'active tool-slice-active' : ''}`}
              onClick={() => setPlaylistTool('slice')}
              title="Navaja / Cortar clips MIDI o Audio (C · Clic sobre un clip para dividir)"
              aria-pressed={playlistTool === 'slice'}
            >
              <Scissors size={12} />
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${playlistTool === 'select' ? 'active' : ''}`}
              onClick={() => setPlaylistTool('select')}
              title="Seleccionar múltiples clips por área (E · o Ctrl+Arrastrar)"
              aria-pressed={playlistTool === 'select'}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5.5 2.5 H3.8 A1.3 1.3 0 0 0 2.5 3.8 V5.5" />
                <path d="M10.5 2.5 H12.2 A1.3 1.3 0 0 1 13.5 3.8 V5.5" />
                <path d="M2.5 10.5 V12.2 A1.3 1.3 0 0 0 3.8 13.5 H5.5" />
                <path d="M13.5 10.5 V12.2 A1.3 1.3 0 0 1 12.2 13.5 H10.5" />
                <rect x="5.2" y="5.2" width="5.6" height="5.6" rx="1" fill="currentColor" fillOpacity="0.2" stroke="none" />
              </svg>
            </button>
          </div>

          {/* Grabación de Audio */}
          <button
            type="button"
            className={`physical-btn ${isRecordingAudio ? 'active' : ''}`}
            onClick={handleToggleRecord}
            title={isRecordingAudio ? 'Detener grabación (Tecla R)' : 'Grabar audio en pista armada (Tecla R)'}
            style={{
              borderColor: isRecordingAudio ? 'rgba(239, 68, 68, 0.7)' : undefined,
              color: isRecordingAudio ? '#fca5a5' : undefined
            }}
          >
            <Mic size={13} style={{ color: isRecordingAudio ? '#ef4444' : 'inherit' }} />
            <span>{isRecordingAudio ? 'DETENER' : 'REC'}</span>
            {isRecordingAudio && <span className="physical-led-dot lit-red" />}
          </button>

          {/* Importar Archivo de Audio */}
          <button
            type="button"
            className="physical-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Importar archivo de audio (WAV, MP3, FLAC, OGG)"
          >
            <Upload size={13} />
            <span>AUDIO</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* Split en cabezal */}
          <button
            type="button"
            className="physical-btn"
            onClick={handleSplitAtPlayhead}
            disabled={!canSplit}
            title={canSplit ? 'Dividir clip MIDI/Audio en el cabezal (Tecla S)' : 'Selecciona un clip o sitúa el cabezal sobre uno (Tecla S)'}
          >
            <Scissors size={13} />
            <span>SPLIT</span>
          </button>

          {/* Bandeja de Snap magnético (Compás / Beat / 1/2 / 1/4) */}
          <div className="physical-segment-tray" title="Ajuste magnético a la cuadrícula (Snap · Alt para libre)">
            <button
              type="button"
              className={`physical-segment-btn ${audioSnapGrid !== 'off' ? 'active' : ''}`}
              onClick={() => setAudioSnapGrid(audioSnapGrid === 'off' ? 'bar' : 'off')}
              title={audioSnapGrid === 'off' ? 'Activar ajuste magnético (Snap)' : 'Desactivar ajuste magnético (Snap)'}
            >
              <Magnet size={12} style={{ color: audioSnapGrid === 'off' ? 'var(--text-secondary)' : '#ffd875' }} />
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${audioSnapGrid === 'bar' ? 'active' : ''}`}
              onClick={() => setAudioSnapGrid('bar')}
              title="Ajuste por Compás (ideal para secuenciar patrones FL-style)"
              style={{ fontSize: '0.64rem', padding: '0 5px' }}
            >
              1C
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${audioSnapGrid === 'beat' ? 'active' : ''}`}
              onClick={() => setAudioSnapGrid('beat')}
              title="Ajuste a 1 beat (negra)"
              style={{ fontSize: '0.64rem', padding: '0 5px' }}
            >
              1
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${audioSnapGrid === '1/2' ? 'active' : ''}`}
              onClick={() => setAudioSnapGrid('1/2')}
              title="Ajuste a 1/2 beat"
              style={{ fontSize: '0.64rem', padding: '0 5px' }}
            >
              1/2
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${audioSnapGrid === '1/4' ? 'active' : ''}`}
              onClick={() => setAudioSnapGrid('1/4')}
              title="Ajuste a 1/4 beat"
              style={{ fontSize: '0.64rem', padding: '0 5px' }}
            >
              1/4
            </button>
          </div>
        </>
      }
      right={
        <>
          <div className="audio-display-badge" title="Posición actual del cabezal">
            <span>COMPÁS {measureNum}.{beatInMeasure}</span>
          </div>

          <button
            type="button"
            className="physical-btn"
            onClick={() => setIsLatencyModalOpen(true)}
            title="Calibración de latencia de interfaz de audio"
          >
            <Sliders size={13} />
            <span>{audioLatencyCalibrationMs}ms</span>
          </button>

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
