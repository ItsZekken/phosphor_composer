import type { SliceCreator, MixerState, MixerActions } from '../types';
import type { ChannelConfig } from '../../utils/typeDefinitions';

export const DEFAULT_CHANNELS: Record<string, ChannelConfig> = {
  master: {
    id: 'master',
    name: 'MASTER',
    type: 'master',
    instrument: 'synth',
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
    color: '#ffaa00'
  },
  chords: {
    id: 'chords',
    name: 'Armonía',
    type: 'chords',
    instrument: 'synth',
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
    color: '#00ffcc'
  },
  melody: {
    id: 'melody',
    name: 'Melodía 1',
    type: 'melody',
    instrument: 'synth',
    volume: 85,
    pan: 0,
    muted: false,
    solo: false,
    color: '#ff00aa'
  },
  drums: {
    id: 'drums',
    name: 'Batería',
    type: 'drums',
    instrument: 'sampler',
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
    color: '#00e5ff'
  }
};

export const initialMixerState: MixerState = {
  channels: DEFAULT_CHANNELS,
  channelOrder: ['master', 'chords', 'melody', 'drums'],
  isMixerOpen: false,
};

export const createMixerSlice: SliceCreator<MixerState & MixerActions> = (set, get) => ({
  ...initialMixerState,

  setMixerOpen: (isMixerOpen) => set({ isMixerOpen }),

  updateChannel: (id, updates) => set((state) => {
    const existing = state.channels[id];
    if (!existing) return state;
    const updatedChannel = { ...existing, ...updates };
    return { channels: { ...state.channels, [id]: updatedChannel } };
  }),

  toggleMute: (id) => get().updateChannel(id, { muted: !get().channels[id]?.muted }),
  toggleSolo: (id) => get().updateChannel(id, { solo: !get().channels[id]?.solo }),
  setChannelVolume: (id, volume) => get().updateChannel(id, { volume }),
  setChannelPan: (id, pan) => get().updateChannel(id, { pan }),

  setChannelInstrument: (id, instrument) => {
    get().updateChannel(id, { instrument });
    if (id === 'chords' && (instrument === 'piano' || instrument === 'synth')) {
      set({ instrumentType: instrument });
    }
  },

  setChannelOrder: (channelOrder) => set({ channelOrder }),

  reorderChannels: (fromIndex, toIndex) => set((state) => {
    const currentOrder = (state.channelOrder && Array.isArray(state.channelOrder) && state.channelOrder.length > 0)
      ? state.channelOrder
      : ['master', ...Object.keys(state.channels || {}).filter(k => k !== 'master')];
    const newOrder = [...currentOrder];
    if (fromIndex < 0 || fromIndex >= newOrder.length || toIndex < 0 || toIndex >= newOrder.length) return state;
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    return { channelOrder: newOrder };
  }),
});
