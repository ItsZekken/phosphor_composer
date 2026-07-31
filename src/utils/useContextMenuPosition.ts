import { useState, useLayoutEffect, useRef } from 'react';

interface Position {
  x: number;
  y: number;
}

/**
 * Hook para posicionar menús contextuales o popovers garantizando que permanezcan
 * completamente dentro de los límites visibles de la pantalla (viewport).
 */
export function useContextMenuPosition(x: number, y: number) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position>({ x, y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const clampPosition = () => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const margin = 12; // Margen de seguridad respecto a los bordes de la ventana

      let clampedX = x;
      let clampedY = y;

      // Adaptación al límite derecho
      if (clampedX + rect.width > vw - margin) {
        clampedX = Math.max(margin, vw - rect.width - margin);
      }
      // Adaptación al límite izquierdo
      if (clampedX < margin) {
        clampedX = margin;
      }

      // Adaptación al límite inferior
      if (clampedY + rect.height > vh - margin) {
        clampedY = Math.max(margin, vh - rect.height - margin);
      }
      // Adaptación al límite superior
      if (clampedY < margin) {
        clampedY = margin;
      }

      setPos({ x: clampedX, y: clampedY });
    };

    clampPosition();

    // Reajustar en caso de cambio de tamaño del elemento o de la ventana
    const resizeObserver = new ResizeObserver(clampPosition);
    resizeObserver.observe(el);
    window.addEventListener('resize', clampPosition);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', clampPosition);
    };
  }, [x, y]);

  return {
    menuRef,
    style: {
      position: 'fixed' as const,
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      zIndex: 9999
    }
  };
}
