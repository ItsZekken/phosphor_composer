import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { liveTelemetryBus } from '../../core/audio/liveTelemetryBus';
import type { CustomDrumSample, DrumChannel } from '../../utils/typeDefinitions';
import { Knob } from '../ui/Knob';
import { DRUM_CATEGORIES, getSamplesByCategory } from '../../constants/drumSamples';
import { CustomSelect } from '../ui/CustomSelect';
import type { SelectGroup } from '../ui/CustomSelect';
import { Trash2, Sparkles, RefreshCw, Upload } from 'lucide-react';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { importCustomDrumSamples, hasExternalFilesPayload } from '../../core/session/projectFileImport';
import { audioBufferRegistry } from '../../core/audio/audioBufferRegistry';
import { notify } from '../../core/ui/toastBus';

interface Props {
  channel: DrumChannel;
  channelIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDragStartRow?: (e: React.DragEvent, index: number) => void;
  onDragOverRow?: (e: React.DragEvent, index: number) => void;
  onDropRow?: (e: React.DragEvent, index: number) => void;
  onDragEndRow?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
  isFileDragOver?: boolean;
  onFileDragOverChannel?: (channelId: string) => void;
  onFileDropChannel?: (channelId: string, files: File[]) => void;
}

// Subcomponente aislado para el LED del medidor de actividad
const DrumActivityLed: React.FC<{ channelColor: string; activePattern: any[] }> = React.memo(({ channelColor, activePattern }) => {
  const isPlaying = useSongStore(s => s.isPlaying);
  const ledRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ledRef.current;
    if (!el) return;
    if (!isPlaying) {
      el.classList.remove('lit');
      return;
    }
    return liveTelemetryBus.subscribeDrumStep(({ step }) => {
      const lit = Boolean(activePattern && step >= 0 && activePattern[step]?.isActive);
      el.classList.toggle('lit', lit);
    });
  }, [isPlaying, activePattern]);

  return (
    <div className="drum-activity-meter">
      <div ref={ledRef} className="meter-led" style={{ '--led-color': channelColor } as React.CSSProperties} />
    </div>
  );
});

const isStepDownbeat = (stepIdx: number, total: number) => {
  if (total <= 0) return false;
  if (total === 16) return stepIdx % 4 === 0;
  if (total === 12) return stepIdx % 3 === 0;
  if (total === 14) return stepIdx % 2 === 0;
  if (total === 15) return stepIdx % 3 === 0;
  if (total === 10) return stepIdx % 2 === 0;
  if (total === 8) return stepIdx % 2 === 0;
  if (total === 24) return stepIdx % 6 === 0;
  if (total === 32) return stepIdx % 8 === 0;
  if (total % 4 === 0) return stepIdx % (total / 4) === 0;
  return stepIdx === 0;
};

// Subcomponente aislado para la grilla de pasos dinámicos
const DrumStepsRow: React.FC<{
  channelColor: string;
  activePattern: any[];
  onStepMouseDown: (index: number, active: boolean) => void;
  onStepMouseEnter: (index: number, active: boolean) => void;
  onStopDrawing: () => void;
}> = React.memo(({ channelColor, activePattern, onStepMouseDown, onStepMouseEnter, onStopDrawing }) => {
  const isPlaying = useSongStore(s => s.isPlaying);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevStepRef = useRef<number>(-1);
  const total = activePattern?.length || 16;
  const stepsWidth = 12 + total * 30;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (prevStepRef.current >= 0) {
      container.children[prevStepRef.current]?.classList.remove('playback-head');
      prevStepRef.current = -1;
    }
    if (!isPlaying) return;
    return liveTelemetryBus.subscribeDrumStep(({ step }) => {
      if (prevStepRef.current >= 0 && prevStepRef.current !== step) {
        container.children[prevStepRef.current]?.classList.remove('playback-head');
      }
      if (step >= 0 && step < container.children.length) {
        container.children[step]?.classList.add('playback-head');
        prevStepRef.current = step;
      } else {
        prevStepRef.current = -1;
      }
    });
  }, [isPlaying, activePattern]);

  return (
    <div ref={containerRef} className="drum-steps" onMouseLeave={onStopDrawing} style={{ width: `${stepsWidth}px`, userSelect: 'none' }}>
      {activePattern && activePattern.map((step, i) => {
        const isDownbeat = isStepDownbeat(i, total);
        return (
          <div 
            key={i}
            className={`drum-step ${step.isActive ? 'active' : ''} ${isDownbeat ? 'downbeat' : ''}`}
            style={{ '--switch-color': channelColor } as React.CSSProperties}
            onMouseDown={() => onStepMouseDown(i, step.isActive)}
            onMouseEnter={() => onStepMouseEnter(i, step.isActive)}
            onTouchStart={(e) => {
              e.preventDefault();
              onStepMouseDown(i, step.isActive);
            }}
          />
        );
      })}
    </div>
  );
});

// Subcomponente aislado para el panel de edición de velocity
const DrumVelocityRow: React.FC<{
  channelColor: string;
  activePattern: any[];
  onVelocityMouseDown: (e: React.MouseEvent | React.TouchEvent, stepIndex: number) => void;
  onVelocityMouseMove: (e: React.MouseEvent | React.TouchEvent, stepIndex: number) => void;
  onStopDrawing: () => void;
}> = React.memo(({ channelColor, activePattern, onVelocityMouseDown, onVelocityMouseMove, onStopDrawing }) => {
  const isPlaying = useSongStore(s => s.isPlaying);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevStepRef = useRef<number>(-1);
  const total = activePattern?.length || 16;
  const stepsWidth = 12 + total * 30;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (prevStepRef.current >= 0) {
      container.children[prevStepRef.current]?.classList.remove('playback-head-vel');
      prevStepRef.current = -1;
    }
    if (!isPlaying) return;
    return liveTelemetryBus.subscribeDrumStep(({ step }) => {
      if (prevStepRef.current >= 0 && prevStepRef.current !== step) {
        container.children[prevStepRef.current]?.classList.remove('playback-head-vel');
      }
      if (step >= 0 && step < container.children.length) {
        container.children[step]?.classList.add('playback-head-vel');
        prevStepRef.current = step;
      } else {
        prevStepRef.current = -1;
      }
    });
  }, [isPlaying, activePattern]);

  return (
    <div className="drum-velocity-panel">
      <div ref={containerRef} className="velocity-editor" onMouseLeave={onStopDrawing} style={{ width: `${stepsWidth}px` }}>
        {activePattern && activePattern.map((step, i) => {
          const isDownbeat = isStepDownbeat(i, total);
          return (
            <div 
              key={i} 
              className={`velocity-bar-container ${isDownbeat ? 'downbeat-bg' : ''}`}
              onMouseDown={(e) => onVelocityMouseDown(e, i)}
              onMouseMove={(e) => onVelocityMouseMove(e, i)}
              onTouchStart={(e) => onVelocityMouseDown(e, i)}
              onTouchMove={(e) => onVelocityMouseMove(e, i)}
            >
              {step.isActive && (
                <div 
                  className="velocity-bar" 
                  style={{ height: `${(step.velocity ?? 0.8) * 100}%`, background: channelColor }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const DrumChannelRow: React.FC<Props> = React.memo(({ 
  channel, 
  channelIndex, 
  isExpanded, 
  onToggleExpand,
  onDragStartRow,
  onDragOverRow,
  onDropRow,
  onDragEndRow,
  isDragging,
  isDragOver,
  isFileDragOver,
  onFileDragOverChannel,
  onFileDropChannel
}) => {
  const toggleDrumStep = useSongStore(s => s.toggleDrumStep);
  const setDrumStepVelocity = useSongStore(s => s.setDrumStepVelocity);
  const updateDrumChannel = useSongStore(s => s.updateDrumChannel);
  const removeDrumChannel = useSongStore(s => s.removeDrumChannel);
  const customDrumSamples = useSongStore(s => s.customDrumSamples);
  const removeCustomDrumSample = useSongStore(s => s.removeCustomDrumSample);
  const currentDrumPatternEdit = useSongStore(s => s.currentDrumPatternEdit);
  const patternLengths = useSongStore(s => s.patternLengths);
  const currentPatternLength = (patternLengths && patternLengths[currentDrumPatternEdit]) || 16;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewSeqRef = useRef(0);
  
  // Smart Draw State
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawAction, setDrawAction] = useState<boolean | null>(null);

  // Rename state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState(channel.name);
  const [isInteractiveHovered, setIsInteractiveHovered] = useState(false);

  // Preview debounce on knob tweak
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerDebouncedPreview = () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      toneEngine.playDrumPreview(channel.id);
    }, 60);
  };

  // Velocity Draw State
  const [isDrawingVelocity, setIsDrawingVelocity] = useState(false);

  const handleStepMouseDown = useCallback((index: number, currentlyActive: boolean) => {
    setIsDrawing(true);
    const newState = !currentlyActive;
    setDrawAction(newState);
    toggleDrumStep(channel.id, index, currentDrumPatternEdit, newState);
    if (newState) {
      const stepVel = channel.patterns[currentDrumPatternEdit]?.[index]?.velocity ?? 0.8;
      toneEngine.playDrumPreview(channel.id, stepVel);
    }
  }, [channel.id, channel.patterns, currentDrumPatternEdit, toggleDrumStep]);

  const handleStepMouseEnter = useCallback((index: number, currentlyActive: boolean) => {
    if (isDrawing && drawAction !== null) {
      if (currentlyActive !== drawAction) {
        toggleDrumStep(channel.id, index, currentDrumPatternEdit, drawAction);
      }
    }
  }, [channel.id, currentDrumPatternEdit, drawAction, isDrawing, toggleDrumStep]);

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
    const reqSeq = ++previewSeqRef.current;
    const preloadPromise =
      typeof toneEngine.preloadDrumSample === 'function'
        ? toneEngine.preloadDrumSample(newSampleUrl)
        : Promise.resolve(null);
    preloadPromise.finally(() => {
      if (previewSeqRef.current === reqSeq) {
        toneEngine.playDrumPreview(channel.id);
      }
    });
  };

  const handleImportSampleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    await importCustomDrumSamples(files, channel.id);
  };

  const handleRemoveCustomSample = useCallback((sample: CustomDrumSample) => {
    removeCustomDrumSample(sample.id);
    if (typeof toneEngine.removeCachedDrumSample === 'function') {
      toneEngine.removeCachedDrumSample(sample.sampleUrl);
    }
    audioBufferRegistry.deleteBuffer(sample.id);
    audioBufferRegistry.deleteBufferFromIndexedDB(sample.id).catch(() => {});
    notify.info(`Sample eliminado: ${sample.name}`, undefined, 2000);
  }, [removeCustomDrumSample]);

  // Velocity Draw Logic
  const handleVelocityMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent, stepIndex: number) => {
    setIsDrawingVelocity(true);
    let currentElement = e.currentTarget as HTMLElement;
    const rect = currentElement.getBoundingClientRect();
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const relativeY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const newVelocity = 1 - (relativeY / rect.height);
    setDrumStepVelocity(channel.id, stepIndex, currentDrumPatternEdit, newVelocity);
  }, [channel.id, currentDrumPatternEdit, setDrumStepVelocity]);

  const handleVelocityMouseMove = useCallback((e: React.MouseEvent | React.TouchEvent, stepIndex: number) => {
    if (!isDrawingVelocity) return;
    let currentElement = e.currentTarget as HTMLElement;
    const rect = currentElement.getBoundingClientRect();
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const relativeY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const newVelocity = 1 - (relativeY / rect.height);
    setDrumStepVelocity(channel.id, stepIndex, currentDrumPatternEdit, newVelocity);
  }, [channel.id, currentDrumPatternEdit, isDrawingVelocity, setDrumStepVelocity]);

  // Colores de la paleta
  const colors = ['var(--reposo)', 'var(--subdominante)', 'var(--tension)', 'var(--spicy)', 'var(--exotic)'];
  const channelColor = colors[channelIndex % colors.length];
  const fullPattern = (channel.patterns && channel.patterns[currentDrumPatternEdit]) || [];
  const activePattern = Array.from({ length: currentPatternLength }).map((_, i) =>
    fullPattern[i] || { isActive: false, velocity: 0.8 }
  );
  const channelRowWidth = 362 + currentPatternLength * 30;

  // Cargar lista de muestras por categorías (incluyendo samples importados si existen)
  const selectGroups: SelectGroup[] = useMemo(() => {
    const builtInGroups: SelectGroup[] = DRUM_CATEGORIES.map(cat => ({
      label: cat.label,
      options: getSamplesByCategory(cat.key).map(sample => ({
        value: sample.path,
        label: sample.name
      }))
    })).filter(g => g.options.length > 0);

    if (!customDrumSamples || customDrumSamples.length === 0) {
      return builtInGroups;
    }

    const importedGroup: SelectGroup = {
      label: 'Importados',
      options: customDrumSamples.map(sample => ({
        value: sample.sampleUrl,
        label: sample.name,
        onDelete: () => handleRemoveCustomSample(sample),
        deleteTitle: `Eliminar "${sample.name}"`
      }))
    };

    return [importedGroup, ...builtInGroups];
  }, [customDrumSamples, handleRemoveCustomSample]);

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

  const handleTitleClick = () => {
    if (isEditingName) return;
    onToggleExpand();
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
    <div 
      className={`drum-channel-container ${isExpanded ? 'expanded' : ''} ${isDragging ? 'dragging-channel' : ''} ${isDragOver ? 'drag-over-channel' : ''} ${isFileDragOver ? 'file-drop-target' : ''}`}
      style={{ width: `${channelRowWidth}px`, maxWidth: 'none' }}
      onDragOver={(e) => {
        if (!hasExternalFilesPayload(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        onFileDragOverChannel?.(channel.id);
      }}
      onDrop={(e) => {
        if (!hasExternalFilesPayload(e)) return;
        e.preventDefault();
        e.stopPropagation();
        (e.nativeEvent as unknown as { __phosphorDropHandled?: boolean }).__phosphorDropHandled = true;
        const files = Array.from(e.dataTransfer.files || []);
        onFileDropChannel?.(channel.id, files);
      }}
    >
      <div className="drum-channel-row">
        {isFileDragOver && (
          <div className="drum-file-drop-badge" aria-hidden="true">
            <Upload size={12} />
            <span>Asignar a {channel.name}</span>
          </div>
        )}

        {/* Panel Izquierdo: Controles */}
        <div 
          className={`drum-controls ${isDragging ? 'is-dragging' : ''}`}
          draggable={!isEditingName && !isInteractiveHovered}
          onDragStart={(e) => {
            if (onDragStartRow) onDragStartRow(e, channelIndex);
          }}
          onDragOver={(e) => {
            if (hasExternalFilesPayload(e)) return;
            if (onDragOverRow) onDragOverRow(e, channelIndex);
          }}
          onDrop={(e) => {
            if (hasExternalFilesPayload(e)) return;
            if (onDropRow) onDropRow(e, channelIndex);
          }}
          onDragEnd={(e) => {
            if (onDragEndRow) onDragEndRow(e);
          }}
        >
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
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => setIsInteractiveHovered(true)}
                onMouseLeave={() => setIsInteractiveHovered(false)}
              />
            ) : (
              <span 
                className="channel-name-text"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setIsEditingName(true);
                  setEditNameValue(channel.name);
                }}
              >
                {channel.name}
              </span>
            )}
          </div>
          
          {contextMenuPos && (
            <ContextMenuContainer x={contextMenuPos.x} y={contextMenuPos.y}>
              <div className="menu-header">Canal: {channel.name}</div>
              
              <button
                type="button"
                onClick={() => {
                  setContextMenuPos(null);
                  const pattern = channel.patterns[currentDrumPatternEdit] || [];
                  for (let stepIdx = 0; stepIdx < currentPatternLength; stepIdx++) {
                    const shouldBeActive = isStepDownbeat(stepIdx, currentPatternLength);
                    if ((pattern[stepIdx]?.isActive ?? false) !== shouldBeActive) {
                      toggleDrumStep(channel.id, stepIdx, currentDrumPatternEdit, shouldBeActive);
                    }
                  }
                }}
              >
                <Sparkles size={14} /> Rellenar pulsos principales
              </button>

              <button
                type="button"
                onClick={() => {
                  setContextMenuPos(null);
                  const pattern = channel.patterns[currentDrumPatternEdit] || [];
                  for (let stepIdx = 0; stepIdx < currentPatternLength; stepIdx++) {
                    if (pattern[stepIdx]?.isActive) {
                      toggleDrumStep(channel.id, stepIdx, currentDrumPatternEdit, false);
                    }
                  }
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

          <div 
            className="drum-sample-selector" 
            style={{ width: '160px' }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={() => setIsInteractiveHovered(true)}
            onMouseLeave={() => setIsInteractiveHovered(false)}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm"
              multiple
              style={{ display: 'none' }}
              onChange={handleImportSampleFiles}
            />
            <CustomSelect
              value={channel.sampleUrl}
              onChange={handleSampleChange}
              groups={selectGroups}
              headerAction={{
                label: 'Importar sample',
                icon: <Upload size={13} />,
                title: 'Importar archivo de audio (.wav, .mp3, .ogg, .flac, .m4a)',
                onClick: () => fileInputRef.current?.click()
              }}
              style={{ width: '100%' }}
            />
          </div>
          
          <DrumActivityLed channelColor={channelColor} activePattern={activePattern} />
          
          <div 
            className="drum-knobs"
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={() => setIsInteractiveHovered(true)}
            onMouseLeave={() => setIsInteractiveHovered(false)}
          >
            <Knob 
              value={channel.volume} 
              min={0} max={100} size={24} 
              onChange={(val) => {
                updateDrumChannel(channel.id, { volume: val });
                triggerDebouncedPreview();
              }} 
              onDoubleClick={handleVolumeDouble} 
              label="VOL" 
            />
            <Knob 
              value={channel.pan} 
              min={-1} max={1} size={24} 
              onChange={(val) => {
                updateDrumChannel(channel.id, { pan: val });
                triggerDebouncedPreview();
              }} 
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

        {/* Panel Derecho: Switches aislados (16 Steps) */}
        <DrumStepsRow
          channelColor={channelColor}
          activePattern={activePattern}
          onStepMouseDown={handleStepMouseDown}
          onStepMouseEnter={handleStepMouseEnter}
          onStopDrawing={stopDrawing}
        />
      </div>

      {/* Accordion Detalle: Velocity aislado */}
      {isExpanded && (
        <DrumVelocityRow
          channelColor={channelColor}
          activePattern={activePattern}
          onVelocityMouseDown={handleVelocityMouseDown}
          onVelocityMouseMove={handleVelocityMouseMove}
          onStopDrawing={stopDrawing}
        />
      )}
    </div>
  );
});
