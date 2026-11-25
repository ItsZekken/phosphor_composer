import React from 'react';

interface MetronomeIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Ícono técnico minimalista de Metrónomo compatible con el trazo de Lucide React.
 */
export const MetronomeIcon: React.FC<MetronomeIconProps> = ({
  size = 16,
  className,
  style
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
    aria-hidden="true"
  >
    {/* Cuerpo trapezoidal */}
    <path d="M6.5 20L9.5 4h5l3 16" />
    {/* Base */}
    <path d="M4.5 20h15" />
    {/* Escala interior */}
    <path d="M9.8 14.5h4.4" />
    {/* Varilla del péndulo */}
    <path d="M12 17L17.5 6.2" />
    {/* Pesa deslizante del péndulo */}
    <circle cx="15.3" cy="10.4" r="1.35" fill="currentColor" stroke="none" />
  </svg>
);
