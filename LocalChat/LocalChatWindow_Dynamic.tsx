// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

// ============================================
// Interfaces
// ============================================

interface VramStats {
  total: number;
  free: number;
  allocated: number;
  used: number;
}

interface ServerStatus {
  model_ready: boolean;
  model_loading: boolean;
  model_name: string;
  cuda_available: boolean;
  vram: VramStats | null;
  error: string | null;
  chat_history_length: number;
  // RAG fields
  embed_loaded?: boolean;
  embed_ready?: boolean;
  embed_loading?: boolean;
  embed_model_name?: string;
  documents_count?: number;
  documents_indexed?: boolean;
  chunks_count?: number;
  chunk_size?: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  parentId?: string | null;
  branchId?: string;
  tokenCount?: number;  // Token count for this message
  mode?: 'chat' | 'rag';  // RAG mode indicator
  retrievedChunks?: Array<{  // RAG retrieved chunks
    text: string;
    document: string;
    similarity: number;
    index: number;
  }>;
}

interface ConversationBranch {
  id: string;
  name: string;
  rootMessageId: string;
  createdAt: string;
  messageCount: number;
}

interface SavedConversation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  branches: ConversationBranch[];
  model: string;
  systemPrompt?: string;
}

interface PackageStatus {
  installed: boolean;
  version?: string;
  hasCuda?: boolean;
}

interface DocumentInfo {
  name: string;
  char_count: number;
  indexed: boolean;
}

interface SavedEmbeddingFile {
  filename: string;
  size: number;
  modified: number;
}

// ============================================
// Constants
// ============================================

type TabType = 'setup' | 'chat' | 'history' | 'prompts' | 'rag';

const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'torch', 'transformers', 'accelerate', 'huggingface-hub', 'protobuf', 'sentencepiece', 'llama-cpp-python', 'numpy', 'pypdf', 'pymupdf'];

const CUDA_PACKAGES: Record<string, {
  installCmd: string;
  checkCuda: (version: string) => boolean;
}> = {
  'torch': {
    installCmd: 'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124',
    checkCuda: (version: string) => version.includes('+cu'),
  },
  'llama-cpp-python': {
    installCmd: 'llama-cpp-python==0.3.4 --no-cache-dir --force-reinstall --only-binary=:all: --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124',
    checkCuda: (_version: string) => true,
  },
};

const RECOMMENDED_MODELS = [
  // Transformers models
  { label: 'Phi-3 Mini (3.8B) - Transformers', value: 'microsoft/Phi-3-mini-4k-instruct', type: 'transformers', size: '~7GB' },
  { label: 'Phi-3 Small (7B) - Transformers', value: 'microsoft/Phi-3-small-8k-instruct', type: 'transformers', size: '~14GB' },
  { label: 'Qwen2.5-7B Instruct - Transformers', value: 'Qwen/Qwen2.5-7B-Instruct', type: 'transformers', size: '~14GB' },
  { label: 'Mistral-7B Instruct - Transformers', value: 'mistralai/Mistral-7B-Instruct-v0.3', type: 'transformers', size: '~14GB' },
  { label: 'TinyLlama-1.1B - Transformers', value: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0', type: 'transformers', size: '~2GB' },

  // GGUF models (quantized, lower VRAM usage)
  { label: 'Qwen2.5-3B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-3B-Instruct-GGUF', type: 'gguf', size: '~2GB' },
  { label: 'Qwen2.5-7B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-7B-Instruct-GGUF', type: 'gguf', size: '~4.5GB' },
  { label: 'Qwen2.5-14B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-14B-Instruct-GGUF', type: 'gguf', size: '~8.5GB' },
  { label: 'Llama-3.1-8B Instruct GGUF (Q4_K_M)', value: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', type: 'gguf', size: '~5GB' },
  { label: 'Phi-3.5-Mini GGUF (Q4_K_M)', value: 'bartowski/Phi-3.5-mini-instruct-GGUF', type: 'gguf', size: '~2.5GB' },
];

const EMBED_MODELS = [
  { label: 'All-MiniLM-L6-v2 (Fast, 80MB)', value: 'sentence-transformers/all-MiniLM-L6-v2' },
  { label: 'BERT Base Uncased (130MB)', value: 'bert-base-uncased' },
  { label: 'All-MPNet-Base-v2 (Best Quality, 420MB)', value: 'sentence-transformers/all-mpnet-base-v2' },
];

// Helper functions
const normalizePackageName = (name: string): string => name.toLowerCase().replace(/-/g, '_');

const parsePackageInfo = (pkgStr: string): { name: string; version?: string } => {
  if (pkgStr.includes(' @ ')) {
    const name = pkgStr.split(' @ ')[0].trim();
    return { name, version: 'local' };
  }
  if (pkgStr.includes('==')) {
    const [name, version] = pkgStr.split('==');
    return { name: name.trim(), version: version?.trim() };
  }
  const parts = pkgStr.split(' ');
  return { name: parts[0].trim(), version: parts[1]?.trim() };
};

const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generateBranchId = (): string => {
  return `branch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generateConversationId = (): string => {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const LocalChatWindow_Dynamic: React.FC = () => {
  // ============================================
  // Server connection state
  // ============================================
  const [serverPort, setServerPort] = useState(8766);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');

  // ============================================
  // Tab state
  // ============================================
  const [activeTab, setActiveTab] = useState<TabType>('setup');

  // ============================================
  // Dependency checking state
  // ============================================
  const [depsStatus, setDepsStatus] = useState<Record<string, PackageStatus>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);

  // ============================================
  // Model state
  // ============================================
  const [selectedModel, setSelectedModel] = useState('microsoft/Phi-3-mini-4k-instruct');
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [modelType, setModelType] = useState<'transformers' | 'gguf'>('transformers');
  const [device, setDevice] = useState('auto');
  const [useFp16, setUseFp16] = useState(true);
  const [useCpuOffload, setUseCpuOffload] = useState(false);

  // GGUF-specific state
  const [nGpuLayers, setNGpuLayers] = useState(-1);  // -1 = all layers on GPU
  const [nCtx, setNCtx] = useState(8192);  // Context window

  // Cached models state
  const [cachedModels, setCachedModels] = useState<string[]>([]);
  const [loadingCachedModels, setLoadingCachedModels] = useState(false);
  const [showCachedModels, setShowCachedModels] = useState(false);
  const [cachedModelsFilter, setCachedModelsFilter] = useState('');

  // ============================================
  // Chat state with branching
  // ============================================
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [useHistory, setUseHistory] = useState(true);

  // Branching state
  const [currentBranchId, setCurrentBranchId] = useState<string>('main');
  const [branches, setBranches] = useState<ConversationBranch[]>([
    { id: 'main', name: 'Main', rootMessageId: '', createdAt: new Date().toISOString(), messageCount: 0 }
  ]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');

  // ============================================
  // Conversation history state
  // ============================================
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [currentConversationName, setCurrentConversationName] = useState('New Chat');
  const [loadingConversations, setLoadingConversations] = useState(false);

  // ============================================
  // Prompts state
  // ============================================
  const [availablePrompts, setAvailablePrompts] = useState<string[]>([]);
  const [activePrompt, setActivePrompt] = useState<string>('default_system');
  const [selectedPromptToView, setSelectedPromptToView] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');

  // ============================================
  // RAG state
  // ============================================
  const [ragMode, setRagMode] = useState(false);  // Toggle between Chat/RAG
  const [embedModelLoading, setEmbedModelLoading] = useState(false);
  const [selectedEmbedModel, setSelectedEmbedModel] = useState('sentence-transformers/all-MiniLM-L6-v2');

  // Document state
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Array<{name: string, content: string, isPdf: boolean}>>([]);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);

  // RAG settings
  const [chunkSize, setChunkSize] = useState(200);
  const [ragTopK, setRagTopK] = useState(3);
  const [relevanceThreshold, setRelevanceThreshold] = useState(0.35);
  const [indexing, setIndexing] = useState(false);

  // Embeddings persistence
  const [savedEmbeddings, setSavedEmbeddings] = useState<SavedEmbeddingFile[]>([]);
  const [selectedEmbeddingFile, setSelectedEmbeddingFile] = useState('');
  const [savingEmbeddings, setSavingEmbeddings] = useState(false);
  const [loadingEmbeddings, setLoadingEmbeddings] = useState(false);

  // Retrieved chunks display state
  const [expandedChunks, setExpandedChunks] = useState<Record<string, boolean>>({});

  // ============================================
  // Generation parameters
  // ============================================
  const [temperature, setTemperature] = useState(0.7);
  const [maxNewTokens, setMaxNewTokens] = useState(512);
  const [topK, setTopK] = useState(50);
  const [topP, setTopP] = useState(0.9);
  const [useTopK, setUseTopK] = useState(true);
  const [useTopP, setUseTopP] = useState(true);

  // Streaming options
  const [useStreaming, setUseStreaming] = useState(true);
  const [currentTokenCount, setCurrentTokenCount] = useState(0);
  const [tokensPerSecond, setTokensPerSecond] = useState(0);
  const [lastGenTime, setLastGenTime] = useState(0);

  // ============================================
  // UI state
  // ============================================
  const [generating, setGenerating] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Resizable log panel
  const [logPanelHeight, setLogPanelHeight] = useState(120);
  const [isResizingLogs, setIsResizingLogs] = useState(false);

  // PDF export - use function to check window directly (avoids closure issues with dynamic loading)
  const [exportingPdf, setExportingPdf] = useState(false);
  const checkJsPdfLoaded = useCallback(() => !!(window as any).jspdf, []);

  // Quick start guide
  const [showGuide, setShowGuide] = useState(false);

  // ============================================
  // Refs
  // ============================================
  const logsEndRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
  }, []);

  // Auto-scroll logs and messages
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for Python process logs
  useEffect(() => {
    if (!ipcRenderer) return;

    const handlePythonLog = (_event: any, log: string) => {
      const trimmed = log.trim();
      if (trimmed.includes('GET /status') || trimmed.includes('GET /health')) {
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

  // Load available venvs
  useEffect(() => {
    const loadVenvs = async () => {
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke('python-list-venvs');
      if (result.success && result.venvs.length > 0) {
        const names = result.venvs.map((v: any) => v.name);
        setAvailableVenvs(names);
        if (!selectedVenv) {
          setSelectedVenv(names[0]);
        }
      }
    };
    loadVenvs();
  }, [ipcRenderer, selectedVenv]);

  const getServerUrl = () => `http://127.0.0.1:${serverPort}`;

  const checkServerStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getServerUrl()}/status`);
      if (res.ok) {
        const status = await res.json();
        setServerStatus(status);
        setServerRunning(true);

        // Refresh RAG state if documents count changed
        if (status.documents_count !== undefined && status.documents_count > 0) {
          refreshDocuments();
        }
        if (status.embed_loaded) {
          listSavedEmbeddings();
        }

        return true;
      }
    } catch {
      setServerRunning(false);
      setServerStatus(null);
    }
    return false;
  }, [serverPort]);

  // Poll server status
  useEffect(() => {
    const interval = setInterval(() => {
      if (serverRunning) {
        checkServerStatus();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [serverRunning, checkServerStatus]);

  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting Local LLM server...');

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

    // Get the script path from workflow folder
    const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
      workflowFolder: 'LocalChat',
      scriptName: 'local_llm_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find local_llm_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'local_llm',
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
          addLog('ERROR: Server failed to start within timeout. Check that fastapi and uvicorn are installed.');
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

    const result = await ipcRenderer.invoke('python-stop-script-server', 'local_llm');
    if (result.success) {
      addLog('Server stopped');
      setServerRunning(false);
      setServerStatus(null);
    } else {
      try {
        await fetch(`${getServerUrl()}/shutdown`, { method: 'POST' });
        addLog('Server shutdown requested');
      } catch {
        addLog('Server not responding - it may have already stopped');
      }
      setServerRunning(false);
      setServerStatus(null);
    }
  };

  const loadModel = async () => {
    if (!serverRunning) {
      addLog('ERROR: Server not running');
      return;
    }

    const modelToLoad = useCustomModel ? customModel : selectedModel;
    addLog(`Loading ${modelType} model: ${modelToLoad}...`);

    try {
      const payload: any = {
        model_name: modelToLoad,
        model_type: modelType,
      };

      if (modelType === 'gguf') {
        payload.n_gpu_layers = nGpuLayers;
        payload.n_ctx = nCtx;
      } else {
        payload.device = device;
        payload.use_fp16 = useFp16;
        payload.use_cpu_offload = useCpuOffload;
      }

      const res = await fetch(`${getServerUrl()}/load_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        if (modelType === 'gguf') {
          addLog(`GGUF model loaded: ${data.model_name} (GPU layers: ${data.gpu_layers}, context: ${data.context_size})`);
        } else {
          addLog(`Transformers model loaded on ${data.device}: ${data.model_name}`);
        }
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
      const res = await fetch(`${getServerUrl()}/unload_model`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog('Model unloaded');
        await checkServerStatus();
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const sendMessage = async (parentMessageId?: string, customContent?: string, overrideBranchId?: string) => {
    const messageContent = customContent || inputMessage.trim();
    if (!serverRunning || !serverStatus?.model_ready || !messageContent) {
      return;
    }

    if (!customContent) {
      setInputMessage('');
    }
    setGenerating(true);
    setCurrentTokenCount(0);
    setTokensPerSecond(0);

    // Use override branchId if provided (for new branches), otherwise use current
    const effectiveBranchId = overrideBranchId || currentBranchId;

    // Create user message with branching support
    const userMsgId = generateMessageId();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: messageContent,
      timestamp: new Date().toLocaleTimeString(),
      parentId: parentMessageId || null,
      branchId: effectiveBranchId,
    };
    setMessages(prev => [...prev, userMsg]);

    addLog(`Sending: "${messageContent.substring(0, 50)}..."`);

    // Create assistant message placeholder for streaming
    const assistantMsgId = generateMessageId();

    if (useStreaming) {
      // Streaming mode
      try {
        abortControllerRef.current = new AbortController();

        const assistantMsg: ChatMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          timestamp: new Date().toLocaleTimeString(),
          parentId: userMsgId,
          branchId: effectiveBranchId,
        };
        setMessages(prev => [...prev, assistantMsg]);

        const res = await fetch(`${getServerUrl()}/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: messageContent,
            temperature,
            max_new_tokens: maxNewTokens,
            top_k: useTopK ? topK : 0,
            top_p: useTopP ? topP : 0,
            use_history: useHistory,
            branch_id: effectiveBranchId,
          }),
          signal: abortControllerRef.current.signal,
        });

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let tokenCount = 0;
        let startTime = performance.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.slice(6));

                if (json.type === 'start') {
                  startTime = performance.now();
                } else if (json.type === 'token') {
                  fullResponse += json.content;
                  tokenCount++;

                  // Update stats
                  const elapsed = (performance.now() - startTime) / 1000;
                  if (elapsed > 0) {
                    setTokensPerSecond(tokenCount / elapsed);
                  }
                  setCurrentTokenCount(tokenCount);

                  // Update message content in place
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId ? { ...m, content: fullResponse } : m
                  ));
                } else if (json.type === 'done') {
                  const genTime = json.generation_time || ((performance.now() - startTime) / 1000);
                  setLastGenTime(genTime);

                  // Update final message with token count
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId ? { ...m, content: fullResponse, tokenCount } : m
                  ));

                  addLog(`Response: ${tokenCount} tokens in ${genTime.toFixed(1)}s (${(tokenCount / genTime).toFixed(1)} tok/s)`);
                } else if (json.type === 'error') {
                  addLog(`ERROR: ${json.error}`);
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId ? { ...m, content: `Error: ${json.error}` } : m
                  ));
                }
              } catch (parseErr) {
                // Ignore JSON parse errors for partial data
              }
            }
          }
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          addLog(`ERROR: ${e.message}`);
          setMessages(prev => prev.map(m =>
            m.id === assistantMsgId ? { ...m, content: `Error: ${e.message}` } : m
          ));
        }
      } finally {
        abortControllerRef.current = null;
        setGenerating(false);
        setEditingMessageId(null);
        setEditingMessageContent('');
      }
    } else {
      // Non-streaming mode (original behavior)
      try {
        const res = await fetch(`${getServerUrl()}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: messageContent,
            temperature,
            max_new_tokens: maxNewTokens,
            top_k: useTopK ? topK : 0,
            top_p: useTopP ? topP : 0,
            use_history: useHistory,
            branch_id: effectiveBranchId,
          }),
        });

        const data = await res.json();
        if (data.success) {
          const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: data.response,
            timestamp: new Date().toLocaleTimeString(),
            parentId: userMsgId,
            branchId: effectiveBranchId,
          };
          setMessages(prev => [...prev, assistantMsg]);
          setLastGenTime(data.generation_time);
          addLog(`Response received in ${data.generation_time.toFixed(1)}s`);
        } else {
          addLog(`ERROR: ${data.error}`);
          const errorMsg: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: `Error: ${data.error}`,
            timestamp: new Date().toLocaleTimeString(),
            parentId: userMsgId,
            branchId: effectiveBranchId,
          };
          setMessages(prev => [...prev, errorMsg]);
        }
      } catch (e: any) {
        addLog(`ERROR: ${e.message}`);
        const errorMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Error: ${e.message}`,
          timestamp: new Date().toLocaleTimeString(),
          parentId: userMsgId,
          branchId: effectiveBranchId,
        };
        setMessages(prev => [...prev, errorMsg]);
      } finally {
        setGenerating(false);
        setEditingMessageId(null);
        setEditingMessageContent('');
      }
    }
  };

  const clearHistory = async () => {
    if (!serverRunning) return;

    try {
      await fetch(`${getServerUrl()}/clear_history`, { method: 'POST' });
      setMessages([]);
      setBranches([{ id: 'main', name: 'Main', rootMessageId: '', createdAt: new Date().toISOString(), messageCount: 0 }]);
      setCurrentBranchId('main');
      addLog('Chat history cleared');
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // ============================================
  // RAG Functions
  // ============================================

  const loadEmbedModel = async () => {
    if (!serverRunning) {
      addLog('ERROR: Server not running');
      return;
    }

    setEmbedModelLoading(true);
    addLog(`Loading embedding model: ${selectedEmbedModel}...`);

    try {
      const response = await fetch(`${getServerUrl()}/embed/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: selectedEmbedModel })
      });

      const result = await response.json();

      if (result.success) {
        addLog(`✓ Embedding model loaded on ${result.device}`);
      } else {
        addLog(`ERROR: Failed to load embedding model: ${result.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setEmbedModelLoading(false);
    }
  };

  const unloadEmbedModel = async () => {
    if (!serverRunning) return;

    try {
      await fetch(`${getServerUrl()}/embed/unload`, { method: 'POST' });
      addLog('Embedding model unloaded');
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newFiles: Array<{name: string, content: string, isPdf: boolean}> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isPdf = file.name.toLowerCase().endsWith('.pdf');

      try {
        if (isPdf) {
          // Read PDF as base64
          const reader = new FileReader();
          const content = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const arrayBuffer = reader.result as ArrayBuffer;
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              for (let j = 0; j < bytes.byteLength; j++) {
                binary += String.fromCharCode(bytes[j]);
              }
              resolve(btoa(binary));
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
          });
          newFiles.push({ name: file.name, content, isPdf: true });
        } else {
          // Read text file
          const reader = new FileReader();
          const content = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsText(file);
          });
          newFiles.push({ name: file.name, content, isPdf: false });
        }
      } catch (e: any) {
        addLog(`ERROR reading ${file.name}: ${e.message}`);
      }
    }

    setSelectedFiles(prev => [...prev, ...newFiles]);
    addLog(`Selected ${newFiles.length} file(s)`);
  };

  const addDocuments = async () => {
    if (!serverRunning || selectedFiles.length === 0) return;

    setUploadingDocuments(true);

    try {
      for (const file of selectedFiles) {
        const endpoint = file.isPdf ? '/documents/add-pdf' : '/documents/add';
        const body = file.isPdf
          ? { name: file.name, pdf_base64: file.content }
          : { name: file.name, content: file.content };

        const response = await fetch(`${getServerUrl()}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const result = await response.json();

        if (result.success) {
          const sizeInfo = file.isPdf
            ? `${result.page_count} pages, ${result.char_count} chars, method: ${result.method}`
            : `${result.char_count} chars`;
          addLog(`✓ Added ${file.name} (${sizeInfo})`);
          if (result.warnings && result.warnings.length > 0) {
            addLog(`  ⚠ ${result.warnings.length} page(s) had extraction issues`);
          }
        } else {
          addLog(`ERROR adding ${file.name}: ${result.error}`);
        }
      }

      // Clear selected files and refresh document list
      setSelectedFiles([]);
      await refreshDocuments();
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setUploadingDocuments(false);
    }
  };

  const refreshDocuments = async () => {
    if (!serverRunning) return;

    try {
      const response = await fetch(`${getServerUrl()}/documents`);
      const result = await response.json();

      if (result.success) {
        setDocuments(result.documents);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const removeDocument = async (name: string) => {
    if (!serverRunning) return;

    try {
      const response = await fetch(`${getServerUrl()}/documents/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (result.success) {
        addLog(`✓ Removed ${name}`);
        await refreshDocuments();
      } else {
        addLog(`ERROR: ${result.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const clearDocuments = async () => {
    if (!serverRunning) return;

    try {
      const response = await fetch(`${getServerUrl()}/documents/clear`, {
        method: 'POST'
      });

      const result = await response.json();

      if (result.success) {
        addLog(`✓ Cleared ${result.count} document(s)`);
        await refreshDocuments();
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const indexDocuments = async () => {
    if (!serverRunning) return;

    setIndexing(true);
    addLog(`Indexing documents with chunk size ${chunkSize}...`);

    try {
      const response = await fetch(`${getServerUrl()}/documents/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunk_size: chunkSize })
      });

      const result = await response.json();

      if (result.success) {
        addLog(`✓ Indexed ${result.documents_count} documents into ${result.chunks_count} chunks`);
        await refreshDocuments();
      } else {
        addLog(`ERROR: ${result.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setIndexing(false);
    }
  };

  const unindexDocuments = async () => {
    if (!serverRunning) return;

    try {
      const response = await fetch(`${getServerUrl()}/documents/unindex`, {
        method: 'POST'
      });

      const result = await response.json();

      if (result.success) {
        addLog('✓ Cleared document index');
        await refreshDocuments();
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const saveEmbeddings = async () => {
    if (!serverRunning) return;

    const filename = prompt('Enter filename for embeddings:', 'embeddings.pkl');
    if (!filename) return;

    setSavingEmbeddings(true);

    try {
      const response = await fetch(`${getServerUrl()}/embeddings/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });

      const result = await response.json();

      if (result.success) {
        addLog(`✓ Saved embeddings to ${result.filepath}`);
        await listSavedEmbeddings();
      } else {
        addLog(`ERROR: ${result.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setSavingEmbeddings(false);
    }
  };

  const loadEmbeddingsFromFile = async () => {
    if (!serverRunning || !selectedEmbeddingFile) return;

    setLoadingEmbeddings(true);

    try {
      const response = await fetch(`${getServerUrl()}/embeddings/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: selectedEmbeddingFile })
      });

      const result = await response.json();

      if (result.success) {
        addLog(`✓ Loaded ${result.documents_count} documents, ${result.chunks_count} chunks`);
        await refreshDocuments();
      } else {
        addLog(`ERROR: ${result.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setLoadingEmbeddings(false);
    }
  };

  const listSavedEmbeddings = async () => {
    if (!serverRunning) return;

    try {
      const response = await fetch(`${getServerUrl()}/embeddings/list`);
      const result = await response.json();

      if (result.success) {
        setSavedEmbeddings(result.files);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const sendRAGQuery = async () => {
    if (!serverRunning || generating) return;

    const query = inputMessage.trim();
    if (!query) return;

    setGenerating(true);
    setInputMessage('');

    // Add user message
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
      branchId: currentBranchId,
      mode: 'rag'
    };

    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await fetch(`${getServerUrl()}/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          top_k: ragTopK,
          temperature,
          max_new_tokens: maxNewTokens,
          relevance_threshold: relevanceThreshold,
          use_rag: true,
          top_k_gen: topK,
          top_p: topP
        })
      });

      const result = await response.json();

      if (result.success) {
        const assistantMessage: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: result.response,
          timestamp: new Date().toISOString(),
          branchId: currentBranchId,
          mode: 'rag',
          retrievedChunks: result.retrieved_chunks
        };

        setMessages(prev => [...prev, assistantMessage]);

        if (result.retrieved_chunks && result.retrieved_chunks.length > 0) {
          addLog(`✓ Retrieved ${result.retrieved_chunks.length} chunks (${result.generation_time.toFixed(2)}s)`);
        } else {
          addLog(`⚠ No relevant chunks found, using general knowledge (${result.generation_time.toFixed(2)}s)`);
        }
      } else {
        addLog(`ERROR: ${result.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // ============================================
  // Dependency Checking Functions
  // ============================================

  const checkDeps = useCallback(async () => {
    if (!selectedVenv || !ipcRenderer) {
      return;
    }

    setCheckingDeps(true);
    try {
      const vres = await ipcRenderer.invoke('python-list-venvs');
      if (vres.success) {
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
              const cudaInfo = CUDA_PACKAGES[pkg];
              map[pkg] = {
                installed: true,
                version: parsed.version,
                hasCuda: cudaInfo ? cudaInfo.checkCuda(parsed.version || '') : undefined
              };
            } else {
              map[pkg] = { installed: false };
            }
          }
          setDepsStatus(map);
        }
      }
    } catch (e: any) {
      addLog(`ERROR checking deps: ${e.message}`);
    } finally {
      setCheckingDeps(false);
    }
  }, [selectedVenv, ipcRenderer, addLog]);

  const installMissingDeps = async () => {
    if (!selectedVenv || !ipcRenderer) {
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
      const hasTorch = missing.includes('torch');
      const nonTorchPackages = missing.filter(p => p !== 'torch');

      // Install non-torch packages first
      for (const pkg of nonTorchPackages) {
        addLog(`Installing ${pkg}...`);
        setInstallingPackage(pkg);
        const result = await ipcRenderer.invoke('python-install-package', {
          venvName: selectedVenv,
          package: pkg,
        });
        if (result.success) {
          addLog(`${pkg} installed`);
        } else {
          addLog(`ERROR installing ${pkg}: ${result.error}`);
        }
      }

      // Install torch with CUDA support
      if (hasTorch) {
        addLog('Installing PyTorch with CUDA support...');
        setInstallingPackage('torch');
        const torchResult = await ipcRenderer.invoke('python-install-package', {
          venvName: selectedVenv,
          package: CUDA_PACKAGES['torch'].installCmd,
        });
        if (torchResult.success) {
          addLog('PyTorch installed');
        } else {
          addLog(`ERROR installing PyTorch: ${torchResult.error}`);
        }
      }

      addLog('Dependency installation complete');
      await checkDeps();
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
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

  // ============================================
  // Cached Models Functions
  // ============================================

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
          addLog(`No cached models found: ${data.error || 'unknown'}`);
        }
      }
    } catch (e: any) {
      addLog(`ERROR scanning cache: ${e.message}`);
    } finally {
      setLoadingCachedModels(false);
    }
  };

  const filteredCachedModels = cachedModelsFilter
    ? cachedModels.filter(m => m.toLowerCase().includes(cachedModelsFilter.toLowerCase()))
    : cachedModels;

  // ============================================
  // Prompts Functions
  // ============================================

  const loadPrompts = useCallback(async () => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/prompts`);
      const data = await res.json();

      if (data.success) {
        setAvailablePrompts(data.prompts || []);
        setActivePrompt(data.active || 'default_system');
      }
    } catch (e: any) {
      addLog(`Error loading prompts: ${e.message}`);
    }
  }, [serverRunning, addLog]);

  const loadPromptContent = async (promptName: string) => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/prompts/${promptName}`);
      const data = await res.json();

      if (data.success) {
        setSelectedPromptToView(promptName);
        setPromptDraft(data.content);
      }
    } catch (e: any) {
      addLog(`Error loading prompt: ${e.message}`);
    }
  };

  const savePrompt = async (name: string, content: string) => {
    if (!serverRunning) return;

    setSavingPrompt(true);
    try {
      const res = await fetch(`${getServerUrl()}/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content })
      });

      const data = await res.json();
      if (data.success) {
        addLog(`Prompt "${name}" saved`);
        setEditingPrompt(null);
        loadPrompts();
      } else {
        addLog(`Error saving prompt: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
    } finally {
      setSavingPrompt(false);
    }
  };

  const selectActivePrompt = async (promptName: string) => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/prompts/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: promptName })
      });

      const data = await res.json();
      if (data.success) {
        setActivePrompt(promptName);
        addLog(`Active prompt set to: ${promptName}`);
      }
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
    }
  };

  // Load prompts when switching to prompts tab or when server connects
  useEffect(() => {
    if (activeTab === 'prompts' && serverRunning) {
      loadPrompts();
    }
  }, [activeTab, serverRunning, loadPrompts]);

  // ============================================
  // Chat Branching Functions
  // ============================================

  const createBranchFromMessage = (messageId: string, newContent: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.role !== 'user') return;

    // Find the index of the message being edited
    const messageIndex = messages.findIndex(m => m.id === messageId);

    // The branch point is the message BEFORE the one being edited (the last assistant message)
    // This way the edited message becomes the first message in the new branch
    const branchPointIndex = messageIndex > 0 ? messageIndex - 1 : -1;
    const branchPointId = branchPointIndex >= 0 ? messages[branchPointIndex].id : '';

    // Create a new branch
    const newBranchId = generateBranchId();
    const newBranch: ConversationBranch = {
      id: newBranchId,
      name: `Branch ${branches.length}`,
      rootMessageId: branchPointId, // Point to the message BEFORE the edit
      createdAt: new Date().toISOString(),
      messageCount: 0,
    };

    setBranches(prev => [...prev, newBranch]);
    setCurrentBranchId(newBranchId);

    // Send the new message on this branch (parent is the branch point)
    // Pass the branchId explicitly since state update is async
    sendMessage(branchPointId || undefined, newContent, newBranchId);

    addLog(`Created new branch: ${newBranch.name}`);
  };

  const getMessagesForCurrentBranch = (): ChatMessage[] => {
    if (currentBranchId === 'main') {
      return messages.filter(m => m.branchId === 'main' || !m.branchId);
    }

    // For non-main branches, get messages that belong to this branch
    // plus ancestor messages from before the branch point (inclusive)
    const branch = branches.find(b => b.id === currentBranchId);
    if (!branch) return messages;

    const branchMessages = messages.filter(m => m.branchId === currentBranchId);

    // Find the branch point message
    const rootIndex = messages.findIndex(m => m.id === branch.rootMessageId);

    if (rootIndex >= 0) {
      // Include messages up to and including the branch point
      const ancestorMessages = messages.slice(0, rootIndex + 1).filter(m => m.branchId === 'main' || !m.branchId);
      return [...ancestorMessages, ...branchMessages];
    }

    return branchMessages;
  };

  // ============================================
  // Conversation History Functions
  // ============================================

  const loadConversations = useCallback(async () => {
    if (!serverRunning) return;

    setLoadingConversations(true);
    try {
      const res = await fetch(`${getServerUrl()}/conversations`);
      const data = await res.json();

      if (data.success) {
        setSavedConversations(data.conversations || []);
      }
    } catch (e: any) {
      addLog(`Error loading conversations: ${e.message}`);
    } finally {
      setLoadingConversations(false);
    }
  }, [serverRunning, addLog]);

  const saveCurrentConversation = async () => {
    if (!serverRunning || messages.length === 0) return;

    const convId = currentConversationId || generateConversationId();
    const conversation: SavedConversation = {
      id: convId,
      name: currentConversationName,
      createdAt: currentConversationId ? savedConversations.find(c => c.id === convId)?.createdAt || new Date().toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages,
      branches,
      model: serverStatus?.model_name || '',
      systemPrompt: activePrompt,
    };

    try {
      const res = await fetch(`${getServerUrl()}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversation)
      });

      const data = await res.json();
      if (data.success) {
        setCurrentConversationId(data.id);
        addLog(`Conversation saved: ${currentConversationName}`);
        loadConversations();
      }
    } catch (e: any) {
      addLog(`Error saving conversation: ${e.message}`);
    }
  };

  const loadConversation = async (convId: string) => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/conversations/${convId}`);
      const data = await res.json();

      if (data.success && data.conversation) {
        const conv = data.conversation;
        setMessages(conv.messages || []);
        setBranches(conv.branches || [{ id: 'main', name: 'Main', rootMessageId: '', createdAt: new Date().toISOString(), messageCount: 0 }]);
        setCurrentBranchId('main');
        setCurrentConversationId(conv.id);
        setCurrentConversationName(conv.name);
        addLog(`Loaded conversation: ${conv.name}`);
        setActiveTab('chat');
      }
    } catch (e: any) {
      addLog(`Error loading conversation: ${e.message}`);
    }
  };

  const deleteConversation = async (convId: string) => {
    if (!serverRunning) return;

    try {
      const res = await fetch(`${getServerUrl()}/conversations/${convId}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (data.success) {
        addLog('Conversation deleted');
        loadConversations();
        if (currentConversationId === convId) {
          setCurrentConversationId(null);
          setCurrentConversationName('New Chat');
        }
      }
    } catch (e: any) {
      addLog(`Error deleting conversation: ${e.message}`);
    }
  };

  const startNewConversation = () => {
    setMessages([]);
    setBranches([{ id: 'main', name: 'Main', rootMessageId: '', createdAt: new Date().toISOString(), messageCount: 0 }]);
    setCurrentBranchId('main');
    setCurrentConversationId(null);
    setCurrentConversationName('New Chat');
    clearHistory();
  };

  // Load conversations when switching to history tab
  useEffect(() => {
    if (activeTab === 'history' && serverRunning) {
      loadConversations();
    }
  }, [activeTab, serverRunning, loadConversations]);

  // ============================================
  // PDF Export Functions
  // ============================================

  // Load jsPDF from CDN
  useEffect(() => {
    // Skip if already loaded
    if ((window as any).jspdf) return;

    // Add script if not already present
    if (!document.querySelector('script[src*="jspdf"]')) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      document.head.appendChild(script);
    }
  }, []);

  const exportChatToPdf = async () => {
    if (!checkJsPdfLoaded() || messages.length === 0) {
      addLog('Cannot export: jsPDF not loaded or no messages');
      return;
    }

    setExportingPdf(true);
    addLog('Generating PDF...');

    try {
      const { jsPDF } = (window as any).jspdf;
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const maxWidth = pageWidth - margin * 2;
      let yPos = margin;

      // Title
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      const title = `Chat Export - ${serverStatus?.model_name?.split('/').pop() || 'Local LLM'}`;
      pdf.text(title, margin, yPos);
      yPos += 10;

      // Timestamp
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, yPos);
      yPos += 15;

      // Messages
      pdf.setFontSize(11);
      const displayMessages = getMessagesForCurrentBranch();

      for (const msg of displayMessages) {
        // Check for page break
        if (yPos > pageHeight - margin - 20) {
          pdf.addPage();
          yPos = margin;
        }

        // Role label with color
        pdf.setFont('helvetica', 'bold');
        if (msg.role === 'user') {
          pdf.setTextColor(44, 82, 130);
        } else if (msg.role === 'assistant') {
          pdf.setTextColor(45, 55, 72);
        } else {
          pdf.setTextColor(85, 60, 154);
        }
        pdf.text(`${msg.role === 'user' ? 'You' : 'Assistant'}:`, margin, yPos);
        yPos += 6;

        // Message content
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(0, 0, 0);
        const lines = pdf.splitTextToSize(msg.content, maxWidth);

        for (const line of lines) {
          if (yPos > pageHeight - margin) {
            pdf.addPage();
            yPos = margin;
          }
          pdf.text(line, margin, yPos);
          yPos += 5;
        }

        yPos += 8;
      }

      // Save
      if (ipcRenderer) {
        const result = await ipcRenderer.invoke('show-save-dialog', {
          title: 'Save Chat as PDF',
          defaultPath: `chat_export_${Date.now()}.pdf`,
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        });

        if (!result.canceled && result.filePath) {
          const pdfArrayBuffer = pdf.output('arraybuffer');
          const pdfBytes = new Uint8Array(pdfArrayBuffer);
          let binaryString = '';
          for (let i = 0; i < pdfBytes.length; i++) {
            binaryString += String.fromCharCode(pdfBytes[i]);
          }

          await ipcRenderer.invoke('write-file', {
            filePath: result.filePath,
            content: btoa(binaryString),
            encoding: 'base64'
          });
          addLog(`PDF saved to: ${result.filePath}`);
        }
      } else {
        pdf.save(`chat_export_${Date.now()}.pdf`);
        addLog('PDF downloaded');
      }
    } catch (e: any) {
      addLog(`ERROR exporting PDF: ${e.message}`);
    } finally {
      setExportingPdf(false);
    }
  };

  // ============================================
  // Resizable Log Panel Handler
  // ============================================

  const handleLogResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLogs(true);

    const startY = e.clientY;
    const startHeight = logPanelHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.min(400, Math.max(60, startHeight + deltaY));
      setLogPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingLogs(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [logPanelHeight]);

  // Tailwind class helpers
  const sectionClass = 'bg-slate-900 p-3 rounded-md mb-2.5';
  const buttonClass = 'py-2 px-4 border-none rounded cursor-pointer bg-blue-500 text-white text-[13px]';
  const buttonRedClass = 'py-2 px-4 border-none rounded cursor-pointer bg-red-500 text-white text-[13px]';
  const buttonSmallClass = 'py-1 px-2.5 border-none rounded cursor-pointer text-[11px]';
  const buttonGrayClass = 'py-2 px-4 border-none rounded cursor-pointer bg-slate-600 text-white text-[13px]';
  const buttonDisabledClass = 'py-2 px-4 border-none rounded cursor-not-allowed bg-slate-600 text-white text-[13px] opacity-50';
  const inputClass = 'py-1.5 px-2.5 border border-slate-600 rounded bg-[#2a2a2a] text-white text-[13px] w-full';
  const sliderContainerClass = 'flex items-center gap-2.5 mb-2';
  const messageClass = (role: string) =>
    `py-2.5 px-3.5 rounded-lg mb-2 text-white text-[13px] leading-relaxed ${
      role === 'user' ? 'bg-blue-800' : role === 'assistant' ? 'bg-slate-700' : 'bg-purple-800'
    }`;
  const tabClass = (isActive: boolean) =>
    `py-2 px-4 border-none cursor-pointer text-[13px] transition-all ${
      isActive ? 'bg-[#2a2a2a] text-blue-500 border-b-2 border-blue-500 font-semibold' : 'bg-transparent text-slate-500 border-b-2 border-transparent font-normal'
    }`;

  // Get messages for current branch
  const displayMessages = getMessagesForCurrentBranch();

  return (
    <div ref={containerRef} className="p-3 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-base">Local LLM Chat</h2>
          <button
            onClick={() => setShowGuide(true)}
            className="bg-transparent border border-blue-500 rounded-full w-[18px] h-[18px] text-blue-500 text-[11px] cursor-pointer flex items-center justify-center p-0"
            title="Quick Start Guide"
          >
            ?
          </button>
        </div>
        <div className="text-[11px] text-slate-500 flex items-center gap-4">
          {serverStatus?.model_ready && (
            <span className="text-green-400">
              Model: {serverStatus.model_name?.split('/').pop()}
            </span>
          )}
          {serverStatus?.vram && (
            <span>
              VRAM: {(serverStatus.vram.used / 1024 ** 3).toFixed(1)}GB / {(serverStatus.vram.total / 1024 ** 3).toFixed(1)}GB
            </span>
          )}
          <span className={serverRunning ? 'text-green-400' : 'text-red-500'}>
            {serverRunning ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-700 mb-2.5">
        {(['setup', 'chat', 'history', 'prompts', 'rag'] as TabType[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={tabClass(activeTab === tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* ============================================ */}
        {/* SETUP TAB */}
        {/* ============================================ */}
        {activeTab === 'setup' && (
          <div className="flex-1 overflow-auto">
            {/* Server Connection */}
            <div className={sectionClass}>
              <h4 className="m-0 mb-2 text-[13px]">Server Connection</h4>
              <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                <span className="text-[13px]">Venv:</span>
                <select
                  value={selectedVenv}
                  onChange={e => setSelectedVenv(e.target.value)}
                  className={`${inputClass} w-[140px]`}
                  disabled={serverRunning}
                >
                  {availableVenvs.length === 0 ? (
                    <option value="">No venvs</option>
                  ) : (
                    availableVenvs.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))
                  )}
                </select>
                <span className="text-[13px]">Port:</span>
                <input
                  type="number"
                  value={serverPort}
                  onChange={e => setServerPort(parseInt(e.target.value) || 8766)}
                  className={`${inputClass} w-[70px]`}
                  disabled={serverRunning}
                />
                {!serverRunning ? (
                  <button onClick={startServer} disabled={connecting} className={connecting ? buttonDisabledClass : buttonClass}>
                    {connecting ? 'Connecting...' : 'Start Server'}
                  </button>
                ) : (
                  <button onClick={stopServer} className={buttonRedClass}>
                    Stop Server
                  </button>
                )}
              </div>

              {serverStatus && (
                <div className="text-[11px] text-slate-500">
                  <span>CUDA: {serverStatus.cuda_available ? 'Yes' : 'No'}</span>
                  {serverStatus.vram && (
                    <span className="ml-4">
                      VRAM: {(serverStatus.vram.used / 1024 ** 3).toFixed(1)}GB / {(serverStatus.vram.total / 1024 ** 3).toFixed(1)}GB
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Dependencies */}
            <div className={sectionClass}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="m-0 text-[13px]">
                  Python Packages {checkingDeps && <span className="text-slate-500 font-normal">(checking...)</span>}
                </h4>
                <div className="flex gap-2">
                  <button
                    onClick={checkDeps}
                    disabled={!selectedVenv || checkingDeps}
                    className={`${buttonSmallClass} ${!selectedVenv || checkingDeps ? 'bg-slate-600 opacity-50' : 'bg-slate-600'} text-white`}
                  >
                    Refresh
                  </button>
                  <button
                    onClick={installMissingDeps}
                    disabled={!selectedVenv || installingDeps || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)}
                    className={`${buttonSmallClass} ${REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed) ? 'bg-slate-600' : 'bg-cyan-600'} text-white`}
                  >
                    {installingDeps ? `Installing ${installingPackage}...` : 'Install All'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {REQUIRED_PACKAGES.map(pkg => {
                  const status = depsStatus[pkg];
                  const isInstalled = status?.installed;
                  return (
                    <div
                      key={pkg}
                      className={`py-1.5 px-2.5 rounded text-[11px] flex items-center gap-1.5 ${
                        isInstalled ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'
                      }`}
                    >
                      <span>{isInstalled ? '✓' : '✗'}</span>
                      <span>{pkg}</span>
                      {status?.version && <span className="text-slate-500 text-[10px]">({status.version})</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Model Settings */}
            <div className={sectionClass}>
              <h4 className="m-0 mb-2 text-[13px]">Model Settings</h4>

              {/* Model Selection */}
              <div className="mb-2">
                <label className="flex items-center gap-1.5 text-xs mb-1.5">
                  <input
                    type="checkbox"
                    checked={useCustomModel}
                    onChange={e => setUseCustomModel(e.target.checked)}
                  />
                  Use custom model path
                </label>

                {useCustomModel ? (
                  <>
                    <input
                      type="text"
                      value={customModel}
                      onChange={e => setCustomModel(e.target.value)}
                      placeholder="e.g., microsoft/Phi-3-mini-4k-instruct or bartowski/Qwen2.5-7B-Instruct-GGUF"
                      className={inputClass}
                    />
                    {/* Model type selector for custom models */}
                    <div className="mt-2">
                      <label className="text-xs mr-4">
                        <input
                          type="radio"
                          name="modelType"
                          value="transformers"
                          checked={modelType === 'transformers'}
                          onChange={e => setModelType('transformers')}
                        />
                        {' '}Transformers
                      </label>
                      <label className="text-xs">
                        <input
                          type="radio"
                          name="modelType"
                          value="gguf"
                          checked={modelType === 'gguf'}
                          onChange={e => setModelType('gguf')}
                        />
                        {' '}GGUF
                      </label>
                    </div>
                  </>
                ) : (
                  <select
                    value={selectedModel}
                    onChange={e => {
                      const selected = RECOMMENDED_MODELS.find(m => m.value === e.target.value);
                      setSelectedModel(e.target.value);
                      if (selected) {
                        setModelType(selected.type as 'transformers' | 'gguf');
                      }
                    }}
                    className={inputClass}
                  >
                    <optgroup label="Transformers Models">
                      {RECOMMENDED_MODELS.filter(m => m.type === 'transformers').map(model => (
                        <option key={model.value} value={model.value}>
                          {model.label} ({model.size})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="GGUF Models (Faster, Lower VRAM)">
                      {RECOMMENDED_MODELS.filter(m => m.type === 'gguf').map(model => (
                        <option key={model.value} value={model.value}>
                          {model.label} ({model.size})
                        </option>
                      ))}
                    </optgroup>
                    {cachedModels.length > 0 && (
                      <optgroup label="Cached Models">
                        {cachedModels.map(model => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>

              {/* Cached Models Scanner */}
              <div className="mb-2">
                <button
                  onClick={loadCachedModels}
                  disabled={!serverRunning || loadingCachedModels}
                  className={`${buttonSmallClass} bg-slate-600 text-white`}
                >
                  {loadingCachedModels ? 'Scanning...' : 'Scan HF Cache'}
                </button>
                {cachedModels.length > 0 && (
                  <span className="ml-2.5 text-[11px] text-slate-500">
                    {cachedModels.length} models found
                  </span>
                )}
              </div>

              {/* GGUF-specific options */}
              {modelType === 'gguf' && (
                <div className="mt-3 mb-2 p-2.5 bg-black rounded-md">
                  <h5 className="m-0 mb-2 text-xs text-blue-400">GGUF Options</h5>

                  <div className="mb-2">
                    <label className="text-[11px] block mb-1">
                      GPU Layers: {nGpuLayers === -1 ? 'All (Auto)' : nGpuLayers}
                    </label>
                    <input
                      type="range"
                      min={-1}
                      max={100}
                      value={nGpuLayers}
                      onChange={e => setNGpuLayers(parseInt(e.target.value))}
                      className="w-full"
                      title="-1 = All layers on GPU (recommended)"
                    />
                    <div className="text-[10px] text-slate-600 mt-0.5">
                      -1 = All layers on GPU, 0 = CPU only, 1-100 = Partial offload
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="text-[11px] block mb-1">
                      Context Window: {nCtx.toLocaleString()} tokens
                    </label>
                    <input
                      type="range"
                      min={2048}
                      max={32768}
                      step={1024}
                      value={nCtx}
                      onChange={e => setNCtx(parseInt(e.target.value))}
                      className="w-full"
                    />
                    <div className="text-[10px] text-slate-600 mt-0.5">
                      Larger = more memory but better long conversations
                    </div>
                  </div>
                </div>
              )}

              {/* Transformers-only options */}
              {modelType === 'transformers' && (
                <div className="flex gap-2.5 items-center mb-2 flex-wrap">
                  <label className="text-xs">
                    <input type="checkbox" checked={useFp16} onChange={e => setUseFp16(e.target.checked)} />
                    {' '}FP16
                  </label>
                  <label className="text-xs">
                    <input type="checkbox" checked={useCpuOffload} onChange={e => setUseCpuOffload(e.target.checked)} />
                    {' '}CPU Offload
                  </label>
                  <input
                    type="text"
                    value={device}
                    onChange={e => setDevice(e.target.value)}
                    placeholder="Device (auto/cuda/cpu)"
                    className={`${inputClass} w-[120px]`}
                  />
                </div>
              )}

              {/* Load/Unload Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={loadModel}
                  disabled={!serverRunning || serverStatus?.model_loading}
                  className={`${buttonClass} bg-green-600`}
                >
                  {serverStatus?.model_loading ? 'Loading...' : 'Load Model'}
                </button>
                <button
                  onClick={unloadModel}
                  disabled={!serverStatus?.model_ready}
                  className={buttonRedClass}
                >
                  Unload
                </button>
                {serverStatus?.model_ready && serverStatus.model_name && (
                  <span className="text-green-400 text-[11px] self-center">
                    Ready: {serverStatus.model_name.split('/').pop()}
                  </span>
                )}
              </div>
            </div>

            {/* Generation Parameters */}
            <div className={sectionClass}>
              <h4 className="m-0 mb-2 text-[13px]">Generation Settings</h4>

              <div className={sliderContainerClass}>
                <span
                  className="w-[120px] text-xs cursor-help"
                  title="Controls randomness. Lower = more focused/deterministic, Higher = more creative/random. Default: 0.7"
                >
                  Temp: {temperature.toFixed(2)}
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={temperature}
                  onChange={e => setTemperature(parseFloat(e.target.value))}
                  className="flex-1"
                  title="Temperature: Controls output randomness"
                />
              </div>

              <div className={sliderContainerClass}>
                <span
                  className="w-[120px] text-xs cursor-help"
                  title="Maximum number of tokens to generate in the response. More tokens = longer responses but slower generation."
                >
                  Max tokens: {maxNewTokens.toLocaleString()}
                </span>
                <input
                  type="range"
                  min={64}
                  max={200000}
                  step={64}
                  value={maxNewTokens}
                  onChange={e => setMaxNewTokens(parseInt(e.target.value))}
                  className="flex-1"
                  title="Maximum tokens to generate"
                />
              </div>

              <div className={sliderContainerClass}>
                <label className="flex items-center gap-1 w-[120px] text-xs cursor-help">
                  <input
                    type="checkbox"
                    checked={useTopK}
                    onChange={e => setUseTopK(e.target.checked)}
                    title="Enable/disable Top K sampling"
                  />
                  <span title="Limits sampling to the K most likely tokens. Lower = more focused. Some models ignore this. Disable if responses seem off.">
                    Top K: {useTopK ? topK : 'Off'}
                  </span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={200}
                  step={1}
                  value={topK}
                  onChange={e => setTopK(parseInt(e.target.value))}
                  className="flex-1"
                  disabled={!useTopK}
                  title="Top K: Sample from top K most likely tokens"
                />
              </div>

              <div className={sliderContainerClass}>
                <label className="flex items-center gap-1 w-[120px] text-xs cursor-help">
                  <input
                    type="checkbox"
                    checked={useTopP}
                    onChange={e => setUseTopP(e.target.checked)}
                    title="Enable/disable Top P (nucleus) sampling"
                  />
                  <span title="Nucleus sampling - samples from smallest set of tokens whose cumulative probability exceeds P. Lower = more focused. Some models ignore this.">
                    Top P: {useTopP ? topP.toFixed(2) : 'Off'}
                  </span>
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={topP}
                  onChange={e => setTopP(parseFloat(e.target.value))}
                  className="flex-1"
                  disabled={!useTopP}
                  title="Top P: Nucleus sampling probability threshold"
                />
              </div>

              <div className="text-[10px] text-slate-600 mt-1 italic">
                Hover over labels for explanations. Some models may ignore Top K/P settings.
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '12px', cursor: 'help' }} title="Include previous messages as context for the model">
                  <input type="checkbox" checked={useHistory} onChange={e => setUseHistory(e.target.checked)} />
                  {' '}Use conversation history
                </label>
                <label style={{ fontSize: '12px', cursor: 'help' }} title="Stream tokens as they are generated (recommended for long responses)">
                  <input type="checkbox" checked={useStreaming} onChange={e => setUseStreaming(e.target.checked)} />
                  {' '}Stream response
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ============================================ */}
        {/* CHAT TAB */}
        {/* ============================================ */}
        {activeTab === 'chat' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Branch Selector */}
            {branches.length > 1 && (
              <div style={{ padding: '8px 12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: '#888' }}>Branch:</span>
                <select
                  value={currentBranchId}
                  onChange={e => setCurrentBranchId(e.target.value)}
                  className={`${inputClass} w-auto`}
                >
                  {branches.map(branch => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Chat Messages */}
            <div style={{ flex: 1, background: '#0d0d0d', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: '200px' }}>
              <div style={{ padding: '6px 10px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '11px', color: '#666' }}>
                    {currentConversationName} ({displayMessages.length} messages)
                  </span>
                  {/* Token stats during/after generation */}
                  {(generating || currentTokenCount > 0) && (
                    <span style={{ fontSize: '10px', color: generating ? '#3498db' : '#888', fontFamily: 'monospace' }}>
                      {currentTokenCount} tokens {tokensPerSecond > 0 && `| ${tokensPerSecond.toFixed(1)} tok/s`}
                      {!generating && lastGenTime > 0 && ` | ${lastGenTime.toFixed(1)}s`}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={exportChatToPdf}
                    disabled={displayMessages.length === 0 || exportingPdf}
                    style={{ background: 'none', border: 'none', color: '#3498db', fontSize: '10px', cursor: 'pointer' }}
                  >
                    {exportingPdf ? 'Exporting...' : 'Export PDF'}
                  </button>
                  <button
                    onClick={saveCurrentConversation}
                    disabled={!serverRunning || displayMessages.length === 0}
                    style={{ background: 'none', border: 'none', color: '#2ecc71', fontSize: '10px', cursor: 'pointer' }}
                  >
                    Save
                  </button>
                  <button
                    onClick={startNewConversation}
                    style={{ background: 'none', border: 'none', color: '#f39c12', fontSize: '10px', cursor: 'pointer' }}
                  >
                    New Chat
                  </button>
                  <button
                    onClick={clearHistory}
                    disabled={!serverRunning}
                    style={{ background: 'none', border: 'none', color: '#666', fontSize: '10px', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
                {displayMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#666', fontSize: '12px', marginTop: '20px' }}>
                    {!serverStatus?.model_ready
                      ? 'Load a model in the Setup tab to start chatting.'
                      : 'No messages yet. Start chatting below!'}
                  </div>
                ) : (
                  displayMessages.map((msg) => (
                    <div key={msg.id} style={{ ...messageStyle(msg.role), position: 'relative' }}>
                      <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>
                          {msg.role === 'user' ? 'You' : 'Assistant'} {msg.timestamp && `• ${msg.timestamp}`}
                          {msg.role === 'assistant' && msg.tokenCount && (
                            <span style={{ marginLeft: '8px', color: '#666', fontFamily: 'monospace' }}>
                              ({msg.tokenCount} tokens)
                            </span>
                          )}
                        </span>
                        {msg.role === 'user' && (
                          <button
                            onClick={() => {
                              setEditingMessageId(msg.id);
                              setEditingMessageContent(msg.content);
                            }}
                            style={{ background: 'none', border: 'none', color: '#888', fontSize: '10px', cursor: 'pointer' }}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      {editingMessageId === msg.id ? (
                        <div>
                          <textarea
                            value={editingMessageContent}
                            onChange={e => setEditingMessageContent(e.target.value)}
                            className={`${inputClass} h-20 mb-2 resize-y`}
                          />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => createBranchFromMessage(msg.id, editingMessageContent)}
                              disabled={generating || !editingMessageContent.trim()}
                              className={`${buttonSmallClass} bg-violet-600`}
                            >
                              Send as New Branch
                            </button>
                            <button
                              onClick={() => {
                                setEditingMessageId(null);
                                setEditingMessageContent('');
                              }}
                              className={`${buttonSmallClass} bg-slate-600`}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                          {/* RAG Retrieved Chunks */}
                          {msg.retrievedChunks && msg.retrievedChunks.length > 0 && (
                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #333' }}>
                              <button
                                onClick={() => setExpandedChunks(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                                className={`${buttonSmallClass} bg-blue-500 mb-2 text-[10px]`}
                              >
                                {expandedChunks[msg.id] ? '▼' : '▶'} Retrieved {msg.retrievedChunks.length} chunk(s)
                              </button>
                              {expandedChunks[msg.id] && (
                                <div style={{ fontSize: '10px', color: '#aaa' }}>
                                  {msg.retrievedChunks.map((chunk, idx) => (
                                    <div
                                      key={idx}
                                      style={{
                                        background: '#0d0d0d',
                                        padding: '8px',
                                        borderRadius: '4px',
                                        marginBottom: '6px',
                                        border: '1px solid #444'
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ color: '#3498db', fontWeight: '600' }}>
                                          #{idx + 1}: {chunk.document}
                                        </span>
                                        <span style={{ color: '#666' }}>
                                          Similarity: {(chunk.similarity * 100).toFixed(1)}%
                                        </span>
                                      </div>
                                      <div style={{ color: '#999', lineHeight: '1.4' }}>
                                        {chunk.text}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Mode Toggle */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', marginBottom: '8px' }}>
              <button
                onClick={() => setRagMode(false)}
                className={`${buttonClass} flex-1 ${!ragMode ? 'bg-violet-600 border-2 border-violet-600' : 'bg-slate-700 border-2 border-slate-600'}`}
              >
                💬 Chat
              </button>
              <button
                onClick={() => setRagMode(true)}
                disabled={!serverStatus?.embed_loaded || !serverStatus?.documents_indexed}
                className={`${buttonClass} flex-1 ${ragMode ? 'bg-blue-500 border-2 border-blue-500' : 'bg-slate-700 border-2 border-slate-600'} ${(!serverStatus?.embed_loaded || !serverStatus?.documents_indexed) ? 'opacity-50' : ''}`}
                title={!serverStatus?.embed_loaded ? 'Load embedding model first' : !serverStatus?.documents_indexed ? 'Index documents first' : 'RAG mode'}
              >
                📚 RAG
              </button>
            </div>

            {ragMode && (
              <div style={{ fontSize: '10px', color: '#3498db', marginBottom: '8px', padding: '6px', background: 'rgba(52, 152, 219, 0.1)', borderRadius: '4px' }}>
                ✓ RAG Mode: Searching {serverStatus?.chunks_count || 0} chunks from {serverStatus?.documents_count || 0} documents
              </div>
            )}

            {/* Chat Input */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && !generating && (ragMode ? sendRAGQuery() : sendMessage())}
                placeholder={serverStatus?.model_ready ? 'Type your message...' : 'Load a model first...'}
                className={`${inputClass} flex-1`}
                disabled={!serverStatus?.model_ready || generating}
              />
              <button
                onClick={() => ragMode ? sendRAGQuery() : sendMessage()}
                disabled={!serverStatus?.model_ready || generating || !inputMessage.trim()}
                className={`${buttonClass} ${generating ? 'bg-slate-600' : ragMode ? 'bg-blue-500' : 'bg-violet-600'}`}
              >
                {generating ? 'Thinking...' : ragMode ? 'Ask RAG' : 'Send'}
              </button>
            </div>
          </div>
        )}

        {/* ============================================ */}
        {/* HISTORY TAB */}
        {/* ============================================ */}
        {activeTab === 'history' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '13px' }}>Saved Conversations</h4>
              <button
                onClick={loadConversations}
                disabled={!serverRunning || loadingConversations}
                className={`${buttonSmallClass} bg-slate-600`}
              >
                {loadingConversations ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', background: '#0d0d0d', borderRadius: '6px', padding: '12px' }}>
              {savedConversations.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#666', fontSize: '12px', marginTop: '20px' }}>
                  {!serverRunning
                    ? 'Start the server to view saved conversations.'
                    : 'No saved conversations yet.'}
                </div>
              ) : (
                savedConversations.map(conv => (
                  <div
                    key={conv.id}
                    style={{
                      padding: '12px',
                      background: currentConversationId === conv.id ? '#2a2a2a' : '#1a1a1a',
                      borderRadius: '6px',
                      marginBottom: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '4px' }}>{conv.name}</div>
                      <div style={{ fontSize: '11px', color: '#888' }}>
                        {conv.messageCount || 0} messages • {new Date(conv.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => loadConversation(conv.id)}
                        className={`${buttonSmallClass} bg-blue-500`}
                      >
                        Load
                      </button>
                      <button
                        onClick={() => deleteConversation(conv.id)}
                        className={`${buttonSmallClass} bg-red-500`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Current Conversation Save */}
            {messages.length > 0 && (
              <div style={{ marginTop: '10px', padding: '12px', background: '#1a1a1a', borderRadius: '6px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={currentConversationName}
                    onChange={e => setCurrentConversationName(e.target.value)}
                    placeholder="Conversation name..."
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    onClick={saveCurrentConversation}
                    disabled={!serverRunning}
                    className={`${buttonClass} bg-green-600`}
                  >
                    Save Current
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================ */}
        {/* PROMPTS TAB */}
        {/* ============================================ */}
        {activeTab === 'prompts' && (
          <div style={{ flex: 1, display: 'flex', gap: '12px', overflow: 'hidden' }}>
            {/* Left Panel - Prompt List */}
            <div style={{ width: '250px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ marginBottom: '10px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>Active Prompt</h4>
                <select
                  value={activePrompt}
                  onChange={e => selectActivePrompt(e.target.value)}
                  className={inputClass}
                  disabled={!serverRunning}
                >
                  {availablePrompts.map(p => (
                    <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>All Prompts</h4>
              <div style={{ flex: 1, overflow: 'auto', background: '#0d0d0d', borderRadius: '6px', padding: '8px' }}>
                {availablePrompts.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#666', fontSize: '11px', padding: '20px' }}>
                    {!serverRunning ? 'Start server to load prompts.' : 'No prompts found.'}
                  </div>
                ) : (
                  availablePrompts.map(promptName => (
                    <button
                      key={promptName}
                      onClick={() => loadPromptContent(promptName)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        marginBottom: '4px',
                        border: 'none',
                        borderRadius: '4px',
                        background: selectedPromptToView === promptName ? '#2a2a2a' : 'transparent',
                        color: selectedPromptToView === promptName ? '#fff' : '#aaa',
                        fontSize: '12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{promptName.replace(/_/g, ' ')}</span>
                      {activePrompt === promptName && (
                        <span style={{ fontSize: '10px', color: '#2ecc71' }}>active</span>
                      )}
                    </button>
                  ))
                )}
              </div>

              {/* New Prompt */}
              <div style={{ marginTop: '10px' }}>
                <input
                  type="text"
                  value={newPromptName}
                  onChange={e => setNewPromptName(e.target.value)}
                  placeholder="new_prompt_name"
                  className={`${inputClass} mb-1.5`}
                />
                <button
                  onClick={() => {
                    if (newPromptName.trim()) {
                      savePrompt(newPromptName.trim().replace(/\s+/g, '_'), 'Enter your system prompt here...');
                      setNewPromptName('');
                    }
                  }}
                  disabled={!serverRunning || !newPromptName.trim()}
                  className={`${buttonClass} w-full bg-green-600`}
                >
                  Create New Prompt
                </button>
              </div>
            </div>

            {/* Right Panel - Prompt Editor */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h4 style={{ margin: 0, fontSize: '13px' }}>
                  {selectedPromptToView ? selectedPromptToView.replace(/_/g, ' ') : 'Select a prompt'}
                </h4>
                {selectedPromptToView && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {editingPrompt !== selectedPromptToView ? (
                      <button
                        onClick={() => setEditingPrompt(selectedPromptToView)}
                        className={`${buttonSmallClass} bg-blue-500`}
                      >
                        Edit
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => savePrompt(selectedPromptToView, promptDraft)}
                          disabled={savingPrompt}
                          className={`${buttonSmallClass} bg-green-600`}
                        >
                          {savingPrompt ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setEditingPrompt(null);
                            loadPromptContent(selectedPromptToView);
                          }}
                          className={`${buttonSmallClass} bg-slate-600`}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div style={{ flex: 1, background: '#0d0d0d', borderRadius: '6px', overflow: 'hidden' }}>
                {selectedPromptToView ? (
                  editingPrompt === selectedPromptToView ? (
                    <textarea
                      value={promptDraft}
                      onChange={e => setPromptDraft(e.target.value)}
                      style={{
                        width: '100%',
                        height: '100%',
                        padding: '12px',
                        background: 'transparent',
                        border: 'none',
                        color: '#fff',
                        fontSize: '13px',
                        fontFamily: 'monospace',
                        resize: 'none',
                        outline: 'none',
                      }}
                    />
                  ) : (
                    <pre style={{
                      margin: 0,
                      padding: '12px',
                      color: '#aaa',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      overflow: 'auto',
                      height: '100%',
                    }}>
                      {promptDraft || 'Loading...'}
                    </pre>
                  )
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: '12px' }}>
                    Select a prompt from the list to view or edit
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================ */}
        {/* RAG TAB */}
        {/* ============================================ */}
        {activeTab === 'rag' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>

            {/* Embedding Model Section */}
            <div className={sectionClass}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>Embedding Model</h4>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <select
                  value={selectedEmbedModel}
                  onChange={e => setSelectedEmbedModel(e.target.value)}
                  className={`${inputClass} flex-1 min-w-[200px]`}
                  disabled={embedModelLoading || serverStatus?.embed_loaded}
                >
                  {EMBED_MODELS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                {!serverStatus?.embed_loaded ? (
                  <button
                    onClick={loadEmbedModel}
                    disabled={!serverRunning || embedModelLoading}
                    className={buttonClass}
                  >
                    {embedModelLoading ? 'Loading...' : 'Load Model'}
                  </button>
                ) : (
                  <button
                    onClick={unloadEmbedModel}
                    disabled={!serverRunning}
                    className={buttonClass}
                  >
                    Unload Model
                  </button>
                )}
              </div>
              {serverStatus?.embed_loaded && (
                <div style={{ fontSize: '11px', color: '#2ecc71', marginTop: '4px' }}>
                  ✓ Loaded: {serverStatus.embed_model_name}
                </div>
              )}
            </div>

            {/* Document Upload Section */}
            <div className={sectionClass}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>Documents</h4>

              <div style={{ marginBottom: '12px' }}>
                <input
                  type="file"
                  multiple
                  accept=".txt,.pdf,.py,.js,.ts,.tsx,.jsx,.md,.json,.csv"
                  onChange={handleFileSelect}
                  style={{ fontSize: '12px', marginBottom: '8px' }}
                  disabled={!serverRunning}
                />
                {selectedFiles.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>
                      Selected: {selectedFiles.length} file(s)
                    </div>
                    <button
                      onClick={addDocuments}
                      disabled={uploadingDocuments || !serverRunning}
                      className={buttonClass}
                    >
                      {uploadingDocuments ? 'Uploading...' : 'Add to Collection'}
                    </button>
                  </div>
                )}
              </div>

              {/* Document List */}
              {documents.length > 0 ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#aaa' }}>
                      {documents.length} document(s) | {serverStatus?.chunks_count || 0} chunks
                      {serverStatus?.documents_indexed && ' ✓ Indexed'}
                    </span>
                    <button
                      onClick={clearDocuments}
                      className={`${buttonSmallClass} bg-red-500`}
                    >
                      Clear All
                    </button>
                  </div>
                  <div style={{ maxHeight: '200px', overflow: 'auto', border: '1px solid #333', borderRadius: '4px' }}>
                    {documents.map(doc => (
                      <div
                        key={doc.name}
                        style={{
                          padding: '8px',
                          borderBottom: '1px solid #333',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '11px'
                        }}
                      >
                        <div>
                          <div style={{ color: '#fff', marginBottom: '2px' }}>{doc.name}</div>
                          <div style={{ color: '#666' }}>
                            {doc.char_count.toLocaleString()} chars
                            {doc.indexed && <span style={{ color: '#2ecc71', marginLeft: '8px' }}>✓ Indexed</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => removeDocument(doc.name)}
                          className={`${buttonSmallClass} bg-red-500`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: '#666', textAlign: 'center', padding: '20px' }}>
                  No documents uploaded
                </div>
              )}
            </div>

            {/* Indexing Section */}
            <div className={sectionClass}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>Indexing</h4>

              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '4px' }}>
                  Chunk Size: {chunkSize} characters
                </label>
                <input
                  type="range"
                  min="50"
                  max="500"
                  step="25"
                  value={chunkSize}
                  onChange={e => setChunkSize(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                  disabled={indexing}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={indexDocuments}
                  disabled={!serverRunning || !serverStatus?.embed_loaded || documents.length === 0 || indexing}
                  className={buttonClass}
                >
                  {indexing ? 'Indexing...' : 'Index All Documents'}
                </button>
                {serverStatus?.documents_indexed && (
                  <button
                    onClick={unindexDocuments}
                    disabled={!serverRunning}
                    className={buttonClass}
                  >
                    Clear Index
                  </button>
                )}
              </div>
            </div>

            {/* Embeddings Persistence */}
            <div className={sectionClass}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>Save/Load Embeddings</h4>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <button
                  onClick={saveEmbeddings}
                  disabled={!serverRunning || !serverStatus?.documents_indexed || savingEmbeddings}
                  className={buttonClass}
                >
                  {savingEmbeddings ? 'Saving...' : 'Save Embeddings'}
                </button>
              </div>

              {savedEmbeddings.length > 0 && (
                <div>
                  <select
                    value={selectedEmbeddingFile}
                    onChange={e => setSelectedEmbeddingFile(e.target.value)}
                    className={`${inputClass} w-full mb-2`}
                  >
                    <option value="">Select saved embeddings...</option>
                    {savedEmbeddings.map(file => (
                      <option key={file.filename} value={file.filename}>
                        {file.filename} ({(file.size / 1024).toFixed(0)} KB)
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={loadEmbeddingsFromFile}
                    disabled={!serverRunning || !selectedEmbeddingFile || loadingEmbeddings}
                    className={buttonClass}
                  >
                    {loadingEmbeddings ? 'Loading...' : 'Load Embeddings'}
                  </button>
                </div>
              )}
            </div>

            {/* RAG Query Settings */}
            <div className={sectionClass}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>RAG Query Settings</h4>

              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '4px' }}>
                  Top K Chunks: {ragTopK}
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={ragTopK}
                  onChange={e => setRagTopK(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '4px' }}>
                  Relevance Threshold: {relevanceThreshold.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={relevanceThreshold}
                  onChange={e => setRelevanceThreshold(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <button onClick={() => setRelevanceThreshold(0.2)} className={`${buttonSmallClass} py-0.5 px-1.5 text-[10px]`}>
                    Always Docs (0.2)
                  </button>
                  <button onClick={() => setRelevanceThreshold(0.35)} className={`${buttonSmallClass} py-0.5 px-1.5 text-[10px]`}>
                    Balanced (0.35)
                  </button>
                  <button onClick={() => setRelevanceThreshold(0.6)} className={`${buttonSmallClass} py-0.5 px-1.5 text-[10px]`}>
                    Free Chat (0.6)
                  </button>
                </div>
              </div>

              <div style={{ fontSize: '10px', color: '#666', marginTop: '8px', lineHeight: '1.4' }}>
                • Lower threshold = more likely to use documents<br/>
                • Higher threshold = more likely to use general knowledge<br/>
                • Top K controls how many document chunks to retrieve
              </div>
            </div>

            {/* Instructions */}
            <div className={`${sectionClass} bg-blue-500/10 border border-blue-500/30`}>
              <h4 className="m-0 mb-2 text-[13px] text-blue-500">How to Use RAG</h4>
              <ol className="m-0 pl-5 text-[11px] text-slate-400 leading-relaxed">
                <li>Load an embedding model (sentence transformers)</li>
                <li>Upload documents (PDF, text, code files)</li>
                <li>Index documents to create embeddings</li>
                <li>Switch to Chat tab and enable RAG mode</li>
                <li>Ask questions about your documents!</li>
              </ol>
            </div>

          </div>
        )}
      </div>

      {/* ============================================ */}
      {/* RESIZABLE LOG PANEL */}
      {/* ============================================ */}

      {/* Resize Handle */}
      <div
        onMouseDown={handleLogResizeStart}
        style={{
          height: '8px',
          background: '#1a1a1a',
          cursor: 'ns-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: '10px',
          borderRadius: '4px 4px 0 0',
        }}
      >
        <div style={{ width: '40px', height: '3px', background: '#444', borderRadius: '2px' }} />
      </div>

      {/* Logs */}
      <div style={{ height: `${logPanelHeight}px`, background: '#0d0d0d', borderRadius: '0 0 6px 6px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '6px 10px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: '#666' }}>Logs</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => setLogPanelHeight(Math.min(400, logPanelHeight + 50))}
              style={{ background: 'none', border: 'none', color: '#666', fontSize: '11px', cursor: 'pointer' }}
              title="Expand"
            >
              ▲
            </button>
            <button
              onClick={() => setLogPanelHeight(Math.max(60, logPanelHeight - 50))}
              style={{ background: 'none', border: 'none', color: '#666', fontSize: '11px', cursor: 'pointer' }}
              title="Shrink"
            >
              ▼
            </button>
            <button onClick={() => setLogs([])} style={{ background: 'none', border: 'none', color: '#666', fontSize: '10px', cursor: 'pointer' }}>
              Clear
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px', fontSize: '11px', fontFamily: 'monospace' }}>
          {logs.map((log, i) => (
            <div key={i} style={{ color: log.includes('ERROR') ? '#e74c3c' : log.includes('Response') || log.includes('success') ? '#2ecc71' : '#888' }}>
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* Quick Start Guide Modal */}
      {showGuide && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div style={{
            background: '#1a1a1a',
            borderRadius: '12px',
            border: '1px solid #333',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Modal Header */}
            <div style={{ padding: '16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#3498db', fontSize: '16px' }}>Quick Start Guide</h3>
              <button
                onClick={() => setShowGuide(false)}
                style={{ background: 'none', border: 'none', color: '#888', fontSize: '18px', cursor: 'pointer', padding: '4px' }}
              >
                x
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '16px', overflow: 'auto', flex: 1 }}>
              {/* Step 1 */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#3498db', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold', flexShrink: 0 }}>1</div>
                <div>
                  <div style={{ fontWeight: '600', color: '#3498db', marginBottom: '4px' }}>Setup Python Environment</div>
                  <div style={{ fontSize: '12px', color: '#aaa' }}>Select a Python virtual environment from the dropdown on the Setup tab. Create one in Python Manager if needed.</div>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#9b59b6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold', flexShrink: 0 }}>2</div>
                <div>
                  <div style={{ fontWeight: '600', color: '#9b59b6', marginBottom: '4px' }}>Install Dependencies</div>
                  <div style={{ fontSize: '12px', color: '#aaa' }}>Click "Refresh" to check packages, then "Install All" to install required packages (torch, transformers, etc).</div>
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#e91e63', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold', flexShrink: 0 }}>3</div>
                <div>
                  <div style={{ fontWeight: '600', color: '#e91e63', marginBottom: '4px' }}>Start the Server</div>
                  <div style={{ fontSize: '12px', color: '#aaa' }}>Click "Start Server" to launch the FastAPI backend. Wait for "Connected" status.</div>
                </div>
              </div>

              {/* Step 4 */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#2ecc71', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold', flexShrink: 0 }}>4</div>
                <div>
                  <div style={{ fontWeight: '600', color: '#2ecc71', marginBottom: '4px' }}>Load a Model</div>
                  <div style={{ fontSize: '12px', color: '#aaa' }}>Select a model from the dropdown or scan your HuggingFace cache for downloaded models. Click "Load Model".</div>
                </div>
              </div>

              {/* Step 5 */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f39c12', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold', flexShrink: 0 }}>5</div>
                <div>
                  <div style={{ fontWeight: '600', color: '#f39c12', marginBottom: '4px' }}>Start Chatting!</div>
                  <div style={{ fontSize: '12px', color: '#aaa' }}>Switch to the Chat tab and send messages. Use streaming for real-time responses.</div>
                </div>
              </div>

              {/* Key Settings */}
              <div style={{ background: '#0d0d0d', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#fff' }}>Key Settings</h4>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#aaa', lineHeight: '1.6' }}>
                  <li><b style={{ color: '#fff' }}>Temperature:</b> Higher = more creative, Lower = more focused</li>
                  <li><b style={{ color: '#fff' }}>Max Tokens:</b> Maximum response length</li>
                  <li><b style={{ color: '#fff' }}>Top K/P:</b> Sampling controls (disable if model ignores them)</li>
                  <li><b style={{ color: '#fff' }}>Streaming:</b> See response as it generates with live stats</li>
                </ul>
              </div>

              {/* Troubleshooting */}
              <div style={{ background: 'rgba(231, 76, 60, 0.1)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(231, 76, 60, 0.3)' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#e74c3c' }}>Troubleshooting</h4>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#aaa', lineHeight: '1.6' }}>
                  <li><b style={{ color: '#e74c3c' }}>Out of memory?</b> Try a smaller model or enable FP16/CPU offload</li>
                  <li><b style={{ color: '#e74c3c' }}>Server won't start?</b> Check the log panel for errors</li>
                  <li><b style={{ color: '#e74c3c' }}>Slow generation?</b> Enable streaming to see progress, or use a smaller model</li>
                  <li><b style={{ color: '#e74c3c' }}>Model not loading?</b> Ensure you have enough RAM/VRAM for the model size</li>
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '16px', borderTop: '1px solid #333' }}>
              <button
                onClick={() => setShowGuide(false)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#3498db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
