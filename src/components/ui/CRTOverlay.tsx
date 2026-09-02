import { useEffect } from 'react';
import { useSongStore } from '../../store/songStore';

export const CRTOverlay = () => {
  const isCrtEnabled = useSongStore(state => state.isCrtEnabled);
  const crtParams = useSongStore(state => state.crtParams);

  useEffect(() => {
    const root = document.documentElement;
    if (isCrtEnabled) {
      root.style.setProperty('--crt-scanline-opacity', String(crtParams.scanlineOpacity));
      root.style.setProperty('--crt-scanline-size', `${crtParams.scanlineSize}px`);
      root.style.setProperty('--crt-aberration', `${crtParams.aberration}px`);
      root.style.setProperty('--crt-bloom', String(crtParams.bloom));
      root.style.setProperty('--crt-svg-blur', `${crtParams.svgBlur}px`);
      root.style.setProperty('--crt-phosphor-hue', String(crtParams.phosphorHue));
      root.style.setProperty('--crt-phosphor-sat', `${crtParams.phosphorSat}%`);
      root.style.setProperty('--crt-tint-strength', String(crtParams.tintStrength));
      root.style.setProperty('--crt-noise', String(crtParams.noise));
      root.style.setProperty('--crt-flicker', String(crtParams.flicker));
      root.style.setProperty('--crt-vignette', String(crtParams.vignette));
      root.style.setProperty('--crt-brightness', String(crtParams.brightness));
      root.style.setProperty('--crt-contrast', String(crtParams.contrast));
      root.style.setProperty('--crt-saturation', String(crtParams.saturation));
    } else {
      // Limpiar o resetear variables si se desactiva para no contaminar
      root.style.setProperty('--crt-scanline-opacity', '0');
      root.style.setProperty('--crt-aberration', '0px');
      root.style.setProperty('--crt-noise', '0');
      root.style.setProperty('--crt-flicker', '0');
      root.style.setProperty('--crt-tint-strength', '0');
      root.style.setProperty('--crt-vignette', '0');
      root.style.setProperty('--crt-brightness', '1');
      root.style.setProperty('--crt-contrast', '1');
      root.style.setProperty('--crt-saturation', '1');
    }
  }, [isCrtEnabled, crtParams]);

  if (!isCrtEnabled) return null;

  return (
    <>
      {/* Capas físicas de monitor CRT vintage aceleradas por GPU */}
      <div id="crt-scanlines" />
      <div id="crt-phosphor" />
      <div id="crt-vignette" />
      <div id="crt-glass-reflection" />
      <div id="crt-noise" />
    </>
  );
};
