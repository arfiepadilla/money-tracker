# Model Manager IPC Handler Implementation Guide

## Overview

The Model Manager workflow now includes an **Offline Mode** feature that allows viewing downloaded models without starting the Python server. This requires implementing a new IPC handler in the Electron main process.

## Required IPC Handler

### Handler Name
`scan-models-directory`

### Purpose
Scans the filesystem for downloaded HuggingFace and SDXL models without requiring the Python server to be running.

### Implementation Location
This handler should be added to your Electron main process IPC handler registration file (where other handlers like `python-list-venvs`, `python-install-package`, etc. are registered).

## Full Implementation Code

```typescript
import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface ScannedModel {
  id: string;
  name: string;
  type: 'huggingface' | 'sdxl';
  size: number;
  size_formatted: string;
  path: string;
  filename?: string;
  last_used: string;
}

interface ScanModelsResult {
  success: boolean;
  models: ScannedModel[];
  error?: string;
  scanned_paths: {
    huggingface: string;
    sdxl: string;
  };
}

// Helper: Get directory size recursively
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return totalSize;
}

// Helper: Format bytes to human-readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// Helper: Scan HuggingFace models
async function scanHuggingFaceModels(cachePath: string): Promise<ScannedModel[]> {
  const models: ScannedModel[] = [];

  try {
    // Check if directory exists
    await fs.access(cachePath);
  } catch {
    console.log(`HuggingFace cache path does not exist: ${cachePath}`);
    return models;
  }

  try {
    const entries = await fs.readdir(cachePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('models--')) {
        // Parse model ID: "models--org--name" → "org/name"
        const modelId = entry.name
          .replace('models--', '')
          .replace(/--/g, '/');

        const modelPath = path.join(cachePath, entry.name);

        // Get size
        const size = await getDirectorySize(modelPath);

        // Get last modified time
        const stats = await fs.stat(modelPath);
        const lastUsed = new Date(stats.mtime).toISOString().split('T')[0];

        models.push({
          id: modelId,
          name: modelId.split('/').pop() || modelId,
          type: 'huggingface',
          size,
          size_formatted: formatBytes(size),
          path: modelPath,
          last_used: lastUsed
        });
      }
    }
  } catch (error) {
    console.error('Error scanning HuggingFace models:', error);
  }

  return models;
}

// Helper: Scan SDXL models
async function scanSDXLModels(sdxlPath: string): Promise<ScannedModel[]> {
  const models: ScannedModel[] = [];

  try {
    // Check if directory exists
    await fs.access(sdxlPath);
  } catch {
    console.log(`SDXL path does not exist: ${sdxlPath}`);
    return models;
  }

  try {
    const entries = await fs.readdir(sdxlPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.safetensors', '.ckpt', '.pt'].includes(ext)) {
          const modelPath = path.join(sdxlPath, entry.name);
          const stats = await fs.stat(modelPath);

          models.push({
            id: path.parse(entry.name).name,
            name: path.parse(entry.name).name,
            type: 'sdxl',
            size: stats.size,
            size_formatted: formatBytes(stats.size),
            path: modelPath,
            filename: entry.name,
            last_used: new Date(stats.mtime).toISOString().split('T')[0]
          });
        }
      }
    }
  } catch (error) {
    console.error('Error scanning SDXL models:', error);
  }

  return models;
}

// Main IPC Handler
ipcMain.handle('scan-models-directory', async (): Promise<ScanModelsResult> => {
  try {
    const models: ScannedModel[] = [];

    // 1. Get paths from environment or defaults
    const modelsBasePath = process.env.CONTEXTUI_MODELS_PATH;
    const hfPath = modelsBasePath
      ? path.join(modelsBasePath, 'huggingface')
      : path.join(os.homedir(), '.cache', 'huggingface', 'hub');
    const sdxlPath = modelsBasePath
      ? path.join(modelsBasePath, 'SDXL')
      : path.join(__dirname, '..', 'models', 'SDXL');

    // 2. Scan HuggingFace cache
    const hfModels = await scanHuggingFaceModels(hfPath);
    models.push(...hfModels);

    // 3. Scan SDXL models
    const sdxlModels = await scanSDXLModels(sdxlPath);
    models.push(...sdxlModels);

    console.log(`Scanned models: ${models.length} found`);

    return {
      success: true,
      models,
      scanned_paths: {
        huggingface: hfPath,
        sdxl: sdxlPath
      }
    };
  } catch (error) {
    console.error('Error in scan-models-directory handler:', error);
    return {
      success: false,
      models: [],
      error: error instanceof Error ? error.message : 'Unknown error',
      scanned_paths: {
        huggingface: '',
        sdxl: ''
      }
    };
  }
});
```

## Environment Variables

The handler uses the `CONTEXTUI_MODELS_PATH` environment variable to locate models:
- If set: Models are expected in `$CONTEXTUI_MODELS_PATH/huggingface` and `$CONTEXTUI_MODELS_PATH/SDXL`
- If not set: Defaults to:
  - HuggingFace: `~/.cache/huggingface/hub`
  - SDXL: `<app-root>/models/SDXL`

## Frontend Integration

The Model Manager workflow (ModelManagerWindow.tsx) has been updated to:

1. **Automatically scan on mount**: When the component loads and the server isn't running, it invokes `scan-models-directory`
2. **Display offline mode indicator**: Shows "Offline Mode" badge in header when models are found
3. **Disable server-dependent features**:
   - Catalog tab is disabled with "(Server Required)" label
   - Delete buttons are disabled
   - Info banner explains offline limitations
4. **Switch modes seamlessly**: When server starts, switches to full functionality automatically

## Testing the Implementation

### Test Scenario 1: App Opens Without Server
1. Open the Model Manager workflow
2. Don't start the Python server
3. Expected: "Offline Mode" indicator appears if models exist
4. Expected: "Downloaded" tab shows models from filesystem
5. Expected: "Catalog" tab is disabled

### Test Scenario 2: Start Server from Offline Mode
1. Start in offline mode (models visible)
2. Click "Start Server"
3. Expected: Switches to "Running" indicator
4. Expected: Catalog tab becomes enabled
5. Expected: Delete buttons become enabled
6. Expected: Can download new models

### Test Scenario 3: No Models Found
1. Clear model directories
2. Open workflow without server
3. Expected: "Offline" indicator (not "Offline Mode")
4. Expected: Empty state message: "No models detected in filesystem"

### Test Scenario 4: Error Handling
1. Set invalid `CONTEXTUI_MODELS_PATH`
2. Open workflow
3. Expected: Silently fails, no crash
4. Expected: Console warning logged

## Dependencies

No additional npm packages required. Uses Node.js built-ins:
- `fs/promises`
- `path`
- `os`

## Performance Considerations

- **Directory scanning is async**: UI remains responsive
- **Caching not implemented**: Scans on every component mount (when server not running)
- **Large model collections**: Should handle 100+ models without issues
- **Consider adding caching**: If performance becomes an issue with very large collections

## Security Considerations

- **File system access is read-only**: Handler only reads directory information
- **Path validation**: Uses standard Node.js path joining to prevent traversal
- **Error handling**: All filesystem operations wrapped in try-catch
- **No user input**: Paths are determined by environment variables, not user-supplied

## Future Enhancements

Potential improvements for future versions:
1. **Caching**: Cache scan results with timestamp, re-scan only if directory modified
2. **Incremental scanning**: Show models as they're found instead of waiting for complete scan
3. **Background refresh**: Periodically re-scan in background when in offline mode
4. **Model validation**: Verify model integrity (check for required files)
5. **Thumbnail generation**: Generate previews for SDXL models

## Troubleshooting

### Models not appearing in offline mode
- Check `CONTEXTUI_MODELS_PATH` environment variable
- Verify models exist in expected directories
- Check console for error messages
- Ensure HuggingFace models follow `models--org--name` naming convention

### Permission errors
- Ensure read permissions on model directories
- On Windows, check directory isn't locked by another process
- Try running with elevated permissions if necessary

### Performance issues
- Check model directory size (very large directories may be slow)
- Consider implementing caching
- Monitor memory usage with large model collections

## Support

For issues or questions about this implementation:
1. Check console logs for detailed error messages
2. Verify paths match expected structure
3. Test with a small number of models first
4. Ensure Node.js has filesystem access permissions
