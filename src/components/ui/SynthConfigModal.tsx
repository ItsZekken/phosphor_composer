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
  Zap,
  Copy,
  ClipboardPaste,
  Check
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
  SynthFXConfig,
  SynthEQConfig
} from '../../utils/typeDefinitions';

interface EqCurveResult {
  y1: number;
  y2: number;
  y3: number;
  y4: number;
  path: string;
  fillPath: string;
}

const getEqCurveCoordinates = (low: number, lowMid: number, highMid: number, high: number, enabled: boolean): EqCurveResult => {
  if (!enabled) {
    return {
      y1: 35,
      y2: 35,
      y3: 35,
      y4: 35,
      path: 'M 0 35 L 220 35',
      fillPath: 'M 0 35 L 220 35 L 220 70 L 0 70 Z'
    };
  }
  const getY = (db: number) => Math.max(9, Math.min(61, 35 - (db / 12) * 26));
  const y1 = getY(low);
  const y2 = getY(lowMid);
  const y3 = getY(highMid);
  const y4 = getY(high);
  const path = `M 0 ${y1.toFixed(1)} C 15 ${y1.toFixed(1)}, 20 ${y1.toFixed(1)}, 30 ${y1.toFixed(1)} C 50 ${y1.toFixed(1)}, 62 ${y2.toFixed(1)}, 82 ${y2.toFixed(1)} C 105 ${y2.toFixed(1)}, 118 ${y3.toFixed(1)}, 138 ${y3.toFixed(1)} C 160 ${y3.toFixed(1)}, 175 ${y4.toFixed(1)}, 190 ${y4.toFixed(1)} L 220 ${y4.toFixed(1)}`;
  const fillPath = `${path} L 220 70 L 0 70 Z`;
  return { y1, y2, y3, y4, path, fillPath };
};

const DELAY_DIVISIONS = [
  { id: '16n', label: '1/16' },
  { id: '8n', label: '1/8' },
  { id: '8n.', label: '1/8 D' },
  { id: '4n', label: '1/4' },
  { id: '4n.', label: '1/4 D' },
  { id: '2n', label: '1/2' }
] as const;

export const SynthConfigModal: React.FC = () => {
  const isSynthModalOpen = useSongStore((state) => state.isSynthModalOpen);
  if (!isSynthModalOpen) return null;

  return <SynthConfigModalContent />;
};

const SynthConfigModalContent: React.FC = () => {
  const setSynthModalOpen = useSongStore((state) => state.setSynthModalOpen);
  const editingChannelId = useSongStore((state) => state.editingChannelId);
  const setChannelSynthSettings = useSongStore((state) => state.setChannelSynthSettings);
  const currentKey = useSongStore((state) => state.key || 'C');

  const targetChannelId = editingChannelId || 'chords';
  const targetChannel = useSongStore((state) => state.channels[targetChannelId] || state.channels['chords']);
  const channelName = (targetChannel?.name || targetChannelId || 'SYNTH').toUpperCase();

  const scopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const filterSvgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDraggingFilterNode, setIsDraggingFilterNode] = useState(false);
  const [scopeMode, setScopeMode] = useState<'wave' | 'fft'>('wave');
  const [activeEnvTab, setActiveEnvTab] = useState<'amp' | 'filter'>('amp');
  const [userPresets, setUserPresets] = useState<SynthPresetDef[]>(() => getUserPresets());
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState('');
  const [copiedNotice, setCopiedNotice] = useState(false);

  const synthClipboard = useSongStore((state) => state.synthClipboard);
  const copySynthSettings = useSongStore((state) => state.copySynthSettings);
  const pasteSynthSettings = useSongStore((state) => state.pasteSynthSettings);

  const synthSettings: SynthSettings = useMemo(() => {
    return normalizeSynthSettings(targetChannel?.synthSettings);
  }, [targetChannel?.synthSettings]);

  // 1. Osciloscopio y Espectro FFT Aislado Exclusivo del Canal (Buffer reutilizado para cero GC)
  useEffect(() => {
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
  }, [targetChannelId, scopeMode]);

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
      const nextDetune = partial.detune !== undefined ? partial.detune : base.detune;
      const nextWave = partial.waveType || base.waveType;
      updateSettings({
        detune: nextDetune,
        waveType: nextWave === 'pulse' ? 'square' : nextWave,
        osc1: {
          enabled: partial.enabled !== undefined ? partial.enabled : base.enabled,
          waveType: nextWave,
          octave: partial.octave !== undefined ? partial.octave : base.octave,
          semi: partial.semi !== undefined ? partial.semi : base.semi,
          detune: nextDetune,
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
          driveType: partial.driveType !== undefined ? partial.driveType : (base.driveType || 'tube'),
          envAmount: partial.envAmount !== undefined ? partial.envAmount : base.envAmount,
          keyTracking: partial.keyTracking !== undefined ? partial.keyTracking : base.keyTracking
        }
      });
    },
    [synthSettings.filter, updateSettings]
  );

  const updateMasterGain = useCallback(
    (gain: number) => {
      updateSettings({ masterGain: Math.max(0, Math.min(2.0, gain)) });
    },
    [updateSettings]
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
            mix: partial.mix !== undefined ? partial.mix : base.mix,
            sync: partial.sync !== undefined ? partial.sync : (base.sync ?? true),
            damping: partial.damping !== undefined ? partial.damping : (base.damping ?? 0.2)
          }
        }
      });
    },
    [synthSettings.fx, updateSettings]
  );

  const updateEQ = useCallback(
    (partial: Partial<SynthEQConfig>) => {
      const baseEq: SynthEQConfig = synthSettings.eq || {
        enabled: false,
        low: 0,
        lowMid: 0,
        highMid: 0,
        high: 0
      };
      updateSettings({
        eq: {
          ...baseEq,
          ...partial
        }
      });
    },
    [synthSettings.eq, updateSettings]
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

  const handleCopySettings = () => {
    copySynthSettings(targetChannelId);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 1200);
  };

  const handlePasteSettings = () => {
    pasteSynthSettings(targetChannelId);
  };

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

  // Interacción gráfica con la curva del filtro VCF con captura global del ratón
  const handleFilterSvgInteraction = useCallback((clientX: number, clientY: number) => {
    const svg = filterSvgRef.current;
    if (!svg || !synthSettings.filter.enabled) return;

    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

    const normX = x / rect.width;
    const freq = Math.round(20 * Math.pow(1000, normX));

    const normY = 1 - y / rect.height;
    const qVal = parseFloat((0.5 + normY * 15.5).toFixed(1));

    updateFilter({
      frequency: Math.max(20, Math.min(20000, freq)),
      Q: Math.max(0.5, Math.min(16, qVal))
    });
  }, [synthSettings.filter.enabled, updateFilter]);

  const handleFilterMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!synthSettings.filter.enabled) return;
    e.preventDefault();
    setIsDraggingFilterNode(true);
    handleFilterSvgInteraction(e.clientX, e.clientY);

    const onMouseMove = (moveEvent: MouseEvent) => {
      handleFilterSvgInteraction(moveEvent.clientX, moveEvent.clientY);
    };

    const onMouseUp = () => {
      setIsDraggingFilterNode(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [synthSettings.filter.enabled, handleFilterSvgInteraction]);

  // Interacción gráfica con el ecualizador paramétrico
  const [activeEqDragBand, setActiveEqDragBand] = useState<'low' | 'lowMid' | 'highMid' | 'high' | null>(null);
  const eqSvgRef = useRef<SVGSVGElement | null>(null);

  const handleEqNodeMouseDown = useCallback(
    (bandKey: 'low' | 'lowMid' | 'highMid' | 'high', e: React.MouseEvent) => {
      if (!synthSettings.eq?.enabled) return;
      e.preventDefault();
      e.stopPropagation();
      setActiveEqDragBand(bandKey);

      const svg = eqSvgRef.current;
      if (!svg) return;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const rect = svg.getBoundingClientRect();
        const relativeY = moveEvent.clientY - rect.top;
        const clampedSvgY = Math.max(9, Math.min(61, (relativeY / rect.height) * 70));
        const newGain = parseFloat((((35 - clampedSvgY) / 26) * 12).toFixed(1));
        updateEQ({ [bandKey]: Math.max(-12, Math.min(12, newGain)) });
      };

      const onMouseUp = () => {
        setActiveEqDragBand(null);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [synthSettings.eq?.enabled, updateEQ]
  );

  // Coordenadas para la curva del filtro SVG
  const svgWidth = 320;
  const svgHeight = 64;
  const cutoffNorm = Math.max(0, Math.min(1, Math.log(synthSettings.filter.frequency / 20) / Math.log(1000)));
  const nodeX = cutoffNorm * svgWidth;
  const qNorm = Math.max(0, Math.min(1, (synthSettings.filter.Q - 0.5) / 15.5));
  const nodeY = (1 - qNorm) * (svgHeight * 0.7) + svgHeight * 0.15;

  // Renderizador de Curva ADSR
  const currentEnv = activeEnvTab === 'amp' ? synthSettings.envelope : (synthSettings.filterEnv || synthSettings.envelope);
  const totalEnvTime = currentEnv.attack + currentEnv.decay + currentEnv.release + 0.5;
  const envSvgWidth = 320;
  const envSvgHeight = 64;
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

  const allPresets = useMemo(() => [...SYNTH_PRESETS, ...userPresets], [userPresets]);

  const currentPresetId = useMemo(() => {
    const pName = synthSettings.presetName;
    if (!pName || pName === 'CUSTOM') return 'CUSTOM';
    const found = allPresets.find(
      (p) => p.id === pName || p.name.toLowerCase() === pName.toLowerCase()
    );
    return found ? found.id : 'CUSTOM';
  }, [allPresets, synthSettings.presetName]);

  const currentDelayDivIndex = useMemo(() => {
    const rawTime = synthSettings.fx?.delay?.time;
    const idx = DELAY_DIVISIONS.findIndex((d) => d.id === rawTime);
    return idx >= 0 ? idx : 1; // default to 1/8
  }, [synthSettings.fx?.delay?.time]);

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
              <span>PHOSPHOR // {channelName}</span>
            </div>

            {/* BARRA DE PRESETS (SIN ÍCONO SPARKLES) */}
            <div className="synth-preset-picker-wrap">
              <select
                className="synth-preset-select"
                value={currentPresetId}
                onChange={(e) => handleApplyPreset(e.target.value)}
                title="Seleccionar Preset"
              >
                <option value="CUSTOM">
                  {currentPresetId === 'CUSTOM' ? 'CUSTOM' : 'PERSONALIZADO'}
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
            <button
              className={`synth-action-btn ${copiedNotice ? 'synth-copied-btn' : ''}`}
              onClick={handleCopySettings}
              title="Copiar configuración del sintetizador al portapapeles"
            >
              {copiedNotice ? <Check size={11} style={{ color: '#00e5ff' }} /> : <Copy size={11} />}
              <span>{copiedNotice ? 'COPIADO' : 'COPIAR'}</span>
            </button>
            <button
              className="synth-action-btn"
              onClick={handlePasteSettings}
              disabled={!synthClipboard}
              title={synthClipboard ? `Pegar parche: ${synthClipboard.presetName || 'Preset'}` : "Portapapeles de sintetizador vacío"}
              style={{ opacity: synthClipboard ? 1 : 0.45 }}
            >
              <ClipboardPaste size={11} />
              <span>PEGAR</span>
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

        {/* ================= RACK DE MÓDULOS ANALÓGICOS ================= */}
        <div className="synth-modal-rack">
          {/* ---------------- MÓDULO 1: OSCILADORES Y MIXER ---------------- */}
          <div className="synth-rack-module module-oscillators">
            <div className="module-title">
              <span><Layers size={13} /> OSCILLATORS</span>
              <span className="module-tag">DUAL + SUB</span>
            </div>
            <div className="module-content">
              {/* OSC 1 */}
              <div className="osc-block">
                <div className="osc-header">
                  <div className="osc-title-wrap">
                    <span className="led-indicator on" title="Oscilador Principal"></span>
                    <span className="osc-label">OSC 1</span>
                  </div>
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
                      onClick={() => updateOsc1({ waveType: w.type })}
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
                    size={32}
                    onChange={(v) => updateOsc1({ detune: v })}
                  />
                  <RotaryKnob
                    label="SEMI"
                    unit="st"
                    value={synthSettings.osc1?.semi ?? 0}
                    min={-12}
                    max={12}
                    step={1}
                    defaultValue={0}
                    size={32}
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
                    size={34}
                    accentColor="#00e5ff"
                    onChange={(v) => updateOsc1({ volume: v / 100 })}
                  />
                </div>
              </div>

              {/* OSC 2 */}
              <div className="osc-block" style={{ marginTop: '8px' }}>
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
                    <span className="osc-label clickable">
                      OSC 2
                    </span>
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
                    defaultValue={0}
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
                {/* SUB */}
                <div className="sub-box">
                  <div className="sub-header-wrap">
                    <label className="switch-led-container">
                      <span className={`led-indicator ${synthSettings.subOsc?.enabled ? 'on' : ''}`}></span>
                      <input
                        type="checkbox"
                        checked={Boolean(synthSettings.subOsc?.enabled)}
                        onChange={(e) => updateSubOsc({ enabled: e.target.checked })}
                        style={{ display: 'none' }}
                        id="sub-toggle"
                      />
                      <span className="sub-label clickable">SUB</span>
                    </label>
                  </div>

                  <div className="sub-selectors-row">
                    <div className="sub-btn-group" title="Octava (-1 / -2)">
                      {([-1, -2] as const).map((oct) => (
                        <button
                          key={oct}
                          type="button"
                          disabled={!synthSettings.subOsc?.enabled}
                          className={`sub-micro-btn ${synthSettings.subOsc?.octave === oct ? 'active' : ''}`}
                          onClick={() => updateSubOsc({ octave: oct })}
                        >
                          {oct}
                        </button>
                      ))}
                    </div>
                    <div className="sub-btn-group" title="Forma de onda (Sin / Cuadrada)">
                      {(['sine', 'square'] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          disabled={!synthSettings.subOsc?.enabled}
                          className={`sub-micro-btn ${synthSettings.subOsc?.waveType === w ? 'active' : ''}`}
                          onClick={() => updateSubOsc({ waveType: w })}
                        >
                          {w === 'sine' ? '~' : '⊓'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <RotaryKnob
                    label="LEVEL"
                    unit="%"
                    disabled={!synthSettings.subOsc?.enabled}
                    value={Math.round((synthSettings.subOsc?.volume ?? 0) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={50}
                    size={32}
                    accentColor="#38bdf8"
                    onChange={(v) => updateSubOsc({ volume: v / 100 })}
                  />
                </div>

                {/* NOISE */}
                <div className="sub-box">
                  <div className="sub-header-wrap">
                    <label className="switch-led-container">
                      <span className={`led-indicator ${synthSettings.noise?.enabled ? 'on' : ''}`}></span>
                      <input
                        type="checkbox"
                        checked={Boolean(synthSettings.noise?.enabled)}
                        onChange={(e) => updateNoise({ enabled: e.target.checked })}
                        style={{ display: 'none' }}
                        id="noise-toggle"
                      />
                      <span className="sub-label clickable">NOISE</span>
                    </label>
                  </div>

                  <div className="sub-selectors-row">
                    <div className="sub-btn-group full-width" title="Color de Ruido">
                      {(['white', 'pink'] as const).map((nt) => (
                        <button
                          key={nt}
                          type="button"
                          disabled={!synthSettings.noise?.enabled}
                          className={`sub-micro-btn ${synthSettings.noise?.type === nt ? 'active' : ''}`}
                          onClick={() => updateNoise({ type: nt })}
                        >
                          {nt === 'white' ? 'WHT' : 'PNK'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <RotaryKnob
                    label="LEVEL"
                    unit="%"
                    disabled={!synthSettings.noise?.enabled}
                    value={Math.round((synthSettings.noise?.volume ?? 0) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={30}
                    size={32}
                    accentColor="#a855f7"
                    onChange={(v) => updateNoise({ volume: v / 100 })}
                  />
                </div>

                {/* GLIDE */}
                <div className="sub-box">
                  <div className="sub-header-wrap">
                    <div className="sub-header-static">
                      <span className={`led-indicator ${(synthSettings.glide ?? 0) > 0 ? 'on' : ''}`} style={{ backgroundColor: (synthSettings.glide ?? 0) > 0 ? '#fbbf24' : undefined, borderColor: (synthSettings.glide ?? 0) > 0 ? '#fbbf24' : undefined, boxShadow: (synthSettings.glide ?? 0) > 0 ? '0 0 7px #fbbf24' : undefined }}></span>
                      <span className="sub-label">GLIDE</span>
                    </div>
                  </div>

                  <div className="sub-selectors-row">
                    <div className="sub-btn-group full-width" title="Modo Portamento">
                      <button
                        type="button"
                        className={`sub-micro-btn ${(synthSettings.glide ?? 0) > 0 ? 'active' : ''}`}
                        style={{ cursor: 'default' }}
                      >
                        PORTA
                      </button>
                    </div>
                  </div>

                  <RotaryKnob
                    label="TIME"
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

          {/* ---------------- MÓDULO 2: FILTRO VCF Y SATURACIÓN DRIVE ---------------- */}
          <div className="synth-rack-module module-filter">
            <div className="module-title">
              <span><Flame size={13} /> VCF & SATURATION</span>
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
                  {synthSettings.filter.enabled ? 'ON' : 'BYPASS'}
                </label>
              </label>
            </div>
            <div className={`module-content ${synthSettings.filter.enabled ? '' : 'module-bypassed'}`}>
              {/* Gráfico Interactivo de Respuesta en Frecuencia */}
              <div className="filter-graph-wrapper">
                <div className="graph-header">
                  <span className="graph-hud-tag">FREQ RESPONSE</span>
                  <span className="graph-hud-val">
                    {synthSettings.filter.frequency >= 1000
                      ? `${(synthSettings.filter.frequency / 1000).toFixed(1)}k`
                      : synthSettings.filter.frequency}Hz · Q {synthSettings.filter.Q.toFixed(1)}
                  </span>
                </div>
                <svg
                  ref={filterSvgRef}
                  width={svgWidth}
                  height={svgHeight}
                  className={`filter-svg-canvas ${isDraggingFilterNode ? 'dragging' : ''}`}
                  onMouseDown={handleFilterMouseDown}
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
                    r={isDraggingFilterNode ? 8 : 6.5}
                    fill="#ff00aa"
                    stroke="#fff"
                    strokeWidth="2"
                    style={{ filter: isDraggingFilterNode ? 'drop-shadow(0 0 12px #ff00aa)' : 'drop-shadow(0 0 8px #ff00aa)' }}
                  />
                </svg>
              </div>

              {/* Selector de Tipo y Rolloff */}
              <div className="filter-type-grid">
                {[
                  { id: 'lowpass', label: 'LP 12', rolloff: -12 },
                  { id: 'lowpass-24', label: 'LP 24', type: 'lowpass', rolloff: -24 },
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

              {/* Perillas del Filtro: Cutoff, Reso, Env Mod, Key Track */}
              <div className="filter-knobs-row">
                <RotaryKnob
                  label="CUTOFF"
                  unit="Hz"
                  logScale
                  disabled={!synthSettings.filter.enabled}
                  value={synthSettings.filter.frequency}
                  min={20}
                  max={20000}
                  step={10}
                  defaultValue={6500}
                  size={38}
                  accentColor="#a855f7"
                  onChange={(v) => updateFilter({ frequency: v })}
                />
                <RotaryKnob
                  label="RESO"
                  disabled={!synthSettings.filter.enabled}
                  value={synthSettings.filter.Q}
                  min={0.1}
                  max={20}
                  step={0.1}
                  defaultValue={1.5}
                  size={38}
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
                  defaultValue={0}
                  size={32}
                  accentColor="#ec4899"
                  onChange={(v) => updateFilter({ envAmount: v / 100 })}
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
                  size={32}
                  accentColor="#eab308"
                  onChange={(v) => updateFilter({ keyTracking: v / 100 })}
                />
              </div>

              {/* BAHÍA DEDICADA DE SATURACIÓN / DRIVE */}
              <div className="synth-drive-bay">
                <div className="bay-header">
                  <span className="bay-title">
                    <Flame size={12} color="#f97316" /> DRIVE & SATURATION
                  </span>
                  <span className={`bay-status-led ${(synthSettings.filter.drive ?? 0) > 0 ? 'active' : ''}`} />
                </div>
                <div className="drive-bay-content">
                  <div className="drive-knob-wrap">
                    <RotaryKnob
                      label="DRIVE"
                      unit="%"
                      disabled={!synthSettings.filter.enabled}
                      value={Math.round((synthSettings.filter.drive ?? 0.1) * 100)}
                      min={0}
                      max={100}
                      step={1}
                      defaultValue={0}
                      size={38}
                      accentColor="#f97316"
                      onChange={(v) => updateFilter({ drive: v / 100 })}
                    />
                  </div>
                  <div className="drive-modes-grid">
                    {[
                      { id: 'warm', label: 'WARM', hint: 'Soft-Clip' },
                      { id: 'tube', label: 'TUBE', hint: 'Triode' },
                      { id: 'tape', label: 'TAPE', hint: 'Tape Sat' },
                      { id: 'fuzz', label: 'FUZZ', hint: 'Diode' }
                    ].map((mode) => {
                      const isActive = (synthSettings.filter.driveType || 'tube') === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          disabled={!synthSettings.filter.enabled}
                          className={`drive-mode-card ${isActive ? 'active' : ''}`}
                          onClick={() => updateFilter({ driveType: mode.id as any })}
                          title={`Saturación ${mode.label} (${mode.hint})`}
                        >
                          <span className="mode-led" />
                          <span className="mode-label">{mode.label}</span>
                          <span className="mode-hint">{mode.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ---------------- MÓDULO 3: DOBLE ENVOLVENTE ADSR Y PHOSPHOR MONITOR ---------------- */}
          <div className="synth-rack-module module-envelope">
            <div className="module-title">
              <span><Activity size={13} /> ENVELOPES & MONITOR</span>
              <div className="env-subtab-pills">
                <button
                  className={`env-tab-btn ${activeEnvTab === 'amp' ? 'active' : ''}`}
                  onClick={() => setActiveEnvTab('amp')}
                >
                  AMP
                </button>
                <button
                  className={`env-tab-btn ${activeEnvTab === 'filter' ? 'active' : ''}`}
                  onClick={() => setActiveEnvTab('filter')}
                >
                  FILTER
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
                  defaultValue={activeEnvTab === 'amp' ? 0.04 : 0.02}
                  size={34}
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
                  size={34}
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
                  defaultValue={activeEnvTab === 'amp' ? 65 : 30}
                  size={34}
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
                  defaultValue={0.6}
                  size={34}
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

              {/* PHOSPHOR CRT MONITOR OSC / FFT */}
              <div className="synth-monitor-bay">
                <div className="bay-header">
                  <span className="bay-title">
                    <Radio size={11} color="#00e5ff" /> MONITOR // {targetChannel.id.toUpperCase()}
                  </span>
                  <div className="scope-mode-tabs">
                    <button
                      type="button"
                      className={`scope-mode-btn ${scopeMode === 'wave' ? 'active' : ''}`}
                      onClick={() => setScopeMode('wave')}
                      title="Osciloscopio"
                    >
                      <Waves size={10} /> OSC
                    </button>
                    <button
                      type="button"
                      className={`scope-mode-btn ${scopeMode === 'fft' ? 'active' : ''}`}
                      onClick={() => setScopeMode('fft')}
                      title="Espectro FFT"
                    >
                      <Activity size={10} /> FFT
                    </button>
                  </div>
                </div>
                <canvas
                  ref={scopeCanvasRef}
                  width={340}
                  height={64}
                  className="synth-scope-canvas"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ================= SECCIÓN INFERIOR: LFO, RACK FX Y ECUALIZADOR GRÁFICO ================= */}
        <div className="synth-bottom-dock">
          {/* 1. LFO MODULATOR */}
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
                  <Compass size={12} /> LFO
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
                min={0.05}
                max={30.0}
                step={0.01}
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

          {/* 2. CHORUS */}
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
                min={0.1}
                max={10.0}
                step={0.01}
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

          {/* 3. DELAY CON OLED RIBBON Y TIMING PRO */}
          <div className="dock-module dock-fx dock-delay">
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
              <div className="delay-sync-toggle">
                <button
                  type="button"
                  disabled={!synthSettings.fx?.delay?.enabled}
                  className={`target-pill ${(synthSettings.fx?.delay?.sync ?? true) ? 'active' : ''}`}
                  onClick={() => updateDelay({ sync: true })}
                  title="Sincronizado al tempo musical"
                >
                  SYNC
                </button>
                <button
                  type="button"
                  disabled={!synthSettings.fx?.delay?.enabled}
                  className={`target-pill ${!(synthSettings.fx?.delay?.sync ?? true) ? 'active' : ''}`}
                  onClick={() => updateDelay({ sync: false, time: typeof synthSettings.fx?.delay?.time === 'number' ? synthSettings.fx.delay.time : 0.25 })}
                  title="Tiempo libre en milisegundos"
                >
                  FREE
                </button>
              </div>
            </div>

            {/* Ribbon OLED de Tiempo */}
            <div className="delay-time-ribbon">
              {(synthSettings.fx?.delay?.sync ?? true) ? (
                <div className="delay-oled-container">
                  <button
                    type="button"
                    disabled={!synthSettings.fx?.delay?.enabled || currentDelayDivIndex <= 0}
                    className="delay-stepper-btn"
                    onClick={() => {
                      const prev = DELAY_DIVISIONS[Math.max(0, currentDelayDivIndex - 1)];
                      updateDelay({ time: prev.id, sync: true });
                    }}
                    title="Subdivisión anterior"
                  >
                    ◀
                  </button>
                  <div
                    className="delay-oled-badge"
                    onClick={() => {
                      const next = DELAY_DIVISIONS[(currentDelayDivIndex + 1) % DELAY_DIVISIONS.length];
                      updateDelay({ time: next.id, sync: true });
                    }}
                    title="Clic para ciclar subdivisión rítmica"
                  >
                    <span className="delay-oled-note">♪</span>
                    <span className="delay-oled-text">{DELAY_DIVISIONS[currentDelayDivIndex]?.label || '1/8'}</span>
                  </div>
                  <button
                    type="button"
                    disabled={!synthSettings.fx?.delay?.enabled || currentDelayDivIndex >= DELAY_DIVISIONS.length - 1}
                    className="delay-stepper-btn"
                    onClick={() => {
                      const next = DELAY_DIVISIONS[Math.min(DELAY_DIVISIONS.length - 1, currentDelayDivIndex + 1)];
                      updateDelay({ time: next.id, sync: true });
                    }}
                    title="Subdivisión siguiente"
                  >
                    ▶
                  </button>
                </div>
              ) : (
                <div className="delay-free-badge">
                  <span className="delay-free-icon">⏱</span>
                  <span className="delay-free-text">
                    {Math.round((typeof synthSettings.fx?.delay?.time === 'number' ? synthSettings.fx.delay.time : 0.25) * 1000)} ms
                  </span>
                </div>
              )}
            </div>

            {/* 4 Knobs de Precisión de Delay */}
            <div className="dock-knob-row">
              <RotaryKnob
                label="TIME"
                disabled={!synthSettings.fx?.delay?.enabled}
                value={(synthSettings.fx?.delay?.sync ?? true) ? currentDelayDivIndex : (typeof synthSettings.fx?.delay?.time === 'number' ? synthSettings.fx.delay.time : 0.25)}
                min={(synthSettings.fx?.delay?.sync ?? true) ? 0 : 0.05}
                max={(synthSettings.fx?.delay?.sync ?? true) ? 5 : 1.2}
                step={(synthSettings.fx?.delay?.sync ?? true) ? 1 : 0.01}
                defaultValue={(synthSettings.fx?.delay?.sync ?? true) ? 1 : 0.25}
                displayValue={(synthSettings.fx?.delay?.sync ?? true) ? DELAY_DIVISIONS[currentDelayDivIndex]?.label : undefined}
                unit={(synthSettings.fx?.delay?.sync ?? true) ? '' : 's'}
                size={30}
                accentColor="#10b981"
                onChange={(v) => {
                  if (synthSettings.fx?.delay?.sync ?? true) {
                    const idx = Math.max(0, Math.min(5, Math.round(v)));
                    updateDelay({ time: DELAY_DIVISIONS[idx]?.id || '8n', sync: true });
                  } else {
                    updateDelay({ time: v, sync: false });
                  }
                }}
              />
              <RotaryKnob
                label="FDBK"
                unit="%"
                disabled={!synthSettings.fx?.delay?.enabled}
                value={Math.round((synthSettings.fx?.delay?.feedback ?? 0.25) * 100)}
                min={0}
                max={85}
                step={1}
                defaultValue={25}
                size={30}
                accentColor="#10b981"
                onChange={(v) => updateDelay({ feedback: v / 100 })}
              />
              <RotaryKnob
                label="DAMP"
                unit="%"
                disabled={!synthSettings.fx?.delay?.enabled}
                value={Math.round((synthSettings.fx?.delay?.damping ?? 0.2) * 100)}
                min={0}
                max={100}
                step={1}
                defaultValue={20}
                size={30}
                accentColor="#10b981"
                onChange={(v) => updateDelay({ damping: v / 100 })}
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
                size={30}
                accentColor="#10b981"
                onChange={(v) => updateDelay({ mix: v / 100 })}
              />
            </div>
          </div>

          {/* 4. REVERB */}
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

          {/* 5. ECUALIZADOR PARAMÉTRICO GRÁFICO PRO VST */}
          <div className="dock-module dock-eq">
            <div className="dock-module-header">
              <label className="switch-led-container">
                <span className={`led-indicator ${synthSettings.eq?.enabled ? 'on' : ''}`}></span>
                <input
                  type="checkbox"
                  checked={Boolean(synthSettings.eq?.enabled)}
                  onChange={(e) => updateEQ({ enabled: e.target.checked })}
                  style={{ display: 'none' }}
                  id="eq-toggle"
                />
                <label htmlFor="eq-toggle" className="field-label clickable font-bold">
                  <Sliders size={12} /> EQ
                </label>
              </label>
              <button
                type="button"
                className="eq-flat-btn"
                disabled={!synthSettings.eq?.enabled}
                onClick={() => updateEQ({ low: 0, lowMid: 0, highMid: 0, high: 0 })}
                title="Restablecer todas las bandas a 0 dB (Flat)"
              >
                FLAT
              </button>
            </div>

            {/* Display de Espectro Paramétrico Interactivo */}
            <div className={`eq-spectrum-display ${synthSettings.eq?.enabled ? '' : 'disabled'}`}>
              {(() => {
                const eqCurve = getEqCurveCoordinates(
                  synthSettings.eq?.low ?? 0,
                  synthSettings.eq?.lowMid ?? 0,
                  synthSettings.eq?.highMid ?? 0,
                  synthSettings.eq?.high ?? 0,
                  synthSettings.eq?.enabled ?? false
                );
                const nodes = [
                  { key: 'low' as const, x: 30, y: eqCurve.y1, label: 'L', name: 'LOW 100Hz', color: '#00e5ff', val: synthSettings.eq?.low ?? 0 },
                  { key: 'lowMid' as const, x: 82, y: eqCurve.y2, label: 'LM', name: 'MID 500Hz', color: '#10b981', val: synthSettings.eq?.lowMid ?? 0 },
                  { key: 'highMid' as const, x: 138, y: eqCurve.y3, label: 'HM', name: 'MID 2.8kHz', color: '#a855f7', val: synthSettings.eq?.highMid ?? 0 },
                  { key: 'high' as const, x: 190, y: eqCurve.y4, label: 'H', name: 'HIGH 10kHz', color: '#f43f5e', val: synthSettings.eq?.high ?? 0 }
                ];

                return (
                  <svg
                    ref={eqSvgRef}
                    viewBox="0 0 220 70"
                    className="eq-svg-spectrum"
                  >
                    <defs>
                      <linearGradient id="eqSpectrumGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.28" />
                        <stop offset="60%" stopColor="#10b981" stopOpacity="0.10" />
                        <stop offset="100%" stopColor="#0a0f0d" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Guías de dB de fondo */}
                    <line x1="0" y1="9" x2="220" y2="9" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.8" />
                    <line x1="0" y1="35" x2="220" y2="35" stroke="rgba(0, 229, 255, 0.25)" strokeWidth="1" strokeDasharray="3 3" />
                    <line x1="0" y1="61" x2="220" y2="61" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.8" />

                    {/* Guías de Frecuencia */}
                    <line x1="30" y1="0" x2="30" y2="70" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="0.8" />
                    <line x1="82" y1="0" x2="82" y2="70" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="0.8" />
                    <line x1="138" y1="0" x2="138" y2="70" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="0.8" />
                    <line x1="190" y1="0" x2="190" y2="70" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="0.8" />

                    {/* Etiquetas de frecuencia de fondo */}
                    <text x="30" y="67" textAnchor="middle" fill="#44554c" fontSize="6" fontFamily="Share Tech Mono">100</text>
                    <text x="82" y="67" textAnchor="middle" fill="#44554c" fontSize="6" fontFamily="Share Tech Mono">500</text>
                    <text x="138" y="67" textAnchor="middle" fill="#44554c" fontSize="6" fontFamily="Share Tech Mono">2.8k</text>
                    <text x="190" y="67" textAnchor="middle" fill="#44554c" fontSize="6" fontFamily="Share Tech Mono">10k</text>

                    {/* Relleno de Espectro Translúcido */}
                    {synthSettings.eq?.enabled && (
                      <path d={eqCurve.fillPath} fill="url(#eqSpectrumGlow)" />
                    )}

                    {/* Curva Paramétrica */}
                    <path
                      d={eqCurve.path}
                      fill="none"
                      stroke={synthSettings.eq?.enabled ? '#00e5ff' : 'rgba(255, 255, 255, 0.2)'}
                      strokeWidth="2"
                      style={{
                        filter: synthSettings.eq?.enabled ? 'drop-shadow(0 0 5px rgba(0, 229, 255, 0.6))' : 'none'
                      }}
                    />

                    {/* Pucks de Nodos Interactivos Arrastrables */}
                    {synthSettings.eq?.enabled &&
                      nodes.map((node) => {
                        const isDragging = activeEqDragBand === node.key;
                        const formattedVal = node.val > 0 ? `+${node.val.toFixed(1)}` : node.val.toFixed(1);
                        return (
                          <g
                            key={node.key}
                            className={`eq-node-group ${isDragging ? 'dragging' : ''}`}
                            onMouseDown={(e) => handleEqNodeMouseDown(node.key, e)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              updateEQ({ [node.key]: 0 });
                            }}
                          >
                            {/* Halo brillante */}
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={isDragging ? 9 : 7}
                              fill="none"
                              stroke={node.color}
                              strokeWidth={isDragging ? 2 : 1}
                              opacity={isDragging ? 0.9 : 0.4}
                              className="eq-node-halo"
                            />
                            {/* Centro del nodo */}
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={4}
                              fill={node.color}
                              stroke="#fff"
                              strokeWidth="1.2"
                              style={{
                                filter: `drop-shadow(0 0 6px ${node.color})`,
                                cursor: 'ns-resize'
                              }}
                            />
                            {/* Tooltip de Ganancia en Arrastre */}
                            {isDragging && (
                              <g>
                                <rect
                                  x={node.x - 18}
                                  y={Math.max(2, node.y - 18)}
                                  width={36}
                                  height={11}
                                  rx={2}
                                  fill="#070a08"
                                  stroke={node.color}
                                  strokeWidth="0.8"
                                />
                                <text
                                  x={node.x}
                                  y={Math.max(2, node.y - 18) + 8}
                                  textAnchor="middle"
                                  fill="#fff"
                                  fontSize="6.5"
                                  fontWeight="bold"
                                  fontFamily="Share Tech Mono"
                                >
                                  {formattedVal}dB
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}
                  </svg>
                );
              })()}
            </div>

            {/* 4 Precision Knobs de Ganancia por Banda */}
            <div className="eq-knobs-dock">
              {[
                { key: 'low' as const, label: 'LOW', freq: '100', color: '#00e5ff' },
                { key: 'lowMid' as const, label: 'L-MID', freq: '500', color: '#10b981' },
                { key: 'highMid' as const, label: 'H-MID', freq: '2.8K', color: '#a855f7' },
                { key: 'high' as const, label: 'HIGH', freq: '10K', color: '#f43f5e' }
              ].map((band) => {
                const val = (synthSettings.eq as any)?.[band.key] ?? 0;
                const formattedVal = val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1);
                return (
                  <div key={band.key} className="eq-band-col">
                    <RotaryKnob
                      label={band.label}
                      unit="dB"
                      disabled={!synthSettings.eq?.enabled}
                      value={val}
                      min={-12}
                      max={12}
                      step={0.5}
                      defaultValue={0}
                      size={28}
                      accentColor={band.color}
                      onChange={(v) => updateEQ({ [band.key]: v })}
                    />
                    <span className="eq-freq-badge" style={{ color: band.color }}>
                      {formattedVal}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 6. MASTER OUTPUT */}
          <div className="dock-module dock-master">
            <div className="dock-module-header">
              <span className="field-label font-bold">
                <Volume2 size={12} color="#00e5ff" /> MASTER
              </span>
              <span className="master-db-readout">
                {(() => {
                  const g = synthSettings.masterGain ?? 1.0;
                  if (g <= 0.001) return '-inf dB';
                  const db = 20 * Math.log10(g);
                  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
                })()}
              </span>
            </div>

            <div className="dock-master-content">
              <RotaryKnob
                label="GAIN"
                unit="%"
                value={Math.round((synthSettings.masterGain ?? 1.0) * 100)}
                min={0}
                max={200}
                step={1}
                defaultValue={100}
                size={44}
                accentColor="#00e5ff"
                onChange={(v) => updateMasterGain(v / 100)}
              />
            </div>
          </div>
        </div>

        {/* ================= FOOTER ================= */}
        <div className="synth-modal-footer">
          <div className="footer-status-pill">
            <span className="status-dot"></span>
            <span>DSP 64-BIT</span>
          </div>
          <div className="footer-status-pill">
            <span>STEREO</span>
          </div>
          <div className="footer-status-pill">
            <span>16 VOICES</span>
          </div>
        </div>
      </div>
    </div>
  );
};
