import type { SliceCreator, DrumState, DrumActions } from '../types';
import type { DrumChannel } from '../../utils/typeDefinitions';
import { PRESET_DRUM_KITS, findMatchingKitId, inferCategoryFromChannel } from '../../constants/drumKits';
import { generateId } from '../../utils/idGenerator';

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
  activeDrumKitId: 'kit_1',
  userDrumPatternEdit: 0,
  currentDrumPatternEdit: 0,
  isLiveFollowLocked: false,
  clipboardPattern: null,
  patternChain: [],
  isPatternRepeatOn: true,
  currentChainItemId: null,
};

export const createDrumSlice: SliceCreator<DrumState & DrumActions> = (set) => ({
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
        if (nextSteps[stepIndex]) {
          const isActivating = forceState !== undefined ? forceState : !nextSteps[stepIndex].isActive;
          nextSteps[stepIndex] = {
            ...nextSteps[stepIndex],
            isActive: isActivating
          };
          if (isActivating) becameActive = true;
        }
        nextPatterns[patternIndex] = nextSteps;
        return { ...ch, patterns: nextPatterns };
      }
      return ch;
    });

    let nextChain = state.patternChain;
    if (becameActive) {
      const isInChain = state.patternChain.some(item => item.patternIndex === patternIndex);
      if (!isInChain) {
        nextChain = [...state.patternChain, { id: generateId('chain'), type: 'pattern', patternIndex, repeatCount: 1 }];
      }
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
    const copiedData = state.drumChannels.map(ch => ch.patterns[sourcePatternIndex]);
    return { clipboardPattern: copiedData };
  }),

  pasteDrumPattern: (targetPatternIndex) => set((state) => {
    if (!state.clipboardPattern) return state;

    const nextChannels = state.drumChannels.map((ch, idx) => {
      const nextPatterns = [...ch.patterns];
      if (state.clipboardPattern && state.clipboardPattern[idx]) {
        nextPatterns[targetPatternIndex] = state.clipboardPattern[idx].map(step => ({ ...step }));
      }
      return { ...ch, patterns: nextPatterns };
    });
    return {
      drumChannels: nextChannels,
      userDrumPatternEdit: targetPatternIndex,
      currentDrumPatternEdit: targetPatternIndex,
      isLiveFollowLocked: state.isPlaying ? true : state.isLiveFollowLocked
    };
  }),

  setPatternRepeatOn: (active) => set({ isPatternRepeatOn: active }),
  setCurrentChainItemId: (id) => set({ currentChainItemId: id }),

  addChainItem: (patternIndex, repeatCount = 1) => set((state) => ({
    patternChain: [...state.patternChain, { id: generateId('chain'), type: 'pattern', patternIndex, repeatCount }]
  })),

  updateChainItem: (id, updates) => set((state) => ({
    patternChain: state.patternChain.map(item => item.id === id ? { ...item, ...updates } : item)
  })),

  removeChainItem: (id) => set((state) => ({
    patternChain: state.patternChain.filter(item => item.id !== id)
  })),

  moveChainItem: (fromIndex, toIndex) => set((state) => {
    if (fromIndex < 0 || fromIndex >= state.patternChain.length || toIndex < 0 || toIndex >= state.patternChain.length) return state;
    const nextChain = [...state.patternChain];
    const [moved] = nextChain.splice(fromIndex, 1);
    nextChain.splice(toIndex, 0, moved);
    return { patternChain: nextChain };
  }),
});
