import React, { useRef, useEffect } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { liveTelemetryBus } from '../../core/audio/liveTelemetryBus';
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

export const ChannelActivityDeck: React.FC = React.memo(() => {
  const channels = useSongStore((state) => state.channels);
  const channelOrder = useSongStore((state) => state.channelOrder);
  const toggleMute = useSongStore((state) => state.toggleMute);
  const toggleSolo = useSongStore((state) => state.toggleSolo);

  const activeChannels = React.useMemo(() => {
    const list: ChannelConfig[] = [];
    (channelOrder || Object.keys(channels)).forEach((id) => {
      if (channels[id]) list.push(channels[id]);
    });
    return list;
  }, [channels, channelOrder]);

  const meterRefs = useRef<Map<string, { el: HTMLDivElement; color: string }>>(new Map());
  const smoothLevelsRef = useRef<Map<string, number>>(new Map());
  const chordPillContainersRef = useRef<Set<HTMLDivElement>>(new Set());
  const melodyPillContainersRef = useRef<Set<HTMLDivElement>>(new Set());

  // Un solo bucle RAF compartido para todos los vúmetros del deck usando transform: scaleX() (GPU)
  useEffect(() => {
    let animId = 0;

    const updateMeters = () => {
      meterRefs.current.forEach(({ el, color }, channelId) => {
        const rawDb = toneEngine.getChannelMeterLevel(channelId);
        const targetNorm = rawDb === -Infinity ? 0 : Math.max(0, Math.min(1, (rawDb + 60) / 60));
        const prev = smoothLevelsRef.current.get(channelId) || 0;
        const next = targetNorm > prev ? targetNorm : prev * 0.88;
        const clamped = next < 0.005 ? 0 : next;
        smoothLevelsRef.current.set(channelId, clamped);

        el.style.transform = `scaleX(${clamped.toFixed(3)})`;
        if (clamped > 0.95) {
          el.style.backgroundColor = '#e04060';
        } else if (clamped > 0.8) {
          el.style.backgroundColor = '#e88c42';
        } else {
          el.style.backgroundColor = color;
        }
      });
      animId = requestAnimationFrame(updateMeters);
    };

    animId = requestAnimationFrame(updateMeters);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Suscripción imperativa a liveTelemetryBus para badges de notas activas sin re-renders en React
  useEffect(() => {
    const syncContainers = (containers: Set<HTMLDivElement>, notes: string[]) => {
      containers.forEach((container) => {
        const pills = container.children;
        for (let i = 0; i < pills.length; i++) {
          const pill = pills[i] as HTMLElement;
          if (i < notes.length) {
            if (pill.textContent !== notes[i]) pill.textContent = notes[i];
            if (pill.style.display !== 'inline-flex') pill.style.display = 'inline-flex';
          } else if (pill.style.display !== 'none') {
            pill.style.display = 'none';
          }
        }
      });
    };

    return liveTelemetryBus.subscribeActiveNotes(({ harmony, melody }) => {
      syncContainers(chordPillContainersRef.current, harmony);
      syncContainers(melodyPillContainersRef.current, melody);
    }, true);
  }, []);

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
        const color = ch.color || '#5a9e7a';
        const isChordChannel = ch.id === 'chords' || ch.type === 'chord' || ch.type === 'chords';
        const isMelodyChannel = !isChordChannel && ch.id !== 'drums' && ch.id !== 'master';

        return (
          <div
            key={ch.id}
            className={`stage-channel-card ${isMuted ? 'muted' : ''} ${isSolo ? 'solo' : ''}`}
            style={{
              borderColor: isSolo ? ch.color : undefined
            }}
          >
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

            <div className="stage-channel-meter-bg">
              <div
                ref={(el) => {
                  if (el) {
                    meterRefs.current.set(ch.id, { el, color });
                  } else {
                    meterRefs.current.delete(ch.id);
                  }
                }}
                className="stage-channel-meter-fill"
                style={{ width: '100%', transformOrigin: 'left center', transform: 'scaleX(0)' }}
              />
            </div>

            <div
              ref={(el) => {
                if (isChordChannel) {
                  if (el) chordPillContainersRef.current.add(el);
                } else if (isMelodyChannel) {
                  if (el) melodyPillContainersRef.current.add(el);
                }
              }}
              className="stage-channel-notes"
            >
              {(isChordChannel || isMelodyChannel) && [0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="stage-note-pill"
                  style={{
                    display: 'none',
                    backgroundColor: `${ch.color}22`,
                    borderColor: ch.color,
                    color: ch.color
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
});
