"""
Kokoro TTS Server
A standalone Text-to-Speech service using the Kokoro model.
Provides endpoints for speech synthesis that can be used by other workflows.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uvicorn
import torch
import gc
import time
import os
import sys
import io
import wave
import base64
import asyncio
import threading
from pathlib import Path
from datetime import datetime

app = FastAPI(title="Kokoro TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# Global State
# ============================================

tts_model: Optional[Dict[str, Any]] = None
tts_ready = False
tts_loading = False
current_voice = "af_heart"
current_speed = 1.0

# Audio playback control
is_speaking = False
stop_requested = False
audio_lock = threading.Lock()

# Logging
agent_log: List[str] = []


def add_log(message: str):
    """Add timestamped entry to log."""
    global agent_log
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    agent_log.append(entry)
    if len(agent_log) > 500:
        agent_log = agent_log[-500:]
    try:
        print(entry, flush=True)
    except Exception:
        pass


# ============================================
# Available Voices
# ============================================

# Kokoro voices follow pattern: {lang_code}{gender}_{name}
# lang_code: 'a' (American English), 'b' (British English)
# gender: 'f' (female), 'm' (male)
AVAILABLE_VOICES = {
    # American Female
    "af_heart": {"name": "Heart", "lang": "American", "gender": "Female", "description": "Warm, friendly voice"},
    "af_bella": {"name": "Bella", "lang": "American", "gender": "Female", "description": "Clear, professional voice"},
    "af_nicole": {"name": "Nicole", "lang": "American", "gender": "Female", "description": "Expressive voice"},
    "af_sarah": {"name": "Sarah", "lang": "American", "gender": "Female", "description": "Natural conversational voice"},
    "af_sky": {"name": "Sky", "lang": "American", "gender": "Female", "description": "Bright, energetic voice"},

    # American Male
    "am_adam": {"name": "Adam", "lang": "American", "gender": "Male", "description": "Deep, authoritative voice"},
    "am_michael": {"name": "Michael", "lang": "American", "gender": "Male", "description": "Friendly male voice"},

    # British Female
    "bf_emma": {"name": "Emma", "lang": "British", "gender": "Female", "description": "British accent, clear"},
    "bf_isabella": {"name": "Isabella", "lang": "British", "gender": "Female", "description": "Elegant British voice"},

    # British Male
    "bm_george": {"name": "George", "lang": "British", "gender": "Male", "description": "British male voice"},
    "bm_lewis": {"name": "Lewis", "lang": "British", "gender": "Male", "description": "Professional British voice"},
}


# ============================================
# VRAM Utilities
# ============================================

def get_vram_stats() -> Optional[Dict[str, Any]]:
    """Get VRAM statistics if CUDA is available."""
    if not torch.cuda.is_available():
        return None

    try:
        total = torch.cuda.get_device_properties(0).total_memory
        allocated = torch.cuda.memory_allocated(0)
        reserved = torch.cuda.memory_reserved(0)
        free = total - reserved

        return {
            "total": total,
            "allocated": allocated,
            "reserved": reserved,
            "free": free,
            "used": reserved
        }
    except Exception:
        return None


def clear_vram():
    """Clear VRAM by running garbage collection and emptying cache."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()


# ============================================
# TTS Functions
# ============================================

async def synthesize_speech(text: str, voice: Optional[str] = None, speed: Optional[float] = None) -> bytes:
    """Synthesize speech from text using Kokoro."""
    global tts_model, tts_ready, current_voice, current_speed, is_speaking, stop_requested

    if not tts_ready or tts_model is None:
        add_log("TTS not ready")
        return b""

    try:
        import numpy as np

        # Use provided voice/speed or defaults
        use_voice = voice or current_voice
        use_speed = speed or current_speed

        # Check if voice exists in pipelines
        if use_voice[0] not in tts_model["pipelines"]:
            add_log(f"Voice {use_voice} not available, using default")
            use_voice = "af_heart"

        with audio_lock:
            is_speaking = True
            stop_requested = False

        model = tts_model["model"]
        pipelines = tts_model["pipelines"]

        # Select pipeline based on voice (first char is lang code)
        pipeline = pipelines[use_voice[0]]
        pack = pipeline.load_voice(use_voice)

        add_log(f"Synthesizing: '{text[:50]}...' with voice {use_voice}")

        # Generate audio chunks
        audio_chunks = []
        for _, ps, _ in pipeline(text, use_voice, use_speed):
            # Check for stop request
            if stop_requested:
                add_log("Speech synthesis stopped by user")
                break

            ref_s = pack[len(ps)-1]
            with torch.no_grad():
                audio = model(ps, ref_s, use_speed)
            audio_chunks.append(audio.cpu().numpy())

        with audio_lock:
            is_speaking = False

        if not audio_chunks:
            return b""

        # Concatenate all audio chunks
        audio_data = np.concatenate(audio_chunks)

        # Create WAV file in memory (Kokoro outputs at 24kHz)
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(24000)  # Kokoro uses 24kHz
            wav_file.writeframes((audio_data * 32767).astype(np.int16).tobytes())

        add_log(f"Synthesized {len(audio_data)/24000:.1f}s of audio")
        return buffer.getvalue()

    except Exception as e:
        add_log(f"TTS error: {e}")
        with audio_lock:
            is_speaking = False
        return b""


# ============================================
# API Models
# ============================================

class TTSConfig(BaseModel):
    device: str = "auto"
    voice: str = "af_heart"


class SynthesizeRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = None
    return_format: str = "base64"  # "base64" or "binary"


class VoiceSelectRequest(BaseModel):
    voice: str
    speed: Optional[float] = None


# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    return {"status": "online", "service": "Kokoro TTS Server"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "tts_ready": tts_ready,
        "current_voice": current_voice,
        "is_speaking": is_speaking
    }


@app.get("/status")
async def status():
    """Get detailed server status."""
    vram = get_vram_stats()

    return {
        "tts_ready": tts_ready,
        "tts_loading": tts_loading,
        "current_voice": current_voice,
        "current_speed": current_speed,
        "is_speaking": is_speaking,
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "device": tts_model.get("device", "unknown") if tts_model else None
    }


@app.get("/voices")
async def list_voices():
    """List all available voices."""
    voices = []
    for voice_id, info in AVAILABLE_VOICES.items():
        voices.append({
            "id": voice_id,
            "name": info["name"],
            "language": info["lang"],
            "gender": info["gender"],
            "description": info["description"],
            "is_current": voice_id == current_voice
        })

    return {
        "success": True,
        "voices": voices,
        "current_voice": current_voice
    }


@app.post("/load")
async def load_tts(config: TTSConfig):
    """Load the Kokoro TTS model."""
    global tts_model, tts_ready, tts_loading, current_voice

    if tts_loading:
        return {"success": False, "error": "Already loading"}

    tts_loading = True
    add_log("Loading Kokoro TTS...")

    try:
        # Determine device
        if config.device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            device = config.device

        add_log(f"Using device: {device}")

        # Import Kokoro
        from kokoro import KModel, KPipeline

        # Clear any existing model
        if tts_model is not None:
            tts_model = None
            clear_vram()

        # Initialize Kokoro model and pipelines
        model = KModel().to(device).eval()
        pipelines = {
            lang_code: KPipeline(lang_code=lang_code, model=False)
            for lang_code in 'ab'
        }

        # Custom pronunciation for "kokoro"
        pipelines['a'].g2p.lexicon.golds['kokoro'] = 'kˈOkəɹO'
        pipelines['b'].g2p.lexicon.golds['kokoro'] = 'kˈQkəɹQ'

        tts_model = {
            "type": "kokoro",
            "model": model,
            "pipelines": pipelines,
            "voice": config.voice,
            "device": device
        }

        current_voice = config.voice
        tts_ready = True
        tts_loading = False

        vram = get_vram_stats()
        vram_used = f"{vram['used'] / 1024**3:.1f}GB" if vram else "N/A"

        add_log(f"Kokoro TTS loaded on {device} with voice {config.voice} (VRAM: {vram_used})")

        return {
            "success": True,
            "device": device,
            "voice": config.voice,
            "vram_used": vram_used
        }

    except ImportError as e:
        tts_loading = False
        add_log(f"Failed to import Kokoro: {e}")
        return {"success": False, "error": f"Kokoro not installed: {e}"}

    except Exception as e:
        tts_loading = False
        add_log(f"Failed to load TTS: {e}")
        return {"success": False, "error": str(e)}


@app.post("/unload")
async def unload_tts():
    """Unload the TTS model to free VRAM."""
    global tts_model, tts_ready

    if tts_model is not None:
        tts_model = None
        tts_ready = False
        clear_vram()
        add_log("TTS model unloaded")
        return {"success": True}

    return {"success": True, "message": "No model loaded"}


@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    """Synthesize speech from text."""
    if not tts_ready:
        return {"success": False, "error": "TTS not loaded"}

    if not request.text.strip():
        return {"success": False, "error": "Empty text"}

    audio = await synthesize_speech(request.text, request.voice, request.speed)

    if not audio:
        return {"success": False, "error": "Synthesis failed"}

    if request.return_format == "binary":
        return Response(content=audio, media_type="audio/wav")
    else:
        audio_b64 = base64.b64encode(audio).decode()
        return {
            "success": True,
            "audio_b64": audio_b64,
            "voice": request.voice or current_voice,
            "duration_estimate": len(audio) / (24000 * 2)  # Rough estimate
        }


@app.post("/speak")
async def speak(request: SynthesizeRequest):
    """Alias for synthesize - for compatibility."""
    return await synthesize(request)


@app.post("/stop")
async def stop_speaking():
    """Stop current speech synthesis."""
    global stop_requested

    with audio_lock:
        stop_requested = True

    add_log("Stop requested")
    return {"success": True, "was_speaking": is_speaking}


@app.post("/voice")
async def set_voice(request: VoiceSelectRequest):
    """Set the current voice."""
    global current_voice, current_speed

    if request.voice not in AVAILABLE_VOICES:
        # Check if it's a valid voice format even if not in our list
        if len(request.voice) >= 2 and request.voice[0] in 'ab' and request.voice[1] in 'fm':
            add_log(f"Using custom voice: {request.voice}")
        else:
            return {"success": False, "error": f"Unknown voice: {request.voice}"}

    current_voice = request.voice
    if request.speed is not None:
        current_speed = max(0.5, min(2.0, request.speed))

    add_log(f"Voice set to: {current_voice}, speed: {current_speed}")

    return {
        "success": True,
        "voice": current_voice,
        "speed": current_speed
    }


@app.get("/logs")
async def get_logs(limit: int = 100):
    """Get recent logs."""
    return {"logs": agent_log[-limit:]}


@app.get("/cuda_check")
async def cuda_check():
    """Check CUDA availability."""
    cuda_available = torch.cuda.is_available()
    cuda_version = None
    device_name = None

    if cuda_available:
        try:
            cuda_version = torch.version.cuda
            device_name = torch.cuda.get_device_name(0)
        except Exception:
            pass

    return {
        "cuda_available": cuda_available,
        "cuda_version": cuda_version,
        "device_name": device_name,
        "torch_version": torch.__version__
    }


# ============================================
# Main Entry Point
# ============================================

if __name__ == "__main__":
    # Accept port as positional argument (like other workflow servers)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8795
    host = "127.0.0.1"

    add_log(f"Starting Kokoro TTS Server on {host}:{port}")

    uvicorn.run(app, host=host, port=port)
