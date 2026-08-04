import type { DrumCategoryKey } from './drumSamples';
import type { DrumChannel } from '../utils/typeDefinitions';

export interface DrumKitPreset {
  id: string;
  name: string;
  samples: Record<string, string>; // Mapea id del canal o tipo ('kick_1', 'snare_1', etc.) a sampleUrl
}

// Generamos 10 Kits Predefinidos variando los índices de los samples
export const PRESET_DRUM_KITS: DrumKitPreset[] = Array.from({ length: 10 }, (_, idx) => {
  const n = idx + 1;
  
  // Clampeo/Modulo según la cantidad de muestras existentes
  const kickIndex = Math.min(n, 11);
  const snareIndex = Math.min(n, 12);
  const clapIndex = Math.min(n, 7);
  const hihatClosedIndex = Math.min(n, 6);
  const hihatOpenIndex = Math.min(n, 4);
  const crashIndex = Math.min(n, 5);

  return {
    id: `kit_${n}`,
    name: `Kit ${n}`,
    samples: {
      'kick_1': `/drums/kicks/kick${kickIndex}.wav`,
      'snare_1': `/drums/snares/snare${snareIndex}.wav`,
      'hihat_closed': `/drums/hihats_closed/hihat_closed${hihatClosedIndex}.wav`,
      'hihat_open': `/drums/hihats_open/hihat_open${hihatOpenIndex}.wav`,
      'clap_1': `/drums/claps/clap${clapIndex}.wav`,
      'crash_1': `/drums/crashes/crash${crashIndex}.wav`,

      // Mapeos secundarios para canales agregados en el futuro por tipo de sample
      'kicks': `/drums/kicks/kick${kickIndex}.wav`,
      'snares': `/drums/snares/snare${snareIndex}.wav`,
      'claps': `/drums/claps/clap${clapIndex}.wav`,
      'hihats_closed': `/drums/hihats_closed/hihat_closed${hihatClosedIndex}.wav`,
      'hihats_open': `/drums/hihats_open/hihat_open${hihatOpenIndex}.wav`,
      'crashes': `/drums/crashes/crash${crashIndex}.wav`
    }
  };
});

/**
 * Determina si la configuración actual de drumChannels coincide exactamente con algún Kit predefinido.
 * Si no coincide con ninguno, retorna 'custom'.
 */
export const findMatchingKitId = (channels: DrumChannel[]): string => {
  for (const kit of PRESET_DRUM_KITS) {
    const isMatch = channels.every(ch => {
      const expectedUrl = kit.samples[ch.id] || kit.samples[inferCategoryFromChannel(ch)];
      return !expectedUrl || ch.sampleUrl === expectedUrl;
    });

    if (isMatch) {
      return kit.id;
    }
  }
  return 'custom';
};

/**
 * Infiere la categoría de sample a partir del id o sampleUrl del canal.
 */
export const inferCategoryFromChannel = (channel: DrumChannel): DrumCategoryKey => {
  const url = channel.sampleUrl.toLowerCase();
  const id = channel.id.toLowerCase();

  if (url.includes('kick') || id.includes('kick')) return 'kicks';
  if (url.includes('snare') || id.includes('snare')) return 'snares';
  if (url.includes('clap') || id.includes('clap')) return 'claps';
  if (url.includes('hihats_closed') || url.includes('closed') || id.includes('closed')) return 'hihats_closed';
  if (url.includes('hihats_open') || url.includes('open') || id.includes('open')) return 'hihats_open';
  if (url.includes('crash') || id.includes('crash')) return 'crashes';
  if (url.includes('tom') || id.includes('tom')) return 'toms';
  if (url.includes('ride') || id.includes('ride')) return 'rides';
  if (url.includes('perc') || id.includes('perc')) return 'perc';
  return 'fx';
};
