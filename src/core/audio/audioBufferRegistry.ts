/**
 * audioBufferRegistry.ts
 * Registro centralizado en memoria de objetos AudioBuffer y persistencia en IndexedDB.
 * Desacopla los datos de audio crudo (pesados) del estado reactivo de Zustand y Zundo,
 * garantizando cero sobrecarga de serialización en el árbol de componentes.
 */

import { generateId } from '../../utils/idGenerator';
import { audioBufferToWav } from '../../utils/wavEncoder';

const DB_NAME = 'phosphor_audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'audio_buffers';

export interface BufferPeaksLOD {
  [lod: number]: Float32Array;
}

class AudioBufferRegistry {
  private buffers = new Map<string, AudioBuffer>();
  private peaksCache = new Map<string, BufferPeaksLOD>();
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Abre o devuelve la conexión activa con IndexedDB.
   */
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

  /**
   * Registra un AudioBuffer en memoria viva y devuelve su identificador único.
   */
  public registerBuffer(buffer: AudioBuffer, explicitId?: string): string {
    const id = explicitId || `ab_${generateId()}`;
    this.buffers.set(id, buffer);
    return id;
  }

  /**
   * Obtiene un AudioBuffer registrado en memoria.
   */
  public getBuffer(id: string): AudioBuffer | undefined {
    return this.buffers.get(id);
  }

  /**
   * Comprueba si un buffer existe en memoria.
   */
  public hasBuffer(id: string): boolean {
    return this.buffers.has(id);
  }

  /**
   * Elimina un buffer de la memoria viva y de su caché de picos.
   */
  public deleteBuffer(id: string): void {
    this.buffers.delete(id);
    this.peaksCache.delete(id);
  }

  /**
   * Guarda los picos precalculados para un nivel de detalle específico (LOD).
   */
  public setPeaks(bufferId: string, lod: number, peaks: Float32Array): void {
    let lodMap = this.peaksCache.get(bufferId);
    if (!lodMap) {
      lodMap = {};
      this.peaksCache.set(bufferId, lodMap);
    }
    lodMap[lod] = peaks;
  }

  /**
   * Obtiene los picos precalculados para un LOD determinado.
   */
  public getPeaks(bufferId: string, lod: number): Float32Array | undefined {
    return this.peaksCache.get(bufferId)?.[lod];
  }

  /**
   * Verifica si ya se han calculado picos para el buffer.
   */
  public hasPeaks(bufferId: string): boolean {
    const lodMap = this.peaksCache.get(bufferId);
    return Boolean(lodMap && Object.keys(lodMap).length > 0);
  }

  /**
   * Persiste un AudioBuffer en IndexedDB codificado como WAV PCM 16-bit.
   */
  public async saveBufferToIndexedDB(id: string, buffer: AudioBuffer): Promise<void> {
    try {
      const db = await this.getDb();
      const wavArrayBuffer = audioBufferToWav(buffer, { normalize: false });

      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
          id,
          data: wavArrayBuffer,
          sampleRate: buffer.sampleRate,
          numberOfChannels: buffer.numberOfChannels,
          duration: buffer.duration,
          updatedAt: Date.now()
        };

        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`[AudioBufferRegistry] Error guardando buffer ${id} en IndexedDB:`, err);
    }
  }

  /**
   * Recupera un AudioBuffer de IndexedDB y lo decodifica en memoria.
   */
  public async loadBufferFromIndexedDB(id: string, audioCtx: AudioContext | BaseAudioContext): Promise<AudioBuffer | null> {
    // Si ya está en memoria viva, retornar directo
    if (this.buffers.has(id)) {
      return this.buffers.get(id)!;
    }

    try {
      const db = await this.getDb();
      const record = await new Promise<{ data: ArrayBuffer } | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });

      if (!record || !record.data) return null;

      // decodeAudioData desconecta/consume el ArrayBuffer, por lo que clonamos por seguridad
      const cloned = record.data.slice(0);
      const audioBuffer = await audioCtx.decodeAudioData(cloned);
      this.buffers.set(id, audioBuffer);
      return audioBuffer;
    } catch (err) {
      console.warn(`[AudioBufferRegistry] Error cargando buffer ${id} de IndexedDB:`, err);
      return null;
    }
  }

  /**
   * Elimina un buffer de IndexedDB.
   */
  public async deleteBufferFromIndexedDB(id: string): Promise<void> {
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
      console.warn(`[AudioBufferRegistry] Error eliminando buffer ${id} de IndexedDB:`, err);
    }
  }
}

export const audioBufferRegistry = new AudioBufferRegistry();
