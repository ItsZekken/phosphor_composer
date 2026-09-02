import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface CustomSelectProps {
  value: string;
  options?: SelectOption[];
  groups?: SelectGroup[];
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
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && menuRef.current) {
      const activeEl = menuRef.current.querySelector('.style-item-row.active') as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;
      
      let top = rect.bottom + 4;
      if (top + 240 > windowHeight && rect.top - 240 > 0) {
        top = Math.max(10, rect.top - 245);
      }
      
      let left = rect.left;
      if (left + 220 > windowWidth) {
        left = Math.max(10, windowWidth - 230);
      }

      setMenuPos({
        top,
        left,
        minWidth: Math.max(130, rect.width)
      });
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (activeGroup && subMenuRef.current && menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const subMenuRect = subMenuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      
      // Check if sub-menu would overflow right edge
      if (menuRect.right + subMenuRect.width > viewportWidth) {
        setSubMenuDirection('left');
      } else {
        setSubMenuDirection('right');
      }
    }
  }, [activeGroup]);

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
          title={draggable ? 'Haz clic para seleccionar o arrastra el valor' : ''}
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
          className="style-popover-panel" 
          style={{ 
            position: 'fixed', 
            zIndex: 9999999, 
            top: `${menuPos.top}px`, 
            left: `${menuPos.left}px`, 
            minWidth: `${menuPos.minWidth}px`, 
            width: 'max-content', 
            padding: '4px', 
            boxShadow: '0 8px 30px rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'var(--bg-secondary, #1c1924)'
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options && (
            <div className="style-list-group" style={{ maxHeight: '250px', overflowY: 'auto' }}>
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
                  style={{ userSelect: 'none', WebkitUserSelect: 'none', cursor: draggable ? 'grab' : 'pointer' }}
                >
                  <span className="style-name" style={{ fontSize: '0.74rem', fontFamily: "'Share Tech Mono', monospace", userSelect: 'none', pointerEvents: 'none' }}>{opt.label}</span>
                  {value === opt.value && <span className="style-led active" />}
                </div>
              ))}
            </div>
          )}

          {groups && (
            <div className="style-list-group hierarchical-group-list" style={{ maxHeight: '250px', overflowY: 'visible' }}>
              {groups.map(group => (
                <div
                  key={group.label}
                  className="style-item-row hierarchical-group-item"
                  style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', overflow: 'visible', background: activeGroup === group.label ? 'rgba(255,255,255,0.1)' : undefined }}
                  onMouseEnter={() => setActiveGroup(group.label)}
                >
                  <span className="style-name" style={{ fontSize: '0.74rem', fontFamily: "'Share Tech Mono', monospace" }}>{group.label}</span>
                  <ChevronRight size={14} style={{ opacity: 0.5 }} />

                  {/* Submenu */}
                  {activeGroup === group.label && (
                    <div 
                      ref={subMenuRef}
                      className="style-popover-panel submenu-panel" 
                      style={{ 
                        position: 'absolute', 
                        top: '-4px', 
                        [subMenuDirection === 'right' ? 'left' : 'right']: '100%',
                        marginLeft: subMenuDirection === 'right' ? '4px' : '0',
                        marginRight: subMenuDirection === 'left' ? '4px' : '0',
                        width: 'max-content',
                        minWidth: '150px',
                        zIndex: 9999999,
                        padding: '4px',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.85)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'var(--bg-secondary, #1c1924)'
                      }}
                    >
                      <div className="style-list-group" style={{ maxHeight: '250px', overflowY: 'auto' }}>
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
                            style={{ userSelect: 'none', WebkitUserSelect: 'none', cursor: draggable ? 'grab' : 'pointer' }}
                          >
                            <span className="style-name" style={{ fontSize: '0.74rem', fontFamily: "'Share Tech Mono', monospace", userSelect: 'none', pointerEvents: 'none' }}>{opt.label}</span>
                            {value === opt.value && <span className="style-led active" />}
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

