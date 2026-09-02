import React from 'react';

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
  return (
    <div className={`unified-toolbar-chassis ${className}`} style={style}>
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
