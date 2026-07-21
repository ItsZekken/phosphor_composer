import React from 'react';
import { Timeline } from './Timeline';
import { ChordPalette } from './ChordPalette';

export const ChordPlayerView: React.FC = () => {
  return (
    <div className="chord-player-view">
      <div className="timeline-properties-container">
        <Timeline />
      </div>
      <ChordPalette />
    </div>
  );
};
