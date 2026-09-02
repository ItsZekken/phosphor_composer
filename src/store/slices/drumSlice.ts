import type { SliceCreator, DrumState, DrumActions } from '../types';
import type { DrumChannel, PatternChainItem } from '../../utils/typeDefinitions';
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
  selectedChainIds: [],
  chainClipboard: [],
  drumTimelineViewport: { scrollLeft: 0, zoomLevel: 1.0 },
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
      const hasAnyInChain = state.patternChain.some(i => i.patternIndex === patternIndex || i.items?.some(sub => sub.patternIndex === patternIndex));
      if (!hasAnyInChain) {
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

  addDrumPattern: () => {
    let newIndex = 0;
    set((state) => {
      const nextChannels = state.drumChannels.map(ch => {
        const nextPatterns = [...ch.patterns];
        nextPatterns.push(Array.from({ length: 16 }).map(() => ({ isActive: false, velocity: 0.8 })));
        return { ...ch, patterns: nextPatterns };
      });
      newIndex = (nextChannels[0]?.patterns.length ?? 1) - 1;
      return {
        drumChannels: nextChannels,
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
      const nextChannels = state.drumChannels.map(ch => {
        const nextPatterns = [...ch.patterns];
        const sourcePattern = nextPatterns[sourceIndex] || Array.from({ length: 16 }).map(() => ({ isActive: false, velocity: 0.8 }));
        nextPatterns.push(sourcePattern.map(step => ({ ...step })));
        return { ...ch, patterns: nextPatterns };
      });
      newIndex = (nextChannels[0]?.patterns.length ?? 1) - 1;
      return {
        drumChannels: nextChannels,
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

    const nextChain: PatternChainItem[] = state.patternChain
      .map(item => {
        if (item.type === 'group' && item.items) {
          const reindexedItems = item.items
            .map(sub => {
              if (sub.patternIndex === undefined || sub.patternIndex < 0) return sub;
              if (sub.patternIndex === targetIndex) return { ...sub, patternIndex: Math.max(0, targetIndex - 1) };
              if (sub.patternIndex > targetIndex) return { ...sub, patternIndex: sub.patternIndex - 1 };
              return sub;
            });
          return { ...item, items: reindexedItems };
        } else {
          if (item.patternIndex === undefined || item.patternIndex < 0) return item;
          if (item.patternIndex === targetIndex) return { ...item, patternIndex: Math.max(0, targetIndex - 1) };
          if (item.patternIndex > targetIndex) return { ...item, patternIndex: item.patternIndex - 1 };
          return item;
        }
      });

    const newEditIndex = Math.max(0, Math.min(totalPatterns - 2, state.userDrumPatternEdit >= targetIndex ? state.userDrumPatternEdit - 1 : state.userDrumPatternEdit));

    return {
      drumChannels: nextChannels,
      patternChain: nextChain,
      userDrumPatternEdit: newEditIndex,
      currentDrumPatternEdit: newEditIndex,
      isLiveFollowLocked: state.isPlaying ? true : state.isLiveFollowLocked
    };
  }),

  clearDrumPattern: (targetIndex) => set((state) => {
    const nextChannels = state.drumChannels.map(ch => {
      const nextPatterns = [...ch.patterns];
      if (nextPatterns[targetIndex]) {
        nextPatterns[targetIndex] = Array.from({ length: 16 }).map(() => ({ isActive: false, velocity: 0.8 }));
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
    const allIds: string[] = [];
    state.patternChain.forEach(item => {
      allIds.push(item.id);
      if (item.type === 'group' && item.items) {
        item.items.forEach(sub => allIds.push(sub.id));
      }
    });
    return { selectedChainIds: allIds };
  }),

  copySelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;
    const copied: PatternChainItem[] = [];
    state.patternChain.forEach(item => {
      if (state.selectedChainIds.includes(item.id)) {
        copied.push(JSON.parse(JSON.stringify(item)));
      } else if (item.type === 'group' && item.items) {
        const selectedSub = item.items.filter(sub => state.selectedChainIds.includes(sub.id));
        selectedSub.forEach(sub => copied.push(JSON.parse(JSON.stringify(sub))));
      }
    });
    return { chainClipboard: copied };
  }),

  cutSelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;
    const copied: PatternChainItem[] = [];
    const nextChain: PatternChainItem[] = [];

    state.patternChain.forEach(item => {
      if (state.selectedChainIds.includes(item.id)) {
        copied.push(JSON.parse(JSON.stringify(item)));
      } else if (item.type === 'group' && item.items) {
        const remainingSub: PatternChainItem[] = [];
        item.items.forEach(sub => {
          if (state.selectedChainIds.includes(sub.id)) {
            copied.push(JSON.parse(JSON.stringify(sub)));
          } else {
            remainingSub.push(sub);
          }
        });
        if (remainingSub.length > 0) {
          nextChain.push({ ...item, items: remainingSub });
        }
      } else {
        nextChain.push(item);
      }
    });

    return {
      chainClipboard: copied,
      patternChain: nextChain,
      selectedChainIds: []
    };
  }),

  pasteChainItems: (targetId) => set((state) => {
    if (!state.chainClipboard || state.chainClipboard.length === 0) return state;

    const clonedItems: PatternChainItem[] = state.chainClipboard.map(item => {
      const clone = JSON.parse(JSON.stringify(item));
      clone.id = generateId(clone.type === 'group' ? 'group' : 'chain');
      if (clone.type === 'group' && clone.items) {
        clone.items = clone.items.map((sub: any) => ({ ...sub, id: generateId('chain') }));
      }
      return clone;
    });

    const newIds = clonedItems.map(i => i.id);
    const nextChain = [...state.patternChain];

    if (targetId) {
      const targetIndex = nextChain.findIndex(i => i.id === targetId);
      if (targetIndex !== -1) {
        nextChain.splice(targetIndex + 1, 0, ...clonedItems);
      } else {
        nextChain.push(...clonedItems);
      }
    } else {
      nextChain.push(...clonedItems);
    }

    return {
      patternChain: nextChain,
      selectedChainIds: newIds
    };
  }),

  duplicateSelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;

    const nextChain: PatternChainItem[] = [];
    const newSelectedIds: string[] = [];

    state.patternChain.forEach(item => {
      nextChain.push(item);
      if (state.selectedChainIds.includes(item.id)) {
        const clone = JSON.parse(JSON.stringify(item));
        clone.id = generateId(clone.type === 'group' ? 'group' : 'chain');
        if (clone.type === 'group' && clone.items) {
          clone.items = clone.items.map((sub: any) => ({ ...sub, id: generateId('chain') }));
        }
        nextChain.push(clone);
        newSelectedIds.push(clone.id);
      } else if (item.type === 'group' && item.items) {
        const newGroupItems: PatternChainItem[] = [];
        item.items.forEach(sub => {
          newGroupItems.push(sub);
          if (state.selectedChainIds.includes(sub.id)) {
            const subClone = { ...sub, id: generateId('chain') };
            newGroupItems.push(subClone);
            newSelectedIds.push(subClone.id);
          }
        });
        nextChain[nextChain.length - 1] = { ...item, items: newGroupItems };
      }
    });

    return {
      patternChain: nextChain,
      selectedChainIds: newSelectedIds.length > 0 ? newSelectedIds : state.selectedChainIds
    };
  }),

  deleteSelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;
    const nextChain: PatternChainItem[] = [];

    state.patternChain.forEach(item => {
      if (!state.selectedChainIds.includes(item.id)) {
        if (item.type === 'group' && item.items) {
          const remaining = item.items.filter(sub => !state.selectedChainIds.includes(sub.id));
          if (remaining.length > 0) {
            nextChain.push({ ...item, items: remaining });
          }
        } else {
          nextChain.push(item);
        }
      }
    });

    return {
      patternChain: nextChain,
      selectedChainIds: []
    };
  }),

  groupSelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length <= 1) return state;
    const selectedTopLevel = state.patternChain.filter(i => state.selectedChainIds.includes(i.id));
    if (selectedTopLevel.length <= 1) return state;

    const firstIndex = state.patternChain.findIndex(i => state.selectedChainIds.includes(i.id));
    const newGroup: PatternChainItem = {
      id: generateId('group'),
      type: 'group',
      repeatCount: 1,
      items: selectedTopLevel.map(i => i.type === 'group' ? (i.items || []) : [i]).flat()
    };

    const nextChain = state.patternChain.filter(i => !state.selectedChainIds.includes(i.id));
    nextChain.splice(firstIndex, 0, newGroup);

    return {
      patternChain: nextChain,
      selectedChainIds: [newGroup.id]
    };
  }),

  ungroupSelectedChainItems: () => set((state) => {
    if (state.selectedChainIds.length === 0) return state;
    const nextChain: PatternChainItem[] = [];
    const newSelected: string[] = [];

    state.patternChain.forEach(item => {
      if (state.selectedChainIds.includes(item.id) && item.type === 'group' && item.items) {
        item.items.forEach(sub => {
          nextChain.push(sub);
          newSelected.push(sub.id);
        });
      } else {
        nextChain.push(item);
      }
    });

    return {
      patternChain: nextChain,
      selectedChainIds: newSelected.length > 0 ? newSelected : state.selectedChainIds
    };
  }),

  setDrumTimelineViewport: (viewport) => set((state) => ({
    drumTimelineViewport: { ...state.drumTimelineViewport, ...viewport }
  })),

  resetDrumTimelineScroll: () => set((state) => ({
    drumTimelineViewport: { ...state.drumTimelineViewport, scrollLeft: 0 }
  })),

  addChainItem: (patternIndex, repeatCount = 1) => set((state) => ({
    patternChain: [...state.patternChain, {
      id: generateId('chain'),
      type: patternIndex === -1 ? 'rest' : 'pattern',
      patternIndex,
      repeatCount
    }]
  })),

  updateChainItem: (id, updates) => set((state) => ({
    patternChain: state.patternChain.map(item => {
      if (item.id === id) return { ...item, ...updates };
      if (item.type === 'group' && item.items) {
        return {
          ...item,
          items: item.items.map(sub => sub.id === id ? { ...sub, ...updates } : sub)
        };
      }
      return item;
    })
  })),

  removeChainItem: (id) => set((state) => ({
    patternChain: state.patternChain.filter(item => {
      if (item.id === id) return false;
      if (item.type === 'group' && item.items) {
        item.items = item.items.filter(sub => sub.id !== id);
      }
      return true;
    }),
    selectedChainIds: state.selectedChainIds.filter(selectedId => selectedId !== id)
  })),

  moveChainItem: (fromIndex, toIndex) => set((state) => {
    if (fromIndex < 0 || fromIndex >= state.patternChain.length || toIndex < 0 || toIndex >= state.patternChain.length) return state;
    const nextChain = [...state.patternChain];
    const [moved] = nextChain.splice(fromIndex, 1);
    nextChain.splice(toIndex, 0, moved);
    return { patternChain: nextChain };
  }),
});
