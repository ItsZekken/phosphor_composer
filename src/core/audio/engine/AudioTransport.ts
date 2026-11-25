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
    try {
      if (Tone.Transport?.bpm) {
        Tone.Transport.bpm.value = bpm;
      }
    } catch (_) {}
  }

  public setLoop(loop: boolean, start = 0, endSeconds = 4) {
    try {
      if (Tone.Transport) {
        Tone.Transport.loop = loop;
        Tone.Transport.loopStart = start;
        Tone.Transport.loopEnd = endSeconds;
      }
    } catch (_) {}
  }

  public setSwing(swingPercent: number) {
    try {
      if (Tone.Transport) {
        Tone.Transport.swing = Math.max(0, Math.min(1, swingPercent / 100));
        Tone.Transport.swingSubdivision = '16n';
      }
    } catch (_) {}
  }

  public setMetroVolume(volumePercent: number) {
    try {
      const gain = volumePercent / 100;
      if (this.metroSynth?.volume) {
        this.metroSynth.volume.value = gain === 0 ? -Infinity : Tone.gainToDb(gain);
      }
    } catch (_) {}
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
    try {
      Tone.Transport.bpm.value = bpm;
      Tone.Transport.seconds = audioSeconds !== undefined ? audioSeconds : currentBeat * (60 / bpm);
      if (Tone.Transport.state !== 'started') {
        Tone.Transport.start();
      }
    } catch (_) {}
  }

  public pause() {
    try {
      if (Tone.Transport.state === 'started') {
        Tone.Transport.pause();
      }
    } catch (_) {}
  }

  public stop() {
    try {
      Tone.Transport.stop();
      Tone.Transport.seconds = 0;
    } catch (_) {}
  }

  public seek(beat: number, bpm: number, audioSeconds?: number) {
    try {
      Tone.Transport.bpm.value = bpm;
      Tone.Transport.seconds = audioSeconds !== undefined ? audioSeconds : beat * (60 / bpm);
    } catch (_) {}
  }

  public dispose() {
    if (this.metroEventId !== null) {
      try { Tone.Transport.clear(this.metroEventId); } catch (_) {}
      this.metroEventId = null;
    }
    try { this.metroSynth.dispose(); } catch (_) {}
  }
}
