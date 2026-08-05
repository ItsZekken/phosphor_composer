import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
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
  renderButton
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [subMenuDirection, setSubMenuDirection] = useState<'right' | 'left'>('right');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveGroup(null);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      {renderButton ? renderButton(selectedOption) : (
        <button
          className={`custom-select-btn ${isOpen ? 'active' : ''}`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
            setActiveGroup(null);
          }}
          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px', minHeight: '28px' }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
            {labelPrefix ? `${labelPrefix} ` : ''}{selectedOption.label}
          </span>
          <ChevronDown size={14} style={{ flexShrink: 0, marginLeft: '6px', opacity: 0.6 }} />
        </button>
      )}

      {isOpen && !disabled && (
        <div ref={menuRef} className="style-popover-panel" style={{ width: 'max-content', minWidth: '100%', position: 'absolute', zIndex: 1000, top: '100%', left: 0, marginTop: '4px', padding: '4px' }}>
          
          {options && (
            <div className="style-list-group" style={{ maxHeight: '250px', overflowY: 'auto' }}>
              {options.map(opt => (
                <div 
                  key={opt.value}
                  className={`style-item-row ${value === opt.value ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                >
                  <span className="style-name" style={{ fontSize: '0.8rem' }}>{opt.label}</span>
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
                  <span className="style-name" style={{ fontSize: '0.8rem' }}>{group.label}</span>
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
                        zIndex: 1001,
                        padding: '4px'
                      }}
                    >
                      <div className="style-list-group" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                        {group.options.map(opt => (
                          <div 
                            key={opt.value}
                            className={`style-item-row ${value === opt.value ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onChange(opt.value);
                              setIsOpen(false);
                              setActiveGroup(null);
                            }}
                          >
                            <span className="style-name" style={{ fontSize: '0.8rem' }}>{opt.label}</span>
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

        </div>
      )}
    </div>
  );
};
