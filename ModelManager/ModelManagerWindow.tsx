import React, { useState, useEffect, useCallback, useRef } from 'react';

// ============== Icons (matching SDXL style) ==============
const IconServer = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M24,72H232a8,8,0,0,0,0-16H24a8,8,0,0,0,0,16Zm208,32H24a8,8,0,0,0-8,8v48a8,8,0,0,0,8,8H232a8,8,0,0,0,8-8V112A8,8,0,0,0,232,104Zm-8,48H32V120H224ZM232,184H24a8,8,0,0,0-8,8v24a8,8,0,0,0,8,8H232a8,8,0,0,0,8-8V192A8,8,0,0,0,232,184Zm-8,24H32V200H224Zm-28-72a12,12,0,1,1,12,12A12,12,0,0,1,196,136Zm0,80a12,12,0,1,1,12,12A12,12,0,0,1,196,216Z" />
  </svg>
);

const IconGear = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Z"/>
  </svg>
);

const IconPackage = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm176,85.78h0l-80,43.79V133.82l32-17.51V152a8,8,0,0,0,16,0V107.55L216,90v85.77Z"/>
  </svg>
);

const IconPlay = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z"/>
  </svg>
);

const IconStop = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M200,32H56A24,24,0,0,0,32,56V200a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V56A24,24,0,0,0,200,32Zm8,168a8,8,0,0,1-8,8H56a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8H200a8,8,0,0,1,8,8Z"/>
  </svg>
);

const IconFolder = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40ZM216,200H40V88H216Z"/>
  </svg>
);

const IconDownload = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"/>
  </svg>
);

const IconTrash = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/>
  </svg>
);

const IconX = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/>
  </svg>
);

const IconSearch = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>
  </svg>
);

const IconSparkle = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M197.58,129.06l-51.61-19-19-51.65a15.92,15.92,0,0,0-29.88,0L78.07,110l-51.65,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0l19-51.61,51.65-19a15.92,15.92,0,0,0,0-29.88ZM140.39,163a15.87,15.87,0,0,0-9.43,9.43l-19,51.46L93,172.39A15.87,15.87,0,0,0,83.61,163h0L32.15,144l51.46-19A15.87,15.87,0,0,0,93,115.61l19-51.46,19,51.46a15.87,15.87,0,0,0,9.43,9.43l51.46,19ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z"/>
  </svg>
);

const IconGpu = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M232,64H176a8,8,0,0,0-8,8v32H128V72a8,8,0,0,0-8-8H64a8,8,0,0,0-8,8v32H24a8,8,0,0,0-8,8v64a8,8,0,0,0,8,8H56v32a8,8,0,0,0,8,8h56a8,8,0,0,0,8-8V184h40v32a8,8,0,0,0,8,8h56a8,8,0,0,0,8-8V72A8,8,0,0,0,232,64ZM72,80h40v24H72Zm40,128H72V184h40Zm72,0H144V184h40Zm40-32H32V120H232Z"/>
  </svg>
);

const IconCheck = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const IconWarning = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z"/>
  </svg>
);

// ============== Types ==============
interface GpuDevice {
  index: number;
  name: string;
  vram_gb: number;
  compute_capability: string;
}

interface GpuInfo {
  available: boolean;
  gpus: GpuDevice[];
  total_vram_gb: number;
  driver_version: string | null;
  cuda_version: string | null;
  recommendation_tier: 'cpu' | 'low' | 'medium' | 'high' | 'ultra' | 'datacenter';
  recommendation_text: string;
  max_recommended_vram: number;
}
interface ServerStatus {
  huggingface_path: string;
  sdxl_path: string;
  total_size: number;
  total_size_formatted: string;
  active_downloads: number;
}

interface DownloadedModel {
  id: string;
  name: string;
  type: 'huggingface' | 'sdxl';
  size: number;
  size_formatted: string;
  path: string;
  filename?: string;
  last_used: string;
}

interface CatalogModel {
  id: string;
  name: string;
  description: string;
  size: string;
  size_bytes?: number;
  vram_gb?: number;
  tier?: string;
  type: string;
  filename?: string;
  tags: string[];
  downloaded: boolean;
  can_run?: boolean;
  recommendation?: 'recommended' | 'possible' | 'too_large';
  recommendation_note?: string;
  gated?: boolean;  // Requires HuggingFace token
}

interface CatalogCategory {
  name: string;
  description: string;
  models: CatalogModel[];
}

interface DownloadProgress {
  status: string;
  progress: number;
  message: string;
}

// ============== Constants ==============
const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'requests', 'huggingface_hub'];

const CATEGORY_ICONS: Record<string, string> = {
  llm: '💬',
  code: '💻',
  image: '🎨',
  audio: '🎵',
  embedding: '🔗',
  vision: '👁️',
  video: '🎬',
  quantized: '⚡',
  moe: '🧠',
};

// ============== Component ==============
export const ModelManagerWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8780);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');

  // Model state
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>([]);
  const [catalog, setCatalog] = useState<Record<string, CatalogCategory>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});

  // UI state
  const [activeTab, setActiveTab] = useState<'downloaded' | 'catalog'>('catalog');
  const [selectedCategory, setSelectedCategory] = useState<string>('llm');
  const [searchQuery, setSearchQuery] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [showServerPanel, setShowServerPanel] = useState(true);
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DownloadedModel | null>(null);
  const [showOnlyCompatible, setShowOnlyCompatible] = useState(false);

  // GPU state
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);

  // HuggingFace credentials for gated models
  const [hfToken, setHfToken] = useState<string>('');
  const [showHfToken, setShowHfToken] = useState(false);

  // Dependency state (same as SDXL)
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);

  // Refs
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  // ============== Utilities ==============
  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
  }, []);

  const getServerUrl = () => `http://127.0.0.1:${serverPort}`;

  // Panel style (matching SDXL)
  const panelClass = "rounded-xl p-4 border border-white/5 bg-slate-950/80 backdrop-blur-xl shadow-lg";

  // ============== Effects ==============

  // Auto-scroll logs
  useEffect(() => {
    if (!isScrolledUp) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isScrolledUp]);

  // Detect scroll position in logs
  const handleLogsScroll = useCallback(() => {
    const container = logsContainerRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 10;
    setIsScrolledUp(!isAtBottom);
  }, []);

  // Load venvs
  useEffect(() => {
    const loadVenvs = async () => {
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke('python-list-venvs');
      if (result.success && result.venvs.length > 0) {
        const names = result.venvs.map((v: any) => v.name);
        setAvailableVenvs(names);
        if (!selectedVenv) setSelectedVenv(names[0]);
      }
    };
    loadVenvs();
  }, [ipcRenderer, selectedVenv]);

  // Listen for Python logs
  useEffect(() => {
    if (!ipcRenderer) return;

    const handlePythonLog = (_event: any, log: string) => {
      const trimmed = log.trim();
      const isPollingRequest =
        trimmed.includes('GET /status') ||
        trimmed.includes('GET /health') ||
        trimmed.includes('GET /downloaded') ||
        trimmed.includes('GET /catalog');

      const isRoutineServerLog =
        trimmed.includes('127.0.0.1:') && (
          trimmed.includes('GET /status') ||
          trimmed.includes('GET /health') ||
          trimmed.includes('GET /downloaded') ||
          trimmed.includes('GET /catalog')
        );

      const isGenericInfo =
        trimmed.includes('INFO:     Started server process') ||
        trimmed.includes('INFO:     Waiting for application startup') ||
        trimmed.includes('INFO:     Application startup complete') ||
        trimmed.includes('INFO:     Uvicorn running on');

      if (isPollingRequest || isRoutineServerLog || isGenericInfo) {
        return;
      }

      addLog(`[Python] ${trimmed}`);
    };

    ipcRenderer.on('python-log', handlePythonLog);
    ipcRenderer.on('python-error', handlePythonLog);

    return () => {
      ipcRenderer.removeListener('python-log', handlePythonLog);
      ipcRenderer.removeListener('python-error', handlePythonLog);
    };
  }, [ipcRenderer, addLog]);

  // Automatically check dependencies when venv changes (same as SDXL)
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
              const found = v.packages.find((p: string) => p.toLowerCase().startsWith(pkg.toLowerCase()));
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

  // Poll server status and data
  useEffect(() => {
    if (!serverRunning) return;

    const fetchData = async () => {
      try {
        const statusRes = await fetch(`${getServerUrl()}/status`);
        if (statusRes.ok) {
          setServerStatus(await statusRes.json());
        }

        const downloadedRes = await fetch(`${getServerUrl()}/downloaded`);
        if (downloadedRes.ok) {
          const data = await downloadedRes.json();
          setDownloadedModels(data.models || []);
        }

        const catalogRes = await fetch(`${getServerUrl()}/catalog`);
        if (catalogRes.ok) {
          const data = await catalogRes.json();
          setCatalog(data.catalog || {});
        }

        // Fetch GPU info (only once or on first load)
        if (!gpuInfo) {
          const gpuRes = await fetch(`${getServerUrl()}/gpu`);
          if (gpuRes.ok) {
            const data = await gpuRes.json();
            if (data.success) {
              setGpuInfo(data.gpu);
            }
          }
        }

        // Check download progress for active downloads
        for (const modelId of Object.keys(downloadProgress)) {
          if (downloadProgress[modelId].status === 'downloading' || downloadProgress[modelId].status === 'starting') {
            const progressRes = await fetch(`${getServerUrl()}/download/progress/${encodeURIComponent(modelId)}`);
            if (progressRes.ok) {
              const data = await progressRes.json();
              if (data.success) {
                setDownloadProgress(prev => ({ ...prev, [modelId]: data }));
              }
            }
          }
        }
      } catch {
        // Ignore polling errors
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [serverRunning, serverPort, downloadProgress, gpuInfo]);

  // ============== Dependency Management (same pattern as SDXL) ==============

  const checkDeps = async () => {
    if (!selectedVenv) {
      addLog('ERROR: No venv selected for dependency check');
      return;
    }

    setCheckingDeps(true);
    try {
      if (ipcRenderer) {
        const vres = await ipcRenderer.invoke('python-list-venvs');
        if (vres.success) {
          const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
          if (v && Array.isArray(v.packages) && v.packages.length >= 0) {
            const map: Record<string, any> = {};
            for (const pkg of REQUIRED_PACKAGES) {
              const found = v.packages.find((p: string) => p.toLowerCase().startsWith(pkg.toLowerCase()));
              map[pkg] = { installed: !!found, version: found ? found.split(' ')[1] : undefined };
            }
            setDepsStatus(map);
            addLog('Dependency status loaded from Python Manager');
            setCheckingDeps(false);
            return;
          }
        }
      }

      const unknownMap: Record<string, any> = {};
      for (const p of REQUIRED_PACKAGES) unknownMap[p] = { installed: false };
      setDepsStatus(unknownMap);
      addLog('Could not determine dependency status');
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setCheckingDeps(false);
    }
  };

  const installMissing = async () => {
    if (!selectedVenv) {
      addLog('ERROR: No venv selected');
      return;
    }

    const missing = REQUIRED_PACKAGES.filter(p => !depsStatus[p]?.installed);
    if (missing.length === 0) {
      addLog('All required packages are already installed');
      return;
    }

    setInstallingDeps(true);
    try {
      if (ipcRenderer) {
        const pkgString = missing.join(' ');
        addLog(`Installing: ${pkgString} into venv ${selectedVenv}`);
        const inst = await ipcRenderer.invoke('python-install-package', { venvName: selectedVenv, package: pkgString });
        addLog(inst?.message || JSON.stringify(inst));
        await checkDeps();
      } else {
        addLog('ERROR: Cannot install packages - Python Manager not available');
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setInstallingDeps(false);
    }
  };

  // ============== Server Control ==============

  const checkServerStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${getServerUrl()}/status`);
      if (res.ok) {
        setServerStatus(await res.json());
        setServerRunning(true);
        return true;
      }
    } catch {
      setServerRunning(false);
      setServerStatus(null);
    }
    return false;
  }, [serverPort]);

  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting Model Manager server...');

    const alreadyRunning = await checkServerStatus();
    if (alreadyRunning) {
      addLog('Server already running!');
      setConnecting(false);
      return;
    }

    if (!selectedVenv) {
      addLog('ERROR: No Python virtual environment selected. Create one in Python Manager first.');
      setConnecting(false);
      return;
    }

    addLog(`Using venv: ${selectedVenv}`);

    const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
      workflowFolder: 'ModelManager',
      scriptName: 'model_manager_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find model_manager_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'model_manager',
    });

    if (result.success) {
      addLog(`Server process started (PID: ${result.pid}), waiting for connection...`);

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
          addLog('ERROR: Server failed to start within timeout. Check that fastapi, uvicorn, requests and huggingface_hub are installed.');
          setConnecting(false);
        }
      }, 1000);
    } else {
      addLog(`ERROR: Failed to start server: ${result.error}`);
      setConnecting(false);
    }
  };

  const stopServer = async () => {
    if (!ipcRenderer) return;

    const result = await ipcRenderer.invoke('python-stop-script-server', 'model_manager');
    if (result.success) {
      addLog('Server stopped');
      setServerRunning(false);
      setServerStatus(null);
      setGpuInfo(null);
    } else {
      try {
        await fetch(`${getServerUrl()}/shutdown`, { method: 'POST' });
        addLog('Server shutdown requested');
      } catch {
        addLog('Server not responding - it may have already stopped');
      }
      setServerRunning(false);
      setServerStatus(null);
      setGpuInfo(null);
    }
  };

  // ============== Model Operations ==============

  const downloadModel = async (model: CatalogModel) => {
    if (!serverRunning) return;

    addLog(`Starting download: ${model.id}`);
    setDownloadProgress(prev => ({
      ...prev,
      [model.id]: { status: 'starting', progress: 0, message: 'Starting download...' }
    }));

    try {
      const requestBody: { model_id: string; model_type: string; hf_token?: string } = {
        model_id: model.id,
        model_type: model.type,
      };

      // Include HuggingFace token if provided (for gated models)
      if (hfToken.trim()) {
        requestBody.hf_token = hfToken.trim();
      }

      const res = await fetch(`${getServerUrl()}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();
      if (!data.success) {
        addLog(`ERROR: ${data.error}`);
        setDownloadProgress(prev => ({
          ...prev,
          [model.id]: { status: 'error', progress: 0, message: data.error }
        }));
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
      setDownloadProgress(prev => ({
        ...prev,
        [model.id]: { status: 'error', progress: 0, message: e.message }
      }));
    }
  };

  const cancelDownload = async (modelId: string) => {
    if (!serverRunning) return;

    try {
      await fetch(`${getServerUrl()}/download/cancel/${encodeURIComponent(modelId)}`, { method: 'POST' });
      addLog(`Download cancelled: ${modelId}`);
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const deleteModel = async (model: DownloadedModel) => {
    if (!serverRunning) return;

    addLog(`Deleting: ${model.id}`);

    try {
      const res = await fetch(`${getServerUrl()}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, model_type: model.type, path: model.path }),
      });

      const data = await res.json();
      if (data.success) {
        addLog(`Deleted: ${model.id}`);
        setDownloadedModels(prev => prev.filter(m => m.path !== model.path));
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }

    setConfirmDelete(null);
  };

  // ============== Filtering ==============

  const filteredCatalogModels = catalog[selectedCategory]?.models.filter(model => {
    // Filter by compatibility if enabled
    if (showOnlyCompatible && model.can_run === false) return false;

    // Filter by search query
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return model.name.toLowerCase().includes(query) ||
           model.description.toLowerCase().includes(query) ||
           model.tags.some(t => t.toLowerCase().includes(query));
  }) || [];

  const filteredDownloadedModels = downloadedModels.filter(model => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query);
  });

  // ============== Render ==============
  return (
    <div className="h-full flex flex-col overflow-hidden bg-gradient-to-br from-[#0f0f1a] via-[#1a1a2e] to-[#16213e]">
        {/* Header with Status Bar (matching SDXL) */}
        <div className="flex-none px-4 py-2.5 border-b border-white/10 bg-slate-900/50 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-lg shadow-violet-500/30 flex-shrink-0">
                <IconFolder className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold bg-gradient-to-r from-violet-400 via-purple-400 to-pink-400 bg-clip-text text-transparent leading-tight">
                  Model Manager
                </h2>
                <p className="text-xs text-slate-500">Download & Manage AI Models</p>
              </div>
            </div>

            {/* Status Indicators */}
            <div className="flex items-center gap-3 text-xs">
              {serverRunning ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="text-emerald-400 font-medium">Running</span>
                  </div>
                  {serverStatus && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-violet-400">Storage:</span>
                      <span className="text-slate-300">{serverStatus.total_size_formatted}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-600"></span>
                  <span className="text-slate-500">Offline</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT SIDEBAR - Setup & Categories */}
          <div className="w-[320px] border-r border-white/5 overflow-y-auto p-4 space-y-4 bg-black/40">

            {/* Setup & Dependencies (matching SDXL exactly) */}
            <div className={panelClass}>
              <button
                onClick={() => setShowServerPanel(!showServerPanel)}
                className="w-full text-left flex items-center justify-between mb-3 group bg-transparent"
              >
                <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
                  <IconGear className="w-4 h-4" />
                  Setup & Dependencies
                </h3>
                <span className={`text-cyan-400 text-xs transition-transform duration-200 ${showServerPanel ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </button>

              {showServerPanel && (
                <div className="space-y-4 text-xs">
                  {/* Venv Selection */}
                  <div className="flex items-center gap-3">
                    <label className="font-medium text-xs whitespace-nowrap text-slate-300">Virtual Environment</label>
                    <select
                      value={selectedVenv}
                      onChange={e => setSelectedVenv(e.target.value)}
                      className="flex-1 text-xs rounded-lg px-3 py-2.5 border border-white/10 focus:outline-none focus:border-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-slate-800 text-slate-200"
                      disabled={serverRunning}
                    >
                      {availableVenvs.length === 0 ? (
                        <option value="">No venvs available</option>
                      ) : (
                        availableVenvs.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))
                      )}
                    </select>
                  </div>

                  {/* Dependencies Section */}
                  <div className="p-4 rounded-xl bg-slate-800/40 border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold flex items-center gap-1.5 text-slate-300">
                        <IconPackage className="w-3.5 h-3.5" />
                        Python Packages {checkingDeps && <span className="text-slate-400">(checking...)</span>}
                      </h4>
                      <button
                        onClick={installMissing}
                        disabled={installingDeps || !selectedVenv || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)}
                        className={`px-3 py-2 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all shadow-sm ${
                          (installingDeps || !selectedVenv || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed))
                            ? 'bg-slate-700'
                            : 'bg-cyan-600 hover:bg-cyan-500'
                        }`}
                      >
                        {installingDeps ? 'Installing...' : 'Install All'}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {REQUIRED_PACKAGES.map(pkg => {
                        const st = depsStatus[pkg];
                        const isInstalled = st?.installed;
                        return (
                          <div
                            key={pkg}
                            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-all ${
                              isInstalled
                                ? 'bg-green-500/15 border border-green-500/40'
                                : 'bg-red-500/15 border border-red-500/40'
                            }`}
                          >
                            <span
                              className={`flex-1 truncate font-medium ${isInstalled ? 'text-green-300' : 'text-red-300'}`}
                            >
                              {pkg}
                            </span>
                            {isInstalled ? (
                              <svg className="w-3.5 h-3.5 flex-none text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5 flex-none text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* HuggingFace Credentials for Gated Models */}
                  <div className="p-4 rounded-xl bg-slate-800/40 border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold flex items-center gap-1.5 text-slate-300">
                        🤗 HuggingFace Token
                        <span className="text-[10px] text-slate-500 font-normal">(for gated models)</span>
                      </h4>
                    </div>
                    <div className="space-y-2">
                      <div className="relative">
                        <input
                          type={showHfToken ? 'text' : 'password'}
                          value={hfToken}
                          onChange={e => setHfToken(e.target.value)}
                          placeholder="hf_xxxxxxxxxxxxxxxxxxxx"
                          className="w-full text-xs rounded-lg px-3 py-2.5 pr-10 border border-white/10 focus:outline-none focus:border-amber-500/50 transition-all bg-slate-800 text-slate-200"
                        />
                        <button
                          type="button"
                          onClick={() => setShowHfToken(!showHfToken)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
                        >
                          {showHfToken ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Get your token from{' '}
                        <a
                          href="https://huggingface.co/settings/tokens"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-400 hover:text-amber-300 underline"
                          onClick={(e) => {
                            e.preventDefault();
                            if (ipcRenderer) {
                              ipcRenderer.invoke('open-external-url', 'https://huggingface.co/settings/tokens');
                            } else {
                              window.open('https://huggingface.co/settings/tokens', '_blank');
                            }
                          }}
                        >
                          huggingface.co/settings/tokens
                        </a>
                        . Required for gated models like Llama, Mistral, etc.
                      </p>
                      {hfToken && (
                        <div className="flex items-center gap-2 text-[10px] text-emerald-400">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                          Token configured
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Port & Server Control */}
                  <div className="space-y-3 pt-4 border-t border-white/10">
                    <div className="flex items-center gap-3">
                      <label className="font-medium text-xs whitespace-nowrap text-slate-300">Port</label>
                      <input
                        type="number"
                        value={serverPort}
                        onChange={e => setServerPort(parseInt(e.target.value) || 8780)}
                        className="w-32 text-xs rounded-lg px-3 py-2.5 border border-white/10 focus:outline-none focus:border-cyan-500/50 transition-all disabled:opacity-50 bg-slate-800 text-slate-200"
                        disabled={serverRunning}
                      />
                    </div>
                    {!serverRunning ? (
                      <button
                        onClick={startServer}
                        disabled={connecting}
                        className={`w-full px-4 py-3 disabled:opacity-60 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg text-white ${
                          connecting ? 'bg-slate-700' : 'bg-green-600 hover:bg-green-500'
                        }`}
                      >
                        <IconPlay className="w-3.5 h-3.5" />
                        {connecting ? 'Starting...' : 'Start Server'}
                      </button>
                    ) : (
                      <button
                        onClick={stopServer}
                        className="w-full px-4 py-3 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg text-white bg-red-600 hover:bg-red-500"
                      >
                        <IconStop className="w-3.5 h-3.5" />
                        Stop Server
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* GPU Info Panel */}
            {serverRunning && gpuInfo && (
              <div className={panelClass}>
                <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2 mb-3">
                  <IconGpu className="w-4 h-4" />
                  Your GPU
                </h3>
                <div className="space-y-3 text-xs">
                  {gpuInfo.available ? (
                    <>
                      {gpuInfo.gpus.map((gpu, i) => (
                        <div key={i} className="p-3 rounded-lg bg-slate-800/60 border border-emerald-500/20">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-white">{gpu.name}</span>
                            <span className="text-emerald-400 font-semibold">{gpu.vram_gb} GB</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1">
                            Compute {gpu.compute_capability}
                          </div>
                        </div>
                      ))}
                      <div className="p-3 rounded-lg bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 border border-emerald-500/30">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-emerald-400 font-semibold capitalize">{gpuInfo.recommendation_tier}</span>
                          <span className="text-slate-400">Tier</span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {gpuInfo.recommendation_text}
                        </p>
                      </div>
                      {gpuInfo.cuda_version && (
                        <div className="text-[10px] text-slate-500 flex justify-between">
                          <span>CUDA {gpuInfo.cuda_version}</span>
                          {gpuInfo.driver_version && <span>Driver {gpuInfo.driver_version}</span>}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-500/30">
                      <div className="flex items-center gap-2 text-amber-400">
                        <IconWarning className="w-4 h-4" />
                        <span className="font-medium">No GPU Detected</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        You can still run small models on CPU, but performance will be limited.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Category Selection */}
            {serverRunning && activeTab === 'catalog' && (
              <div className={panelClass}>
                <h3 className="text-sm font-semibold text-violet-400 mb-3">Categories</h3>
                <div className="space-y-1">
                  {Object.entries(catalog).map(([key, category]) => (
                    <button
                      key={key}
                      onClick={() => setSelectedCategory(key)}
                      className={`w-full px-3 py-2.5 text-left text-xs rounded-lg transition-all ${
                        selectedCategory === key
                          ? 'bg-violet-500/20 border border-violet-500/40 text-white'
                          : 'hover:bg-slate-800/50 text-slate-400 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{CATEGORY_ICONS[key] || '📦'}</span>
                        <div className="flex-1">
                          <div className={selectedCategory === key ? 'text-white' : 'text-slate-300'}>
                            {category.name}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {category.models.length} models
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Console Log Panel */}
            <div className={panelClass}>
              <button
                onClick={() => setShowLogsPanel(!showLogsPanel)}
                className="w-full text-left flex items-center justify-between mb-3 group bg-transparent"
              >
                <h3 className="text-sm font-semibold text-slate-400 flex items-center gap-2">
                  Console ({logs.length})
                </h3>
                <div className="flex items-center gap-2">
                  {logs.length > 0 && (
                    <span
                      onClick={(e) => { e.stopPropagation(); setLogs([]); }}
                      className="text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      Clear
                    </span>
                  )}
                  <span className={`text-slate-400 text-xs transition-transform duration-200 ${showLogsPanel ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </div>
              </button>

              {showLogsPanel && (
                <div
                  ref={logsContainerRef}
                  onScroll={handleLogsScroll}
                  className="h-40 overflow-y-auto font-mono text-[10px] bg-black/30 rounded-lg p-2"
                >
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={
                        log.includes('ERROR') ? 'text-red-400' :
                        log.includes('complete') || log.includes('success') || log.includes('Connected') || log.includes('Deleted') ? 'text-emerald-400' :
                        log.includes('Downloading') || log.includes('Starting') ? 'text-violet-400' :
                        'text-slate-500'
                      }
                    >
                      {log}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </div>

          {/* RIGHT CONTENT - Models */}
          <div className="flex-1 flex flex-col overflow-hidden bg-black/20">
            {/* Tabs & Search */}
            <div className="flex-none px-4 py-3 border-b border-white/10 flex items-center gap-4">
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveTab('catalog')}
                  className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                    activeTab === 'catalog'
                      ? 'bg-violet-500/20 text-violet-400 border border-violet-500/40'
                      : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  Model Catalog
                </button>
                <button
                  onClick={() => setActiveTab('downloaded')}
                  className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                    activeTab === 'downloaded'
                      ? 'bg-violet-500/20 text-violet-400 border border-violet-500/40'
                      : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  Downloaded ({downloadedModels.length})
                </button>
              </div>

              <div className="flex-1 max-w-md">
                <div className="relative">
                  <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search models..."
                    className="w-full pl-10 pr-4 py-2 rounded-lg text-xs border border-white/10 focus:border-violet-500/50 focus:outline-none bg-slate-800 text-slate-200"
                  />
                </div>
              </div>

              {/* Compatibility Filter */}
              {activeTab === 'catalog' && gpuInfo && (
                <label className="flex items-center gap-2 text-xs cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={showOnlyCompatible}
                    onChange={e => setShowOnlyCompatible(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-slate-800 text-emerald-500 focus:ring-emerald-500/50"
                  />
                  <span className="text-slate-400 group-hover:text-slate-300 transition-colors">
                    Show compatible only
                  </span>
                </label>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {!serverRunning ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <IconServer className="w-16 h-16 mx-auto mb-4 text-slate-700" />
                    <p className="text-slate-500 text-sm">Start the server to browse and manage models</p>
                  </div>
                </div>
              ) : activeTab === 'catalog' ? (
                <div className="grid gap-3">
                  {filteredCatalogModels.map(model => {
                    const progress = downloadProgress[model.id];
                    const isDownloading = progress && (progress.status === 'downloading' || progress.status === 'starting');

                    return (
                      <div
                        key={model.id}
                        className={`p-4 rounded-xl border transition-all ${
                          model.downloaded
                            ? 'bg-emerald-900/20 border-emerald-500/30'
                            : model.recommendation === 'too_large'
                            ? 'bg-slate-800/30 border-white/5 opacity-70'
                            : model.recommendation === 'possible'
                            ? 'bg-slate-800/50 border-amber-500/20 hover:border-amber-500/40'
                            : 'bg-slate-800/50 border-white/10 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-medium text-sm text-white">{model.name}</h3>
                              {model.downloaded && (
                                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                              {/* Recommendation Badge */}
                              {!model.downloaded && model.recommendation === 'recommended' && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30 flex items-center gap-1">
                                  <IconCheck className="w-2.5 h-2.5" />
                                  Good fit
                                </span>
                              )}
                              {!model.downloaded && model.recommendation === 'possible' && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30 flex items-center gap-1">
                                  <IconWarning className="w-2.5 h-2.5" />
                                  Tight fit
                                </span>
                              )}
                              {!model.downloaded && model.recommendation === 'too_large' && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded-full border border-red-500/30">
                                  {model.recommendation_note}
                                </span>
                              )}
                              {/* Gated Model Badge */}
                              {model.gated && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30 flex items-center gap-1" title="Requires HuggingFace token">
                                  🔐 Gated
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 mt-1">{model.description}</p>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className="text-[10px] px-2 py-0.5 bg-slate-700 rounded text-slate-300">{model.size}</span>
                              {model.vram_gb && (
                                <span className="text-[10px] px-2 py-0.5 bg-cyan-900/40 text-cyan-300 rounded border border-cyan-500/20">
                                  {model.vram_gb}GB VRAM
                                </span>
                              )}
                              {model.tags.slice(0, 2).map(tag => (
                                <span key={tag} className="text-[10px] px-2 py-0.5 bg-violet-900/30 text-violet-300 rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="flex-none">
                            {model.downloaded ? (
                              <span className="text-xs text-emerald-400 font-medium">Downloaded</span>
                            ) : isDownloading ? (
                              <div className="w-32">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] text-slate-400">{Math.round(progress.progress)}%</span>
                                  <button
                                    onClick={() => cancelDownload(model.id)}
                                    className="text-red-400 hover:text-red-300"
                                  >
                                    <IconX className="w-3 h-3" />
                                  </button>
                                </div>
                                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all"
                                    style={{ width: `${progress.progress}%` } /* dynamic width must use style */}
                                  />
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1 truncate">{progress.message}</p>
                              </div>
                            ) : progress?.status === 'error' ? (
                              <div className="text-center">
                                <span className="text-xs text-red-400">Error</span>
                                <button
                                  onClick={() => downloadModel(model)}
                                  className="block text-[10px] text-violet-400 hover:text-violet-300 mt-1"
                                >
                                  Retry
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-col items-end gap-1">
                                <button
                                  onClick={() => downloadModel(model)}
                                  disabled={!serverRunning}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
                                >
                                  <IconDownload className="w-3 h-3" />
                                  Download
                                </button>
                                {/* Warning for gated models without token */}
                                {model.gated && !hfToken && (
                                  <span className="text-[9px] text-amber-400 flex items-center gap-1">
                                    <IconWarning className="w-3 h-3" />
                                    Token required
                                  </span>
                                )}
                                {/* Show token will be used */}
                                {model.gated && hfToken && (
                                  <span className="text-[9px] text-emerald-400 flex items-center gap-1">
                                    🔑 Token ready
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {filteredCatalogModels.length === 0 && (
                    <div className="text-center text-slate-500 py-8">
                      No models found matching "{searchQuery}"
                    </div>
                  )}
                </div>
              ) : downloadedModels.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <IconFolder className="w-16 h-16 mx-auto mb-4 text-slate-700" />
                    <p className="text-slate-500 text-sm">No models downloaded yet</p>
                    <p className="text-slate-600 text-xs mt-1">Browse the catalog to download models</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDownloadedModels.map(model => (
                    <div
                      key={model.path}
                      className="p-4 bg-slate-800/50 rounded-xl border border-white/10 flex items-center gap-4"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                        model.type === 'sdxl' ? 'bg-gradient-to-br from-pink-600 to-rose-600' : 'bg-gradient-to-br from-violet-600 to-purple-600'
                      }`}>
                        {model.type === 'sdxl' ? '🎨' : '💬'}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm text-white truncate">{model.name}</h3>
                        <p className="text-[10px] text-slate-500 truncate">{model.id}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
                          <span>{model.size_formatted}</span>
                          <span>•</span>
                          <span className="uppercase">{model.type}</span>
                          <span>•</span>
                          <span>Last used: {model.last_used}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => setConfirmDelete(model)}
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg transition-colors"
                        title="Delete model"
                      >
                        <IconTrash className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  {filteredDownloadedModels.length === 0 && searchQuery && (
                    <div className="text-center text-slate-500 py-8">
                      No models found matching "{searchQuery}"
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {confirmDelete && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full mx-4 border border-white/10 shadow-2xl">
              <h3 className="text-lg font-medium text-white mb-2">Delete Model?</h3>
              <p className="text-sm text-slate-400 mb-4">
                Are you sure you want to delete <span className="text-white font-medium">{confirmDelete.name}</span>?
                This will free up {confirmDelete.size_formatted} of disk space.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteModel(confirmDelete)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm text-white transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
};
