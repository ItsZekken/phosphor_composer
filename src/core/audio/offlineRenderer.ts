/**
 * offlineRenderer.ts
 * Motor de renderizado offline de alta velocidad con Tone.Offline y exportación directa a WAV.
 */

import * as Tone from 'tone';
import type { SessionV2 } from '../session';
import type { OfflineRenderOptions } from './audioTypes';
import { scheduleSessionTimeline } from './timelineScheduler';
import { audioBufferToWav } from '../../utils/wavEncoder';
import type { PatternDef } from '../../patterns/patternTypes';

/**
 * Renderiza una sesión completa de forma offline a velocidad máxima de CPU
 * y genera un Blob con formato WAV PCM estéreo de 16 bits.
 */
export async function renderSessionToWav(
  session: SessionV2,
  customPatterns: PatternDef[] = [],
  options: OfflineRenderOptions = {}
): Promise<Blob> {
  const scheduled = scheduleSessionTimeline(session, customPatterns);
  const totalDurationSeconds = Math.max(2, scheduled.totalDurationSeconds);

  if (options.onProgress) {
    options.onProgress(0, totalDurationSeconds);
  }

  const renderedBuffer = await Tone.Offline(async () => {
    // 1. Configurar Grafo de Audio Offline
    const masterVolume = new Tone.Volume(0).toDestination();

    const channels = session.mixer.channels || {};
    const channelNodes = new Map<string, { volumeNode: Tone.Volume; pannerNode: Tone.Panner }>();

    const getChannelNode = (channelId: string) => {
      let node = channelNodes.get(channelId);
      if (!node) {
        const ch = channels[channelId];
        const volDb = ch ? Tone.gainToDb(Math.max(0.001, ch.volume / 100)) : 0;
        const pan = ch ? ch.pan : 0;

        const volumeNode = new Tone.Volume(volDb);
        const pannerNode = new Tone.Panner(pan);
        volumeNode.connect(pannerNode);
        pannerNode.connect(masterVolume);

        node = { volumeNode, pannerNode };
        channelNodes.set(channelId, node);
      }
      return node;
    };

    // 2. Sintetizador de Acordes Offline
    const chordsNode = getChannelNode('chords');
    const chordFilter = new Tone.Filter({ type: 'lowpass', frequency: 12000, Q: 1 });
    const chordSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.08, decay: 0.3, sustain: 0.5, release: 0.8 }
    });
    chordSynth.connect(chordFilter);
    chordFilter.connect(chordsNode.volumeNode);
    chordSynth.volume.value = -6;

    // 3. Sintetizadores de Pistas de Melodía Offline
    const trackSynths = new Map<string, Tone.PolySynth>();
    const getTrackSynth = (channelId: string) => {
      let synth = trackSynths.get(channelId);
      if (!synth) {
        const chNode = getChannelNode(channelId);
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.04, decay: 0.2, sustain: 0.6, release: 0.4 }
        });
        const filter = new Tone.Filter({ type: 'lowpass', frequency: 8000, Q: 1 });
        synth.connect(filter);
        filter.connect(chNode.volumeNode);
        synth.volume.value = -4;
        trackSynths.set(channelId, synth);
      }
      return synth;
    };

    // 4. Sintetizadores de Batería Offline
    const drumsNode = getChannelNode('drums');
    const drumSynths = {
      kick: new Tone.MembraneSynth().connect(drumsNode.volumeNode),
      snare: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.2 }
      }).connect(drumsNode.volumeNode),
      hihatClosed: new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5
      }).connect(drumsNode.volumeNode),
      hihatOpen: new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.5, release: 0.1 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5
      }).connect(drumsNode.volumeNode)
    };

    // 5. Programar Eventos de Acordes
    scheduled.chordEvents.forEach(evt => {
      try {
        chordSynth.triggerAttackRelease(
          evt.note,
          Math.max(0.05, evt.durationSeconds),
          evt.timeSeconds,
          evt.velocity
        );
      } catch (_) {}
    });

    // 6. Programar Eventos de Melodía
    scheduled.trackEvents.forEach(evt => {
      try {
        const synth = getTrackSynth(evt.channelId);
        synth.triggerAttackRelease(
          evt.note,
          Math.max(0.05, evt.durationSeconds),
          evt.timeSeconds,
          evt.velocity
        );
      } catch (_) {}
    });

    // 7. Programar Eventos de Batería
    scheduled.drumEvents.forEach(evt => {
      try {
        const urlLower = evt.sampleUrl.toLowerCase();
        if (urlLower.includes('snare') || urlLower.includes('clap')) {
          drumSynths.snare.triggerAttackRelease('16n', evt.timeSeconds, evt.velocity);
        } else if (urlLower.includes('open')) {
          drumSynths.hihatOpen.triggerAttackRelease('16n', evt.timeSeconds, evt.velocity);
        } else if (urlLower.includes('hihat') || urlLower.includes('crash')) {
          drumSynths.hihatClosed.triggerAttackRelease('16n', evt.timeSeconds, evt.velocity);
        } else {
          drumSynths.kick.triggerAttackRelease('C1', '8n', evt.timeSeconds, evt.velocity);
        }
      } catch (_) {}
    });

  }, totalDurationSeconds);

  if (options.onProgress) {
    options.onProgress(totalDurationSeconds, totalDurationSeconds);
  }

  // 8. Convertir el AudioBuffer a archivo WAV PCM de 16 bits
  const wavArrayBuffer = audioBufferToWav(renderedBuffer.get() as AudioBuffer);
  return new Blob([wavArrayBuffer], { type: 'audio/wav' });
}
