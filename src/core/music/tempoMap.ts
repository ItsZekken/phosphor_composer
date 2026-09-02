/**
 * tempoMap.ts
 * Motor matematico de mapeo de tempo (Tempo Map) determinista.
 * Realiza conversiones bidireccionales continuas entre tiempo metrico (beats) y tiempo de audio (segundos).
 */

import type { TempoMarker } from '../../utils/typeDefinitions';

export interface TempoSegment {
  startBeat: number;
  bpm: number;
  startSeconds: number;
  secondsPerBeat: number;
}

export class TempoMap {
  public readonly baseBpm: number;
  public readonly segments: TempoSegment[];

  constructor(baseBpm: number = 120, markers: TempoMarker[] = []) {
    const validBaseBpm = typeof baseBpm === 'number' && baseBpm >= 30 && baseBpm <= 360 ? baseBpm : 120;
    this.baseBpm = validBaseBpm;

    // 1. Filtrar y ordenar marcadores validos
    const validMarkers = (markers || [])
      .filter((m) => m && typeof m.bpm === 'number' && m.bpm >= 30 && m.bpm <= 360 && typeof m.beat === 'number' && m.beat >= 0)
      .sort((a, b) => a.beat - b.beat);

    // Deduplicar marcadores en el mismo beat (el ultimo prevalece)
    const uniqueMap = new Map<number, number>();
    validMarkers.forEach((m) => {
      uniqueMap.set(m.beat, m.bpm);
    });

    // Asegurar segmento inicial en beat 0
    if (!uniqueMap.has(0)) {
      uniqueMap.set(0, validBaseBpm);
    }

    const sortedBeats = Array.from(uniqueMap.keys()).sort((a, b) => a - b);

    // 2. Construir segmentos continuos precalculando segundos acumulados
    const segments: TempoSegment[] = [];
    let accumulatedSeconds = 0;

    for (let i = 0; i < sortedBeats.length; i++) {
      const beat = sortedBeats[i];
      const bpm = uniqueMap.get(beat)!;
      const secondsPerBeat = 60 / bpm;

      if (i > 0) {
        const prevSeg = segments[i - 1];
        const deltaBeats = beat - prevSeg.startBeat;
        accumulatedSeconds = prevSeg.startSeconds + deltaBeats * prevSeg.secondsPerBeat;
      }

      segments.push({
        startBeat: beat,
        bpm,
        startSeconds: accumulatedSeconds,
        secondsPerBeat
      });
    }

    this.segments = segments;
  }

  /**
   * Obtiene el BPM activo en un compas / beat especifico.
   */
  public getBpmAtBeat(beat: number): number {
    if (this.segments.length === 0) return this.baseBpm;
    if (beat <= this.segments[0].startBeat) return this.segments[0].bpm;

    let low = 0;
    let high = this.segments.length - 1;
    let bestIdx = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.segments[mid].startBeat <= beat) {
        bestIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return this.segments[bestIdx].bpm;
  }

  /**
   * Obtiene el BPM activo en un segundo de audio especifico.
   */
  public getBpmAtSeconds(seconds: number): number {
    if (this.segments.length === 0) return this.baseBpm;
    if (seconds <= this.segments[0].startSeconds) return this.segments[0].bpm;

    let low = 0;
    let high = this.segments.length - 1;
    let bestIdx = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.segments[mid].startSeconds <= seconds) {
        bestIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return this.segments[bestIdx].bpm;
  }

  /**
   * Convierte una posicion metrica en beats a segundos absolutos de audio.
   */
  public beatToSeconds(beat: number): number {
    if (beat <= 0) return 0;
    if (this.segments.length === 0) return (beat * 60) / this.baseBpm;

    let low = 0;
    let high = this.segments.length - 1;
    let bestIdx = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.segments[mid].startBeat <= beat) {
        bestIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const seg = this.segments[bestIdx];
    return seg.startSeconds + (beat - seg.startBeat) * seg.secondsPerBeat;
  }

  /**
   * Convierte un tiempo de audio en segundos al beat correspondiente en la linea de tiempo.
   */
  public secondsToBeat(seconds: number): number {
    if (seconds <= 0) return 0;
    if (this.segments.length === 0) return (seconds * this.baseBpm) / 60;

    let low = 0;
    let high = this.segments.length - 1;
    let bestIdx = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.segments[mid].startSeconds <= seconds) {
        bestIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const seg = this.segments[bestIdx];
    return seg.startBeat + (seconds - seg.startSeconds) / seg.secondsPerBeat;
  }

  /**
   * Calcula la duracion exacta en segundos de un evento metrico.
   */
  public getDurationSeconds(startBeat: number, durationBeats: number): number {
    const startSec = this.beatToSeconds(startBeat);
    const endSec = this.beatToSeconds(startBeat + durationBeats);
    return Math.max(0.001, endSec - startSec);
  }

  /**
   * Duracion total en segundos para una longitud en beats.
   */
  public getTotalDurationSeconds(totalBeats: number): number {
    return this.beatToSeconds(totalBeats);
  }
}

/**
 * Factory helper para instanciar un TempoMap.
 */
export function createTempoMap(baseBpm: number = 120, markers: TempoMarker[] = []): TempoMap {
  return new TempoMap(baseBpm, markers);
}
