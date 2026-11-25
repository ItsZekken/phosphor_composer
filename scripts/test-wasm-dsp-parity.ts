/**
 * scripts/test-wasm-dsp-parity.ts
 * Verifica validez del binario WASM, exactitud matemática y paridad RMS/Pico frente al kernel JS,
 * paneo estéreo, filtro -12/-24 dB/oct, EQ paramétrico y cola + auto-sleep de Chorus/Delay/Reverb.
 */

import assert from 'node:assert/strict';
import { PHOSPHOR_DSP_WASM_BYTES } from '../src/core/audio/wasm/phosphorDspWasmBytes';
import { PhosphorWasmEngine, resolveDelayTimeSeconds } from '../src/core/audio/wasm/PhosphorWasmDSP';
import { PhosphorDSPKernel } from '../src/core/audio/engine/PhosphorDSPKernel';
import { DEFAULT_SYNTH_SETTINGS, SYNTH_PRESETS } from '../src/core/audio/engine/synthPresets';
import type { SynthSettings } from '../src/utils/typeDefinitions';

function measureStereo(bufL: Float32Array, bufR: Float32Array) {
  let sumSq = 0;
  let peak = 0;
  let diffSq = 0;
  for (let i = 0; i < bufL.length; i++) {
    const l = bufL[i];
    const r = bufR[i];
    assert.ok(Number.isFinite(l) && Number.isFinite(r), `Muestra no finita en índice ${i}`);
    const al = Math.abs(l);
    const ar = Math.abs(r);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    sumSq += 0.5 * (l * l + r * r);
    const d = l - r;
    diffSq += d * d;
  }
  const rms = Math.sqrt(sumSq / bufL.length);
  const stereoDiffRms = Math.sqrt(diffSq / bufL.length);
  return { rms, peak, stereoDiffRms };
}

function renderKernel(kernel: PhosphorDSPKernel, sr: number, totalSec: number, notes: Array<{ midi: number; vel: number; start: number; dur: number }>) {
  const blockSize = 128;
  const totalSamples = Math.ceil(totalSec * sr);
  const outL = new Float32Array(totalSamples);
  const outR = new Float32Array(totalSamples);
  const bL = new Float32Array(blockSize);
  const bR = new Float32Array(blockSize);

  const sorted = [...notes].sort((a, b) => a.start - b.start);
  let idx = 0;
  let activeBlocks = 0;

  for (let offset = 0; offset < totalSamples; offset += blockSize) {
    const blockEndTime = (offset + blockSize) / sr;
    while (idx < sorted.length && sorted[idx].start < blockEndTime) {
      const n = sorted[idx++];
      const delay = Math.max(0, Math.round(n.start * sr) - offset);
      kernel.noteOn(n.midi, n.vel, n.dur, delay);
    }
    const active = kernel.process(bL, bR, blockSize);
    if (active) activeBlocks++;
    const count = Math.min(blockSize, totalSamples - offset);
    outL.set(bL.subarray(0, count), offset);
    outR.set(bR.subarray(0, count), offset);
  }
  return { outL, outR, activeBlocks };
}

async function runTests() {
  console.log('🧪 Verificando Phosphor WASM DSP Engine...');

  // 1. Validar binario WebAssembly y helper resolveDelayTimeSeconds
  assert.equal(WebAssembly.validate(PHOSPHOR_DSP_WASM_BYTES), true, 'PHOSPHOR_DSP_WASM_BYTES debe pasar WebAssembly.validate');
  assert.ok(Math.abs(resolveDelayTimeSeconds('8n', 120) - 0.25) < 1e-6);
  assert.ok(Math.abs(resolveDelayTimeSeconds('4n.', 120) - 0.75) < 1e-6);

  const sr = 48000;
  const chordNotes = [
    { midi: 60, vel: 0.85, start: 0.01, dur: 0.45 },
    { midi: 64, vel: 0.82, start: 0.01, dur: 0.45 },
    { midi: 67, vel: 0.80, start: 0.01, dur: 0.45 },
    { midi: 71, vel: 0.78, start: 0.01, dur: 0.45 }
  ];

  // 2. Paridad WASM vs JS fallback en seco sobre presets representativos
  const presetIds = ['warm_pad', 'moog_bass', 'cyber_lead', 'neo_soul_ep', 'supersaw_titan', 'crystal_pluck'];
  for (const id of presetIds) {
    const preset = SYNTH_PRESETS.find((p) => p.id === id);
    const settings: SynthSettings = preset ? preset.settings : DEFAULT_SYNTH_SETTINGS;
    const wasmKernel = new PhosphorDSPKernel(sr, { useWasm: true, includeFx: false });
    const jsKernel = new PhosphorDSPKernel(sr, { useWasm: false, includeFx: false });
    wasmKernel.setSettings(settings);
    jsKernel.setSettings(settings);

    const wRes = renderKernel(wasmKernel, sr, 1.2, chordNotes);
    const jRes = renderKernel(jsKernel, sr, 1.2, chordNotes);
    const wStats = measureStereo(wRes.outL, wRes.outR);
    const jStats = measureStereo(jRes.outL, jRes.outR);

    const rmsDiffDb = Math.abs(20 * Math.log10((wStats.rms + 1e-9) / (jStats.rms + 1e-9)));
    const peakDiff = Math.abs(wStats.peak - jStats.peak);
    console.log(`   Preset "${id}": WASM RMS=${wStats.rms.toFixed(4)} vs JS=${jStats.rms.toFixed(4)} (diff ${rmsDiffDb.toFixed(2)} dB), Peak=${wStats.peak.toFixed(4)} vs ${jStats.peak.toFixed(4)}`);
    assert.ok(wStats.peak <= 0.99, `Preset ${id} excede ceiling: ${wStats.peak}`);
    assert.ok(rmsDiffDb < 0.75, `Divergencia RMS > 0.75 dB en ${id}: ${rmsDiffDb.toFixed(2)} dB`);
    assert.ok(peakDiff < 0.12, `Divergencia pico excesiva en ${id}: ${peakDiff.toFixed(4)}`);
  }

  // 3. Probar todas las ondas, filtros (-12/-24), drives y EQ sin NaN/Inf
  const waves = ['sine', 'sawtooth', 'square', 'triangle'] as const;
  const fTypes = ['lowpass', 'bandpass', 'highpass', 'notch'] as const;
  const dTypes = ['tube', 'tape', 'fuzz', 'warm'] as const;

  for (let i = 0; i < 4; i++) {
    const k = new PhosphorDSPKernel(sr, { useWasm: true, includeFx: false });
    k.setSettings({
      ...DEFAULT_SYNTH_SETTINGS,
      osc1: { ...DEFAULT_SYNTH_SETTINGS.osc1, waveType: waves[i] },
      subOsc: { enabled: true, waveType: waves[i === 1 ? 2 : i] as any, octave: -1, volume: 0.45 },
      noise: { enabled: true, type: i % 2 === 0 ? 'white' : 'pink', volume: 0.2 },
      filter: {
        ...DEFAULT_SYNTH_SETTINGS.filter,
        type: fTypes[i],
        rolloff: i % 2 === 0 ? -12 : -24,
        frequency: 1400,
        Q: 2.2,
        drive: 0.45,
        driveType: dTypes[i],
        envAmount: 0.4,
        keyTracking: 0.6
      },
      lfo: { enabled: true, waveType: 'triangle', rate: 3.5, depth: 0.3, target: i === 1 ? 'pitch' : 'cutoff' },
      eq: { enabled: true, low: 3, lowMid: -2, highMid: 2.5, high: -1 }
    });
    const res = renderKernel(k, sr, 0.8, chordNotes);
    const st = measureStereo(res.outL, res.outR);
    assert.ok(st.rms > 0.005 && st.peak <= 0.99);
    assert.ok(st.stereoDiffRms > 0.0005, 'Debe conservar separación estéreo L/R en acordes >= MIDI 50');
  }

  // 4. Comparativa filtro -12 vs -24 sobre sawtooth grave con cutoff bajo
  const saw12 = new PhosphorDSPKernel(sr, { useWasm: true, includeFx: false });
  const saw24 = new PhosphorDSPKernel(sr, { useWasm: true, includeFx: false });
  const filterTestBase: SynthSettings = {
    ...DEFAULT_SYNTH_SETTINGS,
    osc1: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: 0, volume: 0.9 },
    osc2: { enabled: false, waveType: 'sawtooth', octave: 0, semi: 0, detune: 0, volume: 0 },
    filter: { enabled: true, type: 'lowpass', frequency: 420, Q: 1.0, rolloff: -12, drive: 0, driveType: 'tube', envAmount: 0, keyTracking: 0 }
  };
  saw12.setSettings(filterTestBase);
  saw24.setSettings({ ...filterTestBase, filter: { ...filterTestBase.filter, rolloff: -24 } });
  const r12 = measureStereo(...(() => { const x = renderKernel(saw12, sr, 0.5, [{ midi: 57, vel: 0.9, start: 0, dur: 0.4 }]); return [x.outL, x.outR] as const; })());
  const r24 = measureStereo(...(() => { const x = renderKernel(saw24, sr, 0.5, [{ midi: 57, vel: 0.9, start: 0, dur: 0.4 }]); return [x.outL, x.outR] as const; })());
  assert.ok(r24.rms < r12.rms, `Filtro -24 (${r24.rms.toFixed(4)}) debe atenuar armónicos más que -12 (${r12.rms.toFixed(4)})`);

  // 5. Verificar FX Integrado WASM (Chorus + Delay + Freeverb) + Cola + Auto-Sleep
  const wasmFx = new PhosphorWasmEngine(sr);
  wasmFx.setBpm(120);
  wasmFx.setSettings({
    ...DEFAULT_SYNTH_SETTINGS,
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.0, release: 0.08 },
    fx: {
      chorus: { enabled: true, rate: 1.5, depth: 0.5, mix: 0.4 },
      delay: { enabled: true, time: '8n', feedback: 0.35, mix: 0.35 },
      reverb: { enabled: true, decay: 1.6, mix: 0.3 }
    }
  }, true);
  wasmFx.noteOn(64, 0.9, 0.1, 0);

  const bL = new Float32Array(128);
  const bR = new Float32Array(128);
  let tailAtHalfSec = 0;
  let sleptAtBlock = -1;
  const totalTestBlocks = Math.ceil((3.5 * sr) / 128);
  for (let blk = 0; blk < totalTestBlocks; blk++) {
    const active = wasmFx.process(bL, bR, 128);
    if (blk === Math.round((0.5 * sr) / 128)) {
      tailAtHalfSec = measureStereo(bL, bR).rms;
    }
    if (!active) {
      sleptAtBlock = blk;
      break;
    }
  }
  assert.ok(tailAtHalfSec > 0.0005, `Debe haber cola audible de delay/reverb en t=0.5s (rms=${tailAtHalfSec})`);
  assert.ok(sleptAtBlock > 0 && sleptAtBlock < totalTestBlocks, `El motor FX debe auto-dormirse tras extinguirse la cola (block=${sleptAtBlock})`);

  console.log(`✅ Paridad WASM DSP verificada (${presetIds.length} presets + SVF -12/-24 + Stereo + FX Auto-Sleep en bloque ${sleptAtBlock}).`);
}

runTests().catch((err) => {
  console.error('❌ Fallo en test-wasm-dsp-parity:', err);
  process.exit(1);
});
