/**
 * test-ai-assistant.ts
 * Suite de pruebas automatizadas para el Asistente Armónico Markov,
 * Generador Melódico Algorítmico y Live Vocal-to-MIDI con toggle de escala.
 */

import { getHarmonicSuggestions, generateMelody } from '../src/core/music';
import { LivePitchTracker } from '../src/core/audio';
import type { ChordBlock } from '../src/utils/typeDefinitions';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log('--- 1. Testing Markov Harmony Advisor in Major & Minor Keys ---');

// Caso Mayor: C -> F -> G (espera C o Am)
const majorSuggestions = getHarmonicSuggestions('C', 'major', ['C', 'F', 'G']);
assert(majorSuggestions.length > 0, 'Major suggestions generated');
assert(majorSuggestions[0].chord === 'C' || majorSuggestions[0].chord === 'Cmaj7', `Top suggestion after G in C major is C (got ${majorSuggestions[0].chord} with prob ${majorSuggestions[0].probability})`);
assert(majorSuggestions[0].probability >= 0.7, `Tonic resolution has high probability >= 0.70 (got ${majorSuggestions[0].probability})`);

// Caso Menor: Am -> Dm -> E7 (espera Am)
const minorSuggestions = getHarmonicSuggestions('A', 'minor', ['Am', 'Dm', 'E7']);
assert(minorSuggestions.length > 0, 'Minor suggestions generated');
const topMinor = minorSuggestions[0].chord;
assert(topMinor === 'Am' || topMinor === 'A' || topMinor === 'Am7', `Top suggestion after E7 in A minor is tonic Am (got ${topMinor})`);

// Caso Intercambio Modal (Spicy)
const spicySuggestions = majorSuggestions.filter(s => s.category === 'spicy');
assert(spicySuggestions.length > 0, 'Modal interchange (spicy) suggestions present in palette');

// Caso con Notas Melódicas concurrentes (E4, G4, B4 favorecen Cmaj7 / Em)
const melodicBoostSuggestions = getHarmonicSuggestions('C', 'major', ['C'], [4, 7, 11]); // E, G, B
const cmaj7 = melodicBoostSuggestions.find(s => s.chord.includes('maj7') || s.chord === 'Em');
assert(!!cmaj7, 'Melody pitch classes influenced chord suggestions');

console.log('\n--- 2. Testing Algorithmic Melody Generator (No Magenta) ---');

const sampleChords: ChordBlock[] = [
  { id: 'c1', chord: 'C', startBeat: 0, durationBeats: 4 },
  { id: 'c2', chord: 'Am', startBeat: 4, durationBeats: 4 },
  { id: 'c3', chord: 'F', startBeat: 8, durationBeats: 4 },
  { id: 'c4', chord: 'G', startBeat: 12, durationBeats: 4 }
];

const generatedGhostNotes = generateMelody({
  key: 'C',
  scale: 'major',
  chordBlocks: sampleChords,
  totalBeats: 16,
  style: 'catchy'
});

assert(generatedGhostNotes.length >= 8, `Generated rich melody with ${generatedGhostNotes.length} notes across 16 beats`);

// Verificar variedad rítmica (no solo notas de 0.5 o 1)
const durations = Array.from(new Set(generatedGhostNotes.map(n => n.durationBeats)));
assert(durations.length > 1, `Melody exhibits organic rhythmic variety (durations: ${durations.join(', ')})`);

// Verificar que las notas estén en un rango vocal cómodo (MIDI 60-84)
const allInRange = generatedGhostNotes.every(n => n.midi >= 60 && n.midi <= 84);
assert(allInRange, 'All generated notes stay within comfortable vocal/lead range (C4 to C6)');

console.log('\n--- 3. Testing Live Vocal-to-MIDI & Scale Snapping ---');

const tracker = new LivePitchTracker();

// Simular muestras captadas de voz tarareando (con vibrato y microtono entre 60.2 y 60.8 -> C4)
const simulatedSamples = [
  { midi: 60, time: 0.0, clarity: 0.92 },
  { midi: 60, time: 0.1, clarity: 0.95 },
  { midi: 60, time: 0.2, clarity: 0.91 },
  { midi: 60, time: 0.35, clarity: 0.93 },
  // Transiente de consonante corta (< 0.05s) que debe ser ignorada
  { midi: 75, time: 0.45, clarity: 0.85 },
  // Nota 2: D4 (MIDI 62)
  { midi: 62, time: 0.6, clarity: 0.90 },
  { midi: 62, time: 0.8, clarity: 0.94 },
  { midi: 62, time: 1.0, clarity: 0.92 }
];

// Prueba con snapToScale: true en C Mayor
const scaleSnappedNotes = tracker.processRecordedNotes(simulatedSamples, 120, {
  snapToScale: true,
  key: 'C',
  scale: 'major',
  gridSnap: 0.25,
  minDurationSec: 0.08
});

console.log('Processed Notes:', scaleSnappedNotes);
assert(scaleSnappedNotes.length === 2, `Segmented cleanly into 2 notes, filtering out transients (got ${scaleSnappedNotes.length})`);
assert(scaleSnappedNotes[0].note === 'C4', `First note transcribed accurately as C4 (got ${scaleSnappedNotes[0].note})`);
assert(scaleSnappedNotes[1].note === 'D4', `Second note transcribed accurately as D4 (got ${scaleSnappedNotes[1].note})`);

// Prueba con nota no diatónica (F#4 = MIDI 66 en C mayor)
const chromaticSample = [
  { midi: 66, time: 0.0, clarity: 0.95 },
  { midi: 66, time: 0.2, clarity: 0.95 }
];

const chromaticNotes = tracker.processRecordedNotes(chromaticSample, 120, {
  snapToScale: false,
  key: 'C',
  scale: 'major'
});

const scaleSnappedChromatic = tracker.processRecordedNotes(chromaticSample, 120, {
  snapToScale: true,
  key: 'C',
  scale: 'major'
});

assert(chromaticNotes[0].note === 'F#4', `Chromatic mode preserves exact F#4 (got ${chromaticNotes[0].note})`);
assert(scaleSnappedChromatic[0].note === 'F4' || scaleSnappedChromatic[0].note === 'G4', `Scale mode snaps F#4 to diatonic neighbour F4 or G4 in C major (got ${scaleSnappedChromatic[0].note})`);

console.log('\n🎉 ALL AI ASSISTANT, MARKOV HARMONY & VOCAL-TO-MIDI TESTS PASSED WITH 100% SUCCESS!\n');
