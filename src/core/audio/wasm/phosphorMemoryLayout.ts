/**
 * phosphorMemoryLayout.ts
 * Única fuente de verdad del mapa de memoria lineal de WebAssembly (WASM) para
 * Phosphor Synth + Integrated Stereo FX (Chorus, Damped Delay, Jezar Freeverb).
 * Compartido entre el compilador (`scripts/build-phosphor-wasm.ts`) y el runtime (`PhosphorWasmDSP.ts`).
 */

export const WASM_MAX_VOICES = 32;
export const WASM_BLOCK_SIZE = 128;

// Tamaños de ring buffers de efectos (potencias de 2 para enmascarado por bit)
export const CHORUS_BUF_LEN = 4096;
export const CHORUS_BUF_MASK = CHORUS_BUF_LEN - 1;

export const DELAY_BUF_LEN = 131072; // ~2.73s @ 48kHz
export const DELAY_BUF_MASK = DELAY_BUF_LEN - 1;

export const REV_NUM_COMBS_PER_CH = 8;
export const REV_TOTAL_COMBS = 16;
export const REV_COMB_STRIDE = 2048; // f32 elements per comb
export const REV_COMB_STRIDE_BYTES = REV_COMB_STRIDE * 4;

export const REV_NUM_AP_PER_CH = 4;
export const REV_TOTAL_APS = 8;
export const REV_AP_STRIDE = 1024; // f32 elements per allpass
export const REV_AP_STRIDE_BYTES = REV_AP_STRIDE * 4;

// ================= ESTADO INTERNO Y PARÁMETROS (0 .. 1023) =================
export const M_SAMPLE_RATE = 0;         // f32
export const M_DT_BASE = 4;             // f32
export const M_CURRENT_SAMPLE = 8;      // i32
export const M_AGE_COUNTER = 12;        // i32
export const M_RNG_STATE = 16;          // i32
export const M_LFO_PHASE = 20;          // f32
export const M_LFO_RAND_VAL = 24;       // f32
export const M_DC_IN_L = 28;            // f32
export const M_DC_OUT_L = 32;           // f32
export const M_DC_IN_R = 36;            // f32
export const M_DC_OUT_R = 40;           // f32
export const M_FX_TAIL_SILENT = 44;     // i32 (1 = silent, 0 = active tail)

// Osciladores y ruido
export const M_OSC1_WAVE_CODE = 64;     // i32 (0:sin, 1:saw, 2:sq, 3:tri)
export const M_OSC1_VOL = 68;           // f32
export const M_OSC1_PITCH_FACTOR = 72;  // f32
export const M_OSC2_ENABLED = 76;       // i32
export const M_OSC2_WAVE_CODE = 80;     // i32
export const M_OSC2_VOL = 84;           // f32
export const M_OSC2_PITCH_FACTOR = 88;  // f32
export const M_SUB_ENABLED = 92;        // i32
export const M_SUB_WAVE_CODE = 96;      // i32
export const M_SUB_VOL = 100;           // f32
export const M_SUB_PITCH_FACTOR = 104;  // f32
export const M_NOISE_ENABLED = 108;     // i32
export const M_NOISE_TYPE_CODE = 112;   // i32 (0:white, 1:pink)
export const M_NOISE_VOL = 116;         // f32
export const M_OSC_NORM = 120;          // f32

// Filtro SVF & Saturación
export const M_FILTER_ENABLED = 124;    // i32
export const M_FILTER_TYPE_CODE = 128;  // i32 (0:lp, 1:bp, 2:hp, 3:notch)
export const M_FILTER_FREQ = 132;       // f32
export const M_FILTER_Q = 136;          // f32
export const M_FILTER_FOUR_POLE = 140;  // i32
export const M_FILTER_DRIVE = 144;      // f32
export const M_FILTER_DRIVE_ACTIVE = 148; // i32
export const M_FILTER_DRIVE_TYPE = 152; // i32 (0:tube, 1:tape, 2:fuzz, 3:warm)
export const M_FILTER_ENV_AMT = 156;    // f32
export const M_FILTER_KEY_TRACK = 160;  // f32
export const M_GLIDE_FACTOR = 164;      // f32

// Envolvente Amp & Filtro (coeficientes precalculados por bloque/cambio)
export const M_ATTACK_STEP = 168;       // f32
export const M_DECAY_FACTOR = 172;      // f32
export const M_SUSTAIN = 176;           // f32
export const M_RELEASE_FACTOR = 180;    // f32
export const M_F_ATTACK_STEP = 184;     // f32
export const M_F_DECAY_FACTOR = 188;    // f32
export const M_F_SUSTAIN = 192;         // f32
export const M_F_RELEASE_FACTOR = 196;  // f32

// LFO & Master
export const M_LFO_ENABLED = 200;       // i32
export const M_LFO_WAVE_CODE = 204;     // i32
export const M_LFO_STEP = 208;          // f32
export const M_LFO_DEPTH = 212;         // f32
export const M_LFO_TARGET_CODE = 216;   // i32 (0:cutoff, 1:pitch, 2:amp)
export const M_GAIN_L = 220;            // f32
export const M_GAIN_R = 224;            // f32
export const M_EQ_ENABLED = 228;        // i32
export const M_HAS_GLIDE = 232;         // i32
export const M_DRIVE_PRE_GAIN = 236;    // f32
export const M_DRIVE_POST_COMP = 240;   // f32
export const M_DRY_BASS_ANCHOR = 244;   // f32
export const M_WET_SAT_MIX = 248;       // f32

// EQ 4 bandas (offsets de base para arreglos de 4 elementos = 16 B)
export const M_EQ_BYPASS = 256;         // i32[4]
export const M_EQ_B0 = 272;             // f32[4]
export const M_EQ_B1 = 288;             // f32[4]
export const M_EQ_B2 = 304;             // f32[4]
export const M_EQ_A1 = 320;             // f32[4]
export const M_EQ_A2 = 336;             // f32[4]
export const M_EQ_L1 = 352;             // f32[4]
export const M_EQ_L2 = 368;             // f32[4]
export const M_EQ_R1 = 384;             // f32[4]
export const M_EQ_R2 = 400;             // f32[4]

// FX Rack Integrado (416 .. 767)
export const M_FX_CHORUS_ENABLED = 416; // i32
export const M_FX_CHORUS_RATE = 420;    // f32 (Hz)
export const M_FX_CHORUS_DEPTH = 424;   // f32 (0..1)
export const M_FX_CHORUS_MIX = 428;     // f32 (0..1)
export const M_FX_CHORUS_PHASE = 432;   // f32 (0..1)
export const M_FX_CHORUS_WRITE = 436;   // i32

export const M_FX_DELAY_ENABLED = 448;  // i32
export const M_FX_DELAY_SAMPLES = 452;  // f32
export const M_FX_DELAY_FEEDBACK = 456; // f32 (<= 0.75)
export const M_FX_DELAY_MIX = 460;      // f32 (<= 0.55)
export const M_FX_DELAY_DAMP = 464;     // f32 (0..0.95)
export const M_FX_DELAY_LP_L = 468;     // f32
export const M_FX_DELAY_LP_R = 472;     // f32
export const M_FX_DELAY_WRITE = 476;    // i32

export const M_FX_REV_ENABLED = 480;    // i32
export const M_FX_REV_ROOM = 484;       // f32 (feedback ~0.70..0.95)
export const M_FX_REV_DAMP1 = 488;      // f32
export const M_FX_REV_DAMP2 = 492;      // f32
export const M_FX_REV_MIX = 496;        // f32 (<= 0.55)
export const M_FX_SILENT_BLOCKS = 500;  // i32 (blocks in tail silence)

export const M_FX_REV_COMB_LEN = 512;   // i32[16] (64 B)
export const M_FX_REV_COMB_IDX = 576;   // i32[16] (64 B)
export const M_FX_REV_COMB_STORE = 640; // f32[16] (64 B)
export const M_FX_REV_AP_LEN = 704;     // i32[8]  (32 B)
export const M_FX_REV_AP_IDX = 736;     // i32[8]  (32 B)

// ================= VOCES SoA (32 voces * 4B = 128B/campo, base 1024..5119) =================
export const V_ACTIVE = 1024;       // i32[32]
export const V_MIDI = 1152;         // i32[32]
export const V_ENV_STAGE = 1280;    // i32[32] (0:idle, 1:pending, 2:attack, 3:decay, 4:sustain, 5:release)
export const V_FENV_STAGE = 1408;   // i32[32]
export const V_AGE = 1536;          // i32[32]
export const V_START_SAMPLE = 1664; // i32[32]
export const V_REL_SAMPLE = 1792;   // i32[32]
export const V_F_DIRTY = 1920;      // i32[32]

export const V_FREQ = 2048;         // f32[32]
export const V_TARGET_FREQ = 2176;  // f32[32]
export const V_VEL = 2304;          // f32[32]
export const V_VEL_GAIN = 2432;     // f32[32]
export const V_PHASE1 = 2560;       // f32[32]
export const V_PHASE2 = 2688;       // f32[32]
export const V_PHASE_SUB = 2816;    // f32[32]
export const V_ENV_LEVEL = 2944;    // f32[32]
export const V_FENV_LEVEL = 3072;   // f32[32]
export const V_IC1 = 3200;          // f32[32]
export const V_IC2 = 3328;          // f32[32]
export const V_IC3 = 3456;          // f32[32]
export const V_IC4 = 3584;          // f32[32]
export const V_PAN_L = 3712;        // f32[32]
export const V_PAN_R = 3840;        // f32[32]
export const V_A1 = 3968;           // f32[32]
export const V_A2 = 4096;           // f32[32]
export const V_A3 = 4224;           // f32[32]
export const V_A1_2 = 4352;         // f32[32]
export const V_A2_2 = 4480;         // f32[32]
export const V_A3_2 = 4608;         // f32[32]
export const V_B0 = 4736;           // f32[32]
export const V_B1 = 4864;           // f32[32]
export const V_B2 = 4992;           // f32[32]

// ================= BUFFERS DE BLOQUE (5120 .. 6655) =================
export const M_OUT_L = 5120;        // f32[128] (512 B)
export const M_OUT_R = 5632;        // f32[128] (512 B)
export const M_LFO_BUF = 6144;      // f32[128] (512 B)

// ================= RING BUFFERS DE EFECTOS =================
export const M_CHORUS_BUF_L = 8192;    // f32[4096] (16,384 B)
export const M_CHORUS_BUF_R = 24576;   // f32[4096] (16,384 B)
export const M_DELAY_BUF_L = 40960;    // f32[131072] (524,288 B)
export const M_DELAY_BUF_R = 565248;   // f32[131072] (524,288 B)
export const M_REV_COMB_BUF = 1089536; // f32[16 * 2048] (131,072 B)
export const M_REV_AP_BUF = 1220608;   // f32[8 * 1024] (32,768 B)
export const WASM_TOTAL_BYTES = 1253376;
export const WASM_MEMORY_PAGES = 20; // 20 * 65536 = 1,310,720 bytes

export const ENV_IDLE = 0;
export const ENV_PENDING = 1;
export const ENV_ATTACK = 2;
export const ENV_DECAY = 3;
export const ENV_SUSTAIN = 4;
export const ENV_RELEASE = 5;
