"""
Video Editor Server
Uses FFmpeg for video processing operations
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import subprocess
import json
import tempfile
import shutil
import re
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel

app = FastAPI(title="Video Editor Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# User Paths (from ContextUI environment variables)
# ============================================

def get_temp_dir() -> str:
    """Get temporary directory for video processing."""
    env_path = os.environ.get('CONTEXTUI_CACHE_PATH')
    if env_path:
        temp_dir = os.path.join(env_path, "VideoEditor", "temp")
    else:
        temp_dir = os.path.join(tempfile.gettempdir(), "VideoEditor")

    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir


def get_output_dir() -> str:
    """Get output directory for exported videos."""
    env_path = os.environ.get('CONTEXTUI_GENERATED_PATH')
    if env_path:
        output_dir = os.path.join(env_path, "VideoEditor")
    else:
        output_dir = os.path.join(os.path.dirname(__file__), "output")

    os.makedirs(output_dir, exist_ok=True)
    return output_dir


# ============================================
# FFmpeg helpers
# ============================================

# Cache for FFmpeg paths
_ffmpeg_path: str | None = None
_ffprobe_path: str | None = None


def _get_system_path() -> str:
    """Get the full system PATH from Windows registry (not just inherited env)."""
    try:
        import winreg
        # Get system PATH
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Control\Session Manager\Environment') as key:
            system_path = winreg.QueryValueEx(key, 'Path')[0]
        # Get user PATH
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Environment') as key:
            user_path = winreg.QueryValueEx(key, 'Path')[0]
        return f"{system_path};{user_path}"
    except Exception:
        return os.environ.get('PATH', '')


def find_ffmpeg() -> str | None:
    """Find FFmpeg executable, checking common locations on Windows."""
    global _ffmpeg_path
    if _ffmpeg_path is not None:
        return _ffmpeg_path if _ffmpeg_path else None

    # First try PATH
    try:
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        _ffmpeg_path = 'ffmpeg'
        return _ffmpeg_path
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Try using 'where' command with full system PATH
    try:
        full_path = _get_system_path()
        env = os.environ.copy()
        env['PATH'] = full_path
        result = subprocess.run(['where', 'ffmpeg'], capture_output=True, text=True, check=True, env=env)
        ffmpeg_path = result.stdout.strip().split('\n')[0].strip()
        if ffmpeg_path and os.path.exists(ffmpeg_path):
            _ffmpeg_path = ffmpeg_path
            return _ffmpeg_path
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Check common Windows locations
    common_locations = [
        r'C:\ffmpeg\bin\ffmpeg.exe',
        r'C:\Program Files\ffmpeg\bin\ffmpeg.exe',
        r'C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Programs\ffmpeg\bin\ffmpeg.exe'),
        os.path.expandvars(r'%USERPROFILE%\scoop\apps\ffmpeg\current\bin\ffmpeg.exe'),
        os.path.expandvars(r'%ProgramData%\chocolatey\bin\ffmpeg.exe'),
        # WinGet installs ffmpeg here
        os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe'),
        os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-7.1.1-full_build\bin\ffmpeg.exe'),
    ]

    for loc in common_locations:
        if os.path.exists(loc):
            try:
                subprocess.run([loc, '-version'], capture_output=True, check=True)
                _ffmpeg_path = loc
                return _ffmpeg_path
            except (subprocess.CalledProcessError, FileNotFoundError):
                pass

    _ffmpeg_path = ''  # Mark as checked but not found
    return None


def find_ffprobe() -> str | None:
    """Find FFprobe executable, checking common locations on Windows."""
    global _ffprobe_path
    if _ffprobe_path is not None:
        return _ffprobe_path if _ffprobe_path else None

    # First try PATH
    try:
        result = subprocess.run(['ffprobe', '-version'], capture_output=True, check=True)
        _ffprobe_path = 'ffprobe'
        return _ffprobe_path
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Try using 'where' command with full system PATH
    try:
        full_path = _get_system_path()
        env = os.environ.copy()
        env['PATH'] = full_path
        result = subprocess.run(['where', 'ffprobe'], capture_output=True, text=True, check=True, env=env)
        ffprobe_path = result.stdout.strip().split('\n')[0].strip()
        if ffprobe_path and os.path.exists(ffprobe_path):
            _ffprobe_path = ffprobe_path
            return _ffprobe_path
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Check common Windows locations
    common_locations = [
        r'C:\ffmpeg\bin\ffprobe.exe',
        r'C:\Program Files\ffmpeg\bin\ffprobe.exe',
        r'C:\Program Files (x86)\ffmpeg\bin\ffprobe.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Programs\ffmpeg\bin\ffprobe.exe'),
        os.path.expandvars(r'%USERPROFILE%\scoop\apps\ffmpeg\current\bin\ffprobe.exe'),
        os.path.expandvars(r'%ProgramData%\chocolatey\bin\ffprobe.exe'),
        # WinGet installs ffprobe here
        os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Links\ffprobe.exe'),
        os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-7.1.1-full_build\bin\ffprobe.exe'),
    ]

    for loc in common_locations:
        if os.path.exists(loc):
            try:
                subprocess.run([loc, '-version'], capture_output=True, check=True)
                _ffprobe_path = loc
                return _ffprobe_path
            except (subprocess.CalledProcessError, FileNotFoundError):
                pass

    _ffprobe_path = ''  # Mark as checked but not found
    return None


def check_ffmpeg() -> bool:
    """Check if FFmpeg is available."""
    return find_ffmpeg() is not None


def check_ffprobe() -> bool:
    """Check if FFprobe is available."""
    return find_ffprobe() is not None


def get_video_duration(file_path: str) -> float:
    """Get video duration using ffprobe."""
    ffprobe = find_ffprobe()
    if not ffprobe:
        raise HTTPException(status_code=500, detail="FFprobe not available")
    try:
        cmd = [
            ffprobe,
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'json',
            file_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        return float(data['format']['duration'])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get video duration: {str(e)}")


def get_video_info(file_path: str) -> dict:
    """Get comprehensive video information using ffprobe."""
    ffprobe = find_ffprobe()
    if not ffprobe:
        raise HTTPException(status_code=500, detail="FFprobe not available")
    try:
        cmd = [
            ffprobe,
            '-v', 'error',
            '-show_entries', 'format=duration,size,bit_rate:stream=width,height,codec_name,codec_type',
            '-of', 'json',
            file_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)

        video_stream = next((s for s in data.get('streams', []) if s.get('codec_type') == 'video'), None)

        return {
            'duration': float(data['format'].get('duration', 0)),
            'size': int(data['format'].get('size', 0)),
            'bit_rate': int(data['format'].get('bit_rate', 0)),
            'width': video_stream.get('width', 0) if video_stream else 0,
            'height': video_stream.get('height', 0) if video_stream else 0,
            'video_codec': video_stream.get('codec_name', 'unknown') if video_stream else 'unknown',
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get video info: {str(e)}")


def parse_ebur128_output(stderr: str) -> dict:
    """
    Parse FFmpeg ebur128 filter output to extract loudness values.

    The ebur128 filter outputs a summary at the end like:
    [Parsed_ebur128_0 @ ...] Summary:
      Integrated loudness:
        I:         -16.0 LUFS
        Threshold: -26.0 LUFS
      Loudness range:
        LRA:        10.5 LU
        Threshold: -36.0 LUFS
        LRA low:   -22.0 LUFS
        LRA high:  -11.5 LUFS
      True peak:
        Peak:       -1.2 dBFS
    """
    result = {
        'integrated_loudness': None,
        'loudness_range': None,
        'true_peak': None,
        'has_audio': False
    }

    # Pattern for integrated loudness
    i_match = re.search(r'I:\s+(-?\d+\.?\d*)\s+LUFS', stderr)
    if i_match:
        result['integrated_loudness'] = float(i_match.group(1))
        result['has_audio'] = True

    # Pattern for loudness range
    lra_match = re.search(r'LRA:\s+(-?\d+\.?\d*)\s+LU', stderr)
    if lra_match:
        result['loudness_range'] = float(lra_match.group(1))

    # Pattern for true peak
    peak_match = re.search(r'Peak:\s+(-?\d+\.?\d*)\s+dBFS', stderr)
    if peak_match:
        result['true_peak'] = float(peak_match.group(1))

    return result


def measure_loudness(file_path: str) -> dict:
    """
    Measure audio loudness using FFmpeg's ebur128 filter.
    Returns LUFS values according to EBU R128 standard.
    """
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="FFmpeg not available")

    try:
        # Use ebur128 filter to measure loudness
        cmd = [
            ffmpeg,
            '-i', file_path,
            '-af', 'ebur128=framelog=verbose',
            '-f', 'null',
            '-'
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout for long videos
        )

        # Parse the output from stderr (ffmpeg outputs stats to stderr)
        stderr = result.stderr
        loudness_data = parse_ebur128_output(stderr)

        return loudness_data

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Loudness measurement timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to measure loudness: {str(e)}")


# ============================================
# Request models
# ============================================

class VideoInfoRequest(BaseModel):
    file_path: str


class TranscodeRequest(BaseModel):
    file_path: str


class TrimRequest(BaseModel):
    file_path: str
    start: float
    end: float
    output_path: str


class VideoSegment(BaseModel):
    file_path: str
    start: float
    end: float


class ExportRequest(BaseModel):
    segments: List[VideoSegment]
    output_path: str


class LoudnessRequest(BaseModel):
    file_path: str


# ============================================
# API Routes
# ============================================

@app.get("/")
async def root():
    return {"status": "online", "service": "Video Editor Server"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/status")
async def status():
    return {
        "ffmpeg_available": check_ffmpeg(),
        "ffprobe_available": check_ffprobe(),
        "temp_dir": get_temp_dir(),
    }


@app.post("/get_video_info")
async def api_get_video_info(request: VideoInfoRequest):
    """Get video file information."""
    try:
        if not os.path.exists(request.file_path):
            return {"success": False, "error": "File not found"}

        info = get_video_info(request.file_path)
        return {"success": True, **info}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/measure_loudness")
async def api_measure_loudness(request: LoudnessRequest):
    """Measure audio loudness (LUFS) for a video file."""
    try:
        if not os.path.exists(request.file_path):
            return {"success": False, "error": "File not found"}

        if not check_ffmpeg():
            return {"success": False, "error": "FFmpeg not available"}

        loudness = measure_loudness(request.file_path)

        if not loudness['has_audio']:
            return {
                "success": True,
                "has_audio": False,
                "message": "Video has no audio track"
            }

        return {
            "success": True,
            "has_audio": True,
            "integrated_loudness": loudness['integrated_loudness'],
            "loudness_range": loudness['loudness_range'],
            "true_peak": loudness['true_peak']
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/transcode_for_preview")
async def transcode_for_preview(request: TranscodeRequest):
    """
    Transcode a video to browser-compatible H.264+AAC format.
    Returns path to transcoded file that can be loaded in browser.
    """
    try:
        if not check_ffmpeg():
            return {"success": False, "error": "FFmpeg not available"}

        if not os.path.exists(request.file_path):
            return {"success": False, "error": "File not found"}

        # Create a hash of the file path for caching
        import hashlib
        path_hash = hashlib.md5(request.file_path.encode()).hexdigest()[:12]
        file_name = os.path.basename(request.file_path)
        base_name = os.path.splitext(file_name)[0]

        temp_dir = get_temp_dir()
        output_path = os.path.join(temp_dir, f"{base_name}_{path_hash}_preview.mp4")

        # Check if already transcoded
        if os.path.exists(output_path):
            # Verify the cached file is valid
            try:
                info = get_video_info(output_path)
                return {
                    "success": True,
                    "transcoded_path": output_path,
                    "duration": info['duration'],
                    "cached": True
                }
            except:
                # Cached file is invalid, re-transcode
                os.remove(output_path)

        # Transcode to browser-compatible format
        # -movflags +faststart: enables progressive playback
        # -pix_fmt yuv420p: ensures compatibility
        # -preset fast: balance between speed and quality
        ffmpeg = find_ffmpeg()
        cmd = [
            ffmpeg,
            '-i', request.file_path,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-y',
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            return {"success": False, "error": f"FFmpeg transcode error: {result.stderr}"}

        # Get duration of transcoded file
        info = get_video_info(output_path)

        return {
            "success": True,
            "transcoded_path": output_path,
            "duration": info['duration'],
            "cached": False
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/trim_video")
async def trim_video(request: TrimRequest):
    """Trim a video segment."""
    try:
        if not check_ffmpeg():
            return {"success": False, "error": "FFmpeg not available"}

        if not os.path.exists(request.file_path):
            return {"success": False, "error": "Input file not found"}

        # Use ffmpeg to trim video
        ffmpeg = find_ffmpeg()
        cmd = [
            ffmpeg,
            '-i', request.file_path,
            '-ss', str(request.start),
            '-to', str(request.end),
            '-c', 'copy',  # Copy codec without re-encoding for speed
            '-y',  # Overwrite output file
            request.output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            return {"success": False, "error": f"FFmpeg error: {result.stderr}"}

        return {"success": True, "output_path": request.output_path}

    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/export_video")
async def export_video(request: ExportRequest):
    """Export video by concatenating multiple segments."""
    try:
        if not check_ffmpeg():
            return {"success": False, "error": "FFmpeg not available"}

        if len(request.segments) == 0:
            return {"success": False, "error": "No segments provided"}

        temp_dir = get_temp_dir()
        temp_files = []
        concat_list_file = os.path.join(temp_dir, f"concat_list_{os.getpid()}.txt")
        ffmpeg = find_ffmpeg()

        try:
            # Step 1: Extract each segment to a temp file
            for i, segment in enumerate(request.segments):
                if not os.path.exists(segment.file_path):
                    return {"success": False, "error": f"Segment file not found: {segment.file_path}"}

                temp_output = os.path.join(temp_dir, f"segment_{i}_{os.getpid()}.mp4")
                temp_files.append(temp_output)

                # Extract segment
                cmd = [
                    ffmpeg,
                    '-i', segment.file_path,
                    '-ss', str(segment.start),
                    '-to', str(segment.end),
                    '-c:v', 'libx264',  # Re-encode to ensure compatibility
                    '-c:a', 'aac',
                    '-preset', 'medium',
                    '-y',
                    temp_output
                ]

                result = subprocess.run(cmd, capture_output=True, text=True)

                if result.returncode != 0:
                    return {"success": False, "error": f"FFmpeg error extracting segment {i}: {result.stderr}"}

            # Step 2: Create concat list file
            with open(concat_list_file, 'w') as f:
                for temp_file in temp_files:
                    # FFmpeg concat requires paths to be properly escaped
                    escaped_path = temp_file.replace('\\', '/').replace("'", "'\\''")
                    f.write(f"file '{escaped_path}'\n")

            # Step 3: Concatenate all segments
            cmd = [
                ffmpeg,
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_list_file,
                '-c', 'copy',
                '-y',
                request.output_path
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                return {"success": False, "error": f"FFmpeg error concatenating: {result.stderr}"}

            return {"success": True, "output_path": request.output_path}

        finally:
            # Cleanup temp files
            for temp_file in temp_files:
                if os.path.exists(temp_file):
                    try:
                        os.remove(temp_file)
                    except:
                        pass

            if os.path.exists(concat_list_file):
                try:
                    os.remove(concat_list_file)
                except:
                    pass

    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/shutdown")
async def shutdown():
    """Shutdown the server."""
    import signal
    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "shutting down"}


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f"Starting Video Editor server on port {port}...")
    print(f"Temp directory: {get_temp_dir()}")
    print(f"Output directory: {get_output_dir()}")

    ffmpeg_path = find_ffmpeg()
    ffprobe_path = find_ffprobe()
    print(f"FFmpeg path: {ffmpeg_path or 'NOT FOUND'}")
    print(f"FFprobe path: {ffprobe_path or 'NOT FOUND'}")

    uvicorn.run(app, host="127.0.0.1", port=port)
