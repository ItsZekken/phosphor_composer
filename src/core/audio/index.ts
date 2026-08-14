/**
 * src/core/audio/index.ts
 * Barrel export para el sistema de audio, scheduling de timeline y renderizado offline.
 */

export * from './audioTypes';
export * from './timelineScheduler';
export * from './offlineRenderer';
export * from './pianoSampler';
export * from './engine/MixerGraph';
export * from './engine/SynthVoiceManager';
export * from './engine/DrumSoundManager';
export * from './engine/PreviewManager';
export * from './engine/AudioTransport';
export * from './livePitchTracker';
