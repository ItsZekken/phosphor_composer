/**
 * audioTypes.ts
 * Tipos canónicos para el motor de audio, scheduler de timeline y renderizado offline.
 */

export type OfflineRenderProgressCallback = (elapsedSeconds: number, totalSeconds: number) => void;

export interface OfflineRenderOptions {
  sampleRate?: number;
  onProgress?: OfflineRenderProgressCallback;
  normalize?: boolean;
  targetPeakDb?: number;
  drumBuffers?: Map<string, any>;
}

export interface ScheduledChordEvent {
  note: string;
  timeSeconds: number;
  durationSeconds: number;
  velocity: number;
}

export interface ScheduledTrackEvent {
  trackId: string;
  channelId: string;
  note: string;
  timeSeconds: number;
  durationSeconds: number;
  velocity: number;
}

export interface ScheduledDrumEvent {
  channelId: string;
  sampleUrl: string;
  timeSeconds: number;
  velocity: number;
  pan: number;
  volume: number;
}

export interface ScheduledSessionEvents {
  totalBeats: number;
  totalDurationSeconds: number;
  chordEvents: ScheduledChordEvent[];
  trackEvents: ScheduledTrackEvent[];
  drumEvents: ScheduledDrumEvent[];
}
