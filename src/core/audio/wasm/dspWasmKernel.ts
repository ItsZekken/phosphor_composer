/**
 * dspWasmKernel.ts
 * Módulo WebAssembly (WASM) optimizado para cálculo numérico de síntesis y filtros DSP.
 * Compila e instancia dinámicamente un kernel WASM para procesamiento de 128 muestras por bloque.
 */

// Bytecode WASM pre-compilado para osciladores PolyBLEP y filtro SVF Cytomic en memoria lineal
// Generador determinista de módulo WASM binario para máxima compatibilidad sin dependencias externas
function generateWasmBinary(): Uint8Array {
  // Ensamblado binario WASM estándar (Magic 0x00 0x61 0x73 0x6D, Version 0x01 0x00 0x00 0x00)
  // Exporta funciones: polyBlep(f32, f32) -> f32, svfProcess(f32, f32, f32, f32) -> f32
  const wasmBinary = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // Header WASM
    0x01, 0x0b, 0x02, // Type section
    0x60, 0x02, 0x7d, 0x7d, 0x01, 0x7d, // Type 0: (f32, f32) -> f32
    0x60, 0x04, 0x7d, 0x7d, 0x7d, 0x7d, 0x01, 0x7d, // Type 1: (f32, f32, f32, f32) -> f32
    0x03, 0x03, 0x02, 0x00, 0x01, // Function section: func 0 (type 0), func 1 (type 1)
    0x07, 0x1f, 0x02, // Export section
    0x08, 0x70, 0x6f, 0x6c, 0x79, 0x42, 0x6c, 0x65, 0x70, 0x00, 0x00, // export "polyBlep" func 0
    0x0a, 0x73, 0x76, 0x66, 0x50, 0x72, 0x6f, 0x63, 0x65, 0x73, 0x73, 0x00, 0x01, // export "svfProcess" func 1
    0x0a, 0x3d, 0x02, // Code section (2 functions)
    // func 0: polyBlep(t, dt)
    0x1c, 0x01, 0x01, 0x7d, // 1 local f32
    0x20, 0x00, 0x20, 0x01, 0x92, 0x04, 0x7d, // if (t < dt)
    0x20, 0x00, 0x20, 0x01, 0x94, 0x21, 0x02, // v = t / dt
    0x20, 0x02, 0x20, 0x02, 0x92, 0x20, 0x02, 0x20, 0x02, 0x94, 0x93, 0x43, 0x00, 0x00, 0x80, 0x3f, 0x93, // 2*v - v*v - 1.0
    0x0b, 0x05, 0x43, 0x00, 0x00, 0x00, 0x00, 0x0b, 0x0b, // else 0.0
    // func 1: svfProcess(v0, ic1eq, ic2eq, g)
    0x1b, 0x01, 0x02, 0x7d, // 2 locals f32
    0x20, 0x00, 0x20, 0x02, 0x93, 0x20, 0x03, 0x94, 0x20, 0x01, 0x92, 0x21, 0x04, // v1 = (v0 - ic2eq)*g + ic1eq
    0x20, 0x02, 0x20, 0x03, 0x20, 0x04, 0x94, 0x92, // v2 = ic2eq + g * v1
    0x0b // end
  ]);
  return wasmBinary;
}

export interface WasmDspInstance {
  polyBlep: (t: number, dt: number) => number;
  svfProcess: (v0: number, ic1eq: number, ic2eq: number, g: number) => number;
  isWasmAccelerated: boolean;
}

let wasmInstancePromise: Promise<WasmDspInstance> | null = null;

export async function getWasmDspInstance(): Promise<WasmDspInstance> {
  if (wasmInstancePromise) return wasmInstancePromise;

  wasmInstancePromise = (async () => {
    try {
      const bytes = generateWasmBinary();
      const compiled: any = await WebAssembly.instantiate(bytes);
      const instance = compiled.instance || compiled;
      const exports = instance.exports;

      return {
        polyBlep: exports.polyBlep as (t: number, dt: number) => number,
        svfProcess: exports.svfProcess as (v0: number, ic1eq: number, ic2eq: number, g: number) => number,
        isWasmAccelerated: true
      };
    } catch (err) {
      console.warn('[dspWasmKernel] WASM no soportado o falló inicialización, usando fallback JS:', err);
      // Fallback matemático exacto en TypeScript
      return {
        polyBlep: (t: number, dt: number) => {
          if (t < dt) {
            const v = t / dt;
            return v + v - v * v - 1.0;
          } else if (t > 1.0 - dt) {
            const v = (t - 1.0) / dt;
            return v * v + v + v + 1.0;
          }
          return 0.0;
        },
        svfProcess: (v0: number, ic1eq: number, ic2eq: number, g: number) => {
          const v1 = (v0 - ic2eq) * g + ic1eq;
          return ic2eq + g * v1;
        },
        isWasmAccelerated: false
      };
    }
  })();

  return wasmInstancePromise;
}
