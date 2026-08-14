/**
 * DrumSoundManager.ts
 * Gestor de reproducción de muestras de batería y síntesis de percusión con Tone.js.
 */

import * as Tone from 'tone';
import type { MixerGraph } from './MixerGraph';

export class DrumSoundManager {
  private drumPlayers = new Map<string, { player: Tone.Player; sampleUrl: string }>();
  private drumChannelNodes = new Map<string, { volumeNode: Tone.Volume; pannerNode: Tone.Panner }>();
  private drumSynths = new Map<string, Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth>();
  private mixerGraph: MixerGraph;

  constructor(mixerGraph: MixerGraph) {
    this.mixerGraph = mixerGraph;
    try {
      const drumsChannelNode = this.mixerGraph.getChannelNode('drums');

      this.drumSynths.set('kick1.mp3', new Tone.MembraneSynth().connect(drumsChannelNode.volumeNode));
      this.drumSynths.set('snare1.mp3', new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.2 }
      }).connect(drumsChannelNode.volumeNode));
      this.drumSynths.set('hihat_closed1.mp3', new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.1, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5
      }).connect(drumsChannelNode.volumeNode));
      this.drumSynths.set('hihat_open1.mp3', new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.5, release: 0.1 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5
      }).connect(drumsChannelNode.volumeNode));
    } catch (_) {}
  }

  public getChannelAudioNode(channelId: string, pan: number) {
    const clampedPan = Math.max(-1, Math.min(1, typeof pan === 'number' ? pan : 0));
    let node = this.drumChannelNodes.get(channelId);
    if (!node) {
      const drumsMaster = this.mixerGraph.getChannelNode('drums');
      const pannerNode = new Tone.Panner({ pan: clampedPan }).connect(drumsMaster.volumeNode);
      const volumeNode = new Tone.Volume(0).connect(pannerNode);

      try {
        const rawVol = (volumeNode as any).input || (volumeNode as any)._gainNode || volumeNode;
        if (rawVol) {
          rawVol.channelCount = 2;
          rawVol.channelCountMode = 'explicit';
          rawVol.channelInterpretation = 'speakers';
        }
        const rawPan = (pannerNode as any).output || (pannerNode as any)._panner || pannerNode;
        if (rawPan) {
          rawPan.channelCount = 2;
          rawPan.channelCountMode = 'explicit';
          rawPan.channelInterpretation = 'speakers';
        }
      } catch (_) {}

      const nativePanner = (pannerNode as any).output || (pannerNode as any)._panner;
      if (nativePanner && nativePanner.pan) {
        try { nativePanner.pan.cancelScheduledValues(0); } catch (_) {}
        nativePanner.pan.value = clampedPan;
      }

      node = { volumeNode, pannerNode };
      this.drumChannelNodes.set(channelId, node);
    } else {
      try { node.pannerNode.pan.cancelScheduledValues(0); } catch (_) {}
      node.pannerNode.pan.value = clampedPan;
      const nativePanner = (node.pannerNode as any).output || (node.pannerNode as any)._panner;
      if (nativePanner && nativePanner.pan) {
        try { nativePanner.pan.cancelScheduledValues(0); } catch (_) {}
        nativePanner.pan.value = clampedPan;
      }
    }
    return node;
  }

  public updateDrumChannelPan(channelId: string, pan: number) {
    this.getChannelAudioNode(channelId, pan);
  }

  public getLoadedBuffers(): Map<string, any> {
    const map = new Map<string, any>();
    this.drumPlayers.forEach(({ player, sampleUrl }) => {
      if (player && player.buffer && (player.buffer as any).loaded) {
        map.set(sampleUrl, player.buffer);
      }
    });
    return map;
  }

  public removeDrumPlayer(channelId: string) {
    const cachedPlayer = this.drumPlayers.get(channelId);
    if (cachedPlayer) {
      try { cachedPlayer.player.dispose(); } catch (_) {}
      this.drumPlayers.delete(channelId);
    }
    const cachedNode = this.drumChannelNodes.get(channelId);
    if (cachedNode) {
      try { cachedNode.volumeNode.dispose(); } catch (_) {}
      try { cachedNode.pannerNode.dispose(); } catch (_) {}
      this.drumChannelNodes.delete(channelId);
    }
  }

  private getOrCreateDrumPlayer(channelId: string, sampleUrl: string, pan: number): {
    player: Tone.Player | null;
    channelNode: { volumeNode: Tone.Volume; pannerNode: Tone.Panner };
  } {
    const channelNode = this.getChannelAudioNode(channelId, pan);
    const cached = this.drumPlayers.get(channelId);

    if (cached) {
      if (cached.sampleUrl === sampleUrl) {
        return { player: cached.player, channelNode };
      }
      try { cached.player.dispose(); } catch (_) {}
      this.drumPlayers.delete(channelId);
    }

    if (sampleUrl.startsWith('/') || sampleUrl.endsWith('.wav') || sampleUrl.endsWith('.mp3')) {
      const player = new Tone.Player({
        url: sampleUrl,
        autostart: false,
        onerror: (err) => {
          console.warn(`[DrumSoundManager] Error cargando sample de batería: ${sampleUrl}`, err);
        }
      }).connect(channelNode.volumeNode);

      this.drumPlayers.set(channelId, { player, sampleUrl });
      return { player, channelNode };
    }

    return { player: null, channelNode };
  }

  public triggerDrumSound(channelId: string, sampleUrl: string, volDb: number, pan: number, time?: number) {
    const { player, channelNode } = this.getOrCreateDrumPlayer(channelId, sampleUrl, pan);
    channelNode.volumeNode.volume.value = volDb;

    if (player && player.loaded) {
      if (time !== undefined) {
        player.start(time);
      } else {
        player.start();
      }
      return;
    }

    // Fallback sintético si el sample no ha cargado
    let synth = this.drumSynths.get(sampleUrl);
    if (!synth) {
      const urlLower = sampleUrl.toLowerCase();
      if (urlLower.includes('snare') || urlLower.includes('clap')) {
        synth = this.drumSynths.get('snare1.mp3');
      } else if (urlLower.includes('hihat') || urlLower.includes('crash')) {
        synth = this.drumSynths.get('hihat_closed1.mp3');
      } else {
        synth = this.drumSynths.get('kick1.mp3');
      }
    }

    if (synth) {
      if (time !== undefined) {
        if (synth instanceof Tone.MembraneSynth) {
          synth.triggerAttackRelease('C1', '8n', time);
        } else if (synth instanceof Tone.NoiseSynth) {
          (synth as any).triggerAttackRelease('16n', time);
        } else if (synth instanceof Tone.MetalSynth) {
          (synth as any).triggerAttackRelease('16n', time);
        }
      } else {
        if (synth instanceof Tone.MembraneSynth) {
          synth.triggerAttackRelease('C1', '8n');
        } else if (synth instanceof Tone.NoiseSynth) {
          (synth as any).triggerAttackRelease('16n');
        } else if (synth instanceof Tone.MetalSynth) {
          (synth as any).triggerAttackRelease('16n');
        }
      }
    }
  }

  public dispose() {
    this.drumPlayers.forEach(({ player }) => {
      try { player.dispose(); } catch (_) {}
    });
    this.drumPlayers.clear();

    this.drumChannelNodes.forEach(({ volumeNode, pannerNode }) => {
      try { volumeNode.dispose(); } catch (_) {}
      try { pannerNode.dispose(); } catch (_) {}
    });
    this.drumChannelNodes.clear();

    this.drumSynths.forEach((synth) => {
      try { synth.dispose(); } catch (_) {}
    });
    this.drumSynths.clear();
  }
}
