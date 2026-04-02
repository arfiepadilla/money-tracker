// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

/**
 * Image-to-Text Window
 *
 * An image analysis tool using vision-language models.
 * Features:
 * - Image captioning and description generation
 * - Multiple model support (BLIP-2, Florence-2, LLaVA)
 * - Custom prompt support for specific analysis
 * - Drag & drop or file upload
 * - Analysis history with export
 * - VRAM monitoring
 */

interface VramStats {
  total: number;
  free: number;
  allocated: number;
  used: number;
}

interface ServerStatus {
  model_ready: boolean;
  model_loading: boolean;
  model_name?: string;
  model_type?: string;
  cuda_available: boolean;
  vram: VramStats | null;
  analysis_count: number;
}

interface AnalysisResult {
  description: string;
  processing_time: number;
  model: string;
  prompt?: string;
  prompt_used?: string;
}

interface HistoryItem {
  timestamp: string;
  description: string;
  processing_time: number;
  filename?: string;
  prompt?: string;
  prompt_used?: string;
  thumbnail?: string;
}

// Available Vision-Language models
const VISION_MODELS = [
  { label: 'ViT-GPT2 (Fast, ~500MB)', value: 'nlpconnect/vit-gpt2-image-captioning', size: '~500MB' },
  { label: 'BLIP Base (Good balance, ~1GB)', value: 'Salesforce/blip-image-captioning-base', size: '~1GB' },
  { label: 'BLIP Large (~2GB)', value: 'Salesforce/blip-image-captioning-large', size: '~2GB' },
  { label: 'GIT Base COCO (~700MB)', value: 'microsoft/git-base-coco', size: '~700MB' },
  { label: 'GIT Large COCO (~1.5GB)', value: 'microsoft/git-large-coco', size: '~1.5GB' },
  { label: 'Qwen2-VL 2B (OCR+Prompts, ~4GB)', value: 'Qwen/Qwen2-VL-2B-Instruct', size: '~4GB' },
  { label: 'BLIP-2 OPT 2.7B (~8GB)', value: 'Salesforce/blip2-opt-2.7b', size: '~8GB' },
];

// Preset analysis prompts
const ANALYSIS_PRESETS = [
  { label: 'General Description', value: '', description: 'Generate a general description of the image' },
  { label: 'Detailed Analysis', value: 'Describe this image in detail, including objects, colors, composition, and any text visible.', description: 'Comprehensive analysis' },
  { label: 'OCR - Extract Text', value: 'What text is visible in this image? Please transcribe all readable text.', description: 'Extract text from images' },
  { label: 'Object Detection', value: 'List all objects and items visible in this image.', description: 'Identify objects' },
  { label: 'Scene Description', value: 'Describe the scene, setting, and environment shown in this image.', description: 'Describe the scene' },
  { label: 'Technical Analysis', value: 'Analyze this image from a technical perspective: describe the composition, lighting, and visual elements.', description: 'Technical breakdown' },
];

// Required Python packages
// Note: hf-xet uses hyphen in pip but underscore when imported
const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'torch', 'transformers', 'accelerate', 'huggingface-hub', 'hf-xet', 'pillow', 'einops', 'timm', 'python-multipart', 'tqdm', 'qwen-vl-utils'];

// Storage key for remembering selected venv
const STORAGE_KEY_VENV = 'imagetotext-selected-venv';

export const ImageToTextWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8785);
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

  // Model selection
  const [selectedModel, setSelectedModel] = useState('nlpconnect/vit-gpt2-image-captioning');
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [useFp16, setUseFp16] = useState(true);

  // Cached models browser
  const [cachedModels, setCachedModels] = useState<string[]>([]);
  const [showCachedModels, setShowCachedModels] = useState(false);
  const [loadingCachedModels, setLoadingCachedModels] = useState(false);

  // Image state - supports multiple images for Qwen2-VL
  interface SelectedImage {
    data: string;
    name: string;
  }
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Analysis state
  const [currentDescription, setCurrentDescription] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState<'analyze' | 'history' | 'setup'>('setup');
  const [logs, setLogs] = useState<string[]>([]);
  const [logPanelHeight, setLogPanelHeight] = useState(200);
  const [isDraggingLogPanel, setIsDraggingLogPanel] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setLogPanelHeight(Math.max(60, Math.min(500, newHeight)));
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

        // Try to restore last used venv from localStorage
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

  // Save selected venv to localStorage when it changes
  useEffect(() => {
    if (selectedVenv) {
      localStorage.setItem(STORAGE_KEY_VENV, selectedVenv);
    }
  }, [selectedVenv]);

  // Automatically check dependencies when venv changes
  useEffect(() => {
    const autoCheckDeps = async () => {
      if (!selectedVenv || !ipcRenderer) return;

      setCheckingDeps(true);
      try {
        const vres = await ipcRenderer.invoke('python-list-venvs');
        if (vres.success) {
          const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
          if (v && Array.isArray(v.packages) && v.packages.length >= 0) {
            const map: Record<string, any> = {};
            for (const pkg of REQUIRED_PACKAGES) {
              // Normalize package name for comparison (handle hyphens/underscores)
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

        // Special handling for torch
        if (pkg === 'torch') {
          addLog('Installing PyTorch with CUDA 12.1 support...');
          const result = await ipcRenderer.invoke('python-install-package', {
            venvName: selectedVenv,
            package: 'torch torchvision --index-url https://download.pytorch.org/whl/cu121',
          });

          if (result.success) {
            addLog('PyTorch (GPU version) installed');
            setDepsStatus(prev => ({ ...prev, [pkg]: { installed: true, version: undefined } }));
          } else {
            addLog(`ERROR installing PyTorch: ${result.error}`);
          }
          continue;
        }

        // Regular package installation
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

      // Re-check all deps to get versions
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
        fetchHistory();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [serverRunning, checkServerStatus]);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${getServerUrl()}/history?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch { }
  };

  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting Image-to-Text server...');

    const alreadyRunning = await checkServerStatus();
    if (alreadyRunning) {
      addLog('Server already running!');
      setConnecting(false);
      return;
    }

    if (!selectedVenv) {
      addLog('ERROR: No Python venv selected');
      setConnecting(false);
      return;
    }

    const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
      workflowFolder: 'ImageToText',
      scriptName: 'image_to_text_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find image_to_text_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'image-to-text',
    });

    if (result.success) {
      addLog(`Server started (PID: ${result.pid}), connecting...`);

      let attempts = 0;
      const maxAttempts = 30;
      const pollInterval = setInterval(async () => {
        attempts++;
        const isReady = await checkServerStatus();
        if (isReady) {
          clearInterval(pollInterval);
          addLog('Server connected!');
          setConnecting(false);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          addLog('ERROR: Server timeout');
          setConnecting(false);
        }
      }, 1000);
    } else {
      addLog(`ERROR: ${result.error}`);
      setConnecting(false);
    }
  };

  const stopServer = async () => {
    if (!ipcRenderer) return;

    const result = await ipcRenderer.invoke('python-stop-script-server', 'image-to-text');
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

  const loadModel = async () => {
    if (!serverRunning) return;

    const modelName = useCustomModel ? customModel : selectedModel;
    addLog(`Loading model: ${modelName}...`);

    try {
      const res = await fetch(`${getServerUrl()}/load_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: modelName, use_fp16: useFp16 }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Model loaded on ${data.device}`);
        await checkServerStatus();
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const unloadModel = async () => {
    if (!serverRunning) return;

    addLog('Unloading model...');
    try {
      await fetch(`${getServerUrl()}/unload_model`, { method: 'POST' });
      addLog('Model unloaded');
      await checkServerStatus();
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // Browse cached models
  const loadCachedModels = async () => {
    if (!serverRunning) return;

    setLoadingCachedModels(true);
    addLog('Scanning HuggingFace cache for vision models...');

    try {
      const res = await fetch(`${getServerUrl()}/cached_models`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.models) {
          setCachedModels(data.models);
          addLog(`Found ${data.models.length} vision models in cache`);
        } else {
          addLog(`No cached models found or error: ${data.error || 'unknown'}`);
        }
      }
    } catch (e: any) {
      addLog(`ERROR scanning cache: ${e.message}`);
    } finally {
      setLoadingCachedModels(false);
    }
  };

  const selectCachedModel = (modelPath: string) => {
    setCustomModel(modelPath);
    setUseCustomModel(true);
    setShowCachedModels(false);
    addLog(`Selected cached model: ${modelPath}`);
  };

  // Image handling - supports adding multiple images
  const handleFileSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      addLog('ERROR: Please select an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setSelectedImages(prev => [...prev, { data: base64, name: file.name }]);
      addLog(`Added image: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`);
    };
    reader.readAsDataURL(file);
  };

  const handleMultipleFiles = (files: FileList) => {
    Array.from(files).forEach(file => handleFileSelect(file));
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    addLog('Image removed');
  };

  const clearAllImages = () => {
    setSelectedImages([]);
    addLog('All images cleared');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleMultipleFiles(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleMultipleFiles(files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Track the prompt used for display (from server response)
  const [promptUsed, setPromptUsed] = useState<string | null>(null);

  const analyzeImage = async (withPrompt: boolean = true) => {
    if (!serverRunning || !serverStatus?.model_ready || selectedImages.length === 0) {
      addLog('Model not ready or no image selected');
      return;
    }

    setAnalyzing(true);
    setCurrentDescription('');
    setPromptUsed(null);

    try {
      // Extract base64 data from all images (remove data:image/xxx;base64, prefix)
      const imagesB64 = selectedImages.map(img => img.data.split(',')[1]);
      const prompt = withPrompt ? (useCustomPrompt ? customPrompt : selectedPreset) : '';

      if (withPrompt && prompt) {
        addLog(`Analyzing ${selectedImages.length} image(s) with prompt: ${prompt.substring(0, 50)}...`);
      } else {
        addLog(`Analyzing ${selectedImages.length} image(s) (no prompt)...`);
      }

      const res = await fetch(`${getServerUrl()}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_b64: imagesB64[0],  // Primary image for single-image models
          images_b64: imagesB64,     // All images for multi-image models (Qwen-VL)
          prompt: prompt || null,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server error: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      if (data.success) {
        addLog(`Analysis complete in ${data.processing_time.toFixed(2)}s`);
        setCurrentDescription(data.description);
        // Set the actual prompt used from the server response
        setPromptUsed(data.prompt_used || null);
        await fetchHistory();
      } else {
        addLog(`Analysis error: ${data.detail || data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
      console.error('Analysis error:', e);
    } finally {
      setAnalyzing(false);
    }
  };

  const clearHistory = async () => {
    if (serverRunning) {
      await fetch(`${getServerUrl()}/history/clear`, { method: 'POST' });
    }
    setHistory([]);
    addLog('History cleared');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addLog('Copied to clipboard');
  };

  // Tailwind class helpers
  const buttonClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-purple-600 text-white text-xs flex items-center gap-1';
  const inputClass = 'py-1.5 px-2.5 border border-slate-700 rounded bg-[#252525] text-white text-xs';
  const sectionClass = 'bg-slate-900 rounded-lg p-3.5 mb-2.5';
  const tabClass = (isActive: boolean) =>
    `py-2 px-4 border-none cursor-pointer text-xs ${
      isActive ? 'bg-slate-900 text-white border-b-2 border-purple-600' : 'bg-transparent text-slate-500 border-b-2 border-transparent'
    }`;

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="py-2.5 px-4 border-b border-slate-800 flex items-center gap-3 bg-[#161616]">
        <div>
          <h2 className="m-0 text-sm">Image-to-Text</h2>
          <div className="text-[10px] text-slate-600">Vision-Language Analysis</div>
        </div>
        <div className="ml-auto flex items-center gap-2.5 text-[11px]">
          {serverStatus?.model_ready && (
            <span className="text-green-500">Model Ready</span>
          )}
          {serverStatus?.vram && (
            <span className="text-slate-500">
              VRAM: {(serverStatus.vram.used / 1024 ** 3).toFixed(1)}GB / {(serverStatus.vram.total / 1024 ** 3).toFixed(1)}GB
            </span>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-slate-800 bg-[#161616]">
        <button className={tabClass(activeTab === 'setup')} onClick={() => setActiveTab('setup')}>Setup</button>
        <button className={tabClass(activeTab === 'analyze')} onClick={() => setActiveTab('analyze')}>Analyze</button>
        <button className={tabClass(activeTab === 'history')} onClick={() => setActiveTab('history')}>History ({history.length})</button>
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
                <select value={selectedVenv} onChange={e => setSelectedVenv(e.target.value)} className={`${inputClass} w-[120px]`} disabled={serverRunning}>
                  {availableVenvs.length === 0 ? <option value="">No venvs</option> : availableVenvs.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <input type="number" value={serverPort} onChange={e => setServerPort(parseInt(e.target.value) || 8785)} className={`${inputClass} w-[70px]`} disabled={serverRunning} />
                {!serverRunning ? (
                  <button onClick={startServer} disabled={connecting || !selectedVenv} className={buttonClass}>
                    {connecting ? 'Connecting...' : 'Start'}
                  </button>
                ) : (
                  <button onClick={stopServer} className={`${buttonClass} bg-red-600`}>Stop</button>
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
                            className={`py-0.5 px-2 rounded text-[10px] ${
                              depsStatus[pkg]?.installed
                                ? 'bg-green-950 border border-green-500 text-green-500'
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
                          className={`${buttonClass} ${installingDeps ? 'bg-slate-600' : 'bg-orange-500'}`}
                        >
                          {installingDeps ? 'Installing...' : 'Install Missing Dependencies'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Model Selection */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Vision Model</h3>
              <div className="mb-2">
                <label className="flex items-center gap-1.5 text-[11px] mb-1.5">
                  <input type="checkbox" checked={useCustomModel} onChange={e => setUseCustomModel(e.target.checked)} />
                  Custom model
                </label>
                {useCustomModel ? (
                  <input type="text" value={customModel} onChange={e => setCustomModel(e.target.value)} placeholder="HuggingFace model ID" className={`${inputClass} w-full`} />
                ) : (
                  <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} className={`${inputClass} w-full`}>
                    {VISION_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-2.5">
                <label className="text-[11px]">
                  <input type="checkbox" checked={useFp16} onChange={e => setUseFp16(e.target.checked)} /> FP16
                </label>
                <button onClick={loadModel} disabled={!serverRunning || serverStatus?.model_loading} className={`${buttonClass} ${serverStatus?.model_ready ? 'bg-green-500' : 'bg-green-600'}`}>
                  {serverStatus?.model_loading ? 'Loading...' : serverStatus?.model_ready ? 'Loaded' : 'Load Model'}
                </button>
                <button onClick={unloadModel} disabled={!serverRunning} className={`${buttonClass} bg-red-600`}>Unload</button>
              </div>
              {serverStatus?.model_ready && serverStatus.model_name && (
                <div className="mt-1.5 text-[10px] text-green-500">
                  {serverStatus.model_name.split('/').pop()}
                </div>
              )}
            </div>

            {/* Cached Models Browser */}
            <div className={sectionClass}>
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setShowCachedModels(!showCachedModels)}
              >
                <h3 className="m-0 text-[13px]">Browse Downloaded Models</h3>
                <span className="text-[10px] text-slate-500">{showCachedModels ? '...' : '>'}</span>
              </div>
              {showCachedModels && (
                <div className="mt-2.5">
                  <button onClick={loadCachedModels} disabled={!serverRunning || loadingCachedModels} className={`${buttonClass} bg-purple-600`}>
                    {loadingCachedModels ? 'Scanning...' : 'Scan HF Cache'}
                  </button>
                  {cachedModels.length > 0 ? (
                    <div className="max-h-[200px] overflow-auto bg-[#252525] rounded p-2 mt-2">
                      {cachedModels.map((model, i) => (
                        <div key={i} className="flex items-center gap-2 py-1.5 border-b border-slate-700">
                          <span className="flex-1 text-[11px] text-slate-300 break-all">{model}</span>
                          <button onClick={() => selectCachedModel(model)} className={`${buttonClass} py-0.5 px-1.5 text-[9px] bg-green-600`}>Select</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 mt-2">
                      {loadingCachedModels ? 'Scanning...' : 'Click "Scan HF Cache" to find downloaded models'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Analyze Tab */}
        {activeTab === 'analyze' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Image Upload / Preview - Multi-image support */}
            <div className="mb-2.5">
              {/* Images Grid */}
              {selectedImages.length > 0 && (
                <div className="mb-2">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[11px] text-slate-500">
                      {selectedImages.length} image{selectedImages.length > 1 ? 's' : ''} selected
                      {selectedImages.length > 1 && serverStatus?.model_type !== 'qwen-vl' && (
                        <span className="text-orange-500 ml-2">
                          (Only Qwen2-VL supports multi-image - first image will be used)
                        </span>
                      )}
                    </span>
                    <button
                      onClick={clearAllImages}
                      className={`${buttonClass} py-0.5 px-2 text-[10px] bg-red-600`}
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {selectedImages.map((img, index) => (
                      <div key={index} className="relative">
                        <img
                          src={img.data}
                          alt={img.name}
                          className={`w-20 h-20 object-cover rounded ${index === 0 ? 'border-2 border-purple-600' : 'border border-slate-700'}`}
                          title={img.name}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); removeImage(index); }}
                          className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full border-none bg-red-600 text-white text-[10px] cursor-pointer flex items-center justify-center"
                        >
                          ×
                        </button>
                        {index === 0 && selectedImages.length > 1 && (
                          <div className="absolute bottom-0.5 left-0.5 bg-purple-600 text-white text-[8px] py-px px-1 rounded-sm">
                            Primary
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Drop Zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all ${
                  isDragging ? 'border-purple-600 bg-purple-600/10' : 'border-slate-700 bg-slate-900'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="text-lg mb-1">+</div>
                <div className="text-[11px] text-slate-500">
                  {selectedImages.length === 0
                    ? 'Drop image(s) here or click to browse'
                    : 'Add more images (Qwen2-VL only)'}
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>

            {/* Analysis Options */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Analysis Options</h3>
              <div className="mb-2">
                <label className="flex items-center gap-1.5 text-[11px] mb-1.5">
                  <input type="checkbox" checked={useCustomPrompt} onChange={e => setUseCustomPrompt(e.target.checked)} />
                  Custom prompt
                </label>
                {useCustomPrompt ? (
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder="Enter your analysis prompt..."
                    className={`${inputClass} w-full min-h-[60px] resize-y`}
                  />
                ) : (
                  <select value={selectedPreset} onChange={e => setSelectedPreset(e.target.value)} className={`${inputClass} w-full`}>
                    {ANALYSIS_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => analyzeImage(false)}
                  disabled={!serverStatus?.model_ready || selectedImages.length === 0 || analyzing}
                  className={`${buttonClass} flex-1 justify-center py-2.5 ${analyzing ? 'bg-slate-600' : 'bg-green-600'}`}
                >
                  {analyzing ? 'Analyzing...' : 'Run Image'}
                </button>
                <button
                  onClick={() => analyzeImage(true)}
                  disabled={!serverStatus?.model_ready || selectedImages.length === 0 || analyzing}
                  className={`${buttonClass} flex-1 justify-center py-2.5 ${analyzing ? 'bg-slate-600' : 'bg-purple-600'}`}
                >
                  {analyzing ? 'Analyzing...' : 'Run with Prompt'}
                </button>
              </div>
            </div>

            {/* Result Display */}
            <div className="flex-1 overflow-auto">
              {analyzing ? (
                <div className="text-center text-slate-500 text-xs mt-5">
                  Analyzing image...
                </div>
              ) : currentDescription ? (
                <div className="bg-slate-900 rounded-lg p-4 text-[13px] leading-relaxed whitespace-pre-wrap relative">
                  <button
                    onClick={() => copyToClipboard(currentDescription)}
                    className={`${buttonClass} absolute top-2 right-2 py-1 px-2 text-[10px] bg-slate-700`}
                  >
                    Copy
                  </button>
                  {promptUsed && (
                    <div className="mb-3 pb-2.5 border-b border-slate-700 text-purple-500 text-[11px]">
                      <strong>Prompt:</strong> {promptUsed}
                    </div>
                  )}
                  <div><strong className="text-slate-500 text-[11px]">Result:</strong></div>
                  <div className="mt-1">{currentDescription}</div>
                </div>
              ) : (
                <div className="text-center text-slate-600 text-xs mt-5">
                  {serverStatus?.model_ready ? 'Add image(s) and click "Run Image" or "Run with Prompt"' : 'Load a model to start'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-auto">
            <div className="p-2.5 border-b border-slate-800 flex gap-2">
              <button onClick={clearHistory} className={`${buttonClass} bg-red-600`}>Clear History</button>
            </div>

            {history.length === 0 ? (
              <div className="text-center text-slate-600 text-xs mt-10">
                No analyses yet
              </div>
            ) : (
              <div className="p-2.5">
                {history.slice().reverse().map((item, i) => (
                  <div key={i} className="bg-slate-900 rounded-lg p-3.5 mb-2.5">
                    <div className="flex gap-2.5 mb-2">
                      {item.thumbnail && (
                        <img src={item.thumbnail} alt="" className="w-[60px] h-[60px] object-cover rounded" />
                      )}
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500 mb-1">
                          {new Date(item.timestamp).toLocaleString()} | {item.processing_time.toFixed(2)}s
                          {item.filename && ` | ${item.filename}`}
                        </div>
                        {(item.prompt_used || item.prompt) && (
                          <div className="text-[10px] text-purple-500 mb-1">
                            Prompt: {(item.prompt_used || item.prompt || '').substring(0, 80)}{(item.prompt_used || item.prompt || '').length > 80 ? '...' : ''}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => copyToClipboard(item.description)}
                        className={`${buttonClass} py-1 px-2 text-[10px] bg-slate-700 h-fit`}
                      >
                        Copy
                      </button>
                    </div>
                    <div className="text-xs whitespace-pre-wrap">
                      {item.description}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Logs Panel */}
      <div className="flex flex-col min-h-[60px] max-h-[500px]" style={{ height: `${logPanelHeight}px` }}>
        {/* Drag Handle */}
        <div
          onMouseDown={handleLogPanelDragStart}
          className={`h-1.5 cursor-ns-resize flex items-center justify-center ${isDraggingLogPanel ? 'bg-slate-700' : 'bg-slate-800'}`}
        >
          <div className="w-10 h-0.5 bg-slate-600 rounded-sm" />
        </div>
        <div className="py-1 px-2.5 border-b border-slate-800 flex justify-between items-center bg-[#161616]">
          <span className="text-[10px] text-slate-500">Logs ({logs.length})</span>
          <button onClick={() => setLogs([])} className="bg-transparent border-none text-slate-600 text-[9px] cursor-pointer">Clear</button>
        </div>
        <div className="flex-1 overflow-auto py-1.5 px-2.5 text-[11px] font-mono bg-[#0a0a0a] leading-snug">
          {logs.map((log, i) => (
            <div key={i} className={`mb-0.5 ${log.includes('ERROR') ? 'text-red-500' : log.includes('Ready') || log.includes('loaded') || log.includes('success') || log.includes('complete') ? 'text-green-500' : 'text-slate-400'}`}>
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
