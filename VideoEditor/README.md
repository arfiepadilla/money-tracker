# Video Editor Workflow

A dynamic workflow for Context UI that provides video playback and basic editing capabilities using FFmpeg.

## Features

- **Instant Video Playback**: Load and play videos immediately using HTML5 (no server needed!)
- **Trimming**: Select start and end points to trim video segments
- **Timeline Editor**: Build a sequence by adding multiple trimmed segments
- **Export**: Concatenate all timeline segments into a single output video using FFmpeg
- **Real-time Preview**: Preview your edits in the browser before exporting
- **Server-Free Editing**: All playback and preview happens in the browser; Python/FFmpeg only needed for final export

## Prerequisites

### 1. FFmpeg Installation

This workflow requires FFmpeg to be installed on your system:

**Windows:**
```bash
# Using Chocolatey
choco install ffmpeg

# Or download from: https://ffmpeg.org/download.html
# Add to PATH after installation
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt install ffmpeg  # Debian/Ubuntu
sudo yum install ffmpeg  # CentOS/RHEL
```

Verify installation:
```bash
ffmpeg -version
ffprobe -version
```

### 2. Python Dependencies

Create a virtual environment and install required packages:

```bash
# From Python Manager in Context UI, or manually:
pip install fastapi uvicorn
```

## How to Use

### 1. Load and Preview Videos (No Server Required!)

1. Launch the Video Editor workflow from the Workflow Browser
2. Click "Load Video" (server not needed for playback!)
3. Select a video file from your system
4. The video will appear in the preview player immediately
5. Use playback controls to watch and navigate the video

### 2. Trim a Segment

1. Play the video and find the section you want to keep
2. Click "Set to Current" for the start time at your desired start point
3. Seek to the end point and click "Set to Current" for the end time
4. Or manually enter start/end times in seconds
5. Click "Add to Timeline"

### 3. Build Your Timeline

1. Load additional videos or use different sections of the same video
2. Trim and add segments to the timeline
3. Segments will be concatenated in the order they appear
4. Use "Remove" to delete unwanted segments
5. Use "Clear" to start over

### 4. Export (Server Required)

When you're ready to export your final video:

1. **Start the Python server**:
   - Select a Python virtual environment
   - Ensure dependencies are installed (fastapi, uvicorn)
   - Click "Start Server" and wait for "Connected" status

2. **Export your video**:
   - Click "Export Video" (requires server to be running)
   - Choose a save location (MP4 format)
   - Wait for FFmpeg to process and concatenate your segments
   - Your exported video will be saved to the selected location

**Note**: The server is only needed for the export step. All video playback, trimming, and timeline editing happens in the browser!

## Technical Details

### File Structure

```
VideoEditor/
├── VideoEditorWindow.tsx       # React UI component
├── video_editor_server.py      # Python/FastAPI backend
└── README.md                   # This file
```

### How It Works

1. **Frontend (React)**:
   - Uses HTML5 `<video>` element for instant video playback (no server needed)
   - Extracts video metadata directly from the video file in the browser
   - Provides UI for trimming controls and timeline management
   - All preview and editing happens client-side

2. **Backend (Python/FFmpeg)**: Only used for export operations
   - `ffmpeg`: Extracts trimmed segments and concatenates them into final output
   - Handles re-encoding for compatibility across different video formats

### Video Processing

- **Segment Extraction**: Each timeline segment is extracted using `ffmpeg` with re-encoding to ensure compatibility
- **Concatenation**: Segments are joined using FFmpeg's concat demuxer
- **Codecs**: Output uses H.264 video (libx264) and AAC audio for broad compatibility

### Storage Paths

The workflow uses ContextUI environment variables for file storage:

- **Temp files**: `CONTEXTUI_CACHE_PATH/VideoEditor/temp/`
- **Exported videos**: User-selected location via save dialog

## Tips

- **For faster trimming**: Keep segments on the same video file to minimize processing
- **Re-encoding**: The export process re-encodes video to ensure all segments are compatible
- **Large files**: Processing time depends on video length and system performance
- **Quality**: Medium preset balances quality and speed; segments are re-encoded during export

## Troubleshooting

### "FFmpeg not available"
- Ensure FFmpeg is installed and in your system PATH
- Restart the server after installing FFmpeg

### "Server failed to start"
- Check that fastapi and uvicorn are installed in your virtual environment
- Verify the port (8766) is not already in use

### "Export failed"
- Check the logs for detailed FFmpeg error messages
- Ensure you have write permissions to the output directory
- Verify input video files still exist at their original paths

### Video won't play
- The frontend uses HTML5 video player which may have codec limitations
- For editing, the backend handles all processing via FFmpeg
- Some codecs may not preview but will still export correctly

## Future Enhancements

Possible improvements for this workflow:

- Add video filters (brightness, contrast, saturation)
- Include transitions between segments
- Support for multiple video/audio tracks
- Add text overlays and subtitles
- Implement thumbnail previews in timeline
- Add audio volume adjustment per segment
- Support for more output formats and quality presets

## Dependencies

**Python packages:**
- `fastapi` - Web framework for the API
- `uvicorn` - ASGI server
- `pydantic` - Data validation

**System requirements:**
- `ffmpeg` - Video processing
- `ffprobe` - Video metadata extraction

## License

This workflow is part of the Context UI example modules.
