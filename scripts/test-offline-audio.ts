/**
 * scripts/test-offline-audio.ts
 * Suite de pruebas para Timeline Scheduler, Masterizado y Renderizado Offline a WAV
 */

import { scheduleSessionTimeline } from '../src/core/audio/timelineScheduler';
import type { SessionV2 } from '../src/core/session/sessionTypes';
import { audioBufferToWav } from '../src/utils/wavEncoder';

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

console.log('\n--- 3. Testing WAV Encoder & True Peak Normalization ---');

// Mock de AudioBuffer estéreo a 44.1kHz con señal que excede 1.0 (clipping sintético)
const sampleRate = 44100;
const length = 4410; // 100ms
const leftChannel = new Float32Array(length);
const rightChannel = new Float32Array(length);

// Inyectar pico de 1.8 (sobremodulado)
for (let i = 0; i < length; i++) {
  leftChannel[i] = Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 1.8;
  rightChannel[i] = Math.cos(2 * Math.PI * 440 * (i / sampleRate)) * 1.8;
}

const mockAudioBuffer = {
  numberOfChannels: 2,
  sampleRate,
  length,
  getChannelData: (c: number) => (c === 0 ? leftChannel : rightChannel)
} as any;

const encodedWav = audioBufferToWav(mockAudioBuffer, { normalize: true, targetPeakDb: -0.3 });
assert(encodedWav instanceof ArrayBuffer, 'WAV encoder returns valid ArrayBuffer');

const expectedByteLength = 44 + (length * 2 * 2); // 44 header + 4410 samples * 2 channels * 2 bytes/sample
assert(encodedWav.byteLength === expectedByteLength, `WAV file size is exact (${encodedWav.byteLength} bytes)`);

// Verificar encabezado RIFF
const view = new DataView(encodedWav);
const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
assert(riff === 'RIFF', 'Header contains RIFF identifier');
assert(wave === 'WAVE', 'Header contains WAVE identifier');

// Verificar que las muestras estén dentro de [-32768, 32767] sin desbordamiento
let maxIntSample = 0;
for (let i = 44; i < encodedWav.byteLength; i += 2) {
  const sample = view.getInt16(i, true);
  maxIntSample = Math.max(maxIntSample, Math.abs(sample));
}
// Con targetPeakDb = -0.3, el pico máximo de 32767 * 10^(-0.3/20) ~ 31652
assert(maxIntSample <= 32767 && maxIntSample >= 31000, `True Peak normalized successfully to target range (peak sample: ${maxIntSample})`);

// Probar que señales suaves (pico = 0.25 por fader bajo) se preservan intactas sin sobre-amplificar
const quietLeft = new Float32Array(length);
const quietRight = new Float32Array(length);
for (let i = 0; i < length; i++) {
  quietLeft[i] = 0.25 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
  quietRight[i] = 0.25 * Math.cos(2 * Math.PI * 440 * (i / sampleRate));
}
const quietBuffer = {
  numberOfChannels: 2,
  sampleRate,
  length,
  getChannelData: (c: number) => (c === 0 ? quietLeft : quietRight)
} as any;
const encodedQuietWav = audioBufferToWav(quietBuffer, { normalize: true, targetPeakDb: -0.3 });
const quietView = new DataView(encodedQuietWav);
let maxQuietSample = 0;
for (let i = 44; i < encodedQuietWav.byteLength; i += 2) {
  const sample = quietView.getInt16(i, true);
  maxQuietSample = Math.max(maxQuietSample, Math.abs(sample));
}
// 32767 * 0.25 = ~8192
assert(maxQuietSample <= 8300 && maxQuietSample >= 8000, `Fader volume preserved faithfully without artificial amplification (got ${maxQuietSample}, expected ~8192)`);

console.log('\n🎉 ALL OFFLINE AUDIO, SCHEDULER & WAV MASTERING TESTS PASSED WITH 100% SUCCESS!\n');
