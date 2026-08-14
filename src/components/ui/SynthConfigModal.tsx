import React, { useEffect, useRef, useState } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Sliders, Activity, Radio, Play } from 'lucide-react';
import { toneEngine } from '../../audio/toneEngine';

export const SynthConfigModal: React.FC = () => {
  const {
    isSynthModalOpen,
    setSynthModalOpen,
    editingChannelId,
    channels,
    setChannelSynthSettings
  } = useSongStore(
    useShallow((state) => ({
      isSynthModalOpen: state.isSynthModalOpen,
      setSynthModalOpen: state.setSynthModalOpen,
      editingChannelId: state.editingChannelId,
      channels: state.channels,
      setChannelSynthSettings: state.setChannelSynthSettings
    }))
  );

  const scopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const filterSvgRef = useRef<SVGSVGElement>(null);
  const [isDraggingFilterNode, setIsDraggingFilterNode] = useState(false);

  // Obtener canal y configuraciones de sintetizador objetivo
  const targetChannelId = editingChannelId || 'chords';
  const targetChannel = channels[targetChannelId] || channels['chords'] || Object.values(channels)[0];
  const synthSettings = targetChannel?.synthSettings || {
    waveType: 'triangle',
    detune: 0,
    envelope: { attack: 0.05, decay: 0.2, sustain: 0.7, release: 0.8 },
    filter: { enabled: true, type: 'lowpass', frequency: 3500, Q: 2 }
  };

  // 1. Animación del Osciloscopio FFT en Tiempo Real
  useEffect(() => {
    if (!isSynthModalOpen) return;

    let animId: number;
    const canvas = scopeCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawScope = () => {
      const width = canvas.width;
      const height = canvas.height;
      const waveform = toneEngine.getWaveformData();

      ctx.fillStyle = '#08080f';
      ctx.fillRect(0, 0, width, height);

      // Dibujar retícula de cuadrícula CRT
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x += 20) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += 15) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Dibujar forma de onda FFT
      ctx.strokeStyle = '#00e5ff';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();

      const sliceWidth = width / waveform.length;
      let x = 0;

      for (let i = 0; i < waveform.length; i++) {
        const v = waveform[i];
        const y = ((v + 1) / 2) * height;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.stroke();
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(drawScope);
    };

    drawScope();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isSynthModalOpen]);

  if (!isSynthModalOpen) return null;

  const updateSettings = (partial: any, triggerPreview = false) => {
    const updated = {
      ...synthSettings,
      ...partial
    };
    setChannelSynthSettings(targetChannelId, updated);
    toneEngine.updateSynthSettings(updated, targetChannelId);
    if (triggerPreview) {
      toneEngine.playNotePreview('C4', targetChannelId);
    }
  };

  const handleWaveSelect = (waveType: 'sine' | 'triangle' | 'square' | 'sawtooth') => {
    updateSettings({ waveType }, true);
  };

  const handleDetuneChange = (val: number) => {
    updateSettings({ detune: val });
  };

  const handleEnvelopeChange = (key: 'attack' | 'decay' | 'sustain' | 'release', val: number) => {
    updateSettings({
      envelope: {
        ...synthSettings.envelope,
        [key]: val
      }
    });
  };

  const handleFilterToggle = (enabled: boolean) => {
    updateSettings({
      filter: {
        ...synthSettings.filter,
        enabled
      }
    }, true);
  };

  const handleFilterChange = (key: 'type' | 'frequency' | 'Q', val: any) => {
    updateSettings({
      filter: {
        ...synthSettings.filter,
        [key]: val
      }
    });
  };

  // 2. Interacción Gráfica con la Curva del Filtro VCF (Drag Cutoff X & Q Y)
  const handleFilterSvgInteraction = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = filterSvgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    // Mapear X (0 a rect.width) -> Frecuencia 100 Hz a 12000 Hz (escala log/lineal)
    const normX = x / rect.width;
    const freq = Math.round(100 + Math.pow(normX, 2) * 11900);

    // Mapear Y (rect.height a 0) -> Q 0.5 a 12
    const normY = 1 - y / rect.height;
    const qVal = parseFloat((0.5 + normY * 11.5).toFixed(1));

    updateSettings({
      filter: {
        ...synthSettings.filter,
        frequency: Math.max(100, Math.min(12000, freq)),
        Q: Math.max(0.5, Math.min(12, qVal))
      }
    });
  };

  // Calcular puntos de la curva VCF SVG
  const svgWidth = 280;
  const svgHeight = 90;
  const normCutoff = Math.sqrt((synthSettings.filter.frequency - 100) / 11900);
  const nodeX = normCutoff * svgWidth;
  const normQ = (synthSettings.filter.Q - 0.5) / 11.5;
  const nodeY = (1 - normQ) * svgHeight;

  return (
    <div className="synth-modal-overlay" onClick={() => setSynthModalOpen(false)}>
      <div className="synth-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Panel Header */}
        <div className="synth-modal-header">
          <div className="synth-header-title">
            <Activity className="header-icon pulse-icon" size={16} />
            <span>SINTETIZADOR VIRTUAL // {targetChannel.name.toUpperCase()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="synth-test-btn"
              onClick={() => toneEngine.playNotePreview('C4', targetChannelId)}
              title="Probar nota C4 en tiempo real"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(0, 229, 255, 0.15)',
                border: '1px solid #00e5ff',
                color: '#00e5ff',
                borderRadius: '4px',
                padding: '4px 10px',
                fontSize: '0.72rem',
                fontFamily: "'Share Tech Mono', monospace",
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              <Play size={12} /> PROBAR VOZ (C4)
            </button>
            <button className="synth-close-btn" onClick={() => setSynthModalOpen(false)} title="Cerrar Panel">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Osciloscopio FFT en Tiempo Real */}
        <div className="synth-scope-section" style={{ padding: '8px 16px', background: '#05050a', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.7rem', fontFamily: "'Share Tech Mono', monospace", color: '#00e5ff', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Radio size={12} /> OSCILOSCOPIO FFT EN TIEMPO REAL
            </span>
            <span style={{ fontSize: '0.65rem', color: '#888', fontFamily: "'Share Tech Mono', monospace" }}>CANAL: {targetChannel.id}</span>
          </div>
          <canvas
            ref={scopeCanvasRef}
            width={480}
            height={70}
            style={{ width: '100%', height: '70px', borderRadius: '4px', border: '1px solid rgba(0, 229, 255, 0.2)', display: 'block' }}
          />
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

          {/* SECCIÓN 2: FILTRO CON GRÁFICO INTERACTIVO */}
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
              
              {/* Gráfico Interactivo de Respuesta en Frecuencia (SVG) */}
              <div className="filter-graph-container" style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#aaa', fontFamily: "'Share Tech Mono', monospace", marginBottom: '2px' }}>
                  <span>CURVA DE CORTE Y RESONANCIA</span>
                  <span>ARRASTRA EL NODO Y/X</span>
                </div>
                <svg
                  ref={filterSvgRef}
                  width={svgWidth}
                  height={svgHeight}
                  style={{ background: '#0a0a14', borderRadius: '4px', border: '1px solid rgba(168, 85, 247, 0.3)', cursor: 'crosshair', display: 'block', width: '100%' }}
                  onMouseDown={(e) => {
                    setIsDraggingFilterNode(true);
                    handleFilterSvgInteraction(e);
                  }}
                  onMouseMove={(e) => {
                    if (isDraggingFilterNode) handleFilterSvgInteraction(e);
                  }}
                  onMouseUp={() => setIsDraggingFilterNode(false)}
                  onMouseLeave={() => setIsDraggingFilterNode(false)}
                >
                  {/* Curva de filtro estilizada */}
                  <path
                    d={`M 0 ${svgHeight * 0.4} Q ${nodeX * 0.8} ${svgHeight * 0.4}, ${nodeX} ${nodeY} T ${svgWidth} ${svgHeight * 0.9}`}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="2"
                  />
                  {/* Nodo Interactivo */}
                  <circle
                    cx={nodeX}
                    cy={nodeY}
                    r="6"
                    fill="#ff007f"
                    stroke="#fff"
                    strokeWidth="2"
                    style={{ filter: 'drop-shadow(0 0 6px #ff007f)' }}
                  />
                </svg>
              </div>

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
                      {...({ orient: 'vertical' } as any)}
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
                      {...({ orient: 'vertical' } as any)}
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
                      {...({ orient: 'vertical' } as any)}
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
                      {...({ orient: 'vertical' } as any)}
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
          <span>VIRTUAL ANALOG SYNTHESIS MODEL - PHOSPHOR V15 // {targetChannel.name.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
};
