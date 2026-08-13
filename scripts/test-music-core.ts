/**
 * scripts/test-music-core.ts
 * Suite de pruebas automatizadas para el nuevo Core de Dominio Musical (src/core/music)
 */

import {
  NOTE_CLASSES,
  normalizePitchClass,
  noteToMod12,
  mod12ToNote,
  midiToNote,
  noteToMidi,
  shiftOctave,
  transposeNote,
  parseChord,
  getChordNotes,
  transposeChordName,
  getScaleNotes,
  getDiatonicChords,
  isChordInScale,
  getChordRomanDegree,
  invertChord,
  applyVoicing,
  getBlockNotes,
  resolvePatternNoteToChord,
  renderChordPattern,
  detectKey,
  getHarmonicSuggestions
} from '../src/core/music/index';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('--- 1. Testing Pitch Class & Enharmonics ---');
assert(normalizePitchClass('Eb') === 'D#', 'Eb normalizes to D#');
assert(normalizePitchClass('Bb') === 'A#', 'Bb normalizes to A#');
assert(normalizePitchClass('Db') === 'C#', 'Db normalizes to C#');
assert(normalizePitchClass('Gb') === 'F#', 'Gb normalizes to F#');
assert(normalizePitchClass('Ab') === 'G#', 'Ab normalizes to G#');
assert(noteToMod12('C') === 0, 'C is 0');
assert(noteToMod12('D#') === 3, 'D# is 3');
assert(noteToMod12('Eb') === 3, 'Eb is 3');
assert(mod12ToNote(14) === 'D', 'mod12ToNote(14) is D');
assert(midiToNote(60) === 'C4', 'MIDI 60 is C4');
assert(noteToMidi('C4') === 60, 'C4 is MIDI 60');
assert(noteToMidi('A4') === 69, 'A4 is MIDI 69');
assert(shiftOctave('C3', 2) === 'C5', 'C3 shifted by +2 is C5');
assert(transposeNote('C4', 7) === 'G4', 'C4 + 7 semitones is G4');
assert(transposeNote('Eb4', 2) === 'F4', 'Eb4 + 2 semitones is F4');

console.log('\n--- 2. Testing Chord Parsing & Transposition ---');
const parsedC = parseChord('C');
assert(parsedC !== null && parsedC.root === 'C' && parsedC.quality === 'major', 'Parsed C major');

const parsedEbMaj7 = parseChord('Ebmaj7');
assert(parsedEbMaj7 !== null && parsedEbMaj7.root === 'D#' && parsedEbMaj7.quality === 'major7', 'Parsed Ebmaj7');

const parsedSlash = parseChord('C/E');
assert(parsedSlash !== null && parsedSlash.root === 'C' && parsedSlash.bass === 'E', 'Parsed Slash C/E');

assert(transposeChordName('C/E', 2) === 'D/F#', 'Transpose C/E + 2 -> D/F#');
assert(transposeChordName('Bbmaj7', 2) === 'Cmaj7', 'Transpose Bbmaj7 + 2 -> Cmaj7');

const cNotes = getChordNotes('C', 3);
assert(JSON.stringify(cNotes) === JSON.stringify(['C3', 'E3', 'G3']), 'C chord notes in octave 3');

const slashNotes = getChordNotes('C/E', 4);
assert(slashNotes[0] === 'E3' && slashNotes[1] === 'C4', 'Slash chord puts bass in octave 3');

console.log('\n--- 3. Testing Scales & Roman Degree Analysis ---');
const cMajorNotes = getScaleNotes('C', 'major', 4);
assert(JSON.stringify(cMajorNotes) === JSON.stringify(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']), 'C major scale notes');

const cMajorDiatonic = getDiatonicChords('C', 'major');
assert(JSON.stringify(cMajorDiatonic) === JSON.stringify(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']), 'C major diatonic chords');

assert(isChordInScale('Dm', 'C', 'major') === true, 'Dm is in C major');
assert(isChordInScale('Ab', 'C', 'major') === false, 'Ab is not in C major');

assert(getChordRomanDegree('C', 'C', 'major') === 'I', 'C in C major is I');
assert(getChordRomanDegree('Dm', 'C', 'major') === 'ii', 'Dm in C major is ii');
assert(getChordRomanDegree('G', 'C', 'major') === 'V', 'G in C major is V');
assert(getChordRomanDegree('Ab', 'C', 'major') === 'bVI', 'Ab in C major is bVI');
assert(getChordRomanDegree('Bb', 'C', 'major') === 'bVII', 'Bb in C major is bVII');

console.log('\n--- 4. Testing Voicing & Inversion Engine ---');
const inv1 = invertChord(['C4', 'E4', 'G4'], 1);
assert(JSON.stringify(inv1) === JSON.stringify(['E4', 'G4', 'C5']), '1st inversion of C major');

const drop2 = applyVoicing(['C4', 'E4', 'G4', 'B4'], 'drop2');
assert(drop2.includes('G3'), 'Drop 2 lowered the 2nd highest note to G3');

const blockNotes = getBlockNotes({
  chord: 'C',
  inversion: 1,
  type: 'play'
});
assert(blockNotes[0] === 'C2' && blockNotes[1] === 'E4' && blockNotes[2] === 'G4' && blockNotes[3] === 'C5', 'Block notes has bass + inverted chord');

console.log('\n--- 5. Testing Pattern Note Resolver ---');
const pn = { semitoneFromRoot: 4, octaveOffset: 0, voice: 'chord' }; // Third of C major
const resNote = resolvePatternNoteToChord(pn, 'Am', 4); // Should resolve to C5 (third of Am)
assert(resNote === 'C5', `Pattern third on Am resolves to C5 (got ${resNote})`);

const rendered = renderChordPattern({
  chord: 'C',
  startBeat: 0,
  durationBeats: 4,
  type: 'play'
}, 'quarters');
assert(rendered.length === 16, `Quarter notes pattern rendered 16 notes (4 notes * 4 beats), got ${rendered.length}`);

console.log('\n--- 6. Testing Key Detection ---');
const detectedC = detectKey(['C', 'F', 'G', 'Am']);
assert(detectedC !== null && detectedC.key === 'C' && detectedC.scale === 'major', 'Detected C major from [C, F, G, Am]');

const detectedEb = detectKey(['Eb', 'Ab', 'Bb', 'Cm']);
assert(detectedEb !== null && (detectedEb.key === 'D#' || detectedEb.key === 'Eb') && detectedEb.scale === 'major', 'Detected Eb/D# major from [Eb, Ab, Bb, Cm]');

console.log('\n--- 7. Testing Harmony Advisor ---');
const suggestions = getHarmonicSuggestions('C', 'major', ['C', 'F', 'G']);
assert(suggestions.length > 0, 'Got harmonic suggestions');
assert(suggestions[0].chord === 'C' || suggestions[0].chord === 'Cmaj7' || suggestions[0].chord === 'Am', `Top suggestion after G in C major resolves to tonic or submediant (got ${suggestions[0].chord})`);

console.log('\n🎉 ALL PURE MUSIC DOMAIN TESTS PASSED WITH 100% SUCCESS!');
