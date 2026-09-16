import {
  faderPosToDb,
  dbToFaderPos,
  normalizeTrackDb,
  formatDb,
  dbToLinearGain
} from '../src/core/audio/engine/audioTrackMath';

console.log('--- Testing Audio Track Math & Fader dB Scaling ---');

// 1. Ganancia Unitaria (0 dB)
const unityDb = faderPosToDb(0.75);
if (Math.abs(unityDb) > 0.1) throw new Error(`Expected 0 dB at 0.75 pos, got ${unityDb}`);
console.log('✅ PASS: Unity gain 0 dB at 75% fader travel');

const unityPos = dbToFaderPos(0);
if (Math.abs(unityPos - 0.75) > 0.01) throw new Error(`Expected 0.75 pos for 0 dB, got ${unityPos}`);
console.log('✅ PASS: dbToFaderPos(0 dB) returns 0.75');

// 2. Headroom máximo (+24 dB)
const maxDb = faderPosToDb(1.0);
if (Math.abs(maxDb - 24) > 0.1) throw new Error(`Expected +24 dB at 1.0 pos, got ${maxDb}`);
console.log('✅ PASS: Max boost +24 dB at 100% fader travel');

const maxPos = dbToFaderPos(24);
if (Math.abs(maxPos - 1.0) > 0.01) throw new Error(`Expected 1.0 pos for +24 dB, got ${maxPos}`);
console.log('✅ PASS: dbToFaderPos(+24 dB) returns 1.0');

// 3. Silencio / -∞ dB
const minDb = faderPosToDb(0.01);
if (isFinite(minDb)) throw new Error(`Expected -Infinity at pos <= 0.02, got ${minDb}`);
console.log('✅ PASS: Cut to -Infinity at pos <= 0.02');

const minPos = dbToFaderPos(-Infinity);
if (minPos !== 0) throw new Error(`Expected 0 pos for -Infinity, got ${minPos}`);
console.log('✅ PASS: dbToFaderPos(-Infinity) returns 0');

// 4. Formato de visualización
if (formatDb(-Infinity) !== '-∞') throw new Error(`Expected '-∞', got ${formatDb(-Infinity)}`);
if (formatDb(0) !== '0.0') throw new Error(`Expected '0.0', got ${formatDb(0)}`);
if (formatDb(3.5) !== '+3.5') throw new Error(`Expected '+3.5', got ${formatDb(3.5)}`);
if (formatDb(-6.2) !== '-6.2') throw new Error(`Expected '-6.2', got ${formatDb(-6.2)}`);
console.log('✅ PASS: dB format strings render properly (-∞, 0.0, +3.5, -6.2)');

// 5. Ganancia lineal para Web Audio
if (Math.abs(dbToLinearGain(0) - 1.0) > 0.001) throw new Error('0 dB linear gain must be 1.0');
if (dbToLinearGain(-Infinity) !== 0) throw new Error('-Infinity linear gain must be 0');
console.log('✅ PASS: Linear gain conversions match Web Audio specs');

// 6. Compatibilidad hacia atrás (80 -> 0 dB)
if (normalizeTrackDb(80) !== 0) throw new Error('Legacy volume 80 must normalize to 0 dB');
if (normalizeTrackDb(0) !== 0) throw new Error('Volume 0 dB preserved');
if (normalizeTrackDb(-12) !== -12) throw new Error('Volume -12 dB preserved');
console.log('✅ PASS: Legacy session compatibility (80 -> 0 dB) verified');

console.log('\n🎉 ALL AUDIO TRACK MATH TESTS PASSED WITH 100% SUCCESS!');
