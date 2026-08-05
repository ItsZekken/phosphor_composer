import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export interface CustomSelectProps {
  value: string;
  options: SelectOption[];
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
  onChange, 
  disabled, 
  className = '', 
  style, 
  labelPrefix, 
  renderButton
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectedOption = options.find(o => o.value === value) || { value, label: value };

  return (
    <div ref={containerRef} className={`custom-select-container ${className}`} style={{ position: 'relative', ...style }}>
      {renderButton ? renderButton(selectedOption) : (
        <button
          className={`custom-select-btn ${isOpen ? 'active' : ''}`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
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
        <div className="style-popover-panel" style={{ width: 'max-content', minWidth: '100%', position: 'absolute', zIndex: 1000, top: '100%', left: 0, marginTop: '4px', padding: '4px' }}>
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
        </div>
      )}
    </div>
  );
};
