// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

interface Script {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface TeleprompterSettings {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  backgroundColor: string;
  highlightColor: string;
  lineHeight: number;
  textAlign: 'left' | 'center';
  scrollSpeed: number;
  countdownSeconds: number;
}

const STORAGE_KEY = 'teleprompter_scripts';
const SETTINGS_KEY = 'teleprompter_settings';

const DEFAULT_SETTINGS: TeleprompterSettings = {
  fontSize: 48,
  fontFamily: 'Arial',
  textColor: '#ffffff',
  backgroundColor: '#000000',
  highlightColor: '#ffff00',
  lineHeight: 1.6,
  textAlign: 'center',
  scrollSpeed: 50,
  countdownSeconds: 5,
};

const SAMPLE_SCRIPT = `Welcome to my channel, everyone!

[PAUSE]

Today we're going to be looking at something really exciting.

[---]

First, let me tell you a bit about what we'll cover:

[!] Point number one - this is important
[!] Point number two - don't miss this
[!] Point number three - the key takeaway

[BEAT]

Let me know in the comments what you think about this topic.

[PAUSE]

And don't forget to like and subscribe if you found this helpful!

Thanks for watching, and I'll see you in the next video.`;

export const TeleprompterWindow: React.FC = () => {
  // === Script State ===
  const [currentScript, setCurrentScript] = useState<Script>({
    id: 'script_' + Date.now(),
    title: 'Untitled Script',
    content: SAMPLE_SCRIPT,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const [savedScripts, setSavedScripts] = useState<Script[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // === Playback State ===
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);

  // === Display Settings ===
  const [settings, setSettings] = useState<TeleprompterSettings>(DEFAULT_SETTINGS);
  const [isMirrored, setIsMirrored] = useState(false);

  // === Countdown State ===
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownRemaining, setCountdownRemaining] = useState(0);

  // === UI State ===
  const [activeTab, setActiveTab] = useState<'edit' | 'teleprompter' | 'settings'>('edit');
  const [showScriptLibrary, setShowScriptLibrary] = useState(true);

  // === Refs ===
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const countdownIntervalRef = useRef<any>(null);
  const scrollPositionRef = useRef<number>(0);

  // === Load saved data on mount ===
  useEffect(() => {
    try {
      const savedScriptsJson = localStorage.getItem(STORAGE_KEY);
      if (savedScriptsJson) {
        const scripts = JSON.parse(savedScriptsJson) as Script[];
        setSavedScripts(scripts);
      }

      const savedSettingsJson = localStorage.getItem(SETTINGS_KEY);
      if (savedSettingsJson) {
        const loadedSettings = JSON.parse(savedSettingsJson);
        setSettings({ ...DEFAULT_SETTINGS, ...loadedSettings });
      }
    } catch (e) {
      console.error('Error loading saved data:', e);
    }
  }, []);

  // === Save scripts when changed ===
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedScripts));
    } catch (e) {
      console.error('Error saving scripts:', e);
    }
  }, [savedScripts]);

  // === Save settings when changed ===
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Error saving settings:', e);
    }
  }, [settings]);

  // === Keep scrollPositionRef in sync ===
  useEffect(() => {
    scrollPositionRef.current = scrollPosition;
  }, [scrollPosition]);

  // === Scrolling Animation ===
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    lastTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - lastTimeRef.current) / 1000;
      lastTimeRef.current = currentTime;

      if (scrollContainerRef.current) {
        const maxScroll = scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight;
        const newPosition = scrollPositionRef.current + settings.scrollSpeed * deltaTime;

        if (newPosition >= maxScroll) {
          setIsPlaying(false);
          setScrollPosition(maxScroll);
          scrollPositionRef.current = maxScroll;
          scrollContainerRef.current.scrollTop = maxScroll;
          return;
        }

        scrollPositionRef.current = newPosition;
        setScrollPosition(newPosition);
        scrollContainerRef.current.scrollTop = newPosition;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, settings.scrollSpeed]);

  // === Keyboard Shortcuts ===
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (activeTab === 'teleprompter' && !showCountdown) {
            setIsPlaying(prev => !prev);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSettings(prev => ({ ...prev, scrollSpeed: Math.min(200, prev.scrollSpeed + 10) }));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSettings(prev => ({ ...prev, scrollSpeed: Math.max(10, prev.scrollSpeed - 10) }));
          break;
        case 'r':
        case 'R':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            resetScroll();
          }
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          setIsMirrored(prev => !prev);
          break;
        case 'Escape':
          e.preventDefault();
          setIsPlaying(false);
          setActiveTab('edit');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, showCountdown]);

  // === Ctrl+S to save ===
  useEffect(() => {
    const handleSave = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveScript();
      }
    };
    window.addEventListener('keydown', handleSave);
    return () => window.removeEventListener('keydown', handleSave);
  }, [currentScript]);

  // === Helper Functions ===
  const resetScroll = () => {
    setScrollPosition(0);
    scrollPositionRef.current = 0;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  const createNewScript = () => {
    setCurrentScript({
      id: 'script_' + Date.now(),
      title: 'Untitled Script',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setHasUnsavedChanges(false);
  };

  const saveScript = () => {
    const updatedScript = {
      ...currentScript,
      updatedAt: new Date().toISOString(),
    };

    setSavedScripts(prev => {
      const existing = prev.findIndex(s => s.id === updatedScript.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = updatedScript;
        return updated;
      }
      return [...prev, updatedScript];
    });

    setCurrentScript(updatedScript);
    setHasUnsavedChanges(false);
  };

  const loadScript = (script: Script) => {
    if (hasUnsavedChanges && !confirm('You have unsaved changes. Discard them?')) {
      return;
    }
    setCurrentScript(script);
    setHasUnsavedChanges(false);
  };

  const deleteScript = (scriptId: string) => {
    if (!confirm('Delete this script? This cannot be undone.')) return;
    setSavedScripts(prev => prev.filter(s => s.id !== scriptId));
    if (currentScript.id === scriptId) {
      createNewScript();
    }
  };

  const duplicateScript = (script: Script) => {
    const duplicate: Script = {
      ...script,
      id: 'script_' + Date.now(),
      title: script.title + ' (Copy)',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSavedScripts(prev => [...prev, duplicate]);
  };

  const exportScripts = () => {
    const blob = new Blob([JSON.stringify(savedScripts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'teleprompter_scripts.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importScripts = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          if (file.name.endsWith('.json')) {
            const imported = JSON.parse(content) as Script[];
            setSavedScripts(prev => [...prev, ...imported]);
          } else {
            const newScript: Script = {
              id: 'script_' + Date.now(),
              title: file.name.replace(/\.[^/.]+$/, ''),
              content: content,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            setCurrentScript(newScript);
            setHasUnsavedChanges(true);
          }
        } catch (err) {
          alert('Error importing file: ' + err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const startCountdown = () => {
    setCountdownRemaining(settings.countdownSeconds);
    setShowCountdown(true);
    resetScroll();

    countdownIntervalRef.current = setInterval(() => {
      setCountdownRemaining(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          setShowCountdown(false);
          setIsPlaying(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const getWordCount = (text: string) => {
    return text.trim().split(/\s+/).filter(w => w.length > 0 && !w.startsWith('[')).length;
  };

  const getProgress = () => {
    if (!scrollContainerRef.current) return 0;
    const maxScroll = scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight;
    if (maxScroll <= 0) return 100;
    return Math.round((scrollPosition / maxScroll) * 100);
  };

  const insertCue = (cue: string) => {
    setCurrentScript(prev => ({
      ...prev,
      content: prev.content + '\n\n' + cue + '\n\n',
    }));
    setHasUnsavedChanges(true);
  };

  // === Render Visual Cues ===
  const renderScriptContent = (content: string) => {
    const parts = content.split(/(\[PAUSE\]|\[!\]|\[---\]|\[BEAT\])/g);

    return parts.map((part, index) => {
      if (part === '[PAUSE]') {
        return (
          <div key={index} className="py-4 px-5 my-8 mx-auto bg-red-500/20 border-l-4 border-red-400 text-red-400 text-center text-[0.6em] font-bold tracking-widest max-w-[200px]">
            PAUSE
          </div>
        );
      }
      if (part === '[!]') {
        return (
          <span key={index} className="font-bold" style={{ color: settings.highlightColor }}>&#9733; </span>
        );
      }
      if (part === '[---]') {
        return (
          <hr key={index} className="my-10 mx-auto border-none border-t-2 border-dashed border-slate-700 w-3/5" />
        );
      }
      if (part === '[BEAT]') {
        return (
          <span key={index} className="text-slate-600 italic"> ... </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  // === Tailwind class helpers ===
  const buttonClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-blue-500 text-white text-xs font-medium';
  const buttonSecondaryClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-slate-700 text-white text-xs font-medium';
  const buttonDangerClass = 'py-1.5 px-3 border-none rounded cursor-pointer bg-red-600 text-white text-xs font-medium';
  const inputClass = 'py-1.5 px-2.5 border border-slate-700 rounded bg-slate-800 text-white text-[13px]';
  const sectionClass = 'bg-slate-900 p-3 rounded-md mb-2.5';
  const tabClass = (isActive: boolean) =>
    `py-2 px-4 border-none rounded-t cursor-pointer text-[13px] ${
      isActive ? 'bg-slate-800 text-white font-semibold' : 'bg-transparent text-slate-500 font-normal'
    }`;

  // === Tab Content ===
  const renderEditTab = () => (
    <div className="flex-1 flex overflow-hidden gap-3 p-3">
      {/* Script Library */}
      {showScriptLibrary && (
        <div className="w-[250px] flex flex-col gap-2">
          <div className={sectionClass}>
            <div className="flex justify-between items-center mb-3">
              <span className="font-semibold text-sm">Script Library</span>
              <button onClick={() => setShowScriptLibrary(false)} className={`${buttonSecondaryClass} py-1 px-2`}>
                Hide
              </button>
            </div>
            <button onClick={createNewScript} className={`${buttonClass} w-full mb-2`}>
              + New Script
            </button>
            <div className="max-h-[300px] overflow-y-auto">
              {savedScripts.length === 0 ? (
                <div className="text-slate-600 text-xs text-center p-5">
                  No saved scripts yet
                </div>
              ) : (
                savedScripts.map(script => (
                  <div
                    key={script.id}
                    className={`p-2 mb-1 rounded cursor-pointer ${
                      script.id === currentScript.id ? 'bg-blue-500/20 border-l-[3px] border-blue-500' : 'bg-[#252525] border-l-[3px] border-transparent'
                    }`}
                    onClick={() => loadScript(script)}
                  >
                    <div className="text-[13px] font-medium mb-1">{script.title}</div>
                    <div className="text-[11px] text-slate-600">
                      {getWordCount(script.content)} words
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); duplicateScript(script); }}
                        className={`${buttonSecondaryClass} py-0.5 px-1.5 text-[10px]`}
                      >
                        Copy
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteScript(script.id); }}
                        className={`${buttonDangerClass} py-0.5 px-1.5 text-[10px]`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-1 mt-3">
              <button onClick={importScripts} className={`${buttonSecondaryClass} flex-1 text-[11px]`}>
                Import
              </button>
              <button onClick={exportScripts} className={`${buttonSecondaryClass} flex-1 text-[11px]`} disabled={savedScripts.length === 0}>
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Script Editor */}
      <div className="flex-1 flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          {!showScriptLibrary && (
            <button onClick={() => setShowScriptLibrary(true)} className={buttonSecondaryClass}>
              Show Library
            </button>
          )}
          <input
            type="text"
            value={currentScript.title}
            onChange={(e) => {
              setCurrentScript(prev => ({ ...prev, title: e.target.value }));
              setHasUnsavedChanges(true);
            }}
            className={`${inputClass} flex-1 text-base font-semibold`}
            placeholder="Script Title"
          />
          <button onClick={saveScript} className={buttonClass}>
            {hasUnsavedChanges ? 'Save *' : 'Save'}
          </button>
          <button onClick={() => setActiveTab('teleprompter')} className={`${buttonClass} bg-green-600`}>
            Start Teleprompter
          </button>
        </div>

        <div className={`${sectionClass} flex-1 flex flex-col p-0 overflow-hidden`}>
          <textarea
            value={currentScript.content}
            onChange={(e) => {
              setCurrentScript(prev => ({ ...prev, content: e.target.value }));
              setHasUnsavedChanges(true);
            }}
            className="flex-1 w-full p-4 border-none rounded-md bg-slate-900 text-slate-200 text-sm leading-relaxed resize-none font-serif"
            placeholder="Enter your script here..."
          />
        </div>

        <div className="flex gap-2 items-center justify-between">
          <div className="flex gap-1">
            <span className="text-xs text-slate-600 mr-2">Insert Cue:</span>
            <button onClick={() => insertCue('[PAUSE]')} className={`${buttonSecondaryClass} text-[11px]`}>[PAUSE]</button>
            <button onClick={() => insertCue('[!]')} className={`${buttonSecondaryClass} text-[11px]`}>[!]</button>
            <button onClick={() => insertCue('[---]')} className={`${buttonSecondaryClass} text-[11px]`}>[---]</button>
            <button onClick={() => insertCue('[BEAT]')} className={`${buttonSecondaryClass} text-[11px]`}>[BEAT]</button>
          </div>
          <div className="text-xs text-slate-600">
            {getWordCount(currentScript.content)} words | ~{Math.ceil(getWordCount(currentScript.content) / 150)} min reading time
          </div>
        </div>
      </div>
    </div>
  );

  const renderTeleprompterTab = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Control Bar */}
      <div className="flex gap-3 p-3 bg-slate-900 border-b border-slate-700 items-center flex-wrap">
        <button onClick={() => setActiveTab('edit')} className={buttonSecondaryClass}>
          ← Edit
        </button>

        <button
          onClick={startCountdown}
          className={`${buttonSecondaryClass} bg-purple-600`}
          disabled={showCountdown || isPlaying}
        >
          {settings.countdownSeconds}s Countdown
        </button>

        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`${buttonClass} min-w-[80px] ${isPlaying ? 'bg-red-600' : 'bg-green-600'}`}
          disabled={showCountdown}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        <button onClick={resetScroll} className={buttonSecondaryClass}>
          Reset
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Speed:</span>
          <input
            type="range"
            min={10}
            max={200}
            value={settings.scrollSpeed}
            onChange={(e) => setSettings(prev => ({ ...prev, scrollSpeed: Number(e.target.value) }))}
            className="w-[120px]"
          />
          <span className="text-xs w-[60px]">{settings.scrollSpeed} px/s</span>
        </div>

        <button
          onClick={() => setIsMirrored(!isMirrored)}
          className={`${buttonSecondaryClass} ${isMirrored ? 'bg-red-600' : 'bg-slate-700'}`}
        >
          Mirror: {isMirrored ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Teleprompter Display */}
      <div
        className="flex-1 relative overflow-hidden"
        style={{ background: settings.backgroundColor }}
      >
        {/* Countdown Overlay */}
        {showCountdown && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/95 z-[1000]">
            <div className={`text-[200px] font-bold ${countdownRemaining <= 2 ? 'text-red-600' : 'text-white'}`}>
              {countdownRemaining}
            </div>
          </div>
        )}

        {/* Scrolling Text */}
        <div
          ref={scrollContainerRef}
          className="h-full overflow-hidden"
          style={{ transform: isMirrored ? 'scaleX(-1)' : 'none' }}
        >
          <div
            className="whitespace-pre-wrap"
            style={{
              fontSize: `${settings.fontSize}px`,
              fontFamily: settings.fontFamily,
              color: settings.textColor,
              lineHeight: settings.lineHeight,
              textAlign: settings.textAlign,
              padding: '40vh 10% 60vh 10%',
            }}
          >
            {renderScriptContent(currentScript.content)}
          </div>
        </div>

        {/* Center Guide Line */}
        <div className="absolute top-[40%] left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
      </div>

      {/* Bottom Bar */}
      <div className="flex gap-4 py-2 px-3 bg-slate-900 border-t border-slate-700 items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Font:</span>
          <button
            onClick={() => setSettings(prev => ({ ...prev, fontSize: Math.max(24, prev.fontSize - 4) }))}
            className={`${buttonSecondaryClass} py-1 px-2`}
          >
            A-
          </button>
          <span className="text-xs w-[45px] text-center">{settings.fontSize}px</span>
          <button
            onClick={() => setSettings(prev => ({ ...prev, fontSize: Math.min(120, prev.fontSize + 4) }))}
            className={`${buttonSecondaryClass} py-1 px-2`}
          >
            A+
          </button>
        </div>

        <div className="flex-1" />

        <div className="text-xs text-slate-500">
          Progress: {getProgress()}%
        </div>

        <div className="text-[11px] text-slate-600">
          Space: Play/Pause | ↑↓: Speed | R: Reset | M: Mirror | Esc: Exit
        </div>
      </div>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="flex-1 overflow-auto p-3">
      <div className="max-w-[600px] mx-auto">
        {/* Display Settings */}
        <div className={sectionClass}>
          <h3 className="m-0 mb-4 text-sm font-semibold">Display Settings</h3>

          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1.5">
              Font Size: {settings.fontSize}px
            </label>
            <input
              type="range"
              min={24}
              max={120}
              value={settings.fontSize}
              onChange={(e) => setSettings(prev => ({ ...prev, fontSize: Number(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1.5">
              Font Family
            </label>
            <select
              value={settings.fontFamily}
              onChange={(e) => setSettings(prev => ({ ...prev, fontFamily: e.target.value }))}
              className={`${inputClass} w-full`}
            >
              <option value="Arial">Arial</option>
              <option value="Georgia">Georgia</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Verdana">Verdana</option>
              <option value="Courier New">Courier New</option>
              <option value="system-ui">System UI</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1.5">
              Line Height: {settings.lineHeight}
            </label>
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.1}
              value={settings.lineHeight}
              onChange={(e) => setSettings(prev => ({ ...prev, lineHeight: Number(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1.5">
              Text Alignment
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSettings(prev => ({ ...prev, textAlign: 'left' }))}
                className={`${buttonSecondaryClass} flex-1 ${settings.textAlign === 'left' ? 'bg-blue-500' : 'bg-slate-700'}`}
              >
                Left
              </button>
              <button
                onClick={() => setSettings(prev => ({ ...prev, textAlign: 'center' }))}
                className={`${buttonSecondaryClass} flex-1 ${settings.textAlign === 'center' ? 'bg-blue-500' : 'bg-slate-700'}`}
              >
                Center
              </button>
            </div>
          </div>
        </div>

        {/* Color Settings */}
        <div className={sectionClass}>
          <h3 className="m-0 mb-4 text-sm font-semibold">Colors</h3>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">
                Text Color
              </label>
              <input
                type="color"
                value={settings.textColor}
                onChange={(e) => setSettings(prev => ({ ...prev, textColor: e.target.value }))}
                className="w-full h-10 border-none rounded cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">
                Background
              </label>
              <input
                type="color"
                value={settings.backgroundColor}
                onChange={(e) => setSettings(prev => ({ ...prev, backgroundColor: e.target.value }))}
                className="w-full h-10 border-none rounded cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">
                Highlight
              </label>
              <input
                type="color"
                value={settings.highlightColor}
                onChange={(e) => setSettings(prev => ({ ...prev, highlightColor: e.target.value }))}
                className="w-full h-10 border-none rounded cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Playback Settings */}
        <div className={sectionClass}>
          <h3 className="m-0 mb-4 text-sm font-semibold">Playback</h3>

          <div className="mb-4">
            <label className="block text-xs text-slate-500 mb-1.5">
              Default Scroll Speed: {settings.scrollSpeed} px/s
            </label>
            <input
              type="range"
              min={10}
              max={200}
              value={settings.scrollSpeed}
              onChange={(e) => setSettings(prev => ({ ...prev, scrollSpeed: Number(e.target.value) }))}
              className="w-full"
            />
            <div className="flex justify-between mt-1">
              <button onClick={() => setSettings(prev => ({ ...prev, scrollSpeed: 30 }))} className={`${buttonSecondaryClass} text-[11px]`}>Slow</button>
              <button onClick={() => setSettings(prev => ({ ...prev, scrollSpeed: 60 }))} className={`${buttonSecondaryClass} text-[11px]`}>Normal</button>
              <button onClick={() => setSettings(prev => ({ ...prev, scrollSpeed: 100 }))} className={`${buttonSecondaryClass} text-[11px]`}>Fast</button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1.5">
              Countdown Duration: {settings.countdownSeconds} seconds
            </label>
            <input
              type="range"
              min={3}
              max={10}
              value={settings.countdownSeconds}
              onChange={(e) => setSettings(prev => ({ ...prev, countdownSeconds: Number(e.target.value) }))}
              className="w-full"
            />
          </div>
        </div>

        {/* Reset */}
        <div className={sectionClass}>
          <button
            onClick={() => setSettings(DEFAULT_SETTINGS)}
            className={`${buttonDangerClass} w-full`}
          >
            Reset All Settings to Defaults
          </button>
        </div>
      </div>
    </div>
  );

  // === Main Render ===
  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-950 text-slate-200 font-sans">
      {/* Tab Bar */}
      <div className="flex gap-0.5 py-2 px-3 bg-slate-900 border-b border-slate-700">
        <button onClick={() => setActiveTab('edit')} className={tabClass(activeTab === 'edit')}>
          Edit
        </button>
        <button onClick={() => setActiveTab('teleprompter')} className={tabClass(activeTab === 'teleprompter')}>
          Teleprompter
        </button>
        <button onClick={() => setActiveTab('settings')} className={tabClass(activeTab === 'settings')}>
          Settings
        </button>
        <div className="flex-1" />
        <div className="text-xs text-slate-600 self-center">
          {currentScript.title}{hasUnsavedChanges ? ' *' : ''}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'edit' && renderEditTab()}
      {activeTab === 'teleprompter' && renderTeleprompterTab()}
      {activeTab === 'settings' && renderSettingsTab()}
    </div>
  );
};
