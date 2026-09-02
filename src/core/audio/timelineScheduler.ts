/**
 * timelineScheduler.ts
 * Transforma determinísticamente una SessionV2 en una lista cronológica de eventos de audio.
 */

import type { SessionV2 } from '../session';
import type { 
  ScheduledChordEvent, 
  ScheduledTrackEvent, 
  ScheduledDrumEvent, 
  ScheduledSessionEvents 
} from './audioTypes';
import { renderChordPattern, createTempoMap } from '../music';
import { flattenPatternChain } from '../../utils/typeDefinitions';
import type { PatternDef } from '../../patterns/patternTypes';

/**
 * Calcula los eventos programados en segundos para una sesión completa usando el mapa de tempo.
 */
export function scheduleSessionTimeline(
  session: SessionV2, 
  customPatterns: PatternDef[] = []
): ScheduledSessionEvents {
  const bpm = session.transport.bpm || 120;
  const tempoMarkers = session.transport.tempoMarkers || [];
  const tempoMap = createTempoMap(bpm, tempoMarkers);

  const chordEvents: ScheduledChordEvent[] = [];
  const trackEvents: ScheduledTrackEvent[] = [];
  const drumEvents: ScheduledDrumEvent[] = [];

  let maxBeat = 4;

  // 1. Armadura de Mute / Solo del Mixer
  const channels = session.mixer.channels || {};
  const isAnyChannelSolo = Object.values(channels).filter(c => c.id !== 'master').some(c => c.solo);

  const isChannelAudible = (channelId: string) => {
    const ch = channels[channelId];
    if (!ch) return true;
    if (ch.muted) return false;
    if (isAnyChannelSolo && !ch.solo) return false;
    return true;
  };

  // 2. Programar Acordes y Patrones Rítmicos
  const isChordsAudible = isChannelAudible('chords');
  const chordBlocks = session.harmony.chordBlocks || [];
  const styleMarkers = [...(session.harmony.styleMarkers || [])].sort((a, b) => a.beat - b.beat);
  const defaultPattern = session.harmony.defaultPattern || 'hold';
  const chordOctaveShift = session.harmony.chordOctaveShift || 0;

  chordBlocks.forEach(block => {
    maxBeat = Math.max(maxBeat, block.startBeat + block.durationBeats);
    if (!isChordsAudible) return;

    // Encontrar el patrón aplicable según los styleMarkers
    let activePattern = defaultPattern;
    for (const marker of styleMarkers) {
      if (marker.beat <= block.startBeat) {
        activePattern = marker.pattern;
      } else {
        break;
      }
    }

    const rendered = renderChordPattern(block, activePattern, customPatterns, chordOctaveShift);
    rendered.forEach(rn => {
      chordEvents.push({
        note: rn.name,
        timeSeconds: tempoMap.beatToSeconds(rn.timeBeats),
        durationSeconds: tempoMap.getDurationSeconds(rn.timeBeats, rn.durationBeats),
        velocity: rn.velocity
      });
    });
  });

  // 3. Programar Pistas Melódicas del Piano Roll
  const tracks = session.tracks || [];
  tracks.forEach(track => {
    const isAudible = isChannelAudible(track.channelId);
    (track.notes || []).forEach(n => {
      maxBeat = Math.max(maxBeat, n.startBeat + n.durationBeats);
      if (!isAudible) return;

      trackEvents.push({
        trackId: track.id,
        channelId: track.channelId,
        note: n.note,
        timeSeconds: tempoMap.beatToSeconds(n.startBeat),
        durationSeconds: tempoMap.getDurationSeconds(n.startBeat, n.durationBeats),
        velocity: typeof n.velocity === 'number' ? n.velocity : 0.8
      });
    });
  });

  // 4. Programar Secuenciador de Batería
  const isDrumsAudible = isChannelAudible('drums');
  const drumChannels = session.drums.drumChannels || [];
  const isAnyDrumSolo = drumChannels.some(d => d.solo);

  const patternChain = session.drums.patternChain || [];
  const isPatternRepeatOn = session.drums.isPatternRepeatOn;

  if (isDrumsAudible && drumChannels.length > 0) {
    if (!isPatternRepeatOn && patternChain.length > 0) {
      const flatChain = flattenPatternChain(patternChain);
      const totalMeasures = flatChain.length;
      const totalChainBeats = totalMeasures * 4;
      maxBeat = Math.max(maxBeat, totalChainBeats);

      flatChain.forEach((step, measureIdx) => {
        const patternIdx = step.patternIndex;
        const measureStartBeat = measureIdx * 4;

        for (let stepIdx = 0; stepIdx < 16; stepIdx++) {
          const stepBeat = measureStartBeat + (stepIdx * 0.25);
          const timeSeconds = tempoMap.beatToSeconds(stepBeat);

          drumChannels.forEach(ch => {
            if (ch.muted) return;
            if (isAnyDrumSolo && !ch.solo) return;
            if (!ch.patterns || !ch.patterns[patternIdx]) return;

            const dStep = ch.patterns[patternIdx][stepIdx];
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
          });
        }
      });
    } else {
      // Bucle de 1 compás (16 pasos) hasta alcanzar maxBeat
      const patternIdx = session.drums.currentDrumPatternEdit || 0;
      const totalMeasures = Math.max(1, Math.ceil(maxBeat / 4));

      for (let m = 0; m < totalMeasures; m++) {
        const measureStartBeat = m * 4;
        for (let stepIdx = 0; stepIdx < 16; stepIdx++) {
          const stepBeat = measureStartBeat + (stepIdx * 0.25);
          const timeSeconds = tempoMap.beatToSeconds(stepBeat);

          drumChannels.forEach(ch => {
            if (ch.muted) return;
            if (isAnyDrumSolo && !ch.solo) return;
            if (!ch.patterns || !ch.patterns[patternIdx]) return;

            const dStep = ch.patterns[patternIdx][stepIdx];
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
          });
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
