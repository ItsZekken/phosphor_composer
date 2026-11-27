/**
 * projectFileImport.ts
 * Lógica unificada para importar proyectos (.phos, .json, .mid) y pistas de audio (.wav, .mp3, .ogg, .flac)
 * tanto desde el selector del Header como desde el Drag & Drop global.
 */

import * as Tone from 'tone';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { buildCustomSampleUrl } from '../../constants/drumSamples';
import type { CustomDrumSample, SoundFontAsset } from '../../utils/typeDefinitions';
import { importProjectFromPhosBundle, isPhosBundle } from './phosphorBundle';
import { importMidiToSession } from '../../utils/midiService';
import { audioBufferRegistry } from '../audio/audioBufferRegistry';
import { soundfontRegistry } from '../audio/soundfont/soundfontRegistry';
import { waveformService } from '../audio/waveformService';
import { getNativeAudioContext } from '../audio/worklet/PhosphorWorkletNode';
import { generateId } from '../../utils/idGenerator';
import { notify } from '../ui/toastBus';

const AUDIO_EXTENSIONS = /\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i;
const PROJECT_EXTENSIONS = /\.(phos|zip|json|mid|midi)$/i;
const SOUNDFONT_EXTENSIONS = /\.(sf2|sf3)$/i;
const SOUNDFONT_UPLOAD_EXTENSIONS = /\.(sf2|sf3|js|json)$/i;
const PROJECT_MIME_TYPES = new Set([
  'application/json',
  'text/json',
  'application/zip',
  'application/x-zip-compressed',
  'audio/midi',
  'audio/mid',
  'audio/x-midi'
]);

export function hasExternalFilesPayload(e: { dataTransfer: DataTransfer | null }): boolean {
  const dt = e.dataTransfer;
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes('Files')) {
    return true;
  }
  return Boolean(dt.files && dt.files.length > 0);
}

/**
 * Devuelve true solo cuando todos los archivos arrastrados declaran explícitamente un MIME de proyecto/MIDI.
 * Útil en el Drum Sequencer para mostrar el overlay global solo en proyectos y dejar libre el rack para samples.
 */
export function isExplicitProjectOnlyDrag(e: { dataTransfer: DataTransfer | null }): boolean {
  const items = e.dataTransfer?.items;
  if (!items || items.length === 0) return false;
  let fileItemCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;
    fileItemCount++;
    const mime = (item.type || '').toLowerCase();
    if (!mime || !PROJECT_MIME_TYPES.has(mime)) {
      return false;
    }
  }
  return fileItemCount > 0;
}

export function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '').trim() || 'Phosphor Project';
}

export function sanitizeExportBaseName(title: string, fallback = 'phosphor_project'): string {
  const cleaned = (title || '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
    .trim();
  return cleaned || fallback;
}

export function isSupportedAudioFile(file: File): boolean {
  return Boolean(file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name));
}

export function isSupportedProjectFile(file: File): boolean {
  return PROJECT_EXTENSIONS.test(file.name);
}

export function isSupportedSoundFontFile(file: File): boolean {
  return SOUNDFONT_EXTENSIONS.test(file.name);
}

export function isSupportedSoundFontUploadFile(file: File): boolean {
  return SOUNDFONT_UPLOAD_EXTENSIONS.test(file.name);
}

/**
 * Importa uno o más archivos SoundFont (.sf2, .sf3 o WebAudioFont .js/.json),
 * los registra en soundfontRegistry + IndexedDB y opcionalmente asigna el primero al canal objetivo.
 */
export async function importSoundFontFiles(
  files: File[],
  targetChannelId?: string,
  options?: { silent?: boolean; openModal?: boolean }
): Promise<SoundFontAsset[]> {
  if (!files || files.length === 0) return [];

  const validFiles = files.filter(isSupportedSoundFontUploadFile);
  if (validFiles.length === 0) {
    if (!options?.silent) {
      notify.warning(
        'Formato SoundFont no soportado',
        'Usa archivos .sf2, .sf3 o presets WebAudioFont (.js / .json)'
      );
    }
    return [];
  }

  toneEngine.unlockIfSuspended();
  const imported: SoundFontAsset[] = [];

  for (const file of validFiles) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        notify.error(`El archivo "${file.name}" está vacío`);
        continue;
      }

      const bytes = new Uint8Array(arrayBuffer);
      const { asset } = soundfontRegistry.registerFromBytes(bytes, file.name);
      soundfontRegistry.saveToIndexedDB(asset.id, asset, bytes).catch(() => {});

      useSongStore.getState().addSoundFontAsset(asset);
      imported.push(asset);
    } catch (err) {
      notify.error(`No se pudo cargar SoundFont "${file.name}"`, (err as Error).message);
    }
  }

  if (imported.length > 0) {
    const firstAsset = imported[0];
    if (targetChannelId && firstAsset.patches.length > 0) {
      const state = useSongStore.getState();
      const firstPatch =
        firstAsset.patches.find((p) => p.bank === 0 && p.program === 0) || firstAsset.patches[0];
      const nextConfig = {
        soundfontId: firstAsset.id,
        bank: firstPatch.bank,
        program: firstPatch.program,
        patchName: firstPatch.name,
        gain: 1.0,
        releaseMultiplier: 1.0,
        transpose: 0
      };
      state.setChannelInstrument(targetChannelId, 'soundfont');
      state.setChannelSoundFontConfig(targetChannelId, nextConfig);
      if (options?.openModal) {
        state.openSoundFontConfigForChannel(targetChannelId);
      }
    }

    if (!options?.silent) {
      const patchCount = firstAsset.patches.length;
      notify.success(
        imported.length === 1
          ? `SoundFont cargado: ${firstAsset.name}`
          : `${imported.length} SoundFonts cargados`,
        imported.length === 1
          ? `${patchCount} ${patchCount === 1 ? 'patch disponible' : 'patches disponibles'} · Se guardará en .phos`
          : undefined
      );
    }
  }

  return imported;
}

export async function importAudioFilesToTracks(
  files: File[],
  options?: { switchToTracksView?: boolean }
): Promise<number> {
  const audioFiles = files.filter(isSupportedAudioFile);
  if (audioFiles.length === 0) return 0;

  const nativeCtx = getNativeAudioContext();
  if (!nativeCtx) {
    notify.error('Motor de audio no disponible para decodificar el archivo');
    return 0;
  }

  const state = useSongStore.getState();
  let importedCount = 0;

  for (const file of audioFiles) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await nativeCtx.decodeAudioData(arrayBuffer);
      const bufferId = audioBufferRegistry.registerBuffer(audioBuffer);
      audioBufferRegistry.saveBufferToIndexedDB(bufferId, audioBuffer).catch(() => {});
      waveformService.getOrGeneratePeaks(bufferId, audioBuffer).catch(() => {});

      const latest = useSongStore.getState();
      const clipName = stripFileExtension(file.name);
      const trackId =
        latest.armedTrackId ||
        (latest.audioTracks.length === 1 && latest.audioClips.length === 0 ? latest.audioTracks[0].id : null) ||
        latest.addAudioTrack(clipName);

      latest.addAudioClip({
        id: `clip_${generateId()}`,
        trackId,
        bufferId,
        name: clipName,
        startBeat: Math.floor(latest.currentBeat || 0),
        sourceOffsetSeconds: 0,
        durationSeconds: audioBuffer.duration,
        gain: 1.0,
        fadeInSeconds: 0.005,
        fadeOutSeconds: 0.005,
        isMuted: false
      });
      importedCount++;
    } catch (err) {
      notify.error(`No se pudo importar "${file.name}"`, (err as Error).message);
    }
  }

  if (importedCount > 0) {
    if (options?.switchToTracksView && state.activeView !== 'audio-tracks') {
      useSongStore.getState().setActiveView('audio-tracks');
    }
    notify.success(
      importedCount === 1
        ? `Audio importado: ${stripFileExtension(audioFiles[0].name)}`
        : `${importedCount} archivos de audio importados a Tracks`
    );
  }

  return importedCount;
}

function resolveUniqueSampleName(baseName: string, existingNames: Set<string>): string {
  const cleaned = baseName.trim() || 'Sample personalizado';
  if (!existingNames.has(cleaned.toLowerCase())) {
    existingNames.add(cleaned.toLowerCase());
    return cleaned;
  }
  let suffix = 2;
  while (existingNames.has(`${cleaned} (${suffix})`.toLowerCase())) {
    suffix++;
  }
  const uniqueName = `${cleaned} (${suffix})`;
  existingNames.add(uniqueName.toLowerCase());
  return uniqueName;
}

export async function importCustomDrumSamples(
  files: File[],
  targetChannelId?: string,
  options?: { silent?: boolean }
): Promise<CustomDrumSample[]> {
  if (!files || files.length === 0) return [];

  const audioFiles = files.filter(isSupportedAudioFile);
  if (audioFiles.length === 0) {
    if (!options?.silent) {
      notify.warning(
        'Formato de audio no soportado',
        'Usa archivos .wav, .mp3, .ogg, .flac, .m4a o .aac'
      );
    }
    return [];
  }

  toneEngine.unlockIfSuspended();
  const audioCtx =
    getNativeAudioContext() ||
    (Tone.getContext().rawContext as AudioContext);
  if (!audioCtx) {
    notify.error('Motor de audio no disponible para decodificar el sample');
    return [];
  }

  const existingNames = new Set(
    (useSongStore.getState().customDrumSamples || []).map((s) => s.name.trim().toLowerCase())
  );
  const imported: CustomDrumSample[] = [];

  for (const file of audioFiles) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        notify.error(`El archivo "${file.name}" está vacío`);
        continue;
      }

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      if (!audioBuffer || audioBuffer.length === 0) {
        notify.error(`No se pudo decodificar "${file.name}"`, 'El archivo no contiene audio válido');
        continue;
      }

      const bufferId = generateId('ds');
      const sampleUrl = buildCustomSampleUrl(bufferId);
      const sampleName = resolveUniqueSampleName(
        file.name.replace(/\.[^/.]+$/, '').trim() || 'Sample personalizado',
        existingNames
      );

      audioBufferRegistry.registerBuffer(audioBuffer, bufferId);
      audioBufferRegistry.saveBufferToIndexedDB(bufferId, audioBuffer).catch(() => {});
      if (typeof toneEngine.registerCustomDrumSample === 'function') {
        toneEngine.registerCustomDrumSample(sampleUrl, audioBuffer);
      }

      const newSample: CustomDrumSample = {
        id: bufferId,
        name: sampleName,
        sampleUrl,
        createdAt: Date.now()
      };

      useSongStore.getState().addCustomDrumSample(newSample);
      imported.push(newSample);
    } catch (err) {
      notify.error(`No se pudo importar "${file.name}"`, (err as Error).message);
    }
  }

  if (imported.length > 0) {
    if (targetChannelId) {
      const state = useSongStore.getState();
      const targetChannel = state.drumChannels.find((c) => c.id === targetChannelId);
      const shouldAutoRename = Boolean(targetChannel && /^Custom \d+$/i.test(targetChannel.name.trim()));
      state.updateDrumChannel(targetChannelId, {
        sampleUrl: imported[0].sampleUrl,
        ...(shouldAutoRename ? { name: imported[0].name } : {})
      });
      toneEngine.playDrumPreview(targetChannelId);

      if (!options?.silent) {
        const channelLabel = shouldAutoRename ? imported[0].name : (targetChannel?.name || 'canal');
        notify.success(
          imported.length === 1
            ? `Sample asignado a ${channelLabel}: ${imported[0].name}`
            : `${imported.length} samples importados`,
          imported.length > 1 ? `Asignado a ${channelLabel}: ${imported[0].name}` : undefined
        );
      }
    } else if (!options?.silent) {
      notify.success(
        imported.length === 1
          ? `Sample importado: ${imported[0].name}`
          : `${imported.length} samples importados`
      );
    }
  }

  return imported;
}

export async function importCustomDrumSamplesAsNewChannels(files: File[]): Promise<CustomDrumSample[]> {
  const imported = await importCustomDrumSamples(files, undefined, { silent: true });
  if (imported.length === 0) return [];

  const state = useSongStore.getState();
  const totalPatterns = state.drumChannels[0]?.patterns?.length || 8;
  const lengths = state.patternLengths || [];
  let firstChannelId: string | null = null;

  for (const sample of imported) {
    const channelId = generateId('custom_drum');
    if (!firstChannelId) firstChannelId = channelId;
    const patterns = Array.from({ length: totalPatterns }, (_, patIdx) => {
      const len = lengths[patIdx] || 16;
      return Array.from({ length: len }, () => ({ isActive: false, velocity: 0.8 }));
    });

    useSongStore.getState().addDrumChannel({
      id: channelId,
      name: sample.name,
      sampleUrl: sample.sampleUrl,
      patterns,
      volume: 80,
      pan: 0,
      muted: false,
      solo: false
    });
  }

  if (firstChannelId) {
    toneEngine.playDrumPreview(firstChannelId);
  }

  notify.success(
    imported.length === 1
      ? `Nuevo canal añadido: ${imported[0].name}`
      : `${imported.length} canales de batería añadidos`
  );

  return imported;
}

export async function importProjectFile(file: File): Promise<boolean> {
  const lower = file.name.toLowerCase();
  const baseTitle = stripFileExtension(file.name);
  const store = useSongStore.getState();

  try {
    if (lower.endsWith('.json')) {
      const jsonStr = await file.text();
      store.importSong(jsonStr, baseTitle);
      notify.success(`Proyecto cargado: ${baseTitle}`);
      return true;
    }

    const arrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      notify.error('El archivo está vacío');
      return false;
    }

    if (lower.endsWith('.phos') || lower.endsWith('.zip') || isPhosBundle(arrayBuffer)) {
      const { session, warnings, audioBuffersLoaded, soundfontsLoaded } = await importProjectFromPhosBundle(arrayBuffer);
      store.importSong(session, baseTitle);
      if (warnings && warnings.length > 0) {
        console.warn('[projectFileImport] Advertencias al importar .phos:', warnings);
      }
      const parts: string[] = [];
      if (audioBuffersLoaded > 0) {
        parts.push(`${audioBuffersLoaded} pista${audioBuffersLoaded === 1 ? '' : 's'} de audio`);
      }
      if (soundfontsLoaded > 0) {
        parts.push(`${soundfontsLoaded} SoundFont${soundfontsLoaded === 1 ? '' : 's'}`);
      }
      const detail = parts.length > 0
        ? `Restaurado: ${parts.join(' · ')}`
        : `${session.transport.key} ${session.transport.scale} · ${session.transport.bpm} BPM`;
      notify.success(`Proyecto cargado: ${useSongStore.getState().projectTitle}`, detail);
      return true;
    }

    if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
      const result = importMidiToSession(arrayBuffer, store.customPatterns);
      if (result.success) {
        store.importSong(
          {
            bpm: result.bpm,
            tempoMarkers: result.tempoMarkers || [],
            key: result.key,
            scale: result.scale,
            pattern: result.pattern,
            timeSignature: result.timeSignature,
            chordBlocks: result.chordBlocks,
            styleMarkers: result.styleMarkers,
            tracks: result.tracks,
            melodyNotes: result.melodyNotes,
            isAutoKey: !result.isProject,
            chordOctaveShift: result.chordOctaveShift ?? 0,
            channels: result.channels,
            drumChannels: result.drumChannels,
            patternChain: result.patternChain,
            isPatternRepeatOn: result.isPatternRepeatOn,
            activeDrumKitId: result.activeDrumKitId,
            patternLengths: result.patternLengths
          },
          baseTitle
        );
        const finalState = useSongStore.getState();
        const details: string[] = [
          `${finalState.key} ${finalState.scale}`,
          `${finalState.bpm} BPM`
        ];
        if (result.summary) {
          if (result.summary.tracksCount > 0) {
            details.push(
              `${result.summary.tracksCount} pista${result.summary.tracksCount === 1 ? '' : 's'}`
            );
          }
          if (result.summary.drumPatternsCount > 0) {
            details.push(`batería (${result.summary.drumPatternsCount} pat.)`);
          }
          if (result.summary.chordsCount > 0) {
            details.push(
              result.summary.chordsMutedForFidelity
                ? `${result.summary.chordsCount} acordes (guía)`
                : `${result.summary.chordsCount} acordes`
            );
          }
        }
        notify.success(`MIDI importado: ${finalState.projectTitle}`, details.join(' · '), 4500);
        return true;
      } else {
        notify.error('Error importando archivo MIDI', result.message || 'Formato no compatible');
        return false;
      }
    }

    if (isSupportedSoundFontFile(file)) {
      const activeTrack = store.tracks.find((t) => t.id === store.activeTrackId);
      const targetChannelId =
        store.activeView === 'chord' ? 'chords' : (activeTrack?.channelId || 'melody');
      const loaded = await importSoundFontFiles([file], targetChannelId, { openModal: true });
      return loaded.length > 0;
    }

    if (isSupportedAudioFile(file)) {
      const count = await importAudioFilesToTracks([file], { switchToTracksView: true });
      return count > 0;
    }

    notify.warning(`Formato no soportado: ${file.name}`, 'Usa .phos, .json, .mid, .sf2/.sf3 o audio (.wav/.mp3/.ogg/.flac)');
    return false;
  } catch (err) {
    notify.error(`Error al importar "${file.name}"`, (err as Error).message);
    return false;
  }
}
