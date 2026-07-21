import pkg from '@tonejs/midi';
const { Midi } = pkg;
import {
  getChordNotes,
  invertChord,
  applyVoicing,
} from '../engine/scaleDefinitions';
import type { ChordBlock, MelodyNote } from './typeDefinitions';
import type { PatternDef } from '../patterns/patternTypes';

interface ExportedNote {
  name: string;
  timeBeats: number;
  durationBeats: number;
  velocity: number;
}

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

/**
 * Convierte un número MIDI de nota a su representación de texto (ej: 60 -> "C4")
 */
export function midiToNoteName(midi: number): string {
  const pitchClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pc = pitchClasses[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${pc}${octave}`;
}

/**
 * Obtiene las notas de un bloque aplicando inversión, voicing y el bajo de slash chord
 */
function getBlockNotes(block: ChordBlock): string[] {
  if (block.type === 'silence' || block.type === 'break') {
    return [];
  }

  let baseNotes = getChordNotes(block.chord, 4);
  if (baseNotes.length === 0) return [];

  if (block.voicing) {
    baseNotes = applyVoicing(baseNotes, block.voicing);
  }

  if (block.inversion) {
    baseNotes = invertChord(baseNotes, block.inversion);
  }

  // Tónica del acorde como bajo por defecto
  const rootNoteMatch = block.chord.match(/^([A-G]#?)/);
  const defaultBass = rootNoteMatch ? `${rootNoteMatch[1]}2` : baseNotes[0].replace(/[0-9]/g, '2');
  const bassNote = block.bassNote ? `${block.bassNote}2` : defaultBass;

  if (block.type === 'bass-only') {
    return [bassNote];
  }

  if (block.type === 'chord-only') {
    return baseNotes;
  }

  return [bassNote, ...baseNotes];
}

/**
 * Resuelve una nota de patrón MIDI (normalizada contra C major) a la armonía del acorde activo
 */
function resolvePatternNoteToChord(
  pn: { semitoneFromRoot: number; octaveOffset: number; voice: string },
  chordName: string,
  refOctave: number
): string {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const activeChordNotes = getChordNotes(chordName, refOctave);
  if (activeChordNotes.length === 0) {
    const rootMatch = chordName.split('/')[0].match(/^([A-G]#?)/);
    const rootName = rootMatch ? rootMatch[1] : 'C';
    const rootPC = NOTE_NAMES.indexOf(rootName);
    const targetPC = (rootPC + pn.semitoneFromRoot) % 12;
    const targetOctave = refOctave + pn.octaveOffset + Math.floor((rootPC + pn.semitoneFromRoot) / 12);
    return `${NOTE_NAMES[targetPC]}${targetOctave}`;
  }

  const rootNoteName = activeChordNotes[0].replace(/[0-9]/g, '');
  const rootPC = NOTE_NAMES.indexOf(rootNoteName);

  const activeSemitones = activeChordNotes.map(n => {
    const pc = NOTE_NAMES.indexOf(n.replace(/[0-9]/g, ''));
    const oct = parseInt(n.replace(/[^0-9]/g, ''));
    const relativeMidi = (pc + 12 * oct) - (rootPC + 12 * refOctave);
    return relativeMidi;
  });

  if (activeSemitones.length < 4) {
    activeSemitones.push(activeSemitones[0] + 12);
  }

  const targetSemitone = pn.semitoneFromRoot;
  let targetBaseIdx = 0;
  let refBaseSemitone = 0;

  if (targetSemitone <= 2) {
    targetBaseIdx = 0;
    refBaseSemitone = 0;
  } else if (targetSemitone <= 5) {
    targetBaseIdx = 1;
    refBaseSemitone = 4;
  } else if (targetSemitone <= 8) {
    targetBaseIdx = 2;
    refBaseSemitone = 7;
  } else {
    targetBaseIdx = 3;
    refBaseSemitone = 11;
  }

  const offset = targetSemitone - refBaseSemitone;
  const activeBaseSemitone = activeSemitones[targetBaseIdx];
  const finalRelativeSemitone = activeBaseSemitone + offset;

  const finalMidi = (rootPC + 12 * refOctave) + finalRelativeSemitone + (12 * pn.octaveOffset);
  const finalPC = ((finalMidi % 12) + 12) % 12;
  const finalOctave = Math.floor(finalMidi / 12) - 1;

  return `${NOTE_NAMES[finalPC]}${finalOctave}`;
}

/**
 * Renderiza un bloque de acorde aplicando el patrón rítmico seleccionado
 */
function renderChordPattern(
  block: ChordBlock,
  patternName: string,
  customPatterns: PatternDef[]
): ExportedNote[] {
  const notes = getBlockNotes(block);
  if (notes.length === 0) return [];

  const list: ExportedNote[] = [];
  const duration = block.durationBeats;

  if (patternName === 'hold') {
    notes.forEach(note => {
      list.push({
        name: note,
        timeBeats: block.startBeat,
        durationBeats: duration,
        velocity: 0.6
      });
    });
  } 
  else if (patternName === 'quarters') {
    for (let beat = 0; beat < duration - 0.01; beat += 1) {
      notes.forEach(note => {
        list.push({
          name: note,
          timeBeats: block.startBeat + beat,
          durationBeats: Math.min(0.8, duration - beat),
          velocity: 0.6
        });
      });
    }
  } 
  else if (patternName === 'eighths') {
    for (let beat = 0; beat < duration - 0.01; beat += 0.5) {
      notes.forEach(note => {
        list.push({
          name: note,
          timeBeats: block.startBeat + beat,
          durationBeats: Math.min(0.4, duration - beat),
          velocity: 0.55
        });
      });
    }
  } 
  else if (patternName === 'pop') {
    for (let measureStart = 0; measureStart < duration - 0.01; measureStart += 4) {
      const offsets = [
        { offset: 0, dur: 0.8, vel: 0.6 },
        { offset: 1.5, dur: 0.4, vel: 0.55 },
        { offset: 2.5, dur: 0.7, vel: 0.6 },
        { offset: 3.5, dur: 0.4, vel: 0.55 }
      ];
      offsets.forEach(({ offset, dur, vel }) => {
        const beat = measureStart + offset;
        if (beat < duration) {
          notes.forEach(note => {
            list.push({
              name: note,
              timeBeats: block.startBeat + beat,
              durationBeats: Math.min(dur, duration - beat),
              velocity: vel
            });
          });
        }
      });
    }
  } 
  else if (patternName === 'arpeggio') {
    if (notes.length > 1 && block.type !== 'chord-only') {
      list.push({
        name: notes[0],
        timeBeats: block.startBeat,
        durationBeats: duration,
        velocity: 0.7
      });
    }
    const arpNotes = (notes.length > 1 && block.type !== 'chord-only') ? notes.slice(1) : notes;
    const period = (arpNotes.length - 1) * 2;

    for (let beat = 0; beat < duration - 0.01; beat += 0.5) {
      const step = Math.round(beat / 0.5);
      let noteIndex = 0;
      if (period > 0) {
        const mod = step % period;
        noteIndex = mod < arpNotes.length ? mod : period - mod;
      }
      list.push({
        name: arpNotes[noteIndex],
        timeBeats: block.startBeat + beat,
        durationBeats: Math.min(0.4, duration - beat),
        velocity: 0.55
      });
    }
  } 
  else if (patternName === 'strum') {
    notes.forEach((note, index) => {
      const offsetBeats = index * 0.025;
      if (offsetBeats < duration) {
        list.push({
          name: note,
          timeBeats: block.startBeat + offsetBeats,
          durationBeats: duration - offsetBeats,
          velocity: Math.max(0.3, 0.6 - index * 0.05)
        });
      }
    });
  } 
  else {
    const customPattern = customPatterns.find(p => p.name === patternName);
    if (customPattern) {
      const cycleBeats = customPattern.totalBeats;
      for (let cycleStart = 0; cycleStart < duration - 0.01; cycleStart += cycleBeats) {
        customPattern.notes.forEach(pn => {
          if (block.type === 'bass-only' && pn.voice !== 'bass') return;
          if (block.type === 'chord-only' && pn.voice !== 'chord') return;

          const beat = cycleStart + pn.beatOffset;
          if (beat < duration) {
            const refOctave = pn.voice === 'bass' ? 2 : 4;
            const resolvedNoteName = resolvePatternNoteToChord(pn, block.chord, refOctave);
            list.push({
              name: resolvedNoteName,
              timeBeats: block.startBeat + beat,
              durationBeats: Math.min(pn.durationBeats, duration - beat),
              velocity: pn.velocity
            });
          }
        });
      }
    } else {
      notes.forEach(note => {
        list.push({
          name: note,
          timeBeats: block.startBeat,
          durationBeats: duration,
          velocity: 0.6
        });
      });
    }
  }

  return list;
}

/**
 * Detecta un acorde y su inversión a partir de una colección de números de nota MIDI concurrentes
 */
export function detectChordFromMidi(midiNumbers: number[]): { chord: string; inversion: number } {
  if (midiNumbers.length === 0) return { chord: 'C', inversion: 0 };

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

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

/**
 * Identifica el patrón rítmico comparando los offsets de las notas en el MIDI con las firmas de la app
 */
export function identifyPattern(
  harmonyNotes: { startBeat: number; durationBeats: number }[],
  chordBlocks: { startBeat: number; durationBeats: number }[],
  customPatterns: PatternDef[]
): string {
  if (chordBlocks.length === 0) return 'hold';

  const PATTERN_PROFILES: { name: string; expectedOffsets: number[] }[] = [
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

  const patternScores: Record<string, number> = {};
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
        const offsetNoteCounts = new Map<number, number>();
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

/**
 * Exporta el estado de la sesión a un ArrayBuffer de MIDI serializado
 */
export function exportSessionToMidi(session: any, type: 'normal' | 'project'): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(session.bpm);

  if (type === 'project') {
    const metadata = {
      version: '1.0',
      bpm: session.bpm,
      key: session.key,
      scale: session.scale,
      timeSignature: session.timeSignature,
      pattern: session.pattern,
      instrumentType: session.instrumentType,
      chordBlocks: session.chordBlocks,
      melodyNotes: session.melodyNotes,
    };
    
    midi.header.meta.push({
      text: `ComposerSessionMetadata:${JSON.stringify(metadata)}`,
      type: 'text',
      ticks: 0
    });
  }

  const melodyTrack = midi.addTrack();
  melodyTrack.name = 'Melody';

  const chordsTrack = midi.addTrack();
  chordsTrack.name = 'Chords';

  const beatDuration = 60 / session.bpm;

  session.melodyNotes.forEach((note: MelodyNote) => {
    melodyTrack.addNote({
      name: note.note,
      time: note.startBeat * beatDuration,
      duration: note.durationBeats * beatDuration,
      velocity: note.velocity
    });
  });

  session.chordBlocks.forEach((block: ChordBlock) => {
    if (type === 'project') {
      const notes = getBlockNotes(block);
      notes.forEach(note => {
        chordsTrack.addNote({
          name: note,
          time: block.startBeat * beatDuration,
          duration: block.durationBeats * beatDuration,
          velocity: 0.6
        });
      });
    } else {
      const rendered = renderChordPattern(block, session.pattern, session.customPatterns || []);
      rendered.forEach(n => {
        chordsTrack.addNote({
          name: n.name,
          time: n.timeBeats * beatDuration,
          duration: n.durationBeats * beatDuration,
          velocity: n.velocity
        });
      });
    }
  });

  return midi.toArray();
}

/**
 * Importa un archivo MIDI (ArrayBuffer) y lo convierte al estado de la sesión reconstructiva
 */
export function importMidiToSession(
  midiData: ArrayBuffer,
  customPatterns: PatternDef[]
): {
  success: boolean;
  isProject: boolean;
  bpm: number;
  key: string;
  scale: string;
  pattern: string;
  timeSignature: '4/4' | '3/4' | '6/8';
  chordBlocks: ChordBlock[];
  melodyNotes: MelodyNote[];
  message: string;
} {
  const midi = new Midi(midiData);
  const bpm = midi.header.tempos.length > 0 ? Math.round(midi.header.tempos[0].bpm) : 120;

  if (midi.header.meta && midi.header.meta.length > 0) {
    const metaEvent = midi.header.meta.find(e => e.text.startsWith('ComposerSessionMetadata:'));
    if (metaEvent) {
      try {
        const jsonStr = metaEvent.text.substring('ComposerSessionMetadata:'.length);
        const state = JSON.parse(jsonStr);
        return {
          success: true,
          isProject: true,
          bpm: state.bpm ?? bpm,
          key: state.key ?? 'C',
          scale: state.scale ?? 'major',
          pattern: state.pattern ?? 'hold',
          timeSignature: state.timeSignature ?? '4/4',
          chordBlocks: state.chordBlocks ?? [],
          melodyNotes: state.melodyNotes ?? [],
          message: 'Sesión de proyecto restaurada al 100% desde metadatos.'
        };
      } catch (e) {
        console.warn('[midiService] Falló el parseo de metadatos encajados:', e);
      }
    }
  }

  let melodyNotesRaw: any[] = [];
  let harmonyNotesRaw: any[] = [];

  const nonPercussionTracks = midi.tracks.filter(t => !t.instrument.percussion && t.channel !== 9);

  if (nonPercussionTracks.length === 0) {
    return {
      success: false,
      isProject: false,
      bpm,
      key: 'C',
      scale: 'major',
      pattern: 'hold',
      timeSignature: '4/4',
      chordBlocks: [],
      melodyNotes: [],
      message: 'El archivo MIDI no contiene pistas de notas legibles.'
    };
  }

  if (nonPercussionTracks.length === 1) {
    const trackNotes = nonPercussionTracks[0].notes;
    const notesByBeat: Record<number, any[]> = {};
    trackNotes.forEach(n => {
      const beat = Math.round((n.time * (bpm / 60)) * 4) / 4;
      if (!notesByBeat[beat]) notesByBeat[beat] = [];
      notesByBeat[beat].push(n);
    });

    Object.entries(notesByBeat).forEach(([_beatStr, notes]) => {
      if (notes.length === 1) {
        const note = notes[0];
        if (note.midi >= 60) {
          melodyNotesRaw.push(note);
        } else {
          harmonyNotesRaw.push(note);
        }
      } else {
        notes.sort((a, b) => b.midi - a.midi);
        const highest = notes[0];
        if (highest.midi >= 60) {
          melodyNotesRaw.push(highest);
          for (let i = 1; i < notes.length; i++) {
            harmonyNotesRaw.push(notes[i]);
          }
        } else {
          notes.forEach(n => harmonyNotesRaw.push(n));
        }
      }
    });
  } else {
    nonPercussionTracks.forEach(track => {
      const trackName = track.name.toLowerCase();
      
      const isExplicitMelody = /melody|vocal|lead|solo|flute|trumpet|sing|voice/i.test(trackName);
      const isExplicitHarmony = /chord|harmony|piano|keyboard|accomp|pad|synth|guitar/i.test(trackName);
      
      if (isExplicitMelody) {
        melodyNotesRaw.push(...track.notes);
        return;
      }
      if (isExplicitHarmony) {
        harmonyNotesRaw.push(...track.notes);
        return;
      }

      let overlapCount = 0;
      track.notes.forEach((n1, idx1) => {
        const overlaps = track.notes.some((n2, idx2) => {
          if (idx1 === idx2) return false;
          return n2.time >= n1.time && n2.time < n1.time + n1.duration;
        });
        if (overlaps) overlapCount++;
      });

      const polyphonyRatio = track.notes.length > 0 ? overlapCount / track.notes.length : 0;

      if (polyphonyRatio > 0.15) {
        harmonyNotesRaw.push(...track.notes);
      } else {
        melodyNotesRaw.push(...track.notes);
      }
    });
  }

  if (harmonyNotesRaw.length === 0 && melodyNotesRaw.length > 0) {
    harmonyNotesRaw = [...melodyNotesRaw];
  }

  const melodyNotes: MelodyNote[] = melodyNotesRaw.map(n => {
    const startBeat = Math.round((n.time * (bpm / 60)) * 4) / 4;
    const durationBeats = Math.max(0.25, Math.round((n.duration * (bpm / 60)) * 4) / 4);
    return {
      id: Math.random().toString(36).substr(2, 9),
      note: n.name,
      midi: n.midi,
      startBeat,
      durationBeats,
      velocity: n.velocity
    };
  });

  const harmonyNotesMapped = harmonyNotesRaw.map(n => {
    const startBeat = Math.round((n.time * (bpm / 60)) * 4) / 4;
    const durationBeats = Math.max(0.25, Math.round((n.duration * (bpm / 60)) * 4) / 4);
    return {
      midi: n.midi,
      startBeat,
      durationBeats
    };
  });

  let maxBeat = 0;
  harmonyNotesMapped.forEach(n => {
    maxBeat = Math.max(maxBeat, n.startBeat + n.durationBeats);
  });

  const stepChords: { chord: string; inversion: number }[] = [];
  for (let b = 0; b < maxBeat; b += 0.5) {
    const activeMidis = harmonyNotesMapped
      .filter(n => n.startBeat <= b + 0.05 && n.startBeat + n.durationBeats > b + 0.05)
      .map(n => n.midi);

    if (activeMidis.length > 0) {
      stepChords.push(detectChordFromMidi(activeMidis));
    } else {
      stepChords.push({ chord: '', inversion: 0 });
    }
  }

  const chordBlocks: ChordBlock[] = [];
  let currentBlock: any = null;

  for (let i = 0; i < stepChords.length; i++) {
    const sc = stepChords[i];
    const stepBeat = i * 0.5;

    if (currentBlock && currentBlock.chord === sc.chord && currentBlock.inversion === sc.inversion) {
      currentBlock.durationBeats += 0.5;
    } else {
      if (currentBlock && currentBlock.chord !== '') {
        chordBlocks.push({
          id: Math.random().toString(36).substr(2, 9),
          chord: currentBlock.chord,
          startBeat: currentBlock.startBeat,
          durationBeats: currentBlock.durationBeats,
          inversion: currentBlock.inversion,
          voicing: 'default'
        });
      }
      currentBlock = {
        chord: sc.chord,
        inversion: sc.inversion,
        startBeat: stepBeat,
        durationBeats: 0.5
      };
    }
  }
  if (currentBlock && currentBlock.chord !== '') {
    chordBlocks.push({
      id: Math.random().toString(36).substr(2, 9),
      chord: currentBlock.chord,
      startBeat: currentBlock.startBeat,
      durationBeats: currentBlock.durationBeats,
      inversion: currentBlock.inversion,
      voicing: 'default'
    });
  }

  const pattern = identifyPattern(harmonyNotesMapped, chordBlocks, customPatterns);

  let timeSignature: '4/4' | '3/4' | '6/8' = '4/4';
  if (midi.header.timeSignatures && midi.header.timeSignatures.length > 0) {
    const ts = midi.header.timeSignatures[0].timeSignature;
    const tsStr = `${ts[0]}/${ts[1]}`;
    if (tsStr === '4/4' || tsStr === '3/4' || tsStr === '6/8') {
      timeSignature = tsStr as any;
    }
  }

  return {
    success: true,
    isProject: false,
    bpm,
    key: 'C',
    scale: 'major',
    pattern,
    timeSignature,
    chordBlocks,
    melodyNotes,
    message: `MIDI estándar importado con éxito. Se detectaron ${chordBlocks.length} acordes y se identificó el patrón rítmico '${pattern}'.`
  };
}
