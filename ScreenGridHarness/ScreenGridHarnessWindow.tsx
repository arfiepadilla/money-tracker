// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

/**
 * Screen Grid Harness Window
 *
 * A tool for AI-driven automation of any application via native OS input.
 * Features:
 * - Screenshot capture with coordinate grid overlay
 * - Multiple grid density presets (coarse, medium, fine, ultra)
 * - Spreadsheet-style cell references (A1, B4, AA15) or pixel coordinates
 * - Native mouse/keyboard input simulation
 * - Action history logging
 */

interface MonitorInfo {
  index: number;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface GridConfigState {
  density: string;
  cell_width: number;
  cell_height: number;
  show_labels: boolean;
  label_frequency: number;
}

interface ActionHistoryItem {
  action: string;
  coordinate?: string;
  x?: number;
  y?: number;
  button?: string;
  clicks?: number;
  text?: string;
  keys?: string;
  timestamp: string;
}

interface ServerStatus {
  grid_config: GridConfigState;
  action_count: number;
  has_screenshot: boolean;
}

// Required Python packages
const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'mss', 'pillow', 'pyautogui', 'httpx'];

// Storage key for remembering selected venv
const STORAGE_KEY_VENV = 'screengrid-selected-venv';

// Registry URL for tool discovery
const REGISTRY_URL = 'http://127.0.0.1:8800';

// Tool definition interface
interface ToolDefinition {
  name: string;
  namespace: string;
  version: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

// Grid density presets
const DENSITY_PRESETS = [
  { label: 'Coarse (100x100)', value: 'coarse', description: 'Large cells, good for big buttons' },
  { label: 'Medium (50x50)', value: 'medium', description: 'Balanced precision and visibility' },
  { label: 'Fine (25x25)', value: 'fine', description: 'Precise clicking' },
  { label: 'Ultra (10x10)', value: 'ultra', description: 'Maximum precision' },
];

export const ScreenGridHarnessWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8790);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');

  // Dependency checking state
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [showDepsPanel, setShowDepsPanel] = useState(true);

  // Screenshot state
  const [screenshotData, setScreenshotData] = useState<string | null>(null);
  const [screenshotSize, setScreenshotSize] = useState<{ width: number; height: number } | null>(null);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState(1);
  const [capturing, setCapturing] = useState(false);

  // Grid configuration
  const [gridDensity, setGridDensity] = useState('medium');
  const [showGrid, setShowGrid] = useState(true);
  const [gridConfig, setGridConfig] = useState<GridConfigState | null>(null);

  // Coordinate input
  const [coordinateInput, setCoordinateInput] = useState('');
  const [translatedCoord, setTranslatedCoord] = useState<{ x: number; y: number; cell: string } | null>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number; cell: string } | null>(null);

  // Action execution
  const [actionType, setActionType] = useState<'click' | 'move' | 'type' | 'key' | 'scroll'>('click');
  const [clickButton, setClickButton] = useState('left');
  const [clickCount, setClickCount] = useState(1);
  const [typeText, setTypeText] = useState('');
  const [keyCombo, setKeyCombo] = useState('');
  const [scrollAmount, setScrollAmount] = useState(3);
  const [executing, setExecuting] = useState(false);

  // History
  const [actionHistory, setActionHistory] = useState<ActionHistoryItem[]>([]);

  // Tools state (MCP registry)
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<'capture' | 'actions' | 'history' | 'setup' | 'tools'>('setup');
  const [logs, setLogs] = useState<string[]>([]);
  const [logPanelHeight, setLogPanelHeight] = useState(150);
  const [isDraggingLogPanel, setIsDraggingLogPanel] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Image display
  const [imageZoom, setImageZoom] = useState(1);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-200), `[${timestamp}] ${msg}`]);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Log panel resize handlers
  const handleLogPanelDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLogPanel(true);
  }, []);

  useEffect(() => {
    if (!isDraggingLogPanel) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newHeight = containerRect.bottom - e.clientY;
      setLogPanelHeight(Math.max(60, Math.min(400, newHeight)));
    };

    const handleMouseUp = () => {
      setIsDraggingLogPanel(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingLogPanel]);

  // Listen for Python process logs
  useEffect(() => {
    if (!ipcRenderer) return;

    const handlePythonLog = (_event: any, log: string) => {
      const trimmed = log.trim();
      if (trimmed.includes('GET /status') || trimmed.includes('GET /health')) return;
      addLog(`[Server] ${trimmed}`);
    };

    ipcRenderer.on('python-log', handlePythonLog);
    ipcRenderer.on('python-error', handlePythonLog);

    return () => {
      ipcRenderer.removeListener('python-log', handlePythonLog);
      ipcRenderer.removeListener('python-error', handlePythonLog);
    };
  }, [ipcRenderer, addLog]);

  // Load available venvs and restore last used
  useEffect(() => {
    const loadVenvs = async () => {
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke('python-list-venvs');
      if (result.success && result.venvs.length > 0) {
        const names = result.venvs.map((v: any) => v.name);
        setAvailableVenvs(names);

        const savedVenv = localStorage.getItem(STORAGE_KEY_VENV);
        if (savedVenv && names.includes(savedVenv)) {
          setSelectedVenv(savedVenv);
        } else if (!selectedVenv) {
          setSelectedVenv(names[0]);
        }
      }
    };
    loadVenvs();
  }, [ipcRenderer]);

  // Save selected venv to localStorage
  useEffect(() => {
    if (selectedVenv) {
      localStorage.setItem(STORAGE_KEY_VENV, selectedVenv);
    }
  }, [selectedVenv]);

  // Check dependencies when venv changes
  useEffect(() => {
    const autoCheckDeps = async () => {
      if (!selectedVenv || !ipcRenderer) return;

      setCheckingDeps(true);
      try {
        const vres = await ipcRenderer.invoke('python-list-venvs');
        if (vres.success) {
          const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
          if (v && Array.isArray(v.packages)) {
            const map: Record<string, any> = {};
            for (const pkg of REQUIRED_PACKAGES) {
              const pkgNormalized = pkg.toLowerCase().replace(/-/g, '_').replace(/_/g, '');
              const found = v.packages.find((p: string) => {
                const pNormalized = p.toLowerCase().split(' ')[0].replace(/-/g, '_').replace(/_/g, '');
                return pNormalized === pkgNormalized || pNormalized.startsWith(pkgNormalized);
              });
              map[pkg] = { installed: !!found, version: found ? found.split(' ')[1] : undefined };
            }
            setDepsStatus(map);
          }
        }
      } catch (err) {
        console.error('Error checking dependencies:', err);
      } finally {
        setCheckingDeps(false);
      }
    };

    autoCheckDeps();
  }, [selectedVenv, ipcRenderer]);

  // Install missing dependencies
  const installMissingDeps = async () => {
    if (!ipcRenderer || !selectedVenv) return;

    const missing = REQUIRED_PACKAGES.filter(pkg => !depsStatus[pkg]?.installed);
    if (missing.length === 0) {
      addLog('All dependencies already installed');
      return;
    }

    setInstallingDeps(true);
    addLog(`Installing ${missing.length} packages: ${missing.join(', ')}...`);

    try {
      for (const pkg of missing) {
        addLog(`Installing ${pkg}...`);

        const result = await ipcRenderer.invoke('python-install-package', {
          venvName: selectedVenv,
          package: pkg,
        });

        if (result.success) {
          addLog(`${pkg} installed`);
          setDepsStatus(prev => ({ ...prev, [pkg]: { installed: true, version: undefined } }));
        } else {
          addLog(`ERROR installing ${pkg}: ${result.error}`);
        }
      }

      addLog('Dependency installation complete');

      // Re-check deps to get versions
      const vres = await ipcRenderer.invoke('python-list-venvs');
      if (vres.success) {
        const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
        if (v && Array.isArray(v.packages)) {
          const map: Record<string, any> = {};
          for (const pkg of REQUIRED_PACKAGES) {
            const found = v.packages.find((p: string) => p.toLowerCase().startsWith(pkg.toLowerCase()));
            map[pkg] = { installed: !!found, version: found ? found.split(' ')[1] : undefined };
          }
          setDepsStatus(map);
        }
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setInstallingDeps(false);
    }
  };

  const getServerUrl = () => `http://127.0.0.1:${serverPort}`;

  // Status polling
  const checkServerStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getServerUrl()}/status`);
      if (res.ok) {
        const status = await res.json();
        setServerStatus(status);
        setServerRunning(true);
        setGridConfig(status.grid_config);
        return true;
      }
    } catch {
      setServerRunning(false);
      setServerStatus(null);
    }
    return false;
  }, [serverPort]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (serverRunning) {
        checkServerStatus();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [serverRunning, checkServerStatus]);

  const fetchMonitors = async () => {
    try {
      const res = await fetch(`${getServerUrl()}/monitors`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setMonitors(data.monitors);
        }
      }
    } catch { }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${getServerUrl()}/history?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setActionHistory(data.history || []);
      }
    } catch { }
  };

  // Track previous tool count to avoid noisy logs
  const prevToolCountRef = useRef<number>(0);

  // Fetch tools from registry
  const fetchTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const response = await fetch(`${REGISTRY_URL}/tools?namespace=screen_grid`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success) {
        const screenGridTools = (data.tools || []).filter(
          (t: ToolDefinition) => t.namespace === 'screen_grid'
        );
        setTools(screenGridTools);
        // Only log when tool count changes
        if (screenGridTools.length !== prevToolCountRef.current) {
          if (screenGridTools.length > 0) {
            addLog(`Found ${screenGridTools.length} tools in registry`);
          } else if (prevToolCountRef.current > 0) {
            addLog('No tools registered');
          }
          prevToolCountRef.current = screenGridTools.length;
        }
      }
    } catch (err: any) {
      // Silently fail - registry may not be running
      setTools([]);
    } finally {
      setLoadingTools(false);
    }
  }, [addLog]);

  // Poll for tools when server is running
  useEffect(() => {
    if (!serverRunning) return;

    fetchTools();
    const interval = setInterval(fetchTools, 5000);
    return () => clearInterval(interval);
  }, [serverRunning, fetchTools]);

  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting Screen Grid Harness server...');

    const alreadyRunning = await checkServerStatus();
    if (alreadyRunning) {
      addLog('Server already running!');
      await fetchMonitors();
      setConnecting(false);
      return;
    }

    if (!selectedVenv) {
      addLog('ERROR: No Python venv selected');
      setConnecting(false);
      return;
    }

    const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
      workflowFolder: 'ScreenGridHarness',
      scriptName: 'screen_grid_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find screen_grid_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'screen-grid-harness',
    });

    if (result.success) {
      addLog(`Server started (PID: ${result.pid}), connecting...`);

      let attempts = 0;
      const maxAttempts = 20;
      const pollInterval = setInterval(async () => {
        attempts++;
        const isReady = await checkServerStatus();
        if (isReady) {
          clearInterval(pollInterval);
          addLog('Server connected!');
          await fetchMonitors();
          setConnecting(false);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          addLog('ERROR: Server timeout');
          setConnecting(false);
        }
      }, 500);
    } else {
      addLog(`ERROR: ${result.error}`);
      setConnecting(false);
    }
  };

  const stopServer = async () => {
    if (!ipcRenderer) return;

    const result = await ipcRenderer.invoke('python-stop-script-server', 'screen-grid-harness');
    if (result.success) {
      addLog('Server stopped');
    } else {
      try {
        await fetch(`${getServerUrl()}/shutdown`, { method: 'POST' });
        addLog('Server shutdown requested');
      } catch {
        addLog('Server not responding');
      }
    }
    setServerRunning(false);
    setServerStatus(null);
  };

  // Grid configuration
  const updateGridConfig = async (density: string) => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/grid_config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ density }),
      });
      const data = await res.json();
      if (data.success) {
        setGridConfig(data.config);
        setGridDensity(density);
        addLog(`Grid density set to ${density}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // Screenshot capture
  const captureScreen = async () => {
    if (!serverRunning) return;

    setCapturing(true);
    addLog(`Capturing screen (monitor ${selectedMonitor})...`);

    try {
      const res = await fetch(`${getServerUrl()}/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monitor_index: selectedMonitor,
          render_grid: showGrid,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setScreenshotData(`data:image/png;base64,${data.image_b64}`);
        setScreenshotSize({ width: data.width, height: data.height });
        addLog(`Captured ${data.width}x${data.height} screenshot`);
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setCapturing(false);
    }
  };

  // Coordinate translation
  const translateCoordinate = async () => {
    if (!serverRunning || !coordinateInput.trim()) return;

    try {
      const res = await fetch(`${getServerUrl()}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinate: coordinateInput }),
      });
      const data = await res.json();
      if (data.success) {
        setTranslatedCoord({ x: data.x, y: data.y, cell: data.cell });
        addLog(`${coordinateInput} -> (${data.x}, ${data.y}) [${data.cell}]`);
      } else {
        addLog(`ERROR: ${data.error}`);
        setTranslatedCoord(null);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // Execute actions
  const executeAction = async () => {
    if (!serverRunning || !coordinateInput.trim()) return;

    setExecuting(true);

    try {
      let endpoint = '';
      let body: any = {};

      switch (actionType) {
        case 'click':
          endpoint = '/click';
          body = { coordinate: coordinateInput, button: clickButton, clicks: clickCount };
          break;
        case 'move':
          endpoint = '/move';
          body = { coordinate: coordinateInput, duration: 0.1 };
          break;
        case 'type':
          endpoint = '/type';
          body = { text: typeText, interval: 0.02 };
          break;
        case 'key':
          endpoint = '/key';
          body = { keys: keyCombo };
          break;
        case 'scroll':
          endpoint = '/scroll';
          body = { coordinate: coordinateInput, clicks: scrollAmount };
          break;
      }

      const res = await fetch(`${getServerUrl()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        addLog(`Action executed: ${actionType}`);
        await fetchHistory();
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setExecuting(false);
    }
  };

  // Get current mouse position
  const fetchMousePosition = async () => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/mouse_position`);
      const data = await res.json();
      if (data.success) {
        setMousePosition({ x: data.x, y: data.y, cell: data.cell });
      }
    } catch { }
  };

  // Poll mouse position when on capture tab
  useEffect(() => {
    if (!serverRunning || activeTab !== 'capture') return;

    const interval = setInterval(fetchMousePosition, 500);
    return () => clearInterval(interval);
  }, [serverRunning, activeTab]);

  const clearHistory = async () => {
    if (serverRunning) {
      await fetch(`${getServerUrl()}/history/clear`, { method: 'POST' });
    }
    setActionHistory([]);
    addLog('History cleared');
  };

  // Tailwind class helpers
  const buttonClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-emerald-600 text-white text-xs flex items-center gap-1 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed';
  const buttonSecondaryClass = 'py-1.5 px-3 border border-slate-600 rounded cursor-pointer bg-slate-800 text-white text-xs flex items-center gap-1 hover:bg-slate-700';
  const inputClass = 'py-1.5 px-2.5 border border-slate-700 rounded bg-[#252525] text-white text-xs focus:border-emerald-500 focus:outline-none';
  const sectionClass = 'bg-slate-900 rounded-lg p-3.5 mb-2.5';
  const tabClass = (isActive: boolean) =>
    `py-2 px-4 border-none cursor-pointer text-xs transition-colors ${isActive ? 'bg-slate-900 text-white border-b-2 border-emerald-500' : 'bg-transparent text-slate-500 border-b-2 border-transparent hover:text-slate-300'}`;

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="py-2.5 px-4 border-b border-slate-800 flex items-center gap-3 bg-[#161616]">
        <div>
          <h2 className="m-0 text-sm">Screen Grid Harness</h2>
          <div className="text-[10px] text-slate-600">Native OS Automation</div>
        </div>
        <div className="ml-auto flex items-center gap-2.5 text-[11px]">
          {serverRunning && (
            <span className="text-emerald-500">Server Running</span>
          )}
          {tools.length > 0 && (
            <span className="text-amber-400">{tools.length} Tools</span>
          )}
          {mousePosition && (
            <span className="text-slate-500">
              Mouse: {mousePosition.cell} ({mousePosition.x}, {mousePosition.y})
            </span>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-slate-800 bg-[#161616]">
        <button className={tabClass(activeTab === 'setup')} onClick={() => setActiveTab('setup')}>Setup</button>
        <button className={tabClass(activeTab === 'capture')} onClick={() => setActiveTab('capture')}>Capture</button>
        <button className={tabClass(activeTab === 'actions')} onClick={() => setActiveTab('actions')}>Actions</button>
        <button className={tabClass(activeTab === 'history')} onClick={() => setActiveTab('history')}>History ({actionHistory.length})</button>
        <button className={tabClass(activeTab === 'tools')} onClick={() => setActiveTab('tools')}>Tools ({tools.length})</button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden p-2.5">

        {/* Setup Tab */}
        {activeTab === 'setup' && (
          <div className="flex-1 overflow-auto">
            {/* Server Connection */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Server</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={selectedVenv} onChange={e => setSelectedVenv(e.target.value)} className={`${inputClass} w-[140px]`} disabled={serverRunning}>
                  {availableVenvs.length === 0 ? <option value="">No venvs</option> : availableVenvs.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <input type="number" value={serverPort} onChange={e => setServerPort(parseInt(e.target.value) || 8790)} className={`${inputClass} w-[70px]`} disabled={serverRunning} />
                {!serverRunning ? (
                  <button onClick={startServer} disabled={connecting || !selectedVenv} className={buttonClass}>
                    {connecting ? 'Connecting...' : 'Start Server'}
                  </button>
                ) : (
                  <button onClick={stopServer} className={`${buttonClass} bg-red-600 hover:bg-red-500`}>Stop</button>
                )}
              </div>
            </div>

            {/* Dependencies */}
            <div className={sectionClass}>
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setShowDepsPanel(!showDepsPanel)}
              >
                <h3 className="m-0 text-[13px]">Dependencies</h3>
                <span className="text-[10px] text-slate-500">{showDepsPanel ? '...' : '>'}</span>
              </div>
              {showDepsPanel && (
                <div className="mt-2.5">
                  {checkingDeps ? (
                    <div className="text-[11px] text-slate-500">Checking dependencies...</div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        {REQUIRED_PACKAGES.map(pkg => (
                          <div
                            key={pkg}
                            className={`py-0.5 px-2 rounded text-[10px] ${depsStatus[pkg]?.installed
                              ? 'bg-emerald-950 border border-emerald-500 text-emerald-500'
                              : 'bg-red-950 border border-red-500 text-red-500'
                              }`}
                          >
                            {pkg} {depsStatus[pkg]?.version && `(${depsStatus[pkg].version})`}
                          </div>
                        ))}
                      </div>
                      {REQUIRED_PACKAGES.some(pkg => !depsStatus[pkg]?.installed) && (
                        <button
                          onClick={installMissingDeps}
                          disabled={installingDeps || !selectedVenv}
                          className={`${buttonClass} ${installingDeps ? 'bg-slate-600' : 'bg-orange-500 hover:bg-orange-400'}`}
                        >
                          {installingDeps ? 'Installing...' : 'Install Missing'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Grid Configuration */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Grid Configuration</h3>
              <div className="flex flex-wrap gap-2">
                {DENSITY_PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    onClick={() => updateGridConfig(preset.value)}
                    disabled={!serverRunning}
                    className={`${gridDensity === preset.value ? buttonClass : buttonSecondaryClass}`}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {gridConfig && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Current: {gridConfig.cell_width}x{gridConfig.cell_height}px cells
                </div>
              )}
            </div>

            {/* Monitors */}
            {monitors.length > 0 && (
              <div className={sectionClass}>
                <h3 className="m-0 mb-2.5 text-[13px]">Monitors</h3>
                <div className="flex flex-wrap gap-2">
                  {monitors.map(mon => (
                    <button
                      key={mon.index}
                      onClick={() => setSelectedMonitor(mon.index)}
                      className={selectedMonitor === mon.index ? buttonClass : buttonSecondaryClass}
                    >
                      {mon.name} ({mon.width}x{mon.height})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Capture Tab */}
        {activeTab === 'capture' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Capture Controls */}
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <button
                onClick={captureScreen}
                disabled={!serverRunning || capturing}
                className={buttonClass}
              >
                {capturing ? 'Capturing...' : 'Capture Screenshot'}
              </button>
              <label className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={e => setShowGrid(e.target.checked)}
                />
                Show Grid
              </label>
              <select
                value={gridDensity}
                onChange={e => updateGridConfig(e.target.value)}
                className={`${inputClass} w-[120px]`}
                disabled={!serverRunning}
              >
                {DENSITY_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>

              <div className="ml-auto flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Zoom:</span>
                <input
                  type="range"
                  min="0.25"
                  max="2"
                  step="0.25"
                  value={imageZoom}
                  onChange={e => setImageZoom(parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="text-[11px] text-slate-400">{(imageZoom * 100).toFixed(0)}%</span>
              </div>
            </div>

            {/* Screenshot Display */}
            <div
              ref={imageContainerRef}
              className="flex-1 overflow-auto bg-slate-900 rounded-lg flex items-start justify-start p-2"
            >
              {screenshotData ? (
                <img
                  src={screenshotData}
                  alt="Screenshot"
                  style={{
                    transform: `scale(${imageZoom})`,
                    transformOrigin: 'top left',
                    imageRendering: imageZoom > 1 ? 'pixelated' : 'auto',
                  }}
                  className="max-w-none"
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-600 text-xs h-full w-full">
                  {serverRunning ? 'Click "Capture Screenshot" to begin' : 'Start the server first'}
                </div>
              )}
            </div>

            {screenshotSize && (
              <div className="mt-2 text-[11px] text-slate-500 text-center">
                {screenshotSize.width} x {screenshotSize.height} pixels
              </div>
            )}
          </div>
        )}

        {/* Actions Tab */}
        {activeTab === 'actions' && (
          <div className="flex-1 overflow-auto">
            {/* Coordinate Input */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Coordinate</h3>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={coordinateInput}
                  onChange={e => setCoordinateInput(e.target.value)}
                  placeholder="A1, B4, 320,150..."
                  className={`${inputClass} flex-1`}
                  onKeyDown={e => e.key === 'Enter' && translateCoordinate()}
                />
                <button onClick={translateCoordinate} disabled={!serverRunning} className={buttonSecondaryClass}>
                  Translate
                </button>
              </div>
              {translatedCoord && (
                <div className="text-[11px] text-emerald-400">
                  Pixel: ({translatedCoord.x}, {translatedCoord.y}) | Cell: {translatedCoord.cell}
                </div>
              )}
            </div>

            {/* Action Type Selection */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Action Type</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {(['click', 'move', 'type', 'key', 'scroll'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setActionType(type)}
                    className={actionType === type ? buttonClass : buttonSecondaryClass}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>

              {/* Action-specific options */}
              {actionType === 'click' && (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">Button:</span>
                    <select value={clickButton} onChange={e => setClickButton(e.target.value)} className={`${inputClass} w-[80px]`}>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="middle">Middle</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">Clicks:</span>
                    <input
                      type="number"
                      min="1"
                      max="3"
                      value={clickCount}
                      onChange={e => setClickCount(parseInt(e.target.value) || 1)}
                      className={`${inputClass} w-[50px]`}
                    />
                  </div>
                </div>
              )}

              {actionType === 'type' && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Text:</span>
                  <input
                    type="text"
                    value={typeText}
                    onChange={e => setTypeText(e.target.value)}
                    placeholder="Text to type..."
                    className={`${inputClass} flex-1`}
                  />
                </div>
              )}

              {actionType === 'key' && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Keys:</span>
                  <input
                    type="text"
                    value={keyCombo}
                    onChange={e => setKeyCombo(e.target.value)}
                    placeholder="ctrl+c, enter, alt+tab..."
                    className={`${inputClass} flex-1`}
                  />
                </div>
              )}

              {actionType === 'scroll' && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Amount:</span>
                  <input
                    type="number"
                    value={scrollAmount}
                    onChange={e => setScrollAmount(parseInt(e.target.value) || 0)}
                    className={`${inputClass} w-[60px]`}
                  />
                  <span className="text-[10px] text-slate-600">(+ up, - down)</span>
                </div>
              )}
            </div>

            {/* Execute Button */}
            <div className={sectionClass}>
              <button
                onClick={executeAction}
                disabled={!serverRunning || executing || !coordinateInput.trim()}
                className={`${buttonClass} w-full justify-center py-3 text-sm`}
              >
                {executing ? 'Executing...' : `Execute ${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`}
              </button>
            </div>

            {/* Quick Actions */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Quick Keys</h3>
              <div className="flex flex-wrap gap-2">
                {['enter', 'escape', 'tab', 'backspace', 'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+z'].map(key => (
                  <button
                    key={key}
                    onClick={async () => {
                      try {
                        await fetch(`${getServerUrl()}/key`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ keys: key }),
                        });
                        addLog(`Pressed: ${key}`);
                        await fetchHistory();
                      } catch (e: any) {
                        addLog(`ERROR: ${e.message}`);
                      }
                    }}
                    disabled={!serverRunning}
                    className={buttonSecondaryClass}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-auto">
            <div className="p-2.5 border-b border-slate-800 flex gap-2">
              <button onClick={fetchHistory} disabled={!serverRunning} className={buttonSecondaryClass}>Refresh</button>
              <button onClick={clearHistory} className={`${buttonClass} bg-red-600 hover:bg-red-500`}>Clear History</button>
            </div>

            {actionHistory.length === 0 ? (
              <div className="text-center text-slate-600 text-xs mt-10">
                No actions yet
              </div>
            ) : (
              <div className="p-2.5">
                {actionHistory.slice().reverse().map((item, i) => (
                  <div key={i} className="bg-slate-900 rounded-lg p-3 mb-2 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-emerald-600 rounded text-white text-[10px]">
                        {item.action.toUpperCase()}
                      </span>
                      <span className="text-slate-500 text-[10px]">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      {item.coordinate && <span>Coord: {item.coordinate} </span>}
                      {item.x !== undefined && item.y !== undefined && (
                        <span>({item.x}, {item.y}) </span>
                      )}
                      {item.button && <span>Button: {item.button} </span>}
                      {item.clicks && item.clicks > 1 && <span>Clicks: {item.clicks} </span>}
                      {item.text && <span>Text: "{item.text.substring(0, 30)}..." </span>}
                      {item.keys && <span>Keys: {item.keys}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tools Tab */}
        {activeTab === 'tools' && (
          <div className="flex-1 overflow-auto">
            <div className="p-2.5 border-b border-slate-800 flex items-center gap-2">
              <button
                onClick={fetchTools}
                disabled={loadingTools}
                className={buttonSecondaryClass}
              >
                {loadingTools ? 'Loading...' : 'Refresh'}
              </button>
              <span className="text-[10px] text-slate-500 ml-auto">
                Registry: {REGISTRY_URL}
              </span>
            </div>

            {tools.length === 0 ? (
              <div className="text-center text-slate-600 text-xs mt-10">
                {serverRunning
                  ? 'No tools registered yet. They should appear shortly...'
                  : 'Start the server to register tools with the registry.'}
              </div>
            ) : (
              <div className="p-2.5 space-y-2">
                {tools.map((tool) => {
                  const fullName = `${tool.namespace}:${tool.name}`;
                  const isExpanded = expandedTool === fullName;

                  return (
                    <div
                      key={fullName}
                      className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden"
                    >
                      <div
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-800/50"
                        onClick={() => setExpandedTool(isExpanded ? null : fullName)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500">
                            {isExpanded ? '▼' : '▶'}
                          </span>
                          <span className="font-medium text-amber-400 text-xs">{tool.name}</span>
                          <span className="text-[10px] text-slate-600">v{tool.version}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-4 pb-3 text-xs space-y-2 border-t border-slate-800/50">
                          <p className="text-slate-400 pt-2">{tool.description}</p>

                          {tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0 && (
                            <div>
                              <span className="text-slate-500 text-[10px]">Parameters:</span>
                              <div className="mt-1 font-mono bg-slate-950/50 p-2 rounded text-[11px]">
                                {Object.entries(tool.inputSchema.properties).map(
                                  ([name, schema]: [string, any]) => (
                                    <div key={name} className="text-slate-400">
                                      <span className="text-amber-400">{name}</span>
                                      <span className="text-slate-600">: {schema.type}</span>
                                      {schema.default !== undefined && (
                                        <span className="text-slate-600">
                                          {' '}= {JSON.stringify(schema.default)}
                                        </span>
                                      )}
                                      {schema.description && (
                                        <span className="text-slate-600 ml-2">
                                          // {schema.description}
                                        </span>
                                      )}
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}

                          {tool.inputSchema?.required && tool.inputSchema.required.length > 0 && (
                            <div className="text-[10px] text-slate-500">
                              Required: {tool.inputSchema.required.join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Logs Panel */}
      <div className="flex flex-col min-h-[60px] max-h-[400px]" style={{ height: `${logPanelHeight}px` }}>
        {/* Drag Handle */}
        <div
          onMouseDown={handleLogPanelDragStart}
          className={`h-1.5 cursor-ns-resize flex items-center justify-center ${isDraggingLogPanel ? 'bg-slate-700' : 'bg-slate-800'}`}
        >
          <div className="w-10 h-0.5 bg-slate-600 rounded-sm" />
        </div>
        <div className="py-1 px-2.5 border-b border-slate-800 flex justify-between items-center bg-[#161616]">
          <span className="text-[10px] text-slate-500">Logs ({logs.length})</span>
          <button onClick={() => setLogs([])} className="bg-transparent border-none text-slate-600 text-[9px] cursor-pointer hover:text-slate-400">Clear</button>
        </div>
        <div className="flex-1 overflow-auto py-1.5 px-2.5 text-[11px] font-mono bg-[#0a0a0a] leading-snug">
          {logs.map((log, i) => (
            <div key={i} className={`mb-0.5 ${log.includes('ERROR') ? 'text-red-500' : log.includes('success') || log.includes('complete') || log.includes('connected') ? 'text-emerald-500' : 'text-slate-400'}`}>
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
