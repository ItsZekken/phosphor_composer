function resolveDelayTimeSeconds(time, bpm) {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? Math.max(20, Math.min(300, bpm)) : 120;
  const beatSec = 60.0 / safeBpm;
  if (typeof time === 'number' && Number.isFinite(time)) {
    return Math.max(0.01, Math.min(2.5, time));
  }
  if (typeof time === 'string') {
    const trimmed = time.trim();
    const multMap = {
      '32n': 0.125,
      '16n': 0.25,
      '16n.': 0.375,
      '8t': 1 / 3,
      '8n': 0.5,
      '8n.': 0.75,
      '4t': 2 / 3,
      '4n': 1.0,
      '4n.': 1.5,
      '2n': 2.0,
      '2n.': 3.0,
      '1n': 4.0
    };
    if (trimmed in multMap) {
      return Math.max(0.01, Math.min(2.5, multMap[trimmed] * beatSec));
    }
    const parsed = parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return Math.max(0.01, Math.min(2.5, parsed));
    }
  }
  return Math.max(0.01, Math.min(2.5, 0.5 * beatSec));
}

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
  constructor(options) {
    super();
    this.bpm = 120;
    this.wasmReady = false;
    this.wasmExports = null;
    this.wasmF32 = null;
    this.wasmI32 = null;
    this.wasmOutL = null;
    this.wasmOutR = null;

    this.voices = [];
    this.maxVoices = 16;
    this.ageCounter = 0;
    this.currentSample = 0;
    this.lfoPhase = 0;
    this.lfoRandVal = 0;

    this.activeVoiceIndices = new Int32Array(16);

    this.osc1WaveCode = 3; // triangle
    this.osc2WaveCode = 1; // sawtooth
    this.subWaveCode = 0;  // sine
    this.filterTypeCode = 0; // lowpass
    this.driveTypeCode = 0;  // tube
    this.noiseTypeCode = 0;  // white
    this.lfoWaveCode = 0;    // sine
    this.lfoTargetCode = 0;  // cutoff

    this.params = {
      osc1Wave: 'triangle',
      osc1Vol: 0.8,
      osc1Octave: 0,
      osc1Semi: 0,
      osc1Detune: 0,

      osc2Enabled: true,
      osc2Wave: 'sawtooth',
      osc2Vol: 0.4,
      osc2Octave: 0,
      osc2Semi: 0,
      osc2Detune: 0,

      subEnabled: false,
      subWave: 'sine',
      subVol: 0.0,
      subOctave: -1,

      noiseEnabled: false,
      noiseType: 'white',
      noiseVol: 0.0,

      filterEnabled: true,
      filterType: 'lowpass',
      filterFreq: 6500,
      filterQ: 1.5,
      filterRolloff: -12,
      filterDrive: 0.1,
      filterDriveType: 'tube',
      filterEnvAmount: 0.3,
      filterKeyTracking: 0.5,
      filterEnvAttack: 0.02,
      filterEnvDecay: 0.35,
      filterEnvSustain: 0.3,
      filterEnvRelease: 0.6,
      attack: 0.04,
      decay: 0.25,
      sustain: 0.65,
      release: 0.6,

      glide: 0.0,
      lfoEnabled: false,
      lfoWave: 'sine',
      lfoRate: 2.5,
      lfoDepth: 0.25,
      lfoTarget: 'cutoff',

      eqEnabled: false,
      eqLow: 0,
      eqLowMid: 0,
      eqHighMid: 0,
      eqHigh: 0,

      fxChorusEnabled: false,
      fxChorusRate: 1.5,
      fxChorusDepth: 0.4,
      fxChorusMix: 0.3,

      fxDelayEnabled: false,
      fxDelayTime: '8n',
      fxDelayFeedback: 0.25,
      fxDelayMix: 0.2,

      fxRevEnabled: false,
      fxRevDecay: 1.8,
      fxRevMix: 0.15,

      gain: 0.7,
      pan: 0.0
    };

    // Coeficientes y estados de Ecualizador Gráfico de 4 Bandas
    this.eqB0 = new Float32Array(4);
    this.eqB1 = new Float32Array(4);
    this.eqB2 = new Float32Array(4);
    this.eqA1 = new Float32Array(4);
    this.eqA2 = new Float32Array(4);
    this.eqBypass = [true, true, true, true];
    this.eqAllBypassed = true;
    this.eqL1 = new Float32Array(4);
    this.eqL2 = new Float32Array(4);
    this.eqR1 = new Float32Array(4);
    this.eqR2 = new Float32Array(4);

    // 1-pole DC blocker state
    this.dcPrevInL = 0;
    this.dcPrevOutL = 0;
    this.dcPrevInR = 0;
    this.dcPrevOutR = 0;

    this.updateParamCodes();
    this.updateEqCoefficients();

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
        fEnvStage: 'idle',
        fEnvLevel: 0,
        startSample: -1,
        targetReleaseSample: -1,
        ic1eq: 0,
        ic2eq: 0,
        ic3eq: 0,
        ic4eq: 0,
        panL: 1,
        panR: 1,
        a1: 0,
        a2: 0,
        a3: 0,
        a1_2: 0,
        a2_2: 0,
        a3_2: 0,
        fDirty: true,
        b0: 0,
        b1: 0,
        b2: 0,
        age: 0
      });
    }

    const pOpts = options && options.processorOptions;
    if (pOpts) {
      if (pOpts.bpm) this.bpm = pOpts.bpm;
      if (pOpts.wasmModule || pOpts.wasmBytes) {
        this.initWasm(pOpts.wasmModule, pOpts.wasmBytes);
      }
    }

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data) return;

      switch (data.type) {
        case 'initWasm':
          this.initWasm(data.module, data.bytes);
          break;
        case 'setBpm':
          if (Number.isFinite(data.bpm) && data.bpm > 0) {
            this.bpm = Math.max(20, Math.min(300, data.bpm));
            if (this.wasmReady) this.syncFxToWasm();
          }
          break;
        case 'noteOn':
          if (this.wasmReady && this.wasmExports) {
            this.wasmExports.noteOn(data.midi | 0, data.velocity ?? 0.8, data.durationSeconds ?? -1, data.delaySamples | 0);
          } else {
            this.noteOn(data.midi, data.velocity ?? 0.8, data.durationSeconds, data.delaySamples);
          }
          break;
        case 'noteOff':
          if (this.wasmReady && this.wasmExports) {
            this.wasmExports.noteOff(data.midi | 0, data.delaySamples | 0);
          } else {
            this.noteOff(data.midi, data.delaySamples);
          }
          break;
        case 'allNotesOff':
          if (this.wasmReady && this.wasmExports) {
            this.wasmExports.allNotesOff(data.delaySamples | 0);
          } else {
            this.allNotesOff(data.delaySamples);
          }
          break;
        case 'setParams':
          if (data.params) {
            Object.assign(this.params, data.params);
            this.updateParamCodes();
            this.updateEqCoefficients();
            if (this.wasmReady) {
              this.syncParamsToWasm();
            }
            if (!this.params.noiseEnabled || this.params.noiseVol <= 0.0001) {
              for (let i = 0; i < this.maxVoices; i++) {
                this.voices[i].b0 = 0;
                this.voices[i].b1 = 0;
                this.voices[i].b2 = 0;
              }
            }
          }
          break;
      }
    };
  }

  bindWasmInstance(inst) {
    const ex = inst.exports;
    const buf = ex.memory.buffer;
    this.wasmExports = ex;
    this.wasmF32 = new Float32Array(buf);
    this.wasmI32 = new Int32Array(buf);
    this.wasmOutL = new Float32Array(buf, 5120, 128);
    this.wasmOutR = new Float32Array(buf, 5632, 128);
    ex.init(sampleRate);
    this.wasmReady = true;
    this.syncParamsToWasm();
    return true;
  }

  initWasm(wasmModule, wasmBytes) {
    if (typeof WebAssembly === 'undefined') {
      this.wasmReady = false;
      return false;
    }
    try {
      let mod = wasmModule;
      if (!mod && wasmBytes) {
        mod = new WebAssembly.Module(wasmBytes);
      }
      if (mod) {
        const inst = new WebAssembly.Instance(mod);
        return this.bindWasmInstance(inst);
      }
    } catch (_) {}

    if (wasmBytes && typeof WebAssembly.instantiate === 'function') {
      WebAssembly.instantiate(wasmBytes)
        .then((res) => {
          const inst = res && res.instance ? res.instance : res;
          if (inst && inst.exports) {
            this.bindWasmInstance(inst);
          }
        })
        .catch(() => {
          this.wasmReady = false;
        });
      return true;
    }
    this.wasmReady = false;
    return false;
  }

  syncParamsToWasm() {
    if (!this.wasmReady || !this.wasmF32 || !this.wasmI32) return;
    const f32 = this.wasmF32;
    const i32 = this.wasmI32;
    const p = this.params;
    const sr = f32[0] || sampleRate;
    const dtBase = f32[1] || (1.0 / sr);

    const osc1Vol = p.osc1Vol ?? 0.8;
    const osc1PF = Math.pow(2, ((p.osc1Octave ?? 0) * 12 + (p.osc1Semi ?? 0) + (p.osc1Detune ?? 0) / 100) / 12);
    const osc2Vol = p.osc2Vol ?? 0.4;
    const osc2En = Boolean(p.osc2Enabled) && osc2Vol > 0.0001;
    const osc2PF = osc2En ? Math.pow(2, ((p.osc2Octave ?? 0) * 12 + (p.osc2Semi ?? 0) + (p.osc2Detune ?? 0) / 100) / 12) : 1;
    const subVol = p.subVol ?? 0;
    const subEn = Boolean(p.subEnabled) && subVol > 0.0001;
    const subPF = subEn ? Math.pow(2, ((p.subOctave ?? -1) * 12) / 12) : 0.5;
    const noiseVol = p.noiseVol ?? 0;
    const noiseEn = Boolean(p.noiseEnabled) && noiseVol > 0.0001;

    const activeOscSum = osc1Vol + (osc2En ? osc2Vol : 0) + (subEn ? subVol * 0.7 : 0) + (noiseEn ? noiseVol * 0.35 : 0);
    const oscNorm = activeOscSum > 1.0 ? (1.0 / Math.pow(activeOscSum, 0.7)) : 1.0;

    i32[64 >> 2] = this.osc1WaveCode;
    f32[68 >> 2] = osc1Vol;
    f32[72 >> 2] = osc1PF;
    i32[76 >> 2] = osc2En ? 1 : 0;
    i32[80 >> 2] = this.osc2WaveCode;
    f32[84 >> 2] = osc2Vol;
    f32[88 >> 2] = osc2PF;
    i32[92 >> 2] = subEn ? 1 : 0;
    i32[96 >> 2] = this.subWaveCode;
    f32[100 >> 2] = subVol;
    f32[104 >> 2] = subPF;
    i32[108 >> 2] = noiseEn ? 1 : 0;
    i32[112 >> 2] = this.noiseTypeCode;
    f32[116 >> 2] = noiseVol;
    f32[120 >> 2] = oscNorm;

    if (!noiseEn) {
      for (let v = 0; v < 32; v++) {
        f32[(4736 >> 2) + v] = 0;
        f32[(4864 >> 2) + v] = 0;
        f32[(4992 >> 2) + v] = 0;
      }
    }

    const filterDrive = Math.max(0, Math.min(1, p.filterDrive ?? 0.1));
    i32[124 >> 2] = p.filterEnabled !== false ? 1 : 0;
    i32[128 >> 2] = this.filterTypeCode;
    f32[132 >> 2] = Math.max(20, Math.min(20000, p.filterFreq ?? 6500));
    f32[136 >> 2] = Math.max(0.5, Math.min(10.0, p.filterQ ?? 1.5));
    i32[140 >> 2] = (p.filterRolloff ?? -12) <= -24 ? 1 : 0;
    f32[144 >> 2] = filterDrive;
    i32[148 >> 2] = filterDrive > 0.005 ? 1 : 0;
    i32[152 >> 2] = this.driveTypeCode;
    f32[156 >> 2] = Math.max(-1, Math.min(1, p.filterEnvAmount ?? 0));
    f32[160 >> 2] = Math.max(0, Math.min(1, p.filterKeyTracking ?? 0));
    f32[236 >> 2] = 1.0 + filterDrive * 2.4;
    f32[240 >> 2] = 1.0 / (1.0 + filterDrive * 0.42);
    const dryAnchor = 0.25 * (1.0 - filterDrive * 0.35);
    f32[244 >> 2] = dryAnchor;
    f32[248 >> 2] = 1.0 - dryAnchor;

    const glide = p.glide || 0.0;
    const hasGlide = glide > 0.001 ? 1 : 0;
    i32[232 >> 2] = hasGlide;
    f32[164 >> 2] = hasGlide ? Math.exp(-dtBase / Math.max(0.005, glide)) : 0;

    const TIME_FACTOR = -6.907755;
    f32[168 >> 2] = dtBase / Math.max(0.003, p.attack ?? 0.04);
    f32[172 >> 2] = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.005, p.decay ?? 0.25));
    f32[176 >> 2] = Math.max(0, Math.min(1, p.sustain ?? 0.65));
    f32[180 >> 2] = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.005, p.release ?? 0.6));

    f32[184 >> 2] = dtBase / Math.max(0.003, p.filterEnvAttack ?? 0.02);
    f32[188 >> 2] = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.005, p.filterEnvDecay ?? 0.35));
    f32[192 >> 2] = Math.max(0, Math.min(1, p.filterEnvSustain ?? 0.3));
    f32[196 >> 2] = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.005, p.filterEnvRelease ?? 0.6));

    const lfoDepth = Math.max(0, Math.min(1, p.lfoDepth ?? 0.25));
    const lfoEn = Boolean(p.lfoEnabled) && lfoDepth > 0.001;
    const lfoRate = Math.max(0.05, Math.min(30, p.lfoRate ?? 2.5));
    i32[200 >> 2] = lfoEn ? 1 : 0;
    i32[204 >> 2] = this.lfoWaveCode;
    f32[208 >> 2] = lfoRate * dtBase;
    f32[212 >> 2] = lfoDepth;
    i32[216 >> 2] = this.lfoTargetCode;

    const pan = Math.max(-1, Math.min(1, p.pan ?? 0));
    const gain = p.gain ?? 0.7;
    f32[220 >> 2] = gain * (pan <= 0 ? 1 : 1 - pan);
    f32[224 >> 2] = gain * (pan >= 0 ? 1 : 1 + pan);

    const eqActive = Boolean(p.eqEnabled) && !this.eqAllBypassed;
    i32[228 >> 2] = eqActive ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      i32[(256 >> 2) + i] = this.eqBypass[i] ? 1 : 0;
      f32[(272 >> 2) + i] = this.eqB0[i];
      f32[(288 >> 2) + i] = this.eqB1[i];
      f32[(304 >> 2) + i] = this.eqB2[i];
      f32[(320 >> 2) + i] = this.eqA1[i];
      f32[(336 >> 2) + i] = this.eqA2[i];
    }

    this.syncFxToWasm();
  }

  syncFxToWasm() {
    if (!this.wasmReady || !this.wasmF32 || !this.wasmI32) return;
    const f32 = this.wasmF32;
    const i32 = this.wasmI32;
    const p = this.params;
    const sr = f32[0] || sampleRate;

    const chorusEn = Boolean(p.fxChorusEnabled && (p.fxChorusMix ?? 0) > 0.01);
    i32[416 >> 2] = chorusEn ? 1 : 0;
    f32[420 >> 2] = Math.max(0.05, Math.min(10, p.fxChorusRate ?? 1.5));
    f32[424 >> 2] = Math.max(0, Math.min(1, p.fxChorusDepth ?? 0.4));
    f32[428 >> 2] = Math.max(0, Math.min(1, p.fxChorusMix ?? 0.3));

    const delayEn = Boolean(p.fxDelayEnabled && (p.fxDelayMix ?? 0) > 0.01);
    const delaySec = resolveDelayTimeSeconds(p.fxDelayTime ?? '8n', this.bpm);
    i32[448 >> 2] = delayEn ? 1 : 0;
    f32[452 >> 2] = Math.max(64, Math.min(131000, delaySec * sr));
    f32[456 >> 2] = Math.max(0, Math.min(0.75, p.fxDelayFeedback ?? 0.25));
    f32[460 >> 2] = Math.max(0, Math.min(0.55, p.fxDelayMix ?? 0.2));
    f32[464 >> 2] = 0.28;

    const revEn = Boolean(p.fxRevEnabled && (p.fxRevMix ?? 0) > 0.01);
    const roomNorm = Math.max(0.1, Math.min(0.9, (p.fxRevDecay ?? 1.8) / 4));
    const revRoom = 0.70 + roomNorm * 0.255;
    const revDamp1 = 0.40;
    i32[480 >> 2] = revEn ? 1 : 0;
    f32[484 >> 2] = revRoom;
    f32[488 >> 2] = revDamp1;
    f32[492 >> 2] = 1.0 - revDamp1;
    f32[496 >> 2] = Math.max(0, Math.min(0.55, p.fxRevMix ?? 0.15));

    if (chorusEn || delayEn || revEn) {
      i32[44 >> 2] = 0;
      i32[500 >> 2] = 0;
    }
  }

  waveToCode(w) {
    switch (w) {
      case 'sine': return 0;
      case 'saw':
      case 'sawtooth': return 1;
      case 'pulse':
      case 'square': return 2;
      case 'tri':
      case 'triangle': return 3;
      default: return 0;
    }
  }

  filterToCode(t) {
    switch (t) {
      case 'lowpass': return 0;
      case 'bandpass': return 1;
      case 'highpass': return 2;
      case 'notch': return 3;
      default: return 0;
    }
  }

  driveToCode(d) {
    switch (d) {
      case 'tube': return 0;
      case 'tape': return 1;
      case 'fuzz': return 2;
      case 'warm': return 3;
      default: return 0;
    }
  }

  lfoWaveToCode(w) {
    switch (w) {
      case 'sine': return 0;
      case 'sawtooth': return 1;
      case 'square': return 2;
      case 'triangle': return 3;
      case 'random': return 4;
      default: return 0;
    }
  }

  lfoTargetToCode(t) {
    switch (t) {
      case 'cutoff': return 0;
      case 'pitch': return 1;
      case 'amp': return 2;
      default: return 0;
    }
  }

  updateParamCodes() {
    this.osc1WaveCode = this.waveToCode(this.params.osc1Wave);
    this.osc2WaveCode = this.waveToCode(this.params.osc2Wave);
    this.subWaveCode = this.waveToCode(this.params.subWave);
    this.filterTypeCode = this.filterToCode(this.params.filterType);
    this.driveTypeCode = this.driveToCode(this.params.filterDriveType);
    this.noiseTypeCode = this.params.noiseType === 'pink' ? 1 : 0;
    this.lfoWaveCode = this.lfoWaveToCode(this.params.lfoWave);
    this.lfoTargetCode = this.lfoTargetToCode(this.params.lfoTarget);
  }

  updateEqCoefficients() {
    if (!this.params.eqEnabled) {
      this.eqAllBypassed = true;
      return;
    }

    const sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
    const bands = [
      { type: 'lowshelf', f0: 100, Q: 1.0, gainDb: this.params.eqLow ?? 0 },
      { type: 'peaking', f0: 500, Q: 1.0, gainDb: this.params.eqLowMid ?? 0 },
      { type: 'peaking', f0: 2800, Q: 1.0, gainDb: this.params.eqHighMid ?? 0 },
      { type: 'highshelf', f0: 10000, Q: 1.0, gainDb: this.params.eqHigh ?? 0 }
    ];

    let anyActive = false;
    for (let i = 0; i < 4; i++) {
      const b = bands[i];
      if (Math.abs(b.gainDb) < 0.05) {
        this.eqB0[i] = 1;
        this.eqB1[i] = 0;
        this.eqB2[i] = 0;
        this.eqA1[i] = 0;
        this.eqA2[i] = 0;
        this.eqBypass[i] = true;
      } else {
        anyActive = true;
        this.eqBypass[i] = false;
        const A = Math.pow(10, b.gainDb / 40);
        const w0 = (2 * Math.PI * Math.max(10, Math.min(sr * 0.49, b.f0))) / sr;
        const cosW = Math.cos(w0);
        const sinW = Math.sin(w0);

        let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

        if (b.type === 'peaking') {
          const alpha = sinW / (2 * b.Q);
          b0 = 1 + alpha * A;
          b1 = -2 * cosW;
          b2 = 1 - alpha * A;
          a0 = 1 + alpha / A;
          a1 = -2 * cosW;
          a2 = 1 - alpha / A;
        } else if (b.type === 'lowshelf') {
          const alpha = (sinW / 2) * Math.SQRT2;
          const aPlus1 = A + 1;
          const aMinus1 = A - 1;
          const twoSqrtAlpha = 2 * Math.sqrt(A) * alpha;

          b0 = A * (aPlus1 - aMinus1 * cosW + twoSqrtAlpha);
          b1 = 2 * A * (aMinus1 - aPlus1 * cosW);
          b2 = A * (aPlus1 - aMinus1 * cosW - twoSqrtAlpha);
          a0 = aPlus1 + aMinus1 * cosW + twoSqrtAlpha;
          a1 = -2 * (aMinus1 + aPlus1 * cosW);
          a2 = aPlus1 + aMinus1 * cosW - twoSqrtAlpha;
        } else if (b.type === 'highshelf') {
          const alpha = (sinW / 2) * Math.SQRT2;
          const aPlus1 = A + 1;
          const aMinus1 = A - 1;
          const twoSqrtAlpha = 2 * Math.sqrt(A) * alpha;

          b0 = A * (aPlus1 + aMinus1 * cosW + twoSqrtAlpha);
          b1 = -2 * A * (aMinus1 + aPlus1 * cosW);
          b2 = A * (aPlus1 + aMinus1 * cosW - twoSqrtAlpha);
          a0 = aPlus1 - aMinus1 * cosW + twoSqrtAlpha;
          a1 = 2 * (aMinus1 - aPlus1 * cosW);
          a2 = aPlus1 - aMinus1 * cosW - twoSqrtAlpha;
        }

        const invA0 = 1.0 / a0;
        this.eqB0[i] = b0 * invA0;
        this.eqB1[i] = b1 * invA0;
        this.eqB2[i] = b2 * invA0;
        this.eqA1[i] = a1 * invA0;
        this.eqA2[i] = a2 * invA0;
      }
    }
    this.eqAllBypassed = !anyActive;
  }

  noteOn(midi, velocity, durationSeconds, delaySamples) {
    let targetVoice = null;
    let voiceIndex = -1;
    for (let i = 0; i < this.maxVoices; i++) {
      if (!this.voices[i].active || this.voices[i].envStage === 'idle') {
        targetVoice = this.voices[i];
        voiceIndex = i;
        break;
      }
    }
    if (!targetVoice) {
      let oldestAge = Infinity;
      for (let i = 0; i < this.maxVoices; i++) {
        if (this.voices[i].age < oldestAge) {
          oldestAge = this.voices[i].age;
          targetVoice = this.voices[i];
          voiceIndex = i;
        }
      }
    }
    if (!targetVoice) return;

    const wasIdle = !targetVoice.active || targetVoice.envStage === 'idle';
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const startDelay = delaySamples && delaySamples > 0 ? Math.floor(delaySamples) : 0;
    const targetStart = this.currentSample + startDelay;

    targetVoice.active = true;
    targetVoice.midi = midi;
    targetVoice.targetFrequency = freq;
    if (this.params.glide <= 0.001 || wasIdle || !targetVoice.frequency) {
      targetVoice.frequency = freq;
    }
    targetVoice.velocity = Math.max(0.05, Math.min(1.0, velocity));
    targetVoice.startSample = targetStart;
    targetVoice.age = ++this.ageCounter;

    // Deterministic phase dispersion for oscillators; keep Sub locked at 0
    targetVoice.phase1 = (this.ageCounter * 0.61803398875) % 1.0;
    targetVoice.phase2 = ((this.ageCounter * 0.38196601125) + 0.37) % 1.0;
    targetVoice.phaseSub = 0;

    if (wasIdle) {
      targetVoice.envLevel = 0;
      targetVoice.fEnvLevel = 0;
      targetVoice.ic1eq = 0;
      targetVoice.ic2eq = 0;
      targetVoice.ic3eq = 0;
      targetVoice.ic4eq = 0;
    }
    targetVoice.b0 = 0;
    targetVoice.b1 = 0;
    targetVoice.b2 = 0;

    if (startDelay > 0) {
      targetVoice.envStage = 'pending';
      targetVoice.fEnvStage = 'pending';
    } else {
      targetVoice.envStage = 'attack';
      targetVoice.fEnvStage = 'attack';
    }
    targetVoice.fDirty = true;

    const voicePan = midi < 50 ? 0.0 : ((voiceIndex & 1) === 0 ? -0.11 : 0.11);
    const panAng = (voicePan + 1.0) * 0.7853981633974483;
    targetVoice.panL = Math.cos(panAng) * 1.4142135623730951;
    targetVoice.panR = Math.sin(panAng) * 1.4142135623730951;

    targetVoice.targetReleaseSample =
      durationSeconds && durationSeconds > 0
        ? targetStart + Math.floor(durationSeconds * sampleRate)
        : -1;
  }

  noteOff(midi, delaySamples) {
    const releaseSample = delaySamples && delaySamples > 0 ? this.currentSample + Math.floor(delaySamples) : this.currentSample;
    for (let i = 0; i < this.maxVoices; i++) {
      const v = this.voices[i];
      if (v.active && v.midi === midi && v.envStage !== 'release' && v.envStage !== 'idle') {
        if (delaySamples && delaySamples > 0) {
          v.targetReleaseSample = releaseSample;
        } else {
          v.envStage = 'release';
          v.fEnvStage = 'release';
          v.targetReleaseSample = -1;
        }
      }
    }
  }

  allNotesOff(delaySamples) {
    const releaseSample = delaySamples && delaySamples > 0 ? this.currentSample + Math.floor(delaySamples) : this.currentSample;
    for (let i = 0; i < this.maxVoices; i++) {
      const v = this.voices[i];
      if (v.active && v.envStage !== 'idle' && v.envStage !== 'release') {
        if (delaySamples && delaySamples > 0) {
          v.targetReleaseSample = releaseSample;
        } else {
          v.envStage = 'release';
          v.fEnvStage = 'release';
          v.targetReleaseSample = -1;
        }
      }
    }
  }

  sampleOsc(waveCode, phase, dt) {
    switch (waveCode) {
      case 0: // sine
        return Math.sin(phase * 6.283185307179586);
      case 1: { // sawtooth
        const raw = 2.0 * phase - 1.0;
        return raw - polyBlep(phase, dt);
      }
      case 2: { // square
        const raw = phase < 0.5 ? 1.0 : -1.0;
        return raw + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1.0, dt);
      }
      case 3: // clean piecewise triangle
        return phase < 0.5 ? (4.0 * phase - 1.0) : (3.0 - 4.0 * phase);
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

    if (this.wasmReady && this.wasmExports) {
      const active = this.wasmExports.processBlock(blockSize);
      if (active) {
        if (blockSize === 128) {
          outL.set(this.wasmOutL);
          if (outR !== outL) outR.set(this.wasmOutR);
        } else {
          outL.set(this.wasmOutL.subarray(0, blockSize));
          if (outR !== outL) outR.set(this.wasmOutR.subarray(0, blockSize));
        }
      } else {
        outL.fill(0);
        if (outR !== outL) outR.fill(0);
      }
      return true;
    }

    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    const sr = sampleRate;
    const dtBase = 1.0 / sr;

    const TIME_FACTOR = -6.907755;
    const attackStep = dtBase / Math.max(0.003, this.params.attack);
    const decayFactor = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.005, this.params.decay));
    const releaseFactor = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.005, this.params.release));
    const sustainLevel = Math.max(0, Math.min(1, this.params.sustain));

    const fAttackStep = dtBase / Math.max(0.003, this.params.filterEnvAttack ?? 0.02);
    const fDecayFactor = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.005, this.params.filterEnvDecay ?? 0.35));
    const fReleaseFactor = Math.exp((TIME_FACTOR * dtBase) / Math.max(0.005, this.params.filterEnvRelease ?? 0.6));
    const fSustainLevel = Math.max(0, Math.min(1, this.params.filterEnvSustain ?? 0.3));

    const glideFactor = this.params.glide > 0.001 ? Math.exp(-dtBase / Math.max(0.005, this.params.glide)) : 0;

    const osc1PitchFactor = Math.pow(2, (this.params.osc1Octave * 12 + this.params.osc1Semi + this.params.osc1Detune / 100) / 12);
    const osc2PitchFactor = this.params.osc2Enabled ? Math.pow(2, (this.params.osc2Octave * 12 + this.params.osc2Semi + this.params.osc2Detune / 100) / 12) : 1;
    const subPitchFactor = this.params.subEnabled ? Math.pow(2, (this.params.subOctave * 12) / 12) : 0.5;

    let activeCount = 0;
    const voices = this.voices;
    const activeIndices = this.activeVoiceIndices;
    for (let v = 0; v < this.maxVoices; v++) {
      if (voices[v].active && voices[v].envStage !== 'idle') {
        activeIndices[activeCount++] = v;
      }
    }
    if (activeCount === 0) {
      this.currentSample += blockSize;
      return true;
    }

    const filterEnabled = this.params.filterEnabled;
    const filterFreq = this.params.filterFreq;
    const filterTypeCode = this.filterTypeCode;
    const qClamped = Math.max(0.5, Math.min(10.0, this.params.filterQ));
    const k = 1.0 / qClamped;
    const isFourPole = (this.params.filterRolloff ?? -12) <= -24;
    const k2 = Math.max(0.707, k * 1.45);
    const filterEnvAmount = Math.max(-1, Math.min(1, this.params.filterEnvAmount ?? 0));
    const filterKeyTracking = Math.max(0, Math.min(1, this.params.filterKeyTracking ?? 0));

    const pan = Math.max(-1, Math.min(1, this.params.pan));
    const gainL = this.params.gain * (pan <= 0 ? 1 : 1 - pan);
    const gainR = this.params.gain * (pan >= 0 ? 1 : 1 + pan);

    const isLfoActive = Boolean(this.params.lfoEnabled && (this.params.lfoDepth ?? 0) > 0.001);
    const lfoRate = Math.max(0.05, Math.min(30, this.params.lfoRate ?? 2.5));
    const lfoDepth = Math.max(0, Math.min(1, this.params.lfoDepth ?? 0.25));
    const lfoTargetCode = this.lfoTargetCode;
    const lfoWaveCode = this.lfoWaveCode;
    const lfoStep = lfoRate * dtBase;

    const osc1Vol = this.params.osc1Vol;
    const osc1WaveCode = this.osc1WaveCode;
    const osc2Enabled = this.params.osc2Enabled && this.params.osc2Vol > 0.0001;
    const osc2Vol = this.params.osc2Vol;
    const osc2WaveCode = this.osc2WaveCode;
    const subEnabled = this.params.subEnabled && this.params.subVol > 0.0001;
    const subVol = this.params.subVol;
    const subWaveCode = this.subWaveCode;
    const noiseEnabled = this.params.noiseEnabled && this.params.noiseVol > 0.0001;
    const noiseVol = this.params.noiseVol;
    const isPinkNoise = this.noiseTypeCode === 1;

    const activeOscSum = osc1Vol
      + (osc2Enabled ? osc2Vol : 0)
      + (subEnabled ? subVol * 0.7 : 0)
      + (noiseEnabled ? noiseVol * 0.35 : 0);
    const oscNorm = activeOscSum > 1.0 ? (1.0 / Math.pow(activeOscSum, 0.7)) : 1.0;

    const filterDrive = this.params.filterDrive;
    const filterDriveActive = filterDrive > 0.005;
    const driveTypeCode = this.driveTypeCode;
    const drivePreGain = 1.0 + filterDrive * 2.4;
    const drivePostComp = 1.0 / (1.0 + filterDrive * 0.42);
    const dryBassAnchor = 0.25 * (1.0 - filterDrive * 0.35);
    const wetSatMix = 1.0 - dryBassAnchor;

    const eqEnabled = this.params.eqEnabled && !this.eqAllBypassed;
    const eqBypass = this.eqBypass;
    const eqB0 = this.eqB0, eqB1 = this.eqB1, eqB2 = this.eqB2;
    const eqA1 = this.eqA1, eqA2 = this.eqA2;
    const eqL1 = this.eqL1, eqL2 = this.eqL2;
    const eqR1 = this.eqR1, eqR2 = this.eqR2;

    for (let s = 0; s < blockSize; s++) {
      this.currentSample++;
      let sampleSumL = 0;
      let sampleSumR = 0;

      let lfoVal = 0;
      if (isLfoActive) {
        const prevPhase = this.lfoPhase;
        this.lfoPhase = (this.lfoPhase + lfoStep) % 1.0;
        if (this.lfoPhase < prevPhase) {
          this.lfoRandVal = Math.random() * 2.0 - 1.0;
        }

        switch (lfoWaveCode) {
          case 3: // triangle
            lfoVal = 2.0 * Math.abs(2.0 * this.lfoPhase - 1.0) - 1.0;
            break;
          case 1: // sawtooth
            lfoVal = 1.0 - 2.0 * this.lfoPhase;
            break;
          case 2: // square
            lfoVal = this.lfoPhase < 0.5 ? 1.0 : -1.0;
            break;
          case 4: // random
            lfoVal = this.lfoRandVal;
            break;
          case 0: // sine
          default:
            lfoVal = Math.sin(this.lfoPhase * 6.283185307179586);
            break;
        }
      }

      const lfoPitchMult = (isLfoActive && lfoTargetCode === 1)
        ? (1.0 + lfoVal * lfoDepth * 0.086)
        : 1.0;
      const lfoOct = (isLfoActive && lfoTargetCode === 0) ? (lfoVal * lfoDepth * 2.5) : 0;

      for (let i = 0; i < activeCount; i++) {
        const voice = voices[activeIndices[i]];
        if (!voice.active || voice.envStage === 'idle') continue;

        if (voice.envStage === 'pending') {
          if (this.currentSample >= voice.startSample) {
            voice.envStage = 'attack';
            voice.fEnvStage = 'attack';
            voice.fDirty = true;
          } else {
            continue;
          }
        }

        if (voice.targetReleaseSample > 0 && this.currentSample >= voice.targetReleaseSample) {
          voice.envStage = 'release';
          voice.fEnvStage = 'release';
          voice.targetReleaseSample = -1;
        }

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
            if (sustainLevel <= 0.001 && voice.envLevel < 0.0005) {
              voice.envLevel = 0;
              voice.envStage = 'idle';
              voice.fEnvStage = 'idle';
              voice.fEnvLevel = 0;
              voice.active = false;
              voice.ic1eq = 0;
              voice.ic2eq = 0;
              voice.ic3eq = 0;
              voice.ic4eq = 0;
              continue;
            }
            break;
          case 'sustain':
            voice.envLevel = sustainLevel;
            break;
          case 'release':
            voice.envLevel *= releaseFactor;
            if (voice.envLevel < 0.0005) {
              voice.envLevel = 0;
              voice.envStage = 'idle';
              voice.fEnvStage = 'idle';
              voice.fEnvLevel = 0;
              voice.active = false;
              voice.ic1eq = 0;
              voice.ic2eq = 0;
              voice.ic3eq = 0;
              voice.ic4eq = 0;
              continue;
            }
            break;
        }

        switch (voice.fEnvStage) {
          case 'attack':
            voice.fEnvLevel += fAttackStep;
            if (voice.fEnvLevel >= 1.0) {
              voice.fEnvLevel = 1.0;
              voice.fEnvStage = 'decay';
            }
            break;
          case 'decay':
            voice.fEnvLevel = fSustainLevel + (voice.fEnvLevel - fSustainLevel) * fDecayFactor;
            if (Math.abs(voice.fEnvLevel - fSustainLevel) < 0.0002) {
              voice.fEnvLevel = fSustainLevel;
              voice.fEnvStage = 'sustain';
            }
            break;
          case 'sustain':
            voice.fEnvLevel = fSustainLevel;
            break;
          case 'release':
            voice.fEnvLevel *= fReleaseFactor;
            if (voice.fEnvLevel < 0.0005) {
              voice.fEnvLevel = 0;
              voice.fEnvStage = 'idle';
            }
            break;
        }

        if (glideFactor > 0) {
          voice.frequency = voice.targetFrequency + (voice.frequency - voice.targetFrequency) * glideFactor;
        } else {
          voice.frequency = voice.targetFrequency;
        }

        const dt1 = voice.frequency * osc1PitchFactor * lfoPitchMult * dtBase;
        voice.phase1 = (voice.phase1 + dt1) % 1.0;
        let voiceSample = this.sampleOsc(osc1WaveCode, voice.phase1, dt1) * osc1Vol;

        if (osc2Enabled) {
          const dt2 = voice.frequency * osc2PitchFactor * lfoPitchMult * dtBase;
          voice.phase2 = (voice.phase2 + dt2) % 1.0;
          voiceSample += this.sampleOsc(osc2WaveCode, voice.phase2, dt2) * osc2Vol;
        }

        if (subEnabled) {
          const dtSub = voice.frequency * subPitchFactor * lfoPitchMult * dtBase;
          voice.phaseSub = (voice.phaseSub + dtSub) % 1.0;
          voiceSample += this.sampleOsc(subWaveCode, voice.phaseSub, dtSub) * subVol;
        }

        if (noiseEnabled) {
          const white = Math.random() * 2.0 - 1.0;
          if (isPinkNoise) {
            voice.b0 = 0.99765 * voice.b0 + white * 0.0990460;
            voice.b1 = 0.96300 * voice.b1 + white * 0.2965164;
            voice.b2 = 0.57000 * voice.b2 + white * 1.0526913;
            const pink = voice.b0 + voice.b1 + voice.b2 + white * 0.1848;
            voiceSample += pink * 0.18 * noiseVol;
          } else {
            voiceSample += white * noiseVol;
          }
        }

        voiceSample *= oscNorm;

        if (filterEnabled) {
          if (voice.fDirty || (s & 3) === 0) {
            const keyOct = filterKeyTracking > 0.001 ? ((voice.midi - 60) / 12) * filterKeyTracking : 0;
            const envOct = Math.abs(filterEnvAmount) > 0.001 ? voice.fEnvLevel * filterEnvAmount * 3.5 : 0;
            const velOct = (voice.velocity - 0.75) * 0.9;
            const effCutoff = Math.max(25, Math.min(sr * 0.43, filterFreq * Math.pow(2.0, lfoOct + keyOct + envOct + velOct)));
            const g = Math.tan((Math.PI * effCutoff) / sr);
            const a1 = 1.0 / (1.0 + g * (g + k));
            voice.a1 = a1;
            voice.a2 = g * a1;
            voice.a3 = g * voice.a2;
            if (isFourPole) {
              const a1_2 = 1.0 / (1.0 + g * (g + k2));
              voice.a1_2 = a1_2;
              voice.a2_2 = g * a1_2;
              voice.a3_2 = g * voice.a2_2;
            }
            voice.fDirty = false;
          }

          const v0 = voiceSample;
          const v1Raw = voice.a1 * voice.ic1eq + voice.a2 * (v0 - voice.ic2eq);
          const v1 = v1Raw / (1.0 + 0.14 * Math.abs(v1Raw));
          const v2 = voice.ic2eq + voice.a2 * voice.ic1eq + voice.a3 * (v0 - voice.ic2eq);
          voice.ic1eq = 2.0 * v1 - voice.ic1eq;
          voice.ic2eq = 2.0 * v2 - voice.ic2eq;
          switch (filterTypeCode) {
            case 0: voiceSample = v2; break;
            case 1: voiceSample = v1; break;
            case 2: voiceSample = v0 - k * v1 - v2; break;
            case 3: voiceSample = v0 - k * v1; break;
          }

          if (isFourPole) {
            const u0 = voiceSample;
            const u1Raw = voice.a1_2 * voice.ic3eq + voice.a2_2 * (u0 - voice.ic4eq);
            const u1 = u1Raw / (1.0 + 0.14 * Math.abs(u1Raw));
            const u2 = voice.ic4eq + voice.a2_2 * voice.ic3eq + voice.a3_2 * (u0 - voice.ic4eq);
            voice.ic3eq = 2.0 * u1 - voice.ic3eq;
            voice.ic4eq = 2.0 * u2 - voice.ic4eq;
            switch (filterTypeCode) {
              case 0: voiceSample = u2; break;
              case 1: voiceSample = u1; break;
              case 2: voiceSample = u0 - k2 * u1 - u2; break;
              case 3: voiceSample = u0 - k2 * u1; break;
            }
          }
        }

        // Etapa de Overdrive Analógico con Compensación de Ganancia
        if (filterDriveActive) {
          const sVal = voiceSample * drivePreGain;
          let sat = sVal;

          switch (driveTypeCode) {
            case 0: // tube
              if (sVal >= 0) {
                sat = sVal / (1.0 + 0.45 * sVal);
              } else {
                const neg = -sVal;
                sat = -neg / (1.0 + 0.7 * neg);
              }
              break;
            case 1: { // tape
              const s2 = sVal * sVal;
              sat = (sVal * (27.0 + s2)) / (27.0 + 9.0 * s2);
              break;
            }
            case 2: // fuzz
              sat = Math.tanh(sVal * 1.35);
              break;
            case 3: // warm
              sat = Math.tanh(sVal * 0.85) * 1.15;
              break;
          }

          voiceSample = (sat * wetSatMix + voiceSample * dryBassAnchor) * drivePostComp;
        }

        const velGain = Math.pow(Math.max(0.05, Math.min(1.0, voice.velocity)), 1.35);
        const amp = voiceSample * voice.envLevel * velGain * 0.56;
        sampleSumL += amp * voice.panL;
        sampleSumR += amp * voice.panR;
      }

      const lfoAmpGain = (isLfoActive && lfoTargetCode === 2)
        ? Math.max(0, 1.0 - lfoDepth * 0.5 * (1.0 - lfoVal))
        : 1.0;

      let finalL = sampleSumL * gainL * lfoAmpGain;
      let finalR = sampleSumR * gainR * lfoAmpGain;

      // Ecualizador Gráfico Paramétrico de 4 Bandas
      if (eqEnabled) {
        for (let b = 0; b < 4; b++) {
          if (eqBypass[b]) continue;
          const b0 = eqB0[b], b1 = eqB1[b], b2 = eqB2[b];
          const a1 = eqA1[b], a2 = eqA2[b];

          const yL = b0 * finalL + eqL1[b];
          eqL1[b] = b1 * finalL - a1 * yL + eqL2[b];
          eqL2[b] = b2 * finalL - a2 * yL;
          finalL = yL;

          const yR = b0 * finalR + eqR1[b];
          eqR1[b] = b1 * finalR - a1 * yR + eqR2[b];
          eqR2[b] = b2 * finalR - a2 * yR;
          finalR = yR;
        }
      }

      // Filtro DC Blocker de 1 polo (R = 0.9975)
      const dcR = 0.9975;
      const dcL = finalL - this.dcPrevInL + dcR * this.dcPrevOutL;
      this.dcPrevInL = finalL;
      this.dcPrevOutL = dcL;
      finalL = dcL;

      const dcRight = finalR - this.dcPrevInR + dcR * this.dcPrevOutR;
      this.dcPrevInR = finalR;
      this.dcPrevOutR = dcRight;
      finalR = dcRight;

      // Limitador suave transparente (ceiling ±0.98)
      const absL = finalL < 0 ? -finalL : finalL;
      if (absL > 0.80) {
        finalL = (finalL < 0 ? -1 : 1) * (0.80 + 0.18 * Math.tanh((absL - 0.80) / 0.18));
      }
      const absR = finalR < 0 ? -finalR : finalR;
      if (absR > 0.80) {
        finalR = (finalR < 0 ? -1 : 1) * (0.80 + 0.18 * Math.tanh((absR - 0.80) / 0.18));
      }

      outL[s] = finalL;
      if (outR !== outL) {
        outR[s] = finalR;
      }
    }
    return true;
  }
}

try {
  registerProcessor('phosphor-synth-processor', PhosphorWorkletProcessor);
} catch (_) {}