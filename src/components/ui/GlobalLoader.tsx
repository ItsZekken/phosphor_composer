import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { melodyPredictor } from '../../magenta/melodyPredictor';
import { Play, Loader2, Music, Sparkles, Volume2 } from 'lucide-react';

export const GlobalLoader: React.FC = () => {
  const isAudioLoading = useSongStore(state => state.isAudioLoading);
  const isEngineReady = useSongStore(state => state.isEngineReady);
  const setIsAudioLoading = useSongStore(state => state.setIsAudioLoading);
  const setIsEngineReady = useSongStore(state => state.setIsEngineReady);
  const instrumentType = useSongStore(state => state.instrumentType);

  const [isInitializing, setIsInitializing] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('Iniciando...');

  const handleStartStudio = async () => {
    setIsInitializing(true);
    setIsAudioLoading(true);

    try {
      setLoadingStep('Activando Web Audio API...');
      await toneEngine.init();

      if (instrumentType === 'piano') {
        setLoadingStep('Cargando muestras de piano optimizadas...');
        await toneEngine.setInstrument('piano');
      } else {
        setLoadingStep('Inicializando sintetizadores virtuales...');
      }

      setLoadingStep('Inicializando modelo IA MelodyRNN (Magenta)...');
      await melodyPredictor.init();

      setLoadingStep('¡Estudio preparado!');
    } catch (e) {
      console.error('Error al inicializar el estudio:', e);
    } finally {
      setIsEngineReady(true);
      setIsAudioLoading(false);
      setIsInitializing(false);
    }
  };

  // Si el estudio está listo y no hay carga activa en segundo plano, ocultar overlay
  if (isEngineReady && !isAudioLoading) {
    return null;
  }

  return (
    <div className="global-loader-backdrop">
      <div className="global-loader-card">
        {/* Encabezado Logo Retro */}
        <div className="loader-logo-badge">
          <Music size={28} className="logo-icon" />
          <span className="logo-title">PHOSPHOR</span>
          <span className="logo-tag">DAW v2.0</span>
        </div>

        {!isEngineReady && !isInitializing ? (
          /* PANTALLA INICIAL DE BIENVENIDA / CLICK TO START */
          <div className="loader-start-content">
            <h2>Estudio de Composición Armónica</h2>
            <p className="loader-subtitle">
              Sintetizador Virtual & Acompañamiento Inteligente por IA
            </p>

            <div className="loader-features-grid">
              <div className="feature-chip">
                <Volume2 size={16} />
                <span>Audio HQ 24-bit</span>
              </div>
              <div className="feature-chip">
                <Sparkles size={16} />
                <span>Asistente IA Magenta</span>
              </div>
            </div>

            <button
              type="button"
              className="loader-start-btn"
              onClick={handleStartStudio}
            >
              <Play size={20} fill="currentColor" />
              <span>INICIAR ESTUDIO DE AUDIO</span>
            </button>

            <span className="loader-note">
              Haz clic para activar el motor de audio e inicializar los sintetizadores.
            </span>
          </div>
        ) : (
          /* PANTALLA DE CARGA / INICIALIZACIÓN */
          <div className="loader-progress-content">
            <div className="spinner-container">
              <Loader2 size={48} className="loader-spinner-icon" />
              <div className="equalizer-bars">
                <span className="bar bar-1" />
                <span className="bar bar-2" />
                <span className="bar bar-3" />
                <span className="bar bar-4" />
              </div>
            </div>

            <div className="loader-status-block">
              <h3>{isInitializing ? 'Inicializando Estudio' : 'Cargando Recurso'}</h3>
              <p className="step-text">
                {isInitializing ? loadingStep : 'Cargando muestras de instrumentos...'}
              </p>
            </div>

            <div className="loader-progress-bar-track">
              <div className="loader-progress-bar-fill" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
