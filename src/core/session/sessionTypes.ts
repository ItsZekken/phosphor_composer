/**
 * sessionTypes.ts
 * Definición canónica del esquema de sesión y proyectos de Phosphor (v2 y legacy v1).
 */

import type { NoteClass, ScaleType } from '../music';
import type { 
  ChordBlock, 
  PianoRollTrack, 
  StyleMarker, 
  ChannelConfig, 
  DrumChannel, 
  TimeSignature,
  SynthSettings,
  CRTParams,
  PatternChainItem
} from '../../utils/typeDefinitions';

export type SchemaVersion = 1 | 2;

export interface SessionMetadata {
  title?: string;
  author?: string;
  createdAt: number;
  modifiedAt: number;
  clientVersion?: string;
}

export interface TransportState {
  bpm: number;
  timeSignature: TimeSignature;
  key: NoteClass;
  scale: ScaleType;
  isAutoKey: boolean;
}

export interface HarmonyState {
  chordBlocks: ChordBlock[];
  styleMarkers: StyleMarker[];
  chordOctaveShift: number;
  defaultPattern: string;
}

export interface DrumSessionState {
  patternChain: PatternChainItem[];
  isPatternRepeatOn: boolean;
  activeDrumKitId: string;
  drumChannels: DrumChannel[];
  currentDrumPatternEdit?: number;
}

export interface MixerState {
  channels: Record<string, ChannelConfig>;
  channelOrder: string[];
}

export interface UIPreferenceState {
  isCrtEnabled?: boolean;
  crtParams?: Partial<CRTParams>;
  isKeyboardMelodyEnabled?: boolean;
  isKeyboardChromatic?: boolean;
  keyboardCenterNote?: string;
  isAutoSuggestions?: boolean;
}

/**
 * Esquema de Proyecto / Sesión Canónico v2 (Phosphor Composer)
 */
export interface SessionV2 {
  schemaVersion: 2;
  metadata: SessionMetadata;
  transport: TransportState;
  harmony: HarmonyState;
  tracks: PianoRollTrack[];
  activeTrackId: string;
  drums: DrumSessionState;
  mixer: MixerState;
  ui?: UIPreferenceState;
  customSynthSettings?: Record<string, SynthSettings>;
}

/**
 * Representación del formato Legacy v1 para migración retrocompatible
 */
export interface LegacySessionV1 {
  version?: string;
  schemaVersion?: 1;
  bpm?: number;
  key?: string;
  scale?: string;
  timeSignature?: string;
  pattern?: string;
  chordBlocks?: any[];
  melodyNotes?: any[];
  tracks?: any[];
  activeTrackId?: string;
  channels?: Record<string, any>;
  drumChannels?: any[] | Record<string, any>;
  chordOctaveShift?: number;
  patternChain?: any[];
  isPatternRepeatOn?: boolean;
  activeDrumKitId?: string;
  isAutoKey?: boolean;
  isAutoSuggestions?: boolean;
  channelOrder?: string[];
  keyboardCenterNote?: string;
  isKeyboardMelodyEnabled?: boolean;
  isKeyboardChromatic?: boolean;
  isCrtEnabled?: boolean;
  crtParams?: any;
  synthSettings?: any;
}
