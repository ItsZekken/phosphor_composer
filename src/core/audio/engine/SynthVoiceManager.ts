/**
 * SynthVoiceManager.ts
 * Gestor de sintetizadores polifónicos, filtros y modelado tímbrico.
 */

import * as Tone from 'tone';
import type { SynthSettings } from '../../../utils/typeDefinitions';
import type { MixerGraph } from './MixerGraph';

export class SynthVoiceManager {
  public chordSynth: Tone.PolySynth;
  public melodySynth: Tone.PolySynth;
  public synthFilter: Tone.Filter;
  public melodyFilter: Tone.Filter;

  private trackSynths = new Map<string, Tone.PolySynth>();
  private trackFilters = new Map<string, Tone.Filter>();
  private mixerGraph: MixerGraph;

  constructor(mixerGraph: MixerGraph) {
    this.mixerGraph = mixerGraph;

    try {
      const chordsChannelNode = this.mixerGraph.getChannelNode('chords');
      const melodyChannelNode = this.mixerGraph.getChannelNode('melody');

      this.synthFilter = new Tone.Filter({
        frequency: 20000,
        type: 'lowpass',
        Q: 1
      }).connect(chordsChannelNode.volumeNode);

      this.chordSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.1, decay: 0.3, sustain: 0.4, release: 0.8 }
      });
      this.chordSynth.connect(this.synthFilter);
      this.chordSynth.volume.value = -12;

      this.melodyFilter = new Tone.Filter({
        frequency: 20000,
        type: 'lowpass',
        Q: 1
      }).connect(melodyChannelNode.volumeNode);

      this.melodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.5 }
      });
      this.melodySynth.connect(this.melodyFilter);
      this.melodySynth.volume.value = -6;
    } catch (_) {
      const mockSynth = {
        volume: { value: 0 },
        set: () => {},
        connect: () => {},
        triggerAttack: () => {},
        triggerRelease: () => {},
        triggerAttackRelease: () => {},
        releaseAll: () => {},
        dispose: () => {}
      } as any;
      const mockFilter = {
        frequency: { value: 20000 },
        type: 'lowpass',
        Q: { value: 1 },
        connect: () => {},
        dispose: () => {}
      } as any;
      this.chordSynth = mockSynth;
      this.melodySynth = mockSynth;
      this.synthFilter = mockFilter;
      this.melodyFilter = mockFilter;
    }
  }

  public getChannelSynth(channelId: string): Tone.PolySynth {
    if (channelId === 'melody') return this.melodySynth;
    if (channelId === 'chords') return this.chordSynth;

    const existing = this.trackSynths.get(channelId);
    if (existing) return existing;

    try {
      const newSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.5 }
      });
      newSynth.volume.value = -6;
      const filter = new Tone.Filter({
        type: 'lowpass',
        frequency: 12000,
        Q: 1
      });
      const channelNode = this.mixerGraph.getChannelNode(channelId);
      newSynth.connect(filter);
      filter.connect(channelNode.volumeNode);
      this.trackSynths.set(channelId, newSynth);
      this.trackFilters.set(channelId, filter);
      return newSynth;
    } catch (_) {
      const mockSynth = {
        volume: { value: 0 },
        set: () => {},
        connect: () => {},
        triggerAttack: () => {},
        triggerRelease: () => {},
        triggerAttackRelease: () => {},
        releaseAll: () => {},
        dispose: () => {}
      } as any;
      this.trackSynths.set(channelId, mockSynth);
      return mockSynth;
    }
  }

  public updateSynthSettings(settings: SynthSettings, channelId?: string) {
    if (!settings) return;
    try {
      const applyToSynthAndFilter = (synth: Tone.PolySynth, filter?: Tone.Filter) => {
        if (!synth) return;
        try {
          synth.set({
            oscillator: { type: settings.waveType },
            envelope: {
              attack: Math.max(0.001, settings.envelope.attack),
              decay: Math.max(0.001, settings.envelope.decay),
              sustain: Math.max(0, Math.min(1, settings.envelope.sustain)),
              release: Math.max(0.001, settings.envelope.release)
            },
            detune: settings.detune
          });
        } catch (_) {}

        if (filter) {
          try {
            if (settings.filter && settings.filter.enabled) {
              filter.type = settings.filter.type;
              filter.frequency.value = Math.max(20, Math.min(20000, settings.filter.frequency));
              filter.Q.value = Math.max(0.1, Math.min(20, settings.filter.Q));
            } else {
              filter.type = 'lowpass';
              filter.frequency.value = 20000;
              filter.Q.value = 1;
            }
          } catch (_) {}
        }
      };

      if (channelId === 'chords') {
        applyToSynthAndFilter(this.chordSynth, this.synthFilter);
      } else if (channelId === 'melody') {
        applyToSynthAndFilter(this.melodySynth, this.melodyFilter);
      } else if (channelId) {
        const synth = this.getChannelSynth(channelId);
        const filter = this.trackFilters.get(channelId);
        applyToSynthAndFilter(synth, filter);
      } else {
        applyToSynthAndFilter(this.chordSynth, this.synthFilter);
        applyToSynthAndFilter(this.melodySynth, this.melodyFilter);
        this.trackSynths.forEach((synth, chId) => {
          const filter = this.trackFilters.get(chId);
          applyToSynthAndFilter(synth, filter);
        });
      }
    } catch (e) {
      console.error('Error actualizando ajustes del sintetizador:', e);
    }
  }

  public updateSustain(sustain: boolean) {
    const releaseTime = sustain ? 2.5 : 0.8;
    this.chordSynth.set({ envelope: { release: releaseTime } });
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
    try { this.synthFilter.dispose(); } catch (_) {}
    this.trackSynths.forEach((s) => { try { s.dispose(); } catch (_) {} });
    this.trackFilters.forEach((f) => { try { f.dispose(); } catch (_) {} });
    this.trackSynths.clear();
    this.trackFilters.clear();
  }
}
