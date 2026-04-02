// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

/**
 * Speech-to-Text (STT) Window
 *
 * A real-time speech transcription tool using Whisper models.
 * Features:
 * - Real-time microphone recording and transcription
 * - Multiple Whisper model sizes (tiny, base, small, medium, large)
 * - File upload support for batch transcription
 * - Language selection and translation support
 * - Transcription history with export
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
  cuda_available: boolean;
  vram: VramStats | null;
  transcription_count: number;
}

interface TranscriptionResult {
  transcription: string;
  processing_time: number;
  audio_duration: number;
  model: string;
  language?: string;
  task?: string;
}

interface HistoryItem {
  timestamp: string;
  transcription: string;
  audio_duration: number;
  processing_time: number;
  filename?: string;
}

// Available Whisper models
const WHISPER_MODELS = [
  { label: 'Whisper Tiny (Fast, ~150MB)', value: 'openai/whisper-tiny', size: '~150MB' },
  { label: 'Whisper Base (~290MB)', value: 'openai/whisper-base', size: '~290MB' },
  { label: 'Whisper Small (~970MB)', value: 'openai/whisper-small', size: '~970MB' },
  { label: 'Whisper Medium (~3GB)', value: 'openai/whisper-medium', size: '~3GB' },
  { label: 'Whisper Large v3 (~6GB)', value: 'openai/whisper-large-v3', size: '~6GB' },
];

// Supported languages for Whisper
const LANGUAGES = [
  { label: 'Auto-detect', value: '' },
  { label: 'English', value: 'en' },
  { label: 'Spanish', value: 'es' },
  { label: 'French', value: 'fr' },
  { label: 'German', value: 'de' },
  { label: 'Italian', value: 'it' },
  { label: 'Portuguese', value: 'pt' },
  { label: 'Dutch', value: 'nl' },
  { label: 'Russian', value: 'ru' },
  { label: 'Chinese', value: 'zh' },
  { label: 'Japanese', value: 'ja' },
  { label: 'Korean', value: 'ko' },
];

// Required Python packages
const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'torch', 'transformers', 'accelerate', 'huggingface-hub', 'numpy', 'soundfile', 'python-multipart', 'pydub', 'scipy'];

export const STTWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8782);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>(() => {
    try { return localStorage.getItem('stt_selectedVenv') || ''; } catch { return ''; }
  });

  // Dependency checking state
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [showDepsPanel, setShowDepsPanel] = useState(true);

  // Model selection
  const [selectedModel, setSelectedModel] = useState('openai/whisper-base');
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [useFp16, setUseFp16] = useState(true);

  // Cached models browser
  const [cachedModels, setCachedModels] = useState<string[]>([]);
  const [showCachedModels, setShowCachedModels] = useState(false);
  const [loadingCachedModels, setLoadingCachedModels] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [availableMicrophones, setAvailableMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string>('');

  // Transcription state
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [selectedTask, setSelectedTask] = useState<'transcribe' | 'translate'>('transcribe');
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState<'transcribe' | 'history' | 'setup'>('setup');
  const [logs, setLogs] = useState<string[]>([]);
  const [logPanelHeight, setLogPanelHeight] = useState(200);
  const [isDraggingLogPanel, setIsDraggingLogPanel] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Audio state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingAudioRef = useRef<Blob | null>(null);

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

  // Hotkey for recording (Space or R key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Space or R key to toggle recording
      if (e.code === 'Space' || e.key === 'r' || e.key === 'R') {
        // Only work when server and model are ready
        if (!serverRunning || !serverStatus?.model_ready) return;

        e.preventDefault();
        if (isRecording) {
          stopRecording();
        } else {
          startRecording();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, serverRunning, serverStatus?.model_ready]);

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

  // Load available venvs
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

  // Save selected venv to localStorage
  useEffect(() => {
    if (selectedVenv) {
      try { localStorage.setItem('stt_selectedVenv', selectedVenv); } catch {}
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
            package: 'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121',
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

  // Enumerate microphones
  useEffect(() => {
    enumerateMicrophones();
  }, []);

  const enumerateMicrophones = async () => {
    try {
      addLog('Requesting microphone permission...');

      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addLog('ERROR: MediaDevices API not available');
        return;
      }

      // Request permission first
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        addLog('Microphone permission granted');
      } catch (permError: any) {
        addLog(`Microphone permission denied: ${permError.message}`);
        return;
      }

      // Now enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      addLog(`Found ${devices.length} total devices`);

      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      addLog(`Found ${audioInputs.length} audio input devices`);

      // Log each device for debugging
      audioInputs.forEach((device, i) => {
        addLog(`  [${i}] ${device.label || 'Unnamed device'} (${device.deviceId.substring(0, 8)}...)`);
      });

      setAvailableMicrophones(audioInputs);

      if (!selectedMicrophoneId && audioInputs.length > 0) {
        setSelectedMicrophoneId(audioInputs[0].deviceId);
        addLog(`Selected default microphone: ${audioInputs[0].label || audioInputs[0].deviceId}`);
      }
    } catch (e: any) {
      addLog(`Microphone enumeration error: ${e.message}`);
      console.error('Microphone enumeration error:', e);
    }
  };

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
    addLog('Starting STT server...');

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
      workflowFolder: 'STT',
      scriptName: 'stt_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find stt_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'stt',
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

    const result = await ipcRenderer.invoke('python-stop-script-server', 'stt');
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
    addLog('Scanning HuggingFace cache for Whisper models...');

    try {
      const res = await fetch(`${getServerUrl()}/cached_models`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.models) {
          setCachedModels(data.models);
          addLog(`Found ${data.models.length} Whisper models in cache`);
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

  // Audio conversion helper
  const convertToWav = async (audioBlob: Blob): Promise<Blob> => {
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Create a fresh AudioContext each time to avoid state issues
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Ensure AudioContext is running
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // decodeAudioData needs a copy of the buffer as it detaches the original
    const bufferCopy = arrayBuffer.slice(0);

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioContext.decodeAudioData(bufferCopy);
    } catch (decodeError: any) {
      audioContext.close();
      throw new Error(`Failed to decode audio: ${decodeError.message}`);
    }

    const channelData = audioBuffer.getChannelData(0);

    const int16Data = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const wavBuffer = new ArrayBuffer(44 + int16Data.length * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = 1;
    const bitsPerSample = 16;

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + int16Data.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
    view.setUint16(32, numChannels * bitsPerSample / 8, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, int16Data.length * 2, true);

    const dataView = new Int16Array(wavBuffer, 44);
    dataView.set(int16Data);

    // Clean up AudioContext
    audioContext.close();

    return new Blob([wavBuffer], { type: 'audio/wav' });
  };

  // Recording functions
  const startRecording = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedMicrophoneId
          ? { deviceId: { exact: selectedMicrophoneId } }
          : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/wav')) {
        mimeType = 'audio/wav';
      } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Keep onstop simple - just create the blob and store it
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        pendingAudioRef.current = audioBlob;
      };

      mediaRecorder.start();
      setIsRecording(true);
      addLog('Recording started...');
    } catch (e: any) {
      addLog(`Recording error: ${e.message}`);
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    setIsRecording(false);
    addLog('Recording stopped, processing...');

    try {
      // Stop the recorder and wait for data
      const recorder = mediaRecorderRef.current;

      // Create a promise that resolves when onstop fires
      await new Promise<void>((resolve) => {
        const originalOnStop = recorder.onstop;
        recorder.onstop = (event) => {
          if (originalOnStop) {
            (originalOnStop as any).call(recorder, event);
          }
          resolve();
        };
        recorder.stop();
      });

      // Stop the stream tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      // Process the audio
      const audioBlob = pendingAudioRef.current;
      pendingAudioRef.current = null;

      if (audioBlob && audioBlob.size > 0) {
        addLog(`Audio blob created: ${(audioBlob.size / 1024).toFixed(1)}KB`);
        await transcribeAudio(audioBlob);
      } else {
        addLog('No audio data recorded');
      }
    } catch (e: any) {
      addLog(`ERROR stopping recording: ${e.message}`);
      console.error('Stop recording error:', e);
      // Clean up on error
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    if (!serverRunning || !serverStatus?.model_ready) {
      addLog('Model not ready');
      return;
    }

    setTranscribing(true);

    try {
      // Send raw audio to server - let Python handle conversion
      const arrayBuffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Chunked base64 encoding to avoid stack overflow
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk as any);
      }
      const base64 = btoa(binary);

      addLog(`Sending ${(audioBlob.size / 1024).toFixed(1)}KB audio to server...`);

      const res = await fetch(`${getServerUrl()}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_b64: base64,
          sample_rate: 48000, // Browser default
          format: audioBlob.type.includes('webm') ? 'webm' : 'wav',
          language: selectedLanguage || null,
          task: selectedTask,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server error: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      if (data.success) {
        addLog(`Transcribed in ${data.processing_time.toFixed(2)}s: "${data.transcription}"`);
        setCurrentTranscription(data.transcription);
        await fetchHistory();
      } else {
        addLog(`Transcription error: ${data.detail || data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
      console.error('Transcription error:', e);
    } finally {
      setTranscribing(false);
    }
  };

  // Old transcribeAudio with WAV conversion - keeping as backup
  const transcribeAudioWithWavConversion = async (audioBlob: Blob) => {
    if (!serverRunning || !serverStatus?.model_ready) {
      addLog('Model not ready');
      return;
    }

    setTranscribing(true);

    try {
      const t0 = performance.now();
      addLog(`Converting ${(audioBlob.size / 1024).toFixed(1)}KB audio...`);

      const wavBlob = await convertToWav(audioBlob);
      const convertTime = (performance.now() - t0).toFixed(0);
      addLog(`Audio converted in ${convertTime}ms (${(wavBlob.size / 1024).toFixed(1)}KB WAV)`);

      const arrayBuffer = await wavBlob.arrayBuffer();
      // Use chunked encoding to avoid stack overflow with large arrays
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk as any);
      }
      const base64 = btoa(binary);

      addLog('Sending to server for transcription...');
      const res = await fetch(`${getServerUrl()}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_b64: base64,
          sample_rate: 16000,
          format: 'wav',
          language: selectedLanguage || null,
          task: selectedTask,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      if (data.success) {
        addLog(`Transcribed in ${data.processing_time.toFixed(2)}s: "${data.transcription}"`);
        setCurrentTranscription(data.transcription);
        await fetchHistory();
      } else {
        addLog(`Transcription error: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
      console.error('Transcription error:', e);
    } finally {
      setTranscribing(false);
    }
  };

  const clearHistory = async () => {
    if (serverRunning) {
      await fetch(`${getServerUrl()}/history/clear`, { method: 'POST' });
    }
    setHistory([]);
    addLog('History cleared');
  };

  // Tailwind class helpers
  const sectionClass = 'bg-slate-900 rounded-lg p-3.5 mb-2.5';
  const buttonClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-blue-500 text-white text-xs flex items-center gap-1 hover:bg-blue-400 transition-colors';
  const inputClass = 'py-1.5 px-2.5 border border-slate-700 rounded bg-slate-800 text-white text-xs';
  const tabClass = (isActive: boolean) => `py-2 px-4 border-none cursor-pointer text-xs transition-colors ${
    isActive ? 'bg-slate-900 text-white border-b-2 border-blue-500' : 'bg-transparent text-slate-500 border-b-2 border-transparent hover:text-slate-300'
  }`;

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="py-2.5 px-4 border-b border-slate-800 flex items-center gap-3 bg-slate-900">
        <div>
          <h2 className="m-0 text-sm">Speech-to-Text</h2>
          <div className="text-[10px] text-slate-600">Whisper Transcription Service</div>
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
      <div className="flex border-b border-slate-800 bg-slate-900">
        <button className={tabClass(activeTab === 'setup')} onClick={() => setActiveTab('setup')}>Setup</button>
        <button className={tabClass(activeTab === 'transcribe')} onClick={() => setActiveTab('transcribe')}>Transcribe</button>
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
                <input type="number" value={serverPort} onChange={e => setServerPort(parseInt(e.target.value) || 8781)} className={`${inputClass} w-[70px]`} disabled={serverRunning} />
                {!serverRunning ? (
                  <button onClick={startServer} disabled={connecting || !selectedVenv} className={buttonClass}>
                    {connecting ? 'Connecting...' : 'Start'}
                  </button>
                ) : (
                  <button onClick={stopServer} className={`${buttonClass} bg-red-500 hover:bg-red-400`}>Stop</button>
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
                <span className="text-[10px] text-slate-500">{showDepsPanel ? '▼' : '▶'}</span>
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
                            className={`py-0.5 px-2 rounded text-[10px] border ${
                              depsStatus[pkg]?.installed
                                ? 'bg-green-950 border-green-500 text-green-500'
                                : 'bg-red-950 border-red-500 text-red-500'
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
              <h3 className="m-0 mb-2.5 text-[13px]">Whisper Model</h3>
              <div className="mb-2">
                <label className="flex items-center gap-1.5 text-[11px] mb-1.5">
                  <input type="checkbox" checked={useCustomModel} onChange={e => setUseCustomModel(e.target.checked)} />
                  Custom model
                </label>
                {useCustomModel ? (
                  <input type="text" value={customModel} onChange={e => setCustomModel(e.target.value)} placeholder="HuggingFace model ID" className={`${inputClass} w-full`} />
                ) : (
                  <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} className={`${inputClass} w-full`}>
                    {WHISPER_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
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
                <button onClick={unloadModel} disabled={!serverRunning} className={`${buttonClass} bg-red-500`}>Unload</button>
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
                <span className="text-[10px] text-slate-500">{showCachedModels ? '▼' : '▶'}</span>
              </div>
              {showCachedModels && (
                <div className="mt-2.5">
                  <button onClick={loadCachedModels} disabled={!serverRunning || loadingCachedModels} className={`${buttonClass} bg-blue-500`}>
                    {loadingCachedModels ? 'Scanning...' : 'Scan HF Cache'}
                  </button>
                  {cachedModels.length > 0 ? (
                    <div className="max-h-[200px] overflow-auto bg-slate-800 rounded p-2 mt-2">
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

        {/* Transcribe Tab */}
        {activeTab === 'transcribe' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Controls */}
            <div className="p-2.5 border-b border-slate-800">
              <div className="flex gap-2.5 mb-2.5 flex-wrap">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={!serverStatus?.model_ready || transcribing}
                  className={`${buttonClass} py-2.5 px-5 ${isRecording ? 'bg-red-500' : 'bg-blue-500'}`}
                >
                  {isRecording ? '⏹ Stop Recording' : '🎤 Start Recording'}
                </button>

                <select
                  value={selectedMicrophoneId}
                  onChange={e => setSelectedMicrophoneId(e.target.value)}
                  className={`${inputClass} flex-1 min-w-[150px]`}
                >
                  {availableMicrophones.length === 0 ? (
                    <option value="">No microphones found</option>
                  ) : (
                    availableMicrophones.map(mic => (
                      <option key={mic.deviceId} value={mic.deviceId}>
                        {mic.label || `Microphone ${mic.deviceId.substring(0, 8)}`}
                      </option>
                    ))
                  )}
                </select>
                <button
                  onClick={enumerateMicrophones}
                  className={`${buttonClass} bg-slate-600 py-1.5 px-2.5`}
                  title="Refresh microphone list"
                >
                  Refresh
                </button>
              </div>

              <div className="flex gap-2.5">
                <select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)} className={`${inputClass} flex-1`}>
                  {LANGUAGES.map(lang => <option key={lang.value} value={lang.value}>{lang.label}</option>)}
                </select>

                <select value={selectedTask} onChange={e => setSelectedTask(e.target.value as any)} className={`${inputClass} flex-1`}>
                  <option value="transcribe">Transcribe</option>
                  <option value="translate">Translate to English</option>
                </select>
              </div>
            </div>

            {/* Transcription Display */}
            <div className="flex-1 overflow-auto p-5">
              {transcribing ? (
                <div className="text-center text-slate-500 text-xs">
                  Transcribing...
                </div>
              ) : currentTranscription ? (
                <div className="bg-slate-900 rounded-lg p-5 text-sm leading-relaxed whitespace-pre-wrap">
                  {currentTranscription}
                </div>
              ) : (
                <div className="text-center text-slate-600 text-xs mt-10">
                  {serverStatus?.model_ready ? 'Click "Start Recording" to begin...' : 'Load a model to start'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-auto">
            <div className="p-2.5 border-b border-slate-800 flex gap-2">
              <button onClick={clearHistory} className={`${buttonClass} bg-red-500`}>Clear History</button>
            </div>

            {history.length === 0 ? (
              <div className="text-center text-slate-600 text-xs mt-10">
                No transcriptions yet
              </div>
            ) : (
              <div className="p-2.5">
                {history.slice().reverse().map((item, i) => (
                  <div key={i} className="bg-slate-900 rounded-lg p-3.5 mb-2.5">
                    <div className="text-[10px] text-slate-500 mb-2">
                      {new Date(item.timestamp).toLocaleString()} • {item.audio_duration.toFixed(1)}s audio • {item.processing_time.toFixed(2)}s processing
                      {item.filename && ` • ${item.filename}`}
                    </div>
                    <div className="text-[13px] whitespace-pre-wrap">
                      {item.transcription}
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
        <div className="py-1 px-2.5 border-b border-slate-800 flex justify-between items-center bg-slate-950">
          <span className="text-[10px] text-slate-500">Logs ({logs.length})</span>
          <button onClick={() => setLogs([])} className="bg-transparent border-none text-slate-600 text-[9px] cursor-pointer hover:text-slate-400">Clear</button>
        </div>
        <div className="flex-1 overflow-auto py-1.5 px-2.5 text-[11px] font-mono bg-black leading-snug">
          {logs.map((log, i) => (
            <div key={i} className={`mb-0.5 ${log.includes('ERROR') ? 'text-red-500' : log.includes('Ready') || log.includes('loaded') || log.includes('success') ? 'text-green-500' : 'text-slate-400'}`}>
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
