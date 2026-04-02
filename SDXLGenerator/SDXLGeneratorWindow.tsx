import React, { useState, useEffect, useCallback, useRef } from 'react';

// Phosphor-style icon components
const IconServer = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M24,72H232a8,8,0,0,0,0-16H24a8,8,0,0,0,0,16Zm208,32H24a8,8,0,0,0-8,8v48a8,8,0,0,0,8,8H232a8,8,0,0,0,8-8V112A8,8,0,0,0,232,104Zm-8,48H32V120H224ZM232,184H24a8,8,0,0,0-8,8v24a8,8,0,0,0,8,8H232a8,8,0,0,0,8-8V192A8,8,0,0,0,232,184Zm-8,24H32V200H224Zm-28-72a12,12,0,1,1,12,12A12,12,0,0,1,196,136Zm0,80a12,12,0,1,1,12,12A12,12,0,0,1,196,216Z" />
  </svg>
);

const IconCube = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm176,85.78h0l-80,43.79V133.82l32-17.51V152a8,8,0,0,0,16,0V107.55L216,90v85.77Z"/>
  </svg>
);

const IconSparkle = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M197.58,129.06l-51.61-19-19-51.65a15.92,15.92,0,0,0-29.88,0L78.07,110l-51.65,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0l19-51.61,51.65-19a15.92,15.92,0,0,0,0-29.88ZM140.39,163a15.87,15.87,0,0,0-9.43,9.43l-19,51.46L93,172.39A15.87,15.87,0,0,0,83.61,163h0L32.15,144l51.46-19A15.87,15.87,0,0,0,93,115.61l19-51.46,19,51.46a15.87,15.87,0,0,0,9.43,9.43l51.46,19ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z"/>
  </svg>
);

const IconImage = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z"/>
  </svg>
);

const IconPackage = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm176,85.78h0l-80,43.79V133.82l32-17.51V152a8,8,0,0,0,16,0V107.55L216,90v85.77Z"/>
  </svg>
);

const IconTerminal = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200ZM80,136V120a8,8,0,0,1,16,0v16a8,8,0,0,1-16,0Zm48,0V120a8,8,0,0,1,16,0v16a8,8,0,0,1-16,0Zm48,0V120a8,8,0,0,1,16,0v16a8,8,0,0,1-16,0Z"/>
  </svg>
);

const IconPlay = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z"/>
  </svg>
);

const IconStop = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M200,32H56A24,24,0,0,0,32,56V200a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V56A24,24,0,0,0,200,32Zm8,168a8,8,0,0,1-8,8H56a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8H200a8,8,0,0,1,8,8Z"/>
  </svg>
);

const IconFolder = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40ZM216,200H40V88H216Z"/>
  </svg>
);

const IconTrash = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/>
  </svg>
);

const IconMagicWand = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M248,152a8,8,0,0,1-8,8H224v16a8,8,0,0,1-16,0V160H192a8,8,0,0,1,0-16h16V128a8,8,0,0,1,16,0v16h16A8,8,0,0,1,248,152ZM56,72H72V88a8,8,0,0,0,16,0V72h16a8,8,0,0,0,0-16H88V40a8,8,0,0,0-16,0V56H56a8,8,0,0,0,0,16Zm88,144a8,8,0,0,0-8,8v16H120a8,8,0,0,0,0,16h16v16a8,8,0,0,0,16,0V256h16a8,8,0,0,0,0-16H152V224A8,8,0,0,0,144,216Zm90.73-52.22-42.12-42.13,46.47-46.46a24,24,0,0,0-33.94-33.95L158.68,87.7,116.55,45.58a24,24,0,1,0-33.94,33.94l42.12,42.13L78.27,168.1a24,24,0,1,0,33.94,33.94l46.47-46.46,42.12,42.13a24,24,0,1,0,33.94-33.95ZM100.87,190.7a8,8,0,1,1-11.32-11.31l46.47-46.46,11.31,11.31Zm116.28-.05a8,8,0,0,1-11.32,0l-42.12-42.13,11.31-11.31,42.13,42.12A8,8,0,0,1,217.15,190.65ZM205.09,62.85a8,8,0,0,1,0,11.32L158.63,120.6l-11.31-11.31,46.46-46.47A8,8,0,0,1,205.09,62.85ZM100.87,90.91,89.56,79.6,132,37.16a8,8,0,0,1,11.32,11.31Z"/>
  </svg>
);

const IconInfo = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z"/>
  </svg>
);

const IconX = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/>
  </svg>
);

const IconGear = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 256 256">
    <path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8.06,8.06,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8.06,8.06,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z"/>
  </svg>
);

interface VramStats {
  total: number;
  free: number;
  allocated: number;
  used: number;
}

interface ServerStatus {
  model_ready: boolean;
  model_loading: boolean;
  loading_progress: number;
  model_id: string;
  cuda_available: boolean;
  vram: VramStats | null;
  error: string | null;
  generating: boolean;
  generation_progress: number;
  current_image: number;
  total_images: number;
  generation_status: string;
  has_images: boolean;
  num_images: number;
}

interface GeneratedImage {
  base64: string;
  mime_type: string;
  seed: number;
  path: string;
  generation_time: number;
  width: number;
  height: number;
}

interface ModelOption {
  id: string;
  name: string;
  type: string;
}

const SCHEDULERS = ['DPM++ 2M', 'Euler', 'Euler A', 'DDIM', 'PNDM'];
const OUTPUT_FORMATS = ['png', 'jpg', 'webp'];
const PRESETS = [
  { label: 'Portrait', prompt: 'professional portrait photo, studio lighting, sharp focus, high quality' },
  { label: 'Landscape', prompt: 'beautiful landscape photography, golden hour, dramatic sky, high resolution' },
  { label: 'Anime', prompt: 'anime style illustration, detailed, vibrant colors, professional artwork' },
  { label: 'Fantasy', prompt: 'epic fantasy scene, magical lighting, detailed environment, cinematic' },
  { label: 'Cyberpunk', prompt: 'cyberpunk cityscape, neon lights, rain, futuristic, detailed' },
  { label: 'Realistic', prompt: 'hyperrealistic, photorealistic, 8k, detailed, professional photography' },
];

export const SDXLGeneratorWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8766);
  const [allowNetworkAccess, setAllowNetworkAccess] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);

  // Model state
  const [selectedModel, setSelectedModel] = useState('stabilityai/stable-diffusion-xl-base-1.0');
  const [useCpuOffload, setUseCpuOffload] = useState(true);
  const [useFp16, setUseFp16] = useState(true);
  const [enableAttentionSlicing, setEnableAttentionSlicing] = useState(true);
  const [enableVaeTiling, setEnableVaeTiling] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Default models (shown even before server starts)
  const DEFAULT_MODELS: ModelOption[] = [
    { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base 1.0', type: 'huggingface' },
    { id: 'SG161222/RealVisXL_V5.0', name: 'RealVisXL V5.0', type: 'huggingface' },
  ];

  // Generation parameters
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('low quality, blurry, distorted, deformed, ugly, bad anatomy');
  const [numImages, setNumImages] = useState(1);
  const [steps, setSteps] = useState(30);
  const [cfgScale, setCfgScale] = useState(7.5);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [seed, setSeed] = useState(-1);
  const [scheduler, setScheduler] = useState('DPM++ 2M');
  const [outputFormat, setOutputFormat] = useState('png');
  const [jpgQuality, setJpgQuality] = useState(95);
  const [autoSave, setAutoSave] = useState(true);
  const [saveMetadata, setSaveMetadata] = useState(true);

  // Generated images
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState(-1);

  // Logs
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showServerPanel, setShowServerPanel] = useState(true);
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [showQuickstart, setShowQuickstart] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [showSchedulerDropdown, setShowSchedulerDropdown] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Quickstart dependency list and status
  const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'diffusers', 'transformers', 'torch', 'safetensors', 'accelerate'];
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
  }, []);

  // Auto-scroll logs (only if not manually scrolled up)
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

  // Save logs to file
  const saveLogs = useCallback(() => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron - cannot save logs');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logContent = logs.join('\n');
    const fileName = `sdxl-generator-logs-${timestamp}.txt`;

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

  // Listen for Python process logs
  useEffect(() => {
    if (!ipcRenderer) return;

    const handlePythonLog = (_event: any, log: string) => {
      const trimmed = log.trim();
      // Filter out routine polling requests but allow important messages
      const isPollingRequest =
        trimmed.includes('GET /status') ||
        trimmed.includes('GET /health') ||
        trimmed.includes('GET /generation-status') ||
        trimmed.includes('GET /models');

      const isRoutineServerLog =
        trimmed.includes('127.0.0.1:') && (
          trimmed.includes('GET /status') ||
          trimmed.includes('GET /health') ||
          trimmed.includes('GET /generation-status') ||
          trimmed.includes('GET /models')
        );

      // Allow important INFO messages (model loading, errors, etc.)
      // Only filter generic INFO messages about the server starting
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

  // Load available venvs on mount
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

  const getServerUrl = () => `http://127.0.0.1:${serverPort}`;

  const checkServerStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getServerUrl()}/status`);
      if (res.ok) {
        const status = await res.json();
        setServerStatus(status);
        setServerRunning(true);

        if (status.generating === false && status.has_images) {
          const genRes = await fetch(`${getServerUrl()}/generation-status`);
          if (genRes.ok) {
            const genStatus = await genRes.json();
            if (genStatus.images && genStatus.images.length > 0) {
              setGeneratedImages(genStatus.images);
            }
          }
        }

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
    }, 3000);
    return () => clearInterval(interval);
  }, [serverRunning, checkServerStatus]);

  useEffect(() => {
    if (!serverRunning || !serverStatus?.generating) return;

    const pollImages = async () => {
      try {
        const res = await fetch(`${getServerUrl()}/generation-status`);
        if (res.ok) {
          const data = await res.json();
          if (data.images && data.images.length > generatedImages.length) {
            setGeneratedImages(data.images);
            if (selectedImageIdx < 0 || selectedImageIdx < data.images.length - 1) {
              setSelectedImageIdx(data.images.length - 1);
            }
          }
        }
      } catch {
        // Ignore polling errors
      }
    };

    const interval = setInterval(pollImages, 1500);
    return () => clearInterval(interval);
  }, [serverRunning, serverStatus?.generating, generatedImages.length, selectedImageIdx]);

  // EventBus integration - listen for image generation requests from other workflows
  useEffect(() => {
    const EventBus = (window as any).EventBus;
    if (!EventBus) return;

    const eventBus = EventBus.getInstance();

    // Handle generate requests from other workflows
    const handleGenerate = async (data: { prompt: string; negative_prompt?: string; width?: number; height?: number; steps?: number; seed?: number }) => {
      if (!serverRunning || !serverStatus?.model_ready) {
        addLog('[EventBus] Received sdxl:generate but model not ready');
        eventBus.emit('sdxl:error', { error: 'Model not ready' });
        return;
      }

      addLog(`[EventBus] Generating: "${data.prompt.substring(0, 50)}..."`);
      eventBus.emit('sdxl:generation-started', { prompt: data.prompt });

      // Update prompt in UI
      setPrompt(data.prompt);
      if (data.negative_prompt) setNegativePrompt(data.negative_prompt);
      if (data.width) setWidth(data.width);
      if (data.height) setHeight(data.height);
      if (data.steps) setSteps(data.steps);
      if (data.seed !== undefined) setSeed(data.seed);

      setGeneratedImages([]);
      setSelectedImageIdx(-1);
      setIsGenerating(true);

      try {
        const res = await fetch(`${getServerUrl()}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: data.prompt,
            negative_prompt: data.negative_prompt || negativePrompt,
            num_images: 1,
            steps: data.steps || steps,
            cfg_scale: cfgScale,
            width: data.width || width,
            height: data.height || height,
            seed: data.seed !== undefined ? data.seed : seed,
            scheduler,
            output_format: outputFormat,
            jpg_quality: jpgQuality,
            auto_save: autoSave,
            save_metadata: saveMetadata,
          }),
        });

        const result = await res.json();
        if (result.success) {
          setGeneratedImages(result.images);
          setSelectedImageIdx(0);
          addLog(`[EventBus] Generated ${result.images.length} images in ${result.total_time}s`);
          eventBus.emit('sdxl:generation-finished', {
            success: true,
            images: result.images.length,
            time: result.total_time
          });
        } else {
          addLog(`[EventBus] Generation error: ${result.error}`);
          eventBus.emit('sdxl:error', { error: result.error });
        }
      } catch (e: any) {
        addLog(`[EventBus] Error: ${e.message}`);
        eventBus.emit('sdxl:error', { error: e.message });
      } finally {
        setIsGenerating(false);
        await checkServerStatus();
      }
    };

    // Handle stop requests
    const handleStop = async () => {
      addLog('[EventBus] Received sdxl:stop');
      try {
        await fetch(`${getServerUrl()}/stop-generation`, { method: 'POST' });
        eventBus.emit('sdxl:stopped', {});
      } catch (e: any) {
        eventBus.emit('sdxl:error', { error: e.message });
      }
    };

    // Handle status requests
    const handleGetStatus = () => {
      eventBus.emit('sdxl:status', {
        ready: serverStatus?.model_ready || false,
        generating: serverStatus?.generating || false,
        model: serverStatus?.model_id || '',
        progress: serverStatus?.generation_progress || 0
      });
    };

    eventBus.on('sdxl:generate', handleGenerate);
    eventBus.on('sdxl:stop', handleStop);
    eventBus.on('sdxl:get-status', handleGetStatus);

    // Emit ready event when model is loaded
    if (serverStatus?.model_ready) {
      eventBus.emit('sdxl:ready', { model: serverStatus.model_id });
    }

    return () => {
      eventBus.off('sdxl:generate', handleGenerate);
      eventBus.off('sdxl:stop', handleStop);
      eventBus.off('sdxl:get-status', handleGetStatus);
    };
  }, [serverRunning, serverStatus?.model_ready, serverStatus?.generating, serverStatus?.model_id, serverStatus?.generation_progress, negativePrompt, steps, cfgScale, width, height, seed, scheduler, outputFormat, jpgQuality, autoSave, saveMetadata, getServerUrl, checkServerStatus]);

  useEffect(() => {
    const fetchModels = async () => {
      if (!serverRunning) return;
      try {
        const res = await fetch(`${getServerUrl()}/models`);
        if (res.ok) {
          const models = await res.json();
          setAvailableModels(models);
        }
      } catch {
        // Ignore
      }
    };
    fetchModels();
  }, [serverRunning]);

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

      if (serverRunning) {
        const res = await fetch(`${getServerUrl()}/env/check_deps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages: REQUIRED_PACKAGES }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.results) {
            const map: Record<string, any> = {};
            for (const p of REQUIRED_PACKAGES) {
              const r = data.results[p] || {};
              map[p] = { installed: !!r.installed, version: r.version };
            }
            setDepsStatus(map);
            addLog('Dependency status loaded from server environment');
            setCheckingDeps(false);
            return;
          }
        }
      }

      const unknownMap: Record<string, any> = {};
      for (const p of REQUIRED_PACKAGES) unknownMap[p] = { installed: false };
      setDepsStatus(unknownMap);
      addLog('Could not determine dependency status; try starting the server or use Python Manager');
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

        await checkDeps();
        setInstallingDeps(false);
        return;
      }

      if (serverRunning) {
        const res = await fetch(`${getServerUrl()}/env/install_packages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages: missing }),
        });
        const data = await res.json();
        addLog(data?.stdout || JSON.stringify(data));
        await checkDeps();
      } else {
        addLog('ERROR: Cannot install packages - neither Python Manager nor server is available');
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setInstallingDeps(false);
    }
  };

  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting SDXL server...');

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
      workflowFolder: 'SDXLGenerator',
      scriptName: 'sdxl_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find sdxl_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'sdxl',
      extraArgs: allowNetworkAccess ? ['--network'] : [],
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
          addLog('ERROR: Server failed to start within timeout. Check that diffusers, torch, fastapi and uvicorn are installed.');
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

    const result = await ipcRenderer.invoke('python-stop-script-server', 'sdxl');
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

    addLog(`Loading model: ${selectedModel}...`);
    setIsLoadingModel(true);

    // Start fast polling for progress updates
    const progressInterval = setInterval(async () => {
      await checkServerStatus();
    }, 500);

    try {
      const res = await fetch(`${getServerUrl()}/load_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: selectedModel,
          use_cpu_offload: useCpuOffload,
          use_fp16: useFp16,
          enable_attention_slicing: enableAttentionSlicing,
          enable_vae_tiling: enableVaeTiling,
        }),
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
    } finally {
      clearInterval(progressInterval);
      setIsLoadingModel(false);
      await checkServerStatus();
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

  const generateImages = async () => {
    if (!serverRunning || !serverStatus?.model_ready) {
      addLog('ERROR: Model not ready');
      return;
    }

    if (!prompt.trim()) {
      addLog('ERROR: Please enter a prompt');
      return;
    }

    setGeneratedImages([]);
    setSelectedImageIdx(-1);
    setIsGenerating(true);

    addLog(`Generating: "${prompt.substring(0, 50)}..."`);

    // Start fast polling for progress updates during generation
    const progressInterval = setInterval(async () => {
      await checkServerStatus();
    }, 500);

    try {
      const res = await fetch(`${getServerUrl()}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          negative_prompt: negativePrompt,
          num_images: numImages,
          steps,
          cfg_scale: cfgScale,
          width,
          height,
          seed,
          scheduler,
          output_format: outputFormat,
          jpg_quality: jpgQuality,
          auto_save: autoSave,
          save_metadata: saveMetadata,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setGeneratedImages(data.images);
        addLog(`Generated ${data.images.length} images in ${data.total_time}s`);
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      clearInterval(progressInterval);
      setIsGenerating(false);
      await checkServerStatus();
    }
  };

  const stopGeneration = async () => {
    try {
      await fetch(`${getServerUrl()}/stop-generation`, { method: 'POST' });
      addLog('Stop requested');
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const clearCache = async () => {
    try {
      await fetch(`${getServerUrl()}/clear-cache`, { method: 'POST' });
      addLog('GPU cache cleared');
      await checkServerStatus();
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const openFolder = async () => {
    try {
      await fetch(`${getServerUrl()}/open-folder`, { method: 'POST' });
      addLog('Opened output folder');
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  // Panel style with better spacing
  const panelClass = "rounded-xl p-4 border border-white/5 bg-slate-950/80 backdrop-blur-xl shadow-lg";

  return (
    <>
      {/* Scoped styles for this workflow - uses !important to override global CSS */}
      <style>{`
        .sdxl-generator-workflow select {
          background: rgba(30, 41, 59, 0.6) !important;
          background-image: none !important;
        }

        .sdxl-generator-workflow input[type="number"] {
          background: rgba(30, 41, 59, 0.6) !important;
          -moz-appearance: textfield;
        }
        .sdxl-generator-workflow input[type="number"]::-webkit-outer-spin-button,
        .sdxl-generator-workflow input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        .sdxl-generator-workflow textarea {
          background: rgba(30, 41, 59, 0.6) !important;
        }

        /* Model selection labels - override global label backgrounds */
        .sdxl-generator-workflow label.bg-slate-800\\/40 {
          background: rgba(30, 41, 59, 0.4) !important;
        }

        .sdxl-generator-workflow label.bg-purple-500\\/10 {
          background: rgba(168, 85, 247, 0.1) !important;
        }

        /* Custom slider styling */
        .sdxl-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: #334155;
          outline: none;
          cursor: pointer;
        }
        .sdxl-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #a855f7;
          cursor: pointer;
          border: 2px solid #1e1b4b;
          box-shadow: 0 2px 6px rgba(168, 85, 247, 0.4);
          transition: all 0.15s ease;
        }
        .sdxl-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
          box-shadow: 0 2px 10px rgba(168, 85, 247, 0.6);
        }
        .sdxl-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #a855f7;
          cursor: pointer;
          border: 2px solid #1e1b4b;
          box-shadow: 0 2px 6px rgba(168, 85, 247, 0.4);
        }
        .sdxl-slider.cyan::-webkit-slider-thumb {
          background: #06b6d4;
          box-shadow: 0 2px 6px rgba(6, 182, 212, 0.4);
        }
        .sdxl-slider.cyan::-webkit-slider-thumb:hover {
          box-shadow: 0 2px 10px rgba(6, 182, 212, 0.6);
        }
        .sdxl-slider.cyan::-moz-range-thumb {
          background: #06b6d4;
          box-shadow: 0 2px 6px rgba(6, 182, 212, 0.4);
        }
      `}</style>

      <div className="sdxl-generator-workflow h-full flex flex-col overflow-hidden bg-gradient-to-br from-[#0f0f1a] via-[#1a1a2e] to-[#16213e]">
      {/* Compact Header with Status Bar */}
      <div className="flex-none px-4 py-2.5 border-b border-white/10 bg-slate-900/50 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-purple-500/30 flex-shrink-0">
              <IconSparkle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent leading-tight">
                SDXL Generator
              </h2>
              <p className="text-xs text-slate-500">AI Image Generation</p>
            </div>
            <button
              onClick={() => setShowGuide(true)}
              className="p-1 hover:bg-white/5 rounded-lg transition-colors"
              title="How to use"
            >
              <IconInfo className="w-5 h-5 text-slate-400 hover:text-cyan-400" />
            </button>
          </div>

          {/* Status Indicators */}
          <div className="flex items-center gap-3 text-xs">
            {serverRunning ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-emerald-400 font-medium">Running</span>
                </div>
                {serverStatus?.model_ready && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-purple-400">●</span>
                    <span className="text-slate-300">Ready</span>
                  </div>
                )}
                {serverStatus?.vram && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-cyan-400">VRAM:</span>
                    <span className="text-slate-300">{(serverStatus.vram.allocated / 1024 ** 3).toFixed(1)} / {(serverStatus.vram.total / 1024 ** 3).toFixed(0)}GB</span>
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
        {/* LEFT SIDEBAR - Controls (40%) */}
        <div className="w-[40%] border-r border-white/5 overflow-y-auto p-4 space-y-4 bg-black/40">

          {/* Setup & Dependencies */}
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
                    className="w-48 text-xs rounded-lg px-3 py-2.5 border border-white/10 focus:outline-none focus:border-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-slate-800 text-slate-200"
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

                {/* Port & Server Control */}
                <div className="space-y-3 pt-4 border-t border-white/10">
                  <div className="flex items-center gap-3">
                    <label className="font-medium text-xs whitespace-nowrap text-slate-300">Port</label>
                    <input
                      type="number"
                      value={serverPort}
                      onChange={e => setServerPort(parseInt(e.target.value) || 8766)}
                      className="w-32 text-xs rounded-lg px-3 py-2.5 border border-white/10 focus:outline-none focus:border-cyan-500/50 transition-all disabled:opacity-50 bg-slate-800 text-slate-200"
                      disabled={serverRunning}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="allowNetworkAccess"
                      checked={allowNetworkAccess}
                      onChange={e => setAllowNetworkAccess(e.target.checked)}
                      disabled={serverRunning}
                      className="rounded"
                    />
                    <label htmlFor="allowNetworkAccess" className="text-xs text-slate-300">
                      Allow network access (0.0.0.0)
                    </label>
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

                {serverStatus && (
                  <div className="flex flex-wrap gap-2.5 pt-3 text-xs border-t border-white/10">
                    <button
                      onClick={clearCache}
                      className="transition-colors underline flex items-center gap-1 text-slate-400 hover:text-cyan-400"
                    >
                      <IconTrash className="w-3 h-3" />
                      Clear Cache
                    </button>
                    <button
                      onClick={openFolder}
                      className="transition-colors underline flex items-center gap-1 text-slate-400 hover:text-cyan-400"
                    >
                      <IconFolder className="w-3 h-3" />
                      Open Output
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Model Settings - Collapsible */}
          <div className={panelClass}>
            <button
              onClick={() => setShowModelPanel(!showModelPanel)}
              className="w-full text-left flex items-center justify-between mb-3 group bg-transparent"
            >
              <h3 className="text-sm font-semibold text-purple-400 flex items-center gap-2">
                <IconCube className="w-4 h-4" />
                Model
              </h3>
              <span className={`text-purple-400 text-xs transition-transform duration-200 ${showModelPanel ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>

            {showModelPanel && (
              <div className="space-y-4">
                {/* Model Selection Cards */}
                <div className="space-y-2.5">
                  {(availableModels.length > 0 ? availableModels : DEFAULT_MODELS).map(model => (
                    <label
                      key={model.id}
                      className={`relative flex items-center gap-3 px-3.5 py-3 rounded-lg border-2 cursor-pointer transition-all group ${
                        selectedModel === model.id
                          ? 'bg-purple-500/10 border-purple-500/50 shadow-lg shadow-purple-500/20'
                          : 'bg-slate-800/40 border-white/5 hover:border-purple-500/30 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className={`flex-none w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                        selectedModel === model.id
                          ? 'border-purple-500 bg-purple-500'
                          : 'border-slate-600 group-hover:border-purple-500/50'
                      }`}>
                        {selectedModel === model.id && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                        )}
                      </div>
                      <input
                        type="radio"
                        checked={selectedModel === model.id}
                        onChange={() => setSelectedModel(model.id)}
                        disabled={serverStatus?.model_loading}
                        className="sr-only"
                      />
                      <span className={`text-sm font-medium transition-colors ${
                        selectedModel === model.id ? 'text-white' : 'text-slate-300 group-hover:text-white'
                      }`}>
                        {model.name}
                      </span>
                    </label>
                  ))}
                </div>

                {/* Optimization Options */}
                <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-white/5">
                  {[
                    { label: 'CPU Offload', checked: useCpuOffload, onChange: setUseCpuOffload },
                    { label: 'FP16', checked: useFp16, onChange: setUseFp16 },
                    { label: 'Attn Slice', checked: enableAttentionSlicing, onChange: setEnableAttentionSlicing },
                    { label: 'VAE Tile', checked: enableVaeTiling, onChange: setEnableVaeTiling },
                  ].map(({ label, checked, onChange }) => (
                    <label
                      key={label}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                        checked
                          ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                          : 'bg-slate-800/40 border-white/5 text-slate-400 hover:border-purple-500/20 hover:text-slate-300'
                      }`}
                    >
                      <div className={`flex-none w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                        checked
                          ? 'border-purple-500 bg-purple-500'
                          : 'border-slate-600'
                      }`}>
                        {checked && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => onChange(e.target.checked)}
                        className="sr-only"
                      />
                      <span className="text-xs font-medium">{label}</span>
                    </label>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2.5 pt-3">
                  {/* Show Load button if: loading, no model loaded, or different model selected */}
                  {(isLoadingModel || serverStatus?.model_loading || !serverStatus?.model_ready || serverStatus?.model_id !== selectedModel) && (
                    <button
                      onClick={loadModel}
                      disabled={!serverRunning || isLoadingModel || serverStatus?.model_loading}
                      className={`flex-1 px-4 py-3 text-xs font-semibold rounded-lg transition-all shadow-lg text-white ${
                        (!serverRunning || isLoadingModel || serverStatus?.model_loading)
                          ? 'bg-slate-700'
                          : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/20'
                      }`}
                    >
                      {(isLoadingModel || serverStatus?.model_loading) ? `Loading${serverStatus?.loading_progress ? ` ${Math.round(serverStatus.loading_progress * 100)}%` : '...'}` : 'Load Model'}
                    </button>
                  )}
                  {/* Show Unload button only when a model is loaded */}
                  {serverStatus?.model_ready && (
                    <button
                      onClick={unloadModel}
                      className={`${serverStatus?.model_id === selectedModel ? 'flex-1' : ''} px-4 py-3 text-xs font-semibold rounded-lg transition-all shadow-lg text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 shadow-red-500/20`}
                    >
                      Unload
                    </button>
                  )}
                </div>

                {/* Loading Progress */}
                {(isLoadingModel || serverStatus?.model_loading) && (
                  <div className="w-full h-3 bg-slate-800/60 rounded-full overflow-hidden shadow-inner mt-3">
                    <div
                      className={`h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 shadow-lg ${
                        (serverStatus?.loading_progress || 0) > 0 ? 'transition-all duration-300' : 'animate-pulse'
                      }`}
                      style={{
                        width: (serverStatus?.loading_progress || 0) > 0
                          ? `${(serverStatus?.loading_progress || 0) * 100}%`
                          : '100%',
                        opacity: (serverStatus?.loading_progress || 0) > 0 ? 1 : 0.6
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Generation Settings */}
          <div className={panelClass}>
            <h3 className="text-sm font-semibold text-pink-400 mb-3 flex items-center gap-2">
              <IconSparkle className="w-4 h-4" />
              Generation
            </h3>

            {/* Presets */}
            <div className="flex flex-wrap gap-2 mb-4">
              {PRESETS.map(preset => (
                <button
                  key={preset.label}
                  onClick={() => setPrompt(preset.prompt)}
                  className="px-3 py-2 border text-xs rounded-lg transition-all font-medium shadow-sm bg-slate-800/40 border-white/10 text-slate-300 hover:bg-pink-500/20 hover:border-pink-500/50 hover:text-pink-300"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Prompt */}
            <div className="space-y-2 mb-3.5">
              <label className="block text-xs font-semibold text-slate-300">Prompt</label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                className="w-full h-20 text-slate-100 text-xs rounded-lg px-4 py-3 border border-white/10 focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 focus:outline-none resize-none transition-all placeholder-slate-500"
                placeholder="Describe the image you want to generate..."
              />
            </div>

            <div className="space-y-2 mb-3.5">
              <label className="block text-xs font-semibold text-slate-300">Negative Prompt</label>
              <textarea
                value={negativePrompt}
                onChange={e => setNegativePrompt(e.target.value)}
                className="w-full h-14 text-slate-100 text-xs rounded-lg px-4 py-2.5 border border-white/10 focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 focus:outline-none resize-none transition-all placeholder-slate-500"
                placeholder="What to avoid..."
              />
            </div>

            {/* Parameters Grid */}
            {/* Generation Settings */}
            <div className="space-y-4 mb-4">
              {/* Row 1: Images & Steps */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-medium text-slate-300">Images</label>
                    <span className="text-xs text-purple-400 font-semibold bg-purple-500/10 px-2 py-0.5 rounded">{numImages}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={numImages}
                    onChange={e => setNumImages(parseInt(e.target.value))}
                    className="sdxl-slider"
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-medium text-slate-300">Steps</label>
                    <span className="text-xs text-purple-400 font-semibold bg-purple-500/10 px-2 py-0.5 rounded">{steps}</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={steps}
                    onChange={e => setSteps(parseInt(e.target.value))}
                    className="sdxl-slider"
                  />
                </div>
              </div>

              {/* Row 2: CFG & Seed */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-medium text-slate-300">CFG Scale</label>
                    <span className="text-xs text-purple-400 font-semibold bg-purple-500/10 px-2 py-0.5 rounded">{cfgScale}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="0.5"
                    value={cfgScale}
                    onChange={e => setCfgScale(parseFloat(e.target.value))}
                    className="sdxl-slider"
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-medium text-slate-300">Seed</label>
                    <span className="text-xs text-slate-400">{seed === -1 ? 'Random' : ''}</span>
                  </div>
                  <input
                    type="number"
                    value={seed}
                    onChange={e => setSeed(parseInt(e.target.value) || -1)}
                    className="w-full text-xs rounded-lg px-3 py-1.5 border border-white/10 focus:border-purple-500/50 focus:outline-none bg-slate-800 text-slate-200"
                    placeholder="-1 for random"
                  />
                </div>
              </div>

              {/* Row 3: Dimensions */}
              <div className="pt-2 border-t border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-medium text-slate-300">Dimensions</span>
                  <span className="text-xs text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">{width} × {height}</span>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs text-slate-400">Width</label>
                      <span className="text-xs text-cyan-400 font-medium">{width}</span>
                    </div>
                    <input
                      type="range"
                      min="512"
                      max="1536"
                      step="64"
                      value={width}
                      onChange={e => setWidth(parseInt(e.target.value))}
                      className="sdxl-slider cyan"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs text-slate-400">Height</label>
                      <span className="text-xs text-cyan-400 font-medium">{height}</span>
                    </div>
                    <input
                      type="range"
                      min="512"
                      max="1536"
                      step="64"
                      value={height}
                      onChange={e => setHeight(parseInt(e.target.value))}
                      className="sdxl-slider cyan"
                    />
                  </div>
                </div>
              </div>

              {/* Row 4: Scheduler */}
              <div className="pt-2 border-t border-white/5">
                <label className="text-xs font-medium text-slate-300 block mb-2">Scheduler</label>
                <div className="relative">
                  <button
                    onClick={() => setShowSchedulerDropdown(!showSchedulerDropdown)}
                    className="w-full text-xs rounded-lg px-3 py-2 border border-white/10 hover:border-pink-500/30 focus:border-pink-500/50 focus:outline-none cursor-pointer text-left flex items-center justify-between transition-colors bg-slate-800 text-slate-200"
                  >
                    <span>{scheduler}</span>
                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showSchedulerDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showSchedulerDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowSchedulerDropdown(false)} />
                      <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/10 shadow-xl z-20 overflow-hidden bg-slate-800">
                        {SCHEDULERS.map(s => (
                          <button
                            key={s}
                            onClick={() => {
                              setScheduler(s);
                              setShowSchedulerDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                              scheduler === s
                                ? 'bg-pink-500/20 text-pink-300'
                                : 'text-slate-300 hover:bg-slate-700/50'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Auto-save toggle */}
            <div className="flex items-center justify-between mb-3 px-1">
              <div onClick={() => setAutoSave(!autoSave)} className="flex items-center gap-2.5 cursor-pointer select-none">
                <div className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 ${autoSave ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${autoSave ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
                <span className="text-xs text-slate-300">Auto-save images</span>
              </div>
              <span className="text-xs text-slate-500">{autoSave ? 'Saved automatically' : 'Manual save'}</span>
            </div>

            {/* Generate Button */}
            {!(isGenerating || serverStatus?.generating) ? (
              <button
                onClick={generateImages}
                disabled={!serverStatus?.model_ready}
                className={`w-full px-6 py-3.5 text-sm font-bold rounded-lg transition-all shadow-xl flex items-center justify-center gap-2 text-white ${
                  !serverStatus?.model_ready
                    ? 'bg-slate-600'
                    : 'bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500'
                }`}
              >
                <IconSparkle className="w-4 h-4" />
                Generate Images
              </button>
            ) : (
              <div className="space-y-2.5">
                <button
                  onClick={stopGeneration}
                  className="w-full px-6 py-3.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500"
                >
                  <IconStop className="w-4 h-4" />
                  Stop Generation
                </button>
                <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 ${
                      serverStatus?.generating ? 'transition-all duration-300' : 'animate-pulse'
                    }`}
                    style={{
                      width: serverStatus?.generating
                        ? `${Math.max(5, (serverStatus.generation_progress || 0) * 100)}%`
                        : '100%',
                      opacity: serverStatus?.generating ? 1 : 0.6
                    }}
                  />
                </div>
                <p className="text-xs text-slate-300 text-center font-medium">
                  {serverStatus?.generating
                    ? (serverStatus.generation_status || `Generating image ${serverStatus.current_image || 1} of ${serverStatus.total_images || 1}...`)
                    : 'Starting generation...'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL - Preview & Gallery (60%) */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/30">
          {generatedImages.length > 0 ? (
            <>
              {/* Large Preview */}
              <div className="flex-1 min-h-0 p-6 flex flex-col items-center justify-center">
                {selectedImageIdx >= 0 && generatedImages[selectedImageIdx] && (
                  <>
                    <div className="flex-1 min-h-0 w-full flex items-center justify-center">
                      <img
                        src={`data:${generatedImages[selectedImageIdx].mime_type};base64,${generatedImages[selectedImageIdx].base64}`}
                        alt={`Generated ${selectedImageIdx + 1}`}
                        className="max-w-full max-h-full object-contain rounded-xl shadow-2xl border border-white/10"
                      />
                    </div>
                    <div className="flex-none mt-4 flex gap-6 text-xs text-slate-400">
                      <span><span className="text-purple-400">Seed:</span> {generatedImages[selectedImageIdx].seed}</span>
                      <span><span className="text-cyan-400">Time:</span> {generatedImages[selectedImageIdx].generation_time}s</span>
                      <span><span className="text-pink-400">Size:</span> {generatedImages[selectedImageIdx].width}x{generatedImages[selectedImageIdx].height}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Thumbnail Gallery */}
              <div className="flex-none border-t border-white/10 p-4 bg-slate-900/50">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-emerald-400 flex items-center gap-2">
                    <IconImage className="w-3.5 h-3.5" />
                    Generated Images ({generatedImages.length})
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* Save button (only show if not auto-save) */}
                    {!autoSave && generatedImages.length > 0 && (
                      <button
                        onClick={async () => {
                          if (isSaving) return;
                          setIsSaving(true);
                          setSaveSuccess(false);
                          try {
                            const res = await fetch(`http://127.0.0.1:${serverPort}/save-images`, { method: 'POST' });
                            const data = await res.json();
                            if (data.success) {
                              addLog(`Saved ${generatedImages.length} images to ${data.output_path}`);
                              setSaveSuccess(true);
                              setTimeout(() => setSaveSuccess(false), 3000);
                            } else {
                              addLog(`Save failed: ${data.error}`);
                            }
                          } catch (e) {
                            addLog(`Save error: ${e}`);
                          } finally {
                            setIsSaving(false);
                          }
                        }}
                        disabled={isSaving}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded transition-all ${
                          saveSuccess
                            ? 'bg-emerald-500 text-white'
                            : isSaving
                            ? 'bg-slate-600 text-slate-400 cursor-wait'
                            : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        }`}
                      >
                        {isSaving ? (
                          <>
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Saving...
                          </>
                        ) : saveSuccess ? (
                          <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Saved!
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                            </svg>
                            Save
                          </>
                        )}
                      </button>
                    )}
                    {/* Open folder button */}
                    <button
                      onClick={async () => {
                        try {
                          await fetch(`http://127.0.0.1:${serverPort}/open-folder`, { method: 'POST' });
                        } catch (e) {
                          addLog(`Open folder error: ${e}`);
                        }
                      }}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-slate-700/50 text-slate-300 hover:bg-slate-700 transition-colors"
                      title="Open output folder"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                      </svg>
                      Open Folder
                    </button>
                  </div>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-4 pt-2 px-1">
                  {generatedImages.map((img, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedImageIdx(idx)}
                      className={`flex-none cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                        selectedImageIdx === idx
                          ? 'border-purple-500 shadow-lg shadow-purple-500/30 scale-105'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <img
                        src={`data:${img.mime_type};base64,${img.base64}`}
                        alt={`Thumbnail ${idx + 1}`}
                        className="w-20 h-20 object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              <div className="text-center space-y-3">
                <IconImage className="w-16 h-16 mx-auto text-slate-700" />
                <p>Generated images will appear here</p>
                <p className="text-xs">Configure settings and click Generate to start</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Logs Panel */}
      <div className="flex-none border-t border-white/10 bg-slate-900/90 backdrop-blur-xl">
        <div
          onClick={() => setShowLogsPanel(!showLogsPanel)}
          className="w-full px-4 py-2 flex items-center justify-between text-xs font-medium text-slate-500 hover:text-slate-400 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <IconTerminal className="w-3.5 h-3.5" />
            Console Output ({logs.length})
          </span>
          <div className="flex items-center gap-3">
            {logs.length > 0 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); saveLogs(); }}
                  className="flex items-center gap-1 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setLogs([]); }}
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Clear
                </button>
              </>
            )}
            <span className={`transition-transform duration-200 ${showLogsPanel ? 'rotate-180' : ''}`}>▼</span>
          </div>
        </div>
        {showLogsPanel && (
          <div className="relative">
            <div
              ref={logsContainerRef}
              onScroll={handleLogsScroll}
              className="h-32 overflow-y-auto px-4 pb-2 font-mono text-xs border-t border-white/5"
            >
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={
                    log.includes('ERROR') ? 'text-red-400' :
                    log.includes('complete') || log.includes('success') || log.includes('Connected') || log.includes('loaded') ? 'text-emerald-400' :
                    log.includes('WARNING') ? 'text-amber-400' :
                    'text-slate-500'
                  }
                >
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* How-to Guide Modal */}
      {showGuide && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-6">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border border-white/10 shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/80">
              <h3 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent flex items-center gap-3">
                <IconInfo className="w-6 h-6 text-cyan-400" />
                Quick Start Guide
              </h3>
              <button
                onClick={() => setShowGuide(false)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Close"
              >
                <IconX className="w-5 h-5 text-slate-400 hover:text-white" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="overflow-y-auto p-6 space-y-5">
              {/* Step 1 */}
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-cyan-600 text-white flex items-center justify-center text-sm font-bold shadow-lg">1</div>
                <div className="flex-1 space-y-1.5">
                  <h4 className="font-bold text-cyan-400 text-base">Setup Python Environment</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Select a Python virtual environment from the dropdown. If you don't have one, create it using the Python Manager first.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-white flex items-center justify-center text-sm font-bold shadow-lg">2</div>
                <div className="flex-1 space-y-1.5">
                  <h4 className="font-bold text-purple-400 text-base">Install Dependencies</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Check the Python Packages section. If any packages show a red X, click <span className="text-emerald-400 font-semibold">"Install All"</span> to install missing dependencies.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 text-white flex items-center justify-center text-sm font-bold shadow-lg">3</div>
                <div className="flex-1 space-y-1.5">
                  <h4 className="font-bold text-pink-400 text-base">Start the Server</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Once all dependencies are installed (green checkmarks), click <span className="text-purple-400 font-semibold">"Start Server"</span>. The status will show "Running" when ready.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center text-sm font-bold shadow-lg">4</div>
                <div className="flex-1 space-y-1.5">
                  <h4 className="font-bold text-emerald-400 text-base">Load a Model</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Open the <span className="text-purple-400 font-semibold">"Model"</span> panel, select your SDXL model, and click <span className="text-emerald-400 font-semibold">"Load Model"</span>. Wait for the progress bar to complete.
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    <span className="text-emerald-400">Tip:</span> Enable CPU Offload and FP16 to reduce VRAM usage.
                  </p>
                </div>
              </div>

              {/* Step 5 */}
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-yellow-600 text-white flex items-center justify-center text-sm font-bold shadow-lg">5</div>
                <div className="flex-1 space-y-1.5">
                  <h4 className="font-bold text-yellow-400 text-base">Generate Images</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Enter your prompt and adjust settings like steps and CFG scale. Click <span className="text-pink-400 font-semibold">"Generate Images"</span> to start creating.
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    <span className="text-yellow-400">Tip:</span> Use preset buttons for quick prompt templates.
                  </p>
                </div>
              </div>

              {/* Settings Guide */}
              <div className="mt-6 pt-5 border-t border-white/10">
                <h4 className="font-bold text-slate-200 text-base mb-3 flex items-center gap-2">
                  <IconSparkle className="w-4 h-4 text-cyan-400" />
                  Key Settings
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <p className="text-cyan-400 font-semibold text-xs">Steps (30-50)</p>
                    <p className="text-slate-400 text-xs">Higher = better quality, slower</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-cyan-400 font-semibold text-xs">CFG Scale (7-12)</p>
                    <p className="text-slate-400 text-xs">How closely to follow prompt</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-cyan-400 font-semibold text-xs">Seed</p>
                    <p className="text-slate-400 text-xs">Use same seed for reproducibility</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-cyan-400 font-semibold text-xs">Size (1024x1024)</p>
                    <p className="text-slate-400 text-xs">SDXL optimal resolution</p>
                  </div>
                </div>
              </div>

              {/* Troubleshooting */}
              <div className="mt-4 pt-5 border-t border-white/10">
                <h4 className="font-bold text-red-400 text-base mb-3 flex items-center gap-2">
                  <IconInfo className="w-4 h-4" />
                  Troubleshooting
                </h4>
                <div className="space-y-2 text-xs">
                  <p className="text-slate-300"><span className="text-red-400 font-semibold">Out of memory?</span> Enable CPU Offload, FP16, and Attention Slicing</p>
                  <p className="text-slate-300"><span className="text-red-400 font-semibold">Server won't start?</span> Check Console Output for errors</p>
                  <p className="text-slate-300"><span className="text-red-400 font-semibold">Slow generation?</span> Reduce image size or steps</p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-white/10 bg-slate-900/80">
              <button
                onClick={() => setShowGuide(false)}
                className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};
