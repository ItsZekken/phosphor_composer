import React, { useEffect, useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { PhosphorLogo } from './PhosphorLogo';

export const GlobalLoader: React.FC = () => {
  // 'closed': pantalla en negro con logo en el centro
  // 'opening': división horizontal que se abre hacia arriba y hacia abajo
  // 'hidden': componente desmontado
  const [bootPhase, setBootPhase] = useState<'closed' | 'opening' | 'hidden'>('closed');

  const openCurtain = React.useCallback(() => {
    setBootPhase((prev) => {
      if (prev === 'hidden' || prev === 'opening') return prev;
      return 'opening';
    });

    setTimeout(() => {
      const state = useSongStore.getState();
      state.setIsEngineReady(true);
      state.setIsAudioLoading(false);
      setBootPhase('hidden');
    }, 550);
  }, []);

  useEffect(() => {
    let didOpen = false;

    const triggerOpen = () => {
      if (didOpen) return;
      didOpen = true;
      openCurtain();
    };

    // Temporizador de seguridad infranqueable: La cortina DEBE abrirse en máximo 1.5s
    const fallbackTimer = window.setTimeout(() => {
      triggerOpen();
    }, 1500);

    const autoBoot = async () => {
      try {
        await toneEngine.init();

        // Pre-cargar samples con timeout defensivo para que nada bloquee la apertura
        await Promise.race([
          toneEngine.preloadProjectAudio(),
          new Promise(r => setTimeout(r, 800))
        ]);

        await new Promise(r => setTimeout(r, 200));
        triggerOpen();
      } catch (e) {
        console.warn('Auto-boot advertencia (audio continuará bajo demanda):', e);
        triggerOpen();
      } finally {
        clearTimeout(fallbackTimer);
      }
    };

    autoBoot();

    return () => {
      clearTimeout(fallbackTimer);
    };
  }, [openCurtain]);

  if (bootPhase === 'hidden') {
    return null;
  }

  const isOpening = bootPhase === 'opening';

  return (
    <div
      className="global-curtain-container"
      onClick={() => {
        toneEngine.init().catch(() => {});
        openCurtain();
      }}
      role="button"
      tabIndex={0}
      title="Haz clic para entrar a Phosphor"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        pointerEvents: isOpening ? 'none' : 'all',
        cursor: isOpening ? 'default' : 'pointer',
        overflow: 'hidden'
      }}
    >
      {/* Panel Superior Negro: Se abre hacia arriba desde el centro */}
      <div
        className="curtain-top"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '50vh',
          backgroundColor: '#07050a',
          transform: isOpening ? 'translateY(-100%)' : 'translateY(0%)',
          transition: 'transform 0.5s cubic-bezier(0.77, 0, 0.175, 1)',
          borderBottom: '1px solid rgba(134, 59, 255, 0.15)'
        }}
      />

      {/* Panel Inferior Negro: Se abre hacia abajo desde el centro */}
      <div
        className="curtain-bottom"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '50vh',
          backgroundColor: '#07050a',
          transform: isOpening ? 'translateY(100%)' : 'translateY(0%)',
          transition: 'transform 0.5s cubic-bezier(0.77, 0, 0.175, 1)',
          borderTop: '1px solid rgba(134, 59, 255, 0.15)'
        }}
      />

      {/* Logo Central: Aparece en negro y se desvanece suavemente al abrirse */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${isOpening ? 1.15 : 1})`,
          opacity: isOpening ? 0 : 1,
          transition: 'opacity 0.4s ease-out, transform 0.45s ease-out',
          zIndex: 100000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}
      >
        <PhosphorLogo size={76} animated />

        {/* Halo de neón giratorio */}
        <div
          style={{
            position: 'absolute',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            border: '2px solid transparent',
            borderTopColor: '#00e5ff',
            borderRightColor: '#863bff',
            animation: 'spin 0.9s linear infinite',
            filter: 'drop-shadow(0 0 10px rgba(0, 229, 255, 0.4))'
          }}
        />
      </div>
    </div>
  );
};
