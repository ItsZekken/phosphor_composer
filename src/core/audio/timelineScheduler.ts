/**
 * timelineScheduler.ts
 * Transforma determinísticamente una SessionV2 o el estado en vivo del store
 * en una lista cronológica de eventos de audio, con caché LRU de patrones de acordes.
 * Single Source of Truth 1:1: lee directamente chordBlocks, tracks[].notes, patternChain y audioClips.
 */

import type { SessionV2 } from '../session';
import type {
  ScheduledChordEvent,
  ScheduledTrackEvent,
  ScheduledDrumEvent,
  ScheduledSessionEvents
} from './audioTypes';
import { renderChordPattern, createTempoMap, segmentChordBlockByStyleMarkers, type RenderedNote } from '../music';
import {
  normalizePatternChainToLinear,
  type ChannelConfig,
  type ChordBlock,
  type DrumChannel,
  type PatternChainItem,
  type PianoRollTrack,
  type StyleMarker,
  type TempoMarker,
  type TimeSignature
} from '../../utils/typeDefinitions';
import type { PatternDef } from '../../patterns/patternTypes';
import { getBeatsPerMeasure } from './arrangementResolver';

interface TimelineScheduleInput {
  bpm: number;
  tempoMarkers: TempoMarker[];
  swing: number;
  timeSignature: TimeSignature | string;
  channels: Record<string, ChannelConfig>;
  chordBlocks: ChordBlock[];
  styleMarkers: StyleMarker[];
  defaultPattern: string;
  chordOctaveShift: number;
  tracks: PianoRollTrack[];
  audioClips?: Array<{ isMuted?: boolean; startBeat: number; durationSeconds?: number }>;
  drumChannels: DrumChannel[];
  patternChain: PatternChainItem[];
  drumLaneMuted?: boolean[];
  isPatternRepeatOn: boolean;
  patternLengths?: number[];
  currentDrumPatternEdit?: number;
}

const CHORD_PATTERN_LRU_LIMIT = 512;
let lastCustomPatternsRef: PatternDef[] | null = null;
const chordPatternLruCache = new Map<string, RenderedNote[]>();

function renderChordPatternZeroShiftedCached(
  block: ChordBlock,
  pattern: string,
  customPatterns: PatternDef[],
  chordOctaveShift: number
): RenderedNote[] {
  if (customPatterns !== lastCustomPatternsRef) {
    chordPatternLruCache.clear();
    lastCustomPatternsRef = customPatterns;
  }

  const key = `${block.chord}|${block.durationBeats}|${block.voicing ?? ''}|${block.inversion ?? 0}|${block.type ?? ''}|${block.bassNote ?? ''}|${pattern}|${chordOctaveShift}`;
  const hit = chordPatternLruCache.get(key);
  if (hit !== undefined) {
    chordPatternLruCache.delete(key);
    chordPatternLruCache.set(key, hit);
    return hit;
  }

  const zeroBlock: ChordBlock = { ...block, startBeat: 0 };
  const computed = renderChordPattern(zeroBlock, pattern, customPatterns, chordOctaveShift);

  if (chordPatternLruCache.size >= CHORD_PATTERN_LRU_LIMIT) {
    const oldestKey = chordPatternLruCache.keys().next().value;
    if (oldestKey !== undefined) {
      chordPatternLruCache.delete(oldestKey);
    }
  }
  chordPatternLruCache.set(key, computed);
  return computed;
}

/**
 * Aplica desplazamiento de swing sobre corcheas/semicorcheas off-beat (rejilla 0.5 beats).
 * Un swing de 1.0 desplaza la semicorchea de 0.25 a 0.3333 (proporción 2:1 de tresillo).
 */
function applySwingBeat(beat: number, swing: number): number {
  if (!swing || swing <= 0.001) return beat;
  const clampedSwing = Math.max(0, Math.min(1, swing));
  const grid = 0.5;
  const posInGrid = ((beat % grid) + grid) % grid;
  const distFromOffbeat = Math.abs(posInGrid - 0.25);
  if (distFromOffbeat >= 0.25) return beat;
  const offset = (1 - distFromOffbeat / 0.25) * clampedSwing * (1 / 12);
  return beat + offset;
}

function scheduleTimelineCore(
  input: TimelineScheduleInput,
  customPatterns: PatternDef[] = []
): ScheduledSessionEvents {
  const bpm = input.bpm || 120;
  const tempoMarkers = input.tempoMarkers || [];
  const tempoMap = createTempoMap(bpm, tempoMarkers);
  const swing = input.swing || 0;
  const beatsPerMeasure = getBeatsPerMeasure(input.timeSignature);

  const chordEvents: ScheduledChordEvent[] = [];
  const trackEvents: ScheduledTrackEvent[] = [];
  const drumEvents: ScheduledDrumEvent[] = [];

  // 1. Armadura de Mute / Solo del Mixer
  const channels = input.channels || {};
  const channelValues = Object.values(channels);
  let isAnyChannelSolo = false;
  for (let i = 0; i < channelValues.length; i++) {
    const c = channelValues[i];
    if (c && c.id !== 'master' && c.solo) {
      isAnyChannelSolo = true;
      break;
    }
  }

  const isChannelAudible = (channelId: string) => {
    const ch = channels[channelId];
    if (!ch) return true;
    if (ch.muted) return false;
    if (isAnyChannelSolo && !ch.solo) return false;
    return true;
  };

  const drumChannels = input.drumChannels || [];
  let isAnyDrumSolo = false;
  for (let i = 0; i < drumChannels.length; i++) {
    if (drumChannels[i].solo) {
      isAnyDrumSolo = true;
      break;
    }
  }

  let maxBeat = beatsPerMeasure;

  // 2. Programar Acordes y Patrones Rítmicos (con caché LRU de patrones)
  const isChordsAudible = isChannelAudible('chords');
  const chordBlocks = input.chordBlocks || [];
  const sortedStyleMarkers = input.styleMarkers && input.styleMarkers.length > 1
    ? [...input.styleMarkers].sort((a, b) => a.beat - b.beat)
    : (input.styleMarkers || []);
  const defaultPattern = input.defaultPattern || 'hold';
  const chordOctaveShift = input.chordOctaveShift || 0;

  for (let i = 0; i < chordBlocks.length; i++) {
    const block = chordBlocks[i];
    const blockEnd = block.startBeat + block.durationBeats;
    if (blockEnd > maxBeat) maxBeat = blockEnd;
    if (!isChordsAudible) continue;

    const segments = segmentChordBlockByStyleMarkers(block, sortedStyleMarkers, defaultPattern);
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const baseStart = seg.block.startBeat;
      const rendered = renderChordPatternZeroShiftedCached(seg.block, seg.pattern, customPatterns, chordOctaveShift);
      for (let r = 0; r < rendered.length; r++) {
        const rn = rendered[r];
        const rawTime = baseStart + rn.timeBeats;
        const swungStart = applySwingBeat(rawTime, swing);
        const swungEnd = applySwingBeat(rawTime + rn.durationBeats, swing);
        const swungDuration = Math.max(0.02, swungEnd - swungStart);
        chordEvents.push({
          note: rn.name,
          timeSeconds: tempoMap.beatToSeconds(swungStart),
          durationSeconds: tempoMap.getDurationSeconds(swungStart, swungDuration),
          velocity: rn.velocity
        });
      }
    }
  }

  // 3. Programar Pistas Melódicas (directamente desde `track.notes`, saltando notas muteadas)
  const tracks = input.tracks || [];
  for (let t = 0; t < tracks.length; t++) {
    const track = tracks[t];
    const isAudible = isChannelAudible(track.channelId);
    const notes = track.notes || [];

    for (let nIdx = 0; nIdx < notes.length; nIdx++) {
      const n = notes[nIdx];
      const endBeat = n.startBeat + n.durationBeats;
      if (endBeat > maxBeat) maxBeat = endBeat;
      if (!isAudible || n.muted) continue;

      const swungStart = applySwingBeat(n.startBeat, swing);
      const swungEnd = applySwingBeat(endBeat, swing);
      const swungDuration = Math.max(0.02, swungEnd - swungStart);

      trackEvents.push({
        trackId: track.id,
        channelId: track.channelId,
        note: n.note,
        timeSeconds: tempoMap.beatToSeconds(swungStart),
        durationSeconds: tempoMap.getDurationSeconds(swungStart, swungDuration),
        velocity: typeof n.velocity === 'number' ? n.velocity : 0.8
      });
    }
  }

  // 4. Clips de Audio Multitrack (Extender maxBeat a la duración total de los clips de audio)
  const audioClips = input.audioClips;
  if (audioClips && audioClips.length > 0) {
    for (let i = 0; i < audioClips.length; i++) {
      const clip = audioClips[i];
      if (clip.isMuted) continue;
      const clipStartSec = tempoMap.beatToSeconds(clip.startBeat);
      const clipEndSec = clipStartSec + (clip.durationSeconds || 0);
      const clipEndBeat = tempoMap.secondsToBeat(clipEndSec);
      const ceiled = Math.ceil(clipEndBeat);
      if (ceiled > maxBeat) maxBeat = ceiled;
    }
  }

  // 5. Programar Secuenciador de Batería directamente desde `patternChain` (1:1 con Tracks y Drum Sequencer)
  const isDrumsAudible = isChannelAudible('drums');
  if (isDrumsAudible && drumChannels.length > 0) {
    const patternChain = input.patternChain || [];
    const isPatternRepeatOn = input.isPatternRepeatOn;

    if (!isPatternRepeatOn && patternChain.length > 0) {
      const linearClips = normalizePatternChainToLinear(patternChain);
      const laneMuted = input.drumLaneMuted || [];
      // Evitar doble disparo / clipping cuando 2 capas simultáneas golpean exactamente el mismo canal y tick
      const dedupIndexMap = new Map<string, number>();

      for (let c = 0; c < linearClips.length; c++) {
        const clip = linearClips[c];
        const clipStartBeat = clip.startMeasure * beatsPerMeasure;
        const clipEndBeat = (clip.startMeasure + clip.durationMeasures) * beatsPerMeasure;
        if (clipEndBeat > maxBeat) maxBeat = clipEndBeat;
        if (clip.isMuted || laneMuted[clip.laneIndex]) continue;

        const patternIdx = clip.patternIndex;
        const startWholeMeasure = Math.floor(clip.startMeasure);
        const endWholeMeasure = Math.ceil(clip.startMeasure + clip.durationMeasures);
        const patternLen = input.patternLengths?.[patternIdx] || 16;
        const stepDuration = beatsPerMeasure / patternLen;

        for (let m = startWholeMeasure; m < endWholeMeasure; m++) {
          const measureStartBeat = m * beatsPerMeasure;
          for (let stepIdx = 0; stepIdx < patternLen; stepIdx++) {
            const rawStepBeat = measureStartBeat + stepIdx * stepDuration;
            if (rawStepBeat < clipStartBeat - 1e-6 || rawStepBeat >= clipEndBeat - 1e-6) {
              continue;
            }
            const stepBeat = applySwingBeat(rawStepBeat, swing);
            const timeSeconds = tempoMap.beatToSeconds(stepBeat);
            const timeKey = Math.round(timeSeconds * 10000);

            for (let chIdx = 0; chIdx < drumChannels.length; chIdx++) {
              const ch = drumChannels[chIdx];
              if (ch.muted) continue;
              if (isAnyDrumSolo && !ch.solo) continue;
              const pat = ch.patterns?.[patternIdx];
              if (!pat) continue;

              const dStep = pat[stepIdx];
              if (dStep && dStep.isActive) {
                const dedupKey = `${ch.id}@${timeKey}`;
                const existingIdx = dedupIndexMap.get(dedupKey);
                if (existingIdx !== undefined) {
                  if (dStep.velocity > drumEvents[existingIdx].velocity) {
                    drumEvents[existingIdx].velocity = dStep.velocity;
                  }
                } else {
                  dedupIndexMap.set(dedupKey, drumEvents.length);
                  drumEvents.push({
                    channelId: ch.id,
                    sampleUrl: ch.sampleUrl,
                    timeSeconds,
                    velocity: dStep.velocity,
                    pan: ch.pan ?? 0,
                    volume: ch.volume
                  });
                }
              }
            }
          }
        }
      }
    } else {
      const patternIdx = input.currentDrumPatternEdit || 0;
      const totalMeasures = Math.max(1, Math.ceil(maxBeat / beatsPerMeasure));
      const patternLen = input.patternLengths?.[patternIdx] || 16;
      const stepDuration = beatsPerMeasure / patternLen;

      for (let m = 0; m < totalMeasures; m++) {
        const measureStartBeat = m * beatsPerMeasure;
        for (let stepIdx = 0; stepIdx < patternLen; stepIdx++) {
          const stepBeat = applySwingBeat(measureStartBeat + stepIdx * stepDuration, swing);
          const timeSeconds = tempoMap.beatToSeconds(stepBeat);

          for (let chIdx = 0; chIdx < drumChannels.length; chIdx++) {
            const ch = drumChannels[chIdx];
            if (ch.muted) continue;
            if (isAnyDrumSolo && !ch.solo) continue;
            const pat = ch.patterns?.[patternIdx];
            if (!pat) continue;

            const dStep = pat[stepIdx];
            if (dStep && dStep.isActive) {
              drumEvents.push({
                channelId: ch.id,
                sampleUrl: ch.sampleUrl,
                timeSeconds,
                velocity: dStep.velocity,
                pan: ch.pan ?? 0,
                volume: ch.volume
              });
            }
          }
        }
      }
    }
  }

  // Duración total en segundos con 2 segundos de cola para release/decay
  const totalDurationSeconds = tempoMap.getTotalDurationSeconds(maxBeat) + 2.0;

  return {
    totalBeats: maxBeat,
    totalDurationSeconds,
    chordEvents,
    trackEvents,
    drumEvents
  };
}

/**
 * Calcula los eventos programados en segundos para una sesión SessionV2.
 */
export function scheduleSessionTimeline(
  session: SessionV2,
  customPatterns: PatternDef[] = []
): ScheduledSessionEvents {
  return scheduleTimelineCore(
    {
      bpm: session.transport.bpm || 120,
      tempoMarkers: session.transport.tempoMarkers || [],
      swing: session.transport.swing || 0,
      timeSignature: session.transport.timeSignature || '4/4',
      channels: session.mixer.channels || {},
      chordBlocks: session.harmony.chordBlocks || [],
      styleMarkers: session.harmony.styleMarkers || [],
      defaultPattern: session.harmony.defaultPattern || 'hold',
      chordOctaveShift: session.harmony.chordOctaveShift || 0,
      tracks: session.tracks || [],
      audioClips: session.audio?.clips,
      drumChannels: session.drums.drumChannels || [],
      patternChain: session.drums.patternChain || [],
      drumLaneMuted: session.drums.drumLaneMuted,
      isPatternRepeatOn: Boolean(session.drums.isPatternRepeatOn),
      patternLengths: session.drums.patternLengths,
      currentDrumPatternEdit: session.drums.currentDrumPatternEdit || 0
    },
    customPatterns
  );
}

/**
 * Versión zero-copy directa sobre el estado vivo del store (evita serializeSession en tiempo real).
 */
export function scheduleStoreTimeline(state: any): ScheduledSessionEvents {
  const rawTracks: PianoRollTrack[] = state.tracks || [];
  const activeId = state.activeTrackId;
  const activeNotes = state.melodyNotes;

  const syncedTracks: PianoRollTrack[] = rawTracks.map((t) => {
    if (t.id === activeId && activeNotes && t.notes !== activeNotes) {
      return { ...t, notes: activeNotes };
    }
    return t;
  });

  return scheduleTimelineCore(
    {
      bpm: state.bpm || 120,
      tempoMarkers: state.tempoMarkers || [],
      swing: typeof state.swing === 'number' ? state.swing : 0,
      timeSignature: state.timeSignature || '4/4',
      channels: state.channels || {},
      chordBlocks: state.chordBlocks || [],
      styleMarkers: state.styleMarkers || [],
      defaultPattern: state.pattern || 'hold',
      chordOctaveShift: state.chordOctaveShift || 0,
      tracks: syncedTracks,
      audioClips: state.audioClips,
      drumChannels: state.drumChannels || [],
      patternChain: state.patternChain || [],
      drumLaneMuted: state.drumLaneMuted,
      isPatternRepeatOn: Boolean(state.isPatternRepeatOn),
      patternLengths: state.patternLengths,
      currentDrumPatternEdit: state.currentDrumPatternEdit || 0
    },
    state.customPatterns || []
  );
}
