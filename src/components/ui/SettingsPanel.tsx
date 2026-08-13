import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Volume2, Music, Settings, Tv } from 'lucide-react';

export const SettingsPanel = () => {
  const {
    isSettingsOpen,
    setSettingsOpen,
    isCrtEnabled,
    setCrtEnabled,
    crtParams,
    setCrtParams,
    instrumentType,
    setInstrumentType,
    isMetronomeActive,
    setMetronomeActive,
    metroSubdivision,
    setMetroSubdivision,
    metroVolume,
    setMetroVolume,
    timeSignature,
    setTimeSignature,
    pattern,
    setPattern,
    customPatterns,
    isKeyboardMelodyEnabled,
    setKeyboardMelodyEnabled,
    isKeyboardChromatic,
    setKeyboardChromatic,
    isAutoSuggestions,
    setAutoSuggestions,
    chordOctaveShift,
    setChordOctaveShift,
    swing,
    setSwing,
    sustain,
    setSustain
  } = useSongStore(useShallow(state => ({
    isSettingsOpen: state.isSettingsOpen,
    setSettingsOpen: state.setSettingsOpen,
    isCrtEnabled: state.isCrtEnabled,
    setCrtEnabled: state.setCrtEnabled,
    crtParams: state.crtParams,
    setCrtParams: state.setCrtParams,
    instrumentType: state.instrumentType,
    setInstrumentType: state.setInstrumentType,
    isMetronomeActive: state.isMetronomeActive,
    setMetronomeActive: state.setMetronomeActive,
    metroSubdivision: state.metroSubdivision,
    setMetroSubdivision: state.setMetroSubdivision,
    metroVolume: state.metroVolume,
    setMetroVolume: state.setMetroVolume,
    timeSignature: state.timeSignature,
    setTimeSignature: state.setTimeSignature,
    pattern: state.pattern,
    setPattern: state.setPattern,
    customPatterns: state.customPatterns,
    isKeyboardMelodyEnabled: state.isKeyboardMelodyEnabled,
    setKeyboardMelodyEnabled: state.setKeyboardMelodyEnabled,
    isKeyboardChromatic: state.isKeyboardChromatic,
    setKeyboardChromatic: state.setKeyboardChromatic,
    isAutoSuggestions: state.isAutoSuggestions,
    setAutoSuggestions: state.setAutoSuggestions,
    chordOctaveShift: state.chordOctaveShift,
    setChordOctaveShift: state.setChordOctaveShift,
    swing: state.swing,
    setSwing: state.setSwing,
    sustain: state.sustain,
    setSustain: state.setSustain
  })));

  if (!isSettingsOpen) return null;

  const handleParamChange = (key: keyof typeof crtParams, val: number) => {
    setCrtParams({ [key]: val });
  };

  return (
    <div className="settings-sidebar">
      <div className="settings-header">
        <h2>
          <Settings size={18} style={{ marginRight: '6px', verticalAlign: 'middle', display: 'inline' }} />
          Ajustes
        </h2>
        <button className="settings-close-btn" onClick={() => setSettingsOpen(false)} title="Cerrar ajustes">
          <X size={18} />
        </button>
      </div>

      {/* SECCIÓN 1: MONITOR CRT */}
      <div className="settings-section">
        <div className="settings-section-title">
          <Tv size={12} style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline' }} />
          Monitor CRT
        </div>
        <div className="switch-container">
          <span className="settings-label">Efecto CRT Pantalla</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={isCrtEnabled}
              onChange={(e) => setCrtEnabled(e.target.checked)}
            />
            <span className="slider-toggle" />
          </label>
        </div>

        {isCrtEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '4px' }}>
            <div className="settings-row">
              <span className="settings-label">Opacidad scanlines</span>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={crtParams.scanlineOpacity}
                onChange={(e) => handleParamChange('scanlineOpacity', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.scanlineOpacity.toFixed(2)}</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Tamaño scanlines</span>
              <input
                type="range"
                min="1"
                max="6"
                step="0.5"
                value={crtParams.scanlineSize}
                onChange={(e) => handleParamChange('scanlineSize', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.scanlineSize.toFixed(1)}px</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Curvatura barril</span>
              <input
                type="range"
                min="0"
                max="60"
                step="1"
                value={crtParams.curvature}
                onChange={(e) => handleParamChange('curvature', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.curvature.toFixed(0)}</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Aberración</span>
              <input
                type="range"
                min="0"
                max="8"
                step="0.5"
                value={crtParams.aberration}
                onChange={(e) => handleParamChange('aberration', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.aberration.toFixed(1)}px</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Fósforo Hue (Color)</span>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={crtParams.phosphorHue}
                onChange={(e) => handleParamChange('phosphorHue', parseInt(e.target.value))}
              />
              <span className="settings-val">{crtParams.phosphorHue}°</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Fósforo Sat</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={crtParams.phosphorSat}
                onChange={(e) => handleParamChange('phosphorSat', parseInt(e.target.value))}
              />
              <span className="settings-val">{crtParams.phosphorSat}%</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Intensidad tinte</span>
              <input
                type="range"
                min="0"
                max="0.2"
                step="0.01"
                value={crtParams.tintStrength}
                onChange={(e) => handleParamChange('tintStrength', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.tintStrength.toFixed(2)}</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Ruido estático</span>
              <input
                type="range"
                min="0"
                max="0.1"
                step="0.005"
                value={crtParams.noise}
                onChange={(e) => handleParamChange('noise', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.noise.toFixed(3)}</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Parpadeo CRT</span>
              <input
                type="range"
                min="0"
                max="0.2"
                step="0.01"
                value={crtParams.flicker}
                onChange={(e) => handleParamChange('flicker', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.flicker.toFixed(2)}</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Viñeta</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={crtParams.vignette}
                onChange={(e) => handleParamChange('vignette', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.vignette.toFixed(2)}</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Brillo</span>
              <input
                type="range"
                min="0.8"
                max="1.4"
                step="0.02"
                value={crtParams.brightness}
                onChange={(e) => handleParamChange('brightness', parseFloat(e.target.value))}
              />
              <span className="settings-val">{crtParams.brightness.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* SECCIÓN 2: AUDIO & INSTRUMENTOS */}
      <div className="settings-section">
        <div className="settings-section-title">
          <Volume2 size={12} style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline' }} />
          Instrumento & Metrónomo
        </div>
        <div className="switch-container">
          <span className="settings-label">Tipo Instrumento</span>
          <select
            className="panel-select"
            value={instrumentType}
            onChange={(e) => setInstrumentType(e.target.value as 'synth' | 'piano')}
            style={{ width: '130px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
          >
            <option value="synth">Sintetizador</option>
            <option value="piano">Piano</option>
          </select>
        </div>

        <div className="switch-container">
          <span className="settings-label">Metrónomo activo</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={isMetronomeActive}
              onChange={(e) => setMetronomeActive(e.target.checked)}
            />
            <span className="slider-toggle" />
          </label>
        </div>

        {isMetronomeActive && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '4px' }}>
            <div className="settings-row">
              <span className="settings-label">Subdivisión click</span>
              <select
                className="panel-select"
                value={metroSubdivision}
                onChange={(e) => setMetroSubdivision(e.target.value as any)}
                style={{ gridColumn: '2 / 4', padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
              >
                <option value="4n">1/4 (Negra)</option>
                <option value="8n">1/8 (Corchea)</option>
                <option value="16n">1/16 (Semicorchea)</option>
              </select>
            </div>

            <div className="settings-row">
              <span className="settings-label">Volumen click</span>
              <input
                type="range"
                min="0"
                max="100"
                value={metroVolume}
                onChange={(e) => setMetroVolume(parseInt(e.target.value))}
              />
              <span className="settings-val">{metroVolume}%</span>
            </div>
          </div>
        )}
      </div>

      {/* SECCIÓN: TECLADO MELODÍA */}
      <div className="settings-section">
        <div className="settings-section-title">
          <Music size={12} style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline' }} />
          Teclado QWERTY (Melodía)
        </div>
        <div className="switch-container">
          <span className="settings-label">Habilitar Teclado</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={isKeyboardMelodyEnabled}
              onChange={(e) => setKeyboardMelodyEnabled(e.target.checked)}
            />
            <span className="slider-toggle" />
          </label>
        </div>

        {isKeyboardMelodyEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '6px' }}>
            <div className="switch-container">
              <span className="settings-label">Modo Cromático (W = Do#)</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={isKeyboardChromatic}
                  onChange={(e) => setKeyboardChromatic(e.target.checked)}
                />
                <span className="slider-toggle" />
              </label>
            </div>
            <div className="settings-row" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.3', display: 'block', padding: '2px 4px' }}>
              {isKeyboardChromatic ? (
                <span><strong>Cromático QWERTY:</strong> Fila intermedia = teclas blancas (A=Do, S=Re...). Fila superior = teclas negras (W=Do#, E=Re#...).<br/><em>El atajo de parada/detener se traslada de W a Q.</em></span>
              ) : (
                <span><strong>Diatónico (Tonal):</strong> Solo notas dentro de la escala actual.<br/>Fila inferior = octava baja. Fila intermedia = octava alta.<br/><em>W sigue parando la reproducción.</em></span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* SECCIÓN: SUGERENCIAS ARMÓNICAS */}
      <div className="settings-section">
        <div className="settings-section-title">
          <Music size={12} style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline' }} />
          Sugerencias Armónicas
        </div>
        <div className="switch-container">
          <span className="settings-label">Sugerencias automáticas</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={isAutoSuggestions}
              onChange={(e) => setAutoSuggestions(e.target.checked)}
            />
            <span className="slider-toggle" />
          </label>
        </div>
        <div className="settings-row" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.3', display: 'block', padding: '2px 4px', marginTop: '4px' }}>
          {isAutoSuggestions
            ? <span>Las sugerencias se actualizan automáticamente al editar acordes.</span>
            : <span>Las sugerencias son <strong>manuales</strong>: usa el botón 🔄 en la paleta de acordes.</span>
          }
        </div>
      </div>

      {/* SECCIÓN 3: COMPÁS & RITMO */}
      <div className="settings-section">
        <div className="settings-section-title">
          <Music size={12} style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline' }} />
          Métrica, Octava & Ritmo
        </div>
        <div className="switch-container">
          <span className="settings-label">Compás (Sign.)</span>
          <select
            className="panel-select"
            value={timeSignature}
            onChange={(e) => setTimeSignature(e.target.value as any)}
            style={{ width: '130px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
          >
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="6/8">6/8</option>
          </select>
        </div>

        <div className="switch-container">
          <span className="settings-label">Transponer Acordes</span>
          <select
            className="panel-select"
            value={chordOctaveShift.toString()}
            onChange={(e) => setChordOctaveShift(parseInt(e.target.value))}
            style={{ width: '130px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
          >
            <option value="-2">-2 Octavas</option>
            <option value="-1">-1 Octava</option>
            <option value="0">Normal (0)</option>
            <option value="1">+1 Octava</option>
            <option value="2">+2 Octavas</option>
          </select>
        </div>

        <div className="settings-row" style={{ marginTop: '6px' }}>
          <span className="settings-label">Swing Ratio</span>
          <input
            type="range"
            min="0"
            max="100"
            value={swing}
            onChange={(e) => setSwing(parseInt(e.target.value))}
          />
          <span className="settings-val">{swing}%</span>
        </div>

        <div className="switch-container" style={{ marginTop: '6px' }}>
          <span className="settings-label">Pedal Sustain</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={sustain}
              onChange={(e) => setSustain(e.target.checked)}
            />
            <span className="slider-toggle" />
          </label>
        </div>

        <div className="switch-container" style={{ marginTop: '6px' }}>
          <span className="settings-label">Patrón Rítmico</span>
          <select
            className="panel-select"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            style={{ width: '130px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
          >
            <option value="hold">Sostenido</option>
            <option value="quarters">Negras</option>
            <option value="eighths">Corcheas</option>
            <option value="pop">Piano Pop</option>
            <option value="arpeggio">Arpegio</option>
            <option value="strum">Rasgueado</option>
            {customPatterns.length > 0 && (
              <optgroup label="MIDI">
                {customPatterns.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>
    </div>
  );
};
