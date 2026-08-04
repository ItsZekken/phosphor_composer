import React, { useState } from 'react';
import { useSongStore } from '../../store/songStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const CopyPatternModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { currentDrumPatternEdit, copyDrumPattern, duplicateCurrentPatternToNext } = useSongStore();
  const [sourceIndex, setSourceIndex] = useState<number>(currentDrumPatternEdit);
  const [targetIndex, setTargetIndex] = useState<number>((currentDrumPatternEdit + 1) % 8);

  if (!isOpen) return null;

  const handleCopy = () => {
    copyDrumPattern(sourceIndex, targetIndex);
    onClose();
  };

  const handleQuickDuplicate = () => {
    duplicateCurrentPatternToNext();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content copy-pattern-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📋 Copiar Patrón de Batería</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', padding: '1rem 0' }}>
          {/* Botón rápido de duplicar a siguiente */}
          <div className="quick-duplicate-box" style={{ background: 'rgba(0, 255, 204, 0.08)', border: '1px solid var(--reposo)', padding: '0.8rem', borderRadius: '6px', textAlign: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
              Duplicación Rápida
            </span>
            <button 
              className="ms-btn active-solo" 
              style={{ width: '100%', padding: '0.5rem', fontWeight: 700 }}
              onClick={handleQuickDuplicate}
            >
              ⚡ Duplicar Patrón {currentDrumPatternEdit + 1} en Patrón {((currentDrumPatternEdit + 1) % 8) + 1}
            </button>
          </div>

          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
            ─── O SELECCIONA PATRÓN ORIGEN Y DESTINO ───
          </div>

          <div className="copy-selection-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {/* Origen */}
            <div className="form-group">
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', display: 'block' }}>
                Copiar desde (Origen):
              </label>
              <select 
                className="drum-kit-select" 
                style={{ width: '100%', padding: '0.4rem' }}
                value={sourceIndex} 
                onChange={e => setSourceIndex(Number(e.target.value))}
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <option key={i} value={i}>Patrón {i + 1}</option>
                ))}
              </select>
            </div>

            {/* Destino */}
            <div className="form-group">
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', display: 'block' }}>
                Copiar en (Destino):
              </label>
              <select 
                className="drum-kit-select" 
                style={{ width: '100%', padding: '0.4rem' }}
                value={targetIndex} 
                onChange={e => setTargetIndex(Number(e.target.value))}
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <option key={i} value={i} disabled={i === sourceIndex}>
                    Patrón {i + 1} {i === sourceIndex ? '(Actual)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', marginTop: '1rem' }}>
          <button className="add-channel-btn" style={{ background: 'transparent' }} onClick={onClose}>
            Cancelar
          </button>
          <button className="add-channel-btn" style={{ background: 'var(--reposo)', color: '#000', fontWeight: 700 }} onClick={handleCopy}>
            Copiar Patrón
          </button>
        </div>
      </div>
    </div>
  );
};
