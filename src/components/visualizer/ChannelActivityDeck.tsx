import React, { useRef, useEffect } from 'react';
import { useSongStore } from '../../store/songStore';
import { useVisualizerAudioData } from './hooks/useVisualizerAudioData';
import {
  Volume2,
  VolumeX,
  Headphones,
  Music,
  Piano,
  Drum,
  Sliders,
  Sparkles
} from 'lucide-react';
import type { ChannelConfig } from '../../utils/typeDefinitions';

const ChannelMeterBar: React.FC<{ channelId: string; color: string; getLevel: (id: string) => number }> = React.memo(({
  channelId,
  color,
  getLevel
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let animId: number;

    const update = () => {
      if (barRef.current) {
        const level = getLevel(channelId);
        const percent = Math.min(100, Math.max(0, level * 100));
        barRef.current.style.width = `${percent}%`;

        // Cambio de color al acercarse a 0 dB
        if (level > 0.95) {
          barRef.current.style.backgroundColor = '#e04060';
        } else if (level > 0.8) {
          barRef.current.style.backgroundColor = '#e88c42';
        } else {
          barRef.current.style.backgroundColor = color;
        }
      }
      animId = requestAnimationFrame(update);
    };

    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, [channelId, color, getLevel]);

  return (
    <div className="stage-channel-meter-bg">
      <div ref={barRef} className="stage-channel-meter-fill" />
    </div>
  );
});

export const ChannelActivityDeck: React.FC = React.memo(() => {
  const channels = useSongStore((state) => state.channels);
  const channelOrder = useSongStore((state) => state.channelOrder);
  const toggleMute = useSongStore((state) => state.toggleMute);
  const toggleSolo = useSongStore((state) => state.toggleSolo);
  const activeNotes = useSongStore((state) => state.activeNotes);
  const activeMelodyNotes = useSongStore((state) => state.activeMelodyNotes);
  const { getChannelLevelSmooth } = useVisualizerAudioData();

  // Obtener lista ordenada de canales activos
  const activeChannels = React.useMemo(() => {
    const list: ChannelConfig[] = [];
    (channelOrder || Object.keys(channels)).forEach((id) => {
      if (channels[id]) list.push(channels[id]);
    });
    return list;
  }, [channels, channelOrder]);

  const getChannelIcon = (ch: ChannelConfig) => {
    if (ch.id === 'master') return <Sliders size={13} />;
    if (ch.id === 'chords' || ch.type === 'chord' || ch.type === 'chords') return <Piano size={13} />;
    if (ch.id === 'drums' || ch.type === 'drums') return <Drum size={13} />;
    if (ch.instrument === 'piano') return <Piano size={13} />;
    if (ch.type === 'melody' || ch.type === 'synth') return <Sparkles size={13} />;
    return <Music size={13} />;
  };

  return (
    <div className="stage-channel-deck">
      {activeChannels.map((ch) => {
        const isMuted = Boolean(ch.muted);
        const isSolo = Boolean(ch.solo);

        // Notas activas en este canal
        const isChordChannel = ch.id === 'chords' || ch.type === 'chord' || ch.type === 'chords';
        const isMelodyChannel = ch.id !== 'chords' && ch.id !== 'drums' && ch.id !== 'master';
        const channelActiveNotes = isChordChannel
          ? activeNotes
          : isMelodyChannel
          ? activeMelodyNotes
          : [];

        return (
          <div
            key={ch.id}
            className={`stage-channel-card ${isMuted ? 'muted' : ''} ${isSolo ? 'solo' : ''}`}
            style={{
              borderColor: isSolo ? ch.color : undefined
            }}
          >
            {/* Cabecera del canal: Icono, Color dot y Mute/Solo */}
            <div className="stage-channel-top">
              <div className="stage-channel-identity">
                <span
                  className="stage-channel-dot"
                  style={{
                    backgroundColor: ch.color,
                    boxShadow: `0 0 6px ${ch.color}`
                  }}
                />
                <span className="stage-channel-icon" style={{ color: ch.color }}>
                  {getChannelIcon(ch)}
                </span>
              </div>

              {/* Botones de acción rápida */}
              <div className="stage-channel-actions">
                <button
                  className={`stage-ch-btn ${isMuted ? 'active-mute' : ''}`}
                  onClick={() => toggleMute(ch.id)}
                  title="Mute"
                >
                  {isMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                </button>
                <button
                  className={`stage-ch-btn ${isSolo ? 'active-solo' : ''}`}
                  onClick={() => toggleSolo(ch.id)}
                  title="Solo"
                >
                  <Headphones size={11} />
                </button>
              </div>
            </div>

            {/* Medidor VU en tiempo real */}
            <ChannelMeterBar
              channelId={ch.id}
              color={ch.color || '#5a9e7a'}
              getLevel={getChannelLevelSmooth}
            />

            {/* Notas activas en vivo (sin texto explicativo) */}
            <div className="stage-channel-notes">
              {channelActiveNotes.slice(0, 3).map((note, i) => (
                <span
                  key={i}
                  className="stage-note-pill"
                  style={{
                    backgroundColor: `${ch.color}22`,
                    borderColor: ch.color,
                    color: ch.color
                  }}
                >
                  {note}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
});
