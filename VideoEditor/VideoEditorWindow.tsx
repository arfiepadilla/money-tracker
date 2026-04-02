import React, { useState, useEffect, useCallback, useRef } from 'react';

interface VideoClip {
  id: string;
  name: string;
  filePath: string;
  dataUrl: string | null;
  duration: number;
  startTime: number;
  endTime: number;
  thumbnail?: string;
  loudness?: {
    integratedLoudness: number | null;
    loudnessRange: number | null;
    truePeak: number | null;
  } | null;
  loudnessLoading?: boolean;
  loudnessError?: string | null;
}

interface ServerStatus {
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  temp_dir: string;
}

interface TimelineSegment {
  clipId: string;
  start: number;
  end: number;
  clipStart: number;
  clipEnd: number;
}

export const VideoEditorWindow: React.FC = () => {
  // Server connection
  const [serverPort, setServerPort] = useState(8766);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
  const [selectedVenv, setSelectedVenv] = useState<string>('');

  // Dependency checking
  const REQUIRED_PACKAGES = ['fastapi', 'uvicorn'];
  const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [showQuickstart, setShowQuickstart] = useState(true);

  // FFmpeg installation
  const [ffmpegInstalled, setFfmpegInstalled] = useState<boolean | null>(null);
  const [checkingFfmpeg, setCheckingFfmpeg] = useState(false);
  const [installingFfmpeg, setInstallingFfmpeg] = useState(false);

  // Video clips
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentClip, setCurrentClip] = useState<VideoClip | null>(null);

  // Imported video player state
  const [importedIsPlaying, setImportedIsPlaying] = useState(false);
  const [importedCurrentTime, setImportedCurrentTime] = useState(0);
  const [importedDuration, setImportedDuration] = useState(0);
  const [importedVolume, setImportedVolume] = useState(1.0);
  const [importedPlayerHeight, setImportedPlayerHeight] = useState(200);
  const [isResizingImported, setIsResizingImported] = useState(false);

  // Trimmed video player state
  const [trimmedIsPlaying, setTrimmedIsPlaying] = useState(false);
  const [trimmedCurrentTime, setTrimmedCurrentTime] = useState(0);
  const [trimmedVolume, setTrimmedVolume] = useState(1.0);
  const [trimmedPlayerHeight, setTrimmedPlayerHeight] = useState(180);
  const [isResizingTrimmed, setIsResizingTrimmed] = useState(false);

  // Timeline video player state
  const [timelineIsPlaying, setTimelineIsPlaying] = useState(false);
  const [timelineCurrentTime, setTimelineCurrentTime] = useState(0);
  const [timelineVolume, setTimelineVolume] = useState(1.0);
  const [timelinePlayerHeight, setTimelinePlayerHeight] = useState(250);
  const [isResizingTimeline, setIsResizingTimeline] = useState(false);

  // Timeline playback tracking
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [timelinePlaybackTime, setTimelinePlaybackTime] = useState(0);

  // Logs panel
  const [logsHeight, setLogsHeight] = useState(150);
  const [isResizingLogs, setIsResizingLogs] = useState(false);

  // Editing
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [timeline, setTimeline] = useState<TimelineSegment[]>([]);

  // Processing
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Logs
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Refs - three video players
  const importedVideoRef = useRef<HTMLVideoElement>(null);
  const trimmedVideoRef = useRef<HTMLVideoElement>(null);
  const timelineVideoRef = useRef<HTMLVideoElement>(null);

  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Listen for Python logs
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

  // Auto-check dependencies when venv changes
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

  const checkDependencies = async () => {
    if (!selectedVenv) {
      addLog('ERROR: No venv selected');
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

      const unknownMap: Record<string, any> = {};
      for (const p of REQUIRED_PACKAGES) unknownMap[p] = { installed: false };
      setDepsStatus(unknownMap);
      addLog('Could not determine dependency status');
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
        addLog(`Installing packages: ${missing.join(', ')}`);

        const result = await ipcRenderer.invoke('python-install-packages', {
          venvName: selectedVenv,
          packages: missing
        });

        if (result.success) {
          addLog('Installation completed successfully');
          await checkDependencies();
        } else {
          addLog(`ERROR: Installation failed - ${result.error}`);
        }
      }
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    } finally {
      setInstallingDeps(false);
    }
  };

  // Check if FFmpeg is installed on the system
  const checkFfmpegInstalled = async () => {
    if (!ipcRenderer) return;

    setCheckingFfmpeg(true);
    try {
      // First try simple PATH check
      const result = await ipcRenderer.invoke('run-command', {
        command: 'ffmpeg -version',
        timeout: 10000
      });

      if (result.success && result.stdout && result.stdout.includes('ffmpeg version')) {
        setFfmpegInstalled(true);
        addLog('FFmpeg is installed on this system');
        setCheckingFfmpeg(false);
        return;
      }

      // Try 'where' command which searches PATH more thoroughly
      const whereResult = await ipcRenderer.invoke('run-command', {
        command: 'where ffmpeg',
        timeout: 10000
      });

      if (whereResult.success && whereResult.stdout && whereResult.stdout.trim()) {
        setFfmpegInstalled(true);
        addLog(`FFmpeg found at: ${whereResult.stdout.trim().split('\n')[0]}`);
        setCheckingFfmpeg(false);
        return;
      }

      // Check common Windows installation locations including WinGet
      const commonPaths = [
        '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
        '%ProgramData%\\chocolatey\\bin\\ffmpeg.exe',
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      ];

      for (const pathTemplate of commonPaths) {
        const checkResult = await ipcRenderer.invoke('run-command', {
          command: `cmd /c "if exist "${pathTemplate}" (echo FOUND)"`,
          timeout: 5000
        });

        if (checkResult.success && checkResult.stdout && checkResult.stdout.includes('FOUND')) {
          setFfmpegInstalled(true);
          addLog(`FFmpeg found at: ${pathTemplate}`);
          setCheckingFfmpeg(false);
          return;
        }
      }

      setFfmpegInstalled(false);
      addLog('FFmpeg is not installed on this system');
    } catch (e: any) {
      setFfmpegInstalled(false);
      addLog('FFmpeg is not installed on this system');
    } finally {
      setCheckingFfmpeg(false);
    }
  };

  // Install FFmpeg using winget
  const installFfmpeg = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setInstallingFfmpeg(true);
    addLog('Installing FFmpeg via winget... This may take a few minutes.');
    addLog('A new terminal window will open for the installation.');

    try {
      // Use start cmd to open a new terminal window for installation so user can see progress
      const result = await ipcRenderer.invoke('run-command', {
        command: 'start cmd /c "winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements && echo. && echo FFmpeg installation complete! Press any key to close... && pause"',
        timeout: 300000 // 5 minute timeout
      });

      // The start command returns immediately, so we need to poll for FFmpeg availability
      addLog('Installation started in a new window. Checking for FFmpeg...');

      // Wait a bit then check if ffmpeg is now available
      let attempts = 0;
      const maxAttempts = 60; // Check for up to 5 minutes
      const checkInterval = setInterval(async () => {
        attempts++;
        try {
          const checkResult = await ipcRenderer.invoke('run-command', {
            command: 'ffmpeg -version',
            timeout: 5000
          });

          if (checkResult.success && checkResult.stdout && checkResult.stdout.includes('ffmpeg version')) {
            clearInterval(checkInterval);
            setFfmpegInstalled(true);
            setInstallingFfmpeg(false);
            addLog('FFmpeg installed successfully! You may need to restart the server for it to detect FFmpeg.');
          }
        } catch {
          // Not yet installed, continue polling
        }

        if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          setInstallingFfmpeg(false);
          addLog('Installation check timed out. Please check the installation window and restart the app after FFmpeg is installed.');
          // Re-check one more time
          await checkFfmpegInstalled();
        }
      }, 5000);
    } catch (e: any) {
      addLog(`ERROR: Failed to start FFmpeg installation: ${e.message}`);
      setInstallingFfmpeg(false);
    }
  };

  // Check FFmpeg on component mount
  useEffect(() => {
    checkFfmpegInstalled();
  }, []);

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

  useEffect(() => {
    const interval = setInterval(() => {
      if (serverRunning) {
        checkServerStatus();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [serverRunning, checkServerStatus]);

  const startServer = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    setConnecting(true);
    addLog('Starting Video Editor server...');

    const alreadyRunning = await checkServerStatus();
    if (alreadyRunning) {
      addLog('Server already running!');
      setConnecting(false);
      return;
    }

    if (!selectedVenv) {
      addLog('ERROR: No Python virtual environment selected.');
      setConnecting(false);
      return;
    }

    addLog(`Using venv: ${selectedVenv}`);

    const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
      workflowFolder: 'VideoEditor',
      scriptName: 'video_editor_server.py'
    });

    if (!scriptResult.success) {
      addLog(`ERROR: Could not find video_editor_server.py: ${scriptResult.error}`);
      setConnecting(false);
      return;
    }

    const result = await ipcRenderer.invoke('python-start-script-server', {
      venvName: selectedVenv,
      scriptPath: scriptResult.path,
      port: serverPort,
      serverName: 'video-editor',
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
          addLog('ERROR: Server failed to start. Check that fastapi and uvicorn are installed.');
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

    const result = await ipcRenderer.invoke('python-stop-script-server', 'video-editor');
    if (result.success) {
      addLog('Server stopped');
      setServerRunning(false);
      setServerStatus(null);
    }
  };

  // Helper to create clip and update state
  const createClipFromVideo = (
    fileName: string,
    filePath: string,
    blobUrl: string,
    videoDuration: number
  ) => {
    const newClip: VideoClip = {
      id: `clip_${Date.now()}`,
      name: fileName,
      filePath: filePath,
      dataUrl: blobUrl,
      duration: videoDuration,
      startTime: 0,
      endTime: videoDuration,
    };

    setClips(prev => [...prev, newClip]);
    setCurrentClip(newClip);
    setTrimStart(0);
    setTrimEnd(videoDuration);
    addLog(`Loaded: ${fileName} (${videoDuration.toFixed(2)}s)`);
  };

  // Try to load video using FFmpeg transcoding
  const tryTranscodeLoad = async (filePath: string, fileName: string): Promise<boolean> => {
    if (!serverRunning || !ipcRenderer) return false;

    addLog('Transcoding video for browser playback...');

    try {
      const transcodeRes = await fetch(`${getServerUrl()}/transcode_for_preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath }),
      });

      const transcodeData = await transcodeRes.json();

      if (!transcodeData.success) {
        addLog(`Transcode failed: ${transcodeData.error}`);
        return false;
      }

      const transcodedPath = transcodeData.transcoded_path;
      const videoDuration = transcodeData.duration;

      addLog(transcodeData.cached
        ? `Using cached transcoded version (${videoDuration.toFixed(2)}s)`
        : `Transcoding complete (${videoDuration.toFixed(2)}s)`);

      // Read the transcoded file
      const fileBuffer = await ipcRenderer.invoke('read-file', { filePath: transcodedPath, encoding: null });

      if (!fileBuffer.success) {
        addLog(`ERROR: Could not read transcoded file: ${fileBuffer.error}`);
        return false;
      }

      const uint8Array = new Uint8Array(fileBuffer.content);
      const blob = new Blob([uint8Array], { type: 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);

      createClipFromVideo(fileName, filePath, blobUrl, videoDuration);
      return true;
    } catch (err) {
      addLog(`Transcode request failed: ${err}`);
      return false;
    }
  };

  // Helper to load a single video file by path
  const loadSingleVideoFile = async (filePath: string, setAsCurrent: boolean = true): Promise<boolean> => {
    const fileName = filePath.split(/[/\\]/).pop() || 'video';

    // Check if this file is already loaded
    const existingClip = clips.find(c => c.filePath === filePath);
    if (existingClip) {
      addLog(`${fileName} is already loaded`);
      if (setAsCurrent) {
        setCurrentClip(existingClip);
        setSelectedClipId(existingClip.id);
      }
      return true;
    }

    addLog(`Loading: ${fileName}...`);

    // Determine MIME type from file extension
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'flv': 'video/x-flv',
      'wmv': 'video/x-ms-wmv',
    };
    const mimeType = mimeTypes[extension] || 'video/mp4';

    // Read the file as a blob
    const fileBuffer = await ipcRenderer.invoke('read-file', { filePath, encoding: null });

    if (!fileBuffer.success) {
      addLog(`ERROR: Could not read file: ${fileBuffer.error}`);
      return false;
    }

    // Convert buffer to blob
    const uint8Array = new Uint8Array(fileBuffer.content);
    const blob = new Blob([uint8Array], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    // Try direct loading first
    const directLoadResult = await new Promise<{ success: boolean; duration?: number; error?: string }>((resolve) => {
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.style.cssText = 'position:absolute;opacity:0;pointer-events:none;';
      document.body.appendChild(tempVideo);

      const cleanup = () => {
        tempVideo.removeEventListener('loadedmetadata', onMetadata);
        tempVideo.removeEventListener('error', onError);
        tempVideo.src = '';
        tempVideo.remove();
      };

      const onMetadata = () => {
        const dur = tempVideo.duration;
        cleanup();
        if (dur && !isNaN(dur) && isFinite(dur)) {
          resolve({ success: true, duration: dur });
        } else {
          resolve({ success: false, error: 'Invalid duration' });
        }
      };

      const onError = () => {
        const err = tempVideo.error;
        cleanup();
        URL.revokeObjectURL(blobUrl);
        resolve({ success: false, error: err?.message || 'Unknown error' });
      };

      tempVideo.addEventListener('loadedmetadata', onMetadata);
      tempVideo.addEventListener('error', onError);
      tempVideo.src = blobUrl;
    });

    if (directLoadResult.success && directLoadResult.duration) {
      const newClip: VideoClip = {
        id: `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: fileName,
        filePath: filePath,
        dataUrl: blobUrl,
        duration: directLoadResult.duration,
        startTime: 0,
        endTime: directLoadResult.duration,
      };

      setClips(prev => [...prev, newClip]);
      if (setAsCurrent) {
        setCurrentClip(newClip);
        setSelectedClipId(newClip.id);
        setTrimStart(0);
        setTrimEnd(directLoadResult.duration);
      }
      addLog(`Loaded: ${fileName} (${directLoadResult.duration.toFixed(2)}s)`);
      return true;
    }

    // Direct load failed, try transcoding if server is running
    if (serverRunning) {
      const transcodeSuccess = await tryTranscodeLoad(filePath, fileName);
      return transcodeSuccess;
    } else {
      addLog(`Failed to load ${fileName} - start server to enable transcoding`);
      return false;
    }
  };

  // Load single video file
  const loadVideo = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    try {
      const result = await ipcRenderer.invoke('show-open-dialog', {
        title: 'Open Video',
        filters: [
          { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'] }
        ],
        properties: ['openFile']
      });

      if (!result.success || result.canceled) return;

      await loadSingleVideoFile(result.filePaths[0], true);
    } catch (error) {
      addLog(`ERROR: ${error}`);
    }
  };

  // Load multiple video files at once
  const loadMultipleVideos = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    try {
      const result = await ipcRenderer.invoke('show-open-dialog', {
        title: 'Open Multiple Videos',
        filters: [
          { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'] }
        ],
        properties: ['openFile', 'multiSelections']
      });

      if (!result.success || result.canceled || result.filePaths.length === 0) return;

      addLog(`Loading ${result.filePaths.length} videos...`);

      let loadedCount = 0;
      let firstLoadedClip: VideoClip | null = null;

      for (let i = 0; i < result.filePaths.length; i++) {
        const filePath = result.filePaths[i];
        const isFirst = i === 0;

        // Load video, set first one as current
        const success = await loadSingleVideoFile(filePath, isFirst);
        if (success) {
          loadedCount++;
          if (isFirst) {
            // Get the clip that was just added
            firstLoadedClip = clips.find(c => c.filePath === filePath) || null;
          }
        }
      }

      addLog(`Successfully loaded ${loadedCount} of ${result.filePaths.length} videos`);
    } catch (error) {
      addLog(`ERROR: ${error}`);
    }
  };

  // Remove clip from library
  const removeClipFromLibrary = (clipId: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    // Check if clip is used in timeline
    const usedInTimeline = timeline.some(seg => seg.clipId === clipId);
    if (usedInTimeline) {
      addLog(`Cannot remove ${clip.name} - it's used in the timeline`);
      return;
    }

    // Revoke blob URL to free memory
    if (clip.dataUrl) {
      URL.revokeObjectURL(clip.dataUrl);
    }

    setClips(prev => prev.filter(c => c.id !== clipId));

    // If this was the current clip, select another or clear
    if (currentClip?.id === clipId) {
      const remaining = clips.filter(c => c.id !== clipId);
      if (remaining.length > 0) {
        setCurrentClip(remaining[0]);
        setSelectedClipId(remaining[0].id);
      } else {
        setCurrentClip(null);
        setSelectedClipId(null);
      }
    }

    addLog(`Removed ${clip.name} from library`);
  };

  // Legacy load video code path for transcoding fallback
  const loadVideoLegacy = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    try {
      const result = await ipcRenderer.invoke('show-open-dialog', {
        title: 'Open Video',
        filters: [
          { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'] }
        ],
        properties: ['openFile']
      });

      if (!result.success || result.canceled) return;

      const filePath = result.filePaths[0];
      const fileName = filePath.split(/[/\\]/).pop() || 'video';

      addLog(`Loading: ${fileName}...`);

      // Determine MIME type from file extension
      const extension = fileName.split('.').pop()?.toLowerCase() || '';
      const mimeTypes: Record<string, string> = {
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'ogg': 'video/ogg',
        'mov': 'video/quicktime',
        'avi': 'video/x-msvideo',
        'mkv': 'video/x-matroska',
        'flv': 'video/x-flv',
        'wmv': 'video/x-ms-wmv',
      };
      const mimeType = mimeTypes[extension] || 'video/mp4';

      // Read the file as a blob
      const fileBuffer = await ipcRenderer.invoke('read-file', { filePath, encoding: null });

      if (!fileBuffer.success) {
        addLog(`ERROR: Could not read file: ${fileBuffer.error}`);
        return;
      }

      addLog(`File read successfully, size: ${fileBuffer.content.length} bytes`);

      // Convert buffer to blob
      const uint8Array = new Uint8Array(fileBuffer.content);
      const blob = new Blob([uint8Array], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      // Try direct loading first
      addLog('Trying direct playback...');

      const directLoadResult = await new Promise<{ success: boolean; duration?: number; error?: string }>((resolve) => {
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        tempVideo.style.cssText = 'position:absolute;opacity:0;pointer-events:none;';
        document.body.appendChild(tempVideo);

        const cleanup = () => {
          tempVideo.removeEventListener('loadedmetadata', onMetadata);
          tempVideo.removeEventListener('error', onError);
          tempVideo.src = '';
          tempVideo.remove();
        };

        const onMetadata = () => {
          const dur = tempVideo.duration;
          cleanup();
          if (dur && !isNaN(dur) && isFinite(dur)) {
            resolve({ success: true, duration: dur });
          } else {
            resolve({ success: false, error: 'Invalid duration' });
          }
        };

        const onError = () => {
          const err = tempVideo.error;
          cleanup();
          URL.revokeObjectURL(blobUrl);
          resolve({ success: false, error: err?.message || 'Unknown error' });
        };

        tempVideo.addEventListener('loadedmetadata', onMetadata);
        tempVideo.addEventListener('error', onError);
        tempVideo.src = blobUrl;
      });

      if (directLoadResult.success && directLoadResult.duration) {
        addLog('Direct playback supported');
        createClipFromVideo(fileName, filePath, blobUrl, directLoadResult.duration);
        return;
      }

      // Direct load failed, try transcoding if server is running
      addLog(`Direct playback failed: ${directLoadResult.error}`);

      if (serverRunning) {
        const transcodeSuccess = await tryTranscodeLoad(filePath, fileName);
        if (transcodeSuccess) return;
      } else {
        addLog('TIP: Start the Python server to enable automatic transcoding for incompatible video formats.');
      }

      addLog('ERROR: Could not load video');
    } catch (error) {
      addLog(`ERROR: ${error}`);
    }
  };

  // Update imported video element when current clip changes
  useEffect(() => {
    if (currentClip) {
      // Update imported player
      if (importedVideoRef.current) {
        importedVideoRef.current.src = currentClip.dataUrl || '';
        importedVideoRef.current.load();
      }
      // Update trimmed player
      if (trimmedVideoRef.current) {
        trimmedVideoRef.current.src = currentClip.dataUrl || '';
        trimmedVideoRef.current.load();
      }
      // Reset playback state for new clip
      setImportedCurrentTime(0);
      setImportedIsPlaying(false);
      setImportedDuration(currentClip.duration);
      setTrimStart(currentClip.startTime);
      setTrimEnd(currentClip.endTime);
      setTrimmedCurrentTime(currentClip.startTime);
      setTrimmedIsPlaying(false);
    }
  }, [currentClip]);

  // Sync trimmed player when trim bounds change - only reset if outside bounds
  useEffect(() => {
    if (trimmedVideoRef.current && currentClip?.dataUrl) {
      const currentPos = trimmedVideoRef.current.currentTime;
      // Only reset if current position is outside the new trim bounds
      if (currentPos < trimStart || currentPos > trimEnd) {
        trimmedVideoRef.current.currentTime = trimStart;
        setTrimmedCurrentTime(trimStart);
      }
    }
  }, [trimStart, trimEnd, currentClip?.dataUrl]);

  // ==========================================
  // IMPORTED VIDEO PLAYER CONTROLS
  // ==========================================
  const toggleImportedPlayPause = () => {
    if (!importedVideoRef.current) return;

    if (importedIsPlaying) {
      importedVideoRef.current.pause();
    } else {
      importedVideoRef.current.play();
    }
    setImportedIsPlaying(!importedIsPlaying);
  };

  const handleImportedTimeUpdate = () => {
    if (!importedVideoRef.current) return;
    setImportedCurrentTime(importedVideoRef.current.currentTime);
  };

  const handleImportedVideoEnded = () => {
    setImportedIsPlaying(false);
    if (importedVideoRef.current) {
      importedVideoRef.current.currentTime = 0;
      setImportedCurrentTime(0);
    }
  };

  // Handle seeking in imported video (for when user clicks on video directly or uses slider)
  const handleImportedSeeked = () => {
    if (!importedVideoRef.current) return;
    setImportedCurrentTime(importedVideoRef.current.currentTime);
  };

  // Handle metadata loaded for imported video
  const handleImportedLoadedMetadata = () => {
    if (!importedVideoRef.current) return;
    setImportedCurrentTime(importedVideoRef.current.currentTime);
    setImportedDuration(importedVideoRef.current.duration);
  };

  const seekImportedTo = (time: number) => {
    if (!importedVideoRef.current) return;
    importedVideoRef.current.currentTime = Math.max(0, Math.min(importedDuration, time));
    setImportedCurrentTime(importedVideoRef.current.currentTime);
  };

  const handleImportedVolumeChange = (vol: number) => {
    setImportedVolume(vol);
    if (importedVideoRef.current) {
      importedVideoRef.current.volume = vol;
    }
  };

  // ==========================================
  // TRIMMED VIDEO PLAYER CONTROLS
  // ==========================================
  const toggleTrimmedPlayPause = () => {
    if (!trimmedVideoRef.current) return;

    if (trimmedIsPlaying) {
      trimmedVideoRef.current.pause();
    } else {
      // Ensure we start within trim bounds
      if (trimmedVideoRef.current.currentTime < trimStart || trimmedVideoRef.current.currentTime >= trimEnd) {
        trimmedVideoRef.current.currentTime = trimStart;
      }
      trimmedVideoRef.current.play();
    }
    setTrimmedIsPlaying(!trimmedIsPlaying);
  };

  const handleTrimmedTimeUpdate = () => {
    if (!trimmedVideoRef.current) return;
    const time = trimmedVideoRef.current.currentTime;
    setTrimmedCurrentTime(time);

    // Loop within trim bounds
    if (time >= trimEnd - 0.05) {
      trimmedVideoRef.current.currentTime = trimStart;
    }
  };

  const handleTrimmedVideoEnded = () => {
    setTrimmedIsPlaying(false);
    if (trimmedVideoRef.current) {
      trimmedVideoRef.current.currentTime = trimStart;
    }
  };

  const seekTrimmedTo = (time: number) => {
    if (!trimmedVideoRef.current) return;
    trimmedVideoRef.current.currentTime = Math.max(trimStart, Math.min(trimEnd, time));
    setTrimmedCurrentTime(trimmedVideoRef.current.currentTime);
  };

  const handleTrimmedVolumeChange = (vol: number) => {
    setTrimmedVolume(vol);
    if (trimmedVideoRef.current) {
      trimmedVideoRef.current.volume = vol;
    }
  };

  // ==========================================
  // TIMELINE VIDEO PLAYER CONTROLS
  // ==========================================
  const handleTimelineVolumeChange = (vol: number) => {
    setTimelineVolume(vol);
    if (timelineVideoRef.current) {
      timelineVideoRef.current.volume = vol;
    }
  };

  // Set trim start to current time (from imported player)
  const setTrimStartToCurrent = () => {
    // Read directly from video element in case state hasn't updated yet
    const videoTime = importedVideoRef.current?.currentTime ?? 0;
    const newStart = videoTime;
    // Ensure start is before end (with small tolerance for edge case)
    if (newStart >= trimEnd - 0.1) {
      addLog(`Start time (${newStart.toFixed(2)}s) must be before end time (${trimEnd.toFixed(2)}s)`);
      return;
    }
    setTrimStart(newStart);
    setImportedCurrentTime(newStart); // Sync state with video element
    // Update trimmed player position if needed
    if (trimmedVideoRef.current && trimmedVideoRef.current.currentTime < newStart) {
      trimmedVideoRef.current.currentTime = newStart;
      setTrimmedCurrentTime(newStart);
    }
  };

  // Set trim end to current time (from imported player)
  const setTrimEndToCurrent = () => {
    // Read directly from video element in case state hasn't updated yet
    const videoTime = importedVideoRef.current?.currentTime ?? 0;
    const newEnd = videoTime;
    // Ensure end is after start (with small tolerance for edge case)
    if (newEnd <= trimStart + 0.1) {
      addLog(`End time (${newEnd.toFixed(2)}s) must be after start time (${trimStart.toFixed(2)}s)`);
      return;
    }
    setTrimEnd(newEnd);
    setImportedCurrentTime(newEnd); // Sync state with video element
    // Update trimmed player position if it's now past the end
    if (trimmedVideoRef.current && trimmedVideoRef.current.currentTime > newEnd) {
      trimmedVideoRef.current.currentTime = trimStart;
      setTrimmedCurrentTime(trimStart);
    }
  };

  // Add trimmed clip to timeline
  const addToTimeline = () => {
    if (!currentClip) return;

    const segment: TimelineSegment = {
      clipId: currentClip.id,
      start: timeline.length > 0 ? timeline[timeline.length - 1].end : 0,
      end: timeline.length > 0 ? timeline[timeline.length - 1].end + (trimEnd - trimStart) : (trimEnd - trimStart),
      clipStart: trimStart,
      clipEnd: trimEnd,
    };

    setTimeline(prev => [...prev, segment]);
    addLog(`Added segment: ${currentClip.name} [${trimStart.toFixed(2)}s - ${trimEnd.toFixed(2)}s]`);
  };

  // Remove segment from timeline
  const removeFromTimeline = (index: number) => {
    setTimeline(prev => {
      const newTimeline = prev.filter((_, i) => i !== index);
      // Recalculate start/end times
      let currentEnd = 0;
      return newTimeline.map(seg => {
        const duration = seg.clipEnd - seg.clipStart;
        const newSeg = { ...seg, start: currentEnd, end: currentEnd + duration };
        currentEnd += duration;
        return newSeg;
      });
    });
  };

  // Load a timeline segment back into the editor for re-editing
  const loadSegmentToEditor = (index: number) => {
    const segment = timeline[index];
    if (!segment) return;

    const clip = clips.find(c => c.id === segment.clipId);
    if (!clip) {
      addLog('ERROR: Could not find clip for segment');
      return;
    }

    // Set the clip as current
    setCurrentClip(clip);
    setSelectedClipId(clip.id);

    // Set trim bounds to match the segment
    setTrimStart(segment.clipStart);
    setTrimEnd(segment.clipEnd);

    // Seek imported video to the start of the segment
    if (importedVideoRef.current) {
      importedVideoRef.current.currentTime = segment.clipStart;
      setImportedCurrentTime(segment.clipStart);
    }

    addLog(`Loaded segment ${index + 1} for editing: ${clip.name} [${segment.clipStart.toFixed(2)}s - ${segment.clipEnd.toFixed(2)}s]`);
  };

  // Clear timeline
  const clearTimeline = () => {
    stopTimelinePlayback();
    setTimeline([]);
    addLog('Timeline cleared');
  };

  // Timeline playback functions
  const playTimeline = useCallback(() => {
    if (timeline.length === 0) {
      addLog('No segments in timeline to play');
      return;
    }

    setIsPlayingTimeline(true);
    setCurrentSegmentIndex(0);
    setTimelinePlaybackTime(0);
    playSegment(0);
    addLog('Playing timeline...');
  }, [timeline, clips]);

  const stopTimelinePlayback = useCallback(() => {
    setIsPlayingTimeline(false);
    setCurrentSegmentIndex(0);
    setTimelinePlaybackTime(0);
    if (timelineVideoRef.current) {
      timelineVideoRef.current.pause();
    }
    setTimelineIsPlaying(false);
  }, []);

  const playSegment = useCallback((index: number) => {
    if (index >= timeline.length) {
      // Timeline finished
      setIsPlayingTimeline(false);
      setCurrentSegmentIndex(0);
      setTimelinePlaybackTime(0);
      setTimelineIsPlaying(false);
      addLog('Timeline playback complete');
      return;
    }

    const segment = timeline[index];
    const clip = clips.find(c => c.id === segment.clipId);

    if (!clip || !clip.dataUrl) {
      addLog(`ERROR: Could not find clip for segment ${index + 1}`);
      // Try next segment
      playSegment(index + 1);
      return;
    }

    // Switch to this clip's video in timeline player
    if (timelineVideoRef.current) {
      timelineVideoRef.current.src = clip.dataUrl;
      timelineVideoRef.current.currentTime = segment.clipStart;
      timelineVideoRef.current.play().catch(err => {
        addLog(`ERROR: Could not play segment: ${err}`);
      });
      setTimelineIsPlaying(true);
    }

    setCurrentSegmentIndex(index);
  }, [timeline, clips, addLog]);

  // Handle timeline segment transitions during playback
  useEffect(() => {
    if (!isPlayingTimeline || !timelineVideoRef.current) return;

    const segment = timeline[currentSegmentIndex];
    if (!segment) return;

    const handleTimelineTimeUpdate = () => {
      if (!timelineVideoRef.current || !isPlayingTimeline) return;

      const currentVideoTime = timelineVideoRef.current.currentTime;
      setTimelineCurrentTime(currentVideoTime);

      // Calculate timeline playback time
      let elapsed = 0;
      for (let i = 0; i < currentSegmentIndex; i++) {
        elapsed += timeline[i].clipEnd - timeline[i].clipStart;
      }
      elapsed += currentVideoTime - segment.clipStart;
      setTimelinePlaybackTime(elapsed);

      // Check if we've reached the end of this segment
      if (currentVideoTime >= segment.clipEnd - 0.05) {
        timelineVideoRef.current.pause();
        // Move to next segment
        playSegment(currentSegmentIndex + 1);
      }
    };

    timelineVideoRef.current.addEventListener('timeupdate', handleTimelineTimeUpdate);

    return () => {
      timelineVideoRef.current?.removeEventListener('timeupdate', handleTimelineTimeUpdate);
    };
  }, [isPlayingTimeline, currentSegmentIndex, timeline, playSegment]);

  // Get total timeline duration
  const getTimelineDuration = useCallback(() => {
    return timeline.reduce((total, seg) => total + (seg.clipEnd - seg.clipStart), 0);
  }, [timeline]);

  // Seek to a specific time in the timeline
  const seekTimelineTo = useCallback((targetTime: number) => {
    if (timeline.length === 0) return;

    // Find which segment contains this time
    let accumulatedTime = 0;
    for (let i = 0; i < timeline.length; i++) {
      const segment = timeline[i];
      const segmentDuration = segment.clipEnd - segment.clipStart;

      if (targetTime < accumulatedTime + segmentDuration) {
        // Found the segment
        const clip = clips.find(c => c.id === segment.clipId);
        if (!clip || !clip.dataUrl) return;

        const timeWithinSegment = targetTime - accumulatedTime;
        const videoTime = segment.clipStart + timeWithinSegment;

        // Load this segment into timeline player
        if (timelineVideoRef.current) {
          // Only change source if it's a different clip
          const currentSrc = timelineVideoRef.current.src;
          if (!currentSrc || !currentSrc.includes(clip.dataUrl.split('/').pop() || '')) {
            timelineVideoRef.current.src = clip.dataUrl;
          }
          timelineVideoRef.current.currentTime = videoTime;
          setTimelineCurrentTime(videoTime);
        }

        setCurrentSegmentIndex(i);
        setTimelinePlaybackTime(targetTime);
        return;
      }

      accumulatedTime += segmentDuration;
    }

    // If we're at the end, go to the last frame of the last segment
    const lastIndex = timeline.length - 1;
    const lastSegment = timeline[lastIndex];
    const lastClip = clips.find(c => c.id === lastSegment.clipId);
    if (lastClip && lastClip.dataUrl && timelineVideoRef.current) {
      timelineVideoRef.current.src = lastClip.dataUrl;
      timelineVideoRef.current.currentTime = lastSegment.clipEnd;
      setTimelineCurrentTime(lastSegment.clipEnd);
      setCurrentSegmentIndex(lastIndex);
      setTimelinePlaybackTime(getTimelineDuration());
    }
  }, [timeline, clips, getTimelineDuration]);

  // Toggle timeline play/pause
  const toggleTimelinePlayPause = useCallback(() => {
    if (timeline.length === 0) return;

    if (isPlayingTimeline) {
      // Pause
      if (timelineVideoRef.current) {
        timelineVideoRef.current.pause();
      }
      setIsPlayingTimeline(false);
      setTimelineIsPlaying(false);
    } else {
      // Play from current position
      if (timelineVideoRef.current) {
        // If we haven't started yet or finished, start from beginning
        if (timelinePlaybackTime >= getTimelineDuration() - 0.1 || timelinePlaybackTime === 0) {
          playTimeline();
        } else {
          // Resume from current position
          timelineVideoRef.current.play().catch(err => {
            addLog(`ERROR: Could not play: ${err}`);
          });
          setIsPlayingTimeline(true);
          setTimelineIsPlaying(true);
        }
      } else {
        playTimeline();
      }
    }
  }, [timeline, isPlayingTimeline, timelinePlaybackTime, getTimelineDuration, playTimeline, addLog]);

  // Export video
  const exportVideo = async () => {
    if (!ipcRenderer) {
      addLog('ERROR: Not running in Electron');
      return;
    }

    if (timeline.length === 0) {
      addLog('ERROR: No segments in timeline');
      return;
    }

    if (!serverRunning) {
      addLog('ERROR: Server must be running to export video. Please start the Python server first.');
      return;
    }

    try {
      const result = await ipcRenderer.invoke('show-save-dialog', {
        title: 'Export Video',
        defaultPath: 'exported_video.mp4',
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
      });

      if (!result.success || result.canceled) return;

      setProcessing(true);
      setProgress(0);
      addLog('Exporting video with FFmpeg...');

      // Build segment list for server
      const segments = timeline.map(seg => {
        const clip = clips.find(c => c.id === seg.clipId);
        return {
          file_path: clip?.filePath,
          start: seg.clipStart,
          end: seg.clipEnd,
        };
      });

      const exportRes = await fetch(`${getServerUrl()}/export_video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments,
          output_path: result.filePath,
        }),
      });

      const data = await exportRes.json();

      if (data.success) {
        addLog(`Video exported: ${result.filePath}`);
        setProgress(100);
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (error) {
      addLog(`ERROR: ${error}`);
    } finally {
      setProcessing(false);
    }
  };

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Format loudness value
  const formatLoudness = (lufs: number | null | undefined): string => {
    if (lufs === null || lufs === undefined) return '--';
    return `${lufs.toFixed(1)} LUFS`;
  };

  // Get color based on loudness level
  const getLoudnessColor = (lufs: number | null | undefined): string => {
    if (lufs === null || lufs === undefined) return '#888';
    if (lufs > -9) return '#e74c3c';   // Too loud (red)
    if (lufs > -14) return '#f39c12';  // Slightly loud (orange)
    if (lufs > -20) return '#27ae60';  // Good range (green)
    if (lufs > -27) return '#3498db';  // Slightly quiet (blue)
    return '#9b59b6';                   // Very quiet (purple)
  };

  // Measure loudness for a clip
  const measureClipLoudness = async (clipId: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    if (!serverRunning) {
      addLog('ERROR: Server must be running to measure loudness');
      return;
    }

    // Mark clip as loading loudness
    setClips(prev => prev.map(c =>
      c.id === clipId
        ? { ...c, loudnessLoading: true, loudnessError: null }
        : c
    ));

    addLog(`Measuring loudness for ${clip.name}...`);

    try {
      const res = await fetch(`${getServerUrl()}/measure_loudness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: clip.filePath }),
      });

      const data = await res.json();

      if (!data.success) {
        setClips(prev => prev.map(c =>
          c.id === clipId
            ? { ...c, loudnessLoading: false, loudnessError: data.error }
            : c
        ));
        addLog(`ERROR: Failed to measure loudness: ${data.error}`);
        return;
      }

      if (!data.has_audio) {
        setClips(prev => prev.map(c =>
          c.id === clipId
            ? { ...c, loudnessLoading: false, loudness: null, loudnessError: 'No audio track' }
            : c
        ));
        addLog(`${clip.name}: No audio track`);
        return;
      }

      setClips(prev => prev.map(c =>
        c.id === clipId
          ? {
              ...c,
              loudnessLoading: false,
              loudnessError: null,
              loudness: {
                integratedLoudness: data.integrated_loudness,
                loudnessRange: data.loudness_range,
                truePeak: data.true_peak,
              }
            }
          : c
      ));

      addLog(`${clip.name}: ${data.integrated_loudness.toFixed(1)} LUFS`);

    } catch (err: any) {
      setClips(prev => prev.map(c =>
        c.id === clipId
          ? { ...c, loudnessLoading: false, loudnessError: err.message }
          : c
      ));
      addLog(`ERROR: ${err.message}`);
    }
  };

  // Styles
  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    background: '#3498db',
    color: 'white',
    fontSize: '13px',
  };

  const sectionStyle: React.CSSProperties = {
    background: '#1a1a1a',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '10px',
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <h2 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Video Editor</h2>

      {/* Quickstart Panel */}
      {showQuickstart && (
        <div style={{ ...sectionStyle, background: '#1e293b', border: '1px solid #334155', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: '#f1f5f9' }}>Quick Start</h3>
            <button
              onClick={() => setShowQuickstart(false)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '11px' }}
            >
              Hide
            </button>
          </div>

          {/* FFmpeg Installation Section */}
          <div style={{ background: '#0f172a', padding: '12px', borderRadius: '6px', border: '1px solid #1e293b', marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '12px', color: '#cbd5e1' }}>
                System Requirements
              </h4>
              <button
                onClick={checkFfmpegInstalled}
                disabled={checkingFfmpeg}
                style={{
                  ...buttonStyle,
                  padding: '4px 10px',
                  fontSize: '10px',
                  background: checkingFfmpeg ? '#334155' : '#475569',
                }}
              >
                {checkingFfmpeg ? 'Checking...' : 'Refresh'}
              </button>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px',
              borderRadius: '6px',
              background: ffmpegInstalled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: ffmpegInstalled ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
            }}>
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: ffmpegInstalled === null ? '#64748b' : ffmpegInstalled ? '#22c55e' : '#ef4444',
              }} />
              <div style={{ flex: 1 }}>
                <span style={{ color: '#f1f5f9', fontSize: '12px', fontWeight: 500 }}>FFmpeg</span>
                <span style={{ color: '#94a3b8', fontSize: '11px', marginLeft: '8px' }}>
                  {ffmpegInstalled === null ? '(checking...)' : ffmpegInstalled ? '(installed)' : '(not installed)'}
                </span>
              </div>
              {!ffmpegInstalled && ffmpegInstalled !== null && (
                <button
                  onClick={installFfmpeg}
                  disabled={installingFfmpeg}
                  style={{
                    ...buttonStyle,
                    padding: '6px 12px',
                    fontSize: '11px',
                    background: installingFfmpeg ? '#334155' : '#22c55e',
                    opacity: installingFfmpeg ? 0.7 : 1,
                  }}
                >
                  {installingFfmpeg ? 'Installing...' : 'Install FFmpeg'}
                </button>
              )}
            </div>

            {!ffmpegInstalled && ffmpegInstalled !== null && (
              <p style={{ margin: '8px 0 0 0', fontSize: '10px', color: '#64748b' }}>
                FFmpeg will be installed via Windows Package Manager (winget). A terminal window will open to show progress.
              </p>
            )}
          </div>

          {/* Dependencies Section */}
          <div style={{ background: '#0f172a', padding: '12px', borderRadius: '6px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ margin: 0, fontSize: '12px', color: '#cbd5e1' }}>
                Python Packages {checkingDeps && <span style={{ color: '#64748b' }}>(checking...)</span>}
              </h4>
              <button
                onClick={installMissing}
                disabled={installingDeps || !selectedVenv || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)}
                style={{
                  ...buttonStyle,
                  padding: '6px 12px',
                  fontSize: '11px',
                  background: (installingDeps || !selectedVenv || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)) ? '#334155' : '#0891b2',
                  opacity: (installingDeps || !selectedVenv || REQUIRED_PACKAGES.every(p => depsStatus[p]?.installed)) ? 0.5 : 1,
                }}
              >
                {installingDeps ? 'Installing...' : 'Install All'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {REQUIRED_PACKAGES.map(pkg => {
                const st = depsStatus[pkg];
                const isInstalled = st?.installed;
                return (
                  <div
                    key={pkg}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      background: isInstalled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      border: isInstalled ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                    }}
                  >
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: isInstalled ? '#22c55e' : '#ef4444',
                      }}
                    />
                    <span style={{ color: '#f1f5f9', fontFamily: 'monospace' }}>{pkg}</span>
                    {st?.version && <span style={{ color: '#94a3b8', fontSize: '10px' }}>{st.version}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Server Connection */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px' }}>Venv:</span>
          <select
            value={selectedVenv}
            onChange={e => setSelectedVenv(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #444', borderRadius: '4px', background: '#2a2a2a', color: '#fff', fontSize: '13px' }}
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
          <span style={{ fontSize: '13px' }}>Port:</span>
          <input
            type="number"
            value={serverPort}
            onChange={e => setServerPort(parseInt(e.target.value) || 8766)}
            style={{ padding: '6px 10px', border: '1px solid #444', borderRadius: '4px', background: '#2a2a2a', color: '#fff', fontSize: '13px', width: '70px' }}
            disabled={serverRunning}
          />
          {!serverRunning ? (
            <button onClick={startServer} disabled={connecting} style={buttonStyle}>
              {connecting ? 'Connecting...' : 'Start Server'}
            </button>
          ) : (
            <>
              <span style={{ color: '#2ecc71', fontSize: '13px' }}>Connected</span>
              <button onClick={stopServer} style={{ ...buttonStyle, background: '#e74c3c', marginLeft: '8px' }}>
                Stop
              </button>
            </>
          )}
        </div>

        {serverStatus && (
          <div style={{ fontSize: '11px', color: '#888' }}>
            <span>FFmpeg: {serverStatus.ffmpeg_available ? 'Available' : 'Not found'}</span>
            <span style={{ marginLeft: '15px' }}>FFprobe: {serverStatus.ffprobe_available ? 'Available' : 'Not found'}</span>
          </div>
        )}
      </div>

      {/* Two-Column Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px',
        flex: 1,
        minHeight: 0,
        marginBottom: '10px',
      }}>
        {/* ==================== LEFT COLUMN - Source/Edit ==================== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' }}>

          {/* Imported Video Section */}
          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ margin: 0, fontSize: '13px', color: '#3498db' }}>Imported Video</h4>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={loadVideo} style={{ ...buttonStyle, padding: '4px 10px', fontSize: '11px' }}>
                  Load
                </button>
                <button onClick={loadMultipleVideos} style={{ ...buttonStyle, padding: '4px 10px', fontSize: '11px', background: '#8e44ad' }}>
                  Load Multiple
                </button>
              </div>
            </div>

            <span style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '8px' }}>
              {currentClip ? currentClip.name : 'No video loaded'}
              {clips.length > 1 && ` (${clips.length} clips in library)`}
            </span>

            {/* Imported Video Player */}
            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <div style={{ background: '#000', borderRadius: '4px', overflow: 'hidden', height: `${importedPlayerHeight}px` }}>
                <video
                  ref={importedVideoRef}
                  onTimeUpdate={handleImportedTimeUpdate}
                  onSeeked={handleImportedSeeked}
                  onLoadedMetadata={handleImportedLoadedMetadata}
                  onEnded={handleImportedVideoEnded}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              </div>
              {/* Resize handle */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '8px',
                  background: isResizingImported ? '#3498db' : 'transparent',
                  cursor: 'ns-resize',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizingImported(true);
                  const startY = e.clientY;
                  const startHeight = importedPlayerHeight;

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const delta = moveEvent.clientY - startY;
                    const newHeight = Math.max(100, Math.min(500, startHeight + delta));
                    setImportedPlayerHeight(newHeight);
                  };

                  const handleMouseUp = () => {
                    setIsResizingImported(false);
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                  };

                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                }}
              >
                <div style={{ width: '40px', height: '4px', background: '#666', borderRadius: '2px' }} />
              </div>
            </div>

            {/* Imported Playback Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <button onClick={toggleImportedPlayPause} style={{ ...buttonStyle, padding: '4px 10px', fontSize: '11px', background: importedIsPlaying ? '#e74c3c' : '#27ae60' }} disabled={!currentClip}>
                {importedIsPlaying ? 'Pause' : 'Play'}
              </button>
              <span style={{ fontSize: '11px', color: '#888' }}>
                {formatTime(importedCurrentTime)} / {formatTime(importedDuration)}
              </span>
              <input
                type="range"
                min={0}
                max={importedDuration}
                step={0.1}
                value={importedCurrentTime}
                onChange={e => seekImportedTo(parseFloat(e.target.value))}
                style={{ flex: 1 }}
                disabled={!currentClip}
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={importedVolume}
                onChange={e => handleImportedVolumeChange(parseFloat(e.target.value))}
                style={{ width: '50px' }}
                title="Volume"
              />
            </div>

            {/* Trim Controls - Set trim points from imported video */}
            <div style={{ background: '#252525', padding: '10px', borderRadius: '4px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: '#888', width: '40px' }}>Start:</span>
                <input
                  type="number"
                  value={trimStart.toFixed(2)}
                  onChange={e => setTrimStart(parseFloat(e.target.value) || 0)}
                  step={0.1}
                  min={0}
                  max={importedDuration}
                  style={{ padding: '4px 8px', border: '1px solid #444', borderRadius: '4px', background: '#2a2a2a', color: '#fff', fontSize: '11px', width: '70px' }}
                  disabled={!currentClip}
                />
                <button onClick={setTrimStartToCurrent} style={{ ...buttonStyle, padding: '3px 8px', fontSize: '10px' }} disabled={!currentClip}>
                  Set to Current
                </button>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: '#888', width: '40px' }}>End:</span>
                <input
                  type="number"
                  value={trimEnd.toFixed(2)}
                  onChange={e => setTrimEnd(parseFloat(e.target.value) || 0)}
                  step={0.1}
                  min={0}
                  max={importedDuration}
                  style={{ padding: '4px 8px', border: '1px solid #444', borderRadius: '4px', background: '#2a2a2a', color: '#fff', fontSize: '11px', width: '70px' }}
                  disabled={!currentClip}
                />
                <button onClick={setTrimEndToCurrent} style={{ ...buttonStyle, padding: '3px 8px', fontSize: '10px' }} disabled={!currentClip}>
                  Set to Current
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#888' }}>
                  Duration: {(trimEnd - trimStart).toFixed(2)}s
                </span>
                <button onClick={addToTimeline} style={{ ...buttonStyle, padding: '4px 12px', fontSize: '11px', background: '#9b59b6' }} disabled={!currentClip || trimEnd <= trimStart}>
                  Add to Timeline
                </button>
              </div>
            </div>
          </div>

          {/* Trimmed Section */}
          <div style={sectionStyle}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#9b59b6' }}>Trimmed Preview</h4>

            {/* Trimmed Video Player */}
            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <div style={{ background: '#000', borderRadius: '4px', overflow: 'hidden', height: `${trimmedPlayerHeight}px` }}>
                <video
                  ref={trimmedVideoRef}
                  onTimeUpdate={handleTrimmedTimeUpdate}
                  onEnded={handleTrimmedVideoEnded}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              </div>
              {/* Resize handle */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '8px',
                  background: isResizingTrimmed ? '#9b59b6' : 'transparent',
                  cursor: 'ns-resize',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizingTrimmed(true);
                  const startY = e.clientY;
                  const startHeight = trimmedPlayerHeight;

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const delta = moveEvent.clientY - startY;
                    const newHeight = Math.max(100, Math.min(400, startHeight + delta));
                    setTrimmedPlayerHeight(newHeight);
                  };

                  const handleMouseUp = () => {
                    setIsResizingTrimmed(false);
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                  };

                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                }}
              >
                <div style={{ width: '40px', height: '4px', background: '#666', borderRadius: '2px' }} />
              </div>
            </div>

            {/* Trimmed Playback Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={toggleTrimmedPlayPause} style={{ ...buttonStyle, padding: '4px 10px', fontSize: '11px', background: trimmedIsPlaying ? '#e74c3c' : '#27ae60' }} disabled={!currentClip}>
                {trimmedIsPlaying ? 'Pause' : 'Play'}
              </button>
              <span style={{ fontSize: '11px', color: '#888' }}>
                {formatTime(trimmedCurrentTime - trimStart)} / {formatTime(trimEnd - trimStart)}
              </span>
              <input
                type="range"
                min={trimStart}
                max={trimEnd}
                step={0.1}
                value={trimmedCurrentTime}
                onChange={e => seekTrimmedTo(parseFloat(e.target.value))}
                style={{ flex: 1 }}
                disabled={!currentClip}
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={trimmedVolume}
                onChange={e => handleTrimmedVolumeChange(parseFloat(e.target.value))}
                style={{ width: '50px' }}
                title="Volume"
              />
            </div>
          </div>

          {/* Clip Library */}
          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '13px' }}>Clip Library ({clips.length})</h4>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {clips.length > 0 && serverRunning && (
                  <button
                    onClick={() => {
                      clips.filter(c => !c.loudness && !c.loudnessLoading && !c.loudnessError).forEach(c => {
                        measureClipLoudness(c.id);
                      });
                    }}
                    style={{ ...buttonStyle, padding: '3px 8px', fontSize: '10px', background: '#8e44ad' }}
                    disabled={clips.every(c => c.loudness || c.loudnessLoading || c.loudnessError)}
                    title="Analyze loudness for all clips"
                  >
                    Analyze All
                  </button>
                )}
                {clips.length > 0 && (
                  <span style={{ fontSize: '10px', color: '#666' }}>Click to select</span>
                )}
              </div>
            </div>
            <div style={{ maxHeight: '200px', overflow: 'auto', background: '#252525', borderRadius: '4px', padding: clips.length > 0 ? '8px' : '0' }}>
              {clips.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#666', textAlign: 'center', padding: '20px' }}>
                  No clips loaded. Use "Load" or "Load Multiple" above.
                </div>
              ) : (
                clips.map((clip) => {
                  const isSelected = currentClip?.id === clip.id;
                  const isUsedInTimeline = timeline.some(seg => seg.clipId === clip.id);
                  return (
                    <div
                      key={clip.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '4px',
                        marginBottom: '4px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        background: isSelected ? '#2d3748' : '#1a1a1a',
                        border: isSelected ? '1px solid #3498db' : '1px solid transparent',
                      }}
                    >
                      {/* Top row: name and duration */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span
                          onClick={() => {
                            setSelectedClipId(clip.id);
                            setCurrentClip(clip);
                          }}
                          style={{
                            flex: 1,
                            color: isSelected ? '#fff' : '#888',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={clip.name}
                        >
                          {isSelected && '▶ '}{clip.name} ({clip.duration.toFixed(1)}s)
                          {isUsedInTimeline && <span style={{ color: '#9b59b6', marginLeft: '4px' }}>●</span>}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeClipFromLibrary(clip.id);
                          }}
                          style={{
                            ...buttonStyle,
                            padding: '2px 6px',
                            fontSize: '9px',
                            background: isUsedInTimeline ? '#666' : '#e74c3c',
                            marginLeft: '6px',
                            opacity: isUsedInTimeline ? 0.5 : 1,
                          }}
                          disabled={isUsedInTimeline}
                          title={isUsedInTimeline ? 'Cannot remove - used in timeline' : 'Remove from library'}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Bottom row: loudness info */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '4px',
                        paddingTop: '4px',
                        borderTop: '1px solid #333'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {clip.loudnessLoading ? (
                            <span style={{ color: '#888', fontSize: '10px' }}>Analyzing...</span>
                          ) : clip.loudnessError ? (
                            <span style={{ color: '#e74c3c', fontSize: '10px' }} title={clip.loudnessError}>
                              {clip.loudnessError === 'No audio track' ? 'No audio' : 'Error'}
                            </span>
                          ) : clip.loudness ? (
                            <>
                              <span style={{
                                color: getLoudnessColor(clip.loudness.integratedLoudness),
                                fontSize: '10px',
                                fontWeight: 'bold'
                              }}>
                                {formatLoudness(clip.loudness.integratedLoudness)}
                              </span>
                              {clip.loudness.truePeak !== null && (
                                <span style={{ color: '#666', fontSize: '9px' }} title="True Peak">
                                  TP: {clip.loudness.truePeak.toFixed(1)} dB
                                </span>
                              )}
                            </>
                          ) : (
                            <span style={{ color: '#666', fontSize: '10px' }}>--</span>
                          )}
                        </div>

                        {serverRunning && !clip.loudness && !clip.loudnessLoading && !clip.loudnessError && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              measureClipLoudness(clip.id);
                            }}
                            style={{
                              ...buttonStyle,
                              padding: '2px 8px',
                              fontSize: '9px',
                              background: '#2980b9',
                            }}
                          >
                            Analyze
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ==================== RIGHT COLUMN - Output ==================== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' }}>

          {/* Timeline Player */}
          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ margin: 0, fontSize: '13px', color: '#27ae60' }}>Timeline Preview</h4>
              {isPlayingTimeline && (
                <button
                  onClick={stopTimelinePlayback}
                  style={{ ...buttonStyle, padding: '3px 8px', fontSize: '10px', background: '#e74c3c' }}
                  title="Stop and reset to beginning"
                >
                  Stop
                </button>
              )}
            </div>

            {/* Timeline Video Player */}
            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <div style={{ background: '#000', borderRadius: '4px', overflow: 'hidden', height: `${timelinePlayerHeight}px` }}>
                <video
                  ref={timelineVideoRef}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
                {timeline.length === 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666',
                    fontSize: '12px',
                  }}>
                    Add segments to preview timeline
                  </div>
                )}
              </div>
              {/* Resize handle */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '8px',
                  background: isResizingTimeline ? '#27ae60' : 'transparent',
                  cursor: 'ns-resize',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizingTimeline(true);
                  const startY = e.clientY;
                  const startHeight = timelinePlayerHeight;

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const delta = moveEvent.clientY - startY;
                    const newHeight = Math.max(150, Math.min(600, startHeight + delta));
                    setTimelinePlayerHeight(newHeight);
                  };

                  const handleMouseUp = () => {
                    setIsResizingTimeline(false);
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                  };

                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                }}
              >
                <div style={{ width: '40px', height: '4px', background: '#666', borderRadius: '2px' }} />
              </div>
            </div>

            {/* Timeline Playback Controls */}
            {timeline.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={toggleTimelinePlayPause}
                  style={{
                    ...buttonStyle,
                    padding: '4px 10px',
                    fontSize: '11px',
                    background: isPlayingTimeline ? '#e74c3c' : '#27ae60'
                  }}
                >
                  {isPlayingTimeline ? 'Pause' : 'Play'}
                </button>
                <span style={{ fontSize: '11px', color: '#888', minWidth: '80px' }}>
                  {formatTime(timelinePlaybackTime)} / {formatTime(getTimelineDuration())}
                </span>
                <input
                  type="range"
                  min={0}
                  max={getTimelineDuration()}
                  step={0.1}
                  value={timelinePlaybackTime}
                  onChange={e => {
                    const wasPlaying = isPlayingTimeline;
                    if (wasPlaying) {
                      timelineVideoRef.current?.pause();
                      setIsPlayingTimeline(false);
                    }
                    seekTimelineTo(parseFloat(e.target.value));
                  }}
                  style={{ flex: 1 }}
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={timelineVolume}
                  onChange={e => handleTimelineVolumeChange(parseFloat(e.target.value))}
                  style={{ width: '50px' }}
                  title="Volume"
                />
              </div>
            )}
            {timeline.length > 0 && (
              <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                Segment {currentSegmentIndex + 1}/{timeline.length}
              </div>
            )}
          </div>

          {/* Timeline Segments */}
          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '13px' }}>Timeline Segments ({timeline.length})</h4>
              <button onClick={clearTimeline} style={{ ...buttonStyle, padding: '3px 8px', fontSize: '10px', background: '#666' }} disabled={timeline.length === 0 || isPlayingTimeline}>
                Clear All
              </button>
            </div>

            <div style={{ background: '#252525', borderRadius: '4px', padding: '8px', maxHeight: '200px', overflow: 'auto' }}>
              {timeline.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#666', textAlign: 'center', padding: '20px' }}>
                  No segments. Add trimmed sections from the left panel.
                </div>
              ) : (
                timeline.map((seg, index) => {
                  const clip = clips.find(c => c.id === seg.clipId);
                  const isCurrentlyPlaying = isPlayingTimeline && index === currentSegmentIndex;
                  return (
                    <div
                      key={index}
                      style={{
                        background: isCurrentlyPlaying ? '#1a3d2a' : '#1a1a1a',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        marginBottom: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '11px',
                        border: isCurrentlyPlaying ? '1px solid #27ae60' : '1px solid transparent',
                      }}
                    >
                      <span
                        style={{
                          color: isCurrentlyPlaying ? '#68d391' : '#888',
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={`${clip?.name} [${seg.clipStart.toFixed(2)}s - ${seg.clipEnd.toFixed(2)}s]`}
                      >
                        {isCurrentlyPlaying && '▶ '}{index + 1}. {clip?.name} [{seg.clipStart.toFixed(2)}s - {seg.clipEnd.toFixed(2)}s]
                      </span>
                      <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
                        <button
                          onClick={() => loadSegmentToEditor(index)}
                          style={{ ...buttonStyle, padding: '2px 8px', fontSize: '10px', background: '#3498db' }}
                          disabled={isPlayingTimeline}
                          title="Load segment into editor"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeFromTimeline(index)}
                          style={{ ...buttonStyle, padding: '2px 8px', fontSize: '10px', background: '#e74c3c' }}
                          disabled={isPlayingTimeline}
                          title="Remove from timeline"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Export Controls */}
          <div style={sectionStyle}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '13px' }}>Export</h4>
            <button
              onClick={exportVideo}
              style={{
                ...buttonStyle,
                width: '100%',
                padding: '10px',
                background: (!serverRunning || timeline.length === 0 || processing) ? '#666' : '#27ae60',
                opacity: (!serverRunning || timeline.length === 0 || processing) ? 0.5 : 1
              }}
              disabled={!serverRunning || timeline.length === 0 || processing}
              title={!serverRunning ? 'Server must be running to export' : ''}
            >
              {processing ? `Exporting... ${progress}%` : 'Export Video'}
            </button>
            {!serverRunning && (
              <p style={{ margin: '8px 0 0 0', fontSize: '10px', color: '#888' }}>
                Start the Python server to enable export
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Logs */}
      <div style={{ position: 'relative', background: '#0d0d0d', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: `${logsHeight}px`, minHeight: '80px', flexShrink: 0 }}>
        {/* Resize handle at top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '8px',
            background: isResizingLogs ? '#3498db' : 'transparent',
            cursor: 'ns-resize',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingLogs(true);
            const startY = e.clientY;
            const startHeight = logsHeight;

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const delta = startY - moveEvent.clientY;
              const newHeight = Math.max(80, Math.min(500, startHeight + delta));
              setLogsHeight(newHeight);
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
          <div style={{
            width: '40px',
            height: '4px',
            background: '#666',
            borderRadius: '2px',
          }} />
        </div>
        <div style={{ padding: '6px 10px', paddingTop: '12px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '11px', color: '#666' }}>Logs</span>
          <button onClick={() => setLogs([])} style={{ background: 'none', border: 'none', color: '#666', fontSize: '10px', cursor: 'pointer' }}>
            Clear
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px', fontSize: '11px', fontFamily: 'monospace' }}>
          {logs.map((log, i) => (
            <div key={i} style={{ color: log.includes('ERROR') ? '#e74c3c' : log.includes('Exported') ? '#2ecc71' : '#888' }}>
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
