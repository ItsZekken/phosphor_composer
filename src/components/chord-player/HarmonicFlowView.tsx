/**
 * HarmonicFlowView.tsx
 * Alquimia Armónica CRT Vectorial: Lienzo espacial interactivo, constelación de nodos,
 * arcos de paso sobre demanda, órbitas de sustitución y tech-tree de rutas ramificadas.
 */

import React, { useMemo, useState, useEffect } from 'react';
import type { NoteClass, ScaleType } from '../../utils/typeDefinitions';
import { 
  getChordRomanDegree, 
  getChromaticPassingChords, 
  getSecondaryDominants, 
  parseChord,
  NOTE_CLASSES 
} from '../../core/music';
import { toneEngine } from '../../audio/toneEngine';
import { useSongStore } from '../../store/songStore';
import { getChordRole } from './ChordPalette';
import { 
  GitFork, 
  Plus, 
  Play, 
  CornerDownRight, 
  ChevronRight, 
  Sparkles,
  Repeat,
  Radio
} from 'lucide-react';

interface HarmonicFlowViewProps {
  currentKey: NoteClass;
  scale: ScaleType;
}

interface ChainChord {
  id: string;
  chord: string;
  startBeat: number;
  durationBeats: number;
  isFromTimeline: boolean;
}

interface DetectedSection {
  id: string;
  name: string;
  chords: ChainChord[];
}

function extractSmallestLoop(blocks: Array<{ id: string; chord: string; startBeat: number; durationBeats: number }>): ChainChord[] {
  if (blocks.length <= 1) return blocks.map(b => ({ ...b, isFromTimeline: true }));

  const chords = blocks.map(b => b.chord);
  const n = chords.length;

  for (let L = 2; L <= Math.min(8, Math.floor(n / 2)); L++) {
    let isLoop = true;
    for (let i = 0; i < n; i++) {
      if (chords[i] !== chords[i % L]) {
        isLoop = false;
        break;
      }
    }
    if (isLoop) {
      return blocks.slice(0, L).map(b => ({ ...b, isFromTimeline: true }));
    }
  }

  const maxSlice = Math.min(blocks.length, 8);
  return blocks.slice(0, maxSlice).map(b => ({ ...b, isFromTimeline: true }));
}

function detectSectionsAndLoops(
  chordBlocks: Array<{ id: string; chord: string; startBeat: number; durationBeats: number; section?: string }>
): DetectedSection[] {
  if (chordBlocks.length === 0) {
    return [];
  }

  const explicitSections = new Map<string, typeof chordBlocks>();
  chordBlocks.forEach(b => {
    const secName = b.section?.trim();
    if (secName) {
      if (!explicitSections.has(secName)) explicitSections.set(secName, []);
      explicitSections.get(secName)!.push(b);
    }
  });

  if (explicitSections.size > 1) {
    const result: DetectedSection[] = [];
    explicitSections.forEach((blocks, secName) => {
      result.push({
        id: secName.toLowerCase(),
        name: secName,
        chords: extractSmallestLoop(blocks)
      });
    });
    return result;
  }

  return [{
    id: 'main',
    name: 'Bucle Principal',
    chords: extractSmallestLoop(chordBlocks)
  }];
}

import { useShallow } from 'zustand/react/shallow';

export const HarmonicFlowView: React.FC<HarmonicFlowViewProps> = ({ currentKey, scale }) => {
  const {
    chordBlocks,
    setSelectedChordId,
    addChordBlock,
    updateChordBlock,
    setDraggingChord
  } = useSongStore(useShallow(state => ({
    chordBlocks: state.chordBlocks || [],
    setSelectedChordId: state.setSelectedChordId,
    addChordBlock: state.addChordBlock,
    updateChordBlock: state.updateChordBlock,
    setDraggingChord: state.setDraggingChord
  })));

  const [activeSectionId, setActiveSectionId] = useState<string>('main');
  const [openBridgeIndex, setOpenBridgeIndex] = useState<number | null>(null);
  const [openOrbitChordIndex, setOpenOrbitChordIndex] = useState<number | null>(null);
  const [showTechTree, setShowTechTree] = useState<boolean>(false);
  const [playingRouteId, setPlayingRouteId] = useState<string | null>(null);
  const [playingStepIndex, setPlayingStepIndex] = useState<number | null>(null);

  const detectedSections = useMemo(() => {
    return detectSectionsAndLoops(chordBlocks);
  }, [chordBlocks]);

  useEffect(() => {
    if (detectedSections.length > 0 && !detectedSections.some(s => s.id === activeSectionId)) {
      setActiveSectionId(detectedSections[0].id);
    }
  }, [detectedSections, activeSectionId]);

  const currentSection = detectedSections.find(s => s.id === activeSectionId) || detectedSections[0];
  const activeChain = useMemo(() => currentSection?.chords || [], [currentSection]);

  // Conectores de paso para el puente abierto
  const bridgeChords = useMemo(() => {
    if (openBridgeIndex === null || !activeChain || activeChain.length === 0) return [];
    const sourceChord = activeChain[openBridgeIndex]?.chord || currentKey;
    const nextChord = activeChain[(openBridgeIndex + 1) % activeChain.length]?.chord || currentKey;

    const passing = getChromaticPassingChords(sourceChord, currentKey, scale);
    const parsedNext = parseChord(nextChord);
    const secondaryDoms = getSecondaryDominants(currentKey, scale);

    const targetSecDom = parsedNext 
      ? secondaryDoms.find(sd => sd.targetChord.replace(/[0-9]/g, '') === nextChord.replace(/[0-9]/g, ''))
      : null;

    const list: Array<{ chord: string; tag: string; role: any }> = [];

    if (targetSecDom) {
      list.push({
        chord: targetSecDom.chord,
        tag: `V7 ➔ ${nextChord}`,
        role: 'tension'
      });
    }

    passing.forEach(p => {
      list.push({
        chord: p.chord,
        tag: p.type === 'line_cliche' ? 'aug' : p.type === 'chromatic_approach' ? 'semitono' : 'dim',
        role: p.role
      });
    });

    return list.slice(0, 4);
  }, [activeChain, openBridgeIndex, currentKey, scale]);

  // Sustituciones orbitales para el acorde con órbita abierta
  const orbitSubstitutions = useMemo(() => {
    if (openOrbitChordIndex === null || !activeChain[openOrbitChordIndex]) return [];
    const chord = activeChain[openOrbitChordIndex].chord;
    const parsed = parseChord(chord);
    if (!parsed) return [];

    const root = parsed.root;
    const isMinor = parsed.quality === 'minor' || parsed.quality === 'minor7';

    const results: Array<{ chord: string; tag: string }> = [];
    results.push({ chord: `${root}aug`, tag: 'aug' });
    results.push({ chord: isMinor ? root : `${root}m`, tag: isMinor ? 'Mayor' : 'Menor' });
    results.push({ chord: isMinor ? `${root}m6` : `${root}6`, tag: '6th' });

    const rootVal = NOTE_CLASSES.indexOf(root);
    const tritoneRoot = NOTE_CLASSES[(rootVal + 6) % 12];
    results.push({ chord: `${tritoneRoot}7`, tag: 'Tritono' });

    return results;
  }, [activeChain, openOrbitChordIndex]);

  // Rutas alternativas (Tech Tree de líneas temporales paralelas)
  const evolutionaryRoutes = useMemo(() => {
    const root = currentKey;
    const rootVal = NOTE_CLASSES.indexOf(root);
    const semitoneDown = NOTE_CLASSES[(rootVal + 11) % 12];
    const bVI = NOTE_CLASSES[(rootVal + 8) % 12];
    const bVII = NOTE_CLASSES[(rootVal + 10) % 12];
    const IV = NOTE_CLASSES[(rootVal + 5) % 12];
    const V = NOTE_CLASSES[(rootVal + 7) % 12];

    return [
      {
        id: 'cliche',
        tag: 'Line Cliché',
        chords: [`${root}m`, `${semitoneDown}aug`, bVI, `${bVI}m`]
      },
      {
        id: 'chromatic-alt',
        tag: 'Cromática',
        chords: [root, semitoneDown, bVI, bVII]
      },
      {
        id: 'epic-cinematic',
        tag: 'Cinemática',
        chords: [bVI, bVII, root, `${root}maj7`]
      },
      {
        id: 'soul-ballad',
        tag: 'Pop / Soul',
        chords: [root, `${root}aug`, IV, `${IV}m`]
      },
      {
        id: 'andalusian',
        tag: 'Flamenco',
        chords: [`${root}m`, bVII, bVI, V]
      }
    ];
  }, [currentKey]);

  const handlePlayChord = (chord: string) => {
    toneEngine.playChordPreviewStart(chord);
  };

  const handleMouseDownChord = (chord: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    toneEngine.playChordPreviewStart(chord);
    setDraggingChord(chord);
    if (window.__initialDragChordRef) {
      window.__initialDragChordRef.current = chord;
    }
  };

  const handleInsertConnector = (chord: string, sourceBeat: number) => {
    addChordBlock(chord, sourceBeat + 2, 2);
    handlePlayChord(chord);
    setOpenBridgeIndex(null);
  };

  const handleReplaceChord = (targetIndex: number, newChord: string) => {
    const target = activeChain[targetIndex];
    if (!target) return;
    if (target.isFromTimeline) {
      updateChordBlock(target.id, { chord: newChord });
      handlePlayChord(newChord);
    } else {
      addChordBlock(newChord, target.startBeat, target.durationBeats);
      handlePlayChord(newChord);
    }
    setOpenOrbitChordIndex(null);
  };

  const handlePlayRoute = async (routeId: string, chords: string[]) => {
    if (playingRouteId) return;
    setPlayingRouteId(routeId);
    for (let i = 0; i < chords.length; i++) {
      setPlayingStepIndex(i);
      toneEngine.playChordPreviewStart(chords[i]);
      await new Promise(r => setTimeout(r, 550));
    }
    toneEngine.playChordPreviewStop();
    setPlayingRouteId(null);
    setPlayingStepIndex(null);
  };

  const handleInsertFullRoute = (chords: string[]) => {
    let startBeat = chordBlocks.length > 0
      ? chordBlocks.reduce((max, b) => Math.max(max, b.startBeat + b.durationBeats), 0)
      : 0;

    chords.forEach(c => {
      addChordBlock(c, startBeat, 4);
      startBeat += 4;
    });
    handlePlayChord(chords[0]);
  };

  // FALLBACK VACÍO: Si no hay acordes en la línea de tiempo
  if (chordBlocks.length === 0) {
    return (
      <div className="alchemy-empty-radar">
        <div className="radar-screen">
          <div className="radar-grid-lines" />
          <div className="radar-sweep" />
          <Radio size={28} className="radar-icon-pulse" />
          <span className="radar-tag">SIN SEÑAL</span>
        </div>
      </div>
    );
  }

  return (
    <div className="alchemy-crt-canvas">
      {/* HEADER MINIMALISTA: Píldoras de Sección */}
      {detectedSections.length > 1 && (
        <div className="alchemy-top-bar">
          <div className="alchemy-section-pills">
            {detectedSections.map(sec => (
              <button
                key={sec.id}
                type="button"
                className={`alchemy-sec-pill ${activeSectionId === sec.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveSectionId(sec.id);
                  setOpenBridgeIndex(null);
                  setOpenOrbitChordIndex(null);
                }}
              >
                <Repeat size={10} />
                {sec.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* LIENZO DE NODOS FLOTANTES Y CIRCUITOS CRT */}
      <div className="alchemy-viewport">
        {/* LÍNEA TRONCAL: Constelación de Acordes Flotantes */}
        <div className="alchemy-spine-rail">
          {activeChain.map((node, idx) => {
            const role = getChordRole(node.chord, currentKey, scale);
            const roman = getChordRomanDegree(node.chord, currentKey, scale);
            const isOrbitOpen = openOrbitChordIndex === idx;
            const isBridgeOpen = openBridgeIndex === idx;

            return (
              <React.Fragment key={`${node.id}-${idx}`}>
                {/* NODO PRINCIPAL */}
                <div className="alchemy-node-cluster">
                  <div
                    className={`alchemy-chord-orb ${role} ${isOrbitOpen ? 'orbit-active' : ''}`}
                    onClick={() => {
                      setOpenOrbitChordIndex(isOrbitOpen ? null : idx);
                      setOpenBridgeIndex(null);
                      if (node.isFromTimeline) setSelectedChordId(node.id);
                      handlePlayChord(node.chord);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setOpenOrbitChordIndex(isOrbitOpen ? null : idx);
                      handlePlayChord(node.chord);
                    }}
                    onMouseDown={(e) => handleMouseDownChord(node.chord, e)}
                    title={`${node.chord} (${roman || ''})`}
                  >
                    <span className="orb-chord">{node.chord}</span>
                    <span className="orb-roman">{roman || '•'}</span>
                    <div className="orb-glow-aura" />
                  </div>

                  {/* ÓRBITA DE SUSTITUCIONES (Desplegada en cascada vertical) */}
                  {isOrbitOpen && (
                    <div className="alchemy-orbit-drawer">
                      <div className="orbit-wire-vertical" />
                      <div className="orbit-satellites">
                        {orbitSubstitutions.map((sub, si) => (
                          <div
                            key={`${sub.chord}-${si}`}
                            className="orbit-satellite-node"
                            onMouseDown={(e) => handleMouseDownChord(sub.chord, e)}
                            title={`${sub.chord} (${sub.tag})`}
                          >
                            <span className="satellite-chord">{sub.chord}</span>
                            <span className="satellite-tag">{sub.tag}</span>
                            <button
                              type="button"
                              className="satellite-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReplaceChord(idx, sub.chord);
                              }}
                              title="Reemplazar"
                            >
                              <CornerDownRight size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* CONECTOR ELÉCTRICO ENTRE NODOS */}
                {idx < activeChain.length - 1 && (
                  <div className="alchemy-bridge-zone">
                    <div className={`bridge-wire-h ${isBridgeOpen ? 'active' : ''}`} />
                    
                    <button
                      type="button"
                      className={`bridge-pulse-node ${isBridgeOpen ? 'active' : ''}`}
                      onClick={() => {
                        setOpenBridgeIndex(isBridgeOpen ? null : idx);
                        setOpenOrbitChordIndex(null);
                      }}
                      title="Puente de paso"
                    >
                      <Plus size={10} />
                    </button>

                    {/* ARCO DE PASO OVERHEAD */}
                    {isBridgeOpen && (
                      <div className="bridge-arc-overhead">
                        <div className="bridge-arc-satellites">
                          {bridgeChords.map((bc, bi) => (
                            <div
                              key={`${bc.chord}-${bi}`}
                              className={`bridge-satellite-chip ${bc.role}`}
                              onMouseDown={(e) => handleMouseDownChord(bc.chord, e)}
                            >
                              <span className="chip-chord">{bc.chord}</span>
                              <span className="chip-tag">{bc.tag}</span>
                              <button
                                type="button"
                                className="chip-insert-btn"
                                onClick={() => handleInsertConnector(bc.chord, node.startBeat)}
                                title="Intercalar"
                              >
                                <Plus size={9} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {/* NODO BIFURCACIÓN DE RUTAS FANTASMA */}
          <div className="alchemy-routes-trigger-wrap">
            <button
              type="button"
              className={`routes-trigger-orb ${showTechTree ? 'active' : ''}`}
              onClick={() => {
                setShowTechTree(prev => !prev);
                setOpenBridgeIndex(null);
                setOpenOrbitChordIndex(null);
              }}
              title="Rutas Alternativas"
            >
              <GitFork size={13} />
              <span className="routes-trigger-label">RUTAS</span>
            </button>
          </div>
        </div>

        {/* TECH-TREE DE RUTAS PARALELAS (Desplegable) */}
        {showTechTree && (
          <div className="alchemy-tech-tree">
            <div className="tech-tree-header">
              <span className="tech-tree-title">
                <Sparkles size={11} /> RUTAS ALTERNATIVAS
              </span>
            </div>

            <div className="tech-tree-branches">
              {evolutionaryRoutes.map((route) => {
                const isPlaying = playingRouteId === route.id;

                return (
                  <div 
                    key={route.id} 
                    className={`tech-tree-branch ${isPlaying ? 'playing' : ''}`}
                  >
                    <span className="branch-tag">{route.tag}</span>

                    <div className="branch-node-rail">
                      {route.chords.map((c, ci) => {
                        const isCurrentStep = isPlaying && playingStepIndex === ci;

                        return (
                          <React.Fragment key={ci}>
                            <div
                              className={`branch-step-node ${isCurrentStep ? 'step-glow' : ''}`}
                              onMouseDown={(e) => handleMouseDownChord(c, e)}
                            >
                              {c}
                            </div>
                            {ci < route.chords.length - 1 && (
                              <ChevronRight size={10} className="branch-arrow" />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>

                    <div className="branch-actions">
                      <button
                        type="button"
                        className="branch-btn play"
                        onClick={() => handlePlayRoute(route.id, route.chords)}
                        title="Oír"
                      >
                        <Play size={10} />
                      </button>
                      <button
                        type="button"
                        className="branch-btn insert"
                        onClick={() => handleInsertFullRoute(route.chords)}
                        title="Insertar"
                      >
                        <Plus size={10} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
