import React, { useEffect, useRef, useState } from 'react';
import { Upload, Package, AudioWaveform, HardDrive } from 'lucide-react';
import {
  importProjectFile,
  importAudioFilesToTracks,
  importCustomDrumSamplesAsNewChannels,
  importSoundFontFiles,
  isSupportedAudioFile,
  isSupportedProjectFile,
  isSupportedSoundFontFile,
  hasExternalFilesPayload,
  isExplicitProjectOnlyDrag
} from '../../core/session/projectFileImport';
import { useSongStore } from '../../store/songStore';
import { notify } from '../../core/ui/toastBus';

export const GlobalDropZone: React.FC = () => {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const shouldSuppressOverlayForSequencer = (e: DragEvent) =>
      useSongStore.getState().activeView === 'sequencer' && !isExplicitProjectOnlyDrag(e);

    const handleDragEnter = (e: DragEvent) => {
      if (!hasExternalFilesPayload(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      if (shouldSuppressOverlayForSequencer(e)) {
        setIsDraggingFile(false);
        return;
      }
      setIsDraggingFile(true);
    };

    const handleDragOver = (e: DragEvent) => {
      if (!hasExternalFilesPayload(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      if (shouldSuppressOverlayForSequencer(e)) {
        setIsDraggingFile(false);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!hasExternalFilesPayload(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingFile(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      if (!hasExternalFilesPayload(e)) return;
      dragDepthRef.current = 0;
      setIsDraggingFile(false);

      if ((e as unknown as { __phosphorDropHandled?: boolean }).__phosphorDropHandled) {
        return;
      }

      e.preventDefault();

      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;

      const projectFile = files.find(isSupportedProjectFile);
      if (projectFile) {
        await importProjectFile(projectFile);
        return;
      }

      const soundfontFiles = files.filter(isSupportedSoundFontFile);
      if (soundfontFiles.length > 0) {
        const st = useSongStore.getState();
        const activeTrack = st.tracks.find((t) => t.id === st.activeTrackId);
        const targetChannelId =
          st.activeView === 'chord' ? 'chords' : (activeTrack?.channelId || 'melody');
        await importSoundFontFiles(soundfontFiles, targetChannelId, { openModal: true });
        return;
      }

      const audioFiles = files.filter(isSupportedAudioFile);
      if (audioFiles.length > 0) {
        if (useSongStore.getState().activeView === 'sequencer') {
          await importCustomDrumSamplesAsNewChannels(audioFiles);
        } else {
          await importAudioFilesToTracks(audioFiles, { switchToTracksView: true });
        }
        return;
      }

      notify.warning(
        `Archivo no reconocido: ${files[0].name}`,
        'Formatos soportados: .phos, .json, .mid, .sf2, .sf3, .wav, .mp3, .ogg, .flac'
      );
    };

    const handleDragReset = () => {
      dragDepthRef.current = 0;
      setIsDraggingFile(false);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDragReset, true);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragend', handleDragReset);
    window.addEventListener('blur', handleDragReset);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDragReset, true);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragend', handleDragReset);
      window.removeEventListener('blur', handleDragReset);
    };
  }, []);

  if (!isDraggingFile) return null;

  return (
    <div className="global-drop-overlay" aria-hidden="true">
      <div className="global-drop-card">
        <div className="global-drop-icon-ring">
          <Upload size={28} />
        </div>
        <div className="global-drop-title">SUELTA PARA IMPORTAR</div>
        <div className="global-drop-badges">
          <span className="global-drop-badge">
            <Package size={12} /> Proyecto (.phos / .json / .mid)
          </span>
          <span className="global-drop-badge">
            <HardDrive size={12} /> SoundFont (.sf2 / .sf3)
          </span>
          <span className="global-drop-badge">
            <AudioWaveform size={12} /> Audio (.wav / .mp3 / .ogg / .flac)
          </span>
        </div>
      </div>
    </div>
  );
};
