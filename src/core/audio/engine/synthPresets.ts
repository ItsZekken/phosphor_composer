/**
 * synthPresets.ts
 * Banco de presets de fábrica de sintetizador analógico, gestión de presets de usuario y utilidades.
 */

import type { SynthSettings } from '../../../utils/typeDefinitions';

export const DEFAULT_SYNTH_SETTINGS: SynthSettings = {
  waveType: 'triangle',
  detune: 0,
  envelope: {
    attack: 0.04,
    decay: 0.25,
    sustain: 0.65,
    release: 0.6
  },
  filter: {
    enabled: true,
    type: 'lowpass',
    frequency: 6500,
    Q: 1.5,
    rolloff: -12,
    drive: 0.1,
    envAmount: 0.3,
    keyTracking: 0.5
  },
  osc1: {
    enabled: true,
    waveType: 'triangle',
    octave: 0,
    semi: 0,
    detune: 0,
    volume: 0.8
  },
  osc2: {
    enabled: true,
    waveType: 'sawtooth',
    octave: 0,
    semi: 0,
    detune: 6,
    volume: 0.4
  },
  subOsc: {
    enabled: false,
    waveType: 'sine',
    octave: -1,
    volume: 0.0
  },
  noise: {
    enabled: false,
    type: 'white',
    volume: 0.0
  },
  filterEnv: {
    attack: 0.02,
    decay: 0.35,
    sustain: 0.3,
    release: 0.6
  },
  lfo: {
    enabled: false,
    waveType: 'sine',
    rate: 2.5,
    depth: 0.25,
    target: 'cutoff'
  },
  fx: {
    chorus: {
      enabled: false,
      depth: 0.4,
      rate: 1.5,
      mix: 0.3
    },
    delay: {
      enabled: false,
      time: '8n',
      feedback: 0.25,
      mix: 0.2
    },
    reverb: {
      enabled: false,
      decay: 1.8,
      mix: 0.15
    }
  },
  glide: 0,
  presetName: 'INIT'
};

export interface SynthPresetDef {
  id: string;
  name: string;
  category: 'lead' | 'pad' | 'bass' | 'pluck' | 'keys' | 'fx' | 'user';
  settings: Partial<SynthSettings>;
}

export const SYNTH_PRESETS: SynthPresetDef[] = [
  {
    id: 'init',
    name: 'Init Synth',
    category: 'lead',
    settings: {
      presetName: 'Init Synth',
      waveType: 'triangle',
      detune: 0,
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.5 },
      filter: { enabled: true, type: 'lowpass', frequency: 10000, Q: 1.0, rolloff: -12, drive: 0.0, envAmount: 0.0, keyTracking: 0.5 },
      osc1: { enabled: true, waveType: 'triangle', octave: 0, semi: 0, detune: 0, volume: 0.8 },
      osc2: { enabled: false, waveType: 'sawtooth', octave: 0, semi: 0, detune: 5, volume: 0.0 },
      subOsc: { enabled: false, waveType: 'sine', octave: -1, volume: 0.0 },
      noise: { enabled: false, type: 'white', volume: 0.0 },
      filterEnv: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.5 },
      lfo: { enabled: false, waveType: 'sine', rate: 2.0, depth: 0.0, target: 'cutoff' },
      fx: {
        chorus: { enabled: false, depth: 0.4, rate: 1.5, mix: 0.0 },
        delay: { enabled: false, time: '8n', feedback: 0.2, mix: 0.0 },
        reverb: { enabled: false, decay: 1.5, mix: 0.0 }
      },
      glide: 0
    }
  },
  {
    id: 'warm_pad',
    name: 'Warm Velvet Pad',
    category: 'pad',
    settings: {
      presetName: 'Warm Velvet Pad',
      waveType: 'sawtooth',
      detune: 0,
      envelope: { attack: 0.25, decay: 0.6, sustain: 0.85, release: 1.2 },
      filter: { enabled: true, type: 'lowpass', frequency: 3500, Q: 1.2, rolloff: -12, drive: 0.05, envAmount: 0.25, keyTracking: 0.6 },
      osc1: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: -6, volume: 0.8 },
      osc2: { enabled: true, waveType: 'triangle', octave: 0, semi: 0, detune: 6, volume: 0.7 },
      subOsc: { enabled: true, waveType: 'sine', octave: -1, volume: 0.35 },
      noise: { enabled: false, type: 'pink', volume: 0.0 },
      filterEnv: { attack: 0.3, decay: 0.8, sustain: 0.7, release: 1.4 },
      lfo: { enabled: true, waveType: 'sine', rate: 0.8, depth: 0.15, target: 'cutoff' },
      fx: {
        chorus: { enabled: true, depth: 0.5, rate: 1.2, mix: 0.35 },
        delay: { enabled: false, time: '4n', feedback: 0.3, mix: 0.0 },
        reverb: { enabled: true, decay: 2.5, mix: 0.3 }
      },
      glide: 0.04
    }
  },
  {
    id: 'brass_80s',
    name: '80s Brass Poly',
    category: 'lead',
    settings: {
      presetName: '80s Brass Poly',
      waveType: 'sawtooth',
      detune: 0,
      envelope: { attack: 0.05, decay: 0.35, sustain: 0.7, release: 0.6 },
      filter: { enabled: true, type: 'lowpass', frequency: 4500, Q: 2.0, rolloff: -12, drive: 0.1, envAmount: 0.45, keyTracking: 0.7 },
      osc1: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: -5, volume: 0.8 },
      osc2: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: 5, volume: 0.75 },
      subOsc: { enabled: false, waveType: 'sine', octave: -1, volume: 0.0 },
      noise: { enabled: false, type: 'white', volume: 0.0 },
      filterEnv: { attack: 0.05, decay: 0.4, sustain: 0.35, release: 0.5 },
      lfo: { enabled: false, waveType: 'sine', rate: 4.5, depth: 0.0, target: 'pitch' },
      fx: {
        chorus: { enabled: true, depth: 0.4, rate: 1.5, mix: 0.3 },
        delay: { enabled: false, time: '8n', feedback: 0.2, mix: 0.0 },
        reverb: { enabled: true, decay: 1.8, mix: 0.2 }
      },
      glide: 0
    }
  },
  {
    id: 'moog_bass',
    name: 'Deep Analog Bass',
    category: 'bass',
    settings: {
      presetName: 'Deep Analog Bass',
      waveType: 'sawtooth',
      detune: 0,
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4 },
      filter: { enabled: true, type: 'lowpass', frequency: 2800, Q: 2.2, rolloff: -12, drive: 0.2, envAmount: 0.45, keyTracking: 0.8 },
      osc1: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: 0, volume: 0.9 },
      osc2: { enabled: true, waveType: 'square', octave: -1, semi: 0, detune: 3, volume: 0.65 },
      subOsc: { enabled: true, waveType: 'sine', octave: -1, volume: 0.5 },
      noise: { enabled: false, type: 'white', volume: 0.0 },
      filterEnv: { attack: 0.01, decay: 0.25, sustain: 0.2, release: 0.3 },
      lfo: { enabled: false, waveType: 'triangle', rate: 3.0, depth: 0.0, target: 'cutoff' },
      fx: {
        chorus: { enabled: false, depth: 0.2, rate: 1.0, mix: 0.0 },
        delay: { enabled: false, time: '8n', feedback: 0.1, mix: 0.0 },
        reverb: { enabled: false, decay: 1.0, mix: 0.0 }
      },
      glide: 0.03
    }
  },
  {
    id: 'acid_303',
    name: 'Acid Resonance 303',
    category: 'bass',
    settings: {
      presetName: 'Acid Resonance 303',
      waveType: 'sawtooth',
      detune: 0,
      envelope: { attack: 0.005, decay: 0.25, sustain: 0.25, release: 0.25 },
      filter: { enabled: true, type: 'lowpass', frequency: 2600, Q: 4.5, rolloff: -12, drive: 0.25, envAmount: 0.65, keyTracking: 0.8 },
      osc1: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: 0, volume: 0.9 },
      osc2: { enabled: false, waveType: 'square', octave: 0, semi: 0, detune: 0, volume: 0.0 },
      subOsc: { enabled: false, waveType: 'square', octave: -1, volume: 0.0 },
      noise: { enabled: false, type: 'white', volume: 0.0 },
      filterEnv: { attack: 0.005, decay: 0.2, sustain: 0.15, release: 0.2 },
      lfo: { enabled: false, waveType: 'sine', rate: 6.0, depth: 0.0, target: 'cutoff' },
      fx: {
        chorus: { enabled: false, depth: 0.3, rate: 1.0, mix: 0.0 },
        delay: { enabled: true, time: '8n', feedback: 0.3, mix: 0.25 },
        reverb: { enabled: false, decay: 1.2, mix: 0.0 }
      },
      glide: 0.06
    }
  },
  {
    id: 'pluck_analog',
    name: 'Punchy Analog Pluck',
    category: 'pluck',
    settings: {
      presetName: 'Punchy Analog Pluck',
      waveType: 'square',
      detune: 0,
      envelope: { attack: 0.005, decay: 0.35, sustain: 0.1, release: 0.45 },
      filter: { enabled: true, type: 'lowpass', frequency: 5000, Q: 2.5, rolloff: -12, drive: 0.1, envAmount: 0.5, keyTracking: 0.8 },
      osc1: { enabled: true, waveType: 'square', octave: 0, semi: 0, detune: -4, volume: 0.8 },
      osc2: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: 6, volume: 0.65 },
      subOsc: { enabled: true, waveType: 'sine', octave: -1, volume: 0.3 },
      noise: { enabled: false, type: 'white', volume: 0.0 },
      filterEnv: { attack: 0.005, decay: 0.25, sustain: 0.05, release: 0.35 },
      lfo: { enabled: false, waveType: 'sine', rate: 2.0, depth: 0.0, target: 'cutoff' },
      fx: {
        chorus: { enabled: false, depth: 0.4, rate: 1.5, mix: 0.0 },
        delay: { enabled: true, time: '8n', feedback: 0.25, mix: 0.2 },
        reverb: { enabled: true, decay: 1.8, mix: 0.2 }
      },
      glide: 0
    }
  },
  {
    id: 'supersaw_lead',
    name: 'Supersaw Cyber Lead',
    category: 'lead',
    settings: {
      presetName: 'Supersaw Cyber Lead',
      waveType: 'sawtooth',
      detune: 0,
      envelope: { attack: 0.01, decay: 0.25, sustain: 0.8, release: 0.5 },
      filter: { enabled: true, type: 'lowpass', frequency: 12000, Q: 1.5, rolloff: -12, drive: 0.15, envAmount: 0.3, keyTracking: 0.5 },
      osc1: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: -10, volume: 0.85 },
      osc2: { enabled: true, waveType: 'sawtooth', octave: 0, semi: 0, detune: 10, volume: 0.85 },
      subOsc: { enabled: true, waveType: 'square', octave: -1, volume: 0.35 },
      noise: { enabled: false, type: 'white', volume: 0.0 },
      filterEnv: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.5 },
      lfo: { enabled: false, waveType: 'triangle', rate: 5.0, depth: 0.0, target: 'pitch' },
      fx: {
        chorus: { enabled: true, depth: 0.6, rate: 2.0, mix: 0.45 },
        delay: { enabled: false, time: '8n', feedback: 0.3, mix: 0.0 },
        reverb: { enabled: true, decay: 2.0, mix: 0.25 }
      },
      glide: 0.02
    }
  },
  {
    id: 'glass_bell',
    name: 'Glass Ethereal Bell',
    category: 'keys',
    settings: {
      presetName: 'Glass Ethereal Bell',
      waveType: 'sine',
      detune: 0,
      envelope: { attack: 0.005, decay: 1.2, sustain: 0.3, release: 1.5 },
      filter: { enabled: true, type: 'lowpass', frequency: 8000, Q: 1.5, rolloff: -12, drive: 0.0, envAmount: 0.2, keyTracking: 0.9 },
      osc1: { enabled: true, waveType: 'sine', octave: 0, semi: 0, detune: 0, volume: 0.9 },
      osc2: { enabled: true, waveType: 'triangle', octave: 1, semi: 7, detune: 4, volume: 0.6 },
      subOsc: { enabled: false, waveType: 'sine', octave: -1, volume: 0.0 },
      noise: { enabled: false, type: 'white', volume: 0.0 },
      filterEnv: { attack: 0.01, decay: 0.8, sustain: 0.2, release: 1.2 },
      lfo: { enabled: true, waveType: 'sine', rate: 3.5, depth: 0.1, target: 'pitch' },
      fx: {
        chorus: { enabled: true, depth: 0.5, rate: 1.2, mix: 0.35 },
        delay: { enabled: true, time: '4n', feedback: 0.4, mix: 0.35 },
        reverb: { enabled: true, decay: 3.0, mix: 0.35 }
      },
      glide: 0
    }
  },
  {
    id: 'chiptune_square',
    name: '8-Bit Retro Pulse',
    category: 'lead',
    settings: {
      presetName: '8-Bit Retro Pulse',
      waveType: 'square',
      detune: 0,
      envelope: { attack: 0.002, decay: 0.15, sustain: 0.6, release: 0.15 },
      filter: { enabled: false, type: 'lowpass', frequency: 18000, Q: 1.0, rolloff: -12, drive: 0.0, envAmount: 0.0, keyTracking: 0.0 },
      osc1: { enabled: true, waveType: 'square', octave: 0, semi: 0, detune: 0, volume: 0.85 },
      osc2: { enabled: true, waveType: 'square', octave: 1, semi: 0, detune: 0, volume: 0.55 },
      subOsc: { enabled: false, waveType: 'square', octave: -1, volume: 0.0 },
      noise: { enabled: false, type: 'white', volume: 0.0 },
      filterEnv: { attack: 0.002, decay: 0.1, sustain: 0.5, release: 0.1 },
      lfo: { enabled: false, waveType: 'square', rate: 8.0, depth: 0.0, target: 'pitch' },
      fx: {
        chorus: { enabled: false, depth: 0.0, rate: 1.0, mix: 0.0 },
        delay: { enabled: true, time: '16n', feedback: 0.2, mix: 0.2 },
        reverb: { enabled: false, decay: 1.0, mix: 0.0 }
      },
      glide: 0
    }
  }
];

const USER_PRESETS_STORAGE_KEY = 'phosphor_user_synth_presets';

export function getUserPresets(): SynthPresetDef[] {
  try {
    const raw = localStorage.getItem(USER_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function saveUserPreset(name: string, settings: SynthSettings): SynthPresetDef {
  const cleanName = name.trim() || 'Mi Preset';
  const id = `user_${Date.now()}`;
  const newPreset: SynthPresetDef = {
    id,
    name: cleanName,
    category: 'user',
    settings: {
      ...normalizeSynthSettings(settings),
      presetName: cleanName
    }
  };

  try {
    const existing = getUserPresets().filter((p) => p.name.toLowerCase() !== cleanName.toLowerCase());
    existing.unshift(newPreset);
    localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(existing));
  } catch (_) {}

  return newPreset;
}

export function deleteUserPreset(id: string): void {
  try {
    const existing = getUserPresets().filter((p) => p.id !== id);
    localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(existing));
  } catch (_) {}
}

export function exportPresetToJson(settings: SynthSettings, name?: string): void {
  const presetName = name || settings.presetName || 'phosphor_synth_preset';
  const payload = {
    format: 'phosphor_synth_preset',
    version: '1.0',
    name: presetName,
    createdAt: new Date().toISOString(),
    settings: normalizeSynthSettings({ ...settings, presetName })
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeFilename = presetName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  a.href = url;
  a.download = `preset-${safeFilename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importPresetFromJson(jsonString: string): SynthPresetDef | null {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') return null;

    const rawSettings = parsed.settings || parsed;
    const name = parsed.name || rawSettings.presetName || 'Imported Patch';
    const normalized = normalizeSynthSettings(rawSettings);

    return {
      id: `user_imported_${Date.now()}`,
      name,
      category: 'user',
      settings: { ...normalized, presetName: name }
    };
  } catch (_) {
    return null;
  }
}

/**
 * Asegura que cualquier objeto de configuración de sintetizador tenga todos los campos
 * de la arquitectura analógica completamente inicializados con valores seguros y válidos.
 */
export function normalizeSynthSettings(raw?: Partial<SynthSettings> | null): SynthSettings {
  const base = DEFAULT_SYNTH_SETTINGS;
  if (!raw) return { ...base };

  const legacyWave = raw.waveType || base.waveType;
  const legacyDetune = typeof raw.detune === 'number' ? raw.detune : base.detune;

  const envelope = {
    attack: typeof raw.envelope?.attack === 'number' ? Math.max(0.001, raw.envelope.attack) : base.envelope.attack,
    decay: typeof raw.envelope?.decay === 'number' ? Math.max(0.001, raw.envelope.decay) : base.envelope.decay,
    sustain: typeof raw.envelope?.sustain === 'number' ? Math.max(0, Math.min(1, raw.envelope.sustain)) : base.envelope.sustain,
    release: typeof raw.envelope?.release === 'number' ? Math.max(0.001, raw.envelope.release) : base.envelope.release
  };

  const filter = {
    enabled: raw.filter?.enabled !== undefined ? Boolean(raw.filter.enabled) : base.filter.enabled,
    type: raw.filter?.type || base.filter.type,
    frequency: typeof raw.filter?.frequency === 'number' ? Math.max(40, Math.min(20000, raw.filter.frequency)) : base.filter.frequency,
    Q: typeof raw.filter?.Q === 'number' ? Math.max(0.1, Math.min(20, raw.filter.Q)) : base.filter.Q,
    rolloff: raw.filter?.rolloff || base.filter.rolloff,
    drive: typeof raw.filter?.drive === 'number' ? raw.filter.drive : base.filter.drive,
    envAmount: typeof raw.filter?.envAmount === 'number' ? raw.filter.envAmount : base.filter.envAmount,
    keyTracking: typeof raw.filter?.keyTracking === 'number' ? raw.filter.keyTracking : base.filter.keyTracking
  };

  const osc1 = {
    enabled: raw.osc1?.enabled !== undefined ? Boolean(raw.osc1.enabled) : true,
    waveType: raw.osc1?.waveType || (legacyWave as any) || base.osc1?.waveType || 'triangle',
    octave: typeof raw.osc1?.octave === 'number' ? raw.osc1.octave : (base.osc1?.octave ?? 0),
    semi: typeof raw.osc1?.semi === 'number' ? raw.osc1.semi : (base.osc1?.semi ?? 0),
    detune: typeof raw.osc1?.detune === 'number' ? raw.osc1.detune : legacyDetune,
    volume: typeof raw.osc1?.volume === 'number' ? raw.osc1.volume : (base.osc1?.volume ?? 0.8),
    pulseWidth: raw.osc1?.pulseWidth ?? base.osc1?.pulseWidth
  };

  const osc2 = {
    enabled: raw.osc2?.enabled !== undefined ? Boolean(raw.osc2.enabled) : (base.osc2?.enabled ?? true),
    waveType: raw.osc2?.waveType || base.osc2?.waveType || 'sawtooth',
    octave: typeof raw.osc2?.octave === 'number' ? raw.osc2.octave : (base.osc2?.octave ?? 0),
    semi: typeof raw.osc2?.semi === 'number' ? raw.osc2.semi : (base.osc2?.semi ?? 0),
    detune: typeof raw.osc2?.detune === 'number' ? raw.osc2.detune : (base.osc2?.detune ?? 6),
    volume: typeof raw.osc2?.volume === 'number' ? raw.osc2.volume : (base.osc2?.volume ?? 0.4),
    pulseWidth: raw.osc2?.pulseWidth ?? base.osc2?.pulseWidth
  };

  const subOsc = {
    enabled: raw.subOsc?.enabled !== undefined ? Boolean(raw.subOsc.enabled) : (base.subOsc?.enabled ?? false),
    waveType: raw.subOsc?.waveType || base.subOsc?.waveType || 'sine',
    octave: raw.subOsc?.octave || base.subOsc?.octave || -1,
    volume: typeof raw.subOsc?.volume === 'number' ? raw.subOsc.volume : (base.subOsc?.volume ?? 0.0)
  };

  const noise = {
    enabled: raw.noise?.enabled !== undefined ? Boolean(raw.noise.enabled) : (base.noise?.enabled ?? false),
    type: raw.noise?.type || base.noise?.type || 'white',
    volume: typeof raw.noise?.volume === 'number' ? raw.noise.volume : (base.noise?.volume ?? 0.0)
  };

  const filterEnv = {
    attack: typeof raw.filterEnv?.attack === 'number' ? Math.max(0.001, raw.filterEnv.attack) : (base.filterEnv?.attack ?? 0.02),
    decay: typeof raw.filterEnv?.decay === 'number' ? Math.max(0.001, raw.filterEnv.decay) : (base.filterEnv?.decay ?? 0.35),
    sustain: typeof raw.filterEnv?.sustain === 'number' ? Math.max(0, Math.min(1, raw.filterEnv.sustain)) : (base.filterEnv?.sustain ?? 0.3),
    release: typeof raw.filterEnv?.release === 'number' ? Math.max(0.001, raw.filterEnv.release) : (base.filterEnv?.release ?? 0.6)
  };

  const lfo = {
    enabled: raw.lfo?.enabled !== undefined ? Boolean(raw.lfo.enabled) : (base.lfo?.enabled ?? false),
    waveType: raw.lfo?.waveType || base.lfo?.waveType || 'sine',
    rate: typeof raw.lfo?.rate === 'number' ? raw.lfo.rate : (base.lfo?.rate ?? 2.5),
    depth: typeof raw.lfo?.depth === 'number' ? raw.lfo.depth : (base.lfo?.depth ?? 0.25),
    target: raw.lfo?.target || base.lfo?.target || 'cutoff'
  };

  const fx = {
    chorus: {
      enabled: raw.fx?.chorus?.enabled !== undefined ? Boolean(raw.fx.chorus.enabled) : (base.fx?.chorus?.enabled ?? false),
      depth: typeof raw.fx?.chorus?.depth === 'number' ? raw.fx.chorus.depth : (base.fx?.chorus?.depth ?? 0.4),
      rate: typeof raw.fx?.chorus?.rate === 'number' ? raw.fx.chorus.rate : (base.fx?.chorus?.rate ?? 1.5),
      mix: typeof raw.fx?.chorus?.mix === 'number' ? raw.fx.chorus.mix : (base.fx?.chorus?.mix ?? 0.3)
    },
    delay: {
      enabled: raw.fx?.delay?.enabled !== undefined ? Boolean(raw.fx.delay.enabled) : (base.fx?.delay?.enabled ?? false),
      time: raw.fx?.delay?.time !== undefined ? raw.fx.delay.time : (base.fx?.delay?.time ?? '8n'),
      feedback: typeof raw.fx?.delay?.feedback === 'number' ? raw.fx.delay.feedback : (base.fx?.delay?.feedback ?? 0.25),
      mix: typeof raw.fx?.delay?.mix === 'number' ? raw.fx.delay.mix : (base.fx?.delay?.mix ?? 0.2)
    },
    reverb: {
      enabled: raw.fx?.reverb?.enabled !== undefined ? Boolean(raw.fx.reverb.enabled) : (base.fx?.reverb?.enabled ?? false),
      decay: typeof raw.fx?.reverb?.decay === 'number' ? raw.fx.reverb.decay : (base.fx?.reverb?.decay ?? 1.8),
      mix: typeof raw.fx?.reverb?.mix === 'number' ? raw.fx.reverb.mix : (base.fx?.reverb?.mix ?? 0.15)
    }
  };

  return {
    waveType: (osc1.waveType === 'pulse' ? 'square' : osc1.waveType) as any,
    detune: osc1.detune,
    envelope,
    filter,
    osc1,
    osc2,
    subOsc,
    noise,
    filterEnv,
    lfo,
    fx,
    glide: typeof raw.glide === 'number' ? raw.glide : base.glide,
    presetName: raw.presetName || base.presetName
  };
}
