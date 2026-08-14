/**
 * scripts/test-mixer-solo-mute.ts
 * Suite de pruebas para verificar el comportamiento de Solo y Mute en el grafo del Mixer
 */

import { MixerGraph } from '../src/core/audio/engine/MixerGraph';
import type { ChannelConfig } from '../src/utils/typeDefinitions';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('--- 1. Testing MixerGraph Master Channel Isolation on Sub-Channel Solo ---');

const graph = new MixerGraph();

const testChannels: Record<string, ChannelConfig> = {
  master: { id: 'master', name: 'Master', type: 'master', volume: 80, pan: 0, muted: false, solo: false, color: '#fff', instrument: 'synth' },
  chords: { id: 'chords', name: 'Acordes', type: 'chords', volume: 80, pan: 0, muted: false, solo: false, color: '#00ffcc', instrument: 'synth' },
  melody: { id: 'melody', name: 'Melodía', type: 'melody', volume: 80, pan: 0, muted: false, solo: false, color: '#ff00aa', instrument: 'synth' },
  drums: { id: 'drums', name: 'Batería', type: 'drums', volume: 80, pan: 0, muted: false, solo: false, color: '#ffaa00', instrument: 'sampler' }
};

// Estado inicial: todo sin solo ni mute
graph.syncChannels(testChannels);
assert(graph.getChannelNode('master').volumeNode.mute === false, 'Master is NOT muted initially');
assert(graph.getChannelNode('drums').volumeNode.mute === false, 'Drums is NOT muted initially');
assert(graph.getChannelNode('chords').volumeNode.mute === false, 'Chords is NOT muted initially');

// 2. Solear Batería (drums.solo = true)
console.log('\n--- 2. Testing Solo on Drums ---');
const soloDrumsChannels = {
  ...testChannels,
  drums: { ...testChannels.drums, solo: true }
};
graph.syncChannels(soloDrumsChannels);

assert(graph.getChannelNode('master').volumeNode.mute === false, 'CRITICAL: Master remains UNMUTED when Drums is in Solo');
assert(graph.getChannelNode('drums').volumeNode.mute === false, 'Drums remains UNMUTED when Drums is in Solo');
assert(graph.getChannelNode('chords').volumeNode.mute === true, 'Chords is muted when Drums is in Solo');
assert(graph.getChannelNode('melody').volumeNode.mute === true, 'Melody is muted when Drums is in Solo');

// 3. Mutear Batería
console.log('\n--- 3. Testing Mute on Drums ---');
const muteDrumsChannels = {
  ...testChannels,
  drums: { ...testChannels.drums, muted: true, solo: false }
};
graph.syncChannels(muteDrumsChannels);

assert(graph.getChannelNode('master').volumeNode.mute === false, 'Master remains UNMUTED when Drums is Muted');
assert(graph.getChannelNode('drums').volumeNode.mute === true, 'Drums is Muted');
assert(graph.getChannelNode('chords').volumeNode.mute === false, 'Chords is audible when Drums is Muted');
assert(graph.getChannelNode('melody').volumeNode.mute === false, 'Melody is audible when Drums is Muted');

console.log('\n🎉 ALL MIXER SOLO & MUTE TESTS PASSED WITH 100% SUCCESS!\n');
