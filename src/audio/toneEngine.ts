import * as Tone from 'tone';
import { Piano } from '@tonejs/piano';
import { useSongStore } from '../store/songStore';
import { getChordNotes, invertChord, applyVoicing, NOTE_CLASSES, SCALE_INTERVALS } from '../engine/scaleDefinitions';
import type { PatternDef } from '../patterns/patternTypes';

// Helper debounce simple para evitar llamadas excesivas a syncTimeline
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, delay);
  }) as T;
}

// --- MONKEYPATCH ToneAudioBuffer.load to resolve [mp3|ogg] wildcards for Tone.js v15 ---
if (Tone.ToneAudioBuffer && typeof Tone.ToneAudioBuffer.load === 'function') {
  const originalLoad = Tone.ToneAudioBuffer.load;
  Tone.ToneAudioBuffer.load = function (url: string) {
    const matches = url.match(/\[(.+?)\]/);
    if (matches) {
      const extensions = matches[1].split("|");
      const extension = extensions.find(ext => {
        if (typeof document !== 'undefined') {
          const response = document.createElement("audio").canPlayType("audio/" + ext);
          return response !== "";
        }
        return ext === 'mp3';
      }) || extensions[0];
      url = url.replace(matches[0], extension);
    }
    return originalLoad.call(this, url);
  };
}

function shiftNoteOctave(noteName: string, octaves: number): string {
  if (octaves === 0) return noteName;
  const match = noteName.match(/^([A-G]#?|b?)([0-9])$/);
  if (!match) return noteName;
  const pitchClass = match[1];
  const octave = parseInt(match[2]);
  const newOctave = Math.max(0, Math.min(8, octave + octaves));
  return `${pitchClass}${newOctave}`;
}

// Mapeos para entrada de teclado (melodía)
const DIATONIC_KEY_MAP: Record<string, number> = {
  'z': 0, 'x': 1, 'c': 2, 'v': 3, 'b': 4, 'n': 5, 'm': 6,
  'a': 7, 's': 8, 'd': 9, 'f': 10, 'g': 11, 'h': 12, 'j': 13, 'k': 14, 'l': 15, ';': 16, 'ñ': 16, '´': 17
};

const CHROMATIC_KEY_MAP: Record<string, number> = {
  'a': 0,  // C4
  's': 2,  // D4
  'd': 4,  // E4
  'f': 5,  // F4
  'g': 7,  // G4
  'h': 9,  // A4
  'j': 11, // B4
  'k': 12, // C5
  'l': 14, // D5
  ';': 16, // E5
  'ñ': 16, // E5
  'w': 1,  // C#4
  'e': 3,  // D#4
  't': 6,  // F#4
  'y': 8,  // G#4
  'u': 10, // A#4
  'o': 13, // C#5
  'p': 15  // D#5
};

class ToneEngine {
  private chordSynth: Tone.PolySynth;
  private melodySynth: Tone.Synth;
  private metroSynth: Tone.Synth; // Synth dedicado para el metrónomo
  private chordsPiano: Piano | null = null;
  private melodyPiano: Piano | null = null;
  private synthFilter: Tone.Filter;
  private isInitialized = false;

  private channelNodes = new Map<string, { volumeNode: Tone.Volume; pannerNode: Tone.Panner }>();
  private cachedChannels: Record<string, any> | null = null;
  private scheduledEvents: number[] = [];
  private metroEventId: number | null = null;
  private activePreviewChord: string | null = null;
  private activePreviewNotes: string[] = [];
  private previewTimer: any = null;
  // Estado del secuenciador de previsualización — persiste entre cambios de acorde para legato
  private previewStep = 0;
  private previewNotes: string[] = [];
  private lastTriggeredBeat = -1;
  private lastTriggeredChordId = '';
  private lastTriggeredChordName = '';
  private lastTriggeredVoicing = '';
  private lastTriggeredInversion = 0;
  // Seguimiento en tiempo real de notas activas para el visualizador
  private activeNotesSet = new Set<string>();
  private noteActiveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Seguimiento separado para notas de melodía (color de énfasis distinto)
  private activeMelodyNotesSet = new Set<string>();
  private melodyNoteActiveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private activePressedNotes = new Set<string>();
  private activePressedNotesList: string[] = [];

  // --- Caché de estado del store para el hot path de audio (evita getState() en keyDown/keyUp) ---
  private cachedIsKeyboardMelodyEnabled = true;
  private cachedIsKeyboardChromatic = false;
  private cachedKey = 'C';
  private cachedScale = 'major';
  private cachedBpm = 120;
  // P2: maxBeat cacheado — se actualiza solo cuando cambian los bloques, no en cada tick
  private cachedMaxBeat = 4;
  // rAF handle para el update de UI del playhead
  private playheadRafId: number | null = null;
  private initPromise: Promise<void> | null = null;

  // Versión incremental para detectar cambios en synthSettings sin JSON.stringify
  private synthSettingsVersion = 0;

  public _getInternalDebugState() {
    return [this.playheadRafId];
  }

  private updateCachedMaxBeat(state?: any) {
    const s = state || useSongStore.getState();
    let newMax = 4;
    (s.chordBlocks || []).forEach((b: any) => { newMax = Math.max(newMax, b.startBeat + b.durationBeats); });
    (s.melodyNotes || []).forEach((n: any) => { newMax = Math.max(newMax, n.startBeat + n.durationBeats); });
    this.cachedMaxBeat = newMax;
    return newMax;
  }

  // syncTimeline con debounce para evitar reconstrucciones excesivas durante edición
  private syncTimelineDebounced: () => void;

  private getChannelNode(id: string) {
    let node = this.channelNodes.get(id);
    if (!node) {
      const volumeNode = new Tone.Volume(0);
      const pannerNode = new Tone.Panner(0);
      volumeNode.connect(pannerNode);
      pannerNode.toDestination();
      node = { volumeNode, pannerNode };
      this.channelNodes.set(id, node);
    }
    return node;
  }

  constructor() {
    // Inicializar syncTimelineDebounced antes de cualquier uso
    this.syncTimelineDebounced = debounce(() => this.syncTimeline(), 50);

    const chordsChannelNode = this.getChannelNode('chords');
    const melodyChannelNode = this.getChannelNode('melody');

    this.synthFilter = new Tone.Filter({
      frequency: 20000,
      type: 'lowpass',
      Q: 1
    }).connect(chordsChannelNode.volumeNode);

    // Sintetizadores originales por defecto para evitar descargas pesadas
    this.chordSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.1,
        decay: 0.3,
        sustain: 0.4,
        release: 0.8
      }
    });
    this.chordSynth.connect(this.synthFilter);
    this.chordSynth.volume.value = -12;

    this.melodySynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.05,
        decay: 0.2,
        sustain: 0.6,
        release: 0.4
      }
    });
    this.melodySynth.connect(melodyChannelNode.volumeNode);
    this.melodySynth.volume.value = -6;


    // Metrónomo click con envolvente muy corta percusiva (tipo woodblock)
    this.metroSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.04,
        sustain: 0,
        release: 0.04
      }
    }).toDestination();
    
    // Volumen inicial (50%)
    this.metroSynth.volume.value = Tone.gainToDb(0.5);
  }

  public async init() {
    if (this.isInitialized) return;
    // Evitar inicializaciones concurrentes (P1: garantía de single-init)
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 3000));
        await Promise.race([Tone.start(), timeoutPromise]);
      } catch (e) {
        console.warn('Advertencia al iniciar Tone.start():', e);
      }
      this.isInitialized = true;
    })();
    await this.initPromise;

    // P2: Loop de loop/stop en el audio thread — NO llama setCurrentBeat aquí
    // Solo gestiona el reinicio del loop y la parada. La UI del playhead va por rAF.
    Tone.Transport.scheduleRepeat(() => {
      const maxBeat = this.cachedMaxBeat;
      const currentBeat = Tone.Transport.seconds * this.cachedBpm / 60;

      if (currentBeat >= maxBeat) {
        const state = useSongStore.getState();
        if (state.isLooping) {
          Tone.Transport.seconds = 0;
          // Notificar reset de beat de forma síncrona (UI tolerará un frame de delay)
          state.setCurrentBeat(0);
          this.lastTriggeredBeat = -1;
          this.lastTriggeredChordId = '';
          this.lastTriggeredChordName = '';
        } else {
          this.stop();
        }
      }
    }, '8n'); // Reducido a 8n — suficiente para detectar fin de canción

    // P2: Update de UI del playhead vía requestAnimationFrame — fuera del audio thread
    const updatePlayheadUI = () => {
      if (useSongStore.getState().isPlaying) {
        const beat = Tone.Transport.seconds * this.cachedBpm / 60;
        useSongStore.getState().setCurrentBeat(beat);
      }
      this.playheadRafId = requestAnimationFrame(updatePlayheadUI);
    };
    this.playheadRafId = requestAnimationFrame(updatePlayheadUI);

    // Bucle dinámico para disparo de acordes en tiempo real (legato y al vuelo)
    Tone.Transport.scheduleRepeat((time) => {
      this.triggerChordTick(time);
    }, '16n');

    // Inicializar caché con el estado actual
    const initialState = useSongStore.getState();
    this.cachedIsKeyboardMelodyEnabled = initialState.isKeyboardMelodyEnabled;
    this.cachedIsKeyboardChromatic = initialState.isKeyboardChromatic;
    this.cachedKey = initialState.key;
    this.cachedScale = initialState.scale;
    this.cachedBpm = initialState.bpm;
    this.updateCachedMaxBeat(initialState);

    // Suscripción manual a los cambios del store
    let prevBpm = initialState.bpm;
    let prevIsPlaying = initialState.isPlaying;
    let prevChordBlocks = initialState.chordBlocks;
    let prevMelodyNotes = initialState.melodyNotes;
    let prevIsLooping = initialState.isLooping;
    let prevIsMetronomeActive = initialState.isMetronomeActive;
    let prevMetroSubdivision = initialState.metroSubdivision;
    let prevMetroVolume = initialState.metroVolume;
    let prevTimeSignature = initialState.timeSignature;
    let prevPattern = initialState.pattern;
    let prevSwing = initialState.swing;
    let prevSustain = initialState.sustain;
    // Usamos versión incremental en lugar de JSON.stringify para detectar cambios en synthSettings
    // (synthSettingsVersion se incrementa desde setSynthSettings en el store)
    let prevSynthSettingsVersion = this.synthSettingsVersion;

    useSongStore.subscribe((state) => {
      // --- Actualizar caché de hot path ---
      this.cachedIsKeyboardMelodyEnabled = state.isKeyboardMelodyEnabled;
      this.cachedIsKeyboardChromatic = state.isKeyboardChromatic;
      this.cachedKey = state.key;
      this.cachedScale = state.scale;
      this.cachedBpm = state.bpm;

      if (state.bpm !== prevBpm) {
        prevBpm = state.bpm;
        Tone.Transport.bpm.value = state.bpm;
        this.syncTimelineDebounced();
      }
      if (state.isLooping !== prevIsLooping) {
        prevIsLooping = state.isLooping;
        Tone.Transport.loop = false; // Bucle manual manejado por nosotros
        this.syncTimelineDebounced();
      }
      if (state.isMetronomeActive !== prevIsMetronomeActive || state.metroSubdivision !== prevMetroSubdivision) {
        prevIsMetronomeActive = state.isMetronomeActive;
        prevMetroSubdivision = state.metroSubdivision;
        this.syncTimelineDebounced();
      }
      if (state.metroVolume !== prevMetroVolume) {
        prevMetroVolume = state.metroVolume;
        const gain = state.metroVolume / 100;
        this.metroSynth.volume.value = gain === 0 ? -Infinity : Tone.gainToDb(gain);
      }
      if (state.isPlaying !== prevIsPlaying) {
        prevIsPlaying = state.isPlaying;
        if (state.isPlaying) {
          // Sincronizar el transporte con el beat actual antes de iniciar
          const currentBeat = state.currentBeat;
          const bpm = state.bpm;
          Tone.Transport.seconds = currentBeat * (60 / bpm);
          // S2: Forzar BPM siempre antes de arrancar — corrige bug de sincronización al iniciar
          Tone.Transport.bpm.value = bpm;
          this.syncTimeline(); // Llamada directa (no debounced) al arrancar
          Tone.Transport.start();
        } else {
          Tone.Transport.pause();
          this.silence();
        }
      }
      if (state.timeSignature !== prevTimeSignature) {
        prevTimeSignature = state.timeSignature;
        this.syncTimelineDebounced();
      }
      if (state.pattern !== prevPattern) {
        prevPattern = state.pattern;
        this.syncTimelineDebounced();
      }
      if (state.swing !== prevSwing) {
        prevSwing = state.swing;
        Tone.Transport.swing = state.swing / 100;
        Tone.Transport.swingSubdivision = '16n';
      }
      if (state.sustain !== prevSustain) {
        prevSustain = state.sustain;
        this.updateSustain(state.sustain);
      }
      if (state.chordBlocks !== prevChordBlocks || state.melodyNotes !== prevMelodyNotes) {
        prevChordBlocks = state.chordBlocks;
        prevMelodyNotes = state.melodyNotes;
        this.updateCachedMaxBeat(state);
        this.syncTimelineDebounced();
      }
      // S7: Comparar versión incremental en lugar de JSON.stringify
      if (this.synthSettingsVersion !== prevSynthSettingsVersion) {
        prevSynthSettingsVersion = this.synthSettingsVersion;
        this.updateSynthSettings(state.synthSettings);
      }
    });

    // Cargar configuraciones iniciales del sintetizador y canales
    this.updateSynthSettings(useSongStore.getState().synthSettings);
    this.syncChannels(useSongStore.getState().channels);
    const defaultInstrument = useSongStore.getState().instrumentType;
    if (defaultInstrument === 'piano') {
      this.setInstrument('piano');
    }
  }

  public syncChannels(channels: Record<string, any>) {
    if (!channels) return;
    this.cachedChannels = channels;
    const channelList = Object.values(channels);
    const anySolo = channelList.some((ch: any) => ch.solo);

    for (const ch of channelList as any[]) {
      const node = this.getChannelNode(ch.id);
      const isSilenced = ch.muted || (anySolo && !ch.solo);
      node.volumeNode.mute = isSilenced;

      if (!isSilenced) {
        if (ch.volume <= 0) {
          node.volumeNode.volume.value = -Infinity;
        } else {
          const db = ((ch.volume - 80) / 80) * 30;
          node.volumeNode.volume.value = Math.max(-60, Math.min(6, db));
        }
      }
      node.pannerNode.pan.value = Math.max(-1, Math.min(1, ch.pan));

      if (ch.instrument === 'piano' && (!this.chordsPiano || !this.melodyPiano)) {
        this.setInstrument('piano');
      }
    }
  }

  private isChordPianoActive(): boolean {
    const chordsInst = this.cachedChannels?.chords?.instrument || 'piano';
    return chordsInst === 'piano' && !!this.chordsPiano && this.chordsPiano.loaded;
  }

  private isMelodyPianoActive(): boolean {
    const melodyInst = this.cachedChannels?.melody?.instrument || 'synth';
    return melodyInst === 'piano' && !!this.melodyPiano && this.melodyPiano.loaded;
  }

  /**
   * Incrementa el contador de versión de synthSettings para que la suscripción del store
   * detecte el cambio sin usar JSON.stringify en cada tick (S7).
   */
  public bumpSynthSettingsVersion() {
    this.synthSettingsVersion++;
  }

  /**
   * Actualiza los parámetros de sonido del Sintetizador Virtual de forma reactiva.
   */
  public updateSynthSettings(settings: any) {
    if (!this.isInitialized) return;
    
    try {
      this.chordSynth.set({
        oscillator: { type: settings.waveType },
        envelope: {
          attack: settings.envelope.attack,
          decay: settings.envelope.decay,
          sustain: settings.envelope.sustain,
          release: settings.envelope.release
        },
        detune: settings.detune
      });

      this.melodySynth.set({
        oscillator: { type: settings.waveType },
        envelope: {
          attack: settings.envelope.attack,
          decay: settings.envelope.decay,
          sustain: settings.envelope.sustain,
          release: settings.envelope.release
        },
        detune: settings.detune
      });

      if (this.synthFilter) {
        if (settings.filter.enabled) {
          this.synthFilter.type = settings.filter.type;
          this.synthFilter.frequency.value = settings.filter.frequency;
          this.synthFilter.Q.value = settings.filter.Q;
        } else {
          this.synthFilter.type = 'lowpass';
          this.synthFilter.frequency.value = 20000;
          this.synthFilter.Q.value = 1;
        }
      }
    } catch (e) {
      console.error('Error actualizando ajustes del sintetizador:', e);
    }
  }

  /**
   * Configura o carga el instrumento correspondiente de forma asíncrona
   */
  public async setInstrument(type: 'synth' | 'piano') {
    if (!this.isInitialized) await this.init();

    if (type === 'piano' && (!this.chordsPiano || !this.melodyPiano)) {
      useSongStore.getState().setIsAudioLoading(true);
      
      try {
        const chordsNode = this.getChannelNode('chords');
        const melodyNode = this.getChannelNode('melody');

        if (!this.chordsPiano) {
          this.chordsPiano = new Piano({ velocities: 5, url: '/piano/' }).connect(chordsNode.volumeNode);
          if ((this.chordsPiano as any)._keybed) (this.chordsPiano as any)._keybed._internalLoad = () => Promise.resolve();
          if ((this.chordsPiano as any)._harmonics) (this.chordsPiano as any)._harmonics._internalLoad = () => Promise.resolve();
        }

        if (!this.melodyPiano) {
          this.melodyPiano = new Piano({ velocities: 5, url: '/piano/' }).connect(melodyNode.volumeNode);
          if ((this.melodyPiano as any)._keybed) (this.melodyPiano as any)._keybed._internalLoad = () => Promise.resolve();
          if ((this.melodyPiano as any)._harmonics) (this.melodyPiano as any)._harmonics._internalLoad = () => Promise.resolve();
        }

        const timeoutPromise = new Promise((resolve) => {
          setTimeout(() => {
            console.warn('Timeout de carga de piano superado, forzando inicio...');
            resolve(true);
          }, 12000);
        });

        await Promise.race([
          Promise.all([this.chordsPiano.load(), this.melodyPiano.load()]),
          timeoutPromise
        ]);
      } catch (e) {
        console.error('Error inicializando el piano:', e);
      } finally {
        useSongStore.getState().setIsAudioLoading(false);
      }
    }

    this.syncTimeline();
  }


  /**
   * Silencia de forma limpia todas las voces activas
   */
  public silence() {
    try {
      this.chordSynth.releaseAll();
    } catch (_) {}
    try {
      this.melodySynth.triggerRelease();
    } catch (_) {}
    if (this.chordsPiano) {
      try {
        this.chordsPiano.stopAll();
      } catch (_) {}
    }
    if (this.melodyPiano) {
      try {
        this.melodyPiano.stopAll();
      } catch (_) {}
    }
    try {
      this.metroSynth.triggerRelease();
    } catch (_) {}
  }


  public playChordPreview(chordName: string) {
    if (!this.isInitialized) this.init();
    const state = useSongStore.getState();
    const chordOctaveShift = state.chordOctaveShift || 0;
    const usePiano = this.isChordPianoActive();
    
    try {
      let notes = getChordNotes(chordName, 4);
      if (chordOctaveShift !== 0) {
        notes = notes.map(note => shiftNoteOctave(note, chordOctaveShift));
      }
      if (notes.length > 0) {
        if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
          const now = Tone.now();
          notes.forEach(note => {
            this.chordsPiano!.keyDown({ note, time: now, velocity: 0.7 });
            this.chordsPiano!.keyUp({ note, time: now + 1.0 });
          });
        } else {
          this.chordSynth.triggerAttackRelease(notes, '2n');
        }
      }
    } catch (e) {
      console.warn('Error tocando acorde preview:', e);
    }
  }

  public playChordPreviewStart(chordName: string) {
    if (!this.isInitialized) this.init();
    const state = useSongStore.getState();
    const pattern = state.pattern || 'hold';
    const chordOctaveShift = state.chordOctaveShift || 0;

    let baseNotes = getChordNotes(chordName, 4);
    if (baseNotes.length === 0) return;

    if (chordOctaveShift !== 0) {
      baseNotes = baseNotes.map(n => shiftNoteOctave(n, chordOctaveShift));
    }

    // Tónica del acorde como bajo por defecto
    const rootNoteMatch = chordName.split('/')[0].match(/^([A-G]#?)/);
    const defaultBass = rootNoteMatch ? `${rootNoteMatch[1]}2` : baseNotes[0].replace(/[0-9]/g, '2');
    const bassNote = chordName.includes('/') ? `${chordName.split('/')[1]}2` : defaultBass;
    const notes = [bassNote, ...baseNotes];

    // -- LEGATO: si ya hay un patrón corriendo, solo cambia las notas sin reiniciar el step
    const isPatternRunning = this.activePreviewChord !== null && this.previewTimer !== null;
    
    this.activePreviewChord = chordName;
    this.previewNotes = notes; // Las funciones del loop leen estas notas en cada tick

    // Si el patrón ya corría, no hay nada más que hacer: el loop activo leerá previewNotes actualizado
    if (isPatternRunning) {
      return;
    }

    // Primera vez: inicializar el secuenciador desde cero
    this.previewStep = 0;
    const bpm = state.bpm;
    const beatDurationMs = (60 / bpm) * 1000;
    const usePiano = this.isChordPianoActive();

    const playNoteImmediate = (note: string, durationMs: number, velocity = 0.6) => {
      const now = Tone.now();
      const durSec = durationMs / 1000;
      if (!this.activePreviewNotes.includes(note)) {
        this.activePreviewNotes.push(note);
      }
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        try {
          this.chordsPiano.keyDown({ note, time: now, velocity });
          this.chordsPiano.keyUp({ note, time: now + durSec });
        } catch (e) { console.error(e); }
      } else {
        try {
          this.chordSynth.triggerAttackRelease(note, durSec, now, velocity);
        } catch (e) { console.error(e); }
      }
      this.trackNote(note, durSec, undefined, 'harmony');
    };


    const playChordImmediate = (durationMs: number, velocity = 0.6) => {
      // Leer siempre this.previewNotes para tener las notas actualizadas del acorde actual
      this.previewNotes.forEach(note => playNoteImmediate(note, durationMs, velocity));
    };

    // Redefinir playNoteImmediate para que use this.previewNotes[0] como bajo
    const playBassImmediate = (durationMs: number, velocity = 0.7) => {
      if (this.previewNotes.length > 0) {
        playNoteImmediate(this.previewNotes[0], durationMs, velocity);
      }
    };

    if (pattern === 'hold') {
      playChordImmediate(1500, 0.65);
      return;
    }

    if (pattern === 'strum') {
      this.previewNotes.forEach((note, index) => {
        setTimeout(() => {
          if (this.activePreviewChord !== chordName) return;
          playNoteImmediate(note, 1500 - index * 25, 0.65 - index * 0.05);
        }, index * 25);
      });
      return;
    }

    // Comprobar si es un patrón custom (PatternDef desde MIDI)
    const customPattern = useSongStore.getState().customPatterns?.find(
      (p: { name: string }) => p.name === pattern
    );

    if (customPattern) {
      // Para patrones custom usamos un loop basado en el totalBeats del patrón.
      // Resolvemos las notas usando la misma lógica que resolvePatternNoteToChord.
      const cycleDurationMs = customPattern.totalBeats * beatDurationMs;

      const runCycle = () => {
        if (this.activePreviewChord === null) return;

        // Programar cada nota del patrón como un setTimeout relativo al inicio del ciclo
        for (const pn of customPattern.notes) {
          const delayMs = pn.beatOffset * beatDurationMs;
          const durMs = pn.durationBeats * beatDurationMs;

          setTimeout(() => {
            if (this.activePreviewChord === null) return;
            // Rederivamos el nombre de nota en el momento de ejecución para capturar cambios de acorde
            const currentChord = this.activePreviewChord || chordName;
            const refOctave = pn.voice === 'bass' ? 2 : 4;
            const resolvedNote = this.resolvePatternNoteToChord(pn, currentChord, refOctave);
            playNoteImmediate(resolvedNote, durMs, pn.velocity);
          }, delayMs);
        }

        // Repetir el ciclo cuando termine
        this.previewTimer = setTimeout(runCycle, cycleDurationMs);
      };

      runCycle();
      return;
    }

    // Loop continuo para quarters, eighths, pop, arpeggio
    const runStep = () => {
      if (this.activePreviewChord === null) return; // detenido

      const nextIntervalMs = this.triggerPreviewPatternStep(
        pattern,
        this.previewNotes,       // siempre lee el acorde más reciente
        this.previewStep,
        beatDurationMs,
        playNoteImmediate,
        playChordImmediate,
        playBassImmediate
      );

      this.previewStep++;
      this.previewTimer = setTimeout(runStep, nextIntervalMs);
    };

    runStep();
  }


  private triggerPreviewPatternStep(
    pattern: string,
    notes: string[],
    step: number,
    beatDurationMs: number,
    playNote: (note: string, durMs: number, vel?: number) => void,
    playChord: (durMs: number, vel?: number) => void,
    playBass: (durMs: number, vel?: number) => void
  ): number {
    if (pattern === 'quarters') {
      playChord(beatDurationMs * 0.8, 0.6);
      return beatDurationMs;
    } 

    if (pattern === 'eighths') {
      playChord(beatDurationMs * 0.4, 0.55);
      return beatDurationMs * 0.5;
    }

    if (pattern === 'pop') {
      const stepInPattern = step % 4;
      if (stepInPattern === 0) {
        playChord(beatDurationMs * 0.8, 0.6);
        return beatDurationMs * 1.5;
      } else if (stepInPattern === 1) {
        playChord(beatDurationMs * 0.4, 0.55);
        return beatDurationMs * 1.0;
      } else if (stepInPattern === 2) {
        playChord(beatDurationMs * 0.7, 0.6);
        return beatDurationMs * 1.0;
      } else {
        playChord(beatDurationMs * 0.4, 0.55);
        return beatDurationMs * 0.5;
      }
    }

    if (pattern === 'arpeggio') {
      // Disparar bajo cada 8 pasos (4 beats) para continuidad
      if (step % 8 === 0) {
        playBass(beatDurationMs * 4, 0.7);
      }

      const arpNotes = notes.length > 1 ? notes.slice(1) : notes;
      const period = (arpNotes.length - 1) * 2;
      let noteIndex = 0;

      if (period > 0) {
        const mod = step % period;
        noteIndex = mod < arpNotes.length ? mod : period - mod;
      }

      playNote(arpNotes[noteIndex], beatDurationMs * 0.4, 0.55);
      return beatDurationMs * 0.5;
    }

    return beatDurationMs;
  }

  public playChordPreviewStop(_chordName?: string) {
    this.activePreviewChord = null;
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    
    // Apagar selectivamente únicamente las notas de preescucha
    const now = Tone.now();
    const usePiano = this.isChordPianoActive();
    this.activePreviewNotes.forEach(note => {
      try {
        if (usePiano) {
          this.chordsPiano!.keyUp({ note, time: now });
        } else {
          this.chordSynth.triggerRelease(note, now);
        }
      } catch (_) {}
      
      // Quitar del visualizador de piano
      this.activeNotesSet.delete(note);
      const timer = this.noteActiveTimers.get(note);
      if (timer) {
        clearTimeout(timer);
        this.noteActiveTimers.delete(note);
      }
    });
    this.activePreviewNotes = [];
    useSongStore.getState().setActiveNotes(Array.from(this.activeNotesSet));
  }

  public playNotePreview(noteName: string) {
    if (!this.isInitialized) this.init();
    const usePiano = this.isMelodyPianoActive();
    
    try {
      if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
        const now = Tone.now();
        this.melodyPiano.keyDown({ note: noteName, time: now, velocity: 0.8 });
        this.melodyPiano.keyUp({ note: noteName, time: now + 0.3 });
      } else {
        this.melodySynth.triggerAttackRelease(noteName, '8n');
      }
      this.trackNote(noteName, 0.3, undefined, 'melody');
    } catch (e) {
      console.warn('Error tocando nota preview:', e);
    }
  }

  public stop() {
    Tone.Transport.stop();
    useSongStore.getState().setPlaying(false);
    useSongStore.getState().setCurrentBeat(0);
    this.lastTriggeredBeat = -1;
    this.lastTriggeredChordId = '';
    this.lastTriggeredChordName = '';
    this.lastTriggeredVoicing = '';
    this.lastTriggeredInversion = 0;
    this.silence();
    // Limpiar visualizador de armonía
    this.activeNotesSet.clear();
    this.noteActiveTimers.forEach(t => clearTimeout(t));
    this.noteActiveTimers.clear();
    useSongStore.getState().setActiveNotes([]);
    // Limpiar visualizador de melodía
    this.activeMelodyNotesSet.clear();
    this.melodyNoteActiveTimers.forEach(t => clearTimeout(t));
    this.melodyNoteActiveTimers.clear();
    useSongStore.getState().setActiveMelodyNotes([]);
  }

  public setSeconds(seconds: number) {
    Tone.Transport.seconds = seconds;
    const currentBeat = seconds * (useSongStore.getState().bpm / 60);
    useSongStore.getState().setCurrentBeat(currentBeat);
  }

  public seekToBeat(beat: number) {
    if (!this.isInitialized) this.init();
    const bpm = useSongStore.getState().bpm;
    const seconds = beat * (60 / bpm);
    
    this.lastTriggeredBeat = -1;
    this.lastTriggeredChordId = '';
    this.lastTriggeredChordName = '';
    
    Tone.Transport.seconds = seconds;
    useSongStore.getState().setCurrentBeat(beat);

    if (!useSongStore.getState().isPlaying) {
      this.silence();
    }
  }

  public startNote(noteName: string) {
    if (!this.isInitialized) {
      this.init().then(() => {
        this.startNote(noteName);
      });
      return;
    }

    try {
      this.activePressedNotes.add(noteName);
      this.activePressedNotesList = this.activePressedNotesList.filter(n => n !== noteName);
      this.activePressedNotesList.push(noteName);

      const usePiano = this.isMelodyPianoActive();
      if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
        this.melodyPiano.keyDown({ note: noteName, time: Tone.now(), velocity: 0.8 });
      } else {
        this.melodySynth.triggerAttack(noteName, Tone.now());
      }
      this.trackNoteStart(noteName);
    } catch (e) {
      console.warn('Error starting note:', e);
    }
  }

  public stopNote(noteName: string) {
    if (!this.isInitialized) return;
    
    try {
      this.activePressedNotes.delete(noteName);
      this.activePressedNotesList = this.activePressedNotesList.filter(n => n !== noteName);

      const usePiano = this.isMelodyPianoActive();
      if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
        this.melodyPiano.keyUp({ note: noteName, time: Tone.now() });
      } else {
        if (this.activePressedNotes.size === 0) {
          this.melodySynth.triggerRelease(Tone.now());
        } else {
          const nextNote = this.activePressedNotesList[this.activePressedNotesList.length - 1];
          this.melodySynth.triggerAttack(nextNote, Tone.now());
        }
      }
      this.trackNoteStop(noteName);
    } catch (e) {
      console.warn('Error stopping note:', e);
    }
  }


  private trackNoteStart(note: string) {
    const state = useSongStore.getState();
    const existingTimer = this.melodyNoteActiveTimers.get(note);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.melodyNoteActiveTimers.delete(note);
    }
    this.activeMelodyNotesSet.add(note);
    state.setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));
  }

  private trackNoteStop(note: string) {
    const state = useSongStore.getState();
    const offTimer = setTimeout(() => {
      this.activeMelodyNotesSet.delete(note);
      state.setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));
      this.melodyNoteActiveTimers.delete(note);
    }, 150);
    this.melodyNoteActiveTimers.set(note, offTimer);
  }

  public handleKeyDown(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    // S4: Leer de caché en lugar de getState() — elimina overhead en el hot path de teclado
    if (!this.cachedIsKeyboardMelodyEnabled) return;
    if (e.repeat) return;

    const key = e.key.toLowerCase();

    if (this.cachedIsKeyboardChromatic) {
      const semitones = CHROMATIC_KEY_MAP[key];
      if (semitones !== undefined) {
        e.preventDefault();
        const noteName = this.getChromaticNoteName(this.cachedKey, semitones);
        this.startNote(noteName);
      }
    } else {
      const scaleIndex = DIATONIC_KEY_MAP[key];
      if (scaleIndex !== undefined) {
        e.preventDefault();
        const noteName = this.getDiatonicNoteName(this.cachedKey, this.cachedScale, scaleIndex);
        this.startNote(noteName);
      }
    }
  }

  public handleKeyUp(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    // S4: Leer de caché en lugar de getState()
    if (!this.cachedIsKeyboardMelodyEnabled) return;

    const key = e.key.toLowerCase();

    if (this.cachedIsKeyboardChromatic) {
      const semitones = CHROMATIC_KEY_MAP[key];
      if (semitones !== undefined) {
        const noteName = this.getChromaticNoteName(this.cachedKey, semitones);
        this.stopNote(noteName);
      }
    } else {
      const scaleIndex = DIATONIC_KEY_MAP[key];
      if (scaleIndex !== undefined) {
        const noteName = this.getDiatonicNoteName(this.cachedKey, this.cachedScale, scaleIndex);
        this.stopNote(noteName);
      }
    }
  }

  private getDiatonicNoteName(key: string, scaleType: string, index: number): string {
    const rootVal = NOTE_CLASSES.indexOf(key as any);
    const intervals = (SCALE_INTERVALS as Record<string, number[]>)[scaleType] || SCALE_INTERVALS.major;
    const scaleLength = intervals.length;
    
    const scaleIndex = index % scaleLength;
    const octaveOffset = Math.floor(index / scaleLength);
    
    const baseOctave = 4;
    
    const val = rootVal + intervals[scaleIndex];
    const noteClass = NOTE_CLASSES[val % 12];
    const calculatedOctave = baseOctave + octaveOffset + Math.floor(val / 12);
    
    return `${noteClass}${calculatedOctave}`;
  }

  private getChromaticNoteName(key: string, semitones: number): string {
    const rootVal = NOTE_CLASSES.indexOf(key as any);
    const val = rootVal + semitones;
    
    const baseOctave = 4;
    
    const noteClass = NOTE_CLASSES[val % 12];
    const calculatedOctave = baseOctave + Math.floor(val / 12);
    
    return `${noteClass}${calculatedOctave}`;
  }


  private triggerChordTick(time: number) {
    // S5: Leer el estado una sola vez en lugar de múltiples llamadas a getState()
    const state = useSongStore.getState();
    if (!state.isPlaying) return;

    const bpm = Tone.Transport.bpm.value;
    const beat = Tone.Transport.getSecondsAtTime(time) * (bpm / 60);
    // Redondear a la semicorchea más cercana (0.25 beats)
    const tickBeat = Math.round(beat * 4) / 4;

    // Si retrocedemos en loop, reseteamos la última marca
    if (tickBeat < this.lastTriggeredBeat) {
      this.lastTriggeredBeat = -1;
    }

    if (tickBeat === this.lastTriggeredBeat) return;
    this.lastTriggeredBeat = tickBeat;

    // Buscar si hay un bloque activo en este beat
    const block = state.chordBlocks.find(b => 
      tickBeat >= b.startBeat && tickBeat < b.startBeat + b.durationBeats
    );
    if (!block) return;

    const relativeBeat = tickBeat - block.startBeat;
    const pattern = state.pattern || 'hold';
    const usePiano = this.isChordPianoActive();
    const beatDuration = 60 / bpm;

    const notes = this.getBlockNotes(block, state.chordOctaveShift || 0);
    if (notes.length === 0) return;

    const hasChordChanged = 
      block.id !== this.lastTriggeredChordId || 
      block.chord !== this.lastTriggeredChordName || 
      block.voicing !== this.lastTriggeredVoicing || 
      block.inversion !== this.lastTriggeredInversion;

    if (hasChordChanged) {
      // Liberar notas activas anteriores para evitar amontonamiento
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        try {
          this.chordsPiano.stopAll();
        } catch (_) {}
      } else {
        try {
          this.chordSynth.releaseAll();
        } catch (_) {}
      }
      this.lastTriggeredChordId = block.id;
      this.lastTriggeredChordName = block.chord;
      this.lastTriggeredVoicing = block.voicing || 'default';
      this.lastTriggeredInversion = block.inversion || 0;
    }

    const playNote = (note: string, durBeats: number, velocity = 0.6) => {
      const durSec = durBeats * beatDuration;
      if (usePiano && this.chordsPiano && this.chordsPiano.loaded) {
        try {
          this.chordsPiano.keyDown({ note, time, velocity });
          this.chordsPiano.keyUp({ note, time: time + durSec });
        } catch (e) { console.error(e); }
      } else {

        try {
          this.chordSynth.triggerAttackRelease(note, durSec, time, velocity);
        } catch (e) { console.error(e); }
      }
      this.trackNote(note, durSec, time, 'harmony');
    };

    const playChord = (durBeats: number, velocity = 0.6) => {
      notes.forEach(note => playNote(note, durBeats, velocity));
    };

    if (pattern === 'hold') {
      if (relativeBeat === 0 || hasChordChanged) {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          playChord(remainingBeats, 0.6);
        }
      }
    } 
    else if (pattern === 'quarters') {
      if (relativeBeat % 1 === 0) {
        playChord(0.8, 0.6);
      }
    } 
    else if (pattern === 'eighths') {
      if (relativeBeat % 0.5 === 0) {
        playChord(0.4, 0.55);
      }
    } 
    else if (pattern === 'pop') {
      const beatInPattern = relativeBeat % 4;
      if (beatInPattern === 0) {
        playChord(0.8, 0.6);
      } else if (beatInPattern === 1.5) {
        playChord(0.4, 0.55);
      } else if (beatInPattern === 2.5) {
        playChord(0.7, 0.6);
      } else if (beatInPattern === 3.5) {
        playChord(0.4, 0.55);
      }
    } 
    else if (pattern === 'arpeggio') {
      // Bajo en beat 0 y sostiene
      if ((relativeBeat === 0 || hasChordChanged) && notes.length > 1 && block.type !== 'chord-only') {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          playNote(notes[0], remainingBeats, 0.7);
        }
      }

      // Arpegiar las notas del acorde (excluyendo el bajo)
      if (relativeBeat % 0.5 === 0) {
        const arpNotes = (notes.length > 1 && block.type !== 'chord-only') ? notes.slice(1) : notes;
        const period = (arpNotes.length - 1) * 2;
        const step = Math.round(relativeBeat / 0.5);
        let noteIndex = 0;

        if (period > 0) {
          const mod = step % period;
          noteIndex = mod < arpNotes.length ? mod : period - mod;
        }

        playNote(arpNotes[noteIndex], 0.4, 0.55);
      }
    } 
    else if (pattern === 'strum') {
      if (relativeBeat === 0 || hasChordChanged) {
        const remainingBeats = block.durationBeats - relativeBeat;
        if (remainingBeats > 0) {
          notes.forEach((note, index) => {
            const strumOffset = index * 0.025; // 25ms de desfase
            const noteTime = time + strumOffset;
            const noteDur = (remainingBeats * beatDuration) - strumOffset;

            if (usePiano) {
              try {
                this.chordsPiano!.keyDown({ note, time: noteTime, velocity: 0.6 - index * 0.05 });
                this.chordsPiano!.keyUp({ note, time: noteTime + noteDur });
              } catch (e) {
                console.error(e);
              }
            } else {
              try {
                this.chordSynth.triggerAttackRelease(note, noteDur, noteTime, 0.6 - index * 0.05);
              } catch (e) {
                console.error(e);
              }
            }
          });
        }
      }
    }
    else {
      // Patrón custom (PatternDef desde MIDI)
      const customPattern = state.customPatterns?.find((p: { name: string }) => p.name === pattern);
      if (customPattern) {
        this.playCustomPatternTick(
          customPattern, relativeBeat, block, notes, time, beatDuration, usePiano, hasChordChanged
        );
      }
    }
  }

  /**
   * Resuelve una nota de patrón MIDI (normalizada contra C major) a la armonía del acorde activo.
   * Utiliza un mapeo de grados de la triada/séptima de C major a la triada/séptima del acorde activo,
   * preservando las alteraciones y notas de paso de forma musical.
   */
  private resolvePatternNoteToChord(
    pn: { semitoneFromRoot: number; octaveOffset: number; voice: string },
    chordName: string,
    refOctave: number
  ): string {
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    let targetRefOctave = refOctave;
    if (pn.voice === 'chord') {
      const chordOctaveShift = useSongStore.getState().chordOctaveShift || 0;
      targetRefOctave += chordOctaveShift;
    }

    // 1. Obtener las notas básicas del acorde activo en la octava de referencia
    const activeChordNotes = getChordNotes(chordName, targetRefOctave);
    if (activeChordNotes.length === 0) {
      // Fallback simple si falla
      const rootMatch = chordName.split('/')[0].match(/^([A-G]#?)/);
      const rootName = rootMatch ? rootMatch[1] : 'C';
      const rootPC = NOTE_NAMES.indexOf(rootName);
      const targetPC = (rootPC + pn.semitoneFromRoot) % 12;
      const targetOctave = targetRefOctave + pn.octaveOffset + Math.floor((rootPC + pn.semitoneFromRoot) / 12);
      return `${NOTE_NAMES[targetPC]}${targetOctave}`;
    }

    // 3. Crear el array de notas del acorde activo en formato de semitonos relativos a su tónica
    const rootNoteName = activeChordNotes[0].replace(/[0-9]/g, '');
    const rootPC = NOTE_NAMES.indexOf(rootNoteName);

    const activeSemitones = activeChordNotes.map(n => {
      const pc = NOTE_NAMES.indexOf(n.replace(/[0-9]/g, ''));
      const oct = parseInt(n.replace(/[^0-9]/g, ''));
      const relativeMidi = (pc + 12 * oct) - (rootPC + 12 * targetRefOctave);
      return relativeMidi;
    });

    // Asegurar que tenemos al menos 4 elementos en activeSemitones añadiendo la octava (root + 12)
    if (activeSemitones.length < 4) {
      activeSemitones.push(activeSemitones[0] + 12);
    }

    // 4. Mapear semitonos en C major a grados de la triada/séptima
    const targetSemitone = pn.semitoneFromRoot;
    let targetBaseIdx = 0;
    let refBaseSemitone = 0;

    if (targetSemitone <= 2) {
      targetBaseIdx = 0; // Tónica
      refBaseSemitone = 0;
    } else if (targetSemitone <= 5) {
      targetBaseIdx = 1; // Tercera (o cuarta en sus4)
      refBaseSemitone = 4;
    } else if (targetSemitone <= 8) {
      targetBaseIdx = 2; // Quinta
      refBaseSemitone = 7;
    } else {
      targetBaseIdx = 3; // Séptima (o tensión octava)
      refBaseSemitone = 11;
    }

    // 5. Aplicar la diferencia (offset) a la nota del acorde activo en ese grado
    const offset = targetSemitone - refBaseSemitone;
    const activeBaseSemitone = activeSemitones[targetBaseIdx];
    const finalRelativeSemitone = activeBaseSemitone + offset;

    // 6. Convertir de nuevo a nombre de nota y octava absoluta
    const finalMidi = (rootPC + 12 * targetRefOctave) + finalRelativeSemitone + (12 * pn.octaveOffset);
    const finalPC = ((finalMidi % 12) + 12) % 12;
    const finalOctave = Math.floor(finalMidi / 12) - 1;

    return `${NOTE_NAMES[finalPC]}${finalOctave}`;
  }

  /**
   * Dispara las notas de un PatternDef custom para el beat actual.
   * Filtra las notas del patrón que deben sonar en este tick (beatOffset == relativeBeat % totalBeats).
   */
  private playCustomPatternTick(
    customPattern: PatternDef,
    relativeBeat: number,
    block: any,
    _notes: string[],
    time: number,
    beatDuration: number,
    usePiano: boolean | null,
    _hasChordChanged: boolean
  ) {
    const cycleOffset = relativeBeat % customPattern.totalBeats;
    const tickBeatRounded = Math.round(cycleOffset * 4) / 4;

    // Filtrar las notas del patrón que comienzan en este tick
    const toPlay = customPattern.notes.filter(pn => {
      const beatRounded = Math.round(pn.beatOffset * 4) / 4;
      return beatRounded === tickBeatRounded;
    });

    if (toPlay.length === 0) return;

    for (const pn of toPlay) {
      // Si el bloque es bass-only, solo reproducir notas de bajo; si es chord-only solo acordes
      if (block.type === 'bass-only' && pn.voice !== 'bass') continue;
      if (block.type === 'chord-only' && pn.voice !== 'chord') continue;

      const refOctave = pn.voice === 'bass' ? 2 : 4;
      const noteName = this.resolvePatternNoteToChord(pn, block.chord, refOctave);
      const durSec = pn.durationBeats * beatDuration;

      if (usePiano) {
        try {
          this.chordsPiano!.keyDown({ note: noteName, time, velocity: pn.velocity });
          this.chordsPiano!.keyUp({ note: noteName, time: time + durSec });
        } catch (e) { console.error(e); }
      } else {
        try {
          this.chordSynth.triggerAttackRelease(noteName, durSec, time, pn.velocity);
        } catch (e) { console.error(e); }
      }
      this.trackNote(noteName, durSec, time, 'harmony');
    }
  }

  private getBlockNotes(block: any, chordOctaveShift = 0): string[] {
    if (block.type === 'silence' || block.type === 'break') {
      return [];
    }

    let baseNotes = getChordNotes(block.chord, 4);
    if (baseNotes.length === 0) return [];

    if (block.voicing) {
      baseNotes = applyVoicing(baseNotes, block.voicing);
    }

    if (block.inversion) {
      baseNotes = invertChord(baseNotes, block.inversion);
    }

    if (chordOctaveShift !== 0) {
      baseNotes = baseNotes.map(note => shiftNoteOctave(note, chordOctaveShift));
    }

    // Tónica del acorde como bajo por defecto
    const rootNoteMatch = block.chord.match(/^([A-G]#?)/);
    const defaultBass = rootNoteMatch ? `${rootNoteMatch[1]}2` : baseNotes[0].replace(/[0-9]/g, '2');
    const bassNote = block.bassNote ? `${block.bassNote}2` : defaultBass;

    if (block.type === 'bass-only') {
      return [bassNote];
    }

    if (block.type === 'chord-only') {
      return baseNotes;
    }

    // Por defecto 'play': Bajo + Acorde
    return [bassNote, ...baseNotes];
  }

  private syncTimeline() {
    if (!this.isInitialized) return;

    const state = useSongStore.getState();
    const bpm = state.bpm;
    const beatDuration = 60 / bpm;
    const currentPos = Tone.Transport.seconds;
    
    // Limpiar únicamente los eventos de acordes y notas musicales programados previamente
    this.scheduledEvents.forEach((id) => {
      try {
        Tone.Transport.clear(id);
      } catch (e) {
        console.warn('Error clearing event:', e);
      }
    });
    this.scheduledEvents = [];

    const usePiano = this.isMelodyPianoActive();

    // --- LIBERAR NOTAS DE MELODÍA O ARMONÍA ELIMINADAS O LIMPIADAS ---
    const currentBeat = state.currentBeat;
    const now = Tone.now();

    // 1. Liberar notas de melodía que ya no están programadas en la melodía actual para este beat
    const stillActiveMelodyNotes = new Set(
      state.melodyNotes
        .filter(n => currentBeat >= n.startBeat && currentBeat < n.startBeat + n.durationBeats)
        .map(n => n.note)
    );

    Array.from(this.activeMelodyNotesSet).forEach(note => {
      if (!stillActiveMelodyNotes.has(note)) {
        try {
          if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
            this.melodyPiano.keyUp({ note, time: now });
          }
        } catch (_) {}
        this.activeMelodyNotesSet.delete(note);
        const timer = this.melodyNoteActiveTimers.get(note);
        if (timer) {
          clearTimeout(timer);
          this.melodyNoteActiveTimers.delete(note);
        }
      }
    });

    if (!usePiano && this.activeMelodyNotesSet.size === 0) {
      try {
        this.melodySynth.triggerRelease(now);
      } catch (_) {}
    }
    useSongStore.getState().setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));

    // 2. Liberar notas de armonía si no hay un bloque de acorde activo o si se limpiaron todos los bloques
    const activeBlock = state.chordBlocks.find(b => 
      currentBeat >= b.startBeat && currentBeat < b.startBeat + b.durationBeats
    );
    if (!activeBlock || state.chordBlocks.length === 0) {
      Array.from(this.activeNotesSet).forEach(note => {
        try {
          if (this.chordsPiano && this.chordsPiano.loaded) {
            this.chordsPiano.keyUp({ note, time: now });
          }
        } catch (_) {}
      });
      try {
        this.chordSynth.releaseAll();
      } catch (_) {}
      this.activeNotesSet.clear();
      this.noteActiveTimers.forEach(t => clearTimeout(t));
      this.noteActiveTimers.clear();
      useSongStore.getState().setActiveNotes([]);
    }

    // 1. Programar acordes (Deshabilitado: los acordes se programan dinámicamente al vuelo en triggerChordTick)

    // 2. Programar notas de melodía
    state.melodyNotes.forEach((note) => {
      const startTimeSeconds = note.startBeat * beatDuration;
      const durationSeconds = note.durationBeats * beatDuration;

      if (usePiano && this.melodyPiano && this.melodyPiano.loaded) {
        // Melodía con piano (apagado programado de forma segura en Web Audio)
        const id = Tone.Transport.schedule((time) => {
          try {
            this.melodyPiano!.keyDown({ note: note.note, time, velocity: note.velocity });
            this.melodyPiano!.keyUp({ note: note.note, time: time + durationSeconds });
          } catch (e) {
            console.error('Error tocando nota de melodía con piano:', e);
          }
          this.trackNote(note.note, durationSeconds, time, 'melody');
        }, startTimeSeconds);
        this.scheduledEvents.push(id);
      } else {
        // Melodía con sintetizador virtual original
        const id = Tone.Transport.schedule((time) => {
          try {
            this.melodySynth.triggerAttackRelease(note.note, durationSeconds, time, note.velocity);
          } catch (e) {
            console.error('Error tocando nota de melodía con sintetizador:', e);
          }
          this.trackNote(note.note, durationSeconds, time, 'melody');
        }, startTimeSeconds);
        this.scheduledEvents.push(id);
      }
    });


    // 3. Programar clicks del metrónomo de forma aislada y sample-accurate
    if (this.metroEventId !== null) {
      try {
        Tone.Transport.clear(this.metroEventId);
      } catch (_) {}
      this.metroEventId = null;
    }

    if (state.isMetronomeActive) {
      this.metroEventId = Tone.Transport.scheduleRepeat((time) => {
        try {
          const ticks = Tone.Transport.getTicksAtTime(time);
          const currentBeat = Math.round((ticks / Tone.Transport.PPQ) * 100) / 100;
          
          const timeSignature = useSongStore.getState().timeSignature || '4/4';
          const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
          
          const isMeasureStart = (currentBeat % beatsPerMeasure) === 0;
          const isBeat = (currentBeat % 1) === 0;
          
          let frequency = 400;
          if (isMeasureStart) {
            frequency = 1200;
          } else if (isBeat) {
            frequency = 800;
          }
          
          const volumeFactor = (isMeasureStart || isBeat) ? 1 : 0.5;
          const gain = state.metroVolume / 100 * volumeFactor;
          const db = gain === 0 ? -Infinity : Tone.gainToDb(gain);
          
          this.metroSynth.volume.value = db;
          this.metroSynth.triggerAttackRelease(frequency, '32n', time);
        } catch (e) {
          console.error('Error en metrónomo:', e);
        }
      }, state.metroSubdivision);
    }

    // 4. Calcular la duración total de la canción para el bucle
    const maxBeat = this.updateCachedMaxBeat(state);

    const loopEndSeconds = maxBeat * beatDuration;

    Tone.Transport.loop = false; // Desactivar bucle nativo
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = loopEndSeconds;

    // Solo reajustamos seconds si la posición actual excede los límites (evitando stutters al reproducir y editar)
    if (currentPos > loopEndSeconds) {
      Tone.Transport.seconds = loopEndSeconds;
    }
  }

  /**
   * Registra y gestiona una nota activa para actualizar la UI en tiempo real
   * mediante un setTimeout preciso sincronizado con la reproducción de Tone.js.
   */
  private trackNote(note: string, durationSeconds: number, startTime?: number, type: 'harmony' | 'melody' = 'harmony') {
    const now = Tone.now();
    const delayMs = startTime !== undefined ? Math.max(0, (startTime - now) * 1000) : 0;
    const durationMs = durationSeconds * 1000;

    setTimeout(() => {
      // Si la previsualización o reproducción se detuvo, no activar
      const state = useSongStore.getState();
      if (!state.isPlaying && this.activePreviewChord === null) {
        return;
      }

      if (type === 'melody') {
        // --- Melodía: usa el set y timers separados ---
        const existingTimer = this.melodyNoteActiveTimers.get(note);
        if (existingTimer) clearTimeout(existingTimer);

        this.activeMelodyNotesSet.add(note);
        state.setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));

        const offTimer = setTimeout(() => {
          this.activeMelodyNotesSet.delete(note);
          state.setActiveMelodyNotes(Array.from(this.activeMelodyNotesSet));
          this.melodyNoteActiveTimers.delete(note);
        }, durationMs);

        this.melodyNoteActiveTimers.set(note, offTimer);
      } else {
        // --- Armonía: comportamiento original ---
        const existingTimer = this.noteActiveTimers.get(note);
        if (existingTimer) clearTimeout(existingTimer);

        this.activeNotesSet.add(note);
        state.setActiveNotes(Array.from(this.activeNotesSet));

        const offTimer = setTimeout(() => {
          this.activeNotesSet.delete(note);
          state.setActiveNotes(Array.from(this.activeNotesSet));
          this.noteActiveTimers.delete(note);
        }, durationMs);

        this.noteActiveTimers.set(note, offTimer);
      }
    }, delayMs);
  }

  private updateSustain(sustain: boolean) {
    const releaseTime = sustain ? 2.5 : 0.8;
    this.chordSynth.set({
      envelope: { release: releaseTime }
    });
    [this.chordsPiano, this.melodyPiano].forEach(piano => {
      if (piano) {
        try {
          if (sustain) {
            piano.pedalDown();
          } else {
            piano.pedalUp();
          }
        } catch (e) {
          console.error('Error al aplicar pedal de sustain en el piano:', e);
        }
      }
    });
  }

}

export const toneEngine = new ToneEngine();
