/**
 * liveTelemetryBus.ts
 * Bus de telemetría imperativo de ultra-baja latencia (cero React re-renders, cero setTimeout, cero GC en loop caliente).
 * Desacopla el estado efímero de reproducción en vivo (teclas iluminadas y paso/clip actual del secuenciador)
 * de Zustand para mantener el hilo principal a 60 FPS incluso en proyectos densos.
 */

import * as Tone from 'tone';

export interface ActiveNotesSnapshot {
  harmony: string[];
  melody: string[];
}

export interface DrumStepSnapshot {
  step: number;
  chainItemId: string | null;
  activeChainItemIds: string[];
}

interface ScheduledVisualNote {
  note: string;
  startTimeSec: number;
  endTimeSec: number;
  kind: 'harmony' | 'melody';
}

type ActiveNotesListener = (snapshot: ActiveNotesSnapshot) => void;
type DrumStepListener = (snapshot: DrumStepSnapshot) => void;

const MAX_SCHEDULED_NOTES = 384;

class LiveTelemetryBus {
  private scheduledNotes: ScheduledVisualNote[] = [];
  private manualHarmony: string[] = [];
  private manualMelody: string[] = [];

  private currentHarmony: string[] = [];
  private currentMelody: string[] = [];
  private activeNotesListeners = new Set<ActiveNotesListener>();

  private currentStep = -1;
  private currentChainItemId: string | null = null;
  private currentActiveChainItemIds: string[] = [];
  private drumStepListeners = new Set<DrumStepListener>();

  private rafId: number | null = null;
  private scratchHarmony: string[] = [];
  private scratchMelody: string[] = [];

  private getCurrentAudioTime(): number {
    try {
      return Tone.now();
    } catch (_) {
      return 0;
    }
  }

  public scheduleVisualNote(
    note: string,
    audioTimeSec: number,
    durationSec: number,
    kind: 'harmony' | 'melody'
  ): void {
    const startTimeSec = Number.isFinite(audioTimeSec) ? audioTimeSec : this.getCurrentAudioTime();
    const safeDur = Math.max(0.035, Math.min(8.0, Number.isFinite(durationSec) ? durationSec : 0.1));
    const endTimeSec = startTimeSec + safeDur;

    // Coalescer re-disparos ultra-rápidos sobre exactamente la misma tecla (< 25 ms) en tormentas tipo Rush E
    for (let i = this.scheduledNotes.length - 1; i >= Math.max(0, this.scheduledNotes.length - 48); i--) {
      const existing = this.scheduledNotes[i];
      if (
        existing.note === note &&
        existing.kind === kind &&
        Math.abs(existing.startTimeSec - startTimeSec) < 0.025
      ) {
        if (endTimeSec > existing.endTimeSec) {
          existing.endTimeSec = endTimeSec;
        }
        this.ensureRafRunning();
        return;
      }
    }

    if (this.scheduledNotes.length >= MAX_SCHEDULED_NOTES) {
      // Descartar notas expiradas o reemplazar la mitad más antigua sin .shift() repetitivo
      const now = this.getCurrentAudioTime();
      let writeIdx = 0;
      for (let i = 0; i < this.scheduledNotes.length; i++) {
        if (this.scheduledNotes[i].endTimeSec > now) {
          this.scheduledNotes[writeIdx++] = this.scheduledNotes[i];
        }
      }
      this.scheduledNotes.length = writeIdx;
      if (this.scheduledNotes.length >= MAX_SCHEDULED_NOTES) {
        this.scheduledNotes.splice(0, 32);
      }
    }

    this.scheduledNotes.push({ note, startTimeSec, endTimeSec, kind });
    this.ensureRafRunning();
  }

  public clearScheduledNotes(): void {
    this.scheduledNotes.length = 0;
    this.stopRafIfIdle();
    this.recomputeActiveNotes(true);
  }

  public setManualNotes(kind: 'harmony' | 'melody', notes: string[]): void {
    const clean = Array.isArray(notes) ? [...notes] : [];
    if (kind === 'harmony') {
      this.manualHarmony = clean;
    } else {
      this.manualMelody = clean;
    }
    this.recomputeActiveNotes(false);
  }

  public getActiveNotesSnapshot(): ActiveNotesSnapshot {
    return {
      harmony: this.currentHarmony,
      melody: this.currentMelody
    };
  }

  public subscribeActiveNotes(listener: ActiveNotesListener, emitImmediately = true): () => void {
    this.activeNotesListeners.add(listener);
    if (emitImmediately) {
      listener(this.getActiveNotesSnapshot());
    }
    return () => {
      this.activeNotesListeners.delete(listener);
    };
  }

  public emitDrumStep(
    step: number,
    chainItemId: string | null,
    activeChainItemIds?: string[]
  ): void {
    const nextIds = activeChainItemIds
      ? activeChainItemIds
      : chainItemId
      ? [chainItemId]
      : [];
    if (
      this.currentStep === step &&
      this.currentChainItemId === chainItemId &&
      this.arraysEqual(this.currentActiveChainItemIds, nextIds)
    ) {
      return;
    }
    this.currentStep = step;
    this.currentChainItemId = chainItemId;
    this.currentActiveChainItemIds = nextIds.slice();
    const snap: DrumStepSnapshot = {
      step,
      chainItemId,
      activeChainItemIds: this.currentActiveChainItemIds
    };
    this.drumStepListeners.forEach((listener) => {
      try {
        listener(snap);
      } catch {}
    });
  }

  public getDrumStepSnapshot(): DrumStepSnapshot {
    return {
      step: this.currentStep,
      chainItemId: this.currentChainItemId,
      activeChainItemIds: this.currentActiveChainItemIds
    };
  }

  public subscribeDrumStep(listener: DrumStepListener, emitImmediately = true): () => void {
    this.drumStepListeners.add(listener);
    if (emitImmediately) {
      listener(this.getDrumStepSnapshot());
    }
    return () => {
      this.drumStepListeners.delete(listener);
    };
  }

  public reset(): void {
    this.scheduledNotes.length = 0;
    this.manualHarmony = [];
    this.manualMelody = [];
    this.stopRafIfIdle();
    this.recomputeActiveNotes(true);
    this.emitDrumStep(-1, null);
  }

  private ensureRafRunning(): void {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    const tick = () => {
      this.rafId = null;
      this.recomputeActiveNotes(false);
      if (this.scheduledNotes.length > 0 && typeof requestAnimationFrame !== 'undefined') {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRafIfIdle(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private recomputeActiveNotes(forceClearScheduled: boolean): void {
    const now = this.getCurrentAudioTime();
    const hList = this.scratchHarmony;
    const mList = this.scratchMelody;
    hList.length = 0;
    mList.length = 0;

    for (let i = 0; i < this.manualHarmony.length; i++) {
      const n = this.manualHarmony[i];
      if (!hList.includes(n)) hList.push(n);
    }
    for (let i = 0; i < this.manualMelody.length; i++) {
      const n = this.manualMelody[i];
      if (!mList.includes(n)) mList.push(n);
    }

    if (!forceClearScheduled && this.scheduledNotes.length > 0) {
      let writeIdx = 0;
      for (let i = 0; i < this.scheduledNotes.length; i++) {
        const item = this.scheduledNotes[i];
        if (item.endTimeSec <= now) continue;
        this.scheduledNotes[writeIdx++] = item;
        if (item.startTimeSec <= now + 0.012) {
          if (item.kind === 'harmony') {
            if (!hList.includes(item.note)) hList.push(item.note);
          } else {
            if (!mList.includes(item.note)) mList.push(item.note);
          }
        }
      }
      this.scheduledNotes.length = writeIdx;
    }

    const harmonyChanged = !this.arraysEqual(this.currentHarmony, hList);
    const melodyChanged = !this.arraysEqual(this.currentMelody, mList);
    if (!harmonyChanged && !melodyChanged) return;

    if (harmonyChanged) this.currentHarmony = hList.slice();
    if (melodyChanged) this.currentMelody = mList.slice();

    const snap: ActiveNotesSnapshot = {
      harmony: this.currentHarmony,
      melody: this.currentMelody
    };
    this.activeNotesListeners.forEach((listener) => {
      try {
        listener(snap);
      } catch (_) {}
    });
  }
}

export const liveTelemetryBus = new LiveTelemetryBus();
