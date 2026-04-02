/**
 * MCP Agent Window - AI agent with MCP tool integration
 *
 * Features:
 * - Qwen 2.5 14B GGUF for reasoning and tool calling
 * - Qwen3-VL for vision/screenshots
 * - MCP tool discovery and execution
 * - Editable system prompts
 * - Streaming responses with tool call visualization
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ============================================
// Dependencies for Python server
// ============================================
const REQUIRED_PACKAGES = [
  'fastapi',
  'uvicorn',
  'torch',
  'transformers',
  'accelerate',
  'huggingface-hub',
  'pillow',
  'httpx',
  'qwen-vl-utils',
];

const CUDA_PACKAGES: Record<string, { installCmd: string; checkCuda: (version: string) => boolean }> = {
  'torch': {
    installCmd: 'torch torchvision --index-url https://download.pytorch.org/whl/cu124',
    checkCuda: (version: string) => version.includes('+cu'),
  },
  'llama-cpp-python': {
    installCmd: 'llama-cpp-python==0.3.4 --no-cache-dir --force-reinstall --only-binary=:all: --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124',
    checkCuda: (_version: string) => true,
  },
};

// Add llama-cpp-python to required packages
const ALL_REQUIRED_PACKAGES = [...REQUIRED_PACKAGES, 'llama-cpp-python'];

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

interface PackageStatus {
  installed: boolean;
  version?: string;
  hasCuda?: boolean;
}

// ============================================
// Model Options
// ============================================
const TEXT_MODELS = [
  { label: 'Qwen2.5-14B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-14B-Instruct-GGUF', size: '~8.5GB' },
  { label: 'Qwen2.5-7B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-7B-Instruct-GGUF', size: '~4.5GB' },
  { label: 'Qwen2.5-3B Instruct GGUF (Q4_K_M)', value: 'bartowski/Qwen2.5-3B-Instruct-GGUF', size: '~2GB' },
];

const VISION_MODELS = [
  { label: 'Qwen3-VL-2B-Instruct', value: 'Qwen/Qwen3-VL-2B-Instruct', size: '~5GB' },
  { label: 'Qwen3-VL-4B-Instruct', value: 'Qwen/Qwen3-VL-4B-Instruct', size: '~9GB' },
  { label: 'Qwen3-VL-8B-Instruct', value: 'Qwen/Qwen3-VL-8B-Instruct', size: '~17GB' },
];

// ============================================
// Types
// ============================================
interface ToolDefinition {
  name: string;
  namespace: string;
  description: string;
  inputSchema?: any;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  toolResult?: Record<string, unknown>;
  timestamp: string;
}

interface ServerStatus {
  text_model_ready: boolean;
  text_model_loading: boolean;
  text_model_name: string;
  vision_model_ready: boolean;
  vision_model_loading: boolean;
  vision_model_name: string;
  registry_connected: boolean;
  discovered_tools: number;
  enabled_namespaces: string[];
  active_prompt: string;
  vram?: {
    total: number;
    used: number;
    free: number;
  };
}

interface PromptConfig {
  name: string;
  description: string;
  system_prompt: string;
}

// ============================================
// Component
// ============================================
export const MCPAgentWindow: React.FC = () => {
  // Server state
  const [serverPort, setServerPort] = useState(8793);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);

  // Venv and dependency state
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');
  const [depsStatus, setDepsStatus] = useState<Record<string, PackageStatus>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Model selection
  const [selectedTextModel, setSelectedTextModel] = useState(TEXT_MODELS[0].value);
  const [selectedVisionModel, setSelectedVisionModel] = useState(VISION_MODELS[0].value);

  // Tool state
  const [discoveredTools, setDiscoveredTools] = useState<ToolDefinition[]>([]);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [enabledNamespaces, setEnabledNamespaces] = useState<string[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // Prompt state
  const [prompts, setPrompts] = useState<Record<string, PromptConfig>>({});
  const [activePrompt, setActivePrompt] = useState('default');
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editPromptContent, setEditPromptContent] = useState<PromptConfig | null>(null);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState<'setup' | 'tools' | 'prompts' | 'agent'>('setup');
  const [logs, setLogs] = useState<string[]>([]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // IPC for Electron
  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  // ============================================
  // Utilities
  // ============================================
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), `[${timestamp}] ${message}`]);
  }, []);

  const generateId = () => Math.random().toString(36).substring(2, 9);

  const getServerUrl = () => `http://127.0.0.1:${serverPort}`;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  // ============================================
  // Server Communication
  // ============================================
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getServerUrl()}/status`);
      if (res.ok) {
        const data = await res.json();
        setServerStatus(data);
        setServerRunning(true);
      } else {
        setServerRunning(false);
        setServerStatus(null);
      }
    } catch {
      setServerRunning(false);
      setServerStatus(null);
    }
  }, [serverPort]);

  const fetchTools = useCallback(async () => {
    try {
      const res = await fetch(`${getServerUrl()}/tools`);
      if (res.ok) {
        const data = await res.json();
        setDiscoveredTools(data.tools || []);
        setEnabledNamespaces(data.enabled_namespaces || []);
      }
    } catch {
      // Ignore
    }
  }, [serverPort]);

  const fetchNamespaces = useCallback(async () => {
    try {
      const res = await fetch(`${getServerUrl()}/tools/namespaces`);
      if (res.ok) {
        const data = await res.json();
        setAvailableNamespaces(data.namespaces || []);
      }
    } catch {
      // Ignore
    }
  }, [serverPort]);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch(`${getServerUrl()}/prompts`);
      if (res.ok) {
        const data = await res.json();
        setPrompts(data.prompts || {});
        setActivePrompt(data.active || 'default');
      }
    } catch {
      // Ignore
    }
  }, [serverPort]);

  // Poll status
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Fetch tools and prompts when server connects
  useEffect(() => {
    if (serverRunning) {
      fetchTools();
      fetchNamespaces();
      fetchPrompts();
    }
  }, [serverRunning, fetchTools, fetchNamespaces, fetchPrompts]);

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

  // Check dependencies when venv changes
  const checkDeps = useCallback(async () => {
    if (!selectedVenv || !ipcRenderer) return;

    setCheckingDeps(true);
    try {
      const vres = await ipcRenderer.invoke('python-list-venvs');
      if (vres.success) {
        const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
        if (v && Array.isArray(v.packages)) {
          const map: Record<string, PackageStatus> = {};
          for (const pkg of ALL_REQUIRED_PACKAGES) {
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

  useEffect(() => {
    if (selectedVenv) {
      checkDeps();
    }
  }, [selectedVenv, checkDeps]);

  // Install missing dependencies
  const installMissingDeps = async () => {
    if (!selectedVenv || !ipcRenderer) {
      addLog('ERROR: No venv selected');
      return;
    }

    const missing = ALL_REQUIRED_PACKAGES.filter(p => !depsStatus[p]?.installed);
    if (missing.length === 0) {
      addLog('All required packages are already installed');
      return;
    }

    setInstallingDeps(true);
    try {
      for (const pkg of missing) {
        addLog(`Installing ${pkg}...`);
        setInstallingPackage(pkg);

        const cudaInfo = CUDA_PACKAGES[pkg];
        const installCmd = cudaInfo ? cudaInfo.installCmd : pkg;

        const result = await ipcRenderer.invoke('python-install-package', {
          venvName: selectedVenv,
          package: installCmd,
        });
        if (result.success) {
          addLog(`${pkg} installed`);
        } else {
          addLog(`ERROR installing ${pkg}: ${result.error}`);
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

  // ============================================
  // Server Start/Stop
  // ============================================
  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting MCP Agent server...');

    if (serverRunning) {
      addLog('Server already running!');
      setConnecting(false);
      return;
    }

    if (!selectedVenv) {
      addLog('ERROR: No Python virtual environment selected');
      setConnecting(false);
      return;
    }

    addLog(`Using venv: ${selectedVenv}`);

    const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
      workflowFolder: 'MCPAgent',
      scriptName: 'mcp_agent_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find mcp_agent_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'mcp_agent',
    });

    if (result.success) {
      addLog(`Server process started (PID: ${result.pid}), waiting for connection...`);

      let attempts = 0;
      const maxAttempts = 30;
      const pollInterval = setInterval(async () => {
        attempts++;
        await fetchStatus();
        if (serverRunning) {
          clearInterval(pollInterval);
          addLog('Server connected!');
          setConnecting(false);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          addLog('ERROR: Server failed to start within timeout');
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

    const result = await ipcRenderer.invoke('python-stop-script-server', 'mcp_agent');
    if (result.success) {
      addLog('Server stopped');
      setServerRunning(false);
      setServerStatus(null);
    } else {
      try {
        await fetch(`${getServerUrl()}/shutdown`, { method: 'POST' });
        addLog('Server shutdown requested');
      } catch {
        addLog('Server not responding - may have already stopped');
      }
      setServerRunning(false);
      setServerStatus(null);
    }
  };

  // ============================================
  // Model Loading
  // ============================================
  const loadTextModel = async () => {
    try {
      addLog(`Loading text model: ${selectedTextModel}`);
      const res = await fetch(`${getServerUrl()}/load_text_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: selectedTextModel }),
      });
      const data = await res.json();
      if (data.success) {
        addLog('Text model loaded successfully');
      } else {
        addLog(`Error: ${data.error}`);
      }
      fetchStatus();
    } catch (error) {
      addLog(`Error loading model: ${error}`);
    }
  };

  const loadVisionModel = async () => {
    try {
      addLog(`Loading vision model: ${selectedVisionModel}`);
      const res = await fetch(`${getServerUrl()}/load_vision_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: selectedVisionModel }),
      });
      const data = await res.json();
      if (data.success) {
        addLog('Vision model loaded successfully');
      } else {
        addLog(`Error: ${data.error}`);
      }
      fetchStatus();
    } catch (error) {
      addLog(`Error loading model: ${error}`);
    }
  };

  // ============================================
  // Tool Management
  // ============================================
  const refreshTools = async () => {
    try {
      addLog('Refreshing tools from registry...');
      const res = await fetch(`${getServerUrl()}/tools/refresh`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog(`Found ${data.tool_count} tools`);
        await fetchTools();
        await fetchNamespaces();
      } else {
        addLog(`Error: ${data.error}`);
      }
    } catch (error) {
      addLog(`Error refreshing tools: ${error}`);
    }
  };

  const toggleNamespace = async (namespace: string) => {
    let newEnabled: string[];
    if (enabledNamespaces.includes(namespace)) {
      newEnabled = enabledNamespaces.filter(n => n !== namespace);
    } else {
      newEnabled = [...enabledNamespaces, namespace];
    }

    try {
      const res = await fetch(`${getServerUrl()}/tools/namespaces/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespaces: newEnabled }),
      });
      if (res.ok) {
        setEnabledNamespaces(newEnabled);
      }
    } catch (error) {
      addLog(`Error updating namespaces: ${error}`);
    }
  };

  // ============================================
  // Prompt Management
  // ============================================
  const selectPrompt = async (name: string) => {
    try {
      const res = await fetch(`${getServerUrl()}/prompts/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setActivePrompt(name);
        addLog(`Active prompt set to: ${name}`);
      }
    } catch (error) {
      addLog(`Error setting prompt: ${error}`);
    }
  };

  const startEditingPrompt = (name: string) => {
    setEditingPrompt(name);
    setEditPromptContent({ ...prompts[name] });
  };

  const savePrompt = async () => {
    if (!editingPrompt || !editPromptContent) return;

    try {
      const res = await fetch(`${getServerUrl()}/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingPrompt, content: editPromptContent }),
      });
      if (res.ok) {
        addLog(`Prompt "${editingPrompt}" saved`);
        await fetchPrompts();
        setEditingPrompt(null);
        setEditPromptContent(null);
      }
    } catch (error) {
      addLog(`Error saving prompt: ${error}`);
    }
  };

  const createNewPrompt = () => {
    const name = `custom_${Date.now()}`;
    setEditingPrompt(name);
    setEditPromptContent({
      name: 'New Prompt',
      description: 'Custom prompt',
      system_prompt: 'You are a helpful assistant.\n\n## Available Tools\n{tools_json}\n\n## Tool Usage\n<tool_call>\n{"name": "tool_name", "arguments": {}}\n</tool_call>'
    });
  };

  // ============================================
  // Chat
  // ============================================
  const sendMessage = async () => {
    if (!inputMessage.trim() || isGenerating) return;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsGenerating(true);
    setStreamingContent('');

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`${getServerUrl()}/agent/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: inputMessage }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'token':
                  fullContent += event.content;
                  setStreamingContent(fullContent);
                  break;

                case 'tool_call':
                  addLog(`Tool call: ${event.tool.name}`);
                  setMessages(prev => [...prev, {
                    id: generateId(),
                    role: 'tool_call',
                    content: '',
                    toolCall: event.tool,
                    timestamp: new Date().toLocaleTimeString(),
                  }]);
                  break;

                case 'tool_result':
                  setMessages(prev => [...prev, {
                    id: generateId(),
                    role: 'tool_result',
                    content: '',
                    toolResult: event.result,
                    timestamp: new Date().toLocaleTimeString(),
                  }]);
                  break;

                case 'done':
                  setStreamingContent('');
                  setMessages(prev => [...prev, {
                    id: generateId(),
                    role: 'assistant',
                    content: event.full_response,
                    timestamp: new Date().toLocaleTimeString(),
                  }]);
                  addLog('Generation complete');
                  break;

                case 'error':
                  addLog(`Error: ${event.error}`);
                  break;
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error: unknown) {
      if ((error as Error).name !== 'AbortError') {
        addLog(`Error: ${(error as Error).message}`);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
    }
  };

  const clearChat = async () => {
    setMessages([]);
    setStreamingContent('');
    try {
      await fetch(`${getServerUrl()}/clear_history`, { method: 'POST' });
      addLog('Chat history cleared');
    } catch {
      // Ignore
    }
  };

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // ============================================
  // Render
  // ============================================
  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-cyan-400">MCP Agent</span>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${serverRunning ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-gray-400">Server</span>
            <span className={`w-2 h-2 rounded-full ${serverStatus?.registry_connected ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-gray-400">Registry</span>
            <span className={`w-2 h-2 rounded-full ${serverStatus?.text_model_ready ? 'bg-green-500' : 'bg-gray-500'}`} />
            <span className="text-gray-400">Text</span>
            <span className={`w-2 h-2 rounded-full ${serverStatus?.vision_model_ready ? 'bg-green-500' : 'bg-gray-500'}`} />
            <span className="text-gray-400">Vision</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {(['setup', 'tools', 'prompts', 'agent'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-sm rounded ${
                activeTab === tab
                  ? 'bg-cyan-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {/* Setup Tab */}
        {activeTab === 'setup' && (
          <div className="h-full overflow-auto p-4">
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Python Environment */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Python Environment</h3>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">Venv:</span>
                  <select
                    value={selectedVenv}
                    onChange={e => setSelectedVenv(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm"
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
              </div>

              {/* Dependencies */}
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-400">
                    Python Packages {checkingDeps && <span className="text-gray-500 font-normal">(checking...)</span>}
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={checkDeps}
                      disabled={!selectedVenv || checkingDeps}
                      className="px-2 py-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 rounded text-xs"
                    >
                      Refresh
                    </button>
                    <button
                      onClick={installMissingDeps}
                      disabled={!selectedVenv || installingDeps || ALL_REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)}
                      className={`px-2 py-1 rounded text-xs ${
                        ALL_REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)
                          ? 'bg-gray-600'
                          : 'bg-cyan-600 hover:bg-cyan-500'
                      } disabled:opacity-50`}
                    >
                      {installingDeps ? `Installing ${installingPackage}...` : 'Install All'}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {ALL_REQUIRED_PACKAGES.map(pkg => {
                    const status = depsStatus[pkg];
                    const isInstalled = status?.installed;
                    return (
                      <div
                        key={pkg}
                        className={`py-1.5 px-2.5 rounded text-xs flex items-center gap-1.5 ${
                          isInstalled ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        <span>{isInstalled ? '✓' : '✗'}</span>
                        <span className="truncate">{pkg}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Server Connection */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Server Connection</h3>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm text-gray-400">Port:</span>
                  <input
                    type="number"
                    value={serverPort}
                    onChange={e => setServerPort(parseInt(e.target.value) || 8793)}
                    className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm"
                    disabled={serverRunning}
                  />
                  {!serverRunning ? (
                    <button
                      onClick={startServer}
                      disabled={connecting || !selectedVenv}
                      className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:opacity-50 rounded text-sm"
                    >
                      {connecting ? 'Connecting...' : 'Start Server'}
                    </button>
                  ) : (
                    <button
                      onClick={stopServer}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-sm"
                    >
                      Stop Server
                    </button>
                  )}
                  <span className={`ml-2 text-sm ${serverRunning ? 'text-green-400' : 'text-red-400'}`}>
                    {serverRunning ? 'Running' : 'Stopped'}
                  </span>
                </div>
                {serverStatus && (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Registry:</span>
                      <span className={`ml-2 ${serverStatus.registry_connected ? 'text-green-400' : 'text-yellow-400'}`}>
                        {serverStatus.registry_connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Tools:</span>
                      <span className="ml-2 text-gray-200">{serverStatus.discovered_tools}</span>
                    </div>
                    {serverStatus.vram && (
                      <div className="col-span-2">
                        <span className="text-gray-500">VRAM:</span>
                        <span className="ml-2 text-gray-200">
                          {formatBytes(serverStatus.vram.used)} / {formatBytes(serverStatus.vram.total)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Text Model */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Text Model (Reasoning & Tool Calling)</h3>
                <div className="space-y-3">
                  <select
                    value={selectedTextModel}
                    onChange={(e) => setSelectedTextModel(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm"
                    disabled={serverStatus?.text_model_loading}
                  >
                    {TEXT_MODELS.map(model => (
                      <option key={model.value} value={model.value}>
                        {model.label} ({model.size})
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={loadTextModel}
                      disabled={!serverRunning || serverStatus?.text_model_loading}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 rounded text-sm"
                    >
                      {serverStatus?.text_model_loading ? 'Loading...' : 'Load Model'}
                    </button>
                    {serverStatus?.text_model_ready && (
                      <span className="text-sm text-green-400">
                        ✓ Loaded: {serverStatus.text_model_name.split('/').pop()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Vision Model */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Vision Model (Screenshots)</h3>
                <div className="space-y-3">
                  <select
                    value={selectedVisionModel}
                    onChange={(e) => setSelectedVisionModel(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm"
                    disabled={serverStatus?.vision_model_loading}
                  >
                    {VISION_MODELS.map(model => (
                      <option key={model.value} value={model.value}>
                        {model.label} ({model.size})
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={loadVisionModel}
                      disabled={!serverRunning || serverStatus?.vision_model_loading}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 rounded text-sm"
                    >
                      {serverStatus?.vision_model_loading ? 'Loading...' : 'Load Model'}
                    </button>
                    {serverStatus?.vision_model_ready && (
                      <span className="text-sm text-green-400">
                        ✓ Loaded: {serverStatus.vision_model_name.split('/').pop()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tools Tab */}
        {activeTab === 'tools' && (
          <div className="h-full overflow-auto p-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {/* Toolbar */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">Discovered Tools ({discoveredTools.length})</h2>
                <button
                  onClick={refreshTools}
                  disabled={!serverRunning}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 rounded text-sm"
                >
                  Refresh from Registry
                </button>
              </div>

              {/* Namespace Filters */}
              {availableNamespaces.length > 0 && (
                <div className="bg-gray-800 rounded-lg p-3">
                  <h3 className="text-sm font-medium text-gray-400 mb-2">
                    Filter by Namespace {enabledNamespaces.length > 0 && `(${enabledNamespaces.length} enabled)`}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {availableNamespaces.map(ns => (
                      <button
                        key={ns}
                        onClick={() => toggleNamespace(ns)}
                        className={`px-3 py-1 rounded text-sm ${
                          enabledNamespaces.length === 0 || enabledNamespaces.includes(ns)
                            ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-600'
                            : 'bg-gray-700 text-gray-400 border border-gray-600'
                        }`}
                      >
                        {ns}
                      </button>
                    ))}
                    {enabledNamespaces.length > 0 && (
                      <button
                        onClick={() => setEnabledNamespaces([])}
                        className="px-3 py-1 rounded text-sm bg-gray-700 text-gray-400 hover:bg-gray-600"
                      >
                        Clear Filter
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Tool List */}
              <div className="space-y-2">
                {discoveredTools.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    No tools discovered. Make sure the Tool Registry is running and has registered tools.
                  </div>
                ) : (
                  discoveredTools
                    .filter(t => enabledNamespaces.length === 0 || enabledNamespaces.includes(t.namespace))
                    .map(tool => (
                      <div
                        key={`${tool.namespace}:${tool.name}`}
                        className="bg-gray-800 rounded-lg border border-gray-700"
                      >
                        <div
                          className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-700/50"
                          onClick={() => {
                            const key = `${tool.namespace}:${tool.name}`;
                            setExpandedTools(prev => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            });
                          }}
                        >
                          <div>
                            <span className="font-medium text-cyan-400">{tool.name}</span>
                            <span className="ml-2 text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                              {tool.namespace}
                            </span>
                          </div>
                          <span className="text-gray-500">
                            {expandedTools.has(`${tool.namespace}:${tool.name}`) ? '▼' : '▶'}
                          </span>
                        </div>
                        {expandedTools.has(`${tool.namespace}:${tool.name}`) && (
                          <div className="px-3 pb-3 pt-0 border-t border-gray-700">
                            <p className="text-sm text-gray-400 mt-2">{tool.description}</p>
                            {tool.inputSchema?.properties && (
                              <div className="mt-2">
                                <span className="text-xs text-gray-500">Parameters:</span>
                                <pre className="mt-1 text-xs bg-gray-900 p-2 rounded overflow-auto max-h-40">
                                  {JSON.stringify(tool.inputSchema.properties, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Prompts Tab */}
        {activeTab === 'prompts' && (
          <div className="h-full overflow-auto p-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {/* Prompt Selector */}
              <div className="flex items-center gap-2 flex-wrap">
                {Object.entries(prompts).map(([name, config]) => (
                  <button
                    key={name}
                    onClick={() => selectPrompt(name)}
                    className={`px-3 py-1.5 rounded text-sm ${
                      activePrompt === name
                        ? 'bg-cyan-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {config.name || name}
                  </button>
                ))}
                <button
                  onClick={createNewPrompt}
                  className="px-3 py-1.5 bg-gray-700 text-gray-300 hover:bg-gray-600 rounded text-sm"
                >
                  + New
                </button>
              </div>

              {/* Active Prompt Info */}
              {!editingPrompt && prompts[activePrompt] && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-medium">{prompts[activePrompt].name}</h3>
                      <p className="text-sm text-gray-400">{prompts[activePrompt].description}</p>
                    </div>
                    <button
                      onClick={() => startEditingPrompt(activePrompt)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="bg-gray-900 rounded p-3">
                    <pre className="text-sm text-gray-300 whitespace-pre-wrap">
                      {prompts[activePrompt].system_prompt}
                    </pre>
                  </div>
                </div>
              )}

              {/* Prompt Editor */}
              {editingPrompt && editPromptContent && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-lg font-medium mb-3">
                    {editingPrompt in prompts ? 'Edit Prompt' : 'Create New Prompt'}
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Name</label>
                      <input
                        type="text"
                        value={editPromptContent.name}
                        onChange={e => setEditPromptContent({ ...editPromptContent, name: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Description</label>
                      <input
                        type="text"
                        value={editPromptContent.description}
                        onChange={e => setEditPromptContent({ ...editPromptContent, description: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        System Prompt <span className="text-gray-500">(use {'{tools_json}'} to inject tools)</span>
                      </label>
                      <textarea
                        value={editPromptContent.system_prompt}
                        onChange={e => setEditPromptContent({ ...editPromptContent, system_prompt: e.target.value })}
                        rows={15}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm font-mono"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={savePrompt}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded text-sm"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingPrompt(null); setEditPromptContent(null); }}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Agent Tab */}
        {activeTab === 'agent' && (
          <div className="h-full flex flex-col">
            {/* Messages */}
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {messages.length === 0 && !streamingContent ? (
                <div className="text-center text-gray-500 py-8">
                  <p>Start chatting with the MCP Agent</p>
                  <p className="text-sm mt-2">
                    The agent can use tools from the MCP registry to complete tasks.
                  </p>
                </div>
              ) : (
                <>
                  {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-lg p-3 ${
                        msg.role === 'user' ? 'bg-cyan-600 text-white' :
                        msg.role === 'tool_call' ? 'bg-amber-900/30 border border-amber-600/50' :
                        msg.role === 'tool_result' ? 'bg-emerald-900/30 border border-emerald-600/50' :
                        'bg-gray-700 text-gray-100'
                      }`}>
                        {msg.role === 'tool_call' && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-amber-400 text-sm">
                              <span>🔧</span>
                              <span className="font-medium">{msg.toolCall?.name}</span>
                            </div>
                            {msg.toolCall?.arguments && Object.keys(msg.toolCall.arguments).length > 0 && (
                              <pre className="text-xs text-gray-400 overflow-auto max-h-32">
                                {JSON.stringify(msg.toolCall.arguments, null, 2)}
                              </pre>
                            )}
                          </div>
                        )}
                        {msg.role === 'tool_result' && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                              <span className={msg.toolResult?.success ? 'text-emerald-400' : 'text-red-400'}>
                                {msg.toolResult?.success ? '✓' : '✗'}
                              </span>
                              <span className="text-gray-400">Result</span>
                            </div>
                            <pre className="text-xs text-gray-300 overflow-auto max-h-32">
                              {JSON.stringify(msg.toolResult, null, 2)}
                            </pre>
                          </div>
                        )}
                        {(msg.role === 'user' || msg.role === 'assistant') && (
                          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  {streamingContent && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-lg p-3 bg-gray-700 text-gray-100">
                        <div className="whitespace-pre-wrap text-sm">
                          {streamingContent}
                          <span className="inline-block w-2 h-4 bg-cyan-400 ml-0.5 animate-pulse" />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-gray-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  placeholder="Type a message..."
                  disabled={!serverRunning || !serverStatus?.text_model_ready}
                  className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm"
                />
                {isGenerating ? (
                  <button
                    onClick={stopGeneration}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={sendMessage}
                    disabled={!serverRunning || !serverStatus?.text_model_ready || !inputMessage.trim()}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 rounded-lg text-sm"
                  >
                    Send
                  </button>
                )}
                <button
                  onClick={clearChat}
                  disabled={messages.length === 0}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm"
                  title="Clear chat"
                >
                  🗑️
                </button>
              </div>
              {!serverStatus?.text_model_ready && serverRunning && (
                <p className="text-xs text-yellow-500 mt-2">Load a text model in Setup to start chatting</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Logs */}
      <div className="h-20 bg-gray-800 border-t border-gray-700 overflow-auto p-2">
        <div className="text-xs text-gray-500 font-mono space-y-0.5">
          {logs.slice(-8).map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MCPAgentWindow;
