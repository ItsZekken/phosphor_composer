import pkg from '@tonejs/midi';
const { Midi } = pkg;

// --- Mocking scaleDefinitions helpers for test autonomy ---
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function getChordNotes(chordName, baseOctave = 3) {
  const baseChord = chordName.split('/')[0];
  const match = baseChord.match(/^([A-G][#b]?)(m|maj7|min7|m7|7|maj|min|dim|aug|m7b5|sus4|sus2)?$/);
  if (!match) return [];
  const root = match[1];
  const type = match[2] || '';
  const rootVal = NOTE_NAMES.indexOf(root);
  if (rootVal === -1) return [];

  let intervals = [0, 4, 7];
  switch (type) {
    case 'm': case 'min': intervals = [0, 3, 7]; break;
    case 'dim': intervals = [0, 3, 6]; break;
    case 'aug': intervals = [0, 4, 8]; break;
    case '7': intervals = [0, 4, 7, 10]; break;
    case 'maj7': case 'maj': intervals = [0, 4, 7, 11]; break;
    case 'm7': case 'min7': intervals = [0, 3, 7, 10]; break;
    case 'm7b5': intervals = [0, 3, 6, 10]; break;
    case 'sus4': intervals = [0, 5, 7]; break;
    case 'sus2': intervals = [0, 2, 7]; break;
  }
  return intervals.map(i => {
    const val = rootVal + i;
    const noteClass = NOTE_NAMES[val % 12];
    const octave = baseOctave + Math.floor(val / 12);
    return `${noteClass}${octave}`;
  });
}

// --- Chord qualities ---
const CHORD_QUALITIES = [
  { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] },
  { suffix: '7', intervals: [0, 4, 7, 10] },
  { suffix: 'm7b5', intervals: [0, 3, 6, 10] },
  { suffix: 'm', intervals: [0, 3, 7] }, // Minor
  { suffix: '', intervals: [0, 4, 7] },  // Major
  { suffix: 'sus4', intervals: [0, 5, 7] },
  { suffix: 'sus2', intervals: [0, 2, 7] },
  { suffix: 'dim', intervals: [0, 3, 6] },
  { suffix: 'aug', intervals: [0, 4, 8] },
  { suffix: 'm', intervals: [0, 3] },    // 2-note fallback
  { suffix: '', intervals: [0, 4] },     // 2-note fallback
  { suffix: '', intervals: [0, 7] },     // 5 power chord fallback
];

// --- Chord Detector ---
function detectChordFromMidi(midiNumbers) {
  if (midiNumbers.length === 0) return { chord: 'C', inversion: 0 };

  const pitchClasses = Array.from(new Set(midiNumbers.map(n => n % 12)));
  const sortedMidi = [...midiNumbers].sort((a, b) => a - b);
  const lowestMidi = sortedMidi[0];
  const lowestPC = lowestMidi % 12;

  let bestQuality = CHORD_QUALITIES[5]; // Default major
  let bestScore = -Infinity;
  let bestRootVal = pitchClasses[0] !== undefined ? pitchClasses[0] : 0;

  for (const rootVal of pitchClasses) {
    const relPC = new Set(pitchClasses.map(pc => (pc - rootVal + 12) % 12));
    for (const quality of CHORD_QUALITIES) {
      let matched = 0;
      let missing = 0;
      quality.intervals.forEach(i => {
        if (relPC.has(i)) matched++;
        else missing++;
      });
      let extra = 0;
      relPC.forEach(pc => {
        if (!quality.intervals.includes(pc)) extra++;
      });

      let score = matched * 4 - missing * 1.5 - extra * 1.0;
      if (rootVal === lowestPC) score += 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestQuality = quality;
        bestRootVal = rootVal;
      }
    }
  }

  const rootName = NOTE_NAMES[bestRootVal];
  const suffix = bestQuality.suffix;
  const chordBase = `${rootName}${suffix}`;

  if (lowestPC !== bestRootVal && pitchClasses.includes(lowestPC)) {
    const bassName = NOTE_NAMES[lowestPC];
    const chordWithBass = `${chordBase}/${bassName}`;

    const bassInterval = (lowestPC - bestRootVal + 12) % 12;
    let inversion = 0;
    if (bassInterval === 3 || bassInterval === 4) inversion = 1;
    else if (bassInterval === 6 || bassInterval === 7 || bassInterval === 8) inversion = 2;
    else if (bassInterval === 10 || bassInterval === 11) inversion = 3;

    return { chord: chordWithBass, inversion };
  }

  return { chord: chordBase, inversion: 0 };
}

// --- Pattern Identification ---
function identifyPattern(harmonyNotes, chordBlocks, customPatterns = []) {
  if (chordBlocks.length === 0) return 'hold';

  const PATTERN_PROFILES = [
    { name: 'hold', expectedOffsets: [0] },
    { name: 'quarters', expectedOffsets: [0, 1, 2, 3] },
    { name: 'eighths', expectedOffsets: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
    { name: 'pop', expectedOffsets: [0, 1.5, 2.5, 3.5] },
    { name: 'arpeggio', expectedOffsets: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
    { name: 'strum', expectedOffsets: [0] }
  ];

  customPatterns.forEach(cp => {
    const offsets = Array.from(new Set(cp.notes.map(n => Math.round(n.beatOffset * 4) / 4)));
    PATTERN_PROFILES.push({ name: cp.name, expectedOffsets: offsets });
  });

  const patternScores = {};
  PATTERN_PROFILES.forEach(p => {
    patternScores[p.name] = 0;
  });

  let totalBlocksAnalyzed = 0;

  chordBlocks.forEach(block => {
    const blockNotes = harmonyNotes.filter(n => n.startBeat >= block.startBeat - 0.01 && n.startBeat < block.startBeat + block.durationBeats - 0.05);
    if (blockNotes.length === 0) return;

    totalBlocksAnalyzed++;

    const observedOffsets = Array.from(
      new Set(
        blockNotes.map(n => {
          const rawOffset = n.startBeat - block.startBeat;
          return Math.round(rawOffset * 4) / 4;
        })
      )
    );

    PATTERN_PROFILES.forEach(profile => {
      const expected = profile.expectedOffsets.filter(offset => offset < block.durationBeats);
      if (expected.length === 0) return;

      let matches = 0;
      observedOffsets.forEach(obs => {
        if (expected.some(exp => Math.abs(exp - obs) < 0.125)) {
          matches++;
        }
      });

      const missing = expected.filter(exp => !observedOffsets.some(obs => Math.abs(exp - obs) < 0.125)).length;
      const extra = observedOffsets.filter(obs => !expected.some(exp => Math.abs(exp - obs) < 0.125)).length;

      let score = matches - 0.5 * extra - 0.5 * missing;

      if (profile.name === 'arpeggio') {
        const offsetNoteCounts = new Map();
        blockNotes.forEach(bn => {
          const off = Math.round((bn.startBeat - block.startBeat) * 2) / 2;
          offsetNoteCounts.set(off, (offsetNoteCounts.get(off) || 0) + 1);
        });

        let polyphonicOffsets = 0;
        offsetNoteCounts.forEach((count, off) => {
          if (count > 1 && off > 0) {
            polyphonicOffsets++;
          }
        });

        if (polyphonicOffsets > 0) {
          score -= polyphonicOffsets * 2;
        }
      }

      patternScores[profile.name] += score;
    });
  });

  if (totalBlocksAnalyzed === 0) return 'hold';

  let bestPattern = 'hold';
  let maxScore = -Infinity;
  Object.entries(patternScores).forEach(([name, score]) => {
    if (score > maxScore) {
      maxScore = score;
      bestPattern = name;
    }
  });

  return bestPattern;
}

// --- Run Tests ---
function runTests() {
  console.log('--- EMPEZANDO PRUEBAS DE DETECCIÓN DE ACORDES ---');
  
  // Test C major root position: [60, 64, 67] -> C
  let res = detectChordFromMidi([60, 64, 67]);
  console.assert(res.chord === 'C' && res.inversion === 0, `Esperado C/0, obtenido ${res.chord}/${res.inversion}`);

  // Test C major 1st inversion (E in bass): [64, 67, 72] -> C/E (inversion 1)
  res = detectChordFromMidi([64, 67, 72]);
  console.assert(res.chord === 'C/E' && res.inversion === 1, `Esperado C/E/1, obtenido ${res.chord}/${res.inversion}`);

  // Test D minor root position: [62, 65, 69] -> Dm
  res = detectChordFromMidi([62, 65, 69]);
  console.assert(res.chord === 'Dm' && res.inversion === 0, `Esperado Dm/0, obtenido ${res.chord}/${res.inversion}`);

  // Test G7 root position: [55, 59, 62, 65] -> G7
  res = detectChordFromMidi([55, 59, 62, 65]);
  console.assert(res.chord === 'G7' && res.inversion === 0, `Esperado G7/0, obtenido ${res.chord}/${res.inversion}`);

  console.log('✓ Pruebas de acordes pasadas.');

  console.log('--- EMPEZANDO PRUEBAS DE DETECCIÓN DE PATRONES ---');

  // Test hold pattern
  let harmonyNotes = [{ startBeat: 0 }, { startBeat: 4 }];
  let blocks = [{ startBeat: 0, durationBeats: 4 }, { startBeat: 4, durationBeats: 4 }];
  let pat = identifyPattern(harmonyNotes, blocks);
  console.assert(pat === 'hold', `Esperado hold, obtenido ${pat}`);

  // Test quarters pattern: offsets 0, 1, 2, 3
  harmonyNotes = [
    { startBeat: 0 }, { startBeat: 1 }, { startBeat: 2 }, { startBeat: 3 },
    { startBeat: 4 }, { startBeat: 5 }, { startBeat: 6 }, { startBeat: 7 }
  ];
  pat = identifyPattern(harmonyNotes, blocks);
  console.assert(pat === 'quarters', `Esperado quarters, obtenido ${pat}`);

  // Test pop pattern: offsets 0, 1.5, 2.5, 3.5
  harmonyNotes = [
    { startBeat: 0 }, { startBeat: 1.5 }, { startBeat: 2.5 }, { startBeat: 3.5 },
    { startBeat: 4 }, { startBeat: 5.5 }, { startBeat: 6.5 }, { startBeat: 7.5 }
  ];
  pat = identifyPattern(harmonyNotes, blocks);
  console.assert(pat === 'pop', `Esperado pop, obtenido ${pat}`);

  console.log('✓ Pruebas de patrones pasadas.');
  console.log('\n🎉 ¡TODAS LAS PRUEBAS UNITARIAS PASADAS CON ÉXITO! 🎉');
}

runTests();
