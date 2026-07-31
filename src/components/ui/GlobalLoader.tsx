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

  const [loadingStep, setLoadingStep] = useState<string>('Iniciando...');

  const handleStartStudio = async () => {
    setIsAudioLoading(true);
    try {
      setLoadingStep('Activando Web Audio API...');
      await toneEngine.init();

      setLoadingStep('Cargando muestras de piano de alta calidad...');
      await toneEngine.setInstrument(instrumentType);

      setLoadingStep('Inicializando modelo IA MelodyRNN (Magenta)...');
      await melodyPredictor.init();

      setLoadingStep('¡Todo listo!');
      setIsEngineReady(true);
    } catch (e) {
      console.error('Error al inicializar el estudio:', e);
      setIsEngineReady(true); // Permitir entrada en caso de fallo parcial
    } finally {
      setIsAudioLoading(false);
    }
  };

  // Si el motor ya está listo y no hay nada cargando, no mostrar overlay
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

        {!isEngineReady && !isAudioLoading ? (
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
              <h3>Cargando Estudio</h3>
              <p className="step-text">{loadingStep || 'Preparando sintetizadores...'}</p>
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
