import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { CustomSelect } from '../ui/CustomSelect';
import { Folder, Link as LinkIcon, Plus, GripVertical } from 'lucide-react';
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
  'var(--subdominante)',
  'var(--tension)',
  'var(--spicy)',
  'var(--exotic)',
  '#ff007f',
  '#00bfff',
  '#ffaa00'
];

interface SortablePatternItemProps {
  item: PatternChainItem;
  isInsideGroup?: boolean;
  parentGroupId?: string;
  isCurrentPlaying: boolean;
  currentDrumPatternEdit: number;
  updateChainItem: (id: string, updates: Partial<PatternChainItem>) => void;
  removeChainItem: (id: string) => void;
  setCurrentDrumPatternEdit: (idx: number) => void;
  onRemoveFromGroup?: (groupId: string, itemId: string) => void;
  onUpdateInGroup?: (groupId: string, itemId: string, updates: Partial<PatternChainItem>) => void;
}

const SortablePatternItem: React.FC<SortablePatternItemProps> = ({
  item,
  isInsideGroup = false,
  parentGroupId,
  isCurrentPlaying,
  currentDrumPatternEdit,
  updateChainItem,
  removeChainItem,
  setCurrentDrumPatternEdit,
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    '--block-color': colors[(item.patternIndex ?? 0) % colors.length],
    scale: isInsideGroup ? '0.9' : '1',
    margin: isInsideGroup ? '0' : undefined
  } as React.CSSProperties;

  const handleUpdate = (updates: Partial<PatternChainItem>) => {
    if (isInsideGroup && parentGroupId && onUpdateInGroup) {
      onUpdateInGroup(parentGroupId, item.id, updates);
    } else {
      updateChainItem(item.id, updates);
    }
  };

  const handleRemove = () => {
    if (isInsideGroup && parentGroupId && onRemoveFromGroup) {
      onRemoveFromGroup(parentGroupId, item.id);
    } else {
      removeChainItem(item.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`pattern-chain-block ${isCurrentPlaying ? 'playing' : ''} ${item.patternIndex === currentDrumPatternEdit ? 'editing' : ''}`}
    >
      <div className="block-color-bar" />
      <div className="block-content">
        <div className="block-header">
          <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '4px', opacity: 0.7 }}>
            <GripVertical size={14} />
          </div>
          <div className="block-pattern-select" style={{ minWidth: '45px' }}>
            <CustomSelect
              value={String(item.patternIndex ?? 0)}
              onChange={(val) => {
                handleUpdate({ patternIndex: Number(val) });
                setCurrentDrumPatternEdit(Number(val));
              }}
              options={Array.from({ length: 8 }).map((_, pIdx) => ({
                value: String(pIdx),
                label: `P${pIdx + 1}`
              }))}
            />
          </div>
          <div className="block-nav-btns">
            <button className="chain-nav-btn remove-btn" onClick={handleRemove}>✕</button>
          </div>
        </div>
        <div className="block-repeat-counter">
          <button
            className="repeat-btn"
            disabled={item.repeatCount <= 1}
            onClick={() => handleUpdate({ repeatCount: Math.max(1, item.repeatCount - 1) })}
          >-</button>
          <span className="repeat-count-text">x{item.repeatCount}</span>
          <button
            className="repeat-btn"
            onClick={() => handleUpdate({ repeatCount: item.repeatCount + 1 })}
          >+</button>
        </div>
      </div>
    </div>
  );
};

interface SortableGroupItemProps {
  group: PatternChainItem;
  isPlaying: boolean;
  isPatternRepeatOn: boolean;
  currentChainItemId: string | null;
  currentDrumPatternEdit: number;
  updateChainItem: (id: string, updates: Partial<PatternChainItem>) => void;
  removeChainItem: (id: string) => void;
  setCurrentDrumPatternEdit: (idx: number) => void;
}

const SortableGroupItem: React.FC<SortableGroupItemProps> = ({
  group,
  isPlaying,
  isPatternRepeatOn,
  currentChainItemId,
  currentDrumPatternEdit,
  updateChainItem,
  removeChainItem,
  setCurrentDrumPatternEdit
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
    opacity: isDragging ? 0.4 : 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '8px',
    border: '1px dashed var(--border-color)',
    borderRadius: '8px',
    background: 'rgba(0,0,0,0.2)'
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
    <div ref={setNodeRef} style={style} className="pattern-chain-group">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex' }}>
            <GripVertical size={12} />
          </div>
          <Folder size={12} />
        </span>
        <div className="block-nav-btns" style={{ display: 'flex', gap: '4px' }}>
          <button className="chain-nav-btn remove-btn" onClick={() => removeChainItem(group.id)}>✕</button>
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', overflowX: 'auto', paddingBottom: '4px', minHeight: '80px', minWidth: '100px' }}>
        <SortableContext
          items={(group.items || []).map(i => i.id)}
          strategy={horizontalListSortingStrategy}
        >
          {group.items?.map((item, i) => (
            <React.Fragment key={item.id}>
              <SortablePatternItem
                item={item}
                isInsideGroup={true}
                parentGroupId={group.id}
                isCurrentPlaying={isPlaying && !isPatternRepeatOn && currentChainItemId === item.id}
                currentDrumPatternEdit={currentDrumPatternEdit}
                updateChainItem={updateChainItem}
                removeChainItem={removeChainItem}
                setCurrentDrumPatternEdit={setCurrentDrumPatternEdit}
                onRemoveFromGroup={handleRemoveFromGroup}
                onUpdateInGroup={handleUpdateInGroup}
              />
              {i < (group.items?.length ?? 0) - 1 && (
                <div style={{ color: 'var(--border-color)' }}><LinkIcon size={14} /></div>
              )}
            </React.Fragment>
          ))}
        </SortableContext>
        <button 
          className="action-btn"
          style={{ width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => {
            const newItems = [...(group.items || []), { id: `chain_${Date.now()}`, type: 'pattern' as const, patternIndex: currentDrumPatternEdit, repeatCount: 1 }];
            updateChainItem(group.id, { items: newItems });
          }}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="block-repeat-counter" style={{ alignSelf: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', padding: '2px 8px' }}>
        <button className="repeat-btn" disabled={group.repeatCount <= 1} onClick={() => updateChainItem(group.id, { repeatCount: Math.max(1, group.repeatCount - 1) })}>-</button>
        <span className="repeat-count-text">x{group.repeatCount}</span>
        <button className="repeat-btn" onClick={() => updateChainItem(group.id, { repeatCount: group.repeatCount + 1 })}>+</button>
      </div>
    </div>
  );
};

export const PatternChainArranger: React.FC = () => {
  const {
    patternChain,
    isPatternRepeatOn,
    currentChainItemId,
    addChainItem,
    updateChainItem,
    removeChainItem,
    setCurrentDrumPatternEdit,
    currentDrumPatternEdit,
    isPlaying
  } = useSongStore();

  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleAddGroup = () => {
    const newGroup: PatternChainItem = {
      id: `group_${Date.now()}`,
      type: 'group',
      repeatCount: 2,
      items: [] 
    };
    useSongStore.setState(state => ({ patternChain: [...state.patternChain, newGroup] }));
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

    if (!overId || active.id === overId) {
      return;
    }

    const activeContainer = findContainer(active.id as string);
    let overContainer = findContainer(overId as string);
    
    // Si pasamos por encima del grupo en sí, el contenedor es el id del grupo
    if (patternChain.find(i => i.id === overId && i.type === 'group')) {
        overContainer = overId as string;
    }

    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return;
    }

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

    if (!over || active.id === over.id) {
      return;
    }

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

  return (
    <div className="pattern-chain-container">
      <div className="pattern-chain-header">
        <div className="chain-title-group">
          <LinkIcon size={16} className="chain-icon" style={{ color: 'var(--reposo)' }} />
        </div>

        <div className="chain-actions">
          <button 
            className="action-btn"
            style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => addChainItem(currentDrumPatternEdit, 1)}
            title={`Añadir Patrón ${currentDrumPatternEdit + 1}`}
          >
            <Plus size={14} /> P{currentDrumPatternEdit + 1}
          </button>
          <button 
            className="action-btn"
            style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--subdominante)', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={handleAddGroup}
            title="Añadir Subgrupo"
          >
            <Plus size={14} /> <Folder size={14} />
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
        <div className="pattern-chain-track-wrapper">
          <div className="pattern-chain-track">
            <SortableContext items={patternChain.map(i => i.id)} strategy={horizontalListSortingStrategy}>
              {patternChain.map((item, index) => (
                <React.Fragment key={item.id}>
                  {item.type === 'group' 
                    ? <SortableGroupItem
                        group={item}
                        isPlaying={isPlaying}
                        isPatternRepeatOn={isPatternRepeatOn}
                        currentChainItemId={currentChainItemId}
                        currentDrumPatternEdit={currentDrumPatternEdit}
                        updateChainItem={updateChainItem}
                        removeChainItem={removeChainItem}
                        setCurrentDrumPatternEdit={setCurrentDrumPatternEdit}
                      /> 
                    : <SortablePatternItem
                        item={item}
                        isCurrentPlaying={isPlaying && !isPatternRepeatOn && currentChainItemId === item.id}
                        currentDrumPatternEdit={currentDrumPatternEdit}
                        updateChainItem={updateChainItem}
                        removeChainItem={removeChainItem}
                        setCurrentDrumPatternEdit={setCurrentDrumPatternEdit}
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
                isPlaying={isPlaying}
                isPatternRepeatOn={isPatternRepeatOn}
                currentChainItemId={currentChainItemId}
                currentDrumPatternEdit={currentDrumPatternEdit}
                updateChainItem={() => {}}
                removeChainItem={() => {}}
                setCurrentDrumPatternEdit={() => {}}
              />
            ) : (
              <SortablePatternItem
                item={activeItem}
                isCurrentPlaying={isPlaying && !isPatternRepeatOn && currentChainItemId === activeItem.id}
                currentDrumPatternEdit={currentDrumPatternEdit}
                updateChainItem={() => {}}
                removeChainItem={() => {}}
                setCurrentDrumPatternEdit={() => {}}
              />
            )
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};
