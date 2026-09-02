/**
 * RotaryKnob.tsx
 * Perilla rotatoria analógica de alta precisión para sintetizadores y mezcladores.
 * Soporta arrastre vertical continuo, modo fino (Shift), doble clic para reset,
 * arco SVG con iluminación phosphor y visualización de unidades.
 * 
 * Optimizado para máximo rendimiento:
 * - Listeners de ventana adjuntados ÚNICAMENTE durante el arrastre activo (0 overhead en reposo).
 * - Referencias estables con useRef para evitar reciclar listeners en cada frame.
 * - Memorizado con React.memo.
 */

import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';

interface RotaryKnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (val: number) => void;
  size?: number;
  label?: string;
  unit?: string;
  displayValue?: string | number;
  accentColor?: string;
  disabled?: boolean;
  logScale?: boolean;
}

const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad)
  };
};

const describeArc = (x: number, y: number, r: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(x, y, r, endAngle);
  const end = polarToCartesian(x, y, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return ['M', start.x, start.y, 'A', r, r, 0, largeArcFlag, 0, end.x, end.y].join(' ');
};

const RotaryKnobComponent: React.FC<RotaryKnobProps> = ({
  value,
  min,
  max,
  step = 1,
  defaultValue,
  onChange,
  size = 40,
  label,
  unit = '',
  displayValue,
  accentColor = '#00e5ff',
  disabled = false,
  logScale = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const valueRef = useRef(value);
  valueRef.current = value;

  // Conversión lineal / logarítmica para porcentaje (0 a 1)
  const valueToNorm = useCallback(
    (v: number): number => {
      const clamped = Math.max(min, Math.min(max, v));
      if (logScale && min > 0) {
        return Math.log(clamped / min) / Math.log(max / min);
      }
      return (clamped - min) / (max - min);
    },
    [min, max, logScale]
  );

  const normToValue = useCallback(
    (norm: number): number => {
      const clampedNorm = Math.max(0, Math.min(1, norm));
      if (logScale && min > 0) {
        return min * Math.pow(max / min, clampedNorm);
      }
      return min + clampedNorm * (max - min);
    },
    [min, max, logScale]
  );

  const norm = valueToNorm(value);

  // Ángulo de rotación: de -135° a +135° (270° totales)
  const angle = -135 + norm * 270;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    setIsDragging(true);

    const startY = e.clientY;
    const startVal = valueRef.current;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const sensitivity = moveEvent.shiftKey ? 400 : 120; // Shift = ajuste fino
      const deltaNorm = deltaY / sensitivity;

      const currentNorm = valueToNorm(startVal);
      const newNorm = Math.max(0, Math.min(1, currentNorm + deltaNorm));
      let rawVal = normToValue(newNorm);

      if (step > 0) {
        rawVal = Math.round(rawVal / step) * step;
      }
      rawVal = Math.max(min, Math.min(max, rawVal));
      onChangeRef.current(rawVal);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseup', onMouseUp, { passive: true });
  }, [disabled, min, max, step, valueToNorm, normToValue]);

  const handleDoubleClick = useCallback(() => {
    if (disabled) return;
    if (defaultValue !== undefined) {
      onChangeRef.current(defaultValue);
    } else {
      onChangeRef.current(min + (max - min) * 0.5);
    }
  }, [disabled, defaultValue, min, max]);

  // Cálculo del arco SVG memorizado
  const strokeWidth = 3;
  const radius = (size - strokeWidth * 2) / 2;
  const center = size / 2;

  const bgArcD = useMemo(() => describeArc(center, center, radius, -135, 135), [center, radius]);
  const activeArcD = useMemo(() => {
    return norm > 0.005 ? describeArc(center, center, radius, -135, -135 + norm * 270) : '';
  }, [center, radius, norm]);

  const formattedDisplay =
    displayValue !== undefined
      ? displayValue
      : step < 1
      ? value.toFixed(step < 0.01 ? 3 : 1)
      : Math.round(value);

  return (
    <div
      className={`rotary-knob-container ${disabled ? 'knob-disabled' : ''} ${isDragging ? 'dragging' : ''}`}
      onDoubleClick={handleDoubleClick}
      title={`${label || ''}: ${formattedDisplay}${unit} (Doble clic para reiniciar)`}
    >
      <div
        className="rotary-knob-graphic"
        style={{ width: size, height: size }}
        onMouseDown={handleMouseDown}
      >
        <svg width={size} height={size} className="rotary-knob-svg">
          {/* Arco de fondo */}
          <path
            d={bgArcD}
            fill="none"
            stroke="rgba(255, 255, 255, 0.12)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {/* Arco activo luminoso */}
          {activeArcD && (
            <path
              d={activeArcD}
              fill="none"
              stroke={accentColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              style={{
                filter: isDragging ? `drop-shadow(0 0 4px ${accentColor})` : `drop-shadow(0 0 2px ${accentColor}88)`
              }}
            />
          )}
        </svg>

        {/* Cuerpo del botón rotatorio */}
        <div
          className="rotary-knob-dial"
          style={{
            width: size - 10,
            height: size - 10,
            transform: `translate(-50%, -50%) rotate(${angle}deg)`
          }}
        >
          <div className="rotary-knob-dot" style={{ backgroundColor: accentColor }} />
        </div>
      </div>

      {label && <span className="rotary-knob-label">{label}</span>}
      <span className="rotary-knob-val" style={{ color: accentColor }}>
        {formattedDisplay}
        {unit && <span className="rotary-knob-unit">{unit}</span>}
      </span>
    </div>
  );
};

export const RotaryKnob = React.memo(RotaryKnobComponent);
