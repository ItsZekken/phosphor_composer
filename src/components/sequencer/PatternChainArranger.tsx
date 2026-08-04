import React from 'react';
import { useSongStore } from '../../store/songStore';

export const PatternChainArranger: React.FC = () => {
  const {
    patternChain,
    isChainModeActive,
    currentChainItemIndex,
    setChainModeActive,
    addChainItem,
    updateChainItem,
    removeChainItem,
    moveChainItem,
    setCurrentDrumPatternEdit,
    currentDrumPatternEdit,
    isPlaying
  } = useSongStore();

  const colors = [
    'var(--reposo)',
    'var(--subdominante)',
    'var(--tension)',
    'var(--spicy)',
    'var(--exotic)',
    '#ff007f',
    '#00bfff',
    '#ffaa00'
  ];

  return (
    <div className="pattern-chain-container">
      {/* Header del Arranger */}
      <div className="pattern-chain-header">
        <div className="chain-title-group">
          <span className="chain-icon">🔗</span>
          <span className="chain-title">CADENA DE PATRONES</span>
        </div>

        <div className="chain-actions">
          {/* Toggle Modo Cadena */}
          <button 
            className={`chain-mode-toggle ${isChainModeActive ? 'active' : ''}`}
            onClick={() => setChainModeActive(!isChainModeActive)}
            title={isChainModeActive ? 'Modo Cadena Activado' : 'Modo Bucle Único'}
          >
            <span className="mode-led" />
            {isChainModeActive ? 'CADENA ON' : 'CADENA OFF'}
          </button>

          {/* Agregar Bloque */}
          <button 
            className="add-chain-block-btn"
            onClick={() => addChainItem(currentDrumPatternEdit, 1)}
          >
            + Patrón {currentDrumPatternEdit + 1}
          </button>
        </div>
      </div>

      {/* Track de Bloques Encadenados */}
      <div className="pattern-chain-track-wrapper">
        <div className="pattern-chain-track">
          {patternChain.map((item, index) => {
            const isCurrentPlaying = isPlaying && isChainModeActive && currentChainItemIndex === index;
            const blockColor = colors[item.patternIndex % colors.length];

            return (
              <React.Fragment key={item.id}>
                {/* Bloquecito de Patrón */}
                <div 
                  className={`pattern-chain-block ${isCurrentPlaying ? 'playing' : ''} ${item.patternIndex === currentDrumPatternEdit ? 'editing' : ''}`}
                  style={{ '--block-color': blockColor } as React.CSSProperties}
                >
                  {/* Barra superior de color */}
                  <div className="block-color-bar" />

                  <div className="block-content">
                    {/* Header del bloque */}
                    <div className="block-header">
                      <button 
                        className="pattern-badge-btn"
                        onClick={() => setCurrentDrumPatternEdit(item.patternIndex)}
                        title="Haz clic para ver/editar este patrón"
                      >
                        P{item.patternIndex + 1}
                      </button>

                      <div className="block-nav-btns">
                        <button 
                          className="chain-nav-btn" 
                          disabled={index === 0}
                          onClick={() => moveChainItem(index, index - 1)}
                        >◄</button>
                        <button 
                          className="chain-nav-btn" 
                          disabled={index === patternChain.length - 1}
                          onClick={() => moveChainItem(index, index + 1)}
                        >►</button>
                        <button 
                          className="chain-nav-btn remove-btn" 
                          onClick={() => removeChainItem(item.id)}
                        >✕</button>
                      </div>
                    </div>

                    {/* Selector de Patrón */}
                    <div className="block-pattern-select">
                      <select 
                        value={item.patternIndex}
                        onChange={(e) => updateChainItem(item.id, { patternIndex: Number(e.target.value) })}
                      >
                        {Array.from({ length: 8 }).map((_, pIdx) => (
                          <option key={pIdx} value={pIdx}>
                            Patrón {pIdx + 1}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Control de Repeticiones */}
                    <div className="block-repeat-counter">
                      <button 
                        className="repeat-btn" 
                        disabled={item.repeatCount <= 1}
                        onClick={() => updateChainItem(item.id, { repeatCount: Math.max(1, item.repeatCount - 1) })}
                      >-</button>
                      <span className="repeat-count-text">x{item.repeatCount}</span>
                      <button 
                        className="repeat-btn"
                        onClick={() => updateChainItem(item.id, { repeatCount: item.repeatCount + 1 })}
                      >+</button>
                    </div>
                  </div>
                </div>

                {/* Conector tipo Cadena / Cable Neón entre bloques */}
                {index < patternChain.length - 1 && (
                  <div className={`chain-connector ${isCurrentPlaying ? 'active-pulse' : ''}`}>
                    <svg className="chain-link-svg" viewBox="0 0 40 20">
                      <path 
                        d="M 0 10 Q 10 0, 20 10 T 40 10" 
                        className="chain-cord-path"
                      />
                      <circle cx="20" cy="10" r="3" className="chain-node-dot" />
                    </svg>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
