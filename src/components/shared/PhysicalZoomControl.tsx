import React from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface PhysicalZoomControlProps {
  zoomLevel: number;
  onZoomChange?: (newZoom: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
  style?: React.CSSProperties;
}

export const PhysicalZoomControl: React.FC<PhysicalZoomControlProps> = ({
  zoomLevel,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  minZoom = 0.4,
  maxZoom = 3.0,
  step = 0.15,
  style
}) => {
  const handleZoomOut = () => {
    if (onZoomOut) {
      onZoomOut();
    } else if (onZoomChange) {
      onZoomChange(Math.max(minZoom, parseFloat((zoomLevel - step).toFixed(2))));
    }
  };

  const handleZoomIn = () => {
    if (onZoomIn) {
      onZoomIn();
    } else if (onZoomChange) {
      onZoomChange(Math.min(maxZoom, parseFloat((zoomLevel + step).toFixed(2))));
    }
  };

  const handleReset = () => {
    if (onResetZoom) {
      onResetZoom();
    } else if (onZoomChange) {
      onZoomChange(1.0);
    }
  };

  return (
    <div className="physical-zoom-group" style={style}>
      <button
        type="button"
        className="physical-btn zoom-btn"
        title="Reducir Zoom (Alt + Rueda Abajo)"
        onClick={handleZoomOut}
      >
        <ZoomOut size={13} />
      </button>
      <span
        className="physical-zoom-readout"
        title="Hacer clic para restablecer zoom al 100%"
        onClick={handleReset}
      >
        {Math.round(zoomLevel * 100)}%
      </span>
      <button
        type="button"
        className="physical-btn zoom-btn"
        title="Aumentar Zoom (Alt + Rueda Arriba)"
        onClick={handleZoomIn}
      >
        <ZoomIn size={13} />
      </button>
    </div>
  );
};
