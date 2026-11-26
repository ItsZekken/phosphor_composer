/**
 * soundfontRegistry.ts
 * Registro centralizado en memoria e IndexedDB para archivos SoundFont (.sf2, .sf3, WebAudioFont .js/.json).
 * Desacopla los datos binarios pesados del estado reactivo de Zustand/Zundo y garantiza:
 * - Persistencia automática entre recargas (IndexedDB)
 * - Empaquetado lossless dentro de archivos .phos
 * - Decodificación perezosa y caché de AudioBuffers aislada por BaseAudioContext (soporte nativo Live + Offline)
 */

import { generateId } from '../../../utils/idGenerator';
import type { SoundFontAsset, SoundFontFormat } from '../../../utils/typeDefinitions';
import {
  parseSoundFontBytes,
  type ParsedSoundFont,
  type ParsedSoundFontPreset,
  type SoundFontZone
} from './sf2Parser';

const DB_NAME = 'phosphor_soundfont_db';
const DB_VERSION = 1;
const STORE_NAME = 'soundfonts';

interface StoredSoundFontRecord {
  id: string;
  name: string;
  fileName: string;
  format: SoundFontFormat;
  sizeBytes: number;
  data: ArrayBuffer;
  updatedAt: number;
}

function base64ToUint8Array(raw: string): Uint8Array {
  const cleaned = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  const normalized = cleaned.replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildAssetMetadata(id: string, fileName: string, parsed: ParsedSoundFont, sizeBytes: number): SoundFontAsset {
  return {
    id,
    name: parsed.name || fileName.replace(/\.[^/.]+$/, '').trim() || 'SoundFont',
    fileName,
    format: parsed.format,
    sizeBytes,
    patches: parsed.presets.map((p) => ({
      bank: p.bank,
      program: p.program,
      name: p.name,
      zoneCount: p.zones.length
    })),
    createdAt: Date.now()
  };
}

class SoundFontRegistry {
  private rawBytesMap = new Map<string, Uint8Array>();
  private parsedMap = new Map<string, ParsedSoundFont>();
  private metaMap = new Map<string, SoundFontAsset>();
  private contextBufferCaches = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
  private pendingLoads = new Map<string, Promise<ParsedSoundFont | null>>();
  private pendingDecodes = new Map<string, Promise<AudioBuffer | null>>();
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB no está disponible en este entorno.'));
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  private getContextCache(audioCtx: BaseAudioContext): Map<string, AudioBuffer> {
    let map = this.contextBufferCaches.get(audioCtx);
    if (!map) {
      map = new Map<string, AudioBuffer>();
      this.contextBufferCaches.set(audioCtx, map);
    }
    return map;
  }

  private getZoneCacheKey(soundfontId: string, zone: SoundFontZone): string {
    return `${soundfontId}:${zone.sampleId}:${zone.sampleStart}:${zone.sampleEnd}:${zone.sampleRate}`;
  }

  /**
   * Parsea y registra en memoria un SoundFont a partir de sus bytes originales.
   */
  public registerFromBytes(
    bytes: Uint8Array | ArrayBuffer,
    fileName: string,
    explicitId?: string
  ): { asset: SoundFontAsset; parsed: ParsedSoundFont } {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const id = explicitId || generateId('sf');
    const parsed = parseSoundFontBytes(u8, fileName);
    const asset = buildAssetMetadata(id, fileName, parsed, u8.byteLength);

    this.rawBytesMap.set(id, u8);
    this.parsedMap.set(id, parsed);
    this.metaMap.set(id, asset);

    return { asset, parsed };
  }

  public getParsed(id: string): ParsedSoundFont | undefined {
    return this.parsedMap.get(id);
  }

  public getRawBytes(id: string): Uint8Array | undefined {
    return this.rawBytesMap.get(id);
  }

  public getAssetMeta(id: string): SoundFontAsset | undefined {
    return this.metaMap.get(id);
  }

  public has(id: string): boolean {
    return this.parsedMap.has(id);
  }

  public findPreset(id: string, bank: number, program: number): ParsedSoundFontPreset | undefined {
    const parsed = this.parsedMap.get(id);
    if (!parsed || parsed.presets.length === 0) return undefined;
    const exact = parsed.presets.find((p) => p.bank === bank && p.program === program);
    if (exact) return exact;
    const sameProgram = parsed.presets.find((p) => p.program === program);
    return sameProgram || parsed.presets[0];
  }

  public delete(id: string): void {
    this.rawBytesMap.delete(id);
    this.parsedMap.delete(id);
    this.metaMap.delete(id);
  }

  /**
   * Persiste los bytes originales del SoundFont en IndexedDB.
   */
  public async saveToIndexedDB(id: string, asset: SoundFontAsset, bytes: Uint8Array): Promise<void> {
    try {
      const db = await this.getDb();
      const bufferCopy = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record: StoredSoundFontRecord = {
          id,
          name: asset.name,
          fileName: asset.fileName,
          format: asset.format,
          sizeBytes: bytes.byteLength,
          data: bufferCopy,
          updatedAt: Date.now()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`[SoundFontRegistry] Error guardando SoundFont ${id} en IndexedDB:`, err);
    }
  }

  /**
   * Recupera un SoundFont de IndexedDB y lo parsea en memoria viva.
   */
  public async loadFromIndexedDB(id: string): Promise<{ asset: SoundFontAsset; parsed: ParsedSoundFont } | null> {
    const existingParsed = this.parsedMap.get(id);
    const existingMeta = this.metaMap.get(id);
    if (existingParsed && existingMeta) {
      return { asset: existingMeta, parsed: existingParsed };
    }

    try {
      const db = await this.getDb();
      const record = await new Promise<StoredSoundFontRecord | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });

      if (!record || !record.data) return null;
      const bytes = new Uint8Array(record.data);
      return this.registerFromBytes(bytes, record.fileName || `${record.name}.sf2`, id);
    } catch (err) {
      console.warn(`[SoundFontRegistry] Error cargando SoundFont ${id} de IndexedDB:`, err);
      return null;
    }
  }

  /**
   * Garantiza que el SoundFont esté cargado en memoria (desde caché o IndexedDB), deduplicando cargas concurrentes.
   */
  public async ensureLoaded(id: string): Promise<ParsedSoundFont | null> {
    if (!id) return null;
    const cached = this.parsedMap.get(id);
    if (cached) return cached;

    const pending = this.pendingLoads.get(id);
    if (pending) return pending;

    const promise = this.loadFromIndexedDB(id)
      .then((res) => (res ? res.parsed : null))
      .finally(() => {
        this.pendingLoads.delete(id);
      });

    this.pendingLoads.set(id, promise);
    return promise;
  }

  public async deleteFromIndexedDB(id: string): Promise<void> {
    this.delete(id);
    try {
      const db = await this.getDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`[SoundFontRegistry] Error eliminando SoundFont ${id} de IndexedDB:`, err);
    }
  }

  /**
   * Construye un AudioBuffer mono a partir de muestras PCM Float32 asegurando que la frecuencia de muestreo
   * esté dentro del rango soportado por Web Audio API (>= 8000 Hz y <= 96000 Hz), haciendo upsampling
   * lineal transparente en SoundFonts retro (SNES/GBA/N64) con sampleRate < 8000 Hz.
   */
  private createSafeMonoBuffer(
    audioCtx: BaseAudioContext,
    samples: Float32Array,
    sourceRate: number
  ): AudioBuffer {
    if (sourceRate >= 8000 && sourceRate <= 96000) {
      const buffer = audioCtx.createBuffer(1, samples.length, sourceRate);
      buffer.getChannelData(0).set(samples);
      return buffer;
    }

    const factor = sourceRate < 8000 ? Math.ceil(8000 / Math.max(1000, sourceRate)) : 1;
    const targetRate = Math.max(8000, Math.min(96000, sourceRate * factor));
    const ratio = sourceRate / targetRate;
    const outLen = Math.max(1, Math.round(samples.length / ratio));
    const buffer = audioCtx.createBuffer(1, outLen, targetRate);
    const out = buffer.getChannelData(0);
    const lastIdx = samples.length - 1;

    for (let i = 0; i < outLen; i++) {
      const srcPos = i * ratio;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const s0 = samples[idx <= lastIdx ? idx : lastIdx];
      const s1 = samples[idx + 1 <= lastIdx ? idx + 1 : lastIdx];
      out[i] = s0 + (s1 - s0) * frac;
    }

    return buffer;
  }

  /**
   * Ruta síncrona ultra-rápida para obtener/construir el AudioBuffer de una zona PCM SF2 o WebAudioFont PCM.
   * Devuelve null si la zona requiere decodificación asíncrona (SF3 Ogg Vorbis o WebAudioFont MP3/OGG).
   */
  public getZoneAudioBufferSync(
    soundfontId: string,
    zone: SoundFontZone,
    audioCtx: BaseAudioContext
  ): AudioBuffer | null {
    const cache = this.getContextCache(audioCtx);
    const cacheKey = this.getZoneCacheKey(soundfontId, zone);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const parsed = this.parsedMap.get(soundfontId);
    if (!parsed) return null;

    // 1. SF2 16-bit / 24-bit PCM sin compresión
    const isCompressed = (zone.sampleType & 0x10) !== 0;
    if (parsed.smplData && !isCompressed && zone.sampleEnd > zone.sampleStart) {
      const start = Math.max(0, zone.sampleStart);
      const end = Math.min(parsed.smplData.length, zone.sampleEnd);
      const len = end - start;
      if (len <= 0) return null;

      const floatData = new Float32Array(len);
      const smpl = parsed.smplData;
      const sm24 = parsed.sm24Data;

      if (sm24 && end <= sm24.length) {
        const scale24 = 1 / 8388608; // 2^23
        for (let i = 0; i < len; i++) {
          const sample24 = (smpl[start + i] << 8) | sm24[start + i];
          floatData[i] = sample24 * scale24;
        }
      } else {
        const scale16 = 1 / 32768;
        for (let i = 0; i < len; i++) {
          floatData[i] = smpl[start + i] * scale16;
        }
      }

      const buffer = this.createSafeMonoBuffer(audioCtx, floatData, zone.sampleRate || 44100);
      cache.set(cacheKey, buffer);
      return buffer;
    }

    // 2. WebAudioFont PCM 16-bit base64 (`zone.sample`)
    if (zone.encodedSampleBase64) {
      try {
        const bytes = base64ToUint8Array(zone.encodedSampleBase64);
        const frameCount = Math.floor(bytes.byteLength / 2);
        if (frameCount <= 0) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, frameCount * 2);
        const floatData = new Float32Array(frameCount);
        const scale16 = 1 / 32768;
        for (let i = 0; i < frameCount; i++) {
          floatData[i] = view.getInt16(i * 2, true) * scale16;
        }
        const buffer = this.createSafeMonoBuffer(audioCtx, floatData, zone.sampleRate || 44100);
        cache.set(cacheKey, buffer);
        return buffer;
      } catch (err) {
        console.warn('[SoundFontRegistry] Error decodificando sample PCM WebAudioFont:', err);
        return null;
      }
    }

    return null;
  }

  /**
   * Obtiene o decodifica de forma asíncrona el AudioBuffer de cualquier zona (SF2, SF3 Ogg o WebAudioFont MP3/OGG).
   */
  public async getZoneAudioBuffer(
    soundfontId: string,
    zone: SoundFontZone,
    audioCtx: BaseAudioContext
  ): Promise<AudioBuffer | null> {
    const syncBuf = this.getZoneAudioBufferSync(soundfontId, zone, audioCtx);
    if (syncBuf) return syncBuf;

    const cache = this.getContextCache(audioCtx);
    const cacheKey = this.getZoneCacheKey(soundfontId, zone);
    const pendingKey = `${cacheKey}:${audioCtx.sampleRate}:${audioCtx instanceof OfflineAudioContext ? 'off' : 'live'}`;
    const existingPending = this.pendingDecodes.get(pendingKey);
    if (existingPending) return existingPending;

    const parsed = await this.ensureLoaded(soundfontId);
    if (!parsed) return null;

    const decodePromise = (async (): Promise<AudioBuffer | null> => {
      try {
        // Caso SF3 comprimido (Ogg Vorbis embebido en smpl)
        const isCompressed = (zone.sampleType & 0x10) !== 0;
        if (isCompressed && parsed.smplRawBytes && zone.sampleEnd > zone.sampleStart) {
          const slice = parsed.smplRawBytes.slice(zone.sampleStart, zone.sampleEnd);
          const decoded = await audioCtx.decodeAudioData(slice.buffer);
          cache.set(cacheKey, decoded);
          return decoded;
        }

        // Caso WebAudioFont (`zone.file` base64 MP3/OGG/WAV)
        if (zone.encodedFileBase64) {
          const bytes = base64ToUint8Array(zone.encodedFileBase64);
          const arrayBuf = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
          const decoded = await audioCtx.decodeAudioData(arrayBuf);
          cache.set(cacheKey, decoded);
          return decoded;
        }
      } catch (err) {
        console.warn(`[SoundFontRegistry] Error decodificando zona comprimida ${cacheKey}:`, err);
      }
      return null;
    })().finally(() => {
      this.pendingDecodes.delete(pendingKey);
    });

    this.pendingDecodes.set(pendingKey, decodePromise);
    return decodePromise;
  }

  /**
   * Precarga todos los AudioBuffers necesarios para un patch concreto dentro del AudioContext objetivo.
   */
  public async preloadPresetBuffers(
    soundfontId: string,
    bank: number,
    program: number,
    audioCtx: BaseAudioContext
  ): Promise<ParsedSoundFontPreset | null> {
    const parsed = await this.ensureLoaded(soundfontId);
    if (!parsed) return null;
    const preset = this.findPreset(soundfontId, bank, program);
    if (!preset) return null;

    const asyncJobs: Promise<AudioBuffer | null>[] = [];
    for (let i = 0; i < preset.zones.length; i++) {
      const zone = preset.zones[i];
      const syncBuf = this.getZoneAudioBufferSync(soundfontId, zone, audioCtx);
      if (!syncBuf) {
        asyncJobs.push(this.getZoneAudioBuffer(soundfontId, zone, audioCtx));
      }
    }

    if (asyncJobs.length > 0) {
      await Promise.allSettled(asyncJobs);
    }

    return preset;
  }
}

export const soundfontRegistry = new SoundFontRegistry();
