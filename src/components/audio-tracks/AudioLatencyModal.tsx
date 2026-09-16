/**
 * AudioLatencyModal.tsx
 * Modal de calibración de compensación de latencia de grabación.
 * Permite ajustar con precisión los milisegundos de desfase para alinear tomas de micrófono al compás exacto.
 */

import React from 'react';
import { Sliders, X } from 'lucide-react';
import { useSongStore } from '../../store/songStore';

export const AudioLatencyModal: React.FC = () => {
  const isLatencyModalOpen = useSongStore((state) => state.isLatencyModalOpen);
  const audioLatencyCalibrationMs = useSongStore((state) => state.audioLatencyCalibrationMs);
  const setAudioLatencyCalibrationMs = useSongStore((state) => state.setAudioLatencyCalibrationMs);
  const setIsLatencyModalOpen = useSongStore((state) => state.setIsLatencyModalOpen);

  if (!isLatencyModalOpen) return null;

  return (
    <div className="audio-modal-backdrop" onClick={() => setIsLatencyModalOpen(false)}>
      <div className="audio-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="audio-modal-header">
          <div className="audio-modal-title">
            <Sliders size={16} color="var(--accent)" />
            <span>CALIBRACIÓN DE LATENCIA (I/O OFFSET)</span>
          </div>
          <button
            className="audio-modal-close-btn"
            onClick={() => setIsLatencyModalOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <div className="audio-modal-body">
          <p>
            Compensa el retardo físico de entrada/salida entre tus auriculares y el micrófono.
            Permite que tus tomas vocales o instrumentales grabadas se alineen de forma automática
            con la base rítmica y el metrónomo sin desfase temporal.
          </p>

          <div className="audio-modal-slider-row">
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.8rem', minWidth: '60px' }}>
              {audioLatencyCalibrationMs > 0 ? `+${audioLatencyCalibrationMs}` : audioLatencyCalibrationMs} ms
            </span>
            <input
              type="range"
              min="-50"
              max="150"
              step="1"
              value={audioLatencyCalibrationMs}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
              onChange={(e) => setAudioLatencyCalibrationMs(Number(e.target.value))}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            {[
              { label: '0 ms (Directo)', val: 0 },
              { label: '15 ms (Cable)', val: 15 },
              { label: '30 ms (Estándar)', val: 30 },
              { label: '60 ms (Inalámbrico)', val: 60 }
            ].map((p) => (
              <button
                key={p.val}
                className="audio-rack-btn"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setAudioLatencyCalibrationMs(p.val)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
            <button
              className="audio-rack-btn active"
              onClick={() => setIsLatencyModalOpen(false)}
            >
              Guardar y Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
