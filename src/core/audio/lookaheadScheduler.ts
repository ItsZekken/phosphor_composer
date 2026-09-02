/**
 * lookaheadScheduler.ts
 * Programador de tiempo real determinista basado en el patrón W3C "A Tale of Two Clocks".
 * Reemplaza la destrucción y re-programación masiva de Tone.Transport por una ventana deslizante de 100 ms.
 * Permite edición fluida de notas en el Piano Roll durante la reproducción sin cortes de audio.
 */

import * as Tone from 'tone';
import type { ScheduledSessionEvents, ScheduledChordEvent, ScheduledTrackEvent, ScheduledDrumEvent } from './audioTypes';
import { TempoMap, createTempoMap } from '../music';
import type { TempoMarker, TimeSignature } from '../../utils/typeDefinitions';

export interface LookaheadSchedulerCallbacks {
  onTriggerChord: (evt: ScheduledChordEvent, audioContextTime: number) => void;
  onTriggerTrack: (evt: ScheduledTrackEvent, audioContextTime: number) => void;
  onTriggerDrum: (evt: ScheduledDrumEvent, audioContextTime: number) => void;
  onTriggerMetronome?: (frequency: number, volumeFactor: number, audioContextTime: number) => void;
  onStepChange?: (currentBeat: number, currentAudioSeconds: number) => void;
  onTempoChange?: (newBpm: number, beat: number, audioTime: number) => void;
  onSongEnd?: () => void;
}

export class LookaheadScheduler {
  private isRunning = false;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private intervalMs = 25; // Frecuencia de escaneo (40 Hz)
  private lookaheadSeconds = 0.1; // Ventana de programación futura (100 ms)

  private tempoMap: TempoMap = new TempoMap(120, []);
  private isLooping = false;
  private totalBeats = 16;
  private totalDurationSeconds = 8.0;
  private scheduledEvents: ScheduledSessionEvents | null = null;

  // Configuración de metrónomo integrado en fase
  private isMetronomeActive = false;
  private metroSubdivision: '4n' | '8n' | '16n' = '4n';
  private timeSignature: TimeSignature = '4/4';

  private currentBeat = 0;
  private nextScheduledSeconds = 0;
  private playbackStartTime = 0;
  private startSecondsOffset = 0;

  private lastEmittedBpm = -1;
  private lastEmittedStep = -1;

  private callbacks: LookaheadSchedulerCallbacks;

  constructor(callbacks: LookaheadSchedulerCallbacks) {
    this.callbacks = callbacks;
  }

  public setMetronomeConfig(isActive: boolean, subdivision: '4n' | '8n' | '16n', timeSignature: TimeSignature) {
    this.isMetronomeActive = isActive;
    this.metroSubdivision = subdivision;
    this.timeSignature = timeSignature;
  }

  public setEvents(events: ScheduledSessionEvents, bpm: number, isLooping: boolean, tempoMarkers: TempoMarker[] = []) {
    const wasRunning = this.isRunning;
    const currentLiveBeat = wasRunning ? this.getLiveBeat() : this.currentBeat;
    const oldTempoMap = this.tempoMap;

    this.scheduledEvents = events;
    this.tempoMap = createTempoMap(bpm, tempoMarkers);
    this.isLooping = isLooping;
    this.totalBeats = Math.max(1, events.totalBeats);
    this.totalDurationSeconds = Math.max(0.1, this.tempoMap.getTotalDurationSeconds(this.totalBeats));

    if (wasRunning) {
      // Reanclar determinísticamente el audio al beat actual para evitar cualquier salto
      const now = Tone.now();
      const currentAudioSeconds = this.tempoMap.beatToSeconds(currentLiveBeat);
      this.startSecondsOffset = currentAudioSeconds;
      this.playbackStartTime = now;
      this.currentBeat = currentLiveBeat;

      // Proyectar el horizonte previamente programado para evitar double-triggering de notas en Web Audio
      const prevScheduledBeat = oldTempoMap.secondsToBeat(this.nextScheduledSeconds);
      const newScheduledSeconds = this.tempoMap.beatToSeconds(prevScheduledBeat);

      if (currentLiveBeat < prevScheduledBeat - 1) {
        // En caso de salto de bucle (loop wrap)
        this.nextScheduledSeconds = currentAudioSeconds;
      } else {
        // Preservar el horizonte ya despachado a Web Audio en la ventana de lookahead
        this.nextScheduledSeconds = Math.max(currentAudioSeconds, newScheduledSeconds);
      }

      const currentBpm = this.tempoMap.getBpmAtBeat(currentLiveBeat);
      if (currentBpm !== this.lastEmittedBpm) {
        this.lastEmittedBpm = currentBpm;
        if (this.callbacks.onTempoChange) {
          this.callbacks.onTempoChange(currentBpm, currentLiveBeat, now);
        }
      }
    }
  }

  public start(fromBeat = 0, bpm = 120, tempoMarkers: TempoMarker[] = []) {
    if (this.isRunning) this.stop();

    this.tempoMap = createTempoMap(bpm, tempoMarkers);
    this.currentBeat = fromBeat;
    this.startSecondsOffset = this.tempoMap.beatToSeconds(fromBeat);
    this.nextScheduledSeconds = this.startSecondsOffset;
    this.playbackStartTime = Tone.now();
    this.isRunning = true;

    const startBpm = this.tempoMap.getBpmAtBeat(fromBeat);
    this.lastEmittedBpm = startBpm;
    this.lastEmittedStep = Math.floor(fromBeat * 4);

    if (this.callbacks.onTempoChange) {
      this.callbacks.onTempoChange(startBpm, fromBeat, Tone.now());
    }
    if (this.callbacks.onStepChange) {
      this.callbacks.onStepChange(fromBeat, this.startSecondsOffset);
    }

    // Tick inicial inmediato y luego temporizador periódico
    this.scheduleWindow();
    this.intervalTimer = setInterval(() => {
      this.scheduleWindow();
    }, this.intervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.lastEmittedBpm = -1;
    this.lastEmittedStep = -1;
  }

  public seek(beat: number) {
    this.currentBeat = beat;
    this.startSecondsOffset = this.tempoMap.beatToSeconds(beat);
    this.nextScheduledSeconds = this.startSecondsOffset;
    this.playbackStartTime = Tone.now();

    const seekBpm = this.tempoMap.getBpmAtBeat(beat);
    if (seekBpm !== this.lastEmittedBpm) {
      this.lastEmittedBpm = seekBpm;
      if (this.callbacks.onTempoChange) {
        this.callbacks.onTempoChange(seekBpm, beat, Tone.now());
      }
    }
    this.lastEmittedStep = Math.floor(beat * 4);
    if (this.callbacks.onStepChange) {
      this.callbacks.onStepChange(beat, this.startSecondsOffset);
    }

    if (this.isRunning) {
      this.scheduleWindow();
    }
  }

  public getLiveSeconds(): number {
    if (!this.isRunning) return this.tempoMap.beatToSeconds(this.currentBeat);
    const elapsedSeconds = Tone.now() - this.playbackStartTime;
    let currentAudioSeconds = this.startSecondsOffset + elapsedSeconds;

    if (this.isLooping && this.totalDurationSeconds > 0) {
      currentAudioSeconds = currentAudioSeconds % this.totalDurationSeconds;
    }
    return currentAudioSeconds;
  }

  public getLiveBeat(): number {
    if (!this.isRunning) return this.currentBeat;
    const currentAudioSeconds = this.getLiveSeconds();
    return this.tempoMap.secondsToBeat(currentAudioSeconds);
  }

  public getLiveBpm(): number {
    if (!this.isRunning) return this.tempoMap.getBpmAtBeat(this.currentBeat);
    const liveBeat = this.getLiveBeat();
    return this.tempoMap.getBpmAtBeat(liveBeat);
  }

  private scheduleWindow() {
    if (!this.isRunning || !this.scheduledEvents) return;

    const now = Tone.now();
    const elapsedSeconds = now - this.playbackStartTime;
    let currentAudioSeconds = this.startSecondsOffset + elapsedSeconds;

    // Actualizar currentBeat para telemetría y cursores
    this.currentBeat = this.tempoMap.secondsToBeat(currentAudioSeconds);

    // Evento Global de Cambio de Tempo: se dispara al cruzar marcadores en tiempo real
    const currentBpm = this.tempoMap.getBpmAtSeconds(currentAudioSeconds);
    if (currentBpm !== this.lastEmittedBpm) {
      this.lastEmittedBpm = currentBpm;
      if (this.callbacks.onTempoChange) {
        this.callbacks.onTempoChange(currentBpm, this.currentBeat, now);
      }
    }

    // Sincronización continua de pasos del secuenciador de batería y cadena (16th notes)
    const currentStep = Math.floor(this.currentBeat * 4);
    if (currentStep !== this.lastEmittedStep) {
      this.lastEmittedStep = currentStep;
      if (this.callbacks.onStepChange) {
        this.callbacks.onStepChange(this.currentBeat, currentAudioSeconds);
      }
    }

    const windowEndSeconds = currentAudioSeconds + this.lookaheadSeconds;

    // Verificar fin de canción en modo no loop
    if (!this.isLooping && currentAudioSeconds >= this.totalDurationSeconds) {
      this.stop();
      if (this.callbacks.onSongEnd) {
        this.callbacks.onSongEnd();
      }
      return;
    }

    const startSec = this.nextScheduledSeconds;
    const endSec = windowEndSeconds;

    if (startSec >= endSec) return;

    // Programar acordes dentro de la ventana de audio [startSec, endSec)
    this.scheduledEvents.chordEvents.forEach((evt) => {
      if (this.isEventInWindow(evt.timeSeconds, startSec, endSec)) {
        const timeOffset = evt.timeSeconds - currentAudioSeconds;
        const triggerTime = Math.max(now, now + timeOffset);
        try {
          this.callbacks.onTriggerChord(evt, triggerTime);
        } catch (_) {}
      }
    });

    // Programar pistas melódicas del Piano Roll
    this.scheduledEvents.trackEvents.forEach((evt) => {
      if (this.isEventInWindow(evt.timeSeconds, startSec, endSec)) {
        const timeOffset = evt.timeSeconds - currentAudioSeconds;
        const triggerTime = Math.max(now, now + timeOffset);
        try {
          this.callbacks.onTriggerTrack(evt, triggerTime);
        } catch (_) {}
      }
    });

    // Programar batería
    this.scheduledEvents.drumEvents.forEach((evt) => {
      if (this.isEventInWindow(evt.timeSeconds, startSec, endSec)) {
        const timeOffset = evt.timeSeconds - currentAudioSeconds;
        const triggerTime = Math.max(now, now + timeOffset);
        try {
          this.callbacks.onTriggerDrum(evt, triggerTime);
        } catch (_) {}
      }
    });

    // Programar metrónomo en fase exacta con la métrica y tempo
    if (this.isMetronomeActive && this.callbacks.onTriggerMetronome) {
      const stepBeats = this.metroSubdivision === '16n' ? 0.25 : this.metroSubdivision === '8n' ? 0.5 : 1.0;
      const beatsPerMeasure = this.timeSignature === '3/4' ? 3 : this.timeSignature === '6/8' ? 6 : 4;
      const startBeat = this.tempoMap.secondsToBeat(startSec);
      const endBeat = this.tempoMap.secondsToBeat(endSec);

      const firstStep = Math.floor((startBeat - 0.001) / stepBeats);
      const lastStep = Math.ceil((endBeat + 0.001) / stepBeats);

      for (let s = firstStep; s <= lastStep; s++) {
        const clickBeat = s * stepBeats;
        if (clickBeat < 0) continue;
        const clickSec = this.tempoMap.beatToSeconds(clickBeat);
        if (this.isEventInWindow(clickSec, startSec, endSec)) {
          const timeOffset = clickSec - currentAudioSeconds;
          const triggerTime = Math.max(now, now + timeOffset);

          const isMeasureStart = Math.abs(clickBeat % beatsPerMeasure) < 0.001 || Math.abs((clickBeat % beatsPerMeasure) - beatsPerMeasure) < 0.001;
          const isBeat = Math.abs(clickBeat % 1) < 0.001 || Math.abs((clickBeat % 1) - 1) < 0.001;

          let freq = 400;
          if (isMeasureStart) {
            freq = 1200;
          } else if (isBeat) {
            freq = 800;
          }
          const volumeFactor = isMeasureStart || isBeat ? 1.0 : 0.5;
          this.callbacks.onTriggerMetronome(freq, volumeFactor, triggerTime);
        }
      }
    }

    this.nextScheduledSeconds = endSec;

    // Manejo de bucle (Loop wrapping)
    if (this.isLooping && this.totalDurationSeconds > 0 && windowEndSeconds >= this.totalDurationSeconds) {
      this.startSecondsOffset = 0;
      this.playbackStartTime = now + (this.totalDurationSeconds - currentAudioSeconds);
      this.nextScheduledSeconds = 0;
    }
  }

  private isEventInWindow(evtSeconds: number, startSeconds: number, endSeconds: number): boolean {
    if (this.isLooping && this.totalDurationSeconds > 0) {
      const wrappedEvt = evtSeconds % this.totalDurationSeconds;
      const wrappedStart = startSeconds % this.totalDurationSeconds;
      const wrappedEnd = endSeconds % this.totalDurationSeconds;

      if (wrappedStart < wrappedEnd) {
        return wrappedEvt >= wrappedStart && wrappedEvt < wrappedEnd;
      } else {
        return wrappedEvt >= wrappedStart || wrappedEvt < wrappedEnd;
      }
    }
    return evtSeconds >= startSeconds && evtSeconds < endSeconds;
  }
}
