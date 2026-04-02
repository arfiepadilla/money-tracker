import React, { useState, useEffect, useCallback, useRef } from 'react';

// ============== Types ==============

interface ServerStatus {
  embed_loaded: boolean;
  embed_loading: boolean;
  embed_status: string;
  gen_loaded: boolean;
  gen_loading: boolean;
  gen_status: string;
  gen_model_name: string;
  documents_count: number;
  documents_indexed: boolean;
  chunks_count: number;
  chunk_size: number;
  top_k: number;
  device: string;
  cuda_available: boolean;
  vram: { total: number; free: number; used: number } | null;
}

interface Document {
  name: string;
  char_count: number;
  indexed: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  retrievedChunks?: string[];
  id?: number;
  isLoading?: boolean;
  mode?: 'rag' | 'llm'; // Added mode to track generation type
}

// ============== Constants ==============

const GEN_MODELS = [
  { label: 'Qwen2.5-3B Instruct', value: 'Qwen/Qwen2.5-3B-Instruct', size: '~6GB' },
  { label: 'Qwen2.5-7B Instruct', value: 'Qwen/Qwen2.5-7B-Instruct', size: '~14GB' },
  { label: 'DeepSeek Coder V2 Lite', value: 'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct', size: '~16GB' },
  { label: 'DeepSeek Coder 6.7B', value: 'deepseek-ai/deepseek-coder-6.7b-instruct', size: '~14GB' },
];

const EMBED_MODELS = [
  { label: 'BERT Base Uncased', value: 'bert-base-uncased' },
  { label: 'All MiniLM L6 v2', value: 'sentence-transformers/all-MiniLM-L6-v2' },
];

// Required packages for RAG system
const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'transformers', 'torch', 'numpy', 'pydantic', 'pypdf', 'pymupdf', 'accelerate'];

// ============== Component ==============

export const RAGWindow: React.FC = () => {
  // Server state
  const [serverPort] = useState(8767);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState('');

  // Model state
  const [selectedGenModel, setSelectedGenModel] = useState(GEN_MODELS[0].value);
  const [selectedEmbedModel, setSelectedEmbedModel] = useState(EMBED_MODELS[0].value);
  const [localEmbedLoading, setLocalEmbedLoading] = useState(false);
  const [localGenLoading, setLocalGenLoading] = useState(false);

  // Document state
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocIndex, setSelectedDocIndex] = useState(-1);
  const [selectedFiles, setSelectedFiles] = useState<{ name: string, content: string, isPdf?: boolean }>([]);

  // Settings
  const [chunkSize, setChunkSize] = useState(200);
  const [topK, setTopK] = useState(3);
  const [relevanceThreshold, setRelevanceThreshold] = useState(0.35);
  const [maxTokens, setMaxTokens] = useState(256);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<number | null>(null);

  // UI state
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'models' | 'documents' | 'settings'>('models');
  const [showLogs, setShowLogs] = useState(true);
  const [showSetupPanel, setShowSetupPanel] = useState(true);

  // Dependency state (copied from SDXLGenerator)
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);

  // Improved console state (copied from SDXLGenerator)
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
  const [consoleHeight, setConsoleHeight] = useState(128); // Default 8rem (32 * 4)
  const isDraggingLogs = useRef(false);

  // ============== Utilities ==============

  const renderContent = (content: string) => {
    // Simple markdown code block parser
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
        if (match) {
          const [, lang, code] = match;
          return (
            <div key={index} className="my-2 bg-black/40 rounded-lg overflow-hidden border border-white/5">
              {lang && (
                <div className="px-3 py-1 bg-white/5 border-b border-white/5 text-[10px] text-slate-400 font-mono">
                  {lang}
                </div>
              )}
              <pre className="p-3 overflow-x-auto text-xs font-mono text-slate-300">
                <code>{code}</code>
              </pre>
            </div>
          );
        }
      }
      // Render regular text (handle newlines)
      return (
        <p key={index} className="whitespace-pre-wrap mb-1 last:mb-0">
          {part}
        </p>
      );
    });
  };

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
  }, []);

  const getServerUrl = () => `http://127.0.0.1:${serverPort}`;

  // ============== Effects ==============

  // Auto-scroll logs
  useEffect(() => {
    if (!isScrolledUp) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isScrolledUp]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    const handleLog = (_: any, log: string) => {
      const trimmed = log.trim();
      // Filter out routine polling requests
      const isPollingRequest =
        trimmed.includes('GET /status') ||
        trimmed.includes('GET /health') ||
        trimmed.includes('GET /documents');

      const isRoutineServerLog =
        trimmed.includes('127.0.0.1:') && (
          trimmed.includes('GET /status') ||
          trimmed.includes('GET /health') ||
          trimmed.includes('GET /documents')
        );

      // Filter generic INFO messages and successful request logs to reduce noise
      const isGenericInfo =
        trimmed.includes('INFO:     Started server process') ||
        trimmed.includes('INFO:     Waiting for application startup') ||
        trimmed.includes('INFO:     Application startup complete') ||
        trimmed.includes('INFO:     Uvicorn running on');

      const isSuccessLog =
        (trimmed.includes('POST /query') && trimmed.includes('200 OK')) ||
        (trimmed.includes('POST /embed/load') && trimmed.includes('200 OK')) ||
        (trimmed.includes('POST /gen/load') && trimmed.includes('200 OK'));

      if (isPollingRequest || isRoutineServerLog || isGenericInfo || isSuccessLog) {
        return;
      }

      addLog(`[Python] ${trimmed}`);
    };

    ipcRenderer.on('python-log', handleLog);
    ipcRenderer.on('python-error', handleLog);

    return () => {
      ipcRenderer.removeListener('python-log', handleLog);
      ipcRenderer.removeListener('python-error', handleLog);
    };
  }, [ipcRenderer, addLog]);

  // Handle Resize Logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingLogs.current) return;
      const newHeight = window.innerHeight - e.clientY;
      // Clamp height between 100px and 600px
      setConsoleHeight(Math.max(100, Math.min(600, newHeight)));
    };

    const handleMouseUp = () => {
      isDraggingLogs.current = false;
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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

  // Poll server status
  useEffect(() => {
    if (!serverRunning) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${getServerUrl()}/status`);
        if (res.ok) {
          const status = await res.json();
          setServerStatus(status);
          setDocuments(
            (await (await fetch(`${getServerUrl()}/documents`)).json()).documents || []
          );
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [serverRunning, serverPort]);

  // ============== Console Management ==============

  const handleLogsScroll = useCallback(() => {
    const container = logsContainerRef.current;
    if (!container) return;

    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 10;
    setIsScrolledUp(!isAtBottom);
  }, []);

  const jumpToBottom = useCallback(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsScrolledUp(false);
  }, []);

  const saveLogs = useCallback(() => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron - cannot save logs');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logContent = logs.join('\n');
    const fileName = `rag-logs-${timestamp}.txt`;

    try {
      ipcRenderer.invoke('save-file-dialog', {
        defaultPath: fileName,
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      }).then((result: any) => {
        if (!result.canceled && result.filePath) {
          ipcRenderer.invoke('write-file', { path: result.filePath, content: logContent })
            .then(() => addLog(`Logs saved to: ${result.filePath}`))
            .catch((err: any) => addLog(`ERROR saving logs: ${err.message}`));
        }
      });
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  }, [logs, ipcRenderer, addLog]);

  // ============== Dependency Management ==============

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
        // Separate torch packages from others
        const torchPackages = ['torch', 'torchvision', 'torchaudio'];
        const hasTorch = missing.some(p => torchPackages.includes(p));
        const nonTorchPackages = missing.filter(p => !torchPackages.includes(p));

        // Install non-torch packages first
        if (nonTorchPackages.length > 0) {
          const pkgString = nonTorchPackages.join(' ');
          addLog(`Installing: ${pkgString} into venv ${selectedVenv}`);
          const inst = await ipcRenderer.invoke('python-install-package', { venvName: selectedVenv, package: pkgString });
          addLog(inst?.message || JSON.stringify(inst));
        }

        // Install torch with CUDA support if torch is missing
        if (hasTorch) {
          addLog('Installing PyTorch with CUDA support (cu121)...');
          const torchCmd = 'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121';
          const torchInst = await ipcRenderer.invoke('python-install-package', { venvName: selectedVenv, package: torchCmd });
          addLog(torchInst?.message || JSON.stringify(torchInst));
        }

        // Reload dependency status
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

  const checkServerStatus = async (): Promise<boolean> => {
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
  };

  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting RAG server...');

    const alreadyRunning = await checkServerStatus();
    if (alreadyRunning) {
      addLog('Server already running!');
      setConnecting(false);
      return;
    }

    if (!selectedVenv) {
      addLog('ERROR: No venv selected');
      setConnecting(false);
      return;
    }

    addLog(`Using venv: ${selectedVenv}`);

    const scriptInfo = await ipcRenderer.invoke('resolve-workflow-script', {
      workflowFolder: 'RAG',
      scriptName: 'rag_server.py'
    });

    addLog(`Script resolve result: ${JSON.stringify(scriptInfo)}`);

    if (!scriptInfo.success) {
      addLog(`ERROR: ${scriptInfo.error}`);
      setConnecting(false);
      return;
    }

    addLog(`Script path: ${scriptInfo.path}`);

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptInfo.path,
      port: serverPort,
      serverName: 'rag_server',
    });

    addLog(`Start server result: ${JSON.stringify(result)}`);

    if (result.success) {
      addLog(`Server started (PID: ${result.pid}), waiting...`);

      let attempts = 0;
      const maxAttempts = 30;
      const pollInterval = setInterval(async () => {
        attempts++;
        addLog(`Polling server status (attempt ${attempts}/${maxAttempts})...`);
        const ready = await checkServerStatus();
        if (ready) {
          clearInterval(pollInterval);
          addLog('Server connected!');
          setConnecting(false);
          addSystemMessage('RAG Server connected. Load models to start.');
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

    const result = await ipcRenderer.invoke('python-stop-script-server', 'rag_server');
    if (result.success) {
      addLog('Server stopped');
    } else {
      try {
        await fetch(`${getServerUrl()}/shutdown`, { method: 'POST' });
      } catch {
        // Ignore
      }
    }
    setServerRunning(false);
    setServerStatus(null);
  };

  // ============== Model Control ==============

  const loadEmbedModel = async () => {
    if (!serverRunning) return;

    setLocalEmbedLoading(true);
    addLog('Loading embedding model...');
    const startTime = Date.now();
    try {
      const res = await fetch(`${getServerUrl()}/embed/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: selectedEmbedModel }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Embedding model loaded on ${data.device}`);
        addSystemMessage('Embedding model loaded');
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 500 - elapsed);
      setTimeout(() => setLocalEmbedLoading(false), delay);
    }
  };

  const unloadEmbedModel = async () => {
    if (!serverRunning) return;
    await fetch(`${getServerUrl()}/embed/unload`, { method: 'POST' });
    addLog('Embedding model unloaded');
  };

  const loadGenModel = async () => {
    if (!serverRunning) return;

    setLocalGenLoading(true);
    addLog(`Loading generation model: ${selectedGenModel}...`);
    const startTime = Date.now();
    try {
      const res = await fetch(`${getServerUrl()}/gen/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: selectedGenModel, use_fp16: true }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Generation model loaded: ${data.model_name}`);
        addSystemMessage(`Generation model loaded: ${data.model_name}`);
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 500 - elapsed);
      setTimeout(() => setLocalGenLoading(false), delay);
    }
  };

  const unloadGenModel = async () => {
    if (!serverRunning) return;
    await fetch(`${getServerUrl()}/gen/unload`, { method: 'POST' });
    addLog('Generation model unloaded');
  };

  // ============== Document Control ==============

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filePromises = Array.from(files).map(file => {
      return new Promise<{ name: string, content: string, isPdf?: boolean }>((resolve, reject) => {
        const reader = new FileReader();
        const isPdf = file.name.toLowerCase().endsWith('.pdf');

        reader.onload = (event) => {
          if (isPdf) {
            const arrayBuffer = event.target?.result as ArrayBuffer;
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            resolve({ name: file.name, content: base64, isPdf: true });
          } else {
            const content = event.target?.result as string;
            resolve({ name: file.name, content, isPdf: false });
          }
        };

        reader.onerror = reject;
        if (isPdf) {
          reader.readAsArrayBuffer(file);
        } else {
          reader.readAsText(file);
        }
      });
    });

    Promise.all(filePromises).then(loadedFiles => {
      setSelectedFiles(loadedFiles);
      const pdfCount = loadedFiles.filter(f => f.isPdf).length;
      const txtCount = loadedFiles.length - pdfCount;
      addLog(`Loaded ${txtCount} text file(s) and ${pdfCount} PDF file(s)`);

      // Auto-adjust settings for code files
      const codeExtensions = ['.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.md', '.c', '.cpp', '.h', '.java', '.go', '.rs'];
      const hasCode = loadedFiles.some(f => codeExtensions.some(ext => f.name.toLowerCase().endsWith(ext)) && !f.isPdf);

      if (hasCode) {
        setChunkSize(1000);
        setTopK(5);
        setRelevanceThreshold(0.2);
        addLog("Code files detected: Optimized settings (Chunk: 1000, TopK: 5, Threshold: 0.2)");
      }
    }).catch(e => {
      addLog(`ERROR: Failed to load files - ${e.message}`);
    });
  };

  const addDocument = async () => {
    if (!serverRunning || selectedFiles.length === 0) return;

    addLog(`Adding ${selectedFiles.length} document(s)...`);
    let successCount = 0;
    let errorCount = 0;

    for (const file of selectedFiles) {
      try {
        if (file.isPdf) {
          addLog(`Processing PDF: ${file.name}...`);
          const res = await fetch(`${getServerUrl()}/documents/add-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: file.name,
              pdf_base64: file.content
            }),
          });
          const data = await res.json();

          if (data.success) {
            successCount++;
            addLog(`✓ ${file.name}: Extracted ${data.char_count} characters from ${data.page_count || '?'} pages`);
            if (data.warnings && data.warnings.length > 0) {
              data.warnings.forEach((w: string) => addLog(`  ⚠️ ${w}`));
            }
          } else {
            errorCount++;
            addLog(`✗ ${file.name}: ${data.error}`);
          }
        } else {
          const res = await fetch(`${getServerUrl()}/documents/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, content: file.content }),
          });
          const data = await res.json();
          if (data.success) {
            successCount++;
            addLog(`✓ ${file.name}`);
          } else {
            errorCount++;
            addLog(`✗ ${file.name}: ${data.error}`);
          }
        }
      } catch (e: any) {
        errorCount++;
        addLog(`✗ ${file.name}: ${e.message}`);
      }
    }

    addLog(`Summary: ${successCount} succeeded, ${errorCount} failed`);
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeDocument = async (name: string) => {
    if (!serverRunning) return;
    try {
      const res = await fetch(`${getServerUrl()}/documents/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Document removed: ${name}`);
        setSelectedDocIndex(-1);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const indexDocuments = async () => {
    if (!serverRunning) return;
    addLog('Indexing documents...');
    try {
      const res = await fetch(`${getServerUrl()}/documents/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunk_size: chunkSize }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Indexed ${data.chunks_count} chunks from ${data.documents_count} documents`);
        addSystemMessage(`Documents indexed: ${data.chunks_count} chunks ready`);
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const unindexDocuments = async () => {
    if (!serverRunning) return;
    await fetch(`${getServerUrl()}/documents/unindex`, { method: 'POST' });
    addLog('Documents unindexed');
  };

  const clearAllDocuments = async () => {
    if (!serverRunning) return;
    try {
      const res = await fetch(`${getServerUrl()}/documents/clear`, { method: 'POST' });
      const data = await res.json();
      if (data.success || res.ok) {
        setDocuments([]);
        addLog('All documents cleared');
      } else {
        addLog(`ERROR: Failed to clear documents`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // ============== Chat ==============

  const addSystemMessage = (content: string) => {
    setMessages(prev => [
      ...prev,
      { role: 'system', content, timestamp: new Date().toLocaleTimeString() },
    ]);
  };

  const sendQuery = async (mode: 'rag' | 'llm') => {
    if (!serverRunning || !inputMessage.trim() || generating) return;

    const query = inputMessage.trim();
    setInputMessage('');
    setGenerating(true);

    // Add user message
    setMessages(prev => [
      ...prev,
      { role: 'user', content: query, timestamp: new Date().toLocaleTimeString() },
    ]);

    // Add loading message for assistant
    const loadingMessageId = Date.now();
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: '...',
        timestamp: new Date().toLocaleTimeString(),
        isLoading: true,
        id: loadingMessageId,
        mode: mode
      },
    ]);

    const modeLabel = mode === 'rag' ? 'RAG' : 'LLM';
    addLog(`[${modeLabel}] Querying: "${query.substring(0, 50)}..."`);

    try {
      const res = await fetch(`${getServerUrl()}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          top_k: topK,
          temperature: 0.7,
          max_new_tokens: maxTokens,
          relevance_threshold: relevanceThreshold,
          use_rag: mode === 'rag', // Send to server which mode to use
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Replace loading message with actual response
        setMessages(prev => prev.map(msg =>
          msg.id === loadingMessageId
            ? {
              role: 'assistant',
              content: data.response,
              timestamp: new Date().toLocaleTimeString(),
              retrievedChunks: data.retrieved_chunks,
              mode: mode
            }
            : msg
        ));
        addLog(`Response in ${data.generation_time.toFixed(2)}s`);
      } else {
        // Replace loading message with error
        setMessages(prev => prev.map(msg =>
          msg.id === loadingMessageId
            ? {
              role: 'assistant',
              content: `Error: ${data.error}`,
              timestamp: new Date().toLocaleTimeString(),
              mode: mode
            }
            : msg
        ));
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      setMessages(prev => prev.map(msg =>
        msg.id === loadingMessageId
          ? {
            role: 'assistant',
            content: `Error: ${e.message}`,
            timestamp: new Date().toLocaleTimeString(),
            mode: mode
          }
          : msg
      ));
      addLog(`ERROR: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const clearChat = async () => {
    if (serverRunning) {
      await fetch(`${getServerUrl()}/chat/clear`, { method: 'POST' });
    }
    setMessages([]);
    addLog('Chat cleared');
  };

  // ============== Capabilities & Render ==============

  const canRag =
    serverStatus?.embed_loaded &&
    serverStatus?.gen_loaded &&
    serverStatus?.documents_indexed;

  const canLlm =
    serverStatus?.gen_loaded;

  return (
    <div
      className="h-full flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white"
    >
      {/* Main Content Area */}
      <div className="flex-1 flex flex-row min-h-0">
        {/* Left Panel - Controls */}
        <div
          className="w-96 flex-none flex flex-col overflow-y-auto border-r border-white/10"
        >
          {/* Header Section */}
          <div
            className="flex-none px-4 py-3 space-y-3 border-b border-white/10"
          >
            {/* Title */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500"
              >
                <span className="font-bold text-white">RAG</span>
              </div>
              <div>
                <h2
                  className="text-base font-bold bg-gradient-to-r from-purple-400 to-pink-300 bg-clip-text text-transparent"
                >
                  RAG System
                </h2>
                <p className="text-xs text-slate-400">Document Q&A & LLM Chat</p>
              </div>
            </div>

            {/* Status Info */}
            {serverStatus && (
              <div
                className="flex flex-col gap-1 text-xs rounded p-2 bg-slate-800/50 text-slate-400"
              >
                <div className="flex justify-between">
                  <span>Device:</span>
                  <span className="text-slate-300">{serverStatus.device}</span>
                </div>
                {serverStatus.vram && (
                  <div className="flex justify-between">
                    <span>VRAM:</span>
                    <span className="text-slate-300">
                      {(serverStatus.vram.used / 1024 ** 3).toFixed(1)}GB / {(serverStatus.vram.total / 1024 ** 3).toFixed(1)}GB
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Setup Panel */}
          <div
            className="flex-none px-4 py-3 border-b border-white/10"
          >
            <button
              onClick={() => setShowSetupPanel(!showSetupPanel)}
              className="w-full text-left flex items-center justify-between mb-3"
            >
              <h3 className="text-sm font-semibold flex items-center gap-2 text-cyan-400">
                Setup & Dependencies
              </h3>
              <span
                className={`text-xs transition-transform duration-200 text-cyan-400 ${showSetupPanel ? 'rotate-180' : ''}`}
              >
                ▼
              </span>
            </button>

            {showSetupPanel && (
              <div className="space-y-4 text-xs">
                {/* Venv Selection */}
                <div className="space-y-2">
                  <label className="font-medium text-xs text-slate-300">Virtual Environment</label>
                  <select
                    value={selectedVenv}
                    onChange={e => setSelectedVenv(e.target.value)}
                    disabled={serverRunning}
                    className="w-full text-xs rounded px-2 py-1.5 disabled:opacity-50 bg-slate-700 text-slate-200 border border-white/10"
                  >
                    {availableVenvs.length === 0 ? (
                      <option value="">No venvs</option>
                    ) : (
                      availableVenvs.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))
                    )}
                  </select>
                </div>

                {/* Dependencies Section */}
                <div
                  className="p-4 rounded-xl bg-slate-800/40 border border-white/10"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold flex items-center gap-1.5 text-slate-300">
                      Python Packages {checkingDeps && <span className="text-slate-400">(checking...)</span>}
                    </h4>
                    <button
                      onClick={installMissing}
                      disabled={installingDeps || !selectedVenv || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)}
                      className={`px-3 py-2 disabled:opacity-50 rounded-lg text-xs font-bold transition-all shadow-sm ${
                        installingDeps || !selectedVenv || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)
                          ? 'bg-slate-600 text-slate-400'
                          : 'bg-cyan-600 text-slate-900'
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
                            <svg className="w-3.5 h-3.5 flex-none stroke-green-400" fill="none" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5 flex-none stroke-red-400" fill="none" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Server Control */}
                {!serverRunning ? (
                  <button
                    onClick={startServer}
                    disabled={connecting}
                    className={`w-full px-4 py-2 rounded text-xs font-bold ${
                      connecting
                        ? 'bg-slate-600 text-slate-400'
                        : 'bg-gradient-to-r from-purple-600 to-pink-600 text-slate-900'
                    }`}
                  >
                    {connecting ? 'Connecting...' : 'Start Server'}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <div
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded bg-green-600/20 border border-green-500/30"
                    >
                      <span
                        className="w-2 h-2 rounded-full animate-pulse bg-green-400"
                      />
                      <span className="text-xs text-green-400">Connected</span>
                    </div>
                    <button
                      onClick={stopServer}
                      className="px-4 py-2 rounded text-xs font-bold bg-red-600 text-slate-900"
                    >
                      Stop
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex-none border-b border-white/10">
            <div className="flex justify-center gap-4">
              {(['models', 'documents', 'settings'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-6 py-2 text-xs font-medium transition-colors ${
                    activeTab === tab
                      ? 'text-purple-400 bg-slate-800/50 border-b-2 border-purple-500'
                      : 'text-slate-400 bg-transparent border-b-2 border-transparent'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div className="p-4 space-y-3">
            {activeTab === 'models' && (
              <>
                {/* Embedding Model */}
                <div
                  className="rounded-lg p-3 bg-slate-800/50 border border-white/5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-cyan-400">Embedding Model</span>
                    <span
                      className={`w-2 h-2 rounded-full ${serverStatus?.embed_loaded ? 'bg-green-400' : 'bg-slate-500'}`}
                    />
                  </div>

                  <select
                    value={selectedEmbedModel}
                    onChange={e => setSelectedEmbedModel(e.target.value)}
                    disabled={serverStatus?.embed_loaded || localEmbedLoading}
                    className="w-full text-xs rounded px-2 py-1.5 mb-2 disabled:opacity-50 bg-slate-700 border border-white/10 text-slate-200"
                  >
                    {EMBED_MODELS.map(m => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>

                  <p className="text-xs mb-2 text-slate-500">{serverStatus?.embed_status || 'Not loaded'}</p>

                  {serverStatus?.embed_loaded ? (
                    <button
                      onClick={unloadEmbedModel}
                      className="w-full py-1.5 text-xs rounded font-bold bg-red-600/20 text-red-400"
                    >
                      Unload
                    </button>
                  ) : (
                    <button
                      onClick={loadEmbedModel}
                      disabled={!serverRunning || serverStatus?.embed_loading || localEmbedLoading}
                      className={`w-full py-1.5 text-xs rounded font-bold ${
                        serverStatus?.embed_loading || localEmbedLoading || !serverRunning
                          ? 'bg-slate-600 text-slate-400 cursor-wait'
                          : 'bg-cyan-600 text-slate-900 cursor-pointer'
                      }`}
                    >
                      {serverStatus?.embed_loading || localEmbedLoading ? 'Loading...' : 'Load'}
                    </button>
                  )}
                </div>

                {/* Generation Model */}
                <div
                  className="rounded-lg p-3 bg-slate-800/50 border border-white/5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-orange-400">Generation Model</span>
                    <span
                      className={`w-2 h-2 rounded-full ${serverStatus?.gen_loaded ? 'bg-green-400' : 'bg-slate-500'}`}
                    />
                  </div>
                  <select
                    value={selectedGenModel}
                    onChange={e => setSelectedGenModel(e.target.value)}
                    disabled={serverStatus?.gen_loaded || serverStatus?.gen_loading}
                    className="w-full text-xs rounded px-2 py-1.5 mb-2 disabled:opacity-50 bg-slate-700 border border-white/10 text-slate-200"
                  >
                    {GEN_MODELS.map(m => (
                      <option key={m.value} value={m.value}>
                        {m.label} ({m.size})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs mb-2 text-slate-500">{serverStatus?.gen_status || 'Not loaded'}</p>
                  {serverStatus?.gen_loaded ? (
                    <button
                      onClick={unloadGenModel}
                      className="w-full py-1.5 text-xs rounded font-bold bg-red-600/20 text-red-400"
                    >
                      Unload
                    </button>
                  ) : (
                    <button
                      onClick={loadGenModel}
                      disabled={!serverRunning || serverStatus?.gen_loading || localGenLoading}
                      className={`w-full py-1.5 text-xs rounded font-bold ${
                        serverStatus?.gen_loading || localGenLoading || !serverRunning
                          ? 'bg-slate-600 text-slate-400 cursor-wait'
                          : 'bg-orange-600 text-slate-900 cursor-pointer'
                      }`}
                    >
                      {serverStatus?.gen_loading || localGenLoading ? 'Loading...' : 'Load'}
                    </button>
                  )}
                </div>
              </>
            )}

            {activeTab === 'documents' && (
              <>
                {/* File Upload */}
                <div
                  className="rounded-lg p-3 bg-slate-800/50 border border-white/5"
                >
                  <p className="text-sm font-medium mb-2 text-emerald-400">Add Document</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.pdf,.py,.js,.jsx,.ts,.tsx,.html,.css,.json,.md,.c,.cpp,.h,.java,.go,.rs"
                    multiple
                    onChange={handleFileSelect}
                    className="w-full text-xs text-slate-400"
                  />
                  {selectedFiles.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs mb-1 text-slate-400">
                        {selectedFiles.length} file(s) selected ({selectedFiles.reduce((sum, f) => sum + f.content.length, 0).toLocaleString()} chars)
                      </p>
                      <div className="max-h-20 overflow-y-auto mb-2 space-y-1">
                        {selectedFiles.map((file, i) => (
                          <div key={i} className="text-xs text-slate-500">
                            • {file.name} ({file.content.length.toLocaleString()} chars)
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={addDocument}
                        disabled={!serverRunning}
                        className={`w-full py-1.5 text-xs rounded font-bold disabled:opacity-50 ${
                          !serverRunning ? 'bg-slate-600 text-slate-400' : 'bg-emerald-500 text-slate-900'
                        }`}
                      >
                        Add {selectedFiles.length} Document(s) to Collection
                      </button>
                    </div>
                  )}
                </div>

                {/* Document List */}
                <div
                  className="rounded-lg p-3 bg-slate-800/50 border border-white/5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-blue-400">Documents ({documents.length})</p>
                    {documents.length > 0 && (
                      <button
                        onClick={clearAllDocuments}
                        className="text-xs text-red-400"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {documents.length === 0 ? (
                    <p className="text-xs text-slate-500">No documents loaded</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {documents.map((doc, i) => (
                        <div
                          key={doc.name}
                          onClick={() => setSelectedDocIndex(i)}
                          className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs ${
                            selectedDocIndex === i
                              ? 'bg-blue-600/20 border border-blue-500/30'
                              : 'bg-slate-700/50 border border-transparent'
                          }`}
                        >
                          <div>
                            <p className="truncate max-w-[150px] text-slate-200">{doc.name}</p>
                            <p className="text-slate-500">{doc.char_count.toLocaleString()} chars</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                doc.indexed ? 'bg-green-600/20 text-green-400' : 'bg-slate-600/20 text-slate-400'
                              }`}
                            >
                              {doc.indexed ? 'Indexed' : 'Not indexed'}
                            </span>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                removeDocument(doc.name);
                              }}
                              className="text-red-400"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Index Controls */}
                  {documents.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {serverStatus?.documents_indexed ? (
                        <button
                          onClick={unindexDocuments}
                          className="flex-1 py-1.5 text-xs rounded font-bold bg-red-600/20 text-red-400"
                        >
                          Unindex
                        </button>
                      ) : (
                        <button
                          onClick={indexDocuments}
                          disabled={!serverStatus?.embed_loaded}
                          className={`flex-1 py-1.5 text-xs rounded font-bold disabled:opacity-50 ${
                            !serverStatus?.embed_loaded ? 'bg-slate-600 text-slate-400' : 'bg-blue-600 text-slate-900'
                          }`}
                        >
                          Index All
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'settings' && (
              <div
                className="rounded-lg p-3 space-y-4 bg-slate-800/50 border border-white/5"
              >
                <div>
                  <label className="text-xs text-slate-400">Chunk Size: {chunkSize}</label>
                  <input
                    type="range"
                    min={50}
                    max={500}
                    step={10}
                    value={chunkSize}
                    onChange={e => setChunkSize(parseInt(e.target.value))}
                    className="w-full mt-1"
                  />
                  <p className="text-[10px] mt-1 text-slate-500">Size of text chunks for indexing</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Top K Results: {topK}</label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={topK}
                    onChange={e => setTopK(parseInt(e.target.value))}
                    className="w-full mt-1"
                  />
                  <p className="text-[10px] mt-1 text-slate-500">Number of relevant chunks to retrieve</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Max Generation Tokens: {maxTokens}</label>
                  <input
                    type="range"
                    min={64}
                    max={2048}
                    step={64}
                    value={maxTokens}
                    onChange={e => setMaxTokens(parseInt(e.target.value))}
                    className="w-full mt-1"
                  />
                  <p className="text-[10px] mt-1 text-slate-500">Maximum length of the generated response</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Relevance Threshold: {relevanceThreshold.toFixed(2)}</label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={relevanceThreshold}
                    onChange={e => setRelevanceThreshold(parseFloat(e.target.value))}
                    className="w-full mt-1"
                  />
                  <p className="text-[10px] mt-1 text-slate-500">
                    Lower = use docs more often | Higher = use general knowledge more often
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setRelevanceThreshold(0.2)}
                      className="flex-1 px-2 py-1 rounded text-[10px] font-semibold bg-slate-700/50 text-slate-300 hover:bg-slate-600/50"
                    >
                      Always Docs (0.2)
                    </button>
                    <button
                      onClick={() => setRelevanceThreshold(0.35)}
                      className="flex-1 px-2 py-1 rounded text-[10px] font-semibold bg-slate-700/50 text-slate-300 hover:bg-slate-600/50"
                    >
                      Balanced (0.35)
                    </button>
                    <button
                      onClick={() => setRelevanceThreshold(0.6)}
                      className="flex-1 px-2 py-1 rounded text-[10px] font-semibold bg-slate-700/50 text-slate-300 hover:bg-slate-600/50"
                    >
                      Free Chat (0.6)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-slate-500">
                  <p className="text-lg mb-2">RAG & LLM Chat</p>
                  <p className="text-sm">
                    {!serverRunning
                      ? 'Start the server to begin'
                      : 'Load a generation model to start chatting'}
                  </p>
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i}>
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      msg.role === 'user'
                        ? 'ml-auto mr-0 bg-purple-600/30 border border-purple-500/30 text-left'
                        : msg.role === 'system'
                          ? 'mx-auto bg-slate-700/30 border border-slate-600/30 text-center'
                          : 'ml-0 mr-auto bg-slate-700/50 border border-slate-600/30 text-left'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] ${
                          msg.role === 'user' ? 'text-purple-400' : msg.role === 'system' ? 'text-slate-400' : 'text-emerald-400'
                        }`}
                      >
                        {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'Assistant'}
                      </span>
                      <span className="text-[10px] text-slate-500">{msg.timestamp}</span>
                      {msg.mode && (
                        <span
                          className={`text-[9px] px-1 rounded uppercase ${
                            msg.mode === 'rag' ? 'bg-purple-900/50 text-purple-300' : 'bg-blue-900/50 text-blue-300'
                          }`}
                        >
                          {msg.mode}
                        </span>
                      )}
                    </div>
                    <div className="text-sm">{renderContent(msg.content)}</div>

                    {/* Retrieved Chunks */}
                    {msg.retrievedChunks && msg.retrievedChunks.length > 0 && (
                      <div className="mt-2">
                        <button
                          onClick={() => setExpandedChunks(expandedChunks === i ? null : i)}
                          className="text-[10px] text-cyan-400"
                        >
                          {expandedChunks === i ? '▼' : '▶'} Retrieved {msg.retrievedChunks.length} chunks
                        </button>
                        {expandedChunks === i && (
                          <div className="mt-2 space-y-2">
                            {msg.retrievedChunks.map((chunk, ci) => (
                              <div
                                key={ci}
                                className="rounded p-2 text-[11px] bg-black/30 text-slate-400"
                              >
                                <span className="text-cyan-400">Chunk {ci + 1}:</span>
                                <p className="mt-1">{chunk}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area & Status */}
          <div
            className="flex-none p-4 border-t border-white/10 bg-slate-900"
          >
            {/* Input Row */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyPress={e => {
                  if (e.key === 'Enter' && !generating && inputMessage.trim()) {
                    if (canRag) sendQuery('rag');
                    else if (canLlm) sendQuery('llm');
                  }
                }}
                placeholder={
                  !canLlm
                    ? "Load Generation Model to start chatting..."
                    : canRag
                      ? "Ask about documents (Enter) or chat generally..."
                      : "Chat with LLM (Enter)..."
                }
                disabled={!canLlm || generating}
                className="flex-1 text-sm rounded-lg px-4 py-2 focus:outline-none disabled:opacity-50 bg-slate-800 border border-white/10 text-white"
              />

              {/* RAG Button */}
              <button
                onClick={() => sendQuery('rag')}
                disabled={!canRag || generating || !inputMessage.trim()}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg ${
                  !canRag || generating || !inputMessage.trim()
                    ? 'bg-slate-700 text-slate-500'
                    : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-purple-900/20'
                }`}
              >
                RAG
              </button>

              {/* LLM Button */}
              <button
                onClick={() => sendQuery('llm')}
                disabled={!canLlm || generating || !inputMessage.trim()}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg ${
                  !canLlm || generating || !inputMessage.trim()
                    ? 'bg-slate-700 text-slate-500'
                    : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-blue-900/20'
                }`}
              >
                LLM
              </button>

              <button
                onClick={clearChat}
                className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-700 text-slate-200"
              >
                Clear
              </button>
            </div>

            {/* Status Row */}
            <div className="flex items-center gap-6 text-[10px] px-2">
              <div className={`flex items-center gap-2 ${canRag ? 'text-purple-400' : 'text-slate-600'}`}>
                <span
                  className={`w-2 h-2 rounded-full ${canRag ? 'bg-purple-500' : 'bg-slate-600'}`}
                />
                <span>RAG Mode ({canRag ? 'Ready' : 'Not Ready'})</span>
              </div>
              <div className={`flex items-center gap-2 ${canLlm ? 'text-blue-400' : 'text-slate-600'}`}>
                <span
                  className={`w-2 h-2 rounded-full ${canLlm ? 'bg-blue-500' : 'bg-slate-600'}`}
                />
                <span>LLM Mode ({canLlm ? 'Ready' : 'Not Ready'})</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Improved Log Panel */}
      <div
        className="relative flex-none flex flex-col border-t border-white/10 bg-slate-950/90 backdrop-blur-xl"
      >
        {/* Resize Handle */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            isDraggingLogs.current = true;
            document.body.style.cursor = 'ns-resize';
          }}
          className="absolute top-0 left-0 w-full h-6 -translate-y-1/2 z-50 cursor-ns-resize flex items-center justify-center group"
          title="Drag to resize"
        >
          <div
            className="w-12 h-1 rounded-full transition-colors shadow-sm bg-slate-600/50 border border-black/20"
          />
        </div>
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="w-full px-4 py-2 mt-1 flex items-center justify-between text-xs font-medium bg-transparent relative z-0 text-slate-500"
        >
          <span className="flex items-center gap-2">
            Console Output ({logs.length})
          </span>
          <div className="flex items-center gap-3">
            {logs.length > 0 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); saveLogs(); }}
                  className="flex items-center gap-1 text-slate-500"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setLogs([]); }}
                  className="text-slate-500"
                >
                  Clear
                </button>
              </>
            )}
            <span className={`transition-transform duration-200 ${showLogs ? 'rotate-180' : ''}`}>▼</span>
          </div>
        </button>
        {showLogs && (
          <div className="relative">
            <div
              ref={logsContainerRef}
              onScroll={handleLogsScroll}
              style={{ height: consoleHeight }}
              className="overflow-y-auto px-4 pb-2 font-mono text-xs border-t border-white/5"
            >
              {logs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    color: log.includes('ERROR') ? '#f87171' :
                      log.includes('complete') || log.includes('success') || log.includes('Connected') || log.includes('loaded') ? '#34d399' :
                        log.includes('WARNING') ? '#fbbf24' :
                          '#64748b'
                  }}
                >
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
            {isScrolledUp && (
              <button
                onClick={jumpToBottom}
                className="absolute bottom-3 right-3 px-2 py-1.5 text-xs font-semibold rounded shadow-lg flex items-center gap-1 transition-all bg-cyan-600 text-white"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                Jump to Bottom
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};