/**
 * phosphor-processor.js
 * Pure JavaScript AudioWorkletProcessor for Phosphor DAW.
 * Served directly from public/ to avoid any Vite HMR client injection or bundler transformation.
 */

function polyBlep(t, dt) {
  if (t < dt) {
    const v = t / dt;
    return v + v - v * v - 1.0;
  } else if (t > 1.0 - dt) {
    const v = (t - 1.0) / dt;
    return v * v + v + v + 1.0;
  }
  return 0.0;
}

class PhosphorWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.maxVoices = 16;
    this.ageCounter = 0;
    this.currentSample = 0;

    this.params = {
      osc1Wave: 'sawtooth',
      osc1Vol: 0.8,
      osc1Octave: 0,
      osc1Semi: 0,
      osc1Detune: 0,

      osc2Enabled: false,
      osc2Wave: 'square',
      osc2Vol: 0.5,
      osc2Octave: 0,
      osc2Semi: 0,
      osc2Detune: 5,

      subEnabled: false,
      subVol: 0.4,
      subOctave: -1,

      noiseEnabled: false,
      noiseVol: 0.2,

      filterEnabled: true,
      filterType: 'lowpass',
      filterFreq: 2500,
      filterQ: 1.5,
      filterDrive: 0.0,

      attack: 0.01,
      decay: 0.2,
      sustain: 0.7,
      release: 0.3,

      glide: 0.0,
      gain: 0.7,
      pan: 0.0
    };

    // Pre-asignar todas las voces
    for (let i = 0; i < this.maxVoices; i++) {
      this.voices.push({
        active: false,
        midi: 0,
        frequency: 440,
        targetFrequency: 440,
        velocity: 0.8,
        phase1: 0,
        phase2: 0,
        phaseSub: 0,
        envStage: 'idle',
        envLevel: 0,
        startSample: -1,
        targetReleaseSample: -1,
        ic1eq: 0,
        ic2eq: 0,
        age: 0
      });
    }

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data) return;

      switch (data.type) {
        case 'noteOn':
          this.noteOn(data.midi, data.velocity ?? 0.8, data.durationSeconds, data.delaySamples);
          break;
        case 'noteOff':
          this.noteOff(data.midi, data.delaySamples);
          break;
        case 'allNotesOff':
          this.allNotesOff(data.delaySamples);
          break;
        case 'setParams':
          if (data.params) {
            Object.assign(this.params, data.params);
          }
          break;
      }
    };
  }

  noteOn(midi, velocity, durationSeconds, delaySamples) {
    let targetVoice = null;

    // 1. Buscar voz libre
    for (let i = 0; i < this.maxVoices; i++) {
      if (!this.voices[i].active || this.voices[i].envStage === 'idle') {
        targetVoice = this.voices[i];
        break;
      }
    }

    // 2. Voice-Stealing
    if (!targetVoice) {
      let oldestAge = Infinity;
      for (let i = 0; i < this.maxVoices; i++) {
        if (this.voices[i].age < oldestAge) {
          oldestAge = this.voices[i].age;
          targetVoice = this.voices[i];
        }
      }
    }

    if (!targetVoice) return;

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const startDelay = delaySamples && delaySamples > 0 ? Math.floor(delaySamples) : 0;
    const targetStart = this.currentSample + startDelay;

    targetVoice.active = true;
    targetVoice.midi = midi;
    targetVoice.targetFrequency = freq;
    if (this.params.glide <= 0.001 || targetVoice.envStage === 'idle' || !targetVoice.frequency) {
      targetVoice.frequency = freq;
    }
    targetVoice.velocity = velocity;
    targetVoice.startSample = targetStart;
    targetVoice.age = ++this.ageCounter;

    if (startDelay > 0) {
      targetVoice.envStage = 'pending';
      targetVoice.envLevel = 0;
    } else {
      targetVoice.envStage = 'attack';
    }

    targetVoice.targetReleaseSample =
      durationSeconds && durationSeconds > 0
        ? targetStart + Math.floor(durationSeconds * sampleRate)
        : -1;
  }

  noteOff(midi, delaySamples) {
    const releaseSample = delaySamples && delaySamples > 0 ? this.currentSample + Math.floor(delaySamples) : this.currentSample;
    for (let i = 0; i < this.maxVoices; i++) {
      if (this.voices[i].active && this.voices[i].midi === midi && this.voices[i].envStage !== 'release' && this.voices[i].envStage !== 'idle') {
        if (delaySamples && delaySamples > 0) {
          this.voices[i].targetReleaseSample = releaseSample;
        } else {
          this.voices[i].envStage = 'release';
          this.voices[i].targetReleaseSample = -1;
        }
      }
    }
  }

  allNotesOff(delaySamples) {
    const releaseSample = delaySamples && delaySamples > 0 ? this.currentSample + Math.floor(delaySamples) : this.currentSample;
    for (let i = 0; i < this.maxVoices; i++) {
      if (this.voices[i].active && this.voices[i].envStage !== 'idle') {
        if (delaySamples && delaySamples > 0) {
          this.voices[i].targetReleaseSample = releaseSample;
        } else {
          this.voices[i].envStage = 'release';
          this.voices[i].targetReleaseSample = -1;
        }
      }
    }
  }

  sampleOsc(wave, phase, dt) {
    switch (wave) {
      case 'sine':
        return Math.sin(phase * 2 * Math.PI);
      case 'sawtooth':
      case 'saw': {
        const raw = 2.0 * phase - 1.0;
        return raw - polyBlep(phase, dt);
      }
      case 'square':
      case 'pulse': {
        const raw = phase < 0.5 ? 1.0 : -1.0;
        return raw + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1.0, dt);
      }
      case 'triangle':
      case 'tri': {
        const saw = 2.0 * phase - 1.0 - polyBlep(phase, dt);
        return 2.0 * Math.abs(saw) - 1.0;
      }
      default:
        return 0;
    }
  }

  process(_inputs, outputs, _parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;
    const blockSize = outL.length;

    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    const sr = sampleRate;
    const dtBase = 1.0 / sr;

    // Coeficientes de envolvente por bloque
    const attackStep = dtBase / Math.max(0.001, this.params.attack);
    const decayFactor = Math.exp(-dtBase / Math.max(0.001, this.params.decay));
    const releaseFactor = Math.exp(-dtBase / Math.max(0.001, this.params.release));
    const sustainLevel = this.params.sustain;
    const glideFactor = this.params.glide > 0.001 ? Math.exp(-dtBase / Math.max(0.005, this.params.glide)) : 0;

    // Precalcular factores de transposición de osciladores (0 Math.pow por muestra)
    const osc1PitchFactor = Math.pow(2, (this.params.osc1Octave * 12 + this.params.osc1Semi + this.params.osc1Detune / 100) / 12);
    const osc2PitchFactor = this.params.osc2Enabled ? Math.pow(2, (this.params.osc2Octave * 12 + this.params.osc2Semi + this.params.osc2Detune / 100) / 12) : 1;
    const subPitchFactor = this.params.subEnabled ? Math.pow(2, (this.params.subOctave * 12) / 12) : 0.5;

    // Pre-filtrar índices de voces activas o pendientes para este bloque
    const activeIndices = [];
    for (let v = 0; v < this.maxVoices; v++) {
      if (this.voices[v].active && this.voices[v].envStage !== 'idle') {
        activeIndices.push(v);
      }
    }
    if (activeIndices.length === 0) {
      this.currentSample += blockSize;
      return true;
    }

    // Coeficientes del Filtro SVF (Cytomic / Andrew Simper)
    const cutoffClamped = Math.max(20, Math.min(sr * 0.49, this.params.filterFreq));
    const g = Math.tan((Math.PI * cutoffClamped) / sr);
    const k = 1.0 / Math.max(0.1, this.params.filterQ);
    const a1 = 1.0 / (1.0 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;

    const pan = Math.max(-1, Math.min(1, this.params.pan));
    const gainL = this.params.gain * (pan <= 0 ? 1 : 1 - pan);
    const gainR = this.params.gain * (pan >= 0 ? 1 : 1 + pan);
    const activeCount = activeIndices.length;

    for (let s = 0; s < blockSize; s++) {
      this.currentSample++;
      let sampleSumL = 0;
      let sampleSumR = 0;

      for (let i = 0; i < activeCount; i++) {
        const voice = this.voices[activeIndices[i]];
        if (!voice.active || voice.envStage === 'idle') {
          continue;
        }

        // 0. Inicio programado por Lookahead Scheduler
        if (voice.envStage === 'pending') {
          if (this.currentSample >= voice.startSample) {
            voice.envStage = 'attack';
          } else {
            continue;
          }
        }

        // 1. Auto-release para duraciones programadas
        if (voice.targetReleaseSample > 0 && this.currentSample >= voice.targetReleaseSample) {
          voice.envStage = 'release';
          voice.targetReleaseSample = -1;
        }

        // 2. Cálculo de Envolvente ADSR
        switch (voice.envStage) {
          case 'attack':
            voice.envLevel += attackStep;
            if (voice.envLevel >= 1.0) {
              voice.envLevel = 1.0;
              voice.envStage = 'decay';
            }
            break;
          case 'decay':
            voice.envLevel = sustainLevel + (voice.envLevel - sustainLevel) * decayFactor;
            break;
          case 'sustain':
            voice.envLevel = sustainLevel;
            break;
          case 'release':
            voice.envLevel *= releaseFactor;
            if (voice.envLevel < 0.0001) {
              voice.envLevel = 0;
              voice.envStage = 'idle';
              voice.active = false;
              continue;
            }
            break;
        }

        // 2.5 Glide / Portamento
        if (glideFactor > 0) {
          voice.frequency = voice.targetFrequency + (voice.frequency - voice.targetFrequency) * glideFactor;
        } else {
          voice.frequency = voice.targetFrequency;
        }

        // 3. Cálculo de Osciladores con factores de frecuencia precalculados
        const dt1 = voice.frequency * osc1PitchFactor * dtBase;
        voice.phase1 = (voice.phase1 + dt1) % 1.0;
        let voiceSample = this.sampleOsc(this.params.osc1Wave, voice.phase1, dt1) * this.params.osc1Vol;

        // OSC 2
        if (this.params.osc2Enabled) {
          const dt2 = voice.frequency * osc2PitchFactor * dtBase;
          voice.phase2 = (voice.phase2 + dt2) % 1.0;
          voiceSample += this.sampleOsc(this.params.osc2Wave, voice.phase2, dt2) * this.params.osc2Vol;
        }

        // Sub-Osc (Onda cuadrada pura 1 o 2 octavas abajo)
        if (this.params.subEnabled) {
          const dtSub = voice.frequency * subPitchFactor * dtBase;
          voice.phaseSub = (voice.phaseSub + dtSub) % 1.0;
          voiceSample += (voice.phaseSub < 0.5 ? 1.0 : -1.0) * this.params.subVol;
        }

        // Generador de Ruido
        if (this.params.noiseEnabled) {
          voiceSample += (Math.random() * 2.0 - 1.0) * this.params.noiseVol;
        }

        // 4. Filtro SVF Cytomic
        if (this.params.filterEnabled) {
          const v0 = voiceSample;
          const v1 = a1 * voice.ic1eq + a2 * (v0 - voice.ic2eq);
          const v2 = voice.ic2eq + a2 * voice.ic1eq + a3 * (v0 - voice.ic2eq);
          voice.ic1eq = 2.0 * v1 - voice.ic1eq;
          voice.ic2eq = 2.0 * v2 - voice.ic2eq;

          if (this.params.filterType === 'lowpass') {
            voiceSample = v2;
          } else if (this.params.filterType === 'bandpass') {
            voiceSample = v1;
          } else if (this.params.filterType === 'highpass') {
            voiceSample = v0 - k * v1 - v2;
          }
        }

        // 5. Acumular en la mezcla estéreo
        const amp = voiceSample * voice.envLevel * voice.velocity;
        sampleSumL += amp;
        sampleSumR += amp;
      }

      outL[s] = sampleSumL * gainL;
      if (outR !== outL) {
        outR[s] = sampleSumR * gainR;
      }
    }

    return true;
  }
}

try {
  registerProcessor('phosphor-synth-processor', PhosphorWorkletProcessor);
} catch (_) {}
