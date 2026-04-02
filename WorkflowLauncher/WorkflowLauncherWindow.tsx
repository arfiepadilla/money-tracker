// WorkflowLauncherWindow - Example demonstrating workflow:launch event
// Shows how one workflow can open another workflow

const WorkflowLauncherWindow: React.FC = () => {
  const [status, setStatus] = useState<string>('');
  const [workflowsRoot, setWorkflowsRoot] = useState<string>('');
  const [customPath, setCustomPath] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const eventBus = EventBus.getInstance();

  // Get the workflows root path on mount via event
  useEffect(() => {
    eventBus.publish('workflow:get-base-path', {
      callback: (path: string | null) => {
        setWorkflowsRoot(path || '');
      }
    });
  }, []);

  const launchWorkflow = (path: string, title: string) => {
    if (!path) {
      setStatus('Error: No path provided');
      return;
    }
    setStatus(`Launching ${title || path}...`);
    console.log('[WorkflowLauncher] Launching:', path);

    // Use the workflow:launch event to load and open the workflow
    eventBus.publish('workflow:launch', {
      path: path,
      title: title || path.replace(/^.*[/\\]/, '').replace(/\.(tsx|jsx)$/, ''),
    });

    setTimeout(() => setStatus(''), 2000);
  };

  const handleCustomLaunch = () => {
    // If path is relative, prepend the workflows root
    let fullPath = customPath;
    if (customPath && !customPath.match(/^[A-Za-z]:[/\\]/) && !customPath.startsWith('/')) {
      const separator = workflowsRoot.includes('\\') ? '\\' : '/';
      fullPath = `${workflowsRoot}${separator}${customPath}`;
    }
    launchWorkflow(fullPath, customTitle);
  };

  return (
    <div style={{
      padding: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      backgroundColor: '#1e1e1e',
      color: '#e0e0e0',
      overflow: 'auto',
    }}>
      <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>
        Workflow Launcher Example
      </h2>

      <p style={{ margin: 0, fontSize: '13px', color: '#888' }}>
        This example demonstrates how to use the <code style={{
          backgroundColor: '#2d2d2d',
          padding: '2px 6px',
          borderRadius: '3px',
          color: '#9cdcfe'
        }}>workflow:launch</code> event to open other workflows from within a workflow.
      </p>

      <div style={{
        backgroundColor: '#252526',
        padding: '12px',
        borderRadius: '6px',
        fontSize: '12px',
        fontFamily: 'monospace',
      }}>
        <div style={{ color: '#608b4e' }}>// Usage:</div>
        <div><span style={{ color: '#9cdcfe' }}>eventBus</span>.<span style={{ color: '#dcdcaa' }}>publish</span>(<span style={{ color: '#ce9178' }}>'workflow:launch'</span>, {'{'}</div>
        <div style={{ paddingLeft: '16px' }}><span style={{ color: '#9cdcfe' }}>path</span>: <span style={{ color: '#ce9178' }}>'/full/path/to/workflow.tsx'</span>,</div>
        <div style={{ paddingLeft: '16px' }}><span style={{ color: '#9cdcfe' }}>title</span>: <span style={{ color: '#ce9178' }}>'Tab Title'</span>,</div>
        <div style={{ paddingLeft: '16px' }}><span style={{ color: '#9cdcfe' }}>props</span>: {'{ }'} <span style={{ color: '#608b4e' }}>// optional</span></div>
        <div>{'}'});</div>
      </div>

      {/* Custom path input */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        backgroundColor: '#252526',
        borderRadius: '6px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>
          Launch by path:
        </div>
        <input
          type="text"
          placeholder="Path (absolute or relative to workflows root)"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          style={{
            padding: '8px 12px',
            backgroundColor: '#3c3c3c',
            border: '1px solid #555',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '13px',
            fontFamily: 'monospace',
          }}
        />
        <input
          type="text"
          placeholder="Tab title (optional)"
          value={customTitle}
          onChange={(e) => setCustomTitle(e.target.value)}
          style={{
            padding: '8px 12px',
            backgroundColor: '#3c3c3c',
            border: '1px solid #555',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '13px',
          }}
        />
        <button
          onClick={handleCustomLaunch}
          disabled={!customPath}
          style={{
            padding: '10px 16px',
            backgroundColor: customPath ? '#0e639c' : '#555',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: customPath ? 'pointer' : 'not-allowed',
            fontSize: '13px',
          }}
        >
          Launch Workflow
        </button>
        <div style={{ fontSize: '11px', color: '#888' }}>
          Examples: <code style={{ color: '#9cdcfe' }}>examples/SolarSystem/SolarSystemWindow.tsx</code>
          {' or '}
          <code style={{ color: '#9cdcfe' }}>user_workflows/MyWorkflow/MyWorkflow.tsx</code>
        </div>
      </div>

      {workflowsRoot && (
        <div style={{
          padding: '8px 12px',
          backgroundColor: '#2d2d2d',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'monospace',
          color: '#888',
          wordBreak: 'break-all',
        }}>
          Base path: {workflowsRoot}
        </div>
      )}

      {status && (
        <div style={{
          padding: '8px 12px',
          backgroundColor: status.startsWith('Error') ? '#5a1d1d' : '#264f78',
          borderRadius: '4px',
          fontSize: '13px',
        }}>
          {status}
        </div>
      )}
    </div>
  );
};

export default WorkflowLauncherWindow;
