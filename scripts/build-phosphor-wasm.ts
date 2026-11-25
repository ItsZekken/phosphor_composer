/**
 * scripts/build-phosphor-wasm.ts
 * Compila el kernel WebAssembly completo de Phosphor Synth + Stereo FX Integrado
 * (Osciladores PolyBLEP, Sub, Ruido Blanco/Rosa, Filtro SVF 2/4 polos por voz,
 *  Envolventes T60 Amp+Filtro, LFO, Drive, EQ 4-bandas, DC Blocker, Soft Limiter,
 *  Stereo Chorus, Damped Feedback Delay y Stereo Jezar Freeverb).
 *
 * Emite:
 *  - public/worklets/phosphor-dsp.wasm
 *  - src/core/audio/wasm/phosphorDspWasmBytes.ts
 */

import fs from 'fs';
import path from 'path';
import {
  VAL_I32,
  VAL_F32,
  BLK_VOID,
  BLK_F32,
  FnBuilder,
  WasmModuleBuilder
} from './wasm-builder';
import {
  WASM_MAX_VOICES,
  WASM_MEMORY_PAGES,
  CHORUS_BUF_MASK,
  DELAY_BUF_MASK,
  REV_COMB_STRIDE_BYTES,
  REV_AP_STRIDE_BYTES,
  ENV_IDLE,
  ENV_PENDING,
  ENV_ATTACK,
  ENV_DECAY,
  ENV_SUSTAIN,
  ENV_RELEASE,
  M_SAMPLE_RATE,
  M_DT_BASE,
  M_CURRENT_SAMPLE,
  M_AGE_COUNTER,
  M_RNG_STATE,
  M_LFO_PHASE,
  M_LFO_RAND_VAL,
  M_DC_IN_L,
  M_DC_OUT_L,
  M_DC_IN_R,
  M_DC_OUT_R,
  M_FX_TAIL_SILENT,
  M_OSC1_WAVE_CODE,
  M_OSC1_VOL,
  M_OSC1_PITCH_FACTOR,
  M_OSC2_ENABLED,
  M_OSC2_WAVE_CODE,
  M_OSC2_VOL,
  M_OSC2_PITCH_FACTOR,
  M_SUB_ENABLED,
  M_SUB_WAVE_CODE,
  M_SUB_VOL,
  M_SUB_PITCH_FACTOR,
  M_NOISE_ENABLED,
  M_NOISE_TYPE_CODE,
  M_NOISE_VOL,
  M_OSC_NORM,
  M_FILTER_ENABLED,
  M_FILTER_TYPE_CODE,
  M_FILTER_FREQ,
  M_FILTER_Q,
  M_FILTER_FOUR_POLE,
  M_FILTER_DRIVE_ACTIVE,
  M_FILTER_DRIVE_TYPE,
  M_FILTER_ENV_AMT,
  M_FILTER_KEY_TRACK,
  M_GLIDE_FACTOR,
  M_ATTACK_STEP,
  M_DECAY_FACTOR,
  M_SUSTAIN,
  M_RELEASE_FACTOR,
  M_F_ATTACK_STEP,
  M_F_DECAY_FACTOR,
  M_F_SUSTAIN,
  M_F_RELEASE_FACTOR,
  M_LFO_ENABLED,
  M_LFO_WAVE_CODE,
  M_LFO_STEP,
  M_LFO_DEPTH,
  M_LFO_TARGET_CODE,
  M_GAIN_L,
  M_GAIN_R,
  M_EQ_ENABLED,
  M_HAS_GLIDE,
  M_DRIVE_PRE_GAIN,
  M_DRIVE_POST_COMP,
  M_DRY_BASS_ANCHOR,
  M_WET_SAT_MIX,
  M_EQ_BYPASS,
  M_EQ_B0,
  M_EQ_B1,
  M_EQ_B2,
  M_EQ_A1,
  M_EQ_A2,
  M_EQ_L1,
  M_EQ_L2,
  M_EQ_R1,
  M_EQ_R2,
  M_FX_CHORUS_ENABLED,
  M_FX_CHORUS_RATE,
  M_FX_CHORUS_DEPTH,
  M_FX_CHORUS_MIX,
  M_FX_CHORUS_PHASE,
  M_FX_CHORUS_WRITE,
  M_FX_DELAY_ENABLED,
  M_FX_DELAY_SAMPLES,
  M_FX_DELAY_FEEDBACK,
  M_FX_DELAY_MIX,
  M_FX_DELAY_DAMP,
  M_FX_DELAY_LP_L,
  M_FX_DELAY_LP_R,
  M_FX_DELAY_WRITE,
  M_FX_REV_ENABLED,
  M_FX_REV_ROOM,
  M_FX_REV_DAMP1,
  M_FX_REV_DAMP2,
  M_FX_REV_MIX,
  M_FX_SILENT_BLOCKS,
  M_FX_REV_COMB_LEN,
  M_FX_REV_COMB_IDX,
  M_FX_REV_COMB_STORE,
  M_FX_REV_AP_LEN,
  M_FX_REV_AP_IDX,
  V_ACTIVE,
  V_MIDI,
  V_ENV_STAGE,
  V_FENV_STAGE,
  V_AGE,
  V_START_SAMPLE,
  V_REL_SAMPLE,
  V_F_DIRTY,
  V_FREQ,
  V_TARGET_FREQ,
  V_VEL,
  V_VEL_GAIN,
  V_PHASE1,
  V_PHASE2,
  V_PHASE_SUB,
  V_ENV_LEVEL,
  V_FENV_LEVEL,
  V_IC1,
  V_IC2,
  V_IC3,
  V_IC4,
  V_PAN_L,
  V_PAN_R,
  V_A1,
  V_A2,
  V_A3,
  V_A1_2,
  V_A2_2,
  V_A3_2,
  V_B0,
  V_B1,
  V_B2,
  M_OUT_L,
  M_OUT_R,
  M_LFO_BUF,
  M_CHORUS_BUF_L,
  M_CHORUS_BUF_R,
  M_DELAY_BUF_L,
  M_DELAY_BUF_R,
  M_REV_COMB_BUF,
  M_REV_AP_BUF
} from '../src/core/audio/wasm/phosphorMemoryLayout';

const COMB_TUNINGS_L = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const AP_TUNINGS_L = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

function buildPhosphorWasmBinary(): Uint8Array {
  const mod = new WasmModuleBuilder(WASM_MEMORY_PAGES);

  // =========================================================================
  // 1. fast_sin01(p: f32) -> f32
  // =========================================================================
  const fnSin = mod.addFunction('fast_sin01', [VAL_F32], [VAL_F32]);
  {
    const t = fnSin.addLocal(VAL_F32);
    const u = fnSin.addLocal(VAL_F32);
    const u2 = fnSin.addLocal(VAL_F32);
    fnSin.localGet(0).localGet(0).f32Floor().f32Sub().localSet(t);
    fnSin.localGet(t).f32Const(0.75).f32Gt().ifBlock(
      BLK_VOID,
      () => { fnSin.localGet(t).f32Const(1.0).f32Sub().localSet(t); },
      () => {
        fnSin.localGet(t).f32Const(0.25).f32Gt().ifBlock(BLK_VOID, () => {
          fnSin.f32Const(0.5).localGet(t).f32Sub().localSet(t);
        });
      }
    );
    fnSin.localGet(t).f32Const(6.283185307179586).f32Mul().localTee(u).localGet(u).f32Mul().localSet(u2);
    fnSin
      .localGet(u)
      .f32Const(1.0)
      .localGet(u2)
      .f32Const(-0.16666667)
      .localGet(u2)
      .f32Const(0.0083333338)
      .localGet(u2)
      .f32Const(-0.0001984127)
      .localGet(u2)
      .f32Const(2.7557319e-6)
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul();
  }

  // =========================================================================
  // 2. fast_exp2(x: f32) -> f32
  // =========================================================================
  const fnExp2 = mod.addFunction('fast_exp2', [VAL_F32], [VAL_F32]);
  {
    const xc = fnExp2.addLocal(VAL_F32);
    const fl = fnExp2.addLocal(VAL_F32);
    const f = fnExp2.addLocal(VAL_F32);
    const n = fnExp2.addLocal(VAL_I32);
    const pow2n = fnExp2.addLocal(VAL_F32);

    fnExp2.localGet(0).f32Const(16.0).f32Min().f32Const(-24.0).f32Max().localTee(xc);
    fnExp2.f32Floor().localTee(fl).i32TruncF32S().localSet(n);
    fnExp2.localGet(xc).localGet(fl).f32Sub().localSet(f);
    fnExp2.localGet(n).i32Const(127).i32Add().i32Const(23).i32Shl().f32ReinterpretI32().localSet(pow2n);

    fnExp2
      .localGet(pow2n)
      .f32Const(1.0)
      .localGet(f)
      .f32Const(0.69314718)
      .localGet(f)
      .f32Const(0.24022651)
      .localGet(f)
      .f32Const(0.05550411)
      .localGet(f)
      .f32Const(0.00961813)
      .localGet(f)
      .f32Const(0.001333355)
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul();
  }

  // =========================================================================
  // 3. fast_tan(x: f32) -> f32
  // =========================================================================
  const fnTan = mod.addFunction('fast_tan', [VAL_F32], [VAL_F32]);
  {
    const xc = fnTan.addLocal(VAL_F32);
    const x2 = fnTan.addLocal(VAL_F32);
    const x4 = fnTan.addLocal(VAL_F32);
    fnTan.localGet(0).f32Const(1.36).f32Min().f32Const(0.0).f32Max().localTee(xc);
    fnTan.localGet(xc).f32Mul().localTee(x2).localGet(x2).f32Mul().localSet(x4);

    fnTan.localGet(xc);
    fnTan.f32Const(945.0).f32Const(105.0).localGet(x2).f32Mul().f32Sub().localGet(x4).f32Add().f32Mul();
    fnTan.f32Const(945.0).f32Const(420.0).localGet(x2).f32Mul().f32Sub().f32Const(15.0).localGet(x4).f32Mul().f32Add();
    fnTan.f32Div();
  }

  // =========================================================================
  // 4. fast_tanh(x: f32) -> f32
  // =========================================================================
  const fnTanh = mod.addFunction('fast_tanh', [VAL_F32], [VAL_F32]);
  {
    const xc = fnTanh.addLocal(VAL_F32);
    const x2 = fnTanh.addLocal(VAL_F32);
    fnTanh.localGet(0).f32Const(3.0).f32Min().f32Const(-3.0).f32Max().localTee(xc);
    fnTanh.localGet(xc).f32Mul().localSet(x2);
    fnTanh.localGet(xc).f32Const(27.0).localGet(x2).f32Add().f32Mul();
    fnTanh.f32Const(27.0).f32Const(9.0).localGet(x2).f32Mul().f32Add();
    fnTanh.f32Div();
  }

  // =========================================================================
  // 5. fast_pow_vel135(vel: f32) -> f32
  // =========================================================================
  const fnPowVel = mod.addFunction('fast_pow_vel135', [VAL_F32], [VAL_F32]);
  {
    const v = fnPowVel.addLocal(VAL_F32);
    const bits = fnPowVel.addLocal(VAL_I32);
    const exp = fnPowVel.addLocal(VAL_F32);
    const m = fnPowVel.addLocal(VAL_F32);

    fnPowVel.localGet(0).f32Const(1.0).f32Min().f32Const(0.05).f32Max().localSet(v);
    fnPowVel.localGet(v).i32ReinterpretF32().localTee(bits);
    fnPowVel.i32Const(23).i32ShrU().i32Const(0xff).i32And().i32Const(127).i32Sub().f32ConvertI32S().localSet(exp);
    fnPowVel.localGet(bits).i32Const(0x007fffff).i32And().i32Const(0x3f800000).i32Or().f32ReinterpretI32().f32Const(1.0).f32Sub().localSet(m);
    fnPowVel.localGet(exp);
    fnPowVel.localGet(m)
      .f32Const(1.44261)
      .localGet(m)
      .f32Const(-0.71968)
      .localGet(m)
      .f32Const(0.45988)
      .localGet(m)
      .f32Const(-0.25641)
      .localGet(m)
      .f32Const(0.07360)
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul().f32Add()
      .f32Mul();
    fnPowVel.f32Add().f32Const(1.35).f32Mul().callFn(fnExp2);
  }

  // =========================================================================
  // 6. rand_bipolar() -> f32
  // =========================================================================
  const fnRand = mod.addFunction('rand_bipolar', [], [VAL_F32]);
  {
    const s = fnRand.addLocal(VAL_I32);
    fnRand.loadI32At(M_RNG_STATE).localTee(s);
    fnRand.localGet(s).i32Const(13).i32Shl().i32Xor().localTee(s);
    fnRand.localGet(s).i32Const(17).i32ShrU().i32Xor().localTee(s);
    fnRand.localGet(s).i32Const(5).i32Shl().i32Xor().localSet(s);
    fnRand.storeI32At(M_RNG_STATE, () => fnRand.localGet(s));
    fnRand.localGet(s).i32Const(8).i32ShrS().f32ConvertI32S().f32Const(1.0 / 8388608.0).f32Mul();
  }

  // =========================================================================
  // 7. poly_blep(t: f32, dt: f32) -> f32
  // =========================================================================
  const fnBlep = mod.addFunction('poly_blep', [VAL_F32, VAL_F32], [VAL_F32]);
  {
    const v = fnBlep.addLocal(VAL_F32);
    fnBlep.localGet(1).f32Const(1e-6).f32Le().ifBlock(BLK_VOID, () => {
      fnBlep.f32Const(0.0).ret();
    });
    fnBlep.localGet(0).localGet(1).f32Lt().ifBlock(BLK_F32,
      () => {
        fnBlep.localGet(0).localGet(1).f32Div().localTee(v);
        fnBlep.localGet(v).f32Add().localGet(v).localGet(v).f32Mul().f32Sub().f32Const(1.0).f32Sub();
      },
      () => {
        fnBlep.localGet(0).f32Const(1.0).localGet(1).f32Sub().f32Gt().ifBlock(BLK_F32,
          () => {
            fnBlep.localGet(0).f32Const(1.0).f32Sub().localGet(1).f32Div().localTee(v);
            fnBlep.localGet(v).f32Mul().localGet(v).f32Add().localGet(v).f32Add().f32Const(1.0).f32Add();
          },
          () => { fnBlep.f32Const(0.0); }
        );
      }
    );
  }

  // =========================================================================
  // 8. sample_osc(waveCode: i32, phase: f32, dt: f32) -> f32
  // =========================================================================
  const fnOsc = mod.addFunction('sample_osc', [VAL_I32, VAL_F32, VAL_F32], [VAL_F32]);
  {
    const pHalf = fnOsc.addLocal(VAL_F32);
    const raw = fnOsc.addLocal(VAL_F32);

    fnOsc.localGet(0).i32Eqz().ifBlock(BLK_VOID, () => {
      fnOsc.localGet(1).callFn(fnSin).ret();
    });
    fnOsc.localGet(0).i32Const(1).i32Eq().ifBlock(BLK_VOID, () => {
      fnOsc.f32Const(2.0).localGet(1).f32Mul().f32Const(1.0).f32Sub();
      fnOsc.localGet(1).localGet(2).callFn(fnBlep).f32Sub().ret();
    });
    fnOsc.localGet(0).i32Const(2).i32Eq().ifBlock(BLK_VOID, () => {
      fnOsc.localGet(1).f32Const(0.5).f32Lt();
      fnOsc.ifBlock(BLK_F32, () => fnOsc.f32Const(1.0), () => fnOsc.f32Const(-1.0)).localSet(raw);
      fnOsc.localGet(1).f32Const(0.5).f32Add().localTee(pHalf);
      fnOsc.f32Const(1.0).f32Ge().ifBlock(BLK_VOID, () => {
        fnOsc.localGet(pHalf).f32Const(1.0).f32Sub().localSet(pHalf);
      });
      fnOsc.localGet(raw);
      fnOsc.localGet(1).localGet(2).callFn(fnBlep).f32Add();
      fnOsc.localGet(pHalf).localGet(2).callFn(fnBlep).f32Sub().ret();
    });
    fnOsc.localGet(0).i32Const(3).i32Eq().ifBlock(BLK_VOID, () => {
      fnOsc.localGet(1).f32Const(0.5).f32Lt().ifBlock(BLK_F32,
        () => fnOsc.f32Const(4.0).localGet(1).f32Mul().f32Const(1.0).f32Sub(),
        () => fnOsc.f32Const(3.0).f32Const(4.0).localGet(1).f32Mul().f32Sub()
      ).ret();
    });
    fnOsc.f32Const(0.0);
  }

  // =========================================================================
  // 9. EXPORTED init(sampleRate: f32)
  // =========================================================================
  const fnInit = mod.addFunction('init', [VAL_F32], [], 'init');
  {
    const sr = fnInit.addLocal(VAL_F32);
    const srScale = fnInit.addLocal(VAL_F32);
    const i = fnInit.addLocal(VAL_I32);
    const len = fnInit.addLocal(VAL_I32);

    fnInit.localGet(0).f32Const(44100.0);
    fnInit.localGet(0).f32Const(1000.0).f32Gt().select().localSet(sr);

    fnInit.storeF32At(M_SAMPLE_RATE, () => fnInit.localGet(sr));
    fnInit.storeF32At(M_DT_BASE, () => fnInit.f32Const(1.0).localGet(sr).f32Div());
    fnInit.storeI32At(M_RNG_STATE, () => fnInit.i32Const(0x12345678));
    fnInit.storeI32At(M_FX_TAIL_SILENT, () => fnInit.i32Const(1));
    fnInit.storeI32At(M_FX_SILENT_BLOCKS, () => fnInit.i32Const(0));

    fnInit.localGet(sr).f32Const(44100.0).f32Div().localSet(srScale);
    for (let c = 0; c < 8; c++) {
      fnInit.i32Const(c * 4);
      fnInit.f32Const(COMB_TUNINGS_L[c]).localGet(srScale).f32Mul().i32TruncF32S().localSet(len);
      fnInit.i32Const(2040).localGet(len).localGet(len).i32Const(2040).i32GtS().select();
      fnInit.i32Store(M_FX_REV_COMB_LEN, 2);

      fnInit.i32Const((c + 8) * 4);
      fnInit.f32Const(COMB_TUNINGS_L[c] + STEREO_SPREAD).localGet(srScale).f32Mul().i32TruncF32S().localSet(len);
      fnInit.i32Const(2040).localGet(len).localGet(len).i32Const(2040).i32GtS().select();
      fnInit.i32Store(M_FX_REV_COMB_LEN, 2);
    }
    for (let a = 0; a < 4; a++) {
      fnInit.i32Const(a * 4);
      fnInit.f32Const(AP_TUNINGS_L[a]).localGet(srScale).f32Mul().i32TruncF32S().localSet(len);
      fnInit.i32Const(1020).localGet(len).localGet(len).i32Const(1020).i32GtS().select();
      fnInit.i32Store(M_FX_REV_AP_LEN, 2);

      fnInit.i32Const((a + 4) * 4);
      fnInit.f32Const(AP_TUNINGS_L[a] + STEREO_SPREAD).localGet(srScale).f32Mul().i32TruncF32S().localSet(len);
      fnInit.i32Const(1020).localGet(len).localGet(len).i32Const(1020).i32GtS().select();
      fnInit.i32Store(M_FX_REV_AP_LEN, 2);
    }

    fnInit.forLoop(i, () => fnInit.i32Const(WASM_MAX_VOICES), () => {
      fnInit.storeI32Idx(V_ACTIVE, () => fnInit.localGet(i), () => fnInit.i32Const(0));
      fnInit.storeI32Idx(V_ENV_STAGE, () => fnInit.localGet(i), () => fnInit.i32Const(ENV_IDLE));
      fnInit.storeI32Idx(V_FENV_STAGE, () => fnInit.localGet(i), () => fnInit.i32Const(ENV_IDLE));
      fnInit.storeI32Idx(V_F_DIRTY, () => fnInit.localGet(i), () => fnInit.i32Const(1));
    });
  }

  // =========================================================================
  // 10. EXPORTED noteOn(midi: i32, vel: f32, durSec: f32, delaySamples: i32)
  // =========================================================================
  const fnNoteOn = mod.addFunction('noteOn', [VAL_I32, VAL_F32, VAL_F32, VAL_I32], [], 'noteOn');
  {
    const midi = 0, vel = 1, durSec = 2, delaySamples = 3;
    const i = fnNoteOn.addLocal(VAL_I32);
    const vIdx = fnNoteOn.addLocal(VAL_I32);
    const oldestAge = fnNoteOn.addLocal(VAL_I32);
    const vAge = fnNoteOn.addLocal(VAL_I32);
    const wasIdle = fnNoteOn.addLocal(VAL_I32);
    const freq = fnNoteOn.addLocal(VAL_F32);
    const targetStart = fnNoteOn.addLocal(VAL_I32);
    const delayClamped = fnNoteOn.addLocal(VAL_I32);
    const ageNext = fnNoteOn.addLocal(VAL_I32);
    const tmpF = fnNoteOn.addLocal(VAL_F32);
    const sr = fnNoteOn.addLocal(VAL_F32);

    fnNoteOn.i32Const(-1).localSet(vIdx);
    fnNoteOn.block(BLK_VOID, () => {
      fnNoteOn.forLoop(i, () => fnNoteOn.i32Const(WASM_MAX_VOICES), () => {
        fnNoteOn.loadI32Idx(V_ACTIVE, () => fnNoteOn.localGet(i)).i32Eqz();
        fnNoteOn.loadI32Idx(V_ENV_STAGE, () => fnNoteOn.localGet(i)).i32Eqz().i32Or();
        fnNoteOn.ifBlock(BLK_VOID, () => {
          fnNoteOn.localGet(i).localSet(vIdx);
          fnNoteOn.br(2);
        });
      });
    });

    fnNoteOn.localGet(vIdx).i32Const(0).i32LtS().ifBlock(BLK_VOID, () => {
      fnNoteOn.i32Const(0x7fffffff).localSet(oldestAge);
      fnNoteOn.forLoop(i, () => fnNoteOn.i32Const(WASM_MAX_VOICES), () => {
        fnNoteOn.loadI32Idx(V_AGE, () => fnNoteOn.localGet(i)).localTee(vAge);
        fnNoteOn.localGet(oldestAge).i32LtS().ifBlock(BLK_VOID, () => {
          fnNoteOn.localGet(vAge).localSet(oldestAge);
          fnNoteOn.localGet(i).localSet(vIdx);
        });
      });
    });

    fnNoteOn.localGet(vIdx).i32Const(0).i32LtS().ifBlock(BLK_VOID, () => fnNoteOn.ret());

    fnNoteOn.storeI32At(M_FX_TAIL_SILENT, () => fnNoteOn.i32Const(0));
    fnNoteOn.storeI32At(M_FX_SILENT_BLOCKS, () => fnNoteOn.i32Const(0));

    fnNoteOn.loadI32Idx(V_ACTIVE, () => fnNoteOn.localGet(vIdx)).i32Eqz();
    fnNoteOn.loadI32Idx(V_ENV_STAGE, () => fnNoteOn.localGet(vIdx)).i32Eqz().i32Or().localSet(wasIdle);

    fnNoteOn.f32Const(440.0);
    fnNoteOn.localGet(midi).i32Const(69).i32Sub().f32ConvertI32S().f32Const(1.0 / 12.0).f32Mul().callFn(fnExp2);
    fnNoteOn.f32Mul().localSet(freq);

    fnNoteOn.localGet(delaySamples).i32Const(0);
    fnNoteOn.localGet(delaySamples).i32Const(0).i32GtS().select().localSet(delayClamped);
    fnNoteOn.loadI32At(M_CURRENT_SAMPLE).localGet(delayClamped).i32Add().localSet(targetStart);

    fnNoteOn.loadI32At(M_AGE_COUNTER).i32Const(1).i32Add().localSet(ageNext);
    fnNoteOn.storeI32At(M_AGE_COUNTER, () => fnNoteOn.localGet(ageNext));

    fnNoteOn.storeI32Idx(V_ACTIVE, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.i32Const(1));
    fnNoteOn.storeI32Idx(V_MIDI, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.localGet(midi));
    fnNoteOn.storeF32Idx(V_TARGET_FREQ, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.localGet(freq));

    fnNoteOn.loadI32At(M_HAS_GLIDE).i32Eqz();
    fnNoteOn.localGet(wasIdle).i32Or();
    fnNoteOn.loadF32Idx(V_FREQ, () => fnNoteOn.localGet(vIdx)).f32Const(0.0).f32Eq().i32Or();
    fnNoteOn.ifBlock(BLK_VOID, () => {
      fnNoteOn.storeF32Idx(V_FREQ, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.localGet(freq));
    });

    fnNoteOn.localGet(vel).f32Const(1.0).f32Min().f32Const(0.05).f32Max().localSet(tmpF);
    fnNoteOn.storeF32Idx(V_VEL, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.localGet(tmpF));
    fnNoteOn.storeF32Idx(V_VEL_GAIN, () => fnNoteOn.localGet(vIdx), () => {
      fnNoteOn.localGet(tmpF).callFn(fnPowVel).f32Const(0.56).f32Mul();
    });

    fnNoteOn.storeI32Idx(V_START_SAMPLE, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.localGet(targetStart));
    fnNoteOn.storeI32Idx(V_AGE, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.localGet(ageNext));

    fnNoteOn.localGet(ageNext).f32ConvertI32S().f32Const(0.61803398875).f32Mul().localTee(tmpF);
    fnNoteOn.localGet(tmpF).f32Floor().f32Sub().localSet(tmpF);
    fnNoteOn.storeF32Idx(V_PHASE1, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.localGet(tmpF));

    fnNoteOn.localGet(ageNext).f32ConvertI32S().f32Const(0.38196601125).f32Mul().f32Const(0.37).f32Add().localTee(tmpF);
    fnNoteOn.localGet(tmpF).f32Floor().f32Sub().localSet(tmpF);
    fnNoteOn.storeF32Idx(V_PHASE2, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.localGet(tmpF));

    fnNoteOn.storeF32Idx(V_PHASE_SUB, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));

    fnNoteOn.localGet(wasIdle).ifBlock(BLK_VOID, () => {
      fnNoteOn.storeF32Idx(V_ENV_LEVEL, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));
      fnNoteOn.storeF32Idx(V_FENV_LEVEL, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));
      fnNoteOn.storeF32Idx(V_IC1, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));
      fnNoteOn.storeF32Idx(V_IC2, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));
      fnNoteOn.storeF32Idx(V_IC3, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));
      fnNoteOn.storeF32Idx(V_IC4, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));
    });
    fnNoteOn.storeF32Idx(V_B0, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));
    fnNoteOn.storeF32Idx(V_B1, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));
    fnNoteOn.storeF32Idx(V_B2, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.0));

    fnNoteOn.localGet(delayClamped).i32Const(0).i32GtS().ifBlock(
      BLK_VOID,
      () => {
        fnNoteOn.storeI32Idx(V_ENV_STAGE, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.i32Const(ENV_PENDING));
        fnNoteOn.storeI32Idx(V_FENV_STAGE, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.i32Const(ENV_PENDING));
      },
      () => {
        fnNoteOn.storeI32Idx(V_ENV_STAGE, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.i32Const(ENV_ATTACK));
        fnNoteOn.storeI32Idx(V_FENV_STAGE, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.i32Const(ENV_ATTACK));
      }
    );
    fnNoteOn.storeI32Idx(V_F_DIRTY, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.i32Const(1));

    fnNoteOn.localGet(midi).i32Const(50).i32LtS().ifBlock(
      BLK_VOID,
      () => {
        fnNoteOn.storeF32Idx(V_PAN_L, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(1.0));
        fnNoteOn.storeF32Idx(V_PAN_R, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(1.0));
      },
      () => {
        fnNoteOn.localGet(vIdx).i32Const(1).i32And().i32Eqz().ifBlock(
          BLK_VOID,
          () => {
            fnNoteOn.storeF32Idx(V_PAN_L, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(1.103737));
            fnNoteOn.storeF32Idx(V_PAN_R, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.884182));
          },
          () => {
            fnNoteOn.storeF32Idx(V_PAN_L, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(0.884182));
            fnNoteOn.storeF32Idx(V_PAN_R, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.f32Const(1.103737));
          }
        );
      }
    );

    fnNoteOn.loadF32At(M_SAMPLE_RATE).localSet(sr);
    fnNoteOn.localGet(durSec).f32Const(0.0).f32Gt().ifBlock(
      BLK_VOID,
      () => {
        fnNoteOn.storeI32Idx(V_REL_SAMPLE, () => fnNoteOn.localGet(vIdx), () => {
          fnNoteOn.localGet(targetStart).localGet(durSec).localGet(sr).f32Mul().i32TruncF32S().i32Add();
        });
      },
      () => {
        fnNoteOn.storeI32Idx(V_REL_SAMPLE, () => fnNoteOn.localGet(vIdx), () => fnNoteOn.i32Const(-1));
      }
    );
  }

  // =========================================================================
  // 11. EXPORTED noteOff(midi, delaySamples) & allNotesOff(delaySamples)
  // =========================================================================
  const fnNoteOff = mod.addFunction('noteOff', [VAL_I32, VAL_I32], [], 'noteOff');
  {
    const i = fnNoteOff.addLocal(VAL_I32);
    const st = fnNoteOff.addLocal(VAL_I32);
    const relSample = fnNoteOff.addLocal(VAL_I32);
    fnNoteOff.loadI32At(M_CURRENT_SAMPLE);
    fnNoteOff.localGet(1).i32Const(0).localGet(1).i32Const(0).i32GtS().select();
    fnNoteOff.i32Add().localSet(relSample);

    fnNoteOff.forLoop(i, () => fnNoteOff.i32Const(WASM_MAX_VOICES), () => {
      fnNoteOff.loadI32Idx(V_ACTIVE, () => fnNoteOff.localGet(i)).ifBlock(BLK_VOID, () => {
        fnNoteOff.loadI32Idx(V_MIDI, () => fnNoteOff.localGet(i)).localGet(0).i32Eq().ifBlock(BLK_VOID, () => {
          fnNoteOff.loadI32Idx(V_ENV_STAGE, () => fnNoteOff.localGet(i)).localTee(st);
          fnNoteOff.i32Const(ENV_IDLE).i32Ne();
          fnNoteOff.localGet(st).i32Const(ENV_RELEASE).i32Ne().i32And();
          fnNoteOff.ifBlock(BLK_VOID, () => {
            fnNoteOff.localGet(1).i32Const(0).i32GtS().ifBlock(
              BLK_VOID,
              () => {
                fnNoteOff.storeI32Idx(V_REL_SAMPLE, () => fnNoteOff.localGet(i), () => fnNoteOff.localGet(relSample));
              },
              () => {
                fnNoteOff.storeI32Idx(V_ENV_STAGE, () => fnNoteOff.localGet(i), () => fnNoteOff.i32Const(ENV_RELEASE));
                fnNoteOff.storeI32Idx(V_FENV_STAGE, () => fnNoteOff.localGet(i), () => fnNoteOff.i32Const(ENV_RELEASE));
                fnNoteOff.storeI32Idx(V_REL_SAMPLE, () => fnNoteOff.localGet(i), () => fnNoteOff.i32Const(-1));
              }
            );
          });
        });
      });
    });
  }

  const fnAllNotesOff = mod.addFunction('allNotesOff', [VAL_I32], [], 'allNotesOff');
  {
    const i = fnAllNotesOff.addLocal(VAL_I32);
    const st = fnAllNotesOff.addLocal(VAL_I32);
    const relSample = fnAllNotesOff.addLocal(VAL_I32);
    fnAllNotesOff.loadI32At(M_CURRENT_SAMPLE);
    fnAllNotesOff.localGet(0).i32Const(0).localGet(0).i32Const(0).i32GtS().select();
    fnAllNotesOff.i32Add().localSet(relSample);

    fnAllNotesOff.forLoop(i, () => fnAllNotesOff.i32Const(WASM_MAX_VOICES), () => {
      fnAllNotesOff.loadI32Idx(V_ACTIVE, () => fnAllNotesOff.localGet(i)).ifBlock(BLK_VOID, () => {
        fnAllNotesOff.loadI32Idx(V_ENV_STAGE, () => fnAllNotesOff.localGet(i)).localTee(st);
        fnAllNotesOff.i32Const(ENV_IDLE).i32Ne();
        fnAllNotesOff.localGet(st).i32Const(ENV_RELEASE).i32Ne().i32And();
        fnAllNotesOff.ifBlock(BLK_VOID, () => {
          fnAllNotesOff.localGet(0).i32Const(0).i32GtS().ifBlock(
            BLK_VOID,
            () => {
              fnAllNotesOff.storeI32Idx(V_REL_SAMPLE, () => fnAllNotesOff.localGet(i), () => fnAllNotesOff.localGet(relSample));
            },
            () => {
              fnAllNotesOff.storeI32Idx(V_ENV_STAGE, () => fnAllNotesOff.localGet(i), () => fnAllNotesOff.i32Const(ENV_RELEASE));
              fnAllNotesOff.storeI32Idx(V_FENV_STAGE, () => fnAllNotesOff.localGet(i), () => fnAllNotesOff.i32Const(ENV_RELEASE));
              fnAllNotesOff.storeI32Idx(V_REL_SAMPLE, () => fnAllNotesOff.localGet(i), () => fnAllNotesOff.i32Const(-1));
            }
          );
        });
      });
    });
  }

  // =========================================================================
  // 12. Helper interno apply_fx(blockSize: i32) -> f32 (blockPeak)
  // =========================================================================
  const fnApplyFx = mod.addFunction('apply_fx', [VAL_I32], [VAL_F32]);
  {
    const blockSize = 0;
    const s = fnApplyFx.addLocal(VAL_I32);
    const inL = fnApplyFx.addLocal(VAL_F32);
    const inR = fnApplyFx.addLocal(VAL_F32);
    const sr = fnApplyFx.addLocal(VAL_F32);

    // Chorus locals
    const chorusEn = fnApplyFx.addLocal(VAL_I32);
    const cWrite = fnApplyFx.addLocal(VAL_I32);
    const cPhase = fnApplyFx.addLocal(VAL_F32);
    const cStep = fnApplyFx.addLocal(VAL_F32);
    const cDepth = fnApplyFx.addLocal(VAL_F32);
    const cMix = fnApplyFx.addLocal(VAL_F32);
    const cDry = fnApplyFx.addLocal(VAL_F32);
    const cCenter = fnApplyFx.addLocal(VAL_F32);
    const cSwing = fnApplyFx.addLocal(VAL_F32);
    const dPos = fnApplyFx.addLocal(VAL_F32);
    const i0 = fnApplyFx.addLocal(VAL_I32);
    const i1 = fnApplyFx.addLocal(VAL_I32);
    const frac = fnApplyFx.addLocal(VAL_F32);
    const tapL = fnApplyFx.addLocal(VAL_F32);
    const tapR = fnApplyFx.addLocal(VAL_F32);

    // Delay locals
    const delayEn = fnApplyFx.addLocal(VAL_I32);
    const dWrite = fnApplyFx.addLocal(VAL_I32);
    const dSam = fnApplyFx.addLocal(VAL_F32);
    const dFb = fnApplyFx.addLocal(VAL_F32);
    const dMix = fnApplyFx.addLocal(VAL_F32);
    const dDry = fnApplyFx.addLocal(VAL_F32);
    const d1mDamp = fnApplyFx.addLocal(VAL_F32);
    const lpL = fnApplyFx.addLocal(VAL_F32);
    const lpR = fnApplyFx.addLocal(VAL_F32);

    // Reverb locals
    const revEn = fnApplyFx.addLocal(VAL_I32);
    const rRoom = fnApplyFx.addLocal(VAL_F32);
    const rDamp1 = fnApplyFx.addLocal(VAL_F32);
    const rDamp2 = fnApplyFx.addLocal(VAL_F32);
    const rMix = fnApplyFx.addLocal(VAL_F32);
    const rDry = fnApplyFx.addLocal(VAL_F32);
    const rWetG = fnApplyFx.addLocal(VAL_F32);
    const rIn = fnApplyFx.addLocal(VAL_F32);
    const sumL = fnApplyFx.addLocal(VAL_F32);
    const sumR = fnApplyFx.addLocal(VAL_F32);
    const c = fnApplyFx.addLocal(VAL_I32);
    const cLen = fnApplyFx.addLocal(VAL_I32);
    const cIdx = fnApplyFx.addLocal(VAL_I32);
    const bufOut = fnApplyFx.addLocal(VAL_F32);
    const cStore = fnApplyFx.addLocal(VAL_F32);
    const cBase = fnApplyFx.addLocal(VAL_I32);
    const peak = fnApplyFx.addLocal(VAL_F32);

    fnApplyFx.loadF32At(M_SAMPLE_RATE).localSet(sr);

    // --- 1. Stereo Chorus ---
    fnApplyFx.loadI32At(M_FX_CHORUS_ENABLED).localTee(chorusEn).ifBlock(BLK_VOID, () => {
      fnApplyFx.loadI32At(M_FX_CHORUS_WRITE).localSet(cWrite);
      fnApplyFx.loadF32At(M_FX_CHORUS_PHASE).localSet(cPhase);
      fnApplyFx.loadF32At(M_FX_CHORUS_RATE).loadF32At(M_DT_BASE).f32Mul().localSet(cStep);
      fnApplyFx.loadF32At(M_FX_CHORUS_DEPTH).localSet(cDepth);
      fnApplyFx.loadF32At(M_FX_CHORUS_MIX).localSet(cMix);
      fnApplyFx.f32Const(1.0).localGet(cMix).f32Const(0.45).f32Mul().f32Sub().localSet(cDry);

      fnApplyFx.localGet(sr).f32Const(0.0065).f32Mul().localSet(cCenter);
      fnApplyFx.localGet(sr).f32Const(0.0040).f32Mul().localGet(cDepth).f32Mul().localSet(cSwing);

      fnApplyFx.forLoop(s, () => fnApplyFx.localGet(blockSize), () => {
        fnApplyFx.loadF32Idx(M_OUT_L, () => fnApplyFx.localGet(s)).localSet(inL);
        fnApplyFx.loadF32Idx(M_OUT_R, () => fnApplyFx.localGet(s)).localSet(inR);

        // Guardar en ring buffer
        fnApplyFx.storeF32Idx(M_CHORUS_BUF_L, () => fnApplyFx.localGet(cWrite), () => fnApplyFx.localGet(inL));
        fnApplyFx.storeF32Idx(M_CHORUS_BUF_R, () => fnApplyFx.localGet(cWrite), () => fnApplyFx.localGet(inR));

        // L modulated tap (cPhase)
        fnApplyFx.localGet(cCenter).localGet(cSwing).localGet(cPhase).callFn(fnSin).f32Mul().f32Add().localSet(dPos);
        fnApplyFx.localGet(dPos).f32Floor().localTee(frac).i32TruncF32S().localSet(i0);
        fnApplyFx.localGet(dPos).localGet(frac).f32Sub().localSet(frac);
        fnApplyFx.localGet(cWrite).localGet(i0).i32Sub().i32Const(CHORUS_BUF_MASK).i32And().localSet(i0);
        fnApplyFx.localGet(i0).i32Const(1).i32Sub().i32Const(CHORUS_BUF_MASK).i32And().localSet(i1);
        fnApplyFx.loadF32Idx(M_CHORUS_BUF_L, () => fnApplyFx.localGet(i0)).localSet(tapL);
        fnApplyFx.localGet(tapL);
        fnApplyFx.loadF32Idx(M_CHORUS_BUF_L, () => fnApplyFx.localGet(i1)).localGet(tapL).f32Sub().localGet(frac).f32Mul().f32Add().localSet(tapL);

        // R quadrature modulated tap (cPhase + 0.25)
        fnApplyFx.localGet(cCenter).localGet(cSwing).localGet(cPhase).f32Const(0.25).f32Add().callFn(fnSin).f32Mul().f32Add().localSet(dPos);
        fnApplyFx.localGet(dPos).f32Floor().localTee(frac).i32TruncF32S().localSet(i0);
        fnApplyFx.localGet(dPos).localGet(frac).f32Sub().localSet(frac);
        fnApplyFx.localGet(cWrite).localGet(i0).i32Sub().i32Const(CHORUS_BUF_MASK).i32And().localSet(i0);
        fnApplyFx.localGet(i0).i32Const(1).i32Sub().i32Const(CHORUS_BUF_MASK).i32And().localSet(i1);
        fnApplyFx.loadF32Idx(M_CHORUS_BUF_R, () => fnApplyFx.localGet(i0)).localSet(tapR);
        fnApplyFx.localGet(tapR);
        fnApplyFx.loadF32Idx(M_CHORUS_BUF_R, () => fnApplyFx.localGet(i1)).localGet(tapR).f32Sub().localGet(frac).f32Mul().f32Add().localSet(tapR);

        // Blend & write back
        fnApplyFx.storeF32Idx(M_OUT_L, () => fnApplyFx.localGet(s), () => {
          fnApplyFx.localGet(inL).localGet(cDry).f32Mul();
          fnApplyFx.localGet(tapL).localGet(cMix).f32Mul().f32Const(0.7).f32Mul().f32Add();
        });
        fnApplyFx.storeF32Idx(M_OUT_R, () => fnApplyFx.localGet(s), () => {
          fnApplyFx.localGet(inR).localGet(cDry).f32Mul();
          fnApplyFx.localGet(tapR).localGet(cMix).f32Mul().f32Const(0.7).f32Mul().f32Add();
        });

        // Advance phase & write index
        fnApplyFx.localGet(cPhase).localGet(cStep).f32Add().localTee(cPhase);
        fnApplyFx.f32Const(1.0).f32Ge().ifBlock(BLK_VOID, () => {
          fnApplyFx.localGet(cPhase).f32Const(1.0).f32Sub().localSet(cPhase);
        });
        fnApplyFx.localGet(cWrite).i32Const(1).i32Add().i32Const(CHORUS_BUF_MASK).i32And().localSet(cWrite);
      });

      fnApplyFx.storeI32At(M_FX_CHORUS_WRITE, () => fnApplyFx.localGet(cWrite));
      fnApplyFx.storeF32At(M_FX_CHORUS_PHASE, () => fnApplyFx.localGet(cPhase));
    });

    // --- 2. Stereo Damped Feedback Delay ---
    fnApplyFx.loadI32At(M_FX_DELAY_ENABLED).localTee(delayEn).ifBlock(BLK_VOID, () => {
      fnApplyFx.loadI32At(M_FX_DELAY_WRITE).localSet(dWrite);
      fnApplyFx.loadF32At(M_FX_DELAY_SAMPLES).f32Const(131000.0).f32Min().f32Const(64.0).f32Max().localSet(dSam);
      fnApplyFx.loadF32At(M_FX_DELAY_FEEDBACK).localSet(dFb);
      fnApplyFx.loadF32At(M_FX_DELAY_MIX).localSet(dMix);
      fnApplyFx.f32Const(1.0).localGet(dMix).f32Const(0.35).f32Mul().f32Sub().localSet(dDry);
      fnApplyFx.f32Const(1.0).loadF32At(M_FX_DELAY_DAMP).f32Sub().localSet(d1mDamp);
      fnApplyFx.loadF32At(M_FX_DELAY_LP_L).localSet(lpL);
      fnApplyFx.loadF32At(M_FX_DELAY_LP_R).localSet(lpR);

      // dSam fractional split (static delaySamples across block!)
      fnApplyFx.localGet(dSam).f32Floor().localTee(frac).i32TruncF32S().localSet(i0); // i0 holds integer delay
      fnApplyFx.localGet(dSam).localGet(frac).f32Sub().localSet(frac);

      fnApplyFx.forLoop(s, () => fnApplyFx.localGet(blockSize), () => {
        fnApplyFx.loadF32Idx(M_OUT_L, () => fnApplyFx.localGet(s)).localSet(inL);
        fnApplyFx.loadF32Idx(M_OUT_R, () => fnApplyFx.localGet(s)).localSet(inR);

        // Read indices for L and ping-pong/stereo R
        fnApplyFx.localGet(dWrite).localGet(i0).i32Sub().i32Const(DELAY_BUF_MASK).i32And().localSet(c);
        fnApplyFx.localGet(c).i32Const(1).i32Sub().i32Const(DELAY_BUF_MASK).i32And().localSet(i1);

        fnApplyFx.loadF32Idx(M_DELAY_BUF_L, () => fnApplyFx.localGet(c)).localSet(tapL);
        fnApplyFx.localGet(tapL);
        fnApplyFx.loadF32Idx(M_DELAY_BUF_L, () => fnApplyFx.localGet(i1)).localGet(tapL).f32Sub().localGet(frac).f32Mul().f32Add().localSet(tapL);

        fnApplyFx.loadF32Idx(M_DELAY_BUF_R, () => fnApplyFx.localGet(c)).localSet(tapR);
        fnApplyFx.localGet(tapR);
        fnApplyFx.loadF32Idx(M_DELAY_BUF_R, () => fnApplyFx.localGet(i1)).localGet(tapR).f32Sub().localGet(frac).f32Mul().f32Add().localSet(tapR);

        // Flush denormals
        fnApplyFx.localGet(tapL).f32Abs().f32Const(1e-15).f32Lt().ifBlock(BLK_VOID, () => fnApplyFx.f32Const(0.0).localSet(tapL));
        fnApplyFx.localGet(tapR).f32Abs().f32Const(1e-15).f32Lt().ifBlock(BLK_VOID, () => fnApplyFx.f32Const(0.0).localSet(tapR));

        // 1-pole feedback lowpass damping: lp = lp + (1 - damp) * (tap - lp)
        fnApplyFx.localGet(lpL).localGet(tapL).localGet(lpL).f32Sub().localGet(d1mDamp).f32Mul().f32Add().localSet(lpL);
        fnApplyFx.localGet(lpR).localGet(tapR).localGet(lpR).f32Sub().localGet(d1mDamp).f32Mul().f32Add().localSet(lpR);
        fnApplyFx.localGet(lpL).f32Abs().f32Const(1e-15).f32Lt().ifBlock(BLK_VOID, () => fnApplyFx.f32Const(0.0).localSet(lpL));
        fnApplyFx.localGet(lpR).f32Abs().f32Const(1e-15).f32Lt().ifBlock(BLK_VOID, () => fnApplyFx.f32Const(0.0).localSet(lpR));

        // Subtle cross-feed stereo depth in delay feedback + write
        fnApplyFx.storeF32Idx(M_DELAY_BUF_L, () => fnApplyFx.localGet(dWrite), () => {
          fnApplyFx.localGet(inL).localGet(lpL).f32Const(0.88).f32Mul().localGet(lpR).f32Const(0.12).f32Mul().f32Add().localGet(dFb).f32Mul().f32Add();
        });
        fnApplyFx.storeF32Idx(M_DELAY_BUF_R, () => fnApplyFx.localGet(dWrite), () => {
          fnApplyFx.localGet(inR).localGet(lpR).f32Const(0.88).f32Mul().localGet(lpL).f32Const(0.12).f32Mul().f32Add().localGet(dFb).f32Mul().f32Add();
        });

        fnApplyFx.storeF32Idx(M_OUT_L, () => fnApplyFx.localGet(s), () => {
          fnApplyFx.localGet(inL).localGet(dDry).f32Mul().localGet(tapL).localGet(dMix).f32Mul().f32Add();
        });
        fnApplyFx.storeF32Idx(M_OUT_R, () => fnApplyFx.localGet(s), () => {
          fnApplyFx.localGet(inR).localGet(dDry).f32Mul().localGet(tapR).localGet(dMix).f32Mul().f32Add();
        });

        fnApplyFx.localGet(dWrite).i32Const(1).i32Add().i32Const(DELAY_BUF_MASK).i32And().localSet(dWrite);
      });

      fnApplyFx.storeI32At(M_FX_DELAY_WRITE, () => fnApplyFx.localGet(dWrite));
      fnApplyFx.storeF32At(M_FX_DELAY_LP_L, () => fnApplyFx.localGet(lpL));
      fnApplyFx.storeF32At(M_FX_DELAY_LP_R, () => fnApplyFx.localGet(lpR));
    });

    // --- 3. Stereo Jezar Freeverb ---
    fnApplyFx.loadI32At(M_FX_REV_ENABLED).localTee(revEn).ifBlock(BLK_VOID, () => {
      fnApplyFx.loadF32At(M_FX_REV_ROOM).localSet(rRoom);
      fnApplyFx.loadF32At(M_FX_REV_DAMP1).localSet(rDamp1);
      fnApplyFx.loadF32At(M_FX_REV_DAMP2).localSet(rDamp2);
      fnApplyFx.loadF32At(M_FX_REV_MIX).localSet(rMix);
      fnApplyFx.f32Const(1.0).localGet(rMix).f32Const(0.45).f32Mul().f32Sub().localSet(rDry);
      fnApplyFx.localGet(rMix).f32Const(0.95).f32Mul().localSet(rWetG);

      fnApplyFx.forLoop(s, () => fnApplyFx.localGet(blockSize), () => {
        fnApplyFx.loadF32Idx(M_OUT_L, () => fnApplyFx.localGet(s)).localSet(inL);
        fnApplyFx.loadF32Idx(M_OUT_R, () => fnApplyFx.localGet(s)).localSet(inR);
        fnApplyFx.localGet(inL).localGet(inR).f32Add().f32Const(0.015).f32Mul().localSet(rIn);

        // 8 L combs + 8 R combs
        fnApplyFx.f32Const(0.0).localSet(sumL);
        fnApplyFx.f32Const(0.0).localSet(sumR);

        fnApplyFx.forLoop(c, () => fnApplyFx.i32Const(16), () => {
          fnApplyFx.loadI32Idx(M_FX_REV_COMB_LEN, () => fnApplyFx.localGet(c)).localSet(cLen);
          fnApplyFx.loadI32Idx(M_FX_REV_COMB_IDX, () => fnApplyFx.localGet(c)).localSet(cIdx);
          fnApplyFx.loadF32Idx(M_FX_REV_COMB_STORE, () => fnApplyFx.localGet(c)).localSet(cStore);
          fnApplyFx.i32Const(M_REV_COMB_BUF).localGet(c).i32Const(REV_COMB_STRIDE_BYTES).i32Mul().i32Add().localSet(cBase);

          // out = combBuf[cBase + cIdx * 4]
          fnApplyFx.localGet(cBase).localGet(cIdx).i32Const(2).i32Shl().i32Add().f32Load(0, 2).localSet(bufOut);
          fnApplyFx.localGet(bufOut).f32Abs().f32Const(1e-15).f32Lt().ifBlock(BLK_VOID, () => fnApplyFx.f32Const(0.0).localSet(bufOut));

          // accumulate into L (c < 8) or R (c >= 8)
          fnApplyFx.localGet(c).i32Const(8).i32LtS().ifBlock(
            BLK_VOID,
            () => { fnApplyFx.localGet(sumL).localGet(bufOut).f32Add().localSet(sumL); },
            () => { fnApplyFx.localGet(sumR).localGet(bufOut).f32Add().localSet(sumR); }
          );

          // cStore = bufOut * damp2 + cStore * damp1
          fnApplyFx.localGet(bufOut).localGet(rDamp2).f32Mul().localGet(cStore).localGet(rDamp1).f32Mul().f32Add().localSet(cStore);
          fnApplyFx.localGet(cStore).f32Abs().f32Const(1e-15).f32Lt().ifBlock(BLK_VOID, () => fnApplyFx.f32Const(0.0).localSet(cStore));
          fnApplyFx.storeF32Idx(M_FX_REV_COMB_STORE, () => fnApplyFx.localGet(c), () => fnApplyFx.localGet(cStore));

          // combBuf[cIdx] = rIn + cStore * rRoom
          fnApplyFx.localGet(cBase).localGet(cIdx).i32Const(2).i32Shl().i32Add();
          fnApplyFx.localGet(rIn).localGet(cStore).localGet(rRoom).f32Mul().f32Add();
          fnApplyFx.f32Store(0, 2);

          // advance cIdx
          fnApplyFx.localGet(cIdx).i32Const(1).i32Add().localTee(cIdx);
          fnApplyFx.localGet(cLen).i32GeS().ifBlock(BLK_VOID, () => fnApplyFx.i32Const(0).localSet(cIdx));
          fnApplyFx.storeI32Idx(M_FX_REV_COMB_IDX, () => fnApplyFx.localGet(c), () => fnApplyFx.localGet(cIdx));
        });

        // 4 series allpasses for L (c=0..3) and R (c=4..7)
        fnApplyFx.forLoop(c, () => fnApplyFx.i32Const(4), () => {
          // Left AP c
          fnApplyFx.loadI32Idx(M_FX_REV_AP_LEN, () => fnApplyFx.localGet(c)).localSet(cLen);
          fnApplyFx.loadI32Idx(M_FX_REV_AP_IDX, () => fnApplyFx.localGet(c)).localSet(cIdx);
          fnApplyFx.i32Const(M_REV_AP_BUF).localGet(c).i32Const(REV_AP_STRIDE_BYTES).i32Mul().i32Add().localSet(cBase);
          fnApplyFx.localGet(cBase).localGet(cIdx).i32Const(2).i32Shl().i32Add().f32Load(0, 2).localSet(bufOut);
          fnApplyFx.localGet(bufOut).f32Abs().f32Const(1e-15).f32Lt().ifBlock(BLK_VOID, () => fnApplyFx.f32Const(0.0).localSet(bufOut));
          fnApplyFx.localGet(cBase).localGet(cIdx).i32Const(2).i32Shl().i32Add();
          fnApplyFx.localGet(sumL).localGet(bufOut).f32Const(0.5).f32Mul().f32Add();
          fnApplyFx.f32Store(0, 2);
          fnApplyFx.localGet(bufOut).localGet(sumL).f32Sub().localSet(sumL);
          fnApplyFx.localGet(cIdx).i32Const(1).i32Add().localTee(cIdx);
          fnApplyFx.localGet(cLen).i32GeS().ifBlock(BLK_VOID, () => fnApplyFx.i32Const(0).localSet(cIdx));
          fnApplyFx.storeI32Idx(M_FX_REV_AP_IDX, () => fnApplyFx.localGet(c), () => fnApplyFx.localGet(cIdx));

          // Right AP (c+4)
          fnApplyFx.loadI32Idx(M_FX_REV_AP_LEN, () => fnApplyFx.localGet(c).i32Const(4).i32Add()).localSet(cLen);
          fnApplyFx.loadI32Idx(M_FX_REV_AP_IDX, () => fnApplyFx.localGet(c).i32Const(4).i32Add()).localSet(cIdx);
          fnApplyFx.i32Const(M_REV_AP_BUF).localGet(c).i32Const(4).i32Add().i32Const(REV_AP_STRIDE_BYTES).i32Mul().i32Add().localSet(cBase);
          fnApplyFx.localGet(cBase).localGet(cIdx).i32Const(2).i32Shl().i32Add().f32Load(0, 2).localSet(bufOut);
          fnApplyFx.localGet(bufOut).f32Abs().f32Const(1e-15).f32Lt().ifBlock(BLK_VOID, () => fnApplyFx.f32Const(0.0).localSet(bufOut));
          fnApplyFx.localGet(cBase).localGet(cIdx).i32Const(2).i32Shl().i32Add();
          fnApplyFx.localGet(sumR).localGet(bufOut).f32Const(0.5).f32Mul().f32Add();
          fnApplyFx.f32Store(0, 2);
          fnApplyFx.localGet(bufOut).localGet(sumR).f32Sub().localSet(sumR);
          fnApplyFx.localGet(cIdx).i32Const(1).i32Add().localTee(cIdx);
          fnApplyFx.localGet(cLen).i32GeS().ifBlock(BLK_VOID, () => fnApplyFx.i32Const(0).localSet(cIdx));
          fnApplyFx.storeI32Idx(M_FX_REV_AP_IDX, () => fnApplyFx.localGet(c).i32Const(4).i32Add(), () => fnApplyFx.localGet(cIdx));
        });

        fnApplyFx.storeF32Idx(M_OUT_L, () => fnApplyFx.localGet(s), () => {
          fnApplyFx.localGet(inL).localGet(rDry).f32Mul().localGet(sumL).localGet(rWetG).f32Mul().f32Add();
        });
        fnApplyFx.storeF32Idx(M_OUT_R, () => fnApplyFx.localGet(s), () => {
          fnApplyFx.localGet(inR).localGet(rDry).f32Mul().localGet(sumR).localGet(rWetG).f32Mul().f32Add();
        });
      });
    });

    // --- 4. Soft limitador final post-FX + medición de pico ---
    fnApplyFx.f32Const(0.0).localSet(peak);
    fnApplyFx.forLoop(s, () => fnApplyFx.localGet(blockSize), () => {
      fnApplyFx.loadF32Idx(M_OUT_L, () => fnApplyFx.localGet(s)).localTee(inL);
      fnApplyFx.f32Abs().localTee(rIn);
      fnApplyFx.f32Const(0.80).f32Gt().ifBlock(BLK_VOID, () => {
        fnApplyFx.f32Const(-1.0).f32Const(1.0).localGet(inL).f32Const(0.0).f32Lt().select();
        fnApplyFx.f32Const(0.80).f32Const(0.18).localGet(rIn).f32Const(0.80).f32Sub().f32Const(1.0 / 0.18).f32Mul().callFn(fnTanh).f32Mul().f32Add().f32Mul().localSet(inL);
        fnApplyFx.storeF32Idx(M_OUT_L, () => fnApplyFx.localGet(s), () => fnApplyFx.localGet(inL));
        fnApplyFx.localGet(inL).f32Abs().localSet(rIn);
      });
      fnApplyFx.localGet(peak).localGet(rIn).f32Max().localSet(peak);

      fnApplyFx.loadF32Idx(M_OUT_R, () => fnApplyFx.localGet(s)).localTee(inR);
      fnApplyFx.f32Abs().localTee(rIn);
      fnApplyFx.f32Const(0.80).f32Gt().ifBlock(BLK_VOID, () => {
        fnApplyFx.f32Const(-1.0).f32Const(1.0).localGet(inR).f32Const(0.0).f32Lt().select();
        fnApplyFx.f32Const(0.80).f32Const(0.18).localGet(rIn).f32Const(0.80).f32Sub().f32Const(1.0 / 0.18).f32Mul().callFn(fnTanh).f32Mul().f32Add().f32Mul().localSet(inR);
        fnApplyFx.storeF32Idx(M_OUT_R, () => fnApplyFx.localGet(s), () => fnApplyFx.localGet(inR));
        fnApplyFx.localGet(inR).f32Abs().localSet(rIn);
      });
      fnApplyFx.localGet(peak).localGet(rIn).f32Max().localSet(peak);
    });

    fnApplyFx.localGet(peak);
  }

  // =========================================================================
  // 13. EXPORTED processBlock(blockSize: i32) -> i32
  // =========================================================================
  const fnProc = mod.addFunction('processBlock', [VAL_I32], [VAL_I32], 'processBlock');
  {
    const blockSize = 0;
    const activeCount = fnProc.addLocal(VAL_I32);
    const v = fnProc.addLocal(VAL_I32);
    const s = fnProc.addLocal(VAL_I32);
    const b = fnProc.addLocal(VAL_I32);
    const baseSample = fnProc.addLocal(VAL_I32);
    const curSample = fnProc.addLocal(VAL_I32);
    const sr = fnProc.addLocal(VAL_F32);
    const dtBase = fnProc.addLocal(VAL_F32);

    const isLfoActive = fnProc.addLocal(VAL_I32);
    const lfoTargetCode = fnProc.addLocal(VAL_I32);
    const lfoWaveCode = fnProc.addLocal(VAL_I32);
    const lfoPhase = fnProc.addLocal(VAL_F32);
    const lfoPrevPhase = fnProc.addLocal(VAL_F32);
    const lfoStep = fnProc.addLocal(VAL_F32);
    const lfoDepth = fnProc.addLocal(VAL_F32);
    const lfoVal = fnProc.addLocal(VAL_F32);
    const lfoRand = fnProc.addLocal(VAL_F32);

    const osc1Wave = fnProc.addLocal(VAL_I32);
    const osc1Vol = fnProc.addLocal(VAL_F32);
    const osc1PF = fnProc.addLocal(VAL_F32);
    const osc2En = fnProc.addLocal(VAL_I32);
    const osc2Wave = fnProc.addLocal(VAL_I32);
    const osc2Vol = fnProc.addLocal(VAL_F32);
    const osc2PF = fnProc.addLocal(VAL_F32);
    const subEn = fnProc.addLocal(VAL_I32);
    const subWave = fnProc.addLocal(VAL_I32);
    const subVol = fnProc.addLocal(VAL_F32);
    const subPF = fnProc.addLocal(VAL_F32);
    const noiseEn = fnProc.addLocal(VAL_I32);
    const isPink = fnProc.addLocal(VAL_I32);
    const noiseVol = fnProc.addLocal(VAL_F32);
    const oscNorm = fnProc.addLocal(VAL_F32);

    const fltEn = fnProc.addLocal(VAL_I32);
    const fltType = fnProc.addLocal(VAL_I32);
    const fltFreq = fnProc.addLocal(VAL_F32);
    const fltK = fnProc.addLocal(VAL_F32);
    const fltK2 = fnProc.addLocal(VAL_F32);
    const flt4Pole = fnProc.addLocal(VAL_I32);
    const fltEnvAmt = fnProc.addLocal(VAL_F32);
    const fltKeyTrack = fnProc.addLocal(VAL_F32);
    const hasEnvCutoff = fnProc.addLocal(VAL_I32);
    const hasLfoCutoff = fnProc.addLocal(VAL_I32);
    const srMaxCut = fnProc.addLocal(VAL_F32);
    const piDivSr = fnProc.addLocal(VAL_F32);

    const drvActive = fnProc.addLocal(VAL_I32);
    const drvType = fnProc.addLocal(VAL_I32);
    const drvPre = fnProc.addLocal(VAL_F32);
    const drvPost = fnProc.addLocal(VAL_F32);
    const dryAnchor = fnProc.addLocal(VAL_F32);
    const wetMix = fnProc.addLocal(VAL_F32);

    const atkStep = fnProc.addLocal(VAL_F32);
    const decFac = fnProc.addLocal(VAL_F32);
    const susLvl = fnProc.addLocal(VAL_F32);
    const relFac = fnProc.addLocal(VAL_F32);
    const fAtkStep = fnProc.addLocal(VAL_F32);
    const fDecFac = fnProc.addLocal(VAL_F32);
    const fSusLvl = fnProc.addLocal(VAL_F32);
    const fRelFac = fnProc.addLocal(VAL_F32);
    const hasGlide = fnProc.addLocal(VAL_I32);
    const glideFac = fnProc.addLocal(VAL_F32);

    // Voice locals
    const vStage = fnProc.addLocal(VAL_I32);
    const vfStage = fnProc.addLocal(VAL_I32);
    const vMidi = fnProc.addLocal(VAL_I32);
    const vStartS = fnProc.addLocal(VAL_I32);
    const vRelS = fnProc.addLocal(VAL_I32);
    const vfDirty = fnProc.addLocal(VAL_I32);
    const vFreq = fnProc.addLocal(VAL_F32);
    const vTargetFreq = fnProc.addLocal(VAL_F32);
    const vGainL = fnProc.addLocal(VAL_F32);
    const vGainR = fnProc.addLocal(VAL_F32);
    const ph1 = fnProc.addLocal(VAL_F32);
    const ph2 = fnProc.addLocal(VAL_F32);
    const phSub = fnProc.addLocal(VAL_F32);
    const eLvl = fnProc.addLocal(VAL_F32);
    const feLvl = fnProc.addLocal(VAL_F32);
    const ic1 = fnProc.addLocal(VAL_F32);
    const ic2 = fnProc.addLocal(VAL_F32);
    const ic3 = fnProc.addLocal(VAL_F32);
    const ic4 = fnProc.addLocal(VAL_F32);
    const va1 = fnProc.addLocal(VAL_F32);
    const va2 = fnProc.addLocal(VAL_F32);
    const va3 = fnProc.addLocal(VAL_F32);
    const va1_2 = fnProc.addLocal(VAL_F32);
    const va2_2 = fnProc.addLocal(VAL_F32);
    const va3_2 = fnProc.addLocal(VAL_F32);
    const nb0 = fnProc.addLocal(VAL_F32);
    const nb1 = fnProc.addLocal(VAL_F32);
    const nb2 = fnProc.addLocal(VAL_F32);
    const baseOct = fnProc.addLocal(VAL_F32);

    // Sample scratch
    const lfoPitchMult = fnProc.addLocal(VAL_F32);
    const lfoOct = fnProc.addLocal(VAL_F32);
    const dt1 = fnProc.addLocal(VAL_F32);
    const dt2 = fnProc.addLocal(VAL_F32);
    const dtSub = fnProc.addLocal(VAL_F32);
    const white = fnProc.addLocal(VAL_F32);
    const vSample = fnProc.addLocal(VAL_F32);
    const gCut = fnProc.addLocal(VAL_F32);
    const v0 = fnProc.addLocal(VAL_F32);
    const v1 = fnProc.addLocal(VAL_F32);
    const v2 = fnProc.addLocal(VAL_F32);
    const v1Raw = fnProc.addLocal(VAL_F32);
    const sVal = fnProc.addLocal(VAL_F32);
    const sat = fnProc.addLocal(VAL_F32);
    const neg = fnProc.addLocal(VAL_F32);
    const amp = fnProc.addLocal(VAL_F32);

    // Master & tail
    const gainL = fnProc.addLocal(VAL_F32);
    const gainR = fnProc.addLocal(VAL_F32);
    const eqEn = fnProc.addLocal(VAL_I32);
    const fL = fnProc.addLocal(VAL_F32);
    const fR = fnProc.addLocal(VAL_F32);
    const yEq = fnProc.addLocal(VAL_F32);
    const dcInL = fnProc.addLocal(VAL_F32);
    const dcOutL = fnProc.addLocal(VAL_F32);
    const dcInR = fnProc.addLocal(VAL_F32);
    const dcOutR = fnProc.addLocal(VAL_F32);
    const dcTmp = fnProc.addLocal(VAL_F32);
    const lfoAmpGain = fnProc.addLocal(VAL_F32);
    const blockPeak = fnProc.addLocal(VAL_F32);
    const silentCount = fnProc.addLocal(VAL_I32);
    const graceBlocks = fnProc.addLocal(VAL_I32);

    fnProc.localGet(blockSize).i32Const(128).i32GtS().ifBlock(BLK_VOID, () => fnProc.i32Const(128).localSet(blockSize));
    fnProc.localGet(blockSize).i32Const(0).i32LeS().ifBlock(BLK_VOID, () => fnProc.i32Const(0).ret());

    fnProc.loadI32At(M_CURRENT_SAMPLE).localSet(baseSample);

    // 1. Contar voces activas
    fnProc.i32Const(0).localSet(activeCount);
    fnProc.forLoop(v, () => fnProc.i32Const(WASM_MAX_VOICES), () => {
      fnProc.loadI32Idx(V_ACTIVE, () => fnProc.localGet(v));
      fnProc.loadI32Idx(V_ENV_STAGE, () => fnProc.localGet(v)).i32Const(ENV_IDLE).i32Ne().i32And();
      fnProc.ifBlock(BLK_VOID, () => {
        fnProc.localGet(activeCount).i32Const(1).i32Add().localSet(activeCount);
      });
    });

    // 2. Early exit en reposo total
    fnProc.localGet(activeCount).i32Eqz();
    fnProc.loadI32At(M_FX_TAIL_SILENT).i32Const(0).i32Ne().i32And();
    fnProc.ifBlock(BLK_VOID, () => {
      fnProc.forLoop(s, () => fnProc.localGet(blockSize), () => {
        fnProc.storeF32Idx(M_OUT_L, () => fnProc.localGet(s), () => fnProc.f32Const(0.0));
        fnProc.storeF32Idx(M_OUT_R, () => fnProc.localGet(s), () => fnProc.f32Const(0.0));
      });
      fnProc.storeI32At(M_CURRENT_SAMPLE, () => fnProc.localGet(baseSample).localGet(blockSize).i32Add());
      fnProc.i32Const(0).ret();
    });

    // 3. Limpiar outL/outR
    fnProc.forLoop(s, () => fnProc.localGet(blockSize), () => {
      fnProc.storeF32Idx(M_OUT_L, () => fnProc.localGet(s), () => fnProc.f32Const(0.0));
      fnProc.storeF32Idx(M_OUT_R, () => fnProc.localGet(s), () => fnProc.f32Const(0.0));
    });

    fnProc.loadF32At(M_SAMPLE_RATE).localSet(sr);
    fnProc.loadF32At(M_DT_BASE).localSet(dtBase);
    fnProc.localGet(sr).f32Const(0.43).f32Mul().localSet(srMaxCut);
    fnProc.f32Const(Math.PI).localGet(sr).f32Div().localSet(piDivSr);

    // 4. Síntesis de voces activas (Voice-Outer Loop + LFO Block Cache)
    fnProc.localGet(activeCount).i32Const(0).i32GtS().ifBlock(BLK_VOID, () => {
      fnProc.storeI32At(M_FX_TAIL_SILENT, () => fnProc.i32Const(0));
      fnProc.storeI32At(M_FX_SILENT_BLOCKS, () => fnProc.i32Const(0));

      fnProc.loadF32At(M_LFO_DEPTH).localSet(lfoDepth);
      fnProc.loadI32At(M_LFO_ENABLED).localGet(lfoDepth).f32Const(0.001).f32Gt().i32And().localSet(isLfoActive);
      fnProc.loadI32At(M_LFO_TARGET_CODE).localSet(lfoTargetCode);

      fnProc.localGet(isLfoActive).ifBlock(BLK_VOID, () => {
        fnProc.loadI32At(M_LFO_WAVE_CODE).localSet(lfoWaveCode);
        fnProc.loadF32At(M_LFO_PHASE).localSet(lfoPhase);
        fnProc.loadF32At(M_LFO_STEP).localSet(lfoStep);
        fnProc.loadF32At(M_LFO_RAND_VAL).localSet(lfoRand);

        fnProc.forLoop(s, () => fnProc.localGet(blockSize), () => {
          fnProc.localGet(lfoPhase).localSet(lfoPrevPhase);
          fnProc.localGet(lfoPhase).localGet(lfoStep).f32Add().localTee(lfoPhase);
          fnProc.f32Const(1.0).f32Ge().ifBlock(BLK_VOID, () => {
            fnProc.localGet(lfoPhase).localGet(lfoPhase).f32Floor().f32Sub().localSet(lfoPhase);
          });
          fnProc.localGet(lfoPhase).localGet(lfoPrevPhase).f32Lt().ifBlock(BLK_VOID, () => {
            fnProc.callFn(fnRand).localSet(lfoRand);
          });

          // Switch LFO wave (0:sin, 1:saw, 2:sq, 3:tri, 4:rand)
          fnProc.localGet(lfoWaveCode).i32Eqz().ifBlock(
            BLK_VOID,
            () => { fnProc.localGet(lfoPhase).callFn(fnSin).localSet(lfoVal); },
            () => {
              fnProc.localGet(lfoWaveCode).i32Const(3).i32Eq().ifBlock(
                BLK_VOID,
                () => {
                  fnProc.f32Const(2.0).localGet(lfoPhase).f32Mul().f32Const(1.0).f32Sub().f32Abs().f32Const(2.0).f32Mul().f32Const(1.0).f32Sub().localSet(lfoVal);
                },
                () => {
                  fnProc.localGet(lfoWaveCode).i32Const(1).i32Eq().ifBlock(
                    BLK_VOID,
                    () => { fnProc.f32Const(1.0).f32Const(2.0).localGet(lfoPhase).f32Mul().f32Sub().localSet(lfoVal); },
                    () => {
                      fnProc.localGet(lfoWaveCode).i32Const(2).i32Eq().ifBlock(
                        BLK_VOID,
                        () => {
                          fnProc.f32Const(1.0).f32Const(-1.0).localGet(lfoPhase).f32Const(0.5).f32Lt().select().localSet(lfoVal);
                        },
                        () => { fnProc.localGet(lfoRand).localSet(lfoVal); }
                      );
                    }
                  );
                }
              );
            }
          );

          fnProc.storeF32Idx(M_LFO_BUF, () => fnProc.localGet(s), () => fnProc.localGet(lfoVal));
        });

        fnProc.storeF32At(M_LFO_PHASE, () => fnProc.localGet(lfoPhase));
        fnProc.storeF32At(M_LFO_RAND_VAL, () => fnProc.localGet(lfoRand));
      });

      // Cargar parámetros en registros una sola vez
      fnProc.loadI32At(M_OSC1_WAVE_CODE).localSet(osc1Wave);
      fnProc.loadF32At(M_OSC1_VOL).localSet(osc1Vol);
      fnProc.loadF32At(M_OSC1_PITCH_FACTOR).localSet(osc1PF);
      fnProc.loadI32At(M_OSC2_ENABLED).localSet(osc2En);
      fnProc.loadI32At(M_OSC2_WAVE_CODE).localSet(osc2Wave);
      fnProc.loadF32At(M_OSC2_VOL).localSet(osc2Vol);
      fnProc.loadF32At(M_OSC2_PITCH_FACTOR).localSet(osc2PF);
      fnProc.loadI32At(M_SUB_ENABLED).localSet(subEn);
      fnProc.loadI32At(M_SUB_WAVE_CODE).localSet(subWave);
      fnProc.loadF32At(M_SUB_VOL).localSet(subVol);
      fnProc.loadF32At(M_SUB_PITCH_FACTOR).localSet(subPF);
      fnProc.loadI32At(M_NOISE_ENABLED).localSet(noiseEn);
      fnProc.loadI32At(M_NOISE_TYPE_CODE).localSet(isPink);
      fnProc.loadF32At(M_NOISE_VOL).localSet(noiseVol);
      fnProc.loadF32At(M_OSC_NORM).localSet(oscNorm);

      fnProc.loadI32At(M_FILTER_ENABLED).localSet(fltEn);
      fnProc.loadI32At(M_FILTER_TYPE_CODE).localSet(fltType);
      fnProc.loadF32At(M_FILTER_FREQ).localSet(fltFreq);
      fnProc.f32Const(1.0).loadF32At(M_FILTER_Q).f32Div().localTee(fltK);
      fnProc.f32Const(1.45).f32Mul().f32Const(0.707).f32Max().localSet(fltK2);
      fnProc.loadI32At(M_FILTER_FOUR_POLE).localSet(flt4Pole);
      fnProc.loadF32At(M_FILTER_ENV_AMT).localSet(fltEnvAmt);
      fnProc.loadF32At(M_FILTER_KEY_TRACK).localSet(fltKeyTrack);
      fnProc.localGet(fltEnvAmt).f32Abs().f32Const(0.001).f32Gt().localSet(hasEnvCutoff);
      fnProc.localGet(isLfoActive).localGet(lfoTargetCode).i32Eqz().i32And().localSet(hasLfoCutoff);

      fnProc.loadI32At(M_FILTER_DRIVE_ACTIVE).localSet(drvActive);
      fnProc.loadI32At(M_FILTER_DRIVE_TYPE).localSet(drvType);
      fnProc.loadF32At(M_DRIVE_PRE_GAIN).localSet(drvPre);
      fnProc.loadF32At(M_DRIVE_POST_COMP).localSet(drvPost);
      fnProc.loadF32At(M_DRY_BASS_ANCHOR).localSet(dryAnchor);
      fnProc.loadF32At(M_WET_SAT_MIX).localSet(wetMix);

      fnProc.loadF32At(M_ATTACK_STEP).localSet(atkStep);
      fnProc.loadF32At(M_DECAY_FACTOR).localSet(decFac);
      fnProc.loadF32At(M_SUSTAIN).localSet(susLvl);
      fnProc.loadF32At(M_RELEASE_FACTOR).localSet(relFac);
      fnProc.loadF32At(M_F_ATTACK_STEP).localSet(fAtkStep);
      fnProc.loadF32At(M_F_DECAY_FACTOR).localSet(fDecFac);
      fnProc.loadF32At(M_F_SUSTAIN).localSet(fSusLvl);
      fnProc.loadF32At(M_F_RELEASE_FACTOR).localSet(fRelFac);
      fnProc.loadI32At(M_HAS_GLIDE).localSet(hasGlide);
      fnProc.loadF32At(M_GLIDE_FACTOR).localSet(glideFac);

      // Voice-outer loop
      fnProc.forLoop(v, () => fnProc.i32Const(WASM_MAX_VOICES), () => {
        fnProc.loadI32Idx(V_ACTIVE, () => fnProc.localGet(v));
        fnProc.loadI32Idx(V_ENV_STAGE, () => fnProc.localGet(v)).localTee(vStage).i32Const(ENV_IDLE).i32Ne().i32And();
        fnProc.ifBlock(BLK_VOID, () => {
          // Cargar estado de la voz en registros
          fnProc.loadI32Idx(V_FENV_STAGE, () => fnProc.localGet(v)).localSet(vfStage);
          fnProc.loadI32Idx(V_MIDI, () => fnProc.localGet(v)).localSet(vMidi);
          fnProc.loadI32Idx(V_START_SAMPLE, () => fnProc.localGet(v)).localSet(vStartS);
          fnProc.loadI32Idx(V_REL_SAMPLE, () => fnProc.localGet(v)).localSet(vRelS);
          fnProc.loadI32Idx(V_F_DIRTY, () => fnProc.localGet(v)).localSet(vfDirty);
          fnProc.loadF32Idx(V_FREQ, () => fnProc.localGet(v)).localSet(vFreq);
          fnProc.loadF32Idx(V_TARGET_FREQ, () => fnProc.localGet(v)).localSet(vTargetFreq);

          fnProc.loadF32Idx(V_VEL_GAIN, () => fnProc.localGet(v)).localTee(amp);
          fnProc.loadF32Idx(V_PAN_L, () => fnProc.localGet(v)).f32Mul().localSet(vGainL);
          fnProc.localGet(amp).loadF32Idx(V_PAN_R, () => fnProc.localGet(v)).f32Mul().localSet(vGainR);

          fnProc.loadF32Idx(V_PHASE1, () => fnProc.localGet(v)).localSet(ph1);
          fnProc.loadF32Idx(V_PHASE2, () => fnProc.localGet(v)).localSet(ph2);
          fnProc.loadF32Idx(V_PHASE_SUB, () => fnProc.localGet(v)).localSet(phSub);
          fnProc.loadF32Idx(V_ENV_LEVEL, () => fnProc.localGet(v)).localSet(eLvl);
          fnProc.loadF32Idx(V_FENV_LEVEL, () => fnProc.localGet(v)).localSet(feLvl);
          fnProc.loadF32Idx(V_IC1, () => fnProc.localGet(v)).localSet(ic1);
          fnProc.loadF32Idx(V_IC2, () => fnProc.localGet(v)).localSet(ic2);
          fnProc.loadF32Idx(V_IC3, () => fnProc.localGet(v)).localSet(ic3);
          fnProc.loadF32Idx(V_IC4, () => fnProc.localGet(v)).localSet(ic4);
          fnProc.loadF32Idx(V_A1, () => fnProc.localGet(v)).localSet(va1);
          fnProc.loadF32Idx(V_A2, () => fnProc.localGet(v)).localSet(va2);
          fnProc.loadF32Idx(V_A3, () => fnProc.localGet(v)).localSet(va3);
          fnProc.loadF32Idx(V_A1_2, () => fnProc.localGet(v)).localSet(va1_2);
          fnProc.loadF32Idx(V_A2_2, () => fnProc.localGet(v)).localSet(va2_2);
          fnProc.loadF32Idx(V_A3_2, () => fnProc.localGet(v)).localSet(va3_2);
          fnProc.loadF32Idx(V_B0, () => fnProc.localGet(v)).localSet(nb0);
          fnProc.loadF32Idx(V_B1, () => fnProc.localGet(v)).localSet(nb1);
          fnProc.loadF32Idx(V_B2, () => fnProc.localGet(v)).localSet(nb2);

          // baseOct = keyOct + velOct (invariante para la voz en todo el bloque!)
          fnProc.localGet(fltKeyTrack).f32Const(0.001).f32Gt().ifBlock(
            BLK_F32,
            () => fnProc.localGet(vMidi).i32Const(60).i32Sub().f32ConvertI32S().f32Const(1.0 / 12.0).f32Mul().localGet(fltKeyTrack).f32Mul(),
            () => fnProc.f32Const(0.0)
          );
          fnProc.loadF32Idx(V_VEL, () => fnProc.localGet(v)).f32Const(0.75).f32Sub().f32Const(0.9).f32Mul().f32Add().localSet(baseOct);

          // Inner sample loop con break limpio al apagarse la voz
          fnProc.block(BLK_VOID, () => {
            fnProc.forLoop(s, () => fnProc.localGet(blockSize), () => {
              fnProc.localGet(baseSample).localGet(s).i32Add().i32Const(1).i32Add().localSet(curSample);

              // Pending check
              fnProc.localGet(vStage).i32Const(ENV_PENDING).i32Eq().ifBlock(BLK_VOID, () => {
                fnProc.localGet(curSample).localGet(vStartS).i32GeS().ifBlock(
                  BLK_VOID,
                  () => {
                    fnProc.i32Const(ENV_ATTACK).localSet(vStage);
                    fnProc.i32Const(ENV_ATTACK).localSet(vfStage);
                    fnProc.i32Const(1).localSet(vfDirty);
                  },
                  () => {
                    // Pending continue: jump to end of sample loop body cleanly by guarding rest?
                    // Even simpler: wrap synthesis after pending check, or use block/br!
                  }
                );
              });

              fnProc.localGet(vStage).i32Const(ENV_PENDING).i32Ne().ifBlock(BLK_VOID, () => {
                // Auto-release check
                fnProc.localGet(vRelS).i32Const(0).i32GtS().localGet(curSample).localGet(vRelS).i32GeS().i32And().ifBlock(BLK_VOID, () => {
                  fnProc.i32Const(ENV_RELEASE).localSet(vStage);
                  fnProc.i32Const(ENV_RELEASE).localSet(vfStage);
                  fnProc.i32Const(-1).localSet(vRelS);
                });

                // Amp ADSR step
                fnProc.localGet(vStage).i32Const(ENV_ATTACK).i32Eq().ifBlock(
                  BLK_VOID,
                  () => {
                    fnProc.localGet(eLvl).localGet(atkStep).f32Add().localTee(eLvl);
                    fnProc.f32Const(1.0).f32Ge().ifBlock(BLK_VOID, () => {
                      fnProc.f32Const(1.0).localSet(eLvl);
                      fnProc.i32Const(ENV_DECAY).localSet(vStage);
                    });
                  },
                  () => {
                    fnProc.localGet(vStage).i32Const(ENV_DECAY).i32Eq().ifBlock(
                      BLK_VOID,
                      () => {
                        fnProc.localGet(susLvl).localGet(eLvl).localGet(susLvl).f32Sub().localGet(decFac).f32Mul().f32Add().localSet(eLvl);
                        fnProc.localGet(susLvl).f32Const(0.001).f32Le().localGet(eLvl).f32Const(0.0005).f32Lt().i32And().ifBlock(
                          BLK_VOID,
                          () => {
                            fnProc.f32Const(0.0).localSet(eLvl);
                            fnProc.f32Const(0.0).localSet(feLvl);
                            fnProc.i32Const(ENV_IDLE).localSet(vStage);
                            fnProc.i32Const(ENV_IDLE).localSet(vfStage);
                            fnProc.f32Const(0.0).localSet(ic1);
                            fnProc.f32Const(0.0).localSet(ic2);
                            fnProc.f32Const(0.0).localSet(ic3);
                            fnProc.f32Const(0.0).localSet(ic4);
                            fnProc.storeI32Idx(V_ACTIVE, () => fnProc.localGet(v), () => fnProc.i32Const(0));
                            fnProc.br(6);
                          },
                          () => {
                            fnProc.localGet(eLvl).localGet(susLvl).f32Sub().f32Abs().f32Const(0.0002).f32Lt().ifBlock(BLK_VOID, () => {
                              fnProc.localGet(susLvl).localSet(eLvl);
                              fnProc.i32Const(ENV_SUSTAIN).localSet(vStage);
                            });
                          }
                        );
                      },
                      () => {
                        fnProc.localGet(vStage).i32Const(ENV_SUSTAIN).i32Eq().ifBlock(
                          BLK_VOID,
                          () => { fnProc.localGet(susLvl).localSet(eLvl); },
                          () => {
                            // ENV_RELEASE
                            fnProc.localGet(eLvl).localGet(relFac).f32Mul().localTee(eLvl);
                            fnProc.f32Const(0.0005).f32Lt().ifBlock(BLK_VOID, () => {
                              fnProc.f32Const(0.0).localSet(eLvl);
                              fnProc.f32Const(0.0).localSet(feLvl);
                              fnProc.i32Const(ENV_IDLE).localSet(vStage);
                              fnProc.i32Const(ENV_IDLE).localSet(vfStage);
                              fnProc.f32Const(0.0).localSet(ic1);
                              fnProc.f32Const(0.0).localSet(ic2);
                              fnProc.f32Const(0.0).localSet(ic3);
                              fnProc.f32Const(0.0).localSet(ic4);
                              fnProc.storeI32Idx(V_ACTIVE, () => fnProc.localGet(v), () => fnProc.i32Const(0));
                              fnProc.br(7);
                            });
                          }
                        );
                      }
                    );
                  }
                );

                // Sólo sintetizar si no acaba de entrar en ENV_IDLE
                fnProc.localGet(vStage).i32Const(ENV_IDLE).i32Ne().ifBlock(BLK_VOID, () => {
                  // Filter ADSR
                  fnProc.localGet(vfStage).i32Const(ENV_ATTACK).i32Eq().ifBlock(
                    BLK_VOID,
                    () => {
                      fnProc.localGet(feLvl).localGet(fAtkStep).f32Add().localTee(feLvl);
                      fnProc.f32Const(1.0).f32Ge().ifBlock(BLK_VOID, () => {
                        fnProc.f32Const(1.0).localSet(feLvl);
                        fnProc.i32Const(ENV_DECAY).localSet(vfStage);
                      });
                    },
                    () => {
                      fnProc.localGet(vfStage).i32Const(ENV_DECAY).i32Eq().ifBlock(
                        BLK_VOID,
                        () => {
                          fnProc.localGet(fSusLvl).localGet(feLvl).localGet(fSusLvl).f32Sub().localGet(fDecFac).f32Mul().f32Add().localSet(feLvl);
                          fnProc.localGet(feLvl).localGet(fSusLvl).f32Sub().f32Abs().f32Const(0.0002).f32Lt().ifBlock(BLK_VOID, () => {
                            fnProc.localGet(fSusLvl).localSet(feLvl);
                            fnProc.i32Const(ENV_SUSTAIN).localSet(vfStage);
                          });
                        },
                        () => {
                          fnProc.localGet(vfStage).i32Const(ENV_SUSTAIN).i32Eq().ifBlock(
                            BLK_VOID,
                            () => { fnProc.localGet(fSusLvl).localSet(feLvl); },
                            () => {
                              fnProc.localGet(vfStage).i32Const(ENV_RELEASE).i32Eq().ifBlock(BLK_VOID, () => {
                                fnProc.localGet(feLvl).localGet(fRelFac).f32Mul().localTee(feLvl);
                                fnProc.f32Const(0.0005).f32Lt().ifBlock(BLK_VOID, () => {
                                  fnProc.f32Const(0.0).localSet(feLvl);
                                  fnProc.i32Const(ENV_IDLE).localSet(vfStage);
                                });
                              });
                            }
                          );
                        }
                      );
                    }
                  );

                  // Glide
                  fnProc.localGet(hasGlide).ifBlock(
                    BLK_VOID,
                    () => {
                      fnProc.localGet(vTargetFreq).localGet(vFreq).localGet(vTargetFreq).f32Sub().localGet(glideFac).f32Mul().f32Add().localSet(vFreq);
                    },
                    () => { fnProc.localGet(vTargetFreq).localSet(vFreq); }
                  );

                  // LFO para esta muestra
                  fnProc.f32Const(1.0).localSet(lfoPitchMult);
                  fnProc.f32Const(0.0).localSet(lfoOct);
                  fnProc.localGet(isLfoActive).ifBlock(BLK_VOID, () => {
                    fnProc.loadF32Idx(M_LFO_BUF, () => fnProc.localGet(s)).localSet(lfoVal);
                    fnProc.localGet(lfoTargetCode).i32Const(1).i32Eq().ifBlock(BLK_VOID, () => {
                      fnProc.f32Const(1.0).localGet(lfoVal).localGet(lfoDepth).f32Mul().f32Const(0.086).f32Mul().f32Add().localSet(lfoPitchMult);
                    });
                    fnProc.localGet(lfoTargetCode).i32Eqz().ifBlock(BLK_VOID, () => {
                      fnProc.localGet(lfoVal).localGet(lfoDepth).f32Mul().f32Const(2.5).f32Mul().localSet(lfoOct);
                    });
                  });

                  // OSC 1
                  fnProc.localGet(vFreq).localGet(osc1PF).f32Mul().localGet(lfoPitchMult).f32Mul().localGet(dtBase).f32Mul().localSet(dt1);
                  fnProc.localGet(ph1).localGet(dt1).f32Add().localTee(ph1);
                  fnProc.f32Const(1.0).f32Ge().ifBlock(BLK_VOID, () => fnProc.localGet(ph1).localGet(ph1).f32Floor().f32Sub().localSet(ph1));
                  fnProc.localGet(osc1Wave).localGet(ph1).localGet(dt1).callFn(fnOsc).localGet(osc1Vol).f32Mul().localSet(vSample);

                  // OSC 2
                  fnProc.localGet(osc2En).ifBlock(BLK_VOID, () => {
                    fnProc.localGet(vFreq).localGet(osc2PF).f32Mul().localGet(lfoPitchMult).f32Mul().localGet(dtBase).f32Mul().localSet(dt2);
                    fnProc.localGet(ph2).localGet(dt2).f32Add().localTee(ph2);
                    fnProc.f32Const(1.0).f32Ge().ifBlock(BLK_VOID, () => fnProc.localGet(ph2).localGet(ph2).f32Floor().f32Sub().localSet(ph2));
                    fnProc.localGet(vSample).localGet(osc2Wave).localGet(ph2).localGet(dt2).callFn(fnOsc).localGet(osc2Vol).f32Mul().f32Add().localSet(vSample);
                  });

                  // SUB OSC
                  fnProc.localGet(subEn).ifBlock(BLK_VOID, () => {
                    fnProc.localGet(vFreq).localGet(subPF).f32Mul().localGet(lfoPitchMult).f32Mul().localGet(dtBase).f32Mul().localSet(dtSub);
                    fnProc.localGet(phSub).localGet(dtSub).f32Add().localTee(phSub);
                    fnProc.f32Const(1.0).f32Ge().ifBlock(BLK_VOID, () => fnProc.localGet(phSub).localGet(phSub).f32Floor().f32Sub().localSet(phSub));
                    fnProc.localGet(vSample).localGet(subWave).localGet(phSub).localGet(dtSub).callFn(fnOsc).localGet(subVol).f32Mul().f32Add().localSet(vSample);
                  });

                  // NOISE
                  fnProc.localGet(noiseEn).ifBlock(BLK_VOID, () => {
                    fnProc.callFn(fnRand).localSet(white);
                    fnProc.localGet(isPink).ifBlock(
                      BLK_VOID,
                      () => {
                        fnProc.f32Const(0.99765).localGet(nb0).f32Mul().localGet(white).f32Const(0.0990460).f32Mul().f32Add().localSet(nb0);
                        fnProc.f32Const(0.96300).localGet(nb1).f32Mul().localGet(white).f32Const(0.2965164).f32Mul().f32Add().localSet(nb1);
                        fnProc.f32Const(0.57000).localGet(nb2).f32Mul().localGet(white).f32Const(1.0526913).f32Mul().f32Add().localSet(nb2);
                        fnProc.localGet(vSample);
                        fnProc.localGet(nb0).localGet(nb1).f32Add().localGet(nb2).f32Add().localGet(white).f32Const(0.1848).f32Mul().f32Add();
                        fnProc.f32Const(0.18).f32Mul().localGet(noiseVol).f32Mul().f32Add().localSet(vSample);
                      },
                      () => {
                        fnProc.localGet(vSample).localGet(white).localGet(noiseVol).f32Mul().f32Add().localSet(vSample);
                      }
                    );
                  });

                  fnProc.localGet(vSample).localGet(oscNorm).f32Mul().localSet(vSample);

                  // SVF Filter (per-voice + optional 4-pole)
                  fnProc.localGet(fltEn).ifBlock(BLK_VOID, () => {
                    // Check if cutoff recalculation needed (vfDirty != 0 || ((s & 7) == 0 && (hasLfoCutoff || (hasEnvCutoff && vfStage in [2,3,5]))))
                    fnProc.localGet(vfDirty).i32Const(0).i32Ne();
                    fnProc.localGet(s).i32Const(7).i32And().i32Eqz();
                    fnProc.localGet(hasLfoCutoff);
                    fnProc.localGet(hasEnvCutoff);
                    fnProc.localGet(vfStage).i32Const(ENV_ATTACK).i32Eq();
                    fnProc.localGet(vfStage).i32Const(ENV_DECAY).i32Eq().i32Or();
                    fnProc.localGet(vfStage).i32Const(ENV_RELEASE).i32Eq().i32Or();
                    fnProc.i32And().i32Or().i32And().i32Or();

                    fnProc.ifBlock(BLK_VOID, () => {
                      // effCut = clamp(fltFreq * fast_exp2(baseOct + lfoOct + feLvl * fltEnvAmt * 3.5), 25, srMaxCut)
                      fnProc.localGet(fltFreq);
                      fnProc.localGet(baseOct).localGet(lfoOct).f32Add();
                      fnProc.localGet(feLvl).localGet(fltEnvAmt).f32Mul().f32Const(3.5).f32Mul().f32Add();
                      fnProc.callFn(fnExp2).f32Mul();
                      fnProc.localGet(srMaxCut).f32Min().f32Const(25.0).f32Max();
                      fnProc.localGet(piDivSr).f32Mul().callFn(fnTan).localSet(gCut);

                      fnProc.f32Const(1.0).f32Const(1.0).localGet(gCut).localGet(gCut).localGet(fltK).f32Add().f32Mul().f32Add().f32Div().localTee(va1);
                      fnProc.localGet(gCut).f32Mul().localTee(va2);
                      fnProc.localGet(gCut).f32Mul().localSet(va3);

                      fnProc.localGet(flt4Pole).ifBlock(BLK_VOID, () => {
                        fnProc.f32Const(1.0).f32Const(1.0).localGet(gCut).localGet(gCut).localGet(fltK2).f32Add().f32Mul().f32Add().f32Div().localTee(va1_2);
                        fnProc.localGet(gCut).f32Mul().localTee(va2_2);
                        fnProc.localGet(gCut).f32Mul().localSet(va3_2);
                      });
                      fnProc.i32Const(0).localSet(vfDirty);
                    });

                    // Stage 1 SVF
                    fnProc.localGet(vSample).localSet(v0);
                    fnProc.localGet(va1).localGet(ic1).f32Mul().localGet(va2).localGet(v0).localGet(ic2).f32Sub().f32Mul().f32Add().localTee(v1Raw);
                    fnProc.f32Const(1.0).f32Const(0.14).localGet(v1Raw).f32Abs().f32Mul().f32Add().f32Div().localSet(v1);
                    fnProc.localGet(ic2).localGet(va2).localGet(ic1).f32Mul().f32Add().localGet(va3).localGet(v0).localGet(ic2).f32Sub().f32Mul().f32Add().localSet(v2);
                    fnProc.f32Const(2.0).localGet(v1).f32Mul().localGet(ic1).f32Sub().localSet(ic1);
                    fnProc.f32Const(2.0).localGet(v2).f32Mul().localGet(ic2).f32Sub().localSet(ic2);

                    fnProc.localGet(fltType).i32Eqz().ifBlock(
                      BLK_VOID,
                      () => { fnProc.localGet(v2).localSet(vSample); },
                      () => {
                        fnProc.localGet(fltType).i32Const(1).i32Eq().ifBlock(
                          BLK_VOID,
                          () => { fnProc.localGet(v1).localSet(vSample); },
                          () => {
                            fnProc.localGet(fltType).i32Const(2).i32Eq().ifBlock(
                              BLK_VOID,
                              () => { fnProc.localGet(v0).localGet(fltK).localGet(v1).f32Mul().f32Sub().localGet(v2).f32Sub().localSet(vSample); },
                              () => { fnProc.localGet(v0).localGet(fltK).localGet(v1).f32Mul().f32Sub().localSet(vSample); }
                            );
                          }
                        );
                      }
                    );

                    // Stage 2 SVF (4-pole)
                    fnProc.localGet(flt4Pole).ifBlock(BLK_VOID, () => {
                      fnProc.localGet(vSample).localSet(v0);
                      fnProc.localGet(va1_2).localGet(ic3).f32Mul().localGet(va2_2).localGet(v0).localGet(ic4).f32Sub().f32Mul().f32Add().localTee(v1Raw);
                      fnProc.f32Const(1.0).f32Const(0.14).localGet(v1Raw).f32Abs().f32Mul().f32Add().f32Div().localSet(v1);
                      fnProc.localGet(ic4).localGet(va2_2).localGet(ic3).f32Mul().f32Add().localGet(va3_2).localGet(v0).localGet(ic4).f32Sub().f32Mul().f32Add().localSet(v2);
                      fnProc.f32Const(2.0).localGet(v1).f32Mul().localGet(ic3).f32Sub().localSet(ic3);
                      fnProc.f32Const(2.0).localGet(v2).f32Mul().localGet(ic4).f32Sub().localSet(ic4);

                      fnProc.localGet(fltType).i32Eqz().ifBlock(
                        BLK_VOID,
                        () => { fnProc.localGet(v2).localSet(vSample); },
                        () => {
                          fnProc.localGet(fltType).i32Const(1).i32Eq().ifBlock(
                            BLK_VOID,
                            () => { fnProc.localGet(v1).localSet(vSample); },
                            () => {
                              fnProc.localGet(fltType).i32Const(2).i32Eq().ifBlock(
                                BLK_VOID,
                                () => { fnProc.localGet(v0).localGet(fltK2).localGet(v1).f32Mul().f32Sub().localGet(v2).f32Sub().localSet(vSample); },
                                () => { fnProc.localGet(v0).localGet(fltK2).localGet(v1).f32Mul().f32Sub().localSet(vSample); }
                              );
                            }
                          );
                        }
                      );
                    });
                  });

                  // Drive
                  fnProc.localGet(drvActive).ifBlock(BLK_VOID, () => {
                    fnProc.localGet(vSample).localGet(drvPre).f32Mul().localSet(sVal);
                    fnProc.localGet(drvType).i32Eqz().ifBlock(
                      BLK_VOID,
                      () => {
                        fnProc.localGet(sVal).f32Const(0.0).f32Ge().ifBlock(
                          BLK_VOID,
                          () => { fnProc.localGet(sVal).f32Const(1.0).f32Const(0.45).localGet(sVal).f32Mul().f32Add().f32Div().localSet(sat); },
                          () => {
                            fnProc.localGet(sVal).f32Neg().localTee(neg);
                            fnProc.f32Neg().f32Const(1.0).f32Const(0.7).localGet(neg).f32Mul().f32Add().f32Div().localSet(sat);
                          }
                        );
                      },
                      () => {
                        fnProc.localGet(drvType).i32Const(1).i32Eq().ifBlock(
                          BLK_VOID,
                          () => { fnProc.localGet(sVal).callFn(fnTanh).localSet(sat); },
                          () => {
                            fnProc.localGet(drvType).i32Const(2).i32Eq().ifBlock(
                              BLK_VOID,
                              () => { fnProc.localGet(sVal).f32Const(1.35).f32Mul().callFn(fnTanh).localSet(sat); },
                              () => { fnProc.localGet(sVal).f32Const(0.85).f32Mul().callFn(fnTanh).f32Const(1.15).f32Mul().localSet(sat); }
                            );
                          }
                        );
                      }
                    );
                    fnProc.localGet(sat).localGet(wetMix).f32Mul();
                    fnProc.localGet(vSample).localGet(dryAnchor).f32Mul().f32Add();
                    fnProc.localGet(drvPost).f32Mul().localSet(vSample);
                  });

                  // Accumulate L/R
                  fnProc.localGet(vSample).localGet(eLvl).f32Mul().localSet(amp);
                  fnProc.storeF32Idx(M_OUT_L, () => fnProc.localGet(s), () => {
                    fnProc.loadF32Idx(M_OUT_L, () => fnProc.localGet(s)).localGet(amp).localGet(vGainL).f32Mul().f32Add();
                  });
                  fnProc.storeF32Idx(M_OUT_R, () => fnProc.localGet(s), () => {
                    fnProc.loadF32Idx(M_OUT_R, () => fnProc.localGet(s)).localGet(amp).localGet(vGainR).f32Mul().f32Add();
                  });
                }); // end if vStage != IDLE
              }); // end if vStage != PENDING
            }); // end for s
          }); // end breakable block

          // Almacenar estado actualizado de la voz de vuelta a memoria
          fnProc.storeI32Idx(V_ENV_STAGE, () => fnProc.localGet(v), () => fnProc.localGet(vStage));
          fnProc.storeI32Idx(V_FENV_STAGE, () => fnProc.localGet(v), () => fnProc.localGet(vfStage));
          fnProc.storeI32Idx(V_REL_SAMPLE, () => fnProc.localGet(v), () => fnProc.localGet(vRelS));
          fnProc.storeI32Idx(V_F_DIRTY, () => fnProc.localGet(v), () => fnProc.localGet(vfDirty));
          fnProc.storeF32Idx(V_FREQ, () => fnProc.localGet(v), () => fnProc.localGet(vFreq));
          fnProc.storeF32Idx(V_PHASE1, () => fnProc.localGet(v), () => fnProc.localGet(ph1));
          fnProc.storeF32Idx(V_PHASE2, () => fnProc.localGet(v), () => fnProc.localGet(ph2));
          fnProc.storeF32Idx(V_PHASE_SUB, () => fnProc.localGet(v), () => fnProc.localGet(phSub));
          fnProc.storeF32Idx(V_ENV_LEVEL, () => fnProc.localGet(v), () => fnProc.localGet(eLvl));
          fnProc.storeF32Idx(V_FENV_LEVEL, () => fnProc.localGet(v), () => fnProc.localGet(feLvl));
          fnProc.storeF32Idx(V_IC1, () => fnProc.localGet(v), () => fnProc.localGet(ic1));
          fnProc.storeF32Idx(V_IC2, () => fnProc.localGet(v), () => fnProc.localGet(ic2));
          fnProc.storeF32Idx(V_IC3, () => fnProc.localGet(v), () => fnProc.localGet(ic3));
          fnProc.storeF32Idx(V_IC4, () => fnProc.localGet(v), () => fnProc.localGet(ic4));
          fnProc.storeF32Idx(V_A1, () => fnProc.localGet(v), () => fnProc.localGet(va1));
          fnProc.storeF32Idx(V_A2, () => fnProc.localGet(v), () => fnProc.localGet(va2));
          fnProc.storeF32Idx(V_A3, () => fnProc.localGet(v), () => fnProc.localGet(va3));
          fnProc.storeF32Idx(V_A1_2, () => fnProc.localGet(v), () => fnProc.localGet(va1_2));
          fnProc.storeF32Idx(V_A2_2, () => fnProc.localGet(v), () => fnProc.localGet(va2_2));
          fnProc.storeF32Idx(V_A3_2, () => fnProc.localGet(v), () => fnProc.localGet(va3_2));
          fnProc.storeF32Idx(V_B0, () => fnProc.localGet(v), () => fnProc.localGet(nb0));
          fnProc.storeF32Idx(V_B1, () => fnProc.localGet(v), () => fnProc.localGet(nb1));
          fnProc.storeF32Idx(V_B2, () => fnProc.localGet(v), () => fnProc.localGet(nb2));
        });
      });

      // 5. Post-voice Gain, LFO Amp, EQ 4-bandas, DC Blocker y Soft Clipper pre-FX
      fnProc.loadF32At(M_GAIN_L).localSet(gainL);
      fnProc.loadF32At(M_GAIN_R).localSet(gainR);
      fnProc.loadI32At(M_EQ_ENABLED).localSet(eqEn);
      fnProc.loadF32At(M_DC_IN_L).localSet(dcInL);
      fnProc.loadF32At(M_DC_OUT_L).localSet(dcOutL);
      fnProc.loadF32At(M_DC_IN_R).localSet(dcInR);
      fnProc.loadF32At(M_DC_OUT_R).localSet(dcOutR);

      fnProc.forLoop(s, () => fnProc.localGet(blockSize), () => {
        fnProc.f32Const(1.0).localSet(lfoAmpGain);
        fnProc.localGet(isLfoActive).localGet(lfoTargetCode).i32Const(2).i32Eq().i32And().ifBlock(BLK_VOID, () => {
          fnProc.f32Const(1.0).localGet(lfoDepth).f32Const(0.5).f32Mul();
          fnProc.f32Const(1.0).loadF32Idx(M_LFO_BUF, () => fnProc.localGet(s)).f32Sub().f32Mul().f32Sub();
          fnProc.f32Const(0.0).f32Max().localSet(lfoAmpGain);
        });

        fnProc.loadF32Idx(M_OUT_L, () => fnProc.localGet(s)).localGet(gainL).f32Mul().localGet(lfoAmpGain).f32Mul().localSet(fL);
        fnProc.loadF32Idx(M_OUT_R, () => fnProc.localGet(s)).localGet(gainR).f32Mul().localGet(lfoAmpGain).f32Mul().localSet(fR);

        fnProc.localGet(eqEn).ifBlock(BLK_VOID, () => {
          fnProc.forLoop(b, () => fnProc.i32Const(4), () => {
            fnProc.loadI32Idx(M_EQ_BYPASS, () => fnProc.localGet(b)).i32Eqz().ifBlock(BLK_VOID, () => {
              // yL = b0 * fL + eqL1[b]
              fnProc.loadF32Idx(M_EQ_B0, () => fnProc.localGet(b)).localGet(fL).f32Mul();
              fnProc.loadF32Idx(M_EQ_L1, () => fnProc.localGet(b)).f32Add().localSet(yEq);
              // eqL1[b] = b1 * fL - a1 * yEq + eqL2[b]
              fnProc.storeF32Idx(M_EQ_L1, () => fnProc.localGet(b), () => {
                fnProc.loadF32Idx(M_EQ_B1, () => fnProc.localGet(b)).localGet(fL).f32Mul();
                fnProc.loadF32Idx(M_EQ_A1, () => fnProc.localGet(b)).localGet(yEq).f32Mul().f32Sub();
                fnProc.loadF32Idx(M_EQ_L2, () => fnProc.localGet(b)).f32Add();
              });
              // eqL2[b] = b2 * fL - a2 * yEq
              fnProc.storeF32Idx(M_EQ_L2, () => fnProc.localGet(b), () => {
                fnProc.loadF32Idx(M_EQ_B2, () => fnProc.localGet(b)).localGet(fL).f32Mul();
                fnProc.loadF32Idx(M_EQ_A2, () => fnProc.localGet(b)).localGet(yEq).f32Mul().f32Sub();
              });
              fnProc.localGet(yEq).localSet(fL);

              // yR = b0 * fR + eqR1[b]
              fnProc.loadF32Idx(M_EQ_B0, () => fnProc.localGet(b)).localGet(fR).f32Mul();
              fnProc.loadF32Idx(M_EQ_R1, () => fnProc.localGet(b)).f32Add().localSet(yEq);
              fnProc.storeF32Idx(M_EQ_R1, () => fnProc.localGet(b), () => {
                fnProc.loadF32Idx(M_EQ_B1, () => fnProc.localGet(b)).localGet(fR).f32Mul();
                fnProc.loadF32Idx(M_EQ_A1, () => fnProc.localGet(b)).localGet(yEq).f32Mul().f32Sub();
                fnProc.loadF32Idx(M_EQ_R2, () => fnProc.localGet(b)).f32Add();
              });
              fnProc.storeF32Idx(M_EQ_R2, () => fnProc.localGet(b), () => {
                fnProc.loadF32Idx(M_EQ_B2, () => fnProc.localGet(b)).localGet(fR).f32Mul();
                fnProc.loadF32Idx(M_EQ_A2, () => fnProc.localGet(b)).localGet(yEq).f32Mul().f32Sub();
              });
              fnProc.localGet(yEq).localSet(fR);
            });
          });
        });

        // DC blocker L/R
        fnProc.localGet(fL).localGet(dcInL).f32Sub().f32Const(0.9975).localGet(dcOutL).f32Mul().f32Add().localSet(dcTmp);
        fnProc.localGet(fL).localSet(dcInL);
        fnProc.localGet(dcTmp).localSet(dcOutL);
        fnProc.localGet(dcTmp).localSet(fL);

        fnProc.localGet(fR).localGet(dcInR).f32Sub().f32Const(0.9975).localGet(dcOutR).f32Mul().f32Add().localSet(dcTmp);
        fnProc.localGet(fR).localSet(dcInR);
        fnProc.localGet(dcTmp).localSet(dcOutR);
        fnProc.localGet(dcTmp).localSet(fR);

        // Soft clipper pre-FX (sólo cuando algún FX está activo; en seco fnApplyFx realiza el soft clip único 1:1)
        fnProc.loadI32At(M_FX_CHORUS_ENABLED)
          .loadI32At(M_FX_DELAY_ENABLED).i32Or()
          .loadI32At(M_FX_REV_ENABLED).i32Or()
          .i32Const(0).i32Ne().ifBlock(BLK_VOID, () => {
            fnProc.localGet(fL).f32Abs().localTee(dcTmp).f32Const(0.80).f32Gt().ifBlock(BLK_VOID, () => {
              fnProc.f32Const(-1.0).f32Const(1.0).localGet(fL).f32Const(0.0).f32Lt().select();
              fnProc.f32Const(0.80).f32Const(0.18).localGet(dcTmp).f32Const(0.80).f32Sub().f32Const(1.0 / 0.18).f32Mul().callFn(fnTanh).f32Mul().f32Add().f32Mul().localSet(fL);
            });
            fnProc.localGet(fR).f32Abs().localTee(dcTmp).f32Const(0.80).f32Gt().ifBlock(BLK_VOID, () => {
              fnProc.f32Const(-1.0).f32Const(1.0).localGet(fR).f32Const(0.0).f32Lt().select();
              fnProc.f32Const(0.80).f32Const(0.18).localGet(dcTmp).f32Const(0.80).f32Sub().f32Const(1.0 / 0.18).f32Mul().callFn(fnTanh).f32Mul().f32Add().f32Mul().localSet(fR);
            });
          });

        fnProc.storeF32Idx(M_OUT_L, () => fnProc.localGet(s), () => fnProc.localGet(fL));
        fnProc.storeF32Idx(M_OUT_R, () => fnProc.localGet(s), () => fnProc.localGet(fR));
      });

      fnProc.storeF32At(M_DC_IN_L, () => fnProc.localGet(dcInL));
      fnProc.storeF32At(M_DC_OUT_L, () => fnProc.localGet(dcOutL));
      fnProc.storeF32At(M_DC_IN_R, () => fnProc.localGet(dcInR));
      fnProc.storeF32At(M_DC_OUT_R, () => fnProc.localGet(dcOutR));
    }); // end activeCount > 0

    // 6. Cadena Stereo FX Integrada + Límite & Medición de Pico
    fnProc.localGet(blockSize).callFn(fnApplyFx).localSet(blockPeak);

    // 7. Avanzar currentSample y actualizar estado de sueño auto-FX
    fnProc.storeI32At(M_CURRENT_SAMPLE, () => fnProc.localGet(baseSample).localGet(blockSize).i32Add());

    fnProc.localGet(activeCount).i32Eqz().localGet(blockPeak).f32Const(1e-5).f32Lt().i32And().ifBlock(
      BLK_VOID,
      () => {
        // Calcular max(graceBlocks) según FX activos para NO cortar delays ni colas de reverb
        fnProc.i32Const(0).localSet(graceBlocks);
        fnProc.loadI32At(M_FX_CHORUS_ENABLED).ifBlock(BLK_VOID, () => fnProc.i32Const(2).localSet(graceBlocks));
        fnProc.loadI32At(M_FX_REV_ENABLED).ifBlock(BLK_VOID, () => fnProc.i32Const(16).localSet(graceBlocks));
        fnProc.loadI32At(M_FX_DELAY_ENABLED).ifBlock(BLK_VOID, () => {
          fnProc.loadF32At(M_FX_DELAY_SAMPLES).f32Const(128.0).f32Div().i32TruncF32S().i32Const(8).i32Add().localSet(silentCount);
          fnProc.localGet(silentCount).localGet(graceBlocks).i32GtS().ifBlock(BLK_VOID, () => {
            fnProc.localGet(silentCount).localSet(graceBlocks);
          });
        });

        fnProc.loadI32At(M_FX_SILENT_BLOCKS).i32Const(1).i32Add().localSet(silentCount);
        fnProc.storeI32At(M_FX_SILENT_BLOCKS, () => fnProc.localGet(silentCount));
        fnProc.localGet(silentCount).localGet(graceBlocks).i32GtS().ifBlock(BLK_VOID, () => {
          fnProc.storeI32At(M_FX_TAIL_SILENT, () => fnProc.i32Const(1));
        });
      },
      () => {
        fnProc.storeI32At(M_FX_SILENT_BLOCKS, () => fnProc.i32Const(0));
      }
    );

    fnProc.i32Const(1);
  }

  return mod.build();
}

function main() {
  const bytes = buildPhosphorWasmBinary();
  const isValid = WebAssembly.validate(bytes);
  console.log(`[build-phosphor-wasm] Generated ${bytes.length} bytes | WebAssembly.validate = ${isValid}`);
  if (!isValid) {
    try {
      new WebAssembly.Module(bytes as BufferSource);
    } catch (err) {
      console.error('❌ CompileError:', err);
    }
    console.error('❌ Generated WASM binary failed WebAssembly.validate!');
    process.exit(1);
  }

  const rootDir = process.cwd();
  const wasmPath = path.join(rootDir, 'public', 'worklets', 'phosphor-dsp.wasm');
  fs.mkdirSync(path.dirname(wasmPath), { recursive: true });
  fs.writeFileSync(wasmPath, bytes);

  const base64 = Buffer.from(bytes).toString('base64');
  const tsContent = `/**
 * phosphorDspWasmBytes.ts
 * Binario WebAssembly precompilado (auto-generado por scripts/build-phosphor-wasm.ts).
 * Tamaño: ${bytes.length} bytes (${WASM_MEMORY_PAGES} páginas de memoria por instancia).
 */

const WASM_BASE64 = '${base64}';

function decodeBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const NodeBuffer = (globalThis as { Buffer?: { from(data: string, encoding: string): Uint8Array } }).Buffer;
  if (NodeBuffer && typeof NodeBuffer.from === 'function') {
    const buf = NodeBuffer.from(b64, 'base64');
    const out = new Uint8Array(new ArrayBuffer(buf.length));
    out.set(buf);
    return out;
  }
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export const PHOSPHOR_DSP_WASM_BYTES: Uint8Array<ArrayBuffer> = decodeBase64ToUint8Array(WASM_BASE64);
`;
  const tsPath = path.join(rootDir, 'src', 'core', 'audio', 'wasm', 'phosphorDspWasmBytes.ts');
  fs.writeFileSync(tsPath, tsContent, 'utf8');
  console.log(`[build-phosphor-wasm] Wrote ${wasmPath} & ${tsPath}`);
}

main();
