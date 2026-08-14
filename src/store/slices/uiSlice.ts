import type { SliceCreator, UIState, UIActions } from '../types';

export const initialUIState: UIState = {
  activeView: 'chord',
  activeNotes: [],
  activeMelodyNotes: [],
  instrumentType: 'synth',
  isKeyboardMelodyEnabled: true,
  isKeyboardChromatic: false,
  keyboardCenterNote: 'C4',
  isSynthModalOpen: false,
  editingChannelId: 'chords',
  synthSettings: {
    waveType: 'triangle',
    envelope: {
      attack: 0.1,
      decay: 0.3,
      sustain: 0.4,
      release: 0.8
    },
    filter: {
      enabled: false,
      type: 'lowpass',
      frequency: 2000,
      Q: 1
    },
    detune: 0
  },
  isCrtEnabled: true,
  isSettingsOpen: false,
  crtParams: {
    scanlineOpacity: 0.21,
    scanlineSize: 5.0,
    curvature: 29.0,
    aberration: 2.0,
    bloom: 0.5,
    svgBlur: 0.5,
    phosphorHue: 121,
    phosphorSat: 31,
    tintStrength: 0.04,
    noise: 0.025,
    flicker: 0.1,
    vignette: 0.7,
    brightness: 1.13,
    contrast: 1.08,
    saturation: 0.78
  }
};

export const createUISlice: SliceCreator<UIState & UIActions> = (set) => ({
  ...initialUIState,

  setActiveView: (activeView) => set({ activeView }),
  setActiveNotes: (activeNotes) => set({ activeNotes }),
  setActiveMelodyNotes: (activeMelodyNotes) => set({ activeMelodyNotes }),
  setInstrumentType: (instrumentType) => set((state) => {
    const channels = { ...state.channels };
    if (channels.chords) {
      channels.chords = { ...channels.chords, instrument: instrumentType };
    }
    if (channels.melody) {
      channels.melody = { ...channels.melody, instrument: instrumentType };
    }
    return { instrumentType, channels };
  }),
  setKeyboardMelodyEnabled: (isKeyboardMelodyEnabled) => set({ isKeyboardMelodyEnabled }),
  setKeyboardChromatic: (isKeyboardChromatic) => set({ isKeyboardChromatic }),
  setKeyboardCenterNote: (keyboardCenterNote) => set({ keyboardCenterNote }),
  setSynthModalOpen: (isSynthModalOpen) => set({ isSynthModalOpen }),

  openSynthConfigForChannel: (channelId) => set({
    editingChannelId: channelId,
    isSynthModalOpen: true
  }),

  setChannelSynthSettings: (channelId, settings) => set((state) => {
    const ch = state.channels[channelId];
    if (!ch) return state;
    return {
      channels: {
        ...state.channels,
        [channelId]: {
          ...ch,
          synthSettings: settings
        }
      }
    };
  }),

  setSynthSettings: (updates) => set((state) => {
    const newSettings = { ...state.synthSettings };
    if (updates.waveType !== undefined) newSettings.waveType = updates.waveType;
    if (updates.detune !== undefined) newSettings.detune = updates.detune;

    if (updates.envelope !== undefined) {
      newSettings.envelope = { ...newSettings.envelope, ...updates.envelope };
    }
    if (updates.filter !== undefined) {
      newSettings.filter = { ...newSettings.filter, ...updates.filter };
    }
    return { synthSettings: newSettings };
  }),

  setCrtEnabled: (isCrtEnabled) => set({ isCrtEnabled }),
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  setCrtParams: (updates) => set((state) => ({ crtParams: { ...state.crtParams, ...updates } })),
});
