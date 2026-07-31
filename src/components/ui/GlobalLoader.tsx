import React from 'react';
import { useSongStore } from '../../store/songStore';
import { Loader2 } from 'lucide-react';

export const GlobalLoader: React.FC = () => {
  const isAudioLoading = useSongStore(state => state.isAudioLoading);

  if (!isAudioLoading) return null;

  return (
    <div className="global-loader-overlay">
      <div className="global-loader-content">
        <Loader2 className="loader-spinner" size={54} />
        <div className="loader-text-container">
          <h2>Inicializando</h2>
          <p>Cargando motor de audio y modelos de IA...</p>
        </div>
      </div>
    </div>
  );
};
