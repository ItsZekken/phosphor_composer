/**
 * sf2Parser.ts
 * Parser nativo de SoundFont 2 (.sf2), SoundFont 3 (.sf3) y presets WebAudioFont (.js / .json).
 * Inspirado en la arquitectura de zonas de surikov/webaudiofont, extendido con soporte completo
 * de la especificación SF2.04 (herencia de zonas globales/locales, generadores AHDSR, filtro LP,
 * paneo estéreo, grupos exclusivos, loops y decodificación perezosa sin bloqueo del hilo principal).
 */

import type { SoundFontFormat } from '../../../utils/typeDefinitions';

export interface SoundFontAHDSR {
  delay: number;   // segundos
  attack: number;  // segundos
  hold: number;    // segundos
  decay: number;   // segundos
  sustain: number; // ganancia lineal (0..1)
  release: number; // segundos
}

export interface WebAudioFontEnvelopePoint {
  duration: number;
  volume: number;
}

export interface SoundFontZone {
  keyRangeLow: number;
  keyRangeHigh: number;
  velRangeLow: number;
  velRangeHigh: number;
  /** Nota raíz MIDI (puede tener fracción para presets WebAudioFont expresados en cents) */
  originalPitch: number;
  /** Corrección fina del sample en cents */
  pitchCorrection: number;
  /** Afinación gruesa en semitonos */
  coarseTune: number;
  /** Afinación fina en cents */
  fineTune: number;
  /** Escala de afinación en cents por semitono (100 normal, 0 percusión fija) */
  scaleTuning: number;
  sampleRate: number;
  /** Inicio de loop en segundos (o frames en WebAudioFont antes de normalizar contra buffer) */
  loopStart: number;
  /** Fin de loop en segundos (o frames en WebAudioFont antes de normalizar contra buffer) */
  loopEnd: number;
  /** 0 = sin loop, 1 = loop continuo, 3 = loop mientras se sostiene la tecla */
  loopMode: 0 | 1 | 3;
  /** Paneo estéreo (-1 izquierda .. +1 derecha) */
  pan: number;
  /** Atenuación efectiva en dB (>= 0) */
  attenuationDb: number;
  /** Frecuencia de corte del filtro pasa-bajos en Hz (null = bypass) */
  filterCutoffHz: number | null;
  /** Resonancia del filtro en dB */
  filterQDb: number;
  /** Grupo de corte mutuo (ej. Hi-Hat cerrado corta Hi-Hat abierto) */
  exclusiveClass: number;
  /** Override de tecla MIDI fija (generador 46) */
  fixedKey: number | null;
  /** Override de velocidad fija 0..127 (generador 47) */
  fixedVelocity: number | null;
  /** Escalado de Hold según altura MIDI (timecents por semitono respecto a C4) */
  keynumToVolEnvHold: number;
  /** Escalado de Decay según altura MIDI (timecents por semitono respecto a C4) */
  keynumToVolEnvDecay: number;
  ahdsr: SoundFontAHDSR;
  /** Curva AHDSR nativa de WebAudioFont cuando se importa un .js/.json de surikov/webaudiofont */
  wafAhdsrCurve?: WebAudioFontEnvelopePoint[] | false;
  /** Identificador del sample (índice en shdr para SF2/SF3, o índice de zona para WebAudioFont) */
  sampleId: number;
  /** Offset inicial (frames en SF2, bytes en SF3) */
  sampleStart: number;
  /** Offset final (frames en SF2, bytes en SF3) */
  sampleEnd: number;
  /** Flags sfSampleType de SF2 (bit 0x10 = comprimido SF3 Ogg Vorbis) */
  sampleType: number;
  /** Carga base64 de audio comprimido (MP3/OGG/WAV) en formato WebAudioFont */
  encodedFileBase64?: string;
  /** Carga base64 de PCM 16-bit crudo en formato WebAudioFont */
  encodedSampleBase64?: string;
  /** Indica si loopStart/loopEnd provienen de WebAudioFont y pueden estar en frames o segundos */
  wafLoopRaw?: boolean;
}

export interface ParsedSoundFontPreset {
  bank: number;
  program: number;
  name: string;
  zones: SoundFontZone[];
}

export interface ParsedSoundFont {
  format: SoundFontFormat;
  name: string;
  presets: ParsedSoundFontPreset[];
  /** Vista Int16 zero-copy sobre el chunk smpl de SF2 */
  smplData?: Int16Array;
  /** Vista Uint8 opcional sobre el chunk sm24 (extensión 24-bit SF2.04) */
  sm24Data?: Uint8Array;
  /** Vista Uint8 cruda sobre smpl para samples comprimidos SF3 (Ogg Vorbis) */
  smplRawBytes?: Uint8Array;
}

// Generadores SF2 canónicos (SoundFont 2.04 Technical Specification)
const GEN_START_ADDRS_OFFSET = 0;
const GEN_END_ADDRS_OFFSET = 1;
const GEN_STARTLOOP_ADDRS_OFFSET = 2;
const GEN_ENDLOOP_ADDRS_OFFSET = 3;
const GEN_START_ADDRS_COARSE_OFFSET = 4;
const GEN_INITIAL_FILTER_FC = 8;
const GEN_INITIAL_FILTER_Q = 9;
const GEN_END_ADDRS_COARSE_OFFSET = 12;
const GEN_PAN = 17;
const GEN_DELAY_VOL_ENV = 33;
const GEN_ATTACK_VOL_ENV = 34;
const GEN_HOLD_VOL_ENV = 35;
const GEN_DECAY_VOL_ENV = 36;
const GEN_SUSTAIN_VOL_ENV = 37;
const GEN_RELEASE_VOL_ENV = 38;
const GEN_KEYNUM_TO_VOL_ENV_HOLD = 39;
const GEN_KEYNUM_TO_VOL_ENV_DECAY = 40;
const GEN_INSTRUMENT = 41;
const GEN_KEY_RANGE = 43;
const GEN_VEL_RANGE = 44;
const GEN_STARTLOOP_ADDRS_COARSE_OFFSET = 45;
const GEN_KEYNUM = 46;
const GEN_VELOCITY = 47;
const GEN_INITIAL_ATTENUATION = 48;
const GEN_ENDLOOP_ADDRS_COARSE_OFFSET = 50;
const GEN_COARSE_TUNE = 51;
const GEN_FINE_TUNE = 52;
const GEN_SAMPLE_ID = 53;
const GEN_SAMPLE_MODES = 54;
const GEN_SCALE_TUNING = 56;
const GEN_EXCLUSIVE_CLASS = 57;
const GEN_OVERRIDING_ROOT_KEY = 58;

interface Sf2Generator {
  oper: number;
  amountU16: number;
  amountI16: number;
  lo: number;
  hi: number;
}

interface Sf2PresetHeader {
  name: string;
  program: number;
  bank: number;
  bagIndex: number;
}

interface Sf2InstrumentHeader {
  name: string;
  bagIndex: number;
}

interface Sf2Bag {
  genIndex: number;
  modIndex: number;
}

interface Sf2SampleHeader {
  name: string;
  start: number;
  end: number;
  startLoop: number;
  endLoop: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
  sampleLink: number;
  sampleType: number;
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] || 0,
    bytes[offset + 1] || 0,
    bytes[offset + 2] || 0,
    bytes[offset + 3] || 0
  );
}

function readAsciiZ(bytes: Uint8Array, offset: number, maxLength: number): string {
  let end = offset;
  const limit = Math.min(bytes.length, offset + maxLength);
  while (end < limit && bytes[end] !== 0) {
    end++;
  }
  let out = '';
  for (let i = offset; i < end; i++) {
    const code = bytes[i];
    if (code >= 32 && code <= 126) {
      out += String.fromCharCode(code);
    } else if (code >= 160) {
      out += String.fromCharCode(code);
    }
  }
  return out.trim();
}

function timecentsToSeconds(tc: number, minSeconds = 0, maxSeconds = 60): number {
  if (!Number.isFinite(tc) || tc <= -32768 || tc <= -12000) {
    return minSeconds;
  }
  const sec = Math.pow(2, tc / 1200);
  return Math.max(minSeconds, Math.min(maxSeconds, sec));
}

function centibelsToGain(cb: number): number {
  const clamped = Math.max(0, Math.min(1440, cb));
  if (clamped >= 1000) return 0;
  return Math.pow(10, -clamped / 200);
}

/**
 * Desenvuelve índices uint16 en archivos SF2 masivos (>65535 generadores o bags).
 */
function unwrapU16Indices(rawIndices: number[], totalItems: number): number[] {
  if (rawIndices.length === 0) return rawIndices;
  const unwrapped = new Array<number>(rawIndices.length);
  let carry = 0;
  let prev = rawIndices[0];
  unwrapped[0] = prev;
  for (let i = 1; i < rawIndices.length; i++) {
    const curr = rawIndices[i];
    if (curr < prev && totalItems > 65535) {
      carry += 65536;
    }
    unwrapped[i] = curr + carry;
    prev = curr;
  }
  return unwrapped;
}

/**
 * Comprueba si un buffer binario comienza con cabecera RIFF/sfbk (SoundFont 2 / 3).
 */
export function isSf2Binary(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 12) return false;
  return readFourCC(bytes, 0) === 'RIFF' && readFourCC(bytes, 8) === 'sfbk';
}

/**
 * Parsea un archivo SoundFont 2 (.sf2) o SoundFont 3 (.sf3) desde bytes binarios.
 */
export function parseSF2Bytes(bytes: Uint8Array, fallbackName = 'SoundFont'): ParsedSoundFont {
  if (!isSf2Binary(bytes)) {
    throw new Error('El archivo no tiene una cabecera SoundFont RIFF/sfbk válida.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  const fileEnd = Math.min(bytes.length, 8 + riffSize);

  let bankName = '';
  let smplOffset = -1;
  let smplSize = 0;
  let sm24Offset = -1;
  let sm24Size = 0;

  const pdtaChunks = new Map<string, { offset: number; size: number }>();

  let pos = 12;
  while (pos + 8 <= fileEnd) {
    const chunkId = readFourCC(bytes, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const payloadStart = pos + 8;
    const payloadEnd = Math.min(fileEnd, payloadStart + chunkSize);

    if (chunkId === 'LIST' && payloadStart + 4 <= payloadEnd) {
      const listType = readFourCC(bytes, payloadStart);
      let subPos = payloadStart + 4;
      while (subPos + 8 <= payloadEnd) {
        const subId = readFourCC(bytes, subPos);
        const subSize = view.getUint32(subPos + 4, true);
        const subDataStart = subPos + 8;
        const subDataEnd = Math.min(payloadEnd, subDataStart + subSize);

        if (listType === 'INFO' && subId === 'INAM') {
          bankName = readAsciiZ(bytes, subDataStart, subDataEnd - subDataStart);
        } else if (listType === 'sdta') {
          if (subId === 'smpl') {
            smplOffset = subDataStart;
            smplSize = subDataEnd - subDataStart;
          } else if (subId === 'sm24') {
            sm24Offset = subDataStart;
            sm24Size = subDataEnd - subDataStart;
          }
        } else if (listType === 'pdta') {
          pdtaChunks.set(subId, { offset: subDataStart, size: subDataEnd - subDataStart });
        }

        subPos = subDataStart + subSize + (subSize & 1);
      }
    }

    pos = payloadStart + chunkSize + (chunkSize & 1);
  }

  if (smplOffset < 0 || smplSize <= 0) {
    throw new Error('El SoundFont no contiene datos de audio (chunk sdta/smpl ausente).');
  }

  const requiredPdta = ['phdr', 'pbag', 'pgen', 'inst', 'ibag', 'igen', 'shdr'] as const;
  for (const req of requiredPdta) {
    if (!pdtaChunks.has(req)) {
      throw new Error(`El SoundFont está incompleto: falta la tabla "${req}" en pdta.`);
    }
  }

  // Vista zero-copy sobre smpl (garantizando alineación de 2 bytes para Int16Array)
  const smplRawBytes = bytes.subarray(smplOffset, smplOffset + smplSize);
  let smplData: Int16Array;
  const absoluteSmplOffset = bytes.byteOffset + smplOffset;
  const sampleCount = Math.floor(smplSize / 2);
  if ((absoluteSmplOffset & 1) === 0) {
    smplData = new Int16Array(bytes.buffer, absoluteSmplOffset, sampleCount);
  } else {
    const alignedCopy = smplRawBytes.slice(0, sampleCount * 2);
    smplData = new Int16Array(alignedCopy.buffer, alignedCopy.byteOffset, sampleCount);
  }

  const sm24Data =
    sm24Offset >= 0 && sm24Size >= sampleCount
      ? bytes.subarray(sm24Offset, sm24Offset + sm24Size)
      : undefined;

  // 1. Parsear tablas de generadores (pgen, igen)
  const parseGenerators = (chunkName: 'pgen' | 'igen'): Sf2Generator[] => {
    const c = pdtaChunks.get(chunkName)!;
    const count = Math.floor(c.size / 4);
    const list = new Array<Sf2Generator>(count);
    for (let i = 0; i < count; i++) {
      const off = c.offset + i * 4;
      const oper = view.getUint16(off, true);
      const amountU16 = view.getUint16(off + 2, true);
      const amountI16 = view.getInt16(off + 2, true);
      list[i] = {
        oper,
        amountU16,
        amountI16,
        lo: bytes[off + 2],
        hi: bytes[off + 3]
      };
    }
    return list;
  };

  const pgen = parseGenerators('pgen');
  const igen = parseGenerators('igen');

  // 2. Parsear bags (pbag, ibag)
  const parseBags = (chunkName: 'pbag' | 'ibag', totalGens: number): Sf2Bag[] => {
    const c = pdtaChunks.get(chunkName)!;
    const count = Math.floor(c.size / 4);
    const rawGenIndices = new Array<number>(count);
    const rawModIndices = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      const off = c.offset + i * 4;
      rawGenIndices[i] = view.getUint16(off, true);
      rawModIndices[i] = view.getUint16(off + 2, true);
    }
    const unwrappedGen = unwrapU16Indices(rawGenIndices, totalGens);
    const list = new Array<Sf2Bag>(count);
    for (let i = 0; i < count; i++) {
      list[i] = { genIndex: unwrappedGen[i], modIndex: rawModIndices[i] };
    }
    return list;
  };

  const pbag = parseBags('pbag', pgen.length);
  const ibag = parseBags('ibag', igen.length);

  // 3. Parsear phdr (38 bytes por registro; último registro es centinela EOP)
  const phdrChunk = pdtaChunks.get('phdr')!;
  const phdrCount = Math.floor(phdrChunk.size / 38);
  const rawPbagIndices = new Array<number>(phdrCount);
  const rawPhdrs: Array<{ name: string; program: number; bank: number }> = [];
  for (let i = 0; i < phdrCount; i++) {
    const off = phdrChunk.offset + i * 38;
    rawPhdrs.push({
      name: readAsciiZ(bytes, off, 20),
      program: view.getUint16(off + 20, true),
      bank: view.getUint16(off + 22, true)
    });
    rawPbagIndices[i] = view.getUint16(off + 24, true);
  }
  const unwrappedPbagIndices = unwrapU16Indices(rawPbagIndices, pbag.length);
  const phdrs: Sf2PresetHeader[] = rawPhdrs.map((item, i) => ({
    ...item,
    bagIndex: unwrappedPbagIndices[i]
  }));

  // 4. Parsear inst (22 bytes por registro; último registro es centinela EOI)
  const instChunk = pdtaChunks.get('inst')!;
  const instCount = Math.floor(instChunk.size / 22);
  const rawIbagIndices = new Array<number>(instCount);
  const rawInstNames = new Array<string>(instCount);
  for (let i = 0; i < instCount; i++) {
    const off = instChunk.offset + i * 22;
    rawInstNames[i] = readAsciiZ(bytes, off, 20);
    rawIbagIndices[i] = view.getUint16(off + 20, true);
  }
  const unwrappedIbagIndices = unwrapU16Indices(rawIbagIndices, ibag.length);
  const insts: Sf2InstrumentHeader[] = rawInstNames.map((name, i) => ({
    name,
    bagIndex: unwrappedIbagIndices[i]
  }));

  // 5. Parsear shdr (46 bytes por registro; último registro es centinela EOS)
  const shdrChunk = pdtaChunks.get('shdr')!;
  const shdrCount = Math.floor(shdrChunk.size / 46);
  const shdrs: Sf2SampleHeader[] = [];
  let hasCompressedSf3 = false;
  for (let i = 0; i < Math.max(0, shdrCount - 1); i++) {
    const off = shdrChunk.offset + i * 46;
    const sampleType = view.getUint16(off + 44, true);
    if ((sampleType & 0x10) !== 0) {
      hasCompressedSf3 = true;
    }
    shdrs.push({
      name: readAsciiZ(bytes, off, 20),
      start: view.getUint32(off + 20, true),
      end: view.getUint32(off + 24, true),
      startLoop: view.getUint32(off + 28, true),
      endLoop: view.getUint32(off + 32, true),
      sampleRate: view.getUint32(off + 36, true) || 44100,
      originalPitch: bytes[off + 40],
      pitchCorrection: view.getInt8(off + 41),
      sampleLink: view.getUint16(off + 42, true),
      sampleType
    });
  }

  // Helper: leer mapa de generadores para una zona bag[bagIdx]
  const readBagGenerators = (
    bags: Sf2Bag[],
    gens: Sf2Generator[],
    bagIdx: number
  ): Map<number, Sf2Generator> => {
    const map = new Map<number, Sf2Generator>();
    if (bagIdx < 0 || bagIdx >= bags.length) return map;
    const startGen = bags[bagIdx].genIndex;
    const endGen = bagIdx + 1 < bags.length ? bags[bagIdx + 1].genIndex : gens.length;
    for (let g = startGen; g < endGen && g < gens.length; g++) {
      map.set(gens[g].oper, gens[g]);
    }
    return map;
  };

  // Pre-resolver zonas de cada instrumento para evitar trabajo redundante
  const instZonesCache = new Map<
    number,
    Array<{ sampleId: number; gens: Map<number, Sf2Generator> }>
  >();

  const getInstrumentZones = (instIdx: number) => {
    const cached = instZonesCache.get(instIdx);
    if (cached) return cached;

    const resolved: Array<{ sampleId: number; gens: Map<number, Sf2Generator> }> = [];
    if (instIdx < 0 || instIdx >= insts.length - 1) {
      instZonesCache.set(instIdx, resolved);
      return resolved;
    }

    const startBag = insts[instIdx].bagIndex;
    const endBag = instIdx + 1 < insts.length ? insts[instIdx + 1].bagIndex : ibag.length;

    let globalGens: Map<number, Sf2Generator> | null = null;
    for (let b = startBag; b < endBag && b < ibag.length; b++) {
      const localGens = readBagGenerators(ibag, igen, b);
      const sampleGen = localGens.get(GEN_SAMPLE_ID);
      if (sampleGen === undefined) {
        if (b === startBag) {
          globalGens = localGens;
        }
        continue;
      }

      const merged = new Map<number, Sf2Generator>();
      if (globalGens) {
        globalGens.forEach((v, k) => merged.set(k, v));
      }
      localGens.forEach((v, k) => merged.set(k, v));

      resolved.push({
        sampleId: sampleGen.amountU16,
        gens: merged
      });
    }

    instZonesCache.set(instIdx, resolved);
    return resolved;
  };

  const getInstI16 = (m: Map<number, Sf2Generator>, oper: number, def: number): number => {
    const g = m.get(oper);
    return g !== undefined ? g.amountI16 : def;
  };

  const getPresetDeltaI16 = (m: Map<number, Sf2Generator>, oper: number): number => {
    const g = m.get(oper);
    return g !== undefined ? g.amountI16 : 0;
  };

  // 6. Construir Presets y Zonas resueltas
  const presets: ParsedSoundFontPreset[] = [];
  const presetRecordCount = Math.max(0, phdrs.length - 1);

  for (let p = 0; p < presetRecordCount; p++) {
    const ph = phdrs[p];
    const startBag = ph.bagIndex;
    const endBag = p + 1 < phdrs.length ? phdrs[p + 1].bagIndex : pbag.length;

    let presetGlobalGens: Map<number, Sf2Generator> | null = null;
    const zones: SoundFontZone[] = [];

    for (let b = startBag; b < endBag && b < pbag.length; b++) {
      const localPresetGens = readBagGenerators(pbag, pgen, b);
      const instGen = localPresetGens.get(GEN_INSTRUMENT);
      if (instGen === undefined) {
        if (b === startBag) {
          presetGlobalGens = localPresetGens;
        }
        continue;
      }

      const mergedPresetGens = new Map<number, Sf2Generator>();
      if (presetGlobalGens) {
        presetGlobalGens.forEach((v, k) => mergedPresetGens.set(k, v));
      }
      localPresetGens.forEach((v, k) => mergedPresetGens.set(k, v));

      const pKeyRange = mergedPresetGens.get(GEN_KEY_RANGE);
      const pVelRange = mergedPresetGens.get(GEN_VEL_RANGE);
      const pKeyLow = pKeyRange ? pKeyRange.lo : 0;
      const pKeyHigh = pKeyRange ? pKeyRange.hi : 127;
      const pVelLow = pVelRange ? pVelRange.lo : 0;
      const pVelHigh = pVelRange ? pVelRange.hi : 127;

      const instZones = getInstrumentZones(instGen.amountU16);
      for (let zIdx = 0; zIdx < instZones.length; zIdx++) {
        const iz = instZones[zIdx];
        const sample = shdrs[iz.sampleId];
        if (!sample) continue;

        const ig = iz.gens;
        const iKeyRange = ig.get(GEN_KEY_RANGE);
        const iVelRange = ig.get(GEN_VEL_RANGE);

        const keyRangeLow = Math.max(pKeyLow, iKeyRange ? iKeyRange.lo : 0);
        const keyRangeHigh = Math.min(pKeyHigh, iKeyRange ? iKeyRange.hi : 127);
        const velRangeLow = Math.max(pVelLow, iVelRange ? iVelRange.lo : 0);
        const velRangeHigh = Math.min(pVelHigh, iVelRange ? iVelRange.hi : 127);

        if (keyRangeLow > keyRangeHigh || velRangeLow > velRangeHigh) {
          continue;
        }

        const isCompressed = (sample.sampleType & 0x10) !== 0;
        const sampleRate = Math.max(8000, Math.min(192000, sample.sampleRate || 44100));

        let sampleStart = sample.start;
        let sampleEnd = sample.end;
        let loopStartSec = 0;
        let loopEndSec = 0;

        if (!isCompressed) {
          const startOff =
            getInstI16(ig, GEN_START_ADDRS_OFFSET, 0) +
            getInstI16(ig, GEN_START_ADDRS_COARSE_OFFSET, 0) * 32768;
          const endOff =
            getInstI16(ig, GEN_END_ADDRS_OFFSET, 0) +
            getInstI16(ig, GEN_END_ADDRS_COARSE_OFFSET, 0) * 32768;
          const startLoopOff =
            getInstI16(ig, GEN_STARTLOOP_ADDRS_OFFSET, 0) +
            getInstI16(ig, GEN_STARTLOOP_ADDRS_COARSE_OFFSET, 0) * 32768;
          const endLoopOff =
            getInstI16(ig, GEN_ENDLOOP_ADDRS_OFFSET, 0) +
            getInstI16(ig, GEN_ENDLOOP_ADDRS_COARSE_OFFSET, 0) * 32768;

          sampleStart = Math.max(0, sample.start + startOff);
          sampleEnd = Math.min(smplData.length, sample.end + endOff);
          if (sampleEnd <= sampleStart + 4) continue;

          const loopStartFrame = sample.startLoop + startLoopOff - sampleStart;
          const loopEndFrame = sample.endLoop + endLoopOff - sampleStart;
          const frameCount = sampleEnd - sampleStart;
          if (loopEndFrame > loopStartFrame + 16 && loopStartFrame >= 0 && loopEndFrame <= frameCount) {
            loopStartSec = loopStartFrame / sampleRate;
            loopEndSec = loopEndFrame / sampleRate;
          }
        } else {
          // SF3: start/end son offsets de bytes Ogg Vorbis; startLoop/endLoop son frames relativos al sample
          sampleStart = Math.max(0, sample.start);
          sampleEnd = Math.min(smplRawBytes.length, sample.end);
          if (sampleEnd <= sampleStart + 16) continue;
          if (sample.endLoop > sample.startLoop + 16) {
            loopStartSec = sample.startLoop / sampleRate;
            loopEndSec = sample.endLoop / sampleRate;
          }
        }

        const rawSampleMode = getInstI16(ig, GEN_SAMPLE_MODES, 0) & 3;
        const loopMode: 0 | 1 | 3 =
          rawSampleMode === 1 || rawSampleMode === 3
            ? loopEndSec > loopStartSec
              ? rawSampleMode
              : 0
            : 0;

        // Nota raíz y afinación
        const overrideRoot = getInstI16(ig, GEN_OVERRIDING_ROOT_KEY, -1);
        let originalPitch = overrideRoot >= 0 && overrideRoot <= 127 ? overrideRoot : sample.originalPitch;
        if (originalPitch < 0 || originalPitch > 127) {
          originalPitch = 60;
        }

        const coarseTune =
          getInstI16(ig, GEN_COARSE_TUNE, 0) + getPresetDeltaI16(mergedPresetGens, GEN_COARSE_TUNE);
        const fineTune =
          getInstI16(ig, GEN_FINE_TUNE, 0) + getPresetDeltaI16(mergedPresetGens, GEN_FINE_TUNE);
        const scaleTuning = Math.max(
          0,
          Math.min(1200, getInstI16(ig, GEN_SCALE_TUNING, 100) + getPresetDeltaI16(mergedPresetGens, GEN_SCALE_TUNING))
        );

        // Paneo (-500..+500 -> -1..+1)
        const rawPan = getInstI16(ig, GEN_PAN, 0) + getPresetDeltaI16(mergedPresetGens, GEN_PAN);
        const pan = Math.max(-1, Math.min(1, rawPan / 500));

        // Atenuación (escala compatible con FluidSynth / EMU10K1: 0.4 * cB / 10 = 0.04 dB/cB)
        const rawAttenCb = Math.max(
          0,
          getInstI16(ig, GEN_INITIAL_ATTENUATION, 0) + getPresetDeltaI16(mergedPresetGens, GEN_INITIAL_ATTENUATION)
        );
        const attenuationDb = Math.min(96, rawAttenCb * 0.04);

        // Filtro pasa-bajos SF2
        const filterFcCents =
          getInstI16(ig, GEN_INITIAL_FILTER_FC, 13500) + getPresetDeltaI16(mergedPresetGens, GEN_INITIAL_FILTER_FC);
        const filterCutoffHz =
          filterFcCents < 13450
            ? Math.max(20, Math.min(20000, 8.176 * Math.pow(2, filterFcCents / 1200)))
            : null;
        const filterQCb = Math.max(
          0,
          Math.min(
            960,
            getInstI16(ig, GEN_INITIAL_FILTER_Q, 0) + getPresetDeltaI16(mergedPresetGens, GEN_INITIAL_FILTER_Q)
          )
        );
        const filterQDb = filterQCb / 10;

        // Envolvente de volumen AHDSR
        const delayTc =
          getInstI16(ig, GEN_DELAY_VOL_ENV, -12000) + getPresetDeltaI16(mergedPresetGens, GEN_DELAY_VOL_ENV);
        const attackTc =
          getInstI16(ig, GEN_ATTACK_VOL_ENV, -12000) + getPresetDeltaI16(mergedPresetGens, GEN_ATTACK_VOL_ENV);
        const holdTc =
          getInstI16(ig, GEN_HOLD_VOL_ENV, -12000) + getPresetDeltaI16(mergedPresetGens, GEN_HOLD_VOL_ENV);
        const decayTc =
          getInstI16(ig, GEN_DECAY_VOL_ENV, -12000) + getPresetDeltaI16(mergedPresetGens, GEN_DECAY_VOL_ENV);
        const sustainCb =
          getInstI16(ig, GEN_SUSTAIN_VOL_ENV, 0) + getPresetDeltaI16(mergedPresetGens, GEN_SUSTAIN_VOL_ENV);
        const releaseTc =
          getInstI16(ig, GEN_RELEASE_VOL_ENV, -12000) + getPresetDeltaI16(mergedPresetGens, GEN_RELEASE_VOL_ENV);

        const keynumToVolEnvHold =
          getInstI16(ig, GEN_KEYNUM_TO_VOL_ENV_HOLD, 0) +
          getPresetDeltaI16(mergedPresetGens, GEN_KEYNUM_TO_VOL_ENV_HOLD);
        const keynumToVolEnvDecay =
          getInstI16(ig, GEN_KEYNUM_TO_VOL_ENV_DECAY, 0) +
          getPresetDeltaI16(mergedPresetGens, GEN_KEYNUM_TO_VOL_ENV_DECAY);

        const fixedKeyRaw = getInstI16(ig, GEN_KEYNUM, -1);
        const fixedVelRaw = getInstI16(ig, GEN_VELOCITY, -1);
        const exclusiveClass = Math.max(0, getInstI16(ig, GEN_EXCLUSIVE_CLASS, 0));

        zones.push({
          keyRangeLow,
          keyRangeHigh,
          velRangeLow,
          velRangeHigh,
          originalPitch,
          pitchCorrection: sample.pitchCorrection,
          coarseTune,
          fineTune,
          scaleTuning,
          sampleRate,
          loopStart: loopStartSec,
          loopEnd: loopEndSec,
          loopMode,
          pan,
          attenuationDb,
          filterCutoffHz,
          filterQDb,
          exclusiveClass,
          fixedKey: fixedKeyRaw >= 0 && fixedKeyRaw <= 127 ? fixedKeyRaw : null,
          fixedVelocity: fixedVelRaw >= 0 && fixedVelRaw <= 127 ? fixedVelRaw : null,
          keynumToVolEnvHold,
          keynumToVolEnvDecay,
          ahdsr: {
            delay: timecentsToSeconds(delayTc, 0, 20),
            attack: timecentsToSeconds(attackTc, 0.002, 40),
            hold: timecentsToSeconds(holdTc, 0, 40),
            decay: timecentsToSeconds(decayTc, 0, 60),
            sustain: centibelsToGain(sustainCb),
            release: timecentsToSeconds(releaseTc, 0.015, 30)
          },
          sampleId: iz.sampleId,
          sampleStart,
          sampleEnd,
          sampleType: sample.sampleType
        });
      }
    }

    if (zones.length > 0) {
      presets.push({
        bank: ph.bank,
        program: ph.program,
        name: ph.name || `Patch ${String(ph.bank).padStart(3, '0')}:${String(ph.program).padStart(3, '0')}`,
        zones
      });
    }
  }

  if (presets.length === 0) {
    throw new Error('El archivo SoundFont no contiene ningún patch/preset reproducible.');
  }

  presets.sort((a, b) => a.bank - b.bank || a.program - b.program || a.name.localeCompare(b.name));

  return {
    format: hasCompressedSf3 ? 'sf3' : 'sf2',
    name: bankName || fallbackName,
    presets,
    smplData,
    sm24Data,
    smplRawBytes
  };
}

/**
 * Convierte de forma segura un objeto literal JS estilo surikov/webaudiofont a JSON válido sin usar eval().
 */
function parseWebAudioFontTextToObject(text: string): { varName?: string; data: any } {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('El archivo WebAudioFont está vacío.');
  }

  // Caso 1: JSON puro
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { data: JSON.parse(trimmed) };
    } catch {
      // Continuar con normalizador de objeto JS
    }
  }

  // Extraer nombre de variable si es formato: var _tone_0000_GeneralUserGS_sf2_file = { ... };
  const varMatch = trimmed.match(/(?:var|let|const|window\.)\s*([A-Za-z0-9_$]+)\s*=\s*/);
  const varName = varMatch ? varMatch[1] : undefined;

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No se encontró un objeto preset válido con zonas en el archivo WebAudioFont.');
  }

  let body = trimmed.slice(firstBrace, lastBrace + 1);

  // Intentar parseo JSON directo primero
  try {
    return { varName, data: JSON.parse(body) };
  } catch {
    // Normalizar sintaxis JS de archivos surikov/webaudiofontdata (claves sin comillas, comillas simples, comas finales)
  }

  // Reemplazar cadenas con comillas simples por comillas dobles preservando contenido base64/escape
  let out = '';
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      out += ch;
    } else if (inSingle) {
      if (ch === "'") {
        inSingle = false;
        out += '"';
      } else if (ch === '"') {
        out += '\\"';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') {
        inDouble = true;
        out += ch;
      } else if (ch === "'") {
        inSingle = true;
        out += '"';
      } else {
        out += ch;
      }
    }
  }

  // Eliminar comentarios // y /* */ fuera de cadenas
  // (los archivos webaudiofontdata no contienen // dentro de base64 salvo URLs, pero preservamos cadenas)
  let cleaned = '';
  inDouble = false;
  escaped = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (escaped) {
      cleaned += ch;
      escaped = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inDouble = false;
      cleaned += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      cleaned += ch;
      continue;
    }
    if (ch === '/' && out[i + 1] === '/') {
      while (i < out.length && out[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && out[i + 1] === '*') {
      i += 2;
      while (i < out.length && !(out[i] === '*' && out[i + 1] === '/')) i++;
      i++;
      continue;
    }
    cleaned += ch;
  }

  // Envolver identificadores de claves JS sin comillas en comillas dobles (fuera de strings)
  let jsonReady = '';
  inDouble = false;
  escaped = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      jsonReady += ch;
      escaped = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inDouble = false;
      jsonReady += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      jsonReady += ch;
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$') {
      let j = i;
      while (
        j < cleaned.length &&
        ((cleaned[j] >= 'a' && cleaned[j] <= 'z') ||
          (cleaned[j] >= 'A' && cleaned[j] <= 'Z') ||
          (cleaned[j] >= '0' && cleaned[j] <= '9') ||
          cleaned[j] === '_' ||
          cleaned[j] === '$')
      ) {
        j++;
      }
      const ident = cleaned.slice(i, j);
      let k = j;
      while (k < cleaned.length && (cleaned[k] === ' ' || cleaned[k] === '\t' || cleaned[k] === '\r' || cleaned[k] === '\n')) {
        k++;
      }
      if (cleaned[k] === ':') {
        jsonReady += `"${ident}"`;
      } else {
        jsonReady += ident;
      }
      i = j - 1;
      continue;
    }
    jsonReady += ch;
  }

  // Eliminar comas finales antes de } o ]
  jsonReady = jsonReady.replace(/,\s*([}\]])/g, '$1');

  // Soportar expresiones numéricas simples usadas en docs de webaudiofont (ej. 60*100 o 12*4)
  jsonReady = jsonReady.replace(/:\s*(\d+)\s*\*\s*(\d+)/g, (_m, a, b) => `:${Number(a) * Number(b)}`);

  try {
    return { varName, data: JSON.parse(jsonReady) };
  } catch (err) {
    throw new Error(`No se pudo leer el archivo WebAudioFont (.js/.json): ${(err as Error).message}`);
  }
}

function buildPresetFromWebAudioFontObj(
  obj: any,
  defaultName: string,
  defaultProgram = 0,
  defaultBank = 0
): ParsedSoundFontPreset | null {
  if (!obj || !Array.isArray(obj.zones) || obj.zones.length === 0) {
    return null;
  }

  const zones: SoundFontZone[] = [];
  for (let idx = 0; idx < obj.zones.length; idx++) {
    const z = obj.zones[idx];
    if (!z || typeof z !== 'object') continue;
    const encodedFile = typeof z.file === 'string' && z.file.length > 0 ? z.file : undefined;
    const encodedSample = typeof z.sample === 'string' && z.sample.length > 0 ? z.sample : undefined;
    if (!encodedFile && !encodedSample) continue;

    const rawOrigPitch = typeof z.originalPitch === 'number' ? z.originalPitch : 6000;
    // En surikov/webaudiofont originalPitch suele estar en cents (ej. 6000 = C4); si <= 127 tratar como MIDI
    const originalPitch = rawOrigPitch > 127 ? rawOrigPitch / 100 : rawOrigPitch;
    const sampleRate = typeof z.sampleRate === 'number' && z.sampleRate > 0 ? z.sampleRate : 44100;
    const rawLoopStart = typeof z.loopStart === 'number' ? z.loopStart : 0;
    const rawLoopEnd = typeof z.loopEnd === 'number' ? z.loopEnd : 0;
    const hasLoop = rawLoopEnd > rawLoopStart && rawLoopEnd > 0;

    let wafAhdsrCurve: WebAudioFontEnvelopePoint[] | false | undefined;
    if (Array.isArray(z.ahdsr)) {
      wafAhdsrCurve = z.ahdsr
        .filter((pt: any) => pt && typeof pt.duration === 'number' && typeof pt.volume === 'number')
        .map((pt: any) => ({ duration: pt.duration, volume: pt.volume }));
    } else if (z.ahdsr === false) {
      wafAhdsrCurve = false;
    }

    zones.push({
      keyRangeLow: typeof z.keyRangeLow === 'number' ? Math.max(0, Math.min(127, z.keyRangeLow)) : 0,
      keyRangeHigh: typeof z.keyRangeHigh === 'number' ? Math.max(0, Math.min(127, z.keyRangeHigh)) : 127,
      velRangeLow: typeof z.velRangeLow === 'number' ? Math.max(0, Math.min(127, z.velRangeLow)) : 0,
      velRangeHigh: typeof z.velRangeHigh === 'number' ? Math.max(0, Math.min(127, z.velRangeHigh)) : 127,
      originalPitch,
      pitchCorrection: 0,
      coarseTune: typeof z.coarseTune === 'number' ? z.coarseTune : 0,
      fineTune: typeof z.fineTune === 'number' ? z.fineTune : 0,
      scaleTuning: typeof z.scaleTuning === 'number' ? z.scaleTuning : 100,
      sampleRate,
      loopStart: rawLoopStart,
      loopEnd: rawLoopEnd,
      loopMode: hasLoop ? 1 : 0,
      pan: typeof z.pan === 'number' ? Math.max(-1, Math.min(1, z.pan)) : 0,
      attenuationDb: 0,
      filterCutoffHz: null,
      filterQDb: 0,
      exclusiveClass: 0,
      fixedKey: null,
      fixedVelocity: null,
      keynumToVolEnvHold: 0,
      keynumToVolEnvDecay: 0,
      ahdsr: {
        delay: 0,
        attack: 0.004,
        hold: 0,
        decay: 0.1,
        sustain: 1.0,
        release: 0.18
      },
      wafAhdsrCurve,
      sampleId: idx,
      sampleStart: 0,
      sampleEnd: 0,
      sampleType: 1,
      encodedFileBase64: encodedFile,
      encodedSampleBase64: encodedSample,
      wafLoopRaw: true
    });
  }

  if (zones.length === 0) return null;

  const firstMidi = typeof obj.zones[0]?.midi === 'number' ? obj.zones[0].midi : defaultProgram;
  return {
    bank: typeof obj.bank === 'number' ? obj.bank : defaultBank,
    program: Math.max(0, Math.min(127, Math.floor(firstMidi))),
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : defaultName,
    zones
  };
}

/**
 * Parsea un archivo WebAudioFont (.js o .json) compatible con surikov/webaudiofont.
 */
export function parseWebAudioFontBytes(bytes: Uint8Array, fileName = 'WebAudioFont'): ParsedSoundFont {
  const decoder = new TextDecoder('utf-8');
  const text = decoder.decode(bytes);
  const { varName, data } = parseWebAudioFontTextToObject(text);

  const cleanBase = fileName.replace(/\.[^/.]+$/, '').trim() || 'WebAudioFont';
  const prettyName = varName
    ? varName.replace(/^_(?:tone|drum)_/i, '').replace(/_sf2_file$/i, '').replace(/_/g, ' ').trim() || cleanBase
    : cleanBase;

  const presets: ParsedSoundFontPreset[] = [];

  if (Array.isArray(data?.presets)) {
    for (let i = 0; i < data.presets.length; i++) {
      const p = buildPresetFromWebAudioFontObj(data.presets[i], `${prettyName} #${i + 1}`, i % 128, Math.floor(i / 128));
      if (p) presets.push(p);
    }
  } else {
    const isDrum = Boolean(varName && /^_drum_/i.test(varName));
    const single = buildPresetFromWebAudioFontObj(data, prettyName, 0, isDrum ? 128 : 0);
    if (single) presets.push(single);
  }

  if (presets.length === 0) {
    throw new Error('El archivo WebAudioFont no contiene zonas de audio válidas.');
  }

  return {
    format: 'webaudiofont',
    name: typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : prettyName,
    presets
  };
}

/**
 * Punto de entrada unificado: detecta automáticamente SF2/SF3 binario o WebAudioFont .js/.json.
 */
export function parseSoundFontBytes(bytes: Uint8Array, fileName: string): ParsedSoundFont {
  const cleanName = fileName.replace(/\.[^/.]+$/, '').trim() || 'SoundFont';
  if (isSf2Binary(bytes)) {
    return parseSF2Bytes(bytes, cleanName);
  }
  return parseWebAudioFontBytes(bytes, fileName);
}

export function formatPatchNumber(bank: number, program: number): string {
  return `${String(bank).padStart(3, '0')}:${String(program).padStart(3, '0')}`;
}
