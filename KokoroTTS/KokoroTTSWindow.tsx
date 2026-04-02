// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

/**
 * Kokoro TTS Window
 *
 * A standalone Text-to-Speech service using the Kokoro model.
 * Features:
 * - Voice selection with preview
 * - Speed control
 * - Test synthesis
 * - Dependency management (like VoiceAgent)
 * - API endpoints for other workflows to use
 */

interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
  is_current: boolean;
}

interface VramStats {
  total: number;
  free: number;
  allocated: number;
  used: number;
}

interface ServerStatus {
  tts_ready: boolean;
  tts_loading: boolean;
  current_voice: string;
  current_speed: number;
  is_speaking: boolean;
  cuda_available: boolean;
  vram: VramStats | null;
  device: string | null;
}

// Required Python packages for Kokoro TTS
const REQUIRED_PACKAGES = [
  'fastapi',
  'uvicorn',
  'torch',
  'numpy',
  'kokoro>=0.9.2',
  'soundfile',
  'scipy'
];

// Packages that need special CUDA-enabled versions
const CUDA_PACKAGES: Record<string, {
  installCmd: string;
  checkCuda: (version: string) => boolean;
  requiredVersion?: string;
}> = {
  'torch': {
    installCmd: 'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124',
    checkCuda: (version: string) => version.includes('+cu'),
  },
};

// Helper to normalize package names
const normalizePackageName = (name: string): string => name.toLowerCase().replace(/-/g, '_');

// Parse package info
const parsePackageInfo = (pkgStr: string): { name: string; version?: string } => {
  if (pkgStr.includes(' @ ')) {
    const name = pkgStr.split(' @ ')[0].trim();
    return { name, version: 'local' };
  }
  if (pkgStr.includes('==')) {
    const [name, version] = pkgStr.split('==');
    return { name: name.trim(), version: version?.trim() };
  }
  return { name: pkgStr.trim() };
};

// Find installed package
const findInstalledPackage = (installedPackages: string[], requiredPkg: string): { found: boolean; version?: string } => {
  const requiredName = normalizePackageName(requiredPkg.replace(/[<>=!].*/g, ''));
  for (const pkgStr of installedPackages) {
    const parsed = parsePackageInfo(pkgStr);
    if (normalizePackageName(parsed.name) === requiredName) {
      return { found: true, version: parsed.version };
    }
  }
  return { found: false };
};

export const KokoroTTSWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8795);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState(null);
  const [connecting, setConnecting] = useState(false);

  // Venv selection
  const [availableVenvs, setAvailableVenvs] = useState([]);
  const [selectedVenv, setSelectedVenv] = useState(() => {
    try { return localStorage.getItem('kokoroTTS_selectedVenv') || ''; } catch { return ''; }
  });

  // Dependency checking
  const [depsStatus, setDepsStatus] = useState({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [installingPackage, setInstallingPackage] = useState(null);

  // Voices
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('af_heart');
  const [speed, setSpeed] = useState(1.0);

  // Test synthesis
  const [testText, setTestText] = useState('Hello! This is a test of the Kokoro text to speech system.');
  const [synthesizing, setSynthesizing] = useState(false);
  const [audioRef, setAudioRef] = useState(null);

  // Logs
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev: any) => [...prev.slice(-200), `[${timestamp}] ${msg}`]);
  }, []);

  const getServerUrl = useCallback(() => `http://127.0.0.1:${serverPort}`, [serverPort]);

  // Persist venv selection
  useEffect(() => {
    if (selectedVenv) {
      try { localStorage.setItem('kokoroTTS_selectedVenv', selectedVenv); } catch {}
    }
  }, [selectedVenv]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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

  // Check dependencies when venv changes
  useEffect(() => {
    const checkDeps = async () => {
      if (!selectedVenv || !ipcRenderer) return;

      setCheckingDeps(true);

      try {
        const vres = await ipcRenderer.invoke('python-list-venvs');
        if (vres.success) {
          const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
          if (v && Array.isArray(v.packages)) {
            const map: Record<string, any> = {};
            for (const pkg of REQUIRED_PACKAGES) {
              const result = findInstalledPackage(v.packages, pkg);
              const version = result.version || '';
              const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
              map[pkg] = {
                installed: result.found,
                version: result.version,
                hasCuda: cudaInfo ? cudaInfo.checkCuda(version) : undefined
              };
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

    checkDeps();
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
        setInstallingPackage(pkg);
        addLog(`Installing ${pkg}...`);

        const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
        const installCmd = cudaInfo ? cudaInfo.installCmd : pkg;

        const result = await ipcRenderer.invoke('python-install-package', {
          venvName: selectedVenv,
          package: installCmd,
        });

        if (result.success) {
          addLog(`${pkg} installed`);
          setDepsStatus((prev: any) => ({
            ...prev,
            [pkg]: { installed: true, version: undefined, hasCuda: cudaInfo ? true : undefined }
          }));
        } else {
          addLog(`ERROR installing ${pkg}: ${result.error}`);
        }
      }

      addLog('Dependency installation complete');

      // Re-check deps
      const vres = await ipcRenderer.invoke('python-list-venvs');
      if (vres.success) {
        const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
        if (v && Array.isArray(v.packages)) {
          const map: Record<string, any> = {};
          for (const pkg of REQUIRED_PACKAGES) {
            const result = findInstalledPackage(v.packages, pkg);
            const version = result.version || '';
            const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
            map[pkg] = {
              installed: result.found,
              version: result.version,
              hasCuda: cudaInfo ? cudaInfo.checkCuda(version) : undefined
            };
          }
          setDepsStatus(map);
        }
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setInstallingDeps(false);
      setInstallingPackage(null);
    }
  };

  // Install CUDA package
  const installCudaPackage = async (pkg: string) => {
    if (!ipcRenderer || !selectedVenv) return;

    const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
    if (!cudaInfo) return;

    setInstallingPackage(pkg);
    addLog(`Installing ${pkg} with CUDA support...`);

    try {
      await ipcRenderer.invoke('python-uninstall-package', {
        venvName: selectedVenv,
        package: pkg,
      });

      const result = await ipcRenderer.invoke('python-install-package', {
        venvName: selectedVenv,
        package: cudaInfo.installCmd,
      });

      if (result.success) {
        addLog(`${pkg} with CUDA installed successfully`);
      } else {
        addLog(`ERROR installing ${pkg}: ${result.error}`);
      }

      // Re-check deps
      const vres = await ipcRenderer.invoke('python-list-venvs');
      if (vres.success) {
        const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
        if (v && Array.isArray(v.packages)) {
          const map: Record<string, any> = {};
          for (const p of REQUIRED_PACKAGES) {
            const result = findInstalledPackage(v.packages, p);
            const version = result.version || '';
            const cudaPkgInfo = CUDA_PACKAGES[p as keyof typeof CUDA_PACKAGES];
            map[p] = {
              installed: result.found,
              version: result.version,
              hasCuda: cudaPkgInfo ? cudaPkgInfo.checkCuda(version) : undefined
            };
          }
          setDepsStatus(map);
        }
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setInstallingPackage(null);
    }
  };

  // Listen for Python logs
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

  // EventBus integration - listen for TTS events from other workflows
  useEffect(() => {
    const EventBus = (window as any).EventBus;
    if (!EventBus) return;

    const eventBus = EventBus.getInstance();

    // Handle speak requests from other workflows
    const handleSpeak = async (data: { text: string; voice?: string; speed?: number }) => {
      if (!serverRunning || !serverStatus?.tts_ready) {
        addLog('[EventBus] Received tts:speak but TTS not ready');
        return;
      }

      addLog(`[EventBus] Speaking: "${data.text.substring(0, 50)}..."`);

      try {
        const res = await fetch(`${getServerUrl()}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: data.text,
            voice: data.voice || selectedVoice,
            speed: data.speed || speed
          })
        });

        const result = await res.json();

        if (result.success && result.audio_b64) {
          eventBus.emit('tts:speaking-started', { text: data.text });
          playAudioWithEvents(result.audio_b64, eventBus);
        } else {
          addLog(`[EventBus] Synthesis failed: ${result.error || 'Unknown error'}`);
          eventBus.emit('tts:error', { error: result.error || 'Synthesis failed' });
        }
      } catch (e: any) {
        addLog(`[EventBus] Error: ${e.message}`);
        eventBus.emit('tts:error', { error: e.message });
      }
    };

    // Handle stop requests
    const handleStop = () => {
      addLog('[EventBus] Received tts:stop');
      stopAudio();
    };

    // Handle voice change requests
    const handleSetVoice = (data: { voice: string; speed?: number }) => {
      addLog(`[EventBus] Setting voice to: ${data.voice}`);
      setVoice(data.voice);
      if (data.speed !== undefined) {
        setSpeed(data.speed);
      }
    };

    // Handle status requests
    const handleGetStatus = () => {
      eventBus.emit('tts:status', {
        ready: serverStatus?.tts_ready || false,
        speaking: serverStatus?.is_speaking || false,
        voice: selectedVoice,
        speed: speed
      });
    };

    eventBus.on('tts:speak', handleSpeak);
    eventBus.on('tts:stop', handleStop);
    eventBus.on('tts:set-voice', handleSetVoice);
    eventBus.on('tts:get-status', handleGetStatus);

    // Emit ready event when TTS is loaded
    if (serverStatus?.tts_ready) {
      eventBus.emit('tts:ready', { voice: selectedVoice, speed });
    }

    return () => {
      eventBus.off('tts:speak', handleSpeak);
      eventBus.off('tts:stop', handleStop);
      eventBus.off('tts:set-voice', handleSetVoice);
      eventBus.off('tts:get-status', handleGetStatus);
    };
  }, [serverRunning, serverStatus?.tts_ready, serverStatus?.is_speaking, selectedVoice, speed, getServerUrl]);

  // Play audio with EventBus events
  const playAudioWithEvents = (base64Audio: string, eventBus: any) => {
    // Stop any existing audio
    if (audioRef) {
      audioRef.pause();
      audioRef.src = '';
    }

    // Decode base64 to binary
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create blob and play
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setAudioRef(null);
      eventBus.emit('tts:speaking-finished', {});
      addLog('[EventBus] Speaking finished');
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      setAudioRef(null);
      eventBus.emit('tts:error', { error: 'Audio playback error' });
      addLog('[EventBus] Audio playback error');
    };

    setAudioRef(audio);
    audio.play().catch(e => {
      addLog(`[EventBus] Play error: ${e.message}`);
      eventBus.emit('tts:error', { error: e.message });
    });
  };

  // Check server status
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
  }, [getServerUrl]);

  // Status polling
  useEffect(() => {
    if (!serverRunning) return;
    const interval = setInterval(checkServerStatus, 3000);
    return () => clearInterval(interval);
  }, [serverRunning, checkServerStatus]);

  // Start server
  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting Kokoro TTS server...');

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
      workflowFolder: 'KokoroTTS',
      scriptName: 'kokoro_tts_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find kokoro_tts_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'kokoro_tts',
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
          loadVoices();
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

  // Stop server
  const stopServer = async () => {
    if (!ipcRenderer) return;

    const result = await ipcRenderer.invoke('python-stop-script-server', 'kokoro_tts');
    if (result.success) {
      addLog('Server stopped');
    } else {
      addLog('Server stop requested');
    }
    setServerRunning(false);
    setServerStatus(null);
  };

  // Load TTS model
  const loadTTS = async () => {
    if (!serverRunning) return;

    addLog('Loading Kokoro TTS model...');

    try {
      const res = await fetch(`${getServerUrl()}/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: selectedVoice })
      });

      const data = await res.json();

      if (data.success) {
        addLog(`TTS loaded on ${data.device} (VRAM: ${data.vram_used})`);
        loadVoices();
      } else {
        addLog(`Error loading TTS: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
    }
  };

  // Unload TTS model
  const unloadTTS = async () => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/unload`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        addLog('TTS model unloaded');
      }
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
    }
  };

  // Load voices
  const loadVoices = async () => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/voices`);
      const data = await res.json();

      if (data.success) {
        setVoices(data.voices);
        if (data.current_voice) {
          setSelectedVoice(data.current_voice);
        }
      }
    } catch (e: any) {
      addLog(`Error loading voices: ${e.message}`);
    }
  };

  // Set voice
  const setVoice = async (voiceId: string) => {
    setSelectedVoice(voiceId);

    if (!serverRunning || !serverStatus?.tts_ready) return;

    try {
      const res = await fetch(`${getServerUrl()}/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceId, speed })
      });

      const data = await res.json();

      if (data.success) {
        addLog(`Voice set to: ${voiceId}`);
      }
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
    }
  };

  // Synthesize test
  const synthesizeTest = async () => {
    if (!serverRunning || !serverStatus?.tts_ready || !testText.trim()) return;

    setSynthesizing(true);
    addLog(`Synthesizing: "${testText.substring(0, 50)}..."`);

    try {
      const res = await fetch(`${getServerUrl()}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          voice: selectedVoice,
          speed
        })
      });

      const data = await res.json();

      if (data.success && data.audio_b64) {
        playAudio(data.audio_b64);
        addLog('Playback started');
      } else {
        addLog(`Error: ${data.error || 'Synthesis failed'}`);
      }
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
    } finally {
      setSynthesizing(false);
    }
  };

  // Play audio from base64
  const playAudio = (base64Audio: string) => {
    // Stop any existing audio
    if (audioRef) {
      audioRef.pause();
      audioRef.src = '';
    }

    // Decode base64 to binary
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create blob and play
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setAudioRef(null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      setAudioRef(null);
      addLog('Audio playback error');
    };

    setAudioRef(audio);
    audio.play().catch(e => addLog(`Play error: ${e.message}`));
  };

  // Stop audio
  const stopAudio = async () => {
    if (audioRef) {
      audioRef.pause();
      audioRef.src = '';
      setAudioRef(null);
    }

    // Also tell server to stop if synthesizing
    if (serverRunning) {
      try {
        await fetch(`${getServerUrl()}/stop`, { method: 'POST' });
      } catch {}
    }

    addLog('Audio stopped');
  };

  // Format bytes
  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    return `${bytes} B`;
  };

  // Check if all deps are installed
  const allDepsInstalled = REQUIRED_PACKAGES.every(pkg => depsStatus[pkg]?.installed);
  const missingDepsCount = REQUIRED_PACKAGES.filter(pkg => !depsStatus[pkg]?.installed).length;

  return (
    <div className="flex flex-col h-full text-white font-sans bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-slate-900/50 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-lg bg-gradient-to-br from-pink-500 to-orange-500 shadow-pink-500/30">
            TTS
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-50">Kokoro TTS</h1>
            <p className="text-xs text-slate-400">Text-to-Speech Service</p>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-4 text-xs">
          {serverStatus?.vram && (
            <div className="text-slate-400">
              VRAM: {formatBytes(serverStatus.vram.used)} / {formatBytes(serverStatus.vram.total)}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-slate-400">TTS:</span>
            {serverStatus?.tts_ready ? (
              <span className="px-2 py-0.5 text-xs rounded bg-green-500/20 text-green-400">Ready</span>
            ) : serverStatus?.tts_loading ? (
              <span className="px-2 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400">Loading...</span>
            ) : (
              <span className="px-2 py-0.5 text-xs rounded bg-slate-500/20 text-slate-400">Not Loaded</span>
            )}
          </div>
          {serverStatus?.is_speaking && (
            <span className="px-2 py-0.5 text-xs rounded animate-pulse bg-blue-500/20 text-blue-400">Speaking...</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Setup & Voices */}
        <div className="w-1/2 p-4 border-r border-white/10 overflow-y-auto bg-black/30">
          <h2 className="text-lg font-semibold mb-4 text-slate-50">Setup</h2>

          {/* Venv Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-slate-300">Python Environment</label>
            <select
              value={selectedVenv}
              onChange={e => setSelectedVenv(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm border border-white/10 focus:outline-none focus:border-cyan-500/50 transition-all bg-slate-800 text-slate-200 disabled:opacity-50"
              disabled={serverRunning}
            >
              <option value="">Select venv...</option>
              {availableVenvs.map((v: any) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* Dependencies Panel */}
          {selectedVenv && (
            <div className="mb-4 p-3 rounded-lg border bg-slate-800/40 border-white/10">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-slate-300">Dependencies</h3>
                <div className="flex items-center gap-2">
                  {checkingDeps && <span className="text-xs text-slate-400">Checking...</span>}
                  {allDepsInstalled ? (
                    <span className="px-2 py-0.5 text-xs rounded bg-green-500/20 text-green-400">All Installed</span>
                  ) : (
                    <span className="px-2 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400">{missingDepsCount} Missing</span>
                  )}
                </div>
              </div>

              <div className="space-y-1 mb-3 max-h-32 overflow-y-auto">
                {REQUIRED_PACKAGES.map(pkg => {
                  const status = depsStatus[pkg];
                  const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];

                  return (
                    <div key={pkg} className="flex items-center justify-between text-xs py-1 px-2 rounded transition-colors">
                      <div className="flex items-center gap-2">
                        <span className={status?.installed ? 'text-green-400' : 'text-red-400'}>
                          {status?.installed ? '✓' : '✗'}
                        </span>
                        <span className="text-slate-300">{pkg}</span>
                        {status?.version && (
                          <span className="text-slate-500">{status.version}</span>
                        )}
                      </div>
                      {cudaInfo && status?.installed && (
                        <div className="flex items-center gap-2">
                          {status.hasCuda ? (
                            <span className="text-xs text-green-400">CUDA</span>
                          ) : (
                            <button
                              onClick={() => installCudaPackage(pkg)}
                              disabled={installingPackage === pkg}
                              className={`px-2 py-0.5 text-xs rounded text-white disabled:opacity-50 transition-all ${
                                installingPackage === pkg ? 'bg-slate-500' : 'bg-yellow-500/50 hover:bg-yellow-500/70'
                              }`}
                            >
                              {installingPackage === pkg ? 'Installing...' : 'Add CUDA'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!allDepsInstalled && (
                <button
                  onClick={installMissingDeps}
                  disabled={installingDeps}
                  className={`w-full px-3 py-2 rounded text-sm font-medium text-white disabled:opacity-50 transition-all shadow-sm ${
                    installingDeps ? 'bg-slate-700' : 'bg-cyan-600 hover:bg-cyan-500'
                  }`}
                >
                  {installingDeps ? `Installing ${installingPackage || ''}...` : `Install Missing (${missingDepsCount})`}
                </button>
              )}
            </div>
          )}

          {/* Port */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-slate-300">Port</label>
            <input
              type="number"
              value={serverPort}
              onChange={e => setServerPort(parseInt(e.target.value) || 8795)}
              className="w-full px-3 py-2 rounded text-sm border border-white/10 focus:outline-none transition-all bg-slate-800 text-slate-200 disabled:opacity-50"
              disabled={serverRunning}
            />
          </div>

          {/* Server Controls */}
          <div className="flex gap-2 mb-6">
            {!serverRunning ? (
              <button
                onClick={startServer}
                disabled={connecting || !selectedVenv || !allDepsInstalled}
                className={`px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50 transition-all shadow-lg ${
                  (connecting || !selectedVenv || !allDepsInstalled) ? 'bg-slate-700' : 'bg-green-600 hover:bg-green-500'
                }`}
              >
                {connecting ? 'Starting...' : 'Start Server'}
              </button>
            ) : (
              <button
                onClick={stopServer}
                className="px-4 py-2 rounded text-sm font-medium text-white transition-all shadow-lg bg-red-600 hover:bg-red-500"
              >
                Stop Server
              </button>
            )}
          </div>

          {/* TTS Controls */}
          {serverRunning && (
            <>
              <div className="flex gap-2 mb-6">
                <button
                  onClick={loadTTS}
                  disabled={serverStatus?.tts_loading || serverStatus?.tts_ready}
                  className={`px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50 transition-all shadow-lg ${
                    (serverStatus?.tts_loading || serverStatus?.tts_ready) ? 'bg-slate-700' : 'bg-pink-500 hover:bg-pink-400'
                  }`}
                >
                  {serverStatus?.tts_loading ? 'Loading...' : 'Load TTS'}
                </button>
                <button
                  onClick={unloadTTS}
                  disabled={!serverStatus?.tts_ready}
                  className={`px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50 transition-all shadow-lg ${
                    serverStatus?.tts_ready ? 'bg-slate-600 hover:bg-slate-500' : 'bg-slate-800'
                  }`}
                >
                  Unload
                </button>
              </div>

              {/* Voice Selection */}
              <h3 className="text-md font-semibold mb-3 text-slate-50">Voice Selection</h3>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {voices.map((voice: any) => (
                  <button
                    key={voice.id}
                    onClick={() => setVoice(voice.id)}
                    className={`p-2 rounded text-left text-xs text-slate-50 transition-colors border ${
                      selectedVoice === voice.id
                        ? 'bg-pink-500/30 border-pink-500'
                        : 'bg-slate-800/50 border-white/10 hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="font-medium">{voice.name}</div>
                    <div className="text-slate-400">{voice.language} {voice.gender}</div>
                  </button>
                ))}
              </div>

              {/* Speed Control */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-slate-300">
                  Speed: {speed.toFixed(1)}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={speed}
                  onChange={e => setSpeed(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Test Synthesis */}
              <h3 className="text-md font-semibold mb-3 text-slate-50">Test</h3>
              <textarea
                value={testText}
                onChange={e => setTestText(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm mb-2 h-20 resize-none border border-white/10 focus:outline-none bg-slate-800 text-slate-200"
                placeholder="Enter text to synthesize..."
              />
              <div className="flex gap-2">
                <button
                  onClick={synthesizeTest}
                  disabled={!serverStatus?.tts_ready || synthesizing || !testText.trim()}
                  className={`flex-1 px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50 transition-all shadow-lg ${
                    (!serverStatus?.tts_ready || synthesizing || !testText.trim()) ? 'bg-slate-700' : 'bg-pink-500 hover:bg-pink-400'
                  }`}
                >
                  {synthesizing ? 'Synthesizing...' : 'Speak'}
                </button>
                <button
                  onClick={stopAudio}
                  disabled={!audioRef && !serverStatus?.is_speaking}
                  className={`px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50 transition-all shadow-lg ${
                    (!audioRef && !serverStatus?.is_speaking) ? 'bg-slate-700' : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  Stop
                </button>
              </div>

              {/* API Info */}
              <div className="mt-6 p-3 rounded-lg text-xs border bg-blue-800/20 border-blue-500/30 text-blue-300">
                <strong>API Endpoints:</strong>
                <ul className="mt-1 space-y-1 text-slate-400">
                  <li>POST /synthesize - Synthesize text to speech</li>
                  <li>POST /stop - Stop current synthesis</li>
                  <li>GET /voices - List available voices</li>
                  <li>POST /voice - Set current voice</li>
                </ul>
              </div>

              {/* EventBus Info */}
              <div className="mt-3 p-3 rounded-lg text-xs border bg-purple-900/20 border-purple-500/30 text-purple-300">
                <strong>EventBus Integration:</strong>
                <div className="mt-2">
                  <div className="mb-1 text-slate-400">Listen for:</div>
                  <ul className="space-y-0.5 ml-2 text-slate-400">
                    <li>tts:speak - {'{text, voice?, speed?}'}</li>
                    <li>tts:stop - Stop speaking</li>
                    <li>tts:set-voice - {'{voice, speed?}'}</li>
                    <li>tts:get-status - Request status</li>
                  </ul>
                </div>
                <div className="mt-2">
                  <div className="mb-1 text-slate-400">Emits:</div>
                  <ul className="space-y-0.5 ml-2 text-slate-400">
                    <li>tts:ready - TTS loaded</li>
                    <li>tts:speaking-started - Started speaking</li>
                    <li>tts:speaking-finished - Done speaking</li>
                    <li>tts:status - Status response</li>
                    <li>tts:error - Error occurred</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Panel - Logs */}
        <div className="w-1/2 p-4 flex flex-col">
          <h2 className="text-lg font-semibold mb-2 text-slate-50">Logs</h2>
          <div className="flex-1 rounded-lg border overflow-y-auto p-2 bg-slate-800/50 border-white/10">
            <div className="font-mono text-xs space-y-0.5">
              {logs.map((log: any, i: any) => (
                <div key={i} className="px-1 transition-colors text-slate-300">
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
