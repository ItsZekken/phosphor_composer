import type { MelodyNote, GhostNote, NoteClass, ScaleType, ChordBlock } from '../utils/typeDefinitions';
import { noteToMod12, mod12ToNote } from '../engine/scaleDefinitions';
import { useSongStore } from '../store/songStore';

// Declaración para el objeto global mm de Magenta
declare const mm: any;

class MelodyPredictor {
  private model: any = null;
  private isLoaded = false;
  private isLoading = false;
  private checkpointUrl = 'https://storage.googleapis.com/download.magenta.tensorflow.org/tfjs_checkpoints/music_rnn/chord_pitches_improv';

  public async init() {
    if (this.isLoaded || this.isLoading) return;
    this.isLoading = true;
    useSongStore.getState().setIsAudioLoading(true);

    try {
      if (typeof mm !== 'undefined') {
        this.model = new mm.MusicRNN(this.checkpointUrl);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout de Magenta RNN')), 5000)
        );
        await Promise.race([this.model.initialize(), timeoutPromise]);
        this.isLoaded = true;
        console.log('Magenta MelodyRNN cargado correctamente.');
      } else {
        console.warn('Magenta.js no está disponible en window. Usando fallback algorítmico.');
      }
    } catch (e) {
      console.error('Error cargando Magenta MelodyRNN:', e);
    } finally {
      this.isLoading = false;
      useSongStore.getState().setIsAudioLoading(false);
    }
  }

  /**
   * Genera sugerencias de notas (Ghost Notes) a partir de la melodía existente y los acordes
   */
  public async predictNextNotes(
    existingNotes: MelodyNote[],
    chordBlocks: ChordBlock[],
    _bpm: number,
    key: NoteClass,
    scale: ScaleType
  ): Promise<GhostNote[]> {
    if (existingNotes.length === 0) {
      return [];
    }

    if (!this.isLoaded) {
      await this.init();
    }

    // Si sigue sin cargar (offline/error), usar fallback local determinista
    if (!this.isLoaded || !this.model) {
      return this.fallbackPrediction(existingNotes, chordBlocks, key, scale);
    }

    try {
      // 1. Traducir notas al formato de Magenta (Quantized Note Sequence)
      // Cada beat lo cuantizamos a steps (1 beat = 4 steps para semicorcheas)
      const stepsPerBeat = 4;
      const notes = existingNotes.map(note => ({
        pitch: note.midi,
        quantizedStartStep: Math.round(note.startBeat * stepsPerBeat),
        quantizedEndStep: Math.round((note.startBeat + note.durationBeats) * stepsPerBeat)
      }));

      // Si no hay notas, crear una nota inicial por defecto
      // (Esta rama ya no se ejecuta por la condición inicial, pero se mantiene como safety)
      if (notes.length === 0) {
        const rootMidi = 60 + noteToMod12(key); // C4 tónica
        notes.push({
          pitch: rootMidi,
          quantizedStartStep: 0,
          quantizedEndStep: 4
        });
      }

      // Ordenar notas
      notes.sort((a, b) => a.quantizedStartStep - b.quantizedStartStep);

      // Encontrar el compás n+1 (el primer compás vacío después de la última nota)
      const lastNote = existingNotes[existingNotes.length - 1];
      const lastNoteEndBeat = lastNote.startBeat + lastNote.durationBeats;
      const measureLength = 4; // Asumiendo 4/4
      // Redondear hacia arriba al próximo inicio de compás
      const nextEmptyMeasureStartBeat = Math.ceil(lastNoteEndBeat / measureLength) * measureLength;

      const seq = {
        notes,
        quantizationInfo: { stepsPerQuarter: stepsPerBeat },
        totalQuantizedSteps: nextEmptyMeasureStartBeat * stepsPerBeat
      };

      // 2. Ejecutar la continuación (32 steps = 8 beats = 2 compases)
      const stepsToPredict = 32;
      const temperature = 1.0;
      
      // Obtener la progresión de acordes esperada para la ventana generada
      const chordsForPrediction: string[] = [];
      const predEndBeat = nextEmptyMeasureStartBeat + (stepsToPredict / stepsPerBeat);
      for (let beat = nextEmptyMeasureStartBeat; beat < predEndBeat; beat += measureLength) {
         const activeBlock = chordBlocks.find(b => beat >= b.startBeat && beat < b.startBeat + b.durationBeats);
         chordsForPrediction.push(activeBlock ? activeBlock.chord : (key + (scale === 'minor' ? 'm' : '')));
      }

      // Pasar los acordes al modelo ImprovRNN
      const result = await this.model.continueSequence(seq, stepsToPredict, temperature, chordsForPrediction);
      
      // 3. Convertir la secuencia resultante a GhostNotes
      const ghostNotes: GhostNote[] = result.notes.map((note: any, index: number) => {
        const startBeat = note.quantizedStartStep / stepsPerBeat;
        const durationBeats = (note.quantizedEndStep - note.quantizedStartStep) / stepsPerBeat;
        
        const noteIndex = note.pitch % 12;
        const octave = Math.floor(note.pitch / 12) - 1;
        const noteName = `${mod12ToNote(noteIndex)}${octave}`;

        return {
          id: `ghost-${index}-${Math.random().toString(36).substr(2, 5)}`,
          note: noteName,
          midi: note.pitch,
          startBeat: startBeat,
          durationBeats: durationBeats || 1
        };
      });

      return ghostNotes;
    } catch (e) {
      console.warn('Fallo en la inferencia de Magenta. Usando fallback.', e);
      return this.fallbackPrediction(existingNotes, chordBlocks, key, scale);
    }
  }

  /**
   * Fallback algorítmico local basado en la escala si Magenta no está listo
   */
  private fallbackPrediction(existingNotes: MelodyNote[], _chordBlocks: ChordBlock[], _key: NoteClass, _scale: ScaleType): GhostNote[] {
    if (existingNotes.length === 0) {
      return [];
    }
    
    // Si hay notas previas, tomamos la última y sugerimos notas vecinas dentro de la escala
    const lastNote = existingNotes[existingNotes.length - 1];
    const nextStart = lastNote.startBeat + lastNote.durationBeats;
    
    const ghostNotes: GhostNote[] = [];
    let currentPitch = lastNote.midi;

    for (let i = 0; i < 4; i++) {
      // Movimiento aleatorio controlado (paso conjunto)
      const step = Math.random() > 0.5 ? 2 : -2;
      currentPitch = currentPitch + step;
      
      // Limitar rango
      if (currentPitch < 48) currentPitch = 55;
      if (currentPitch > 84) currentPitch = 72;

      const noteIndex = currentPitch % 12;
      const octave = Math.floor(currentPitch / 12) - 1;
      const noteName = `${mod12ToNote(noteIndex)}${octave}`;

      ghostNotes.push({
        id: `ghost-fb-${i}`,
        note: noteName,
        midi: currentPitch,
        startBeat: nextStart + i,
        durationBeats: 1
      });
    }

    return ghostNotes;
  }
}

export const melodyPredictor = new MelodyPredictor();
