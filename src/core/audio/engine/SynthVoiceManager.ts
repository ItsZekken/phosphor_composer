/**
 * SynthVoiceManager.ts
 * Gestor de sintetizadores analógicos virtuales, ruteo por canal y osciloscopio aislado.
 */

import type { SynthSettings } from '../../../utils/typeDefinitions';
import type { MixerGraph } from './MixerGraph';
import { PhosphorAnalogSynth } from './PhosphorAnalogSynth';

export class SynthVoiceManager {
  public chordSynth: PhosphorAnalogSynth;
  public melodySynth: PhosphorAnalogSynth;

  private trackSynths = new Map<string, PhosphorAnalogSynth>();
  private mixerGraph: MixerGraph;

  constructor(mixerGraph: MixerGraph) {
    this.mixerGraph = mixerGraph;

    const chordsChannelNode = this.mixerGraph.getChannelNode('chords');
    const melodyChannelNode = this.mixerGraph.getChannelNode('melody');

    this.chordSynth = new PhosphorAnalogSynth('chords', undefined, chordsChannelNode.volumeNode);
    this.melodySynth = new PhosphorAnalogSynth('melody', undefined, melodyChannelNode.volumeNode);
  }

  public getChannelSynth(channelId: string): PhosphorAnalogSynth {
    if (channelId === 'melody') return this.melodySynth;
    if (channelId === 'chords') return this.chordSynth;

    const existing = this.trackSynths.get(channelId);
    if (existing) return existing;

    const channelNode = this.mixerGraph.getChannelNode(channelId);
    const newSynth = new PhosphorAnalogSynth(channelId, undefined, channelNode.volumeNode);
    this.trackSynths.set(channelId, newSynth);
    return newSynth;
  }

  public updateSynthSettings(settings: Partial<SynthSettings>, channelId?: string) {
    if (!settings) return;
    try {
      if (channelId === 'chords') {
        this.chordSynth.setSettings(settings);
      } else if (channelId === 'melody') {
        this.melodySynth.setSettings(settings);
      } else if (channelId) {
        const synth = this.getChannelSynth(channelId);
        synth.setSettings(settings);
      } else {
        this.chordSynth.setSettings(settings);
        this.melodySynth.setSettings(settings);
        this.trackSynths.forEach((synth) => {
          synth.setSettings(settings);
        });
      }
    } catch (e) {
      console.error('Error actualizando ajustes del sintetizador:', e);
    }
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
    try { this.chordSynth.disconnectAnalysers(); } catch (_) {}
    try { this.melodySynth.disconnectAnalysers(); } catch (_) {}
    this.trackSynths.forEach((synth) => {
      try { synth.disconnectAnalysers(); } catch (_) {}
    });
  }

  public syncTrackSynths(activeChannelIds: string[]) {
    const activeSet = new Set(activeChannelIds);
    for (const [chId, synth] of this.trackSynths.entries()) {
      if (!activeSet.has(chId)) {
        try {
          synth.dispose();
        } catch (_) {}
        this.trackSynths.delete(chId);
      }
    }
  }

  public updateSustain(sustain: boolean) {
    const releaseTime = sustain ? 2.5 : 0.8;
    this.chordSynth.setSettings({ envelope: { ...this.chordSynth.getSettings().envelope, release: releaseTime } });
  }

  public releaseAll() {
    try { this.chordSynth.releaseAll(); } catch (_) {}
    try { this.melodySynth.releaseAll(); } catch (_) {}
    this.trackSynths.forEach((s) => {
      try { s.releaseAll(); } catch (_) {}
    });
  }

  public dispose() {
    this.releaseAll();
    try { this.chordSynth.dispose(); } catch (_) {}
    try { this.melodySynth.dispose(); } catch (_) {}
    this.trackSynths.forEach((s) => { try { s.dispose(); } catch (_) {} });
    this.trackSynths.clear();
  }
}
