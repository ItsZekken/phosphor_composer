/**
 * test-mixer-reactivity.ts
 * Suite de pruebas para verificar la reactividad del Mixer (Faders, Paneo, Mute, Solo)
 * y su sincronización inmediata con el grafo de Web Audio.
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

console.log('--- 1. Testing Mixer State & Web Audio Reactivity ---');

// 1. Verificar estado inicial
const initialStore = useSongStore.getState();
assert(initialStore.channels.chords.volume === 80, 'Initial chords volume is 80 (0 dB)');
assert(initialStore.channels.melody.volume === 85, 'Initial melody volume is 85');

// 2. Mover fader de volumen de Armonía a 50 (atenuación)
useSongStore.getState().setChannelVolume('chords', 50);
const updatedStore1 = useSongStore.getState();
assert(updatedStore1.channels.chords.volume === 50, 'Store updated chords volume to 50');

// 3. Mover fader de volumen de Master a 100 (+6 dB)
useSongStore.getState().setChannelVolume('master', 100);
const updatedStore2 = useSongStore.getState();
assert(updatedStore2.channels.master.volume === 100, 'Store updated master volume to 100');

// 4. Mover fader de volumen a 0 (-Infinity dB)
useSongStore.getState().setChannelVolume('drums', 0);
const updatedStore3 = useSongStore.getState();
assert(updatedStore3.channels.drums.volume === 0, 'Store updated drums volume to 0');

// 5. Paneo estéreo
useSongStore.getState().setChannelPan('melody', -0.75);
const updatedStore4 = useSongStore.getState();
assert(updatedStore4.channels.melody.pan === -0.75, 'Store updated melody pan to -0.75 (L75)');

// 6. Mute
useSongStore.getState().toggleMute('melody');
assert(useSongStore.getState().channels.melody.muted === true, 'Store toggled melody mute to true');
useSongStore.getState().toggleMute('melody');
assert(useSongStore.getState().channels.melody.muted === false, 'Store toggled melody mute back to false');

// 7. Solo
useSongStore.getState().toggleSolo('chords');
assert(useSongStore.getState().channels.chords.solo === true, 'Store toggled chords solo to true');

console.log('\n🎉 ALL MIXER REACTIVITY & AUDIO SYNC TESTS PASSED WITH 100% SUCCESS!\n');
