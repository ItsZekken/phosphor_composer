/**
 * SoundFontConfigModal.tsx
 * Rack interactivo de gestión y selección de patches SoundFont (.sf2, .sf3 y WebAudioFont .js/.json)
 * para Phosphor Composer. Permite subir SoundFonts propios, explorar bancos/patches, ajustar
 * ganancia/release/transposición, activar Chorus y Reverb estéreo y audicionar con teclado interactivo.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  X,
  Upload,
  Search,
  Trash2,
  Play,
  Volume2,
  HardDrive,
  Disc3,
  Package,
  AlertTriangle,
  Copy,
  ClipboardPaste,
  Check,
  RotateCcw,
  Waves,
  Compass,
  Sliders
} from 'lucide-react';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { toneEngine } from '../../audio/toneEngine';
import { importSoundFontFiles } from '../../core/session/projectFileImport';
import { formatPatchNumber } from '../../core/audio/soundfont/sf2Parser';
import { soundfontRegistry } from '../../core/audio/soundfont/soundfontRegistry';
import {
  DEFAULT_SOUNDFONT_CHORUS,
  DEFAULT_SOUNDFONT_REVERB
} from '../../core/audio/soundfont/soundfontFx';
import { getScaleNotes, type ScaleType } from '../../core/music';
import { notify } from '../../core/ui/toastBus';
import type {
  ChannelSoundFontConfig,
  SoundFontAsset,
  SoundFontChorusConfig,
  SoundFontPatchInfo,
  SoundFontReverbConfig
} from '../../utils/typeDefinitions';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const MINI_KEYBOARD_NOTES: Array<{ note: string; isBlack: boolean; label?: string }> = [
  { note: 'C3', isBlack: false, label: 'C3' },
  { note: 'C#3', isBlack: true },
  { note: 'D3', isBlack: false },
  { note: 'D#3', isBlack: true },
  { note: 'E3', isBlack: false },
  { note: 'F3', isBlack: false },
  { note: 'F#3', isBlack: true },
  { note: 'G3', isBlack: false },
  { note: 'G#3', isBlack: true },
  { note: 'A3', isBlack: false },
  { note: 'A#3', isBlack: true },
  { note: 'B3', isBlack: false },
  { note: 'C4', isBlack: false, label: 'C4' },
  { note: 'C#4', isBlack: true },
  { note: 'D4', isBlack: false },
  { note: 'D#4', isBlack: true },
  { note: 'E4', isBlack: false },
  { note: 'F4', isBlack: false },
  { note: 'F#4', isBlack: true },
  { note: 'G4', isBlack: false },
  { note: 'G#4', isBlack: true },
  { note: 'A4', isBlack: false },
  { note: 'A#4', isBlack: true },
  { note: 'B4', isBlack: false },
  { note: 'C5', isBlack: false, label: 'C5' }
];

const handleHorizontalWheel = (e: React.WheelEvent<HTMLElement>) => {
  const el = e.currentTarget;
  if (el.scrollWidth <= el.clientWidth) return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    el.scrollLeft += e.deltaY;
  }
};

export const SoundFontConfigModal: React.FC = () => {
  const isOpen = useSongStore((state) => state.isSoundFontModalOpen);
  if (!isOpen) return null;
  return <SoundFontConfigModalContent />;
};

const SoundFontConfigModalContent: React.FC = () => {
  const {
    soundfontModalChannelId,
    setSoundFontModalOpen,
    channels,
    soundfonts,
    setChannelInstrument,
    setChannelSoundFontConfig,
    removeSoundFontAsset,
    copySoundFontConfig,
    pasteSoundFontConfig,
    soundfontClipboard,
    currentKey,
    currentScale
  } = useSongStore(
    useShallow((state) => ({
      soundfontModalChannelId: state.soundfontModalChannelId,
      setSoundFontModalOpen: state.setSoundFontModalOpen,
      channels: state.channels,
      soundfonts: state.soundfonts || [],
      setChannelInstrument: state.setChannelInstrument,
      setChannelSoundFontConfig: state.setChannelSoundFontConfig,
      removeSoundFontAsset: state.removeSoundFontAsset,
      copySoundFontConfig: state.copySoundFontConfig,
      pasteSoundFontConfig: state.pasteSoundFontConfig,
      soundfontClipboard: state.soundfontClipboard,
      currentKey: state.key || 'C',
      currentScale: (state.scale || 'major') as ScaleType
    }))
  );

  const targetChannelId = soundfontModalChannelId || 'melody';
  const targetChannel = channels[targetChannelId] || channels.melody || channels.chords;
  const channelName = (targetChannel?.name || targetChannelId).toUpperCase();
  const activeConfig = targetChannel?.soundfontConfig;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedSoundFontId, setSelectedSoundFontId] = useState<string>(
    () => activeConfig?.soundfontId || soundfonts[0]?.id || ''
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [bankFilter, setBankFilter] = useState<number | 'all'>('all');
  const [autoPreview, setAutoPreview] = useState(true);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [missingBinaryMap, setMissingBinaryMap] = useState<Record<string, boolean>>({});

  // Sincronizar SoundFont seleccionado si cambia el canal editado o se agrega el primer SoundFont
  useEffect(() => {
    if (activeConfig?.soundfontId && soundfonts.some((s) => s.id === activeConfig.soundfontId)) {
      setSelectedSoundFontId(activeConfig.soundfontId);
    } else if (soundfonts.length > 0 && !soundfonts.some((s) => s.id === selectedSoundFontId)) {
      setSelectedSoundFontId(soundfonts[0].id);
    } else if (soundfonts.length === 0) {
      setSelectedSoundFontId('');
    }
  }, [targetChannelId, activeConfig?.soundfontId, soundfonts, selectedSoundFontId]);

  // Verificar disponibilidad binaria en memoria o IndexedDB para el SoundFont seleccionado
  useEffect(() => {
    if (!selectedSoundFontId) return;
    let cancelled = false;
    if (soundfontRegistry.has(selectedSoundFontId)) {
      setMissingBinaryMap((prev) => (prev[selectedSoundFontId] ? { ...prev, [selectedSoundFontId]: false } : prev));
      return;
    }
    soundfontRegistry.ensureLoaded(selectedSoundFontId).then((parsed) => {
      if (cancelled) return;
      setMissingBinaryMap((prev) => ({ ...prev, [selectedSoundFontId]: !parsed }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSoundFontId]);

  // Reiniciar filtro de banco al cambiar de SoundFont
  useEffect(() => {
    setBankFilter('all');
    setSearchQuery('');
  }, [selectedSoundFontId]);

  const selectedAsset: SoundFontAsset | undefined = useMemo(
    () => soundfonts.find((sf) => sf.id === selectedSoundFontId),
    [soundfonts, selectedSoundFontId]
  );

  const availableBanks = useMemo(() => {
    if (!selectedAsset) return [];
    const banks = new Set<number>();
    for (const p of selectedAsset.patches) {
      banks.add(p.bank);
    }
    return Array.from(banks).sort((a, b) => a - b);
  }, [selectedAsset]);

  const filteredPatches = useMemo(() => {
    if (!selectedAsset) return [];
    const q = searchQuery.trim().toLowerCase();
    return selectedAsset.patches.filter((p) => {
      if (bankFilter !== 'all' && p.bank !== bankFilter) return false;
      if (!q) return true;
      const code = formatPatchNumber(p.bank, p.program);
      return (
        p.name.toLowerCase().includes(q) ||
        code.includes(q) ||
        String(p.program).includes(q)
      );
    });
  }, [selectedAsset, bankFilter, searchQuery]);

  const chorusCfg: SoundFontChorusConfig = activeConfig?.chorus
    ? { ...DEFAULT_SOUNDFONT_CHORUS, ...activeConfig.chorus }
    : DEFAULT_SOUNDFONT_CHORUS;

  const reverbCfg: SoundFontReverbConfig = activeConfig?.reverb
    ? { ...DEFAULT_SOUNDFONT_REVERB, ...activeConfig.reverb }
    : DEFAULT_SOUNDFONT_REVERB;

  const handleUploadFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      setIsUploading(true);
      try {
        const imported = await importSoundFontFiles(Array.from(files), targetChannelId);
        if (imported.length > 0) {
          setSelectedSoundFontId(imported[0].id);
          setMissingBinaryMap((prev) => ({ ...prev, [imported[0].id]: false }));
        }
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [targetChannelId]
  );

  const handleSelectPatch = useCallback(
    (asset: SoundFontAsset, patch: SoundFontPatchInfo) => {
      const nextConfig: ChannelSoundFontConfig = {
        soundfontId: asset.id,
        bank: patch.bank,
        program: patch.program,
        patchName: patch.name,
        gain: activeConfig?.gain ?? 1.0,
        releaseMultiplier: activeConfig?.releaseMultiplier ?? 1.0,
        transpose: activeConfig?.transpose ?? 0,
        ...(activeConfig?.chorus ? { chorus: { ...activeConfig.chorus } } : {}),
        ...(activeConfig?.reverb ? { reverb: { ...activeConfig.reverb } } : {})
      };
      setChannelInstrument(targetChannelId, 'soundfont');
      setChannelSoundFontConfig(targetChannelId, nextConfig);

      if (autoPreview) {
        toneEngine.unlockIfSuspended();
        const previewNote = patch.bank === 128 ? 'C2' : `${currentKey}4`;
        window.setTimeout(() => {
          toneEngine.playNotePreview(previewNote, targetChannelId, 0.85);
        }, 12);
      }
    },
    [
      activeConfig?.gain,
      activeConfig?.releaseMultiplier,
      activeConfig?.transpose,
      activeConfig?.chorus,
      activeConfig?.reverb,
      autoPreview,
      currentKey,
      setChannelInstrument,
      setChannelSoundFontConfig,
      targetChannelId
    ]
  );

  const handleUpdateConfigParam = useCallback(
    (updates: Partial<ChannelSoundFontConfig>) => {
      if (!activeConfig?.soundfontId) return;
      setChannelSoundFontConfig(targetChannelId, {
        ...activeConfig,
        ...updates
      });
    },
    [activeConfig, setChannelSoundFontConfig, targetChannelId]
  );

  const handleUpdateChorus = useCallback(
    (updates: Partial<SoundFontChorusConfig>) => {
      if (!activeConfig?.soundfontId) return;
      const base = activeConfig.chorus
        ? { ...DEFAULT_SOUNDFONT_CHORUS, ...activeConfig.chorus }
        : { ...DEFAULT_SOUNDFONT_CHORUS };
      setChannelSoundFontConfig(targetChannelId, {
        ...activeConfig,
        chorus: { ...base, ...updates }
      });
    },
    [activeConfig, setChannelSoundFontConfig, targetChannelId]
  );

  const handleUpdateReverb = useCallback(
    (updates: Partial<SoundFontReverbConfig>) => {
      if (!activeConfig?.soundfontId) return;
      const base = activeConfig.reverb
        ? { ...DEFAULT_SOUNDFONT_REVERB, ...activeConfig.reverb }
        : { ...DEFAULT_SOUNDFONT_REVERB };
      setChannelSoundFontConfig(targetChannelId, {
        ...activeConfig,
        reverb: { ...base, ...updates }
      });
    },
    [activeConfig, setChannelSoundFontConfig, targetChannelId]
  );

  const handleAuditionChord = useCallback(() => {
    if (!activeConfig?.soundfontId) return;
    toneEngine.unlockIfSuspended();
    if (activeConfig.bank === 128) {
      const drumHits = ['C2', 'D2', 'F#2', 'A#2'];
      drumHits.forEach((n, idx) => {
        window.setTimeout(() => toneEngine.playNotePreview(n, targetChannelId, 0.85), idx * 140);
      });
      return;
    }
    const scaleNotes = getScaleNotes(currentKey, currentScale);
    const triad = [
      `${scaleNotes[0] || 'C'}4`,
      `${scaleNotes[2] || 'E'}4`,
      `${scaleNotes[4] || 'G'}4`,
      `${scaleNotes[0] || 'C'}5`
    ];
    triad.forEach((n, idx) => {
      window.setTimeout(() => toneEngine.playNotePreview(n, targetChannelId, 0.8), idx * 95);
    });
  }, [activeConfig, currentKey, currentScale, targetChannelId]);

  const handleDeleteAsset = useCallback(
    (e: React.MouseEvent, asset: SoundFontAsset) => {
      e.stopPropagation();
      removeSoundFontAsset(asset.id);
      notify.info(`SoundFont eliminado: ${asset.name}`);
    },
    [removeSoundFontAsset]
  );

  const handleCopyConfig = useCallback(() => {
    if (!activeConfig) return;
    copySoundFontConfig(targetChannelId);
    setCopiedNotice(true);
    window.setTimeout(() => setCopiedNotice(false), 1200);
  }, [activeConfig, copySoundFontConfig, targetChannelId]);

  const handlePasteConfig = useCallback(() => {
    if (pasteSoundFontConfig(targetChannelId)) {
      notify.info('Patch SoundFont pegado en este canal');
    }
  }, [pasteSoundFontConfig, targetChannelId]);

  const handleKeyDownMouse = (note: string) => {
    if (!activeConfig?.soundfontId) return;
    setPressedKey(note);
    toneEngine.startNote(note, targetChannelId, 0.85);
  };

  const handleKeyUpMouse = (note: string) => {
    if (pressedKey === note) {
      setPressedKey(null);
    }
    toneEngine.stopNote(note, targetChannelId);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    (e.nativeEvent as unknown as { __phosphorDropHandled?: boolean }).__phosphorDropHandled = true;
    handleUploadFiles(e.dataTransfer.files);
  };

  const isSelectedBinaryMissing = Boolean(selectedAsset && missingBinaryMap[selectedAsset.id]);
  const hasAssignedSf = Boolean(activeConfig?.soundfontId);
  const gainPct = Math.round((activeConfig?.gain ?? 1.0) * 100);
  const releaseMult = activeConfig?.releaseMultiplier ?? 1.0;
  const transposeVal = activeConfig?.transpose ?? 0;

  return (
    <div
      className="synth-modal-overlay sf-modal-overlay"
      onClick={() => setSoundFontModalOpen(false)}
    >
      <div
        className={`sf-modal-container ${isDraggingOver ? 'drag-over' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDraggingOver(false);
        }}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".sf2,.sf3,.js,.json"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => handleUploadFiles(e.target.files)}
        />

        {/* Header con scroll horizontal seguro */}
        <div
          className="synth-modal-header sf-modal-header"
          onWheel={handleHorizontalWheel}
        >
          <div className="sf-header-left">
            <div className="synth-brand-tag" style={{ flexShrink: 0 }}>
              <HardDrive size={14} className="header-icon" />
              <span>SOUNDFONT // {channelName}</span>
            </div>
            <div className="sf-active-patch-pill" title="Patch activo en este canal">
              <Disc3 size={12} style={{ color: activeConfig ? '#5fab82' : '#aba3be', flexShrink: 0 }} />
              {activeConfig ? (
                <span className="sf-active-patch-text">
                  <strong style={{ color: '#ffd875' }}>
                    {formatPatchNumber(activeConfig.bank, activeConfig.program)}
                  </strong>{' '}
                  {activeConfig.patchName || 'Patch'}
                </span>
              ) : (
                <span style={{ color: 'var(--text-secondary)' }}>Sin patch asignado</span>
              )}
            </div>
          </div>

          <div className="sf-header-right">
            <button
              type="button"
              className="physical-btn sf-upload-header-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              title="Subir archivo SoundFont (.sf2, .sf3 o WebAudioFont .js/.json)"
            >
              <Upload size={12} />
              <span>{isUploading ? 'CARGANDO...' : 'SUBIR SOUNDFONT'}</span>
            </button>

            <button
              type="button"
              className={`physical-btn ${autoPreview ? 'active' : ''}`}
              onClick={() => setAutoPreview((v) => !v)}
              title="Reproducir una nota automáticamente al seleccionar un patch"
              style={{ height: '26px', padding: '0 8px', fontSize: '0.68rem', gap: '4px', flexShrink: 0 }}
            >
              <Volume2 size={12} />
              <span>AUTO</span>
            </button>

            <button
              type="button"
              className="physical-btn"
              onClick={handleAuditionChord}
              disabled={!hasAssignedSf}
              title="Escuchar arpegio de prueba en la tonalidad actual"
              style={{ height: '26px', padding: '0 8px', fontSize: '0.68rem', gap: '4px', flexShrink: 0 }}
            >
              <Play size={11} />
              <span>PROBAR</span>
            </button>

            <button
              type="button"
              className={`physical-btn ${copiedNotice ? 'active' : ''}`}
              onClick={handleCopyConfig}
              disabled={!hasAssignedSf}
              title="Copiar patch y FX SoundFont"
              style={{ height: '26px', padding: '0 7px', flexShrink: 0 }}
            >
              {copiedNotice ? <Check size={12} /> : <Copy size={12} />}
            </button>

            <button
              type="button"
              className="physical-btn"
              onClick={handlePasteConfig}
              disabled={!soundfontClipboard}
              title={
                soundfontClipboard
                  ? `Pegar patch: ${soundfontClipboard.patchName || 'SoundFont'}`
                  : 'Portapapeles SoundFont vacío'
              }
              style={{ height: '26px', padding: '0 7px', flexShrink: 0 }}
            >
              <ClipboardPaste size={12} />
            </button>

            <button
              type="button"
              className="physical-btn"
              onClick={() => setSoundFontModalOpen(false)}
              title="Cerrar (Esc)"
              style={{ height: '26px', padding: '0 7px', flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Main 2-column body (con min-width: 0 y scroll horizontal seguro si se reduce el viewport) */}
        <div className="sf-modal-body-scroll">
          <div className="sf-modal-body">
            {/* Left Column: SoundFont Library */}
            <div className="sf-library-pane">
              <div className="sf-pane-header">
                <span>BANCOS CARGADOS</span>
                <span className="sf-count-badge">{soundfonts.length}</span>
              </div>

              <button
                type="button"
                className="sf-dropzone-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={15} style={{ color: '#ffd875' }} />
                <span className="sf-dropzone-title">Subir o arrastrar SoundFont</span>
                <span className="sf-dropzone-sub">.sf2 · .sf3 · WebAudioFont .js / .json</span>
              </button>

              <div className="sf-library-list">
                {soundfonts.length === 0 ? (
                  <div className="sf-empty-state">
                    <HardDrive size={22} style={{ opacity: 0.45 }} />
                    <p>No hay SoundFonts cargados todavía.</p>
                    <span>
                      Sube un archivo <strong>.sf2</strong>, <strong>.sf3</strong> o un preset de{' '}
                      <strong>WebAudioFont</strong> para seleccionar sus instrumentos.
                    </span>
                  </div>
                ) : (
                  soundfonts.map((asset) => {
                    const isSelected = asset.id === selectedSoundFontId;
                    const isAssigned = activeConfig?.soundfontId === asset.id;
                    return (
                      <div
                        key={asset.id}
                        className={`sf-library-item ${isSelected ? 'selected' : ''} ${isAssigned ? 'assigned' : ''}`}
                        onClick={() => setSelectedSoundFontId(asset.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedSoundFontId(asset.id);
                          }
                        }}
                      >
                        <div className="sf-library-item-top">
                          <span className="sf-library-item-name" title={asset.fileName}>
                            {isAssigned && <span className="sf-assigned-dot" />}
                            <span className="sf-truncate">{asset.name}</span>
                          </span>
                          <span className={`sf-format-badge fmt-${asset.format}`}>
                            {asset.format === 'webaudiofont' ? 'WAF' : asset.format.toUpperCase()}
                          </span>
                        </div>
                        <div className="sf-library-item-meta">
                          <span>
                            {asset.patches.length} {asset.patches.length === 1 ? 'patch' : 'patches'} ·{' '}
                            {formatBytes(asset.sizeBytes)}
                          </span>
                          <button
                            type="button"
                            className="sf-delete-btn"
                            onClick={(e) => handleDeleteAsset(e, asset)}
                            title="Eliminar SoundFont de la biblioteca local"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="sf-phos-note">
                <Package size={12} style={{ color: '#ffd875', flexShrink: 0 }} />
                <span>
                  El SoundFont activo de cada pista se guarda automáticamente dentro del{' '}
                  <strong>.phos</strong>.
                </span>
              </div>
            </div>

            {/* Right Column: Patch Browser */}
            <div className="sf-patch-pane">
              <div className="sf-patch-toolbar">
                <div className="sf-search-wrap">
                  <Search size={12} className="sf-search-icon" />
                  <input
                    type="text"
                    className="sf-search-input"
                    placeholder="Buscar patch por nombre o número (ej. Piano, 048, Strings)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={!selectedAsset}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="sf-search-clear"
                      onClick={() => setSearchQuery('')}
                      title="Limpiar búsqueda"
                    >
                      ×
                    </button>
                  )}
                </div>

                {selectedAsset && (
                  <span className="sf-patch-counter">
                    {filteredPatches.length}/{selectedAsset.patches.length}
                  </span>
                )}
              </div>

              {availableBanks.length > 1 && (
                <div className="sf-bank-filter-row" onWheel={handleHorizontalWheel}>
                  <button
                    type="button"
                    className={`sf-bank-pill ${bankFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setBankFilter('all')}
                  >
                    Todos ({selectedAsset?.patches.length || 0})
                  </button>
                  {availableBanks.map((bank) => (
                    <button
                      key={bank}
                      type="button"
                      className={`sf-bank-pill ${bankFilter === bank ? 'active' : ''}`}
                      onClick={() => setBankFilter(bank)}
                    >
                      {bank === 128 ? 'Percusión (128)' : `Banco ${String(bank).padStart(3, '0')}`}
                    </button>
                  ))}
                </div>
              )}

              {isSelectedBinaryMissing && (
                <div className="sf-missing-banner">
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span>
                    Los datos binarios de este SoundFont no están en este navegador. Vuelve a subir{' '}
                    <strong>{selectedAsset?.fileName}</strong> o importa el archivo <strong>.phos</strong>{' '}
                    original.
                  </span>
                </div>
              )}

              <div className="sf-patch-list">
                {!selectedAsset ? (
                  <div className="sf-empty-state">
                    <Disc3 size={24} style={{ opacity: 0.35 }} />
                    <p>Selecciona o sube un SoundFont para explorar sus patches.</p>
                  </div>
                ) : filteredPatches.length === 0 ? (
                  <div className="sf-empty-state">
                    <p>No hay patches que coincidan con &quot;{searchQuery}&quot;.</p>
                  </div>
                ) : (
                  filteredPatches.map((patch) => {
                    const isCurrent =
                      activeConfig?.soundfontId === selectedAsset.id &&
                      activeConfig.bank === patch.bank &&
                      activeConfig.program === patch.program;
                    return (
                      <button
                        key={`${patch.bank}:${patch.program}:${patch.name}`}
                        type="button"
                        className={`sf-patch-row ${isCurrent ? 'active' : ''}`}
                        onClick={() => handleSelectPatch(selectedAsset, patch)}
                      >
                        <span className="sf-patch-code">
                          {formatPatchNumber(patch.bank, patch.program)}
                        </span>
                        <span className="sf-patch-name" title={patch.name}>
                          {patch.name}
                        </span>
                        {typeof patch.zoneCount === 'number' && (
                          <span className="sf-patch-zones" title={`${patch.zoneCount} zonas de muestras`}>
                            {patch.zoneCount}z
                          </span>
                        )}
                        {isCurrent && <span className="sf-patch-active-dot" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Strip: Rack Horizontal de Canal + Chorus + Reverb + Mini Teclado */}
        <div className="sf-modal-footer">
          <div className="sf-fx-rack" onWheel={handleHorizontalWheel}>
            {/* Módulo 1: Canal (Ganancia / Release / Transposición) */}
            <div className="sf-fx-card">
              <div className="sf-fx-card-head">
                <span className="sf-fx-card-title">
                  <Sliders size={11} style={{ color: '#ffd875' }} />
                  <span>CANAL</span>
                </span>
                <button
                  type="button"
                  className="sf-mini-reset-btn"
                  disabled={!hasAssignedSf}
                  onClick={() =>
                    handleUpdateConfigParam({ gain: 1.0, releaseMultiplier: 1.0, transpose: 0 })
                  }
                  title="Restablecer ganancia, release y transposición"
                >
                  <RotateCcw size={10} />
                </button>
              </div>
              <div className="sf-fx-controls-grid">
                <label className="sf-param-control" title="Doble clic para restablecer al 100%">
                  <span className="sf-param-label">GAIN</span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    value={gainPct}
                    disabled={!hasAssignedSf}
                    onChange={(e) => handleUpdateConfigParam({ gain: Number(e.target.value) / 100 })}
                    onDoubleClick={() => handleUpdateConfigParam({ gain: 1.0 })}
                  />
                  <span className="sf-param-value">{gainPct}%</span>
                </label>

                <label className="sf-param-control" title="Doble clic para restablecer a 1.0x">
                  <span className="sf-param-label">REL</span>
                  <input
                    type="range"
                    min={20}
                    max={300}
                    step={5}
                    value={Math.round(releaseMult * 100)}
                    disabled={!hasAssignedSf}
                    onChange={(e) =>
                      handleUpdateConfigParam({ releaseMultiplier: Number(e.target.value) / 100 })
                    }
                    onDoubleClick={() => handleUpdateConfigParam({ releaseMultiplier: 1.0 })}
                  />
                  <span className="sf-param-value">{releaseMult.toFixed(2)}x</span>
                </label>

                <div className="sf-param-control">
                  <span className="sf-param-label">TRAN</span>
                  <div className="sf-transpose-stepper">
                    <button
                      type="button"
                      className="sf-step-btn"
                      disabled={!hasAssignedSf}
                      onClick={() => handleUpdateConfigParam({ transpose: Math.max(-24, transposeVal - 12) })}
                      title="-1 octava"
                    >
                      -12
                    </button>
                    <button
                      type="button"
                      className="sf-step-btn"
                      disabled={!hasAssignedSf}
                      onClick={() => handleUpdateConfigParam({ transpose: Math.max(-24, transposeVal - 1) })}
                      title="-1 semitono"
                    >
                      -1
                    </button>
                    <span
                      className="sf-param-value sf-transpose-val"
                      onDoubleClick={() => handleUpdateConfigParam({ transpose: 0 })}
                      title="Doble clic para 0 st"
                    >
                      {transposeVal > 0 ? `+${transposeVal}` : transposeVal}
                    </span>
                    <button
                      type="button"
                      className="sf-step-btn"
                      disabled={!hasAssignedSf}
                      onClick={() => handleUpdateConfigParam({ transpose: Math.min(24, transposeVal + 1) })}
                      title="+1 semitono"
                    >
                      +1
                    </button>
                    <button
                      type="button"
                      className="sf-step-btn"
                      disabled={!hasAssignedSf}
                      onClick={() => handleUpdateConfigParam({ transpose: Math.min(24, transposeVal + 12) })}
                      title="+1 octava"
                    >
                      +12
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Módulo 2: CHORUS ESTÉREO */}
            <div className={`sf-fx-card ${chorusCfg.enabled ? 'fx-on' : ''}`}>
              <div className="sf-fx-card-head">
                <span className="sf-fx-card-title">
                  <Waves size={11} style={{ color: chorusCfg.enabled ? '#00e5ff' : 'var(--text-secondary)' }} />
                  <span>CHORUS</span>
                </span>
                <button
                  type="button"
                  className={`sf-fx-power-btn ${chorusCfg.enabled ? 'active' : ''}`}
                  disabled={!hasAssignedSf}
                  onClick={() => handleUpdateChorus({ enabled: !chorusCfg.enabled })}
                  title={chorusCfg.enabled ? 'Desactivar Chorus' : 'Activar Chorus estéreo'}
                >
                  <span className="sf-fx-led" />
                  <span>{chorusCfg.enabled ? 'ON' : 'OFF'}</span>
                </button>
              </div>
              <div className="sf-fx-controls-grid">
                <label className="sf-param-control" title="Mezcla Chorus · Doble clic 35%">
                  <span className="sf-param-label">MIX</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(chorusCfg.mix * 100)}
                    disabled={!hasAssignedSf}
                    onChange={(e) =>
                      handleUpdateChorus({ enabled: true, mix: Number(e.target.value) / 100 })
                    }
                    onDoubleClick={() =>
                      handleUpdateChorus({ enabled: true, mix: DEFAULT_SOUNDFONT_CHORUS.mix })
                    }
                  />
                  <span className="sf-param-value">{Math.round(chorusCfg.mix * 100)}%</span>
                </label>

                <label className="sf-param-control" title="Velocidad LFO · Doble clic 1.5 Hz">
                  <span className="sf-param-label">RATE</span>
                  <input
                    type="range"
                    min={10}
                    max={800}
                    step={10}
                    value={Math.round(chorusCfg.rate * 100)}
                    disabled={!hasAssignedSf}
                    onChange={(e) =>
                      handleUpdateChorus({ enabled: true, rate: Number(e.target.value) / 100 })
                    }
                    onDoubleClick={() =>
                      handleUpdateChorus({ enabled: true, rate: DEFAULT_SOUNDFONT_CHORUS.rate })
                    }
                  />
                  <span className="sf-param-value">{chorusCfg.rate.toFixed(1)}Hz</span>
                </label>

                <label className="sf-param-control" title="Profundidad de modulación · Doble clic 45%">
                  <span className="sf-param-label">DPTH</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(chorusCfg.depth * 100)}
                    disabled={!hasAssignedSf}
                    onChange={(e) =>
                      handleUpdateChorus({ enabled: true, depth: Number(e.target.value) / 100 })
                    }
                    onDoubleClick={() =>
                      handleUpdateChorus({ enabled: true, depth: DEFAULT_SOUNDFONT_CHORUS.depth })
                    }
                  />
                  <span className="sf-param-value">{Math.round(chorusCfg.depth * 100)}%</span>
                </label>
              </div>
            </div>

            {/* Módulo 3: REVERB ESTÉREO */}
            <div className={`sf-fx-card ${reverbCfg.enabled ? 'fx-on reverb-on' : ''}`}>
              <div className="sf-fx-card-head">
                <span className="sf-fx-card-title">
                  <Compass size={11} style={{ color: reverbCfg.enabled ? '#c084fc' : 'var(--text-secondary)' }} />
                  <span>REVERB</span>
                </span>
                <button
                  type="button"
                  className={`sf-fx-power-btn reverb ${reverbCfg.enabled ? 'active' : ''}`}
                  disabled={!hasAssignedSf}
                  onClick={() => handleUpdateReverb({ enabled: !reverbCfg.enabled })}
                  title={reverbCfg.enabled ? 'Desactivar Reverb' : 'Activar Reverb estéreo de sala'}
                >
                  <span className="sf-fx-led" />
                  <span>{reverbCfg.enabled ? 'ON' : 'OFF'}</span>
                </button>
              </div>
              <div className="sf-fx-controls-grid">
                <label className="sf-param-control" title="Mezcla Reverb · Doble clic 30%">
                  <span className="sf-param-label">MIX</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(reverbCfg.mix * 100)}
                    disabled={!hasAssignedSf}
                    onChange={(e) =>
                      handleUpdateReverb({ enabled: true, mix: Number(e.target.value) / 100 })
                    }
                    onDoubleClick={() =>
                      handleUpdateReverb({ enabled: true, mix: DEFAULT_SOUNDFONT_REVERB.mix })
                    }
                  />
                  <span className="sf-param-value">{Math.round(reverbCfg.mix * 100)}%</span>
                </label>

                <label className="sf-param-control" title="Tiempo de cola (Decay) · Doble clic 2.2s">
                  <span className="sf-param-label">DECAY</span>
                  <input
                    type="range"
                    min={30}
                    max={600}
                    step={10}
                    value={Math.round(reverbCfg.decay * 100)}
                    disabled={!hasAssignedSf}
                    onChange={(e) =>
                      handleUpdateReverb({ enabled: true, decay: Number(e.target.value) / 100 })
                    }
                    onDoubleClick={() =>
                      handleUpdateReverb({ enabled: true, decay: DEFAULT_SOUNDFONT_REVERB.decay })
                    }
                  />
                  <span className="sf-param-value">{reverbCfg.decay.toFixed(1)}s</span>
                </label>
              </div>
            </div>
          </div>

          <div
            className="sf-mini-keyboard-scroll"
            onWheel={handleHorizontalWheel}
          >
            <div
              className={`sf-mini-keyboard ${!hasAssignedSf ? 'disabled' : ''}`}
              aria-label="Teclado de prueba SoundFont"
            >
              {MINI_KEYBOARD_NOTES.map((k) => (
                <button
                  key={k.note}
                  type="button"
                  disabled={!hasAssignedSf}
                  className={`sf-kb-key ${k.isBlack ? 'black' : 'white'} ${pressedKey === k.note ? 'active' : ''}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleKeyDownMouse(k.note);
                  }}
                  onPointerUp={() => handleKeyUpMouse(k.note)}
                  onPointerLeave={() => {
                    if (pressedKey === k.note) handleKeyUpMouse(k.note);
                  }}
                  onPointerCancel={() => {
                    if (pressedKey === k.note) handleKeyUpMouse(k.note);
                  }}
                  title={k.note}
                >
                  {k.label && <span className="sf-kb-label">{k.label}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
