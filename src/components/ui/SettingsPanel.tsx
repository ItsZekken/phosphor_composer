import { useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Music, Settings, Tv, RefreshCw, Keyboard } from 'lucide-react';
import { CustomSelect, type SelectGroup } from './CustomSelect';

const TIME_SIG_OPTIONS = [
  { value: '4/4', label: '4/4' },
  { value: '3/4', label: '3/4' },
  { value: '6/8', label: '6/8' }
];

const OCTAVE_SHIFT_OPTIONS = [
  { value: '-2', label: '-2 Octavas' },
  { value: '-1', label: '-1 Octava' },
  { value: '0', label: 'Normal (0)' },
  { value: '1', label: '+1 Octava' },
  { value: '2', label: '+2 Octavas' }
];

const STANDARD_PATTERNS = [
  { value: 'hold', label: 'Sostenido' },
  { value: 'quarters', label: 'Negras' },
  { value: 'eighths', label: 'Corcheas' },
  { value: 'pop', label: 'Piano Pop' },
  { value: 'arpeggio', label: 'Arpegio' },
  { value: 'strum', label: 'Rasgueado' }
];

export const SettingsPanel = () => {
  const {
    isSettingsOpen,
    setSettingsOpen,
    setCommandPaletteMode,
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
  } = useSongStore(
    useShallow((state) => ({
      isSettingsOpen: state.isSettingsOpen,
      setSettingsOpen: state.setSettingsOpen,
      setCommandPaletteMode: state.setCommandPaletteMode,
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
    }))
  );

  const patternGroups = useMemo<SelectGroup[]>(() => {
    const groups: SelectGroup[] = [{ label: 'Estándar', options: STANDARD_PATTERNS }];
    if (customPatterns && customPatterns.length > 0) {
      groups.push({
        label: 'Patrones MIDI',
        options: customPatterns.map((p) => ({ value: p.name, label: p.name }))
      });
    }
    return groups;
  }, [customPatterns]);

  if (!isSettingsOpen) return null;

  return (
    <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="settings-sidebar" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ajustes">
        <div className="settings-header">
          <h2>
            <Settings size={18} style={{ marginRight: '6px', verticalAlign: 'middle', display: 'inline' }} />
            Ajustes
          </h2>
          <button className="settings-close-btn" onClick={() => setSettingsOpen(false)} title="Cerrar ajustes (Esc)">
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

        {/* SECCIÓN 2: TECLADO MELODÍA */}
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
              <div className="settings-row" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.35', display: 'block', padding: '2px 4px' }}>
                {isKeyboardChromatic ? (
                  <span>
                    <strong>Cromático QWERTY:</strong> Fila intermedia = teclas blancas (A=Do, S=Re...). Fila superior = teclas negras (W=Do#, E=Re#...).
                    <br />
                    <em>El atajo de parada/detener se traslada de W a Q.</em>
                  </span>
                ) : (
                  <span>
                    <strong>Diatónico (Tonal):</strong> Solo notas dentro de la escala actual.
                    <br />
                    Fila inferior = octava baja. Fila intermedia = octava alta.
                    <br />
                    <em>W sigue parando la reproducción.</em>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* SECCIÓN 3: SUGERENCIAS ARMÓNICAS */}
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
          <div className="settings-row" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.35', display: 'block', padding: '2px 4px', marginTop: '4px' }}>
            {isAutoSuggestions ? (
              <span>Las sugerencias se actualizan automáticamente al editar acordes.</span>
            ) : (
              <span>
                Las sugerencias son <strong>manuales</strong>: usa el botón{' '}
                <RefreshCw size={11} style={{ display: 'inline', verticalAlign: '-2px' }} /> en la paleta de acordes.
              </span>
            )}
          </div>
        </div>

        {/* SECCIÓN 4: COMPÁS & RITMO */}
        <div className="settings-section">
          <div className="settings-section-title">
            <Music size={12} style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline' }} />
            Métrica, Octava & Ritmo
          </div>
          <div className="switch-container">
            <span className="settings-label">Compás (Sign.)</span>
            <CustomSelect
              value={timeSignature}
              onChange={(val) => setTimeSignature(val as any)}
              options={TIME_SIG_OPTIONS}
              style={{ width: '136px' }}
            />
          </div>

          <div className="switch-container">
            <span className="settings-label">Transponer Acordes</span>
            <CustomSelect
              value={chordOctaveShift.toString()}
              onChange={(val) => setChordOctaveShift(parseInt(val, 10))}
              options={OCTAVE_SHIFT_OPTIONS}
              style={{ width: '136px' }}
            />
          </div>

          <div className="settings-row" style={{ marginTop: '6px' }}>
            <span className="settings-label">Swing Ratio</span>
            <input
              type="range"
              min="0"
              max="100"
              value={swing}
              onChange={(e) => setSwing(parseInt(e.target.value, 10))}
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
            <CustomSelect
              value={pattern}
              onChange={(val) => setPattern(val)}
              groups={patternGroups}
              style={{ width: '136px' }}
            />
          </div>
        </div>

        {/* ACCESO DIRECTO A GUÍA DE ATAJOS */}
        <div className="settings-footer-actions">
          <button
            type="button"
            className="settings-shortcuts-btn"
            onClick={() => {
              setSettingsOpen(false);
              setCommandPaletteMode('shortcuts');
            }}
          >
            <Keyboard size={13} />
            <span>Ver Guía de Atajos (?)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
