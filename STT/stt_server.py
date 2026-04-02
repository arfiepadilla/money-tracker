"""
Speech-to-Text (STT) FastAPI Server
Provides endpoints for transcribing audio using Whisper and other STT models.
Supports real-time streaming and batch transcription.
"""

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uvicorn
import torch
import gc
import time
import os
import sys
import subprocess
import json
import base64
import wave
import io
import numpy as np
from pathlib import Path
from datetime import datetime

app = FastAPI(title="STT Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# User Paths (from ContextUI environment variables)
# Following the same pattern as VoiceAgent and MusicGen
# ============================================

def get_models_cache_path() -> Path:
    """Get HuggingFace models cache path from env var or fallback to default.
    This uses the same path as ModelManager so we don't duplicate downloads."""
    env_path = os.environ.get('CONTEXTUI_MODELS_PATH')
    if env_path:
        return Path(env_path) / "huggingface"
    # Fallback: use default HuggingFace cache
    hf_home = os.environ.get('HF_HOME', os.path.expanduser('~/.cache/huggingface'))
    return Path(hf_home) / "hub"


def get_generated_path() -> Path:
    """Get generated content path from env var."""
    env_path = os.environ.get('CONTEXTUI_GENERATED_PATH')
    if env_path:
        return Path(env_path)
    return Path.home() / "ContextUI" / "default" / "generated"


# ============================================
# Global State
# ============================================

# Model State
stt_model = None
stt_processor = None
stt_model_name = ""
stt_ready = False
stt_loading = False

# System State
models_cache = get_models_cache_path()
transcription_history: List[Dict[str, Any]] = []

# Required Python packages for STT
REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'torch', 'transformers', 'accelerate', 'huggingface_hub', 'numpy', 'soundfile', 'python-multipart', 'pydub', 'scipy']


def add_log(message: str):
    """Add timestamped log entry."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    print(entry)


# ============================================
# Utility Functions
# ============================================

def clear_cuda():
    """Best-effort VRAM release."""
    if not torch.cuda.is_available():
        return
    try:
        for i in range(torch.cuda.device_count()):
            with torch.cuda.device(i):
                torch.cuda.synchronize()
    except Exception:
        pass
    for _ in range(5):
        gc.collect()
    try:
        for device_id in range(torch.cuda.device_count()):
            with torch.cuda.device(device_id):
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
    except Exception as e:
        print(f"Warning during CUDA cleanup: {e}")


def get_vram_stats():
    """Get VRAM statistics."""
    if not torch.cuda.is_available():
        return None
    try:
        device = torch.cuda.current_device()
        free, total = torch.cuda.mem_get_info()
        allocated = torch.cuda.memory_allocated(device)
        return {
            "total": total,
            "free": free,
            "allocated": allocated,
            "used": total - free,
        }
    except Exception:
        return None


# ============================================
# Dependency Management (following SDXL pattern)
# ============================================

def run_pip_command(args: List[str], timeout: int = 600) -> Dict[str, Any]:
    """Run pip-related command using the server Python interpreter and return structured result."""
    try:
        proc = subprocess.run([sys.executable, "-m"] + args, capture_output=True, text=True, timeout=timeout)
        return {
            "returncode": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
        }
    except Exception as e:
        return {"returncode": -1, "stdout": "", "stderr": str(e)}


@app.get("/env/packages")
async def env_packages():
    """Return installed packages in this Python environment (pip list --format=json)."""
    res = run_pip_command(["pip", "list", "--format=json"])
    if res["returncode"] != 0:
        return {"success": False, "error": res.get("stderr", "Failed to list packages")}

    try:
        packages = json.loads(res["stdout"] or "[]")
    except Exception:
        packages = []

    return {"success": True, "packages": packages}


@app.post("/env/check_deps")
async def env_check_deps(packages: List[str]):
    """Check whether the listed packages are installed in this environment using `pip show`."""
    results: Dict[str, Dict[str, Any]] = {}
    for pkg in packages:
        r = run_pip_command(["pip", "show", pkg])
        installed = r.get("returncode", -1) == 0
        version = None
        if installed:
            for line in (r.get("stdout", "") or "").splitlines():
                if line.startswith("Version:"):
                    version = line.split(":", 1)[1].strip()
                    break

        results[pkg] = {"installed": installed, "version": version, "stdout": r.get("stdout", ""), "stderr": r.get("stderr", "")}

    return {"success": True, "results": results}


@app.post("/env/install_packages")
async def env_install_packages(packages: List[str]):
    """Install the requested packages in this environment using pip. Returns pip output."""
    if not packages:
        return {"success": False, "error": "No packages provided"}

    args = ["pip", "install"] + packages
    res = run_pip_command(args)
    if res.get("returncode", -1) == 0:
        return {"success": True, "stdout": res.get("stdout", "")}
    else:
        return {"success": False, "stdout": res.get("stdout", ""), "stderr": res.get("stderr", "")}


# ============================================
# Request/Response Models
# ============================================

class STTModelConfig(BaseModel):
    model_name: str = "openai/whisper-base"
    device: str = "auto"
    use_fp16: bool = True


class TranscribeRequest(BaseModel):
    audio_b64: str  # Base64 encoded audio
    sample_rate: int = 16000
    format: str = "wav"
    language: Optional[str] = None  # Auto-detect if None
    task: str = "transcribe"  # or "translate" (to English)
    return_timestamps: bool = False


class BatchTranscribeRequest(BaseModel):
    audio_files_b64: List[str]  # List of base64 encoded audio files
    sample_rate: int = 16000
    format: str = "wav"
    language: Optional[str] = None
    task: str = "transcribe"


# ============================================
# Audio Processing Functions
# ============================================

def resample_audio(audio_array: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Resample audio to target sample rate using high-quality resampling."""
    if orig_sr == target_sr:
        return audio_array

    # Try scipy for high-quality resampling
    try:
        from scipy import signal
        # Calculate the number of samples in output
        num_samples = int(len(audio_array) * target_sr / orig_sr)
        add_log(f"Resampling: input range=[{np.min(audio_array):.4f}, {np.max(audio_array):.4f}], RMS={np.sqrt(np.mean(audio_array**2)):.4f}")
        resampled = signal.resample(audio_array, num_samples)
        add_log(f"Resampled with scipy: {len(audio_array)} -> {len(resampled)} samples, output range=[{np.min(resampled):.4f}, {np.max(resampled):.4f}]")
        return resampled.astype(np.float32)
    except ImportError:
        pass

    # Fallback: use pydub for resampling (converts through AudioSegment)
    try:
        from pydub import AudioSegment
        import tempfile

        # Convert float32 array to int16 bytes
        int16_data = (audio_array * 32767).astype(np.int16)

        # Create AudioSegment from raw data
        audio_segment = AudioSegment(
            data=int16_data.tobytes(),
            sample_width=2,
            frame_rate=orig_sr,
            channels=1
        )

        # Resample using pydub
        audio_segment = audio_segment.set_frame_rate(target_sr)

        # Convert back to numpy array
        samples = np.array(audio_segment.get_array_of_samples())
        resampled = samples.astype(np.float32) / 32768.0
        add_log(f"Resampled with pydub: {len(audio_array)} -> {len(resampled)} samples")
        return resampled
    except Exception as e:
        add_log(f"Pydub resampling failed: {e}, using linear interpolation")

    # Last resort: linear interpolation (lower quality)
    ratio = target_sr / orig_sr
    new_length = int(len(audio_array) * ratio)
    old_indices = np.arange(len(audio_array))
    new_indices = np.linspace(0, len(audio_array) - 1, new_length)
    resampled = np.interp(new_indices, old_indices, audio_array)
    add_log(f"Resampled with linear interp: {len(audio_array)} -> {len(resampled)} samples")
    return resampled.astype(np.float32)


async def decode_audio(audio_b64: str, sample_rate: int = 16000, format: str = "wav") -> np.ndarray:
    """Decode base64 audio to numpy array and resample to 16kHz for Whisper."""
    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 audio: {e}")

    add_log(f"Received {len(audio_bytes)} bytes of {format} audio")

    try:
        detected_sample_rate = 16000
        audio_array = None

        # Try pydub first for webm/opus formats
        if format in ['webm', 'opus', 'ogg'] or audio_bytes[:4] != b'RIFF':
            try:
                from pydub import AudioSegment
                import tempfile

                # Determine the format for pydub
                pydub_format = format
                if format == 'webm' or audio_bytes[:4] == b'\x1a\x45\xdf\xa3':  # WebM magic bytes
                    pydub_format = 'webm'

                add_log(f"Using pydub to decode {pydub_format} audio...")

                # Write to temp file since pydub needs file path for some formats
                with tempfile.NamedTemporaryFile(suffix=f'.{pydub_format}', delete=False) as tmp:
                    tmp.write(audio_bytes)
                    tmp_path = tmp.name

                try:
                    audio_segment = AudioSegment.from_file(tmp_path, format=pydub_format)
                    detected_sample_rate = audio_segment.frame_rate
                    sample_width = audio_segment.sample_width

                    # Convert to mono if stereo
                    if audio_segment.channels > 1:
                        audio_segment = audio_segment.set_channels(1)

                    # Get raw samples and normalize based on sample width
                    samples = np.array(audio_segment.get_array_of_samples())

                    # Normalize based on sample width (bytes per sample)
                    if sample_width == 1:  # 8-bit
                        audio_array = (samples.astype(np.float32) - 128) / 128.0
                    elif sample_width == 2:  # 16-bit
                        audio_array = samples.astype(np.float32) / 32768.0
                    elif sample_width == 4:  # 32-bit
                        audio_array = samples.astype(np.float32) / 2147483648.0
                    else:
                        audio_array = samples.astype(np.float32) / 32768.0  # Default to 16-bit

                    add_log(f"Pydub decoded: {detected_sample_rate}Hz, {audio_segment.channels}ch, {sample_width}B/sample, {len(audio_array)} samples, max={np.max(np.abs(samples))}")
                finally:
                    # Clean up temp file
                    import os
                    os.unlink(tmp_path)

            except Exception as pydub_error:
                add_log(f"Pydub failed ({pydub_error}), trying WAV...")

        # Try to parse as WAV file
        if audio_array is None:
            try:
                with wave.open(io.BytesIO(audio_bytes), 'rb') as wav_file:
                    detected_sample_rate = wav_file.getframerate()
                    n_channels = wav_file.getnchannels()
                    sampwidth = wav_file.getsampwidth()
                    frames = wav_file.readframes(wav_file.getnframes())

                    add_log(f"WAV: {detected_sample_rate}Hz, {n_channels}ch, {sampwidth*8}bit, {len(frames)} bytes")

                    # Convert to numpy array based on sample width
                    if sampwidth == 2:  # 16-bit
                        audio_array = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                    elif sampwidth == 4:  # 32-bit
                        audio_array = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
                    else:
                        audio_array = np.frombuffer(frames, dtype=np.float32)

                    # If stereo, convert to mono
                    if n_channels == 2:
                        audio_array = audio_array.reshape(-1, 2).mean(axis=1)

            except Exception as wav_error:
                add_log(f"WAV parsing failed: {wav_error}")

        # Try soundfile as last resort
        if audio_array is None:
            try:
                import soundfile as sf
                audio_array, detected_sample_rate = sf.read(io.BytesIO(audio_bytes))
                # Convert to mono if stereo
                if len(audio_array.shape) > 1:
                    audio_array = audio_array.mean(axis=1)
                audio_array = audio_array.astype(np.float32)
                add_log(f"Soundfile decoded: {detected_sample_rate}Hz, {len(audio_array)} samples")
            except Exception as sf_error:
                add_log(f"Soundfile also failed: {sf_error}")
                raise HTTPException(status_code=400, detail=f"Cannot decode audio. Tried pydub, wav, soundfile. Error: {sf_error}")

        # Resample to 16kHz if needed (Whisper requires 16kHz)
        target_sr = 16000
        if detected_sample_rate != target_sr:
            add_log(f"Resampling from {detected_sample_rate}Hz to {target_sr}Hz...")
            audio_array = resample_audio(audio_array, detected_sample_rate, target_sr)

        # Log audio stats for debugging
        audio_min = float(np.min(audio_array))
        audio_max = float(np.max(audio_array))
        audio_rms = float(np.sqrt(np.mean(audio_array**2)))
        add_log(f"Audio ready: {len(audio_array)} samples, {len(audio_array)/target_sr:.2f}s, range=[{audio_min:.4f}, {audio_max:.4f}], RMS={audio_rms:.4f}")
        return audio_array

    except HTTPException:
        raise
    except Exception as e:
        add_log(f"Audio decode error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error processing audio: {e}")


# ============================================
# Transcription Functions
# ============================================

async def transcribe_audio(
    audio_array: np.ndarray,
    sample_rate: int = 16000,
    language: Optional[str] = None,
    task: str = "transcribe",
    return_timestamps: bool = False
) -> Dict[str, Any]:
    """Transcribe audio to text using loaded STT model."""
    global stt_model, stt_processor, stt_ready

    if not stt_ready or stt_model is None:
        raise HTTPException(status_code=503, detail="STT model not loaded")

    try:
        start_time = time.time()

        # Process with Whisper - ensure audio is float32 and 1D
        audio_array = np.asarray(audio_array, dtype=np.float32)
        if len(audio_array.shape) > 1:
            audio_array = audio_array.mean(axis=1)

        # Process audio features
        inputs = stt_processor(
            audio_array,
            sampling_rate=sample_rate,
            return_tensors="pt"
        )

        # Get model device and dtype
        device = next(stt_model.parameters()).device
        model_dtype = next(stt_model.parameters()).dtype
        input_features = inputs.input_features.to(device=device, dtype=model_dtype)

        # Build generation config using the modern API
        generate_kwargs = {
            "input_features": input_features,
        }

        # Use language and task parameters directly (modern Whisper API)
        if language:
            generate_kwargs["language"] = language
        if task:
            generate_kwargs["task"] = task

        if return_timestamps:
            generate_kwargs["return_timestamps"] = True

        with torch.no_grad():
            predicted_ids = stt_model.generate(**generate_kwargs)

        # Decode transcription
        transcription = stt_processor.batch_decode(
            predicted_ids,
            skip_special_tokens=True
        )[0]

        processing_time = time.time() - start_time
        audio_duration = len(audio_array) / sample_rate

        add_log(f"Transcribed {audio_duration:.1f}s audio in {processing_time:.2f}s: {transcription[:50]}...")

        result = {
            "transcription": transcription.strip(),
            "processing_time": processing_time,
            "audio_duration": audio_duration,
            "model": stt_model_name,
        }

        if language:
            result["language"] = language
        if task:
            result["task"] = task

        return result

    except Exception as e:
        add_log(f"Transcription error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription error: {e}")


# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    return {"status": "online", "service": "STT Server"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_ready": stt_ready,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/status")
async def status():
    vram = get_vram_stats()
    return {
        "model_ready": stt_ready,
        "model_loading": stt_loading,
        "model_name": stt_model_name,
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "models_cache_path": str(models_cache),
        "transcription_count": len(transcription_history),
    }


# ============================================
# Model Loading Endpoints
# ============================================

@app.post("/load_model")
async def load_model(config: STTModelConfig):
    """Load the STT model."""
    global stt_model, stt_processor, stt_model_name, stt_ready, stt_loading

    if stt_loading:
        return {"success": False, "error": "Model is already loading"}

    stt_loading = True

    try:
        if stt_model is not None:
            add_log("Unloading existing STT model...")
            stt_model.to("cpu")
            del stt_model
            stt_model = None
            del stt_processor
            stt_processor = None
            clear_cuda()

        stt_model_name = config.model_name
        add_log(f"Loading STT model: {stt_model_name}")

        from transformers import WhisperProcessor, WhisperForConditionalGeneration

        device = "cuda" if torch.cuda.is_available() else "cpu"
        if config.device != "auto":
            device = config.device

        # Use shared model cache path
        cache_dir = str(models_cache)
        add_log(f"Using model cache: {cache_dir}")

        stt_processor = WhisperProcessor.from_pretrained(
            stt_model_name,
            cache_dir=cache_dir
        )

        dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

        stt_model = WhisperForConditionalGeneration.from_pretrained(
            stt_model_name,
            torch_dtype=dtype,
            cache_dir=cache_dir,
            low_cpu_mem_usage=True
        )
        stt_model.to(device)
        stt_model.eval()
        stt_ready = True

        add_log(f"STT model loaded on {device}")
        return {"success": True, "device": device, "model_name": stt_model_name}

    except Exception as e:
        stt_ready = False
        add_log(f"Model load error: {e}")
        return {"success": False, "error": str(e)}
    finally:
        stt_loading = False


@app.post("/unload_model")
async def unload_model():
    """Unload the STT model to free VRAM."""
    global stt_model, stt_processor, stt_ready, stt_model_name

    add_log("Unloading STT model...")

    if stt_model is not None:
        stt_model.to("cpu")
        del stt_model
        stt_model = None
        del stt_processor
        stt_processor = None

    stt_ready = False
    stt_model_name = ""

    for _ in range(5):
        gc.collect()

    clear_cuda()

    add_log("STT model unloaded")
    return {"success": True}


# ============================================
# Transcription Endpoints
# ============================================

@app.post("/transcribe")
async def transcribe(request: TranscribeRequest):
    """Transcribe a single audio file."""
    # Decode audio
    audio_array = await decode_audio(request.audio_b64, request.sample_rate, request.format)

    # Transcribe (always 16kHz since decode_audio resamples)
    result = await transcribe_audio(
        audio_array,
        sample_rate=16000,
        language=request.language,
        task=request.task,
        return_timestamps=request.return_timestamps
    )

    # Add to history
    transcription_history.append({
        "timestamp": datetime.now().isoformat(),
        "transcription": result["transcription"],
        "audio_duration": result["audio_duration"],
        "processing_time": result["processing_time"],
    })

    # Keep history manageable
    if len(transcription_history) > 100:
        transcription_history[:] = transcription_history[-100:]

    return {"success": True, **result}


@app.post("/transcribe_batch")
async def transcribe_batch(request: BatchTranscribeRequest):
    """Transcribe multiple audio files."""
    results = []

    for i, audio_b64 in enumerate(request.audio_files_b64):
        try:
            # Decode audio
            audio_array = await decode_audio(audio_b64, request.sample_rate, request.format)

            # Transcribe (always 16kHz since decode_audio resamples)
            result = await transcribe_audio(
                audio_array,
                sample_rate=16000,
                language=request.language,
                task=request.task,
                return_timestamps=False
            )

            results.append({
                "index": i,
                "success": True,
                **result
            })

            # Add to history
            transcription_history.append({
                "timestamp": datetime.now().isoformat(),
                "transcription": result["transcription"],
                "audio_duration": result["audio_duration"],
                "processing_time": result["processing_time"],
            })

        except Exception as e:
            results.append({
                "index": i,
                "success": False,
                "error": str(e)
            })

    # Keep history manageable
    if len(transcription_history) > 100:
        transcription_history[:] = transcription_history[-100:]

    return {"success": True, "results": results, "total": len(request.audio_files_b64)}


@app.post("/transcribe_file")
async def transcribe_file(file: UploadFile = File(...)):
    """Transcribe an uploaded audio file."""
    try:
        # Read file
        audio_bytes = await file.read()

        # Encode to base64
        audio_b64 = base64.b64encode(audio_bytes).decode()

        # Decode audio
        audio_array = await decode_audio(audio_b64, sample_rate=16000, format="wav")

        # Transcribe
        result = await transcribe_audio(audio_array, sample_rate=16000)

        # Add to history
        transcription_history.append({
            "timestamp": datetime.now().isoformat(),
            "filename": file.filename,
            "transcription": result["transcription"],
            "audio_duration": result["audio_duration"],
            "processing_time": result["processing_time"],
        })

        return {"success": True, **result}

    except Exception as e:
        add_log(f"File transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# History Endpoints
# ============================================

@app.get("/history")
async def get_history(limit: int = 50):
    """Get transcription history."""
    return {
        "success": True,
        "history": transcription_history[-limit:],
        "total": len(transcription_history)
    }


@app.post("/history/clear")
async def clear_history():
    """Clear transcription history."""
    global transcription_history
    transcription_history = []
    add_log("History cleared")
    return {"success": True}


# ============================================
# Cached Models Browser
# ============================================

@app.get("/cached_models")
async def get_cached_models():
    """Scan the HuggingFace cache directory and return list of downloaded models."""
    try:
        cache_path = models_cache
        add_log(f"Scanning cache at: {cache_path}")

        if not cache_path.exists():
            return {"success": False, "error": f"Cache path does not exist: {cache_path}", "models": []}

        models = []

        # HuggingFace hub cache structure: models--{org}--{model}/snapshots/{hash}/
        for item in cache_path.iterdir():
            if item.is_dir():
                name = item.name

                # Parse HuggingFace cache format: models--org--name
                if name.startswith("models--"):
                    parts = name.replace("models--", "").split("--")
                    if len(parts) >= 2:
                        model_id = "/".join(parts)
                        models.append(model_id)

        # Also check the hub subdirectory if it exists
        hub_path = cache_path / "hub"
        if hub_path.exists():
            for item in hub_path.iterdir():
                if item.is_dir() and item.name.startswith("models--"):
                    parts = item.name.replace("models--", "").split("--")
                    if len(parts) >= 2:
                        model_id = "/".join(parts)
                        if model_id not in models:
                            models.append(model_id)

        # Filter to only Whisper models
        whisper_models = [m for m in models if "whisper" in m.lower()]

        # Sort models alphabetically
        whisper_models.sort()

        add_log(f"Found {len(whisper_models)} Whisper models in cache")
        return {"success": True, "models": whisper_models, "cache_path": str(cache_path)}

    except Exception as e:
        add_log(f"Error scanning cache: {e}")
        return {"success": False, "error": str(e), "models": []}


# ============================================
# Shutdown
# ============================================

@app.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server."""
    add_log("Shutdown requested...")
    import asyncio
    asyncio.get_event_loop().call_later(0.5, lambda: os._exit(0))
    return {"success": True, "message": "Server shutting down"}


if __name__ == "__main__":
    import logging
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8782
    print(f"Starting STT server on port {port}...")
    print(f"Models cache path: {models_cache}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
