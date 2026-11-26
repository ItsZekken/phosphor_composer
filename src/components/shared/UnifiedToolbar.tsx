import React, { useRef, useCallback } from 'react';

interface UnifiedToolbarProps {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const UnifiedToolbar: React.FC<UnifiedToolbarProps> = ({
  left,
  center,
  right,
  children,
  className = '',
  style
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  }, []);

  return (
    <div
      ref={scrollRef}
      className={`unified-toolbar-chassis ${className}`}
      style={style}
      onWheel={handleWheel}
    >
      {children ? (
        children
      ) : (
        <>
          <div className="toolbar-zone zone-left">
            {left}
          </div>
          <div className="toolbar-zone zone-center">
            {center}
          </div>
          <div className="toolbar-zone zone-right">
            {right}
          </div>
        </>
      )}
    </div>
  );
};
