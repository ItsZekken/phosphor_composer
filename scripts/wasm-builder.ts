/**
 * scripts/wasm-builder.ts
 * Ensamblador determinista y tipado de módulos binarios WebAssembly 1.0 (zero dependencies).
 * Emite código máquina WASM estándar con validación de estructura de bloques y LEB128 exacto.
 */

export const VAL_I32 = 0x7f;
export const VAL_F32 = 0x7d;
export const BLK_VOID = 0x40;
export const BLK_I32 = 0x7f;
export const BLK_F32 = 0x7d;

export type WasmValType = typeof VAL_I32 | typeof VAL_F32;
export type WasmBlockType = typeof BLK_VOID | typeof BLK_I32 | typeof BLK_F32;

const f32Scratch = new ArrayBuffer(4);
const f32View = new DataView(f32Scratch);

export function pushUleb(out: number[], value: number): void {
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
}

export function pushSleb(out: number[], value: number): void {
  let v = value | 0;
  let more = true;
  while (more) {
    let b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) {
      more = false;
    } else {
      b |= 0x80;
    }
    out.push(b);
  }
}

export function pushStr(out: number[], str: string): void {
  const bytes = new TextEncoder().encode(str);
  pushUleb(out, bytes.length);
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
}

export function encodeSection(id: number, payload: number[]): number[] {
  const out: number[] = [id];
  pushUleb(out, payload.length);
  for (let i = 0; i < payload.length; i++) out.push(payload[i]);
  return out;
}

export class FnBuilder {
  public readonly name: string;
  public readonly params: WasmValType[];
  public readonly results: WasmValType[];
  public readonly extraLocals: WasmValType[] = [];
  public readonly code: number[] = [];
  public exportName: string | null = null;
  public fnIndex = -1;

  constructor(name: string, params: WasmValType[], results: WasmValType[], exportName: string | null = null) {
    this.name = name;
    this.params = params;
    this.results = results;
    this.exportName = exportName;
  }

  public addLocal(type: WasmValType): number {
    const idx = this.params.length + this.extraLocals.length;
    this.extraLocals.push(type);
    return idx;
  }

  public op(opcode: number): this {
    this.code.push(opcode);
    return this;
  }

  public i32Const(val: number): this {
    this.code.push(0x41);
    pushSleb(this.code, val | 0);
    return this;
  }

  public f32Const(val: number): this {
    this.code.push(0x43);
    f32View.setFloat32(0, val, true);
    this.code.push(f32View.getUint8(0), f32View.getUint8(1), f32View.getUint8(2), f32View.getUint8(3));
    return this;
  }

  public localGet(idx: number): this {
    this.code.push(0x20);
    pushUleb(this.code, idx);
    return this;
  }

  public localSet(idx: number): this {
    this.code.push(0x21);
    pushUleb(this.code, idx);
    return this;
  }

  public localTee(idx: number): this {
    this.code.push(0x22);
    pushUleb(this.code, idx);
    return this;
  }

  // Carga/escritura en memoria lineal (addr en el tope del stack)
  public i32Load(offset = 0, align = 2): this {
    this.code.push(0x28);
    pushUleb(this.code, align);
    pushUleb(this.code, offset >>> 0);
    return this;
  }

  public f32Load(offset = 0, align = 2): this {
    this.code.push(0x2a);
    pushUleb(this.code, align);
    pushUleb(this.code, offset >>> 0);
    return this;
  }

  public i32Store(offset = 0, align = 2): this {
    this.code.push(0x36);
    pushUleb(this.code, align);
    pushUleb(this.code, offset >>> 0);
    return this;
  }

  public f32Store(offset = 0, align = 2): this {
    this.code.push(0x38);
    pushUleb(this.code, align);
    pushUleb(this.code, offset >>> 0);
    return this;
  }

  // Helpers de acceso directo a dirección constante (0 base + offset)
  public loadI32At(byteOffset: number): this {
    this.i32Const(0);
    return this.i32Load(byteOffset, 2);
  }

  public loadF32At(byteOffset: number): this {
    this.i32Const(0);
    return this.f32Load(byteOffset, 2);
  }

  public storeI32At(byteOffset: number, valueEmit: () => void): this {
    this.i32Const(0);
    valueEmit();
    return this.i32Store(byteOffset, 2);
  }

  public storeF32At(byteOffset: number, valueEmit: () => void): this {
    this.i32Const(0);
    valueEmit();
    return this.f32Store(byteOffset, 2);
  }

  // Arreglos SoA indexados por (index << 2) + baseOffset
  public loadI32Idx(baseOffset: number, emitIdx: () => void): this {
    emitIdx();
    this.i32Const(2).i32Shl();
    return this.i32Load(baseOffset, 2);
  }

  public loadF32Idx(baseOffset: number, emitIdx: () => void): this {
    emitIdx();
    this.i32Const(2).i32Shl();
    return this.f32Load(baseOffset, 2);
  }

  public storeI32Idx(baseOffset: number, emitIdx: () => void, emitVal: () => void): this {
    emitIdx();
    this.i32Const(2).i32Shl();
    emitVal();
    return this.i32Store(baseOffset, 2);
  }

  public storeF32Idx(baseOffset: number, emitIdx: () => void, emitVal: () => void): this {
    emitIdx();
    this.i32Const(2).i32Shl();
    emitVal();
    return this.f32Store(baseOffset, 2);
  }

  // Control de flujo estructurado
  public block(type: WasmBlockType, body: () => void): this {
    this.code.push(0x02, type);
    body();
    this.code.push(0x0b);
    return this;
  }

  public loop(type: WasmBlockType, body: () => void): this {
    this.code.push(0x03, type);
    body();
    this.code.push(0x0b);
    return this;
  }

  public ifBlock(type: WasmBlockType, thenBody: () => void, elseBody?: () => void): this {
    this.code.push(0x04, type);
    thenBody();
    if (elseBody) {
      this.code.push(0x05);
      elseBody();
    }
    this.code.push(0x0b);
    return this;
  }

  public br(depth: number): this {
    this.code.push(0x0c);
    pushUleb(this.code, depth);
    return this;
  }

  public brIf(depth: number): this {
    this.code.push(0x0d);
    pushUleb(this.code, depth);
    return this;
  }

  public ret(): this { return this.op(0x0f); }
  public callFn(fn: FnBuilder): this {
    this.code.push(0x10);
    pushUleb(this.code, fn.fnIndex);
    return this;
  }
  public drop(): this { return this.op(0x1a); }
  public select(): this { return this.op(0x1b); }

  // Operadores i32
  public i32Eqz(): this { return this.op(0x45); }
  public i32Eq(): this { return this.op(0x46); }
  public i32Ne(): this { return this.op(0x47); }
  public i32LtS(): this { return this.op(0x48); }
  public i32LtU(): this { return this.op(0x49); }
  public i32GtS(): this { return this.op(0x4a); }
  public i32GtU(): this { return this.op(0x4b); }
  public i32LeS(): this { return this.op(0x4c); }
  public i32GeS(): this { return this.op(0x4e); }
  public i32Add(): this { return this.op(0x6a); }
  public i32Sub(): this { return this.op(0x6b); }
  public i32Mul(): this { return this.op(0x6c); }
  public i32DivS(): this { return this.op(0x6d); }
  public i32RemS(): this { return this.op(0x6f); }
  public i32And(): this { return this.op(0x71); }
  public i32Or(): this { return this.op(0x72); }
  public i32Xor(): this { return this.op(0x73); }
  public i32Shl(): this { return this.op(0x74); }
  public i32ShrS(): this { return this.op(0x75); }
  public i32ShrU(): this { return this.op(0x76); }

  // Operadores f32
  public f32Eq(): this { return this.op(0x5b); }
  public f32Ne(): this { return this.op(0x5c); }
  public f32Lt(): this { return this.op(0x5d); }
  public f32Gt(): this { return this.op(0x5e); }
  public f32Le(): this { return this.op(0x5f); }
  public f32Ge(): this { return this.op(0x60); }
  public f32Abs(): this { return this.op(0x8b); }
  public f32Neg(): this { return this.op(0x8c); }
  public f32Ceil(): this { return this.op(0x8d); }
  public f32Floor(): this { return this.op(0x8e); }
  public f32Trunc(): this { return this.op(0x8f); }
  public f32Sqrt(): this { return this.op(0x91); }
  public f32Add(): this { return this.op(0x92); }
  public f32Sub(): this { return this.op(0x93); }
  public f32Mul(): this { return this.op(0x94); }
  public f32Div(): this { return this.op(0x95); }
  public f32Min(): this { return this.op(0x96); }
  public f32Max(): this { return this.op(0x97); }

  // Conversiones
  public i32TruncF32S(): this { return this.op(0xa8); }
  public i32ReinterpretF32(): this { return this.op(0xbc); }
  public f32ConvertI32S(): this { return this.op(0xb2); }
  public f32ReinterpretI32(): this { return this.op(0xbe); }

  // Loop incremental estándar: for (var = 0; var < count; var++)
  public forLoop(idxLocal: number, emitCount: () => void, body: () => void): this {
    this.i32Const(0).localSet(idxLocal);
    this.block(BLK_VOID, () => {
      this.loop(BLK_VOID, () => {
        this.localGet(idxLocal);
        emitCount();
        this.i32GeS().brIf(1);
        body();
        this.localGet(idxLocal).i32Const(1).i32Add().localSet(idxLocal);
        this.br(0);
      });
    });
    return this;
  }

  public compileBody(): number[] {
    // Agrupar extraLocals contiguos del mismo tipo
    const runs: Array<{ count: number; type: WasmValType }> = [];
    for (const t of this.extraLocals) {
      if (runs.length > 0 && runs[runs.length - 1].type === t) {
        runs[runs.length - 1].count++;
      } else {
        runs.push({ count: 1, type: t });
      }
    }

    const body: number[] = [];
    pushUleb(body, runs.length);
    for (const r of runs) {
      pushUleb(body, r.count);
      body.push(r.type);
    }
    for (let i = 0; i < this.code.length; i++) body.push(this.code[i]);
    body.push(0x0b); // end function
    return body;
  }
}

export class WasmModuleBuilder {
  private readonly memoryPages: number;
  private readonly functions: FnBuilder[] = [];

  constructor(memoryPages: number) {
    this.memoryPages = memoryPages;
  }

  public addFunction(
    name: string,
    params: WasmValType[],
    results: WasmValType[],
    exportName: string | null = null
  ): FnBuilder {
    const fn = new FnBuilder(name, params, results, exportName);
    fn.fnIndex = this.functions.length;
    this.functions.push(fn);
    return fn;
  }

  public build(): Uint8Array {
    // 1. Type section (deduplicated signatures)
    const sigKey = (p: WasmValType[], r: WasmValType[]) => `${p.join(',')}|${r.join(',')}`;
    const sigMap = new Map<string, number>();
    const sigs: Array<{ params: WasmValType[]; results: WasmValType[] }> = [];
    const fnTypeIndices: number[] = [];

    for (const fn of this.functions) {
      const k = sigKey(fn.params, fn.results);
      let idx = sigMap.get(k);
      if (idx === undefined) {
        idx = sigs.length;
        sigMap.set(k, idx);
        sigs.push({ params: fn.params, results: fn.results });
      }
      fnTypeIndices.push(idx);
    }

    const typePayload: number[] = [];
    pushUleb(typePayload, sigs.length);
    for (const s of sigs) {
      typePayload.push(0x60);
      pushUleb(typePayload, s.params.length);
      for (const pt of s.params) typePayload.push(pt);
      pushUleb(typePayload, s.results.length);
      for (const rt of s.results) typePayload.push(rt);
    }

    // 3. Function section
    const funcPayload: number[] = [];
    pushUleb(funcPayload, fnTypeIndices.length);
    for (const idx of fnTypeIndices) pushUleb(funcPayload, idx);

    // 5. Memory section (1 internal memory, no max bound or minPages)
    const memPayload: number[] = [];
    pushUleb(memPayload, 1);
    memPayload.push(0x00); // flags: min only
    pushUleb(memPayload, this.memoryPages);

    // 7. Export section ("memory" + exported functions)
    const exportedFns = this.functions.filter((f) => f.exportName !== null);
    const expPayload: number[] = [];
    pushUleb(expPayload, 1 + exportedFns.length);
    pushStr(expPayload, 'memory');
    expPayload.push(0x02, 0x00); // memory 0
    for (const fn of exportedFns) {
      pushStr(expPayload, fn.exportName!);
      expPayload.push(0x00);
      pushUleb(expPayload, fn.fnIndex);
    }

    // 10. Code section
    const codePayload: number[] = [];
    pushUleb(codePayload, this.functions.length);
    for (const fn of this.functions) {
      const body = fn.compileBody();
      pushUleb(codePayload, body.length);
      for (let i = 0; i < body.length; i++) codePayload.push(body[i]);
    }

    const bytes: number[] = [
      0x00, 0x61, 0x73, 0x6d, // \0asm
      0x01, 0x00, 0x00, 0x00, // version 1
      ...encodeSection(1, typePayload),
      ...encodeSection(3, funcPayload),
      ...encodeSection(5, memPayload),
      ...encodeSection(7, expPayload),
      ...encodeSection(10, codePayload)
    ];

    return new Uint8Array(bytes);
  }
}
