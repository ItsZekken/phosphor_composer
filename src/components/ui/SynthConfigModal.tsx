/**
 * SynthConfigModal.tsx
 * Interfaz de Sintetizador Analógico Virtual de nivel profesional para Phosphor Composer.
 * Módulos: Multi-Osciladores con Mixer, Filtro VCF con curva interactiva, Doble Envolvente (Amp & Filter),
 * Modulación LFO, Rack de FX (Chorus, Delay, Reverb), Guardado/Exportación de Presets y Osciloscopio Aislado por Canal.
 * Filosofía: 0 Emojis, diseño técnico y lenguaje visual mínimo basado en iconografía precisa.
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import {
  X,
  Sliders,
  Activity,
  Radio,
  Play,
  RotateCcw,
  Waves,
  Layers,
  Volume2,
  Flame,
  Clock,
  Compass,
  Save,
  Download,
  Upload,
  Zap
} from 'lucide-react';
import { toneEngine } from '../../audio/toneEngine';
import { RotaryKnob } from './RotaryKnob';
import {
  SYNTH_PRESETS,
  DEFAULT_SYNTH_SETTINGS,
  getUserPresets,
  saveUserPreset,
  exportPresetToJson,
  importPresetFromJson,
  normalizeSynthSettings,
  type SynthPresetDef
} from '../../core/audio/engine/synthPresets';
import type {
  OscWaveType,
  SynthSettings,
  OscConfig,
  SubOscConfig,
  NoiseConfig,
  FilterConfig,
  ADSRConfig,
  LFOConfig,
  SynthFXConfig
} from '../../utils/typeDefinitions';

export const SynthConfigModal: React.FC = () => {
  const isSynthModalOpen = useSongStore((state) => state.isSynthModalOpen);
  const setSynthModalOpen = useSongStore((state) => state.setSynthModalOpen);
  const editingChannelId = useSongStore((state) => state.editingChannelId);
  const setChannelSynthSettings = useSongStore((state) => state.setChannelSynthSettings);
  const currentKey = useSongStore((state) => state.key || 'C');

  const targetChannelId = editingChannelId || 'chords';
  const targetChannel = useSongStore((state) => state.channels[targetChannelId] || state.channels['chords']);

  const scopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const filterSvgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDraggingFilterNode, setIsDraggingFilterNode] = useState(false);
  const [scopeMode, setScopeMode] = useState<'wave' | 'fft'>('wave');
  const [activeEnvTab, setActiveEnvTab] = useState<'amp' | 'filter'>('amp');
  const [userPresets, setUserPresets] = useState<SynthPresetDef[]>(() => getUserPresets());
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState('');

  const synthSettings: SynthSettings = useMemo(() => {
    return normalizeSynthSettings(targetChannel?.synthSettings);
  }, [targetChannel?.synthSettings]);

  // 1. Osciloscopio y Espectro FFT Aislado Exclusivo del Canal (Buffer reutilizado para cero GC)
  useEffect(() => {
    if (!isSynthModalOpen) return;

    let animId: number;
    const canvas = scopeCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Buffers instanciados una sola vez fuera del bucle de animación
    const waveBuffer = new Float32Array(512);
    const fftBuffer = new Float32Array(64);

    const drawScope = () => {
      const width = canvas.width;
      const height = canvas.height;

      ctx.fillStyle = '#060807';
      ctx.fillRect(0, 0, width, height);

      // Retícula de cuadrícula CRT
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x += 24) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += 16) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Línea central
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      if (scopeMode === 'wave') {
        // Forma de onda en tiempo real del canal
        toneEngine.getChannelWaveformData(targetChannelId, waveBuffer);

        ctx.strokeStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 6;
        ctx.lineWidth = 2;
        ctx.beginPath();

        const sliceWidth = width / waveBuffer.length;
        let x = 0;

        for (let i = 0; i < waveBuffer.length; i++) {
          const v = waveBuffer[i];
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
      } else {
        // Espectro de frecuencias FFT del canal
        toneEngine.getChannelFrequencyData(targetChannelId, fftBuffer);

        const barWidth = width / fftBuffer.length;
        for (let i = 0; i < fftBuffer.length; i++) {
          const db = fftBuffer[i];
          const normHeight = Math.max(0, Math.min(1, (db + 100) / 100));
          const barHeight = normHeight * height;

          const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
          gradient.addColorStop(0, '#ff00aa');
          gradient.addColorStop(0.5, '#a855f7');
          gradient.addColorStop(1, '#00e5ff');

          ctx.fillStyle = gradient;
          ctx.fillRect(i * barWidth + 1, height - barHeight, barWidth - 2, barHeight);
        }
      }

      animId = requestAnimationFrame(drawScope);
    };

    drawScope();

    return () => {
      cancelAnimationFrame(animId);
      toneEngine.disconnectSynthAnalysers();
    };
  }, [isSynthModalOpen, targetChannelId, scopeMode]);

  // Actualización de configuración (sin reproducir sonido preview al modificar parámetros)
  const updateSettings = useCallback(
    (partial: Partial<SynthSettings>, preservePresetName = false) => {
      const updated = normalizeSynthSettings({
        ...synthSettings,
        ...partial,
        presetName: preservePresetName ? partial.presetName || synthSettings.presetName : 'CUSTOM'
      });
      setChannelSynthSettings(targetChannelId, updated);
      toneEngine.updateSynthSettings(updated, targetChannelId);
    },
    [synthSettings, setChannelSynthSettings, targetChannelId]
  );

  // Funciones de actualización fuertemente tipadas
  const updateOsc1 = useCallback(
    (partial: Partial<OscConfig>) => {
      const base = synthSettings.osc1 || DEFAULT_SYNTH_SETTINGS.osc1!;
      updateSettings({
        osc1: {
          enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
          waveType: partial.waveType || base.waveType,
          octave: partial.octave !== undefined ? partial.octave : base.octave,
          semi: partial.semi !== undefined ? partial.semi : base.semi,
          detune: partial.detune !== undefined ? partial.detune : base.detune,
          volume: partial.volume !== undefined ? partial.volume : base.volume,
          pulseWidth: partial.pulseWidth !== undefined ? partial.pulseWidth : base.pulseWidth
        }
      });
    },
    [synthSettings.osc1, updateSettings]
  );

  const updateOsc2 = useCallback(
    (partial: Partial<OscConfig>) => {
      const base = synthSettings.osc2 || DEFAULT_SYNTH_SETTINGS.osc2!;
      updateSettings({
        osc2: {
          enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
          waveType: partial.waveType || base.waveType,
          octave: partial.octave !== undefined ? partial.octave : base.octave,
          semi: partial.semi !== undefined ? partial.semi : base.semi,
          detune: partial.detune !== undefined ? partial.detune : base.detune,
          volume: partial.volume !== undefined ? partial.volume : base.volume,
          pulseWidth: partial.pulseWidth !== undefined ? partial.pulseWidth : base.pulseWidth
        }
      });
    },
    [synthSettings.osc2, updateSettings]
  );

  const updateSubOsc = useCallback(
    (partial: Partial<SubOscConfig>) => {
      const base = synthSettings.subOsc || DEFAULT_SYNTH_SETTINGS.subOsc!;
      updateSettings({
        subOsc: {
          enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
          waveType: partial.waveType || base.waveType,
          octave: partial.octave !== undefined ? partial.octave : base.octave,
          volume: partial.volume !== undefined ? partial.volume : base.volume
        }
      });
    },
    [synthSettings.subOsc, updateSettings]
  );

  const updateNoise = useCallback(
    (partial: Partial<NoiseConfig>) => {
      const base = synthSettings.noise || DEFAULT_SYNTH_SETTINGS.noise!;
      updateSettings({
        noise: {
          enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
          type: partial.type || base.type,
          volume: partial.volume !== undefined ? partial.volume : base.volume
        }
      });
    },
    [synthSettings.noise, updateSettings]
  );

  const updateFilter = useCallback(
    (partial: Partial<FilterConfig>) => {
      const base = synthSettings.filter;
      updateSettings({
        filter: {
          enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
          type: partial.type || base.type,
          frequency: partial.frequency !== undefined ? partial.frequency : base.frequency,
          Q: partial.Q !== undefined ? partial.Q : base.Q,
          rolloff: partial.rolloff !== undefined ? partial.rolloff : base.rolloff,
          drive: partial.drive !== undefined ? partial.drive : base.drive,
          envAmount: partial.envAmount !== undefined ? partial.envAmount : base.envAmount,
          keyTracking: partial.keyTracking !== undefined ? partial.keyTracking : base.keyTracking
        }
      });
    },
    [synthSettings.filter, updateSettings]
  );

  const updateAmpEnv = useCallback(
    (partial: Partial<ADSRConfig>) => {
      const base = synthSettings.envelope;
      updateSettings({
        envelope: {
          attack: partial.attack !== undefined ? partial.attack : base.attack,
          decay: partial.decay !== undefined ? partial.decay : base.decay,
          sustain: partial.sustain !== undefined ? partial.sustain : base.sustain,
          release: partial.release !== undefined ? partial.release : base.release
        }
      });
    },
    [synthSettings.envelope, updateSettings]
  );

  const updateFilterEnv = useCallback(
    (partial: Partial<ADSRConfig>) => {
      const base = synthSettings.filterEnv || DEFAULT_SYNTH_SETTINGS.filterEnv!;
      updateSettings({
        filterEnv: {
          attack: partial.attack !== undefined ? partial.attack : base.attack,
          decay: partial.decay !== undefined ? partial.decay : base.decay,
          sustain: partial.sustain !== undefined ? partial.sustain : base.sustain,
          release: partial.release !== undefined ? partial.release : base.release
        }
      });
    },
    [synthSettings.filterEnv, updateSettings]
  );

  const updateLfo = useCallback(
    (partial: Partial<LFOConfig>) => {
      const base = synthSettings.lfo || DEFAULT_SYNTH_SETTINGS.lfo!;
      updateSettings({
        lfo: {
          enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
          waveType: partial.waveType || base.waveType,
          rate: partial.rate !== undefined ? partial.rate : base.rate,
          depth: partial.depth !== undefined ? partial.depth : base.depth,
          target: partial.target || base.target
        }
      });
    },
    [synthSettings.lfo, updateSettings]
  );

  const updateChorus = useCallback(
    (partial: Partial<SynthFXConfig['chorus']>) => {
      const baseFx = synthSettings.fx || DEFAULT_SYNTH_SETTINGS.fx!;
      const base = baseFx.chorus;
      updateSettings({
        fx: {
          ...baseFx,
          chorus: {
            enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
            depth: partial.depth !== undefined ? partial.depth : base.depth,
            rate: partial.rate !== undefined ? partial.rate : base.rate,
            mix: partial.mix !== undefined ? partial.mix : base.mix
          }
        }
      });
    },
    [synthSettings.fx, updateSettings]
  );

  const updateDelay = useCallback(
    (partial: Partial<SynthFXConfig['delay']>) => {
      const baseFx = synthSettings.fx || DEFAULT_SYNTH_SETTINGS.fx!;
      const base = baseFx.delay;
      updateSettings({
        fx: {
          ...baseFx,
          delay: {
            enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
            time: partial.time !== undefined ? partial.time : base.time,
            feedback: partial.feedback !== undefined ? partial.feedback : base.feedback,
            mix: partial.mix !== undefined ? partial.mix : base.mix
          }
        }
      });
    },
    [synthSettings.fx, updateSettings]
  );

  const updateReverb = useCallback(
    (partial: Partial<SynthFXConfig['reverb']>) => {
      const baseFx = synthSettings.fx || DEFAULT_SYNTH_SETTINGS.fx!;
      const base = baseFx.reverb;
      updateSettings({
        fx: {
          ...baseFx,
          reverb: {
            enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
            decay: partial.decay !== undefined ? partial.decay : base.decay,
            mix: partial.mix !== undefined ? partial.mix : base.mix
          }
        }
      });
    },
    [synthSettings.fx, updateSettings]
  );

  // Probar nota tónica de la escala actual en octava 4
  const handleTestTone = () => {
    const tonic = `${currentKey}4`;
    toneEngine.playNotePreview(tonic, targetChannelId);
  };

  const handleApplyPreset = (presetId: string) => {
    const allPresets = [...SYNTH_PRESETS, ...userPresets];
    const found = allPresets.find((p) => p.id === presetId);
    if (found) {
      const fullPreset = normalizeSynthSettings({ ...found.settings, presetName: found.name });
      setChannelSynthSettings(targetChannelId, fullPreset);
      toneEngine.updateSynthSettings(fullPreset, targetChannelId);
    }
  };

  const handleOpenSaveModal = () => {
    setSavePresetName(synthSettings.presetName === 'CUSTOM' ? '' : synthSettings.presetName || '');
    setIsSaveModalOpen(true);
  };

  const handleConfirmSavePreset = () => {
    const name = savePresetName.trim() || 'Mi Preset';
    const saved = saveUserPreset(name, synthSettings);
    setUserPresets(getUserPresets());
    const fullPreset = normalizeSynthSettings({ ...synthSettings, presetName: saved.name });
    setChannelSynthSettings(targetChannelId, fullPreset);
    toneEngine.updateSynthSettings(fullPreset, targetChannelId);
    setIsSaveModalOpen(false);
  };

  const handleExportPreset = () => {
    exportPresetToJson(synthSettings, synthSettings.presetName || 'Mi_Preset');
  };

  const handleImportPresetClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileImported = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const imported = importPresetFromJson(content);
      if (imported) {
        saveUserPreset(imported.name, imported.settings as SynthSettings);
        setUserPresets(getUserPresets());
        const fullPreset = normalizeSynthSettings({ ...imported.settings, presetName: imported.name });
        setChannelSynthSettings(targetChannelId, fullPreset);
        toneEngine.updateSynthSettings(fullPreset, targetChannelId);
      }
    };
    reader.readAsText(file);
  };

  if (!isSynthModalOpen) return null;

  // Interacción gráfica con la curva del filtro VCF
  const handleFilterSvgInteraction = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = filterSvgRef.current;
    if (!svg || !synthSettings.filter.enabled) return;

    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const normX = x / rect.width;
    const freq = Math.round(20 * Math.pow(1000, normX));

    const normY = 1 - y / rect.height;
    const qVal = parseFloat((0.5 + normY * 15.5).toFixed(1));

    updateFilter({
      frequency: Math.max(20, Math.min(20000, freq)),
      Q: Math.max(0.5, Math.min(16, qVal))
    });
  };

  // Coordenadas para la curva del filtro SVG
  const svgWidth = 320;
  const svgHeight = 90;
  const cutoffNorm = Math.max(0, Math.min(1, Math.log(synthSettings.filter.frequency / 20) / Math.log(1000)));
  const nodeX = cutoffNorm * svgWidth;
  const qNorm = Math.max(0, Math.min(1, (synthSettings.filter.Q - 0.5) / 15.5));
  const nodeY = (1 - qNorm) * (svgHeight * 0.7) + svgHeight * 0.15;

  // Renderizador de Curva ADSR
  const currentEnv = activeEnvTab === 'amp' ? synthSettings.envelope : (synthSettings.filterEnv || synthSettings.envelope);
  const totalEnvTime = currentEnv.attack + currentEnv.decay + currentEnv.release + 0.5;
  const envSvgWidth = 320;
  const envSvgHeight = 70;
  const pA_X = (currentEnv.attack / totalEnvTime) * (envSvgWidth * 0.85);
  const pA_Y = 10;
  const pD_X = pA_X + (currentEnv.decay / totalEnvTime) * (envSvgWidth * 0.85);
  const pD_Y = envSvgHeight - 10 - currentEnv.sustain * (envSvgHeight - 20);
  const pS_X = pD_X + (0.5 / totalEnvTime) * (envSvgWidth * 0.85);
  const pS_Y = pD_Y;
  const pR_X = Math.min(envSvgWidth - 5, pS_X + (currentEnv.release / totalEnvTime) * (envSvgWidth * 0.85));
  const pR_Y = envSvgHeight - 10;

  const envPathD = `M 10 ${envSvgHeight - 10} L ${Math.max(12, pA_X)} ${pA_Y} L ${Math.max(pA_X + 2, pD_X)} ${pD_Y} L ${pS_X} ${pS_Y} L ${pR_X} ${pR_Y}`;

  // Formas de onda con íconos vectoriales
  const waveOptions: { type: OscWaveType; label: string; symbol: string }[] = [
    { type: 'sine', label: 'SIN', symbol: '~' },
    { type: 'triangle', label: 'TRI', symbol: '/\\' },
    { type: 'sawtooth', label: 'SAW', symbol: '/|' },
    { type: 'square', label: 'SQR', symbol: '|_|' },
    { type: 'pulse', label: 'PLS', symbol: '|-|' }
  ];

  const currentPresetVal = synthSettings.presetName === 'CUSTOM' ? 'CUSTOM' : synthSettings.presetName || 'CUSTOM';

  return (
    <div className="synth-modal-overlay" onClick={() => setSynthModalOpen(false)}>
      <div className="synth-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Input oculto para importación de presets */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleFileImported}
        />

        {/* Modal de Guardar Preset */}
        {isSaveModalOpen && (
          <div className="synth-save-modal-overlay" onClick={() => setIsSaveModalOpen(false)}>
            <div className="synth-save-modal" onClick={(e) => e.stopPropagation()}>
              <div className="save-modal-title">
                <Save size={14} />
                <span>GUARDAR PRESET</span>
              </div>
              <input
                type="text"
                className="save-preset-input"
                placeholder="Nombre del preset..."
                value={savePresetName}
                onChange={(e) => setSavePresetName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmSavePreset();
                  if (e.key === 'Escape') setIsSaveModalOpen(false);
                }}
              />
              <div className="save-modal-actions">
                <button className="save-btn-cancel" onClick={() => setIsSaveModalOpen(false)}>
                  CANCELAR
                </button>
                <button className="save-btn-confirm" onClick={handleConfirmSavePreset}>
                  GUARDAR
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= HEADER ANALÓGICO ================= */}
        <div className="synth-modal-header">
          <div className="synth-header-left">
            <div className="synth-brand-tag">
              <Activity className="header-icon pulse-icon" size={15} />
              <span>PHOSPHOR // {targetChannel.name.toUpperCase()}</span>
            </div>

            {/* BARRA DE PRESETS (SIN ÍCONO SPARKLES) */}
            <div className="synth-preset-picker-wrap">
              <select
                className="synth-preset-select"
                value={currentPresetVal}
                onChange={(e) => handleApplyPreset(e.target.value)}
                title="Seleccionar Preset"
              >
                <option value="CUSTOM">
                  {currentPresetVal === 'CUSTOM' ? 'CUSTOM' : 'PERSONALIZADO'}
                </option>
                {userPresets.length > 0 && (
                  <optgroup label="PRESETS DE USUARIO">
                    {userPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="PRESETS DE FÁBRICA">
                  {SYNTH_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name.toUpperCase()} [{p.category.toUpperCase()}]
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* BOTONES DE GESTIÓN DE PRESETS: GUARDAR, EXPORTAR, IMPORTAR */}
            <button
              className="synth-action-btn"
              onClick={handleOpenSaveModal}
              title="Guardar Preset Actual"
            >
              <Save size={11} />
              <span>GUARDAR</span>
            </button>
            <button
              className="synth-action-btn"
              onClick={handleExportPreset}
              title="Exportar Preset a Archivo JSON"
            >
              <Download size={11} />
              <span>EXPORTAR</span>
            </button>
            <button
              className="synth-action-btn"
              onClick={handleImportPresetClick}
              title="Importar Preset desde Archivo JSON"
            >
              <Upload size={11} />
              <span>IMPORTAR</span>
            </button>
          </div>

          <div className="synth-header-right">
            {/* BOTÓN TEST: SIN 'C4', DISPARA NOTA TÓNICA DE LA ESCALA ACTUAL */}
            <button
              className="synth-action-btn synth-test-btn"
              onClick={handleTestTone}
              title="Probar nota tónica en tiempo real"
            >
              <Play size={11} />
              <span>PROBAR</span>
            </button>
            <button
              className="synth-action-btn"
              onClick={() => handleApplyPreset('init')}
              title="Reiniciar a Init Patch"
            >
              <RotateCcw size={11} />
              <span>INIT</span>
            </button>
            <button
              className="synth-close-btn"
              onClick={() => setSynthModalOpen(false)}
              title="Cerrar Sintetizador"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ================= OSCILOSCOPIO AISLADO POR CANAL ================= */}
        <div className="synth-scope-section">
          <div className="synth-scope-topbar">
            <div className="scope-title-badge">
              <Radio size={12} />
              <span>CANAL // {targetChannel.id.toUpperCase()}</span>
            </div>
            <div className="scope-mode-tabs">
              <button
                className={`scope-mode-btn ${scopeMode === 'wave' ? 'active' : ''}`}
                onClick={() => setScopeMode('wave')}
                title="Osciloscopio Forma de Onda"
              >
                <Waves size={11} /> OSC
              </button>
              <button
                className={`scope-mode-btn ${scopeMode === 'fft' ? 'active' : ''}`}
                onClick={() => setScopeMode('fft')}
                title="Espectro de Frecuencias FFT"
              >
                <Activity size={11} /> FFT
              </button>
            </div>
          </div>
          <canvas
            ref={scopeCanvasRef}
            width={740}
            height={68}
            className="synth-scope-canvas"
          />
        </div>

        {/* ================= RACK DE MÓDULOS ANALÓGICOS ================= */}
        <div className="synth-modal-rack">
          {/* ---------------- MÓDULO 1: OSCILADORES Y MIXER ---------------- */}
          <div className="synth-rack-module module-oscillators">
            <div className="module-title">
              <span><Layers size={13} /> I. OSC / MIXER</span>
              <span className="module-tag">ANALOG MULTI-VOICE</span>
            </div>
            <div className="module-content">
              {/* OSC 1 */}
              <div className="osc-block">
                <div className="osc-header">
                  <span className="osc-label">OSC 1</span>
                  <div className="oct-semi-selector">
                    <span className="param-tag">OCT</span>
                    {[-2, -1, 0, 1, 2].map((oct) => (
                      <button
                        key={oct}
                        className={`step-btn ${synthSettings.osc1?.octave === oct ? 'active' : ''}`}
                        onClick={() => updateOsc1({ octave: oct })}
                      >
                        {oct > 0 ? `+${oct}` : oct}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="wave-icon-grid">
                  {waveOptions.map((w) => (
                    <button
                      key={w.type}
                      className={`wave-icon-btn ${synthSettings.osc1?.waveType === w.type ? 'active' : ''}`}
                      onClick={() =>
                        updateSettings({
                          waveType: w.type === 'pulse' ? 'square' : w.type,
                          osc1: { ...(synthSettings.osc1 || DEFAULT_SYNTH_SETTINGS.osc1!), waveType: w.type }
                        })
                      }
                      title={`${w.label} Wave`}
                    >
                      <span className="wave-glyph">{w.symbol}</span>
                      <span className="wave-txt">{w.label}</span>
                    </button>
                  ))}
                </div>

                <div className="knob-row">
                  <RotaryKnob
                    label="FINE"
                    unit="c"
                    value={synthSettings.osc1?.detune ?? 0}
                    min={-50}
                    max={50}
                    step={1}
                    defaultValue={0}
                    size={34}
                    onChange={(v) => {
                      updateSettings({ detune: v });
                      updateOsc1({ detune: v });
                    }}
                  />
                  <RotaryKnob
                    label="SEMI"
                    unit="st"
                    value={synthSettings.osc1?.semi ?? 0}
                    min={-12}
                    max={12}
                    step={1}
                    defaultValue={0}
                    size={34}
                    onChange={(v) => updateOsc1({ semi: v })}
                  />
                  <RotaryKnob
                    label="MIX 1"
                    unit="%"
                    value={Math.round((synthSettings.osc1?.volume ?? 0.8) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={80}
                    size={36}
                    accentColor="#00e5ff"
                    onChange={(v) => updateOsc1({ volume: v / 100 })}
                  />
                </div>
              </div>

              {/* OSC 2 */}
              <div className="osc-block" style={{ marginTop: '10px' }}>
                <div className="osc-header">
                  <label className="switch-led-container">
                    <span className={`led-indicator ${synthSettings.osc2?.enabled ? 'on' : ''}`}></span>
                    <input
                      type="checkbox"
                      checked={Boolean(synthSettings.osc2?.enabled)}
                      onChange={(e) => updateOsc2({ enabled: e.target.checked })}
                      style={{ display: 'none' }}
                      id="osc2-power"
                    />
                    <label htmlFor="osc2-power" className="osc-label clickable">
                      OSC 2 {synthSettings.osc2?.enabled ? 'ON' : 'OFF'}
                    </label>
                  </label>

                  <div className="oct-semi-selector">
                    <span className="param-tag">OCT</span>
                    {[-2, -1, 0, 1, 2].map((oct) => (
                      <button
                        key={oct}
                        disabled={!synthSettings.osc2?.enabled}
                        className={`step-btn ${synthSettings.osc2?.octave === oct ? 'active' : ''}`}
                        onClick={() => updateOsc2({ octave: oct })}
                      >
                        {oct > 0 ? `+${oct}` : oct}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={`wave-icon-grid ${!synthSettings.osc2?.enabled ? 'disabled-grid' : ''}`}>
                  {waveOptions.map((w) => (
                    <button
                      key={w.type}
                      disabled={!synthSettings.osc2?.enabled}
                      className={`wave-icon-btn ${synthSettings.osc2?.waveType === w.type ? 'active' : ''}`}
                      onClick={() => updateOsc2({ waveType: w.type })}
                      title={`${w.label} Wave`}
                    >
                      <span className="wave-glyph">{w.symbol}</span>
                      <span className="wave-txt">{w.label}</span>
                    </button>
                  ))}
                </div>

                <div className="knob-row">
                  <RotaryKnob
                    label="FINE"
                    unit="c"
                    disabled={!synthSettings.osc2?.enabled}
                    value={synthSettings.osc2?.detune ?? 0}
                    min={-50}
                    max={50}
                    step={1}
                    defaultValue={6}
                    size={34}
                    onChange={(v) => updateOsc2({ detune: v })}
                  />
                  <RotaryKnob
                    label="SEMI"
                    unit="st"
                    disabled={!synthSettings.osc2?.enabled}
                    value={synthSettings.osc2?.semi ?? 0}
                    min={-12}
                    max={12}
                    step={1}
                    defaultValue={0}
                    size={34}
                    onChange={(v) => updateOsc2({ semi: v })}
                  />
                  <RotaryKnob
                    label="MIX 2"
                    unit="%"
                    disabled={!synthSettings.osc2?.enabled}
                    value={Math.round((synthSettings.osc2?.volume ?? 0.4) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={40}
                    size={36}
                    accentColor="#ff00aa"
                    onChange={(v) => updateOsc2({ volume: v / 100 })}
                  />
                </div>
              </div>

              {/* SUB OSC & NOISE & GLIDE */}
              <div className="sub-noise-row">
                <div className="sub-box">
                  <label className="switch-led-container">
                    <span className={`led-indicator ${synthSettings.subOsc?.enabled ? 'on' : ''}`}></span>
                    <input
                      type="checkbox"
                      checked={Boolean(synthSettings.subOsc?.enabled)}
                      onChange={(e) => updateSubOsc({ enabled: e.target.checked })}
                      style={{ display: 'none' }}
                      id="sub-toggle"
                    />
                    <label htmlFor="sub-toggle" className="field-label clickable">
                      SUB -1OCT
                    </label>
                  </label>
                  <RotaryKnob
                    label="SUB"
                    unit="%"
                    disabled={!synthSettings.subOsc?.enabled}
                    value={Math.round((synthSettings.subOsc?.volume ?? 0) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={0}
                    size={32}
                    accentColor="#38bdf8"
                    onChange={(v) => updateSubOsc({ volume: v / 100 })}
                  />
                </div>

                <div className="sub-box">
                  <label className="switch-led-container">
                    <span className={`led-indicator ${synthSettings.noise?.enabled ? 'on' : ''}`}></span>
                    <input
                      type="checkbox"
                      checked={Boolean(synthSettings.noise?.enabled)}
                      onChange={(e) => updateNoise({ enabled: e.target.checked })}
                      style={{ display: 'none' }}
                      id="noise-toggle"
                    />
                    <label htmlFor="noise-toggle" className="field-label clickable">
                      NOISE
                    </label>
                  </label>
                  <RotaryKnob
                    label="NOISE"
                    unit="%"
                    disabled={!synthSettings.noise?.enabled}
                    value={Math.round((synthSettings.noise?.volume ?? 0) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={0}
                    size={32}
                    accentColor="#a855f7"
                    onChange={(v) => updateNoise({ volume: v / 100 })}
                  />
                </div>

                <div className="sub-box">
                  <span className="field-label">GLIDE</span>
                  <RotaryKnob
                    label="PORTA"
                    unit="s"
                    value={parseFloat((synthSettings.glide ?? 0).toFixed(2))}
                    min={0}
                    max={0.5}
                    step={0.01}
                    defaultValue={0}
                    size={32}
                    accentColor="#fbbf24"
                    onChange={(v) => updateSettings({ glide: v })}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ---------------- MÓDULO 2: FILTRO VCF ANALÓGICO ---------------- */}
          <div className="synth-rack-module module-filter">
            <div className="module-title">
              <span><Flame size={13} /> II. FILTRO VCF</span>
              <label className="switch-led-container">
                <span className={`led-indicator ${synthSettings.filter.enabled ? 'on' : ''}`}></span>
                <input
                  type="checkbox"
                  checked={Boolean(synthSettings.filter.enabled)}
                  onChange={(e) => updateFilter({ enabled: e.target.checked })}
                  style={{ display: 'none' }}
                  id="filter-toggle"
                />
                <label htmlFor="filter-toggle" className="bypass-label">
                  {synthSettings.filter.enabled ? 'VCF ON' : 'BYPASS'}
                </label>
              </label>
            </div>
            <div className={`module-content ${synthSettings.filter.enabled ? '' : 'module-bypassed'}`}>
              {/* Gráfico Interactivo de Respuesta en Frecuencia */}
              <div className="filter-graph-wrapper">
                <div className="graph-header">
                  <span>RESPUESTA EN FRECUENCIA</span>
                  <span>{synthSettings.filter.frequency} Hz // Q: {synthSettings.filter.Q.toFixed(1)}</span>
                </div>
                <svg
                  ref={filterSvgRef}
                  width={svgWidth}
                  height={svgHeight}
                  className="filter-svg-canvas"
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
                    d={`M 0 ${svgHeight * 0.5} Q ${nodeX * 0.85} ${svgHeight * 0.5}, ${nodeX} ${nodeY} T ${svgWidth} ${svgHeight * 0.95}`}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="2.5"
                    style={{ filter: 'drop-shadow(0 0 6px #a855f7)' }}
                  />
                  {/* Nodo Interactivo */}
                  <circle
                    cx={nodeX}
                    cy={nodeY}
                    r="6.5"
                    fill="#ff00aa"
                    stroke="#fff"
                    strokeWidth="2"
                    style={{ filter: 'drop-shadow(0 0 8px #ff00aa)' }}
                  />
                </svg>
              </div>

              {/* Selector de Tipo y Rolloff */}
              <div className="filter-type-grid">
                {[
                  { id: 'lowpass', label: 'LP 12dB', rolloff: -12 },
                  { id: 'lowpass-24', label: 'LP 24dB', type: 'lowpass', rolloff: -24 },
                  { id: 'highpass', label: 'HP', rolloff: -12 },
                  { id: 'bandpass', label: 'BP', rolloff: -12 },
                  { id: 'notch', label: 'NOTCH', rolloff: -12 }
                ].map((item) => {
                  const isActive =
                    item.id === 'lowpass-24'
                      ? synthSettings.filter.type === 'lowpass' && synthSettings.filter.rolloff === -24
                      : synthSettings.filter.type === (item.type || item.id) &&
                        (synthSettings.filter.rolloff !== -24 || item.id === 'lowpass-24');
                  return (
                    <button
                      key={item.id}
                      className={`filter-type-pill ${isActive ? 'active' : ''}`}
                      disabled={!synthSettings.filter.enabled}
                      onClick={() =>
                        updateFilter({
                          type: (item.type || item.id) as any,
                          rolloff: item.rolloff as any
                        })
                      }
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {/* Perillas del Filtro */}
              <div className="filter-knobs-grid">
                <RotaryKnob
                  label="CUTOFF"
                  unit="Hz"
                  logScale
                  disabled={!synthSettings.filter.enabled}
                  value={synthSettings.filter.frequency}
                  min={20}
                  max={20000}
                  step={10}
                  defaultValue={4500}
                  size={42}
                  accentColor="#a855f7"
                  onChange={(v) => updateFilter({ frequency: v })}
                />
                <RotaryKnob
                  label="RESO (Q)"
                  disabled={!synthSettings.filter.enabled}
                  value={synthSettings.filter.Q}
                  min={0.1}
                  max={20}
                  step={0.1}
                  defaultValue={2.0}
                  size={42}
                  accentColor="#a855f7"
                  onChange={(v) => updateFilter({ Q: v })}
                />
                <RotaryKnob
                  label="ENV MOD"
                  unit="%"
                  disabled={!synthSettings.filter.enabled}
                  value={Math.round((synthSettings.filter.envAmount ?? 0.3) * 100)}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={30}
                  size={36}
                  accentColor="#ec4899"
                  onChange={(v) => updateFilter({ envAmount: v / 100 })}
                />
                <RotaryKnob
                  label="DRIVE"
                  unit="%"
                  disabled={!synthSettings.filter.enabled}
                  value={Math.round((synthSettings.filter.drive ?? 0.1) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={10}
                  size={36}
                  accentColor="#f97316"
                  onChange={(v) => updateFilter({ drive: v / 100 })}
                />
                <RotaryKnob
                  label="KEY TRK"
                  unit="%"
                  disabled={!synthSettings.filter.enabled}
                  value={Math.round((synthSettings.filter.keyTracking ?? 0.5) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={50}
                  size={36}
                  accentColor="#eab308"
                  onChange={(v) => updateFilter({ keyTracking: v / 100 })}
                />
              </div>
            </div>
          </div>

          {/* ---------------- MÓDULO 3: DOBLE ENVOLVENTE ADSR ---------------- */}
          <div className="synth-rack-module module-envelope">
            <div className="module-title">
              <span><Clock size={13} /> III. ENVOLVENTES</span>
              <div className="env-subtab-pills">
                <button
                  className={`env-tab-btn ${activeEnvTab === 'amp' ? 'active' : ''}`}
                  onClick={() => setActiveEnvTab('amp')}
                >
                  AMP ADSR
                </button>
                <button
                  className={`env-tab-btn ${activeEnvTab === 'filter' ? 'active' : ''}`}
                  onClick={() => setActiveEnvTab('filter')}
                >
                  FILTER ADSR
                </button>
              </div>
            </div>
            <div className="module-content">
              {/* Visualizador de Curva ADSR */}
              <div className="env-curve-box">
                <svg width={envSvgWidth} height={envSvgHeight} className="env-svg-canvas">
                  <path
                    d={envPathD}
                    fill="none"
                    stroke={activeEnvTab === 'amp' ? '#00e5ff' : '#ec4899'}
                    strokeWidth="2.5"
                    style={{
                      filter: `drop-shadow(0 0 6px ${activeEnvTab === 'amp' ? '#00e5ff' : '#ec4899'})`
                    }}
                  />
                  {/* Puntos clave */}
                  <circle cx={Math.max(12, pA_X)} cy={pA_Y} r="4" fill="#fff" />
                  <circle cx={pD_X} cy={pD_Y} r="4" fill="#fff" />
                  <circle cx={pS_X} cy={pS_Y} r="4" fill="#fff" />
                  <circle cx={pR_X} cy={pR_Y} r="4" fill="#fff" />
                </svg>
              </div>

              {/* Sliders / Knobs de Envolvente */}
              <div className="adsr-knob-cluster">
                <RotaryKnob
                  label="ATTACK"
                  unit="s"
                  value={currentEnv.attack}
                  min={0.001}
                  max={4.0}
                  step={0.01}
                  defaultValue={activeEnvTab === 'amp' ? 0.05 : 0.02}
                  size={42}
                  accentColor={activeEnvTab === 'amp' ? '#00e5ff' : '#ec4899'}
                  onChange={(v) => {
                    if (activeEnvTab === 'amp') {
                      updateAmpEnv({ attack: v });
                    } else {
                      updateFilterEnv({ attack: v });
                    }
                  }}
                />
                <RotaryKnob
                  label="DECAY"
                  unit="s"
                  value={currentEnv.decay}
                  min={0.001}
                  max={4.0}
                  step={0.01}
                  defaultValue={activeEnvTab === 'amp' ? 0.25 : 0.35}
                  size={42}
                  accentColor={activeEnvTab === 'amp' ? '#00e5ff' : '#ec4899'}
                  onChange={(v) => {
                    if (activeEnvTab === 'amp') {
                      updateAmpEnv({ decay: v });
                    } else {
                      updateFilterEnv({ decay: v });
                    }
                  }}
                />
                <RotaryKnob
                  label="SUSTAIN"
                  unit="%"
                  value={Math.round(currentEnv.sustain * 100)}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={activeEnvTab === 'amp' ? 60 : 30}
                  size={42}
                  accentColor={activeEnvTab === 'amp' ? '#00e5ff' : '#ec4899'}
                  onChange={(v) => {
                    if (activeEnvTab === 'amp') {
                      updateAmpEnv({ sustain: v / 100 });
                    } else {
                      updateFilterEnv({ sustain: v / 100 });
                    }
                  }}
                />
                <RotaryKnob
                  label="RELEASE"
                  unit="s"
                  value={currentEnv.release}
                  min={0.001}
                  max={8.0}
                  step={0.01}
                  defaultValue={activeEnvTab === 'amp' ? 0.8 : 0.6}
                  size={42}
                  accentColor={activeEnvTab === 'amp' ? '#00e5ff' : '#ec4899'}
                  onChange={(v) => {
                    if (activeEnvTab === 'amp') {
                      updateAmpEnv({ release: v });
                    } else {
                      updateFilterEnv({ release: v });
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ================= SECCIÓN INFERIOR: LFO Y RACK FX ================= */}
        <div className="synth-bottom-dock">
          {/* LFO */}
          <div className="dock-module dock-lfo">
            <div className="dock-module-header">
              <label className="switch-led-container">
                <span className={`led-indicator ${synthSettings.lfo?.enabled ? 'on' : ''}`}></span>
                <input
                  type="checkbox"
                  checked={Boolean(synthSettings.lfo?.enabled)}
                  onChange={(e) => updateLfo({ enabled: e.target.checked })}
                  style={{ display: 'none' }}
                  id="lfo-toggle"
                />
                <label htmlFor="lfo-toggle" className="field-label clickable font-bold">
                  <Compass size={12} /> LFO MODULATOR
                </label>
              </label>
              <div className="lfo-target-row">
                {[
                  { id: 'cutoff', label: 'VCF' },
                  { id: 'pitch', label: 'PITCH' },
                  { id: 'amp', label: 'AMP' }
                ].map((t) => (
                  <button
                    key={t.id}
                    disabled={!synthSettings.lfo?.enabled}
                    className={`target-pill ${synthSettings.lfo?.target === t.id ? 'active' : ''}`}
                    onClick={() => updateLfo({ target: t.id as any })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="dock-knob-row">
              <RotaryKnob
                label="RATE"
                unit="Hz"
                disabled={!synthSettings.lfo?.enabled}
                value={synthSettings.lfo?.rate ?? 2.5}
                min={0.1}
                max={20}
                step={0.1}
                defaultValue={2.5}
                size={34}
                accentColor="#38bdf8"
                onChange={(v) => updateLfo({ rate: v })}
              />
              <RotaryKnob
                label="DEPTH"
                unit="%"
                disabled={!synthSettings.lfo?.enabled}
                value={Math.round((synthSettings.lfo?.depth ?? 0.25) * 100)}
                min={0}
                max={100}
                step={1}
                defaultValue={25}
                size={34}
                accentColor="#38bdf8"
                onChange={(v) => updateLfo({ depth: v / 100 })}
              />
            </div>
          </div>

          {/* CHORUS */}
          <div className="dock-module dock-fx">
            <div className="dock-module-header">
              <label className="switch-led-container">
                <span className={`led-indicator ${synthSettings.fx?.chorus?.enabled ? 'on' : ''}`}></span>
                <input
                  type="checkbox"
                  checked={Boolean(synthSettings.fx?.chorus?.enabled)}
                  onChange={(e) => updateChorus({ enabled: e.target.checked })}
                  style={{ display: 'none' }}
                  id="chorus-toggle"
                />
                <label htmlFor="chorus-toggle" className="field-label clickable font-bold">
                  <Zap size={12} /> CHORUS
                </label>
              </label>
            </div>
            <div className="dock-knob-row">
              <RotaryKnob
                label="RATE"
                unit="Hz"
                disabled={!synthSettings.fx?.chorus?.enabled}
                value={synthSettings.fx?.chorus?.rate ?? 1.5}
                min={0.5}
                max={8.0}
                step={0.1}
                defaultValue={1.5}
                size={34}
                accentColor="#a855f7"
                onChange={(v) => updateChorus({ rate: v })}
              />
              <RotaryKnob
                label="MIX"
                unit="%"
                disabled={!synthSettings.fx?.chorus?.enabled}
                value={Math.round((synthSettings.fx?.chorus?.mix ?? 0.3) * 100)}
                min={0}
                max={100}
                step={1}
                defaultValue={30}
                size={34}
                accentColor="#a855f7"
                onChange={(v) => updateChorus({ mix: v / 100 })}
              />
            </div>
          </div>

          {/* DELAY */}
          <div className="dock-module dock-fx">
            <div className="dock-module-header">
              <label className="switch-led-container">
                <span className={`led-indicator ${synthSettings.fx?.delay?.enabled ? 'on' : ''}`}></span>
                <input
                  type="checkbox"
                  checked={Boolean(synthSettings.fx?.delay?.enabled)}
                  onChange={(e) => updateDelay({ enabled: e.target.checked })}
                  style={{ display: 'none' }}
                  id="delay-toggle"
                />
                <label htmlFor="delay-toggle" className="field-label clickable font-bold">
                  <Clock size={12} /> DELAY
                </label>
              </label>
            </div>
            <div className="dock-knob-row">
              <RotaryKnob
                label="FDBK"
                unit="%"
                disabled={!synthSettings.fx?.delay?.enabled}
                value={Math.round((synthSettings.fx?.delay?.feedback ?? 0.25) * 100)}
                min={0}
                max={85}
                step={1}
                defaultValue={25}
                size={34}
                accentColor="#10b981"
                onChange={(v) => updateDelay({ feedback: v / 100 })}
              />
              <RotaryKnob
                label="MIX"
                unit="%"
                disabled={!synthSettings.fx?.delay?.enabled}
                value={Math.round((synthSettings.fx?.delay?.mix ?? 0.2) * 100)}
                min={0}
                max={100}
                step={1}
                defaultValue={20}
                size={34}
                accentColor="#10b981"
                onChange={(v) => updateDelay({ mix: v / 100 })}
              />
            </div>
          </div>

          {/* REVERB */}
          <div className="dock-module dock-fx">
            <div className="dock-module-header">
              <label className="switch-led-container">
                <span className={`led-indicator ${synthSettings.fx?.reverb?.enabled ? 'on' : ''}`}></span>
                <input
                  type="checkbox"
                  checked={Boolean(synthSettings.fx?.reverb?.enabled)}
                  onChange={(e) => updateReverb({ enabled: e.target.checked })}
                  style={{ display: 'none' }}
                  id="reverb-toggle"
                />
                <label htmlFor="reverb-toggle" className="field-label clickable font-bold">
                  <Volume2 size={12} /> REVERB
                </label>
              </label>
            </div>
            <div className="dock-knob-row">
              <RotaryKnob
                label="DECAY"
                unit="s"
                disabled={!synthSettings.fx?.reverb?.enabled}
                value={synthSettings.fx?.reverb?.decay ?? 1.8}
                min={0.5}
                max={5.0}
                step={0.1}
                defaultValue={1.8}
                size={34}
                accentColor="#f59e0b"
                onChange={(v) => updateReverb({ decay: v })}
              />
              <RotaryKnob
                label="MIX"
                unit="%"
                disabled={!synthSettings.fx?.reverb?.enabled}
                value={Math.round((synthSettings.fx?.reverb?.mix ?? 0.15) * 100)}
                min={0}
                max={100}
                step={1}
                defaultValue={15}
                size={34}
                accentColor="#f59e0b"
                onChange={(v) => updateReverb({ mix: v / 100 })}
              />
            </div>
          </div>
        </div>

        {/* ================= FOOTER ================= */}
        <div className="synth-modal-footer">
          <Sliders size={12} style={{ marginRight: '6px' }} />
          <span>PHOSPHOR ANALOG SYNTHESIS MODEL V15 // 64-BIT DSP AUDIO ENGINE</span>
        </div>
      </div>
    </div>
  );
};
