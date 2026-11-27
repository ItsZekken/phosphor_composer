/**
 * AudioTracksToolbar.tsx
 * Barra superior unificada para la vista TRACKS 1:1 de Phosphor
 * (Armonía / Piano Roll / Batería / Audio Multitrack).
 */

import React, { useMemo, useRef } from 'react';
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
import { reconcileTrackRegions } from '../../core/audio/melodyRegionUtils';
import {
  getEffectiveDrumLaneCount,
  normalizePatternChainToLinear
} from '../../utils/typeDefinitions';

export const AudioTracksToolbar: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    chordBlocks,
    tracks,
    patternChain,
    drumLaneCount,
    drumLaneMuted,
    audioTracks,
    audioClips,
    channels,
    bpm,
    timeSignature,
    selectedPlaylistTrack,
    selectedTrackId,
    selectedChordIds,
    selectedMelodyRegionRefs,
    selectedChainIds,
    selectedClipIds,
    currentBeat,
    isRecordingAudio,
    armedTrackId,
    audioSnapGrid,
    audioTimelineViewport,
    audioLatencyCalibrationMs,
    playlistTool,
    isPickerOpen,
    toggleMute,
    toggleSolo,
    toggleMuteDrumLane,
    addPianoRollTrack,
    addAudioTrack,
    updateAudioTrack,
    addAudioClip,
    splitChordBlock,
    splitMelodyRegion,
    splitChainItem,
    splitAudioClip,
    setAudioSnapGrid,
    setAudioTimelineViewport,
    setIsLatencyModalOpen,
    startAudioRecording,
    stopAudioRecording,
    setPlaylistTool,
    setIsPickerOpen
  } = useSongStore(
    useShallow((state) => ({
      chordBlocks: state.chordBlocks || [],
      tracks: state.tracks || [],
      patternChain: state.patternChain || [],
      drumLaneCount: state.drumLaneCount || 1,
      drumLaneMuted: state.drumLaneMuted || [],
      audioTracks: state.audioTracks || [],
      audioClips: state.audioClips || [],
      channels: state.channels || {},
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      selectedPlaylistTrack: state.selectedPlaylistTrack,
      selectedTrackId: state.selectedTrackId,
      selectedChordIds: state.selectedChordIds || [],
      selectedMelodyRegionRefs: state.selectedMelodyRegionRefs || [],
      selectedChainIds: state.selectedChainIds || [],
      selectedClipIds: state.selectedClipIds || [],
      currentBeat: state.currentBeat,
      isRecordingAudio: state.isRecordingAudio,
      armedTrackId: state.armedTrackId,
      audioSnapGrid: state.audioSnapGrid,
      audioTimelineViewport: state.audioTimelineViewport,
      audioLatencyCalibrationMs: state.audioLatencyCalibrationMs,
      playlistTool: state.playlistTool,
      isPickerOpen: state.isPickerOpen,
      toggleMute: state.toggleMute,
      toggleSolo: state.toggleSolo,
      toggleMuteDrumLane: state.toggleMuteDrumLane,
      addPianoRollTrack: state.addPianoRollTrack,
      addAudioTrack: state.addAudioTrack,
      updateAudioTrack: state.updateAudioTrack,
      addAudioClip: state.addAudioClip,
      splitChordBlock: state.splitChordBlock,
      splitMelodyRegion: state.splitMelodyRegion,
      splitChainItem: state.splitChainItem,
      splitAudioClip: state.splitAudioClip,
      setAudioSnapGrid: state.setAudioSnapGrid,
      setAudioTimelineViewport: state.setAudioTimelineViewport,
      setIsLatencyModalOpen: state.setIsLatencyModalOpen,
      startAudioRecording: state.startAudioRecording,
      stopAudioRecording: state.stopAudioRecording,
      setPlaylistTool: state.setPlaylistTool,
      setIsPickerOpen: state.setIsPickerOpen
    }))
  );

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const currentMeasure = currentBeat / beatsPerMeasure;

  // Resolver pista activa (Armonía / Melodía / Batería / Audio) para M/S rápidos
  const activeTrackInfo = useMemo(() => {
    if (selectedPlaylistTrack.kind === 'harmony') {
      const ch = channels.chords;
      return {
        label: ch?.name || 'Acordes',
        muted: Boolean(ch?.muted),
        solo: Boolean(ch?.solo),
        toggleM: () => toggleMute('chords'),
        toggleS: () => toggleSolo('chords')
      };
    }
    if (selectedPlaylistTrack.kind === 'melody') {
      const tr = tracks.find((t) => t.id === selectedPlaylistTrack.trackId) || tracks[0];
      if (!tr) return null;
      const ch = channels[tr.channelId];
      return {
        label: tr.name,
        muted: Boolean(ch?.muted),
        solo: Boolean(ch?.solo),
        toggleM: () => toggleMute(tr.channelId),
        toggleS: () => toggleSolo(tr.channelId)
      };
    }
    if (selectedPlaylistTrack.kind === 'drums') {
      const ch = channels.drums;
      const effectiveDrumLanes = getEffectiveDrumLaneCount(patternChain, drumLaneCount);
      const laneIdx = Math.min(effectiveDrumLanes - 1, selectedPlaylistTrack.laneIndex ?? 0);
      const isMulti = effectiveDrumLanes > 1;
      const baseLabel = ch?.name || 'Batería';
      return {
        label: isMulti ? `${baseLabel} · C${laneIdx + 1}` : baseLabel,
        muted: isMulti ? Boolean(drumLaneMuted[laneIdx]) : Boolean(ch?.muted),
        solo: Boolean(ch?.solo),
        toggleM: () => (isMulti ? toggleMuteDrumLane(laneIdx) : toggleMute('drums')),
        toggleS: () => toggleSolo('drums')
      };
    }
    const audioTrack =
      audioTracks.find((t) => t.id === selectedPlaylistTrack.trackId) ||
      audioTracks.find((t) => t.id === selectedTrackId) ||
      audioTracks[0];
    if (!audioTrack) return null;
    return {
      label: audioTrack.name,
      muted: audioTrack.muted,
      solo: audioTrack.solo,
      toggleM: () => updateAudioTrack(audioTrack.id, { muted: !audioTrack.muted }),
      toggleS: () => updateAudioTrack(audioTrack.id, { solo: !audioTrack.solo })
    };
  }, [
    selectedPlaylistTrack,
    channels,
    tracks,
    patternChain,
    drumLaneCount,
    drumLaneMuted,
    audioTracks,
    selectedTrackId,
    toggleMute,
    toggleSolo,
    toggleMuteDrumLane,
    updateAudioTrack
  ]);

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

  // Resolver targets de Split unificado en el cabezal (Armonía + Melodías + Batería + Audio)
  const splitTargets = useMemo(() => {
    const linearDrums = normalizePatternChainToLinear(patternChain);
    const hasExplicitSelection =
      selectedChordIds.length > 0 ||
      selectedMelodyRegionRefs.length > 0 ||
      selectedChainIds.length > 0 ||
      selectedClipIds.length > 0;

    const chordsToSplit: string[] = [];
    const melodiesToSplit: Array<{ trackId: string; regionId: string }> = [];
    const drumsToSplit: string[] = [];
    const audiosToSplit: string[] = [];

    if (hasExplicitSelection) {
      for (const id of selectedChordIds) {
        const b = chordBlocks.find((c) => c.id === id);
        if (b && currentBeat > b.startBeat + 0.06 && currentBeat < b.startBeat + b.durationBeats - 0.06) {
          chordsToSplit.push(b.id);
        }
      }
      for (const ref of selectedMelodyRegionRefs) {
        const tr = tracks.find((t) => t.id === ref.trackId);
        if (!tr) continue;
        const reg = reconcileTrackRegions(tr.id, tr.notes, tr.regions, beatsPerMeasure).find(
          (r) => r.id === ref.regionId
        );
        if (reg && currentBeat > reg.startBeat + 0.06 && currentBeat < reg.startBeat + reg.durationBeats - 0.06) {
          melodiesToSplit.push(ref);
        }
      }
      for (const id of selectedChainIds) {
        const c = linearDrums.find((d) => d.id === id);
        if (c && currentMeasure > c.startMeasure + 0.05 && currentMeasure < c.startMeasure + c.durationMeasures - 0.05) {
          drumsToSplit.push(c.id);
        }
      }
      for (const id of selectedClipIds) {
        const c = audioClips.find((a) => a.id === id);
        if (
          c &&
          currentBeat > c.startBeat + 0.06 &&
          currentBeat < c.startBeat + (c.durationSeconds * bpm) / 60 - 0.06
        ) {
          audiosToSplit.push(c.id);
        }
      }
    } else if (selectedPlaylistTrack.kind === 'harmony') {
      const b = chordBlocks.find(
        (c) => currentBeat > c.startBeat + 0.06 && currentBeat < c.startBeat + c.durationBeats - 0.06
      );
      if (b) chordsToSplit.push(b.id);
    } else if (selectedPlaylistTrack.kind === 'melody') {
      const tr = tracks.find((t) => t.id === selectedPlaylistTrack.trackId);
      if (tr) {
        const reg = reconcileTrackRegions(tr.id, tr.notes, tr.regions, beatsPerMeasure).find(
          (r) => currentBeat > r.startBeat + 0.06 && currentBeat < r.startBeat + r.durationBeats - 0.06
        );
        if (reg) melodiesToSplit.push({ trackId: tr.id, regionId: reg.id });
      }
    } else if (selectedPlaylistTrack.kind === 'drums') {
      const laneIdx = selectedPlaylistTrack.laneIndex ?? 0;
      const c = linearDrums.find(
        (d) =>
          d.laneIndex === laneIdx &&
          currentMeasure > d.startMeasure + 0.05 &&
          currentMeasure < d.startMeasure + d.durationMeasures - 0.05
      );
      if (c) drumsToSplit.push(c.id);
    } else {
      const audioTrackId = selectedPlaylistTrack.trackId || selectedTrackId;
      const c = audioClips.find(
        (a) =>
          a.trackId === audioTrackId &&
          currentBeat > a.startBeat + 0.06 &&
          currentBeat < a.startBeat + (a.durationSeconds * bpm) / 60 - 0.06
      );
      if (c) audiosToSplit.push(c.id);
    }

    return { chordsToSplit, melodiesToSplit, drumsToSplit, audiosToSplit };
  }, [
    chordBlocks,
    tracks,
    patternChain,
    audioClips,
    bpm,
    beatsPerMeasure,
    currentBeat,
    currentMeasure,
    selectedPlaylistTrack,
    selectedTrackId,
    selectedChordIds,
    selectedMelodyRegionRefs,
    selectedChainIds,
    selectedClipIds
  ]);

  const canSplit =
    splitTargets.chordsToSplit.length > 0 ||
    splitTargets.melodiesToSplit.length > 0 ||
    splitTargets.drumsToSplit.length > 0 ||
    splitTargets.audiosToSplit.length > 0;

  const handleSplitAtPlayhead = () => {
    if (!canSplit) return;
    splitTargets.chordsToSplit.forEach((id) => splitChordBlock(id, currentBeat));
    splitTargets.melodiesToSplit.forEach((ref) =>
      splitMelodyRegion(ref.trackId, ref.regionId, currentBeat)
    );
    splitTargets.drumsToSplit.forEach((id) => splitChainItem(id, currentMeasure));
    splitTargets.audiosToSplit.forEach((id) => splitAudioClip(id, currentBeat));
  };

  const measureNum = Math.floor(currentBeat / beatsPerMeasure) + 1;
  const beatInMeasure = Math.floor(currentBeat % beatsPerMeasure) + 1;

  return (
    <UnifiedToolbar
      left={
        <>
          {/* Toggle Panel Paleta & Patrones */}
          <button
            type="button"
            className={`physical-btn ${isPickerOpen ? 'active' : ''}`}
            onClick={() => setIsPickerOpen(!isPickerOpen)}
            title={
              isPickerOpen
                ? 'Ocultar panel de Acordes, Patrones y Audio'
                : 'Mostrar panel de Acordes, Patrones y Audio'
            }
          >
            <PanelLeft size={13} style={{ color: isPickerOpen ? '#ffd875' : 'var(--text-secondary)' }} />
          </button>

          {/* Botones M y S rápidos para la pista activa */}
          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
            <button
              type="button"
              className={`control-btn mute-toggle ${activeTrackInfo?.muted ? 'active' : ''}`}
              onClick={() => activeTrackInfo?.toggleM()}
              disabled={!activeTrackInfo}
              title={
                activeTrackInfo
                  ? activeTrackInfo.muted
                    ? `Desmutear ${activeTrackInfo.label}`
                    : `Silenciar ${activeTrackInfo.label} (Mute)`
                  : 'Silenciar pista activa'
              }
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
              className={`control-btn solo-toggle ${activeTrackInfo?.solo ? 'active' : ''}`}
              onClick={() => activeTrackInfo?.toggleS()}
              disabled={!activeTrackInfo}
              title={
                activeTrackInfo
                  ? activeTrackInfo.solo
                    ? `Desactivar Solo de ${activeTrackInfo.label}`
                    : `Aislar ${activeTrackInfo.label} (Solo)`
                  : 'Aislar pista activa'
              }
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

          {/* Botón + Melodía (Piano Roll 1:1) */}
          <button
            type="button"
            className="physical-btn"
            onClick={() => addPianoRollTrack()}
            title="Añadir nuevo canal de Piano Roll (sincronizado 1:1 con Tracks y Mixer)"
            style={{ gap: '4px', padding: '0 8px' }}
          >
            <Plus size={12} style={{ color: '#a78bfa' }} />
            <MidiKeysMiniIcon color="#a78bfa" size={11} />
            <span>MELODÍA</span>
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
          {/* Herramientas de Tracks: Pincel · Navaja · Seleccionar */}
          <div className="physical-segment-tray" role="group" aria-label="Herramientas de Tracks">
            <button
              type="button"
              className={`physical-segment-btn ${playlistTool === 'paint' ? 'active' : ''}`}
              onClick={() => setPlaylistTool('paint')}
              title="Pincel (P · Clic pinta acordes en Armonía o patrones en Batería; arrastrar pinta varios compases)"
              aria-pressed={playlistTool === 'paint'}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${playlistTool === 'slice' ? 'active tool-slice-active' : ''}`}
              onClick={() => setPlaylistTool('slice')}
              title="Navaja / Cortar bloques de Armonía, regiones de Piano Roll, Batería o Audio (C)"
              aria-pressed={playlistTool === 'slice'}
            >
              <Scissors size={12} />
            </button>
            <button
              type="button"
              className={`physical-segment-btn ${playlistTool === 'select' ? 'active' : ''}`}
              onClick={() => setPlaylistTool('select')}
              title="Seleccionar múltiples bloques y clips por área (E · o Ctrl+Arrastrar)"
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
            title={
              canSplit
                ? 'Dividir bloque/región/clip en el cabezal (Tecla S)'
                : 'Sitúa el cabezal dentro de un bloque o clip seleccionado (Tecla S)'
            }
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
              title="Ajuste por Compás"
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
