import pkg, { Midi as NamedMidi } from '@tonejs/midi';
const Midi = NamedMidi || (pkg as any)?.Midi || (pkg as any);
import {
  midiToNote,
  renderChordPattern,
  segmentChordBlockByStyleMarkers,
  getBlockNotes,
  createTempoMap
} from '../core/music';
import {
  flattenPatternChain,
  type ChordBlock,
  type MelodyNote,
  type TempoMarker,
  type PianoRollTrack,
  type DrumChannel,
  type PatternChainItem,
  type StyleMarker
} from './typeDefinitions';
import type { PatternDef } from '../patterns/patternTypes';

export const midiToNoteName = midiToNote;

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
 * Mapea un canal de batería o su nombre a la nota MIDI estándar de General MIDI Percussion (Canal 10).
 */
export function getDrumGMNote(channelId: string, channelName?: string): number {
  const str = `${channelId} ${channelName || ''}`.toLowerCase();
  if (str.includes('kick') || str.includes('bombo') || str.includes('bd') || str.includes('bassdrum')) return 36; // Bass Drum 1
  if (str.includes('snare') || str.includes('tarola') || str.includes('caja') || str.includes('sd')) return 38; // Acoustic Snare
  if (str.includes('clap') || str.includes('aplauso') || str.includes('handclap')) return 39; // Hand Clap
  if (str.includes('rim') || str.includes('sidestick')) return 37; // Side Stick
  if (str.includes('closed') || str.includes('hihat (c)') || str.includes('hh_c') || str.includes('ch') || str.includes('hihat_closed')) return 42; // Closed Hi-Hat
  if (str.includes('pedal') || str.includes('foot')) return 44; // Pedal Hi-Hat
  if (str.includes('open') || str.includes('hihat (o)') || str.includes('hh_o') || str.includes('oh') || str.includes('hihat_open')) return 46; // Open Hi-Hat
  if (str.includes('crash') || str.includes('platillo')) return 49; // Crash Cymbal 1
  if (str.includes('splash')) return 55; // Splash Cymbal
  if (str.includes('ride')) return 51; // Ride Cymbal 1
  if (str.includes('tom_low') || str.includes('low tom')) return 41; // Low Floor Tom
  if (str.includes('tom_mid') || str.includes('mid tom')) return 45; // Low Tom
  if (str.includes('tom_hi') || str.includes('high tom')) return 48; // Hi-Mid Tom
  if (str.includes('tambourine') || str.includes('pandereta')) return 54; // Tambourine
  if (str.includes('cowbell') || str.includes('cencerro')) return 56; // Cowbell
  if (str.includes('shaker') || str.includes('maraca')) return 70; // Maracas
  return 36;
}

export interface ExportSessionMidiParams {
  bpm?: number;
  tempoMarkers?: TempoMarker[];
  key?: string;
  scale?: string;
  timeSignature?: string;
  pattern?: string;
  styleMarkers?: StyleMarker[];
  chordOctaveShift?: number;
  chordBlocks?: ChordBlock[];
  tracks?: PianoRollTrack[];
  melodyNotes?: MelodyNote[];
  drumChannels?: DrumChannel[];
  patternChain?: PatternChainItem[];
  isPatternRepeatOn?: boolean;
  currentDrumPatternEdit?: number;
  customPatterns?: PatternDef[];
  channels?: Record<string, any>;
  instrumentType?: string;
  activeDrumKitId?: string;
}

/**
 * Exporta el estado de la sesión a un archivo MIDI multicanal estándar (SMF Tipo 1)
 * con canales dedicados por pista, patrones rítmicos procesados y percusión GM en el canal 10.
 */
export function exportSessionToMidi(session: ExportSessionMidiParams, type: 'normal' | 'project' = 'normal'): Uint8Array {
  const midi = new Midi();
  const bpm = session.bpm || 120;
  const tempoMap = createTempoMap(bpm, session.tempoMarkers || []);
  midi.header.setTempo(bpm);

  // 1. Meta-eventos de Tempo Changes progresivos
  if (tempoMap.segments.length > 1) {
    tempoMap.segments.forEach(seg => {
      if (seg.startBeat > 0) {
        midi.header.tempos.push({
          bpm: seg.bpm,
          ticks: Math.round(seg.startBeat * (midi.header.ppq || 480))
        });
      }
    });
  }

  // 2. Meta-eventos de Compás (Time Signature) y Tonalidad (Key Signature)
  if (session.timeSignature) {
    const parts = session.timeSignature.split('/').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
      midi.header.timeSignatures = [{
        ticks: 0,
        timeSignature: [parts[0], parts[1]]
      }];
    }
  }

  midi.header.update();

  // 3. Metadatos de Proyecto (para serialización completa)
  if (type === 'project') {
    const metadata = {
      version: '2.0',
      bpm: session.bpm,
      tempoMarkers: session.tempoMarkers || [],
      key: session.key,
      scale: session.scale,
      timeSignature: session.timeSignature,
      pattern: session.pattern,
      instrumentType: session.instrumentType,
      chordBlocks: session.chordBlocks,
      tracks: session.tracks,
      melodyNotes: session.melodyNotes,
      channels: session.channels,
      drumChannels: session.drumChannels,
      patternChain: session.patternChain,
      isPatternRepeatOn: session.isPatternRepeatOn,
      activeDrumKitId: session.activeDrumKitId,
      chordOctaveShift: session.chordOctaveShift,
      currentDrumPatternEdit: session.currentDrumPatternEdit,
      styleMarkers: session.styleMarkers
    };

    midi.header.meta.push({
      text: `ComposerSessionMetadata:${JSON.stringify(metadata)}`,
      type: 'text',
      ticks: 0
    });
  }

  // 4. Calcular maxBeat de la composición
  let maxBeat = 16;
  (session.chordBlocks || []).forEach(b => {
    maxBeat = Math.max(maxBeat, (b.startBeat || 0) + (b.durationBeats || 4));
  });
  (session.tracks || []).forEach(t => {
    (t.notes || []).forEach(n => {
      maxBeat = Math.max(maxBeat, (n.startBeat || 0) + (n.durationBeats || 1));
    });
  });
  (session.melodyNotes || []).forEach(n => {
    maxBeat = Math.max(maxBeat, (n.startBeat || 0) + (n.durationBeats || 1));
  });

  // 5. Pista 1: Armonía / Acordes (Canal MIDI 1 / index 0)
  if (session.chordBlocks && session.chordBlocks.length > 0) {
    const chordsTrack = midi.addTrack();
    chordsTrack.name = 'Chords';
    chordsTrack.channel = 0; // Canal MIDI 1

    session.chordBlocks.forEach((block: ChordBlock) => {
      if (type === 'project') {
        const notes = getBlockNotes(block);
        notes.forEach(note => {
          chordsTrack.addNote({
            name: note,
            time: tempoMap.beatToSeconds(block.startBeat),
            duration: Math.max(0.05, tempoMap.getDurationSeconds(block.startBeat, block.durationBeats)),
            velocity: 0.7
          });
        });
      } else {
        const segments = segmentChordBlockByStyleMarkers(
          block,
          session.styleMarkers || [],
          session.pattern || 'hold'
        );

        segments.forEach((seg) => {
          const rendered = renderChordPattern(
            seg.block,
            seg.pattern,
            session.customPatterns || [],
            session.chordOctaveShift || 0
          );

          rendered.forEach((rn) => {
            chordsTrack.addNote({
              name: rn.name,
              time: tempoMap.beatToSeconds(rn.timeBeats),
              duration: Math.max(0.05, tempoMap.getDurationSeconds(rn.timeBeats, rn.durationBeats)),
              velocity: typeof rn.velocity === 'number' ? Math.max(0.1, Math.min(1.0, rn.velocity)) : 0.75
            });
          });
        });
      }
    });
  }

  // 6. Pistas 2..N: Pistas de Piano Roll / Melodías (Canales MIDI 2..9, 11..16)
  const tracksToExport = (session.tracks && session.tracks.length > 0)
    ? session.tracks
    : (session.melodyNotes && session.melodyNotes.length > 0
        ? [{ id: 'melody_default', name: 'Melody', channelId: 'melody', color: '#6880ad', notes: session.melodyNotes }]
        : []);

  tracksToExport.forEach((track, trackIdx) => {
    const notes = track.notes || [];
    if (notes.length === 0 && tracksToExport.length > 1) return;

    const midiTrack = midi.addTrack();
    midiTrack.name = track.name || `Melody ${trackIdx + 1}`;

    // Asignar canal MIDI dedicado evitando el 9 (Canal 10 de percusión)
    let assignedChannel = 1 + trackIdx;
    if (assignedChannel >= 9) assignedChannel += 1;
    if (assignedChannel > 15) assignedChannel = (assignedChannel % 16);
    if (assignedChannel === 9) assignedChannel = 10;
    midiTrack.channel = assignedChannel;

    notes.forEach((note: MelodyNote) => {
      midiTrack.addNote({
        name: note.note,
        time: tempoMap.beatToSeconds(note.startBeat),
        duration: Math.max(0.05, tempoMap.getDurationSeconds(note.startBeat, note.durationBeats)),
        velocity: typeof note.velocity === 'number' ? Math.max(0.1, Math.min(1.0, note.velocity)) : 0.8
      });
    });
  });

  // 7. Pista N+1: Percusión / Batería (Canal MIDI 10 / index 9)
  const drumChannels = session.drumChannels || [];
  if (drumChannels.length > 0) {
    const drumsTrack = midi.addTrack();
    drumsTrack.name = 'Drums';
    drumsTrack.channel = 9; // Canal MIDI 10 estándar GM Percussion

    const patternChain = session.patternChain || [];
    const isPatternRepeatOn = session.isPatternRepeatOn;

    if (!isPatternRepeatOn && patternChain.length > 0) {
      const flatChain = flattenPatternChain(patternChain);
      const totalMeasures = flatChain.length;
      maxBeat = Math.max(maxBeat, totalMeasures * 4);

      flatChain.forEach((step, measureIdx) => {
        const patternIdx = step.patternIndex;
        if (patternIdx < 0) return;
        const measureStartBeat = measureIdx * 4;

        for (let stepIdx = 0; stepIdx < 16; stepIdx++) {
          const stepBeat = measureStartBeat + (stepIdx * 0.25);
          const time = tempoMap.beatToSeconds(stepBeat);
          const duration = Math.max(0.05, Math.min(0.2, tempoMap.getDurationSeconds(stepBeat, 0.25)));

          drumChannels.forEach(ch => {
            if (ch.muted) return;
            const dStep = ch.patterns?.[patternIdx]?.[stepIdx];
            if (dStep && dStep.isActive) {
              const gmNote = getDrumGMNote(ch.id, ch.name);
              const vel = typeof dStep.velocity === 'number' ? dStep.velocity : 0.8;
              const volFactor = typeof ch.volume === 'number' ? ch.volume / 100 : 0.8;
              drumsTrack.addNote({
                midi: gmNote,
                time,
                duration,
                velocity: Math.max(0.1, Math.min(1.0, vel * volFactor))
              });
            }
          });
        }
      });
    } else {
      // Repetición del patrón actual a lo largo de maxBeat
      const patternIdx = session.currentDrumPatternEdit || 0;
      const totalMeasures = Math.max(1, Math.ceil(maxBeat / 4));
      let hasActiveSteps = false;

      for (const ch of drumChannels) {
        if (!ch.muted && ch.patterns?.[patternIdx]?.some(s => s?.isActive)) {
          hasActiveSteps = true;
          break;
        }
      }

      if (hasActiveSteps) {
        for (let m = 0; m < totalMeasures; m++) {
          const measureStartBeat = m * 4;
          for (let stepIdx = 0; stepIdx < 16; stepIdx++) {
            const stepBeat = measureStartBeat + (stepIdx * 0.25);
            if (stepBeat >= maxBeat) break;
            const time = tempoMap.beatToSeconds(stepBeat);
            const duration = Math.max(0.05, Math.min(0.2, tempoMap.getDurationSeconds(stepBeat, 0.25)));

            drumChannels.forEach(ch => {
              if (ch.muted) return;
              const dStep = ch.patterns?.[patternIdx]?.[stepIdx];
              if (dStep && dStep.isActive) {
                const gmNote = getDrumGMNote(ch.id, ch.name);
                const vel = typeof dStep.velocity === 'number' ? dStep.velocity : 0.8;
                const volFactor = typeof ch.volume === 'number' ? ch.volume / 100 : 0.8;
                drumsTrack.addNote({
                  midi: gmNote,
                  time,
                  duration,
                  velocity: Math.max(0.1, Math.min(1.0, vel * volFactor))
                });
              }
            });
          }
        }
      }
    }

    if (drumsTrack.notes.length === 0) {
      midi.tracks = midi.tracks.filter(t => t !== drumsTrack);
    }
  }

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
  tempoMarkers?: TempoMarker[];
  key: string;
  scale: string;
  pattern: string;
  timeSignature: '4/4' | '3/4' | '6/8';
  chordBlocks: ChordBlock[];
  melodyNotes: MelodyNote[];
  channels?: Record<string, any>;
  drumChannels?: any[];
  patternChain?: any[];
  isPatternRepeatOn?: boolean;
  activeDrumKitId?: string;
  chordOctaveShift?: number;
  currentDrumPatternEdit?: number;
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
          tempoMarkers: state.tempoMarkers ?? [],
          key: state.key ?? 'C',
          scale: state.scale ?? 'major',
          pattern: state.pattern ?? 'hold',
          timeSignature: state.timeSignature ?? '4/4',
          chordBlocks: state.chordBlocks ?? [],
          melodyNotes: state.melodyNotes ?? [],
          channels: state.channels,
          drumChannels: state.drumChannels,
          patternChain: state.patternChain,
          isPatternRepeatOn: state.isPatternRepeatOn,
          activeDrumKitId: state.activeDrumKitId,
          chordOctaveShift: state.chordOctaveShift,
          currentDrumPatternEdit: state.currentDrumPatternEdit,
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

  const tempoMarkers: TempoMarker[] = midi.header.tempos && midi.header.tempos.length > 1
    ? midi.header.tempos
        .filter(t => t.ticks > 0)
        .map((t, idx) => ({
          id: `tm_midi_${idx}`,
          beat: Math.round((t.ticks / (midi.header.ppq || 480)) * 4) / 4,
          bpm: Math.round(t.bpm)
        }))
    : [];

  return {
    success: true,
    isProject: false,
    bpm,
    tempoMarkers,
    key: 'C',
    scale: 'major',
    pattern,
    timeSignature,
    chordBlocks,
    melodyNotes,
    message: `MIDI estándar importado con éxito. Se detectaron ${chordBlocks.length} acordes y se identificó el patrón rítmico '${pattern}'.`
  };
}
