import type { SliceCreator, UIState, UIActions } from '../types';
import { DEFAULT_SYNTH_SETTINGS, normalizeSynthSettings } from '../../core/audio/engine/synthPresets';
import type { CRTParams } from '../../utils/typeDefinitions';

export const FIXED_CRT_PARAMS: CRTParams = {
  scanlineOpacity: 0.23,
  scanlineSize: 3.0,
  curvature: 30.0,
  aberration: 3.0,
  bloom: 0.5,
  svgBlur: 0.5,
  phosphorHue: 210,
  phosphorSat: 53,
  tintStrength: 0.08,
  noise: 0.050,
  flicker: 0.09,
  vignette: 1.00,
  brightness: 1.40,
  contrast: 1.08,
  saturation: 0.78
};

const USER_SETTINGS_KEY = 'phosphor_user_settings';

const loadSavedUserSettings = (): Partial<UIState> => {
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(USER_SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[uiSlice] No se pudieron cargar ajustes locales:', e);
  }
  return {};
};

const saveUserSettings = (settings: Partial<UIState>) => {
  try {
    if (typeof window !== 'undefined') {
      const existing = loadSavedUserSettings();
      localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify({ ...existing, ...settings }));
    }
  } catch (e) {
    console.warn('[uiSlice] No se pudieron guardar ajustes locales:', e);
  }
};

const savedSettings = typeof window !== 'undefined' ? loadSavedUserSettings() : {};

export const initialUIState: UIState = {
  activeView: 'chord',
  activeNotes: [],
  activeMelodyNotes: [],
  instrumentType: 'synth',
  isKeyboardMelodyEnabled: savedSettings.isKeyboardMelodyEnabled !== undefined ? savedSettings.isKeyboardMelodyEnabled : true,
  isKeyboardChromatic: savedSettings.isKeyboardChromatic !== undefined ? savedSettings.isKeyboardChromatic : false,
  keyboardCenterNote: savedSettings.keyboardCenterNote || 'C4',
  isSynthModalOpen: false,
  editingChannelId: 'chords',
  synthSettings: { ...DEFAULT_SYNTH_SETTINGS },
  synthClipboard: null,
  isCrtEnabled: savedSettings.isCrtEnabled === true, // Default OFF (false)
  isSettingsOpen: false,
  crtParams: { ...FIXED_CRT_PARAMS }
};

export const createUISlice: SliceCreator<UIState & UIActions> = (set, get) => ({
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
  setKeyboardMelodyEnabled: (isKeyboardMelodyEnabled) => {
    saveUserSettings({ isKeyboardMelodyEnabled });
    set({ isKeyboardMelodyEnabled });
  },
  setKeyboardChromatic: (isKeyboardChromatic) => {
    saveUserSettings({ isKeyboardChromatic });
    set({ isKeyboardChromatic });
  },
  setKeyboardCenterNote: (keyboardCenterNote) => {
    saveUserSettings({ keyboardCenterNote });
    set({ keyboardCenterNote });
  },
  setSynthModalOpen: (isSynthModalOpen) => set({ isSynthModalOpen }),

  openSynthConfigForChannel: (channelId) => set({
    editingChannelId: channelId,
    isSynthModalOpen: true
  }),

  setChannelSynthSettings: (channelId, settings) => set((state) => {
    const ch = state.channels[channelId];
    if (!ch) return state;
    const normalized = normalizeSynthSettings(settings);
    return {
      channels: {
        ...state.channels,
        [channelId]: {
          ...ch,
          synthSettings: normalized
        }
      }
    };
  }),

  setSynthSettings: (updates) => set((state) => {
    const newSettings = normalizeSynthSettings({ ...state.synthSettings, ...updates });
    return { synthSettings: newSettings };
  }),

  copySynthSettings: (channelId) => set((state) => {
    const targetId = channelId || state.editingChannelId || 'melody';
    const ch = state.channels[targetId];
    const sourceSettings = ch?.synthSettings || state.synthSettings || DEFAULT_SYNTH_SETTINGS;
    const cloned = JSON.parse(JSON.stringify(normalizeSynthSettings(sourceSettings)));
    return { synthClipboard: cloned };
  }),

  pasteSynthSettings: (channelId) => {
    const state = get();
    if (!state.synthClipboard) return false;
    const targetId = channelId || state.editingChannelId || 'melody';
    const ch = state.channels[targetId];
    if (!ch) return false;
    const pasted = normalizeSynthSettings(JSON.parse(JSON.stringify(state.synthClipboard)));
    set((s) => ({
      channels: {
        ...s.channels,
        [targetId]: {
          ...s.channels[targetId],
          instrument: 'synth',
          synthSettings: pasted
        }
      }
    }));
    import('../../audio/toneEngine').then((mod) => {
      mod.toneEngine.updateSynthSettings(pasted, targetId);
    }).catch(() => {});
    return true;
  },

  setCrtEnabled: (isCrtEnabled) => {
    saveUserSettings({ isCrtEnabled });
    set({ isCrtEnabled });
  },
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  setCrtParams: (updates) => set((state) => {
    const newParams = { ...state.crtParams, ...updates };
    saveUserSettings({ crtParams: newParams });
    return { crtParams: newParams };
  }),
});
