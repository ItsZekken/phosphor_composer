/**
 * idGenerator.ts
 * Generador seguro de identificadores únicos para bloques, notas, pistas y canales.
 */

export function generateId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    return `${prefix}_${uuid}`;
  }
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${randomPart}`;
}
