import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { UnifiedToolbar } from '../shared/UnifiedToolbar';
import { ChannelQuickControl } from '../ui/ChannelQuickControl';
import { DrumChannelRow } from './DrumChannelRow';
import { PRESET_DRUM_KITS } from '../../constants/drumKits';
import { PatternChainArranger } from './PatternChainArranger';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';

import { CustomSelect } from '../ui/CustomSelect';
import { Copy, ClipboardPaste, Repeat, Plus, Trash2, Eraser, Layers, Upload } from 'lucide-react';
import { type DrumChannel } from '../../utils/typeDefinitions';
import {
  hasExternalFilesPayload,
  isExplicitProjectOnlyDrag,
  isSupportedAudioFile,
  isSupportedProjectFile,
  importProjectFile,
  importCustomDrumSamples,
  importCustomDrumSamplesAsNewChannels
} from '../../core/session/projectFileImport';
import { notify } from '../../core/ui/toastBus';

import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_DRUM_CHANNELS } from '../../store/slices/drumSlice';

export const DrumSequencerView: React.FC = () => {
  const { 
    drumChannels, 
    activeDrumKitId, 
    selectDrumKit, 
    currentDrumPatternEdit, 
    setCurrentDrumPatternEdit, 
    copyDrumPattern,
    pasteDrumPattern,
    addDrumPattern,
    duplicateDrumPattern,
    removeDrumPattern,
    clearDrumPattern,
    clipboardPattern,
    patternLengths,
    setDrumPatternLength,
    isPatternRepeatOn,
    setPatternRepeatOn,
    addDrumChannel,
    reorderDrumChannels
  } = useSongStore(useShallow(state => ({
    drumChannels: state.drumChannels || [],
    activeDrumKitId: state.activeDrumKitId,
    selectDrumKit: state.selectDrumKit,
    currentDrumPatternEdit: state.currentDrumPatternEdit,
    setCurrentDrumPatternEdit: state.setCurrentDrumPatternEdit,
    copyDrumPattern: state.copyDrumPattern,
    pasteDrumPattern: state.pasteDrumPattern,
    addDrumPattern: state.addDrumPattern,
    duplicateDrumPattern: state.duplicateDrumPattern,
    removeDrumPattern: state.removeDrumPattern,
    clearDrumPattern: state.clearDrumPattern,
    clipboardPattern: state.clipboardPattern,
    patternLengths: state.patternLengths,
    setDrumPatternLength: state.setDrumPatternLength,
    isPatternRepeatOn: state.isPatternRepeatOn,
    setPatternRepeatOn: state.setPatternRepeatOn,
    addDrumChannel: state.addDrumChannel,
    reorderDrumChannels: state.reorderDrumChannels
  })));
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [patternContextMenu, setPatternContextMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [isExternalFileDragging, setIsExternalFileDragging] = useState(false);
  const [fileDropTargetChannelId, setFileDropTargetChannelId] = useState<string | null>(null);
  const [isNewChannelZoneOver, setIsNewChannelZoneOver] = useState(false);
  const fileDragDepthRef = useRef(0);

  const resetFileDragState = useCallback(() => {
    fileDragDepthRef.current = 0;
    setIsExternalFileDragging(false);
    setFileDropTargetChannelId(null);
    setIsNewChannelZoneOver(false);
  }, []);

  useEffect(() => {
    const handleWindowDragEnter = (e: DragEvent) => {
      if (!hasExternalFilesPayload(e) || isExplicitProjectOnlyDrag(e)) return;
      fileDragDepthRef.current += 1;
      setIsExternalFileDragging(true);
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      if (!hasExternalFilesPayload(e)) return;
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) {
        resetFileDragState();
      }
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', resetFileDragState);
    window.addEventListener('dragend', resetFileDragState);
    window.addEventListener('blur', resetFileDragState);

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', resetFileDragState);
      window.removeEventListener('dragend', resetFileDragState);
      window.removeEventListener('blur', resetFileDragState);
    };
  }, [resetFileDragState]);

  const handleFileDragOverChannel = useCallback((channelId: string) => {
    setIsExternalFileDragging(true);
    setIsNewChannelZoneOver(false);
    setFileDropTargetChannelId(prev => (prev === channelId ? prev : channelId));
  }, []);

  const handleRackFilesDrop = useCallback(async (targetChannelId: string | null, files: File[]) => {
    resetFileDragState();
    if (!files || files.length === 0) return;

    const projectFile = files.find(isSupportedProjectFile);
    if (projectFile) {
      await importProjectFile(projectFile);
      return;
    }

    const audioFiles = files.filter(isSupportedAudioFile);
    if (audioFiles.length === 0) {
      notify.warning(
        `Archivo no reconocido: ${files[0].name}`,
        'Formatos soportados: .wav, .mp3, .ogg, .flac, .m4a, .phos, .json, .mid'
      );
      return;
    }

    if (targetChannelId) {
      await importCustomDrumSamples(audioFiles, targetChannelId);
    } else {
      await importCustomDrumSamplesAsNewChannels(audioFiles);
    }
  }, [resetFileDragState]);

  const rawChannels = drumChannels;
  const channelList: DrumChannel[] = (Array.isArray(rawChannels) && rawChannels.length > 0)
    ? rawChannels
    : (rawChannels && typeof rawChannels === 'object' && Object.values(rawChannels).length > 0
      ? (Object.values(rawChannels) as DrumChannel[])
      : DEFAULT_DRUM_CHANNELS);

  const totalPatterns = channelList[0]?.patterns?.length || 8;
  const currentPatternLength = (patternLengths && patternLengths[currentDrumPatternEdit]) || 16;

  const PRESET_STEP_COUNTS = [
    { value: '8', label: '8 (1/8)' },
    { value: '10', label: '10 (10:4)' },
    { value: '12', label: '12 (12/8)' },
    { value: '14', label: '14 (7:4)' },
    { value: '15', label: '15 (15:4)' },
    { value: '16', label: '16 (1/16)' },
    { value: '18', label: '18 (18:4)' },
    { value: '20', label: '20 (5:4)' },
    { value: '24', label: '24 (6:4)' },
    { value: '28', label: '28 (28:4)' },
    { value: '32', label: '32 (1/32)' }
  ];

  const stepOptions = PRESET_STEP_COUNTS.some(opt => opt.value === String(currentPatternLength))
    ? PRESET_STEP_COUNTS
    : [
        { value: String(currentPatternLength), label: `${currentPatternLength} (${currentPatternLength}:4)` },
        ...PRESET_STEP_COUNTS
      ].sort((a, b) => Number(a.value) - Number(b.value));

  const handleToggleExpand = (id: string) => {
    setExpandedChannelId(prev => (prev === id ? null : id));
  };

  const handleDragStartRow = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOverRow = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDropRow = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndexStr = e.dataTransfer.getData('text/plain');
    const sourceIndex = sourceIndexStr !== '' ? Number(sourceIndexStr) : draggedIndex;
    if (sourceIndex !== null && !isNaN(sourceIndex) && sourceIndex !== targetIndex) {
      reorderDrumChannels(sourceIndex, targetIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEndRow = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleAddChannel = () => {
    const newId = `custom_drum_${Date.now()}`;
    const newChannel: DrumChannel = {
      id: newId,
      name: `Custom ${drumChannels.length + 1}`,
      sampleUrl: PRESET_DRUM_KITS[0].samples['kick_1'] || '/drums/kicks/kick1.wav',
      patterns: Array(totalPatterns).fill(null).map(() => Array(16).fill({ isActive: false, velocity: 0.8 })),
      volume: 80,
      pan: 0,
      muted: false,
      solo: false,
    };
    addDrumChannel(newChannel);
  };

  return (
    <div
      className="sequencer-container"
      onClick={() => { if (patternContextMenu) setPatternContextMenu(null); }}
      onDragOver={(e) => {
        if (!hasExternalFilesPayload(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (fileDropTargetChannelId !== null) setFileDropTargetChannelId(null);
        if (isNewChannelZoneOver) setIsNewChannelZoneOver(false);
      }}
      onDrop={(e) => {
        if (!hasExternalFilesPayload(e)) return;
        e.preventDefault();
        e.stopPropagation();
        (e.nativeEvent as unknown as { __phosphorDropHandled?: boolean }).__phosphorDropHandled = true;
        const files = Array.from(e.dataTransfer.files || []);
        handleRackFilesDrop(null, files);
      }}
    >
      <UnifiedToolbar
        left={
          <>
            <ChannelQuickControl channelId="drums" />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.68rem', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-secondary)' }}>KIT:</span>
              <CustomSelect
                value={activeDrumKitId}
                onChange={selectDrumKit}
                options={[
                  ...PRESET_DRUM_KITS.map(kit => ({ value: kit.id, label: kit.name })),
                  { value: 'custom', label: `Custom ${activeDrumKitId === 'custom' ? '★' : ''}` }
                ]}
                style={{ width: '130px' }}
              />
            </div>
            <button 
              className="physical-btn" 
              onClick={handleAddChannel}
              title="Añadir nuevo canal de batería"
            >
              <Plus size={13} />
            </button>
          </>
        }
        center={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Pantalla Digital LCD Táctil de Patrones Dinámicos y Portapapeles */}
            <div className="lcd-pattern-screen" style={{ display: 'flex', alignItems: 'center', maxWidth: '100%', overflowX: 'auto' }} title="Pantalla Digital de Patrones (Clic derecho para opciones)">
              {Array.from({ length: totalPatterns }).map((_, i) => (
                <button 
                  key={i}
                  className={`lcd-pattern-cell ${currentDrumPatternEdit === i ? 'active' : ''}`}
                  onClick={() => setCurrentDrumPatternEdit(i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setPatternContextMenu({ x: e.clientX, y: e.clientY, index: i });
                  }}
                  title={`Patrón ${i + 1} — Clic derecho para opciones`}
                >
                  {i + 1}
                </button>
              ))}

              {/* Botón para añadir nuevo patrón dinámico */}
              <button
                className="lcd-pattern-cell lcd-action-cell"
                onClick={() => addDrumPattern()}
                title="Añadir nuevo patrón vacío (+)"
                style={{ color: 'var(--accent-hover)', fontWeight: 'bold' }}
              >
                <Plus size={12} />
              </button>

              <span className="lcd-pattern-divider" />
              <button 
                className="lcd-pattern-cell lcd-action-cell" 
                onClick={() => copyDrumPattern(currentDrumPatternEdit)}
                title="Copiar patrón actual"
              >
                <Copy size={12} />
              </button>
              <button 
                className={`lcd-pattern-cell lcd-action-cell ${clipboardPattern ? 'has-clipboard' : ''}`} 
                onClick={() => { if (clipboardPattern) pasteDrumPattern(currentDrumPatternEdit); }}
                title="Pegar patrón"
                disabled={!clipboardPattern}
              >
                <ClipboardPaste size={12} />
              </button>
            </div>

            {/* Botón de Repetición en Bucle */}
            <button
              className={`physical-btn ${isPatternRepeatOn ? 'active' : ''}`}
              onClick={() => setPatternRepeatOn(!isPatternRepeatOn)}
              title="Repetir patrón actual en bucle"
            >
              <Repeat size={13} style={{ color: isPatternRepeatOn ? '#ffd875' : 'var(--text-secondary)' }} />
            </button>
          </div>
        }
        right={
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.68rem', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-secondary)' }}>
              PASOS:
            </span>
            <div style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)', padding: '2px' }}>
              <button
                className="physical-btn"
                style={{ width: '22px', height: '22px', padding: 0, fontSize: '0.75rem', lineHeight: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setDrumPatternLength(currentDrumPatternEdit, Math.max(4, currentPatternLength - 1))}
                title="Reducir pasos (-1)"
                disabled={currentPatternLength <= 4}
              >
                -
              </button>

              <div style={{ width: '96px', margin: '0 2px' }}>
                <CustomSelect
                  value={String(currentPatternLength)}
                  onChange={(val) => setDrumPatternLength(currentDrumPatternEdit, Number(val))}
                  options={stepOptions}
                  style={{ width: '100%', height: '22px', fontSize: '0.72rem' }}
                />
              </div>

              <button
                className="physical-btn"
                style={{ width: '22px', height: '22px', padding: 0, fontSize: '0.75rem', lineHeight: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setDrumPatternLength(currentDrumPatternEdit, Math.min(32, currentPatternLength + 1))}
                title="Aumentar pasos (+1)"
                disabled={currentPatternLength >= 32}
              >
                +
              </button>
            </div>
          </div>
        }
      />

      {/* Menú Contextual de Patrón */}
      {patternContextMenu && (
        <ContextMenuContainer
          x={patternContextMenu.x}
          y={patternContextMenu.y}
        >
          <div className="menu-header">
            <span>PATRÓN P{patternContextMenu.index + 1}</span>
          </div>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              duplicateDrumPattern(patternContextMenu.index);
              setPatternContextMenu(null);
            }}
          >
            <Layers size={13} /> Duplicar Patrón (P{patternContextMenu.index + 1})
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              clearDrumPattern(patternContextMenu.index);
              setPatternContextMenu(null);
            }}
          >
            <Eraser size={13} /> Limpiar Patrón
          </button>

          {totalPatterns > 1 && (
            <>
              <hr className="menu-separator" />
              <button
                type="button"
                className="menu-danger"
                onClick={() => {
                  removeDrumPattern(patternContextMenu.index);
                  setPatternContextMenu(null);
                }}
              >
                <Trash2 size={13} /> Eliminar Patrón (P{patternContextMenu.index + 1})
              </button>
            </>
          )}
        </ContextMenuContainer>
      )}

      {/* Grid del Secuenciador */}
      <div className="drum-rack">
        <div className="drum-channels-shelf">
          {channelList.map((channel, idx) => (
            <DrumChannelRow 
              key={channel.id}
              channel={channel}
              channelIndex={idx}
              isExpanded={expandedChannelId === channel.id}
              onToggleExpand={() => handleToggleExpand(channel.id)}
              onDragStartRow={handleDragStartRow}
              onDragOverRow={handleDragOverRow}
              onDropRow={handleDropRow}
              onDragEndRow={handleDragEndRow}
              isDragging={draggedIndex === idx}
              isDragOver={dragOverIndex === idx && draggedIndex !== idx}
              isFileDragOver={fileDropTargetChannelId === channel.id}
              onFileDragOverChannel={handleFileDragOverChannel}
              onFileDropChannel={handleRackFilesDrop}
            />
          ))}

          {isExternalFileDragging && (
            <div
              className={`drum-new-channel-dropzone ${isNewChannelZoneOver ? 'active' : ''}`}
              style={{ width: `${362 + currentPatternLength * 30}px`, maxWidth: 'none' }}
              onDragOver={(e) => {
                if (!hasExternalFilesPayload(e)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                if (fileDropTargetChannelId !== null) setFileDropTargetChannelId(null);
                if (!isNewChannelZoneOver) setIsNewChannelZoneOver(true);
              }}
              onDrop={(e) => {
                if (!hasExternalFilesPayload(e)) return;
                e.preventDefault();
                e.stopPropagation();
                (e.nativeEvent as unknown as { __phosphorDropHandled?: boolean }).__phosphorDropHandled = true;
                const files = Array.from(e.dataTransfer.files || []);
                handleRackFilesDrop(null, files);
              }}
            >
              <Upload size={14} />
              <span>Soltar sobre un canal para asignarlo o aquí para añadir nuevo canal</span>
            </div>
          )}
        </div>

        {/* Cadena Visual de Patrones (Arranger) */}
        <PatternChainArranger />
      </div>
    </div>
  );
};
