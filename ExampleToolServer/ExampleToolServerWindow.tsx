/**
 * Example Tool Server Workflow
 *
 * A TSX frontend for demonstrating the ContextUI tool registry system.
 * This workflow starts the example_tool_server.py and provides a UI for:
 * - Starting/stopping the Python server
 * - Viewing registered tools from the registry
 * - Testing tools directly with custom inputs
 * - Viewing server logs
 *
 * Note: React, useState, useEffect, useCallback, useRef, useMemo, and PhosphorIcons
 * are provided by DynamicModuleLoader - no imports needed.
 */

// Types
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
  provider: {
    type: string;
    endpoint?: string;
  };
}

interface TestResult {
  success: boolean;
  data?: any;
  error?: string;
  duration?: number;
}

interface LogEntry {
  timestamp: Date;
  type: 'info' | 'error' | 'success';
  message: string;
}

interface PackageStatus {
  installed: boolean;
  version?: string;
}

// Constants
const REGISTRY_URL = 'http://127.0.0.1:8800';
const SERVER_PORT = 8795;
const SERVER_NAME = 'example_tools';

// Required Python packages for the example tool server
const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'httpx', 'pydantic'];

// Helper functions for package name normalization
const normalizePackageName = (name: string): string => name.toLowerCase().replace(/-/g, '_');

const parsePackageInfo = (pkgStr: string): { name: string; version?: string } => {
  if (pkgStr.includes(' @ ')) {
    const name = pkgStr.split(' @ ')[0].trim();
    return { name, version: 'local' };
  }
  if (pkgStr.includes('==')) {
    const [name, version] = pkgStr.split('==');
    return { name: name.trim(), version: version.trim() };
  }
  return { name: pkgStr.trim() };
};

const ExampleToolServerWindow: React.FC = () => {
  // Get icons from PhosphorIcons
  const { Play, Stop, ArrowClockwise, Terminal, Wrench, Lightning, CheckCircle, XCircle, CaretDown, CaretRight, Spinner, PaperPlaneTilt } = PhosphorIcons;

  // Server state
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStarting, setServerStarting] = useState(false);
  const [venvs, setVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');

  // Dependencies state
  const [depsStatus, setDepsStatus] = useState<Record<string, PackageStatus>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);

  // Tools state
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  // Testing state
  const [selectedTestTool, setSelectedTestTool] = useState<string | null>(null);
  const [testInput, setTestInput] = useState<string>('{}');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Add log entry
  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev.slice(-100), { timestamp: new Date(), type, message }]);
  }, []);

  // Scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Get ipcRenderer reference
  const getIpcRenderer = useCallback(() => {
    const electron = (window as any).require?.('electron');
    return electron?.ipcRenderer;
  }, []);

  // Check dependencies for the selected venv
  const checkDeps = useCallback(async () => {
    const ipcRenderer = getIpcRenderer();
    if (!selectedVenv || !ipcRenderer) {
      return;
    }

    setCheckingDeps(true);
    try {
      const vres = await ipcRenderer.invoke('python-list-venvs');
      if (vres.success !== false) {
        const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
        if (v && Array.isArray(v.packages)) {
          const map: Record<string, PackageStatus> = {};
          for (const pkg of REQUIRED_PACKAGES) {
            const normalizedPkg = normalizePackageName(pkg);
            const found = v.packages.find((p: string) => {
              const parsed = parsePackageInfo(p);
              return normalizePackageName(parsed.name) === normalizedPkg;
            });
            if (found) {
              const parsed = parsePackageInfo(found);
              map[pkg] = {
                installed: true,
                version: parsed.version,
              };
            } else {
              map[pkg] = { installed: false };
            }
          }
          setDepsStatus(map);
        }
      }
    } catch (e: any) {
      addLog('error', `Error checking deps: ${e.message}`);
    } finally {
      setCheckingDeps(false);
    }
  }, [selectedVenv, getIpcRenderer, addLog]);

  // Install missing dependencies
  const installMissingDeps = async () => {
    const ipcRenderer = getIpcRenderer();
    if (!selectedVenv || !ipcRenderer) {
      addLog('error', 'No venv selected');
      return;
    }

    const missing = REQUIRED_PACKAGES.filter(p => !depsStatus[p]?.installed);
    if (missing.length === 0) {
      addLog('info', 'All required packages are already installed');
      return;
    }

    setInstallingDeps(true);
    try {
      for (const pkg of missing) {
        addLog('info', `Installing ${pkg}...`);
        setInstallingPackage(pkg);
        const result = await ipcRenderer.invoke('python-install-package', {
          venvName: selectedVenv,
          package: pkg,
        });
        if (result.success) {
          addLog('success', `${pkg} installed`);
        } else {
          addLog('error', `Error installing ${pkg}: ${result.error}`);
        }
      }

      addLog('success', 'Dependency installation complete');
      await checkDeps();
    } catch (e: any) {
      addLog('error', `Error: ${e.message}`);
    } finally {
      setInstallingDeps(false);
      setInstallingPackage(null);
    }
  };

  // Auto-check deps when venv changes
  useEffect(() => {
    if (selectedVenv) {
      checkDeps();
    }
  }, [selectedVenv, checkDeps]);

  // Fetch available venvs via IPC (uses the python manager infrastructure)
  useEffect(() => {
    const fetchVenvs = async () => {
      try {
        // Use electron IPC to get available venvs from the Python manager
        const electron = (window as any).require?.('electron');
        const ipcRenderer = electron?.ipcRenderer;
        if (ipcRenderer) {
          const result = await ipcRenderer.invoke('python-list-venvs');
          if (result.venvs && result.venvs.length > 0) {
            // result.venvs contains objects with {name, path, pythonVersion, packages}
            // Extract just the names for our dropdown
            const venvNames = result.venvs.map((v: any) => typeof v === 'string' ? v : v.name);
            setVenvs(venvNames);
            if (!selectedVenv) {
              setSelectedVenv(venvNames[0]);
            }
          } else {
            // Fallback if no venvs found
            setVenvs(['default']);
            setSelectedVenv('default');
          }
        } else {
          // Browser fallback
          setVenvs(['default']);
          setSelectedVenv('default');
        }
      } catch (err) {
        addLog('error', 'Could not fetch Python environments');
        setVenvs(['default']);
        setSelectedVenv('default');
      }
    };
    fetchVenvs();
  }, [addLog, selectedVenv]);

  // Check if server is already running
  const checkServerStatus = useCallback(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/status`);
      if (response.ok) {
        const data = await response.json();
        if (data.server === SERVER_NAME) {
          setServerRunning(true);
          return true;
        }
      }
    } catch {
      // Server not running
    }
    return false;
  }, []);

  // Track previous tool count to avoid noisy logs
  const prevToolCountRef = useRef<number>(0);

  // Fetch tools from registry
  const fetchTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const response = await fetch(`${REGISTRY_URL}/tools`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success) {
        // Filter to show example and tsx_example namespace tools (excludes MCP built-in tools)
        const exampleTools = (data.tools || []).filter(
          (t: ToolDefinition) => t.namespace === 'example' || t.namespace === 'tsx_example'
        );
        setTools(exampleTools);
        // Only log when tool count changes
        if (exampleTools.length !== prevToolCountRef.current) {
          if (exampleTools.length > 0) {
            addLog('success', `Found ${exampleTools.length} tools in registry`);
          } else if (prevToolCountRef.current > 0) {
            addLog('info', 'No tools registered');
          }
          prevToolCountRef.current = exampleTools.length;
        }
      }
    } catch (err: any) {
      if (!err.message.includes('fetch')) {
        addLog('error', `Failed to fetch tools: ${err.message}`);
      }
      setTools([]);
    } finally {
      setLoadingTools(false);
    }
  }, [addLog]);

  // Initial load
  useEffect(() => {
    checkServerStatus().then(running => {
      if (running) {
        addLog('info', 'Server already running');
      }
    });
    fetchTools();

    // Poll for tools every 3 seconds
    const interval = setInterval(fetchTools, 3000);
    return () => clearInterval(interval);
  }, [checkServerStatus, fetchTools, addLog]);

  // Start server using electron IPC to python manager
  const startServer = async () => {
    setServerStarting(true);
    addLog('info', `Starting example tool server on port ${SERVER_PORT}...`);

    try {
      const ipcRenderer = getIpcRenderer();

      if (ipcRenderer) {
        // Resolve the script path using the workflow resolver (handles user profile folder)
        const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
          workflowFolder: 'ExampleToolServer',
          scriptName: 'example_tool_server.py'
        });

        if (!scriptResult.success) {
          throw new Error(scriptResult.error || 'Could not find example_tool_server.py');
        }

        addLog('info', `Script path: ${scriptResult.path}`);

        // Start the Python server using the script server handler
        const result = await ipcRenderer.invoke('python-start-script-server', {
          venvName: selectedVenv,
          scriptPath: scriptResult.path,
          port: SERVER_PORT,
          serverName: SERVER_NAME
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to start server');
        }

        addLog('info', 'Server process started, waiting for initialization...');

        // Wait for server to come up
        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const running = await checkServerStatus();
          if (running) {
            setServerRunning(true);
            addLog('success', 'Server started successfully!');
            fetchTools();
            return;
          }
          attempts++;
        }

        addLog('error', 'Server failed to start (timeout)');
      } else {
        addLog('error', 'Electron IPC not available - running in browser mode');
      }
    } catch (err: any) {
      addLog('error', `Failed to start server: ${err.message}`);
    } finally {
      setServerStarting(false);
    }
  };

  // Stop server using electron IPC to python manager
  const stopServer = async () => {
    addLog('info', 'Stopping server...');
    try {
      const ipcRenderer = getIpcRenderer();

      if (ipcRenderer) {
        // Use python-stop-script-server with serverName and port
        const result = await ipcRenderer.invoke('python-stop-script-server', SERVER_NAME, SERVER_PORT);

        if (result.success) {
          setServerRunning(false);
          addLog('success', 'Server stopped');
        } else {
          throw new Error(result.error || 'Failed to stop server');
        }
      } else {
        // Browser fallback
        setServerRunning(false);
        addLog('info', 'Server marked as stopped (browser mode)');
      }
    } catch (err: any) {
      addLog('error', `Failed to stop server: ${err.message}`);
    }
  };

  // Execute tool test
  const executeTest = async () => {
    if (!selectedTestTool) return;

    setTesting(true);
    setTestResult(null);

    const tool = tools.find(t => `${t.namespace}:${t.name}` === selectedTestTool);
    if (!tool) {
      addLog('error', 'Tool not found');
      setTesting(false);
      return;
    }

    let args: Record<string, any>;
    try {
      args = JSON.parse(testInput);
    } catch {
      setTestResult({ success: false, error: 'Invalid JSON input' });
      setTesting(false);
      return;
    }

    addLog('info', `Executing ${selectedTestTool}...`);
    const startTime = Date.now();

    try {
      const response = await fetch(`${REGISTRY_URL}/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: tool.name,
          namespace: tool.namespace,
          arguments: args,
        }),
      });

      const data = await response.json();
      const duration = Date.now() - startTime;

      if (data.success) {
        setTestResult({ success: true, data: data.result, duration });
        addLog('success', `Tool executed successfully (${duration}ms)`);
      } else {
        setTestResult({ success: false, error: data.error, duration });
        addLog('error', `Tool execution failed: ${data.error}`);
      }
    } catch (err: any) {
      const duration = Date.now() - startTime;
      setTestResult({ success: false, error: err.message, duration });
      addLog('error', `Request failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  // Set default test input when tool is selected
  useEffect(() => {
    if (selectedTestTool) {
      const tool = tools.find(t => `${t.namespace}:${t.name}` === selectedTestTool);
      if (tool?.inputSchema?.properties) {
        const defaultInput: Record<string, any> = {};
        Object.entries(tool.inputSchema.properties).forEach(([key, schema]: [string, any]) => {
          if (schema.default !== undefined) {
            defaultInput[key] = schema.default;
          } else if (schema.type === 'string') {
            defaultInput[key] = '';
          } else if (schema.type === 'number' || schema.type === 'integer') {
            defaultInput[key] = 0;
          }
        });
        setTestInput(JSON.stringify(defaultInput, null, 2));
      } else {
        setTestInput('{}');
      }
      setTestResult(null);
    }
  }, [selectedTestTool, tools]);

  return (
    <div className="h-full flex flex-col bg-zinc-900 text-zinc-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-700">
        <div className="flex items-center gap-3">
          <Wrench size={24} className="text-amber-400" />
          <div>
            <h1 className="text-lg font-semibold">Example Tool Server</h1>
            <p className="text-xs text-zinc-500">
              Reference implementation for the ContextUI tool registry
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {serverRunning ? (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              Running on port {SERVER_PORT}
            </span>
          ) : (
            <span className="text-zinc-500 text-sm">Server stopped</span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Server Control & Tools */}
        <div className="w-1/2 flex flex-col border-r border-zinc-700">
          {/* Server Control */}
          <div className="p-4 border-b border-zinc-700/50 bg-zinc-800/30">
            <h2 className="text-sm font-medium text-zinc-400 mb-3">Server Control</h2>
            <div className="flex items-center gap-3">
              <select
                value={selectedVenv}
                onChange={(e) => setSelectedVenv(e.target.value)}
                disabled={serverRunning}
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm focus:outline-none focus:border-amber-500 disabled:opacity-50"
              >
                {venvs.map((venv) => (
                  <option key={venv} value={venv}>
                    {venv}
                  </option>
                ))}
              </select>

              {serverRunning ? (
                <button
                  onClick={stopServer}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded transition-colors"
                >
                  <Stop size={18} weight="fill" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={startServer}
                  disabled={serverStarting}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded transition-colors disabled:opacity-50"
                >
                  {serverStarting ? (
                    <Spinner size={18} className="animate-spin" />
                  ) : (
                    <Play size={18} weight="fill" />
                  )}
                  Start
                </button>
              )}
            </div>

            {/* Dependencies */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-zinc-500">Python Dependencies</h3>
                <div className="flex gap-2">
                  <button
                    onClick={checkDeps}
                    disabled={!selectedVenv || checkingDeps}
                    className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded disabled:opacity-50 transition-colors"
                  >
                    {checkingDeps ? 'Checking...' : 'Refresh'}
                  </button>
                  <button
                    onClick={installMissingDeps}
                    disabled={!selectedVenv || installingDeps || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)
                        ? 'bg-zinc-700 text-zinc-500'
                        : 'bg-amber-600/30 hover:bg-amber-600/40 text-amber-400'
                    } disabled:opacity-50`}
                  >
                    {installingDeps ? `Installing ${installingPackage}...` : 'Install All'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {REQUIRED_PACKAGES.map(pkg => {
                  const status = depsStatus[pkg];
                  const isInstalled = status?.installed;
                  return (
                    <div
                      key={pkg}
                      className={`py-1.5 px-2.5 rounded text-xs flex items-center gap-1.5 ${
                        isInstalled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                      }`}
                    >
                      <span>{isInstalled ? '✓' : '✗'}</span>
                      <span>{pkg}</span>
                      {status?.version && <span className="text-zinc-500 text-[10px]">({status.version})</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tools List */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-zinc-400">Registered Tools</h2>
              <button
                onClick={fetchTools}
                disabled={loadingTools}
                className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
              >
                <ArrowClockwise
                  size={16}
                  className={loadingTools ? 'animate-spin text-zinc-500' : 'text-zinc-400'}
                />
              </button>
            </div>

            {tools.length === 0 ? (
              <div className="text-zinc-500 text-sm p-4 bg-zinc-800/30 rounded border border-zinc-700/50">
                {serverRunning
                  ? 'No tools registered yet. They should appear shortly...'
                  : 'Start the server to register tools with the registry.'}
              </div>
            ) : (
              <div className="space-y-2">
                {tools.map((tool) => {
                  const fullName = `${tool.namespace}:${tool.name}`;
                  const isExpanded = expandedTool === fullName;

                  return (
                    <div
                      key={fullName}
                      className="bg-zinc-800/50 rounded border border-zinc-700 overflow-hidden"
                    >
                      <div
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-zinc-800"
                        onClick={() => setExpandedTool(isExpanded ? null : fullName)}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <CaretDown size={14} className="text-zinc-500" />
                          ) : (
                            <CaretRight size={14} className="text-zinc-500" />
                          )}
                          <span className="font-medium text-amber-400">{tool.name}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTestTool(fullName);
                          }}
                          className="p-1.5 hover:bg-amber-600/20 text-amber-400 rounded transition-colors"
                          title="Test this tool"
                        >
                          <Lightning size={14} />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="px-4 pb-3 text-xs space-y-2 border-t border-zinc-700/50">
                          <p className="text-zinc-400 pt-2">{tool.description}</p>

                          {tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0 && (
                            <div>
                              <span className="text-zinc-500">Parameters:</span>
                              <div className="mt-1 font-mono bg-zinc-900/50 p-2 rounded">
                                {Object.entries(tool.inputSchema.properties).map(
                                  ([name, schema]: [string, any]) => (
                                    <div key={name} className="text-zinc-400">
                                      <span className="text-amber-400">{name}</span>
                                      <span className="text-zinc-600">: {schema.type}</span>
                                      {schema.default !== undefined && (
                                        <span className="text-zinc-600">
                                          {' '}= {JSON.stringify(schema.default)}
                                        </span>
                                      )}
                                    </div>
                                  )
                                )}
                              </div>
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
        </div>

        {/* Right Panel - Tool Tester & Logs */}
        <div className="w-1/2 flex flex-col">
          {/* Tool Tester */}
          <div className="flex-1 flex flex-col border-b border-zinc-700">
            <div className="p-4 border-b border-zinc-700/50 bg-zinc-800/30">
              <h2 className="text-sm font-medium text-zinc-400">Tool Tester</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Tool Selector */}
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Select Tool</label>
                <select
                  value={selectedTestTool || ''}
                  onChange={(e) => setSelectedTestTool(e.target.value || null)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Select a tool --</option>
                  {tools.map((tool) => (
                    <option key={`${tool.namespace}:${tool.name}`} value={`${tool.namespace}:${tool.name}`}>
                      {tool.namespace}:{tool.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedTestTool && (
                <>
                  {/* Input */}
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">
                      Arguments (JSON)
                    </label>
                    <textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      className="w-full h-32 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded font-mono text-sm focus:outline-none focus:border-amber-500 resize-none"
                      placeholder="{}"
                    />
                  </div>

                  {/* Execute Button */}
                  <button
                    onClick={executeTest}
                    disabled={testing || !serverRunning}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing ? (
                      <Spinner size={18} className="animate-spin" />
                    ) : (
                      <PaperPlaneTilt size={18} />
                    )}
                    Execute Tool
                  </button>

                  {/* Result */}
                  {testResult && (
                    <div
                      className={`p-3 rounded border ${
                        testResult.success
                          ? 'bg-emerald-900/20 border-emerald-700'
                          : 'bg-red-900/20 border-red-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {testResult.success ? (
                          <CheckCircle size={16} className="text-emerald-400" weight="fill" />
                        ) : (
                          <XCircle size={16} className="text-red-400" weight="fill" />
                        )}
                        <span
                          className={`text-sm font-medium ${
                            testResult.success ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {testResult.success ? 'Success' : 'Error'}
                        </span>
                        {testResult.duration && (
                          <span className="text-xs text-zinc-500 ml-auto">
                            {testResult.duration}ms
                          </span>
                        )}
                      </div>
                      <pre className="text-xs font-mono overflow-x-auto text-zinc-300">
                        {testResult.success
                          ? JSON.stringify(testResult.data, null, 2)
                          : testResult.error}
                      </pre>
                    </div>
                  )}
                </>
              )}

              {!selectedTestTool && (
                <div className="text-center text-zinc-500 text-sm py-8">
                  Select a tool from the list to test it
                </div>
              )}
            </div>
          </div>

          {/* Logs */}
          <div className="h-48 flex flex-col">
            <div className="flex items-center gap-2 p-3 border-b border-zinc-700/50 bg-zinc-800/30">
              <Terminal size={16} className="text-zinc-400" />
              <h2 className="text-sm font-medium text-zinc-400">Logs</h2>
              <button
                onClick={() => setLogs([])}
                className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1 bg-zinc-950/50">
              {logs.length === 0 ? (
                <div className="text-zinc-600 p-2">No logs yet...</div>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 ${
                      log.type === 'error'
                        ? 'text-red-400'
                        : log.type === 'success'
                        ? 'text-emerald-400'
                        : 'text-zinc-400'
                    }`}
                  >
                    <span className="text-zinc-600 flex-shrink-0">
                      {log.timestamp.toLocaleTimeString()}
                    </span>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

ExampleToolServerWindow;
