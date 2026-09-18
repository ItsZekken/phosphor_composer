/**
 * phosphorBundle.ts
 * Administrador de paquetes de proyecto de Phosphor (.phos).
 * Empaqueta y desempaqueta de forma atómica y portátil la sesión musical (project.json)
 * y todas las pistas de audio grabadas o importadas (audio/*.wav) utilizando compresión fflate.
 */

import { zip, unzip, strToU8, strFromU8, type AsyncZippable } from 'fflate';
import { serializeSession, deserializeSession } from './sessionSerializer';
import type { SessionV2, SessionMetadata } from './sessionTypes';
import { audioBufferToWav } from '../../utils/wavEncoder';
import { audioBufferRegistry } from '../audio/audioBufferRegistry';
import { waveformService } from '../audio/waveformService';
import { getNativeAudioContext } from '../audio/worklet/PhosphorWorkletNode';

/**
 * Comprueba si un búfer binario corresponde a un archivo ZIP / .phos válido
 * verificando los bytes mágicos de la cabecera Local File Header (PK\x03\x04).
 */
export function isPhosBundle(data: ArrayBuffer | Uint8Array): boolean {
  if (!data) return false;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Sanitiza una cadena para su uso seguro como nombre de archivo en cualquier sistema operativo.
 */
function sanitizeFileName(str: string): string {
  return str.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

export interface ExportPhosResult {
  blob: Blob;
  filename: string;
  audioCount: number;
}

/**
 * Exporta el estado completo de la canción como un paquete de proyecto .phos.
 * Empaqueta project.json y todas las pistas de audio activas en la subcarpeta virtual audio/*.wav.
 */
export async function exportProjectToPhosBundle(
  state: any,
  metadataUpdates?: Partial<SessionMetadata>,
  onProgress?: (message: string, percent: number) => void
): Promise<ExportPhosResult> {
  onProgress?.('Serializando estructura musical...', 15);

  const session = serializeSession(state, metadataUpdates);
  const jsonString = JSON.stringify(session, null, 2);
  const projectJsonBytes = strToU8(jsonString);

  const zipFiles: AsyncZippable = {
    'project.json': [projectJsonBytes, { level: 6 }]
  };

  const audioClips = state.audioClips || [];
  const uniqueBufferIds = Array.from(
    new Set<string>(audioClips.map((c: any) => c.bufferId).filter(Boolean))
  );

  let audioCount = 0;
  if (uniqueBufferIds.length > 0) {
    const audioDir: AsyncZippable = {};
    const nativeCtx = getNativeAudioContext();

    for (let i = 0; i < uniqueBufferIds.length; i++) {
      const bufferId = uniqueBufferIds[i];
      const progressPercent = 20 + Math.round(((i + 1) / uniqueBufferIds.length) * 55);
      onProgress?.(`Procesando pista de audio ${i + 1}/${uniqueBufferIds.length}...`, progressPercent);

      let buffer = audioBufferRegistry.getBuffer(bufferId);
      if (!buffer && nativeCtx) {
        try {
          buffer = (await audioBufferRegistry.loadBufferFromIndexedDB(bufferId, nativeCtx)) || undefined;
        } catch {}
      }

      if (buffer) {
        try {
          const wavArrayBuffer = audioBufferToWav(buffer, { normalize: false });
          const wavBytes = new Uint8Array(wavArrayBuffer);
          // Nivel 2: compresión ligera y ultrarrápida ideal para audio PCM 16-bit
          audioDir[`${bufferId}.wav`] = [wavBytes, { level: 2 }];
          audioCount++;
        } catch (err) {
          console.warn(`[phosphorBundle] No se pudo convertir buffer ${bufferId} a WAV:`, err);
        }
      }
    }

    if (Object.keys(audioDir).length > 0) {
      zipFiles['audio'] = audioDir;
    }
  }

  onProgress?.('Generando paquete comprimido .phos...', 80);

  const zipData = await new Promise<Uint8Array>((resolve, reject) => {
    zip(zipFiles, { level: 4 }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });

  onProgress?.('Finalizando empaquetado...', 98);

  const keyStr = session.transport.key || 'C';
  const scaleStr = session.transport.scale || 'major';
  const bpmStr = session.transport.bpm || 120;
  const projectTitle = metadataUpdates?.title || session.metadata?.title || 'Phosphor Project';
  const safeTitle = sanitizeFileName(projectTitle);
  const filename = `${safeTitle}_${keyStr}_${scaleStr}_${bpmStr}bpm.phos`;

  const blob = new Blob([zipData.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  onProgress?.('Completado', 100);

  return { blob, filename, audioCount };
}

export interface ImportPhosResult {
  session: SessionV2;
  warnings: string[];
  audioBuffersLoaded: number;
}

/**
 * Importa y desempaqueta un archivo .phos (o .zip).
 * Extrae el archivo project.json, decodifica cada archivo de audio en audio/*.wav,
 * los registra en audioBufferRegistry y en IndexedDB, y retorna la sesión deserializada.
 */
export async function importProjectFromPhosBundle(
  bundleData: ArrayBuffer | Uint8Array,
  targetContext?: AudioContext,
  onProgress?: (message: string, percent: number) => void
): Promise<ImportPhosResult> {
  onProgress?.('Descomprimiendo archivo .phos...', 15);

  const u8Data = bundleData instanceof Uint8Array ? bundleData : new Uint8Array(bundleData);

  const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(u8Data, (err, data) => {
      if (err) {
        reject(new Error(`Fallo al descomprimir paquete .phos: ${err.message}`));
      } else {
        resolve(data);
      }
    });
  });

  // 1. Localizar y deserializar project.json
  let projectJsonBytes = unzipped['project.json'];
  if (!projectJsonBytes) {
    // Búsqueda insensible o en subcarpetas si fue empaquetado por una herramienta externa
    const foundKey = Object.keys(unzipped).find(
      (k) => k.toLowerCase() === 'project.json' || k.toLowerCase().endsWith('/project.json')
    );
    if (foundKey) {
      projectJsonBytes = unzipped[foundKey];
    }
  }

  if (!projectJsonBytes) {
    throw new Error('El paquete .phos es inválido: no contiene el archivo principal "project.json".');
  }

  onProgress?.('Leyendo estructura del proyecto...', 35);
  const jsonStr = strFromU8(projectJsonBytes);
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`El archivo project.json dentro del paquete .phos está corrupto: ${(err as Error).message}`);
  }

  const { session, warnings } = deserializeSession(parsedRaw);

  // 2. Extraer y decodificar pistas de audio (carpeta audio/*)
  const audioEntries = Object.entries(unzipped).filter(([filename, bytes]) => {
    const lower = filename.toLowerCase();
    return (
      bytes.length > 44 && // Mínimo encabezado WAV
      (lower.startsWith('audio/') || lower.includes('/audio/')) &&
      (lower.endsWith('.wav') || lower.endsWith('.mp3') || lower.endsWith('.ogg') || lower.endsWith('.flac'))
    );
  });

  let audioBuffersLoaded = 0;
  if (audioEntries.length > 0) {
    const audioCtx = targetContext || getNativeAudioContext();
    if (!audioCtx) {
      warnings.push('No hay AudioContext activo disponible para decodificar pistas de audio importadas.');
    } else {
      for (let i = 0; i < audioEntries.length; i++) {
        const [filePath, fileBytes] = audioEntries[i];
        const progressPercent = 40 + Math.round(((i + 1) / audioEntries.length) * 55);
        onProgress?.(`Decodificando pista de audio ${i + 1}/${audioEntries.length}...`, progressPercent);

        // Extraer bufferId del nombre del archivo (ej: "audio/ab_12345.wav" -> "ab_12345")
        const baseName = filePath.split('/').pop() || filePath;
        const bufferId = baseName.replace(/\.[^/.]+$/, '');

        try {
          // Clonamos el ArrayBuffer porque decodeAudioData desvincula/consume el buffer subyacente
          const arrayBufferCopy = fileBytes.buffer.slice(
            fileBytes.byteOffset,
            fileBytes.byteOffset + fileBytes.byteLength
          ) as ArrayBuffer;

          const audioBuffer = await audioCtx.decodeAudioData(arrayBufferCopy);
          audioBufferRegistry.registerBuffer(audioBuffer, bufferId);
          audioBufferRegistry.saveBufferToIndexedDB(bufferId, audioBuffer).catch(() => {});
          waveformService.getOrGeneratePeaks(bufferId, audioBuffer).catch(() => {});
          audioBuffersLoaded++;
        } catch (decodeErr) {
          warnings.push(`No se pudo decodificar el archivo de audio "${baseName}": ${decodeErr}`);
        }
      }
    }
  }

  onProgress?.('Proyecto importado con éxito', 100);
  return { session, warnings, audioBuffersLoaded };
}
