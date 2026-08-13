/**
 * scripts/test-session-migration.ts
 * Suite de pruebas para Serialización, Deserialización y Migración Retrocompatible de Sesiones
 */

import {
  serializeSession,
  deserializeSession,
  exportSessionToJson
} from '../src/core/session/index';
import type { LegacySessionV1, SessionV2 } from '../src/core/session/sessionTypes';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('--- 1. Testing Legacy v1 Session Migration (Flat melodyNotes) ---');
const legacyV1: LegacySessionV1 = {
  bpm: 128,
  key: 'Eb', // Old flat format
  scale: 'minor',
  timeSignature: '4/4',
  pattern: 'eighths',
  chordBlocks: [
    { chord: 'Eb', startBeat: 0, durationBeats: 4 },
    { chord: 'Ab', startBeat: 4, durationBeats: 4 },
    { chord: 'Bb', startBeat: 8, durationBeats: 4 },
    { chord: 'Cm', startBeat: 12, durationBeats: 4 }
  ],
  melodyNotes: [
    { note: 'Eb4', startBeat: 0, durationBeats: 1, velocity: 0.8 },
    { note: 'G4', startBeat: 1, durationBeats: 1, velocity: 0.8 },
    { note: 'Bb4', startBeat: 2, durationBeats: 2, velocity: 0.9 }
  ],
  channels: {
    melody: { name: 'Lead Synth', volume: -3, pan: 0.2, mute: false, solo: false, isDrum: false }
  }
};

const migrationResult = deserializeSession(legacyV1);
assert(migrationResult.session.schemaVersion === 2, 'Migrated session has schemaVersion: 2');
assert(migrationResult.session.transport.key === 'D#', 'Migrated key Eb is normalized to D#');
assert(migrationResult.session.transport.scale === 'minor', 'Migrated scale is minor');
assert(migrationResult.session.transport.bpm === 128, 'Migrated bpm is 128');
assert(migrationResult.session.tracks.length === 1, 'Migrated tracks has 1 track created from flat melodyNotes');
assert(migrationResult.session.tracks[0].notes.length === 3, 'Track 1 received all 3 melody notes');
assert(migrationResult.session.tracks[0].notes[0].note === 'Eb4', 'Track note 1 preserved');
assert(migrationResult.session.harmony.chordBlocks.length === 4, 'Migrated 4 chord blocks');
assert(migrationResult.session.mixer.channels.melody.name === 'Lead Synth', 'Custom channel name preserved');

console.log('\n--- 2. Testing Multi-Track Session Serialization & Deserialization ---');
const multiTrackState = {
  bpm: 140,
  key: 'G',
  scale: 'major',
  timeSignature: '4/4',
  isAutoKey: false,
  pattern: 'pop',
  chordBlocks: [
    { id: 'c1', chord: 'G', startBeat: 0, durationBeats: 4, voicing: 'open', inversion: 0, type: 'play' },
    { id: 'c2', chord: 'Em', startBeat: 4, durationBeats: 4, voicing: 'default', inversion: 1, type: 'play' }
  ],
  styleMarkers: [
    { id: 'sm1', beat: 0, pattern: 'pop' },
    { id: 'sm2', beat: 4, pattern: 'arpeggio' }
  ],
  chordOctaveShift: -1,
  tracks: [
    {
      id: 'track_lead',
      name: 'Lead Synth',
      channelId: 'melody',
      color: '#00e5ff',
      notes: [{ id: 'n1', note: 'B4', startBeat: 0, durationBeats: 2, velocity: 0.85 }],
      viewport: { scrollLeft: 0, scrollTop: 600, beatWidth: 40, rowHeight: 20 }
    },
    {
      id: 'track_bass',
      name: 'Sub Bass',
      channelId: 'ch_bass',
      color: '#ffaa00',
      notes: [{ id: 'n2', note: 'G2', startBeat: 0, durationBeats: 4, velocity: 0.9 }],
      viewport: { scrollLeft: 0, scrollTop: 600, beatWidth: 40, rowHeight: 20 }
    }
  ],
  activeTrackId: 'track_lead',
  melodyNotes: [{ id: 'n1', note: 'B4', startBeat: 0, durationBeats: 2, velocity: 0.85 }],
  channels: {
    master: { id: 'master', name: 'Master', volume: 0, pan: 0, mute: false, solo: false, isDrum: false },
    chords: { id: 'chords', name: 'Acordes', volume: -6, pan: -0.2, mute: false, solo: false, isDrum: false },
    melody: { id: 'melody', name: 'Lead Synth', volume: -4, pan: 0.3, mute: false, solo: false, isDrum: false },
    ch_bass: { id: 'ch_bass', name: 'Sub Bass', volume: -2, pan: 0, mute: false, solo: false, isDrum: false },
    drums: { id: 'drums', name: 'Batería', volume: 0, pan: 0, mute: false, solo: false, isDrum: true }
  },
  channelOrder: ['master', 'chords', 'melody', 'ch_bass', 'drums'],
  patternChain: [{ patternId: 'intro_drums', repeatCount: 2 }],
  isPatternRepeatOn: true,
  activeDrumKitId: 'kit_synthwave'
};

const jsonStr = exportSessionToJson(multiTrackState, { title: 'Multi Track Test' });
assert(typeof jsonStr === 'string' && jsonStr.includes('Multi Track Test'), 'Exported session to JSON string');

const imported = deserializeSession(jsonStr);
const sessionV2: SessionV2 = imported.session;

assert(sessionV2.schemaVersion === 2, 'Imported session schema is version 2');
assert(sessionV2.tracks.length === 2, 'Imported session has 2 tracks preserved');
assert(sessionV2.tracks[1].name === 'Sub Bass', 'Second track name is Sub Bass');
assert(sessionV2.tracks[1].notes[0].note === 'G2', 'Second track note is G2');
assert(sessionV2.mixer.channels.ch_bass !== undefined, 'Dedicated track channel in mixer preserved');
assert(sessionV2.harmony.styleMarkers.length === 2, 'Style markers preserved');
assert(sessionV2.drums.patternChain.length === 1, 'Drum pattern chain preserved');
assert(sessionV2.drums.activeDrumKitId === 'kit_synthwave', 'Active drum kit preserved');

console.log('\n--- 3. Testing Malformed Input Resiliency ---');
let caughtError = false;
try {
  deserializeSession('invalid json string {]');
} catch (_) {
  caughtError = true;
}
assert(caughtError, 'Corrupted JSON string safely throws catchable error without crashing');

const partialEmpty = deserializeSession({});
assert(partialEmpty.session.schemaVersion === 2, 'Empty object migrates cleanly with safe defaults');
assert(partialEmpty.session.tracks.length === 1, 'Empty object gets default track');
assert(partialEmpty.session.transport.bpm === 120, 'Default bpm is 120');

console.log('\n🎉 ALL SESSION MIGRATION & SERIALIZATION TESTS PASSED WITH 100% SUCCESS!');
