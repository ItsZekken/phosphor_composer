/**
 * audioBenchmark.ts
 * Suite de benchmarks objetivos y telemetría comparativa Tri-Engine:
 * 1. Tone.js Graph (Grafo de nodos nativos Web Audio)
 * 2. Pure TypeScript AudioWorklet DSP
 * 3. WebAssembly (WASM) DSP Kernel
 *
 * Mide tiempo de cómputo por bloque (µs), uso de CPU %, aceleración offline y throughput.
 */

import * as Tone from 'tone';
import { PhosphorAnalogSynth } from '../engine/PhosphorAnalogSynth';
import { normalizeSynthSettings } from '../engine/synthPresets';
import { getWasmDspInstance } from '../wasm/dspWasmKernel';

export interface EngineBenchmarkResult {
  engineName: 'Tone.js Graph' | 'TypeScript AudioWorklet' | 'WebAssembly (WASM)';
  voiceCount: number;
  durationSeconds: number;
  totalSamplesGenerated: number;
  renderTimeMs: number;
  blockDurationUs: number; // Microsegundos por bloque de 128 muestras
  speedupFactor: number;   // e.g. 100x más rápido que tiempo real
  cpuUsagePercent: number; // Porcentaje de CPU estimado para tiempo real
  throughputMSamplesSec: number; // Millones de muestras por segundo
  passed: boolean;
}

export interface ComparativeBenchmarkReport {
  timestamp: number;
  sampleRate: number;
  voiceCounts: number[];
  toneJsResults: EngineBenchmarkResult[];
  tsWorkletResults: EngineBenchmarkResult[];
  wasmMvpResults: EngineBenchmarkResult[];
  decisionVerdict: 'MANTENER_TYPESCRIPT' | 'COMPILAR_WASM_REQUERIDO';
  verdictScoreExplanation: string;
}

/**
 * 1. Benchmark del sintetizador actual basado en grafo Tone.js
 */
export async function benchmarkToneJs(voiceCount: number, durationSeconds = 2.0): Promise<EngineBenchmarkResult> {
  const sampleRate = 44100;
  const startPerf = performance.now();

  await Tone.Offline(async () => {
    const masterOut = new Tone.Gain(1.0).toDestination();
    const synths: PhosphorAnalogSynth[] = [];

    const settings = normalizeSynthSettings({
      waveType: 'sawtooth',
      osc1: { enabled: true, waveType: 'sawtooth', volume: 0.8, octave: 0, semi: 0, detune: 0 },
      osc2: { enabled: true, waveType: 'square', volume: 0.6, octave: 0, semi: 7, detune: 10 },
      filter: { enabled: true, type: 'lowpass', frequency: 2500, Q: 3.5, drive: 0.4, rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.4 }
    });

    const numSynths = Math.ceil(voiceCount / 6);
    for (let i = 0; i < numSynths; i++) {
      const synth = new PhosphorAnalogSynth(`bench_synth_${i}`, settings, masterOut);
      synths.push(synth);
    }

    const baseMidis = [48, 52, 55, 59, 62, 65, 69, 72];
    for (let v = 0; v < voiceCount; v++) {
      const synthIdx = v % numSynths;
      const midi = baseMidis[v % baseMidis.length] + Math.floor(v / baseMidis.length) * 12;
      const noteName = Tone.Frequency(midi, 'midi').toNote();
      const startTime = (v * 0.04) % (durationSeconds * 0.5);
      const noteDuration = Math.max(0.5, durationSeconds - startTime - 0.2);

      synths[synthIdx].triggerAttackRelease(noteName, noteDuration, startTime, 0.8);
    }
  }, durationSeconds);

  const endPerf = performance.now();
  const renderTimeMs = endPerf - startPerf;
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const totalBlocks = totalSamples / 128;
  const blockDurationUs = (renderTimeMs * 1000) / totalBlocks;
  const totalAudioDurationMs = durationSeconds * 1000;
  const speedupFactor = totalAudioDurationMs / Math.max(0.1, renderTimeMs);
  const cpuUsagePercent = (renderTimeMs / totalAudioDurationMs) * 100;
  const throughputMSamplesSec = (totalSamples * voiceCount) / (renderTimeMs * 1000);

  return {
    engineName: 'Tone.js Graph',
    voiceCount,
    durationSeconds,
    totalSamplesGenerated: totalSamples,
    renderTimeMs: Math.round(renderTimeMs * 100) / 100,
    blockDurationUs: Math.round(blockDurationUs * 10) / 10,
    speedupFactor: Math.round(speedupFactor * 10) / 10,
    cpuUsagePercent: Math.round(cpuUsagePercent * 100) / 100,
    throughputMSamplesSec: Math.round(throughputMSamplesSec * 100) / 100,
    passed: cpuUsagePercent < 30.0
  };
}

/**
 * 2. Benchmark del DSP en TypeScript Puro (AudioWorklet loop)
 */
export async function benchmarkTsWorklet(voiceCount: number, durationSeconds = 2.0): Promise<EngineBenchmarkResult> {
  const sampleRate = 44100;
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const blockSize = 128;
  const numBlocks = Math.floor(totalSamples / blockSize);

  const outBuffer = new Float32Array(blockSize);
  const dt = 1.0 / sampleRate;

  // PolyBLEP helper local
  const polyBlep = (t: number, dtVal: number): number => {
    if (t < dtVal) {
      const v = t / dtVal;
      return v + v - v * v - 1.0;
    } else if (t > 1.0 - dtVal) {
      const v = (t - 1.0) / dtVal;
      return v * v + v + v + 1.0;
    }
    return 0.0;
  };

  const startPerf = performance.now();

  // Estados de voces pre-asignadas
  const phases = new Float32Array(voiceCount);
  const freqs = new Float32Array(voiceCount);
  const ic1eq = new Float32Array(voiceCount);
  const ic2eq = new Float32Array(voiceCount);

  for (let v = 0; v < voiceCount; v++) {
    freqs[v] = 220 * Math.pow(2, (v % 24) / 12);
  }

  const g = Math.tan((Math.PI * 2500) / sampleRate);
  const k = 1.0 / 1.5;
  const a1 = 1.0 / (1.0 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;

  for (let b = 0; b < numBlocks; b++) {
    outBuffer.fill(0);

    for (let s = 0; s < blockSize; s++) {
      let sampleSum = 0;

      for (let v = 0; v < voiceCount; v++) {
        const dtVal = freqs[v] * dt;
        phases[v] = (phases[v] + dtVal) % 1.0;

        // Oscilador PolyBLEP Sawtooth
        const raw = 2.0 * phases[v] - 1.0;
        const osc = raw - polyBlep(phases[v], dtVal);

        // Filtro SVF 2-pole Cytomic
        const v0 = osc;
        const v1 = a1 * ic1eq[v] + a2 * (v0 - ic2eq[v]);
        const v2 = ic2eq[v] + a2 * ic1eq[v] + a3 * (v0 - ic2eq[v]);
        ic1eq[v] = 2.0 * v1 - ic1eq[v];
        ic2eq[v] = 2.0 * v2 - ic2eq[v];

        sampleSum += v2;
      }

      outBuffer[s] = sampleSum * 0.2;
    }
  }

  const endPerf = performance.now();
  const renderTimeMs = endPerf - startPerf;
  const blockDurationUs = (renderTimeMs * 1000) / numBlocks;
  const totalAudioDurationMs = durationSeconds * 1000;
  const speedupFactor = totalAudioDurationMs / Math.max(0.1, renderTimeMs);
  const cpuUsagePercent = (renderTimeMs / totalAudioDurationMs) * 100;
  const throughputMSamplesSec = (totalSamples * voiceCount) / (renderTimeMs * 1000);

  return {
    engineName: 'TypeScript AudioWorklet',
    voiceCount,
    durationSeconds,
    totalSamplesGenerated: totalSamples,
    renderTimeMs: Math.round(renderTimeMs * 100) / 100,
    blockDurationUs: Math.round(blockDurationUs * 10) / 10,
    speedupFactor: Math.round(speedupFactor * 10) / 10,
    cpuUsagePercent: Math.round(cpuUsagePercent * 100) / 100,
    throughputMSamplesSec: Math.round(throughputMSamplesSec * 100) / 100,
    passed: cpuUsagePercent < 20.0
  };
}

/**
 * 3. Benchmark del DSP compilado en WebAssembly (WASM)
 */
export async function benchmarkWasm(voiceCount: number, durationSeconds = 2.0): Promise<EngineBenchmarkResult> {
  const wasmInstance = await getWasmDspInstance();
  const sampleRate = 44100;
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const blockSize = 128;
  const numBlocks = Math.floor(totalSamples / blockSize);

  const outBuffer = new Float32Array(blockSize);
  const dt = 1.0 / sampleRate;

  const startPerf = performance.now();

  const phases = new Float32Array(voiceCount);
  const freqs = new Float32Array(voiceCount);
  const ic1eq = new Float32Array(voiceCount);
  const ic2eq = new Float32Array(voiceCount);

  for (let v = 0; v < voiceCount; v++) {
    freqs[v] = 220 * Math.pow(2, (v % 24) / 12);
  }

  const g = Math.tan((Math.PI * 2500) / sampleRate);

  for (let b = 0; b < numBlocks; b++) {
    outBuffer.fill(0);

    for (let s = 0; s < blockSize; s++) {
      let sampleSum = 0;

      for (let v = 0; v < voiceCount; v++) {
        const dtVal = freqs[v] * dt;
        phases[v] = (phases[v] + dtVal) % 1.0;

        // WASM PolyBlep
        const raw = 2.0 * phases[v] - 1.0;
        const osc = raw - wasmInstance.polyBlep(phases[v], dtVal);

        // WASM SVF Filter
        const filtered = wasmInstance.svfProcess(osc, ic1eq[v], ic2eq[v], g);
        ic2eq[v] = filtered;

        sampleSum += filtered;
      }

      outBuffer[s] = sampleSum * 0.2;
    }
  }

  const endPerf = performance.now();
  const renderTimeMs = endPerf - startPerf;
  const blockDurationUs = (renderTimeMs * 1000) / numBlocks;
  const totalAudioDurationMs = durationSeconds * 1000;
  const speedupFactor = totalAudioDurationMs / Math.max(0.1, renderTimeMs);
  const cpuUsagePercent = (renderTimeMs / totalAudioDurationMs) * 100;
  const throughputMSamplesSec = (totalSamples * voiceCount) / (renderTimeMs * 1000);

  return {
    engineName: 'WebAssembly (WASM)',
    voiceCount,
    durationSeconds,
    totalSamplesGenerated: totalSamples,
    renderTimeMs: Math.round(renderTimeMs * 100) / 100,
    blockDurationUs: Math.round(blockDurationUs * 10) / 10,
    speedupFactor: Math.round(speedupFactor * 10) / 10,
    cpuUsagePercent: Math.round(cpuUsagePercent * 100) / 100,
    throughputMSamplesSec: Math.round(throughputMSamplesSec * 100) / 100,
    passed: cpuUsagePercent < 15.0
  };
}

/**
 * Ejecuta la comparativa completa Tri-Engine para 8, 16, 32 y 64 voces polifónicas
 */
export async function runComparativeBenchmark(
  onProgress?: (step: string, percent: number) => void
): Promise<ComparativeBenchmarkReport> {
  const voiceCounts = [8, 16, 32, 64];
  const toneJsResults: EngineBenchmarkResult[] = [];
  const tsWorkletResults: EngineBenchmarkResult[] = [];
  const wasmMvpResults: EngineBenchmarkResult[] = [];

  const totalSteps = voiceCounts.length * 3;
  let currentStep = 0;

  for (const vc of voiceCounts) {
    if (onProgress) onProgress(`Ejecutando Tone.js Graph (${vc} voces)...`, (++currentStep / totalSteps) * 100);
    const rTone = await benchmarkToneJs(vc, 1.5);
    toneJsResults.push(rTone);

    if (onProgress) onProgress(`Ejecutando TypeScript AudioWorklet (${vc} voces)...`, (++currentStep / totalSteps) * 100);
    const rTs = await benchmarkTsWorklet(vc, 1.5);
    tsWorkletResults.push(rTs);

    if (onProgress) onProgress(`Ejecutando WebAssembly Kernel (${vc} voces)...`, (++currentStep / totalSteps) * 100);
    const rWasm = await benchmarkWasm(vc, 1.5);
    wasmMvpResults.push(rWasm);
  }

  // Evaluación de la Compuerta de Decisión (Fase 4)
  const ts32 = tsWorkletResults.find((r) => r.voiceCount === 32) || tsWorkletResults[tsWorkletResults.length - 1];
  const wasm32 = wasmMvpResults.find((r) => r.voiceCount === 32) || wasmMvpResults[wasmMvpResults.length - 1];

  let decisionVerdict: ComparativeBenchmarkReport['decisionVerdict'] = 'MANTENER_TYPESCRIPT';
  let verdictScoreExplanation = '';

  if (ts32.cpuUsagePercent < 15.0) {
    decisionVerdict = 'MANTENER_TYPESCRIPT';
    verdictScoreExplanation = `DECISIÓN: MANTENER TYPESCRIPT PURO. El AudioWorklet en TypeScript procesa 32 voces con solo el ${ts32.cpuUsagePercent}% de CPU (${ts32.blockDurationUs} µs por bloque de 2.9ms). Compilar a WASM introduciría complejidad innecesaria con una ganancia marginal en esta escala.`;
  } else {
    decisionVerdict = 'COMPILAR_WASM_REQUERIDO';
    verdictScoreExplanation = `DECISIÓN: COMPILAR A WEBASSEMBLY. La carga en TypeScript supera el umbral del 15% (${ts32.cpuUsagePercent}% CPU). WASM reduce el tiempo a ${wasm32.blockDurationUs} µs (${wasm32.cpuUsagePercent}% CPU), justificando la aceleración binaria.`;
  }

  return {
    timestamp: Date.now(),
    sampleRate: 44100,
    voiceCounts,
    toneJsResults,
    tsWorkletResults,
    wasmMvpResults,
    decisionVerdict,
    verdictScoreExplanation
  };
}
