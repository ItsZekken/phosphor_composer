/**
 * sessionSerializer.ts
 * Motor de serialización, deserialización y migración retrocompatible de proyectos.
 */

import type { SessionV2, LegacySessionV1, SessionMetadata } from './sessionTypes';
import type { 
  PianoRollTrack, 
  ChordBlock, 
  MelodyNote, 
  StyleMarker, 
  TempoMarker,
  ChannelConfig, 
  DrumChannel,
  TimeSignature
} from '../../utils/typeDefinitions';
import type { NoteClass, ScaleType } from '../music';
import { normalizePitchClass, noteToMidi } from '../music';
import { normalizeSynthSettings } from '../audio/engine/synthPresets';

export const createEmptyPatterns = (numPatterns = 8, length = 16) => 
  Array.from({ length: numPatterns }).map(() => 
    Array.from({ length }).map(() => ({ isActive: false, velocity: 0.8 }))
  );

export const DEFAULT_DRUM_CHANNELS: DrumChannel[] = [
  { id: 'kick_1', name: 'Kick', sampleUrl: '/drums/kicks/kick1.wav', patterns: createEmptyPatterns(), volume: 80, pan: 0, muted: false, solo: false },
  { id: 'snare_1', name: 'Snare', sampleUrl: '/drums/snares/snare1.wav', patterns: createEmptyPatterns(), volume: 80, pan: 0, muted: false, solo: false },
  { id: 'hihat_closed', name: 'HiHat (C)', sampleUrl: '/drums/hihats_closed/hihat_closed1.wav', patterns: createEmptyPatterns(), volume: 70, pan: 0, muted: false, solo: false },
  { id: 'hihat_open', name: 'HiHat (O)', sampleUrl: '/drums/hihats_open/hihat_open1.wav', patterns: createEmptyPatterns(), volume: 70, pan: 0, muted: false, solo: false },
  { id: 'clap_1', name: 'Clap', sampleUrl: '/drums/claps/clap1.wav', patterns: createEmptyPatterns(), volume: 75, pan: 0, muted: false, solo: false },
  { id: 'crash_1', name: 'Crash', sampleUrl: '/drums/crashes/crash1.wav', patterns: createEmptyPatterns(), volume: 70, pan: 0, muted: false, solo: false }
];

export const DEFAULT_CHANNELS: Record<string, ChannelConfig> = {
  master: { id: 'master', name: 'Master', type: 'master', volume: 80, pan: 0, muted: false, solo: false, color: '#ffffff', instrument: 'synth' },
  chords: { id: 'chords', name: 'Acordes', type: 'chords', volume: 80, pan: 0, muted: false, solo: false, color: '#00e5ff', instrument: 'synth' },
  melody: { id: 'melody', name: 'Melodía', type: 'melody', volume: 85, pan: 0, muted: false, solo: false, color: '#ff00aa', instrument: 'synth' },
  drums: { id: 'drums', name: 'Batería', type: 'drums', volume: 80, pan: 0, muted: false, solo: false, color: '#ffaa00', instrument: 'sampler' }
};

export const DEFAULT_VIEWPORT = { scrollLeft: 0, scrollTop: 600, beatWidth: 40, rowHeight: 20 };

/**
 * Normaliza y migra cualquier formato de sesión antiguo (v1 o parcial) a la estructura canónica SessionV2.
 */
export function migrateLegacyToV2(raw: LegacySessionV1): { session: SessionV2; warnings: string[] } {
  const warnings: string[] = [];

  // 1. Validar y normalizar Transporte
  const bpm = typeof raw.bpm === 'number' && raw.bpm > 20 && raw.bpm < 400 ? raw.bpm : 120;
  const rawKey = typeof raw.key === 'string' ? raw.key : 'C';
  const key: NoteClass = normalizePitchClass(rawKey);
  const scale: ScaleType = (['major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'locrian'].includes(raw.scale as any))
    ? (raw.scale as ScaleType)
    : 'major';
  const timeSignature: TimeSignature = (raw.timeSignature === '3/4' || raw.timeSignature === '6/8') ? raw.timeSignature : '4/4';
  const isAutoKey = Boolean(raw.isAutoKey);
  const rawTempoMarkers = (raw as any).transport?.tempoMarkers || (raw as any).tempoMarkers;
  const tempoMarkers: TempoMarker[] = Array.isArray(rawTempoMarkers)
    ? rawTempoMarkers
        .filter((tm: any) => typeof tm === 'object' && typeof tm.bpm === 'number')
        .map((tm: any, index: number) => ({
          id: tm.id || `tm_${Date.now()}_${index}`,
          beat: typeof tm.beat === 'number' ? Math.max(0, tm.beat) : 0,
          bpm: Math.max(30, Math.min(360, tm.bpm))
        }))
        .sort((a: TempoMarker, b: TempoMarker) => a.beat - b.beat)
    : [];

  // 2. Normalizar Armonía
  const chordBlocks: ChordBlock[] = Array.isArray(raw.chordBlocks)
    ? raw.chordBlocks.map((b, index) => ({
        id: b.id || `cb_${Date.now()}_${index}`,
        chord: typeof b.chord === 'string' ? b.chord : 'C',
        startBeat: typeof b.startBeat === 'number' ? b.startBeat : index * 4,
        durationBeats: typeof b.durationBeats === 'number' ? b.durationBeats : 4,
        voicing: b.voicing || 'default',
        inversion: typeof b.inversion === 'number' ? b.inversion : 0,
        type: b.type || 'play',
        bassNote: b.bassNote
      }))
    : [];

  const styleMarkers: StyleMarker[] = Array.isArray((raw as any).styleMarkers)
    ? (raw as any).styleMarkers.map((m: any, index: number) => ({
        id: m.id || `sm_${Date.now()}_${index}`,
        beat: typeof m.beat === 'number' ? m.beat : 0,
        pattern: typeof m.pattern === 'string' ? m.pattern : 'hold'
      }))
    : [];

  const chordOctaveShift = typeof raw.chordOctaveShift === 'number' ? raw.chordOctaveShift : 0;
  const defaultPattern = typeof raw.pattern === 'string' ? raw.pattern : 'hold';

  // 3. Normalizar Pistas y Notas (Unificación del Split-Brain)
  let tracks: PianoRollTrack[] = [];
  const rawNotes: MelodyNote[] = Array.isArray(raw.melodyNotes)
    ? raw.melodyNotes.map((n, index) => {
        const noteName = typeof n.note === 'string' ? n.note : 'C4';
        return {
          id: n.id || `mn_${Date.now()}_${index}`,
          note: noteName,
          midi: typeof n.midi === 'number' ? n.midi : noteToMidi(noteName),
          startBeat: typeof n.startBeat === 'number' ? n.startBeat : 0,
          durationBeats: typeof n.durationBeats === 'number' ? n.durationBeats : 1,
          velocity: typeof n.velocity === 'number' ? n.velocity : 0.8
        };
      })
    : [];

  if (Array.isArray(raw.tracks) && raw.tracks.length > 0) {
    tracks = raw.tracks.map((t, index) => {
      const trackNotes: MelodyNote[] = Array.isArray(t.notes)
        ? t.notes.map((n: any, nIdx: number) => {
            const noteName = typeof n.note === 'string' ? n.note : 'C4';
            return {
              id: n.id || `tn_${Date.now()}_${nIdx}`,
              note: noteName,
              midi: typeof n.midi === 'number' ? n.midi : noteToMidi(noteName),
              startBeat: typeof n.startBeat === 'number' ? n.startBeat : 0,
              durationBeats: typeof n.durationBeats === 'number' ? n.durationBeats : 1,
              velocity: typeof n.velocity === 'number' ? n.velocity : 0.8
            };
          })
        : [];

      return {
        id: t.id || `track_melody_${index + 1}`,
        name: t.name || `Pista ${index + 1}`,
        channelId: t.channelId || (index === 0 ? 'melody' : `ch_${t.id || `track_${index + 1}`}`),
        color: t.color || '#ff00aa',
        notes: trackNotes,
        viewport: t.viewport || { ...DEFAULT_VIEWPORT }
      };
    });

    // Si la primera pista no tiene notas pero existía melodyNotes plano en la raíz, sincronizar
    if (rawNotes.length > 0 && tracks[0].notes.length === 0) {
      tracks[0].notes = rawNotes;
      warnings.push('Se migraron notas planas de melodyNotes a la primera pista de Piano Roll.');
    }
  } else {
    // Si no había tracks definidos (v1 plano), construir la pista inicial
    tracks = [
      {
        id: 'track_melody_1',
        name: 'Melodía 1',
        channelId: 'melody',
        color: '#ff00aa',
        notes: rawNotes,
        viewport: { ...DEFAULT_VIEWPORT }
      }
    ];
    if (rawNotes.length > 0) {
      warnings.push('Sesión Legacy v1: Se creó la pista principal a partir de melodyNotes.');
    }
  }

  const activeTrackId = (raw.activeTrackId && tracks.some(t => t.id === raw.activeTrackId))
    ? raw.activeTrackId
    : tracks[0].id;

  // 4. Normalizar Baterías
  const patternChain = Array.isArray(raw.patternChain) ? raw.patternChain : [];
  const isPatternRepeatOn = Boolean(raw.isPatternRepeatOn);
  const activeDrumKitId = typeof raw.activeDrumKitId === 'string' ? raw.activeDrumKitId : 'kit_1';

  let drumChannels: DrumChannel[] = DEFAULT_DRUM_CHANNELS;
  if (Array.isArray(raw.drumChannels)) {
    drumChannels = raw.drumChannels;
  } else if (raw.drumChannels && typeof raw.drumChannels === 'object') {
    drumChannels = Object.values(raw.drumChannels);
  }

  // 5. Normalizar Canales del Mixer
  const channels: Record<string, ChannelConfig> = { ...DEFAULT_CHANNELS };
  if (raw.channels && typeof raw.channels === 'object') {
    Object.keys(raw.channels).forEach(chId => {
      const ch = raw.channels![chId];
      if (ch && typeof ch === 'object') {
        const rawSynth = ch.synthSettings || (ch.instrument === 'synth' ? raw.synthSettings : undefined);
        channels[chId] = {
          id: chId,
          name: ch.name || chId,
          type: ch.type || (chId === 'master' ? 'master' : chId === 'chords' ? 'chords' : chId === 'drums' ? 'drums' : 'melody'),
          volume: typeof ch.volume === 'number' ? ch.volume : 0,
          pan: typeof ch.pan === 'number' ? ch.pan : 0,
          muted: Boolean(ch.muted || ch.mute),
          solo: Boolean(ch.solo),
          color: ch.color || '#00e5ff',
          instrument: ch.instrument || 'synth',
          synthSettings: rawSynth ? normalizeSynthSettings(rawSynth) : undefined
        };
      }
    });
  }

  // Asegurar que cada pista tenga su canal en el mixer
  tracks.forEach(track => {
    if (!channels[track.channelId]) {
      channels[track.channelId] = {
        id: track.channelId,
        name: track.name,
        type: 'synth',
        volume: 0,
        pan: 0,
        muted: false,
        solo: false,
        color: track.color || '#ff00aa',
        instrument: 'synth',
        synthSettings: track.synthSettings ? normalizeSynthSettings(track.synthSettings) : undefined
      };
    }
  });

  const channelOrder = Array.isArray(raw.channelOrder) && raw.channelOrder.length > 0
    ? raw.channelOrder
    : ['master', 'chords', 'melody', 'drums', ...tracks.filter(t => t.channelId !== 'melody').map(t => t.channelId)];

  // 6. Ensamblar SessionV2 Canónica
  const sessionV2: SessionV2 = {
    schemaVersion: 2,
    metadata: {
      title: 'Phosphor Composition',
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      clientVersion: '2.0.0'
    },
    transport: {
      bpm,
      tempoMarkers,
      timeSignature,
      key,
      scale,
      isAutoKey
    },
    harmony: {
      chordBlocks,
      styleMarkers,
      chordOctaveShift,
      defaultPattern,
      chordGridSnap: (raw as any).chordGridSnap || (raw as any).harmony?.chordGridSnap || '1',
      chordTimelineViewport: (raw as any).chordTimelineViewport || (raw as any).harmony?.chordTimelineViewport || { scrollLeft: 0, zoomLevel: 1.0 }
    },
    tracks,
    activeTrackId,
    drums: {
      patternChain,
      isPatternRepeatOn,
      activeDrumKitId,
      drumChannels,
      drumTimelineViewport: (raw as any).drumTimelineViewport || (raw as any).drums?.drumTimelineViewport || { scrollLeft: 0, zoomLevel: 1.0 }
    },
    mixer: {
      channels,
      channelOrder
    },
    ui: {
      isCrtEnabled: raw.isCrtEnabled,
      crtParams: raw.crtParams,
      isKeyboardMelodyEnabled: raw.isKeyboardMelodyEnabled,
      isKeyboardChromatic: raw.isKeyboardChromatic,
      keyboardCenterNote: raw.keyboardCenterNote || 'C4',
      isAutoSuggestions: raw.isAutoSuggestions
    }
  };

  return { session: sessionV2, warnings };
}

/**
 * Deserializa una sesión desde un objeto JSON o string garantizando validación y migración.
 */
export function deserializeSession(rawInput: unknown): { session: SessionV2; warnings: string[] } {
  let parsedObj: any = rawInput;

  if (typeof rawInput === 'string') {
    try {
      parsedObj = JSON.parse(rawInput);
    } catch (e) {
      throw new Error(`JSON de sesión inválido: ${(e as Error).message}`);
    }
  }

  if (!parsedObj || typeof parsedObj !== 'object') {
    throw new Error('La estructura de la sesión debe ser un objeto válido.');
  }

  // Si ya es un schemaVersion: 2 válido con campos completos
  if (parsedObj.schemaVersion === 2 && parsedObj.transport && parsedObj.tracks && parsedObj.harmony) {
    // Normalizar synthSettings en todos los canales existentes para robustez total
    if (parsedObj.mixer?.channels) {
      Object.keys(parsedObj.mixer.channels).forEach((chId) => {
        const ch = parsedObj.mixer.channels[chId];
        if (ch && ch.synthSettings) {
          ch.synthSettings = normalizeSynthSettings(ch.synthSettings);
        }
      });
    }
    return { session: parsedObj as SessionV2, warnings: [] };
  }

  // Si es un formato legacy v1 o un volcado plano de Zustand
  return migrateLegacyToV2(parsedObj as LegacySessionV1);
}

/**
 * Serializa el estado de la aplicación en una estructura limpia SessionV2.
 */
export function serializeSession(state: any, metadataUpdates?: Partial<SessionMetadata>): SessionV2 {
  const synchronizedTracks: PianoRollTrack[] = (state.tracks || []).map((t: any) => {
    if (t.id === state.activeTrackId && state.melodyNotes) {
      return { ...t, notes: state.melodyNotes };
    }
    return t;
  });

  return {
    schemaVersion: 2,
    metadata: {
      title: metadataUpdates?.title || 'Phosphor Project',
      author: metadataUpdates?.author,
      createdAt: metadataUpdates?.createdAt || Date.now(),
      modifiedAt: Date.now(),
      clientVersion: '2.0.0'
    },
    transport: {
      bpm: state.bpm || 120,
      tempoMarkers: state.tempoMarkers || [],
      timeSignature: state.timeSignature || '4/4',
      key: state.key || 'C',
      scale: state.scale || 'major',
      isAutoKey: Boolean(state.isAutoKey)
    },
    harmony: {
      chordBlocks: state.chordBlocks || [],
      styleMarkers: state.styleMarkers || [],
      chordOctaveShift: state.chordOctaveShift || 0,
      defaultPattern: state.pattern || 'hold',
      chordGridSnap: state.chordGridSnap || '1',
      chordTimelineViewport: state.chordTimelineViewport || { scrollLeft: 0, zoomLevel: 1.0 }
    },
    tracks: synchronizedTracks,
    activeTrackId: state.activeTrackId || synchronizedTracks[0]?.id || 'track_melody_1',
    drums: {
      patternChain: state.patternChain || [],
      isPatternRepeatOn: Boolean(state.isPatternRepeatOn),
      activeDrumKitId: state.activeDrumKitId || 'kit_1',
      drumChannels: state.drumChannels || DEFAULT_DRUM_CHANNELS,
      currentDrumPatternEdit: state.currentDrumPatternEdit,
      drumTimelineViewport: state.drumTimelineViewport || { scrollLeft: 0, zoomLevel: 1.0 }
    },
    mixer: {
      channels: {
        ...(state.channels || DEFAULT_CHANNELS),
        chords: {
          ...((state.channels || DEFAULT_CHANNELS).chords),
          instrument: (state.channels || DEFAULT_CHANNELS).chords?.instrument || (state.instrumentType === 'piano' ? 'piano' : 'synth')
        },
        melody: {
          ...((state.channels || DEFAULT_CHANNELS).melody),
          instrument: (state.channels || DEFAULT_CHANNELS).melody?.instrument || (state.instrumentType === 'piano' ? 'piano' : 'synth')
        }
      },
      channelOrder: state.channelOrder || ['master', 'chords', 'melody', 'drums']
    },
    ui: {
      isCrtEnabled: state.isCrtEnabled,
      crtParams: state.crtParams,
      isKeyboardMelodyEnabled: state.isKeyboardMelodyEnabled,
      isKeyboardChromatic: state.isKeyboardChromatic,
      keyboardCenterNote: state.keyboardCenterNote || 'C4',
      isAutoSuggestions: state.isAutoSuggestions
    }
  };
}

/**
 * Exporta el estado a una cadena formateada JSON v2 lista para descarga.
 */
export function exportSessionToJson(state: any, metadataUpdates?: Partial<SessionMetadata>): string {
  const session = serializeSession(state, metadataUpdates);
  return JSON.stringify(session, null, 2);
}
