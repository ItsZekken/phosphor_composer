/**
 * MixerGraph.ts
 * Administrador del grafo de mezcla Web Audio y nodos de ruteo estéreo.
 */

import * as Tone from 'tone';
import type { ChannelConfig } from '../../../utils/typeDefinitions';

export interface ChannelNode {
  volumeNode: Tone.Volume;
  pannerNode: Tone.Panner;
  meterNode: Tone.Meter;
}

export class MixerGraph {
  private channelNodes = new Map<string, ChannelNode>();
  private analyserNode: Tone.Analyser | null = null;
  private fftNode: Tone.Analyser | null = null;

  constructor() {}

  public getAnalyser(): Tone.Analyser {
    if (!this.analyserNode) {
      try {
        this.analyserNode = new Tone.Analyser('waveform', 512);
        const masterNode = this.getChannelNode('master');
        masterNode.pannerNode.connect(this.analyserNode);
      } catch (_) {
        this.analyserNode = { getValue: () => new Float32Array(512), dispose: () => {} } as any;
      }
    }
    return this.analyserNode!;
  }

  public getFftAnalyser(): Tone.Analyser {
    if (!this.fftNode) {
      try {
        this.fftNode = new Tone.Analyser('fft', 64);
        const masterNode = this.getChannelNode('master');
        masterNode.pannerNode.connect(this.fftNode);
      } catch (_) {
        this.fftNode = { getValue: () => new Float32Array(64), dispose: () => {} } as any;
      }
    }
    return this.fftNode!;
  }

  public getChannelNode(id: string): ChannelNode {
    let node = this.channelNodes.get(id);
    if (!node) {
      try {
        const volumeNode = new Tone.Volume(0);
        const pannerNode = new Tone.Panner({ pan: 0 });
        const meterNode = new Tone.Meter({ smoothing: 0.8 });

        volumeNode.connect(pannerNode);

        if (id === 'master') {
          pannerNode.toDestination();
          pannerNode.connect(meterNode);
        } else {
          const masterNode = this.getChannelNode('master');
          pannerNode.connect(masterNode.volumeNode);
          pannerNode.connect(meterNode);
        }

        node = { volumeNode, pannerNode, meterNode };
        this.channelNodes.set(id, node);
      } catch (_) {
        // Fallback seguro para tests en Node.js o entornos sin AudioParam
        node = {
          volumeNode: { volume: { value: 0 }, mute: false, connect: () => {}, dispose: () => {} } as any,
          pannerNode: { pan: { value: 0 }, connect: () => {}, toDestination: () => {}, dispose: () => {} } as any,
          meterNode: { getValue: () => -Infinity, connect: () => {}, dispose: () => {} } as any
        };
        this.channelNodes.set(id, node);
      }
    }
    return node;
  }

  public syncChannels(channels: Record<string, ChannelConfig>) {
    if (!channels) return;
    const channelList = Object.values(channels);
    const nonMasterList = channelList.filter((ch) => ch.id !== 'master');
    const anySolo = nonMasterList.some((ch) => ch.solo);

    for (const ch of channelList) {
      const node = this.getChannelNode(ch.id);
      const isMaster = ch.id === 'master';
      const isSilenced = isMaster ? Boolean(ch.muted) : Boolean(ch.muted || (anySolo && !ch.solo));
      node.volumeNode.mute = isSilenced;

      if (!isSilenced) {
        if (ch.volume <= 0) {
          node.volumeNode.volume.value = -Infinity;
        } else {
          const db = ((ch.volume - 80) / 80) * 30;
          node.volumeNode.volume.value = Math.max(-60, Math.min(6, db));
        }
      }
      const clampedPan = Math.max(-1, Math.min(1, ch.pan));
      node.pannerNode.pan.value = clampedPan;

      const nativePanner = (node.pannerNode as any).output || (node.pannerNode as any)._panner;
      if (nativePanner && nativePanner.pan) {
        try {
          nativePanner.pan.cancelScheduledValues(0);
        } catch (_) {}
        nativePanner.pan.value = clampedPan;
      }
    }
  }

  public getChannelMeterLevel(id: string): number {
    const node = this.channelNodes.get(id);
    if (!node) return -Infinity;
    try {
      const val = node.meterNode.getValue();
      return typeof val === 'number' ? val : Array.isArray(val) ? (val as number[])[0] : -Infinity;
    } catch (_) {
      return -Infinity;
    }
  }

  public getWaveformData(): Float32Array {
    try {
      if (!this.analyserNode) this.getAnalyser();
      return this.analyserNode!.getValue() as Float32Array;
    } catch (_) {
      return new Float32Array(512);
    }
  }

  public getFrequencyData(): Float32Array {
    try {
      if (!this.fftNode) this.getFftAnalyser();
      return this.fftNode!.getValue() as Float32Array;
    } catch (_) {
      return new Float32Array(64);
    }
  }

  public dispose() {
    this.channelNodes.forEach((node) => {
      try { node.volumeNode.dispose(); } catch (_) {}
      try { node.pannerNode.dispose(); } catch (_) {}
      try { node.meterNode.dispose(); } catch (_) {}
    });
    this.channelNodes.clear();
    if (this.analyserNode) {
      try { this.analyserNode.dispose(); } catch (_) {}
      this.analyserNode = null;
    }
    if (this.fftNode) {
      try { this.fftNode.dispose(); } catch (_) {}
      this.fftNode = null;
    }
  }
}
