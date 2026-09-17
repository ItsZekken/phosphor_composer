/**
 * AudioTrackLane.tsx
 * Componentes modulares para la estación multitrack de pistas de audio:
 * - AudioTrackHeader: Panel de control de hardware de pista (izquierdo, fijo),
 *   con fader analógico calibrado en decibeles (-∞ a +24 dB, 0 dB en 75%),
 *   knob rotatorio analógico de paneo (L / C / R) con reseteo rápido por doble click,
 *   y botones Mute/Solo/Arm estilo consola analógica.
 * - AudioTrackLane: Carril de clips sobre la cuadrícula temporal (derecho, desplazable).
 */

import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import type { AudioTrack, AudioClip } from '../../utils/typeDefinitions';
import { useSongStore } from '../../store/songStore';
import { AudioClipComponent } from './AudioClipComponent';
import { Knob } from '../ui/Knob';
import { toneEngine } from '../../audio/toneEngine';
import {
  faderPosToDb,
  dbToFaderPos,
  normalizeTrackDb,
  formatDb
} from '../../core/audio/engine/audioTrackMath';

interface AudioTrackHeaderProps {
  track: AudioTrack;
  liveRms?: number;
}

export const AudioTrackHeader: React.FC<AudioTrackHeaderProps> = ({
  track,
  liveRms = 0
}) => {
  const selectedTrackId = useSongStore((state) => state.selectedTrackId);
  const setSelectedTrackId = useSongStore((state) => state.setSelectedTrackId);
  const updateAudioTrack = useSongStore((state) => state.updateAudioTrack);
  const removeAudioTrack = useSongStore((state) => state.removeAudioTrack);
  const setArmedTrackId = useSongStore((state) => state.setArmedTrackId);
  const isPlaying = useSongStore((state) => state.isPlaying);

  const [trackName, setTrackName] = useState(track.name);
  const [playbackRms, setPlaybackRms] = useState(0);
  const isSelected = selectedTrackId === track.id;

  const trackDb = normalizeTrackDb(track.volume);
  const faderPos = dbToFaderPos(trackDb);

  // Vúmetro en tiempo real durante la reproducción
  useEffect(() => {
    if (!isPlaying) {
      setPlaybackRms(0);
      return;
    }

    let animId: number;
    const updateMeter = () => {
      const db = toneEngine.getChannelMeterLevel(track.id);
      if (isFinite(db) && db > -60) {
        const linear = Math.pow(10, db / 20);
        setPlaybackRms((prev) => prev * 0.65 + linear * 0.35);
      } else {
        setPlaybackRms((prev) => Math.max(0, prev * 0.82));
      }
      animId = requestAnimationFrame(updateMeter);
    };

    animId = requestAnimationFrame(updateMeter);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, track.id]);

  const handleNameBlur = () => {
    if (trackName.trim()) {
      updateAudioTrack(track.id, { name: trackName.trim() });
    } else {
      setTrackName(track.name);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNameBlur();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setTrackName(track.name);
      e.currentTarget.blur();
    }
  };

  const handleVolumeChange = (pos: number) => {
    const newDb = faderPosToDb(pos);
    updateAudioTrack(track.id, { volume: newDb });
  };

  const handleVolumeReset = () => {
    updateAudioTrack(track.id, { volume: 0 }); // 0.0 dB
  };

  const handlePanChange = (panVal: number) => {
    const snapped = Math.abs(panVal) < 0.05 ? 0 : Math.round(panVal * 100) / 100;
    updateAudioTrack(track.id, { pan: snapped });
  };

  const handlePanReset = () => {
    updateAudioTrack(track.id, { pan: 0 });
  };

  const panTooltip =
    track.pan === 0
      ? 'Paneo: Centro'
      : track.pan < 0
      ? `Paneo: L${Math.round(track.pan * -100)}%`
      : `Paneo: R${Math.round(track.pan * 100)}%`;

  const volTooltip = `Volumen: ${formatDb(trackDb)} dB (0 dB al 75%)`;
  const effectiveRms = track.isArmed ? liveRms : playbackRms;
  const vuHeightPercent = Math.min(100, Math.round(effectiveRms * 280));

  return (
    <div
      className={`audio-track-header ${isSelected ? 'selected' : ''}`}
      onClick={() => setSelectedTrackId(track.id)}
      style={{ '--channel-color': track.color } as React.CSSProperties}
    >
      {/* Tira indicadora de color de canal en el borde izquierdo */}
      <div className="audio-track-color-strip" style={{ backgroundColor: track.color }} />

      {/* Identificador: Badge de color, Nombre editable y Botón eliminar */}
      <div className="audio-track-title-strip" onClick={(e) => e.stopPropagation()}>
        <span className="audio-track-badge" style={{ backgroundColor: track.color }} />
        <input
          className="audio-track-name-input"
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={handleNameKeyDown}
          title="Doble clic o escribe para renombrar"
        />
        <button
          type="button"
          className="audio-track-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            removeAudioTrack(track.id);
          }}
          title="Eliminar pista"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Controles analógicos estilo Drum Sequencer: Arm, VOL, PAN, M/S */}
      <div
        className="audio-track-hardware-controls"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Botón Armar Grabación */}
        <button
          type="button"
          className={`audio-arm-hardware-btn ${track.isArmed ? 'armed' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setArmedTrackId(track.isArmed ? null : track.id);
          }}
          title={track.isArmed ? 'Pista armada para grabación (Desarmar)' : 'Armar pista para grabar'}
        >
          <span className="arm-dot">●</span>
        </button>

        {/* Knob de Volumen con calibración en dB */}
        <div className="audio-hardware-knob-wrapper" title={volTooltip}>
          <Knob
            value={faderPos}
            min={0}
            max={1}
            size={22}
            label="VOL"
            onChange={handleVolumeChange}
            onDoubleClick={handleVolumeReset}
          />
          <span className="audio-knob-readout">{formatDb(trackDb)}</span>
        </div>

        {/* Knob de Paneo estéreo L / C / R */}
        <div className="audio-hardware-knob-wrapper" title={panTooltip}>
          <Knob
            value={track.pan}
            min={-1}
            max={1}
            size={22}
            label="PAN"
            onChange={handlePanChange}
            onDoubleClick={handlePanReset}
          />
          <span className="audio-knob-readout">
            {track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.round(track.pan * -100)}` : `R${Math.round(track.pan * 100)}`}
          </span>
        </div>

        {/* Conmutadores Mute y Solo apilados verticalmente */}
        <div className="drum-mute-solo">
          <button
            type="button"
            className={`ms-btn ${track.muted ? 'active-mute' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              updateAudioTrack(track.id, { muted: !track.muted });
            }}
            title={track.muted ? 'Desmutear pista' : 'Silenciar pista (Mute)'}
          >
            M
          </button>
          <button
            type="button"
            className={`ms-btn ${track.solo ? 'active-solo' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              updateAudioTrack(track.id, { solo: !track.solo });
            }}
            title={track.solo ? 'Desactivar Solo' : 'Aislar pista (Solo)'}
          >
            S
          </button>
        </div>
      </div>

      {/* Tira LED de actividad / nivel en el borde derecho */}
      <div className="audio-track-activity-strip" title="Nivel de actividad de la pista">
        <div
          className="audio-track-activity-led"
          style={{
            height: `${vuHeightPercent}%`,
            backgroundColor: vuHeightPercent > 85 ? '#ff3b30' : track.color
          }}
        />
      </div>
    </div>
  );
};

interface AudioTrackLaneProps {
  track: AudioTrack;
  clips: AudioClip[];
  zoomLevel: number;
  totalWidth: number;
}

export const AudioTrackLane: React.FC<AudioTrackLaneProps> = ({
  track,
  clips,
  zoomLevel,
  totalWidth
}) => {
  const selectedClipIds = useSongStore((state) => state.selectedClipIds);
  const selectClip = useSongStore((state) => state.selectClip);
  const setSelectedTrackId = useSongStore((state) => state.setSelectedTrackId);
  const snapGrid = useSongStore((state) => state.audioSnapGrid);

  const handleLaneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setSelectedTrackId(track.id);
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const rawBeat = clickX / zoomLevel;

      let step = 1;
      if (snapGrid === 'bar') step = 4;
      else if (snapGrid === 'beat') step = 1;
      else if (snapGrid === '1/2') step = 0.5;
      else if (snapGrid === '1/4') step = 0.25;
      else if (snapGrid === '1/8') step = 0.125;
      else if (snapGrid === '1/16') step = 0.0625;
      else if (snapGrid === 'off') step = 0;

      const targetBeat = step > 0 ? Math.max(0, Math.round(rawBeat / step) * step) : Math.max(0, rawBeat);
      toneEngine.seekToBeat(targetBeat);
    }
  };

  return (
    <div
      className="audio-track-lane"
      data-track-id={track.id}
      style={{ width: totalWidth, minWidth: totalWidth }}
      onClick={handleLaneClick}
    >
      {clips.map((clip) => (
        <AudioClipComponent
          key={clip.id}
          clip={clip}
          track={track}
          zoomLevel={zoomLevel}
          isSelected={selectedClipIds.includes(clip.id)}
          onSelect={(e) => selectClip(clip.id, e.shiftKey || e.ctrlKey || e.metaKey)}
        />
      ))}
    </div>
  );
};
