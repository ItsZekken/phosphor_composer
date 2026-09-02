/**
 * PreviewManager.ts
 * Orquestador de preescuchas interactivas de acordes, notas melódicas y tracking visual de teclas.
 * Totalmente desacoplado mediante ChannelInstrumentManager para soportar cualquier canal e instrumento.
 */

import * as Tone from 'tone';
import { getChordNotes, shiftOctave, resolvePatternNoteToChord } from '../../music';
import type { PatternDef } from '../../../patterns/patternTypes';
import type { ChannelInstrumentManager } from './ChannelInstrumentManager';
import { useSongStore } from '../../../store/songStore';

export interface PreviewContext {
  instrumentManager: ChannelInstrumentManager;
  onActiveNotesChange: (notes: string[]) => void;
  onActiveMelodyNotesChange: (notes: string[]) => void;
}

export class PreviewManager {
  private ctx: PreviewContext;
  private activePreviewChord: string | null = null;
  private activePreviewNotes: string[] = [];
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewStep = 0;
  private previewNotes: string[] = [];

  private activeNotesSet = new Set<string>();
  private noteActiveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private activeMelodyNotesSet = new Set<string>();
  private melodyNoteActiveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private activePressedNotes = new Set<string>();
  private activePressedNotesList: string[] = [];

  constructor(context: PreviewContext) {
    this.ctx = context;
  }

  public playChordPreview(chordName: string, chordOctaveShift = 0) {
    const isPiano = useSongStore.getState().channels.chords?.instrument === 'piano';

    try {
      let notes = getChordNotes(chordName, 4);
      if (chordOctaveShift !== 0) {
        notes = notes.map((note) => shiftOctave(note, chordOctaveShift));
      }
      if (notes.length > 0) {
        const now = Tone.now();
        this.ctx.instrumentManager.triggerAttackRelease('chords', isPiano, notes, '2n', now, 0.7);
      }
    } catch (e) {
      console.warn('Error tocando acorde preview:', e);
    }
  }

  public playChordPreviewStart(
    chordName: string,
    options: {
      pattern: string;
      chordOctaveShift: number;
      bpm: number;
      customPatterns: PatternDef[];
    }
  ) {
    const { pattern = 'hold', chordOctaveShift = 0, bpm = 120, customPatterns = [] } = options;

    let baseNotes = getChordNotes(chordName, 4);
    if (baseNotes.length === 0) return;

    if (chordOctaveShift !== 0) {
      baseNotes = baseNotes.map((n) => shiftOctave(n, chordOctaveShift));
    }

    const rootNoteMatch = chordName.split('/')[0].match(/^([A-G]#?)/);
    const defaultBass = rootNoteMatch ? `${rootNoteMatch[1]}2` : baseNotes[0].replace(/[0-9]/g, '2');
    const bassNote = chordName.includes('/') ? `${chordName.split('/')[1]}2` : defaultBass;
    const notes = [bassNote, ...baseNotes];

    const isPatternRunning = this.activePreviewChord !== null && this.previewTimer !== null;
    this.activePreviewChord = chordName;
    this.previewNotes = notes;

    if (isPatternRunning) return;

    this.previewStep = 0;
    const beatDurationMs = (60 / bpm) * 1000;
    const isPiano = useSongStore.getState().channels.chords?.instrument === 'piano';

    const playNoteImmediate = (note: string, durationMs: number, velocity = 0.6) => {
      const now = Tone.now();
      const durSec = durationMs / 1000;
      if (!this.activePreviewNotes.includes(note)) {
        this.activePreviewNotes.push(note);
      }
      this.ctx.instrumentManager.triggerAttackRelease('chords', isPiano, note, durSec, now, velocity);
      this.trackNote(note, durSec, undefined, 'harmony');
    };

    const playChordImmediate = (durationMs: number, velocity = 0.6) => {
      const now = Tone.now();
      const durSec = durationMs / 1000;
      this.previewNotes.forEach((note) => {
        if (!this.activePreviewNotes.includes(note)) {
          this.activePreviewNotes.push(note);
        }
      });
      this.ctx.instrumentManager.triggerAttackRelease('chords', isPiano, this.previewNotes, durSec, now, velocity);
      this.previewNotes.forEach((note) => this.trackNote(note, durSec, undefined, 'harmony'));
    };

    const playBassImmediate = (durationMs: number, velocity = 0.7) => {
      if (this.previewNotes.length > 0) {
        playNoteImmediate(this.previewNotes[0], durationMs, velocity);
      }
    };

    if (pattern === 'hold') {
      playChordImmediate(1500, 0.65);
      return;
    }

    if (pattern === 'strum') {
      this.previewNotes.forEach((note, index) => {
        setTimeout(() => {
          if (this.activePreviewChord !== chordName) return;
          playNoteImmediate(note, 1500 - index * 25, 0.65 - index * 0.05);
        }, index * 25);
      });
      return;
    }

    const customPattern = customPatterns.find((p) => p.name === pattern);
    if (customPattern) {
      const cycleDurationMs = customPattern.totalBeats * beatDurationMs;

      const runCycle = () => {
        if (this.activePreviewChord === null) return;

        for (const pn of customPattern.notes) {
          const delayMs = pn.beatOffset * beatDurationMs;
          const durMs = pn.durationBeats * beatDurationMs;

          setTimeout(() => {
            if (this.activePreviewChord === null) return;
            const currentChord = this.activePreviewChord || chordName;
            const refOctave = pn.voice === 'bass' ? 2 : 4;
            const resolvedNote = resolvePatternNoteToChord(pn, currentChord, refOctave, chordOctaveShift);
            playNoteImmediate(resolvedNote, durMs, pn.velocity);
          }, delayMs);
        }

        this.previewTimer = setTimeout(runCycle, cycleDurationMs);
      };

      runCycle();
      return;
    }

    const runStep = () => {
      if (this.activePreviewChord === null) return;

      const nextIntervalMs = this.triggerPreviewPatternStep(
        pattern,
        this.previewNotes,
        this.previewStep,
        beatDurationMs,
        playNoteImmediate,
        playChordImmediate,
        playBassImmediate
      );

      this.previewStep++;
      this.previewTimer = setTimeout(runStep, nextIntervalMs);
    };

    runStep();
  }

  private triggerPreviewPatternStep(
    pattern: string,
    notes: string[],
    step: number,
    beatDurationMs: number,
    playNote: (note: string, durMs: number, vel?: number) => void,
    playChord: (durMs: number, vel?: number) => void,
    playBass: (durMs: number, vel?: number) => void
  ): number {
    if (pattern === 'quarters') {
      playChord(beatDurationMs * 0.8, 0.6);
      return beatDurationMs;
    }

    if (pattern === 'eighths') {
      playChord(beatDurationMs * 0.4, 0.55);
      return beatDurationMs * 0.5;
    }

    if (pattern === 'pop') {
      const stepInPattern = step % 4;
      if (stepInPattern === 0) {
        playChord(beatDurationMs * 0.8, 0.6);
        return beatDurationMs * 1.5;
      } else if (stepInPattern === 1) {
        playChord(beatDurationMs * 0.4, 0.55);
        return beatDurationMs * 1.0;
      } else if (stepInPattern === 2) {
        playChord(beatDurationMs * 0.7, 0.6);
        return beatDurationMs * 1.0;
      } else {
        playChord(beatDurationMs * 0.4, 0.55);
        return beatDurationMs * 0.5;
      }
    }

    if (pattern === 'arpeggio') {
      if (step % 8 === 0) {
        playBass(beatDurationMs * 4, 0.7);
      }

      const arpNotes = notes.length > 1 ? notes.slice(1) : notes;
      const period = (arpNotes.length - 1) * 2;
      let noteIndex = 0;

      if (period > 0) {
        const mod = step % period;
        noteIndex = mod < arpNotes.length ? mod : period - mod;
      }

      playNote(arpNotes[noteIndex], beatDurationMs * 0.4, 0.55);
      return beatDurationMs * 0.5;
    }

    return beatDurationMs;
  }

  public playChordPreviewStop() {
    this.activePreviewChord = null;
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }

    const now = Tone.now();
    const isPiano = useSongStore.getState().channels.chords?.instrument === 'piano';

    this.activePreviewNotes.forEach((note) => {
      try {
        this.ctx.instrumentManager.keyUp('chords', isPiano, note, now);
      } catch (_) {}

      this.activeNotesSet.delete(note);
      const timer = this.noteActiveTimers.get(note);
      if (timer) {
        clearTimeout(timer);
        this.noteActiveTimers.delete(note);
      }
    });

    this.activePreviewNotes = [];
    this.ctx.onActiveNotesChange(Array.from(this.activeNotesSet));
  }

  public playNotePreview(noteName: string, channelId = 'melody', usePiano = false) {
    try {
      const now = Tone.now();
      this.ctx.instrumentManager.triggerAttackRelease(channelId, usePiano, noteName, '8n', now, 0.8);
      this.trackNote(noteName, 0.3, undefined, channelId);
    } catch (e) {
      console.warn('Error tocando nota preview:', e);
    }
  }

  public startNote(noteName: string, channelId = 'melody', usePiano = false) {
    try {
      this.activePressedNotes.add(noteName);
      this.activePressedNotesList = this.activePressedNotesList.filter((n) => n !== noteName);
      this.activePressedNotesList.push(noteName);

      this.ctx.instrumentManager.keyDown(channelId, usePiano, noteName, Tone.now(), 0.8);
      this.trackNoteStart(noteName);
    } catch (e) {
      console.warn('Error starting note:', e);
    }
  }

  public stopNote(noteName: string, channelId = 'melody', usePiano = false) {
    try {
      this.activePressedNotes.delete(noteName);
      this.activePressedNotesList = this.activePressedNotesList.filter((n) => n !== noteName);

      if (this.activePressedNotes.size === 0) {
        this.ctx.instrumentManager.releaseAll();
      } else {
        this.ctx.instrumentManager.keyUp(channelId, usePiano, noteName, Tone.now());
        const nextNote = this.activePressedNotesList[this.activePressedNotesList.length - 1];
        this.ctx.instrumentManager.keyDown(channelId, usePiano, nextNote, Tone.now(), 0.8);
      }
      this.trackNoteStop(noteName);
    } catch (e) {
      console.warn('Error stopping note:', e);
    }
  }

  public trackNote(
    note: string,
    durationSeconds: number,
    startTime?: number,
    type: 'harmony' | 'melody' | string = 'harmony'
  ) {
    if (useSongStore.getState().isPlaying) return;
    const now = Tone.now();
    const delayMs = startTime !== undefined ? Math.max(0, (startTime - now) * 1000) : 0;
    const durationMs = durationSeconds * 1000;

    setTimeout(() => {
      if (type !== 'harmony') {
        const existingTimer = this.melodyNoteActiveTimers.get(note);
        if (existingTimer) clearTimeout(existingTimer);

        this.activeMelodyNotesSet.add(note);
        this.ctx.onActiveMelodyNotesChange(Array.from(this.activeMelodyNotesSet));

        const offTimer = setTimeout(() => {
          this.activeMelodyNotesSet.delete(note);
          this.ctx.onActiveMelodyNotesChange(Array.from(this.activeMelodyNotesSet));
          this.melodyNoteActiveTimers.delete(note);
        }, durationMs);

        this.melodyNoteActiveTimers.set(note, offTimer);
      } else {
        const existingTimer = this.noteActiveTimers.get(note);
        if (existingTimer) clearTimeout(existingTimer);

        this.activeNotesSet.add(note);
        this.ctx.onActiveNotesChange(Array.from(this.activeNotesSet));

        const offTimer = setTimeout(() => {
          this.activeNotesSet.delete(note);
          this.ctx.onActiveNotesChange(Array.from(this.activeNotesSet));
          this.noteActiveTimers.delete(note);
        }, durationMs);

        this.noteActiveTimers.set(note, offTimer);
      }
    }, delayMs);
  }

  private trackNoteStart(note: string) {
    const existingTimer = this.melodyNoteActiveTimers.get(note);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.melodyNoteActiveTimers.delete(note);
    }
    this.activeMelodyNotesSet.add(note);
    this.ctx.onActiveMelodyNotesChange(Array.from(this.activeMelodyNotesSet));
  }

  private trackNoteStop(note: string) {
    const offTimer = setTimeout(() => {
      this.activeMelodyNotesSet.delete(note);
      this.ctx.onActiveMelodyNotesChange(Array.from(this.activeMelodyNotesSet));
      this.melodyNoteActiveTimers.delete(note);
    }, 150);
    this.melodyNoteActiveTimers.set(note, offTimer);
  }

  public clearAllActiveNotes() {
    this.activeNotesSet.clear();
    this.noteActiveTimers.forEach((t) => clearTimeout(t));
    this.noteActiveTimers.clear();
    this.ctx.onActiveNotesChange([]);

    this.activeMelodyNotesSet.clear();
    this.melodyNoteActiveTimers.forEach((t) => clearTimeout(t));
    this.melodyNoteActiveTimers.clear();
    this.ctx.onActiveMelodyNotesChange([]);
  }

  public dispose() {
    this.playChordPreviewStop();
    this.clearAllActiveNotes();
  }
}
