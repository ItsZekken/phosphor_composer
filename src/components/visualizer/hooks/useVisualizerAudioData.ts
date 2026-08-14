import { useRef, useEffect } from 'react';
import { toneEngine } from '../../../audio/toneEngine';

export interface VisualizerAudioFrame {
  waveform: Float32Array;
  frequency: Float32Array;
  masterLevel: number; // dB normalized 0..1
  channelLevels: Record<string, number>; // channelId -> normalized 0..1
}

/**
 * Hook de alto rendimiento para captura de datos de audio a 60 FPS sin provocar re-renders en React.
 * Permite a los visualizadores basados en Canvas consumir la trama más reciente en su bucle RAF.
 */
export function useVisualizerAudioData() {
  const frameRef = useRef<VisualizerAudioFrame>({
    waveform: new Float32Array(512),
    frequency: new Float32Array(64),
    masterLevel: 0,
    channelLevels: {}
  });

  const smoothChannelLevels = useRef<Record<string, number>>({});

  useEffect(() => {
    let animId: number;

    const sample = () => {
      const waveform = toneEngine.getWaveformData();
      const frequency = toneEngine.getFrequencyData();

      // Muestrear nivel del master
      const masterDb = toneEngine.getChannelMeterLevel('master');
      // Convertir dB (-60 a 0) a 0..1 lineal aproximado
      const masterNorm = masterDb === -Infinity ? 0 : Math.max(0, Math.min(1, (masterDb + 60) / 60));

      frameRef.current.waveform = waveform;
      frameRef.current.frequency = frequency;
      frameRef.current.masterLevel = masterNorm;

      animId = requestAnimationFrame(sample);
    };

    animId = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(animId);
  }, []);

  const getChannelLevelSmooth = (channelId: string): number => {
    const rawDb = toneEngine.getChannelMeterLevel(channelId);
    const targetNorm = rawDb === -Infinity ? 0 : Math.max(0, Math.min(1, (rawDb + 60) / 60));
    
    const prev = smoothChannelLevels.current[channelId] || 0;
    // Ataque rápido, caída suave
    const next = targetNorm > prev 
      ? targetNorm 
      : prev * 0.88;

    smoothChannelLevels.current[channelId] = next < 0.005 ? 0 : next;
    return smoothChannelLevels.current[channelId];
  };

  return {
    getAudioFrame: () => frameRef.current,
    getChannelLevelSmooth
  };
}
