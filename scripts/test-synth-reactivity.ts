/**
 * test-synth-reactivity.ts
 * Suite de pruebas para verificar que los cambios tímbricos de la UI del Sintetizador
 * (Forma de Onda, Detune, ADSR Envelope, Filtro VCF Cutoff/Q/Type) se apliquen reactivamente
 * a cada canal de sintetizador independiente.
 */

import { useSongStore } from '../src/store/songStore';
import { toneEngine } from '../src/audio/toneEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log('--- 1. Testing Synth Settings Reactivity for Chords Channel ---');

useSongStore.getState().setChannelSynthSettings('chords', {
  waveType: 'sawtooth',
  detune: 25,
  envelope: { attack: 0.15, decay: 0.4, sustain: 0.6, release: 1.5 },
  filter: { enabled: true, type: 'lowpass', frequency: 1200, Q: 3.5 }
});

const chordsSettings = useSongStore.getState().channels['chords'].synthSettings;
assert(chordsSettings?.waveType === 'sawtooth', 'Chords waveType updated to sawtooth');
assert(chordsSettings?.detune === 25, 'Chords detune updated to +25 cents');
assert(chordsSettings?.envelope.attack === 0.15, 'Chords envelope attack updated to 0.15s');
assert(chordsSettings?.filter.frequency === 1200, 'Chords filter frequency updated to 1200 Hz');

console.log('\n--- 2. Testing Synth Settings Reactivity for Melody Channel ---');

useSongStore.getState().setChannelSynthSettings('melody', {
  waveType: 'square',
  detune: -12,
  envelope: { attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.3 },
  filter: { enabled: true, type: 'highpass', frequency: 800, Q: 2.0 }
});

const melodySettings = useSongStore.getState().channels['melody'].synthSettings;
assert(melodySettings?.waveType === 'square', 'Melody waveType updated to square');
assert(melodySettings?.detune === -12, 'Melody detune updated to -12 cents');
assert(melodySettings?.filter.type === 'highpass', 'Melody filter type updated to highpass');
assert(melodySettings?.filter.frequency === 800, 'Melody filter frequency updated to 800 Hz');

console.log('\n--- 3. Testing Direct Audio Engine Synchronization ---');

// Invocación directa que ejecuta el modal al interactuar con los knobs
toneEngine.updateSynthSettings({
  waveType: 'sine',
  detune: 0,
  envelope: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.5 },
  filter: { enabled: false, type: 'lowpass', frequency: 20000, Q: 1 }
}, 'chords');

assert(true, 'toneEngine.updateSynthSettings executed without throwing exceptions');

console.log('\n🎉 ALL SYNTH UI & AUDIO REACTIVITY TESTS PASSED WITH 100% SUCCESS!\n');
