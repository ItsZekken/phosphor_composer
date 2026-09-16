/**
 * AudioRecorder.ts
 * Gestor de captura de audio de ultra-baja latencia con AudioWorklet y compensación de retardo.
 * Conecta el micrófono del usuario directamente al procesador PCM,
 * calcula la compensación de latencia de ida y vuelta (roundtrip) y libera el hardware inmediatamente.
 */

import { ensurePhosphorRecorderWorkletRegistered } from '../worklet/PhosphorRecorderProcessor';
import { getNativeAudioContext } from '../worklet/PhosphorWorkletNode';
import { audioBufferRegistry } from '../audioBufferRegistry';
import { waveformService } from '../waveformService';

export interface RecordResult {
  bufferId: string;
  buffer: AudioBuffer;
  startBeat: number;
  durationSeconds: number;
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private monitorGainNode: GainNode | null = null;

  private isRecording = false;
  private recordingStartBeat = 0;

  private chunksL: Float32Array[] = [];
  private chunksR: Float32Array[] = [];
  private totalRecordedSamples = 0;

  private onMeterCallback: ((rms: number) => void) | null = null;

  public setOnMeter(callback: ((rms: number) => void) | null) {
    this.onMeterCallback = callback;
  }

  /**
   * Prepara y solicita acceso al micrófono en segundo plano para arranque instantáneo sin lag al grabar.
   */
  public async prepare(): Promise<boolean> {
    const nativeCtx = getNativeAudioContext();
    if (!nativeCtx) return false;

    try {
      const isRegistered = await ensurePhosphorRecorderWorkletRegistered(nativeCtx);
      if (!isRegistered) return false;

      if (!this.mediaStream) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2
          }
        });
      }

      if (!this.sourceNode) {
        this.sourceNode = nativeCtx.createMediaStreamSource(this.mediaStream);
      }

      if (!this.workletNode) {
        this.workletNode = new AudioWorkletNode(nativeCtx, 'phosphor-recorder-processor');
        this.workletNode.port.onmessage = (e) => {
          const data = e.data;
          if (data.type === 'DATA') {
            if (data.chunkL) {
              this.chunksL.push(data.chunkL);
              this.chunksR.push(data.chunkR || data.chunkL);
              this.totalRecordedSamples += data.chunkL.length;
            }
            if (this.onMeterCallback && typeof data.rms === 'number') {
              this.onMeterCallback(data.rms);
            }
          } else if (data.type === 'METER') {
            if (this.onMeterCallback && typeof data.rms === 'number') {
              this.onMeterCallback(data.rms);
            }
          }
        };
        this.sourceNode.connect(this.workletNode);
      }

      return true;
    } catch (err) {
      console.warn('[AudioRecorder] Error inicializando micrófono:', err);
      this.cleanup();
      return false;
    }
  }

  /**
   * Inicia la captura sincronizada con el compás del transporte.
   */
  public async startRecording(startBeat: number): Promise<boolean> {
    if (this.isRecording) return false;

    if (!this.mediaStream || !this.workletNode) {
      const ok = await this.prepare();
      if (!ok) return false;
    }

    this.chunksL = [];
    this.chunksR = [];
    this.totalRecordedSamples = 0;
    this.recordingStartBeat = startBeat;
    this.isRecording = true;

    this.workletNode!.port.postMessage({ type: 'START' });
    return true;
  }

  /**
   * Detiene la captura, compensa la latencia y devuelve el AudioBuffer registrado.
   */
  public async stopRecording(calibrationOffsetMs = 0): Promise<RecordResult | null> {
    if (!this.isRecording) return null;

    this.isRecording = false;

    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'STOP' });
    }

    // Pequeño delay de 50ms para recibir el último chunk emitido por el procesador
    await new Promise((resolve) => setTimeout(resolve, 50));

    const nativeCtx = getNativeAudioContext();
    const sampleRate = nativeCtx?.sampleRate || 44100;

    // Liberar inmediatamente el hardware del micrófono para apagar el indicador de privacidad
    this.cleanup();

    if (this.totalRecordedSamples === 0 || this.chunksL.length === 0) {
      return null;
    }

    // 1. Unificar los fragmentos Float32Array
    const fullL = new Float32Array(this.totalRecordedSamples);
    const fullR = new Float32Array(this.totalRecordedSamples);
    let offset = 0;
    for (let i = 0; i < this.chunksL.length; i++) {
      const cL = this.chunksL[i];
      const cR = this.chunksR[i];
      fullL.set(cL, offset);
      fullR.set(cR, offset);
      offset += cL.length;
    }

    // 2. Cálculo de compensación de latencia de ida y vuelta (Roundtrip Latency)
    // Latencia de salida (lo que tardó en sonar el metrónomo/backing track) +
    // Latencia base del hardware + offset manual calibrado por el usuario
    const outputLatency = (nativeCtx as any)?.outputLatency || 0;
    const baseLatency = (nativeCtx as any)?.baseLatency || 0.01;
    const userOffsetSec = calibrationOffsetMs / 1000;
    const totalLatencySec = Math.max(0, outputLatency + baseLatency + userOffsetSec);
    const latencySamples = Math.floor(totalLatencySec * sampleRate);

    // Si la latencia es válida, recortamos el retraso inicial para alinear con el compás
    let finalL = fullL;
    let finalR = fullR;
    if (latencySamples > 0 && latencySamples < this.totalRecordedSamples) {
      finalL = fullL.subarray(latencySamples);
      finalR = fullR.subarray(latencySamples);
    }

    const finalLength = finalL.length;
    if (finalLength === 0) return null;

    // 3. Crear AudioBuffer y asignar datos
    const audioBuffer = nativeCtx.createBuffer(2, finalLength, sampleRate);
    audioBuffer.copyToChannel(finalL, 0);
    audioBuffer.copyToChannel(finalR, 1);

    const durationSeconds = audioBuffer.duration;

    // 4. Registrar en memoria viva y persistir en IndexedDB
    const bufferId = audioBufferRegistry.registerBuffer(audioBuffer);
    audioBufferRegistry.saveBufferToIndexedDB(bufferId, audioBuffer).catch(() => {});

    // 5. Precalcular picos en segundo plano
    waveformService.getOrGeneratePeaks(bufferId, audioBuffer).catch(() => {});

    return {
      bufferId,
      buffer: audioBuffer,
      startBeat: this.recordingStartBeat,
      durationSeconds
    };
  }

  /**
   * Cierra streams y desconecta nodos de audio para garantizar reposo total de CPU.
   */
  public cleanup(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      this.mediaStream = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (_) {}
      this.sourceNode = null;
    }

    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch (_) {}
      this.workletNode = null;
    }

    if (this.monitorGainNode) {
      try {
        this.monitorGainNode.disconnect();
      } catch (_) {}
      this.monitorGainNode = null;
    }

    this.isRecording = false;
    if (this.onMeterCallback) {
      this.onMeterCallback(0);
    }
  }
}

export const audioRecorder = new AudioRecorder();
