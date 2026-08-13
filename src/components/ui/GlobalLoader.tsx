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
  const [statusText, setStatusText] = useState<string>('INICIANDO ENTORNO ANALÓGICO...');

  useEffect(() => {
    let isMounted = true;

    const autoBoot = async () => {
      // Fase 1: CRT Warmup (Línea de fósforo expandiéndose)
      await new Promise(r => setTimeout(r, 200));
      if (!isMounted) return;

      setBootPhase('calibrating');
      setStatusText('ACTIVANDO WEB AUDIO API...');

      try {
        await toneEngine.init();
        if (!isMounted) return;

        if (instrumentType === 'piano') {
          setStatusText('CARGANDO BANCO DE PIANO...');
          await toneEngine.setInstrument('piano');
        } else {
          setStatusText('CALIBRANDO SINTETIZADORES ANALÓGICOS...');
        }

        setStatusText('INICIALIZANDO MOTOR IA (MAGENTA)...');
        await melodyPredictor.init();

        if (!isMounted) return;
        setStatusText('// ESTUDIO PHOSPHOR NOMINAL //');
        setBootPhase('ready');

        // Fase 3: Fade out suave a la interfaz
        setTimeout(() => {
          if (!isMounted) return;
          setIsEngineReady(true);
          setIsAudioLoading(false);
          setBootPhase('hidden');
        }, 400);

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
          transition: 'all 0.25s ease-out'
        }}
      />

      {/* Contenedor central del Logo y Estado */}
      <div
        className="crt-boot-card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          padding: '24px 32px',
          borderRadius: '12px',
          background: 'rgba(26, 22, 34, 0.95)',
          border: '1px solid rgba(134, 59, 255, 0.3)',
          boxShadow: '0 0 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(134, 59, 255, 0.2)',
          transform: bootPhase === 'warmup' ? 'scale(0.85)' : 'scale(1)',
          opacity: bootPhase === 'warmup' ? 0.2 : 1,
          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Logo Prisma con resplandor */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PhosphorLogo size={60} animated />
          {/* Anillo de giro de neón */}
          <div
            style={{
              position: 'absolute',
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              border: '2px solid transparent',
              borderTopColor: '#00e5ff',
              borderRightColor: '#863bff',
              animation: 'spin 1s linear infinite'
            }}
          />
        </div>

        {/* Título de Marca */}
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontFamily: '"VT323", monospace',
              fontSize: '2.4rem',
              color: '#5a9e7a',
              letterSpacing: '0.1em',
              margin: 0,
              textShadow: '0 0 8px rgba(90, 158, 122, 0.8), 0 0 16px rgba(90, 158, 122, 0.4)'
            }}
          >
            PHOSPHOR
          </h1>
          <span
            style={{
              fontFamily: '"Share Tech Mono", monospace',
              fontSize: '0.75rem',
              color: '#8c84a0',
              letterSpacing: '0.15em',
              textTransform: 'uppercase'
            }}
          >
            PLAYGROUND DE COMPOSICIÓN RÁPIDA
          </span>
        </div>

        {/* Barra de progreso de fósforo */}
        <div
          style={{
            width: '240px',
            height: '4px',
            backgroundColor: '#120e18',
            borderRadius: '2px',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            position: 'relative'
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(90deg, #5a9e7a, #00e5ff, #863bff)',
              animation: 'progress-glow 1.2s infinite alternate ease-in-out'
            }}
          />
        </div>

        {/* Línea de estado del sistema */}
        <span
          style={{
            fontFamily: '"Share Tech Mono", monospace',
            fontSize: '0.7rem',
            color: '#00e5ff',
            letterSpacing: '0.05em'
          }}
        >
          {statusText}
        </span>
      </div>
    </div>
  );
};
