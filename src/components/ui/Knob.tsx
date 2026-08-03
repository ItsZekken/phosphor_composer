import React, { useRef, useState, useEffect, useCallback } from 'react';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  onDoubleClick?: () => void;
  size?: number;
  label?: string;
}

export const Knob: React.FC<KnobProps> = ({ 
  value, 
  min, 
  max, 
  onChange, 
  onDoubleClick,
  size = 32,
  label
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const percentage = (value - min) / (max - min);
  // Rotación: de -135deg a 135deg (270 grados totales)
  const rotation = -135 + (percentage * 270);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startY.current = e.clientY;
    startValue.current = value;
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    const deltaY = startY.current - e.clientY;
    // Sensibilidad: 100px para ir de min a max
    const deltaValue = (deltaY / 100) * (max - min);
    
    let newValue = startValue.current + deltaValue;
    newValue = Math.max(min, Math.min(max, newValue));
    onChange(newValue);
  }, [isDragging, min, max, onChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="knob-container" onDoubleClick={onDoubleClick}>
      <div 
        className={`knob-body ${isDragging ? 'dragging' : ''}`}
        style={{ width: size, height: size }}
        onMouseDown={handleMouseDown}
      >
        <div 
          className="knob-indicator"
          style={{ transform: `rotate(${rotation}deg)` }}
        />
      </div>
      {label && <div className="knob-label">{label}</div>}
    </div>
  );
};
