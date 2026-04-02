import React, { useState, useEffect, useCallback, useRef } from 'react';

interface VramStats {
  total: number;
  free: number;
  allocated: number;
  used: number;
}

interface ServerStatus {
  model_ready: boolean;
  model_loading: boolean;
  model_size: string;
  sample_rate: number;
  cuda_available: boolean;
  vram: VramStats | null;
  error: string | null;
  has_audio: boolean;
  audio_duration: number;
}

interface AudioHistoryItem {
  id: string;
  prompt: string;
  audio: Float32Array;
  sampleRate: number;
  duration: number;
  timestamp: number;
  generationTime: number;
  settings: {
    duration?: number;
    temperature: number;
    topK: number;
    guidanceScale: number;
    extended?: boolean;
    targetDuration?: number;
  };
}

interface SongSection {
  id: string;
  name: string;
  prompt: string;
  duration: number;
  temperature: number;
  guidanceScale: number;
}

interface StructurePreset {
  name: string;
  description: string;
  basePrompt: string;
  sections: Omit<SongSection, 'id'>[];
}

const MODEL_SIZES = ['small', 'medium', 'large', 'melody'];

const REQUIRED_PACKAGES = [
  'fastapi',
  'uvicorn',
  'torch',
  'transformers',
  'accelerate',
  'numpy',
  'scipy',
];

const CUDA_PACKAGES: Record<string, { installCmd: string; checkCuda: (v: string) => boolean }> = {
  'torch': {
    installCmd: 'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124',
    checkCuda: (version: string) => version.includes('+cu'),
  },
};

const normalizePackageName = (name: string): string =>
  name.toLowerCase().replace(/-/g, '_').split('>=')[0].split('==')[0];

// Parse package info from pip list output
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

const PRESETS = [
  { category: 'Chill', label: 'Lo-fi', prompt: 'lo-fi hip hop, jazzy chords, vinyl crackle, mellow drums, chill vibes' },
  { category: 'Chill', label: 'Ambient', prompt: 'ambient atmospheric soundscape, ethereal pads, subtle textures, peaceful' },
  { category: 'Chill', label: 'Chillout', prompt: 'downtempo chill, soft pads, gentle beats, relaxing atmosphere, lounge vibes' },

  { category: 'Electronic', label: 'Synthwave', prompt: '80s synthwave, arpeggiated synths, driving bassline, retro drums, neon vibes' },
  { category: 'Electronic', label: 'Electronic', prompt: 'electronic dance music, pulsing synths, four on the floor beat, energetic' },
  { category: 'Electronic', label: 'House', prompt: 'four on the floor kick, synthesized bass, piano stabs, uplifting, club energy' },
  { category: 'Electronic', label: 'Drum & Bass', prompt: 'fast breakbeats, heavy sub bass, atmospheric pads, high energy, 170 bpm feel' },
  { category: 'Electronic', label: 'Trap', prompt: '808 bass, hi-hat rolls, snappy snares, dark atmosphere, modern hip-hop' },

  { category: 'Rock/Metal', label: 'Rock', prompt: 'energetic rock guitar riffs, driving drums, powerful bass, anthemic' },
  { category: 'Rock/Metal', label: 'Metal', prompt: 'heavy metal, distorted guitars, double bass drums, aggressive, dark atmosphere' },

  { category: 'Jazz/Blues', label: 'Jazz', prompt: 'smooth jazz, saxophone solo, piano chords, upright bass, brushed drums' },
  { category: 'Jazz/Blues', label: 'Blues', prompt: 'blues guitar, soulful bends, walking bass, shuffle drums, melancholic' },
  { category: 'Jazz/Blues', label: 'Funk', prompt: 'funky bass groove, rhythm guitar, tight drums, brass section, danceable' },

  { category: 'World', label: 'Classical', prompt: 'classical orchestra, strings section, woodwinds, elegant piano, baroque style' },
  { category: 'World', label: 'Folk', prompt: 'acoustic folk, fingerstyle guitar, harmonica, earthy percussion, storytelling vibe' },
  { category: 'World', label: 'Reggae', prompt: 'reggae rhythm, offbeat guitar skank, deep bassline, laid-back drums, island vibes' },
  { category: 'World', label: 'Country', prompt: 'country music, steel guitar, banjo, upright bass, storytelling lyrics feel' },
  { category: 'World', label: 'World Music', prompt: 'world music fusion, ethnic percussion, traditional instruments, cultural blend' },

  { category: 'Cinematic', label: 'Epic', prompt: 'epic cinematic orchestral, powerful brass, soaring strings, dramatic percussion' },
  { category: 'Cinematic', label: 'Orchestral Epic', prompt: 'epic cinematic, full orchestra, massive percussion, triumphant horns, heroic' },
  { category: 'Cinematic', label: 'Experimental', prompt: 'experimental soundscape, glitchy textures, unconventional rhythms, avant-garde' },
];

const MAX_HISTORY_ITEMS = 10;

const STRUCTURE_PRESETS: StructurePreset[] = [
  {
    name: 'Simple',
    description: 'Intro → Main → Outro',
    basePrompt: '',
    sections: [
      { name: 'Intro', prompt: 'intro, building, atmospheric, sparse, anticipation', duration: 10, temperature: 0.9, guidanceScale: 3.5 },
      { name: 'Main', prompt: 'full arrangement, steady rhythm, melodic, engaging', duration: 40, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Outro', prompt: 'outro, fading, resolution, sparse, peaceful ending', duration: 10, temperature: 0.9, guidanceScale: 3.5 },
    ],
  },
  {
    name: 'Pop Structure',
    description: 'Intro → Verse → Chorus → Verse → Chorus → Outro',
    basePrompt: '',
    sections: [
      { name: 'Intro', prompt: 'intro, building, atmospheric, sparse', duration: 10, temperature: 0.9, guidanceScale: 3.5 },
      { name: 'Verse 1', prompt: 'verse, steady rhythm, melodic, grounded, restrained', duration: 20, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Chorus', prompt: 'chorus, full energy, hook, memorable melody, powerful', duration: 15, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Verse 2', prompt: 'verse, steady rhythm, melodic, slight variation', duration: 20, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Chorus 2', prompt: 'chorus, full energy, hook, climactic, intense', duration: 15, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Outro', prompt: 'outro, fading, resolution, peaceful ending', duration: 10, temperature: 0.9, guidanceScale: 3.5 },
    ],
  },
  {
    name: 'Extended Jam',
    description: 'Intro → Build → Peak → Wind-down',
    basePrompt: '',
    sections: [
      { name: 'Intro', prompt: 'intro, minimal, atmospheric, mysterious, building slowly', duration: 15, temperature: 0.8, guidanceScale: 4.0 },
      { name: 'Build', prompt: 'building energy, adding layers, growing intensity, groove', duration: 30, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Peak', prompt: 'peak energy, full arrangement, climactic, powerful, driving', duration: 30, temperature: 1.1, guidanceScale: 2.5 },
      { name: 'Wind-down', prompt: 'winding down, fading energy, peaceful, resolution, sparse', duration: 15, temperature: 0.9, guidanceScale: 3.5 },
    ],
  },
  {
    name: 'Cinematic',
    description: 'Ambient → Rising → Climax → Resolution',
    basePrompt: 'cinematic orchestral, epic film score, emotional',
    sections: [
      { name: 'Ambient', prompt: 'ambient, atmospheric, mysterious, subtle textures', duration: 15, temperature: 0.8, guidanceScale: 4.0 },
      { name: 'Rising', prompt: 'rising tension, building drama, orchestral swells, anticipation', duration: 25, temperature: 0.9, guidanceScale: 3.5 },
      { name: 'Climax', prompt: 'epic climax, full orchestra, powerful, dramatic, triumphant', duration: 20, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Resolution', prompt: 'resolution, peaceful, reflective, fading, emotional conclusion', duration: 15, temperature: 0.8, guidanceScale: 4.0 },
    ],
  },
  {
    name: 'Lo-Fi 2min',
    description: 'Chill lo-fi hip hop track (2 minutes)',
    basePrompt: 'lo-fi hip hop, jazzy chords, vinyl crackle, mellow drums, chill vibes, warm bass',
    sections: [
      { name: 'Intro', prompt: 'intro, soft piano, gentle fade in, nostalgic', duration: 15, temperature: 0.85, guidanceScale: 3.5 },
      { name: 'Verse A', prompt: 'laid back groove, relaxed, steady', duration: 25, temperature: 0.95, guidanceScale: 3.0 },
      { name: 'Hook', prompt: 'melodic hook, dreamy, emotional', duration: 20, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Verse B', prompt: 'subtle variation, consistent groove', duration: 25, temperature: 0.95, guidanceScale: 3.0 },
      { name: 'Hook 2', prompt: 'return to hook, fuller sound', duration: 20, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Outro', prompt: 'outro, fading out, peaceful ending', duration: 15, temperature: 0.85, guidanceScale: 3.5 },
    ],
  },
  {
    name: 'Synthwave 2min',
    description: 'Retro 80s synthwave track (2 minutes)',
    basePrompt: '80s synthwave, arpeggiated synths, retro drums, pulsing bass, neon vibes, driving beat',
    sections: [
      { name: 'Intro', prompt: 'intro, sparse, building slowly', duration: 15, temperature: 0.9, guidanceScale: 3.5 },
      { name: 'Build', prompt: 'building, adding layers, growing energy', duration: 20, temperature: 0.95, guidanceScale: 3.0 },
      { name: 'Main A', prompt: 'full energy, driving, melodic', duration: 25, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Breakdown', prompt: 'breakdown, softer, atmospheric', duration: 15, temperature: 0.9, guidanceScale: 3.0 },
      { name: 'Main B', prompt: 'return to full energy, climactic', duration: 30, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Outro', prompt: 'outro, fading, peaceful ending', duration: 15, temperature: 0.9, guidanceScale: 3.5 },
    ],
  },
  {
    name: 'Synthwave Smooth',
    description: 'Continuous synthwave flow (2 min, fewer transitions)',
    basePrompt: '80s synthwave, arpeggiated synths, retro drums, pulsing bass, neon vibes, driving beat',
    sections: [
      { name: 'Intro', prompt: 'intro, gentle start, building anticipation', duration: 20, temperature: 0.9, guidanceScale: 3.5 },
      { name: 'Main', prompt: 'full arrangement, energetic, driving rhythm', duration: 80, temperature: 1.0, guidanceScale: 3.0 },
      { name: 'Outro', prompt: 'outro, gradual fade, resolution', duration: 20, temperature: 0.9, guidanceScale: 3.5 },
    ],
  },
  {
    name: 'Lo-Fi Smooth',
    description: 'Continuous lo-fi flow (2 min, fewer transitions)',
    basePrompt: 'lo-fi hip hop, jazzy chords, vinyl crackle, mellow drums, chill vibes, warm bass',
    sections: [
      { name: 'Intro', prompt: 'intro, gentle fade in, sparse', duration: 15, temperature: 0.9, guidanceScale: 3.5 },
      { name: 'Main', prompt: 'steady groove, mellow, consistent vibe', duration: 90, temperature: 0.95, guidanceScale: 3.0 },
      { name: 'Outro', prompt: 'outro, fading out, peaceful', duration: 15, temperature: 0.9, guidanceScale: 3.5 },
    ],
  },
];

const SECTION_PROMPT_HINTS: Record<string, string> = {
  'intro': 'intro, building, atmospheric, sparse, anticipation',
  'verse': 'verse, steady rhythm, melodic, grounded, restrained',
  'chorus': 'chorus, full energy, hook, memorable melody, powerful',
  'bridge': 'bridge, contrast, breakdown, emotional shift, different',
  'outro': 'outro, fading, resolution, sparse, peaceful ending',
  'build': 'building energy, adding layers, growing intensity',
  'peak': 'peak energy, full arrangement, climactic, powerful',
  'breakdown': 'breakdown, minimal, stripped back, spacious',
};

export const MusicGenWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8765);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>(() => {
    try {
      return localStorage.getItem('musicgen_selectedVenv') || '';
    } catch {
      return '';
    }
  });

  // Dependency management
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version: string; needsCuda?: boolean }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);
  const [depsExpanded, setDepsExpanded] = useState(true);

  // Audio history
  const [audioHistory, setAudioHistory] = useState<AudioHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Logs resize
  const [logsHeight, setLogsHeight] = useState(200);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  // Model state
  const [selectedModel, setSelectedModel] = useState('small');
  const [device, setDevice] = useState('auto');
  const [useFp16, setUseFp16] = useState(true);

  // Generation parameters
  const [prompt, setPrompt] = useState('lo-fi hip hop, jazzy chords, vinyl crackle, mellow drums, chill vibes');
  const [duration, setDuration] = useState(10);
  const [temperature, setTemperature] = useState(1.0);
  const [topK, setTopK] = useState(250);
  const [topP, setTopP] = useState(0.0);
  const [guidanceScale, setGuidanceScale] = useState(3.0);

  // Extended generation
  const [useExtended, setUseExtended] = useState(false);
  const [targetDuration, setTargetDuration] = useState(60);
  const [contextSeconds, setContextSeconds] = useState(10);
  const [segmentDuration, setSegmentDuration] = useState(20);

  // Structured song generation
  const [useStructured, setUseStructured] = useState(false);
  const [sections, setSections] = useState<SongSection[]>([]);
  const [basePrompt, setBasePrompt] = useState('');
  const [structuredContextSeconds, setStructuredContextSeconds] = useState(10);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(1);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<Float32Array | null>(null);
  const [audioSampleRate, setAudioSampleRate] = useState(32000);
  const [lastGenTime, setLastGenTime] = useState(0);
  const [savedPath, setSavedPath] = useState('');

  // Logs
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Audio playback
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
  }, []);

  // Listen for Python process logs from main process
  useEffect(() => {
    if (!ipcRenderer) return;

    const handlePythonLog = (_event: any, log: string) => {
      const trimmed = log.trim();
      // Filter out noisy status polling logs
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

  // Save selectedVenv to localStorage
  useEffect(() => {
    if (selectedVenv) {
      try {
        localStorage.setItem('musicgen_selectedVenv', selectedVenv);
      } catch {
        // Ignore storage errors
      }
    }
  }, [selectedVenv]);

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

  const getServerUrl = () => `http://127.0.0.1:${serverPort}`;

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
    addLog('Starting MusicGen server...');

    // First check if server is already running
    const alreadyRunning = await checkServerStatus();
    if (alreadyRunning) {
      addLog('Server already running!');
      setConnecting(false);
      return;
    }

    // Use the selected venv
    if (!selectedVenv) {
      addLog('ERROR: No Python virtual environment selected. Create one in Python Manager first.');
      setConnecting(false);
      return;
    }

    addLog(`Using venv: ${selectedVenv}`);

    // Get the script path from workflow folder
    const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
      workflowFolder: 'MusicGen',
      scriptName: 'musicgen_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find musicgen_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    // Start as a managed script server
    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'musicgen',
    });

    if (result.success) {
      addLog(`Server process started (PID: ${result.pid}), waiting for connection...`);

      // Poll for server to be ready
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

    // First try to stop via PythonManager
    const result = await ipcRenderer.invoke('python-stop-script-server', 'musicgen');
    if (result.success) {
      addLog('Server stopped');
      setServerRunning(false);
      setServerStatus(null);
    } else {
      // If not tracked, try to send shutdown request to the server itself
      try {
        await fetch(`${getServerUrl()}/shutdown`, { method: 'POST' });
        addLog('Server shutdown requested');
      } catch {
        // Server might have already stopped or doesn't have shutdown endpoint
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

    addLog(`Loading model: facebook/musicgen-${selectedModel}...`);

    try {
      const res = await fetch(`${getServerUrl()}/load_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_size: selectedModel,
          device,
          use_fp16: useFp16,
        }),
      });

      const data = await res.json();
      if (data.success) {
        addLog(`Model loaded on ${data.device}, sample rate: ${data.sample_rate}Hz`);
        setAudioSampleRate(data.sample_rate);
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

  const generateMusic = async () => {
    if (!serverRunning || !serverStatus?.model_ready) {
      addLog('ERROR: Model not ready');
      return;
    }

    setGenerating(true);
    setGeneratedAudio(null);
    setSavedPath('');

    const endpoint = useExtended ? '/generate_extended' : '/generate';
    const body = useExtended
      ? {
          prompt,
          target_duration: targetDuration,
          context_seconds: contextSeconds,
          segment_duration: segmentDuration,
          temperature,
          top_k: topK,
          top_p: topP,
          guidance_scale: guidanceScale,
        }
      : {
          prompt,
          duration,
          temperature,
          top_k: topK,
          top_p: topP,
          guidance_scale: guidanceScale,
        };

    addLog(`Generating: "${prompt.substring(0, 50)}..."`);

    try {
      const res = await fetch(`${getServerUrl()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        // Decode base64 audio
        const audioBytes = Uint8Array.from(atob(data.audio_b64), c => c.charCodeAt(0));
        const audioFloat = new Float32Array(audioBytes.buffer);

        setGeneratedAudio(audioFloat);
        setAudioSampleRate(data.sample_rate);
        setLastGenTime(data.generation_time);

        // Add to history
        addToHistory(audioFloat, data.sample_rate, data.generation_time);

        addLog(`Generated ${data.duration.toFixed(1)}s in ${data.generation_time.toFixed(1)}s`);
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const playAudio = () => {
    if (!generatedAudio) return;

    // Stop if already playing
    if (isPlaying && audioSourceRef.current) {
      audioSourceRef.current.stop();
      setIsPlaying(false);
      return;
    }

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const ctx = audioContextRef.current;
      const buffer = ctx.createBuffer(1, generatedAudio.length, audioSampleRate);
      buffer.copyToChannel(generatedAudio, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlaying(false);

      audioSourceRef.current = source;
      source.start();
      setIsPlaying(true);
    } catch (e: any) {
      addLog(`Playback error: ${e.message}`);
    }
  };

  const saveAudio = async () => {
    if (!generatedAudio || !ipcRenderer) return;

    const timestamp = Date.now();
    const filename = `musicgen_${timestamp}.wav`;

    try {
      const res = await fetch(`${getServerUrl()}/save_audio?filename=${filename}&output_dir=music_output`, {
        method: 'POST',
      });

      const data = await res.json();
      if (data.success) {
        setSavedPath(data.path);
        addLog(`Saved: ${data.path}`);
      } else {
        addLog(`Save error: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`Save error: ${e.message}`);
    }
  };

  // Dependency management - automatically checks when venv changes
  useEffect(() => {
    const checkDeps = async () => {
      if (!selectedVenv || !ipcRenderer) return;

      setCheckingDeps(true);

      try {
        const vres = await ipcRenderer.invoke('python-list-venvs');
        if (vres.success) {
          const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
          if (v && Array.isArray(v.packages)) {
            const map: Record<string, { installed: boolean; version: string; needsCuda?: boolean }> = {};
            for (const pkg of REQUIRED_PACKAGES) {
              const result = findInstalledPackage(v.packages, pkg);
              const version = result.version || '';
              const cudaInfo = CUDA_PACKAGES[normalizePackageName(pkg)];
              map[pkg] = {
                installed: result.found,
                version: result.version || '',
                needsCuda: cudaInfo ? !cudaInfo.checkCuda(version) : false,
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

  const installAllDependencies = async () => {
    if (!ipcRenderer || !selectedVenv) return;

    const missingPackages = Object.entries(depsStatus)
      .filter(([_, status]) => !status.installed)
      .map(([pkg]) => pkg);

    if (missingPackages.length === 0) {
      addLog('No missing dependencies');
      return;
    }

    setInstallingDeps(true);
    addLog(`Installing ${missingPackages.length} packages...`);

    for (const pkg of missingPackages) {
      setInstallingPackage(pkg);
      const normalized = normalizePackageName(pkg);
      const cudaPkg = CUDA_PACKAGES[normalized];

      let installCmd = pkg;
      if (cudaPkg && serverStatus?.cuda_available) {
        installCmd = cudaPkg.installCmd;
        addLog(`Installing ${pkg} with CUDA support...`);
      } else {
        addLog(`Installing ${pkg}...`);
      }

      const result = await ipcRenderer.invoke('python-install-package', {
        venvName: selectedVenv,
        package: installCmd,
      });

      if (result.success) {
        addLog(`✓ ${pkg} installed`);
      } else {
        addLog(`✗ ${pkg} failed: ${result.error}`);
      }
    }

    setInstallingPackage(null);
    setInstallingDeps(false);
    addLog('Installation complete');

    // Trigger re-check by updating a dummy state - the useEffect will handle the actual check
    setSelectedVenv(selectedVenv);
  };

  const upgradeToCuda = async (packageName: string) => {
    if (!ipcRenderer || !selectedVenv) return;

    const normalized = normalizePackageName(packageName);
    const cudaPkg = CUDA_PACKAGES[normalized];
    if (!cudaPkg) return;

    setInstallingPackage(packageName);
    addLog(`Upgrading ${packageName} to CUDA version...`);

    // Uninstall old version
    const uninstallResult = await ipcRenderer.invoke('python-uninstall-package', {
      venvName: selectedVenv,
      packageName: normalized,
    });

    if (!uninstallResult.success) {
      addLog(`Warning: Uninstall had issues: ${uninstallResult.error}`);
    }

    // Install CUDA version
    const installResult = await ipcRenderer.invoke('python-install-package', {
      venvName: selectedVenv,
      package: cudaPkg.installCmd,
    });

    if (installResult.success) {
      addLog(`✓ ${packageName} upgraded to CUDA`);
    } else {
      addLog(`✗ CUDA upgrade failed: ${installResult.error}`);
    }

    setInstallingPackage(null);

    // Trigger re-check
    setSelectedVenv(selectedVenv);
  };

  // Handle logs resize
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = logsHeight;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const delta = resizeStartY.current - e.clientY;
      const newHeight = Math.max(100, Math.min(600, resizeStartHeight.current + delta));
      setLogsHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing]);

  // Audio history functions
  const addToHistory = (audio: Float32Array, sampleRate: number, genTime: number) => {
    const historyItem: AudioHistoryItem = {
      id: Date.now().toString(),
      prompt,
      audio,
      sampleRate,
      duration: audio.length / sampleRate,
      timestamp: Date.now(),
      generationTime: genTime,
      settings: {
        duration: useExtended ? undefined : duration,
        temperature,
        topK,
        guidanceScale,
        extended: useExtended,
        targetDuration: useExtended ? targetDuration : undefined,
      },
    };

    setAudioHistory(prev => {
      const updated = [historyItem, ...prev];
      return updated.slice(0, MAX_HISTORY_ITEMS);
    });
    setSelectedHistoryId(historyItem.id);
  };

  const playHistoryItem = (id: string) => {
    const item = audioHistory.find(h => h.id === id);
    if (!item) return;

    // Stop current playback if any
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      setIsPlaying(false);
    }

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const ctx = audioContextRef.current;
      const buffer = ctx.createBuffer(1, item.audio.length, item.sampleRate);
      buffer.copyToChannel(item.audio, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        setIsPlaying(false);
        if (selectedHistoryId === id) {
          // Keep the history item selected
        }
      };

      audioSourceRef.current = source;
      source.start();
      setIsPlaying(true);
      setSelectedHistoryId(id);
      setGeneratedAudio(item.audio);
      setAudioSampleRate(item.sampleRate);
    } catch (e: any) {
      addLog(`Playback error: ${e.message}`);
    }
  };

  const deleteHistoryItem = (id: string) => {
    setAudioHistory(prev => prev.filter(h => h.id !== id));
    if (selectedHistoryId === id) {
      setSelectedHistoryId(null);
    }
  };

  const clearHistory = () => {
    setAudioHistory([]);
    setSelectedHistoryId(null);
  };

  const saveHistoryItem = async (id: string) => {
    if (!ipcRenderer) return;

    const item = audioHistory.find(h => h.id === id);
    if (!item) return;

    // Temporarily set generatedAudio to this item's audio so saveAudio works
    const prevAudio = generatedAudio;
    const prevSampleRate = audioSampleRate;
    setGeneratedAudio(item.audio);
    setAudioSampleRate(item.sampleRate);

    await saveAudio();

    // Restore
    setGeneratedAudio(prevAudio);
    setAudioSampleRate(prevSampleRate);
  };

  // Section management functions
  const applyPreset = (preset: StructurePreset) => {
    const newSections = preset.sections.map((s, idx) => ({
      ...s,
      id: `${Date.now()}-${idx}`,
    }));
    setSections(newSections);
    if (preset.basePrompt) {
      setBasePrompt(preset.basePrompt);
    }
    addLog(`Applied structure preset: ${preset.name}`);
  };

  const addSection = () => {
    const newSection: SongSection = {
      id: Date.now().toString(),
      name: 'New Section',
      prompt: '',
      duration: 15,
      temperature: 1.0,
      guidanceScale: 3.0,
    };
    setSections(prev => [...prev, newSection]);
  };

  const updateSection = (id: string, updates: Partial<SongSection>) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const removeSection = (id: string) => {
    setSections(prev => prev.filter(s => s.id !== id));
    if (editingSectionId === id) {
      setEditingSectionId(null);
    }
  };

  const moveSection = (id: string, direction: 'up' | 'down') => {
    setSections(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      if (direction === 'up' && idx === 0) return prev;
      if (direction === 'down' && idx === prev.length - 1) return prev;

      const newSections = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [newSections[idx], newSections[swapIdx]] = [newSections[swapIdx], newSections[idx]];
      return newSections;
    });
  };

  const getTotalDuration = () => sections.reduce((sum, s) => sum + s.duration, 0);

  const generateStructuredSong = async () => {
    if (!serverRunning || !serverStatus?.model_ready) {
      addLog('ERROR: Model not ready');
      return;
    }

    if (sections.length === 0) {
      addLog('ERROR: No sections defined');
      return;
    }

    setGenerating(true);
    setGeneratedAudio(null);
    setSavedPath('');

    const requestBody = {
      sections: sections.map(s => ({
        name: s.name,
        prompt: s.prompt,
        duration: s.duration,
        temperature: s.temperature,
        guidance_scale: s.guidanceScale,
      })),
      context_seconds: structuredContextSeconds,
      crossfade_seconds: crossfadeSeconds,
      base_prompt: basePrompt,
      top_k: topK,
      top_p: topP,
    };

    addLog(`Generating structured song: ${sections.length} sections, ${getTotalDuration()}s total`);

    try {
      const res = await fetch(`${getServerUrl()}/generate_structured`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();
      if (data.success) {
        const audioBytes = Uint8Array.from(atob(data.audio_b64), c => c.charCodeAt(0));
        const audioFloat = new Float32Array(audioBytes.buffer);

        setGeneratedAudio(audioFloat);
        setAudioSampleRate(data.sample_rate);
        setLastGenTime(data.generation_time);

        // Add to history with structured info
        addToHistory(audioFloat, data.sample_rate, data.generation_time);

        addLog(`Generated structured song: ${data.duration.toFixed(1)}s in ${data.generation_time.toFixed(1)}s`);
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const missingDeps = Object.entries(depsStatus).filter(([_, s]) => !s.installed).length;
  const hasCudaUpgrades = Object.entries(depsStatus).some(([_, s]) => s.needsCuda);

  return (
    <div className="p-4 pb-6 h-full flex flex-col overflow-auto gap-3 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700">
      {/* Header */}
      <div className="flex items-center mb-4">
        <div className="inline-block p-2 rounded-lg mr-3 bg-gradient-to-br from-violet-500 to-pink-500 shadow-lg shadow-violet-500/30">
          🎵
        </div>
        <h2 className="m-0 text-xl font-bold text-slate-50">MusicGen</h2>
      </div>

      {/* Dependencies Section */}
      {selectedVenv && (
        <div className="bg-slate-900/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
          <div
            className={`flex items-center justify-between cursor-pointer ${depsExpanded ? 'mb-3' : ''}`}
            onClick={() => setDepsExpanded(!depsExpanded)}
          >
            <h4 className="m-0 text-sm font-semibold text-slate-50">
              Dependencies {missingDeps > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-xl text-xs bg-red-500/20 text-red-400 border border-red-500/30">
                  {missingDeps} missing
                </span>
              )}
            </h4>
            <span className="text-slate-400 text-lg">{depsExpanded ? '▼' : '▶'}</span>
          </div>

          {depsExpanded && (
            <>
              {missingDeps > 0 && (
                <div className="flex gap-2 mb-3 flex-wrap">
                  <button
                    onClick={installAllDependencies}
                    disabled={installingDeps}
                    className="px-4 py-2 border-none rounded-lg cursor-pointer text-slate-50 text-sm font-semibold transition-all duration-200 hover:brightness-110 bg-gradient-to-br from-green-600 to-green-500"
                  >
                    {installingDeps ? `Installing...` : `Install All (${missingDeps})`}
                  </button>
                </div>
              )}

              <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                {REQUIRED_PACKAGES.map(pkg => {
                  const status = depsStatus[pkg];
                  const isInstalling = installingPackage === pkg;

                  return (
                    <div
                      key={pkg}
                      className={`p-2 rounded-lg bg-slate-900/60 border ${status?.installed ? 'border-green-400/30' : 'border-red-400/30'}`}
                    >
                      <div className="text-xs font-semibold text-slate-50 mb-1">
                        {pkg}
                      </div>
                      <div className="text-xs text-slate-300">
                        {isInstalling ? (
                          <span className="text-yellow-400">Installing...</span>
                        ) : status?.installed ? (
                          <>
                            <span className="text-green-400">✓ {status.version}</span>
                            {status.needsCuda && (
                              <button
                                onClick={() => upgradeToCuda(pkg)}
                                className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 cursor-pointer hover:brightness-110"
                              >
                                Add CUDA
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-red-400">✗ Not installed</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Server Connection */}
      <div className="bg-slate-900/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
        <h4 className="m-0 mb-3 text-sm font-semibold text-slate-50">Server</h4>
        <div className="flex items-center gap-2.5 mb-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-slate-300">Venv:</span>
            <select
              value={selectedVenv}
              onChange={e => setSelectedVenv(e.target.value)}
              className="px-3 py-2 border border-white/10 rounded-lg bg-slate-900/60 text-slate-50 text-sm w-36 transition-all duration-200"
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
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-slate-300">Port:</span>
            <input
              type="number"
              value={serverPort}
              onChange={e => setServerPort(parseInt(e.target.value) || 8765)}
              className="px-3 py-2 border border-white/10 rounded-lg bg-slate-900/60 text-slate-50 text-sm w-20 transition-all duration-200"
              disabled={serverRunning}
            />
          </div>
          {!serverRunning ? (
            <button
              onClick={startServer}
              disabled={connecting}
              className="px-4 py-2 border-none rounded-lg cursor-pointer text-slate-50 text-sm font-semibold transition-all duration-200 hover:brightness-110 bg-gradient-to-br from-green-600 to-green-500"
            >
              {connecting ? 'Connecting...' : 'Start Server'}
            </button>
          ) : (
            <>
              <span className="px-3 py-1 rounded-xl text-xs font-semibold bg-green-400/20 text-green-400 border border-green-400/30">
                Connected
              </span>
              <button
                onClick={stopServer}
                className="px-4 py-2 border-none rounded-lg cursor-pointer text-slate-50 text-sm font-semibold transition-all duration-200 hover:brightness-110 bg-gradient-to-br from-red-600 to-red-500"
              >
                Stop
              </button>
            </>
          )}
        </div>

        {serverStatus && (
          <div className="flex gap-4 text-xs text-slate-400">
            <span>
              CUDA: <span className={`font-semibold ${serverStatus.cuda_available ? 'text-green-400' : 'text-red-400'}`}>
                {serverStatus.cuda_available ? 'Available' : 'No'}
              </span>
            </span>
            {serverStatus.vram && (() => {
              const usedGB = serverStatus.vram.used / 1024 ** 3;
              const totalGB = serverStatus.vram.total / 1024 ** 3;
              const percentage = (usedGB / totalGB) * 100;
              const colorClass = percentage < 50 ? 'text-green-400' : percentage < 80 ? 'text-yellow-400' : 'text-red-400';
              return (
                <span>
                  VRAM: <span className={`font-semibold ${colorClass}`}>
                    {usedGB.toFixed(1)}GB / {totalGB.toFixed(1)}GB ({percentage.toFixed(0)}%)
                  </span>
                </span>
              );
            })()}
          </div>
        )}
      </div>

      {/* Model Settings */}
      <div className="bg-slate-900/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
        <h4 className="m-0 mb-3 text-sm font-semibold text-slate-50">Model</h4>

        <div className="flex gap-2 mb-3 flex-wrap">
          {MODEL_SIZES.map(size => (
            <label
              key={size}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer text-slate-50 ${selectedModel === size ? 'bg-violet-500/20 border border-violet-500/30' : 'bg-slate-600/30 border border-white/10'} ${serverStatus?.model_loading ? 'opacity-50' : ''}`}
            >
              <input
                type="radio"
                checked={selectedModel === size}
                onChange={() => setSelectedModel(size)}
                disabled={serverStatus?.model_loading}
                className="m-0"
              />
              {size}
            </label>
          ))}
        </div>

        <div className="flex gap-2.5 items-center mb-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-slate-300">
            <input type="checkbox" checked={useFp16} onChange={e => setUseFp16(e.target.checked)} />
            FP16
          </label>
          <input
            type="text"
            value={device}
            onChange={e => setDevice(e.target.value)}
            placeholder="Device (auto/cuda/cpu)"
            className="px-3 py-2 border border-white/10 rounded-lg bg-slate-900/60 text-slate-50 text-sm w-36 transition-all duration-200"
          />
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <button
            onClick={loadModel}
            disabled={!serverRunning || serverStatus?.model_loading}
            className={`px-4 py-2 border-none rounded-lg text-slate-50 text-sm font-semibold transition-all duration-200 bg-gradient-to-br from-green-600 to-green-500 ${(!serverRunning || serverStatus?.model_loading) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:brightness-110'}`}
          >
            {serverStatus?.model_loading ? 'Loading...' : 'Load Model'}
          </button>
          <button
            onClick={unloadModel}
            disabled={!serverStatus?.model_ready}
            className={`px-4 py-2 border-none rounded-lg text-slate-50 text-sm font-semibold transition-all duration-200 bg-gradient-to-br from-red-600 to-red-500 ${!serverStatus?.model_ready ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:brightness-110'}`}
          >
            Unload
          </button>
          {serverStatus?.model_ready && (
            <span className="px-3 py-1 rounded-xl text-xs font-semibold bg-green-400/20 text-green-400 border border-green-400/30">
              Ready: {serverStatus.model_size}
            </span>
          )}
        </div>
      </div>

      {/* Generation Parameters */}
      <div className="bg-slate-900/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
        <h4 className="m-0 mb-3 text-sm font-semibold text-slate-50">Generation Settings</h4>

        <label className="flex items-center gap-1.5 mb-3 text-xs text-slate-300">
          <input type="checkbox" checked={useExtended} onChange={e => setUseExtended(e.target.checked)} />
          Extended Generation (longer tracks)
        </label>

        {useExtended ? (
          <>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-28 text-xs text-slate-300">Target: <span className="text-slate-50 font-semibold">{targetDuration}s</span></span>
              <input
                type="range"
                min={30}
                max={300}
                value={targetDuration}
                onChange={e => setTargetDuration(parseInt(e.target.value))}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-28 text-xs text-slate-300">Context: <span className="text-slate-50 font-semibold">{contextSeconds}s</span></span>
              <input
                type="range"
                min={5}
                max={15}
                value={contextSeconds}
                onChange={e => setContextSeconds(parseInt(e.target.value))}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-28 text-xs text-slate-300">Segment: <span className="text-slate-50 font-semibold">{segmentDuration}s</span></span>
              <input
                type="range"
                min={10}
                max={20}
                value={segmentDuration}
                onChange={e => setSegmentDuration(parseInt(e.target.value))}
                className="flex-1"
              />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-28 text-xs text-slate-300">Duration: <span className="text-slate-50 font-semibold">{duration}s</span></span>
            <input
              type="range"
              min={1}
              max={30}
              value={duration}
              onChange={e => setDuration(parseInt(e.target.value))}
              className="flex-1"
            />
          </div>
        )}

        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-28 text-xs text-slate-300">Temperature: <span className="text-slate-50 font-semibold">{temperature.toFixed(2)}</span></span>
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.05}
            value={temperature}
            onChange={e => setTemperature(parseFloat(e.target.value))}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-28 text-xs text-slate-300">Top-K: <span className="text-slate-50 font-semibold">{topK}</span></span>
          <input
            type="range"
            min={0}
            max={500}
            value={topK}
            onChange={e => setTopK(parseInt(e.target.value))}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-28 text-xs text-slate-300">Guidance: <span className="text-slate-50 font-semibold">{guidanceScale.toFixed(1)}</span></span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={guidanceScale}
            onChange={e => setGuidanceScale(parseFloat(e.target.value))}
            className="flex-1"
          />
        </div>
      </div>

      {/* Structured Song Mode */}
      <div className="bg-slate-900/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <h4 className="m-0 text-sm font-semibold text-slate-50">Structured Song Mode</h4>
          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={useStructured}
              onChange={e => {
                setUseStructured(e.target.checked);
                if (e.target.checked) {
                  setUseExtended(false);
                }
              }}
            />
            Enable
          </label>
        </div>

        {useStructured && (
          <>
            {/* Base Style Prompt */}
            <div className="mb-3">
              <label className="text-xs text-slate-400 mb-1 block">Base Style (applied to all sections):</label>
              <input
                type="text"
                value={basePrompt}
                onChange={e => setBasePrompt(e.target.value)}
                placeholder="e.g., lo-fi hip hop, jazzy chords, mellow"
                className="px-3 py-2 border border-white/10 rounded-lg bg-slate-900/60 text-slate-50 text-sm w-full"
              />
            </div>

            {/* Structure Presets */}
            <div className="mb-3">
              <label className="text-xs text-slate-400 mb-1 block">Structure Presets:</label>
              <div className="flex gap-2 flex-wrap">
                {STRUCTURE_PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset)}
                    title={preset.description}
                    className="px-3 py-1.5 border-none rounded-lg cursor-pointer text-slate-50 text-xs font-semibold transition-all duration-200 bg-slate-600/50 border border-white/10 hover:brightness-125"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Context/Crossfade Settings */}
            <div className="flex gap-4 mb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Context:</span>
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={structuredContextSeconds}
                  onChange={e => setStructuredContextSeconds(parseInt(e.target.value) || 5)}
                  className="px-2 py-1 border border-white/10 rounded-lg bg-slate-900/60 text-slate-50 text-xs w-14"
                />
                <span className="text-xs text-slate-400">s</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Crossfade:</span>
                <input
                  type="number"
                  min={0.5}
                  max={3}
                  step={0.5}
                  value={crossfadeSeconds}
                  onChange={e => setCrossfadeSeconds(parseFloat(e.target.value) || 1)}
                  className="px-2 py-1 border border-white/10 rounded-lg bg-slate-900/60 text-slate-50 text-xs w-14"
                />
                <span className="text-xs text-slate-400">s</span>
              </div>
            </div>

            {/* Sections List */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-slate-400">
                  Sections ({sections.length}) - Total: <span className="text-slate-50 font-semibold">{getTotalDuration()}s</span>
                </label>
                <button
                  onClick={addSection}
                  className="px-2 py-1 border-none rounded-lg cursor-pointer text-slate-50 text-xs font-semibold transition-all duration-200 bg-green-600/50 hover:brightness-125"
                >
                  + Add Section
                </button>
              </div>

              {sections.length === 0 ? (
                <div className="text-xs text-slate-500 italic p-4 text-center border border-dashed border-white/10 rounded-lg">
                  No sections yet. Use a preset or add sections manually.
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                  {sections.map((section, idx) => (
                    <div
                      key={section.id}
                      className={`p-3 rounded-lg border ${editingSectionId === section.id ? 'bg-violet-500/10 border-violet-500/30' : 'bg-slate-900/60 border-white/10'}`}
                    >
                      {editingSectionId === section.id ? (
                        /* Edit Mode */
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={section.name}
                              onChange={e => updateSection(section.id, { name: e.target.value })}
                              placeholder="Section name"
                              className="px-2 py-1 border border-white/10 rounded bg-slate-900/60 text-slate-50 text-xs flex-1"
                            />
                            <input
                              type="number"
                              min={5}
                              max={30}
                              value={section.duration}
                              onChange={e => updateSection(section.id, { duration: parseInt(e.target.value) || 10 })}
                              className="px-2 py-1 border border-white/10 rounded bg-slate-900/60 text-slate-50 text-xs w-16"
                            />
                            <span className="text-xs text-slate-400 self-center">s</span>
                          </div>
                          <textarea
                            value={section.prompt}
                            onChange={e => updateSection(section.id, { prompt: e.target.value })}
                            placeholder="Section-specific prompt additions..."
                            className="px-2 py-1 border border-white/10 rounded bg-slate-900/60 text-slate-50 text-xs w-full h-16 resize-none"
                          />
                          <div className="flex gap-3 flex-wrap">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-slate-400">Temp:</span>
                              <input
                                type="number"
                                min={0.1}
                                max={2}
                                step={0.1}
                                value={section.temperature}
                                onChange={e => updateSection(section.id, { temperature: parseFloat(e.target.value) || 1 })}
                                className="px-1 py-0.5 border border-white/10 rounded bg-slate-900/60 text-slate-50 text-xs w-14"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-slate-400">Guidance:</span>
                              <input
                                type="number"
                                min={1}
                                max={10}
                                step={0.5}
                                value={section.guidanceScale}
                                onChange={e => updateSection(section.id, { guidanceScale: parseFloat(e.target.value) || 3 })}
                                className="px-1 py-0.5 border border-white/10 rounded bg-slate-900/60 text-slate-50 text-xs w-14"
                              />
                            </div>
                          </div>
                          {/* Prompt hints */}
                          <div className="flex gap-1 flex-wrap">
                            {Object.entries(SECTION_PROMPT_HINTS).map(([key, hint]) => (
                              <button
                                key={key}
                                onClick={() => updateSection(section.id, { prompt: hint })}
                                className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700/50 text-slate-400 hover:text-slate-200 cursor-pointer border-none"
                              >
                                {key}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => setEditingSectionId(null)}
                            className="px-2 py-1 border-none rounded cursor-pointer text-slate-50 text-xs font-semibold bg-violet-500/50 hover:brightness-125 self-end"
                          >
                            Done
                          </button>
                        </div>
                      ) : (
                        /* View Mode */
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs text-slate-400">#{idx + 1}</span>
                              <span className="text-sm font-semibold text-slate-50">{section.name}</span>
                              <span className="text-xs text-slate-400">({section.duration}s)</span>
                            </div>
                            <div className="text-xs text-slate-300 truncate max-w-md">
                              {section.prompt || <span className="italic text-slate-500">No prompt</span>}
                            </div>
                          </div>
                          <div className="flex gap-1 ml-2">
                            <button
                              onClick={() => moveSection(section.id, 'up')}
                              disabled={idx === 0}
                              className={`px-1.5 py-0.5 border-none rounded text-xs cursor-pointer ${idx === 0 ? 'opacity-30' : 'hover:brightness-125'} bg-slate-600/50 text-slate-300`}
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveSection(section.id, 'down')}
                              disabled={idx === sections.length - 1}
                              className={`px-1.5 py-0.5 border-none rounded text-xs cursor-pointer ${idx === sections.length - 1 ? 'opacity-30' : 'hover:brightness-125'} bg-slate-600/50 text-slate-300`}
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => setEditingSectionId(section.id)}
                              className="px-1.5 py-0.5 border-none rounded text-xs cursor-pointer hover:brightness-125 bg-slate-600/50 text-slate-300"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => removeSection(section.id)}
                              className="px-1.5 py-0.5 border-none rounded text-xs cursor-pointer hover:brightness-125 bg-red-500/30 text-red-400"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generate Structured Button */}
            <button
              onClick={generateStructuredSong}
              disabled={!serverStatus?.model_ready || generating || sections.length === 0}
              className={`w-full px-5 py-3 border-none rounded-lg text-slate-50 text-sm font-semibold transition-all duration-200 ${generating ? 'bg-slate-600/50' : 'bg-gradient-to-br from-pink-500 to-violet-500'} ${(!serverStatus?.model_ready || generating || sections.length === 0) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:brightness-110'}`}
            >
              {generating ? 'Generating...' : `🎵 Generate Structured Song (${getTotalDuration()}s)`}
            </button>
          </>
        )}
      </div>

      {/* Prompt & Generate */}
      <div className="bg-slate-900/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
        <h4 className="m-0 mb-3 text-sm font-semibold text-slate-50">Prompt & Presets</h4>

        {/* Presets organized by category */}
        <div className="mb-3">
          {['Chill', 'Electronic', 'Rock/Metal', 'Jazz/Blues', 'World', 'Cinematic'].map(category => {
            const categoryPresets = PRESETS.filter(p => p.category === category);
            return (
              <div key={category} className="mb-2">
                <div className="text-xs text-slate-400 mb-1 font-semibold">
                  {category}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {categoryPresets.map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => setPrompt(preset.prompt)}
                      className="px-2.5 py-1 border-none rounded-lg cursor-pointer text-slate-50 text-xs font-semibold transition-all duration-200 bg-slate-600/50 border border-white/10 hover:brightness-125"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="px-3 py-2 border border-white/10 rounded-lg bg-slate-900/60 text-slate-50 text-sm w-full transition-all duration-200 resize-y font-inherit h-[70px]"
          placeholder="Describe the music you want to generate..."
        />

        <div className="flex gap-2 mt-3 flex-wrap items-center">
          <button
            onClick={generateMusic}
            disabled={!serverStatus?.model_ready || generating}
            className={`px-5 py-2.5 border-none rounded-lg text-slate-50 text-sm font-semibold transition-all duration-200 ${generating ? 'bg-slate-600/50' : 'bg-gradient-to-br from-violet-500 to-violet-400'} ${(!serverStatus?.model_ready || generating) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:brightness-110'}`}
          >
            {generating ? 'Generating...' : useExtended ? '🎵 Generate Extended' : '🎵 Generate'}
          </button>

          {generatedAudio && (
            <>
              <button
                onClick={playAudio}
                className={`px-4 py-2 border-none rounded-lg cursor-pointer text-slate-50 text-sm font-semibold transition-all duration-200 hover:brightness-110 ${isPlaying ? 'bg-gradient-to-br from-red-600 to-red-500' : 'bg-gradient-to-br from-green-600 to-green-500'}`}
              >
                {isPlaying ? '⏸ Stop' : '▶ Play'}
              </button>
              <button
                onClick={saveAudio}
                className="px-4 py-2 border-none rounded-lg cursor-pointer text-slate-50 text-sm font-semibold transition-all duration-200 hover:brightness-110 bg-gradient-to-br from-amber-500 to-amber-400"
              >
                💾 Save
              </button>
            </>
          )}
        </div>

        {generatedAudio && (
          <div className="mt-3 text-xs text-green-400 flex gap-3 flex-wrap">
            <span>
              Duration: <span className="font-semibold">{(generatedAudio.length / audioSampleRate).toFixed(1)}s</span>
            </span>
            <span>
              Sample Rate: <span className="font-semibold">{audioSampleRate}Hz</span>
            </span>
            {lastGenTime > 0 && (
              <span>
                Gen Time: <span className="font-semibold">{lastGenTime.toFixed(1)}s</span>
              </span>
            )}
          </div>
        )}

        {savedPath && (
          <div className="mt-2 text-xs text-slate-400">
            Saved: <span className="text-slate-300">{savedPath}</span>
          </div>
        )}
      </div>

      {/* Audio History */}
      {audioHistory.length > 0 && (
        <div className="bg-slate-900/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
          <div
            className={`flex items-center justify-between cursor-pointer ${historyExpanded ? 'mb-3' : ''}`}
            onClick={() => setHistoryExpanded(!historyExpanded)}
          >
            <h4 className="m-0 text-sm font-semibold text-slate-50">
              Audio History ({audioHistory.length}/{MAX_HISTORY_ITEMS})
            </h4>
            <span className="text-slate-400 text-lg">{historyExpanded ? '▼' : '▶'}</span>
          </div>

          {historyExpanded && (
            <>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={clearHistory}
                  className="px-4 py-2 border-none rounded-lg cursor-pointer text-slate-50 text-sm font-semibold transition-all duration-200 bg-slate-600/50 border border-white/10 hover:brightness-125"
                >
                  Clear All
                </button>
              </div>

              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                {audioHistory.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`p-2.5 rounded-lg ${selectedHistoryId === item.id ? 'bg-violet-500/20 border border-violet-500/30' : 'bg-slate-900/60 border border-white/10'}`}
                  >
                    <div className="flex justify-between items-start mb-1.5">
                      <div className="flex-1">
                        <div className="text-xs text-slate-400 mb-1">
                          #{audioHistory.length - idx} • {new Date(item.timestamp).toLocaleTimeString()}
                        </div>
                        <div className="text-xs text-slate-50 mb-1">
                          {item.prompt.substring(0, 60)}{item.prompt.length > 60 ? '...' : ''}
                        </div>
                        <div className="text-xs text-slate-300">
                          {item.duration.toFixed(1)}s • {item.generationTime.toFixed(1)}s gen time
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => playHistoryItem(item.id)}
                          className="px-2 py-1 border-none rounded-lg cursor-pointer text-slate-50 text-xs font-semibold transition-all duration-200 bg-slate-600/50 border border-white/10 hover:brightness-125"
                        >
                          {selectedHistoryId === item.id && isPlaying ? '⏸' : '▶'}
                        </button>
                        <button
                          onClick={() => saveHistoryItem(item.id)}
                          className="px-2 py-1 border-none rounded-lg cursor-pointer text-slate-50 text-xs font-semibold transition-all duration-200 bg-slate-600/50 border border-white/10 hover:brightness-125"
                        >
                          💾
                        </button>
                        <button
                          onClick={() => deleteHistoryItem(item.id)}
                          className="px-2 py-1 rounded-lg cursor-pointer text-slate-50 text-xs font-semibold transition-all duration-200 bg-red-500/20 border border-red-500/30 hover:brightness-125"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Logs */}
      <div
        className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden flex flex-col relative shrink-0"
        style={{ height: `${logsHeight}px` }}
      >
        {/* Resize handle - keep inline style for dynamic state-based background */}
        <div
          onMouseDown={handleResizeStart}
          className={`absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-10 transition-colors duration-200 ${isResizing ? 'bg-violet-500/30' : 'hover:bg-violet-500/20'}`}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-0.5 rounded-sm bg-slate-300/50" />
        </div>

        <div className="px-4 py-2.5 border-b border-white/10 flex justify-between items-center mt-2">
          <span className="text-sm text-slate-300 font-semibold">Logs</span>
          <button
            onClick={() => setLogs([])}
            className="px-2.5 py-1 border-none rounded-lg cursor-pointer text-slate-50 text-xs font-semibold transition-all duration-200 bg-slate-600/50 border border-white/10 hover:brightness-125"
          >
            Clear
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3 text-xs font-mono">
          {logs.map((log, i) => (
            <div
              key={i}
              className={`mb-0.5 ${log.includes('ERROR') ? 'text-red-400' : log.includes('Generated') || log.includes('✓') ? 'text-green-400' : 'text-slate-400'}`}
            >
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
