/**
 * patternResolver.ts
 * Unifica la resolución armónica de notas de patrones rítmicos hacia los acordes activos.
 * Elimina la duplicación entre toneEngine.ts y midiService.ts.
 */

import type { NoteClass } from './pitchClass';
import { NOTE_CLASSES } from './pitchClass';
import { parseChord, getChordNotes } from './chordParser';
import type { VoicingType } from './voicingEngine';
import { getBlockNotes } from './voicingEngine';
import type { PatternDef, PatternNote } from '../../patterns/patternTypes';

export interface RenderedNote {
  name: string;
  timeBeats: number;
  durationBeats: number;
  velocity: number;
  voice?: 'bass' | 'chord';
}

/**
 * Resuelve una nota de patrón rítmico (normalizada originalmente en C major)
 * al acorde activo respetando la armonía, extensiones y octava.
 */
export function resolvePatternNoteToChord(
  pn: { semitoneFromRoot: number; octaveOffset: number; voice: string },
  chordName: string,
  refOctave: number,
  chordOctaveShift = 0
): string {
  let targetRefOctave = refOctave;
  if (pn.voice === 'chord') {
    targetRefOctave += chordOctaveShift;
  }

  // 1. Obtener notas básicas del acorde activo
  const activeChordNotes = getChordNotes(chordName, targetRefOctave);
  if (activeChordNotes.length === 0) {
    const parsed = parseChord(chordName);
    const rootName = parsed ? parsed.root : 'C';
    const rootPC = NOTE_CLASSES.indexOf(rootName as NoteClass);
    const targetPC = (((rootPC + pn.semitoneFromRoot) % 12) + 12) % 12;
    const targetOctave = targetRefOctave + pn.octaveOffset + Math.floor((rootPC + pn.semitoneFromRoot) / 12);
    return `${NOTE_CLASSES[targetPC]}${targetOctave}`;
  }

  // 2. Extraer semitonos relativos a la tónica del acorde activo
  const rootNoteName = activeChordNotes[0].replace(/[0-9-]/g, '') as NoteClass;
  const rootPC = NOTE_CLASSES.indexOf(rootNoteName);

  const rootMidi = 12 * (targetRefOctave + 1) + rootPC;

  const activeSemitones = activeChordNotes.map(n => {
    const pc = NOTE_CLASSES.indexOf(n.replace(/[0-9-]/g, '') as NoteClass);
    const oct = parseInt(n.replace(/[^0-9-]/g, ''), 10);
    const noteMidi = 12 * (oct + 1) + pc;
    return noteMidi - rootMidi;
  });

  if (activeSemitones.length < 4) {
    activeSemitones.push(activeSemitones[0] + 12);
  }

  // 3. Mapear semitonos en C major a grados de la tríada/séptima
  const targetSemitone = pn.semitoneFromRoot;
  let targetBaseIdx = 0;
  let refBaseSemitone = 0;

  if (targetSemitone <= 2) {
    targetBaseIdx = 0; // Tónica
    refBaseSemitone = 0;
  } else if (targetSemitone <= 5) {
    targetBaseIdx = 1; // Tercera (o cuarta en sus4)
    refBaseSemitone = 4;
  } else if (targetSemitone <= 8) {
    targetBaseIdx = 2; // Quinta
    refBaseSemitone = 7;
  } else {
    targetBaseIdx = 3; // Séptima
    refBaseSemitone = 11;
  }

  // 4. Aplicar offset y reconstruir nota final
  const offset = targetSemitone - refBaseSemitone;
  const activeBaseSemitone = activeSemitones[targetBaseIdx] ?? activeSemitones[0];
  const finalRelativeSemitone = activeBaseSemitone + offset;

  const finalMidi = rootMidi + finalRelativeSemitone + (12 * pn.octaveOffset);
  const finalPC = ((finalMidi % 12) + 12) % 12;
  const finalOctave = Math.floor(finalMidi / 12) - 1;

  return `${NOTE_CLASSES[finalPC]}${finalOctave}`;
}

/**
 * Renderiza todas las notas de un bloque de acorde aplicando el patrón rítmico seleccionado.
 * Utilizado por el motor de audio en tiempo real y por el exportador MIDI.
 */
export function renderChordPattern(
  block: {
    chord: string;
    startBeat: number;
    durationBeats: number;
    voicing?: VoicingType | string;
    inversion?: number;
    type?: 'play' | 'silence' | 'break' | 'bass-only' | 'chord-only';
    bassNote?: string;
  },
  patternName: string,
  customPatterns: PatternDef[] = [],
  chordOctaveShift = 0
): RenderedNote[] {
  const notes = getBlockNotes({
    chord: block.chord,
    voicing: block.voicing,
    inversion: block.inversion,
    octaveShift: chordOctaveShift,
    type: block.type,
    bassNote: block.bassNote
  });

  if (notes.length === 0) return [];

  const list: RenderedNote[] = [];
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
        velocity: 0.7,
        voice: 'bass'
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
        velocity: 0.55,
        voice: 'chord'
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
        customPattern.notes.forEach((pn: PatternNote) => {
          if (block.type === 'bass-only' && pn.voice !== 'bass') return;
          if (block.type === 'chord-only' && pn.voice !== 'chord') return;

          const beat = cycleStart + pn.beatOffset;
          if (beat < duration) {
            const refOctave = pn.voice === 'bass' ? 2 : 4;
            const resolvedNoteName = resolvePatternNoteToChord(pn, block.chord, refOctave, chordOctaveShift);
            list.push({
              name: resolvedNoteName,
              timeBeats: block.startBeat + beat,
              durationBeats: Math.min(pn.durationBeats, duration - beat),
              velocity: pn.velocity,
              voice: pn.voice
            });
          }
        });
      }
    } else {
      // Fallback a hold
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
