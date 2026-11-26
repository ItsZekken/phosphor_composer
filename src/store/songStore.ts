/**
 * songStore.ts
 * Root Store de Phosphor compuesto por Slices modulares e historial de deshacer/rehacer con Zundo.
 * Arquitectura 1:1 Single Source of Truth: Chord Palette, Piano Roll, Drum Sequencer y Tracks
 * editan exactamente los mismos datos canónicos (chordBlocks, tracks[].notes, patternChain, audioClips).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import type { SongStore } from './types';
import { createTransportSlice, initialTransportState } from './slices/transportSlice';
import { createHarmonySlice, initialHarmonyState } from './slices/harmonySlice';
import { createTrackSlice, initialTrackState } from './slices/trackSlice';
import {
  createDrumSlice,
  initialDrumState,
  DEFAULT_DRUM_CHANNELS,
  normalizeCustomDrumSamples,
  savePersistedCustomDrumSamples
} from './slices/drumSlice';
import { getCustomSampleBufferId } from '../constants/drumSamples';
import { createMixerSlice, initialMixerState, DEFAULT_CHANNELS } from './slices/mixerSlice';
import { createUISlice, initialUIState } from './slices/uiSlice';
import { createAudioTrackSlice, initialAudioTrackState, DEFAULT_AUDIO_TRACKS } from './slices/audioTrackSlice';
import { createPlaylistSlice, initialPlaylistState } from './slices/playlistSlice';
import { NOTE_CLASSES, transposeNote, transposeChordName } from '../core/music';
import { deserializeSession } from '../core/session';

export * from './types';
export { DEFAULT_CHANNELS, DEFAULT_DRUM_CHANNELS, DEFAULT_AUDIO_TRACKS };

export const useSongStore = create<SongStore>()(
  temporal(
    (set, get, api) => ({
      ...createTransportSlice(set, get, api),
      ...createHarmonySlice(set, get, api),
      ...createTrackSlice(set, get, api),
      ...createDrumSlice(set, get, api),
      ...createMixerSlice(set, get, api),
      ...createUISlice(set, get, api),
      ...createAudioTrackSlice(set, get, api),
      ...createPlaylistSlice(set, get, api),

      transposeSong: (semitones: number) => {
        set((state) => {
          const transposeList = (notes: typeof state.melodyNotes) =>
            (notes || []).map((n) => ({
              ...n,
              midi: n.midi + semitones,
              note: transposeNote(n.note, semitones)
            }));

          const nextTracks = state.tracks.map((track) => ({
            ...track,
            notes: transposeList(track.notes)
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
          ...initialAudioTrackState,
          ...initialPlaylistState,
          projectTitle: 'Sin título',
          lastSavedAt: null,
          commandPaletteMode: 'closed',
          isCrtEnabled: get().isCrtEnabled,
          customDrumSamples: get().customDrumSamples,
          bpm: 100,
          isAutoKey: false,
          detectedKey: null,
          isPlaying: false,
          currentBeat: 0,
          playbackStep: 0
        });

        get().updateSuggestions();
      },

      importSong: (sessionInput: unknown, fallbackTitle?: string) => {
        const { session } = deserializeSession(sessionInput);
        const normalizedTracks = session.tracks.map((t) => ({
          ...t,
          notes: Array.isArray(t.notes) ? t.notes : []
        }));
        const activeTrack = normalizedTracks.find((t) => t.id === session.activeTrackId) || normalizedTracks[0];
        const activeMelodyNotes = activeTrack ? activeTrack.notes : [];

        const rawDrumChannels = session.drums.drumChannels;
        const normalizedDrumChannels = (Array.isArray(rawDrumChannels) && rawDrumChannels.length > 0)
          ? rawDrumChannels
          : (rawDrumChannels && typeof rawDrumChannels === 'object' && Object.values(rawDrumChannels).length > 0
            ? (Object.values(rawDrumChannels) as any)
            : DEFAULT_DRUM_CHANNELS);

        const existingCustomSamples = get().customDrumSamples || [];
        const sessionCustomSamples = normalizeCustomDrumSamples(session.drums.customSamples);
        const mergedCustomSampleMap = new Map<string, typeof existingCustomSamples[number]>();
        for (const s of existingCustomSamples) {
          mergedCustomSampleMap.set(s.id, s);
        }
        for (const s of sessionCustomSamples) {
          mergedCustomSampleMap.set(s.id, s);
        }
        for (const ch of normalizedDrumChannels) {
          const customId = getCustomSampleBufferId(ch?.sampleUrl);
          if (customId && !mergedCustomSampleMap.has(customId)) {
            mergedCustomSampleMap.set(customId, {
              id: customId,
              name: ch?.name?.trim() || 'Sample importado',
              sampleUrl: ch.sampleUrl
            });
          }
        }
        const mergedCustomSamples = Array.from(mergedCustomSampleMap.values());
        if (mergedCustomSamples.length !== existingCustomSamples.length) {
          savePersistedCustomDrumSamples(mergedCustomSamples);
        }

        const rawTitle = session.metadata?.title?.trim();
        const isGenericTitle =
          !rawTitle || /^phosphor (project|composition)/i.test(rawTitle) || rawTitle === 'Sin título';
        const resolvedTitle = !isGenericTitle
          ? rawTitle
          : (fallbackTitle?.trim() || 'Sin título');

        set({
          projectTitle: resolvedTitle,
          bpm: session.transport.bpm,
          tempoMarkers: session.transport.tempoMarkers || [],
          key: session.transport.key,
          scale: session.transport.scale,
          isAutoKey: session.transport.isAutoKey,
          detectedKey: null,
          timeSignature: session.transport.timeSignature,
          swing: session.transport.swing ?? 0,
          pattern: session.harmony.defaultPattern,
          chordBlocks: session.harmony.chordBlocks,
          styleMarkers: session.harmony.styleMarkers,
          chordOctaveShift: session.harmony.chordOctaveShift,
          chordGridSnap: session.harmony.chordGridSnap || '1',
          chordTimelineViewport: session.harmony.chordTimelineViewport || { scrollLeft: 0, zoomLevel: 1.0 },
          tracks: normalizedTracks,
          activeTrackId: activeTrack ? activeTrack.id : session.activeTrackId,
          melodyNotes: activeMelodyNotes,
          patternChain: session.drums.patternChain,
          isPatternRepeatOn: session.drums.isPatternRepeatOn,
          activeDrumKitId: session.drums.activeDrumKitId,
          drumChannels: normalizedDrumChannels,
          customDrumSamples: mergedCustomSamples,
          patternLengths: session.drums.patternLengths || Array.from({ length: normalizedDrumChannels[0]?.patterns?.length || 8 }).map(() => 16),
          drumPatternNames: session.drums.drumPatternNames || [],
          drumTimelineViewport: session.drums.drumTimelineViewport || { scrollLeft: 0, zoomLevel: 1.0 },
          audioTracks: (session as any).audio?.tracks || DEFAULT_AUDIO_TRACKS,
          audioClips: (session as any).audio?.clips || [],
          audioLatencyCalibrationMs: (session as any).audio?.latencyMs ?? 20,
          selectedPlaylistTrack: { kind: 'harmony' },
          selectedMelodyRegionRefs: [],
          selectedChainIds: [],
          selectedClipIds: [],
          channels: session.mixer.channels,
          channelOrder: session.mixer.channelOrder,
          selectedChordId: null,
          selectedChordIds: [],
          currentBeat: 0,
          isPlaying: false,
          isCrtEnabled: get().isCrtEnabled,
          ...(session.ui?.isKeyboardMelodyEnabled !== undefined && { isKeyboardMelodyEnabled: session.ui.isKeyboardMelodyEnabled }),
          ...(session.ui?.isKeyboardChromatic !== undefined && { isKeyboardChromatic: session.ui.isKeyboardChromatic }),
          ...(session.ui?.keyboardCenterNote && { keyboardCenterNote: session.ui.keyboardCenterNote })
        });

        get().updateSuggestions();

        // Pre-cargar todos los samples de batería, piano y nodos de audio del proyecto importado
        import('../audio/toneEngine').then(({ toneEngine }) => {
          toneEngine.preloadProjectAudio(session.mixer.channels, session.drums.drumChannels);
        }).catch((err) => {
          console.warn('[songStore] Advertencia al pre-cargar audio del proyecto importado:', err);
        });
      }
    }),
    {
      partialize: (state) => ({
        bpm: state.bpm,
        tempoMarkers: state.tempoMarkers,
        key: state.key,
        scale: state.scale,
        chordBlocks: state.chordBlocks,
        chordGridSnap: state.chordGridSnap,
        tracks: state.tracks,
        styleMarkers: state.styleMarkers,
        timeSignature: state.timeSignature,
        pattern: state.pattern,
        chordOctaveShift: state.chordOctaveShift,
        drumChannels: state.drumChannels,
        patternLengths: state.patternLengths,
        drumPatternNames: state.drumPatternNames,
        patternChain: state.patternChain,
        audioTracks: state.audioTracks,
        audioClips: state.audioClips
      }),
      equality: (pastState, currentState) => {
        const keys = Object.keys(pastState) as Array<keyof typeof pastState>;
        for (const k of keys) {
          if (k === 'tracks') {
            if (pastState.tracks.length !== currentState.tracks.length) return false;
            for (let i = 0; i < pastState.tracks.length; i++) {
              const a = pastState.tracks[i];
              const b = currentState.tracks[i];
              if (
                a.id !== b.id ||
                a.name !== b.name ||
                a.channelId !== b.channelId ||
                a.color !== b.color ||
                a.notes !== b.notes ||
                a.regions !== b.regions
              ) {
                return false;
              }
            }
            continue;
          }
          if (pastState[k] !== currentState[k]) return false;
        }
        return true;
      }
    }
  )
);

// Invariante 1:1 tras undo/redo de Zundo o actualizaciones externas de `tracks`:
// garantizar que `melodyNotes` refleje siempre las notas exactas de la pista activa.
useSongStore.subscribe((state, prevState) => {
  if (state.tracks !== prevState.tracks || state.activeTrackId !== prevState.activeTrackId) {
    const activeTrack = state.tracks.find((t) => t.id === state.activeTrackId) || state.tracks[0];
    const expectedNotes = activeTrack ? activeTrack.notes : [];
    if (state.melodyNotes !== expectedNotes) {
      useSongStore.setState({ melodyNotes: expectedNotes });
    }
  }
});
