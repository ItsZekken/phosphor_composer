import type { SliceCreator, UIState, UIActions } from '../types';
import { DEFAULT_SYNTH_SETTINGS, normalizeSynthSettings } from '../../core/audio/engine/synthPresets';
import type { CRTParams, SoundFontAsset } from '../../utils/typeDefinitions';

const SOUNDFONTS_STORAGE_KEY = 'phosphor_soundfonts';

export function normalizeSoundFontAssets(raw: unknown): SoundFontAsset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: SoundFontAsset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<SoundFontAsset>;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const format = obj.format === 'sf3' || obj.format === 'webaudiofont' ? obj.format : 'sf2';
    const fileName =
      typeof obj.fileName === 'string' && obj.fileName.trim()
        ? obj.fileName.trim()
        : `${name}.${format === 'webaudiofont' ? 'js' : format}`;
    const patches = Array.isArray(obj.patches)
      ? obj.patches
          .filter((p) => p && typeof p === 'object' && typeof p.name === 'string')
          .map((p) => ({
            bank: typeof p.bank === 'number' && Number.isFinite(p.bank) ? Math.max(0, Math.floor(p.bank)) : 0,
            program: typeof p.program === 'number' && Number.isFinite(p.program) ? Math.max(0, Math.min(127, Math.floor(p.program))) : 0,
            name: p.name.trim() || 'Patch',
            ...(typeof p.zoneCount === 'number' ? { zoneCount: p.zoneCount } : {})
          }))
      : [];
    result.push({
      id,
      name,
      fileName,
      format,
      sizeBytes: typeof obj.sizeBytes === 'number' && obj.sizeBytes >= 0 ? obj.sizeBytes : 0,
      patches,
      ...(typeof obj.createdAt === 'number' ? { createdAt: obj.createdAt } : {})
    });
  }
  return result;
}

export function loadPersistedSoundFonts(): SoundFontAsset[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SOUNDFONTS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeSoundFontAssets(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function savePersistedSoundFonts(assets: SoundFontAsset[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SOUNDFONTS_STORAGE_KEY, JSON.stringify(assets));
  } catch {
    // ignore storage quota errors
  }
}

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
  projectTitle: 'Sin título',
  lastSavedAt: null,
  commandPaletteMode: 'closed',
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
  isSoundFontModalOpen: false,
  soundfontModalChannelId: 'melody',
  soundfonts: loadPersistedSoundFonts(),
  soundfontClipboard: null,
  isCrtEnabled: savedSettings.isCrtEnabled === true, // Default OFF (false)
  isSettingsOpen: false,
  crtParams: { ...FIXED_CRT_PARAMS }
};

export const createUISlice: SliceCreator<UIState & UIActions> = (set, get) => ({
  ...initialUIState,

  setActiveView: (activeView) => set({ activeView }),
  setProjectTitle: (projectTitle) => set({ projectTitle: projectTitle.trim() || 'Sin título' }),
  setLastSavedAt: (lastSavedAt) => set({ lastSavedAt }),
  setCommandPaletteMode: (commandPaletteMode) => set({ commandPaletteMode }),
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

  setSoundFontModalOpen: (isSoundFontModalOpen) => set({ isSoundFontModalOpen }),

  openSoundFontConfigForChannel: (channelId) => set({
    soundfontModalChannelId: channelId,
    isSoundFontModalOpen: true
  }),

  setChannelSoundFontConfig: (channelId, config) => {
    const cloned = config
      ? {
          ...config,
          ...(config.chorus ? { chorus: { ...config.chorus } } : {}),
          ...(config.reverb ? { reverb: { ...config.reverb } } : {})
        }
      : undefined;
    set((state) => {
      const ch = state.channels[channelId];
      if (!ch) return state;
      return {
        channels: {
          ...state.channels,
          [channelId]: {
            ...ch,
            soundfontConfig: cloned
          }
        }
      };
    });
    import('../../audio/toneEngine').then((mod) => {
      mod.toneEngine.updateSoundFontConfig(channelId, cloned);
    }).catch(() => {});
  },

  addSoundFontAsset: (asset) => set((state) => {
    const existingIdx = state.soundfonts.findIndex((s) => s.id === asset.id);
    const next = existingIdx >= 0
      ? state.soundfonts.map((s, i) => (i === existingIdx ? asset : s))
      : [...state.soundfonts, asset];
    savePersistedSoundFonts(next);
    return { soundfonts: next };
  }),

  removeSoundFontAsset: (soundfontId) => {
    set((state) => {
      const nextSoundFonts = state.soundfonts.filter((s) => s.id !== soundfontId);
      savePersistedSoundFonts(nextSoundFonts);

      const nextChannels = { ...state.channels };
      let channelsChanged = false;
      for (const [chId, ch] of Object.entries(nextChannels)) {
        if (ch?.soundfontConfig?.soundfontId === soundfontId) {
          nextChannels[chId] = { ...ch, soundfontConfig: undefined };
          channelsChanged = true;
        }
      }

      return {
        soundfonts: nextSoundFonts,
        ...(channelsChanged ? { channels: nextChannels } : {})
      };
    });
    import('../../core/audio/soundfont/soundfontRegistry').then((mod) => {
      mod.soundfontRegistry.deleteFromIndexedDB(soundfontId).catch(() => {});
    }).catch(() => {});
  },

  setSoundFontAssets: (assets) => set(() => {
    const normalized = normalizeSoundFontAssets(assets);
    savePersistedSoundFonts(normalized);
    return { soundfonts: normalized };
  }),

  copySoundFontConfig: (channelId) => set((state) => {
    const targetId = channelId || state.soundfontModalChannelId || 'melody';
    const config = state.channels[targetId]?.soundfontConfig;
    if (!config) return state;
    return {
      soundfontClipboard: {
        ...config,
        ...(config.chorus ? { chorus: { ...config.chorus } } : {}),
        ...(config.reverb ? { reverb: { ...config.reverb } } : {})
      }
    };
  }),

  pasteSoundFontConfig: (channelId) => {
    const state = get();
    if (!state.soundfontClipboard) return false;
    const targetId = channelId || state.soundfontModalChannelId || 'melody';
    const ch = state.channels[targetId];
    if (!ch) return false;
    const pasted = {
      ...state.soundfontClipboard,
      ...(state.soundfontClipboard.chorus ? { chorus: { ...state.soundfontClipboard.chorus } } : {}),
      ...(state.soundfontClipboard.reverb ? { reverb: { ...state.soundfontClipboard.reverb } } : {})
    };
    set((s) => ({
      channels: {
        ...s.channels,
        [targetId]: {
          ...s.channels[targetId],
          instrument: 'soundfont',
          soundfontConfig: pasted
        }
      }
    }));
    import('../../audio/toneEngine').then((mod) => {
      mod.toneEngine.updateSoundFontConfig(targetId, pasted);
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
