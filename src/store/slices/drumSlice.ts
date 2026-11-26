import type { SliceCreator, DrumState, DrumActions } from '../types';
import type { CustomDrumSample, DrumChannel, PatternChainItem } from '../../utils/typeDefinitions';
import { normalizePatternChainItems } from '../../utils/typeDefinitions';
import { PRESET_DRUM_KITS, findMatchingKitId, inferCategoryFromChannel } from '../../constants/drumKits';
import { buildCustomSampleUrl, isCustomSampleUrl } from '../../constants/drumSamples';
import { generateId } from '../../utils/idGenerator';

const CUSTOM_DRUM_SAMPLES_STORAGE_KEY = 'phosphor_custom_drum_samples';

export function normalizeCustomDrumSamples(raw: unknown): CustomDrumSample[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: CustomDrumSample[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<CustomDrumSample>;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    const sampleUrl =
      typeof obj.sampleUrl === 'string' && isCustomSampleUrl(obj.sampleUrl)
        ? obj.sampleUrl
        : buildCustomSampleUrl(id);
    seen.add(id);
    result.push({
      id,
      name,
      sampleUrl,
      ...(typeof obj.createdAt === 'number' ? { createdAt: obj.createdAt } : {})
    });
  }
  return result;
}

export function loadPersistedCustomDrumSamples(): CustomDrumSample[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CUSTOM_DRUM_SAMPLES_STORAGE_KEY);
    if (!raw) return [];
    return normalizeCustomDrumSamples(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function savePersistedCustomDrumSamples(samples: CustomDrumSample[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CUSTOM_DRUM_SAMPLES_STORAGE_KEY, JSON.stringify(samples));
  } catch {
    // ignore storage quota errors
  }
}

const createEmptyPatterns = (numPatterns = 8, length = 16) =>
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

export const initialDrumState: DrumState = {
  drumChannels: DEFAULT_DRUM_CHANNELS,
  customDrumSamples: loadPersistedCustomDrumSamples(),
  activeDrumKitId: 'kit_1',
  patternLengths: [16, 16, 16, 16, 16, 16, 16, 16],
  drumPatternNames: [],
  drumArrangementMode: 'sequencer',
  userDrumPatternEdit: 0,
  currentDrumPatternEdit: 0,
  isLiveFollowLocked: false,
  clipboardPattern: null,
  clipboardPatternLength: null,
  patternChain: [],
  selectedChainIds: [],
  chainClipboard: [],
  drumTimelineViewport: { scrollLeft: 0, zoomLevel: 1.0 },
  isPatternRepeatOn: true,
  currentChainItemId: null,
};

export const createDrumSlice: SliceCreator<DrumState & DrumActions> = (set, get) => ({
  ...initialDrumState,

  selectDrumKit: (kitId) => set((state) => {
    if (kitId === 'custom') {
      return { activeDrumKitId: 'custom' };
    }

    const kit = PRESET_DRUM_KITS.find(k => k.id === kitId);
    if (!kit) return state;

    const nextChannels = state.drumChannels.map(ch => {
      const newSampleUrl = kit.samples[ch.id] || kit.samples[inferCategoryFromChannel(ch)];
      if (newSampleUrl) {
        return { ...ch, sampleUrl: newSampleUrl };
      }
      return ch;
    });

    return {
      drumChannels: nextChannels,
      activeDrumKitId: kitId
    };
  }),

  setCurrentDrumPatternEdit: (pattern: number) => set((state) => ({
    userDrumPatternEdit: pattern,
    currentDrumPatternEdit: pattern,
    isLiveFollowLocked: state.isPlaying ? true : state.isLiveFollowLocked
  })),

  setCurrentDrumPatternEditLive: (pattern: number) => set({ currentDrumPatternEdit: pattern }),

  setDrumPatternLength: (patternIndex: number, length: number) => set((state) => {
    const clampedLen = Math.max(4, Math.min(32, Math.round(length)));
    const totalPatterns = state.drumChannels[0]?.patterns.length || 8;
    const nextLengths = [...(state.patternLengths || [])];
    while (nextLengths.length < totalPatterns) {
      nextLengths.push(16);
    }
    nextLengths[patternIndex] = clampedLen;

    const nextChannels = state.drumChannels.map(ch => {
      const nextPatterns = [...ch.patterns];
      const currentSteps = nextPatterns[patternIndex] ? [...nextPatterns[patternIndex]] : [];
      if (currentSteps.length < clampedLen) {
        while (currentSteps.length < clampedLen) {
          currentSteps.push({ isActive: false, velocity: 0.8 });
        }
        nextPatterns[patternIndex] = currentSteps;
        return { ...ch, patterns: nextPatterns };
      }
      return ch;
    });

    return {
      drumChannels: nextChannels,
      patternLengths: nextLengths
    };
  }),

  renameDrumPattern: (patternIndex: number, name: string) => set((state) => {
    const trimmed = name.trim();
    const totalPatterns = state.drumChannels[0]?.patterns.length || 8;
    const nextNames = [...(state.drumPatternNames || [])];
    while (nextNames.length < totalPatterns) {
      nextNames.push('');
    }
    nextNames[patternIndex] = trimmed;
    return { drumPatternNames: nextNames };
  }),

  setDrumArrangementMode: (drumArrangementMode) => set({ drumArrangementMode }),

  addDrumChannel: (channel) => set((state) => ({ drumChannels: [...state.drumChannels, channel] })),

  updateDrumChannel: (id, updates) => set((state) => {
    const nextChannels = state.drumChannels.map(ch => ch.id === id ? { ...ch, ...updates } : ch);
    const newKitId = updates.sampleUrl !== undefined ? findMatchingKitId(nextChannels) : state.activeDrumKitId;
    return {
      drumChannels: nextChannels,
      activeDrumKitId: newKitId
    };
  }),

  removeDrumChannel: (id) => set((state) => ({
    drumChannels: state.drumChannels.filter(c => c.id !== id)
  })),

  addCustomDrumSample: (sample) => set((state) => {
    const existingIdx = state.customDrumSamples.findIndex(s => s.id === sample.id);
    const nextSamples =
      existingIdx >= 0
        ? state.customDrumSamples.map((s, i) => (i === existingIdx ? sample : s))
        : [...state.customDrumSamples, sample];
    savePersistedCustomDrumSamples(nextSamples);
    return { customDrumSamples: nextSamples };
  }),

  removeCustomDrumSample: (sampleId) => set((state) => {
    const target = state.customDrumSamples.find(s => s.id === sampleId);
    if (!target) return state;

    const nextSamples = state.customDrumSamples.filter(s => s.id !== sampleId);
    savePersistedCustomDrumSamples(nextSamples);

    let channelsUpdated = false;
    const nextChannels = state.drumChannels.map((ch) => {
      if (ch.sampleUrl !== target.sampleUrl) return ch;
      channelsUpdated = true;
      const fallbackUrl =
        PRESET_DRUM_KITS[0]?.samples[ch.id] ||
        PRESET_DRUM_KITS[0]?.samples[inferCategoryFromChannel(ch)] ||
        '/drums/kicks/kick1.wav';
      return { ...ch, sampleUrl: fallbackUrl };
    });

    return {
      customDrumSamples: nextSamples,
      ...(channelsUpdated
        ? {
            drumChannels: nextChannels,
            activeDrumKitId: findMatchingKitId(nextChannels)
          }
        : {})
    };
  }),

  setCustomDrumSamples: (samples) => set(() => {
    const normalized = normalizeCustomDrumSamples(samples);
    savePersistedCustomDrumSamples(normalized);
    return { customDrumSamples: normalized };
  }),

  reorderDrumChannels: (fromIndex, toIndex) => set((state) => {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= state.drumChannels.length ||
      toIndex >= state.drumChannels.length
    ) {
      return state;
    }
    const nextChannels = [...state.drumChannels];
    const [movedItem] = nextChannels.splice(fromIndex, 1);
    nextChannels.splice(toIndex, 0, movedItem);
    return { drumChannels: nextChannels };
  }),

  toggleDrumStep: (channelId, stepIndex, patternIndex, forceState) => set((state) => {
    let becameActive = false;
    const nextChannels = state.drumChannels.map(ch => {
      if (ch.id === channelId) {
        const nextPatterns = [...ch.patterns];
        const nextSteps = [...nextPatterns[patternIndex]];
        const currentStep = nextSteps[stepIndex];
        const nextIsActive = forceState !== undefined ? forceState : !currentStep.isActive;
        if (nextIsActive) becameActive = true;
        nextSteps[stepIndex] = { ...currentStep, isActive: nextIsActive };
        nextPatterns[patternIndex] = nextSteps;
        return { ...ch, patterns: nextPatterns };
      }
      return ch;
    });

    let nextChain = state.patternChain;
    if (becameActive && state.patternChain.length === 0) {
      nextChain = [{
        id: generateId('chain'),
        type: 'pattern',
        patternIndex,
        startMeasure: 0,
        durationMeasures: 1,
        repeatCount: 1
      }];
    }

    return {
      drumChannels: nextChannels,
      patternChain: nextChain,
      userDrumPatternEdit: patternIndex,
      ...(state.isPlaying && { isLiveFollowLocked: true })
    };
  }),

  setDrumStepVelocity: (channelId, stepIndex, patternIndex, velocity) => set((state) => {
    const nextChannels = state.drumChannels.map(ch => {
      if (ch.id === channelId) {
        const nextPatterns = [...ch.patterns];
        const nextSteps = [...nextPatterns[patternIndex]];
        if (nextSteps[stepIndex]) {
          nextSteps[stepIndex] = { ...nextSteps[stepIndex], velocity };
        }
        nextPatterns[patternIndex] = nextSteps;
        return { ...ch, patterns: nextPatterns };
      }
      return ch;
    });
    return {
      drumChannels: nextChannels,
      userDrumPatternEdit: patternIndex,
      ...(state.isPlaying && { isLiveFollowLocked: true })
    };
  }),

  copyDrumPattern: (sourcePatternIndex) => set((state) => {
    const copiedData = state.drumChannels.map(ch => ch.patterns[sourcePatternIndex]?.map(step => ({ ...step })));
    const copiedLength = state.patternLengths?.[sourcePatternIndex] || 16;
    return { clipboardPattern: copiedData, clipboardPatternLength: copiedLength };
  }),

  pasteDrumPattern: (targetPatternIndex) => set((state) => {
    if (!state.clipboardPattern) return state;

    const copiedLength = state.clipboardPatternLength || 16;
    const totalPatterns = state.drumChannels[0]?.patterns.length || 8;
    const nextLengths = [...(state.patternLengths || [])];
    while (nextLengths.length < totalPatterns) {
      nextLengths.push(16);
    }
    nextLengths[targetPatternIndex] = copiedLength;

    const nextChannels = state.drumChannels.map((ch, idx) => {
      const nextPatterns = [...ch.patterns];
      if (state.clipboardPattern && state.clipboardPattern[idx]) {
        nextPatterns[targetPatternIndex] = state.clipboardPattern[idx].map(step => ({ ...step }));
      }
      return { ...ch, patterns: nextPatterns };
    });
    return {
      drumChannels: nextChannels,
      patternLengths: nextLengths,
      userDrumPatternEdit: targetPatternIndex,
      currentDrumPatternEdit: targetPatternIndex,
      isLiveFollowLocked: state.isPlaying ? true : state.isLiveFollowLocked
    };
  }),

  addDrumPattern: () => {
    let newIndex = 0;
    set((state) => {
      const nextChannels = state.drumChannels.map(ch => {
        const nextPatterns = [...ch.patterns];
        nextPatterns.push(Array.from({ length: 16 }).map(() => ({ isActive: false, velocity: 0.8 })));
        return { ...ch, patterns: nextPatterns };
      });
      newIndex = (nextChannels[0]?.patterns.length ?? 1) - 1;
      const nextLengths = [...(state.patternLengths || [])];
      nextLengths.push(16);
      const nextNames = [...(state.drumPatternNames || [])];
      while (nextNames.length < newIndex) nextNames.push('');
      nextNames.push('');
      return {
        drumChannels: nextChannels,
        patternLengths: nextLengths,
        drumPatternNames: nextNames,
        userDrumPatternEdit: newIndex,
        currentDrumPatternEdit: newIndex,
        isLiveFollowLocked: state.isPlaying ? true : state.isLiveFollowLocked
      };
    });
    return newIndex;
  },

  duplicateDrumPattern: (sourceIndex) => {
    let newIndex = 0;
    set((state) => {
      const sourceLen = state.patternLengths?.[sourceIndex] || 16;
      const nextChannels = state.drumChannels.map(ch => {
        const nextPatterns = [...ch.patterns];
        const sourcePattern = nextPatterns[sourceIndex] || Array.from({ length: sourceLen }).map(() => ({ isActive: false, velocity: 0.8 }));
        nextPatterns.push(sourcePattern.map(step => ({ ...step })));
        return { ...ch, patterns: nextPatterns };
      });
      newIndex = (nextChannels[0]?.patterns.length ?? 1) - 1;
      const nextLengths = [...(state.patternLengths || [])];
      nextLengths.push(sourceLen);
      const nextNames = [...(state.drumPatternNames || [])];
      while (nextNames.length < newIndex) nextNames.push('');
      const sourceCustomName = state.drumPatternNames?.[sourceIndex]?.trim();
      nextNames.push(sourceCustomName ? `${sourceCustomName} (copia)` : '');
      return {
        drumChannels: nextChannels,
        patternLengths: nextLengths,
        drumPatternNames: nextNames,
        userDrumPatternEdit: newIndex,
        currentDrumPatternEdit: newIndex,
        isLiveFollowLocked: state.isPlaying ? true : state.isLiveFollowLocked
      };
    });
    return newIndex;
  },

  removeDrumPattern: (targetIndex) => set((state) => {
    const totalPatterns = state.drumChannels[0]?.patterns.length || 0;
    if (totalPatterns <= 1) return state;

    const nextChannels = state.drumChannels.map(ch => {
      const nextPatterns = ch.patterns.filter((_, idx) => idx !== targetIndex);
      return { ...ch, patterns: nextPatterns };
    });

    const nextLengths = (state.patternLengths || []).filter((_, idx) => idx !== targetIndex);
    const nextNames = (state.drumPatternNames || []).filter((_, idx) => idx !== targetIndex);

    const nextChain: PatternChainItem[] = normalizePatternChainItems(state.patternChain).map(item => {
      if (item.patternIndex === undefined || item.patternIndex < 0) return item;
      if (item.patternIndex === targetIndex) return { ...item, patternIndex: Math.max(0, targetIndex - 1) };
      if (item.patternIndex > targetIndex) return { ...item, patternIndex: item.patternIndex - 1 };
      return item;
    });

    const removedMidiClipIds = new Set<string>();
    const nextMidiClips = (state.midiClips || []).reduce<typeof state.midiClips>((acc, clip) => {
      if (clip.sourceType !== 'drums') {
        acc.push(clip);
        return acc;
      }
      const pIdx = clip.drumPatternIndex ?? 0;
      if (pIdx === targetIndex) {
        removedMidiClipIds.add(clip.id);
        return acc;
      }
      if (pIdx > targetIndex) {
        acc.push({ ...clip, drumPatternIndex: pIdx - 1 });
        return acc;
      }
      acc.push(clip);
      return acc;
    }, []);

    const nextSelectedMidiClipIds = removedMidiClipIds.size > 0
      ? (state.selectedMidiClipIds || []).filter((id) => !removedMidiClipIds.has(id))
      : state.selectedMidiClipIds;

    const newEditIndex = Math.max(0, Math.min(totalPatterns - 2, state.userDrumPatternEdit >= targetIndex ? state.userDrumPatternEdit - 1 : state.userDrumPatternEdit));
    const nextSelectedPatternRef =
      state.selectedPatternRef?.sourceType === 'drums'
        ? {
            sourceType: 'drums' as const,
            drumPatternIndex:
              state.selectedPatternRef.drumPatternIndex === targetIndex
                ? newEditIndex
                : state.selectedPatternRef.drumPatternIndex > targetIndex
                ? state.selectedPatternRef.drumPatternIndex - 1
                : state.selectedPatternRef.drumPatternIndex
          }
        : state.selectedPatternRef;

    return {
      drumChannels: nextChannels,
      patternLengths: nextLengths,
      drumPatternNames: nextNames,
      patternChain: nextChain,
      midiClips: nextMidiClips,
      selectedMidiClipIds: nextSelectedMidiClipIds,
      selectedPatternRef: nextSelectedPatternRef,
      userDrumPatternEdit: newEditIndex,
      currentDrumPatternEdit: newEditIndex,
      isLiveFollowLocked: state.isPlaying ? true : state.isLiveFollowLocked
    };
  }),

  clearDrumPattern: (targetIndex) => set((state) => {
    const currentLen = state.patternLengths?.[targetIndex] || 16;
    const nextChannels = state.drumChannels.map(ch => {
      const nextPatterns = [...ch.patterns];
      if (nextPatterns[targetIndex]) {
        nextPatterns[targetIndex] = Array.from({ length: currentLen }).map(() => ({ isActive: false, velocity: 0.8 }));
      }
      return { ...ch, patterns: nextPatterns };
    });
    return { drumChannels: nextChannels };
  }),

  setPatternRepeatOn: (active) => set({ isPatternRepeatOn: active }),
  setCurrentChainItemId: (id) => set({ currentChainItemId: id }),

  setSelectedChainIds: (selectedChainIds) => set({ selectedChainIds }),

  toggleSelectChainId: (id, multi = false) => set((state) => {
    if (!multi) {
      return { selectedChainIds: state.selectedChainIds.includes(id) && state.selectedChainIds.length === 1 ? [] : [id] };
    }
    const exists = state.selectedChainIds.includes(id);
    return {
      selectedChainIds: exists
        ? state.selectedChainIds.filter(i => i !== id)
        : [...state.selectedChainIds, id]
    };
  }),

  selectAllChainItems: () => set((state) => {
    const linear = normalizePatternChainItems(state.patternChain);
    return { selectedChainIds: linear.map(item => item.id) };
  }),

  copySelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;
    const linear = normalizePatternChainItems(state.patternChain);
    const copied = linear
      .filter(item => state.selectedChainIds.includes(item.id))
      .map(item => ({ ...item }));
    return { chainClipboard: copied };
  }),

  cutSelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;
    const linear = normalizePatternChainItems(state.patternChain);
    const copied: PatternChainItem[] = [];
    const nextChain: PatternChainItem[] = [];

    for (const item of linear) {
      if (state.selectedChainIds.includes(item.id)) {
        copied.push({ ...item });
      } else {
        nextChain.push(item);
      }
    }

    return {
      chainClipboard: copied,
      patternChain: nextChain,
      selectedChainIds: []
    };
  }),

  pasteChainItems: (targetId) => set((state) => {
    if (!state.chainClipboard || state.chainClipboard.length === 0) return state;

    const linearClip = normalizePatternChainItems(state.chainClipboard);
    if (linearClip.length === 0) return state;

    const linearExisting = normalizePatternChainItems(state.patternChain);
    const beatsPerMeasure = state.timeSignature === '3/4' ? 3 : state.timeSignature === '6/8' ? 6 : 4;
    const minStart = Math.min(...linearClip.map(i => i.startMeasure ?? 0));

    let targetBaseMeasure = Math.max(0, Math.round(((state.currentBeat || 0) / beatsPerMeasure) * 4) / 4);
    if (targetId) {
      const targetItem = linearExisting.find(i => i.id === targetId);
      if (targetItem) {
        targetBaseMeasure = (targetItem.startMeasure ?? 0) + (targetItem.durationMeasures ?? targetItem.repeatCount ?? 1);
      }
    } else if (targetBaseMeasure === 0 && linearExisting.length > 0 && state.currentBeat === 0) {
      targetBaseMeasure = linearExisting.reduce((m, i) => Math.max(m, (i.startMeasure ?? 0) + (i.durationMeasures ?? 1)), 0);
    }

    const pasted: PatternChainItem[] = linearClip.map(item => ({
      ...item,
      id: generateId('chain'),
      startMeasure: targetBaseMeasure + ((item.startMeasure ?? 0) - minStart)
    }));

    const nextChain = [...linearExisting, ...pasted].sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0));
    return {
      patternChain: nextChain,
      selectedChainIds: pasted.map(i => i.id)
    };
  }),

  duplicateSelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;
    const linear = normalizePatternChainItems(state.patternChain);
    const selected = linear.filter(i => state.selectedChainIds.includes(i.id));
    if (selected.length === 0) return state;

    const minStart = Math.min(...selected.map(i => i.startMeasure ?? 0));
    const maxEnd = selected.reduce((m, i) => Math.max(m, (i.startMeasure ?? 0) + (i.durationMeasures ?? 1)), 0);
    const span = Math.max(0.25, maxEnd - minStart);

    const clones: PatternChainItem[] = selected.map(i => ({
      ...i,
      id: generateId('chain'),
      startMeasure: (i.startMeasure ?? 0) + span
    }));

    const nextChain = [...linear, ...clones].sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0));
    return {
      patternChain: nextChain,
      selectedChainIds: clones.map(c => c.id)
    };
  }),

  deleteSelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;
    const linear = normalizePatternChainItems(state.patternChain);
    const nextChain = linear.filter(item => !state.selectedChainIds.includes(item.id));
    return {
      patternChain: nextChain,
      selectedChainIds: []
    };
  }),

  groupSelectedChainItems: () => set((state) => state),
  ungroupSelectedChainItems: () => set((state) => state),

  setDrumTimelineViewport: (viewport) => set((state) => ({
    drumTimelineViewport: { ...state.drumTimelineViewport, ...viewport }
  })),

  resetDrumTimelineScroll: () => set((state) => ({
    drumTimelineViewport: { ...state.drumTimelineViewport, scrollLeft: 0 }
  })),

  addChainItem: (patternIndex, durationMeasures = 1, startMeasure) => set((state) => {
    if (patternIndex < 0) return state;
    const linear = normalizePatternChainItems(state.patternChain);
    const maxEnd = linear.reduce((m, i) => Math.max(m, (i.startMeasure ?? 0) + (i.durationMeasures ?? 1)), 0);
    const resolvedStart = typeof startMeasure === 'number' ? Math.max(0, startMeasure) : maxEnd;
    const dur = Math.max(0.25, durationMeasures);

    const newItem: PatternChainItem = {
      id: generateId('chain'),
      type: 'pattern',
      patternIndex,
      startMeasure: resolvedStart,
      durationMeasures: dur,
      repeatCount: Math.max(1, Math.round(dur))
    };

    return {
      patternChain: [...linear, newItem].sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0)),
      selectedChainIds: [newItem.id]
    };
  }),

  addChainItemsBatch: (clips) => {
    if (!clips || clips.length === 0) return [];
    const linear = normalizePatternChainItems(get().patternChain);
    const created: PatternChainItem[] = clips.map(c => {
      const dur = Math.max(0.25, c.durationMeasures);
      return {
        id: generateId('chain'),
        type: 'pattern' as const,
        patternIndex: Math.max(0, c.patternIndex),
        startMeasure: Math.max(0, c.startMeasure),
        durationMeasures: dur,
        repeatCount: Math.max(1, Math.round(dur))
      };
    });
    const newIds = created.map(c => c.id);
    set({
      patternChain: [...linear, ...created].sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0)),
      selectedChainIds: newIds
    });
    return newIds;
  },

  updateChainItem: (id, updates) => set((state) => {
    const linear = normalizePatternChainItems(state.patternChain);
    const nextChain = linear.map(item => {
      if (item.id !== id) return item;
      const merged = { ...item, ...updates };
      if (updates.durationMeasures !== undefined) {
        merged.repeatCount = Math.max(1, Math.round(updates.durationMeasures));
      } else if (updates.repeatCount !== undefined) {
        merged.durationMeasures = Math.max(0.25, updates.repeatCount);
      }
      return merged;
    }).sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0));
    return { patternChain: nextChain };
  }),

  updateChainItemsBatch: (updates) => set((state) => {
    if (!updates || updates.length === 0) return state;
    const map = new Map(updates.map(u => [u.id, u.changes]));
    const linear = normalizePatternChainItems(state.patternChain);
    const nextChain = linear.map(item => {
      const chg = map.get(item.id);
      if (!chg) return item;
      const merged = { ...item, ...chg };
      if (chg.durationMeasures !== undefined) {
        merged.repeatCount = Math.max(1, Math.round(chg.durationMeasures));
      } else if (chg.repeatCount !== undefined) {
        merged.durationMeasures = Math.max(0.25, chg.repeatCount);
      }
      return merged;
    }).sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0));
    return { patternChain: nextChain };
  }),

  splitChainItem: (id, splitMeasure) => set((state) => {
    const linear = normalizePatternChainItems(state.patternChain);
    const target = linear.find(i => i.id === id);
    if (!target) return state;
    const start = target.startMeasure ?? 0;
    const dur = target.durationMeasures ?? target.repeatCount ?? 1;
    const end = start + dur;
    if (splitMeasure <= start + 0.125 || splitMeasure >= end - 0.125) return state;

    const firstDur = splitMeasure - start;
    const secondDur = end - splitMeasure;
    const secondItem: PatternChainItem = {
      id: generateId('chain'),
      type: 'pattern',
      patternIndex: target.patternIndex ?? 0,
      startMeasure: splitMeasure,
      durationMeasures: secondDur,
      repeatCount: Math.max(1, Math.round(secondDur))
    };

    const nextChain = [
      ...linear.map(i => i.id === id ? {
        ...i,
        durationMeasures: firstDur,
        repeatCount: Math.max(1, Math.round(firstDur))
      } : i),
      secondItem
    ].sort((a, b) => (a.startMeasure ?? 0) - (b.startMeasure ?? 0));

    return {
      patternChain: nextChain,
      selectedChainIds: [id, secondItem.id]
    };
  }),

  makeChainItemUnique: (id) => {
    const state = get();
    const linear = normalizePatternChainItems(state.patternChain);
    const target = linear.find(i => i.id === id);
    if (!target) return null;

    const sourceIndex = Math.max(0, target.patternIndex ?? 0);
    const sourceLen = state.patternLengths?.[sourceIndex] || 16;
    const nextChannels = state.drumChannels.map(ch => {
      const nextPatterns = [...ch.patterns];
      const sourcePat = nextPatterns[sourceIndex] || Array.from({ length: sourceLen }).map(() => ({ isActive: false, velocity: 0.8 }));
      nextPatterns.push(sourcePat.map(s => ({ ...s })));
      return { ...ch, patterns: nextPatterns };
    });
    const newPatternIndex = (nextChannels[0]?.patterns.length ?? 1) - 1;
    const nextLengths = [...(state.patternLengths || []), sourceLen];

    const nextChain = linear.map(item =>
      item.id === id ? { ...item, patternIndex: newPatternIndex } : item
    );

    set({
      drumChannels: nextChannels,
      patternLengths: nextLengths,
      patternChain: nextChain,
      userDrumPatternEdit: newPatternIndex,
      currentDrumPatternEdit: newPatternIndex,
      isLiveFollowLocked: state.isPlaying ? true : state.isLiveFollowLocked
    });
    return newPatternIndex;
  },

  fillChainToSong: (patternIndex, targetMeasures) => set(() => {
    const dur = Math.max(1, Math.ceil(targetMeasures));
    const item: PatternChainItem = {
      id: generateId('chain'),
      type: 'pattern',
      patternIndex: Math.max(0, patternIndex),
      startMeasure: 0,
      durationMeasures: dur,
      repeatCount: dur
    };
    return {
      patternChain: [item],
      isPatternRepeatOn: false,
      selectedChainIds: [item.id]
    };
  }),

  clearPatternChain: () => set({
    patternChain: [],
    selectedChainIds: [],
    currentChainItemId: null
  }),

  removeChainItem: (id) => set((state) => {
    const linear = normalizePatternChainItems(state.patternChain);
    return {
      patternChain: linear.filter(item => item.id !== id),
      selectedChainIds: state.selectedChainIds.filter(selectedId => selectedId !== id)
    };
  }),

  moveChainItem: (fromIndex, toIndex) => set((state) => {
    if (fromIndex < 0 || fromIndex >= state.patternChain.length || toIndex < 0 || toIndex >= state.patternChain.length) return state;
    const nextChain = [...state.patternChain];
    const [moved] = nextChain.splice(fromIndex, 1);
    nextChain.splice(toIndex, 0, moved);
    return { patternChain: nextChain };
  }),
});
