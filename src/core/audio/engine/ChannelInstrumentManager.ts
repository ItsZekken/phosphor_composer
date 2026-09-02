/**
 * ChannelInstrumentManager.ts
 * Gestor unificado y dinámico de instrumentos musicales por canal (Sintetizadores Virtuales y Samplers de Piano).
 * Elimina cualquier dependencia de canales fijos o hardcodeados permitiendo paridad total en N canales.
 */

import * as Tone from 'tone';
import type { ChannelConfig, SynthSettings } from '../../../utils/typeDefinitions';
import type { MixerGraph } from './MixerGraph';
import { PhosphorAnalogSynth } from './PhosphorAnalogSynth';
import { PianoSampler, preloadPianoBuffers } from '../pianoSampler';

export class ChannelInstrumentManager {
  private synths = new Map<string, PhosphorAnalogSynth>();
  private pianos = new Map<string, PianoSampler>();
  private mixerGraph: MixerGraph;
  private isSustainActive = false;

  constructor(mixerGraph: MixerGraph) {
    this.mixerGraph = mixerGraph;
  }

  /**
   * Obtiene o instancia el sintetizador analógico conectado al canal del mezclador.
   */
  public getChannelSynth(channelId: string): PhosphorAnalogSynth {
    let synth = this.synths.get(channelId);
    if (!synth) {
      const channelNode = this.mixerGraph.getChannelNode(channelId);
      synth = new PhosphorAnalogSynth(channelId, undefined, channelNode.volumeNode);
      if (this.isSustainActive) {
        synth.setSettings({ envelope: { ...synth.getSettings().envelope, release: 2.5 } });
      }
      this.synths.set(channelId, synth);
    }
    return synth;
  }

  /**
   * Obtiene o instancia el sampler de piano conectado al canal del mezclador.
   */
  public getChannelPiano(channelId: string): PianoSampler {
    let piano = this.pianos.get(channelId);
    if (!piano) {
      const channelNode = this.mixerGraph.getChannelNode(channelId);
      piano = new PianoSampler(channelNode.volumeNode);
      if (this.isSustainActive) {
        piano.pedalDown();
      }
      this.pianos.set(channelId, piano);
    }
    return piano;
  }

  public isPianoLoaded(channelId: string): boolean {
    const piano = this.pianos.get(channelId);
    return piano ? piano.loaded : false;
  }

  public isPianoLoading(channelId: string): boolean {
    const piano = this.pianos.get(channelId);
    return piano ? piano.isLoading : false;
  }

  /**
   * Precarga de forma asíncrona todos los samplers de piano y sintetizadores para los canales activos.
   */
  public async preloadChannelInstruments(channels: Record<string, ChannelConfig>): Promise<void> {
    if (!channels) return;

    // 1. Precargar buffers globales de piano si algún canal lo requiere
    const hasAnyPiano = Object.values(channels).some((ch) => ch.instrument === 'piano');
    if (hasAnyPiano) {
      await preloadPianoBuffers();
    }

    const loadPromises: Promise<unknown>[] = [];

    // 2. Instanciar y precargar samplers y sintes para cada canal
    Object.entries(channels).forEach(([channelId, config]) => {
      if (config.instrument === 'piano') {
        const piano = this.getChannelPiano(channelId);
        if (!piano.loaded && !piano.isLoading) {
          loadPromises.push(piano.load());
        }
      } else {
        const synth = this.getChannelSynth(channelId);
        if (config.synthSettings) {
          synth.setSettings(config.synthSettings);
        }
      }
    });

    if (loadPromises.length > 0) {
      await Promise.allSettled(loadPromises);
    }
  }

  /**
   * Dispara una nota o conjunto de notas según el instrumento asignado al canal.
   */
  public triggerAttackRelease(
    channelId: string,
    isPiano: boolean,
    notes: string | string[],
    duration: number | string,
    time?: number,
    velocity = 0.8
  ) {
    if (isPiano) {
      const piano = this.getChannelPiano(channelId);
      if (piano.loaded) {
        piano.triggerAttackRelease(notes, duration, time, velocity);
        return;
      }
    }
    const synth = this.getChannelSynth(channelId);
    synth.triggerAttackRelease(notes, duration, time, velocity);
  }

  /**
   * Inicia el ataque continuo de una nota.
   */
  public keyDown(
    channelId: string,
    isPiano: boolean,
    note: string,
    time?: number,
    velocity = 0.8
  ) {
    if (isPiano) {
      const piano = this.getChannelPiano(channelId);
      if (piano.loaded) {
        piano.keyDown({ note, time, velocity });
        return;
      }
    }
    const synth = this.getChannelSynth(channelId);
    synth.triggerAttack(note, time, velocity);
  }

  /**
   * Libera la nota sostenida.
   */
  public keyUp(
    channelId: string,
    isPiano: boolean,
    note: string,
    time?: number
  ) {
    if (isPiano) {
      const piano = this.getChannelPiano(channelId);
      if (piano.loaded) {
        piano.keyUp({ note, time });
        return;
      }
    }
    const synth = this.getChannelSynth(channelId);
    synth.triggerRelease(note, time);
  }

  public updateSynthSettings(settings: Partial<SynthSettings>, channelId?: string) {
    if (!settings) return;
    if (channelId) {
      const synth = this.getChannelSynth(channelId);
      synth.setSettings(settings);
    } else {
      this.synths.forEach((synth) => {
        synth.setSettings(settings);
      });
    }
  }

  public updateSustain(sustain: boolean) {
    this.isSustainActive = sustain;
    const releaseTime = sustain ? 2.5 : 0.8;

    this.synths.forEach((synth) => {
      synth.setSettings({ envelope: { ...synth.getSettings().envelope, release: releaseTime } });
    });

    this.pianos.forEach((piano) => {
      try {
        if (sustain) piano.pedalDown();
        else piano.pedalUp();
      } catch (e) {
        console.warn('Error al aplicar sustain en el piano:', e);
      }
    });
  }

  public getChannelWaveform(channelId: string, target?: Float32Array): Float32Array {
    const synth = this.getChannelSynth(channelId);
    return synth.getWaveformData(target);
  }

  public getChannelFrequency(channelId: string, target?: Float32Array): Float32Array {
    const synth = this.getChannelSynth(channelId);
    return synth.getFrequencyData(target);
  }

  public disconnectAnalysers() {
    this.synths.forEach((synth) => {
      try { synth.disconnectAnalysers(); } catch (_) {}
    });
  }

  public releaseAll(time?: number) {
    const triggerTime = time !== undefined ? time : Tone.now();
    this.synths.forEach((synth) => {
      try { synth.releaseAll(triggerTime); } catch (_) {}
    });
    this.pianos.forEach((piano) => {
      try { piano.stopAll(); } catch (_) {}
    });
  }

  public stopAll() {
    this.releaseAll();
  }

  public syncActiveChannels(activeChannelIds: string[]) {
    const activeSet = new Set(activeChannelIds);

    // Limpiar sintetizadores de canales que fueron eliminados
    for (const [chId, synth] of this.synths.entries()) {
      if (!activeSet.has(chId) && chId !== 'chords' && chId !== 'melody') {
        try { synth.dispose(); } catch (_) {}
        this.synths.delete(chId);
      }
    }

    // Limpiar samplers de piano de canales eliminados
    for (const [chId, piano] of this.pianos.entries()) {
      if (!activeSet.has(chId) && chId !== 'chords' && chId !== 'melody') {
        try { piano.dispose(); } catch (_) {}
        this.pianos.delete(chId);
      }
    }
  }

  public dispose() {
    this.releaseAll();
    this.synths.forEach((synth) => {
      try { synth.dispose(); } catch (_) {}
    });
    this.synths.clear();

    this.pianos.forEach((piano) => {
      try { piano.dispose(); } catch (_) {}
    });
    this.pianos.clear();
  }
}
