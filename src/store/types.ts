import type { StateCreator } from 'zustand';
import type {
  NoteClass,
  ScaleType,
  TimeSignature,
  ChordBlock,
  MelodyNote,
  GhostNote,
  ChordSuggestion,
  ActiveView,
  ChannelConfig,
  ChannelInstrument,
  SynthSettings,
  CRTParams,
  DrumChannel,
  DrumStep,
  PatternChainItem,
  PianoRollTrack,
  StyleMarker,
  TempoMarker
} from '../utils/typeDefinitions';
import type { PatternDef } from '../patterns/patternTypes';

export type PaletteMode = 'matrix' | 'alchemy' | 'builder' | 'fifths' | 'cadences';
export type MatrixMode = 'diatonic' | 'chromatic';

export interface TransportState {
  bpm: number;
  liveBpm: number;
  tempoMarkers: TempoMarker[];
  key: NoteClass;
  scale: ScaleType;
  isAutoKey: boolean;
  detectedKey: string | null;
  timeSignature: TimeSignature;
  isPlaying: boolean;
  currentBeat: number;
  playbackStep: number;
  isLooping: boolean;
  isMetronomeActive: boolean;
  metroSubdivision: '4n' | '8n' | '16n';
  metroVolume: number;
  swing: number;
  sustain: boolean;
  isAudioLoading: boolean;
  isEngineReady: boolean;
  isExporting: boolean;
  exportProgress: number;
}

export interface TransportActions {
  setBpm: (bpm: number) => void;
  setLiveBpm: (bpm: number) => void;
  addTempoMarker: (marker: TempoMarker) => void;
  removeTempoMarker: (id: string) => void;
  updateTempoMarker: (id: string, updates: Partial<TempoMarker>) => void;
  setTempoMarkers: (markers: TempoMarker[]) => void;
  setKey: (key: NoteClass) => void;
  setScale: (scale: ScaleType) => void;
  setIsAutoKey: (isAutoKey: boolean) => void;
  setTimeSignature: (timeSignature: TimeSignature) => void;
  setPlaying: (isPlaying: boolean) => void;
  setCurrentBeat: (beat: number) => void;
  setPlaybackStep: (step: number) => void;
  setLooping: (isLooping: boolean) => void;
  setMetronomeActive: (isMetronomeActive: boolean) => void;
  setMetroSubdivision: (subdivision: '4n' | '8n' | '16n') => void;
  setMetroVolume: (volume: number) => void;
  setSwing: (swing: number) => void;
  setSustain: (sustain: boolean) => void;
  setIsAudioLoading: (loading: boolean) => void;
  setIsEngineReady: (ready: boolean) => void;
  setIsExporting: (exporting: boolean) => void;
  setExportProgress: (progress: number) => void;
}

export interface HarmonyState {
  chordBlocks: ChordBlock[];
  selectedChordId: string | null;
  selectedChordIds: string[];
  chordGridSnap: '1' | '1/2' | '1/4';
  chordClipboard: ChordBlock[];
  chordTimelineViewport: { scrollLeft: number; zoomLevel: number };
  chordSuggestions: ChordSuggestion[];
  ghostNotes: GhostNote[];
  paletteMode: PaletteMode;
  matrixMode: MatrixMode;
  pattern: string;
  customPatterns: PatternDef[];
  chordOctaveShift: number;
  styleMarkers: StyleMarker[];
  isAutoSuggestions: boolean;
  draggingChord: string | null;
  draggingStyle: string | null;
}

export interface HarmonyActions {
  addChordBlock: (chord: string, startBeat: number, durationBeats?: number) => void;
  updateChordBlock: (id: string, updates: Partial<Omit<ChordBlock, 'id'>>) => void;
  removeChordBlock: (id: string) => void;
  setSelectedChordId: (id: string | null) => void;
  setSelectedChordIds: (ids: string[]) => void;
  toggleSelectChordId: (id: string, multi?: boolean) => void;
  selectAllChords: () => void;
  setChordGridSnap: (gridSnap: '1' | '1/2' | '1/4') => void;
  setChordTimelineViewport: (viewport: Partial<{ scrollLeft: number; zoomLevel: number }>) => void;
  resetChordTimelineScroll: () => void;
  copySelectedChords: () => void;
  cutSelectedChords: () => void;
  pasteChords: (targetBeat?: number) => void;
  duplicateSelectedChords: () => void;
  deleteSelectedChords: () => void;
  moveSelectedChords: (deltaBeats: number) => void;
  setPaletteMode: (paletteMode: PaletteMode) => void;
  setMatrixMode: (matrixMode: MatrixMode) => void;
  setPattern: (pattern: string) => void;
  setCustomPatterns: (customPatterns: PatternDef[]) => void;
  setChordOctaveShift: (chordOctaveShift: number) => void;
  addStyleMarker: (marker: StyleMarker) => void;
  removeStyleMarker: (id: string) => void;
  updateStyleMarker: (id: string, updates: Partial<StyleMarker>) => void;
  setAutoSuggestions: (isAutoSuggestions: boolean) => void;
  setDraggingChord: (chord: string | null) => void;
  setDraggingStyle: (style: string | null) => void;
  updateSuggestions: () => void;
  setGhostNotes: (ghostNotes: GhostNote[]) => void;
  refreshPatterns: () => Promise<void>;
}

export interface TrackState {
  tracks: PianoRollTrack[];
  activeTrackId: string;
  clipboardNotes: MelodyNote[];
  melodyNotes: MelodyNote[]; // Sincronizado para retrocompatibilidad con componentes existentes
}

export interface TrackActions {
  addPianoRollTrack: (name?: string) => void;
  removePianoRollTrack: (id: string) => void;
  renamePianoRollTrack: (id: string, name: string) => void;
  setActiveTrackId: (id: string) => void;
  updateTrackViewport: (id: string, viewport: Partial<PianoRollTrack['viewport']>) => void;
  resetActiveTrackScroll: () => void;
  setTrackNotes: (trackId: string, notes: MelodyNote[]) => void;
  addMelodyNote: (note: Omit<MelodyNote, 'id'>) => void;
  updateMelodyNote: (id: string, updates: Partial<Omit<MelodyNote, 'id'>>) => void;
  removeMelodyNote: (id: string) => void;
  setMelodyNotes: (notes: MelodyNote[]) => void;
  setClipboardNotes: (notes: MelodyNote[]) => void;
}

export interface DrumState {
  drumChannels: DrumChannel[];
  activeDrumKitId: string;
  userDrumPatternEdit: number;
  currentDrumPatternEdit: number;
  isLiveFollowLocked: boolean;
  clipboardPattern: DrumStep[][] | null;
  patternChain: PatternChainItem[];
  selectedChainIds: string[];
  chainClipboard: PatternChainItem[];
  drumTimelineViewport: { scrollLeft: number; zoomLevel: number };
  isPatternRepeatOn: boolean;
  currentChainItemId: string | null;
}

export interface DrumActions {
  selectDrumKit: (kitId: string) => void;
  setCurrentDrumPatternEdit: (pattern: number) => void;
  setCurrentDrumPatternEditLive: (pattern: number) => void;
  addDrumChannel: (channel: DrumChannel) => void;
  updateDrumChannel: (id: string, updates: Partial<DrumChannel>) => void;
  removeDrumChannel: (id: string) => void;
  reorderDrumChannels: (fromIndex: number, toIndex: number) => void;
  toggleDrumStep: (channelId: string, stepIndex: number, patternIndex: number, forceState?: boolean) => void;
  setDrumStepVelocity: (channelId: string, stepIndex: number, patternIndex: number, velocity: number) => void;
  copyDrumPattern: (sourcePatternIndex: number) => void;
  pasteDrumPattern: (targetPatternIndex: number) => void;
  addDrumPattern: () => number;
  duplicateDrumPattern: (sourceIndex: number) => number;
  removeDrumPattern: (targetIndex: number) => void;
  clearDrumPattern: (targetIndex: number) => void;
  setPatternRepeatOn: (active: boolean) => void;
  setCurrentChainItemId: (id: string | null) => void;
  setSelectedChainIds: (ids: string[]) => void;
  toggleSelectChainId: (id: string, multi?: boolean) => void;
  selectAllChainItems: () => void;
  copySelectedChainItems: () => void;
  cutSelectedChainItems: () => void;
  pasteChainItems: (targetId?: string) => void;
  duplicateSelectedChainItems: () => void;
  deleteSelectedChainItems: () => void;
  groupSelectedChainItems: () => void;
  ungroupSelectedChainItems: () => void;
  setDrumTimelineViewport: (viewport: Partial<{ scrollLeft: number; zoomLevel: number }>) => void;
  resetDrumTimelineScroll: () => void;
  addChainItem: (patternIndex: number, repeatCount?: number) => void;
  updateChainItem: (id: string, updates: Partial<PatternChainItem>) => void;
  removeChainItem: (id: string) => void;
  moveChainItem: (fromIndex: number, toIndex: number) => void;
}

export interface MixerState {
  channels: Record<string, ChannelConfig>;
  channelOrder: string[];
  isMixerOpen: boolean;
}

export interface MixerActions {
  setMixerOpen: (open: boolean) => void;
  updateChannel: (id: string, updates: Partial<ChannelConfig>) => void;
  toggleMute: (id: string) => void;
  toggleSolo: (id: string) => void;
  setChannelVolume: (id: string, volume: number) => void;
  setChannelPan: (id: string, pan: number) => void;
  setChannelInstrument: (id: string, instrument: ChannelInstrument) => void;
  setChannelOrder: (channelOrder: string[]) => void;
  reorderChannels: (fromIndex: number, toIndex: number) => void;
}

export interface UIState {
  activeView: ActiveView;
  activeNotes: string[];
  activeMelodyNotes: string[];
  instrumentType: 'synth' | 'piano';
  isKeyboardMelodyEnabled: boolean;
  isKeyboardChromatic: boolean;
  keyboardCenterNote: string;
  isSynthModalOpen: boolean;
  editingChannelId: string | null;
  synthSettings: SynthSettings;
  isCrtEnabled: boolean;
  isSettingsOpen: boolean;
  crtParams: CRTParams;
}

export interface UIActions {
  setActiveView: (view: ActiveView) => void;
  setActiveNotes: (notes: string[]) => void;
  setActiveMelodyNotes: (notes: string[]) => void;
  setInstrumentType: (type: 'synth' | 'piano') => void;
  setKeyboardMelodyEnabled: (enabled: boolean) => void;
  setKeyboardChromatic: (chromatic: boolean) => void;
  setKeyboardCenterNote: (centerNote: string) => void;
  setSynthModalOpen: (open: boolean) => void;
  openSynthConfigForChannel: (channelId: string) => void;
  setChannelSynthSettings: (channelId: string, settings: SynthSettings) => void;
  setSynthSettings: (settings: Partial<SynthSettings>) => void;
  setCrtEnabled: (enabled: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCrtParams: (params: Partial<CRTParams>) => void;
}

export interface ProjectActions {
  transposeSong: (semitones: number) => void;
  clearSong: () => void;
  importSong: (sessionInput: unknown) => void;
}

export type SongStore = TransportState &
  TransportActions &
  HarmonyState &
  HarmonyActions &
  TrackState &
  TrackActions &
  DrumState &
  DrumActions &
  MixerState &
  MixerActions &
  UIState &
  UIActions &
  ProjectActions;

export type SliceCreator<T> = StateCreator<SongStore, [], [], T>;
