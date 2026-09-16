/**
 * AudioTrackLane.tsx
 * Componentes modulares para la estación multitrack de pistas de audio:
 * - AudioTrackHeader: Panel de control de hardware de pista (izquierdo, fijo),
 *   con fader analógico calibrado en decibeles (-∞ a +24 dB, 0 dB en 75%),
 *   knob rotatorio analógico de paneo (L / C / R) con reseteo rápido por doble click,
 *   y botones Mute/Solo/Arm estilo consola analógica.
 * - AudioTrackLane: Carril de clips sobre la cuadrícula temporal (derecho, desplazable).
 */

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AudioTrack, AudioClip } from '../../utils/typeDefinitions';
import { useSongStore } from '../../store/songStore';
import { AudioClipComponent } from './AudioClipComponent';
import { Knob } from '../ui/Knob';
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

  const [trackName, setTrackName] = useState(track.name);
  const isSelected = selectedTrackId === track.id;

  const trackDb = normalizeTrackDb(track.volume);
  const faderPos = dbToFaderPos(trackDb);

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
  const vuHeightPercent = Math.min(100, Math.round(liveRms * 280));

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
        <div title={volTooltip}>
          <Knob
            value={faderPos}
            min={0}
            max={1}
            size={24}
            label="VOL"
            onChange={handleVolumeChange}
            onDoubleClick={handleVolumeReset}
          />
        </div>

        {/* Knob de Paneo estéreo L / C / R */}
        <div title={panTooltip}>
          <Knob
            value={track.pan}
            min={-1}
            max={1}
            size={24}
            label="PAN"
            onChange={handlePanChange}
            onDoubleClick={handlePanReset}
          />
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
            height: `${track.isArmed ? Math.max(20, vuHeightPercent) : 0}%`,
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

  return (
    <div
      className="audio-track-lane"
      style={{ width: totalWidth, minWidth: totalWidth }}
      onClick={() => setSelectedTrackId(track.id)}
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
