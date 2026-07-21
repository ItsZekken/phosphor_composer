import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Sliders, Activity } from 'lucide-react';

export const SynthConfigModal = () => {
  const {
    isSynthModalOpen,
    setSynthModalOpen,
    synthSettings,
    setSynthSettings
  } = useSongStore(useShallow(state => ({
    isSynthModalOpen: state.isSynthModalOpen,
    setSynthModalOpen: state.setSynthModalOpen,
    synthSettings: state.synthSettings,
    setSynthSettings: state.setSynthSettings
  })));

  if (!isSynthModalOpen) return null;

  const handleWaveSelect = (waveType: 'sine' | 'triangle' | 'square' | 'sawtooth') => {
    setSynthSettings({ waveType });
  };

  const handleDetuneChange = (val: number) => {
    setSynthSettings({ detune: val });
  };

  const handleEnvelopeChange = (key: 'attack' | 'decay' | 'sustain' | 'release', val: number) => {
    setSynthSettings({
      envelope: {
        ...synthSettings.envelope,
        [key]: val
      }
    });
  };

  const handleFilterToggle = (enabled: boolean) => {
    setSynthSettings({
      filter: {
        ...synthSettings.filter,
        enabled
      }
    });
  };

  const handleFilterChange = (key: 'type' | 'frequency' | 'Q', val: any) => {
    setSynthSettings({
      filter: {
        ...synthSettings.filter,
        [key]: val
      }
    });
  };

  return (
    <div className="synth-modal-overlay" onClick={() => setSynthModalOpen(false)}>
      <div className="synth-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Panel Header */}
        <div className="synth-modal-header">
          <div className="synth-header-title">
            <Activity className="header-icon pulse-icon" size={16} />
            <span>SINTETIZADOR VIRTUAL // CONFIGURACIÓN DE VOZ</span>
          </div>
          <button className="synth-close-btn" onClick={() => setSynthModalOpen(false)} title="Cerrar Panel">
            <X size={16} />
          </button>
        </div>

        {/* Panel Body (Eurorack Rack) */}
        <div className="synth-modal-rack">
          
          {/* SECCIÓN 1: OSCILADOR */}
          <div className="synth-rack-module">
            <div className="module-title">I. OSCILADOR</div>
            <div className="module-content">
              {/* Selector de Onda */}
              <div className="control-field">
                <label className="field-label">FORMA DE ONDA</label>
                <div className="wave-selector-grid">
                  <button 
                    className={`wave-btn ${synthSettings.waveType === 'sine' ? 'active' : ''}`}
                    onClick={() => handleWaveSelect('sine')}
                    title="Senoidal (~)"
                  >
                    <span className="wave-icon">~</span>
                    <span className="wave-label">SINE</span>
                  </button>
                  <button 
                    className={`wave-btn ${synthSettings.waveType === 'triangle' ? 'active' : ''}`}
                    onClick={() => handleWaveSelect('triangle')}
                    title="Triangular (/\)"
                  >
                    <span className="wave-icon">/\</span>
                    <span className="wave-label">TRI</span>
                  </button>
                  <button 
                    className={`wave-btn ${synthSettings.waveType === 'square' ? 'active' : ''}`}
                    onClick={() => handleWaveSelect('square')}
                    title="Cuadrada (|_|)"
                  >
                    <span className="wave-icon">|_|</span>
                    <span className="wave-label">SQR</span>
                  </button>
                  <button 
                    className={`wave-btn ${synthSettings.waveType === 'sawtooth' ? 'active' : ''}`}
                    onClick={() => handleWaveSelect('sawtooth')}
                    title="Diente de Sierra (//)"
                  >
                    <span className="wave-icon">//</span>
                    <span className="wave-label">SAW</span>
                  </button>
                </div>
              </div>

              {/* Detune Slider */}
              <div className="control-field" style={{ marginTop: '14px' }}>
                <div className="field-header">
                  <label className="field-label">MICRO-AFINACIÓN (DETUNE)</label>
                  <span className="field-value">{synthSettings.detune > 0 ? `+${synthSettings.detune}` : synthSettings.detune} Cts</span>
                </div>
                <div className="slider-wrapper">
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={synthSettings.detune}
                    onChange={(e) => handleDetuneChange(parseInt(e.target.value))}
                    className="synth-slider"
                  />
                  <div className="slider-ticks">
                    <span>-100</span>
                    <span>0</span>
                    <span>+100</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECCIÓN 2: FILTRO */}
          <div className="synth-rack-module">
            <div className="module-title">
              <span>II. FILTRO VCF</span>
              <label className="switch-led-container">
                <span className={`led-indicator ${synthSettings.filter.enabled ? 'on' : ''}`}></span>
                <input
                  type="checkbox"
                  checked={synthSettings.filter.enabled}
                  onChange={(e) => handleFilterToggle(e.target.checked)}
                  style={{ display: 'none' }}
                  id="filter-toggle-checkbox"
                />
                <label htmlFor="filter-toggle-checkbox" className="bypass-label">
                  {synthSettings.filter.enabled ? 'ON' : 'BYPASS'}
                </label>
              </label>
            </div>
            <div className={`module-content ${synthSettings.filter.enabled ? '' : 'module-bypassed'}`}>
              {/* Tipo de Filtro */}
              <div className="control-field">
                <label className="field-label">TIPO</label>
                <div className="filter-type-row">
                  {['lowpass', 'highpass', 'bandpass'].map((type) => (
                    <button
                      key={type}
                      className={`filter-type-btn ${synthSettings.filter.type === type ? 'active' : ''}`}
                      disabled={!synthSettings.filter.enabled}
                      onClick={() => handleFilterChange('type', type)}
                    >
                      {type === 'lowpass' ? 'LP (Paso Bajo)' : type === 'highpass' ? 'HP (Paso Alto)' : 'BP (Paso Banda)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Frecuencia de Corte */}
              <div className="control-field" style={{ marginTop: '10px' }}>
                <div className="field-header">
                  <label className="field-label">FRECUENCIA DE CORTE</label>
                  <span className="field-value">{synthSettings.filter.frequency} Hz</span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="12000"
                  step="50"
                  disabled={!synthSettings.filter.enabled}
                  value={synthSettings.filter.frequency}
                  onChange={(e) => handleFilterChange('frequency', parseInt(e.target.value))}
                  className="synth-slider"
                />
              </div>

              {/* Q (Resonancia) */}
              <div className="control-field" style={{ marginTop: '10px' }}>
                <div className="field-header">
                  <label className="field-label">RESONANCIA (Q)</label>
                  <span className="field-value">{synthSettings.filter.Q.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="12"
                  step="0.1"
                  disabled={!synthSettings.filter.enabled}
                  value={synthSettings.filter.Q}
                  onChange={(e) => handleFilterChange('Q', parseFloat(e.target.value))}
                  className="synth-slider"
                />
              </div>
            </div>
          </div>

          {/* SECCIÓN 3: ENVOLVENTE ADSR */}
          <div className="synth-rack-module">
            <div className="module-title">III. ENVOLVENTE ADSR</div>
            <div className="module-content">
              {/* Sliders Verticales de Envolvente */}
              <div className="adsr-sliders-container">
                {/* Attack */}
                <div className="adsr-slider-col">
                  <div className="adsr-val-label">{synthSettings.envelope.attack.toFixed(2)}s</div>
                  <div className="vertical-slider-wrapper">
                    <input
                      type="range"
                      min="0.001"
                      max="2.0"
                      step="0.01"
                      orient="vertical"
                      value={synthSettings.envelope.attack}
                      onChange={(e) => handleEnvelopeChange('attack', parseFloat(e.target.value))}
                      className="synth-slider vertical-slider"
                    />
                  </div>
                  <label className="adsr-label">A</label>
                  <span className="adsr-desc">ATTACK</span>
                </div>

                {/* Decay */}
                <div className="adsr-slider-col">
                  <div className="adsr-val-label">{synthSettings.envelope.decay.toFixed(2)}s</div>
                  <div className="vertical-slider-wrapper">
                    <input
                      type="range"
                      min="0.05"
                      max="2.0"
                      step="0.01"
                      orient="vertical"
                      value={synthSettings.envelope.decay}
                      onChange={(e) => handleEnvelopeChange('decay', parseFloat(e.target.value))}
                      className="synth-slider vertical-slider"
                    />
                  </div>
                  <label className="adsr-label">D</label>
                  <span className="adsr-desc">DECAY</span>
                </div>

                {/* Sustain */}
                <div className="adsr-slider-col">
                  <div className="adsr-val-label">{Math.round(synthSettings.envelope.sustain * 100)}%</div>
                  <div className="vertical-slider-wrapper">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      orient="vertical"
                      value={synthSettings.envelope.sustain}
                      onChange={(e) => handleEnvelopeChange('sustain', parseFloat(e.target.value))}
                      className="synth-slider vertical-slider"
                    />
                  </div>
                  <label className="adsr-label">S</label>
                  <span className="adsr-desc">SUSTAIN</span>
                </div>

                {/* Release */}
                <div className="adsr-slider-col">
                  <div className="adsr-val-label">{synthSettings.envelope.release.toFixed(2)}s</div>
                  <div className="vertical-slider-wrapper">
                    <input
                      type="range"
                      min="0.05"
                      max="4.0"
                      step="0.01"
                      orient="vertical"
                      value={synthSettings.envelope.release}
                      onChange={(e) => handleEnvelopeChange('release', parseFloat(e.target.value))}
                      className="synth-slider vertical-slider"
                    />
                  </div>
                  <label className="adsr-label">R</label>
                  <span className="adsr-desc">RELEASE</span>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Panel Footer */}
        <div className="synth-modal-footer">
          <Sliders size={12} style={{ marginRight: '6px' }} />
          <span>VIRTUAL ANALOG SYNTHESIS MODEL - PHOSPHOR V15</span>
        </div>
      </div>
    </div>
  );
};
