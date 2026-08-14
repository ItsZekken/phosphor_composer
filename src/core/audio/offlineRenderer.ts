/**
 * offlineRenderer.ts
 * Motor de renderizado offline de alta fidelidad con Tone.Offline y exportación a WAV / OGG / WebM.
 * Refleja exactamente la síntesis, envolventes ADSR, filtros VCF, sampler acústico de Piano,
 * paneo estéreo, volumen y balance de faders del mixer de Phosphor Composer.
 */

import * as Tone from 'tone';
import type { SessionV2 } from '../session';
import type { OfflineRenderOptions } from './audioTypes';
import { scheduleSessionTimeline } from './timelineScheduler';
import { audioBufferToWav } from '../../utils/wavEncoder';
import { audioBufferToCompressedBlob, type CompressedAudioResult } from '../../utils/compressedAudioEncoder';
import type { PatternDef } from '../../patterns/patternTypes';
import type { SynthSettings } from '../../utils/typeDefinitions';
import { PIANO_URLS, PIANO_BASE_URL, preloadPianoBuffers } from './pianoSampler';

/**
 * Convierte el valor de fader (0 a 100 con 80 = 0 dB) al valor en decibeles exacto del mixer.
 */
function faderToDb(volume: number): number {
  if (volume <= 0) return -Infinity;
  const db = ((volume - 80) / 80) * 30;
  return Math.max(-60, Math.min(6, db));
}

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

  if (options.onProgress) {
    options.onProgress(0, totalDurationSeconds);
  }

  const channels = session.mixer.channels || {};

  // 1. Precargar samples de Piano si algún canal tiene instrumento 'piano'
  const hasPiano = Object.values(channels).some(ch => ch.instrument === 'piano');
  if (hasPiano) {
    try {
      await preloadPianoBuffers();
    } catch (_) {}
  }

  const renderedBuffer = await Tone.Offline(async () => {
    // 2. Grafo Maestro de Audio Offline (Aplica fader y mute del Master)
    const masterCh = channels['master'];
    const masterVol = masterCh?.volume ?? 80;
    const masterDb = faderToDb(masterVol);
    const masterVolume = new Tone.Volume(masterDb).toDestination();
    if (masterCh?.muted) {
      masterVolume.mute = true;
    }

    const channelNodes = new Map<string, { volumeNode: Tone.Volume; pannerNode: Tone.Panner }>();

    const getChannelNode = (channelId: string) => {
      let node = channelNodes.get(channelId);
      if (!node) {
        const ch = channels[channelId];
        const volVal = ch?.volume ?? 80;
        const volDb = faderToDb(volVal);
        const pan = ch ? Math.max(-1, Math.min(1, ch.pan)) : 0;

        const volumeNode = new Tone.Volume(volDb);
        if (ch?.muted) {
          volumeNode.mute = true;
        }
        const pannerNode = new Tone.Panner(pan);
        volumeNode.connect(pannerNode);
        pannerNode.connect(masterVolume);

        node = { volumeNode, pannerNode };
        channelNodes.set(channelId, node);
      }
      return node;
    };

    // 3. Creador de Instrumentos (Piano Sampler / Sintetizadores VCF)
    const channelInstruments = new Map<string, any>();

    // Instanciar y esperar a que los samplers de piano estén listos dentro del contexto offline
    for (const chId of Object.keys(channels)) {
      const ch = channels[chId];
      if (ch?.instrument === 'piano') {
        const chNode = getChannelNode(chId);
        try {
          await new Promise<void>((resolve) => {
            const sampler = new Tone.Sampler({
              urls: PIANO_URLS,
              baseUrl: PIANO_BASE_URL,
              onload: () => {
                channelInstruments.set(chId, sampler);
                resolve();
              },
              onerror: () => {
                resolve();
              }
            }).connect(chNode.volumeNode);
            channelInstruments.set(chId, sampler);
            setTimeout(resolve, 2500);
          });
        } catch (_) {
          const pianoSynth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.005, decay: 1.2, sustain: 0.2, release: 0.8 }
          }).connect(chNode.volumeNode);
          pianoSynth.volume.value = -6;
          channelInstruments.set(chId, pianoSynth);
        }
      }
    }

    const getInstrumentForChannel = (channelId: string, defaultWave: 'triangle' | 'sine' = 'triangle') => {
      let instrument = channelInstruments.get(channelId);
      if (instrument) return instrument;

      const ch = channels[channelId];
      const chNode = getChannelNode(channelId);

      // Si el canal está configurado como Piano Acústico pero no se precargó
      if (ch?.instrument === 'piano') {
        try {
          const pianoSampler = new Tone.Sampler({
            urls: PIANO_URLS,
            baseUrl: PIANO_BASE_URL
          }).connect(chNode.volumeNode);

          instrument = pianoSampler;
          channelInstruments.set(channelId, pianoSampler);
          return pianoSampler;
        } catch (_) {
          const pianoSynth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.005, decay: 1.2, sustain: 0.2, release: 0.8 }
          }).connect(chNode.volumeNode);
          pianoSynth.volume.value = -6;

          instrument = pianoSynth;
          channelInstruments.set(channelId, pianoSynth);
          return pianoSynth;
        }
      }

      // Si el canal está configurado como Sintetizador Virtual
      const synthSettings: SynthSettings = ch?.synthSettings || {
        waveType: defaultWave,
        detune: 0,
        envelope: { attack: 0.04, decay: 0.2, sustain: 0.5, release: 0.6 },
        filter: { enabled: true, type: 'lowpass', frequency: 12000, Q: 1 }
      };

      // Configurar Filtro VCF por Canal
      let filter: Tone.Filter;
      if (synthSettings.filter && synthSettings.filter.enabled !== false) {
        filter = new Tone.Filter({
          type: synthSettings.filter.type || 'lowpass',
          frequency: Math.max(20, Math.min(20000, synthSettings.filter.frequency || 12000)),
          Q: Math.max(0.1, Math.min(20, synthSettings.filter.Q || 1))
        });
      } else {
        filter = new Tone.Filter({
          type: 'lowpass',
          frequency: 20000,
          Q: 1
        });
      }
      filter.connect(chNode.volumeNode);

      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: synthSettings.waveType || defaultWave },
        envelope: {
          attack: Math.max(0.001, synthSettings.envelope?.attack ?? 0.04),
          decay: Math.max(0.001, synthSettings.envelope?.decay ?? 0.2),
          sustain: Math.max(0, Math.min(1, synthSettings.envelope?.sustain ?? 0.5)),
          release: Math.max(0.001, synthSettings.envelope?.release ?? 0.5)
        },
        detune: synthSettings.detune || 0
      });

      synth.connect(filter);
      synth.volume.value = channelId === 'chords' ? -10 : -6;

      instrument = synth;
      channelInstruments.set(channelId, synth);
      return synth;
    };

    // 4. Instanciar Instrumento de Acordes
    const chordVoice = getInstrumentForChannel('chords', 'triangle');

    // 5. Sintetizadores y Samplers de Batería Offline
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
    scheduled.chordEvents.forEach(evt => {
      try {
        chordVoice.triggerAttackRelease(
          evt.note,
          Math.max(0.05, evt.durationSeconds),
          evt.timeSeconds,
          evt.velocity
        );
      } catch (_) {}
    });

    // 7. Programar Eventos de Pistas Melódicas
    scheduled.trackEvents.forEach(evt => {
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

    // 8. Programar Eventos de Batería con Paneo Estéreo y Muestras de Audio
    const drumBuffers = options.drumBuffers;

    scheduled.drumEvents.forEach(evt => {
      try {
        const sampleUrl = evt.sampleUrl;
        const cachedBuffer = drumBuffers ? drumBuffers.get(sampleUrl) : null;

        if (cachedBuffer && cachedBuffer.loaded) {
          const drumVolVal = evt.volume ?? 80;
          const drumVolDb = faderToDb(drumVolVal);
          const panner = new Tone.Panner(Math.max(-1, Math.min(1, evt.pan || 0))).connect(drumsNode.volumeNode);
          const volume = new Tone.Volume(drumVolDb).connect(panner);
          const player = new Tone.Player(cachedBuffer).connect(volume);
          player.start(evt.timeSeconds);
        } else {
          // Fallback a síntesis percusiva de alta fidelidad
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

  }, totalDurationSeconds);

  if (options.onProgress) {
    options.onProgress(totalDurationSeconds, totalDurationSeconds);
  }

  return renderedBuffer.get() as AudioBuffer;
}

/**
 * Renderiza una sesión completa de forma offline a velocidad máxima de CPU
 * y genera un Blob con formato WAV PCM estéreo de 16 bits masterizado (True Peak -0.3 dBFS).
 */
export async function renderSessionToWav(
  session: SessionV2,
  customPatterns: PatternDef[] = [],
  options: OfflineRenderOptions = {}
): Promise<Blob> {
  const audioBuffer = await renderSessionToAudioBuffer(session, customPatterns, options);

  const wavArrayBuffer = audioBufferToWav(audioBuffer, {
    normalize: options.normalize !== false,
    targetPeakDb: options.targetPeakDb ?? -0.3
  });

  return new Blob([wavArrayBuffer], { type: 'audio/wav' });
}

/**
 * Renderiza una sesión completa y la comprime a formato .ogg / .webm con códec Opus.
 */
export async function renderSessionToCompressed(
  session: SessionV2,
  customPatterns: PatternDef[] = [],
  options: OfflineRenderOptions = {}
): Promise<CompressedAudioResult> {
  const audioBuffer = await renderSessionToAudioBuffer(session, customPatterns, options);
  return audioBufferToCompressedBlob(audioBuffer, 'ogg');
}
