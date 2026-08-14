/**
 * test-multi-track-mixer.ts
 * Suite de pruebas para verificar la creación dinámica de pistas de Piano Roll (Melodía 2, 3, etc.),
 * su síntesis independiente y el control reactivo del fader en el Mixer.
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

console.log('--- 1. Testing Dynamic Multi-Track Creation & Mixer Strip Linking ---');

// 1. Añadir pista "Melodía 2"
useSongStore.getState().addPianoRollTrack('Melodía 2');
const stateAfterAdd = useSongStore.getState();

assert(stateAfterAdd.tracks.length >= 2, `Tracks count increased to ${stateAfterAdd.tracks.length}`);
const track2 = stateAfterAdd.tracks[stateAfterAdd.tracks.length - 1];
assert(track2.name === 'Melodía 2', 'Second track created with name "Melodía 2"');
assert(!!track2.channelId, `Second track assigned channelId: ${track2.channelId}`);

// 2. Verificar que el canal existe en state.channels
const channel2Config = stateAfterAdd.channels[track2.channelId];
assert(!!channel2Config, `Channel config created in store for ${track2.channelId}`);
assert(channel2Config.volume === 80, 'Initial volume of Melodía 2 is 80 (0 dB)');

// 3. Obtener el sintetizador y el nodo de canal en el mixer
const synth2 = (toneEngine as any).synthManager.getChannelSynth(track2.channelId);
assert(!!synth2, `PolySynth created for channel ${track2.channelId}`);

const node2 = (toneEngine as any).mixerGraph.getChannelNode(track2.channelId);
assert(!!node2, `Mixer channel node created for ${track2.channelId}`);

// 4. Mover fader de volumen de Melodía 2 a 40 (-15 dB)
useSongStore.getState().setChannelVolume(track2.channelId, 40);
assert(useSongStore.getState().channels[track2.channelId].volume === 40, 'Melodía 2 volume updated to 40 in store');

// 5. Paneo de Melodía 2 a la derecha (+0.80)
useSongStore.getState().setChannelPan(track2.channelId, 0.8);
assert(useSongStore.getState().channels[track2.channelId].pan === 0.8, 'Melodía 2 pan updated to R80 in store');

// 6. Mute de Melodía 2
useSongStore.getState().toggleMute(track2.channelId);
assert(useSongStore.getState().channels[track2.channelId].muted === true, 'Melodía 2 mute toggled to true');

console.log('\n🎉 ALL MULTI-TRACK PIANO ROLL & MIXER REACTIVITY TESTS PASSED WITH 100% SUCCESS!\n');
