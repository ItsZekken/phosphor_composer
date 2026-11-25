/**
 * projectFileImport.ts
 * Lógica unificada para importar proyectos (.phos, .json, .mid) y pistas de audio (.wav, .mp3, .ogg, .flac)
 * tanto desde el selector del Header como desde el Drag & Drop global.
 */

import { useSongStore } from '../../store/songStore';
import { importProjectFromPhosBundle, isPhosBundle } from './phosphorBundle';
import { importMidiToSession } from '../../utils/midiService';
import { audioBufferRegistry } from '../audio/audioBufferRegistry';
import { waveformService } from '../audio/waveformService';
import { getNativeAudioContext } from '../audio/worklet/PhosphorWorkletNode';
import { generateId } from '../../utils/idGenerator';
import { notify } from '../ui/toastBus';

const AUDIO_EXTENSIONS = /\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i;
const PROJECT_EXTENSIONS = /\.(phos|zip|json|mid|midi)$/i;

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
      const { session, warnings, audioBuffersLoaded } = await importProjectFromPhosBundle(arrayBuffer);
      store.importSong(session, baseTitle);
      if (warnings && warnings.length > 0) {
        console.warn('[projectFileImport] Advertencias al importar .phos:', warnings);
      }
      const detail = audioBuffersLoaded > 0
        ? `${audioBuffersLoaded} pista${audioBuffersLoaded === 1 ? '' : 's'} de audio restaurada${audioBuffersLoaded === 1 ? '' : 's'}`
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

    if (isSupportedAudioFile(file)) {
      const count = await importAudioFilesToTracks([file], { switchToTracksView: true });
      return count > 0;
    }

    notify.warning(`Formato no soportado: ${file.name}`, 'Usa .phos, .json, .mid o audio (.wav/.mp3/.ogg/.flac)');
    return false;
  } catch (err) {
    notify.error(`Error al importar "${file.name}"`, (err as Error).message);
    return false;
  }
}
