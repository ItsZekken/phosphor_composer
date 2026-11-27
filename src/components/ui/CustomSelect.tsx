import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  onDelete?: () => void;
  deleteTitle?: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectHeaderAction {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  title?: string;
}

export interface CustomSelectProps {
  value: string;
  options?: SelectOption[];
  groups?: SelectGroup[];
  headerAction?: SelectHeaderAction;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  labelPrefix?: string;
  renderButton?: (selectedOption: SelectOption | undefined) => React.ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onOptionDragStart?: (value: string, e: React.DragEvent<HTMLDivElement>) => void;
  onOptionMouseDown?: (value: string, e: React.MouseEvent<HTMLDivElement>) => void;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value, 
  options, 
  groups, 
  headerAction,
  onChange, 
  disabled, 
  className = '', 
  style, 
  labelPrefix, 
  renderButton,
  draggable,
  onDragStart,
  onMouseDown,
  onOptionDragStart,
  onOptionMouseDown
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [subMenuDirection, setSubMenuDirection] = useState<'right' | 'left'>('right');
  const [subMenuTop, setSubMenuTop] = useState<number>(-4);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; minWidth: number }>({ top: 0, left: 0, minWidth: 130 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
        setActiveGroup(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setActiveGroup(null);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && menuRef.current) {
      const activeEl = menuRef.current.querySelector('.style-item-row.active') as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [isOpen]);

  const hasHeaderAction = Boolean(headerAction);

  useLayoutEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;
      const menuHeight = menuRef.current?.offsetHeight || 245;
      const menuWidth = menuRef.current?.offsetWidth || 220;
      
      let top = rect.bottom + 4;
      if (top + menuHeight > windowHeight - 8 && rect.top - menuHeight - 4 > 8) {
        top = Math.max(10, rect.top - menuHeight - 4);
      } else if (top + menuHeight > windowHeight - 8) {
        top = Math.max(10, windowHeight - menuHeight - 8);
      }
      
      let left = rect.left;
      if (left + menuWidth > windowWidth - 10) {
        left = Math.max(10, windowWidth - menuWidth - 10);
      }

      setMenuPos({
        top,
        left,
        minWidth: Math.max(130, rect.width)
      });
    }
  }, [isOpen, groups?.length, options?.length, hasHeaderAction]);

  useLayoutEffect(() => {
    if (activeGroup && subMenuRef.current && menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const subMenuRect = subMenuRef.current.getBoundingClientRect();
      const parentRect = subMenuRef.current.parentElement?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Check if sub-menu would overflow right edge
      if (menuRect.right + subMenuRect.width + 6 > viewportWidth) {
        setSubMenuDirection('left');
      } else {
        setSubMenuDirection('right');
      }

      if (parentRect) {
        const defaultBottom = parentRect.top - 4 + subMenuRect.height;
        if (defaultBottom > viewportHeight - 8) {
          const overflow = defaultBottom - (viewportHeight - 8);
          const maxShiftUp = Math.max(0, parentRect.top - 12);
          setSubMenuTop(-4 - Math.min(overflow, maxShiftUp));
        } else {
          setSubMenuTop(-4);
        }
      }
    } else {
      setSubMenuTop(-4);
    }
  }, [activeGroup, groups]);

  let selectedOption: SelectOption | undefined;
  if (options) {
    selectedOption = options.find(o => o.value === value);
  } else if (groups) {
    for (const group of groups) {
      const found = group.options.find(o => o.value === value);
      if (found) {
        selectedOption = found;
        break;
      }
    }
  }
  selectedOption = selectedOption || { value, label: value };

  return (
    <div ref={containerRef} className={`custom-select-container ${className}`} style={{ position: 'relative', ...style }}>
      {renderButton ? (
        <div
          onClick={(e) => {
            if (disabled) return;
            e.stopPropagation();
            setIsOpen(!isOpen);
            setActiveGroup(null);
          }}
          onContextMenu={(e) => {
            if (disabled) return;
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(!isOpen);
            setActiveGroup(null);
          }}
        >
          {renderButton(selectedOption)}
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          className={`custom-select-btn ${isOpen ? 'active' : ''}`}
          draggable={draggable}
          onDragStart={onDragStart}
          onMouseDown={onMouseDown}
          onClick={(e) => {
            if (disabled) return;
            e.stopPropagation();
            setIsOpen(!isOpen);
            setActiveGroup(null);
          }}
          title={draggable ? 'Haz clic para seleccionar o arrastra el valor' : (typeof selectedOption.label === 'string' ? selectedOption.label : '')}
          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px', minHeight: '26px', height: '26px', cursor: draggable ? 'grab' : 'pointer', userSelect: 'none', WebkitUserSelect: 'none', opacity: disabled ? 0.5 : 1 }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.74rem', fontFamily: "'Share Tech Mono', monospace", userSelect: 'none', pointerEvents: 'none' }}>
            {labelPrefix ? `${labelPrefix} ` : ''}{selectedOption.label}
          </span>
          <ChevronDown size={14} style={{ flexShrink: 0, marginLeft: '6px', opacity: 0.6, pointerEvents: 'none' }} />
        </div>
      )}

      {isOpen && !disabled && createPortal(
        <div 
          ref={menuRef} 
          className="style-popover-panel custom-select-popover" 
          style={{ 
            position: 'fixed', 
            zIndex: 9999999, 
            top: `${menuPos.top}px`, 
            left: `${menuPos.left}px`, 
            minWidth: `${menuPos.minWidth}px`, 
            width: 'max-content', 
            padding: '4px', 
            gap: '4px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'var(--bg-secondary, #1c1924)'
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {headerAction && (
            <>
              <div
                role="button"
                tabIndex={0}
                className="style-item-row custom-select-header-action"
                title={headerAction.title}
                onMouseEnter={() => setActiveGroup(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                  setActiveGroup(null);
                  headerAction.onClick();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsOpen(false);
                    setActiveGroup(null);
                    headerAction.onClick();
                  }
                }}
              >
                <span className="style-name custom-select-header-action-content">
                  {headerAction.icon}
                  <span>{headerAction.label}</span>
                </span>
              </div>
              <div className="custom-select-header-divider" />
            </>
          )}

          {options && (
            <div className="style-list-group" style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: 0 }}>
              {options.map(opt => (
                <div 
                  key={opt.value}
                  className={`style-item-row ${value === opt.value ? 'active' : ''}`}
                  draggable={draggable}
                  onDragStart={(e) => {
                    if (onOptionDragStart) onOptionDragStart(opt.value, e);
                    else if (onDragStart) onDragStart(e);
                  }}
                  onMouseDown={(e) => {
                    if (onOptionMouseDown) onOptionMouseDown(opt.value, e);
                    else if (onMouseDown) onMouseDown(e);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  style={{ userSelect: 'none', WebkitUserSelect: 'none', cursor: draggable ? 'grab' : 'pointer', gap: '8px' }}
                >
                  <span className="style-name" style={{ fontSize: '0.74rem', fontFamily: "'Share Tech Mono', monospace", userSelect: 'none', pointerEvents: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>{opt.label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {value === opt.value && <span className="style-led active" />}
                    {opt.onDelete && (
                      <button
                        type="button"
                        className="custom-select-option-delete"
                        title={opt.deleteTitle || 'Eliminar'}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          opt.onDelete?.();
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {groups && (
            <div className="style-list-group hierarchical-group-list" style={{ maxHeight: '280px', overflowY: 'visible', marginBottom: 0 }}>
              {groups.map(group => (
                <div
                  key={group.label}
                  className="style-item-row hierarchical-group-item"
                  style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', overflow: 'visible', gap: '10px', background: activeGroup === group.label ? 'rgba(255,255,255,0.1)' : undefined }}
                  onMouseEnter={() => setActiveGroup(group.label)}
                >
                  <span className="style-name" style={{ fontSize: '0.74rem', fontFamily: "'Share Tech Mono', monospace" }}>{group.label}</span>
                  <ChevronRight size={14} style={{ opacity: 0.5, flexShrink: 0 }} />

                  {/* Submenu */}
                  {activeGroup === group.label && (
                    <div 
                      ref={subMenuRef}
                      className="style-popover-panel submenu-panel custom-select-popover" 
                      style={{ 
                        position: 'absolute', 
                        top: `${subMenuTop}px`, 
                        [subMenuDirection === 'right' ? 'left' : 'right']: '100%',
                        marginLeft: subMenuDirection === 'right' ? '4px' : '0',
                        marginRight: subMenuDirection === 'left' ? '4px' : '0',
                        width: 'max-content',
                        minWidth: '150px',
                        zIndex: 9999999,
                        padding: '4px',
                        gap: '4px',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.85)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'var(--bg-secondary, #1c1924)'
                      }}
                    >
                      <div className="style-list-group" style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: 0 }}>
                        {group.options.map(opt => (
                          <div 
                            key={opt.value}
                            className={`style-item-row ${value === opt.value ? 'active' : ''}`}
                            draggable={draggable}
                            onDragStart={(e) => {
                              if (onOptionDragStart) onOptionDragStart(opt.value, e);
                              else if (onDragStart) onDragStart(e);
                            }}
                            onMouseDown={(e) => {
                              if (onOptionMouseDown) onOptionMouseDown(opt.value, e);
                              else if (onMouseDown) onMouseDown(e);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onChange(opt.value);
                              setIsOpen(false);
                              setActiveGroup(null);
                            }}
                            style={{ userSelect: 'none', WebkitUserSelect: 'none', cursor: draggable ? 'grab' : 'pointer', gap: '8px' }}
                          >
                            <span className="style-name" style={{ fontSize: '0.74rem', fontFamily: "'Share Tech Mono', monospace", userSelect: 'none', pointerEvents: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>{opt.label}</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                              {value === opt.value && <span className="style-led active" />}
                              {opt.onDelete && (
                                <button
                                  type="button"
                                  className="custom-select-option-delete"
                                  title={opt.deleteTitle || 'Eliminar'}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    opt.onDelete?.();
                                  }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

