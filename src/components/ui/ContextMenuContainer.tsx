import React from 'react';
import { useContextMenuPosition } from '../../utils/useContextMenuPosition';

interface ContextMenuContainerProps {
  x: number;
  y: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * Contenedor genérico para menús contextuales adaptativo a los bordes del viewport.
 */
export const ContextMenuContainer: React.FC<ContextMenuContainerProps> = ({
  x,
  y,
  children,
  className = 'custom-context-menu',
  style = {},
  onClick
}) => {
  const { menuRef, style: boundedStyle } = useContextMenuPosition(x, y);

  return (
    <div
      ref={menuRef}
      className={className}
      style={{
        ...boundedStyle,
        ...style
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      {children}
    </div>
  );
};
