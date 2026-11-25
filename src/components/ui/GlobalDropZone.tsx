import React, { useEffect, useRef, useState } from 'react';
import { Upload, Package, AudioWaveform } from 'lucide-react';
import {
  importProjectFile,
  importAudioFilesToTracks,
  isSupportedAudioFile,
  isSupportedProjectFile
} from '../../core/session/projectFileImport';
import { notify } from '../../core/ui/toastBus';

function hasFilesPayload(e: DragEvent): boolean {
  const dt = e.dataTransfer;
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes('Files')) {
    return true;
  }
  return Boolean(dt.files && dt.files.length > 0);
}

export const GlobalDropZone: React.FC = () => {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (!hasFilesPayload(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingFile(true);
    };

    const handleDragOver = (e: DragEvent) => {
      if (!hasFilesPayload(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!hasFilesPayload(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingFile(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      if (!hasFilesPayload(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFile(false);

      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;

      const projectFile = files.find(isSupportedProjectFile);
      if (projectFile) {
        await importProjectFile(projectFile);
        return;
      }

      const audioFiles = files.filter(isSupportedAudioFile);
      if (audioFiles.length > 0) {
        await importAudioFilesToTracks(audioFiles, { switchToTracksView: true });
        return;
      }

      notify.warning(
        `Archivo no reconocido: ${files[0].name}`,
        'Formatos soportados: .phos, .json, .mid, .wav, .mp3, .ogg, .flac'
      );
    };

    const handleWindowBlur = () => {
      dragDepthRef.current = 0;
      setIsDraggingFile(false);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('blur', handleWindowBlur);
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
            <AudioWaveform size={12} /> Audio (.wav / .mp3 / .ogg / .flac)
          </span>
        </div>
      </div>
    </div>
  );
};
