/**
 * AudioTransport.ts
 * Gestor del reloj maestro, transporte, swing y metrónomo aislado.
 */

import * as Tone from 'tone';

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

  public triggerMetroClick(frequency: number, volumeFactor: number, time: number) {
    try {
      const volumeNode = this.metroSynth.volume;
      const baseDb = volumeNode.value;
      if (volumeFactor < 1.0) {
        volumeNode.setValueAtTime(baseDb - 6, time);
      }
      this.metroSynth.triggerAttackRelease(frequency, '32n', time);
    } catch (_) {}
  }

  public syncMetronome(
    _isActive: boolean,
    volumePercent: number
  ) {
    this.setMetroVolume(volumePercent);
    if (this.metroEventId !== null) {
      try { Tone.Transport.clear(this.metroEventId); } catch (_) {}
      this.metroEventId = null;
    }
  }

  public start(currentBeat: number, bpm: number, audioSeconds?: number) {
    Tone.Transport.bpm.value = bpm;
    Tone.Transport.seconds = audioSeconds !== undefined ? audioSeconds : currentBeat * (60 / bpm);
    Tone.Transport.start();
  }

  public pause() {
    Tone.Transport.pause();
  }

  public stop() {
    Tone.Transport.stop();
  }

  public seek(beat: number, bpm: number, audioSeconds?: number) {
    Tone.Transport.bpm.value = bpm;
    Tone.Transport.seconds = audioSeconds !== undefined ? audioSeconds : beat * (60 / bpm);
  }

  public dispose() {
    if (this.metroEventId !== null) {
      try { Tone.Transport.clear(this.metroEventId); } catch (_) {}
      this.metroEventId = null;
    }
    try { this.metroSynth.dispose(); } catch (_) {}
  }
}
