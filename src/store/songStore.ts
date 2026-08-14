/**
 * songStore.ts
 * Root Store de Phosphor compuesto por Slices modulares e historial de deshacer/rehacer con Zundo.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import type { SongStore } from './types';
import { createTransportSlice, initialTransportState } from './slices/transportSlice';
import { createHarmonySlice, initialHarmonyState } from './slices/harmonySlice';
import { createTrackSlice, initialTrackState } from './slices/trackSlice';
import { createDrumSlice, initialDrumState, DEFAULT_DRUM_CHANNELS } from './slices/drumSlice';
import { createMixerSlice, initialMixerState, DEFAULT_CHANNELS } from './slices/mixerSlice';
import { createUISlice, initialUIState } from './slices/uiSlice';
import { NOTE_CLASSES, transposeNote, transposeChordName } from '../core/music';
import { deserializeSession } from '../core/session';

export * from './types';
export { DEFAULT_CHANNELS, DEFAULT_DRUM_CHANNELS };

export const useSongStore = create<SongStore>()(
  temporal(
    (set, get, api) => ({
      ...createTransportSlice(set, get, api),
      ...createHarmonySlice(set, get, api),
      ...createTrackSlice(set, get, api),
      ...createDrumSlice(set, get, api),
      ...createMixerSlice(set, get, api),
      ...createUISlice(set, get, api),

      transposeSong: (semitones: number) => {
        set((state) => {
          const nextTracks = state.tracks.map((track) => ({
            ...track,
            notes: (track.notes || []).map((n) => ({
              ...n,
              midi: n.midi + semitones,
              note: transposeNote(n.note, semitones)
            }))
          }));

          const activeTrack = nextTracks.find((t) => t.id === state.activeTrackId) || nextTracks[0];

          const newChords = state.chordBlocks.map((block) => ({
            ...block,
            chord: transposeChordName(block.chord, semitones)
          }));

          const keyVal = NOTE_CLASSES.indexOf(state.key);
          const newKey = NOTE_CLASSES[(((keyVal + semitones) % 12) + 12) % 12];

          return {
            tracks: nextTracks,
            melodyNotes: activeTrack ? activeTrack.notes : [],
            chordBlocks: newChords,
            key: newKey
          };
        });
        get().updateSuggestions();
      },

      clearSong: () => {
        try {
          localStorage.removeItem('phosphor_session');
        } catch (_) {}

        set({
          ...initialTransportState,
          ...initialHarmonyState,
          ...initialTrackState,
          ...initialDrumState,
          ...initialMixerState,
          ...initialUIState,
          bpm: 100,
          isAutoKey: false,
          detectedKey: null,
          isPlaying: false,
          currentBeat: 0,
          playbackStep: 0,
        });

        get().updateSuggestions();
      },

      importSong: (sessionInput: unknown) => {
        const { session } = deserializeSession(sessionInput);
        const activeTrack = session.tracks.find((t) => t.id === session.activeTrackId) || session.tracks[0];
        const activeMelodyNotes = activeTrack ? activeTrack.notes : [];

        set({
          bpm: session.transport.bpm,
          key: session.transport.key,
          scale: session.transport.scale,
          isAutoKey: session.transport.isAutoKey,
          detectedKey: null,
          timeSignature: session.transport.timeSignature,
          pattern: session.harmony.defaultPattern,
          chordBlocks: session.harmony.chordBlocks,
          styleMarkers: session.harmony.styleMarkers,
          chordOctaveShift: session.harmony.chordOctaveShift,
          tracks: session.tracks,
          activeTrackId: session.activeTrackId,
          melodyNotes: activeMelodyNotes,
          patternChain: session.drums.patternChain,
          isPatternRepeatOn: session.drums.isPatternRepeatOn,
          activeDrumKitId: session.drums.activeDrumKitId,
          drumChannels: session.drums.drumChannels,
          channels: session.mixer.channels,
          channelOrder: session.mixer.channelOrder,
          selectedChordId: null,
          currentBeat: 0,
          isPlaying: false,
          ...(session.ui?.isCrtEnabled !== undefined && { isCrtEnabled: session.ui.isCrtEnabled }),
          ...(session.ui?.crtParams && { crtParams: { ...get().crtParams, ...session.ui.crtParams } }),
          ...(session.ui?.isKeyboardMelodyEnabled !== undefined && { isKeyboardMelodyEnabled: session.ui.isKeyboardMelodyEnabled }),
          ...(session.ui?.isKeyboardChromatic !== undefined && { isKeyboardChromatic: session.ui.isKeyboardChromatic }),
          ...(session.ui?.keyboardCenterNote && { keyboardCenterNote: session.ui.keyboardCenterNote })
        });

        get().updateSuggestions();
      }
    }),
    {
      partialize: (state) => ({
        bpm: state.bpm,
        key: state.key,
        scale: state.scale,
        chordBlocks: state.chordBlocks,
        tracks: state.tracks,
        styleMarkers: state.styleMarkers,
        timeSignature: state.timeSignature,
        pattern: state.pattern,
        chordOctaveShift: state.chordOctaveShift,
        drumChannels: state.drumChannels,
        patternChain: state.patternChain,
      }),
    }
  )
);
