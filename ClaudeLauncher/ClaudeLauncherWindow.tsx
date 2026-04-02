// Terminal style types
interface TextStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

interface StyledSpan {
  text: string;
  style: TextStyle;
}

// Terminal state
interface TerminalLine {
  spans: StyledSpan[];
  timestamp: number;
}

// ANSI color palette - standard 16 colors
const ANSI_COLORS: Record<number, string> = {
  0: '#000000',   // Black
  1: '#cc0000',   // Red
  2: '#00cc00',   // Green
  3: '#cccc00',   // Yellow
  4: '#0000cc',   // Blue
  5: '#cc00cc',   // Magenta
  6: '#00cccc',   // Cyan
  7: '#cccccc',   // White
  // Bright colors
  8: '#666666',   // Bright Black (Gray)
  9: '#ff0000',   // Bright Red
  10: '#00ff00',  // Bright Green
  11: '#ffff00',  // Bright Yellow
  12: '#0000ff',  // Bright Blue
  13: '#ff00ff',  // Bright Magenta
  14: '#00ffff',  // Bright Cyan
  15: '#ffffff',  // Bright White
};

// 256-color palette lookup
const get256Color = (n: number): string => {
  if (n < 16) return ANSI_COLORS[n];
  if (n < 232) {
    // 216 colors: 6x6x6 cube
    const idx = n - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor((idx % 36) / 6);
    const b = idx % 6;
    const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  // Grayscale: 24 shades
  const gray = 8 + (n - 232) * 10;
  const hex = gray.toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
};

// Default style
const defaultStyle = (): TextStyle => ({});

const ClaudeLauncherWindow: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Generate unique instance ID for multi-instance support
  const instanceIdRef = useRef<string>(() => {
    const id = `claude-terminal-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    return id;
  });
  const instanceId = typeof instanceIdRef.current === 'function' ? instanceIdRef.current() : instanceIdRef.current;
  // Store the resolved value back
  if (typeof instanceIdRef.current === 'function') {
    instanceIdRef.current = instanceId;
  }

  // Connection state - use unique port based on instance to avoid conflicts
  const [serverPort, setServerPort] = useState(() => {
    // Generate a port in the range 8781-8980 combining timestamp and random for uniqueness
    return 8781 + (Date.now() % 100) + Math.floor(Math.random() * 100);
  });
  const [serverRunning, setServerRunning] = useState(false);
  const serverRunningRef = useRef(false); // Track server state for cleanup
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);

  // Create venv state
  const [showCreateVenv, setShowCreateVenv] = useState(false);
  const [newVenvName, setNewVenvName] = useState('');
  const [creatingVenv, setCreatingVenv] = useState(false);

  // Store full venv info (name and path)
  const [venvInfoMap, setVenvInfoMap] = useState<Record<string, string>>({});

  // Package manager state
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [requiredPackages, setRequiredPackages] = useState<string[]>([]);
  const [requirementsPath, setRequirementsPath] = useState<string>('');

  // Auto-launch state
  const [claudeLaunched, setClaudeLaunched] = useState(false);
  const autoStartedRef = useRef(false);
  const [directoryChanged, setDirectoryChanged] = useState(false);
  const [claudeInstallState, setClaudeInstallState] = useState<'unchecked' | 'checking' | 'installing' | 'ready'>('unchecked');
  const terminalOutputRef = useRef('');

  // Terminal state
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [isFocused, setIsFocused] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [fontSize, setFontSize] = useState(() => {
    // Load saved font size from localStorage, default to 14
    const saved = localStorage.getItem('claudeLauncher-fontSize');
    return saved ? parseInt(saved, 10) : 14;
  });
  const [displayCursorCol, setDisplayCursorCol] = useState(0);
  const [displayCursorRow, setDisplayCursorRow] = useState(0);

  // Track user's current input line separately for clean display
  const [userInput, setUserInput] = useState('');
  const [userInputCursor, setUserInputCursor] = useState(0);
  const [isAtPrompt, setIsAtPrompt] = useState(false);

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);

  // Terminal config
  const MAX_LINES = 1000;

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  // Keep ref in sync with state for cleanup
  useEffect(() => {
    serverRunningRef.current = serverRunning;
  }, [serverRunning]);

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${msg}`]);
  }, []);

  // Create a new venv
  const createVenv = useCallback(async () => {
    if (!newVenvName.trim()) {
      addLog('ERROR: Please enter a venv name');
      return;
    }

    const venvName = newVenvName.trim();

    // Check if name already exists
    if (availableVenvs.includes(venvName)) {
      addLog(`ERROR: Venv "${venvName}" already exists`);
      return;
    }

    setCreatingVenv(true);
    addLog(`Creating venv "${venvName}"...`);

    try {
      // Get base path from an existing venv, or construct from home directory
      let basePath: string;
      const existingVenvPath = Object.values(venvInfoMap)[0];
      if (existingVenvPath) {
        // Extract base directory from existing venv path
        const path = (window as any).require?.('path');
        basePath = path ? path.dirname(existingVenvPath) : existingVenvPath.substring(0, existingVenvPath.lastIndexOf('\\'));
      } else {
        // Fallback: use home directory
        const os = (window as any).require?.('os');
        const homeDir = os?.homedir() || process.env.USERPROFILE || process.env.HOME;
        basePath = `${homeDir}\\ContextUI\\Default\\python_venvs`;
      }

      const venvPath = `${basePath}\\${venvName}`;
      addLog(`Creating at: ${venvPath}`);

      // Use ContextUI's Python runtime - detect available version
      const os = (window as any).require?.('os');
      const fs = (window as any).require?.('fs');
      const homeDir = os?.homedir() || process.env.USERPROFILE || process.env.HOME;
      const runtimeDir = `${homeDir}\\ContextUI\\python_runtime`;

      // Find available Python versions - prefer 3.12 for stability
      let pythonVersion: string | null = null;
      try {
        const versions = fs.readdirSync(runtimeDir).filter((name: string) => /^\d+\.\d+$/.test(name));
        if (versions.length > 0) {
          // Prefer 3.12 if available (more stable), otherwise highest version
          if (versions.includes('3.12')) {
            pythonVersion = '3.12';
          } else {
            versions.sort((a: string, b: string) => {
              const [aMaj, aMin] = a.split('.').map(Number);
              const [bMaj, bMin] = b.split('.').map(Number);
              return bMaj - aMaj || bMin - aMin;
            });
            pythonVersion = versions[0];
          }
        }
      } catch (e) {
        addLog(`ERROR: Could not read Python runtime directory`);
        setCreatingVenv(false);
        return;
      }

      if (!pythonVersion) {
        addLog('ERROR: No Python runtime found in ContextUI');
        setCreatingVenv(false);
        return;
      }

      const pythonPath = `"${runtimeDir}\\${pythonVersion}\\python.exe"`;
      addLog(`Using Python ${pythonVersion}: ${pythonPath}`);

      // Use child_process to create venv via shell command
      const { exec } = (window as any).require('child_process');
      const util = (window as any).require('util');
      const execAsync = util.promisify(exec);

      // Create venv structure manually (bundled Python has issues with venv module)
      addLog('Creating venv directory structure...');

      const scriptsPath = `${venvPath}\\Scripts`;
      const libPath = `${venvPath}\\Lib\\site-packages`;

      fs.mkdirSync(scriptsPath, { recursive: true });
      fs.mkdirSync(libPath, { recursive: true });

      // Copy essential files from runtime to venv Scripts
      const runtimeVersionDir = `${runtimeDir}\\${pythonVersion}`;
      const filesToCopy = ['python.exe', 'pythonw.exe', 'python312.dll', 'python313.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
      for (const file of filesToCopy) {
        const src = `${runtimeVersionDir}\\${file}`;
        const dst = `${scriptsPath}\\${file}`;
        try {
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            addLog(`Copied ${file}`);
          }
        } catch (copyErr) {
          addLog(`Warning: Could not copy ${file}`);
        }
      }

      // Create pyvenv.cfg
      const pyvenvCfg = `home = ${runtimeVersionDir}\ninclude-system-site-packages = false\nversion = ${pythonVersion}\n`;
      fs.writeFileSync(`${venvPath}\\pyvenv.cfg`, pyvenvCfg);

      addLog('Venv structure created, installing packages...');

      // Get requirements.txt path
      const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
        workflowFolder: 'ClaudeLauncher',
        scriptName: 'requirements.txt'
      });

      if (!scriptResult.success) {
        throw new Error('Could not find requirements.txt');
      }

      // Install packages using runtime's pip with --prefix
      await execAsync(`${pythonPath} -m pip install --prefix "${venvPath}" -r "${scriptResult.path}"`, { timeout: 180000 });

      addLog(`Venv "${venvName}" created successfully`);

      // Refresh venv list
      if (ipcRenderer) {
        const result = await ipcRenderer.invoke('python-list-venvs');
        if (result.success && result.venvs.length > 0) {
          const names = result.venvs.map((v: any) => v.name);
          const infoMap: Record<string, string> = {};
          result.venvs.forEach((v: any) => {
            infoMap[v.name] = v.path;
          });
          setVenvInfoMap(infoMap);
          setAvailableVenvs(names);
        }
      }

      setSelectedVenv(venvName);
      setShowCreateVenv(false);
      setNewVenvName('');
    } catch (e: any) {
      addLog(`ERROR creating venv: ${e.message}`);
    } finally {
      setCreatingVenv(false);
    }
  }, [ipcRenderer, newVenvName, availableVenvs, venvInfoMap, addLog]);

  // Load requirements from requirements.txt
  const loadRequirements = useCallback(async () => {
    if (!ipcRenderer) return;

    try {
      const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
        workflowFolder: 'ClaudeLauncher',
        scriptName: 'requirements.txt'
      });

      if (!scriptResult.success) {
        addLog('No requirements.txt found');
        return;
      }

      setRequirementsPath(scriptResult.path);

      const fs = (window as any).require?.('fs');
      if (!fs) return;

      const content = fs.readFileSync(scriptResult.path, 'utf-8');
      const lines = content.split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line && !line.startsWith('#'));

      // Parse package names (handle extras like uvicorn[standard])
      const packages = lines.map((line: string) => {
        // Extract base package name for display (e.g., "uvicorn[standard]" -> "uvicorn")
        // But keep the full spec for installation
        return line;
      });

      setRequiredPackages(packages);
      addLog(`Loaded ${packages.length} packages from requirements.txt`);
    } catch (e: any) {
      addLog(`Error loading requirements: ${e.message}`);
    }
  }, [ipcRenderer, addLog]);

  // Check installed packages in the selected venv
  const checkDeps = useCallback(async () => {
    if (!selectedVenv || !ipcRenderer || requiredPackages.length === 0) {
      return;
    }

    setCheckingDeps(true);
    try {
      const vres = await ipcRenderer.invoke('python-list-venvs');
      const fs = (window as any).require?.('fs');
      const venvPath = venvInfoMap[selectedVenv];

      if (vres.success) {
        const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
        const pipPackages = (v && Array.isArray(v.packages)) ? v.packages : [];

        const map: Record<string, any> = {};
        for (const pkg of requiredPackages) {
          // Extract base package name (e.g., "uvicorn[standard]" -> "uvicorn")
          const baseName = pkg.replace(/\[.*\]/, '').split(/[<>=!]/).at(0) || pkg;
          let found = pipPackages.find((p: string) => p.toLowerCase().startsWith(baseName.toLowerCase()));

          // Fallback: check if package folder exists in site-packages (for --target installs)
          if (!found && venvPath && fs) {
            const sitePackages = `${venvPath}\\Lib\\site-packages`;
            try {
              const folders = fs.readdirSync(sitePackages);
              // Package folders are usually lowercase with underscores
              const pkgFolder = baseName.toLowerCase().replace(/-/g, '_');
              if (folders.some((f: string) => f.toLowerCase().startsWith(pkgFolder))) {
                found = baseName;
              }
            } catch {}
          }

          // For packages with extras (like uvicorn[standard]), also check the extra dependencies
          let isInstalled = !!found;
          if (isInstalled && pkg.includes('[standard]')) {
            // uvicorn[standard] requires websockets - check if it's installed
            let hasWebsockets = pipPackages.find((p: string) => p.toLowerCase().startsWith('websockets'));
            // Fallback check for websockets folder
            if (!hasWebsockets && venvPath && fs) {
              const sitePackages = `${venvPath}\\Lib\\site-packages`;
              try {
                const folders = fs.readdirSync(sitePackages);
                hasWebsockets = folders.some((f: string) => f.toLowerCase().startsWith('websockets'));
              } catch {}
            }
            isInstalled = !!hasWebsockets;
            if (!isInstalled) {
              addLog(`${pkg} requires websockets but it's not installed`);
            }
          }

          map[pkg] = { installed: isInstalled, version: found ? (typeof found === 'string' && found.includes(' ') ? found.split(' ')[1] : undefined) : undefined };
        }
        setDepsStatus(map);
        addLog('Package status checked');
      }
    } catch (e: any) {
      addLog(`ERROR checking packages: ${e.message}`);
    } finally {
      setCheckingDeps(false);
    }
  }, [selectedVenv, ipcRenderer, requiredPackages, venvInfoMap, addLog]);

  // Install missing packages from requirements.txt
  const installMissing = useCallback(async () => {
    if (!selectedVenv || !ipcRenderer) {
      addLog('ERROR: No venv selected');
      return;
    }

    if (!requirementsPath) {
      addLog('ERROR: No requirements.txt found');
      return;
    }

    const missing = requiredPackages.filter(p => !depsStatus[p]?.installed);
    if (missing.length === 0) {
      addLog('All required packages are already installed');
      return;
    }

    setInstallingDeps(true);
    try {
      // Install directly from requirements.txt using -r flag
      addLog(`Installing from requirements.txt into venv ${selectedVenv}...`);
      const inst = await ipcRenderer.invoke('python-install-package', {
        venvName: selectedVenv,
        package: `-r "${requirementsPath}"`
      });

      // If IPC fails because pip isn't in venv, use runtime pip directly
      if (!inst?.success && inst?.error?.includes('Pip not installed')) {
        addLog('Venv has no pip, installing pip first...');
        const os = (window as any).require?.('os');
        const fs = (window as any).require?.('fs');
        const homeDir = os?.homedir() || process.env.USERPROFILE || process.env.HOME;
        const runtimeDir = `${homeDir}\\ContextUI\\python_runtime`;

        // Find available Python version
        const versions = fs.readdirSync(runtimeDir).filter((name: string) => /^\d+\.\d+$/.test(name));
        const pyVersion = versions.includes('3.12') ? '3.12' : versions[0];
        const runtimePip = `"${runtimeDir}\\${pyVersion}\\Scripts\\pip.exe"`;
        const venvPath = venvInfoMap[selectedVenv];

        if (venvPath) {
          const { exec } = (window as any).require('child_process');
          const util = (window as any).require('util');
          const execAsync = util.promisify(exec);

          // Install using --prefix to properly set up packages in venv structure
          addLog('Installing requirements with --prefix...');
          await execAsync(`${runtimePip} install -r "${requirementsPath}" --prefix "${venvPath}"`);
          addLog('Installation complete (via runtime pip)');
        } else {
          addLog('ERROR: Could not find venv path');
        }
      } else {
        addLog(inst?.message || (inst?.success ? 'Installation complete' : JSON.stringify(inst)));
      }
      await checkDeps();
    } catch (e: any) {
      addLog(`ERROR installing packages: ${e.message}`);
    } finally {
      setInstallingDeps(false);
    }
  }, [selectedVenv, ipcRenderer, requirementsPath, requiredPackages, depsStatus, venvInfoMap, addLog, checkDeps]);

  // Load available venvs
  useEffect(() => {
    const loadVenvs = async () => {
      if (!ipcRenderer) return;

      const result = await ipcRenderer.invoke('python-list-venvs');
      if (result.success && result.venvs.length > 0) {
        const names = result.venvs.map((v: any) => v.name);
        // Build map of name -> path
        const infoMap: Record<string, string> = {};
        result.venvs.forEach((v: any) => {
          infoMap[v.name] = v.path;
        });
        setVenvInfoMap(infoMap);
        setAvailableVenvs(names);

        // Auto-select 'terminal' venv if it exists, otherwise first available
        if (!selectedVenv) {
          if (names.includes('terminal')) {
            setSelectedVenv('terminal');
          } else {
            setSelectedVenv(names[0]);
          }
        }
      } else {
        addLog('No Python venvs found. Please create one using Python Manager.');
      }
    };
    loadVenvs();
  }, [ipcRenderer, selectedVenv, addLog]);

  // Spawn a new instance of ClaudeLauncherWindow with a unique component name
  // This prevents the "close one, close all" bug in the docking system
  const spawnNewInstance = useCallback(() => {
    const uniqueName = `ClaudeLauncherWindow_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const moduleManager = (window as any).ModuleManager?.getInstance?.();
    const dockingAddTab = (window as any).dockingAddTab;

    if (!moduleManager || !dockingAddTab) {
      addLog('ERROR: ModuleManager or dockingAddTab not available');
      return;
    }

    // Register the component under the unique name
    moduleManager.registerModuleTemplate(uniqueName, ClaudeLauncherWindow);
    addLog(`Registered new instance as: ${uniqueName}`);

    // Add a new tab with the unique component name
    dockingAddTab(uniqueName, `Claude Terminal ${uniqueName.split('_')[1]?.slice(-4) || ''}`, undefined, {});
  }, [addLog]);

  // Load requirements.txt on mount
  useEffect(() => {
    loadRequirements();
  }, [loadRequirements]);

  // Check package dependencies when venv is selected and requirements are loaded
  useEffect(() => {
    if (selectedVenv && requiredPackages.length > 0) {
      checkDeps();
    }
  }, [selectedVenv, requiredPackages, checkDeps]);

  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Cursor blink
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible(v => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  // F12 to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        setSidebarVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Save font size to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('claudeLauncher-fontSize', fontSize.toString());
  }, [fontSize]);

  // Strip ANSI escape sequences from text
  const stripAnsi = (text: string): string => {
    return text
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
      .replace(/\x1b[()][A-Za-z0-9]/g, '')
      .replace(/\x1b[78DEHMNOCFGIKZ=#>]/g, '')
      .replace(/\x07/g, '');
  };

  // Current cursor position
  const cursorColRef = useRef(0);
  const cursorRowRef = useRef(0);

  // Buffer for incomplete escape sequences
  const escapeBufferRef = useRef('');

  // Terminal dimensions
  const termRows = 30;
  const termCols = 120;

  // Alternate screen buffer support
  const mainScreenRef = useRef<TerminalLine[]>([]);
  const mainCursorRef = useRef({ row: 0, col: 0 });
  const isAltScreenRef = useRef(false);
  const [isAltScreen, setIsAltScreen] = useState(false);

  // Saved cursor position
  const savedCursorRef = useRef({ row: 0, col: 0 });

  // Scroll region (top and bottom margins, 0-indexed)
  const scrollTopRef = useRef(0);
  const scrollBottomRef = useRef(termRows - 1);

  // Current text style (updated by SGR sequences)
  const currentStyleRef = useRef<TextStyle>(defaultStyle());

  // Last printed character (for REP command)
  const lastCharRef = useRef(' ');

  // Debug
  const debugDataRef = useRef(false);

  // Helper to create an empty line with no spans
  const emptyLine = (): TerminalLine => ({ spans: [], timestamp: Date.now() });

  // Helper to get plain text from a line
  const getLineText = (line: TerminalLine): string => {
    return line.spans.map(s => s.text).join('');
  };

  // Helper to set character at position in a line (REPLACE, not insert)
  const setCharAt = (line: TerminalLine, col: number, char: string, style: TextStyle): TerminalLine => {
    const newSpans: StyledSpan[] = [];
    let pos = 0;
    let charSet = false;

    for (const span of line.spans) {
      const spanStart = pos;
      const spanEnd = pos + span.text.length;

      if (!charSet && col >= spanStart && col < spanEnd) {
        // The replacement position is within this span
        const relPos = col - spanStart;

        // Part before the replaced char
        if (relPos > 0) {
          newSpans.push({ text: span.text.substring(0, relPos), style: { ...span.style } });
        }

        // The new character with new style
        newSpans.push({ text: char, style: { ...style } });
        charSet = true;

        // Part after the replaced char
        if (relPos + 1 < span.text.length) {
          newSpans.push({ text: span.text.substring(relPos + 1), style: { ...span.style } });
        }
      } else {
        newSpans.push({ text: span.text, style: { ...span.style } });
      }

      pos = spanEnd;
    }

    // If position is beyond all spans, add padding and the character
    if (!charSet) {
      if (pos < col) {
        newSpans.push({ text: ' '.repeat(col - pos), style: {} });
      }
      newSpans.push({ text: char, style: { ...style } });
    }

    // Merge adjacent spans with same style
    const merged: StyledSpan[] = [];
    for (const span of newSpans) {
      if (span.text.length === 0) continue;
      const last = merged[merged.length - 1];
      if (last && JSON.stringify(last.style) === JSON.stringify(span.style)) {
        last.text += span.text;
      } else {
        merged.push({ text: span.text, style: { ...span.style } });
      }
    }

    return { spans: merged, timestamp: Date.now() };
  };

  // Helper to truncate line at position
  const truncateLineAt = (line: TerminalLine, col: number): TerminalLine => {
    const newSpans: StyledSpan[] = [];
    let pos = 0;

    for (const span of line.spans) {
      const spanEnd = pos + span.text.length;
      if (pos >= col) break;

      if (spanEnd <= col) {
        newSpans.push(span);
      } else {
        newSpans.push({ text: span.text.substring(0, col - pos), style: span.style });
        break;
      }
      pos = spanEnd;
    }

    return { spans: newSpans, timestamp: Date.now() };
  };

  // Helper to clear line from position with spaces
  const clearLineFrom = (line: TerminalLine, col: number): TerminalLine => {
    return truncateLineAt(line, col);
  };

  // Helper to clear line up to position
  const clearLineTo = (line: TerminalLine, col: number): TerminalLine => {
    const text = getLineText(line);
    const newSpans: StyledSpan[] = [{ text: ' '.repeat(Math.min(col, text.length)), style: {} }];

    let pos = 0;
    for (const span of line.spans) {
      const spanEnd = pos + span.text.length;
      if (spanEnd > col) {
        if (pos < col) {
          newSpans.push({ text: span.text.substring(col - pos), style: span.style });
        } else {
          newSpans.push(span);
        }
      }
      pos = spanEnd;
    }

    return { spans: newSpans, timestamp: Date.now() };
  };

  // Parse SGR parameters and update style
  const parseSGR = (params: string, currentStyle: TextStyle): TextStyle => {
    const style = { ...currentStyle };
    const parts = params.split(';').map(p => parseInt(p) || 0);

    let i = 0;
    while (i < parts.length) {
      const code = parts[i];

      if (code === 0) {
        // Reset
        Object.keys(style).forEach(k => delete (style as any)[k]);
      } else if (code === 1) {
        style.bold = true;
      } else if (code === 2) {
        style.dim = true;
      } else if (code === 3) {
        style.italic = true;
      } else if (code === 4) {
        style.underline = true;
      } else if (code === 7) {
        style.inverse = true;
      } else if (code === 9) {
        style.strikethrough = true;
      } else if (code === 22) {
        style.bold = false;
        style.dim = false;
      } else if (code === 23) {
        style.italic = false;
      } else if (code === 24) {
        style.underline = false;
      } else if (code === 27) {
        style.inverse = false;
      } else if (code === 29) {
        style.strikethrough = false;
      } else if (code >= 30 && code <= 37) {
        style.fg = ANSI_COLORS[code - 30];
      } else if (code === 38) {
        // Extended foreground color
        if (parts[i + 1] === 5 && parts[i + 2] !== undefined) {
          // 256 color
          style.fg = get256Color(parts[i + 2]);
          i += 2;
        } else if (parts[i + 1] === 2 && parts[i + 4] !== undefined) {
          // 24-bit color
          const r = parts[i + 2];
          const g = parts[i + 3];
          const b = parts[i + 4];
          style.fg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          i += 4;
        }
      } else if (code === 39) {
        delete style.fg;
      } else if (code >= 40 && code <= 47) {
        style.bg = ANSI_COLORS[code - 40];
      } else if (code === 48) {
        // Extended background color
        if (parts[i + 1] === 5 && parts[i + 2] !== undefined) {
          // 256 color
          style.bg = get256Color(parts[i + 2]);
          i += 2;
        } else if (parts[i + 1] === 2 && parts[i + 4] !== undefined) {
          // 24-bit color
          const r = parts[i + 2];
          const g = parts[i + 3];
          const b = parts[i + 4];
          style.bg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          i += 4;
        }
      } else if (code === 49) {
        delete style.bg;
      } else if (code >= 90 && code <= 97) {
        // Bright foreground
        style.fg = ANSI_COLORS[code - 90 + 8];
      } else if (code >= 100 && code <= 107) {
        // Bright background
        style.bg = ANSI_COLORS[code - 100 + 8];
      }

      i++;
    }

    return style;
  };

  // Parse incoming data into lines
  const appendOutput = useCallback((data: string) => {
    setLines(prev => {
      let updated = [...prev];

      if (updated.length === 0) {
        updated.push(emptyLine());
      }

      let cursorCol = cursorColRef.current;
      let cursorRow = cursorRowRef.current;
      let currentStyle = { ...currentStyleRef.current };

      if (!isAltScreenRef.current) {
        if (cursorRow >= updated.length) {
          cursorRow = updated.length - 1;
        }
      }

      while (updated.length <= cursorRow) {
        updated.push(emptyLine());
      }

      let fullData = escapeBufferRef.current + data;
      escapeBufferRef.current = '';

      if (debugDataRef.current) {
        const hex = Array.from(fullData).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
        console.log('Terminal data:', hex);
      }

      const ensureRow = (row: number) => {
        while (updated.length <= row) {
          updated.push(emptyLine());
        }
      };

      const scrollUp = () => {
        if (isAltScreenRef.current) {
          // In alt screen, respect scroll regions
          const top = scrollTopRef.current;
          const bottom = scrollBottomRef.current;
          // Remove line at top of scroll region
          updated.splice(top, 1);
          // Insert empty line at bottom of scroll region
          updated.splice(bottom, 0, emptyLine());
          // Ensure we maintain proper row count
          while (updated.length < termRows) {
            updated.push(emptyLine());
          }
          while (updated.length > termRows) {
            updated.pop();
          }
        } else {
          if (updated.length > 0) {
            updated.shift();
            updated.push(emptyLine());
          }
        }
      };

      const scrollDown = () => {
        if (isAltScreenRef.current) {
          const top = scrollTopRef.current;
          const bottom = scrollBottomRef.current;
          // Remove line at bottom of scroll region
          updated.splice(bottom, 1);
          // Insert empty line at top of scroll region
          updated.splice(top, 0, emptyLine());
          while (updated.length < termRows) {
            updated.push(emptyLine());
          }
          while (updated.length > termRows) {
            updated.pop();
          }
        } else {
          if (updated.length > 0) {
            updated.pop();
            updated.unshift(emptyLine());
          }
        }
      };

      let i = 0;
      while (i < fullData.length) {
        const char = fullData[i];

        if (char === '\x1b') {
          if (i + 1 >= fullData.length) {
            escapeBufferRef.current = fullData.substring(i);
            break;
          }

          const nextChar = fullData[i + 1];

          if (nextChar === '[') {
            let j = i + 2;
            let params = '';
            while (j < fullData.length && /[0-9;?]/.test(fullData[j])) {
              params += fullData[j];
              j++;
            }

            if (j >= fullData.length) {
              escapeBufferRef.current = fullData.substring(i);
              break;
            }

            const cmd = fullData[j];
            j++;

            if (cmd === 'm') {
              // SGR - Select Graphic Rendition (colors and text attributes)
              currentStyle = parseSGR(params || '0', currentStyle);
            } else if (cmd === 'K') {
              ensureRow(cursorRow);
              const mode = parseInt(params) || 0;
              if (mode === 0 || params === '') {
                updated[cursorRow] = clearLineFrom(updated[cursorRow], cursorCol);
              } else if (mode === 1) {
                updated[cursorRow] = clearLineTo(updated[cursorRow], cursorCol);
              } else if (mode === 2) {
                updated[cursorRow] = emptyLine();
              }
            } else if (cmd === 'P') {
              // Delete characters - rebuild spans without the deleted chars
              const n = parseInt(params) || 1;
              ensureRow(cursorRow);
              const text = getLineText(updated[cursorRow]);
              const newText = text.substring(0, cursorCol) + text.substring(cursorCol + n);
              // Rebuild with single span (simplified - preserving styles would be more complex)
              updated[cursorRow] = { spans: newText ? [{ text: newText, style: {} }] : [], timestamp: Date.now() };
            } else if (cmd === 'C') {
              const n = parseInt(params) || 1;
              cursorCol += n;
            } else if (cmd === 'D') {
              const n = parseInt(params) || 1;
              cursorCol = Math.max(0, cursorCol - n);
            } else if (cmd === 'A') {
              // Cursor Up - move cursor up, stop at top of screen
              const n = parseInt(params) || 1;
              cursorRow = Math.max(0, cursorRow - n);
              ensureRow(cursorRow);
            } else if (cmd === 'B') {
              // Cursor Down - move cursor down, stop at bottom of screen
              const n = parseInt(params) || 1;
              cursorRow += n;
              if (isAltScreenRef.current) {
                if (cursorRow >= termRows) {
                  cursorRow = termRows - 1;
                }
              }
              ensureRow(cursorRow);
            } else if (cmd === 'G') {
              const col = parseInt(params) || 1;
              cursorCol = col - 1;
            } else if (cmd === 'd') {
              const row = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                cursorRow = Math.min(row - 1, termRows - 1);
              } else {
                cursorRow = Math.min(row - 1, updated.length - 1);
              }
              ensureRow(cursorRow);
            } else if (cmd === 'X') {
              // Erase characters (replace with spaces)
              const n = parseInt(params) || 1;
              ensureRow(cursorRow);
              const text = getLineText(updated[cursorRow]);
              const before = text.substring(0, cursorCol);
              const after = text.substring(cursorCol + n);
              const newText = before + ' '.repeat(n) + after;
              updated[cursorRow] = { spans: [{ text: newText, style: {} }], timestamp: Date.now() };
            } else if (cmd === '@') {
              // Insert Character (ICH) - insert blank characters, shift existing text right
              const n = parseInt(params) || 1;
              ensureRow(cursorRow);
              const text = getLineText(updated[cursorRow]);
              const before = text.substring(0, cursorCol);
              const after = text.substring(cursorCol);
              const newText = before + ' '.repeat(n) + after;
              // Truncate to terminal width
              const finalText = newText.substring(0, termCols);
              updated[cursorRow] = { spans: finalText ? [{ text: finalText, style: {} }] : [], timestamp: Date.now() };
            } else if (cmd === 'b') {
              // REP - Repeat preceding graphic character
              const n = parseInt(params) || 1;
              const lastChar = lastCharRef.current;
              ensureRow(cursorRow);
              for (let k = 0; k < n; k++) {
                updated[cursorRow] = setCharAt(updated[cursorRow], cursorCol, lastChar, currentStyle);
                cursorCol++;
              }
            } else if (cmd === '~') {
              // Function key sequences - ignore
            } else if (cmd === 'J') {
              const mode = parseInt(params) || 0;
              if (mode === 3) {
                if (isAltScreenRef.current) {
                  updated = [];
                  for (let r = 0; r < termRows; r++) {
                    updated.push(emptyLine());
                  }
                  mainScreenRef.current = [emptyLine()];
                } else {
                  updated = [emptyLine()];
                }
                cursorRow = 0;
                cursorCol = 0;
              } else if (mode === 2) {
                if (isAltScreenRef.current) {
                  updated = [];
                  for (let r = 0; r < termRows; r++) {
                    updated.push(emptyLine());
                  }
                } else {
                  updated = [emptyLine()];
                }
                cursorRow = 0;
                cursorCol = 0;
              } else if (mode === 0) {
                ensureRow(cursorRow);
                updated[cursorRow] = clearLineFrom(updated[cursorRow], cursorCol);
                for (let r = cursorRow + 1; r < updated.length; r++) {
                  updated[r] = emptyLine();
                }
              } else if (mode === 1) {
                for (let r = 0; r < cursorRow; r++) {
                  updated[r] = emptyLine();
                }
                ensureRow(cursorRow);
                updated[cursorRow] = clearLineTo(updated[cursorRow], cursorCol);
              }
            } else if (cmd === 'H' || cmd === 'f') {
              const parts = params.split(';');
              const row = parseInt(parts[0]) || 1;
              const col = parseInt(parts[1]) || 1;
              if (isAltScreenRef.current) {
                cursorRow = Math.min(row - 1, termRows - 1);
                cursorCol = col - 1;
                ensureRow(cursorRow);
              } else {
                const targetRow = row - 1;
                if (targetRow < updated.length) {
                  cursorRow = targetRow;
                  cursorCol = col - 1;
                } else {
                  cursorRow = updated.length - 1;
                  cursorCol = col - 1;
                }
                ensureRow(cursorRow);
              }
            } else if (cmd === 'L') {
              const n = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                for (let k = 0; k < n; k++) {
                  updated.splice(cursorRow, 0, emptyLine());
                  if (updated.length > termRows) {
                    updated.pop();
                  }
                }
              } else {
                for (let k = 0; k < n; k++) {
                  updated.splice(cursorRow, 0, emptyLine());
                }
              }
            } else if (cmd === 'M') {
              const n = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                updated.splice(cursorRow, Math.min(n, updated.length - cursorRow));
                while (updated.length < termRows) {
                  updated.push(emptyLine());
                }
              } else {
                updated.splice(cursorRow, n);
                ensureRow(cursorRow);
              }
            } else if (cmd === 'S') {
              const n = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                for (let k = 0; k < n; k++) {
                  scrollUp();
                }
              }
            } else if (cmd === 'T' && !params.includes(';')) {
              const n = parseInt(params) || 1;
              for (let k = 0; k < n; k++) {
                scrollDown();
              }
            } else if (cmd === 's' && !params) {
              savedCursorRef.current = { row: cursorRow, col: cursorCol };
            } else if (cmd === 'u' && !params) {
              cursorRow = savedCursorRef.current.row;
              cursorCol = savedCursorRef.current.col;
              ensureRow(cursorRow);
            } else if (cmd === 'h' && params.startsWith('?')) {
              const modes = params.substring(1).split(';').map(s => parseInt(s));
              if (modes.some(m => m === 1049 || m === 47 || m === 1047)) {
                if (!isAltScreenRef.current) {
                  mainScreenRef.current = updated.map(line => ({ spans: [...line.spans], timestamp: line.timestamp }));
                  mainCursorRef.current = { row: cursorRow, col: cursorCol };
                  isAltScreenRef.current = true;
                  setIsAltScreen(true);
                  // Reset scroll region for alt screen
                  scrollTopRef.current = 0;
                  scrollBottomRef.current = termRows - 1;
                  updated = [];
                  for (let r = 0; r < termRows; r++) {
                    updated.push(emptyLine());
                  }
                  cursorRow = 0;
                  cursorCol = 0;
                }
              }
            } else if (cmd === 'l' && params.startsWith('?')) {
              const modes = params.substring(1).split(';').map(s => parseInt(s));
              if (modes.some(m => m === 1049 || m === 47 || m === 1047)) {
                if (isAltScreenRef.current) {
                  updated = mainScreenRef.current.length > 0
                    ? mainScreenRef.current.map(line => ({ spans: [...line.spans], timestamp: line.timestamp }))
                    : [emptyLine()];
                  cursorRow = Math.min(mainCursorRef.current.row, updated.length - 1);
                  cursorCol = mainCursorRef.current.col;
                  isAltScreenRef.current = false;
                  setIsAltScreen(false);
                  escapeBufferRef.current = '';
                }
              }
            } else if (cmd === 'r') {
              // DECSTBM - Set Top and Bottom Margins (Scrolling Region)
              if (params === '' || params === ';') {
                // Reset to full screen
                scrollTopRef.current = 0;
                scrollBottomRef.current = termRows - 1;
              } else {
                const parts = params.split(';');
                const top = (parseInt(parts[0]) || 1) - 1;
                const bottom = (parseInt(parts[1]) || termRows) - 1;
                scrollTopRef.current = Math.max(0, Math.min(top, termRows - 1));
                scrollBottomRef.current = Math.max(scrollTopRef.current, Math.min(bottom, termRows - 1));
              }
              // Move cursor to home position
              cursorRow = 0;
              cursorCol = 0;
            } else if (cmd === 'n') {
              // DSR - Device Status Report - ignore (terminal query)
            }

            i = j;
            continue;
          } else if (nextChar === ']') {
            let j = i + 2;
            while (j < fullData.length && fullData[j] !== '\x07' && !(fullData[j] === '\x1b' && fullData[j+1] === '\\')) j++;
            if (j >= fullData.length) {
              escapeBufferRef.current = fullData.substring(i);
              break;
            }
            if (fullData[j] === '\x07') j++;
            else if (fullData[j] === '\x1b') j += 2;
            i = j;
            continue;
          } else if (nextChar === 'D') {
            // Index - move cursor down, scroll up if at bottom of scroll region
            if (isAltScreenRef.current) {
              if (cursorRow >= scrollBottomRef.current) {
                scrollUp();
                cursorRow = scrollBottomRef.current;
              } else {
                cursorRow++;
              }
              ensureRow(cursorRow);
            } else {
              cursorRow++;
              if (cursorRow >= updated.length) {
                updated.push(emptyLine());
              }
              ensureRow(cursorRow);
            }
            i += 2;
            continue;
          } else if (nextChar === 'M') {
            // Reverse Index - move cursor up, scroll down if at top of scroll region
            if (isAltScreenRef.current) {
              if (cursorRow <= scrollTopRef.current) {
                scrollDown();
                cursorRow = scrollTopRef.current;
              } else {
                cursorRow--;
              }
            } else {
              cursorRow = Math.max(0, cursorRow - 1);
            }
            i += 2;
            continue;
          } else if (nextChar === 'E') {
            // Next Line - move to column 0 of next line, scroll if at bottom of scroll region
            if (isAltScreenRef.current) {
              if (cursorRow >= scrollBottomRef.current) {
                scrollUp();
                cursorRow = scrollBottomRef.current;
              } else {
                cursorRow++;
              }
              ensureRow(cursorRow);
            } else {
              cursorRow++;
              if (cursorRow >= updated.length) {
                updated.push(emptyLine());
              }
              ensureRow(cursorRow);
            }
            cursorCol = 0;
            i += 2;
            continue;
          } else if (nextChar === '7') {
            // DEC Save Cursor (DECSC)
            savedCursorRef.current = { row: cursorRow, col: cursorCol };
            i += 2;
            continue;
          } else if (nextChar === '8') {
            // DEC Restore Cursor (DECRC)
            cursorRow = savedCursorRef.current.row;
            cursorCol = savedCursorRef.current.col;
            ensureRow(cursorRow);
            i += 2;
            continue;
          } else {
            i += 2;
            continue;
          }
        }

        if (char === '[') {
          const afterBracket = fullData[i + 1];
          if (afterBracket && /[?0-9;]/.test(afterBracket)) {
            let j = i + 1;
            if (fullData[j] === '?') j++;
            while (j < fullData.length && /[0-9;]/.test(fullData[j])) j++;
            if (j < fullData.length && /[ABCDEFGHJKLMPSTXZfhlmnrsub~@]/.test(fullData[j])) {
              i = j + 1;
              continue;
            }
            if (j >= fullData.length && i + 1 < fullData.length) {
              escapeBufferRef.current = fullData.substring(i);
              break;
            }
          }
        }

        if (/[0-9]/.test(char)) {
          let j = i;
          while (j < fullData.length && /[0-9;]/.test(fullData[j])) j++;
          if (j < fullData.length && j > i && /[ABCDEFGHJKLMPSTXZrnb~@]/.test(fullData[j])) {
            i = j + 1;
            continue;
          }
        }

        if (char === '\r') {
          cursorCol = 0;
          i++;
          continue;
        }

        if (char === '\n') {
          if (isAltScreenRef.current) {
            if (cursorRow >= scrollBottomRef.current) {
              // At bottom of scroll region, scroll up
              scrollUp();
              cursorRow = scrollBottomRef.current;
            } else {
              cursorRow++;
            }
            ensureRow(cursorRow);
          } else {
            cursorRow++;
            if (cursorRow >= updated.length) {
              updated.push(emptyLine());
            }
            ensureRow(cursorRow);
          }
          cursorCol = 0;
          i++;
          continue;
        }

        if (char === '\x08') {
          if (cursorCol > 0) {
            cursorCol--;
          }
          i++;
          continue;
        }

        if (char === '\x7f') {
          if (cursorCol > 0) {
            cursorCol--;
          }
          i++;
          continue;
        }

        if (char === '\x07') {
          i++;
          continue;
        }

        if (char === '\t') {
          // Tab - move cursor to next tab stop (every 8 columns)
          const tabStop = 8;
          const nextTab = Math.floor(cursorCol / tabStop) * tabStop + tabStop;
          cursorCol = Math.min(nextTab, termCols - 1);
          i++;
          continue;
        }

        if (char.charCodeAt(0) < 32) {
          i++;
          continue;
        }

        ensureRow(cursorRow);
        // Replace character at cursor position with current style
        updated[cursorRow] = setCharAt(updated[cursorRow], cursorCol, char, currentStyle);
        // Track last printed character for REP command
        lastCharRef.current = char;
        cursorCol++;
        i++;
      }

      // Save current style for next call
      currentStyleRef.current = currentStyle;

      cursorColRef.current = cursorCol;
      cursorRowRef.current = cursorRow;
      setDisplayCursorCol(cursorCol);
      setDisplayCursorRow(cursorRow);

      if (isAltScreenRef.current) {
        while (updated.length > termRows) {
          updated.shift();
        }
        while (updated.length < termRows) {
          updated.push(emptyLine());
        }
      } else {
        if (updated.length > MAX_LINES) {
          updated = updated.slice(-MAX_LINES);
        }
      }

      return updated;
    });
  }, []);

  // Start server
  const startServer = useCallback(async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    if (!selectedVenv) {
      addLog('ERROR: No venv selected');
      return;
    }

    setConnecting(true);
    addLog('Starting terminal server for Claude...');

    try {
      const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
        workflowFolder: 'ClaudeLauncher',
        scriptName: 'terminal_server.py'
      });

      if (!scriptResult.success) {
        addLog(`ERROR: Could not find server script: ${scriptResult.error}`);
        setConnecting(false);
        return;
      }

      addLog(`Script path: ${scriptResult.path}`);

      const result = await ipcRenderer.invoke('python-start-script-server', {
        venvName: selectedVenv,
        scriptPath: scriptResult.path,
        port: serverPort,
        serverName: instanceId
      });

      if (result.success) {
        addLog(`Server started on port ${serverPort}`);
        setServerRunning(true);

        // Wait a moment then connect
        setTimeout(() => connectWebSocket(), 1500);
      } else {
        addLog(`ERROR: ${result.error}`);
        setConnecting(false);
      }
    } catch (e) {
      addLog(`ERROR: ${e}`);
      setConnecting(false);
    }
  }, [ipcRenderer, selectedVenv, serverPort, instanceId, addLog]);

  // Stop server
  const stopServer = async () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setClaudeLaunched(false);
    setDirectoryChanged(false);
    setClaudeInstallState('unchecked');
    terminalOutputRef.current = '';

    if (!ipcRenderer) return;

    const result = await ipcRenderer.invoke('python-stop-script-server', instanceId);
    if (result.success) {
      addLog('Server stopped');
    }
    setServerRunning(false);
  };

  // Connect WebSocket
  const connectWebSocket = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    addLog(`Connecting to ws://127.0.0.1:${serverPort}/ws/terminal`);

    // Get venv path
    let venvPath: string | undefined;
    if (selectedVenv && ipcRenderer) {
      try {
        const result = await ipcRenderer.invoke('python-list-venvs');
        if (result.success && result.venvs) {
          const venv = result.venvs.find((v: any) => v.name === selectedVenv);
          if (venv) {
            venvPath = venv.path;
            addLog(`Found venv path: ${venvPath}`);
          }
        }
      } catch (e) {
        addLog(`WARN: Could not get venv path: ${e}`);
      }
    }

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/terminal`);

    ws.onopen = () => {
      addLog('WebSocket connected');
      setConnected(true);
      setConnecting(false);
      setSidebarVisible(false); // Hide sidebar once connected

      // Send initial config - use cmd for Claude
      const config = {
        shell: 'cmd',
        cols: 120,
        rows: 30,
        venvPath: venvPath
      };
      addLog(`Sending config: ${JSON.stringify(config)}`);
      ws.send(JSON.stringify(config));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'output') {
          appendOutput(data.data);

          // Track output for Claude installation checking
          const stripped = stripAnsi(data.data);
          terminalOutputRef.current += stripped;

          // Keep only last 2000 chars to avoid memory issues
          if (terminalOutputRef.current.length > 2000) {
            terminalOutputRef.current = terminalOutputRef.current.slice(-2000);
          }

          // Check if we're at a prompt and should launch Claude
          const strippedTrimmed = stripped.trimEnd();
          if ((strippedTrimmed.endsWith('>') || strippedTrimmed.endsWith('$')) && !claudeLaunched) {
            setIsAtPrompt(true);
          }
        } else if (data.type === 'connected') {
          appendOutput(data.message);
        } else if (data.type === 'error') {
          addLog(`Terminal error: ${data.message}`);
        }
      } catch (e) {
        appendOutput(event.data);
      }
    };

    ws.onerror = (err) => {
      addLog('WebSocket error');
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      addLog('WebSocket closed');
      setConnected(false);
      setConnecting(false);
    };

    wsRef.current = ws;
  }, [serverPort, selectedVenv, ipcRenderer, addLog, appendOutput, claudeLaunched]);

  // Auto-launch Claude when at prompt (first change directory, check if installed, then launch)
  useEffect(() => {
    if (isAtPrompt && connected && !claudeLaunched && wsRef.current) {
      // Small delay to ensure prompt is fully ready
      const timer = setTimeout(() => {
        if (!directoryChanged) {
          // First, navigate to the examples directory
          addLog('Navigating to examples directory...');
          wsRef.current?.send(JSON.stringify({
            type: 'input',
            data: 'cd %USERPROFILE%\\ContextUI\\Default\\workflows\\examples\r'
          }));
          setDirectoryChanged(true);
          setIsAtPrompt(false);
        } else if (claudeInstallState === 'unchecked') {
          // Check if Claude is installed by looking for the exe at known location, then PATH
          addLog('Checking if Claude CLI is installed...');
          terminalOutputRef.current = ''; // Clear output buffer
          wsRef.current?.send(JSON.stringify({
            type: 'input',
            data: 'if exist "%USERPROFILE%\\.local\\bin\\claude.exe" (echo CLAUDEYES) else (where claude 2>nul || echo CLAUDENO)\r'
          }));
          setClaudeInstallState('checking');
          setIsAtPrompt(false);
        } else if (claudeInstallState === 'checking') {
          // Check the output - look for exact line matches to avoid matching the command echo
          const output = terminalOutputRef.current;
          const lines = output.split(/[\r\n]+/).map(l => l.trim().toLowerCase());

          // Check for our markers as standalone lines (not part of command echo)
          const hasClaudeYes = lines.some(l => l === 'claudeyes');
          const hasClaudeNo = lines.some(l => l === 'claudeno');
          const hasClaudePath = lines.some(l => l.endsWith('claude.exe') && !l.includes('echo') && !l.includes('exist'));

          if (hasClaudeYes || hasClaudePath) {
            // Claude is installed (either at known path or in PATH)
            addLog('Claude CLI found, launching...');
            setClaudeInstallState('ready');
            // Use full path to be safe
            wsRef.current?.send(JSON.stringify({
              type: 'input',
              data: '"%USERPROFILE%\\.local\\bin\\claude.exe"\r'
            }));
            setClaudeLaunched(true);
            setIsAtPrompt(false);
          } else if (hasClaudeNo) {
            // Claude is not installed, run installer
            addLog('Claude CLI not found, installing...');
            terminalOutputRef.current = '';
            wsRef.current?.send(JSON.stringify({
              type: 'input',
              data: 'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd\r'
            }));
            setClaudeInstallState('installing');
            setIsAtPrompt(false);
          } else {
            // Still waiting for output, stay in checking state
            setIsAtPrompt(false);
          }
        } else if (claudeInstallState === 'installing') {
          // Installation finished, now launch Claude using full path (PATH not updated in current session)
          addLog('Installation complete, launching Claude...');
          setClaudeInstallState('ready');
          wsRef.current?.send(JSON.stringify({
            type: 'input',
            data: '"%USERPROFILE%\\.local\\bin\\claude.exe"\r'
          }));
          setClaudeLaunched(true);
          setIsAtPrompt(false);
        } else if (claudeInstallState === 'ready') {
          // Ready to launch Claude
          addLog('Launching Claude...');
          wsRef.current?.send(JSON.stringify({
            type: 'input',
            data: 'claude\r'
          }));
          setClaudeLaunched(true);
          setIsAtPrompt(false);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isAtPrompt, connected, claudeLaunched, directoryChanged, claudeInstallState, addLog]);

  // Auto-start server when venv is available and all packages are installed
  useEffect(() => {
    const allPackagesInstalled = requiredPackages.length > 0 && requiredPackages.every(p => depsStatus[p]?.installed);
    if (selectedVenv && allPackagesInstalled && !autoStartedRef.current && !serverRunning && !connecting) {
      autoStartedRef.current = true;
      // Small delay to ensure component is fully mounted
      const timer = setTimeout(() => {
        startServer();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [selectedVenv, requiredPackages, depsStatus, serverRunning, connecting, startServer]);

  // Send input
  const sendInput = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'input',
        data: text
      }));
    }
  }, []);

  // Handle key input
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!connected) return;

    e.preventDefault();

    // Handle Alt+V for image paste (Claude Code style)
    if (e.altKey && (e.key === 'v' || e.key === 'V')) {
      navigator.clipboard.read().then(async (items) => {
        for (const item of items) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            try {
              const blob = await item.getType(imageType);
              const buffer = await blob.arrayBuffer();
              const fs = (window as any).require?.('fs');
              const os = (window as any).require?.('os');
              const path = (window as any).require?.('path');

              if (fs && os && path) {
                const ext = imageType.split('/')[1] || 'png';
                const tempPath = path.join(os.tmpdir(), `claude-paste-${Date.now()}.${ext}`);
                fs.writeFileSync(tempPath, Buffer.from(buffer));

                // Send the file path using Claude's @ syntax
                const pathText = `@${tempPath} `;
                for (const ch of pathText) {
                  sendInput(ch);
                }
                addLog(`Image pasted: ${tempPath}`);
              } else {
                addLog('ERROR: Could not access filesystem APIs');
              }
            } catch (err: any) {
              addLog(`ERROR reading image: ${err.message}`);
            }
            return;
          }
        }
        // No image found in clipboard
        addLog('No image found in clipboard');
      }).catch((err) => {
        addLog(`Clipboard error: ${err.message}`);
      });
      return;
    }

    if (e.ctrlKey) {
      if (e.key === 'c' || e.key === 'C') {
        sendInput('\x03');
        setUserInput('');
        setUserInputCursor(0);
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        sendInput('\x04');
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        navigator.clipboard.readText().then(text => {
          if (text) {
            const cleanText = text.replace(/[\r\n]/g, '');
            setUserInput(prev => {
              const newInput = prev.substring(0, userInputCursor) + cleanText + prev.substring(userInputCursor);
              setUserInputCursor(userInputCursor + cleanText.length);
              return newInput;
            });
            for (const ch of cleanText) {
              sendInput(ch);
            }
          }
        }).catch(() => {});
        return;
      }
      return;
    }

    if (e.key === 'Enter') {
      sendInput('\r');
      setUserInput('');
      setUserInputCursor(0);
      setIsAtPrompt(false);
      return;
    }

    if (e.key === 'Backspace') {
      if (userInputCursor > 0) {
        setUserInput(prev => prev.substring(0, userInputCursor - 1) + prev.substring(userInputCursor));
        setUserInputCursor(prev => prev - 1);
      }
      sendInput('\x7f');
      return;
    }

    if (e.key === 'Delete') {
      setUserInput(prev => prev.substring(0, userInputCursor) + prev.substring(userInputCursor + 1));
      sendInput('\x1b[3~');
      return;
    }

    if (e.key === 'ArrowUp') {
      sendInput('\x1b[A');
      return;
    }
    if (e.key === 'ArrowDown') {
      sendInput('\x1b[B');
      return;
    }
    if (e.key === 'ArrowLeft') {
      setUserInputCursor(prev => Math.max(0, prev - 1));
      sendInput('\x1b[D');
      return;
    }
    if (e.key === 'ArrowRight') {
      setUserInputCursor(prev => Math.min(userInput.length, prev + 1));
      sendInput('\x1b[C');
      return;
    }

    if (e.key === 'Tab') {
      sendInput('\t');
      return;
    }

    if (e.key === 'Escape') {
      sendInput('\x1b');
      return;
    }

    if (e.key.length === 1) {
      setUserInput(prev => prev.substring(0, userInputCursor) + e.key + prev.substring(userInputCursor));
      setUserInputCursor(prev => prev + 1);
      sendInput(e.key);
      return;
    }
  }, [connected, sendInput, userInput, userInputCursor]);

  // Focus terminal on click
  const handleTerminalClick = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }
    inputRef.current?.focus();
  };

  // Cleanup on unmount - stop Python server to prevent orphaned processes
  useEffect(() => {
    const currentInstanceId = instanceIdRef.current;
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      // Stop the Python server if it's running
      if (serverRunningRef.current && ipcRenderer) {
        ipcRenderer.invoke('python-stop-script-server', currentInstanceId);
      }
    };
  }, [ipcRenderer]);

  return (
    <div className="flex h-full bg-[#1a1a2e]">
      {/* Side Panel - Toggle with F12 */}
      {sidebarVisible && (
      <div className="w-[200px] p-2.5 bg-[rgba(30,30,50,0.95)] overflow-y-auto text-xs text-white border-r border-slate-700">
        {/* Status */}
        <div className={`p-2 rounded mb-2.5 text-center ${
          claudeLaunched ? 'bg-pink-400/30' : claudeInstallState === 'installing' ? 'bg-orange-500/30' : connected ? 'bg-green-500/20' : serverRunning ? 'bg-yellow-500/20' : 'bg-slate-500/20'
        }`}>
          <span className={
            claudeLaunched ? 'text-pink-400' : claudeInstallState === 'installing' ? 'text-orange-500' : connected ? 'text-green-400' : serverRunning ? 'text-yellow-400' : 'text-slate-500'
          }>
            {claudeLaunched ? '● CLAUDE RUNNING' : claudeInstallState === 'installing' ? '● INSTALLING CLAUDE...' : claudeInstallState === 'checking' ? '● CHECKING CLAUDE...' : connected ? '● CONNECTED' : serverRunning ? '● STARTING...' : '○ DISCONNECTED'}
          </span>
        </div>

        <div className="flex justify-between items-center mb-2.5">
          <h3 className="text-pink-400 m-0 text-[13px]">Claude Launcher</h3>
          <button
            onClick={spawnNewInstance}
            title="Open new Claude terminal instance"
            className="bg-cyan-600 border-none text-white py-1 px-2 rounded cursor-pointer text-[10px] flex items-center gap-0.5 hover:bg-cyan-500 transition-colors"
          >
            + New
          </button>
        </div>

        <div className="mb-2">
          <label className="text-slate-500 block mb-1 text-[11px]">Python Venv:</label>
          <div className="flex gap-1">
            <select
              value={selectedVenv}
              onChange={(e) => setSelectedVenv(e.target.value)}
              disabled={serverRunning}
              className="flex-1 bg-slate-700 border border-slate-600 text-white p-1 text-[11px] disabled:opacity-50"
            >
              {availableVenvs.length === 0 && <option value="">No venvs available</option>}
              {availableVenvs.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCreateVenv(!showCreateVenv)}
              disabled={serverRunning || creatingVenv}
              title="Create new venv"
              className={`border border-slate-600 text-white py-1 px-2 text-[11px] rounded-sm disabled:cursor-not-allowed ${
                showCreateVenv ? 'bg-pink-400' : 'bg-slate-700'
              }`}
            >
              +
            </button>
          </div>
          {showCreateVenv && (
            <div className="mt-1.5 flex gap-1">
              <input
                type="text"
                value={newVenvName}
                onChange={(e) => setNewVenvName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createVenv()}
                placeholder="Venv name..."
                disabled={creatingVenv}
                className="flex-1 bg-slate-700 border border-slate-600 text-white p-1 text-[11px] disabled:opacity-50"
              />
              <button
                onClick={createVenv}
                disabled={creatingVenv || !newVenvName.trim()}
                className={`border-none text-white py-1 px-2 text-[11px] rounded-sm disabled:cursor-wait ${
                  creatingVenv ? 'bg-slate-700' : 'bg-cyan-600 hover:bg-cyan-500'
                }`}
              >
                {creatingVenv ? '...' : 'Create'}
              </button>
            </div>
          )}
        </div>

        <div className="mb-2.5">
          <label className="text-slate-500 block mb-1 text-[11px]">Port:</label>
          <input
            type="number"
            value={serverPort}
            onChange={(e) => setServerPort(parseInt(e.target.value) || 8781)}
            disabled={serverRunning}
            className="w-full bg-slate-700 border border-slate-600 text-white p-1 text-[11px] disabled:opacity-50"
          />
        </div>

        <div className="mb-2.5">
          <label className="text-slate-500 block mb-1 text-[11px]">Font Size: {fontSize}px</label>
          <input
            type="range"
            min="10"
            max="24"
            value={fontSize}
            onChange={(e) => setFontSize(parseInt(e.target.value))}
            className="w-full accent-pink-400"
          />
        </div>

        {/* Package Manager Section */}
        {selectedVenv && (
          <div className="mb-2.5 p-2 bg-[rgba(30,30,50,0.8)] rounded border border-slate-600">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-slate-500 text-[11px] font-bold">
                Packages {checkingDeps && '(checking...)'}
              </span>
              <button
                onClick={installMissing}
                disabled={installingDeps || requiredPackages.length === 0 || requiredPackages.every(p => depsStatus[p]?.installed)}
                className={`border-none text-white py-0.5 px-2 rounded text-[10px] disabled:cursor-default ${
                  (installingDeps || requiredPackages.every(p => depsStatus[p]?.installed)) ? 'bg-slate-700' : 'bg-cyan-600 hover:bg-cyan-500 cursor-pointer'
                }`}
              >
                {installingDeps ? 'Installing...' : 'Install All'}
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {requiredPackages.length === 0 ? (
                <span className="text-[10px] text-slate-600">Loading requirements...</span>
              ) : (
                requiredPackages.map(pkg => {
                  const st = depsStatus[pkg];
                  const isInstalled = st?.installed;
                  // Show cleaner name but keep full spec
                  const displayName = pkg.replace(/\[.*\]/, match => `[${match.slice(1, -1)}]`);
                  return (
                    <div
                      key={pkg}
                      title={pkg}
                      className={`flex items-center justify-between py-1 px-1.5 rounded ${
                        isInstalled ? 'bg-green-500/15 border border-green-500/40' : 'bg-red-500/15 border border-red-500/40'
                      }`}
                    >
                      <span className={`text-[10px] ${isInstalled ? 'text-green-300' : 'text-red-300'}`}>
                        {displayName}
                      </span>
                      <span className={`text-[10px] ${isInstalled ? 'text-green-400' : 'text-red-400'}`}>
                        {isInstalled ? '✓' : '✗'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        <div className="flex gap-1.5 mb-2.5">
          {!serverRunning ? (
            <button
              onClick={startServer}
              disabled={connecting || !selectedVenv}
              className="flex-1 bg-pink-400 border-none text-white p-2 rounded cursor-pointer text-[11px] disabled:cursor-wait hover:bg-pink-300 transition-colors"
            >
              {connecting ? 'Starting...' : 'Launch Claude'}
            </button>
          ) : (
            <button
              onClick={stopServer}
              className="flex-1 bg-red-600 border-none text-white p-2 rounded cursor-pointer text-[11px] hover:bg-red-500 transition-colors"
            >
              Stop
            </button>
          )}
        </div>

        {serverRunning && !connected && (
          <button
            onClick={connectWebSocket}
            disabled={connecting}
            className="w-full bg-pink-400 border-none text-white p-2 rounded cursor-pointer text-[11px] mb-2.5 hover:bg-pink-300 transition-colors disabled:cursor-wait"
          >
            Reconnect
          </button>
        )}

        <h3 className="text-pink-400 my-3 text-[13px]">Logs</h3>
        <div className="bg-slate-950 p-1.5 rounded max-h-[150px] overflow-y-auto text-[10px] font-mono">
          {logs.map((log, i) => (
            <div key={i} className={log.includes('ERROR') ? 'text-red-400' : 'text-slate-500'}>{log}</div>
          ))}
        </div>

        <h3 className="text-pink-400 my-3 text-[13px]">Shortcuts</h3>
        <div className="text-[10px] text-slate-500">
          <div><span className="text-pink-400">Ctrl+C</span> - Interrupt</div>
          <div><span className="text-pink-400">Ctrl+D</span> - EOF</div>
          <div><span className="text-pink-400">Ctrl+V</span> - Paste text</div>
          <div><span className="text-pink-400">Alt+V</span> - Paste image</div>
          <div><span className="text-pink-400">Escape</span> - Cancel</div>
          <div><span className="text-pink-400">Tab</span> - Autocomplete</div>
          <div><span className="text-pink-400">F12</span> - Toggle sidebar</div>
        </div>
      </div>
      )}

      {/* Terminal Area */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col relative"
        onClick={handleTerminalClick}
      >
        {/* Terminal output */}
        <div
          ref={outputRef}
          className="flex-1 bg-[#0c0c1a] p-2.5 font-mono text-slate-200 overflow-y-auto whitespace-pre-wrap break-all cursor-text select-text"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: `${Math.round(fontSize * 1.3)}px`,
          }}
        >
          {lines.map((line, idx) => {
            const isLastLine = idx === lines.length - 1;

            // Render styled spans for a line
            const renderSpans = (spans: StyledSpan[]) => {
              if (spans.length === 0) return null;

              return spans.map((span, spanIdx) => {
                const style: React.CSSProperties = {};

                if (span.style.inverse) {
                  // Swap foreground and background for inverse
                  style.backgroundColor = span.style.fg || '#e0e0e0';
                  style.color = span.style.bg || '#0c0c1a';
                } else {
                  if (span.style.fg) style.color = span.style.fg;
                  if (span.style.bg) style.backgroundColor = span.style.bg;
                }

                if (span.style.bold) style.fontWeight = 'bold';
                if (span.style.dim) style.opacity = 0.5;
                if (span.style.italic) style.fontStyle = 'italic';
                if (span.style.underline) style.textDecoration = 'underline';
                if (span.style.strikethrough) {
                  style.textDecoration = style.textDecoration
                    ? `${style.textDecoration} line-through`
                    : 'line-through';
                }

                return (
                  <span key={spanIdx} style={style}>
                    {span.text}
                  </span>
                );
              });
            };

            if (isLastLine && connected) {
              if (isFocused) {
                return (
                  <div key={idx}>
                    {renderSpans(line.spans)}
                    <span className={cursorVisible ? 'bg-pink-400 text-[#0c0c1a]' : 'bg-transparent text-slate-200'}>{' '}</span>
                  </div>
                );
              }

              return <div key={idx}>{line.spans.length > 0 ? renderSpans(line.spans) : ' '}</div>;
            }

            return <div key={idx}>{line.spans.length > 0 ? renderSpans(line.spans) : ' '}</div>;
          })}
        </div>

        {/* Hidden input */}
        <input
          ref={inputRef}
          type="text"
          value=""
          onChange={() => {}}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="absolute opacity-0 pointer-events-none"
          autoFocus
        />

        {/* Status bar */}
        <div className="h-6 bg-slate-950 border-t border-slate-700 flex items-center px-2.5 font-mono text-[11px] text-slate-500">
          <span>{claudeLaunched ? 'Claude is running - Type to interact (F12 to access settings)' : claudeInstallState === 'installing' ? 'Installing Claude CLI...' : claudeInstallState === 'checking' ? 'Checking for Claude CLI...' : connected ? (isFocused ? 'Ready' : 'Click to focus') : 'Disconnected'}</span>
          {connected && (
            <span className={`ml-auto ${isFocused ? 'text-pink-400' : 'text-slate-600'}`}>
              {isFocused ? '● FOCUSED' : '○ UNFOCUSED'}
            </span>
          )}
        </div>

        {/* Connection overlay */}
        {!connected && (
          <div className="absolute top-0 left-0 right-0 bottom-6 bg-black/70 flex flex-col items-center justify-center text-slate-500 text-base gap-3">
            {!selectedVenv && (
              <>
                <div className="text-pink-400">No Python Venv Selected</div>
                <div className="text-xs">Select a venv in the sidebar</div>
              </>
            )}
            {selectedVenv && requiredPackages.length > 0 && !requiredPackages.every(p => depsStatus[p]?.installed) && (
              <>
                <div className="text-orange-500">Missing Packages</div>
                <div className="text-xs">Click "Install All" in the sidebar to install required packages</div>
              </>
            )}
            {selectedVenv && requiredPackages.length > 0 && requiredPackages.every(p => depsStatus[p]?.installed) && (
              connecting ? 'Starting Claude...' : (installingDeps ? 'Installing packages...' : 'Ready to start')
            )}
          </div>
        )}
      </div>
    </div>
  );
};

ClaudeLauncherWindow;
