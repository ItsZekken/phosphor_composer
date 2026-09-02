import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Music, Settings, Tv } from 'lucide-react';

export const SettingsPanel = () => {
  const {
    isSettingsOpen,
    setSettingsOpen,
    isCrtEnabled,
    setCrtEnabled,
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
