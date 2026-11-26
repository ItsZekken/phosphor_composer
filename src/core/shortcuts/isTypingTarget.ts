/**
 * Helpers centralizados para evitar disparar atajos mientras el usuario escribe
 * o cuando un modal bloqueante (Ajustes / Sintetizador) está abierto.
 */

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  ) {
    return true;
  }
  return Boolean(target.closest('[contenteditable="true"]'));
}

export function isModalBlockingShortcuts(state: {
  isSynthModalOpen?: boolean;
  isSoundFontModalOpen?: boolean;
  isSettingsOpen?: boolean;
  commandPaletteMode?: string;
}): boolean {
  return Boolean(
    state.isSynthModalOpen ||
      state.isSoundFontModalOpen ||
      state.isSettingsOpen ||
      (state.commandPaletteMode && state.commandPaletteMode !== 'closed')
  );
}
