/**
 * MixerGraph.ts
 * Administrador del grafo de mezcla Web Audio y nodos de ruteo estéreo de alta fidelidad.
 * Garantiza un canal estéreo explícito (channelCount: 2) en todos los nodos para evitar el colapso mono.
 */

import * as Tone from 'tone';
import type { ChannelConfig } from '../../../utils/typeDefinitions';

export interface ChannelNode {
  volumeNode: Tone.Volume;
  pannerNode: Tone.Panner;
  meterNode: Tone.Meter;
}

/**
 * Convierte el valor de fader (0 a 100 con 80 = 0 dB) al valor en decibeles exacto del mixer.
 */
export function faderToDb(volume: number): number {
  if (volume <= 0) return -Infinity;
  const db = ((volume - 80) / 80) * 30;
  return Math.max(-60, Math.min(6, db));
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

        // Configuración estéreo explícita en los nodos nativos Web Audio para preservar la separación L/R
        this.enforceStereoNode(volumeNode);
        this.enforceStereoNode(pannerNode);

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
        // Fallback seguro para entornos de prueba sin AudioParam
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

  /**
   * Fuerza modo estéreo explícito (channelCount: 2) para prevenir downmixing a mono accidental.
   */
  private enforceStereoNode(toneNode: any) {
    try {
      const raw = toneNode.input || toneNode.output || toneNode._gainNode || toneNode._panner || toneNode;
      if (raw) {
        raw.channelCount = 2;
        raw.channelCountMode = 'explicit';
        raw.channelInterpretation = 'speakers';
      }
      if (toneNode._panner) {
        toneNode._panner.channelCount = 2;
        toneNode._panner.channelCountMode = 'explicit';
        toneNode._panner.channelInterpretation = 'speakers';
      }
    } catch (_) {}
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
        node.volumeNode.volume.value = faderToDb(ch.volume);
      }
      const clampedPan = Math.max(-1, Math.min(1, ch.pan));
      node.pannerNode.pan.value = clampedPan;

      const nativePanner = (node.pannerNode as any).output || (node.pannerNode as any)._panner;
      if (nativePanner && nativePanner.pan) {
        try {
          nativePanner.pan.cancelScheduledValues(0);
        } catch (_) {}
        nativePanner.pan.value = clampedPan;
        nativePanner.channelCount = 2;
        nativePanner.channelCountMode = 'explicit';
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

  private waveformBuffer = new Float32Array(512);
  private frequencyBuffer = new Float32Array(64);

  public getWaveformData(target?: Float32Array): Float32Array {
    const dest = target || this.waveformBuffer;
    try {
      if (!this.analyserNode) this.getAnalyser();
      const raw = (this.analyserNode as any)?._analyser;
      if (raw && typeof raw.getFloatTimeDomainData === 'function') {
        raw.getFloatTimeDomainData(dest);
        return dest;
      }
      const val = this.analyserNode!.getValue() as Float32Array;
      if (target && target !== val) {
        target.set(val);
        return target;
      }
      return val;
    } catch (_) {
      return dest;
    }
  }

  public getFrequencyData(target?: Float32Array): Float32Array {
    const dest = target || this.frequencyBuffer;
    try {
      if (!this.fftNode) this.getFftAnalyser();
      const raw = (this.fftNode as any)?._analyser;
      if (raw && typeof raw.getFloatFrequencyData === 'function') {
        raw.getFloatFrequencyData(dest);
        return dest;
      }
      const val = this.fftNode!.getValue() as Float32Array;
      if (target && target !== val) {
        target.set(val);
        return target;
      }
      return val;
    } catch (_) {
      return dest;
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
