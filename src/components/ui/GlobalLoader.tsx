import React, { useEffect, useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { melodyPredictor } from '../../magenta/melodyPredictor';
import { PhosphorLogo } from './PhosphorLogo';

export const GlobalLoader: React.FC = () => {
  const setIsEngineReady = useSongStore(state => state.setIsEngineReady);
  const setIsAudioLoading = useSongStore(state => state.setIsAudioLoading);
  const instrumentType = useSongStore(state => state.instrumentType);

  const [bootPhase, setBootPhase] = useState<'warmup' | 'calibrating' | 'ready' | 'hidden'>('warmup');

  useEffect(() => {
    let isMounted = true;

    const autoBoot = async () => {
      // Fase 1: CRT Warmup (Línea de fósforo horizontal)
      await new Promise(r => setTimeout(r, 180));
      if (!isMounted) return;

      setBootPhase('calibrating');

      try {
        await toneEngine.init();
        if (!isMounted) return;

        if (instrumentType === 'piano') {
          await toneEngine.setInstrument('piano');
        }

        await melodyPredictor.init();

        if (!isMounted) return;
        setBootPhase('ready');

        // Fase 3: Fade out suave a la interfaz
        setTimeout(() => {
          if (!isMounted) return;
          setIsEngineReady(true);
          setIsAudioLoading(false);
          setBootPhase('hidden');
        }, 350);

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

  return (
    <div
      className={`global-crt-loader-overlay ${bootPhase}`}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#0a080e',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s ease',
        opacity: bootPhase === 'ready' ? 0 : 1,
        pointerEvents: bootPhase === 'ready' ? 'none' : 'all'
      }}
    >
      {/* Rayo central de encendido CRT */}
      <div
        className="crt-power-beam"
        style={{
          position: 'absolute',
          width: bootPhase === 'warmup' ? '100vw' : '0px',
          height: bootPhase === 'warmup' ? '2px' : '0px',
          background: '#00e5ff',
          boxShadow: '0 0 20px #00e5ff, 0 0 40px #863bff',
          transition: 'all 0.22s ease-out'
        }}
      />

      {/* Solo el Logo con halo de neón y giro suave */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: bootPhase === 'warmup' ? 'scale(0.8)' : 'scale(1)',
          opacity: bootPhase === 'warmup' ? 0 : 1,
          transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        <PhosphorLogo size={72} animated />
        
        {/* Anillo de giro de neón sutil */}
        <div
          style={{
            position: 'absolute',
            width: '96px',
            height: '96px',
            borderRadius: '50%',
            border: '2px solid transparent',
            borderTopColor: '#00e5ff',
            borderRightColor: '#863bff',
            animation: 'spin 0.9s linear infinite',
            filter: 'drop-shadow(0 0 8px rgba(0, 229, 255, 0.5))'
          }}
        />
      </div>
    </div>
  );
};
