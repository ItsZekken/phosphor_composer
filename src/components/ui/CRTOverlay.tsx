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
      {/* Filtro SVG CRT de deformación analógica y difuminado de fósforo */}
      <svg width="100%" height="100%" style={{ position: 'absolute', pointerEvents: 'none', top: 0, left: 0, zIndex: -1000, opacity: 0 }}>
        <defs>
          {/* Mapa de gradiente radial perfectamente simétrico para simular curvatura esférica de barril */}
          <radialGradient id="spherical-map" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#808080" /> {/* Gris neutro en el centro: sin distorsión */}
            <stop offset="100%" stopColor="#000000" /> {/* Negro en los bordes: distorsión radial máxima */}
          </radialGradient>

          <filter id="crt-barrel" x="-2%" y="-2%" width="104%" height="104%">
            {/* Carga del mapa de desplazamiento esférico simétrico */}
            <feImage href="#displacement-source" result="map" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={crtParams.curvature * 1.5}
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            {/* Bloom / phosphor glow de fósforo */}
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation={crtParams.svgBlur}
              result="blur"
            />
            <feBlend
              in="displaced"
              in2="blur"
              mode="screen"
              result="bloomed"
            />
            <feComposite in="bloomed" in2="SourceGraphic" operator="over" />
          </filter>
        </defs>
        {/* Elemento de origen que feImage cargará como textura de desplazamiento */}
        <rect id="displacement-source" width="100%" height="100%" fill="url(#spherical-map)" />
      </svg>

      {/* Capas físicas del monitor simulado */}
      <div id="crt-scanlines" />
      <div id="crt-phosphor" />
      <div id="crt-vignette" />
      <div id="crt-noise" />
    </>
  );
};
