export interface DrumSampleDefinition {
  id: string;
  name: string;
  category: DrumCategoryKey;
  path: string;
}

export type DrumCategoryKey = 
  | 'kicks'
  | 'snares'
  | 'claps'
  | 'hihats_closed'
  | 'hihats_open'
  | 'crashes'
  | 'toms'
  | 'rides'
  | 'perc'
  | 'fx';

export interface DrumCategoryMeta {
  key: DrumCategoryKey;
  label: string;
  description: string;
}

export const DRUM_CATEGORIES: DrumCategoryMeta[] = [
  { key: 'kicks', label: 'Kicks', description: 'Bombos y frecuencias graves' },
  { key: 'snares', label: 'Snares', description: 'Cajas y tarolas' },
  { key: 'claps', label: 'Claps', description: 'Palmas y aplausos' },
  { key: 'hihats_closed', label: 'Hi-Hats Cerrados', description: 'Hats cerrados rítmicos' },
  { key: 'hihats_open', label: 'Hi-Hats Abiertos', description: 'Hats abiertos y acentos' },
  { key: 'crashes', label: 'Crashes & Platillos', description: 'Platillos de remate y acentos' },
  { key: 'toms', label: 'Toms', description: 'Toms y timbales' },
  { key: 'rides', label: 'Rides', description: 'Platillos ride' },
  { key: 'perc', label: 'Percusión', description: 'Percusiones varias y latinas' },
  { key: 'fx', label: 'Efectos (FX)', description: 'Impactos, risers y efectos' }
];

export const AVAILABLE_DRUM_SAMPLES: DrumSampleDefinition[] = [
  // Kicks
  ...Array.from({ length: 11 }, (_, i) => ({
    id: `kick_${i + 1}`,
    name: `Kick ${i + 1}`,
    category: 'kicks' as DrumCategoryKey,
    path: `/drums/kicks/kick${i + 1}.wav`
  })),

  // Snares
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `snare_${i + 1}`,
    name: `Snare ${i + 1}`,
    category: 'snares' as DrumCategoryKey,
    path: `/drums/snares/snare${i + 1}.wav`
  })),

  // Claps
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `clap_${i + 1}`,
    name: `Clap ${i + 1}`,
    category: 'claps' as DrumCategoryKey,
    path: `/drums/claps/clap${i + 1}.wav`
  })),

  // HiHats Closed
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `hihat_closed_${i + 1}`,
    name: `HiHat Closed ${i + 1}`,
    category: 'hihats_closed' as DrumCategoryKey,
    path: `/drums/hihats_closed/hihat_closed${i + 1}.wav`
  })),

  // HiHats Open
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `hihat_open_${i + 1}`,
    name: `HiHat Open ${i + 1}`,
    category: 'hihats_open' as DrumCategoryKey,
    path: `/drums/hihats_open/hihat_open${i + 1}.wav`
  })),

  // Crashes
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `crash_${i + 1}`,
    name: `Crash ${i + 1}`,
    category: 'crashes' as DrumCategoryKey,
    path: `/drums/crashes/crash${i + 1}.wav`
  }))
];

export const getSamplesByCategory = (category: DrumCategoryKey): DrumSampleDefinition[] => {
  return AVAILABLE_DRUM_SAMPLES.filter(s => s.category === category);
};

export const getSampleByPath = (path: string): DrumSampleDefinition | undefined => {
  return AVAILABLE_DRUM_SAMPLES.find(s => s.path === path);
};
