import { useEffect } from 'react';

interface UseTimelineNavigationOptions {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  baseBeatWidth: number;
  zoomLevel: number;
  minZoom: number;
  maxZoom: number;
  onZoomChange: (nextZoom: number) => void;
  onScrollChange?: (nextScrollLeft: number) => void;
  enableMiddleClickPan?: boolean;
}

/**
 * Navegación unificada para líneas de tiempo horizontales:
 * - Ctrl/Cmd + Rueda o Alt + Rueda: Zoom horizontal anclado al cursor.
 * - Shift + Rueda: Scroll horizontal fluido.
 * - Click central (Middle Button) arrastrar: Paneo libre de la vista.
 */
export function useTimelineNavigation({
  viewportRef,
  baseBeatWidth,
  zoomLevel,
  minZoom,
  maxZoom,
  onZoomChange,
  onScrollChange,
  enableMiddleClickPan = true
}: UseTimelineNavigationOptions) {
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        const rect = el.getBoundingClientRect();
        const pointerX = Math.max(0, e.clientX - rect.left);
        const currentPxPerBeat = Math.max(1, baseBeatWidth * zoomLevel);
        const anchorBeat = (el.scrollLeft + pointerX) / currentPxPerBeat;

        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const rawNext = parseFloat((zoomLevel * factor).toFixed(3));
        const nextZoom = Math.max(minZoom, Math.min(maxZoom, rawNext));

        if (nextZoom !== zoomLevel) {
          onZoomChange(nextZoom);
          const nextPxPerBeat = Math.max(1, baseBeatWidth * nextZoom);
          const nextScrollLeft = Math.max(0, anchorBeat * nextPxPerBeat - pointerX);
          requestAnimationFrame(() => {
            if (!viewportRef.current) return;
            viewportRef.current.scrollLeft = nextScrollLeft;
            onScrollChange?.(viewportRef.current.scrollLeft);
          });
        }
      } else if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft = Math.max(0, el.scrollLeft + e.deltaY);
        onScrollChange?.(el.scrollLeft);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [viewportRef, baseBeatWidth, zoomLevel, minZoom, maxZoom, onZoomChange, onScrollChange]);

  useEffect(() => {
    if (!enableMiddleClickPan) return;
    const el = viewportRef.current;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startScrollLeft = el.scrollLeft;
      const startScrollTop = el.scrollTop;
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = 'grabbing';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        el.scrollLeft = Math.max(0, startScrollLeft - dx);
        el.scrollTop = Math.max(0, startScrollTop - dy);
        onScrollChange?.(el.scrollLeft);
      };

      const handleMouseUp = () => {
        document.body.style.cursor = prevCursor;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    };

    el.addEventListener('mousedown', handleMouseDown);
    return () => {
      el.removeEventListener('mousedown', handleMouseDown);
    };
  }, [viewportRef, enableMiddleClickPan, onScrollChange]);
}
