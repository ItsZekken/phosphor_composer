import React, { useEffect, useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { PhosphorLogo } from './PhosphorLogo';

export const GlobalLoader: React.FC = () => {
  const setIsEngineReady = useSongStore(state => state.setIsEngineReady);
  const setIsAudioLoading = useSongStore(state => state.setIsAudioLoading);
  const instrumentType = useSongStore(state => state.instrumentType);

  // 'closed': pantalla en negro con logo en el centro
  // 'opening': división horizontal que se abre hacia arriba y hacia abajo
  // 'hidden': componente desmontado
  const [bootPhase, setBootPhase] = useState<'closed' | 'opening' | 'hidden'>('closed');

  useEffect(() => {
    let isMounted = true;

    const autoBoot = async () => {
      try {
        // Inicializar audio y pre-cargar todos los samples (batería, piano y nodos de mezcla)
        await toneEngine.init();
        if (!isMounted) return;

        await toneEngine.preloadProjectAudio();
        if (!isMounted) return;

        // Breve pausa para contemplar el logo antes de abrir la cortina
        await new Promise(r => setTimeout(r, 300));
        if (!isMounted) return;

        // Iniciar apertura horizontal desde el centro hacia arriba y abajo
        setBootPhase('opening');

        // Al terminar la animación de apertura, desbloquear la app
        setTimeout(() => {
          if (!isMounted) return;
          setIsEngineReady(true);
          setIsAudioLoading(false);
          setBootPhase('hidden');
        }, 550);

      } catch (e) {
        console.warn('Auto-boot advertencia (audio continuará bajo demanda):', e);
        if (isMounted) {
          setIsEngineReady(true);
          setIsAudioLoading(false);
          setBootPhase('hidden');
        }
      }
    };

    autoBoot();

    return () => {
      isMounted = false;
    };
  }, [instrumentType, setIsAudioLoading, setIsEngineReady]);

  if (bootPhase === 'hidden') {
    return null;
  }

  const isOpening = bootPhase === 'opening';

  return (
    <div
      className="global-curtain-container"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        pointerEvents: isOpening ? 'none' : 'all',
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
