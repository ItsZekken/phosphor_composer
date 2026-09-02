/**
 * livePitchTracker.ts
 * Motor de detección de pitch monofónico en tiempo real para voz/tarareo (Vocal-to-MIDI).
 * Diseñado para operar durante la reproducción activa de la canción con bajísima latencia.
 */

import type { MelodyNote, ScaleType } from '../../utils/typeDefinitions';
import type { NoteClass } from '../music';
import { midiToNoteName, noteToMod12, SCALE_INTERVALS } from '../music';
import { generateId } from '../../utils/idGenerator';

export interface RecordedPitchSample {
  midi: number;
  time: number; // Tiempo en segundos relativo al transporte
  clarity: number;
}

export interface LivePitchTrackerOptions {
  sampleRate?: number;
  bufferSize?: number;
  minMidi?: number;
  maxMidi?: number;
  clarityThreshold?: number;
  onLivePitch?: (pitch: { midi: number; note: string; clarity: number } | null) => void;
}

export class LivePitchTracker {
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private rafId: number | null = null;

  private isRunning = false;
  private recordedSamples: RecordedPitchSample[] = [];
  private recordingStartTime = 0;
  private transportTimeOffset = 0;

  private minMidi: number;
  private maxMidi: number;
  private clarityThreshold: number;
  private onLivePitch?: (pitch: { midi: number; note: string; clarity: number } | null) => void;

  private worker: Worker | null = null;
  private isProcessing = false;
  private currentRequestId = 0;
  private reusableBuffer = new Float32Array(2048);

  // Filtro mediano circular para estabilizar el vibrato
  private pitchHistory: number[] = [];
  private historySize = 3;

  constructor(options: LivePitchTrackerOptions = {}) {
    this.minMidi = options.minMidi ?? 40; // E2 (82 Hz)
    this.maxMidi = options.maxMidi ?? 84; // C6 (1046 Hz)
    this.clarityThreshold = options.clarityThreshold ?? 0.82;
    this.onLivePitch = options.onLivePitch;
  }

  public async start(initialTransportSeconds = 0): Promise<void> {
    if (this.isRunning) return;

    this.recordedSamples = [];
    this.pitchHistory = [];
    this.transportTimeOffset = initialTransportSeconds;
    this.recordingStartTime = performance.now();
    this.isProcessing = false;

    // Inicializar Web Worker dedicado para offload de cálculos O(N^2)
    try {
      this.worker = new Worker(new URL('../../workers/pitchTrackerWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; result: { midi: number; frequency: number; clarity: number } | null }>) => {
        this.handleWorkerResult(e.data.result);
      };
    } catch (err) {
      console.warn('[LivePitchTracker] Web Worker no disponible, fallback síncrono activo:', err);
      this.worker = null;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    this.mediaStream = stream;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 2048;

    this.sourceNode.connect(this.analyserNode);
    this.isRunning = true;

    this.processAudioLoop();
  }

  private processAudioLoop = () => {
    if (!this.isRunning || !this.analyserNode || !this.audioCtx) return;

    if (this.worker) {
      if (!this.isProcessing) {
        this.isProcessing = true;
        this.analyserNode.getFloatTimeDomainData(this.reusableBuffer);
        this.worker.postMessage({
          id: ++this.currentRequestId,
          buffer: this.reusableBuffer,
          sampleRate: this.audioCtx.sampleRate
        });
      }
    } else {
      // Fallback síncrono
      this.analyserNode.getFloatTimeDomainData(this.reusableBuffer);
      const result = this.detectPitch(this.reusableBuffer, this.audioCtx.sampleRate);
      this.handlePitchResult(result);
    }

    this.rafId = requestAnimationFrame(this.processAudioLoop);
  };

  private handleWorkerResult(result: { midi: number; frequency: number; clarity: number } | null) {
    this.isProcessing = false;
    if (!this.isRunning) return;
    this.handlePitchResult(result);
  }

  private handlePitchResult(result: { midi: number; frequency: number; clarity: number } | null) {
    const elapsedSeconds = (performance.now() - this.recordingStartTime) / 1000;
    const currentTransportTime = this.transportTimeOffset + elapsedSeconds;

    if (result && result.clarity >= this.clarityThreshold) {
      // Filtrado mediano para absorber vibratos vocales
      this.pitchHistory.push(result.midi);
      if (this.pitchHistory.length > this.historySize) {
        this.pitchHistory.shift();
      }

      const sorted = [...this.pitchHistory].sort((a, b) => a - b);
      const medianMidi = sorted[Math.floor(sorted.length / 2)];

      if (medianMidi >= this.minMidi && medianMidi <= this.maxMidi) {
        this.recordedSamples.push({
          midi: medianMidi,
          time: currentTransportTime,
          clarity: result.clarity
        });

        if (this.onLivePitch) {
          this.onLivePitch({
            midi: medianMidi,
            note: midiToNoteName(medianMidi),
            clarity: result.clarity
          });
        }
      }
    } else {
      this.pitchHistory = [];
      if (this.onLivePitch) {
        this.onLivePitch(null);
      }
    }
  }

  /**
   * Algoritmo de Autocorrelación normalizada con ventana para estimación de pitch
   */
  private detectPitch(buffer: Float32Array, sampleRate: number): { midi: number; frequency: number; clarity: number } | null {
    const size = buffer.length;
    let rms = 0;
    for (let i = 0; i < size; i++) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / size);

    // Umbral de silencio
    if (rms < 0.015) {
      return null;
    }

    // Autocorrelación
    const c = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - i; j++) {
        c[i] = c[i] + buffer[j] * buffer[j + i];
      }
    }

    // Encontrar primer mínimo local
    let d = 0;
    while (d < size - 1 && c[d] > c[d + 1]) {
      d++;
    }

    let maxVal = -1;
    let maxPos = -1;
    for (let i = d; i < size; i++) {
      if (c[i] > maxVal) {
        maxVal = c[i];
        maxPos = i;
      }
    }

    if (maxPos <= 0 || c[0] <= 0) return null;

    const clarity = maxVal / c[0];
    if (clarity < 0.70) return null;

    let T0 = maxPos;
    // Interpolación parabólica
    const x1 = c[T0 - 1] || 0;
    const x2 = c[T0];
    const x3 = c[T0 + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) {
      T0 = T0 - b / (2 * a);
    }

    const frequency = sampleRate / T0;
    if (frequency < 70 || frequency > 1200) return null;

    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    return { midi, frequency, clarity };
  }

  public stop(): RecordedPitchSample[] {
    this.isRunning = false;

    if (this.worker) {
      try { this.worker.terminate(); } catch (_) {}
      this.worker = null;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch (_) {}
      this.mediaStream = null;
    }

    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch (_) {}
      this.audioCtx = null;
    }

    if (this.onLivePitch) {
      this.onLivePitch(null);
    }

    return this.recordedSamples;
  }

  /**
   * Post-procesamiento inteligente de segmentación, cuantización y acople a escala.
   */
  public processRecordedNotes(
    samples: RecordedPitchSample[],
    bpm: number,
    options: {
      snapToScale: boolean;
      key: NoteClass | string;
      scale: ScaleType;
      gridSnap?: number; // default 0.25 (semicorchea)
      minDurationSec?: number; // default 0.08s (elimina ruidos breves)
    }
  ): MelodyNote[] {
    if (samples.length === 0) return [];

    const { snapToScale, key, scale, gridSnap = 0.25, minDurationSec = 0.08 } = options;
    const secondsPerBeat = 60 / bpm;

    // 1. Preparar clases de notas de la escala para cuantización rápida si snapToScale está activo
    const rootMod12 = noteToMod12(key);
    const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.major;
    const scalePitchClasses = new Set(intervals.map((i) => (rootMod12 + i) % 12));

    const snapMidiToScale = (midi: number): number => {
      if (!snapToScale) return midi;
      const pc = ((midi % 12) + 12) % 12;
      if (scalePitchClasses.has(pc)) return midi;

      // Buscar semitono vecino que pertenezca a la escala
      if (scalePitchClasses.has((pc - 1 + 12) % 12)) return midi - 1;
      if (scalePitchClasses.has((pc + 1) % 12)) return midi + 1;
      return midi;
    };

    // 2. Segmentación de notas por proximidad temporal y pitch
    interface Segment {
      midi: number;
      startTime: number;
      endTime: number;
    }

    const segments: Segment[] = [];
    let currentSeg: Segment | null = null;
    const maxGapSeconds = 0.25;

    for (const sample of samples) {
      const processedMidi = snapMidiToScale(sample.midi);

      if (!currentSeg) {
        currentSeg = { midi: processedMidi, startTime: sample.time, endTime: sample.time };
      } else {
        const gap = sample.time - currentSeg.endTime;
        if (processedMidi === currentSeg.midi && gap <= maxGapSeconds) {
          currentSeg.endTime = sample.time;
        } else {
          if (currentSeg.endTime - currentSeg.startTime >= minDurationSec) {
            segments.push({ ...currentSeg });
          }
          currentSeg = { midi: processedMidi, startTime: sample.time, endTime: sample.time };
        }
      }
    }

    if (currentSeg && currentSeg.endTime - currentSeg.startTime >= minDurationSec) {
      segments.push({ ...currentSeg });
    }

    // 3. Cuantización musical al Grid rítmico
    const finalNotes: MelodyNote[] = [];

    segments.forEach((seg) => {
      const startBeatRaw = seg.startTime / secondsPerBeat;
      const endBeatRaw = seg.endTime / secondsPerBeat;

      const startBeat = Math.max(0, Math.floor(startBeatRaw / gridSnap) * gridSnap);
      const endBeat = Math.max(startBeat + gridSnap, Math.round(endBeatRaw / gridSnap) * gridSnap);
      const durationBeats = endBeat - startBeat;

      if (durationBeats > 0) {
        finalNotes.push({
          id: generateId('mn_mic'),
          note: midiToNoteName(seg.midi),
          midi: seg.midi,
          startBeat,
          durationBeats,
          velocity: 0.8
        });
      }
    });

    return finalNotes;
  }
}
