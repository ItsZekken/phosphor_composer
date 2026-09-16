/**
 * AudioTrackEngine.ts
 * Motor de reproducción multitrack de pistas de audio sincronizado con LookaheadScheduler y MixerGraph.
 * Dispara clips de audio mediante Tone.ToneBufferSource en el grafo de audio principal con micro-fades anti-click.
 * Garantiza cero consumo de CPU cuando no existen clips activos.
 */

import * as Tone from 'tone';
import type { MixerGraph } from './MixerGraph';
import type { TempoMap } from '../../music';
import { audioBufferRegistry } from '../audioBufferRegistry';
import { useSongStore } from '../../../store/songStore';
import { getNativeAudioContext } from '../worklet/PhosphorWorkletNode';

export class AudioTrackEngine {
  private mixerGraph: MixerGraph;
  private activeSources = new Set<Tone.ToneBufferSource>();
  private scheduledClipEvents = new Set<string>(); // Evita double-trigger dentro de la ventana de lookahead

  constructor(mixerGraph: MixerGraph) {
    this.mixerGraph = mixerGraph;
  }

  /**
   * Programa los clips de audio que caen dentro de la ventana [startSec, endSec).
   * Llamado en cada ciclo (25 ms) por LookaheadScheduler.
   */
  public scheduleWindow(startSec: number, endSec: number, currentAudioSeconds: number, tempoMap: TempoMap): void {
    const state = useSongStore.getState();
    const clips = state.audioClips;
    if (!clips || clips.length === 0) return;

    const tracks = state.audioTracks || [];
    const trackMap = new Map(tracks.map((t) => [t.id, t]));

    const hasAnySolo = tracks.some((t) => t.solo);
    const now = Tone.now();

    for (const clip of clips) {
      if (clip.isMuted) continue;

      const track = trackMap.get(clip.trackId);
      if (track?.muted) continue;
      if (hasAnySolo && !track?.solo) continue;

      // Convertir el compás de inicio a segundos según el mapa de tempo
      const clipStartSec = tempoMap.beatToSeconds(clip.startBeat);
      const clipEndSec = clipStartSec + clip.durationSeconds;

      // Comprobar si el clip intersecta el horizonte de programación
      const overlaps = clipStartSec < endSec && clipEndSec > startSec;
      if (!overlaps) continue;

      // Clave de unicidad para evitar disparar el mismo clip dos veces en la misma pasada
      const eventKey = `${clip.id}_${Math.floor(clipStartSec * 100)}`;
      if (this.scheduledClipEvents.has(eventKey)) continue;

      const buffer = audioBufferRegistry.getBuffer(clip.bufferId);
      if (!buffer) {
        const nativeCtx = getNativeAudioContext();
        if (nativeCtx) {
          audioBufferRegistry.loadBufferFromIndexedDB(clip.bufferId, nativeCtx).catch(() => {});
        }
        continue;
      }

      // Calcular tiempo de disparo y offsets
      const timeOffset = clipStartSec - currentAudioSeconds;
      let when: number;
      let sourceOffset: number;
      let playDuration: number;

      if (timeOffset >= 0) {
        when = Math.max(now, now + timeOffset);
        sourceOffset = clip.sourceOffsetSeconds;
        playDuration = clip.durationSeconds;
      } else {
        // Reproducción comenzada en medio del clip
        when = now;
        const elapsed = -timeOffset;
        sourceOffset = clip.sourceOffsetSeconds + elapsed;
        playDuration = Math.max(0, clip.durationSeconds - elapsed);
      }

      if (playDuration <= 0.005) continue;
      if (sourceOffset >= buffer.duration) continue;

      try {
        const source = new Tone.ToneBufferSource(buffer);
        const channelNode = this.mixerGraph.getChannelNode(clip.trackId);

        source.fadeIn = Math.max(0.003, clip.fadeInSeconds || 0.003);
        source.fadeOut = Math.max(0.003, clip.fadeOutSeconds || 0.003);

        source.connect(channelNode.volumeNode);
        source.start(when, sourceOffset, playDuration, clip.gain ?? 1.0);

        this.activeSources.add(source);
        this.scheduledClipEvents.add(eventKey);

        source.onended = () => {
          this.activeSources.delete(source);
          try {
            source.dispose();
          } catch {}
        };
      } catch (err) {
        console.warn(`[AudioTrackEngine] Error programando clip ${clip.name}:`, err);
      }
    }
  }

  /**
   * Resetea el registro de eventos programados al reiniciar o saltar de bucle (Loop Wrap).
   */
  public onLoopWrap(): void {
    this.scheduledClipEvents.clear();
  }

  /**
   * Detiene inmediatamente todos los nodos activos de audio y limpia referencias.
   */
  public stop(): void {
    const now = Tone.now();
    for (const source of this.activeSources) {
      try {
        source.stop(now);
        source.dispose();
      } catch {}
    }
    this.activeSources.clear();
    this.scheduledClipEvents.clear();
  }

  /**
   * Limpia eventos al realizar un salto de compás (Seek).
   */
  public seek(): void {
    this.stop();
  }
}
