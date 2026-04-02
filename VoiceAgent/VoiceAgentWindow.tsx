// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

/**
 * Voice-Controlled Multi-Service Agent Window
 *
 * A sophisticated voice-controlled agent system that coordinates with
 * multiple remote services and tools. Features:
 * - Real-time voice input (speech-to-text)
 * - Real-time voice output (text-to-speech)
 * - Router model for fast intent classification
 * - Three operational modes: Planning, Execution, Conversation
 * - Multi-service coordination with async job management
 * - WebSocket real-time updates
 */

interface VramStats {
  total: number;
  free: number;
  allocated: number;
  used: number;
}

interface ModelStatus {
  ready: boolean;
  loading: boolean;
  model_name?: string;
}

interface ServerStatus {
  router: ModelStatus;
  stt: ModelStatus;
  tts: ModelStatus;
  cuda_available: boolean;
  vram: VramStats | null;
  active_jobs: number;
  registered_services: number;
  current_mode: string;
  conversation_length: number;
}

interface Job {
  id: string;
  service_type: string;
  parameters: Record<string, any>;
  status: string;
  progress: number;
  description: string;
  estimated_duration?: number;
  created_at: number;
}

interface Service {
  name: string;
  service_type: string;
  base_url: string;
  port: number;
  is_available: boolean;
  capabilities: string[];
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode?: string;
  timestamp?: string;
}

// Recommended models based on spec constraints (24GB total VRAM budget)
// Router: Small model (~1-3B) for fast intent classification (~1-2GB VRAM)
// Size estimates: FP16 = ~2 bytes/param, 4-bit = ~0.5 bytes/param + overhead

const ROUTER_MODELS = [
  // GGUF models (recommended - fast CUDA inference on Windows!)
  // Using bartowski repos which have proper single-file Q4_K_M quantizations
  { label: 'Qwen2.5-3B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-3B-Instruct-GGUF', size: '~2GB', type: 'gguf' },
  { label: 'Qwen2.5-1.5B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF', size: '~1GB', type: 'gguf' },
  { label: 'Phi-3.5-mini GGUF (Q4_K_M)', value: 'bartowski/Phi-3.5-mini-instruct-GGUF', size: '~2.5GB', type: 'gguf' },
  { label: 'Llama-3.2-1B Instruct GGUF (Q4_K_M)', value: 'bartowski/Llama-3.2-1B-Instruct-GGUF', size: '~0.8GB', type: 'gguf' },
  // FP16 models (no quantization)
  { label: 'Qwen2.5-1.5B Instruct (FP16)', value: 'Qwen/Qwen2.5-1.5B-Instruct', size: '~3GB FP16', type: 'transformers' },
  { label: 'Qwen2.5-0.5B Instruct (FP16)', value: 'Qwen/Qwen2.5-0.5B-Instruct', size: '~1GB FP16', type: 'transformers' },
  { label: 'TinyLlama-1.1B (FP16)', value: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0', size: '~2.2GB FP16', type: 'transformers' },
  // Larger models (slower but smarter)
  { label: '── Larger Models (slower) ──', value: '', size: '', type: 'separator' },
  { label: 'Qwen2.5-14B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-14B-Instruct-GGUF', size: '~8.5GB', type: 'gguf' },
  { label: 'Qwen2.5-7B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-7B-Instruct-GGUF', size: '~4.5GB', type: 'gguf' },
  { label: 'Llama-3.1-8B Instruct GGUF (Q4_K_M)', value: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', size: '~5GB', type: 'gguf' },
];

// STT (Speech-to-Text) models
const STT_MODELS = [
  { label: 'Whisper Tiny (Fast)', value: 'openai/whisper-tiny', size: '~150MB' },
  { label: 'Whisper Base', value: 'openai/whisper-base', size: '~290MB' },
  { label: 'Whisper Small', value: 'openai/whisper-small', size: '~970MB' },
  { label: 'Whisper Medium', value: 'openai/whisper-medium', size: '~3GB' },
  { label: 'Whisper Large v3', value: 'openai/whisper-large-v3', size: '~6GB' },
];

// TTS (Text-to-Speech) models
const TTS_MODELS = [
  { label: 'Kokoro TTS', value: 'kokoro', size: '~82MB' },
];

const SERVICE_TYPES = [
  'music_generation', 'image_generation', 'spreadsheet', 'calendar',
  'rag', 'cad', 'document', 'chat', 'workflow'
];

// Prompt presets for quick switching
const PROMPT_PRESETS: Record<string, { name: string; description: string; prompt: string }> = {
  'general': {
    name: 'General Assistant',
    description: 'Friendly conversational assistant without any tools',
    prompt: `You are a friendly voice assistant. Have natural conversations with the user. Be helpful, concise, and engaging.

User: Hello!
Assistant: Hi there! How can I help you today?

User: What's the weather like?
Assistant: I don't have access to weather data, but I hope it's nice where you are!

User: Tell me a joke
Assistant: Why don't scientists trust atoms? Because they make up everything!

User: What's 2 plus 2?
Assistant: That's 4!

User: {user_message}
Assistant:`
  },
  'periodic_table': {
    name: 'Periodic Table',
    description: 'Can control the Periodic Table workflow',
    prompt: `You are a friendly voice assistant. You can have normal conversations about any topic. You also have access to a Periodic Table - if the user asks about a chemical element, include <TASK>select_element:SYMBOL</TASK> at the end to highlight it.

User: Hey, how are you?
Assistant: I'm doing great, thanks for asking! How can I help you today?

User: What's the weather like?
Assistant: I don't have access to weather data, but I hope it's nice where you are!

User: Tell me a joke
Assistant: Why don't scientists trust atoms? Because they make up everything!

User: What's 2 plus 2?
Assistant: That's 4!

User: Show me gold
Assistant: Gold is element 79, a beautiful yellow metal prized for jewelry and electronics!
<TASK>select_element:Au</TASK>

User: What is iron used for?
Assistant: Iron is element 26, symbol Fe. It's essential for making steel, which is used in buildings, cars, and tools. It's also vital for your blood - hemoglobin contains iron!
<TASK>select_element:Fe</TASK>

User: Tell me about hydrogen
Assistant: Hydrogen is the lightest element, number 1 on the periodic table. It makes up most of the universe and is used in fuel cells!
<TASK>select_element:H</TASK>

User: {user_message}
Assistant:`
  },
  'coding': {
    name: 'Coding Helper',
    description: 'Focused on programming and technical questions',
    prompt: `You are a helpful coding assistant. Answer programming questions concisely. Provide code examples when helpful but keep them brief for voice output.

User: Hello!
Assistant: Hi! I'm here to help with coding questions. What are you working on?

User: How do I reverse a string in Python?
Assistant: Use slicing: reversed_string = original[::-1]. Or use the reversed function with join: ''.join(reversed(original)).

User: What's a promise in JavaScript?
Assistant: A Promise is an object representing the eventual completion or failure of an async operation. You can chain .then() for success and .catch() for errors.

User: {user_message}
Assistant:`
  },
  'creative': {
    name: 'Creative Writer',
    description: 'Storytelling and creative responses',
    prompt: `You are a creative and imaginative assistant. Tell stories, create poems, and engage in creative conversation. Be expressive and entertaining.

User: Hello!
Assistant: Greetings, friend! What creative adventure shall we embark upon today?

User: Tell me a short story
Assistant: In a teacup on a windowsill lived a tiny dragon named Spark. Each morning, he'd breathe warmth into the tea, making it perfect. The old woman who owned the cup thought she just had good timing with the kettle.

User: Write a haiku about coding
Assistant: Semicolon lost, hours searching line by line, there you are, you pest.

User: {user_message}
Assistant:`
  }
};

// Required Python packages for Voice Agent
// llama-cpp-python is required for GGUF models (fast CUDA inference on Windows!)
// kokoro>=0.9.2 is needed for Kokoro TTS
const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'torch', 'transformers', 'accelerate', 'huggingface-hub', 'pyarrow', 'pandas', 'numpy', 'llama-cpp-python', 'sentencepiece', 'optimum', 'kokoro>=0.9.2', 'soundfile', 'pydub', 'scipy', 'python-multipart'];

// Packages that need special CUDA-enabled versions
const CUDA_PACKAGES: Record<string, {
  installCmd: string;
  checkCuda: (version: string) => boolean;
  getCudaVersion: (version: string) => string | null;
  requiredVersion?: string; // Exact version required (shows red if mismatch)
  requiredCudaVersion?: string; // Required CUDA version suffix (e.g., "124" for +cu124)
}> = {
  'torch': {
    // PyTorch with CUDA 12.4
    installCmd: 'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124',
    checkCuda: (version: string) => version.includes('+cu'),
    getCudaVersion: (version: string): string | null => {
      const match = version.match(/\+cu(\d+)/);
      return match ? match[1] : null;
    },
    requiredCudaVersion: '124',
  },
  'llama-cpp-python': {
    // llama-cpp-python with CUDA - required for fast GGUF inference on Windows
    // Using abetlen's cu124 wheels which have working CUDA support
    // Note: Version string doesn't include +cu suffix, CUDA support checked at runtime
    installCmd: 'llama-cpp-python==0.3.4 --no-cache-dir --force-reinstall --only-binary=:all: --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124',
    checkCuda: (_version: string) => true, // Can't detect from version, use runtime check
    getCudaVersion: (_version: string): string | null => null,
    requiredVersion: '0.3.4',
    // No requiredCudaVersion - can't detect from version string, rely on runtime check
  },
};

// Helper to normalize package names for comparison (pip normalizes dashes to underscores)
const normalizePackageName = (name: string): string => name.toLowerCase().replace(/-/g, '_');

// Parse package info from pip freeze format: "package==version" or "package @ file://..."
const parsePackageInfo = (pkgStr: string): { name: string; version?: string } => {
  // Handle @ format for local/editable installs: "package @ file://..."
  if (pkgStr.includes(' @ ')) {
    const name = pkgStr.split(' @ ')[0].trim();
    return { name, version: 'local' };
  }
  // Handle == format: "package==version"
  if (pkgStr.includes('==')) {
    const [name, version] = pkgStr.split('==');
    return { name: name.trim(), version: version?.trim() };
  }
  // Fallback: just the package name
  return { name: pkgStr.trim() };
};

// Find installed package matching a required package name
const findInstalledPackage = (installedPackages: string[], requiredPkg: string): { found: boolean; version?: string } => {
  // Strip version specifiers from required package (e.g., "kokoro>=0.9.2" -> "kokoro")
  const requiredName = normalizePackageName(requiredPkg.replace(/[<>=!].*/g, ''));

  for (const pkgStr of installedPackages) {
    const parsed = parsePackageInfo(pkgStr);
    if (normalizePackageName(parsed.name) === requiredName) {
      return { found: true, version: parsed.version };
    }
  }
  return { found: false };
};

export const VoiceAgentWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8780);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>(() => {
    try { return localStorage.getItem('voiceAgent_selectedVenv') || ''; } catch { return ''; }
  });

  // Dependency checking state
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string; hasCuda?: boolean }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null); // Track which package is being installed
  const [showDepsPanel, setShowDepsPanel] = useState(true);
  const [torchCudaAvailable, setTorchCudaAvailable] = useState<boolean | null>(null);
  const [llamaCppGpuAvailable, setLlamaCppGpuAvailable] = useState<boolean | null>(null);
  const [runtimeCudaChecked, setRuntimeCudaChecked] = useState(false); // Whether we've checked via server endpoint

  // Model selection - defaults chosen for 24GB VRAM budget (~2GB router + ~1GB voice)
  // Using GGUF models by default as they have working CUDA acceleration on Windows
  const [selectedRouterModel, setSelectedRouterModel] = useState('bartowski/Qwen2.5-3B-Instruct-GGUF');
  const [selectedSTTModel, setSelectedSTTModel] = useState('openai/whisper-base');
  const [selectedTTSModel, setSelectedTTSModel] = useState('kokoro');
  const [customRouterModel, setCustomRouterModel] = useState('');
  const [customSTTModel, setCustomSTTModel] = useState('');
  const [customTTSModel, setCustomTTSModel] = useState('');
  const [useCustomRouter, setUseCustomRouter] = useState(false);
  const [useCustomSTT, setUseCustomSTT] = useState(false);
  const [useCustomTTS, setUseCustomTTS] = useState(false);

  // Cached models browser
  const [cachedModels, setCachedModels] = useState<string[]>([]);
  const [showCachedModels, setShowCachedModels] = useState(false);
  const [loadingCachedModels, setLoadingCachedModels] = useState(false);
  const [cachedModelsFilter, setCachedModelsFilter] = useState('');

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [transcribeOnly, setTranscribeOnly] = useState(false); // Just transcribe, no agent response
  const [fastChat, setFastChat] = useState(true); // Use router model for fast responses
  const [availableMicrophones, setAvailableMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string>('');
  const [availableSpeakers, setAvailableSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>('');
  const [pushToTalkEnabled, setPushToTalkEnabled] = useState(true); // Enable spacebar push-to-talk
  const [pushToTalkKey, setPushToTalkKey] = useState('Space'); // Keybind for push-to-talk

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [streamingMessage, setStreamingMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [currentMode, setCurrentMode] = useState<string>('conversation');

  // Jobs state
  const [jobs, setJobs] = useState<Job[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState<'agent' | 'setup' | 'jobs' | 'services' | 'prompts' | 'debug'>('setup');
  const [logs, setLogs] = useState<string[]>([]);
  const [logPanelHeight, setLogPanelHeight] = useState(200);
  const [isResizingLogs, setIsResizingLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Audio state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const startRecordingRef = useRef<() => void>(() => {});
  const stopRecordingRef = useRef<() => void>(() => {});
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Prompts state (fetched from server)
  const [promptsData, setPromptsData] = useState<{
    router_examples: string;
    planning_prompt: string;
    execution_prompt: string;
    conversation_prompt: string;
    tool_definitions: any;
  } | null>(null);

  // Prompt editing state
  const [editingPrompt, setEditingPrompt] = useState<'router' | 'planning' | 'execution' | 'conversation' | null>(null);
  const [editedPromptContent, setEditedPromptContent] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [activePreset, setActivePreset] = useState<string>('periodic_table');
  const [applyingPreset, setApplyingPreset] = useState(false);

  // Debug info for Debug tab
  const [debugInfo, setDebugInfo] = useState<Array<{
    timestamp: string;
    transcription: string;
    router_output: string;
    task: string | null;
    task_result: any;
    timings: any;
  }>>([]);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-200), `[${timestamp}] ${msg}`]);
  }, []);

  // Persist selected venv to localStorage
  useEffect(() => {
    if (selectedVenv) {
      try { localStorage.setItem('voiceAgent_selectedVenv', selectedVenv); } catch {}
    }
  }, [selectedVenv]);

  // Auto-scroll
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  // Push-to-talk keyboard listener
  useEffect(() => {
    if (!pushToTalkEnabled || activeTab !== 'agent') return;

    let isKeyDown = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Check if the correct key is pressed
      if (e.code === pushToTalkKey && !isKeyDown) {
        isKeyDown = true;
        e.preventDefault();
        startRecordingRef.current();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === pushToTalkKey && isKeyDown) {
        isKeyDown = false;
        e.preventDefault();
        stopRecordingRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pushToTalkEnabled, pushToTalkKey, activeTab]);

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

  // Automatically check dependencies when venv changes
  useEffect(() => {
    const autoCheckDeps = async () => {
      if (!selectedVenv || !ipcRenderer) return;

      setCheckingDeps(true);
      setTorchCudaAvailable(null);
      setLlamaCppGpuAvailable(null);
      setRuntimeCudaChecked(false);

      try {
        const vres = await ipcRenderer.invoke('python-list-venvs');
        if (vres.success) {
          const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
          if (v && Array.isArray(v.packages) && v.packages.length >= 0) {
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

            // Check if torch has CUDA support by checking version string
            // CUDA versions have +cu in version (e.g., "2.5.0+cu121")
            // CPU versions are just "2.5.0"
            const torchVersion = map['torch']?.version || '';
            const torchHasCuda = CUDA_PACKAGES['torch'].checkCuda(torchVersion);
            setTorchCudaAvailable(torchVersion ? torchHasCuda : null);
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

  // Check CUDA status via the running server (runtime check)
  const checkRuntimeCudaStatus = async () => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/env/cuda_status`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setTorchCudaAvailable(data.torch_cuda_available);
          setLlamaCppGpuAvailable(data.llama_cpp_gpu_support);
          setRuntimeCudaChecked(true);
          addLog(`Runtime CUDA check: torch=${data.torch_cuda_available}, llama_cpp_gpu=${data.llama_cpp_gpu_support}`);
        }
      }
    } catch (e) {
      // Server not running or endpoint not available
    }
  };

  // Install a specific CUDA-enabled package
  const installCudaPackage = async (pkg: string) => {
    if (!ipcRenderer || !selectedVenv) return;

    const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
    if (!cudaInfo) {
      addLog(`No CUDA package info for ${pkg}`);
      return;
    }

    setInstallingPackage(pkg);
    addLog(`Installing ${pkg} with CUDA support...`);

    try {
      // Uninstall existing version first
      addLog(`Uninstalling existing ${pkg}...`);
      await ipcRenderer.invoke('python-uninstall-package', {
        venvName: selectedVenv,
        package: pkg.replace('>=', ' ').split(' ')[0], // Strip version specifier
      });

      // Install CUDA version
      addLog(`Installing ${cudaInfo.installCmd}...`);
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

          // Update CUDA availability based on version strings
          const torchVersion = map['torch']?.version || '';
          setTorchCudaAvailable(CUDA_PACKAGES['torch'].checkCuda(torchVersion));
        }
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setInstallingPackage(null);
    }
  };

  // Install missing dependencies (one at a time using python-install-package)
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
      // Install each package one at a time
      for (const pkg of missing) {
        addLog(`Installing ${pkg}...`);

        // Check if this package has special CUDA handling
        const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
        if (cudaInfo) {
          addLog(`Installing ${pkg} with CUDA support...`);
          const result = await ipcRenderer.invoke('python-install-package', {
            venvName: selectedVenv,
            package: cudaInfo.installCmd,
          });

          if (result.success) {
            addLog(`${pkg} (CUDA) installed`);
            setDepsStatus(prev => ({
              ...prev,
              [pkg]: { installed: true, version: undefined, hasCuda: true }
            }));
          } else {
            addLog(`ERROR installing ${pkg}: ${result.error}`);
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
          // Update status for this package
          setDepsStatus(prev => ({
            ...prev,
            [pkg]: { installed: true, version: undefined }
          }));
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

          // Update CUDA availability
          const torchVersion = map['torch']?.version || '';
          setTorchCudaAvailable(CUDA_PACKAGES['torch'].checkCuda(torchVersion));
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
        fetchJobs();
        fetchServices();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [serverRunning, checkServerStatus]);

  // Enumerate audio devices when voice is enabled
  useEffect(() => {
    if (voiceEnabled) {
      enumerateAudioDevices();
    }
  }, [voiceEnabled]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!serverRunning) return;

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);

    ws.onopen = () => {
      addLog('WebSocket connected');
      wsRef.current = ws;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'job_progress') {
          setJobs(prev => prev.map(j =>
            j.id === data.job_id ? { ...j, progress: data.progress } : j
          ));
        } else if (data.type === 'job_complete') {
          addLog(`Job ${data.job_id} completed!`);
          fetchJobs();
        }
      } catch (e) { }
    };

    ws.onclose = () => {
      addLog('WebSocket disconnected');
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
  }, [serverRunning, serverPort]);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${getServerUrl()}/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch { }
  };

  const fetchServices = async () => {
    try {
      const res = await fetch(`${getServerUrl()}/services`);
      if (res.ok) {
        const data = await res.json();
        setServices(data.services || []);
      }
    } catch { }
  };

  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting Voice Agent server...');

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
      workflowFolder: 'VoiceAgent',
      scriptName: 'voice_agent_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find voice_agent_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'voice_agent',
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

    const result = await ipcRenderer.invoke('python-stop-script-server', 'voice_agent');
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

  // Helper to determine model type from selection
  const getModelType = (modelName: string, modelList: typeof ROUTER_MODELS | typeof MAIN_MODELS): string => {
    // Check if it's a predefined model with a type
    const predefined = modelList.find(m => m.value === modelName);
    if (predefined && predefined.type) {
      return predefined.type;
    }
    // Heuristic for custom models: if it contains GGUF or ends with .gguf, it's GGUF
    if (modelName.toLowerCase().includes('gguf') || modelName.endsWith('.gguf')) {
      return 'gguf';
    }
    return 'transformers';
  };

  const loadRouterModel = async () => {
    if (!serverRunning) return;

    const modelName = useCustomRouter ? customRouterModel : selectedRouterModel;
    const modelType = getModelType(modelName, ROUTER_MODELS);
    addLog(`Loading router model: ${modelName} (${modelType})...`);

    try {
      const res = await fetch(`${getServerUrl()}/load_router`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: modelName, model_type: modelType }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Router model loaded on ${data.device} (${data.model_type || modelType})`);
        await checkServerStatus();
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const loadSTTModel = async () => {
    if (!serverRunning) return;

    const modelName = useCustomSTT ? customSTTModel : selectedSTTModel;
    addLog(`Loading STT model: ${modelName}...`);

    try {
      const res = await fetch(`${getServerUrl()}/load_stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: modelName }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`STT model loaded on ${data.device}`);
        await checkServerStatus();
      } else {
        addLog(`STT ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const loadTTSModel = async () => {
    if (!serverRunning) return;

    const modelName = useCustomTTS ? customTTSModel : selectedTTSModel;
    addLog(`Loading TTS model: ${modelName}...`);

    try {
      const res = await fetch(`${getServerUrl()}/load_tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: modelName }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`TTS model loaded on ${data.device}`);
        setVoiceEnabled(true);
        await checkServerStatus();
      } else {
        addLog(`TTS ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // State for loading all models
  const [loadingAllModels, setLoadingAllModels] = useState(false);

  // Processing state to prevent duplicate requests
  const [processingVoice, setProcessingVoice] = useState(false);

  const loadAllModels = async () => {
    if (!serverRunning) return;

    setLoadingAllModels(true);
    addLog('=== Loading all models sequentially ===');

    try {
      // 1. Load Router Model
      addLog('Step 1/3: Loading router model...');
      const routerName = useCustomRouter ? customRouterModel : selectedRouterModel;
      const routerType = getModelType(routerName, ROUTER_MODELS);
      const routerRes = await fetch(`${getServerUrl()}/load_router`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: routerName, model_type: routerType }),
      });
      const routerData = await routerRes.json();
      if (routerData.success) {
        addLog(`Router model loaded on ${routerData.device} (${routerData.model_type || routerType})`);
      } else {
        addLog(`Router ERROR: ${routerData.error}`);
      }
      await checkServerStatus();

      // 2. Load STT Model
      addLog('Step 2/3: Loading STT model...');
      const sttName = useCustomSTT ? customSTTModel : selectedSTTModel;
      const sttRes = await fetch(`${getServerUrl()}/load_stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: sttName }),
      });
      const sttData = await sttRes.json();
      if (sttData.success) {
        addLog(`STT model loaded on ${sttData.device}`);
      } else {
        addLog(`STT ERROR: ${sttData.error}`);
      }
      await checkServerStatus();

      // 3. Load TTS Model
      addLog('Step 3/3: Loading TTS model...');
      const ttsName = useCustomTTS ? customTTSModel : selectedTTSModel;
      const ttsRes = await fetch(`${getServerUrl()}/load_tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: ttsName }),
      });
      const ttsData = await ttsRes.json();
      if (ttsData.success) {
        addLog(`TTS model loaded on ${ttsData.device}`);
        setVoiceEnabled(true);
      } else {
        addLog(`TTS ERROR: ${ttsData.error}`);
      }
      await checkServerStatus();

      addLog('=== All models loaded ===');
    } catch (e: any) {
      addLog(`ERROR loading models: ${e.message}`);
    } finally {
      setLoadingAllModels(false);
    }
  };

  // Browse cached models from HuggingFace folder
  const loadCachedModels = async () => {
    if (!serverRunning) return;

    setLoadingCachedModels(true);
    addLog('Scanning HuggingFace cache for downloaded models...');

    try {
      const res = await fetch(`${getServerUrl()}/cached_models`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.models) {
          setCachedModels(data.models);
          addLog(`Found ${data.models.length} cached models`);
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

  const selectCachedModel = (modelPath: string, target: 'router' | 'stt' | 'tts') => {
    switch (target) {
      case 'router':
        setCustomRouterModel(modelPath);
        setUseCustomRouter(true);
        break;
      case 'stt':
        setCustomSTTModel(modelPath);
        setUseCustomSTT(true);
        break;
      case 'tts':
        setCustomTTSModel(modelPath);
        setUseCustomTTS(true);
        break;
    }
    setShowCachedModels(false);
    addLog(`Selected cached model for ${target}: ${modelPath}`);
  };

  const filteredCachedModels = cachedModelsFilter
    ? cachedModels.filter(m => m.toLowerCase().includes(cachedModelsFilter.toLowerCase()))
    : cachedModels;

  const unloadAllModels = async () => {
    if (!serverRunning) return;

    addLog('Unloading all models...');
    try {
      await fetch(`${getServerUrl()}/unload_all`, { method: 'POST' });
      addLog('All models unloaded');
      setVoiceEnabled(false);
      await checkServerStatus();
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // Enumerate available microphones and speakers
  const enumerateAudioDevices = async () => {
    try {
      // Request permission first to get device labels
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
      });

      const devices = await navigator.mediaDevices.enumerateDevices();

      // Get microphones (audio inputs)
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      setAvailableMicrophones(audioInputs);

      // Set default microphone if not already selected
      if (!selectedMicrophoneId && audioInputs.length > 0) {
        setSelectedMicrophoneId(audioInputs[0].deviceId);
      }

      // Get speakers (audio outputs)
      const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
      setAvailableSpeakers(audioOutputs);

      // Set default speaker if not already selected
      if (!selectedSpeakerId && audioOutputs.length > 0) {
        setSelectedSpeakerId(audioOutputs[0].deviceId);
      }
    } catch (e: any) {
      addLog(`Audio device enumeration error: ${e.message}`);
    }
  };

  // Voice recording
  const startRecording = async () => {
    try {
      // Use selected microphone or default
      const constraints: MediaStreamConstraints = {
        audio: selectedMicrophoneId
          ? { deviceId: { exact: selectedMicrophoneId } }
          : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Try to use WAV format if available, otherwise use default
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

      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          await processVoiceInput(audioBlob);
        } catch (err: any) {
          addLog(`ERROR in onstop handler: ${err.message}`);
          console.error('onstop error:', err);
        } finally {
          stream.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      addLog('Recording started...');
    } catch (e: any) {
      addLog(`Recording error: ${e.message}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      addLog('Recording stopped, processing...');
    }
  };

  // Keep refs updated for keyboard listener
  startRecordingRef.current = startRecording;
  stopRecordingRef.current = stopRecording;

  const processVoiceInput = async (audioBlob: Blob) => {
    if (!serverRunning || !serverStatus?.stt?.ready) {
      addLog('STT not ready');
      return;
    }

    if (processingVoice) {
      addLog('Already processing voice input...');
      return;
    }

    setProcessingVoice(true);

    try {
      // Send raw audio to server - let Python handle conversion (like STTWindow does)
      addLog(`Sending ${(audioBlob.size / 1024).toFixed(1)}KB audio to server...`);

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

      // Determine format from blob type
      const format = audioBlob.type.includes('webm') ? 'webm' : 'wav';

      // Use fast transcribe-only endpoint or full agent pipeline
      const endpoint = transcribeOnly ? '/transcribe' : '/agent/voice';
      const modeLabel = transcribeOnly ? 'transcribe-only' : (fastChat ? 'fast-chat' : 'full-agent');
      addLog(`Sending to server (${modeLabel}, format: ${format})...`);

      // Create abort controller for timeout (2 minutes for slow GPTQ inference)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      let res;
      try {
        res = await fetch(`${getServerUrl()}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio_b64: base64,
            sample_rate: 48000, // Browser default sample rate
            format: format,
            fast_chat: fastChat,
            skip_tts: !autoSpeak,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'No error details');
        throw new Error(`Server error: ${res.status} ${res.statusText} - ${errorText}`);
      }

      const data = await res.json();
      if (data.success) {
        addLog(`Transcribed: "${data.transcription}"`);

        // Add user message with transcription
        setMessages(prev => [...prev, {
          role: 'user',
          content: data.transcription,
          timestamp: new Date().toLocaleTimeString()
        }]);

        // Only add assistant response if using full agent mode
        if (!transcribeOnly && data.response) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.response,
            timestamp: new Date().toLocaleTimeString()
          }]);

          // Execute any tool actions from the server (e.g., select element)
          if (data.tool_actions && data.tool_actions.length > 0) {
            for (const action of data.tool_actions) {
              handleToolAction(action);
            }
          }

          // Store debug info for Debug tab
          if (data.debug) {
            setDebugInfo(prev => [...prev.slice(-20), {
              timestamp: new Date().toLocaleTimeString(),
              transcription: data.transcription,
              router_output: data.debug.router_full_output,
              task: data.debug.task,
              task_result: data.debug.task_result,
              timings: data.timings
            }]);
          }

          // Play audio response if available and autoSpeak is on
          if (data.audio_b64 && autoSpeak) {
            playAudio(data.audio_b64);
          }
        }
      } else {
        addLog(`Voice processing error: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
      console.error('Voice processing error:', e);
    } finally {
      setProcessingVoice(false);
    }
  };

  const playAudio = async (base64Audio: string) => {
    try {
      // Stop any currently playing audio
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      // Set output device if supported and selected
      if (selectedSpeakerId && 'setSinkId' in audio) {
        try {
          await (audio as any).setSinkId(selectedSpeakerId);
        } catch (e: any) {
          console.warn('Could not set audio output device:', e);
        }
      }

      setIsPlaying(true);

      audio.onended = () => {
        setIsPlaying(false);
        currentAudioRef.current = null;
        URL.revokeObjectURL(url);
      };

      audio.onerror = (e) => {
        addLog(`Audio playback error: ${audio.error?.message || 'unknown error'}`);
        console.error('Audio error:', e, audio.error);
        setIsPlaying(false);
        currentAudioRef.current = null;
        URL.revokeObjectURL(url);
      };

      addLog(`Playing audio (${(base64Audio.length / 1024).toFixed(1)}KB)...`);
      audio.play().catch(e => {
        addLog(`Audio play failed: ${e.message}`);
      });
    } catch (e: any) {
      addLog(`Audio playback error: ${e.message}`);
      setIsPlaying(false);
    }
  };

  const stopAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
      setIsPlaying(false);
      addLog('Audio stopped');
    }
  };

  // Handle tool actions from the server (e.g., EventBus events)
  const handleToolAction = (actionData: any) => {
    addLog(`Tool action: ${actionData.action}`);

    const EventBus = (window as any).EventBus;
    if (!EventBus) {
      addLog('EventBus not available');
      return;
    }

    const eventBus = EventBus.getInstance();

    switch (actionData.action) {
      case 'select_periodic_element':
        // Emit event to select element in Periodic Table workflow
        console.log('[VoiceAgent] EventBus instance:', eventBus);
        console.log('[VoiceAgent] Emitting periodic-table:select-element with:', actionData.element);
        eventBus.emit('periodic-table:select-element', actionData.element);
        addLog(`Emitted periodic-table:select-element: ${JSON.stringify(actionData.element)}`);
        break;
      case 'launch_workflow':
        // Emit event to launch a workflow
        eventBus.emit('workflow:launch', { name: actionData.workflow_name });
        addLog(`Emitted workflow:launch: ${actionData.workflow_name}`);
        break;
      default:
        addLog(`Unknown action: ${actionData.action}`);
    }
  };

  // Text chat (streaming)
  const sendMessageStreaming = async (overrideMessage?: string) => {
    const messageToSend = overrideMessage || inputMessage.trim();
    if (!serverRunning || !serverStatus?.router?.ready || !messageToSend) return;

    setInputMessage('');
    setGenerating(true);
    setStreamingMessage('');

    const userMsg: Message = {
      role: 'user',
      content: messageToSend,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages(prev => [...prev, userMsg]);

    addLog(`Sending: "${messageToSend.substring(0, 50)}..."`);

    try {
      const response = await fetch(`${getServerUrl()}/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageToSend }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let currentResponse = '';
      let mode = 'conversation';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (data.type) {
                case 'mode':
                  mode = data.mode;
                  setCurrentMode(mode);
                  break;
                case 'token':
                  // Check for action events embedded in content
                  if (data.content.includes('__ACTION__:')) {
                    const parts = data.content.split('__ACTION__:');
                    // Add non-action text to response
                    if (parts[0]) {
                      currentResponse += parts[0];
                      setStreamingMessage(currentResponse);
                    }
                    // Handle action(s)
                    for (let i = 1; i < parts.length; i++) {
                      try {
                        const actionData = JSON.parse(parts[i]);
                        handleToolAction(actionData);
                      } catch (e) {
                        console.error('Failed to parse action:', e);
                      }
                    }
                  } else {
                    currentResponse += data.content;
                    setStreamingMessage(currentResponse);
                  }
                  break;
                case 'action':
                  // Handle tool action from server
                  handleToolAction(data.action);
                  break;
                case 'debug':
                  // Store debug info
                  if (data.data) {
                    setDebugInfo((prev: typeof debugInfo) => [...prev.slice(-20), {
                      timestamp: new Date().toLocaleTimeString(),
                      transcription: messageToSend,
                      router_output: data.data.router_full_output || '',
                      task: data.data.task,
                      task_result: data.data.task_result,
                      timings: {}
                    }]);
                  }
                  break;
                case 'done':
                  addLog('Response complete');
                  break;
                case 'error':
                  addLog(`ERROR: ${data.error}`);
                  break;
              }
            } catch { }
          }
        }
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: currentResponse,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      setStreamingMessage('');

      // Auto-speak response if enabled
      if (autoSpeak && serverStatus?.tts?.ready) {
        speakText(currentResponse);
      }

    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
      setStreamingMessage('');
    } finally {
      setGenerating(false);
    }
  };

  const speakText = async (text: string) => {
    try {
      const res = await fetch(`${getServerUrl()}/synthesize?text=${encodeURIComponent(text)}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success && data.audio_b64) {
        playAudio(data.audio_b64);
      }
    } catch (e: any) {
      addLog(`TTS error: ${e.message}`);
    }
  };

  const clearConversation = async () => {
    if (serverRunning) {
      await fetch(`${getServerUrl()}/conversation/clear`, { method: 'POST' });
    }
    setMessages([]);
    addLog('Conversation cleared');
  };

  // Fetch prompts for debugging
  const fetchPrompts = async () => {
    if (!serverRunning) return;
    try {
      const res = await fetch(`${getServerUrl()}/prompts`);
      const data = await res.json();
      if (data.success) {
        setPromptsData(data);
      }
    } catch (e: any) {
      addLog(`Failed to fetch prompts: ${e.message}`);
    }
  };

  // Start editing a prompt
  const startEditingPrompt = (promptType: 'router' | 'planning' | 'execution' | 'conversation') => {
    if (!promptsData) return;
    const content = promptType === 'router' ? promptsData.router_examples
      : promptType === 'planning' ? promptsData.planning_prompt
      : promptType === 'execution' ? promptsData.execution_prompt
      : promptsData.conversation_prompt;
    setEditedPromptContent(content);
    setEditingPrompt(promptType);
  };

  // Save edited prompt
  const savePrompt = async () => {
    if (!editingPrompt || !serverRunning) return;
    setSavingPrompt(true);
    try {
      const res = await fetch(`${getServerUrl()}/prompts/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt_type: editingPrompt,
          content: editedPromptContent,
        }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`${editingPrompt} prompt updated`);
        setEditingPrompt(null);
        await fetchPrompts(); // Refresh prompts
      } else {
        addLog(`Failed to update prompt: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`Failed to save prompt: ${e.message}`);
    } finally {
      setSavingPrompt(false);
    }
  };

  // Cancel editing
  const cancelEditingPrompt = () => {
    setEditingPrompt(null);
    setEditedPromptContent('');
  };

  // Apply a prompt preset
  const applyPreset = async (presetKey: string) => {
    if (!serverRunning || applyingPreset) return;
    const preset = PROMPT_PRESETS[presetKey];
    if (!preset) return;

    setApplyingPreset(true);
    try {
      const res = await fetch(`${getServerUrl()}/prompts/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt_type: 'router',
          content: preset.prompt,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActivePreset(presetKey);
        addLog(`Switched to "${preset.name}" preset`);
        await fetchPrompts();
      } else {
        addLog(`Failed to apply preset: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`Failed to apply preset: ${e.message}`);
    } finally {
      setApplyingPreset(false);
    }
  };

  // Job management
  const cancelJob = async (jobId: string) => {
    try {
      await fetch(`${getServerUrl()}/jobs/${jobId}/cancel`, { method: 'POST' });
      addLog(`Job ${jobId} cancelled`);
      await fetchJobs();
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // Service management
  const registerMusicGenService = async () => {
    try {
      await fetch(`${getServerUrl()}/services/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'musicgen',
          service_type: 'music_generation',
          base_url: 'http://127.0.0.1',
          port: 8765,
          capabilities: ['generate', 'generate_extended']
        }),
      });
      addLog('MusicGen service registered');
      await fetchServices();
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const registerLocalChatService = async () => {
    try {
      await fetch(`${getServerUrl()}/services/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'localchat',
          service_type: 'chat',
          base_url: 'http://127.0.0.1',
          port: 8766,
          capabilities: ['chat', 'chat_stream']
        }),
      });
      addLog('LocalChat service registered');
      await fetchServices();
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // Mode badge colors and classes
  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'planning': return '#9b59b6';
      case 'execution': return '#e67e22';
      case 'conversation': return '#3498db';
      default: return '#666';
    }
  };

  const getModeClass = (mode: string) => {
    switch (mode) {
      case 'planning': return 'bg-purple-600';
      case 'execution': return 'bg-orange-500';
      case 'conversation': return 'bg-blue-500';
      default: return 'bg-slate-600';
    }
  };

  // Tailwind class helpers
  const buttonClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-blue-500 text-white text-xs flex items-center gap-1';
  const buttonRedClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-red-500 text-white text-xs flex items-center gap-1';
  const buttonPurpleClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-purple-600 text-white text-xs flex items-center gap-1';
  const buttonGreenClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-green-600 text-white text-xs flex items-center gap-1';
  const buttonOrangeClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-orange-500 text-white text-xs flex items-center gap-1';
  const buttonGrayClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-slate-700 text-white text-xs flex items-center gap-1';
  const buttonDisabledClass = 'py-1.5 px-3 border-none rounded cursor-not-allowed bg-slate-600 text-white text-xs flex items-center gap-1';
  const inputClass = 'py-1.5 px-2.5 border border-slate-700 rounded bg-[#252525] text-white text-xs';
  const sectionClass = 'bg-slate-900 rounded-lg p-3.5 mb-2.5';
  const tabClass = (isActive: boolean) =>
    `py-2 px-4 border-none cursor-pointer text-xs ${
      isActive ? 'bg-slate-900 text-white border-b-2 border-blue-500' : 'bg-transparent text-slate-500 border-b-2 border-transparent'
    }`;
  const messageClass = (role: string) =>
    `p-3 rounded-lg mb-2.5 ${role === 'user' ? 'bg-[#1e3a5f]' : 'bg-[#1a2f1a]'}`;
  const jobCardClass = 'bg-[#252525] rounded-md p-2.5 mb-2';

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0f0f0f] text-slate-200">
      {/* Header */}
      <div className="py-2.5 px-4 border-b border-[#2a2a2a] flex items-center gap-3 bg-[#161616]">
        <div>
          <h2 className="m-0 text-sm">Voice Agent</h2>
          <div className="text-[10px] text-slate-600">Multi-Service AI Assistant</div>
        </div>
        <div className="ml-auto flex items-center gap-2.5 text-[11px]">
          {serverStatus?.router?.ready && (
            <span className="text-blue-400">Router Ready</span>
          )}
          <span className={`py-0.5 px-2 rounded text-white text-[10px] uppercase ${getModeClass(currentMode)}`}>
            {currentMode}
          </span>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-[#2a2a2a] bg-[#161616]">
        <button className={tabClass(activeTab === 'setup')} onClick={() => setActiveTab('setup')}>Setup</button>
        <button className={tabClass(activeTab === 'agent')} onClick={() => setActiveTab('agent')}>Agent</button>
        <button className={tabClass(activeTab === 'jobs')} onClick={() => setActiveTab('jobs')}>Jobs ({jobs.length})</button>
        <button className={tabClass(activeTab === 'services')} onClick={() => setActiveTab('services')}>Services ({services.length})</button>
        <button className={tabClass(activeTab === 'prompts')} onClick={() => { setActiveTab('prompts'); fetchPrompts(); }}>Prompts</button>
        <button className={tabClass(activeTab === 'debug')} onClick={() => setActiveTab('debug')}>Debug ({debugInfo.length})</button>
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
                <input type="number" value={serverPort} onChange={e => setServerPort(parseInt(e.target.value) || 8780)} className={`${inputClass} w-[70px]`} disabled={serverRunning} />
                {!serverRunning ? (
                  <button onClick={startServer} disabled={connecting || !selectedVenv} className={connecting || !selectedVenv ? buttonDisabledClass : buttonClass}>
                    {connecting ? 'Connecting...' : 'Start'}
                  </button>
                ) : (
                  <button onClick={stopServer} className={buttonRedClass}>Stop</button>
                )}
              </div>
              {serverStatus?.vram && (
                <div className="mt-2 text-[10px] text-slate-500">
                  VRAM: {(serverStatus.vram.used / 1024 ** 3).toFixed(1)}GB / {(serverStatus.vram.total / 1024 ** 3).toFixed(1)}GB
                </div>
              )}
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
                        {REQUIRED_PACKAGES.map(pkg => {
                          const status = depsStatus[pkg];
                          const isCudaPkg = pkg in CUDA_PACKAGES;
                          const cudaPkgConfig = isCudaPkg ? CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES] : null;
                          const needsCudaWarning = isCudaPkg && status?.installed && status?.hasCuda === false;

                          // Check version requirements for CUDA packages
                          const installedVersion = status?.version || '';
                          const baseVersion = installedVersion.split('+')[0]; // Strip +cu suffix
                          const cudaVersion = cudaPkgConfig?.getCudaVersion(installedVersion);

                          // Version mismatch checks
                          const hasVersionMismatch = cudaPkgConfig?.requiredVersion && baseVersion !== cudaPkgConfig.requiredVersion;
                          const hasCudaVersionMismatch = cudaPkgConfig?.requiredCudaVersion && cudaVersion !== cudaPkgConfig.requiredCudaVersion;
                          const hasAnyMismatch = hasVersionMismatch || hasCudaVersionMismatch || needsCudaWarning;

                          // Determine classes based on status
                          let badgeClass = '';
                          if (!status?.installed) {
                            badgeClass = 'bg-red-900/50 border-red-500 text-red-500';
                          } else if (hasAnyMismatch) {
                            badgeClass = 'bg-red-900/50 border-red-500 text-red-500';
                          } else if (isCudaPkg && status?.hasCuda === true) {
                            badgeClass = 'bg-teal-900/50 border-green-400 text-green-400';
                          } else {
                            badgeClass = 'bg-green-900/50 border-green-400 text-green-400';
                          }

                          // Build tooltip
                          let tooltip = '';
                          if (hasVersionMismatch) {
                            tooltip = `Version mismatch: have ${baseVersion}, need ${cudaPkgConfig?.requiredVersion}`;
                          } else if (hasCudaVersionMismatch) {
                            tooltip = `CUDA version mismatch: have cu${cudaVersion || 'none'}, need cu${cudaPkgConfig?.requiredCudaVersion}`;
                          } else if (needsCudaWarning) {
                            tooltip = `${pkg} installed but no CUDA support - GPU acceleration disabled!`;
                          }

                          return (
                            <div
                              key={pkg}
                              title={tooltip || undefined}
                              className={`py-0.5 px-2 rounded text-[10px] border ${badgeClass}`}
                            >
                              {pkg} {status?.version && `(${status.version})`}
                              {hasVersionMismatch && ` ✗ need ${cudaPkgConfig?.requiredVersion}`}
                              {!hasVersionMismatch && hasCudaVersionMismatch && ` ✗ need cu${cudaPkgConfig?.requiredCudaVersion}`}
                              {!hasVersionMismatch && !hasCudaVersionMismatch && needsCudaWarning && ' ⚠️ CPU'}
                              {!hasAnyMismatch && isCudaPkg && status?.hasCuda === true && ' ✓ CUDA'}
                            </div>
                          );
                        })}
                      </div>

                      {/* CUDA Status Summary */}
                      {(torchCudaAvailable !== null || llamaCppGpuAvailable !== null) && (() => {
                        const torchVersion = depsStatus['torch']?.version || '';
                        const torchCudaVersion = CUDA_PACKAGES['torch'].getCudaVersion(torchVersion);

                        return (
                          <div className="text-[11px] mb-2.5 p-2 bg-[#252525] rounded">
                            <div className="font-bold mb-1">CUDA Status:</div>
                            <div className="flex gap-4 flex-wrap">
                              <span className={torchCudaAvailable ? 'text-green-400' : torchCudaAvailable === false ? 'text-red-500' : 'text-slate-500'}>
                                PyTorch: {torchCudaAvailable ? `✓ CUDA (cu${torchCudaVersion || '?'})` : torchCudaAvailable === false ? '✗ CPU only' : 'unknown'}
                              </span>
                              <span className={llamaCppGpuAvailable ? 'text-green-400' : llamaCppGpuAvailable === false ? 'text-yellow-500' : 'text-slate-500'}>
                                llama.cpp: {llamaCppGpuAvailable ? '✓ GPU' : llamaCppGpuAvailable === false ? '✗ CPU only' : 'unknown'}
                              </span>
                            </div>

                            {/* llama-cpp-python GPU not available - offer install */}
                            {llamaCppGpuAvailable === false && depsStatus['llama-cpp-python']?.installed && (
                              <div className="mt-2 p-2 bg-yellow-900/30 rounded border border-yellow-500">
                                <div className="text-yellow-500 font-bold mb-1">
                                  llama-cpp-python has no GPU support
                                </div>
                                <div className="text-yellow-200 text-[10px] mb-1.5">
                                  Reinstall with CUDA to enable fast GGUF model inference (~50+ tok/s).
                                </div>
                                <button
                                  onClick={() => installCudaPackage('llama-cpp-python')}
                                  disabled={installingPackage !== null}
                                  className={`${installingPackage === 'llama-cpp-python' ? buttonDisabledClass : buttonOrangeClass} text-[10px]`}
                                >
                                  {installingPackage === 'llama-cpp-python' ? 'Installing...' : 'Install llama-cpp-python with CUDA'}
                                </button>
                              </div>
                            )}

                            {serverRunning && (
                              <button
                                onClick={checkRuntimeCudaStatus}
                                className="py-0.5 px-1.5 border-none rounded cursor-pointer bg-slate-600 text-white text-[9px] mt-1.5"
                              >
                                Check Runtime CUDA
                              </button>
                            )}
                          </div>
                        );
                      })()}

                      {/* PyTorch CUDA Warning + Install Button */}
                      {depsStatus['torch']?.installed && depsStatus['torch']?.hasCuda === false && (
                        <div className="text-[11px] text-yellow-500 mb-2 p-2 bg-yellow-900/30 rounded">
                          <div className="mb-1.5">
                            ⚠️ <strong>PyTorch has no CUDA support.</strong> GPTQ models will not work correctly.
                          </div>
                          <button
                            onClick={() => installCudaPackage('torch')}
                            disabled={installingPackage !== null}
                            className={`${installingPackage === 'torch' ? buttonDisabledClass : buttonOrangeClass} text-[10px]`}
                          >
                            {installingPackage === 'torch' ? 'Installing...' : 'Install PyTorch with CUDA 12.1'}
                          </button>
                        </div>
                      )}

                      {/* Install Missing Dependencies Button */}
                      {REQUIRED_PACKAGES.some(pkg => !depsStatus[pkg]?.installed) && (
                        <button
                          onClick={installMissingDeps}
                          disabled={installingDeps || installingPackage !== null || !selectedVenv}
                          className={`${installingDeps || installingPackage !== null || !selectedVenv ? buttonDisabledClass : buttonOrangeClass} mb-2`}
                        >
                          {installingDeps ? 'Installing...' : 'Install Missing Dependencies'}
                        </button>
                      )}

                      {/* All deps installed - show status */}
                      {REQUIRED_PACKAGES.every(pkg => depsStatus[pkg]?.installed) && (
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <div className={`text-[11px] ${
                            (torchCudaAvailable && llamaCppGpuAvailable) ? 'text-green-400' :
                            (torchCudaAvailable === false || llamaCppGpuAvailable === false) ? 'text-yellow-500' : 'text-slate-400'
                          }`}>
                            All dependencies installed
                            {(torchCudaAvailable && llamaCppGpuAvailable) && ' (CUDA ready)'}
                            {(torchCudaAvailable === false || llamaCppGpuAvailable === false) && ' (CUDA packages need reinstall)'}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Router Model */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Router Model (Intent Classification)</h3>
              <div className="mb-2">
                <label className="flex items-center gap-1.5 text-[11px] mb-1.5">
                  <input type="checkbox" checked={useCustomRouter} onChange={e => setUseCustomRouter(e.target.checked)} />
                  Custom model
                </label>
                {useCustomRouter ? (
                  <input type="text" value={customRouterModel} onChange={e => setCustomRouterModel(e.target.value)} placeholder="HuggingFace model ID" className={`${inputClass} w-full`} />
                ) : (
                  <select value={selectedRouterModel} onChange={e => setSelectedRouterModel(e.target.value)} className={`${inputClass} w-full`}>
                    {ROUTER_MODELS.map(m =>
                      m.type === 'separator'
                        ? <option key={m.label} disabled className="text-slate-500">{m.label}</option>
                        : <option key={m.value} value={m.value}>{m.label} ({m.size})</option>
                    )}
                  </select>
                )}
              </div>
              <button onClick={loadRouterModel} disabled={!serverRunning || serverStatus?.router?.loading} className={!serverRunning || serverStatus?.router?.loading ? buttonDisabledClass : buttonGreenClass}>
                {serverStatus?.router?.loading ? 'Loading...' : serverStatus?.router?.ready ? 'Loaded' : 'Load Router'}
              </button>
              {serverStatus?.router?.ready && serverStatus.router.model_name && (
                <div className="mt-1.5 text-[10px] text-green-400">
                  {serverStatus.router.model_name.split('/').pop()}
                </div>
              )}
            </div>

            {/* STT Model */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Speech-to-Text (STT)</h3>
              <div className="mb-2">
                <label className="flex items-center gap-1.5 text-[11px] mb-1.5">
                  <input type="checkbox" checked={useCustomSTT} onChange={e => setUseCustomSTT(e.target.checked)} />
                  Custom model
                </label>
                {useCustomSTT ? (
                  <input type="text" value={customSTTModel} onChange={e => setCustomSTTModel(e.target.value)} placeholder="HuggingFace model ID or local path" className={`${inputClass} w-full`} />
                ) : (
                  <select value={selectedSTTModel} onChange={e => setSelectedSTTModel(e.target.value)} className={`${inputClass} w-full`}>
                    {STT_MODELS.map(m => <option key={m.value} value={m.value}>{m.label} ({m.size})</option>)}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadSTTModel} disabled={!serverRunning || serverStatus?.stt?.loading} className={serverStatus?.stt?.ready ? buttonGreenClass : (!serverRunning || serverStatus?.stt?.loading ? buttonDisabledClass : buttonPurpleClass)}>
                  {serverStatus?.stt?.loading ? 'Loading...' : serverStatus?.stt?.ready ? 'STT Loaded' : 'Load STT'}
                </button>
                {serverStatus?.stt?.ready && (
                  <span className="text-green-400 text-[10px]">Ready</span>
                )}
              </div>
            </div>

            {/* TTS Model */}
            <div className={sectionClass}>
              <h3 className="m-0 mb-2.5 text-[13px]">Text-to-Speech (TTS)</h3>
              <div className="mb-2">
                <label className="flex items-center gap-1.5 text-[11px] mb-1.5">
                  <input type="checkbox" checked={useCustomTTS} onChange={e => setUseCustomTTS(e.target.checked)} />
                  Custom model
                </label>
                {useCustomTTS ? (
                  <input type="text" value={customTTSModel} onChange={e => setCustomTTSModel(e.target.value)} placeholder="HuggingFace model ID or local path" className={`${inputClass} w-full`} />
                ) : (
                  <select value={selectedTTSModel} onChange={e => setSelectedTTSModel(e.target.value)} className={`${inputClass} w-full`}>
                    {TTS_MODELS.map(m => <option key={m.value} value={m.value}>{m.label} ({m.size})</option>)}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadTTSModel} disabled={!serverRunning || serverStatus?.tts?.loading} className={serverStatus?.tts?.ready ? buttonGreenClass : (!serverRunning || serverStatus?.tts?.loading ? buttonDisabledClass : buttonPurpleClass)}>
                  {serverStatus?.tts?.loading ? 'Loading...' : serverStatus?.tts?.ready ? 'TTS Loaded' : 'Load TTS'}
                </button>
                {serverStatus?.tts?.ready && (
                  <span className="text-green-400 text-[10px]">Ready</span>
                )}
              </div>
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
                  <div className="flex gap-2 mb-2.5">
                    <button onClick={loadCachedModels} disabled={!serverRunning || loadingCachedModels} className={!serverRunning || loadingCachedModels ? buttonDisabledClass : buttonClass}>
                      {loadingCachedModels ? 'Scanning...' : 'Scan HF Cache'}
                    </button>
                    <input
                      type="text"
                      placeholder="Filter models..."
                      value={cachedModelsFilter}
                      onChange={e => setCachedModelsFilter(e.target.value)}
                      className={`${inputClass} flex-1`}
                    />
                  </div>
                  {cachedModels.length > 0 ? (
                    <div className="max-h-[200px] overflow-auto bg-[#252525] rounded p-2">
                      {filteredCachedModels.map((model, i) => (
                        <div key={i} className="flex items-center gap-2 py-1.5 border-b border-slate-700">
                          <span className="flex-1 text-[11px] text-slate-300 break-all">{model}</span>
                          <div className="flex gap-1">
                            <button onClick={() => selectCachedModel(model, 'router')} className="py-0.5 px-1.5 border-none rounded cursor-pointer bg-green-600 text-white text-[9px]">Router</button>
                            <button onClick={() => selectCachedModel(model, 'stt')} className="py-0.5 px-1.5 border-none rounded cursor-pointer bg-purple-600 text-white text-[9px]">STT</button>
                            <button onClick={() => selectCachedModel(model, 'tts')} className="py-0.5 px-1.5 border-none rounded cursor-pointer bg-orange-500 text-white text-[9px]">TTS</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500">
                      {loadingCachedModels ? 'Scanning...' : 'Click "Scan HF Cache" to find downloaded models'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Load All / Unload All */}
            <div className={sectionClass}>
              <div className="flex gap-2.5 flex-wrap">
                <button
                  onClick={loadAllModels}
                  disabled={!serverRunning || loadingAllModels}
                  className={`${!serverRunning || loadingAllModels ? buttonDisabledClass : buttonPurpleClass} flex-1`}
                >
                  {loadingAllModels ? 'Loading All Models...' : 'Load All Models'}
                </button>
                <button onClick={unloadAllModels} disabled={!serverRunning} className={!serverRunning ? buttonDisabledClass : buttonRedClass}>
                  Unload All
                </button>
              </div>
              {loadingAllModels && (
                <div className="mt-2 text-[11px] text-purple-400">
                  Loading models sequentially (Router → STT → TTS)...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Agent Tab */}
        {activeTab === 'agent' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Voice Controls */}
            {voiceEnabled && (
              <div className="p-2 border-b border-[#2a2a2a] flex items-center gap-2.5 flex-wrap">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`${isRecording ? 'bg-red-500' : 'bg-purple-600'} py-2.5 px-5 border-none rounded cursor-pointer text-white text-xs flex items-center gap-1`}
                  title={pushToTalkEnabled ? `Keybind: ${pushToTalkKey}` : 'Keybind disabled'}
                >
                  {isRecording ? 'Stop Recording' : `Push to Talk${pushToTalkEnabled ? ` [${pushToTalkKey === 'Space' ? '␣' : pushToTalkKey}]` : ''}`}
                </button>

                {/* Push-to-Talk Keybind Toggle */}
                <label className="text-[11px] flex items-center gap-1" title="Enable spacebar as push-to-talk hotkey">
                  <input type="checkbox" checked={pushToTalkEnabled} onChange={e => setPushToTalkEnabled(e.target.checked)} />
                  Keybind
                </label>

                {/* Microphone Selection */}
                {availableMicrophones.length > 0 && (
                  <select
                    value={selectedMicrophoneId}
                    onChange={e => setSelectedMicrophoneId(e.target.value)}
                    className={`${inputClass} w-[200px] text-[11px]`}
                    title="Input device (microphone)"
                  >
                    {availableMicrophones.map(mic => (
                      <option key={mic.deviceId} value={mic.deviceId}>
                        {mic.label || `Microphone ${mic.deviceId.substring(0, 8)}`}
                      </option>
                    ))}
                  </select>
                )}

                {/* Speaker Selection */}
                {availableSpeakers.length > 0 && (
                  <select
                    value={selectedSpeakerId}
                    onChange={e => setSelectedSpeakerId(e.target.value)}
                    className={`${inputClass} w-[200px] text-[11px]`}
                    title="Output device (speaker)"
                  >
                    {availableSpeakers.map(speaker => (
                      <option key={speaker.deviceId} value={speaker.deviceId}>
                        {speaker.label || `Speaker ${speaker.deviceId.substring(0, 8)}`}
                      </option>
                    ))}
                  </select>
                )}

                <label className="text-[11px] flex items-center gap-1">
                  <input type="checkbox" checked={transcribeOnly} onChange={e => setTranscribeOnly(e.target.checked)} />
                  Transcribe only
                </label>

                <label className="text-[11px] flex items-center gap-1">
                  <input type="checkbox" checked={fastChat} onChange={e => setFastChat(e.target.checked)} />
                  Fast chat (router)
                </label>

                <label className="text-[11px] flex items-center gap-1">
                  <input type="checkbox" checked={autoSpeak} onChange={e => setAutoSpeak(e.target.checked)} />
                  Auto-speak
                </label>

                {/* Stop Audio Button */}
                {isPlaying && (
                  <button
                    onClick={stopAudio}
                    className="py-1 px-2.5 border-none rounded cursor-pointer bg-red-500 text-white text-[11px]"
                  >
                    ⏹ Stop Audio
                  </button>
                )}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-auto p-2.5">
              {messages.length === 0 ? (
                <div className="text-center text-slate-600 text-xs mt-10">
                  {serverStatus?.router?.ready ? 'Start a conversation...' : 'Load router model to begin'}
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={messageClass(msg.role)} style={msg.mode ? { borderLeft: `3px solid ${getModeColor(msg.mode)}` } : undefined}>
                    <div className="text-[10px] text-slate-400 mb-1.5 flex items-center gap-2">
                      {msg.role === 'user' ? 'You' : 'Agent'} {msg.timestamp && `• ${msg.timestamp}`}
                      {msg.mode && (
                        <span className={`py-0.5 px-1.5 rounded text-white text-[9px] ${getModeClass(msg.mode)}`}>
                          {msg.mode}
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap text-[13px]">{msg.content}</div>
                  </div>
                ))
              )}
              {streamingMessage && (
                <div className={messageClass('assistant')} style={{ borderLeft: `3px solid ${getModeColor(currentMode)}` }}>
                  <div className="text-[10px] text-slate-400 mb-1.5">Agent • typing...</div>
                  <div className="whitespace-pre-wrap text-[13px]">{streamingMessage}</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Text Input */}
            <div className="p-2.5 border-t border-[#2a2a2a] flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && !generating && sendMessageStreaming()}
                placeholder={serverStatus?.router?.ready ? "Type or use voice..." : "Load router model first"}
                className={`${inputClass} flex-1`}
                disabled={!serverStatus?.router?.ready || generating}
              />
              <button onClick={() => sendMessageStreaming()} disabled={!serverStatus?.router?.ready || generating || !inputMessage.trim()} className={!serverStatus?.router?.ready || generating || !inputMessage.trim() ? buttonDisabledClass : buttonClass}>
                {generating ? '...' : 'Send'}
              </button>
              <button onClick={clearConversation} className={buttonGrayClass}>Clear</button>
            </div>
          </div>
        )}

        {/* Jobs Tab */}
        {activeTab === 'jobs' && (
          <div className="flex-1 overflow-auto">
            {jobs.length === 0 ? (
              <div className="text-center text-slate-600 text-xs mt-10">
                No active jobs
              </div>
            ) : (
              jobs.map(job => (
                <div key={job.id} className={jobCardClass}>
                  <div className="flex justify-between mb-1.5">
                    <span className="font-medium">{job.description || job.id}</span>
                    <span className={`py-0.5 px-1.5 rounded text-white text-[10px] ${
                      job.status === 'complete' ? 'bg-green-500' : job.status === 'in_progress' ? 'bg-blue-500' : 'bg-slate-600'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mb-1">
                    {job.service_type} • ID: {job.id}
                  </div>
                  {job.status === 'in_progress' && (
                    <div className="mt-1.5">
                      <div className="h-1 bg-slate-700 rounded overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${job.progress * 100}%` }} />
                      </div>
                      <div className="text-[10px] text-slate-600 mt-1">{(job.progress * 100).toFixed(0)}%</div>
                    </div>
                  )}
                  {job.status === 'in_progress' && (
                    <button onClick={() => cancelJob(job.id)} className="py-1 px-2 mt-2 border-none rounded cursor-pointer bg-red-500 text-white text-[10px]">
                      Cancel
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Services Tab */}
        {activeTab === 'services' && (
          <div className="flex-1 overflow-auto">
            <div className={sectionClass}>
              <h4 className="m-0 mb-2.5 text-xs">Quick Register</h4>
              <div className="flex gap-2 flex-wrap">
                <button onClick={registerMusicGenService} disabled={!serverRunning} className={!serverRunning ? buttonDisabledClass : buttonPurpleClass}>
                  + MusicGen
                </button>
                <button onClick={registerLocalChatService} disabled={!serverRunning} className={!serverRunning ? buttonDisabledClass : buttonClass}>
                  + LocalChat
                </button>
              </div>
            </div>

            {services.length === 0 ? (
              <div className="text-center text-slate-600 text-xs mt-5">
                No services registered
              </div>
            ) : (
              services.map(service => (
                <div key={service.name} className={jobCardClass}>
                  <div className="flex justify-between mb-1">
                    <span className="font-medium">{service.name}</span>
                    <span className={`w-2 h-2 rounded-full ${service.is_available ? 'bg-green-500' : 'bg-red-500'}`} />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {service.service_type} • {service.base_url}:{service.port}
                  </div>
                  {service.capabilities.length > 0 && (
                    <div className="text-[10px] text-slate-600 mt-1">
                      Capabilities: {service.capabilities.join(', ')}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Prompts Tab */}
        {activeTab === 'prompts' && (
          <div className="flex-1 overflow-auto">
            {!serverRunning ? (
              <div className="text-center text-slate-600 text-xs mt-10">
                Start the server to view prompts
              </div>
            ) : !promptsData ? (
              <div className="text-center text-slate-600 text-xs mt-10">
                Loading prompts...
              </div>
            ) : editingPrompt ? (
              /* Prompt Editor */
              <div className="flex flex-col gap-3 h-full">
                <div className={sectionClass + ' flex-1 flex flex-col'}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="m-0 text-xs text-yellow-400">
                      Editing: {editingPrompt.charAt(0).toUpperCase() + editingPrompt.slice(1)} Prompt
                    </h4>
                    <div className="flex gap-2">
                      <button
                        onClick={cancelEditingPrompt}
                        className={buttonGrayClass}
                        disabled={savingPrompt}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={savePrompt}
                        className={savingPrompt ? buttonDisabledClass : buttonGreenClass}
                        disabled={savingPrompt}
                      >
                        {savingPrompt ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 mb-2">
                    Edit the prompt below. Make sure to keep the {'{user_message}'} placeholder for the router prompt.
                  </div>
                  <textarea
                    value={editedPromptContent}
                    onChange={e => setEditedPromptContent(e.target.value)}
                    className="flex-1 min-h-[400px] bg-slate-900 text-slate-200 p-3 rounded text-[11px] font-mono border border-slate-700 resize-none"
                    spellCheck={false}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Prompt Presets */}
                <div className={sectionClass}>
                  <h4 className="m-0 mb-2 text-xs text-yellow-400">Quick Presets</h4>
                  <div className="text-[10px] text-slate-500 mb-2">
                    Switch between different assistant personalities instantly
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(PROMPT_PRESETS).map(([key, preset]) => (
                      <button
                        key={key}
                        onClick={() => applyPreset(key)}
                        disabled={applyingPreset}
                        className={`py-1.5 px-3 border-none rounded cursor-pointer text-xs transition-all ${
                          activePreset === key
                            ? 'bg-green-600 text-white ring-2 ring-green-400'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        } ${applyingPreset ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={preset.description}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                  {activePreset && PROMPT_PRESETS[activePreset] && (
                    <div className="mt-2 text-[10px] text-slate-400">
                      Active: <span className="text-green-400">{PROMPT_PRESETS[activePreset].name}</span> - {PROMPT_PRESETS[activePreset].description}
                    </div>
                  )}
                </div>

                {/* Current State */}
                <div className={sectionClass}>
                  <h4 className="m-0 mb-2 text-xs text-blue-400">Current State</h4>
                  <pre className="bg-slate-900 p-2 rounded text-[11px] overflow-auto max-h-[100px] m-0 whitespace-pre-wrap break-words">
                    {JSON.stringify(promptsData.current_state, null, 2)}
                  </pre>
                </div>

                {/* Router Examples */}
                <div className={sectionClass}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="m-0 text-xs text-red-400">Router Prompt (Main)</h4>
                    <button onClick={() => startEditingPrompt('router')} className={buttonOrangeClass}>
                      Edit
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-500 mb-1.5">
                    This is the main prompt that controls the assistant's behavior and tool usage
                  </div>
                  <pre className="bg-slate-900 p-2 rounded text-[10px] overflow-auto max-h-[300px] m-0 whitespace-pre-wrap break-words">
                    {promptsData.router_examples}
                  </pre>
                </div>

                {/* Tool Definitions */}
                <div className={sectionClass}>
                  <h4 className="m-0 mb-2 text-xs text-green-400">Tool Definitions</h4>
                  <div className="text-[10px] text-slate-500 mb-1.5">
                    Available tools for execution mode
                  </div>
                  <pre className="bg-slate-900 p-2 rounded text-[10px] overflow-auto max-h-[200px] m-0 whitespace-pre-wrap break-words">
                    {JSON.stringify(promptsData.tool_definitions, null, 2)}
                  </pre>
                </div>

                {/* Planning Prompt */}
                <div className={sectionClass}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="m-0 text-xs text-purple-400">Planning Mode System Prompt</h4>
                    <button onClick={() => startEditingPrompt('planning')} className={buttonOrangeClass}>
                      Edit
                    </button>
                  </div>
                  <pre className="bg-slate-900 p-2 rounded text-[10px] overflow-auto max-h-[200px] m-0 whitespace-pre-wrap break-words">
                    {promptsData.planning_prompt}
                  </pre>
                </div>

                {/* Execution Prompt */}
                <div className={sectionClass}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="m-0 text-xs text-orange-400">Execution Mode System Prompt</h4>
                    <button onClick={() => startEditingPrompt('execution')} className={buttonOrangeClass}>
                      Edit
                    </button>
                  </div>
                  <pre className="bg-slate-900 p-2 rounded text-[10px] overflow-auto max-h-[200px] m-0 whitespace-pre-wrap break-words">
                    {promptsData.execution_prompt}
                  </pre>
                </div>

                {/* Conversation Prompt */}
                <div className={sectionClass}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="m-0 text-xs text-teal-400">Conversation Mode System Prompt</h4>
                    <button onClick={() => startEditingPrompt('conversation')} className={buttonOrangeClass}>
                      Edit
                    </button>
                  </div>
                  <pre className="bg-slate-900 p-2 rounded text-[10px] overflow-auto max-h-[200px] m-0 whitespace-pre-wrap break-words">
                    {promptsData.conversation_prompt}
                  </pre>
                </div>

                {/* Refresh Button */}
                <button
                  onClick={fetchPrompts}
                  className={`${buttonClass} self-start`}
                >
                  Refresh Prompts
                </button>
              </div>
            )}
          </div>
        )}

        {/* Debug Tab */}
        {activeTab === 'debug' && (
          <div className="flex-1 overflow-auto">
            <div className="flex justify-between items-center mb-2.5">
              <h4 className="m-0 text-xs text-red-400">Model Debug Output</h4>
              <button
                onClick={() => setDebugInfo([])}
                className="py-1 px-2 border-none rounded cursor-pointer bg-slate-700 text-white text-[10px]"
              >
                Clear
              </button>
            </div>

            {debugInfo.length === 0 ? (
              <div className="text-center text-slate-600 text-xs mt-10">
                No debug info yet. Speak or type to see model outputs.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {debugInfo.map((info: typeof debugInfo[number], idx: number) => (
                  <div key={idx} className="bg-slate-900 rounded-lg p-3.5">
                    {/* Header */}
                    <div className="flex justify-between mb-2">
                      <span className="text-[11px] text-slate-500">{info.timestamp}</span>
                      <span className="text-[10px] text-slate-600">
                        Router: {info.timings?.router?.toFixed(0) || '?'}ms
                        {info.task && ` | Task: ${info.timings?.task?.toFixed(0) || '?'}ms`}
                      </span>
                    </div>

                    {/* User Input */}
                    <div className="mb-2">
                      <div className="text-[10px] text-blue-400 mb-0.5">User:</div>
                      <div className="text-[11px] text-white">{info.transcription}</div>
                    </div>

                    {/* Router Full Output */}
                    <div className="mb-2">
                      <div className="text-[10px] text-green-400 mb-0.5">Router Output (full):</div>
                      <pre className="bg-black p-1.5 rounded text-[10px] m-0 whitespace-pre-wrap break-words max-h-[150px] overflow-auto">
                        {info.router_output || '(empty)'}
                      </pre>
                    </div>

                    {/* Task (if any) */}
                    {info.task && (
                      <div className="mb-2">
                        <div className="text-[10px] text-orange-400 mb-0.5">Task Detected:</div>
                        <code className="bg-black py-1 px-2 rounded text-[11px]">
                          {info.task}
                        </code>
                      </div>
                    )}

                    {/* Task Result (if any) */}
                    {info.task_result && (
                      <div>
                        <div className="text-[10px] text-purple-400 mb-0.5">Task Result:</div>
                        <pre className="bg-black p-1.5 rounded text-[10px] m-0 whitespace-pre-wrap break-words max-h-[100px] overflow-auto">
                          {JSON.stringify(info.task_result, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resizable Logs Panel */}
      <div className="border-t border-[#2a2a2a] flex flex-col min-h-[60px] max-h-[500px]" style={{ height: `${logPanelHeight}px` }}>
        {/* Resize Handle */}
        <div
          className="h-1.5 bg-slate-900 cursor-ns-resize flex items-center justify-center"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingLogs(true);
            const startY = e.clientY;
            const startHeight = logPanelHeight;

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const deltaY = startY - moveEvent.clientY;
              const newHeight = Math.min(500, Math.max(60, startHeight + deltaY));
              setLogPanelHeight(newHeight);
            };

            const handleMouseUp = () => {
              setIsResizingLogs(false);
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        >
          <div className="w-10 h-[3px] bg-slate-600 rounded" />
        </div>

        {/* Logs Header */}
        <div className="py-1 px-2.5 border-b border-[#2a2a2a] flex justify-between items-center bg-[#161616]">
          <span className="text-[10px] text-slate-500">Logs ({logs.length})</span>
          <div className="flex gap-2 items-center">
            <span className="text-[9px] text-slate-600">{logPanelHeight}px</span>
            <button
              onClick={() => setLogPanelHeight(Math.min(500, logPanelHeight + 100))}
              className="bg-transparent border-none text-slate-600 text-[11px] cursor-pointer px-1"
              title="Expand"
            >
              ▲
            </button>
            <button
              onClick={() => setLogPanelHeight(Math.max(60, logPanelHeight - 100))}
              className="bg-transparent border-none text-slate-600 text-[11px] cursor-pointer px-1"
              title="Shrink"
            >
              ▼
            </button>
            <button onClick={() => setLogs([])} className="bg-transparent border-none text-slate-600 text-[9px] cursor-pointer">Clear</button>
          </div>
        </div>

        {/* Logs Content */}
        <div className="flex-1 overflow-auto py-1.5 px-2.5 text-[11px] font-mono bg-[#0a0a0a] leading-relaxed">
          {logs.map((log, i) => (
            <div key={i} className={`mb-0.5 ${log.includes('ERROR') ? 'text-red-500' : log.includes('Ready') || log.includes('loaded') || log.includes('success') ? 'text-green-400' : 'text-slate-400'}`}>
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
