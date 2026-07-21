# Phosphor Composer

Secuenciador y generador de progresiones armónicas en el navegador con estética CRT retro.

## Características

- **Paleta Armónica & Chord Player**: Sugerencias de acordes (reposo, tensión, variaciones) según la tonalidad y escala seleccionada.
- **Piano Roll Interactivo**: Edición de notas en cuadrícula Canvas 2D con selección múltiple por lazo, arrastre y redimensionado.
- **Asistencia de IA (Magenta.js)**: Generación opcional de acompañamientos y sugerencias melódicas (ChordRNN / ImprovRNN).
- **Entrada MIDI y Micrófono**: Compatibilidad con dispositivos WebMIDI y captura mediante micrófono.
- **Motor de Audio**: Síntesis y playback en tiempo real con Tone.js.
- **Efectos CRT**: Overlay retro con scanlines y curva CRT configurable.

## Stack Técnico

- **Frontend**: React 19, TypeScript, Vite
- **Audio / Música**: Tone.js, @tonejs/midi, @magenta/music
- **Estado**: Zustand + Zundo (deshacer / rehacer)
- **UI / Iconos**: Lucide React, CSS puro

## Desarrollo

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev

# Compilar para producción
npm run build
```
