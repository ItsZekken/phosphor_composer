/**
 * PhosphorAnalogSynth.ts
 * Sintetizador analógico virtual polifónico de alto rendimiento, baja latencia y True DSP Bypass.
 * 
 * Arquitectura:
 * - Multi-oscilador híbrido (OSC 1, OSC 2, Sub-Osc, Noise Generator bajo demanda)
 * - Grafo DSP con True Dynamic Bypass: Los nodos de FX (Freeverb, Chorus, Delay, Drive) se desconectan
 *   del audio thread cuando están apagados o su mix es 0, consumiendo 0% CPU.
 * - Parameter Diffing ultra-eficiente para cero caídas de frames en manipulación de perillas.
 * - Transposición rápida con aritmética entera y cero Garbage Collection.
 */

import * as Tone from 'tone';
import type { SynthSettings } from '../../../utils/typeDefinitions';
import { normalizeSynthSettings } from './synthPresets';
import { noteToMidi, midiToNote } from '../../music/pitchClass';

/**
 * Transpone una nota musical (ej: "C4") por octavas y semitonos mediante aritmética entera pura (0 GC).
 */
function transposeNoteFast(noteName: string, octaves: number, semi: number): string {
  if (octaves === 0 && semi === 0) return noteName;
  const midi = noteToMidi(noteName);
  const transposed = Math.max(12, Math.min(127, midi + octaves * 12 + semi));
  return midiToNote(transposed);
}

export class PhosphorAnalogSynth {
  public id: string;
  private settings: SynthSettings;

  // Oscilador Principal 1
  private osc1Synth: Tone.PolySynth;
  private osc1Gain: Tone.Gain;

  // Osciladores Secundarios (bajo demanda)
  private osc2Synth: Tone.PolySynth | null = null;
  private osc2Gain: Tone.Gain | null = null;

  private subSynth: Tone.PolySynth | null = null;
  private subGain: Tone.Gain | null = null;

  // Generador de Ruido Real (bajo demanda)
  private noiseSynth: Tone.NoiseSynth | null = null;
  private noiseGain: Tone.Gain | null = null;

  // Sumador de Mezcla y Salida Calibrada
  private mixerSumNode: Tone.Gain;
  public outputNode: Tone.Gain;

  // Nodos DSP con True Dynamic Bypass (creados e insertados solo cuando están activos)
  private vibratoNode: Tone.Vibrato | null = null;
  private driveNode: Tone.Distortion | null = null;
  private filterNode: Tone.Filter;
  private lfoAmpNode: Tone.Gain;
  private chorusNode: Tone.Chorus | null = null;
  private delayNode: Tone.FeedbackDelay | null = null;
  private reverbNode: Tone.Freeverb | null = null;

  // Analizadores Bajo Demanda
  private analyserNode: Tone.Analyser | null = null;
  private fftNode: Tone.Analyser | null = null;
  private isAnalyserActive = false;

  // LFO
  private lfoNode: Tone.LFO | null = null;
  private currentLfoTarget: 'cutoff' | 'pitch' | 'amp' | 'none' = 'none';

  private isDisposed = false;

  constructor(id: string, initialSettings?: Partial<SynthSettings>, destinationNode?: Tone.ToneAudioNode) {
    this.id = id;
    this.settings = normalizeSynthSettings(initialSettings);

    // 1. Salida principal calibrada (0.6 = -4.4 dB)
    this.outputNode = new Tone.Gain(0.6);
    if (destinationNode) {
      this.outputNode.connect(destinationNode);
    }

    // 2. Sumador de mezcla y nodo de ganancia LFO Amp (Tremolo)
    this.mixerSumNode = new Tone.Gain(1.0);
    this.lfoAmpNode = new Tone.Gain(1.0);

    // 3. Filtro VCF base
    const filter = this.settings.filter;
    this.filterNode = new Tone.Filter({
      frequency: filter.enabled ? Math.max(20, Math.min(20000, filter.frequency)) : 20000,
      type: filter.enabled ? filter.type : 'lowpass',
      Q: filter.enabled ? filter.Q : 1,
      rolloff: filter.rolloff === -24 ? -24 : -12
    });

    // 4. Construir el grafo de audio conectando únicamente los nodos activos
    this.rebuildAudioGraph();

    // 5. Oscilador 1 Principal
    this.osc1Gain = new Tone.Gain(this.settings.osc1?.volume ?? 0.8);
    this.osc1Gain.connect(this.mixerSumNode);

    this.osc1Synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: this.mapWaveType(this.settings.osc1?.waveType || 'triangle') },
      envelope: { ...this.settings.envelope },
      portamento: this.settings.glide || 0
    });
    this.osc1Synth.maxPolyphony = 6;
    this.osc1Synth.connect(this.osc1Gain);

    // 6. Fuentes secundarias y LFO
    this.syncSecondarySources();
    this.applyLFO();
  }

  private mapWaveType(wave?: string): any {
    if (wave === 'pulse') return 'square';
    if (wave && ['sine', 'triangle', 'square', 'sawtooth'].includes(wave)) {
      return wave;
    }
    return 'triangle';
  }

  /**
   * Reconstruye dinámicamente la cadena de efectos en serie conectando SOLO los nodos activos.
   * Si un efecto está apagado o su mix es 0, queda completamente desconectado del grafo Web Audio (0% CPU).
   */
  private rebuildAudioGraph() {
    if (this.isDisposed) return;

    // Desconectar etapa intermedia
    try { this.mixerSumNode.disconnect(); } catch (_) {}
    if (this.vibratoNode) try { this.vibratoNode.disconnect(); } catch (_) {}
    if (this.driveNode) try { this.driveNode.disconnect(); } catch (_) {}
    try { this.filterNode.disconnect(); } catch (_) {}
    try { this.lfoAmpNode.disconnect(); } catch (_) {}
    if (this.chorusNode) try { this.chorusNode.disconnect(); } catch (_) {}
    if (this.delayNode) try { this.delayNode.disconnect(); } catch (_) {}
    if (this.reverbNode) try { this.reverbNode.disconnect(); } catch (_) {}

    let current: Tone.ToneAudioNode = this.mixerSumNode;

    // 0. Etapa de Modulación de Tono / Pitch Vibrato (Solo si LFO pitch activo y depth > 0.01)
    const lfo = this.settings.lfo;
    const isPitchLfoActive = Boolean(lfo?.enabled && lfo?.target === 'pitch' && (lfo?.depth ?? 0) > 0.01);
    if (isPitchLfoActive) {
      const rate = Math.max(0.1, Math.min(20, lfo?.rate ?? 2.5));
      const depth = Math.max(0.01, Math.min(1, lfo?.depth ?? 0.25));
      const waveType = lfo?.waveType === 'random' ? 'sine' : (lfo?.waveType || 'sine');

      if (!this.vibratoNode) {
        this.vibratoNode = new Tone.Vibrato({
          frequency: rate,
          depth: depth * 0.9,
          type: waveType as any
        });
      } else {
        this.vibratoNode.frequency.rampTo(rate, 0.02);
        this.vibratoNode.depth.value = depth * 0.9;
        this.vibratoNode.type = waveType as any;
      }
      current.connect(this.vibratoNode);
      current = this.vibratoNode;
    } else if (this.vibratoNode) {
      try { this.vibratoNode.dispose(); } catch (_) {}
      this.vibratoNode = null;
    }

    // 1. Etapa de Saturación / Drive (Solo si drive > 0.02)
    const filter = this.settings.filter;
    const driveVal = Math.max(0, Math.min(1, filter.drive ?? 0));
    if (driveVal > 0.02) {
      if (!this.driveNode) {
        this.driveNode = new Tone.Distortion({ distortion: driveVal * 0.4, oversample: 'none' });
      } else {
        this.driveNode.distortion = driveVal * 0.4;
      }
      current.connect(this.driveNode);
      current = this.driveNode;
    }

    // 2. Etapa de Filtro VCF (Solo si filter.enabled === true)
    if (filter.enabled) {
      this.filterNode.type = filter.type;
      this.filterNode.rolloff = filter.rolloff === -24 ? -24 : -12;
      this.filterNode.frequency.value = Math.max(20, Math.min(20000, filter.frequency));
      this.filterNode.Q.value = Math.max(0.1, Math.min(20, filter.Q));
      current.connect(this.filterNode);
      current = this.filterNode;
    }

    // 3. Etapa de Modulación de Amplitud (LFO Amp Tremolo)
    current.connect(this.lfoAmpNode);
    current = this.lfoAmpNode;

    // 3. Etapa de Chorus (Solo si chorus.enabled && mix > 0.01)
    const fx = this.settings.fx;
    const isChorusActive = Boolean(fx?.chorus?.enabled && (fx.chorus.mix ?? 0) > 0.01);
    if (isChorusActive) {
      if (!this.chorusNode) {
        this.chorusNode = new Tone.Chorus({
          frequency: fx?.chorus?.rate ?? 1.5,
          delayTime: 3.5,
          depth: fx?.chorus?.depth ?? 0.4,
          wet: fx!.chorus.mix ?? 0.3
        });
      } else {
        this.chorusNode.frequency.value = fx?.chorus?.rate ?? 1.5;
        this.chorusNode.depth = fx?.chorus?.depth ?? 0.4;
        this.chorusNode.wet.value = fx!.chorus.mix ?? 0.3;
      }
      try { this.chorusNode.start(); } catch (_) {}
      current.connect(this.chorusNode);
      current = this.chorusNode;
    } else if (this.chorusNode) {
      try { this.chorusNode.stop(); } catch (_) {}
    }

    // 4. Etapa de Delay (Solo si delay.enabled && mix > 0.01)
    const isDelayActive = Boolean(fx?.delay?.enabled && (fx.delay.mix ?? 0) > 0.01);
    if (isDelayActive) {
      if (!this.delayNode) {
        this.delayNode = new Tone.FeedbackDelay({
          delayTime: fx?.delay?.time ?? '8n',
          feedback: Math.min(0.85, fx?.delay?.feedback ?? 0.25),
          wet: fx!.delay.mix ?? 0.2
        });
      } else {
        this.delayNode.delayTime.value = fx?.delay?.time ?? '8n' as any;
        this.delayNode.feedback.value = Math.min(0.85, fx?.delay?.feedback ?? 0.25);
        this.delayNode.wet.value = fx!.delay.mix ?? 0.2;
      }
      current.connect(this.delayNode);
      current = this.delayNode;
    }

    // 5. Etapa de Reverb (Solo si reverb.enabled && mix > 0.01)
    const isReverbActive = Boolean(fx?.reverb?.enabled && (fx.reverb.mix ?? 0) > 0.01);
    if (isReverbActive) {
      if (!this.reverbNode) {
        this.reverbNode = new Tone.Freeverb({
          roomSize: Math.max(0.1, Math.min(0.9, (fx?.reverb?.decay ?? 1.8) / 4)),
          dampening: 3000,
          wet: fx!.reverb.mix ?? 0.15
        });
      } else {
        this.reverbNode.roomSize.value = Math.max(0.1, Math.min(0.9, (fx?.reverb?.decay ?? 1.8) / 4));
        this.reverbNode.wet.value = fx!.reverb.mix ?? 0.15;
      }
      current.connect(this.reverbNode);
      current = this.reverbNode;
    }

    // Conectar el final de la cadena a la salida calibrada
    current.connect(this.outputNode);
  }

  private syncSecondarySources() {
    // OSC 2
    const osc2 = this.settings.osc2;
    if (osc2 && osc2.enabled && (osc2.volume ?? 0) > 0) {
      if (!this.osc2Synth) {
        this.osc2Gain = new Tone.Gain(osc2.volume);
        this.osc2Gain.connect(this.mixerSumNode);
        this.osc2Synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: this.mapWaveType(osc2.waveType || 'sawtooth') },
          envelope: { ...this.settings.envelope },
          portamento: this.settings.glide || 0
        });
        this.osc2Synth.maxPolyphony = 6;
        this.osc2Synth.connect(this.osc2Gain);
      } else {
        if (this.osc2Gain) this.osc2Gain.gain.rampTo(osc2.volume, 0.02);
      }
    } else if (this.osc2Gain) {
      this.osc2Gain.gain.rampTo(0, 0.02);
    }

    // SUB OSC
    const sub = this.settings.subOsc;
    if (sub && sub.enabled && (sub.volume ?? 0) > 0) {
      if (!this.subSynth) {
        this.subGain = new Tone.Gain(sub.volume);
        this.subGain.connect(this.mixerSumNode);
        this.subSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: this.mapWaveType(sub.waveType || 'sine') },
          envelope: { ...this.settings.envelope },
          portamento: this.settings.glide || 0
        });
        this.subSynth.maxPolyphony = 4;
        this.subSynth.connect(this.subGain);
      } else {
        if (this.subGain) this.subGain.gain.rampTo(sub.volume, 0.02);
      }
    } else if (this.subGain) {
      this.subGain.gain.rampTo(0, 0.02);
    }

    // NOISE GENERATOR REAL
    const noise = this.settings.noise;
    if (noise && noise.enabled && (noise.volume ?? 0) > 0) {
      if (!this.noiseSynth) {
        this.noiseGain = new Tone.Gain(noise.volume * 0.4);
        this.noiseGain.connect(this.mixerSumNode);
        this.noiseSynth = new Tone.NoiseSynth({
          noise: { type: (noise.type || 'white') as any },
          envelope: {
            attack: Math.max(0.001, this.settings.envelope.attack),
            decay: Math.max(0.01, this.settings.envelope.decay),
            sustain: Math.max(0, Math.min(1, this.settings.envelope.sustain)),
            release: Math.max(0.01, this.settings.envelope.release)
          }
        });
        this.noiseSynth.connect(this.noiseGain);
      } else if (this.noiseGain) {
        this.noiseGain.gain.rampTo(noise.volume * 0.4, 0.02);
      }
    } else if (this.noiseGain) {
      this.noiseGain.gain.rampTo(0, 0.02);
    }
  }

  /**
   * Actualización ultra-rápida y atómica de parámetros sin recargar innecesariamente las voces de audio (0 Lag).
   */
  public setSettings(newSettings: Partial<SynthSettings>) {
    if (this.isDisposed) return;
    const prev = this.settings;
    const next = normalizeSynthSettings({ ...this.settings, ...newSettings });
    this.settings = next;

    try {
      // 1. Oscilador 1
      const osc1Next = next.osc1!;
      const osc1Prev = prev.osc1;
      if (osc1Prev?.volume !== osc1Next.volume || osc1Prev?.enabled !== osc1Next.enabled) {
        this.osc1Gain.gain.rampTo(osc1Next.enabled ? osc1Next.volume : 0, 0.02);
      }
      if (osc1Prev?.waveType !== osc1Next.waveType) {
        this.osc1Synth.set({ oscillator: { type: this.mapWaveType(osc1Next.waveType) } });
      }
      if (osc1Prev?.detune !== osc1Next.detune) {
        this.osc1Synth.set({ detune: osc1Next.detune });
      }

      // Envolvente de Amplitud
      const envPrev = prev.envelope;
      const envNext = next.envelope;
      if (
        envPrev.attack !== envNext.attack ||
        envPrev.decay !== envNext.decay ||
        envPrev.sustain !== envNext.sustain ||
        envPrev.release !== envNext.release
      ) {
        const cleanEnv = {
          attack: Math.max(0.001, envNext.attack),
          decay: Math.max(0.001, envNext.decay),
          sustain: Math.max(0, Math.min(1, envNext.sustain)),
          release: Math.max(0.001, envNext.release)
        };
        this.osc1Synth.set({ envelope: cleanEnv });
        if (this.osc2Synth) this.osc2Synth.set({ envelope: cleanEnv });
        if (this.subSynth) this.subSynth.set({ envelope: cleanEnv });
        if (this.noiseSynth) {
          try {
            this.noiseSynth.envelope.attack = cleanEnv.attack;
            this.noiseSynth.envelope.decay = cleanEnv.decay;
            this.noiseSynth.envelope.sustain = cleanEnv.sustain;
            this.noiseSynth.envelope.release = cleanEnv.release;
          } catch (_) {}
        }
      }

      // Glide / Portamento
      if (prev.glide !== next.glide) {
        const portamento = next.glide || 0;
        this.osc1Synth.set({ portamento });
        if (this.osc2Synth) this.osc2Synth.set({ portamento });
        if (this.subSynth) this.subSynth.set({ portamento });
      }

      // 2. Verificar si la topología del grafo DSP cambió (activar/desactivar efectos)
      const fPrev = prev.filter;
      const fNext = next.filter;
      const fxPrev = prev.fx;
      const fxNext = next.fx;
      const lfoPrev = prev.lfo;
      const lfoNext = next.lfo;

      const isPitchLfoPrev = Boolean(lfoPrev?.enabled && lfoPrev?.target === 'pitch' && (lfoPrev?.depth ?? 0) > 0.01);
      const isPitchLfoNext = Boolean(lfoNext?.enabled && lfoNext?.target === 'pitch' && (lfoNext?.depth ?? 0) > 0.01);

      const topologyChanged =
        fPrev.enabled !== fNext.enabled ||
        (Math.abs(fPrev.drive ?? 0) > 0.02) !== (Math.abs(fNext.drive ?? 0) > 0.02) ||
        isPitchLfoPrev !== isPitchLfoNext ||
        Boolean(fxPrev?.chorus?.enabled && (fxPrev.chorus.mix ?? 0) > 0.01) !== Boolean(fxNext?.chorus?.enabled && (fxNext.chorus?.mix ?? 0) > 0.01) ||
        Boolean(fxPrev?.delay?.enabled && (fxPrev.delay.mix ?? 0) > 0.01) !== Boolean(fxNext?.delay?.enabled && (fxNext.delay?.mix ?? 0) > 0.01) ||
        Boolean(fxPrev?.reverb?.enabled && (fxPrev.reverb.mix ?? 0) > 0.01) !== Boolean(fxNext?.reverb?.enabled && (fxNext.reverb?.mix ?? 0) > 0.01);

      if (topologyChanged) {
        this.rebuildAudioGraph();
      } else {
        // Actualizaciones continuas de parámetros si el grafo ya está conectado
        if (fNext.enabled) {
          if (fPrev.frequency !== fNext.frequency) {
            this.filterNode.frequency.rampTo(Math.max(20, Math.min(20000, fNext.frequency)), 0.02);
          }
          if (fPrev.Q !== fNext.Q) {
            this.filterNode.Q.rampTo(Math.max(0.1, Math.min(20, fNext.Q)), 0.02);
          }
        }
        if (this.driveNode && fPrev.drive !== fNext.drive) {
          this.driveNode.distortion = Math.max(0, Math.min(1, fNext.drive ?? 0)) * 0.4;
        }
        if (this.chorusNode && fxNext?.chorus) {
          if (fxPrev?.chorus?.mix !== fxNext.chorus.mix) this.chorusNode.wet.rampTo(fxNext.chorus.mix, 0.02);
          if (fxPrev?.chorus?.depth !== fxNext.chorus.depth) this.chorusNode.depth = fxNext.chorus.depth;
          if (fxPrev?.chorus?.rate !== fxNext.chorus.rate) this.chorusNode.frequency.rampTo(fxNext.chorus.rate, 0.02);
        }
        if (this.delayNode && fxNext?.delay) {
          if (fxPrev?.delay?.mix !== fxNext.delay.mix) this.delayNode.wet.rampTo(fxNext.delay.mix, 0.02);
          if (fxPrev?.delay?.feedback !== fxNext.delay.feedback) this.delayNode.feedback.rampTo(Math.min(0.85, fxNext.delay.feedback), 0.02);
        }
        if (this.reverbNode && fxNext?.reverb) {
          if (fxPrev?.reverb?.mix !== fxNext.reverb.mix) this.reverbNode.wet.rampTo(fxNext.reverb.mix, 0.02);
          if (fxPrev?.reverb?.decay !== fxNext.reverb.decay) this.reverbNode.roomSize.rampTo(Math.max(0.1, Math.min(0.9, fxNext.reverb.decay / 4)), 0.02);
        }
      }

      // 4. Sincronizar fuentes secundarias
      this.syncSecondarySources();

      if (this.osc2Synth && next.osc2) {
        if (prev.osc2?.waveType !== next.osc2.waveType) {
          this.osc2Synth.set({ oscillator: { type: this.mapWaveType(next.osc2.waveType) } });
        }
        if (prev.osc2?.detune !== next.osc2.detune) {
          this.osc2Synth.set({ detune: next.osc2.detune });
        }
      }

      if (this.subSynth && next.subOsc) {
        if (prev.subOsc?.waveType !== next.subOsc.waveType) {
          this.subSynth.set({ oscillator: { type: this.mapWaveType(next.subOsc.waveType) } });
        }
      }

      // 5. Sincronizar LFO
      this.applyLFO();
    } catch (e) {
      console.warn('Error aplicando parámetros al sinte:', e);
    }
  }

  private cleanupLfoConnections() {
    if (this.lfoNode) {
      try {
        this.lfoNode.stop();
        this.lfoNode.disconnect();
        this.lfoNode.dispose();
      } catch (_) {}
      this.lfoNode = null;
    }

    // 1. Restaurar frecuencia estática del filtro VCF
    if (this.filterNode) {
      try {
        this.filterNode.frequency.cancelScheduledValues(0);
        this.filterNode.frequency.value = this.settings.filter.enabled ? this.settings.filter.frequency : 20000;
      } catch (_) {}
    }

    // 2. Restaurar ganancia estática de modulación de amplitud (Tremolo)
    if (this.lfoAmpNode) {
      try {
        this.lfoAmpNode.gain.cancelScheduledValues(0);
        this.lfoAmpNode.gain.value = 1.0;
      } catch (_) {}
    }

    // 3. Restaurar ganancia estática de salida
    if (this.outputNode) {
      try {
        this.outputNode.gain.cancelScheduledValues(0);
        this.outputNode.gain.value = 0.6;
      } catch (_) {}
    }

    this.currentLfoTarget = 'none';
  }

  private applyLFO() {
    try {
      const lfo = this.settings.lfo;
      if (!lfo || !lfo.enabled || (lfo.depth ?? 0) <= 0) {
        this.cleanupLfoConnections();
        return;
      }

      const rate = Math.max(0.1, Math.min(20, lfo.rate ?? 2.5));
      const depth = Math.max(0.01, Math.min(1, lfo.depth ?? 0.25));
      const newTarget = lfo.target || 'cutoff';
      const waveType = lfo.waveType === 'random' ? 'sine' : (lfo.waveType || 'sine');

      // 1. Modulación de Tono / Pitch Vibrato
      if (newTarget === 'pitch') {
        if (this.currentLfoTarget !== 'pitch') {
          this.cleanupLfoConnections();
          this.currentLfoTarget = 'pitch';
        }
        if (this.vibratoNode) {
          this.vibratoNode.frequency.rampTo(rate, 0.02);
          this.vibratoNode.depth.value = depth * 0.9;
          this.vibratoNode.type = waveType as any;
        }
        return;
      }

      // 2. Modulación de VCF (Cutoff) o Amp (Tremolo) mediante Tone.LFO
      if (this.currentLfoTarget !== newTarget) {
        this.cleanupLfoConnections();
      }

      if (!this.lfoNode) {
        this.lfoNode = new Tone.LFO({
          frequency: rate,
          type: waveType as any,
          min: 100,
          max: 5000
        });
        this.lfoNode.start();
      } else {
        this.lfoNode.frequency.rampTo(rate, 0.02);
        this.lfoNode.type = waveType as any;
      }

      if (newTarget === 'cutoff' && this.settings.filter.enabled) {
        const baseCutoff = Math.max(50, Math.min(18000, this.settings.filter.frequency || 5000));
        const minCutoff = Math.max(20, baseCutoff * Math.pow(0.5, depth * 3.5));
        const maxCutoff = Math.min(20000, baseCutoff * Math.pow(2.0, depth * 3.5));
        this.lfoNode.min = minCutoff;
        this.lfoNode.max = maxCutoff;

        if (this.currentLfoTarget !== 'cutoff') {
          this.filterNode.frequency.cancelScheduledValues(0);
          this.filterNode.frequency.value = 0;
          this.lfoNode.connect(this.filterNode.frequency);
          this.currentLfoTarget = 'cutoff';
        }
      } else if (newTarget === 'amp') {
        this.lfoNode.min = Math.max(0, 1.0 - depth);
        this.lfoNode.max = 1.0;

        if (this.currentLfoTarget !== 'amp') {
          this.lfoAmpNode.gain.cancelScheduledValues(0);
          this.lfoAmpNode.gain.value = 0;
          this.lfoNode.connect(this.lfoAmpNode.gain);
          this.currentLfoTarget = 'amp';
        }
      }
    } catch (e) {
      console.warn('Error aplicando modulación LFO:', e);
    }
  }

  public getSettings(): SynthSettings {
    return { ...this.settings };
  }

  /**
   * Disparo seguro y atómico de notas polifónicas con cero lag.
   */
  public triggerAttackRelease(
    notes: string | string[],
    duration: number | string,
    time?: number,
    velocity = 0.8
  ) {
    if (this.isDisposed) return;
    const noteArray = Array.isArray(notes) ? notes : [notes];
    const triggerTime = time !== undefined ? time : Tone.now();
    const durSec = typeof duration === 'number' ? duration : Tone.Time(duration).toSeconds();

    // 1. OSC 1
    if (this.settings.osc1?.enabled && (this.settings.osc1.volume ?? 0) > 0) {
      const osc1Notes = noteArray.map((n) =>
        transposeNoteFast(n, this.settings.osc1?.octave ?? 0, this.settings.osc1?.semi ?? 0)
      );
      try {
        this.osc1Synth.triggerAttackRelease(osc1Notes, durSec, triggerTime, velocity);
      } catch (_) {}
    }

    // 2. OSC 2
    if (this.osc2Synth && this.settings.osc2?.enabled && (this.settings.osc2.volume ?? 0) > 0) {
      const osc2Notes = noteArray.map((n) =>
        transposeNoteFast(n, this.settings.osc2?.octave ?? 0, this.settings.osc2?.semi ?? 0)
      );
      try {
        this.osc2Synth.triggerAttackRelease(osc2Notes, durSec, triggerTime, velocity);
      } catch (_) {}
    }

    // 3. Sub-oscilador
    if (this.subSynth && this.settings.subOsc?.enabled && (this.settings.subOsc.volume ?? 0) > 0) {
      const subNotes = noteArray.map((n) =>
        transposeNoteFast(n, this.settings.subOsc?.octave ?? -1, 0)
      );
      try {
        this.subSynth.triggerAttackRelease(subNotes, durSec, triggerTime, velocity);
      } catch (_) {}
    }

    // 4. Ruido Real
    if (this.noiseSynth && this.settings.noise?.enabled && (this.settings.noise.volume ?? 0) > 0) {
      try {
        this.noiseSynth.triggerAttackRelease(durSec, triggerTime, velocity * 0.4);
      } catch (_) {}
    }
  }

  public triggerAttack(notes: string | string[], time?: number, velocity = 0.8) {
    if (this.isDisposed) return;
    const noteArray = Array.isArray(notes) ? notes : [notes];
    const triggerTime = time !== undefined ? time : Tone.now();

    if (this.settings.osc1?.enabled) {
      const osc1Notes = noteArray.map((n) =>
        transposeNoteFast(n, this.settings.osc1?.octave ?? 0, this.settings.osc1?.semi ?? 0)
      );
      try { this.osc1Synth.triggerAttack(osc1Notes, triggerTime, velocity); } catch (_) {}
    }

    if (this.osc2Synth && this.settings.osc2?.enabled && (this.settings.osc2.volume ?? 0) > 0) {
      const osc2Notes = noteArray.map((n) =>
        transposeNoteFast(n, this.settings.osc2?.octave ?? 0, this.settings.osc2?.semi ?? 0)
      );
      try { this.osc2Synth.triggerAttack(osc2Notes, triggerTime, velocity); } catch (_) {}
    }

    if (this.subSynth && this.settings.subOsc?.enabled && (this.settings.subOsc.volume ?? 0) > 0) {
      const subNotes = noteArray.map((n) =>
        transposeNoteFast(n, this.settings.subOsc?.octave ?? -1, 0)
      );
      try { this.subSynth.triggerAttack(subNotes, triggerTime, velocity); } catch (_) {}
    }

    if (this.noiseSynth && this.settings.noise?.enabled && (this.settings.noise.volume ?? 0) > 0) {
      try { this.noiseSynth.triggerAttack(triggerTime, velocity * 0.4); } catch (_) {}
    }
  }

  public triggerRelease(notes?: string | string[], time?: number) {
    if (this.isDisposed) return;
    const triggerTime = time !== undefined ? time : Tone.now();

    if (notes) {
      const noteArray = Array.isArray(notes) ? notes : [notes];
      if (this.settings.osc1?.enabled) {
        const osc1Notes = noteArray.map((n) =>
          transposeNoteFast(n, this.settings.osc1?.octave ?? 0, this.settings.osc1?.semi ?? 0)
        );
        try { this.osc1Synth.triggerRelease(osc1Notes, triggerTime); } catch (_) {}
      }

      if (this.osc2Synth && this.settings.osc2?.enabled) {
        const osc2Notes = noteArray.map((n) =>
          transposeNoteFast(n, this.settings.osc2?.octave ?? 0, this.settings.osc2?.semi ?? 0)
        );
        try { this.osc2Synth.triggerRelease(osc2Notes, triggerTime); } catch (_) {}
      }

      if (this.subSynth && this.settings.subOsc?.enabled) {
        const subNotes = noteArray.map((n) =>
          transposeNoteFast(n, this.settings.subOsc?.octave ?? -1, 0)
        );
        try { this.subSynth.triggerRelease(subNotes, triggerTime); } catch (_) {}
      }

      if (this.noiseSynth) {
        try { this.noiseSynth.triggerRelease(triggerTime); } catch (_) {}
      }
    } else {
      this.releaseAll(triggerTime);
    }
  }

  public releaseAll(time?: number) {
    if (this.isDisposed) return;
    const triggerTime = time !== undefined ? time : Tone.now();

    try { this.osc1Synth.releaseAll(triggerTime); } catch (_) {}
    if (this.osc2Synth) try { this.osc2Synth.releaseAll(triggerTime); } catch (_) {}
    if (this.subSynth) try { this.subSynth.releaseAll(triggerTime); } catch (_) {}
    if (this.noiseSynth) try { this.noiseSynth.triggerRelease(triggerTime); } catch (_) {}
  }

  /**
   * Analizadores bajo demanda (Lazy-loaded): Se conectan solo al solicitar datos visuales
   */
  public getWaveformData(target?: Float32Array): Float32Array {
    if (this.isDisposed) return target || new Float32Array(512);
    try {
      if (!this.analyserNode) {
        this.analyserNode = new Tone.Analyser('waveform', 512);
        this.outputNode.connect(this.analyserNode);
        this.isAnalyserActive = true;
      }
      const raw = (this.analyserNode as any)?._analyser;
      if (raw && typeof raw.getFloatTimeDomainData === 'function') {
        const dest = target || new Float32Array(512);
        raw.getFloatTimeDomainData(dest);
        return dest;
      }
      const val = this.analyserNode.getValue() as Float32Array;
      if (target && target !== val) {
        target.set(val);
        return target;
      }
      return val;
    } catch (_) {
      return target || new Float32Array(512);
    }
  }

  public getFrequencyData(target?: Float32Array): Float32Array {
    if (this.isDisposed) return target || new Float32Array(64);
    try {
      if (!this.fftNode) {
        this.fftNode = new Tone.Analyser('fft', 64);
        this.outputNode.connect(this.fftNode);
        this.isAnalyserActive = true;
      }
      const raw = (this.fftNode as any)?._analyser;
      if (raw && typeof raw.getFloatFrequencyData === 'function') {
        const dest = target || new Float32Array(64);
        raw.getFloatFrequencyData(dest);
        return dest;
      }
      const val = this.fftNode.getValue() as Float32Array;
      if (target && target !== val) {
        target.set(val);
        return target;
      }
      return val;
    } catch (_) {
      return target || new Float32Array(64);
    }
  }

  /**
   * Desconecta analizadores para ahorrar ciclos de CPU cuando el modal visualizador se cierra
   */
  public disconnectAnalysers() {
    if (!this.isAnalyserActive) return;
    if (this.analyserNode) {
      try {
        this.outputNode.disconnect(this.analyserNode);
        this.analyserNode.dispose();
      } catch (_) {}
      this.analyserNode = null;
    }
    if (this.fftNode) {
      try {
        this.outputNode.disconnect(this.fftNode);
        this.fftNode.dispose();
      } catch (_) {}
      this.fftNode = null;
    }
    this.isAnalyserActive = false;
  }

  public dispose() {
    this.isDisposed = true;
    this.releaseAll();
    this.disconnectAnalysers();
    this.cleanupLfoConnections();

    if (this.vibratoNode) {
      try { this.vibratoNode.dispose(); } catch (_) {}
      this.vibratoNode = null;
    }

    try { this.osc1Synth.dispose(); } catch (_) {}
    try { this.osc1Gain.dispose(); } catch (_) {}

    if (this.osc2Synth) {
      try { this.osc2Synth.dispose(); } catch (_) {}
      this.osc2Synth = null;
    }
    if (this.osc2Gain) {
      try { this.osc2Gain.dispose(); } catch (_) {}
      this.osc2Gain = null;
    }

    if (this.subSynth) {
      try { this.subSynth.dispose(); } catch (_) {}
      this.subSynth = null;
    }
    if (this.subGain) {
      try { this.subGain.dispose(); } catch (_) {}
      this.subGain = null;
    }

    if (this.noiseSynth) {
      try { this.noiseSynth.dispose(); } catch (_) {}
      this.noiseSynth = null;
    }
    if (this.noiseGain) {
      try { this.noiseGain.dispose(); } catch (_) {}
      this.noiseGain = null;
    }

    try { this.mixerSumNode.dispose(); } catch (_) {}
    if (this.driveNode) try { this.driveNode.dispose(); } catch (_) {}
    try { this.filterNode.dispose(); } catch (_) {}
    try { this.lfoAmpNode.dispose(); } catch (_) {}

    if (this.chorusNode) try { this.chorusNode.stop(); this.chorusNode.dispose(); } catch (_) {}
    if (this.delayNode) try { this.delayNode.dispose(); } catch (_) {}
    if (this.reverbNode) try { this.reverbNode.dispose(); } catch (_) {}

    try { this.outputNode.dispose(); } catch (_) {}
  }
}
