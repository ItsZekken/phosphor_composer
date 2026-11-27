/**
 * WebAudioFontEngine.ts
 * Motor de reproducción SoundFont inspirado en surikov/webaudiofont (WebAudioFontPlayer)
 * adaptado a la arquitectura de Phosphor Composer con:
 * - Pool de voces nativas Web Audio (AudioBufferSourceNode + BiquadFilterNode + GainNode + StereoPannerNode)
 * - Soporte completo de zonas múltiples (estéreo L/R, capas de velocidad, loops SF2/WAF, AHDSR, exclusiveClass)
 * - Paridad acústica 1:1 entre reproducción en vivo (AudioContext) y renderizado offline (OfflineAudioContext)
 */

import * as Tone from 'tone';
import { noteToMidi } from '../../music/pitchClass';
import type { ChannelSoundFontConfig } from '../../../utils/typeDefinitions';
import type { ParsedSoundFontPreset, SoundFontZone } from './sf2Parser';
import { soundfontRegistry } from './soundfontRegistry';
import { SoundFontFxChain } from './soundfontFx';

const MAX_SOUNDFONT_VOICES = 112;
const MAX_SAME_PITCH_VOICES = 4;

export interface WebAudioFontVoiceHandle {
  note: string;
  midi: number;
  exclusiveClass: number;
  loopMode: 0 | 1 | 3;
  releaseSec: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode | null;
  panner: StereoPannerNode | null;
  age: number;
  released: boolean;
  sustainedByPedal: boolean;
  cancel: (atTime?: number) => void;
}

export interface QueueWaveTableOptions {
  gainScale?: number;
  releaseMultiplier?: number;
  transpose?: number;
  sustained?: boolean;
  densityHeadroom?: number;
  onVoiceEnded?: (voice: WebAudioFontVoiceHandle) => void;
}

/**
 * Selecciona todas las zonas del preset que coinciden con (midi, velocity127).
 * Mantiene soporte completo de pares estéreo (Left+Right) y capas de velocidad SF2,
 * con fallback a la zona más cercana en bancos melódicos (como WebAudioFontPlayer.findZone).
 */
export function findMatchingZones(
  preset: ParsedSoundFontPreset,
  midi: number,
  velocity127: number
): SoundFontZone[] {
  const zones = preset.zones;
  if (!zones || zones.length === 0) return [];

  const exact: SoundFontZone[] = [];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (
      midi >= z.keyRangeLow &&
      midi <= z.keyRangeHigh &&
      velocity127 >= z.velRangeLow &&
      velocity127 <= z.velRangeHigh
    ) {
      exact.push(z);
    }
  }
  if (exact.length > 0) return exact;

  // Fallback 1: coincidencia solo por rango de tecla (si las capas de velocidad tenían hueco)
  const keyOnly: SoundFontZone[] = [];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (midi >= z.keyRangeLow && midi <= z.keyRangeHigh) {
      keyOnly.push(z);
    }
  }
  if (keyOnly.length > 0) return keyOnly;

  // En banco de percusión (128), teclas sin mapeo permanecen en silencio
  if (preset.bank === 128) return [];

  // Fallback 2 (bancos melódicos): zona(s) más cercanas en altura MIDI
  let bestDist = Infinity;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const dist = midi < z.keyRangeLow ? z.keyRangeLow - midi : midi - z.keyRangeHigh;
    if (dist < bestDist) bestDist = dist;
  }

  const nearest: SoundFontZone[] = [];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const dist = midi < z.keyRangeLow ? z.keyRangeLow - midi : midi - z.keyRangeHigh;
    if (dist === bestDist) {
      nearest.push(z);
    }
  }
  return nearest;
}

/**
 * Calcula la amplitud aproximada de la envolvente AHDSR en un instante relativo `tFromStart`
 * para evitar saltos de ganancia en notas staccato más cortas que Attack + Hold + Decay.
 */
function sampleAhdsrLevelAt(
  tFromStart: number,
  peakGain: number,
  delay: number,
  attack: number,
  hold: number,
  decay: number,
  sustainGain: number
): number {
  if (tFromStart <= delay) return 0.0001;
  const tAfterDelay = tFromStart - delay;
  if (tAfterDelay < attack) {
    return 0.0001 + (peakGain - 0.0001) * (tAfterDelay / Math.max(0.0001, attack));
  }
  const tAfterAttack = tAfterDelay - attack;
  if (tAfterAttack < hold) {
    return peakGain;
  }
  const tAfterHold = tAfterAttack - hold;
  if (decay <= 0.001) {
    return sustainGain;
  }
  // Aproximación suave de la rampa exponencial de decay
  const frac = Math.min(1, tAfterHold / decay);
  return Math.max(0.0001, peakGain * Math.pow(Math.max(0.0001, sustainGain / Math.max(0.0001, peakGain)), frac));
}

/**
 * Núcleo WebAudioFontPlayer inspirado directamente en surikov/webaudiofont.
 * Opera de forma agnóstica sobre cualquier BaseAudioContext (AudioContext en vivo u OfflineAudioContext).
 */
export class WebAudioFontPlayerCore {
  private voiceAgeCounter = 0;

  /**
   * Programa una nota (todas sus zonas activas) en el BaseAudioContext objetivo.
   * Equivalente enriquecido de `WebAudioFontPlayer.queueWaveTable`.
   */
  public queueWaveTable(
    audioCtx: BaseAudioContext,
    targetNode: AudioNode,
    soundfontId: string,
    preset: ParsedSoundFontPreset,
    when: number,
    pitchMidi: number,
    durationSec: number | null,
    velocity = 0.8,
    noteLabel = '',
    options: QueueWaveTableOptions = {}
  ): WebAudioFontVoiceHandle[] {
    const transpose = options.transpose ?? 0;
    const effectiveInputMidi = Math.max(0, Math.min(127, Math.round(pitchMidi + transpose)));
    const clampedVel = Math.max(0.02, Math.min(1.0, velocity));
    const velocity127 = Math.max(1, Math.min(127, Math.round(clampedVel * 127)));

    const matchedZones = findMatchingZones(preset, effectiveInputMidi, velocity127);
    if (matchedZones.length === 0) return [];

    const now = audioCtx.currentTime;
    const startAt = Math.max(now, when);
    const gainScale = Math.max(0, Math.min(2.5, options.gainScale ?? 1.0));
    const releaseMult = Math.max(0.1, Math.min(4.0, options.releaseMultiplier ?? 1.0));
    const densityHeadroom = options.densityHeadroom ?? 1.0;

    // Compensación ligera si hay varias zonas mono apiladas (las zonas estéreo L/R con pan opuesto no suman en el mismo canal)
    const isStereoPair =
      matchedZones.length === 2 &&
      Math.sign(matchedZones[0].pan) !== 0 &&
      Math.sign(matchedZones[0].pan) === -Math.sign(matchedZones[1].pan);
    const layerCompensation =
      matchedZones.length > 1 && !isStereoPair ? 1 / Math.sqrt(matchedZones.length) : 1.0;

    const handles: WebAudioFontVoiceHandle[] = [];

    for (let i = 0; i < matchedZones.length; i++) {
      const zone = matchedZones[i];
      const buffer = soundfontRegistry.getZoneAudioBufferSync(soundfontId, zone, audioCtx);
      if (!buffer) continue;

      const handle = this.scheduleSingleZone(
        audioCtx,
        targetNode,
        zone,
        buffer,
        startAt,
        effectiveInputMidi,
        durationSec,
        clampedVel,
        noteLabel,
        gainScale * densityHeadroom * layerCompensation,
        releaseMult,
        Boolean(options.sustained),
        options.onVoiceEnded
      );
      if (handle) {
        handles.push(handle);
      }
    }

    return handles;
  }

  private scheduleSingleZone(
    audioCtx: BaseAudioContext,
    targetNode: AudioNode,
    zone: SoundFontZone,
    buffer: AudioBuffer,
    startAt: number,
    midi: number,
    durationSec: number | null,
    velocity: number,
    noteLabel: string,
    gainScale: number,
    releaseMult: number,
    sustained: boolean,
    onVoiceEnded?: (voice: WebAudioFontVoiceHandle) => void
  ): WebAudioFontVoiceHandle | null {
    const effectiveMidi = zone.fixedKey !== null ? zone.fixedKey : midi;
    const effectiveVel = zone.fixedVelocity !== null ? Math.max(0.02, zone.fixedVelocity / 127) : velocity;

    // Cálculo de pitch exacto SF2 / WebAudioFont
    const deltaCents =
      (effectiveMidi - zone.originalPitch) * zone.scaleTuning +
      zone.coarseTune * 100 +
      zone.fineTune +
      zone.pitchCorrection;
    const playbackRate = Math.max(0.0625, Math.min(16, Math.pow(2, deltaCents / 1200)));

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(playbackRate, startAt);

    // Configurar loops (normalizando unidades de frames vs segundos en WebAudioFont)
    let loopStartSec = zone.loopStart;
    let loopEndSec = zone.loopEnd;
    if (zone.wafLoopRaw && loopEndSec > buffer.duration && zone.sampleRate > 0) {
      loopStartSec = zone.loopStart / zone.sampleRate;
      loopEndSec = zone.loopEnd / zone.sampleRate;
    }

    const canLoop =
      (zone.loopMode === 1 || zone.loopMode === 3) &&
      loopEndSec > loopStartSec + 0.002 &&
      loopStartSec >= 0 &&
      loopStartSec < buffer.duration;

    if (canLoop) {
      src.loop = true;
      src.loopStart = loopStartSec;
      src.loopEnd = Math.min(buffer.duration, loopEndSec);
    }

    // Ganancia objetivo con curva de velocidad natural + atenuación SF2
    const velGain = Math.pow(effectiveVel, 1.5);
    const attenGain = zone.attenuationDb > 0 ? Math.pow(10, -zone.attenuationDb / 20) : 1.0;
    const peakGain = Math.max(0.0001, Math.min(2.0, velGain * attenGain * gainScale * 0.85));

    const gainNode = audioCtx.createGain();

    // Envolvente AHDSR (setupEnvelope estilo WebAudioFont + SF2)
    const keyFactorHold =
      zone.keynumToVolEnvHold !== 0
        ? Math.pow(2, ((60 - effectiveMidi) * zone.keynumToVolEnvHold) / 1200)
        : 1.0;
    const keyFactorDecay =
      zone.keynumToVolEnvDecay !== 0
        ? Math.pow(2, ((60 - effectiveMidi) * zone.keynumToVolEnvDecay) / 1200)
        : 1.0;

    const delaySec = zone.ahdsr.delay;
    const attackSec = Math.max(0.002, zone.ahdsr.attack);
    const holdSec = Math.min(40, zone.ahdsr.hold * keyFactorHold);
    const decaySec = Math.min(60, zone.ahdsr.decay * keyFactorDecay);
    const sustainGain = Math.max(0.0001, peakGain * zone.ahdsr.sustain);
    const releaseSec = Math.max(0.015, Math.min(20, zone.ahdsr.release * releaseMult));

    const envStart = startAt + delaySec;

    if (Array.isArray(zone.wafAhdsrCurve) && zone.wafAhdsrCurve.length > 0) {
      // Curva AHDSR explícita de surikov/webaudiofont
      gainNode.gain.setValueAtTime(0.0001, startAt);
      let cursor = envStart;
      for (let k = 0; k < zone.wafAhdsrCurve.length; k++) {
        const pt = zone.wafAhdsrCurve[k];
        cursor += Math.max(0.002, pt.duration);
        gainNode.gain.linearRampToValueAtTime(Math.max(0.0001, pt.volume * peakGain), cursor);
      }
    } else if (zone.wafAhdsrCurve === false) {
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.linearRampToValueAtTime(peakGain, envStart + 0.003);
    } else {
      gainNode.gain.setValueAtTime(0.0001, startAt);
      if (delaySec > 0.0005) {
        gainNode.gain.setValueAtTime(0.0001, envStart);
      }
      gainNode.gain.linearRampToValueAtTime(peakGain, envStart + attackSec);

      const decayStart = envStart + attackSec + holdSec;
      if (holdSec > 0.0005) {
        gainNode.gain.setValueAtTime(peakGain, decayStart);
      }

      if (zone.ahdsr.sustain < 0.999) {
        if (decaySec > 0.002) {
          gainNode.gain.exponentialRampToValueAtTime(sustainGain, decayStart + decaySec);
        } else {
          gainNode.gain.setValueAtTime(sustainGain, decayStart + 0.001);
        }
      }
    }

    // Filtro pasa-bajos SF2 opcional (solo se instancia cuando el patch usa filtro activo)
    let filterNode: BiquadFilterNode | null = null;
    if (zone.filterCutoffHz !== null && zone.filterCutoffHz < 19800) {
      filterNode = audioCtx.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.setValueAtTime(zone.filterCutoffHz, startAt);
      // En W3C Web Audio lowpass, Q se expresa en dB; -3.0103 dB = respuesta Butterworth plana (SF2 Q=0)
      filterNode.Q.setValueAtTime(Math.min(24, zone.filterQDb - 3.0103), startAt);
    }

    // Paneo estéreo SF2 opcional
    let pannerNode: StereoPannerNode | null = null;
    if (Math.abs(zone.pan) > 0.005 && typeof audioCtx.createStereoPanner === 'function') {
      pannerNode = audioCtx.createStereoPanner();
      pannerNode.pan.setValueAtTime(zone.pan, startAt);
    }

    // Conectar grafo de la voz: src -> [filter] -> gain -> [panner] -> targetNode
    let tail: AudioNode = src;
    if (filterNode) {
      tail.connect(filterNode);
      tail = filterNode;
    }
    tail.connect(gainNode);
    tail = gainNode;
    if (pannerNode) {
      tail.connect(pannerNode);
      tail = pannerNode;
    }
    tail.connect(targetNode);

    const voice: WebAudioFontVoiceHandle = {
      note: noteLabel,
      midi: effectiveMidi,
      exclusiveClass: zone.exclusiveClass,
      loopMode: zone.loopMode,
      releaseSec,
      src,
      gain: gainNode,
      filter: filterNode,
      panner: pannerNode,
      age: ++this.voiceAgeCounter,
      released: false,
      sustainedByPedal: false,
      cancel: (atTime?: number) => {
        try {
          const t = atTime !== undefined ? Math.max(audioCtx.currentTime, atTime) : audioCtx.currentTime;
          gainNode.gain.cancelScheduledValues(t);
          gainNode.gain.setTargetAtTime(0.00001, t, 0.005);
          src.stop(t + 0.025);
          voice.released = true;
        } catch {}
      }
    };

    src.start(startAt);

    // Programar release para notas con duración definida (playback del timeline y render offline)
    if (durationSec !== null) {
      if (sustained) {
        voice.sustainedByPedal = true;
      } else {
        const relAt = startAt + Math.max(0.02, durationSec);
        const relLevel = sampleAhdsrLevelAt(
          relAt - startAt,
          peakGain,
          delaySec,
          attackSec,
          holdSec,
          decaySec,
          sustainGain
        );

        gainNode.gain.cancelScheduledValues(relAt);
        gainNode.gain.setValueAtTime(Math.max(0.0001, relLevel), relAt);
        const tau = Math.max(0.004, releaseSec / 4.6);
        gainNode.gain.setTargetAtTime(0.00001, relAt, tau);

        const stopDelay = Math.min(releaseSec * 1.4, 10) + 0.05;
        if (canLoop) {
          src.stop(relAt + stopDelay);
        } else {
          // Para samples sin loop, respetar la duración natural del sample si acaba antes
          const naturalEnd = startAt + buffer.duration / playbackRate + 0.02;
          src.stop(Math.min(naturalEnd, relAt + stopDelay));
        }
        voice.released = true;
      }
    }

    src.onended = () => {
      onVoiceEnded?.(voice);
      try {
        src.disconnect();
        if (filterNode) filterNode.disconnect();
        gainNode.disconnect();
        if (pannerNode) pannerNode.disconnect();
      } catch {}
    };

    return voice;
  }
}

export const sharedWebAudioFontPlayer = new WebAudioFontPlayerCore();

/**
 * Sampler de canal SoundFont compatible con ChannelInstrumentManager (misma interfaz que PianoSampler).
 */
export class SoundFontSampler {
  private targetNode: Tone.InputNode;
  private busInput: GainNode | null = null;
  private fxChain: SoundFontFxChain | null = null;
  private busCompressor: DynamicsCompressorNode | null = null;
  private activeVoices: WebAudioFontVoiceHandle[] = [];
  private config: ChannelSoundFontConfig | undefined = undefined;
  private activePreset: ParsedSoundFontPreset | null = null;
  private isPedalActive = false;

  public loaded = false;
  public isLoading = false;
  private loadVersion = 0;

  constructor(targetNode: Tone.InputNode) {
    this.targetNode = targetNode;
  }

  private getLiveAudioContext(): AudioContext | null {
    try {
      const raw = Tone.getContext().rawContext as AudioContext | undefined;
      if (raw && typeof raw.createBufferSource === 'function' && typeof raw.createGain === 'function') {
        return raw;
      }
    } catch {}
    return null;
  }

  private ensureNativeBus(audioCtx: AudioContext): GainNode {
    if (this.busInput) return this.busInput;
    const bus = audioCtx.createGain();
    bus.gain.value = 1.0;

    let stageOut: AudioNode;
    if (typeof audioCtx.createDynamicsCompressor === 'function') {
      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -5;
      comp.knee.value = 12;
      comp.ratio.value = 8;
      comp.attack.value = 0.002;
      comp.release.value = 0.08;
      Tone.connect(comp, this.targetNode as any);
      this.busCompressor = comp;
      stageOut = comp;
    } else {
      const bridge = audioCtx.createGain();
      bridge.gain.value = 1.0;
      Tone.connect(bridge, this.targetNode as any);
      stageOut = bridge;
    }

    const fx = new SoundFontFxChain(audioCtx, stageOut);
    fx.applySettings(this.config?.chorus, this.config?.reverb);
    bus.connect(fx.input);

    this.fxChain = fx;
    this.busInput = bus;
    return bus;
  }

  public getConfig(): ChannelSoundFontConfig | undefined {
    return this.config;
  }

  public setConfig(config: ChannelSoundFontConfig | undefined): void {
    const prev = this.config;
    const patchChanged =
      prev?.soundfontId !== config?.soundfontId ||
      prev?.bank !== config?.bank ||
      prev?.program !== config?.program;

    this.config = config ? { ...config } : undefined;

    // Actualizar Chorus y Reverb en tiempo real inmediatamente
    if (this.fxChain) {
      this.fxChain.applySettings(this.config?.chorus, this.config?.reverb);
    }

    if (!config || !config.soundfontId) {
      this.activePreset = null;
      this.loaded = false;
      this.isLoading = false;
      return;
    }

    if (patchChanged || !this.activePreset) {
      // Resolución síncrona instantánea si el SF2 ya está en memoria
      const preset = soundfontRegistry.findPreset(config.soundfontId, config.bank, config.program);
      if (preset) {
        this.activePreset = preset;
        const audioCtx = this.getLiveAudioContext();
        const needsAsyncDecode = preset.zones.some(
          (z) => Boolean(z.encodedFileBase64) || (z.sampleType & 0x10) !== 0
        );
        if (!needsAsyncDecode) {
          this.loaded = true;
          this.isLoading = false;
          if (audioCtx) {
            this.ensureNativeBus(audioCtx);
          }
          return;
        }
      }
      this.load().catch(() => {});
    }
  }

  public async load(): Promise<boolean> {
    if (!this.config?.soundfontId) {
      this.loaded = false;
      this.isLoading = false;
      return false;
    }

    const version = ++this.loadVersion;
    const { soundfontId, bank, program } = this.config;
    this.isLoading = true;

    const promise = (async (): Promise<boolean> => {
      try {
        const audioCtx = this.getLiveAudioContext();
        if (!audioCtx) {
          const parsed = await soundfontRegistry.ensureLoaded(soundfontId);
          if (version !== this.loadVersion) return this.loaded;
          this.activePreset = parsed ? soundfontRegistry.findPreset(soundfontId, bank, program) || null : null;
          this.loaded = Boolean(this.activePreset);
          this.isLoading = false;
          return this.loaded;
        }

        const preset = await soundfontRegistry.preloadPresetBuffers(soundfontId, bank, program, audioCtx);
        if (version !== this.loadVersion) return this.loaded;

        if (preset) {
          this.activePreset = preset;
          this.ensureNativeBus(audioCtx);
          this.loaded = true;
          this.isLoading = false;
          return true;
        }

        this.activePreset = null;
        this.loaded = false;
        this.isLoading = false;
        return false;
      } catch (err) {
        console.warn('[SoundFontSampler] Error cargando SoundFont:', err);
        if (version === this.loadVersion) {
          this.loaded = false;
          this.isLoading = false;
        }
        return false;
      }
    })();

    return promise;
  }

  private enforceExclusiveAndPolyphony(midi: number, exclusiveClasses: number[], startAt: number): void {
    // 1. Corte de grupos exclusivos (ej. Hi-Hat cerrado corta abierto)
    if (exclusiveClasses.length > 0) {
      for (let i = this.activeVoices.length - 1; i >= 0; i--) {
        const v = this.activeVoices[i];
        if (v.exclusiveClass > 0 && exclusiveClasses.includes(v.exclusiveClass)) {
          this.activeVoices.splice(i, 1);
          v.cancel(startAt);
        }
      }
    }

    // 2. Limitar voces duplicadas sobre la misma altura
    let sameCount = 0;
    let oldestIdx = -1;
    let oldestAge = Infinity;
    for (let i = 0; i < this.activeVoices.length; i++) {
      const v = this.activeVoices[i];
      if (v.midi === midi) {
        sameCount++;
        if (v.age < oldestAge) {
          oldestAge = v.age;
          oldestIdx = i;
        }
      }
    }
    if (sameCount >= MAX_SAME_PITCH_VOICES && oldestIdx !== -1) {
      const victim = this.activeVoices.splice(oldestIdx, 1)[0];
      victim?.cancel(startAt);
    }

    // 3. Robo de voces LRU si se excede el tope de polifonía
    while (this.activeVoices.length >= MAX_SOUNDFONT_VOICES) {
      let victimIdx = 0;
      let victimScore = Infinity;
      for (let i = 0; i < this.activeVoices.length; i++) {
        const v = this.activeVoices[i];
        const score = v.released ? v.age - 1_000_000 : v.age;
        if (score < victimScore) {
          victimScore = score;
          victimIdx = i;
        }
      }
      const victim = this.activeVoices.splice(victimIdx, 1)[0];
      victim?.cancel(startAt);
    }
  }

  private spawnNote(note: string, durationSec: number | null, time?: number, velocity = 0.8): void {
    if (!this.config?.soundfontId) return;
    const audioCtx = this.getLiveAudioContext();
    if (!audioCtx) return;

    if (!this.activePreset) {
      const instant = soundfontRegistry.findPreset(
        this.config.soundfontId,
        this.config.bank,
        this.config.program
      );
      if (instant) {
        this.activePreset = instant;
        this.loaded = true;
      } else {
        if (!this.isLoading) {
          this.load().catch(() => {});
        }
        return;
      }
    }

    const midi = noteToMidi(note);
    const transpose = this.config.transpose ?? 0;
    const effectiveMidi = Math.max(0, Math.min(127, Math.round(midi + transpose)));
    const vel127 = Math.max(1, Math.min(127, Math.round(Math.max(0.02, Math.min(1, velocity)) * 127)));
    const startAt = time !== undefined ? Math.max(audioCtx.currentTime, time) : audioCtx.currentTime;

    const previewZones = findMatchingZones(this.activePreset, effectiveMidi, vel127);
    const exclusiveClasses: number[] = [];
    for (let i = 0; i < previewZones.length; i++) {
      if (previewZones[i].exclusiveClass > 0) {
        exclusiveClasses.push(previewZones[i].exclusiveClass);
      }
    }
    this.enforceExclusiveAndPolyphony(effectiveMidi, exclusiveClasses, startAt);

    const activeCount = this.activeVoices.length;
    const densityHeadroom = activeCount > 10 ? Math.max(0.35, 1 / Math.sqrt(activeCount / 10)) : 1.0;
    const bus = this.ensureNativeBus(audioCtx);

    const voices = sharedWebAudioFontPlayer.queueWaveTable(
      audioCtx,
      bus,
      this.config.soundfontId,
      this.activePreset,
      startAt,
      midi,
      durationSec,
      velocity,
      note,
      {
        gainScale: this.config.gain ?? 1.0,
        releaseMultiplier: this.config.releaseMultiplier ?? 1.0,
        transpose,
        sustained: this.isPedalActive && durationSec !== null,
        densityHeadroom,
        onVoiceEnded: (ended) => {
          const idx = this.activeVoices.indexOf(ended);
          if (idx !== -1) this.activeVoices.splice(idx, 1);
        }
      }
    );

    for (let i = 0; i < voices.length; i++) {
      this.activeVoices.push(voices[i]);
    }
  }

  public keyDown({ note, time, velocity = 0.8 }: { note: string; time?: number; velocity?: number }): void {
    try {
      this.spawnNote(note, null, time, velocity);
    } catch (err) {
      console.warn('[SoundFontSampler] Error en keyDown:', err);
    }
  }

  public keyUp({ note, time }: { note: string; time?: number }): void {
    const audioCtx = this.getLiveAudioContext();
    const now = audioCtx ? audioCtx.currentTime : 0;
    const relAt = time !== undefined ? Math.max(now, time) : now;

    for (let i = 0; i < this.activeVoices.length; i++) {
      const v = this.activeVoices[i];
      if (!v.released && v.note === note) {
        if (this.isPedalActive) {
          v.sustainedByPedal = true;
        } else {
          this.releaseVoice(v, relAt);
        }
      }
    }
  }

  private releaseVoice(v: WebAudioFontVoiceHandle, relAt: number): void {
    try {
      const g = v.gain.gain;
      if (typeof (g as any).cancelAndHoldAtTime === 'function') {
        (g as any).cancelAndHoldAtTime(relAt);
      } else {
        g.cancelScheduledValues(relAt);
        g.setValueAtTime(Math.max(0.0001, g.value), relAt);
      }
      if (v.loopMode === 3) {
        v.src.loop = false;
      }
      const tau = Math.max(0.004, v.releaseSec / 4.6);
      g.setTargetAtTime(0.00001, relAt, tau);
      v.src.stop(relAt + Math.min(v.releaseSec * 1.4, 10) + 0.05);
      v.released = true;
    } catch {}
  }

  public triggerAttackRelease(
    note: string | string[],
    duration: number | string,
    time?: number,
    velocity = 0.8
  ): void {
    const durSec = typeof duration === 'number' ? duration : Tone.Time(duration).toSeconds();
    try {
      if (Array.isArray(note)) {
        for (let i = 0; i < note.length; i++) {
          this.spawnNote(note[i], durSec, time, velocity);
        }
      } else {
        this.spawnNote(note, durSec, time, velocity);
      }
    } catch (err) {
      console.warn('[SoundFontSampler] Error en triggerAttackRelease:', err);
    }
  }

  public pedalDown(): void {
    this.isPedalActive = true;
  }

  public pedalUp(options?: { time?: number }): void {
    this.isPedalActive = false;
    const audioCtx = this.getLiveAudioContext();
    const now = audioCtx ? audioCtx.currentTime : 0;
    const relAt = options?.time !== undefined ? Math.max(now, options.time) : now;

    for (let i = 0; i < this.activeVoices.length; i++) {
      const v = this.activeVoices[i];
      if (v.sustainedByPedal && !v.released) {
        v.sustainedByPedal = false;
        this.releaseVoice(v, relAt);
      }
    }
  }

  public stopAll(): void {
    const audioCtx = this.getLiveAudioContext();
    const now = audioCtx ? audioCtx.currentTime : 0;
    const voices = this.activeVoices.splice(0, this.activeVoices.length);
    for (let i = 0; i < voices.length; i++) {
      voices[i].cancel(now);
    }
  }

  public dispose(): void {
    this.stopAll();
    if (this.busInput) {
      try { this.busInput.disconnect(); } catch {}
      this.busInput = null;
    }
    if (this.fxChain) {
      try { this.fxChain.dispose(); } catch {}
      this.fxChain = null;
    }
    if (this.busCompressor) {
      try { this.busCompressor.disconnect(); } catch {}
      this.busCompressor = null;
    }
    this.activePreset = null;
    this.loaded = false;
    this.isLoading = false;
  }
}

/**
 * Renderiza una pista completa de SoundFont en OfflineAudioContext estéreo a velocidad nativa C++,
 * con paridad acústica 1:1 respecto al playback en tiempo real (usado en exportación WAV, MP3, M4A y MP4).
 */
export async function renderSoundFontTrackOffline(
  events: Array<{ note: string; timeSeconds: number; durationSeconds: number; velocity: number }>,
  config: ChannelSoundFontConfig,
  totalDurationSeconds: number,
  sampleRate = 44100
): Promise<AudioBuffer | null> {
  if (!config?.soundfontId || events.length === 0) return null;

  const totalFrames = Math.max(1, Math.ceil(totalDurationSeconds * sampleRate));
  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

  const preset = await soundfontRegistry.preloadPresetBuffers(
    config.soundfontId,
    config.bank,
    config.program,
    offlineCtx
  );

  if (!preset) {
    throw new Error(
      `[Exportación de Audio] No se encontró el SoundFont "${config.patchName || config.soundfontId}" en memoria ni en IndexedDB.`
    );
  }

  const bus = offlineCtx.createGain();
  bus.gain.value = 1.0;

  let stageOut: AudioNode = offlineCtx.destination;
  if (typeof offlineCtx.createDynamicsCompressor === 'function') {
    const comp = offlineCtx.createDynamicsCompressor();
    comp.threshold.value = -5;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.08;
    comp.connect(offlineCtx.destination);
    stageOut = comp;
  }

  const fx = new SoundFontFxChain(offlineCtx, stageOut);
  fx.applySettings(config.chorus, config.reverb);
  bus.connect(fx.input);

  const player = new WebAudioFontPlayerCore();
  const sorted = events.slice().sort((a, b) => a.timeSeconds - b.timeSeconds);

  for (let i = 0; i < sorted.length; i++) {
    const evt = sorted[i];
    if (evt.timeSeconds >= totalDurationSeconds) continue;
    const midi = noteToMidi(evt.note);
    player.queueWaveTable(
      offlineCtx,
      bus,
      config.soundfontId,
      preset,
      Math.max(0, evt.timeSeconds),
      midi,
      Math.max(0.02, evt.durationSeconds),
      evt.velocity,
      evt.note,
      {
        gainScale: config.gain ?? 1.0,
        releaseMultiplier: config.releaseMultiplier ?? 1.0,
        transpose: config.transpose ?? 0
      }
    );
  }

  return offlineCtx.startRendering();
}
