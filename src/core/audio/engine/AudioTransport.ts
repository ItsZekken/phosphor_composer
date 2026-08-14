/**
 * AudioTransport.ts
 * Gestor del reloj maestro, transporte, swing y metrónomo aislado.
 */

import * as Tone from 'tone';
import type { TimeSignature } from '../../../utils/typeDefinitions';

export class AudioTransport {
  public metroSynth: Tone.Synth;
  private metroEventId: number | null = null;

  constructor() {
    try {
      this.metroSynth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: {
          attack: 0.001,
          decay: 0.04,
          sustain: 0,
          release: 0.04
        }
      }).toDestination();

      this.metroSynth.volume.value = Tone.gainToDb(0.5);
    } catch (_) {
      this.metroSynth = {
        volume: { value: 0 },
        triggerAttackRelease: () => {},
        dispose: () => {}
      } as any;
    }
  }

  public setBpm(bpm: number) {
    Tone.Transport.bpm.value = bpm;
  }

  public setLoop(loop: boolean, start = 0, endSeconds = 4) {
    Tone.Transport.loop = loop;
    Tone.Transport.loopStart = start;
    Tone.Transport.loopEnd = endSeconds;
  }

  public setSwing(swingPercent: number) {
    Tone.Transport.swing = Math.max(0, Math.min(1, swingPercent / 100));
    Tone.Transport.swingSubdivision = '16n';
  }

  public setMetroVolume(volumePercent: number) {
    const gain = volumePercent / 100;
    this.metroSynth.volume.value = gain === 0 ? -Infinity : Tone.gainToDb(gain);
  }

  public syncMetronome(
    isActive: boolean,
    subdivision: '4n' | '8n' | '16n',
    timeSignature: TimeSignature,
    volumePercent: number
  ) {
    if (this.metroEventId !== null) {
      try {
        Tone.Transport.clear(this.metroEventId);
      } catch (_) {}
      this.metroEventId = null;
    }

    if (!isActive) return;

    this.setMetroVolume(volumePercent);

    this.metroEventId = Tone.Transport.scheduleRepeat((time) => {
      try {
        const ticks = Tone.Transport.getTicksAtTime(time);
        const currentBeat = Math.round((ticks / Tone.Transport.PPQ) * 100) / 100;

        const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
        const isMeasureStart = currentBeat % beatsPerMeasure === 0;
        const isBeat = currentBeat % 1 === 0;

        let frequency = 400;
        if (isMeasureStart) {
          frequency = 1200;
        } else if (isBeat) {
          frequency = 800;
        }

        const volumeFactor = isMeasureStart || isBeat ? 1 : 0.5;
        const gain = (volumePercent / 100) * volumeFactor;
        const db = gain === 0 ? -Infinity : Tone.gainToDb(gain);

        this.metroSynth.volume.value = db;
        this.metroSynth.triggerAttackRelease(frequency, '32n', time);
      } catch (e) {
        console.error('Error en metrónomo:', e);
      }
    }, subdivision);
  }

  public start(currentBeat: number, bpm: number) {
    Tone.Transport.seconds = currentBeat * (60 / bpm);
    Tone.Transport.bpm.value = bpm;
    Tone.Transport.start();
  }

  public pause() {
    Tone.Transport.pause();
  }

  public stop() {
    Tone.Transport.stop();
  }

  public seek(beat: number, bpm: number) {
    Tone.Transport.seconds = beat * (60 / bpm);
  }

  public dispose() {
    if (this.metroEventId !== null) {
      try { Tone.Transport.clear(this.metroEventId); } catch (_) {}
      this.metroEventId = null;
    }
    try { this.metroSynth.dispose(); } catch (_) {}
  }
}
