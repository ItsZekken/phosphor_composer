import { useState } from 'react';
import { Activity, Play, CheckCircle, AlertTriangle, Cpu, X, Copy, Zap } from 'lucide-react';
import { runComparativeBenchmark, type ComparativeBenchmarkReport } from '../../core/audio/benchmarks/audioBenchmark';

interface AudioBenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AudioBenchmarkModal = ({ isOpen, onClose }: AudioBenchmarkModalProps) => {
  const [isRunning, setIsRunning] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [report, setReport] = useState<ComparativeBenchmarkReport | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleStartBenchmark = async () => {
    setIsRunning(true);
    setProgressPercent(0);
    setProgressText('Iniciando entorno de pruebas...');

    try {
      const result = await runComparativeBenchmark((step, pct) => {
        setProgressText(step);
        setProgressPercent(Math.round(pct));
      });
      setReport(result);
    } catch (err) {
      console.error('Error al ejecutar benchmark:', err);
      setProgressText('Error en la ejecución del benchmark.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyReport = () => {
    if (!report) return;
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)'
      }}
    >
      <div
        className="modal-content phosphor-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '90%',
          maxWidth: '840px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0c120c',
          border: '2px solid #22c55e',
          borderRadius: '8px',
          boxShadow: '0 0 30px rgba(34, 197, 94, 0.25)',
          color: '#dcfce7',
          padding: '24px',
          fontFamily: 'monospace'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #166534', paddingBottom: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Activity size={24} color="#22c55e" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#4ade80', letterSpacing: '0.05em' }}>
              FASE 4: COMPUERTA DE DECISIÓN & TELEMETRÍA TRI-ENGINE
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#86efac', cursor: 'pointer', padding: '4px' }}
            title="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Descripción de la prueba */}
        <p style={{ fontSize: '0.9rem', color: '#86efac', lineHeight: '1.5', margin: '0 0 16px 0' }}>
          Este arnés evalúa de forma empírica el rendimiento de síntesis (Multi-oscilador PolyBLEP + Filtro Cytomic SVF + ADSR)
          comparando <strong>Tone.js Graph</strong> vs. <strong>TypeScript AudioWorklet</strong> vs. <strong>WebAssembly (WASM)</strong>.
        </p>

        {/* Botón de Ejecución & Barra de Progreso */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
          <button
            onClick={handleStartBenchmark}
            disabled={isRunning}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: isRunning ? '#14532d' : '#16a34a',
              color: '#ffffff',
              border: '1px solid #4ade80',
              padding: '10px 20px',
              borderRadius: '4px',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '0.95rem'
            }}
          >
            {isRunning ? <Cpu className="spin-slow" size={18} /> : <Play size={18} />}
            {isRunning ? 'Ejecutando Pruebas...' : 'Ejecutar Benchmark Tri-Engine'}
          </button>

          {report && (
            <button
              onClick={handleCopyReport}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#142914',
                color: '#86efac',
                border: '1px solid #22c55e',
                padding: '10px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              <Copy size={16} />
              {copied ? '¡Copiado JSON!' : 'Copiar Informe'}
            </button>
          )}
        </div>

        {/* Indicador de Progreso en Vivo */}
        {isRunning && (
          <div style={{ marginBottom: '20px', backgroundColor: '#051b05', border: '1px solid #22c55e', borderRadius: '4px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.85rem' }}>
              <span style={{ color: '#4ade80' }}>{progressText}</span>
              <span style={{ color: '#22c55e', fontWeight: 'bold' }}>{progressPercent}%</span>
            </div>
            <div style={{ width: '100%', height: '8px', backgroundColor: '#0f290f', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  backgroundColor: '#22c55e',
                  boxShadow: '0 0 10px #22c55e',
                  transition: 'width 0.2s ease-out'
                }}
              />
            </div>
          </div>
        )}

        {/* Cuadro de Veredicto de Decisión */}
        {report && (
          <div
            style={{
              backgroundColor: report.decisionVerdict === 'MANTENER_TYPESCRIPT' ? '#06280e' : '#2e1c03',
              border: `2px solid ${report.decisionVerdict === 'MANTENER_TYPESCRIPT' ? '#22c55e' : '#eab308'}`,
              borderRadius: '6px',
              padding: '16px',
              marginBottom: '24px',
              boxShadow: `0 0 15px ${report.decisionVerdict === 'MANTENER_TYPESCRIPT' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)'}`
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              {report.decisionVerdict === 'MANTENER_TYPESCRIPT' ? (
                <CheckCircle size={22} color="#4ade80" />
              ) : (
                <AlertTriangle size={22} color="#facc15" />
              )}
              <h3
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                  color: report.decisionVerdict === 'MANTENER_TYPESCRIPT' ? '#4ade80' : '#facc15',
                  fontWeight: 'bold'
                }}
              >
                {report.verdictScoreExplanation.split('.')[0]}
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#dcfce7', lineHeight: '1.4' }}>
              {report.verdictScoreExplanation}
            </p>
          </div>
        )}

        {/* Tabla Comparativa de Rendimiento */}
        {report && (
          <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.85rem',
                textAlign: 'left'
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#0f290f', borderBottom: '2px solid #22c55e', color: '#86efac' }}>
                  <th style={{ padding: '10px' }}>Voces</th>
                  <th style={{ padding: '10px' }}>Tone.js (µs / CPU%)</th>
                  <th style={{ padding: '10px' }}>TS Worklet (µs / CPU%)</th>
                  <th style={{ padding: '10px' }}>WASM (µs / CPU%)</th>
                  <th style={{ padding: '10px' }}>Speedup vs Tone</th>
                </tr>
              </thead>
              <tbody>
                {report.voiceCounts.map((vc, idx) => {
                  const rTone = report.toneJsResults[idx];
                  const rTs = report.tsWorkletResults[idx];
                  const rWasm = report.wasmMvpResults[idx];
                  const speedup = (rTone.renderTimeMs / Math.max(0.01, rTs.renderTimeMs)).toFixed(1);

                  return (
                    <tr
                      key={vc}
                      style={{
                        borderBottom: '1px solid #143814',
                        backgroundColor: idx % 2 === 0 ? 'rgba(5, 27, 5, 0.4)' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '10px', fontWeight: 'bold', color: '#4ade80' }}>{vc} Voces</td>
                      <td style={{ padding: '10px', color: '#f87171' }}>
                        {rTone.blockDurationUs} µs ({rTone.cpuUsagePercent}%)
                      </td>
                      <td style={{ padding: '10px', color: '#60a5fa', fontWeight: 'bold' }}>
                        {rTs.blockDurationUs} µs ({rTs.cpuUsagePercent}%)
                      </td>
                      <td style={{ padding: '10px', color: '#a78bfa' }}>
                        {rWasm.blockDurationUs} µs ({rWasm.cpuUsagePercent}%)
                      </td>
                      <td style={{ padding: '10px', color: '#22c55e', fontWeight: 'bold' }}>
                        <Zap size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                        {speedup}x más rápido
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #166534', paddingTop: '16px' }}>
          <button
            onClick={onClose}
            style={{
              backgroundColor: '#142914',
              color: '#dcfce7',
              border: '1px solid #22c55e',
              padding: '8px 18px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
