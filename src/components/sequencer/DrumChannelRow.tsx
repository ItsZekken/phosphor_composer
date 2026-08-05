import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import type { DrumChannel } from '../../utils/typeDefinitions';
import { Knob } from '../ui/Knob';
import { DRUM_CATEGORIES, getSamplesByCategory } from '../../constants/drumSamples';
import { CustomSelect } from '../ui/CustomSelect';
import type { SelectGroup } from '../ui/CustomSelect';
import { Trash2, Sparkles, RefreshCw } from 'lucide-react';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';

interface Props {
  channel: DrumChannel;
  channelIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const DrumChannelRow: React.FC<Props> = ({ channel, channelIndex, isExpanded, onToggleExpand }) => {
  const { toggleDrumStep, setDrumStepVelocity, updateDrumChannel, removeDrumChannel, playbackStep, isPlaying, currentDrumPatternEdit } = useSongStore();
  
  // Smart Draw State
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawAction, setDrawAction] = useState<boolean | null>(null);

  // Rename state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState(channel.name);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Velocity Draw State
  const [isDrawingVelocity, setIsDrawingVelocity] = useState(false);

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

  const handleSampleChange = (newSampleUrl: string) => {
    updateDrumChannel(channel.id, { sampleUrl: newSampleUrl });
    setTimeout(() => {
      toneEngine.playDrumPreview(channel.id);
    }, 50);
  };

  // Velocity Draw Logic
  const handleVelocityDraw = (e: React.MouseEvent | React.TouchEvent, stepIndex: number, forceDraw = false) => {
    if (!forceDraw && !isDrawingVelocity) return;
    
    let currentElement = e.currentTarget as HTMLElement;
    const rect = currentElement.getBoundingClientRect();
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    const relativeY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const newVelocity = 1 - (relativeY / rect.height);
    setDrumStepVelocity(channel.id, stepIndex, currentDrumPatternEdit, newVelocity);
  };

  // Colores de la paleta
  const colors = ['var(--reposo)', 'var(--subdominante)', 'var(--tension)', 'var(--spicy)', 'var(--exotic)'];
  const channelColor = colors[channelIndex % colors.length];

  // Activity Meter logic
  const activePattern = channel.patterns[currentDrumPatternEdit];
  const isPlayingActiveStep = isPlaying && activePattern && activePattern[playbackStep]?.isActive;

  // Cargar lista de muestras por categorías
  const selectGroups: SelectGroup[] = DRUM_CATEGORIES.map(cat => ({
    label: cat.label,
    options: getSamplesByCategory(cat.key).map(sample => ({
      value: sample.path,
      label: sample.name
    }))
  })).filter(g => g.options.length > 0);

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number, y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (contextMenuPos) {
      const closeMenu = () => setContextMenuPos(null);
      window.addEventListener('click', closeMenu);
      return () => window.removeEventListener('click', closeMenu);
    }
  }, [contextMenuPos]);

  const handleTitleClick = (e: React.MouseEvent) => {
    // If editing, don't trigger anything
    if (isEditingName) return;

    if (e.detail === 1) {
      clickTimeoutRef.current = setTimeout(() => {
        onToggleExpand();
      }, 200); // 200ms delay to wait for double click
    } else if (e.detail === 2) {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
      setIsEditingName(true);
      setEditNameValue(channel.name);
    }
  };

  const handleNameSubmit = () => {
    if (editNameValue.trim() !== '') {
      updateDrumChannel(channel.id, { name: editNameValue.trim() });
    } else {
      setEditNameValue(channel.name);
    }
    setIsEditingName(false);
  };

  return (
    <div className={`drum-channel-container ${isExpanded ? 'expanded' : ''}`}>
      <div className="drum-channel-row">
        {/* Panel Izquierdo: Controles */}
        <div className="drum-controls">
          <div 
            className="drum-title" 
            onClick={handleTitleClick}
            onContextMenu={handleContextMenu}
            style={{ cursor: 'pointer', flex: 1, minWidth: 0, overflow: 'hidden' }}
          >
            <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
            {isEditingName ? (
              <input
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNameSubmit();
                  if (e.key === 'Escape') {
                    setEditNameValue(channel.name);
                    setIsEditingName(false);
                  }
                }}
                autoFocus
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  fontWeight: 'inherit',
                  outline: 'none',
                  width: '100%',
                  padding: 0,
                  margin: 0
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="channel-name-text">{channel.name}</span>
            )}
          </div>
          
          {contextMenuPos && (
            <ContextMenuContainer x={contextMenuPos.x} y={contextMenuPos.y}>
              <div className="menu-header">Canal: {channel.name}</div>
              
              <button
                type="button"
                onClick={() => {
                  setContextMenuPos(null);
                  // Rellenar cada 4 pasos (0, 4, 8, 12)
                  const pattern = channel.patterns[currentDrumPatternEdit] || [];
                  pattern.forEach((_, stepIdx) => {
                    const shouldBeActive = stepIdx % 4 === 0;
                    if (pattern[stepIdx]?.isActive !== shouldBeActive) {
                      toggleDrumStep(channel.id, stepIdx, currentDrumPatternEdit);
                    }
                  });
                }}
              >
                <Sparkles size={14} /> Rellenar cada 4 pasos
              </button>

              <button
                type="button"
                onClick={() => {
                  setContextMenuPos(null);
                  // Limpiar todos los pasos del patrón
                  const pattern = channel.patterns[currentDrumPatternEdit] || [];
                  pattern.forEach((step, stepIdx) => {
                    if (step.isActive) {
                      toggleDrumStep(channel.id, stepIdx, currentDrumPatternEdit);
                    }
                  });
                }}
              >
                <RefreshCw size={14} /> Limpiar pasos
              </button>

              <hr className="menu-separator" />

              <button
                type="button"
                className="menu-danger"
                onClick={() => {
                  setContextMenuPos(null);
                  removeDrumChannel(channel.id);
                }}
              >
                <Trash2 size={14} /> Eliminar Canal
              </button>
            </ContextMenuContainer>
          )}

          <div className="drum-sample-selector" style={{ width: '160px' }}>
            <CustomSelect
              value={channel.sampleUrl}
              onChange={handleSampleChange}
              groups={selectGroups}
              style={{ width: '100%' }}
            />
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
        <div className="drum-steps" onMouseLeave={stopDrawing} style={{ userSelect: 'none' }}>
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
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleStepMouseDown(i, step.isActive);
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Accordion Detalle: Velocity */}
      {isExpanded && (
        <div className="drum-velocity-panel">
          <div 
            className="velocity-editor"
            onMouseLeave={stopDrawing}
          >
            {activePattern && activePattern.map((step, i) => (
              <div 
                key={i} 
                className={`velocity-bar-container ${i % 4 === 0 ? 'downbeat-bg' : ''} ${isPlaying && playbackStep === i ? 'playback-head-vel' : ''}`}
                onMouseDown={(e) => { setIsDrawingVelocity(true); handleVelocityDraw(e, i, true); }}
                onMouseMove={(e) => handleVelocityDraw(e, i)}
                onTouchStart={(e) => { setIsDrawingVelocity(true); handleVelocityDraw(e, i, true); }}
                onTouchMove={(e) => handleVelocityDraw(e, i)}
              >
                {step.isActive && (
                  <div 
                    className="velocity-bar" 
                    style={{ height: `${(step.velocity ?? 0.8) * 100}%`, background: channelColor }}
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
