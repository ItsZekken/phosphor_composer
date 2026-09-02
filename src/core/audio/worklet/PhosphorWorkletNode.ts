/**
 * PhosphorWorkletNode.ts
 * Nodo cliente que encapsula el PhosphorWorkletProcessor en el hilo principal.
 * Conecta el sistema de instrumentos de Phosphor con el motor de síntesis AudioWorklet de ultra-baja latencia.
 */

import * as Tone from 'tone';
import type { SynthSettings } from '../../../utils/typeDefinitions';

let isProcessorModuleRegistered = false;
let registerPromise: Promise<void> | null = null;

export async function ensurePhosphorWorkletRegistered(context: AudioContext): Promise<void> {
  if (isProcessorModuleRegistered) return;
  if (registerPromise) return registerPromise;

  registerPromise = (async () => {
    try {
      const workletUrl = new URL('./PhosphorWorkletProcessor.ts', import.meta.url);
      await context.audioWorklet.addModule(workletUrl);
      isProcessorModuleRegistered = true;
    } catch (err) {
      console.warn('[PhosphorWorkletNode] Error al registrar AudioWorklet module:', err);
      throw err;
    }
  })();

  await registerPromise;
}

export class PhosphorWorkletNode {
  public readonly id: string;
  private workletNode: AudioWorkletNode | null = null;
  private context: AudioContext;
  private isReady = false;
  private pendingQueue: Array<(node: AudioWorkletNode) => void> = [];

  constructor(id: string, context?: AudioContext) {
    this.id = id;
    this.context = context || (Tone.getContext().rawContext as AudioContext);
    this.init();
  }

  private async init() {
    try {
      await ensurePhosphorWorkletRegistered(this.context);
      this.workletNode = new AudioWorkletNode(this.context, 'phosphor-synth-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });

      this.isReady = true;
      this.pendingQueue.forEach((fn) => fn(this.workletNode!));
      this.pendingQueue = [];
    } catch (err) {
      console.error('[PhosphorWorkletNode] No se pudo instanciar el AudioWorklet:', err);
    }
  }

  public connect(destination: AudioNode | Tone.ToneAudioNode): void {
    const rawDest = (destination as any).input ? (destination as any).input : destination;
    if (this.isReady && this.workletNode) {
      this.workletNode.connect(rawDest);
    } else {
      this.pendingQueue.push((node) => {
        node.connect(rawDest);
      });
    }
  }

  public disconnect(): void {
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch (_) {}
    }
  }

  public triggerAttack(midiOrNote: number | string, velocity = 0.8): void {
    const midi = typeof midiOrNote === 'number' ? midiOrNote : Tone.Frequency(midiOrNote).toMidi();
    this.postMessage({ type: 'noteOn', midi, velocity });
  }

  public triggerRelease(midiOrNote: number | string): void {
    const midi = typeof midiOrNote === 'number' ? midiOrNote : Tone.Frequency(midiOrNote).toMidi();
    this.postMessage({ type: 'noteOff', midi });
  }

  public triggerAttackRelease(midiOrNote: number | string, durationSeconds: number, velocity = 0.8): void {
    const midi = typeof midiOrNote === 'number' ? midiOrNote : Tone.Frequency(midiOrNote).toMidi();
    this.postMessage({ type: 'noteOn', midi, velocity, durationSeconds });
  }

  public allNotesOff(): void {
    this.postMessage({ type: 'allNotesOff' });
  }

  public setSettings(settings: SynthSettings): void {
    const params = {
      osc1Wave: settings.osc1?.waveType || settings.waveType || 'sawtooth',
      osc1Vol: settings.osc1?.volume ?? 0.8,
      osc1Octave: settings.osc1?.octave ?? 0,
      osc1Semi: settings.osc1?.semi ?? 0,
      osc1Detune: settings.osc1?.detune ?? 0,

      osc2Enabled: settings.osc2?.enabled ?? false,
      osc2Wave: settings.osc2?.waveType || 'square',
      osc2Vol: settings.osc2?.volume ?? 0.5,
      osc2Octave: settings.osc2?.octave ?? 0,
      osc2Semi: settings.osc2?.semi ?? 0,
      osc2Detune: settings.osc2?.detune ?? 0,

      subEnabled: settings.subOsc?.enabled ?? false,
      subVol: settings.subOsc?.volume ?? 0.4,
      subOctave: settings.subOsc?.octave ?? -1,

      noiseEnabled: settings.noise?.enabled ?? false,
      noiseVol: settings.noise?.volume ?? 0.2,

      filterEnabled: settings.filter?.enabled ?? true,
      filterType: settings.filter?.type || 'lowpass',
      filterFreq: settings.filter?.frequency ?? 2500,
      filterQ: settings.filter?.Q ?? 1.5,
      filterDrive: settings.filter?.drive ?? 0.0,

      attack: settings.envelope?.attack ?? 0.01,
      decay: settings.envelope?.decay ?? 0.2,
      sustain: settings.envelope?.sustain ?? 0.7,
      release: settings.envelope?.release ?? 0.3
    };

    this.postMessage({ type: 'setParams', params });
  }

  private postMessage(msg: any): void {
    if (this.isReady && this.workletNode) {
      this.workletNode.port.postMessage(msg);
    } else {
      this.pendingQueue.push((node) => {
        node.port.postMessage(msg);
      });
    }
  }

  public dispose(): void {
    this.allNotesOff();
    this.disconnect();
    this.workletNode = null;
    this.pendingQueue = [];
  }
}
