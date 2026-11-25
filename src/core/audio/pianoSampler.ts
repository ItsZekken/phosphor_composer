/**
 * pianoSampler.ts
 * Sampler de piano acústico ultraligero basado en pool nativo Web Audio (32 voces con LRU stealing)
 * sobre buffers decodificados compartidos en memoria (sharedPianoBuffers), con fallback automático
 * a Tone.Sampler para entornos offline/mocks sin contexto nativo.
 */

import * as Tone from 'tone';
import { noteToMidi } from '../music/pitchClass';

export const PIANO_URLS: Record<string, string> = {
  A0: 'A0v10.mp3',
  C1: 'C1v10.mp3',
  'D#2': 'Ds2v10.mp3',
  'F#3': 'Fs3v10.mp3',
  A4: 'A4v10.mp3',
  C5: 'C5v10.mp3',
  'D#6': 'Ds6v10.mp3',
  'F#7': 'Fs7v10.mp3',
  C8: 'C8v10.mp3'
};

export const PIANO_BASE_URL = '/piano/';

const MAX_PIANO_VOICES = 32;

let sharedPianoBuffers: Tone.ToneAudioBuffers | null = null;
let sharedPianoPromise: Promise<Tone.ToneAudioBuffers | null> | null = null;

interface NativePianoVoice {
  note: string;
  midi: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  age: number;
  released: boolean;
  sustainedByPedal: boolean;
}

/**
 * Precarga el banco global de 9 muestras de piano en memoria compartida.
 */
export async function preloadPianoBuffers(): Promise<Tone.ToneAudioBuffers | null> {
  if (sharedPianoBuffers && (sharedPianoBuffers as any).loaded) {
    return sharedPianoBuffers;
  }
  if (sharedPianoPromise) {
    return sharedPianoPromise;
  }

  sharedPianoPromise = new Promise<Tone.ToneAudioBuffers | null>((resolve) => {
    try {
      const buffers = new Tone.ToneAudioBuffers({
        urls: PIANO_URLS,
        baseUrl: PIANO_BASE_URL,
        onload: () => {
          sharedPianoBuffers = buffers;
          resolve(buffers);
        },
        onerror: (err) => {
          console.warn('[PianoSampler] Error precargando buffers de piano:', err);
          resolve(null);
        }
      });
    } catch (e) {
      console.warn('[PianoSampler] Excepción al precargar buffers de piano:', e);
      resolve(null);
    }
  });

  return sharedPianoPromise;
}

/**
 * Obtiene los buffers de piano precargados si ya están listos en memoria.
 */
export function getSharedPianoBuffers(): Tone.ToneAudioBuffers | null {
  return (sharedPianoBuffers && (sharedPianoBuffers as any).loaded) ? sharedPianoBuffers : null;
}

export class PianoSampler {
  private sampler: Tone.Sampler | null = null;
  private nativeSamples: Array<{ midi: number; buffer: AudioBuffer }> = [];
  private nativeVoices: NativePianoVoice[] = [];
  private useNativePool = false;
  private voiceAgeCounter = 0;

  public loaded: boolean = false;
  public isLoading: boolean = false;
  private loadPromise: Promise<boolean> | null = null;
  private targetNode: Tone.InputNode;
  private isPedalActive: boolean = false;

  constructor(targetNode: Tone.InputNode) {
    this.targetNode = targetNode;
  }

  private indexNativeSamples(buffers: Tone.ToneAudioBuffers): Array<{ midi: number; buffer: AudioBuffer }> {
    const entries: Array<{ midi: number; buffer: AudioBuffer }> = [];
    for (const noteName of Object.keys(PIANO_URLS)) {
      if (!buffers.has(noteName)) continue;
      const toneBuf = buffers.get(noteName);
      const rawBuf = (toneBuf as any)?.get?.() || (toneBuf as any)?._buffer;
      if (rawBuf && typeof rawBuf.getChannelData === 'function') {
        entries.push({ midi: noteToMidi(noteName), buffer: rawBuf });
      }
    }
    entries.sort((a, b) => a.midi - b.midi);
    return entries;
  }

  public async load(): Promise<boolean> {
    if (this.loaded && (this.useNativePool || this.sampler)) return true;
    if (this.loadPromise) return this.loadPromise;

    this.isLoading = true;
    this.loadPromise = (async () => {
      try {
        let buffers = getSharedPianoBuffers();
        if (!buffers) {
          buffers = await preloadPianoBuffers();
        }

        if (buffers && (buffers as any).loaded) {
          const audioCtx = Tone.getContext().rawContext as AudioContext;
          const samples = this.indexNativeSamples(buffers);

          if (
            audioCtx &&
            samples.length > 0 &&
            typeof audioCtx.createBufferSource === 'function' &&
            typeof audioCtx.createGain === 'function'
          ) {
            this.nativeSamples = samples;
            this.useNativePool = true;
            this.loaded = true;
            this.isLoading = false;
            return true;
          }

          // Fallback Tone.Sampler si no hay contexto nativo directo (ej. entorno de pruebas)
          const bufferMap: Record<string, Tone.ToneAudioBuffer> = {};
          Object.keys(PIANO_URLS).forEach((note) => {
            if (buffers!.has(note)) {
              bufferMap[note] = buffers!.get(note);
            }
          });

          this.sampler = new Tone.Sampler({
            urls: bufferMap,
            onload: () => {
              this.loaded = true;
              this.isLoading = false;
            }
          }).connect(this.targetNode);

          this.loaded = true;
          this.isLoading = false;
          return true;
        }

        // 2. Fallback de carga por URL directa si la precarga global falló
        return new Promise<boolean>((resolve) => {
          this.sampler = new Tone.Sampler({
            urls: PIANO_URLS,
            baseUrl: PIANO_BASE_URL,
            onload: () => {
              this.loaded = true;
              this.isLoading = false;
              resolve(true);
            },
            onerror: (err) => {
              console.warn('[PianoSampler] Fallback por error cargando samples:', err);
              this.loaded = false;
              this.isLoading = false;
              resolve(false);
            }
          }).connect(this.targetNode);
        });
      } catch (e) {
        console.warn('[PianoSampler] Error inicializando sampler:', e);
        this.loaded = false;
        this.isLoading = false;
        return false;
      }
    })();

    return this.loadPromise;
  }

  private findNearestSample(midi: number): { midi: number; buffer: AudioBuffer } {
    const samples = this.nativeSamples;
    let best = samples[0];
    let minDist = Math.abs(best.midi - midi);
    for (let i = 1; i < samples.length; i++) {
      const dist = Math.abs(samples[i].midi - midi);
      if (dist < minDist) {
        minDist = dist;
        best = samples[i];
      }
    }
    return best;
  }

  private stealOldestVoiceIfNeeded(audioCtx: AudioContext): void {
    while (this.nativeVoices.length >= MAX_PIANO_VOICES) {
      let victimIdx = 0;
      let victimScore = Infinity;
      for (let i = 0; i < this.nativeVoices.length; i++) {
        const v = this.nativeVoices[i];
        // Priorizar robo de voces ya en release para minimizar corte audible
        const score = v.released ? v.age - 1_000_000 : v.age;
        if (score < victimScore) {
          victimScore = score;
          victimIdx = i;
        }
      }
      const victim = this.nativeVoices.splice(victimIdx, 1)[0];
      if (victim) {
        try {
          const now = audioCtx.currentTime;
          victim.gain.gain.cancelScheduledValues(now);
          victim.gain.gain.setTargetAtTime(0, now, 0.004);
          victim.src.stop(now + 0.025);
        } catch (_) {}
      }
    }
  }

  private spawnNativeVoice(note: string, durationSec: number | null, time?: number, velocity = 0.8): void {
    const audioCtx = Tone.getContext().rawContext as AudioContext;
    if (!audioCtx || this.nativeSamples.length === 0) return;

    const midi = noteToMidi(note);
    const nearest = this.findNearestSample(midi);
    const playbackRate = Math.pow(2, (midi - nearest.midi) / 12);

    this.stealOldestVoiceIfNeeded(audioCtx);

    const now = audioCtx.currentTime;
    const startAt = time !== undefined ? Math.max(now, time) : now;
    const clampedVel = Math.max(0.05, Math.min(1.0, velocity));
    const targetGain = Math.pow(clampedVel, 1.4);

    const src = audioCtx.createBufferSource();
    src.buffer = nearest.buffer;
    src.playbackRate.value = playbackRate;

    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0.0001, startAt);
    gainNode.gain.linearRampToValueAtTime(targetGain, startAt + 0.003);

    src.connect(gainNode);
    Tone.connect(gainNode, this.targetNode as any);

    const voice: NativePianoVoice = {
      note,
      midi,
      src,
      gain: gainNode,
      age: ++this.voiceAgeCounter,
      released: false,
      sustainedByPedal: false
    };

    src.start(startAt);

    if (durationSec !== null) {
      if (this.isPedalActive) {
        voice.sustainedByPedal = true;
      } else {
        const relAt = startAt + Math.max(0.03, durationSec);
        gainNode.gain.setTargetAtTime(0, relAt, 0.065);
        src.stop(relAt + 0.45);
        voice.released = true;
      }
    }

    this.nativeVoices.push(voice);
    src.onended = () => {
      const idx = this.nativeVoices.indexOf(voice);
      if (idx !== -1) this.nativeVoices.splice(idx, 1);
      try {
        src.disconnect();
        gainNode.disconnect();
      } catch (_) {}
    };
  }

  public keyDown({ note, time, velocity = 0.8 }: { note: string; time?: number; velocity?: number }) {
    if (!this.loaded) return;
    if (this.useNativePool) {
      try {
        this.spawnNativeVoice(note, null, time, velocity);
      } catch (err) {
        console.warn('[PianoSampler] Error en keyDown:', err);
      }
      return;
    }
    if (!this.sampler) return;
    try {
      this.sampler.triggerAttack(note, time, velocity);
    } catch (_) {}
  }

  public keyUp({ note, time }: { note: string; time?: number }) {
    if (!this.loaded) return;
    if (this.useNativePool) {
      const audioCtx = Tone.getContext().rawContext as AudioContext;
      const now = audioCtx ? audioCtx.currentTime : 0;
      const relAt = time !== undefined ? Math.max(now, time) : now;
      for (let i = 0; i < this.nativeVoices.length; i++) {
        const v = this.nativeVoices[i];
        if (!v.released && v.note === note) {
          if (this.isPedalActive) {
            v.sustainedByPedal = true;
          } else {
            try {
              v.gain.gain.cancelScheduledValues(relAt);
              v.gain.gain.setTargetAtTime(0, relAt, 0.065);
              v.src.stop(relAt + 0.45);
              v.released = true;
            } catch (_) {}
          }
        }
      }
      return;
    }
    if (!this.sampler || this.isPedalActive) return;
    try {
      this.sampler.triggerRelease(note, time);
    } catch (_) {}
  }

  public triggerAttackRelease(note: string | string[], duration: number | string, time?: number, velocity = 0.8) {
    if (!this.loaded) return;
    const durSec = typeof duration === 'number' ? duration : Tone.Time(duration).toSeconds();

    if (this.useNativePool) {
      try {
        if (Array.isArray(note)) {
          for (let i = 0; i < note.length; i++) {
            this.spawnNativeVoice(note[i], durSec, time, velocity);
          }
        } else {
          this.spawnNativeVoice(note, durSec, time, velocity);
        }
      } catch (err) {
        console.warn('[PianoSampler] Error en triggerAttackRelease:', err);
      }
      return;
    }

    if (!this.sampler) return;
    try {
      const actualDur = this.isPedalActive ? Math.max(durSec, 2.5) : durSec;
      this.sampler.triggerAttackRelease(note, actualDur, time, velocity);
    } catch (_) {}
  }

  public stopAll() {
    if (!this.loaded) return;
    if (this.useNativePool) {
      const audioCtx = Tone.getContext().rawContext as AudioContext;
      const now = audioCtx ? audioCtx.currentTime : 0;
      const voices = this.nativeVoices.splice(0, this.nativeVoices.length);
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setTargetAtTime(0, now, 0.008);
          v.src.stop(now + 0.04);
        } catch (_) {}
      }
      return;
    }
    if (!this.sampler) return;
    try {
      this.sampler.releaseAll();
    } catch (_) {}
  }

  public pedalDown(_options?: { time?: number }) {
    this.isPedalActive = true;
  }

  public pedalUp(options?: { time?: number }) {
    this.isPedalActive = false;
    if (this.useNativePool) {
      const audioCtx = Tone.getContext().rawContext as AudioContext;
      const now = audioCtx ? audioCtx.currentTime : 0;
      const relAt = options?.time !== undefined ? Math.max(now, options.time) : now;
      for (let i = 0; i < this.nativeVoices.length; i++) {
        const v = this.nativeVoices[i];
        if (v.sustainedByPedal && !v.released) {
          v.sustainedByPedal = false;
          v.released = true;
          try {
            v.gain.gain.setTargetAtTime(0, relAt, 0.065);
            v.src.stop(relAt + 0.45);
          } catch (_) {}
        }
      }
      return;
    }
    if (this.sampler && this.loaded) {
      try {
        const t = options?.time !== undefined ? options.time : Tone.now();
        this.sampler.releaseAll(t);
      } catch (_) {}
    }
  }

  public dispose() {
    this.stopAll();
    this.nativeSamples = [];
    this.useNativePool = false;
    if (this.sampler) {
      try {
        this.sampler.dispose();
      } catch (_) {}
      this.sampler = null;
    }
    this.loaded = false;
    this.isLoading = false;
  }
}
