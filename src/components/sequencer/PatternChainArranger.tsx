import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { 
  Folder, 
  Link as LinkIcon, 
  Plus, 
  ZoomIn, 
  ZoomOut, 
  Copy, 
  Scissors, 
  Clipboard, 
  Layers, 
  Trash2, 
  Ungroup, 
  Group,
  Play,
  VolumeX
} from 'lucide-react';
import type { PatternChainItem } from '../../utils/typeDefinitions';

import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const colors = [
  'var(--reposo)',
  'var(--tension)',
  'var(--subdominante)',
  'var(--spicy)',
  'var(--exotic)',
  'var(--accent)',
  '#68b5a0',
  '#d6706e',
  '#7d98b3',
  '#c4a852',
  '#a270b5',
  '#6fa882',
];

interface SortablePatternItemProps {
  item: PatternChainItem;
  totalPatterns: number;
  isInsideGroup?: boolean;
  parentGroupId?: string;
  isCurrentPlaying: boolean;
  isSelected: boolean;
  zoomLevel: number;
  updateChainItem: (id: string, updates: Partial<PatternChainItem>) => void;
  removeChainItem: (id: string) => void;
  setCurrentDrumPatternEdit: (idx: number) => void;
  onSelect: (e: React.MouseEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: PatternChainItem, parentGroupId?: string) => void;
  onRemoveFromGroup?: (groupId: string, itemId: string) => void;
  onUpdateInGroup?: (groupId: string, itemId: string, updates: Partial<PatternChainItem>) => void;
}

const SortablePatternItem: React.FC<SortablePatternItemProps> = ({
  item,
  totalPatterns,
  isInsideGroup = false,
  parentGroupId,
  isCurrentPlaying,
  isSelected,
  zoomLevel,
  updateChainItem,
  removeChainItem,
  setCurrentDrumPatternEdit,
  onSelect,
  onContextMenu,
  onRemoveFromGroup,
  onUpdateInGroup
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id, data: { type: 'pattern', parentGroupId } });

  const [isResizingEdge, setIsResizingEdge] = useState(false);
  const [showPatternPicker, setShowPatternPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const pickerRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!showPatternPicker || !badgeRef.current) return;
    const rect = badgeRef.current.getBoundingClientRect();
    const popoverWidth = 216;
    const numRows = Math.ceil(totalPatterns / 4);
    // 7px top padding + 28px rest button + 6px gap + (numRows * 28px) + (numRows - 1)*5px gap + 7px bottom padding
    const popoverHeight = 14 + 28 + 6 + (numRows * 28) + (Math.max(0, numRows - 1) * 5);
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Calcular si cabe abajo o si debe colocarse arriba del bloque
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    let top = rect.bottom + 4;
    if (spaceBelow < popoverHeight + 12 && spaceAbove > spaceBelow) {
      top = Math.max(12, rect.top - popoverHeight - 4);
    }
    if (top + popoverHeight > vh - 12) {
      top = Math.max(12, vh - popoverHeight - 12);
    }

    let left = rect.left + (rect.width / 2) - (popoverWidth / 2);
    if (left + popoverWidth > vw - 12) {
      left = vw - popoverWidth - 12;
    }
    if (left < 12) left = 12;

    setPickerPos({ top, left });
  }, [showPatternPicker, totalPatterns]);

  useEffect(() => {
    if (!showPatternPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        pickerRef.current && !pickerRef.current.contains(target) &&
        badgeRef.current && !badgeRef.current.contains(target)
      ) {
        setShowPatternPicker(false);
      }
    };
    const handleScroll = () => {
      setShowPatternPicker(false);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [showPatternPicker]);

  const isRest = item.type === 'rest' || item.patternIndex === -1;
  const patternIdx = isRest ? -1 : (item.patternIndex ?? 0);
  const patternColor = isRest ? 'rgba(255, 255, 255, 0.32)' : colors[patternIdx % colors.length];

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    '--block-color': patternColor,
    scale: isInsideGroup ? '0.94' : '1',
    margin: isInsideGroup ? '0' : undefined,
    width: `${Math.round(100 * zoomLevel)}px`,
    minWidth: `${Math.round(100 * zoomLevel)}px`
  } as React.CSSProperties;

  const handleUpdate = (updates: Partial<PatternChainItem>) => {
    if (isInsideGroup && parentGroupId && onUpdateInGroup) {
      onUpdateInGroup(parentGroupId, item.id, updates);
    } else {
      updateChainItem(item.id, updates);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInsideGroup && parentGroupId && onRemoveFromGroup) {
      onRemoveFromGroup(parentGroupId, item.id);
    } else {
      removeChainItem(item.id);
    }
  };

  const handleEdgeResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizingEdge(true);
    const startX = e.clientX;
    const initialRepeats = item.repeatCount;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const stepWidth = 24 * zoomLevel;
      const deltaRepeats = Math.round(deltaX / stepWidth);
      const nextRepeats = Math.max(1, Math.min(64, initialRepeats + deltaRepeats));
      if (nextRepeats !== item.repeatCount) {
        handleUpdate({ repeatCount: nextRepeats });
      }
    };

    const handleMouseUp = () => {
      setIsResizingEdge(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`pattern-chain-block ${isRest ? 'is-rest' : ''} ${isCurrentPlaying ? 'playing' : ''} ${isSelected ? 'selected' : ''} ${isResizingEdge ? 'resizing' : ''}`}
      onClick={(e) => onSelect(e, item.id)}
      onContextMenu={(e) => onContextMenu(e, item, parentGroupId)}
    >
      <div className="block-color-bar" />

      {/* Indicador de Reproducción Activa */}
      {isCurrentPlaying && (
        <div className="block-playing-badge" title="Reproduciendo en este momento">
          <Play size={9} className="playing-icon-pulse" />
        </div>
      )}

      <div className="block-content">
        <div className="block-header">
          {/* Badge Grande y Clickeable para cambiar patrón o silencio */}
          <div
            ref={badgeRef}
            className="pattern-badge-pill"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setShowPatternPicker(prev => !prev);
            }}
            title={isRest ? 'Silencio — Clic para cambiar' : `Patrón P${patternIdx + 1} — Clic para cambiar`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              background: isRest ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.08)',
              border: `1px solid ${isSelected ? '#ffd875' : isRest ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.16)'}`,
              borderLeft: `4px solid ${patternColor}`,
              color: isRest ? '#c5c1d8' : '#ffffff',
              borderRadius: '4px',
              padding: '2px 7px',
              fontSize: '0.85rem',
              fontFamily: "'Outfit', system-ui, sans-serif",
              fontWeight: 700,
              cursor: 'pointer',
              userSelect: 'none',
              flex: 1
            }}
          >
            {isRest ? (
              <VolumeX size={14} style={{ opacity: 0.9 }} />
            ) : (
              `P${patternIdx + 1}`
            )}
          </div>

          <div className="block-nav-btns" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <button className="chain-nav-btn remove-btn" onClick={handleRemove} title="Eliminar bloque">✕</button>
          </div>
        </div>

        {/* Popover selector de patrón emergente flotante en Portal (sin corte de overflow ni z-order) */}
        {showPatternPicker && createPortal(
          <div
            ref={pickerRef}
            className="pattern-quick-picker-popover"
            style={{
              position: 'fixed',
              top: `${pickerPos.top}px`,
              left: `${pickerPos.left}px`,
              width: '216px',
              zIndex: 99999
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Opción de Silencio */}
            <button
              type="button"
              className={`picker-popover-rest-btn ${isRest ? 'active' : ''}`}
              onClick={() => {
                handleUpdate({ type: 'rest', patternIndex: -1 });
                setShowPatternPicker(false);
              }}
              title="Silencio"
            >
              <VolumeX size={15} />
            </button>

            <div className="picker-popover-grid">
              {Array.from({ length: totalPatterns }).map((_, pI) => (
                <button
                  key={pI}
                  type="button"
                  className={`picker-popover-cell ${!isRest && pI === patternIdx ? 'active' : ''}`}
                  style={{ '--btn-color': colors[pI % colors.length] } as React.CSSProperties}
                  onClick={() => {
                    handleUpdate({ type: 'pattern', patternIndex: pI });
                    setCurrentDrumPatternEdit(pI);
                    setShowPatternPicker(false);
                  }}
                  title={`Patrón P${pI + 1}`}
                >
                  <span className="picker-dot" />
                  P{pI + 1}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}

        <div className="block-repeat-counter" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="repeat-btn"
            disabled={item.repeatCount <= 1}
            onClick={(e) => {
              e.stopPropagation();
              handleUpdate({ repeatCount: Math.max(1, item.repeatCount - 1) });
            }}
          >-</button>
          <span className="repeat-count-text" title="Veces que se repite el patrón">x{item.repeatCount}</span>
          <button
            type="button"
            className="repeat-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleUpdate({ repeatCount: Math.min(64, item.repeatCount + 1) });
            }}
          >+</button>
        </div>
      </div>

      {/* Tirador derecho para estirar repeticiones arrastrando */}
      <div
        className="chain-block-resize-handle right"
        title="Arrastra a la derecha para aumentar repeticiones"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={handleEdgeResizeMouseDown}
      />
    </div>
  );
};

interface SortableGroupItemProps {
  group: PatternChainItem;
  totalPatterns: number;
  isPlaying: boolean;
  isPatternRepeatOn: boolean;
  isSelected: boolean;
  selectedChainIds: string[];
  zoomLevel: number;
  currentChainItemId: string | null;
  currentDrumPatternEdit: number;
  updateChainItem: (id: string, updates: Partial<PatternChainItem>) => void;
  removeChainItem: (id: string) => void;
  setCurrentDrumPatternEdit: (idx: number) => void;
  onSelect: (e: React.MouseEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: PatternChainItem, parentGroupId?: string) => void;
}

const SortableGroupItem: React.FC<SortableGroupItemProps> = ({
  group,
  totalPatterns,
  isPlaying,
  isPatternRepeatOn,
  isSelected,
  selectedChainIds,
  zoomLevel,
  currentChainItemId,
  currentDrumPatternEdit,
  updateChainItem,
  removeChainItem,
  setCurrentDrumPatternEdit,
  onSelect,
  onContextMenu
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: group.id, data: { type: 'group' } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px 10px',
    border: isSelected ? '1px solid #ffd875' : '1px dashed rgba(255, 255, 255, 0.18)',
    boxShadow: isSelected ? '0 0 16px rgba(255, 216, 117, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.35)',
    borderRadius: '8px',
    background: isSelected ? 'rgba(255, 216, 117, 0.08)' : 'rgba(15, 11, 22, 0.65)',
    cursor: 'grab'
  } as React.CSSProperties;

  const handleUpdateInGroup = (groupId: string, itemId: string, updates: Partial<PatternChainItem>) => {
    if (!group.items) return;
    const newItems = group.items.map(i => i.id === itemId ? { ...i, ...updates } : i);
    updateChainItem(groupId, { items: newItems });
  };

  const handleRemoveFromGroup = (groupId: string, itemId: string) => {
    if (!group.items) return;
    const newItems = group.items.filter(i => i.id !== itemId);
    updateChainItem(groupId, { items: newItems });
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes}
      {...listeners}
      className={`pattern-chain-group ${isSelected ? 'selected' : ''}`}
      onClick={(e) => onSelect(e, group.id)}
      onContextMenu={(e) => onContextMenu(e, group)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', color: isSelected ? '#ffd875' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px', fontFamily: "'Outfit', system-ui, sans-serif", fontWeight: 700 }}>
          <Folder size={13} style={{ color: '#ffd875' }} />
          <span>GRUPO</span>
        </span>
        <div className="block-nav-btns" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button className="chain-nav-btn remove-btn" onClick={(e) => { e.stopPropagation(); removeChainItem(group.id); }} title="Eliminar grupo">✕</button>
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', overflowX: 'auto', paddingBottom: '2px', minHeight: '68px', minWidth: '80px' }}>
        <SortableContext
          items={(group.items || []).map(i => i.id)}
          strategy={horizontalListSortingStrategy}
        >
          {group.items?.map((item, i) => (
            <React.Fragment key={item.id}>
              <SortablePatternItem
                item={item}
                totalPatterns={totalPatterns}
                isInsideGroup={true}
                parentGroupId={group.id}
                isCurrentPlaying={isPlaying && !isPatternRepeatOn && currentChainItemId === item.id}
                isSelected={selectedChainIds.includes(item.id)}
                zoomLevel={zoomLevel}
                updateChainItem={updateChainItem}
                removeChainItem={removeChainItem}
                setCurrentDrumPatternEdit={setCurrentDrumPatternEdit}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onRemoveFromGroup={handleRemoveFromGroup}
                onUpdateInGroup={handleUpdateInGroup}
              />
              {i < (group.items?.length ?? 0) - 1 && (
                <div style={{ color: 'var(--border-color)', opacity: 0.6 }}><LinkIcon size={12} /></div>
              )}
            </React.Fragment>
          ))}
        </SortableContext>
        <button 
          type="button"
          className="action-btn"
          style={{ width: '28px', height: '28px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.8 }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const newItems = [...(group.items || []), { id: `chain_${Date.now()}`, type: 'pattern' as const, patternIndex: currentDrumPatternEdit, repeatCount: 1 }];
            updateChainItem(group.id, { items: newItems });
          }}
          title="Añadir patrón al grupo"
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="block-repeat-counter" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ alignSelf: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '1px 6px' }}>
        <button type="button" className="repeat-btn" disabled={group.repeatCount <= 1} onClick={(e) => { e.stopPropagation(); updateChainItem(group.id, { repeatCount: Math.max(1, group.repeatCount - 1) }); }}>-</button>
        <span className="repeat-count-text">x{group.repeatCount}</span>
        <button type="button" className="repeat-btn" onClick={(e) => { e.stopPropagation(); updateChainItem(group.id, { repeatCount: Math.min(64, group.repeatCount + 1) }); }}>+</button>
      </div>
    </div>
  );
};

export const PatternChainArranger: React.FC = () => {
  const {
    patternChain,
    drumChannels,
    isPatternRepeatOn,
    currentChainItemId,
    addChainItem,
    updateChainItem,
    removeChainItem,
    setCurrentDrumPatternEdit,
    currentDrumPatternEdit,
    isPlaying,
    selectedChainIds,
    setSelectedChainIds,
    toggleSelectChainId,
    selectAllChainItems,
    copySelectedChainItems,
    cutSelectedChainItems,
    pasteChainItems,
    duplicateSelectedChainItems,
    deleteSelectedChainItems,
    groupSelectedChainItems,
    ungroupSelectedChainItems,
    chainClipboard,
    drumTimelineViewport,
    setDrumTimelineViewport
  } = useSongStore(useShallow(state => ({
    patternChain: state.patternChain,
    drumChannels: state.drumChannels || [],
    isPatternRepeatOn: state.isPatternRepeatOn,
    currentChainItemId: state.currentChainItemId,
    addChainItem: state.addChainItem,
    updateChainItem: state.updateChainItem,
    removeChainItem: state.removeChainItem,
    setCurrentDrumPatternEdit: state.setCurrentDrumPatternEdit,
    currentDrumPatternEdit: state.currentDrumPatternEdit,
    isPlaying: state.isPlaying,
    selectedChainIds: state.selectedChainIds || [],
    setSelectedChainIds: state.setSelectedChainIds,
    toggleSelectChainId: state.toggleSelectChainId,
    selectAllChainItems: state.selectAllChainItems,
    copySelectedChainItems: state.copySelectedChainItems,
    cutSelectedChainItems: state.cutSelectedChainItems,
    pasteChainItems: state.pasteChainItems,
    duplicateSelectedChainItems: state.duplicateSelectedChainItems,
    deleteSelectedChainItems: state.deleteSelectedChainItems,
    groupSelectedChainItems: state.groupSelectedChainItems,
    ungroupSelectedChainItems: state.ungroupSelectedChainItems,
    chainClipboard: state.chainClipboard || [],
    drumTimelineViewport: state.drumTimelineViewport,
    setDrumTimelineViewport: state.setDrumTimelineViewport
  })));

  const totalPatterns = drumChannels[0]?.patterns?.length || 8;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(drumTimelineViewport?.zoomLevel || 1.0);
  const trackWrapperRef = useRef<HTMLDivElement>(null);

  // Menús contextuales
  const [itemContextMenu, setItemContextMenu] = useState<{ x: number; y: number; item: PatternChainItem; parentGroupId?: string } | null>(null);
  const [trackContextMenu, setTrackContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setDrumTimelineViewport({ zoomLevel });
  }, [zoomLevel, setDrumTimelineViewport]);

  useEffect(() => {
    if (trackWrapperRef.current) {
      trackWrapperRef.current.scrollLeft = drumTimelineViewport?.scrollLeft ?? 0;
    }
  }, [drumTimelineViewport?.scrollLeft]);

  // Zoom con Alt + Rueda y Scroll con Shift + Rueda
  useEffect(() => {
    const el = trackWrapperRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoomLevel(z => Math.max(0.6, Math.min(2.0, parseFloat((z + delta).toFixed(2)))));
      } else if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Atajos de teclado para la Cadena de Patrones
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isCtrlOrCmd && e.key.toLowerCase() === 'c') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          copySelectedChainItems();
        }
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'x') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          cutSelectedChainItems();
        }
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteChainItems(selectedChainIds[0]);
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'd') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          duplicateSelectedChainItems();
        }
      } else if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'g') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          ungroupSelectedChainItems();
        }
      } else if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'g') {
        if (selectedChainIds.length > 1) {
          e.preventDefault();
          groupSelectedChainItems();
        }
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllChainItems();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedChainIds.length > 0) {
          e.preventDefault();
          deleteSelectedChainItems();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedChainIds,
    copySelectedChainItems,
    cutSelectedChainItems,
    pasteChainItems,
    duplicateSelectedChainItems,
    deleteSelectedChainItems,
    selectAllChainItems,
    groupSelectedChainItems,
    ungroupSelectedChainItems
  ]);

  // Cerrar selecciones al hacer clic en fondo
  const handleTrackBackgroundClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.pattern-chain-block') && !target.closest('.pattern-chain-group') && !target.closest('.context-menu-container') && !target.closest('.pattern-quick-picker-popover') && !target.closest('.chain-actions')) {
      if (selectedChainIds.length > 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        setSelectedChainIds([]);
      }
    }
  };

  const handleSelectItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const isMultiKey = e.shiftKey || e.ctrlKey || e.metaKey;
    toggleSelectChainId(id, isMultiKey);
  };

  const handleItemContextMenu = (e: React.MouseEvent, item: PatternChainItem, parentGroupId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedChainIds.includes(item.id)) {
      setSelectedChainIds([item.id]);
    }
    setItemContextMenu({ x: e.clientX, y: e.clientY, item, parentGroupId });
  };

  const handleTrackContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.pattern-chain-block') && !target.closest('.pattern-chain-group')) {
      e.preventDefault();
      e.stopPropagation();
      setTrackContextMenu({ x: e.clientX, y: e.clientY });
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleAddGroup = () => {
    const newGroup: PatternChainItem = {
      id: `group_${Date.now()}`,
      type: 'group',
      repeatCount: 1,
      items: [
        { id: `chain_${Date.now()}_1`, type: 'pattern', patternIndex: currentDrumPatternEdit, repeatCount: 1 },
        { id: `chain_${Date.now()}_2`, type: 'pattern', patternIndex: (currentDrumPatternEdit + 1) % totalPatterns, repeatCount: 1 }
      ] 
    };
    useSongStore.setState(state => ({ 
      patternChain: [...state.patternChain, newGroup],
      selectedChainIds: [newGroup.id]
    }));
  };

  const findContainer = (id: string) => {
    if (patternChain.find(i => i.id === id)) {
      return 'root';
    }
    for (const group of patternChain) {
      if (group.type === 'group' && group.items?.find(i => i.id === id)) {
        return group.id;
      }
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    const overId = over?.id;

    if (!overId || active.id === overId) return;

    const activeContainer = findContainer(active.id as string);
    let overContainer = findContainer(overId as string);
    
    if (patternChain.find(i => i.id === overId && i.type === 'group')) {
      overContainer = overId as string;
    }

    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    useSongStore.setState((state) => {
      const nextChain = JSON.parse(JSON.stringify(state.patternChain)) as PatternChainItem[];
      let activeItem: PatternChainItem | undefined;
      
      if (activeContainer === 'root') {
        const index = nextChain.findIndex(i => i.id === active.id);
        activeItem = nextChain[index];
        nextChain.splice(index, 1);
      } else {
        const groupIndex = nextChain.findIndex(g => g.id === activeContainer);
        if (groupIndex !== -1 && nextChain[groupIndex].items) {
          const index = nextChain[groupIndex].items!.findIndex(i => i.id === active.id);
          activeItem = nextChain[groupIndex].items![index];
          nextChain[groupIndex].items!.splice(index, 1);
        }
      }

      if (!activeItem) return { patternChain: nextChain };

      if (overContainer === 'root') {
        const overIndex = nextChain.findIndex(i => i.id === overId);
        const newIndex = overIndex >= 0 ? overIndex : nextChain.length;
        nextChain.splice(newIndex, 0, activeItem);
      } else {
        const groupIndex = nextChain.findIndex(g => g.id === overContainer);
        if (groupIndex !== -1) {
          if (!nextChain[groupIndex].items) nextChain[groupIndex].items = [];
          const overIndex = nextChain[groupIndex].items!.findIndex(i => i.id === overId);
          const newIndex = overIndex >= 0 ? overIndex : nextChain[groupIndex].items!.length;
          nextChain[groupIndex].items!.splice(newIndex, 0, activeItem);
        }
      }

      return { patternChain: nextChain };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(over.id as string);

    if (activeContainer && activeContainer === overContainer) {
      useSongStore.setState((state) => {
        const nextChain = JSON.parse(JSON.stringify(state.patternChain)) as PatternChainItem[];

        if (activeContainer === 'root') {
          const oldIndex = nextChain.findIndex(i => i.id === active.id);
          const newIndex = nextChain.findIndex(i => i.id === over.id);
          return { patternChain: arrayMove(nextChain, oldIndex, newIndex) };
        } else {
          const groupIndex = nextChain.findIndex(g => g.id === activeContainer);
          if (groupIndex !== -1 && nextChain[groupIndex].items) {
            const items = nextChain[groupIndex].items!;
            const oldIndex = items.findIndex(i => i.id === active.id);
            const newIndex = items.findIndex(i => i.id === over.id);
            nextChain[groupIndex].items = arrayMove(items, oldIndex, newIndex);
            return { patternChain: nextChain };
          }
        }
        return state;
      });
    }
  };

  const activeItem = activeId 
    ? (
      patternChain.find(i => i.id === activeId) || 
      patternChain.reduce<PatternChainItem | undefined>((acc, curr) => acc || curr.items?.find(i => i.id === activeId), undefined)
    ) 
    : null;

  const hasSelection = selectedChainIds.length > 0;
  const isSingleGroupSelected = hasSelection && selectedChainIds.length === 1 && patternChain.some(i => i.id === selectedChainIds[0] && i.type === 'group');

  return (
    <div className="pattern-chain-container" onClick={handleTrackBackgroundClick} onContextMenu={handleTrackContextMenu}>
      <div className="pattern-chain-header">
        <div className="chain-title-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LinkIcon size={15} className="chain-icon" style={{ color: 'var(--reposo)' }} />
          <span style={{ fontSize: '0.78rem', fontFamily: "'Outfit', system-ui, sans-serif", color: 'var(--text-secondary)', letterSpacing: '0.04em', fontWeight: 700 }}>
            CADENA DE PATRONES ({patternChain.length} {patternChain.length === 1 ? 'bloque' : 'bloques'})
          </span>
        </div>

        {/* Barra Central de Controles de Zoom */}
        <div className="timeline-zoom-group" style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(0,0,0,0.4)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            type="button"
            className="action-btn"
            style={{ padding: '2px 5px', minHeight: '22px', fontSize: '0.7rem' }}
            title="Reducir Zoom (Alt + Rueda Abajo)"
            onClick={() => setZoomLevel(z => Math.max(0.6, parseFloat((z - 0.1).toFixed(2))))}
          >
            <ZoomOut size={12} />
          </button>
          <span
            style={{ fontSize: '0.72rem', fontFamily: "'Outfit', system-ui, sans-serif", color: 'var(--text-secondary)', padding: '0 5px', minWidth: '36px', textAlign: 'center', cursor: 'pointer', fontWeight: 700 }}
            title="Hacer clic para restaurar 100%"
            onClick={() => setZoomLevel(1.0)}
          >
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            className="action-btn"
            style={{ padding: '2px 5px', minHeight: '22px', fontSize: '0.7rem' }}
            title="Aumentar Zoom (Alt + Rueda Arriba)"
            onClick={() => setZoomLevel(z => Math.min(2.0, parseFloat((z + 0.1).toFixed(2))))}
          >
            <ZoomIn size={12} />
          </button>
        </div>

        {/* Barra de Acciones de la Cadena */}
        <div className="chain-actions" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {hasSelection && (
            <>
              <button
                type="button"
                className="action-btn"
                style={{ padding: '3px 8px', fontSize: '0.72rem', color: '#ffd875', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(255,216,117,0.3)' }}
                onClick={duplicateSelectedChainItems}
                title="Duplicar selección (Ctrl+D)"
              >
                <Layers size={12} /> Duplicar
              </button>

              <button
                type="button"
                className="action-btn"
                style={{ padding: '3px 8px', fontSize: '0.72rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={copySelectedChainItems}
                title="Copiar selección (Ctrl+C)"
              >
                <Copy size={12} /> Copiar
              </button>

              <button
                type="button"
                className="action-btn"
                style={{ padding: '3px 8px', fontSize: '0.72rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={cutSelectedChainItems}
                title="Cortar selección (Ctrl+X)"
              >
                <Scissors size={12} /> Cortar
              </button>

              {selectedChainIds.length > 1 && (
                <button
                  type="button"
                  className="action-btn"
                  style={{ padding: '3px 8px', fontSize: '0.72rem', color: '#ffd875', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={groupSelectedChainItems}
                  title="Agrupar selección (Ctrl+G)"
                >
                  <Group size={12} /> Agrupar
                </button>
              )}

              {isSingleGroupSelected && (
                <button
                  type="button"
                  className="action-btn"
                  style={{ padding: '3px 8px', fontSize: '0.72rem', color: 'var(--subdominante)', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={ungroupSelectedChainItems}
                  title="Desagrupar grupo seleccionado (Ctrl+Shift+G)"
                >
                  <Ungroup size={12} /> Desagrupar
                </button>
              )}

              <button
                type="button"
                className="action-btn danger-action"
                style={{ padding: '3px 8px', fontSize: '0.72rem', color: '#ff4757', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(255,71,87,0.3)' }}
                onClick={deleteSelectedChainItems}
                title="Eliminar seleccionados (Supr)"
              >
                <Trash2 size={12} /> Eliminar
              </button>
            </>
          )}

          {chainClipboard.length > 0 && (
            <button
              type="button"
              className="action-btn"
              style={{ padding: '3px 8px', fontSize: '0.72rem', color: 'var(--reposo)', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(95,171,130,0.35)' }}
              onClick={() => pasteChainItems(selectedChainIds[0])}
              title="Pegar elementos del portapapeles (Ctrl+V)"
            >
              <Clipboard size={12} /> Pegar ({chainClipboard.length})
            </button>
          )}

          <button 
            type="button"
            className="action-btn primary-add-btn"
            style={{ padding: '3px 9px', fontSize: '0.72rem', color: 'var(--accent-hover)', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(132,112,204,0.4)', background: 'rgba(132,112,204,0.1)' }}
            onClick={() => addChainItem(currentDrumPatternEdit, 1)}
            title={`Añadir Patrón P${currentDrumPatternEdit + 1} a la cadena`}
          >
            <Plus size={13} /> P{currentDrumPatternEdit + 1}
          </button>

          <button 
            type="button"
            className="action-btn"
            style={{ padding: '3px 9px', fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)' }}
            onClick={() => addChainItem(-1, 1)}
            title="Añadir Silencio a la cadena"
          >
            <Plus size={13} /> <VolumeX size={13} />
          </button>

          <button 
            type="button"
            className="action-btn"
            style={{ padding: '3px 8px', fontSize: '0.72rem', color: 'var(--subdominante)', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={handleAddGroup}
            title="Añadir Subgrupo a la cadena"
          >
            <Plus size={13} /> <Folder size={13} />
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div 
          className="pattern-chain-track-wrapper" 
          ref={trackWrapperRef}
          onScroll={(e) => {
            const left = e.currentTarget.scrollLeft;
            setDrumTimelineViewport({ scrollLeft: left });
          }}
        >
          <div className="pattern-chain-track">
            <SortableContext items={patternChain.map(i => i.id)} strategy={horizontalListSortingStrategy}>
              {patternChain.map((item, index) => (
                <React.Fragment key={item.id}>
                  {item.type === 'group' 
                    ? <SortableGroupItem
                        group={item}
                        totalPatterns={totalPatterns}
                        isPlaying={isPlaying}
                        isPatternRepeatOn={isPatternRepeatOn}
                        isSelected={selectedChainIds.includes(item.id)}
                        selectedChainIds={selectedChainIds}
                        zoomLevel={zoomLevel}
                        currentChainItemId={currentChainItemId}
                        currentDrumPatternEdit={currentDrumPatternEdit}
                        updateChainItem={updateChainItem}
                        removeChainItem={removeChainItem}
                        setCurrentDrumPatternEdit={setCurrentDrumPatternEdit}
                        onSelect={handleSelectItem}
                        onContextMenu={handleItemContextMenu}
                      /> 
                    : <SortablePatternItem
                        item={item}
                        totalPatterns={totalPatterns}
                        isCurrentPlaying={isPlaying && !isPatternRepeatOn && currentChainItemId === item.id}
                        isSelected={selectedChainIds.includes(item.id)}
                        zoomLevel={zoomLevel}
                        updateChainItem={updateChainItem}
                        removeChainItem={removeChainItem}
                        setCurrentDrumPatternEdit={setCurrentDrumPatternEdit}
                        onSelect={handleSelectItem}
                        onContextMenu={handleItemContextMenu}
                      />
                  }

                  {index < patternChain.length - 1 && (
                    <div className={`chain-connector ${isPlaying && !isPatternRepeatOn ? 'active-pulse' : ''}`}>
                      <svg className="chain-link-svg" viewBox="0 0 40 20">
                        <path 
                          d="M 0 10 Q 10 0, 20 10 T 40 10" 
                          className="chain-cord-path"
                        />
                        <circle cx="20" cy="10" r="3" className="chain-node-dot" />
                      </svg>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </SortableContext>
          </div>
        </div>

        <DragOverlay>
          {activeItem ? (
            activeItem.type === 'group' ? (
              <SortableGroupItem
                group={activeItem}
                totalPatterns={totalPatterns}
                isPlaying={isPlaying}
                isPatternRepeatOn={isPatternRepeatOn}
                isSelected={false}
                selectedChainIds={[]}
                zoomLevel={zoomLevel}
                currentChainItemId={currentChainItemId}
                currentDrumPatternEdit={currentDrumPatternEdit}
                updateChainItem={() => {}}
                removeChainItem={() => {}}
                setCurrentDrumPatternEdit={() => {}}
                onSelect={() => {}}
                onContextMenu={() => {}}
              />
            ) : (
              <SortablePatternItem
                item={activeItem}
                totalPatterns={totalPatterns}
                isCurrentPlaying={isPlaying && !isPatternRepeatOn && currentChainItemId === activeItem.id}
                isSelected={false}
                zoomLevel={zoomLevel}
                updateChainItem={() => {}}
                removeChainItem={() => {}}
                setCurrentDrumPatternEdit={() => {}}
                onSelect={() => {}}
                onContextMenu={() => {}}
              />
            )
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Menú Contextual de Bloque */}
      {itemContextMenu && (
        <ContextMenuContainer
          x={itemContextMenu.x}
          y={itemContextMenu.y}
        >
          <div className="menu-header">
            <span>
              {itemContextMenu.item.type === 'group' 
                ? 'GRUPO DE PATRONES' 
                : (itemContextMenu.item.type === 'rest' || itemContextMenu.item.patternIndex === -1)
                ? 'BLOQUE SILENCIO'
                : `BLOQUE P${(itemContextMenu.item.patternIndex ?? 0) + 1}`}
            </span>
          </div>

          {itemContextMenu.item.type !== 'group' && (
            (itemContextMenu.item.type === 'rest' || itemContextMenu.item.patternIndex === -1) ? (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  updateChainItem(itemContextMenu.item.id, { type: 'pattern', patternIndex: currentDrumPatternEdit });
                  setItemContextMenu(null);
                }}
              >
                <Plus size={13} /> Convertir a Patrón P{currentDrumPatternEdit + 1}
              </button>
            ) : (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  updateChainItem(itemContextMenu.item.id, { type: 'rest', patternIndex: -1 });
                  setItemContextMenu(null);
                }}
              >
                <VolumeX size={13} /> Convertir a Silencio
              </button>
            )
          )}

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              copySelectedChainItems();
              setItemContextMenu(null);
            }}
          >
            <Copy size={13} /> Copiar (Ctrl+C)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              duplicateSelectedChainItems();
              setItemContextMenu(null);
            }}
          >
            <Layers size={13} /> Duplicar (Ctrl+D)
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              cutSelectedChainItems();
              setItemContextMenu(null);
            }}
          >
            <Scissors size={13} /> Cortar (Ctrl+X)
          </button>

          {chainClipboard.length > 0 && (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                pasteChainItems(itemContextMenu.item.id);
                setItemContextMenu(null);
              }}
            >
              <Clipboard size={13} /> Pegar después (Ctrl+V)
            </button>
          )}

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              addChainItem(-1, 1);
              setItemContextMenu(null);
            }}
          >
            <VolumeX size={13} /> Insertar Silencio
          </button>

          {selectedChainIds.length > 1 && (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                groupSelectedChainItems();
                setItemContextMenu(null);
              }}
            >
              <Group size={13} /> Agrupar ({selectedChainIds.length}) (Ctrl+G)
            </button>
          )}

          {itemContextMenu.item.type === 'group' && (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                ungroupSelectedChainItems();
                setItemContextMenu(null);
              }}
            >
              <Ungroup size={13} /> Desagrupar (Ctrl+Shift+G)
            </button>
          )}

          <hr className="menu-separator" />

          <button
            type="button"
            className="menu-danger"
            onClick={() => {
              deleteSelectedChainItems();
              setItemContextMenu(null);
            }}
          >
            <Trash2 size={13} /> Eliminar
          </button>
        </ContextMenuContainer>
      )}

      {/* Menú Contextual de Pista (Right-click en fondo) */}
      {trackContextMenu && (
        <ContextMenuContainer
          x={trackContextMenu.x}
          y={trackContextMenu.y}
        >
          <div className="menu-header">
            <span>CADENA DE PATRONES</span>
          </div>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              addChainItem(currentDrumPatternEdit, 1);
              setTrackContextMenu(null);
            }}
          >
            <Plus size={13} /> Insertar Patrón P{currentDrumPatternEdit + 1}
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              addChainItem(-1, 1);
              setTrackContextMenu(null);
            }}
          >
            <VolumeX size={13} /> Insertar Silencio
          </button>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              handleAddGroup();
              setTrackContextMenu(null);
            }}
          >
            <Folder size={13} /> Insertar Nuevo Grupo
          </button>

          {chainClipboard.length > 0 && (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                pasteChainItems();
                setTrackContextMenu(null);
              }}
            >
              <Clipboard size={13} /> Pegar ({chainClipboard.length}) (Ctrl+V)
            </button>
          )}

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              selectAllChainItems();
              setTrackContextMenu(null);
            }}
          >
            <Layers size={13} /> Seleccionar Todo (Ctrl+A)
          </button>
        </ContextMenuContainer>
      )}
    </div>
  );
};
