import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import type { DrumChannel } from '../../utils/typeDefinitions';
import { Knob } from '../ui/Knob';
import { AVAILABLE_DRUM_SAMPLES, getSamplesByCategory } from '../../constants/drumSamples';
import { inferCategoryFromChannel } from '../../constants/drumKits';

interface Props {
  channel: DrumChannel;
  channelIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const DrumChannelRow: React.FC<Props> = ({ channel, channelIndex, isExpanded, onToggleExpand }) => {
  const { toggleDrumStep, setDrumStepVelocity, updateDrumChannel, playbackStep, isPlaying, currentDrumPatternEdit } = useSongStore();
  
  // Smart Draw State
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawAction, setDrawAction] = useState<boolean | null>(null);

  // Velocity Draw State (para la vista expandida)
  const [isDrawingVelocity, setIsDrawingVelocity] = useState(false);
  const velocityContainerRef = useRef<HTMLDivElement>(null);

  const handleStepMouseDown = (index: number, currentlyActive: boolean) => {
    setIsDrawing(true);
    const newState = !currentlyActive;
    setDrawAction(newState);
    toggleDrumStep(channel.id, index, currentDrumPatternEdit, newState);
    if (newState) {
      toneEngine.playDrumPreview(channel.id, channel.patterns[currentDrumPatternEdit][index].velocity);
    }
  };

  const handleStepMouseEnter = (index: number, currentlyActive: boolean) => {
    if (isDrawing && drawAction !== null) {
      if (currentlyActive !== drawAction) {
        toggleDrumStep(channel.id, index, currentDrumPatternEdit, drawAction);
      }
    }
  };

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
    setDrawAction(null);
    setIsDrawingVelocity(false);
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', stopDrawing);
    window.addEventListener('mouseleave', stopDrawing);
    return () => {
      window.removeEventListener('mouseup', stopDrawing);
      window.removeEventListener('mouseleave', stopDrawing);
    };
  }, [stopDrawing]);

  // Controles
  const handleVolumeDouble = () => updateDrumChannel(channel.id, { volume: 80 });
  const handlePanDouble = () => updateDrumChannel(channel.id, { pan: 0 });

  const handleSampleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSampleUrl = e.target.value;
    updateDrumChannel(channel.id, { sampleUrl: newSampleUrl });
    setTimeout(() => {
      toneEngine.playDrumPreview(channel.id);
    }, 50);
  };

  // Velocity Draw Logic
  const handleVelocityDraw = (e: React.MouseEvent | React.TouchEvent, forceDraw = false) => {
    if (!forceDraw && !isDrawingVelocity) return;
    if (!velocityContainerRef.current) return;
    
    const rect = velocityContainerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    const stepWidth = rect.width / 16;
    const stepIndex = Math.floor((clientX - rect.left) / stepWidth);
    
    if (stepIndex >= 0 && stepIndex < 16) {
      const relativeY = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const newVelocity = 1 - (relativeY / rect.height);
      setDrumStepVelocity(channel.id, stepIndex, currentDrumPatternEdit, newVelocity);
    }
  };

  // Colores de la paleta
  const colors = ['var(--reposo)', 'var(--subdominante)', 'var(--tension)', 'var(--spicy)', 'var(--exotic)'];
  const channelColor = colors[channelIndex % colors.length];

  // Activity Meter logic
  const activePattern = channel.patterns[currentDrumPatternEdit];
  const isPlayingActiveStep = isPlaying && activePattern && activePattern[playbackStep]?.isActive;

  // Cargar lista de muestras según la categoría del canal
  const category = inferCategoryFromChannel(channel);
  const categorySamples = getSamplesByCategory(category);
  const availableOptions = categorySamples.length > 0 ? categorySamples : AVAILABLE_DRUM_SAMPLES;

  return (
    <div className={`drum-channel-container ${isExpanded ? 'expanded' : ''}`}>
      <div className="drum-channel-row">
        {/* Panel Izquierdo: Controles */}
        <div className="drum-controls">
          <div 
            className="drum-title" 
            onClick={onToggleExpand}
            style={{ cursor: 'pointer' }}
          >
            <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
            <span className="channel-name-text">{channel.name}</span>
          </div>

          <div className="drum-sample-selector">
            <select 
              className="channel-sample-select"
              value={channel.sampleUrl}
              onChange={handleSampleChange}
              title={`Sample: ${channel.sampleUrl}`}
            >
              {availableOptions.map(sample => (
                <option key={sample.id} value={sample.path}>
                  {sample.name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="drum-activity-meter">
            <div className={`meter-led ${isPlayingActiveStep ? 'lit' : ''}`} style={{ '--led-color': channelColor } as React.CSSProperties} />
          </div>
          
          <div className="drum-knobs">
            <Knob 
              value={channel.volume} 
              min={0} max={100} size={24} 
              onChange={(val) => updateDrumChannel(channel.id, { volume: val })} 
              onDoubleClick={handleVolumeDouble} 
              label="VOL" 
            />
            <Knob 
              value={channel.pan} 
              min={-1} max={1} size={24} 
              onChange={(val) => updateDrumChannel(channel.id, { pan: val })} 
              onDoubleClick={handlePanDouble} 
              label="PAN" 
            />
            <div className="drum-mute-solo">
              <button 
                className={`ms-btn ${channel.muted ? 'active-mute' : ''}`}
                onClick={(e) => { e.stopPropagation(); updateDrumChannel(channel.id, { muted: !channel.muted }); }}
              >M</button>
              <button 
                className={`ms-btn ${channel.solo ? 'active-solo' : ''}`}
                onClick={(e) => { e.stopPropagation(); updateDrumChannel(channel.id, { solo: !channel.solo }); }}
              >S</button>
            </div>
          </div>
        </div>

        {/* Panel Derecho: Switches (16 Steps) */}
        <div className="drum-steps" onMouseLeave={stopDrawing}>
          {activePattern && activePattern.map((step, i) => {
            const isDownbeat = i % 4 === 0;
            const isPlayingThisStep = isPlaying && playbackStep === i;
            return (
              <div 
                key={i}
                className={`drum-step ${step.isActive ? 'active' : ''} ${isDownbeat ? 'downbeat' : ''} ${isPlayingThisStep ? 'playback-head' : ''}`}
                style={{ '--switch-color': channelColor } as React.CSSProperties}
                onMouseDown={() => handleStepMouseDown(i, step.isActive)}
                onMouseEnter={() => handleStepMouseEnter(i, step.isActive)}
              />
            );
          })}
        </div>
      </div>

      {/* Accordion Detalle: Velocity */}
      {isExpanded && (
        <div className="drum-velocity-panel">
          <div className="velocity-label">VELOCITY</div>
          <div 
            className="velocity-editor"
            ref={velocityContainerRef}
            onMouseDown={(e) => { setIsDrawingVelocity(true); handleVelocityDraw(e, true); }}
            onMouseMove={(e) => handleVelocityDraw(e)}
            onTouchStart={(e) => { setIsDrawingVelocity(true); handleVelocityDraw(e, true); }}
            onTouchMove={(e) => handleVelocityDraw(e)}
          >
            {activePattern && activePattern.map((step, i) => (
              <div key={i} className={`velocity-bar-container ${i % 4 === 0 ? 'downbeat-bg' : ''} ${isPlaying && playbackStep === i ? 'playback-head-vel' : ''}`}>
                {step.isActive && (
                  <div 
                    className="velocity-bar" 
                    style={{ height: `${step.velocity * 100}%`, background: channelColor }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
