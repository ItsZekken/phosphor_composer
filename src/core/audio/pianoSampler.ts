/**
 * pianoSampler.ts
 * Sampler de piano acústico ultraligero y de alta fidelidad basado en Tone.Sampler.
 * Utiliza un singleton global de buffers decodificados en memoria compartida (sharedPianoBuffers)
 * para instanciación instantánea (0 ms) en múltiples canales y 0 consumo extra de RAM (~15 MB total).
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
  public loaded: boolean = false;
  public isLoading: boolean = false;
  private loadPromise: Promise<boolean> | null = null;
  private targetNode: Tone.InputNode;
  private isPedalActive: boolean = false;

  constructor(targetNode: Tone.InputNode) {
    this.targetNode = targetNode;
  }

  public async load(): Promise<boolean> {
    if (this.loaded && this.sampler) return true;
    if (this.loadPromise) return this.loadPromise;

    this.isLoading = true;
    this.loadPromise = (async () => {
      try {
        // 1. Asegurar que los buffers globales compartidos estén listos
        let buffers = getSharedPianoBuffers();
        if (!buffers) {
          buffers = await preloadPianoBuffers();
        }

        if (buffers && (buffers as any).loaded) {
          // Construir mapa de buffers de audio directos para instanciación síncrona/instantánea
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

  public keyDown({ note, time, velocity = 0.8 }: { note: string; time?: number; velocity?: number }) {
    if (!this.loaded || !this.sampler) return;
    try {
      this.sampler.triggerAttack(note, time, velocity);
    } catch (_) {}
  }

  public keyUp({ note, time }: { note: string; time?: number }) {
    if (!this.loaded || !this.sampler) return;
    if (this.isPedalActive) return; // Si el pedal de sustain está presionado, no apagar la nota inmediatamente
    try {
      this.sampler.triggerRelease(note, time);
    } catch (_) {}
  }

  public triggerAttackRelease(note: string | string[], duration: number | string, time?: number, velocity = 0.8) {
    if (!this.loaded || !this.sampler) return;
    try {
      const durSec = typeof duration === 'number' ? duration : Tone.Time(duration).toSeconds();
      const actualDur = this.isPedalActive ? Math.max(durSec, 2.5) : durSec;
      this.sampler.triggerAttackRelease(note, actualDur, time, velocity);
    } catch (_) {}
  }

  public stopAll() {
    if (!this.loaded || !this.sampler) return;
    try {
      this.sampler.releaseAll();
    } catch (_) {}
  }

  public pedalDown(_options?: { time?: number }) {
    this.isPedalActive = true;
  }

  public pedalUp(options?: { time?: number }) {
    this.isPedalActive = false;
    if (this.sampler && this.loaded) {
      try {
        const t = options?.time !== undefined ? options.time : Tone.now();
        this.sampler.releaseAll(t);
      } catch (_) {}
    }
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
