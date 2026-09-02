/**
 * DrumSoundManager.ts
 * Gestor de reproducción de muestras de batería y síntesis de percusión con Tone.js.
 * Incluye caché global de AudioBuffers decodificados y pre-carga instantánea zero-latency.
 */

import * as Tone from 'tone';
import type { MixerGraph } from './MixerGraph';

export class DrumSoundManager {
  private activeSources = new Set<Tone.ToneBufferSource>();
  private drumChannelNodes = new Map<string, { volumeNode: Tone.Volume; pannerNode: Tone.Panner }>();
  private drumSynths = new Map<string, Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth>();
  private bufferCache = new Map<string, Tone.ToneAudioBuffer>();
  private loadingPromises = new Map<string, Promise<Tone.ToneAudioBuffer | null>>();
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

  /**
   * Pre-carga un archivo de audio y lo almacena decodificado en la caché de buffers.
   */
  public async preloadSample(sampleUrl: string): Promise<Tone.ToneAudioBuffer | null> {
    if (!sampleUrl || (!sampleUrl.startsWith('/') && !sampleUrl.endsWith('.wav') && !sampleUrl.endsWith('.mp3'))) {
      return null;
    }
    const cached = this.bufferCache.get(sampleUrl);
    if (cached && (cached as any).loaded) {
      return cached;
    }
    if (this.loadingPromises.has(sampleUrl)) {
      return this.loadingPromises.get(sampleUrl)!;
    }

    const promise = new Promise<Tone.ToneAudioBuffer | null>((resolve) => {
      try {
        const buffer = new Tone.ToneAudioBuffer(
          sampleUrl,
          () => {
            this.bufferCache.set(sampleUrl, buffer);
            this.loadingPromises.delete(sampleUrl);
            resolve(buffer);
          },
          (err) => {
            console.warn(`[DrumSoundManager] Error pre-cargando buffer de audio: ${sampleUrl}`, err);
            this.loadingPromises.delete(sampleUrl);
            resolve(null);
          }
        );
      } catch (e) {
        console.warn(`[DrumSoundManager] Excepción al pre-cargar buffer: ${sampleUrl}`, e);
        this.loadingPromises.delete(sampleUrl);
        resolve(null);
      }
    });

    this.loadingPromises.set(sampleUrl, promise);
    return promise;
  }

  /**
   * Pre-carga anticipadamente los buffers de audio y nodos de canal de batería.
   */
  public async preloadChannels(channels: Array<{ id: string; sampleUrl: string; pan?: number }>): Promise<void> {
    if (!channels || channels.length === 0) return;

    await Promise.all(
      channels.map(async (ch) => {
        if (!ch.sampleUrl) return;
        this.getChannelAudioNode(ch.id, ch.pan ?? 0);
        await this.preloadSample(ch.sampleUrl);
      })
    );
  }

  public getLoadedBuffers(): Map<string, any> {
    const map = new Map<string, any>();
    this.bufferCache.forEach((buffer, url) => {
      if (buffer && (buffer as any).loaded) {
        map.set(url, buffer);
      }
    });
    return map;
  }

  public removeDrumPlayer(channelId: string) {
    const cachedNode = this.drumChannelNodes.get(channelId);
    if (cachedNode) {
      try { cachedNode.volumeNode.dispose(); } catch (_) {}
      try { cachedNode.pannerNode.dispose(); } catch (_) {}
      this.drumChannelNodes.delete(channelId);
    }
  }

  /**
   * Dispara una muestra de batería de forma polifónica y superponible (Polyphonic One-Shot).
   * Los sonidos largos (crashes, open hihats, 808s) continúan sonando naturalmente
   * sin cortarse cuando se activa un nuevo golpe en el mismo canal.
   */
  public triggerDrumSound(channelId: string, sampleUrl: string, volDb: number, pan: number, time?: number) {
    const channelNode = this.getChannelAudioNode(channelId, pan);

    // 1. Obtener buffer pre-cargado desde caché
    let cachedBuffer = this.bufferCache.get(sampleUrl);

    if (!cachedBuffer && (sampleUrl.startsWith('/') || sampleUrl.endsWith('.wav') || sampleUrl.endsWith('.mp3'))) {
      this.preloadSample(sampleUrl);
    }

    if (cachedBuffer && (cachedBuffer as any).loaded) {
      try {
        const source = new Tone.ToneBufferSource(cachedBuffer);
        source.connect(channelNode.volumeNode);

        const gainFactor = Tone.dbToGain(volDb);
        source.start(time, 0, undefined, gainFactor);

        this.activeSources.add(source);
        source.onended = () => {
          this.activeSources.delete(source);
          try {
            source.dispose();
          } catch (_) {}
        };
        return;
      } catch (e) {
        console.warn(`[DrumSoundManager] Error disparando muestra polifónica ${sampleUrl}:`, e);
      }
    }

    // 2. Fallback sintético si el buffer aún no está disponible
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

  /**
   * Detiene inmediatamente todas las muestras de batería activas al pausar/detener la reproducción.
   */
  public stopAll() {
    this.activeSources.forEach((source) => {
      try {
        source.stop();
        source.dispose();
      } catch (_) {}
    });
    this.activeSources.clear();
  }

  public dispose() {
    this.stopAll();

    this.drumChannelNodes.forEach(({ volumeNode, pannerNode }) => {
      try { volumeNode.dispose(); } catch (_) {}
      try { pannerNode.dispose(); } catch (_) {}
    });
    this.drumChannelNodes.clear();

    this.drumSynths.forEach((synth) => {
      try { synth.dispose(); } catch (_) {}
    });
    this.drumSynths.clear();

    this.bufferCache.forEach((buf) => {
      try { buf.dispose(); } catch (_) {}
    });
    this.bufferCache.clear();
    this.loadingPromises.clear();
  }
}
