/**
 * offlineRenderer.ts
 * Motor de renderizado offline de alta fidelidad con Tone.Offline y exportación a WAV / MP3.
 * Garantiza paridad acústica 1:1 con el playback en tiempo real:
 * - Síntesis analógica multi-oscilador y filtros VCF.
 * - Sampler acústico de Piano interpolado con buffers compartidos.
 * - Envolventes de sustain, dinámicas de velocidad por nota y faders en dB.
 * - Ruteo estéreo explícito y paneo individual por canal y golpe de batería.
 */

import * as Tone from 'tone';
import type { SessionV2 } from '../session';
import type { OfflineRenderOptions } from './audioTypes';
import { scheduleSessionTimeline } from './timelineScheduler';
import { audioBufferToWav } from '../../utils/wavEncoder';
import { audioBufferToMp3BlobAsync, type Mp3EncodeResult } from '../../utils/mp3Encoder';
import { audioBufferToM4aBlobAsync } from '../../utils/m4aEncoder';
import type { PatternDef } from '../../patterns/patternTypes';
import type { SynthSettings } from '../../utils/typeDefinitions';
import { PIANO_URLS, PIANO_BASE_URL, preloadPianoBuffers, getSharedPianoBuffers } from './pianoSampler';
import { PhosphorAnalogSynth } from './engine/PhosphorAnalogSynth';
import { normalizeSynthSettings } from './engine/synthPresets';
import { faderToDb } from './engine/MixerGraph';
import { normalizeTrackDb } from './engine/audioTrackMath';
import { audioBufferRegistry } from './audioBufferRegistry';
import { createTempoMap } from '../music';

/**
 * Renderiza una sesión completa de forma offline a velocidad máxima de CPU
 * y devuelve el AudioBuffer nativo decodificado.
 */
export async function renderSessionToAudioBuffer(
  session: SessionV2,
  customPatterns: PatternDef[] = [],
  options: OfflineRenderOptions = {}
): Promise<AudioBuffer> {
  const scheduled = scheduleSessionTimeline(session, customPatterns);
  const totalDurationSeconds = Math.max(2, scheduled.totalDurationSeconds);
  const sampleRate = options.sampleRate || 44100;

  if (options.onProgress) {
    options.onProgress(0, totalDurationSeconds);
  }

  const channels = session.mixer.channels || {};

  // 1. Precargar samples de Piano si algún canal tiene instrumento 'piano'
  const hasPiano = Object.values(channels).some((ch) => ch.instrument === 'piano');
  if (hasPiano) {
    try {
      await preloadPianoBuffers();
    } catch (_) {}
  }

  const sharedBuffers = getSharedPianoBuffers();

  const renderedBuffer = await Tone.Offline(async () => {
    // 2. Grafo Maestro de Audio Offline
    const masterCh = channels['master'];
    const masterVol = masterCh?.volume ?? 80;
    const masterPan = masterCh ? Math.max(-1, Math.min(1, masterCh.pan)) : 0;
    const masterDb = faderToDb(masterVol);

    const masterPanner = new Tone.Panner(masterPan).toDestination();
    const masterVolume = new Tone.Volume(masterDb).connect(masterPanner);
    if (masterCh?.muted) {
      masterVolume.mute = true;
    }

    const enforceStereo = (node: any) => {
      try {
        const raw = node.input || node.output || node._gainNode || node._panner || node;
        if (raw) {
          raw.channelCount = 2;
          raw.channelCountMode = 'explicit';
          raw.channelInterpretation = 'speakers';
        }
        if (node._panner) {
          node._panner.channelCount = 2;
          node._panner.channelCountMode = 'explicit';
          node._panner.channelInterpretation = 'speakers';
        }
      } catch (_) {}
    };

    enforceStereo(masterVolume);
    enforceStereo(masterPanner);

    // 3. Nodos de Canales Individuales
    const channelNodes = new Map<string, { volumeNode: Tone.Volume; pannerNode: Tone.Panner }>();

    const getChannelNode = (channelId: string) => {
      let node = channelNodes.get(channelId);
      if (!node) {
        const ch = channels[channelId];
        const audioTracks = (session as any).audio?.tracks || [];
        const audioTrack = audioTracks.find((t: any) => t.id === channelId);

        let volDb = 0;
        let pan = 0;
        let isMuted = false;

        if (ch) {
          volDb = faderToDb(ch.volume ?? 80);
          pan = Math.max(-1, Math.min(1, ch.pan ?? 0));
          isMuted = Boolean(ch.muted);
        } else if (audioTrack) {
          const trackDb = normalizeTrackDb(audioTrack.volume);
          volDb = trackDb <= -59 ? -Infinity : Math.min(24, trackDb);
          pan = Math.max(-1, Math.min(1, audioTrack.pan ?? 0));
          isMuted = Boolean(audioTrack.muted);
        }

        const volumeNode = new Tone.Volume(volDb);
        if (isMuted) {
          volumeNode.mute = true;
        }
        const pannerNode = new Tone.Panner(pan);
        enforceStereo(volumeNode);
        enforceStereo(pannerNode);

        volumeNode.connect(pannerNode);
        pannerNode.connect(masterVolume);

        node = { volumeNode, pannerNode };
        channelNodes.set(channelId, node);
      }
      return node;
    };

    // 4. Instanciación y Carga de Instrumentos por Canal
    const channelInstruments = new Map<string, any>();

    const getInstrumentForChannel = (channelId: string, defaultWave: 'triangle' | 'sine' = 'triangle') => {
      let instrument = channelInstruments.get(channelId);
      if (instrument) return instrument;

      const ch = channels[channelId];
      const chNode = getChannelNode(channelId);

      if (ch?.instrument === 'piano') {
        try {
          if (sharedBuffers && (sharedBuffers as any).loaded) {
            const bufferMap: Record<string, Tone.ToneAudioBuffer> = {};
            Object.keys(PIANO_URLS).forEach((note) => {
              if (sharedBuffers.has(note)) {
                bufferMap[note] = sharedBuffers.get(note);
              }
            });
            const sampler = new Tone.Sampler({ urls: bufferMap }).connect(chNode.volumeNode);
            instrument = sampler;
          } else {
            const sampler = new Tone.Sampler({
              urls: PIANO_URLS,
              baseUrl: PIANO_BASE_URL
            }).connect(chNode.volumeNode);
            instrument = sampler;
          }
        } catch (_) {
          const pianoSynth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.005, decay: 1.2, sustain: 0.2, release: 0.8 }
          }).connect(chNode.volumeNode);
          pianoSynth.volume.value = -4.4;
          instrument = pianoSynth;
        }
      } else {
        const synthSettings: SynthSettings = normalizeSynthSettings(ch?.synthSettings || { waveType: defaultWave });
        const analogSynth = new PhosphorAnalogSynth(channelId, synthSettings, chNode.volumeNode);
        enforceStereo(analogSynth.outputNode);
        instrument = analogSynth;
      }

      channelInstruments.set(channelId, instrument);
      return instrument;
    };

    // Inicializar instrumento de acordes
    const chordVoice = getInstrumentForChannel('chords', 'triangle');

    // 5. Sintetizadores de Batería de Respaldo Offline
    const drumsNode = getChannelNode('drums');
    const drumSynths = {
      kick: new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 6,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.3 }
      }).connect(drumsNode.volumeNode),
      snare: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 }
      }).connect(drumsNode.volumeNode),
      hihatClosed: new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.08, release: 0.01 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5
      }).connect(drumsNode.volumeNode),
      hihatOpen: new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.45, release: 0.1 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5
      }).connect(drumsNode.volumeNode)
    };

    // 6. Programar Eventos de Acordes
    scheduled.chordEvents.forEach((evt) => {
      try {
        chordVoice.triggerAttackRelease(
          evt.note,
          Math.max(0.05, evt.durationSeconds),
          evt.timeSeconds,
          evt.velocity
        );
      } catch (_) {}
    });

    // 7. Programar Eventos de Pistas Melódicas del Piano Roll
    scheduled.trackEvents.forEach((evt) => {
      try {
        const voice = getInstrumentForChannel(evt.channelId, 'triangle');
        voice.triggerAttackRelease(
          evt.note,
          Math.max(0.05, evt.durationSeconds),
          evt.timeSeconds,
          evt.velocity
        );
      } catch (_) {}
    });

    // 8. Programar Eventos de Batería (Optimizado: Reutilización de panners y fuentes ligeras)
    const drumBuffers = options.drumBuffers;
    const drumChannelPanners = new Map<string, Tone.Panner>();

    const getDrumPanner = (channelId: string, panVal: number) => {
      let p = drumChannelPanners.get(channelId);
      if (!p) {
        p = new Tone.Panner(Math.max(-1, Math.min(1, panVal || 0))).connect(drumsNode.volumeNode);
        enforceStereo(p);
        drumChannelPanners.set(channelId, p);
      }
      return p;
    };

    scheduled.drumEvents.forEach((evt) => {
      try {
        const sampleUrl = evt.sampleUrl;
        const cachedBuffer = drumBuffers ? drumBuffers.get(sampleUrl) : null;

        if (cachedBuffer && cachedBuffer.loaded) {
          const panner = getDrumPanner(evt.channelId, evt.pan || 0);
          const gainFactor = (evt.volume / 100) * evt.velocity;
          const source = new Tone.ToneBufferSource(cachedBuffer);
          source.connect(panner);
          source.start(evt.timeSeconds, 0, undefined, gainFactor);
        } else {
          // Fallback a síntesis percusiva calibrada
          const urlLower = (sampleUrl || '').toLowerCase();
          if (urlLower.includes('snare') || urlLower.includes('clap')) {
            drumSynths.snare.triggerAttackRelease('16n', evt.timeSeconds, evt.velocity);
          } else if (urlLower.includes('open')) {
            drumSynths.hihatOpen.triggerAttackRelease('16n', evt.timeSeconds, evt.velocity);
          } else if (urlLower.includes('hihat') || urlLower.includes('crash')) {
            drumSynths.hihatClosed.triggerAttackRelease('16n', evt.timeSeconds, evt.velocity);
          } else {
            drumSynths.kick.triggerAttackRelease('C1', '8n', evt.timeSeconds, evt.velocity);
          }
        }
      } catch (_) {}
    });

    // 9. Programar Pistas y Clips de Audio Multitrack
    const audioSession = (session as any).audio;
    if (audioSession?.clips && audioSession.clips.length > 0) {
      const tempoMap = createTempoMap(session.transport.bpm, session.transport.tempoMarkers || []);
      const audioTracks = audioSession.tracks || [];
      const trackMap = new Map(audioTracks.map((t: any) => [t.id, t]));
      const anySolo = audioTracks.some((t: any) => t.solo);

      for (const clip of audioSession.clips) {
        if (clip.isMuted) continue;
        const track = trackMap.get(clip.trackId) as any;
        if (track?.muted) continue;
        if (anySolo && !track?.solo) continue;

        const buffer = audioBufferRegistry.getBuffer(clip.bufferId);
        if (!buffer) continue;

        const clipStartSec = tempoMap.beatToSeconds(clip.startBeat);
        const playDuration = clip.durationSeconds;
        const sourceOffset = clip.sourceOffsetSeconds;

        if (clipStartSec >= totalDurationSeconds) continue;

        try {
          const toneBuffer = new Tone.ToneAudioBuffer(buffer);
          const channelNode = getChannelNode(clip.trackId);
          const clipGain = clip.gain ?? 1.0;
          const clipVolDb = Tone.gainToDb(clipGain);
          const clipVolNode = new Tone.Volume(clipVolDb).connect(channelNode.volumeNode);
          enforceStereo(clipVolNode);

          const player = new Tone.Player(toneBuffer).connect(clipVolNode);
          player.fadeIn = Math.max(0.003, clip.fadeInSeconds || 0.003);
          player.fadeOut = Math.max(0.003, clip.fadeOutSeconds || 0.003);
          player.start(clipStartSec, sourceOffset, playDuration);
        } catch (_) {}
      }
    }

  }, totalDurationSeconds, 2, sampleRate);

  if (options.onProgress) {
    options.onProgress(totalDurationSeconds, totalDurationSeconds);
  }

  return renderedBuffer.get() as AudioBuffer;
}

import { renderSessionRealtime } from './realtimeRenderer';

export async function renderSessionToWav(
  session: SessionV2,
  customPatterns: PatternDef[] = [],
  options: OfflineRenderOptions = {}
): Promise<Blob> {
  let audioBuffer: AudioBuffer;
  if (options.realtime) {
    if (options.onPhase) options.onPhase('GRABANDO EN TIEMPO REAL...');
    const scheduled = scheduleSessionTimeline(session, customPatterns);
    const duration = Math.max(2, scheduled.totalDurationSeconds);
    audioBuffer = await renderSessionRealtime(duration, options.onProgress || (() => {}));
  } else {
    if (options.onPhase) options.onPhase('RENDERIZANDO AUDIO...');
    audioBuffer = await renderSessionToAudioBuffer(session, customPatterns, {
      ...options,
      sampleRate: options.sampleRate || 44100
    });
  }

  if (options.onPhase) {
    options.onPhase('CODIFICANDO WAV...');
  }
  const wavArrayBuffer = audioBufferToWav(audioBuffer, {
    normalize: options.normalize !== false,
    targetPeakDb: options.targetPeakDb ?? -0.3
  });

  return new Blob([wavArrayBuffer], { type: 'audio/wav' });
}

/**
 * Renderiza una sesión completa y la comprime en segundo plano a formato MP3/M4A.
 */
export async function renderSessionToCompressed(
  session: SessionV2,
  customPatterns: PatternDef[] = [],
  options: OfflineRenderOptions & { format?: 'mp3' | 'm4a' } = {}
): Promise<Mp3EncodeResult | { blob: Blob; extension: string; mimeType: string }> {
  let audioBuffer: AudioBuffer;
  if (options.realtime) {
    if (options.onPhase) options.onPhase('GRABANDO EN TIEMPO REAL...');
    const scheduled = scheduleSessionTimeline(session, customPatterns);
    const duration = Math.max(2, scheduled.totalDurationSeconds);
    audioBuffer = await renderSessionRealtime(duration, options.onProgress || (() => {}));
  } else {
    if (options.onPhase) options.onPhase('RENDERIZANDO AUDIO...');
    audioBuffer = await renderSessionToAudioBuffer(session, customPatterns, {
      ...options,
      sampleRate: options.sampleRate || 44100
    });
  }

  const isM4a = options.format === 'm4a';

  if (isM4a) {
    if (options.onPhase) options.onPhase('COMPRIMIENDO M4A...');
    return audioBufferToM4aBlobAsync(audioBuffer, {
      bitrate: 128,
      onProgress: (p) => {
        if (options.onProgress) {
          options.onProgress(p, 1);
        }
      },
      onPhase: options.onPhase
    });
  } else {
    if (options.onPhase) options.onPhase('COMPRIMIENDO MP3...');
    return audioBufferToMp3BlobAsync(audioBuffer, {
      bitrate: 256,
      normalize: options.normalize !== false,
      targetPeakDb: options.targetPeakDb ?? -0.3,
      onProgress: (p) => {
        if (options.onProgress) {
          options.onProgress(p, 1);
        }
      },
      onPhase: options.onPhase
    });
  }
}
