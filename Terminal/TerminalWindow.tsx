import React, { useRef, useEffect, useState, useCallback } from 'react';

// Terminal state
interface TerminalLine {
  text: string;
  timestamp: number;
}

// Required packages for PTY server
const REQUIRED_PACKAGES = [
  'pywinpty',
  'fastapi',
  'uvicorn'
];

// Helper to normalize package names (handle hyphens vs underscores)
const normalizePackageName = (name: string): string =>
  name.toLowerCase().replace(/-/g, '_');

// Parse package info from pip output
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

export const TerminalWindow: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Connection state
  const [serverPort, setServerPort] = useState(8780);
  const [serverRunning, setServerRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');
  const [shell, setShell] = useState<string>('cmd');
  const [logs, setLogs] = useState<string[]>([]);

  // Dependency checking state
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);

  // Terminal state
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [isFocused, setIsFocused] = useState(false);
  const [displayCursorCol, setDisplayCursorCol] = useState(0);
  const [displayCursorRow, setDisplayCursorRow] = useState(0);

  // Track user's current input line separately for clean display
  const [userInput, setUserInput] = useState('');
  const [userInputCursor, setUserInputCursor] = useState(0);
  const [isAtPrompt, setIsAtPrompt] = useState(false);

  // Track conda environment for prompt display
  const [condaEnv, setCondaEnv] = useState<string>('');

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);

  // Terminal config
  const MAX_LINES = 1000;

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${msg}`]);
  }, []);

  // Store full venv info (name and path)
  const [venvInfoMap, setVenvInfoMap] = useState<Record<string, string>>({});

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
        if (!selectedVenv && names.length > 0) {
          setSelectedVenv(names[0]);
        }
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
            const map: Record<string, { installed: boolean; version?: string }> = {};
            for (const pkg of REQUIRED_PACKAGES) {
              const result = findInstalledPackage(v.packages, pkg);
              map[pkg] = {
                installed: result.found,
                version: result.version
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

        const result = await ipcRenderer.invoke('python-install-package', {
          venvName: selectedVenv,
          package: pkg,
        });

        if (result.success) {
          addLog(`${pkg} installed`);
          setDepsStatus(prev => ({
            ...prev,
            [pkg]: { installed: true, version: undefined }
          }));
        } else {
          addLog(`ERROR installing ${pkg}: ${result.error}`);
        }
      }

      addLog('Dependency installation complete');

      // Re-check deps after installation
      const vres = await ipcRenderer.invoke('python-list-venvs');
      if (vres.success) {
        const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
        if (v && Array.isArray(v.packages)) {
          const map: Record<string, { installed: boolean; version?: string }> = {};
          for (const pkg of REQUIRED_PACKAGES) {
            const result = findInstalledPackage(v.packages, pkg);
            map[pkg] = {
              installed: result.found,
              version: result.version
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

  // Check if all deps are installed
  const allDepsInstalled = REQUIRED_PACKAGES.every(pkg => depsStatus[pkg]?.installed);
  const missingDepsCount = REQUIRED_PACKAGES.filter(pkg => !depsStatus[pkg]?.installed).length;

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

  // Strip ANSI escape sequences from text
  const stripAnsi = (text: string): string => {
    // Remove CSI sequences: ESC [ ... letter
    // Remove OSC sequences: ESC ] ... BEL or ST
    // Remove other escape sequences
    return text
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')  // CSI sequences
      .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC sequences (BEL terminated)
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')     // OSC sequences (ST terminated)
      .replace(/\x1b[()][A-Za-z0-9]/g, '')      // Character set selection
      .replace(/\x1b[78DEHMNOCFGIKZ=#>]/g, '')  // Other escape sequences
      .replace(/\x07/g, '');                     // Bell character
  };

  // Current cursor position - column (x) and row (y) for 2D screen buffer
  const cursorColRef = useRef(0);
  const cursorRowRef = useRef(0);

  // Buffer for incomplete escape sequences across data chunks
  const escapeBufferRef = useRef('');

  // Terminal dimensions (for screen buffer mode)
  const termRows = 30;
  const termCols = 120;

  // Alternate screen buffer support (for full-screen apps like vim, less, claude)
  const mainScreenRef = useRef<TerminalLine[]>([]);
  const mainCursorRef = useRef({ row: 0, col: 0 });
  const isAltScreenRef = useRef(false);
  const [isAltScreen, setIsAltScreen] = useState(false);

  // Saved cursor position for CSI s/u (DECSC/DECRC)
  const savedCursorRef = useRef({ row: 0, col: 0 });

  // Debug: log raw data
  const debugDataRef = useRef(false);

  // Parse incoming data into lines (handles terminal control chars)
  const appendOutput = useCallback((data: string) => {
    setLines(prev => {
      let updated = [...prev];

      // Ensure we have at least one line
      if (updated.length === 0) {
        updated.push({ text: '', timestamp: Date.now() });
      }

      // Get current cursor column position
      let cursorCol = cursorColRef.current;

      // Track cursor row position - use saved position for both modes
      // This allows cursor movement (like CSI A for cursor up) to work in normal mode too
      let cursorRow = cursorRowRef.current;

      // In normal mode, ensure cursorRow is within bounds of the buffer
      if (!isAltScreenRef.current) {
        // If cursor is beyond the buffer (e.g., after lines were added), clamp it
        if (cursorRow >= updated.length) {
          cursorRow = updated.length - 1;
        }
      }

      // Ensure we have enough rows (only matters for alt screen)
      while (updated.length <= cursorRow) {
        updated.push({ text: '', timestamp: Date.now() });
      }

      // Prepend any buffered escape sequence data
      let fullData = escapeBufferRef.current + data;
      escapeBufferRef.current = '';

      // Debug logging
      if (debugDataRef.current) {
        const hex = Array.from(fullData).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
        console.log('Terminal data:', hex);
        console.log('  Readable:', fullData.replace(/[\x00-\x1f]/g, c => `<${c.charCodeAt(0).toString(16)}>`));
        console.log('  Cursor before:', cursorRow, cursorCol, 'Line:', updated[cursorRow]?.text);
      }

      // Helper to ensure row exists
      const ensureRow = (row: number) => {
        while (updated.length <= row) {
          updated.push({ text: '', timestamp: Date.now() });
        }
      };

      // Helper to scroll screen up by one line (for alt screen mode)
      const scrollUp = () => {
        if (updated.length > 0) {
          updated.shift(); // Remove top line
          updated.push({ text: '', timestamp: Date.now() }); // Add empty line at bottom
        }
      };

      // Process character by character like the OpenGL terminal
      let i = 0;
      while (i < fullData.length) {
        const char = fullData[i];

        // Handle escape sequences - skip them
        if (char === '\x1b') {
          // Check if we have enough data to parse the sequence
          if (i + 1 >= fullData.length) {
            // Incomplete - buffer for next chunk
            escapeBufferRef.current = fullData.substring(i);
            break;
          }

          const nextChar = fullData[i + 1];

          if (nextChar === '[') {
            // CSI sequence: ESC [ params command
            let j = i + 2;
            let params = '';
            // Collect parameters (digits, semicolons, question marks)
            while (j < fullData.length && /[0-9;?]/.test(fullData[j])) {
              params += fullData[j];
              j++;
            }

            // Check if we have the command character
            if (j >= fullData.length) {
              // Incomplete sequence - buffer for next chunk
              escapeBufferRef.current = fullData.substring(i);
              break;
            }

            const cmd = fullData[j];
            j++; // Skip the command character

            // Handle CSI sequences that affect cursor/content
            if (cmd === 'K') {
              // Erase in line - CSI K or CSI 0K clears from cursor to end
              ensureRow(cursorRow);
              let currentText = updated[cursorRow].text;
              const mode = parseInt(params) || 0;
              if (mode === 0 || params === '') {
                // Clear from cursor to end of line
                currentText = currentText.substring(0, cursorCol);
              } else if (mode === 1) {
                // Clear from start of line to cursor
                currentText = ' '.repeat(cursorCol) + currentText.substring(cursorCol);
              } else if (mode === 2) {
                // Clear entire line
                currentText = '';
              }
              updated[cursorRow] = { text: currentText, timestamp: Date.now() };
            } else if (cmd === 'P') {
              // Delete characters - CSI n P
              const n = parseInt(params) || 1;
              ensureRow(cursorRow);
              let currentText = updated[cursorRow].text;
              currentText = currentText.substring(0, cursorCol) + currentText.substring(cursorCol + n);
              updated[cursorRow] = { text: currentText, timestamp: Date.now() };
            } else if (cmd === 'C') {
              // Cursor forward - CSI n C
              const n = parseInt(params) || 1;
              cursorCol += n;
            } else if (cmd === 'D') {
              // Cursor back - CSI n D
              const n = parseInt(params) || 1;
              cursorCol = Math.max(0, cursorCol - n);
            } else if (cmd === 'A') {
              // Cursor up - CSI n A
              const n = parseInt(params) || 1;
              cursorRow = Math.max(0, cursorRow - n);
              ensureRow(cursorRow);
            } else if (cmd === 'B') {
              // Cursor down - CSI n B
              const n = parseInt(params) || 1;
              cursorRow += n;
              if (isAltScreenRef.current) {
                // Clamp to screen bounds in alt screen mode
                if (cursorRow >= termRows) {
                  cursorRow = termRows - 1;
                }
              }
              ensureRow(cursorRow);
            } else if (cmd === 'G') {
              // Cursor horizontal absolute - CSI n G
              const col = parseInt(params) || 1;
              cursorCol = col - 1; // 1-based to 0-based
            } else if (cmd === 'd') {
              // Cursor vertical absolute - CSI n d
              const row = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                cursorRow = Math.min(row - 1, termRows - 1); // 1-based to 0-based, clamped
              } else {
                // In normal mode, allow positioning within existing buffer
                cursorRow = Math.min(row - 1, updated.length - 1);
              }
              ensureRow(cursorRow);
            } else if (cmd === 'X') {
              // Erase Character (ECH) - CSI n X
              // Erases n characters at cursor without moving cursor
              const n = parseInt(params) || 1;
              ensureRow(cursorRow);
              let currentText = updated[cursorRow].text;
              // Replace n characters at cursor with spaces
              const before = currentText.substring(0, cursorCol);
              const after = currentText.substring(cursorCol + n);
              currentText = before + ' '.repeat(n) + after;
              updated[cursorRow] = { text: currentText, timestamp: Date.now() };
            } else if (cmd === '~') {
              // Function key sequences (Delete=3~, Home=1~, End=4~, PgUp=5~, PgDn=6~, etc.)
              // These are input echoes - ignore them
            } else if (cmd === 'J') {
              // Erase in Display - CSI J, CSI 0J, CSI 1J, CSI 2J, CSI 3J
              const mode = parseInt(params) || 0;
              if (mode === 3) {
                // CSI 3J - Clear screen AND scrollback buffer
                // This clears everything including the saved main screen
                if (isAltScreenRef.current) {
                  // In alt screen mode, clear alt screen
                  updated = [];
                  for (let r = 0; r < termRows; r++) {
                    updated.push({ text: '', timestamp: Date.now() });
                  }
                  // Also clear the saved main screen buffer
                  mainScreenRef.current = [{ text: '', timestamp: Date.now() }];
                } else {
                  // In normal mode, clear everything
                  updated = [{ text: '', timestamp: Date.now() }];
                }
                cursorRow = 0;
                cursorCol = 0;
              } else if (mode === 2) {
                // CSI 2J - Clear entire screen (but not scrollback)
                if (isAltScreenRef.current) {
                  // In alt screen mode, create full screen buffer
                  updated = [];
                  for (let r = 0; r < termRows; r++) {
                    updated.push({ text: '', timestamp: Date.now() });
                  }
                } else {
                  // In normal mode, just clear to single line
                  updated = [{ text: '', timestamp: Date.now() }];
                }
                cursorRow = 0;
                cursorCol = 0;
              } else if (mode === 0) {
                // CSI 0J - Clear from cursor to end of screen
                ensureRow(cursorRow);
                updated[cursorRow] = { text: updated[cursorRow].text.substring(0, cursorCol), timestamp: Date.now() };
                // Clear all lines after current row
                for (let r = cursorRow + 1; r < updated.length; r++) {
                  updated[r] = { text: '', timestamp: Date.now() };
                }
              } else if (mode === 1) {
                // CSI 1J - Clear from start of screen to cursor
                for (let r = 0; r < cursorRow; r++) {
                  updated[r] = { text: '', timestamp: Date.now() };
                }
                ensureRow(cursorRow);
                updated[cursorRow] = { text: ' '.repeat(cursorCol) + updated[cursorRow].text.substring(cursorCol), timestamp: Date.now() };
              }
            } else if (cmd === 'H' || cmd === 'f') {
              // Cursor position - CSI row;col H or CSI row;col f
              const parts = params.split(';');
              const row = parseInt(parts[0]) || 1;
              const col = parseInt(parts[1]) || 1;
              if (isAltScreenRef.current) {
                cursorRow = Math.min(row - 1, termRows - 1); // 1-based to 0-based, clamped
                cursorCol = col - 1;
                ensureRow(cursorRow);
              } else {
                // In normal mode, allow positioning within existing buffer
                const targetRow = row - 1; // 1-based to 0-based
                if (targetRow < updated.length) {
                  cursorRow = targetRow;
                  cursorCol = col - 1;
                } else {
                  // Position beyond current buffer - extend it if reasonable
                  // This supports apps like Claude Code that position on specific rows
                  cursorRow = updated.length - 1;
                  cursorCol = col - 1;
                }
                ensureRow(cursorRow);
              }
            } else if (cmd === 'L') {
              // Insert lines - CSI n L
              const n = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                // In alt screen, insert lines at cursor and remove from bottom
                for (let k = 0; k < n; k++) {
                  updated.splice(cursorRow, 0, { text: '', timestamp: Date.now() });
                  if (updated.length > termRows) {
                    updated.pop(); // Remove from bottom to maintain screen size
                  }
                }
              } else {
                for (let k = 0; k < n; k++) {
                  updated.splice(cursorRow, 0, { text: '', timestamp: Date.now() });
                }
              }
            } else if (cmd === 'M') {
              // Delete lines - CSI n M
              const n = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                // In alt screen, delete lines at cursor and add at bottom
                updated.splice(cursorRow, Math.min(n, updated.length - cursorRow));
                while (updated.length < termRows) {
                  updated.push({ text: '', timestamp: Date.now() });
                }
              } else {
                updated.splice(cursorRow, n);
                ensureRow(cursorRow);
              }
            } else if (cmd === 'S') {
              // Scroll up - CSI n S
              const n = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                for (let k = 0; k < n; k++) {
                  scrollUp();
                }
              }
            } else if (cmd === 'T' && !params.includes(';')) {
              // Scroll down - CSI n T (only if no semicolons - avoid mouse tracking)
              const n = parseInt(params) || 1;
              if (isAltScreenRef.current) {
                for (let k = 0; k < n; k++) {
                  // Scroll down: remove bottom line, add empty at top
                  if (updated.length > 0) {
                    updated.pop();
                    updated.unshift({ text: '', timestamp: Date.now() });
                  }
                }
              }
            } else if (cmd === 's' && !params) {
              // Save cursor position - CSI s (ANSI.SYS)
              savedCursorRef.current = { row: cursorRow, col: cursorCol };
            } else if (cmd === 'u' && !params) {
              // Restore cursor position - CSI u (ANSI.SYS)
              cursorRow = savedCursorRef.current.row;
              cursorCol = savedCursorRef.current.col;
              ensureRow(cursorRow);
            } else if (cmd === 'h' && params.startsWith('?')) {
              // DEC Private Mode Set - CSI ? Ps h
              // Handle multiple modes like ?1049;25h
              const modes = params.substring(1).split(';').map(s => parseInt(s));
              if (modes.some(m => m === 1049 || m === 47 || m === 1047)) {
                // Switch to alternate screen buffer
                if (!isAltScreenRef.current) {
                  // Save main screen
                  mainScreenRef.current = updated.map(line => ({ ...line }));
                  mainCursorRef.current = { row: cursorRow, col: cursorCol };
                  isAltScreenRef.current = true;
                  setIsAltScreen(true);
                  // Clear for alternate screen
                  updated = [];
                  for (let r = 0; r < termRows; r++) {
                    updated.push({ text: '', timestamp: Date.now() });
                  }
                  cursorRow = 0;
                  cursorCol = 0;
                }
              }
            } else if (cmd === 'l' && params.startsWith('?')) {
              // DEC Private Mode Reset - CSI ? Ps l
              // Handle multiple modes like ?1049;25l
              const modes = params.substring(1).split(';').map(s => parseInt(s));
              if (modes.some(m => m === 1049 || m === 47 || m === 1047)) {
                // Switch back to main screen buffer
                if (isAltScreenRef.current) {
                  // Restore main screen
                  updated = mainScreenRef.current.length > 0
                    ? mainScreenRef.current.map(line => ({ ...line }))
                    : [{ text: '', timestamp: Date.now() }];
                  // Restore cursor position from when we entered alt screen
                  cursorRow = Math.min(mainCursorRef.current.row, updated.length - 1);
                  cursorCol = mainCursorRef.current.col;
                  isAltScreenRef.current = false;
                  setIsAltScreen(false);
                  // Clear any escape buffer to prevent orphaned sequences
                  escapeBufferRef.current = '';
                }
              }
            }
            // All other CSI sequences are ignored (colors, etc.)

            i = j;
            continue;
          } else if (nextChar === ']') {
            // OSC sequence - find BEL or ST
            let j = i + 2;
            while (j < fullData.length && fullData[j] !== '\x07' && !(fullData[j] === '\x1b' && fullData[j+1] === '\\')) j++;
            if (j >= fullData.length) {
              // Incomplete - buffer
              escapeBufferRef.current = fullData.substring(i);
              break;
            }
            if (fullData[j] === '\x07') j++;
            else if (fullData[j] === '\x1b') j += 2;
            i = j;
            continue;
          } else if (nextChar === 'D') {
            // Index (IND) - ESC D - Move cursor down, scroll if at bottom
            if (isAltScreenRef.current) {
              cursorRow++;
              if (cursorRow >= termRows) {
                scrollUp();
                cursorRow = termRows - 1;
              }
              ensureRow(cursorRow);
            } else {
              // In normal mode, move cursor down
              cursorRow++;
              if (cursorRow >= updated.length) {
                updated.push({ text: '', timestamp: Date.now() });
              }
              ensureRow(cursorRow);
            }
            i += 2;
            continue;
          } else if (nextChar === 'M') {
            // Reverse Index (RI) - ESC M - Move cursor up, scroll down if at top
            if (isAltScreenRef.current) {
              cursorRow--;
              if (cursorRow < 0) {
                // Scroll down: remove bottom, add at top
                if (updated.length > 0) {
                  updated.pop();
                  updated.unshift({ text: '', timestamp: Date.now() });
                }
                cursorRow = 0;
              }
            } else {
              // In normal mode, move cursor up if possible
              cursorRow = Math.max(0, cursorRow - 1);
            }
            i += 2;
            continue;
          } else if (nextChar === 'E') {
            // Next Line (NEL) - ESC E - Move to beginning of next line
            if (isAltScreenRef.current) {
              cursorRow++;
              if (cursorRow >= termRows) {
                scrollUp();
                cursorRow = termRows - 1;
              }
              ensureRow(cursorRow);
            } else {
              // In normal mode, move cursor down
              cursorRow++;
              if (cursorRow >= updated.length) {
                updated.push({ text: '', timestamp: Date.now() });
              }
              ensureRow(cursorRow);
            }
            cursorCol = 0;
            i += 2;
            continue;
          } else {
            // Other escape - skip 2 chars
            i += 2;
            continue;
          }
        }

        // Handle orphaned CSI sequence parts (from split data)
        // If we see [ followed by params and command, skip it
        // But only if it looks VERY specifically like a CSI sequence (starts with digit or ?)
        if (char === '[') {
          const afterBracket = fullData[i + 1];
          // Only process as CSI if next char is ?, digit, or semicolon
          if (afterBracket && /[?0-9;]/.test(afterBracket)) {
            let j = i + 1;
            // Allow optional '?' for DEC private sequences
            if (fullData[j] === '?') j++;
            // Skip parameters (digits, semicolons)
            while (j < fullData.length && /[0-9;]/.test(fullData[j])) j++;
            // Check for SPECIFIC command characters (not all letters - that catches normal text!)
            // Only match known CSI commands: cursor movement, erase, mode set/reset
            if (j < fullData.length && /[ABCDEFGHJKLMPSTXZfhlmnsu~@]/.test(fullData[j])) {
              // This looks like an orphaned CSI sequence, skip it
              i = j + 1;
              continue;
            }
            // Check for incomplete orphaned sequence at end of data
            if (j >= fullData.length && i + 1 < fullData.length) {
              // Might be split - buffer it
              escapeBufferRef.current = fullData.substring(i);
              break;
            }
          }
        }

        // Handle orphaned CSI parameters (digits that leaked from split sequences)
        // Only match very specific patterns that can't be normal text
        // Pattern: digits followed by uppercase letter or specific punctuation
        if (/[0-9]/.test(char)) {
          let j = i;
          while (j < fullData.length && /[0-9;]/.test(fullData[j])) j++;
          // Only skip if followed by UPPERCASE command letter or ~ (not lowercase which could be text)
          // This catches things like "1P" (delete) "2J" (clear) but not "110" or digits before lowercase
          if (j < fullData.length && j > i && /[ABCDEFGHJKLMPSTXZ~@]/.test(fullData[j])) {
            // This looks like orphaned CSI params - skip them and the command
            i = j + 1;
            continue;
          }
        }

        // Carriage return - move cursor to beginning of current line
        if (char === '\r') {
          cursorCol = 0;
          i++;
          continue;
        }

        // Newline - move down or add new line
        if (char === '\n') {
          if (isAltScreenRef.current) {
            // In alt screen, move cursor down or scroll if at bottom
            cursorRow++;
            if (cursorRow >= termRows) {
              // At bottom of screen - scroll up
              scrollUp();
              cursorRow = termRows - 1;
            }
            ensureRow(cursorRow);
          } else {
            // In normal mode, move cursor down
            cursorRow++;
            // If we're beyond the buffer, add a new line
            if (cursorRow >= updated.length) {
              updated.push({ text: '', timestamp: Date.now() });
            }
            ensureRow(cursorRow);
          }
          cursorCol = 0;
          i++;
          continue;
        }

        // Backspace (0x08) - move cursor back
        if (char === '\x08') {
          if (cursorCol > 0) {
            cursorCol--;
          }
          i++;
          continue;
        }

        // DEL (0x7F) - just move cursor back (same handling as backspace)
        if (char === '\x7f') {
          if (cursorCol > 0) {
            cursorCol--;
          }
          i++;
          continue;
        }

        // Bell - ignore
        if (char === '\x07') {
          i++;
          continue;
        }

        // Other control chars - ignore
        if (char.charCodeAt(0) < 32 && char !== '\t') {
          i++;
          continue;
        }

        // Printable character - write at cursor position
        ensureRow(cursorRow);
        let currentText = updated[cursorRow].text;

        // Pad with spaces if cursor is beyond current text
        while (currentText.length < cursorCol) {
          currentText += ' ';
        }

        // Overwrite or append at cursor position
        if (cursorCol < currentText.length) {
          // Overwrite character at cursor
          currentText = currentText.substring(0, cursorCol) + char + currentText.substring(cursorCol + 1);
        } else {
          // Append at end
          currentText += char;
        }

        updated[cursorRow] = { text: currentText, timestamp: Date.now() };
        cursorCol++;
        i++;
      }

      // Debug: log final state
      if (debugDataRef.current) {
        console.log('  Cursor after:', cursorRow, cursorCol, 'Line:', updated[cursorRow]?.text);
      }

      // Save cursor position for next call
      cursorColRef.current = cursorCol;
      cursorRowRef.current = cursorRow;
      // Update display cursor position (triggers re-render for cursor display)
      setDisplayCursorCol(cursorCol);
      setDisplayCursorRow(cursorRow);

      // Maintain proper buffer size
      if (isAltScreenRef.current) {
        // In alt screen mode, maintain exactly termRows lines
        while (updated.length > termRows) {
          updated.shift(); // Remove excess from top
        }
        while (updated.length < termRows) {
          updated.push({ text: '', timestamp: Date.now() });
        }
      } else {
        // In normal mode, trim to max lines
        if (updated.length > MAX_LINES) {
          updated = updated.slice(-MAX_LINES);
        }
      }

      return updated;
    });
  }, []);

  // Start server
  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    if (!selectedVenv) {
      addLog('ERROR: No venv selected');
      return;
    }

    setConnecting(true);
    addLog('Starting terminal server...');

    try {
      const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
        workflowFolder: 'Terminal',
        scriptName: 'pty_server.py'
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
        serverName: 'Terminal'
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
  };

  // Stop server
  const stopServer = async () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);

    if (!ipcRenderer) return;

    const result = await ipcRenderer.invoke('python-stop-script-server', 'Terminal');
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

    addLog(`Connecting to ws://127.0.0.1:${serverPort}/ws/pty`);

    // Get venv path directly from IPC to ensure we have latest data
    let venvPath: string | undefined;
    if (selectedVenv && ipcRenderer) {
      try {
        const result = await ipcRenderer.invoke('python-list-venvs');
        if (result.success && result.venvs) {
          const venv = result.venvs.find((v: any) => v.name === selectedVenv);
          if (venv) {
            venvPath = venv.path;
            addLog(`Found venv path: ${venvPath}`);
          } else {
            addLog(`WARN: Venv "${selectedVenv}" not found in list`);
          }
        }
      } catch (e) {
        addLog(`WARN: Could not get venv path: ${e}`);
      }
    }

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/pty`);

    ws.onopen = () => {
      addLog('WebSocket connected');
      setConnected(true);
      setConnecting(false);

      // Send initial config with venv path
      const config = {
        shell: shell,
        cols: 120,
        rows: 30,
        venvPath: venvPath
      };
      addLog(`Sending config: ${JSON.stringify(config)}`);
      ws.send(JSON.stringify(config));

      if (venvPath) {
        addLog(`Using venv: ${selectedVenv} (${venvPath})`);

        // After a short delay, send command to prepend venv Scripts to PATH
        setTimeout(() => {
          const scriptsPath = venvPath.replace(/\//g, '\\') + '\\Scripts';
          // Use @ to suppress echo of the command itself
          const setPathCmd = `@set PATH=${scriptsPath};%PATH%\r`;
          ws.send(JSON.stringify({ type: 'input', data: setPathCmd }));
          addLog(`Sent PATH update: ${scriptsPath}`);
        }, 500);
      } else {
        addLog('No venv path configured');
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'output') {
          appendOutput(data.data);
          // Check if output ends with prompt indicator (> or $)
          // This helps us know when user can type
          // Strip ANSI escape codes before checking
          const stripped = stripAnsi(data.data).trimEnd();
          if (stripped.endsWith('>') || stripped.endsWith('$') || stripped.endsWith('#')) {
            setIsAtPrompt(true);

            // Detect conda environment from prompt
            // PowerShell conda shows: (envname) PS C:\path>
            // Bash conda shows: (envname) user@host:path$
            // Look for (envname) pattern anywhere in the output
            const condaMatch = stripped.match(/\(([^)]+)\)\s*(?:PS\s|C:|\/)/);
            if (condaMatch) {
              setCondaEnv(condaMatch[1]);
            }
            // Don't clear condaEnv if not found - it persists until deactivate
          }
        } else if (data.type === 'connected') {
          appendOutput(data.message);
        } else if (data.type === 'error') {
          addLog(`Terminal error: ${data.message}`);
        }
      } catch (e) {
        // Raw text
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
  }, [serverPort, shell, selectedVenv, ipcRenderer, addLog, appendOutput]);

  // Send input
  const sendInput = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'input',
        data: text
      }));
    }
  }, []);

  // Handle key input - matches OpenGL terminal behavior
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!connected) return;

    // Prevent default for all keys we handle
    e.preventDefault();

    if (e.ctrlKey) {
      // Ctrl+C - interrupt
      if (e.key === 'c' || e.key === 'C') {
        sendInput('\x03');
        setUserInput('');
        setUserInputCursor(0);
        return;
      }
      // Ctrl+D - EOF
      if (e.key === 'd' || e.key === 'D') {
        sendInput('\x04');
        return;
      }
      // Ctrl+V - paste (handled separately)
      if (e.key === 'v' || e.key === 'V') {
        navigator.clipboard.readText().then(text => {
          if (text) {
            const cleanText = text.replace(/[\r\n]/g, '');
            // Update local input state
            setUserInput(prev => {
              const newInput = prev.substring(0, userInputCursor) + cleanText + prev.substring(userInputCursor);
              setUserInputCursor(userInputCursor + cleanText.length);
              return newInput;
            });
            // Send to PTY
            for (const ch of cleanText) {
              sendInput(ch);
            }
          }
        }).catch(() => {});
        return;
      }
      return;
    }

    // Enter - send carriage return and clear input
    if (e.key === 'Enter') {
      // Check if this is a conda deactivate command
      const cmd = userInput.trim().toLowerCase();
      if (cmd === 'conda deactivate' || cmd === 'deactivate') {
        setCondaEnv('');
      }

      sendInput('\r');
      setUserInput('');
      setUserInputCursor(0);
      setIsAtPrompt(false);
      return;
    }

    // Backspace - delete character before cursor
    if (e.key === 'Backspace') {
      if (userInputCursor > 0) {
        setUserInput(prev => prev.substring(0, userInputCursor - 1) + prev.substring(userInputCursor));
        setUserInputCursor(prev => prev - 1);
      }
      sendInput('\x7f');
      return;
    }

    // Delete key - delete character at cursor
    if (e.key === 'Delete') {
      setUserInput(prev => prev.substring(0, userInputCursor) + prev.substring(userInputCursor + 1));
      sendInput('\x1b[3~');
      return;
    }

    // Arrow keys
    if (e.key === 'ArrowUp') {
      sendInput('\x1b[A');
      // History might change input - we'll get it from output
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

    // Tab
    if (e.key === 'Tab') {
      sendInput('\t');
      return;
    }

    // Escape
    if (e.key === 'Escape') {
      sendInput('\x1b');
      return;
    }

    // Printable characters
    if (e.key.length === 1) {
      setUserInput(prev => prev.substring(0, userInputCursor) + e.key + prev.substring(userInputCursor));
      setUserInputCursor(prev => prev + 1);
      sendInput(e.key);
      return;
    }
  }, [connected, sendInput, userInput, userInputCursor]);

  // Focus terminal on click (but not if selecting text)
  const handleTerminalClick = (e: React.MouseEvent) => {
    // Don't steal focus if user is selecting text
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }
    inputRef.current?.focus();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className="flex h-full bg-[#1a1a2e]">
      {/* Side Panel */}
      <div className="w-[220px] p-2.5 bg-[rgba(30,30,50,0.95)] overflow-y-auto text-xs text-white border-r border-slate-700">
        {/* Status */}
        <div className={`p-2 rounded mb-2.5 text-center ${
          connected ? 'bg-green-500/20' : serverRunning ? 'bg-yellow-500/20' : 'bg-slate-600/20'
        }`}>
          <span className={connected ? 'text-green-400' : serverRunning ? 'text-yellow-400' : 'text-slate-500'}>
            {connected ? '● CONNECTED' : serverRunning ? '● SERVER RUNNING' : '○ DISCONNECTED'}
          </span>
        </div>

        <h3 className="text-[#667eea] m-0 mb-2.5 text-[13px]">Server Settings</h3>

        <div className="mb-2">
          <label className="text-slate-500 block mb-1 text-[11px]">Python Venv:</label>
          <select
            value={selectedVenv}
            onChange={(e) => setSelectedVenv(e.target.value)}
            disabled={serverRunning}
            className="w-full bg-slate-700 border border-slate-600 text-white p-1 text-[11px] rounded"
          >
            {availableVenvs.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <div className="mb-2">
          <label className="text-slate-500 block mb-1 text-[11px]">Port:</label>
          <input
            type="number"
            value={serverPort}
            onChange={(e) => setServerPort(parseInt(e.target.value) || 8780)}
            disabled={serverRunning}
            className="w-full bg-slate-700 border border-slate-600 text-white p-1 text-[11px] rounded"
          />
        </div>

        <div className="mb-2.5">
          <label className="text-slate-500 block mb-1 text-[11px]">Shell:</label>
          <select
            value={shell}
            onChange={(e) => setShell(e.target.value)}
            disabled={connected}
            className="w-full bg-slate-700 border border-slate-600 text-white p-1 text-[11px] rounded"
          >
            <option value="powershell">PowerShell</option>
            <option value="cmd">Command Prompt</option>
            <option value="bash">Bash (WSL)</option>
          </select>
        </div>

        {/* Dependencies Panel */}
        {selectedVenv && (
          <div className="mb-2.5 p-2 rounded border bg-slate-800/40 border-slate-600">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-slate-400 text-[11px]">Dependencies</span>
              <div className="flex items-center gap-1.5">
                {checkingDeps && <span className="text-[10px] text-slate-500">Checking...</span>}
                {allDepsInstalled ? (
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-500/20 text-green-400">OK</span>
                ) : (
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-yellow-500/20 text-yellow-400">{missingDepsCount} Missing</span>
                )}
              </div>
            </div>

            <div className="space-y-0.5 mb-2 max-h-20 overflow-y-auto">
              {REQUIRED_PACKAGES.map(pkg => {
                const status = depsStatus[pkg];
                return (
                  <div key={pkg} className="flex items-center justify-between text-[10px] py-0.5 px-1">
                    <div className="flex items-center gap-1.5">
                      <span className={status?.installed ? 'text-green-400' : 'text-red-400'}>
                        {status?.installed ? '✓' : '✗'}
                      </span>
                      <span className="text-slate-300">{pkg}</span>
                    </div>
                    {status?.version && (
                      <span className="text-slate-500 text-[9px]">{status.version}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {!allDepsInstalled && (
              <button
                onClick={installMissingDeps}
                disabled={installingDeps}
                className="w-full px-2 py-1 rounded text-[10px] font-medium text-white bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 transition-colors"
              >
                {installingDeps ? `Installing ${installingPackage || ''}...` : `Install Missing (${missingDepsCount})`}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-1.5 mb-2.5">
          {!serverRunning ? (
            <button
              onClick={startServer}
              disabled={connecting || !selectedVenv || !allDepsInstalled}
              className={`flex-1 bg-green-600 hover:bg-green-500 border-none text-white p-2 rounded text-[11px] transition-colors ${
                connecting ? 'cursor-wait' : 'cursor-pointer'
              } disabled:opacity-50`}
            >
              {connecting ? 'Starting...' : 'Start Server'}
            </button>
          ) : (
            <button
              onClick={stopServer}
              className="flex-1 bg-red-600 hover:bg-red-500 border-none text-white p-2 rounded cursor-pointer text-[11px] transition-colors"
            >
              Stop Server
            </button>
          )}
        </div>

        {serverRunning && !connected && (
          <button
            onClick={connectWebSocket}
            disabled={connecting}
            className="w-full bg-[#667eea] hover:bg-[#7a8ff0] border-none text-white p-2 rounded cursor-pointer text-[11px] mb-2.5 transition-colors disabled:opacity-50"
          >
            Reconnect
          </button>
        )}

        <h3 className="text-[#667eea] mt-3 mb-2 text-[13px]">Logs</h3>
        <div className="bg-slate-950 p-1.5 rounded max-h-[200px] overflow-y-auto text-[10px] font-mono">
          {logs.map((log, i) => (
            <div key={i} className={log.includes('ERROR') ? 'text-red-400' : 'text-slate-500'}>{log}</div>
          ))}
        </div>

        <h3 className="text-[#667eea] mt-3 mb-2 text-[13px]">Keyboard Shortcuts</h3>
        <div className="text-[10px] text-slate-500">
          <div><span className="text-[#667eea]">Ctrl+C</span> - Interrupt</div>
          <div><span className="text-[#667eea]">Ctrl+D</span> - EOF</div>
          <div><span className="text-[#667eea]">Tab</span> - Autocomplete</div>
          <div><span className="text-[#667eea]">↑/↓</span> - History</div>
        </div>
      </div>

      {/* Terminal Area */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col relative"
        onClick={handleTerminalClick}
      >
        {/* Terminal output - selectable text */}
        <div
          ref={outputRef}
          className="flex-1 bg-[#0c0c1a] p-2.5 font-mono text-sm leading-[18px] text-green-500 overflow-y-auto whitespace-pre-wrap break-all cursor-text select-text"
        >
          {lines.map((line, idx) => {
            // Cursor is on the last line (simplest approach that works for normal terminal use)
            const isLastLine = idx === lines.length - 1;

            if (isLastLine && connected) {
              // This is the line where the cursor is - show it with blinking cursor at end
              const lineText = line.text.trimEnd();
              // Always put cursor at end of line text for simplicity
              const cursorPos = lineText.length;

              if (isFocused) {
                return (
                  <div key={idx}>
                    {lineText}
                    <span className={cursorVisible ? 'bg-green-500 text-[#0c0c1a]' : 'bg-transparent text-green-500'}>{' '}</span>
                  </div>
                );
              }

              return <div key={idx}>{lineText || ' '}</div>;
            }

            // For non-active lines, trim trailing spaces
            return <div key={idx}>{line.text.trimEnd() || ' '}</div>;
          })}
        </div>

        {/* Hidden input for keyboard capture */}
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
          <span>{connected ? (isFocused ? 'Ready - Type to input' : 'Click terminal to focus') : 'Disconnected'}</span>
          {connected && (
            <span className={`ml-auto ${isFocused ? 'text-green-500' : 'text-slate-600'}`}>
              {isFocused ? '● FOCUSED' : '○ UNFOCUSED'}
            </span>
          )}
        </div>

        {/* Connection overlay */}
        {!connected && (
          <div className="absolute top-0 left-0 right-0 bottom-6 bg-black/70 flex items-center justify-center text-slate-500 text-base">
            {connecting ? 'Connecting...' : 'Start server to connect'}
          </div>
        )}
      </div>
    </div>
  );
};
