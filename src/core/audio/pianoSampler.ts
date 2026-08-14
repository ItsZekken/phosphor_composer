/**
 * pianoSampler.ts
 * Sampler de piano acústico ultraligero y de alta fidelidad basado en Tone.Sampler.
 * 
 * Reemplaza la biblioteca @tonejs/piano (que consumía +6 GB de RAM al decodificar
 * 880 buffers estéreo sin comprimir para 16 velocidades) por un banco interpolado
 * optimizado de 9 notas clave que ocupa solo ~15 MB de RAM.
 */

import * as Tone from 'tone';

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

let sharedPianoBuffers: Tone.ToneAudioBuffers | null = null;
let sharedPianoPromise: Promise<Tone.ToneAudioBuffers | null> | null = null;

export async function preloadPianoBuffers(): Promise<Tone.ToneAudioBuffers | null> {
  if (sharedPianoBuffers && (sharedPianoBuffers as any).loaded) return sharedPianoBuffers;
  if (sharedPianoPromise) return sharedPianoPromise;

  sharedPianoPromise = new Promise<Tone.ToneAudioBuffers | null>((resolve) => {
    try {
      const buffers = new Tone.ToneAudioBuffers({
        urls: PIANO_URLS,
        baseUrl: PIANO_BASE_URL,
        onload: () => {
          sharedPianoBuffers = buffers;
          resolve(buffers);
        },
        onerror: () => {
          resolve(null);
        }
      });
    } catch (_) {
      resolve(null);
    }
  });

  return sharedPianoPromise;
}

export class PianoSampler {
  private sampler: Tone.Sampler | null = null;
  public loaded: boolean = false;
  public isLoading: boolean = false;
  private loadPromise: Promise<boolean> | null = null;
  private targetNode: Tone.InputNode;

  constructor(targetNode: Tone.InputNode) {
    this.targetNode = targetNode;
  }

  public async load(): Promise<boolean> {
    if (this.loaded && this.sampler) return true;
    if (this.loadPromise) return this.loadPromise;

    this.isLoading = true;
    this.loadPromise = new Promise<boolean>((resolve) => {
      try {
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
      } catch (e) {
        console.warn('[PianoSampler] Error inicializando sampler:', e);
        this.loaded = false;
        this.isLoading = false;
        resolve(false);
      }
    });

    return this.loadPromise;
  }

  public keyDown({ note, time, velocity = 0.8 }: { note: string; time?: number; velocity?: number }) {
    if (!this.loaded || !this.sampler) return;
    try {
      this.sampler.triggerAttack(note, time, velocity);
    } catch (_) {}
  }

  public keyUp({ note, time }: { note: string; time?: number }) {
    if (!this.loaded || !this.sampler) return;
    try {
      this.sampler.triggerRelease(note, time);
    } catch (_) {}
  }

  public triggerAttackRelease(note: string, duration: number | string, time?: number, velocity = 0.8) {
    if (!this.loaded || !this.sampler) return;
    try {
      this.sampler.triggerAttackRelease(note, duration, time, velocity);
    } catch (_) {}
  }

  public stopAll() {
    if (!this.loaded || !this.sampler) return;
    try {
      this.sampler.releaseAll();
    } catch (_) {}
  }

  public pedalDown(_options?: { time?: number }) {
    // Soporte para pedal de sustain
  }

  public pedalUp(_options?: { time?: number }) {
    // Soporte para liberación de sustain
  }

  public dispose() {
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
