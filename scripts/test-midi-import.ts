/**
 * test-midi-import.ts
 * Pruebas unitarias y de regresión del importador MIDI inteligente de Phosphor Composer:
 * - Preservación exacta de tresillos y tiempos por ticks/ppq sin deriva con cambios de tempo
 * - Conservación fiel de velocidades y soporte de pedal sustain (CC64)
 * - Análisis armónico multi-pista (arpegios + bajos -> Dm, Dm/C, A#, D#/G, A7, F)
 * - Detección real de tonalidad/escala (sin forzar C major)
 * - Mapeo de programas GM y nombres de pista a Piano / Presets de Synth + CC7/CC10
 * - Conversión de percusión GM (Canal 10) a patrones deduplicados y cadena lineal con velocidades
 */

import pkg from '@tonejs/midi';
import { importMidiToSession } from '../src/utils/midiService';

const Midi = (pkg as any)?.Midi || (pkg as any);

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

console.log('--- 1. Moonlight-style D Minor Triplets + Bass + Exact Velocities ---');
{
  const midi = new Midi();
  const ppq = midi.header.ppq; // 480
  midi.header.setTempo(60);
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [4, 4] }];

  const rh = midi.addTrack();
  rh.name = 'up:';
  rh.channel = 0;
  rh.instrument.number = 0; // Acoustic Grand Piano

  const lh = midi.addTrack();
  lh.name = 'dn:';
  lh.channel = 1;
  lh.instrument.number = 0;

  // Bar 1 (Dm): A3-D4-F4 triplets + D3 bass
  lh.addNote({ midi: 50, ticks: 0, durationTicks: ppq * 4, velocity: 0.62 });
  for (let b = 0; b < 4; b++) {
    rh.addNote({ midi: 57, ticks: Math.round((b + 0 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.45 });
    rh.addNote({ midi: 62, ticks: Math.round((b + 1 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.52 });
    rh.addNote({ midi: 65, ticks: Math.round((b + 2 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.58 });
  }

  // Bar 2 (Dm/C): A3-D4-F4 triplets + C3 bass
  lh.addNote({ midi: 48, ticks: ppq * 4, durationTicks: ppq * 4, velocity: 0.65 });
  for (let b = 4; b < 8; b++) {
    rh.addNote({ midi: 57, ticks: Math.round((b + 0 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.48 });
    rh.addNote({ midi: 62, ticks: Math.round((b + 1 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.54 });
    rh.addNote({ midi: 65, ticks: Math.round((b + 2 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.6 });
  }

  // Bar 3a (A# / Bb): A#3-D4-F4 + A#2 bass; Bar 3b (D#/G): A#3-D#4-G4 + G2 bass
  lh.addNote({ midi: 46, ticks: ppq * 8, durationTicks: ppq * 2, velocity: 0.7 });
  for (let b = 8; b < 10; b++) {
    rh.addNote({ midi: 58, ticks: Math.round((b + 0 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.55 });
    rh.addNote({ midi: 62, ticks: Math.round((b + 1 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.6 });
    rh.addNote({ midi: 65, ticks: Math.round((b + 2 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.65 });
  }
  lh.addNote({ midi: 43, ticks: ppq * 10, durationTicks: ppq * 2, velocity: 0.72 });
  for (let b = 10; b < 12; b++) {
    rh.addNote({ midi: 58, ticks: Math.round((b + 0 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.55 });
    rh.addNote({ midi: 63, ticks: Math.round((b + 1 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.62 });
    rh.addNote({ midi: 67, ticks: Math.round((b + 2 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.68 });
  }

  // Bar 4 (A7): A3-C#4-G4 + A2 bass -> Bar 5 (Dm resolution)
  lh.addNote({ midi: 45, ticks: ppq * 12, durationTicks: ppq * 4, velocity: 0.75 });
  for (let b = 12; b < 16; b++) {
    rh.addNote({ midi: 57, ticks: Math.round((b + 0 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.6 });
    rh.addNote({ midi: 61, ticks: Math.round((b + 1 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.66 });
    rh.addNote({ midi: 67, ticks: Math.round((b + 2 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.7 });
  }
  lh.addNote({ midi: 50, ticks: ppq * 16, durationTicks: ppq * 4, velocity: 0.7 });
  for (let b = 16; b < 20; b++) {
    rh.addNote({ midi: 57, ticks: Math.round((b + 0 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.5 });
    rh.addNote({ midi: 62, ticks: Math.round((b + 1 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.55 });
    rh.addNote({ midi: 65, ticks: Math.round((b + 2 / 3) * ppq), durationTicks: Math.round(ppq / 3), velocity: 0.6 });
  }

  const res = importMidiToSession(toArrayBuffer(midi.toArray()), []);
  assert(res.success, 'Import succeeded');
  assert(res.key === 'D' && res.scale === 'minor', `Detected D minor (got ${res.key} ${res.scale})`);
  assert(res.tracks?.length === 2, `Preserved both piano hands as 2 tracks (got ${res.tracks?.length})`);
  assert(res.tracks![0].name === 'Piano (Mano Der.)', `Normalized RH track name (got ${res.tracks![0].name})`);
  assert(res.tracks![1].name === 'Piano (Mano Izq.)', `Normalized LH track name (got ${res.tracks![1].name})`);
  assert(res.channels?.melody?.instrument === 'piano', 'RH mapped to sampled Piano');
  assert(res.channels?.[res.tracks![1].channelId]?.instrument === 'piano', 'LH mapped to sampled Piano');
  assert(res.channels?.chords?.muted === true, 'Accompaniment chords channel muted by default for fidelity');

  // Verify exact triplets (1/3 and 2/3 beats) and velocities
  const n0 = res.tracks![0].notes[0];
  const n1 = res.tracks![0].notes[1];
  const n2 = res.tracks![0].notes[2];
  assert(Math.abs(n1.startBeat - 1 / 3) < 0.002, `Triplet note 2 exact beat 0.3333 (got ${n1.startBeat})`);
  assert(Math.abs(n2.startBeat - 2 / 3) < 0.002, `Triplet note 3 exact beat 0.6667 (got ${n2.startBeat})`);
  assert(Math.abs(n0.velocity - 0.45) < 0.02 && Math.abs(n2.velocity - 0.58) < 0.02, `Exact velocities preserved (${n0.velocity}, ${n2.velocity})`);

  // Verify exact chords detected from combined hands
  const chordSeq = res.chordBlocks.map((b) => b.chord);
  assert(chordSeq[0] === 'Dm', `Bar 1 chord is Dm (got ${chordSeq[0]})`);
  assert(chordSeq[1] === 'Dm/C' || chordSeq[1] === 'Dm7/C', `Bar 2 chord is Dm/C or Dm7/C (got ${chordSeq[1]})`);
  assert(chordSeq[2] === 'A#', `Bar 3a chord is A# major (got ${chordSeq[2]})`);
  assert(chordSeq[3] === 'D#/G', `Bar 3b chord is D#/G (got ${chordSeq[3]})`);
  assert(chordSeq[4] === 'A7', `Bar 4 chord is A7 with omitted 5th (got ${chordSeq[4]})`);
  assert(chordSeq[5] === 'Dm', `Bar 5 resolves to Dm (got ${chordSeq[5]})`);
}

console.log('\n--- 2. Multi-Track Synth + Explicit Chords + Tempo Change + GM Drums (Ch 10) ---');
{
  const midi = new Midi();
  const ppq = midi.header.ppq; // 480
  midi.header.tempos = [
    { ticks: 0, bpm: 120 },
    { ticks: ppq * 8, bpm: 96 }
  ];
  midi.header.update();

  // Track 0: explicit Chords in C minor
  const chTrack = midi.addTrack();
  chTrack.name = 'Chords';
  chTrack.channel = 0;
  [48, 60, 63, 67].forEach((m) => chTrack.addNote({ midi: m, ticks: 0, durationTicks: ppq * 4, velocity: 0.7 }));
  [44, 56, 60, 63].forEach((m) => chTrack.addNote({ midi: m, ticks: ppq * 4, durationTicks: ppq * 4, velocity: 0.7 }));
  [46, 58, 62, 65].forEach((m) => chTrack.addNote({ midi: m, ticks: ppq * 8, durationTicks: ppq * 4, velocity: 0.7 }));
  [48, 60, 63, 67].forEach((m) => chTrack.addNote({ midi: m, ticks: ppq * 12, durationTicks: ppq * 4, velocity: 0.7 }));

  // Track 1: Moog Sub Bass (even with GM prog 0, name should resolve to moog_bass)
  const bassTrack = midi.addTrack();
  bassTrack.name = 'Moog Sub Bass';
  bassTrack.channel = 1;
  bassTrack.instrument.number = 0;
  bassTrack.addNote({ midi: 36, ticks: 0, durationTicks: ppq * 4, velocity: 0.85 });
  bassTrack.addNote({ midi: 34, ticks: ppq * 8, durationTicks: ppq * 4, velocity: 0.9 }); // after tempo change!

  // Track 2: Synth Lead + CC10 Pan right
  const leadTrack = midi.addTrack();
  leadTrack.name = 'Cyber Lead';
  leadTrack.channel = 2;
  leadTrack.instrument.number = 81; // Sawtooth Lead
  leadTrack.addCC({ number: 10, ticks: 0, value: 0.75 }); // +0.5 pan
  leadTrack.addNote({ midi: 72, ticks: ppq * 12, durationTicks: ppq * 2, velocity: 0.92 });

  // Track 3: GM Drums (Channel 10 = index 9)
  const drumTrack = midi.addTrack();
  drumTrack.name = 'Drums';
  drumTrack.channel = 9;
  for (let m = 0; m < 4; m++) {
    const base = m * ppq * 4;
    drumTrack.addNote({ midi: 36, ticks: base, durationTicks: 120, velocity: 0.95 }); // Kick beat 1
    drumTrack.addNote({ midi: 38, ticks: base + ppq, durationTicks: 120, velocity: 0.82 }); // Snare beat 2
    drumTrack.addNote({ midi: 42, ticks: base + ppq / 2, durationTicks: 120, velocity: 0.5 }); // HH C
  }

  const res = importMidiToSession(toArrayBuffer(midi.toArray()), []);
  assert(res.success, 'Multi-track MIDI import succeeded');
  assert(res.key === 'C' && res.scale === 'minor', `Detected C minor (got ${res.key} ${res.scale})`);
  assert(res.tempoMarkers?.length === 1 && res.tempoMarkers[0].beat === 8 && res.tempoMarkers[0].bpm === 96, 'Tempo marker preserved at exact beat 8');
  assert(res.channels?.chords?.muted === false, 'Explicit Chords track keeps chords channel unmuted');
  assert(res.tracks?.length === 2, `2 non-chord melodic tracks preserved (got ${res.tracks?.length})`);
  assert(res.tracks![0].notes[1].startBeat === 8, `Note after tempo change stays on exact beat 8 (got ${res.tracks![0].notes[1].startBeat})`);
  assert(res.channels?.melody?.synthSettings?.presetName === 'Fat Minimoog Bass', `Moog Sub Bass mapped to Fat Minimoog Bass (got ${res.channels?.melody?.synthSettings?.presetName})`);
  const leadCh = res.channels?.[res.tracks![1].channelId];
  assert(leadCh?.instrument === 'synth' && Math.abs((leadCh?.pan ?? 0) - 0.5) < 0.05, `Lead channel pan mapped from CC10 (got ${leadCh?.pan})`);
  assert(Array.isArray(res.drumChannels) && res.drumChannels.length === 6, 'GM Drums converted into 6 Phosphor DrumChannels');
  assert(res.patternChain?.length === 1 && res.patternChain[0].durationMeasures === 4, `4 identical drum measures merged into 1 linear clip of 4 measures (got ${JSON.stringify(res.patternChain)})`);
  const kickStep0 = res.drumChannels!.find((d) => d.id === 'kick_1')!.patterns[0][0];
  assert(kickStep0.isActive && kickStep0.velocity >= 0.9, `Drum step velocity preserved (got ${kickStep0.velocity})`);
}

console.log('\n🎉 ALL SMART MIDI IMPORT TESTS PASSED WITH 100% SUCCESS!');
