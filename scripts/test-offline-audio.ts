/**
 * scripts/test-offline-audio.ts
 * Suite de pruebas para Timeline Scheduler y Renderizado Offline
 */

import { scheduleSessionTimeline } from '../src/core/audio/timelineScheduler';
import type { SessionV2 } from '../src/core/session/sessionTypes';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('--- 1. Testing Timeline Event Scheduling from SessionV2 ---');

const mockSession: SessionV2 = {
  schemaVersion: 2,
  metadata: {
    title: 'Offline Render Test',
    createdAt: Date.now(),
    modifiedAt: Date.now()
  },
  transport: {
    bpm: 120, // 1 beat = 0.5s
    timeSignature: '4/4',
    key: 'C',
    scale: 'major',
    isAutoKey: false
  },
  harmony: {
    chordBlocks: [
      { id: 'c1', chord: 'C', startBeat: 0, durationBeats: 4, voicing: 'default', inversion: 0, type: 'play' },
      { id: 'c2', chord: 'G', startBeat: 4, durationBeats: 4, voicing: 'default', inversion: 0, type: 'play' }
    ],
    styleMarkers: [
      { id: 'sm1', beat: 0, pattern: 'hold' },
      { id: 'sm2', beat: 4, pattern: 'quarters' }
    ],
    chordOctaveShift: 0,
    defaultPattern: 'hold'
  },
  tracks: [
    {
      id: 'track_lead',
      name: 'Lead',
      channelId: 'melody',
      color: '#ff00aa',
      notes: [
        { id: 'n1', note: 'E4', midi: 64, startBeat: 0, durationBeats: 2, velocity: 0.8 },
        { id: 'n2', note: 'G4', midi: 67, startBeat: 2, durationBeats: 2, velocity: 0.9 }
      ]
    },
    {
      id: 'track_bass',
      name: 'Bass',
      channelId: 'ch_bass',
      color: '#00e5ff',
      notes: [
        { id: 'n3', note: 'C2', midi: 36, startBeat: 0, durationBeats: 4, velocity: 0.85 }
      ]
    }
  ],
  activeTrackId: 'track_lead',
  drums: {
    patternChain: [],
    isPatternRepeatOn: true,
    activeDrumKitId: 'kit_1',
    currentDrumPatternEdit: 0,
    drumChannels: [
      {
        id: 'kick',
        name: 'Kick',
        sampleUrl: '/drums/kick.wav',
        volume: 80,
        pan: 0,
        muted: false,
        solo: false,
        patterns: [
          [
            { isActive: true, velocity: 0.9 },  // step 0 (beat 0)
            { isActive: false, velocity: 0 },
            { isActive: false, velocity: 0 },
            { isActive: false, velocity: 0 },
            { isActive: true, velocity: 0.9 },  // step 4 (beat 1)
            { isActive: false, velocity: 0 },
            { isActive: false, velocity: 0 },
            { isActive: false, velocity: 0 },
            { isActive: true, velocity: 0.9 },  // step 8 (beat 2)
            { isActive: false, velocity: 0 },
            { isActive: false, velocity: 0 },
            { isActive: false, velocity: 0 },
            { isActive: true, velocity: 0.9 },  // step 12 (beat 3)
            { isActive: false, velocity: 0 },
            { isActive: false, velocity: 0 },
            { isActive: false, velocity: 0 }
          ]
        ]
      }
    ]
  },
  mixer: {
    channels: {
      master: { id: 'master', name: 'Master', type: 'master', volume: 80, pan: 0, muted: false, solo: false, color: '#fff', instrument: 'synth' },
      chords: { id: 'chords', name: 'Chords', type: 'chords', volume: 80, pan: -0.2, muted: false, solo: false, color: '#00e5ff', instrument: 'synth' },
      melody: { id: 'melody', name: 'Melody', type: 'melody', volume: 80, pan: 0.2, muted: false, solo: false, color: '#ff00aa', instrument: 'synth' },
      ch_bass: { id: 'ch_bass', name: 'Bass', type: 'synth', volume: 80, pan: 0, muted: false, solo: false, color: '#00e5ff', instrument: 'synth' },
      drums: { id: 'drums', name: 'Drums', type: 'drums', volume: 80, pan: 0, muted: false, solo: false, color: '#ffaa00', instrument: 'sampler' }
    },
    channelOrder: ['master', 'chords', 'melody', 'ch_bass', 'drums']
  }
};

const scheduled = scheduleSessionTimeline(mockSession);

assert(scheduled.totalBeats === 8, 'Total beats calculated correctly as 8 beats');
assert(scheduled.totalDurationSeconds === 6.0, 'Total duration is 8 * 0.5s + 2.0s tail = 6.0s');
assert(scheduled.chordEvents.length > 0, `Scheduled ${scheduled.chordEvents.length} chord note events`);
assert(scheduled.trackEvents.length === 3, `Scheduled 3 melody track events across 2 tracks`);
assert(scheduled.trackEvents[0].note === 'E4' && scheduled.trackEvents[0].timeSeconds === 0, 'First melody note E4 scheduled at 0.0s');
assert(scheduled.trackEvents[1].note === 'G4' && scheduled.trackEvents[1].timeSeconds === 1.0, 'Second melody note G4 scheduled at 1.0s');
assert(scheduled.trackEvents[2].note === 'C2' && scheduled.trackEvents[2].channelId === 'ch_bass', 'Bass track note C2 mapped to ch_bass channel');
assert(scheduled.drumEvents.length === 8, `Scheduled 8 kick drum events across 2 measures (4 kicks per measure * 2)`);

console.log('\n--- 2. Testing Channel Mute and Solo Isolation in Offline Timeline ---');
const mutedSession: SessionV2 = {
  ...mockSession,
  mixer: {
    ...mockSession.mixer,
    channels: {
      ...mockSession.mixer.channels,
      chords: { ...mockSession.mixer.channels.chords, muted: true }
    }
  }
};

const mutedScheduled = scheduleSessionTimeline(mutedSession);
assert(mutedScheduled.chordEvents.length === 0, 'Muted chords channel produces 0 chord events');
assert(mutedScheduled.trackEvents.length === 3, 'Melody track events are unaffected when only chords are muted');

console.log('\n🎉 ALL OFFLINE AUDIO & SCHEDULER TESTS PASSED WITH 100% SUCCESS!');
