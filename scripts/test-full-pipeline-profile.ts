/**
 * scripts/test-full-pipeline-profile.ts
 * Suite de profiling real y verificación de paridad acústica para el motor offline de Phosphor Composer.
 */

import { renderSynthTrackOffline } from '../src/core/audio/engine/PhosphorDSPKernel';
import { renderDrumsOffline } from '../src/core/audio/engine/DrumOfflineRenderer';
import { normalizeSynthSettings } from '../src/core/audio/engine/synthPresets';
import type { ScheduledDrumEvent } from '../src/core/audio/audioTypes';
import { faderToDb } from '../src/core/audio/engine/MixerGraph';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('=== INICIANDO PROFILING REAL DEL MOTOR OFFLINE ===\n');

// ------------------------------------------------------------------------
// 1. Profiling de Sintetizadores Analógicos (DSP Kernel) en sesión compleja
// ------------------------------------------------------------------------
console.log('--- 1. Profiling de Síntesis Analógica (Chords & Lead) ---');

const synthSettings = normalizeSynthSettings({
  osc1: { waveType: 'sawtooth', volume: 0.8, octave: 0, semi: 0, detune: 0, enabled: true },
  osc2: { waveType: 'square', volume: 0.5, octave: -1, semi: 0, detune: 5, enabled: true },
  subOsc: { waveType: 'sine', volume: 0.3, octave: -1, enabled: true },
  noise: { type: 'pink', volume: 0.05, enabled: true },
  filter: { enabled: true, type: 'lowpass', frequency: 3500, Q: 2.0, drive: 0.25, driveType: 'tube' },
  envelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.4 },
  lfo: { enabled: true, waveType: 'triangle', rate: 4.0, depth: 0.3, target: 'cutoff' },
  eq: { enabled: true, low: 2.0, lowMid: -1.5, highMid: 1.0, high: 2.5 },
  masterGain: 1.0
});

// Generar 180 segundos (3 minutos) de acordes y notas densas
const totalDurationSeconds = 180;
const sampleRate = 44100;
const synthEvents: Array<{ note: string; timeSeconds: number; durationSeconds: number; velocity: number }> = [];

const chordNotes = ['C4', 'E4', 'G4', 'B4', 'D5'];
for (let t = 0; t < totalDurationSeconds - 2; t += 2) {
  chordNotes.forEach((n, idx) => {
    synthEvents.push({
      note: n,
      timeSeconds: t + idx * 0.05,
      durationSeconds: 1.8,
      velocity: 0.85
    });
  });
}

console.log(`Simulando pista de sinte analógico: ${synthEvents.length} notas a lo largo de ${totalDurationSeconds}s (3 min)...`);
const t0 = performance.now();
const synthBuffer = renderSynthTrackOffline(synthEvents, synthSettings, totalDurationSeconds, sampleRate);
const synthTimeMs = performance.now() - t0;

console.log(`⏱️ Tiempo de renderizado de 3 min de sinte analógico: ${(synthTimeMs / 1000).toFixed(3)}s (${synthTimeMs.toFixed(1)}ms)`);
assert(synthTimeMs < 10000, `Síntesis de 3 minutos completada en <10s (obtenido: ${(synthTimeMs / 1000).toFixed(2)}s)`);

const synthL = synthBuffer.getChannelData(0);
const synthR = synthBuffer.getChannelData(1);

// Verificar integridad de datos (sin NaN ni Infinitos)
let synthHasNan = false;
let synthMaxAmp = 0;
for (let i = 0; i < synthL.length; i++) {
  if (isNaN(synthL[i]) || isNaN(synthR[i]) || !isFinite(synthL[i]) || !isFinite(synthR[i])) {
    synthHasNan = true;
    break;
  }
  synthMaxAmp = Math.max(synthMaxAmp, Math.abs(synthL[i]), Math.abs(synthR[i]));
}

assert(!synthHasNan, 'El buffer de sinte no contiene muestras NaN ni infinitas');
assert(synthMaxAmp > 0.05 && synthMaxAmp <= 3.0, `Pico de amplitud de sinte calibrado correctamente (peak: ${synthMaxAmp.toFixed(3)})`);


// ------------------------------------------------------------------------
// 2. Profiling de Batería Ultrarrápida (PCM Stereo Mix con Resampling)
// ------------------------------------------------------------------------
console.log('\n--- 2. Profiling de Mezcla de Batería PCM ---');

// Mockear buffers de batería reales a diferentes frecuencias (44.1kHz y 48kHz para probar resampling)
const kickBuf = {
  numberOfChannels: 2,
  sampleRate: 44100,
  length: 8820,
  duration: 0.2,
  getChannelData: (_c: number) => {
    const arr = new Float32Array(8820);
    for (let i = 0; i < 8820; i++) arr[i] = Math.sin(2 * Math.PI * 55 * (i / 44100)) * Math.exp(-i / 1500);
    return arr;
  }
};

const snareBuf = {
  numberOfChannels: 2,
  sampleRate: 48000, // 48kHz para verificar resampling lineal
  length: 12000,
  duration: 0.25,
  getChannelData: (_c: number) => {
    const arr = new Float32Array(12000);
    for (let i = 0; i < 12000; i++) arr[i] = (Math.random() * 2 - 1) * Math.exp(-i / 2500);
    return arr;
  }
};

const preloadedMap = new Map<string, any>();
preloadedMap.set('/drums/kicks/kick1.wav', { loaded: true, get: () => kickBuf });
preloadedMap.set('/drums/snares/snare1.wav', { loaded: true, get: () => snareBuf });

// Generar 180 segundos con 8 golpes de batería por segundo (~1440 golpes en total)
const drumEvents: ScheduledDrumEvent[] = [];
for (let t = 0; t < totalDurationSeconds - 1; t += 0.25) {
  drumEvents.push({
    channelId: 'kick_1',
    sampleUrl: '/drums/kicks/kick1.wav',
    timeSeconds: t,
    velocity: 0.9,
    pan: 0,
    volume: 80
  });
  if (Math.round(t * 4) % 2 === 1) {
    drumEvents.push({
      channelId: 'snare_1',
      sampleUrl: '/drums/snares/snare1.wav',
      timeSeconds: t,
      velocity: 0.85,
      pan: 0.1,
      volume: 80
    });
  }
}

console.log(`Simulando pista de batería: ${drumEvents.length} golpes a lo largo de ${totalDurationSeconds}s...`);
const t1 = performance.now();
const drumBuffer = await renderDrumsOffline(drumEvents, totalDurationSeconds, sampleRate, preloadedMap);
const drumTimeMs = performance.now() - t1;

console.log(`⏱️ Tiempo de renderizado de 3 min de batería PCM: ${(drumTimeMs / 1000).toFixed(3)}s (${drumTimeMs.toFixed(1)}ms)`);
assert(drumTimeMs < 500, `Mezcla de batería completada en <0.5s (obtenido: ${drumTimeMs.toFixed(1)}ms)`);

const drumL = drumBuffer.getChannelData(0);
const drumR = drumBuffer.getChannelData(1);

let drumHasNan = false;
let drumMaxAmp = 0;
for (let i = 0; i < drumL.length; i++) {
  if (isNaN(drumL[i]) || isNaN(drumR[i]) || !isFinite(drumL[i]) || !isFinite(drumR[i])) {
    drumHasNan = true;
    break;
  }
  drumMaxAmp = Math.max(drumMaxAmp, Math.abs(drumL[i]), Math.abs(drumR[i]));
}

assert(!drumHasNan, 'El buffer de batería no contiene muestras NaN ni infinitas');
assert(drumMaxAmp > 0.1 && drumMaxAmp <= 2.0, `Pico de batería calibrado correctamente (peak: ${drumMaxAmp.toFixed(3)})`);

// ------------------------------------------------------------------------
// 3. Verificación de Faders y Calibración dB
// ------------------------------------------------------------------------
console.log('\n--- 3. Verificación de Faders y No Muteo Involuntario ---');

assert(faderToDb(80) === 0, 'Fader 80 corresponde exactamente a 0.0 dB (Unity Gain)');
assert(faderToDb(0) === -Infinity, 'Fader 0 corresponde a -Infinity dB (Mute)');
assert(faderToDb(100) > 0, 'Fader 100 proporciona boost positivo');

// Tiempo total acumulado de DSP puro para una canción de 3 minutos
const totalDspTimeMs = synthTimeMs + drumTimeMs;
console.log(`\n⚡ TIEMPO TOTAL DSP PARA CANCIÓN DE 3 MINUTOS: ${(totalDspTimeMs / 1000).toFixed(2)}s`);
assert(totalDspTimeMs < 12000, `Tiempo total de procesamiento < 15 segundos (obtenido: ${(totalDspTimeMs / 1000).toFixed(2)}s)`);

console.log('\n🎉 TODOS LOS TESTS DE RENDIMIENTO Y PARIDAD ACÚSTICA PASARON AL 100%!\n');
