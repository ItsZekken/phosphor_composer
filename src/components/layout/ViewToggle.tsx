import { useSongStore } from '../../store/songStore';

export const ViewToggle = () => {
  const activeView = useSongStore(state => state.activeView);
  const setActiveView = useSongStore(state => state.setActiveView);

  return (
    <div className="view-toggle-container">
      <span className="mock-label" style={{ marginRight: '8px', fontSize: '0.65rem', fontFamily: '"Share Tech Mono", monospace' }}>
        SELECCIONAR VISTA:
      </span>
      <button
        className={`toggle-btn ${activeView === 'chord' ? 'active' : ''}`}
        onClick={() => setActiveView('chord')}
      >
        <span style={{ 
          display: 'inline-block', 
          width: '6px', 
          height: '6px', 
          borderRadius: '50%', 
          backgroundColor: activeView === 'chord' ? '#82a5f5' : '#3a324a', 
          marginRight: '8px',
          boxShadow: activeView === 'chord' ? '0 0 6px #82a5f5, 0 0 10px #82a5f5' : 'none',
          verticalAlign: 'middle',
          transition: 'background-color 0.15s'
        }}></span>
        CHORD PALETTE
      </button>
      <button
        className={`toggle-btn ${activeView === 'piano-roll' ? 'active' : ''}`}
        onClick={() => setActiveView('piano-roll')}
      >
        <span style={{ 
          display: 'inline-block', 
          width: '6px', 
          height: '6px', 
          borderRadius: '50%', 
          backgroundColor: activeView === 'piano-roll' ? '#82a5f5' : '#3a324a', 
          marginRight: '8px',
          boxShadow: activeView === 'piano-roll' ? '0 0 6px #82a5f5, 0 0 10px #82a5f5' : 'none',
          verticalAlign: 'middle',
          transition: 'background-color 0.15s'
        }}></span>
        PIANO ROLL
      </button>
      <button
        className={`toggle-btn ${activeView === 'sequencer' ? 'active' : ''}`}
        onClick={() => setActiveView('sequencer')}
      >
        <span style={{ 
          display: 'inline-block', 
          width: '6px', 
          height: '6px', 
          borderRadius: '50%', 
          backgroundColor: activeView === 'sequencer' ? '#82a5f5' : '#3a324a', 
          marginRight: '8px',
          boxShadow: activeView === 'sequencer' ? '0 0 6px #82a5f5, 0 0 10px #82a5f5' : 'none',
          verticalAlign: 'middle',
          transition: 'background-color 0.15s'
        }}></span>
        DRUM SEQUENCER
      </button>
      <button
        className={`toggle-btn ${activeView === 'visualizer' ? 'active' : ''}`}
        onClick={() => setActiveView('visualizer')}
      >
        <span style={{ 
          display: 'inline-block', 
          width: '6px', 
          height: '6px', 
          borderRadius: '50%', 
          backgroundColor: activeView === 'visualizer' ? '#5a9e7a' : '#3a324a', 
          marginRight: '8px',
          boxShadow: activeView === 'visualizer' ? '0 0 6px #5a9e7a, 0 0 10px #5a9e7a' : 'none',
          verticalAlign: 'middle',
          transition: 'background-color 0.15s'
        }}></span>
        STAGE
      </button>
    </div>
  );
};
