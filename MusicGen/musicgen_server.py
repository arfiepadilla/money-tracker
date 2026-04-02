"""
MusicGen FastAPI Server
Provides endpoints for music generation using Meta's MusicGen model.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uvicorn
import torch
import numpy as np
import os
import gc
import time
import struct
import base64
import threading
from datetime import datetime


# ============================================
# User Paths (from ContextUI environment variables)
# ============================================
def get_generated_music_path() -> str:
    """Get generated music path from env var or fallback to default."""
    env_path = os.environ.get('CONTEXTUI_GENERATED_MUSIC_PATH')
    if env_path:
        return env_path
    # Fallback: relative to working directory
    return "music_output"


app = FastAPI(title="MusicGen Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
model = None
processor = None
model_size = "small"
model_ready = False
model_loading = False
sample_rate = 32000
generated_audio = None
last_error = None
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


class ModelConfig(BaseModel):
    model_size: str = "small"  # small, medium, large, melody
    device: str = "auto"
    use_fp16: bool = True


class GenerateRequest(BaseModel):
    prompt: str
    duration: float = 10.0
    temperature: float = 1.0
    top_k: int = 250
    top_p: float = 0.0
    guidance_scale: float = 3.0
    # Audio input for continuation (base64 encoded)
    input_audio_b64: Optional[str] = None
    input_sample_rate: int = 32000
    audio_mode: str = "continuation"  # continuation or melody


class ExtendedGenerateRequest(BaseModel):
    prompt: str
    target_duration: float = 60.0
    context_seconds: float = 10.0
    segment_duration: float = 20.0
    temperature: float = 1.0
    top_k: int = 250
    top_p: float = 0.0
    guidance_scale: float = 3.0


class SongSection(BaseModel):
    """A single section of a structured song."""
    name: str              # "intro", "verse", "chorus", etc.
    prompt: str            # Section-specific prompt additions
    duration: float        # Duration in seconds
    temperature: float = 1.0
    guidance_scale: float = 3.0


class StructuredGenerateRequest(BaseModel):
    """Request for generating a multi-section structured song."""
    sections: List[SongSection]
    context_seconds: float = 5.0    # Audio overlap for continuity
    crossfade_seconds: float = 1.0  # Crossfade duration between sections
    base_prompt: str = ""           # Base style applied to all sections
    top_k: int = 250
    top_p: float = 0.0


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


def get_vram_stats() -> Optional[Dict[str, Any]]:
    """Get VRAM statistics if CUDA is available."""
    if not torch.cuda.is_available():
        return None
    try:
        device = torch.cuda.current_device()
        total = torch.cuda.get_device_properties(device).total_memory
        allocated = torch.cuda.memory_allocated(device)
        reserved = torch.cuda.memory_reserved(device)
        free = total - reserved
        return {
            "total": total,
            "allocated": allocated,
            "reserved": reserved,
            "free": free,
            "used": reserved,
        }
    except Exception:
        return None


@app.get("/")
async def root():
    return {"status": "online", "service": "MusicGen Server"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_ready": model_ready,
        "model_loading": model_loading,
        "model_size": model_size,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/status")
async def status():
    global model_ready, model_loading, model_size, sample_rate, last_error

    vram = get_vram_stats()

    return {
        "model_ready": model_ready,
        "model_loading": model_loading,
        "model_size": model_size,
        "sample_rate": sample_rate,
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "error": last_error,
        "has_audio": generated_audio is not None,
        "audio_duration": len(generated_audio) / sample_rate if generated_audio is not None else 0,
    }


@app.post("/load_model")
async def load_model(config: ModelConfig):
    global model, processor, model_size, model_ready, model_loading, sample_rate, last_error

    if model_loading:
        add_log("ERROR: Model is already loading")
        return {"success": False, "error": "Model is already loading"}

    model_loading = True
    last_error = None

    try:
        # Unload existing model first
        if model is not None:
            add_log("Unloading existing model...")
            model.to("cpu")
            del model
            model = None
            del processor
            processor = None
            clear_cuda()

        model_size = config.model_size
        is_melody = model_size == "melody"

        if is_melody:
            from transformers import AutoProcessor, MusicgenMelodyForConditionalGeneration
            model_class = MusicgenMelodyForConditionalGeneration
        else:
            from transformers import AutoProcessor, MusicgenForConditionalGeneration
            model_class = MusicgenForConditionalGeneration

        model_name = f"facebook/musicgen-{model_size}"
        add_log(f"Loading MusicGen model: {model_name}")

        # Resolve device
        if config.device == "auto":
            if torch.cuda.is_available():
                device = "cuda"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        else:
            device = config.device

        # Load processor
        add_log("Loading processor...")
        processor = AutoProcessor.from_pretrained(model_name)

        # Load model
        add_log(f"Loading model on {device}...")
        dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

        model = model_class.from_pretrained(
            model_name,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
            device_map=None,
        )

        if device != "cpu":
            model.to(device)

        model.eval()
        sample_rate = model.config.audio_encoder.sampling_rate
        model_ready = True

        add_log(f"MusicGen {model_size} loaded successfully on {device}")

        return {"success": True, "device": device, "sample_rate": sample_rate}

    except Exception as e:
        last_error = str(e)
        model_ready = False
        add_log(f"ERROR loading model: {e}")
        return {"success": False, "error": str(e)}
    finally:
        model_loading = False


@app.post("/unload_model")
async def unload_model():
    global model, processor, model_ready

    add_log("Unloading MusicGen model...")

    if model is not None:
        try:
            model.to("cpu")
            if torch.cuda.is_available():
                torch.cuda.synchronize()
        except Exception as e:
            add_log(f"Warning: Error moving model to CPU: {e}")

    model = None
    processor = None
    model_ready = False

    for _ in range(5):
        gc.collect()

    clear_cuda()
    add_log("MusicGen model unloaded successfully")

    return {"success": True}


@app.post("/generate")
async def generate(request: GenerateRequest):
    global model, processor, model_ready, generated_audio, sample_rate, last_error

    if not model_ready or model is None:
        return {"success": False, "error": "Model not loaded"}

    if not request.prompt.strip():
        return {"success": False, "error": "Please enter a prompt"}

    last_error = None

    try:
        is_melody_model = model_size == "melody"

        # Decode input audio if provided
        input_audio = None
        if request.input_audio_b64:
            audio_bytes = base64.b64decode(request.input_audio_b64)
            input_audio = np.frombuffer(audio_bytes, dtype=np.float32)

        use_audio = input_audio is not None
        use_melody_mode = use_audio and is_melody_model and request.audio_mode == "melody"
        use_continuation = use_audio and request.audio_mode == "continuation"

        add_log(f"Generating music: '{request.prompt[:50]}...' ({request.duration}s)")
        t0 = time.perf_counter()

        # Prepare inputs
        if use_melody_mode or use_continuation:
            inputs = processor(
                audio=input_audio,
                sampling_rate=request.input_sample_rate,
                text=[request.prompt],
                padding=True,
                return_tensors="pt",
            )
        else:
            inputs = processor(
                text=[request.prompt],
                padding=True,
                return_tensors="pt",
            )

        device = next(model.parameters()).device
        dtype = next(model.parameters()).dtype

        def prepare_input(v):
            if not hasattr(v, 'to'):
                return v
            v = v.to(device)
            if v.is_floating_point():
                v = v.to(dtype)
            return v

        inputs = {k: prepare_input(v) for k, v in inputs.items()}

        # Calculate max tokens
        audio_length_in_s = float(request.duration)
        frame_rate = getattr(model.config.audio_encoder, 'frame_rate', 50)

        if use_continuation and input_audio is not None:
            input_duration = len(input_audio) / request.input_sample_rate
            max_total = 30.0
            remaining = max(1.0, max_total - input_duration)
            audio_length_in_s = min(audio_length_in_s, remaining)

        gen_kwargs = {
            "max_new_tokens": int(audio_length_in_s * frame_rate),
            "do_sample": True,
            "temperature": max(0.01, float(request.temperature)),
            "top_k": int(request.top_k) if request.top_k > 0 else None,
            "top_p": float(request.top_p) if request.top_p > 0 else None,
            "guidance_scale": float(request.guidance_scale),
        }

        with torch.no_grad():
            audio_values = model.generate(**inputs, **gen_kwargs)

        audio_np = audio_values[0, 0].cpu().numpy()
        generated_audio = audio_np

        gen_time = time.perf_counter() - t0
        duration = len(audio_np) / sample_rate
        add_log(f"Generation complete: {duration:.1f}s in {gen_time:.2f}s")

        # Encode audio as base64
        audio_b64 = base64.b64encode(audio_np.astype(np.float32).tobytes()).decode('utf-8')

        return {
            "success": True,
            "audio_b64": audio_b64,
            "sample_rate": sample_rate,
            "duration": len(audio_np) / sample_rate,
            "generation_time": gen_time,
        }

    except Exception as e:
        last_error = str(e)
        add_log(f"ERROR during generation: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/generate_extended")
async def generate_extended(request: ExtendedGenerateRequest):
    global model, processor, model_ready, generated_audio, sample_rate, last_error

    if not model_ready or model is None:
        return {"success": False, "error": "Model not loaded"}

    if not request.prompt.strip():
        return {"success": False, "error": "Please enter a prompt"}

    last_error = None

    try:
        t0 = time.perf_counter()

        target = float(request.target_duration)
        context_len = float(request.context_seconds)
        segment_len = float(request.segment_duration)

        if target <= context_len + segment_len:
            total_segments = 1
        else:
            total_segments = int(np.ceil((target - context_len) / segment_len))

        add_log(f"Extended generation: '{request.prompt[:50]}...' - {target}s target, {total_segments} segments")

        device = next(model.parameters()).device
        dtype = next(model.parameters()).dtype
        frame_rate = getattr(model.config.audio_encoder, 'frame_rate', 50)

        def prepare_input(v):
            if not hasattr(v, 'to'):
                return v
            v = v.to(device)
            if v.is_floating_point():
                v = v.to(dtype)
            return v

        gen_kwargs = {
            "do_sample": True,
            "temperature": max(0.01, float(request.temperature)),
            "top_k": int(request.top_k) if request.top_k > 0 else None,
            "top_p": float(request.top_p) if request.top_p > 0 else None,
            "guidance_scale": float(request.guidance_scale),
        }

        accumulated_audio = None
        current_context = None
        current_sr = sample_rate

        for seg_idx in range(total_segments):
            if accumulated_audio is None:
                gen_duration = min(context_len + segment_len, 30.0)
                add_log(f"Segment {seg_idx + 1}/{total_segments}: Generating initial {gen_duration:.1f}s...")
            else:
                gen_duration = segment_len
                add_log(f"Segment {seg_idx + 1}/{total_segments}: Continuing with {context_len:.1f}s context...")

            if current_context is not None:
                inputs = processor(
                    audio=current_context,
                    sampling_rate=current_sr,
                    text=[request.prompt],
                    padding=True,
                    return_tensors="pt",
                )
                input_dur = len(current_context) / current_sr
                effective_gen = min(gen_duration, 30.0 - input_dur)
            else:
                inputs = processor(
                    text=[request.prompt],
                    padding=True,
                    return_tensors="pt",
                )
                effective_gen = min(gen_duration, 30.0)

            inputs = {k: prepare_input(v) for k, v in inputs.items()}
            gen_kwargs["max_new_tokens"] = int(effective_gen * frame_rate)

            with torch.no_grad():
                audio_values = model.generate(**inputs, **gen_kwargs)

            new_audio = audio_values[0, 0].cpu().numpy()
            new_sr = sample_rate

            if accumulated_audio is None:
                accumulated_audio = new_audio
            else:
                context_samples = int(context_len * new_sr)
                if len(new_audio) > context_samples:
                    new_portion = new_audio[context_samples:]
                    crossfade_samples = min(int(0.5 * new_sr), len(new_portion), len(accumulated_audio))
                    if crossfade_samples > 0:
                        fade_out = np.linspace(1, 0, crossfade_samples)
                        fade_in = np.linspace(0, 1, crossfade_samples)
                        accumulated_audio[-crossfade_samples:] *= fade_out
                        new_portion[:crossfade_samples] *= fade_in
                        accumulated_audio[-crossfade_samples:] += new_portion[:crossfade_samples]
                        accumulated_audio = np.concatenate([accumulated_audio, new_portion[crossfade_samples:]])
                    else:
                        accumulated_audio = np.concatenate([accumulated_audio, new_portion])

            context_samples = int(context_len * new_sr)
            if len(accumulated_audio) >= context_samples:
                current_context = accumulated_audio[-context_samples:]
                current_sr = new_sr

            current_duration = len(accumulated_audio) / new_sr
            if current_duration >= target:
                add_log(f"Reached target duration: {current_duration:.1f}s")
                break

        # Trim to exact target duration
        target_samples = int(target * sample_rate)
        if len(accumulated_audio) > target_samples:
            accumulated_audio = accumulated_audio[:target_samples]

        generated_audio = accumulated_audio

        gen_time = time.perf_counter() - t0
        final_duration = len(generated_audio) / sample_rate
        add_log(f"Extended generation complete: {final_duration:.1f}s in {gen_time:.1f}s")

        audio_b64 = base64.b64encode(accumulated_audio.astype(np.float32).tobytes()).decode('utf-8')

        return {
            "success": True,
            "audio_b64": audio_b64,
            "sample_rate": sample_rate,
            "duration": final_duration,
            "generation_time": gen_time,
            "segments": total_segments,
        }

    except Exception as e:
        last_error = str(e)
        add_log(f"ERROR during extended generation: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/generate_structured")
async def generate_structured(request: StructuredGenerateRequest):
    """Generate a multi-section structured song with different prompts per section."""
    global model, processor, model_ready, generated_audio, sample_rate, last_error

    if not model_ready or model is None:
        return {"success": False, "error": "Model not loaded"}

    if not request.sections:
        return {"success": False, "error": "No sections provided"}

    last_error = None

    try:
        t0 = time.perf_counter()

        total_sections = len(request.sections)
        total_duration = sum(s.duration for s in request.sections)
        add_log(f"Structured generation: {total_sections} sections, {total_duration:.0f}s total")

        device = next(model.parameters()).device
        dtype = next(model.parameters()).dtype
        frame_rate = getattr(model.config.audio_encoder, 'frame_rate', 50)

        def prepare_input(v):
            if not hasattr(v, 'to'):
                return v
            v = v.to(device)
            if v.is_floating_point():
                v = v.to(dtype)
            return v

        accumulated_audio = None
        context_samples = int(request.context_seconds * sample_rate)
        crossfade_samples = int(request.crossfade_seconds * sample_rate)

        # Maximum generation per chunk (MusicGen limit is ~30s, use 25s to be safe with context)
        max_chunk_duration = 20.0

        for idx, section in enumerate(request.sections):
            # Combine base prompt with section prompt
            if request.base_prompt.strip():
                full_prompt = f"{request.base_prompt.strip()}, {section.prompt.strip()}"
            else:
                full_prompt = section.prompt.strip()

            if not full_prompt:
                add_log(f"WARNING: Section {idx + 1} has empty prompt, skipping")
                continue

            section_duration = float(section.duration)
            add_log(f"Section {idx + 1}/{total_sections}: '{section.name}' ({section_duration:.0f}s)")
            add_log(f"  Prompt: '{full_prompt[:60]}...'")

            # Build generation kwargs for this section
            gen_kwargs = {
                "do_sample": True,
                "temperature": max(0.01, float(section.temperature)),
                "top_k": int(request.top_k) if request.top_k > 0 else None,
                "top_p": float(request.top_p) if request.top_p > 0 else None,
                "guidance_scale": float(section.guidance_scale),
            }

            # Track how much of this section we've generated
            section_audio = None
            section_generated = 0.0
            chunk_num = 0
            max_chunks = 50  # Safety limit

            while section_generated < section_duration - 0.5 and chunk_num < max_chunks:
                chunk_num += 1
                remaining = section_duration - section_generated

                # Determine if this is the first chunk overall or continuing
                is_first_chunk_overall = (accumulated_audio is None and section_audio is None)
                has_context = not is_first_chunk_overall

                if is_first_chunk_overall:
                    # Very first chunk: generate from scratch
                    gen_duration = min(remaining, max_chunk_duration, 30.0)
                    inputs = processor(
                        text=[full_prompt],
                        padding=True,
                        return_tensors="pt",
                    )
                    add_log(f"  Chunk {chunk_num}: generating initial {gen_duration:.1f}s")
                else:
                    # Get context audio
                    if section_audio is not None and len(section_audio) >= context_samples:
                        context_audio = section_audio[-context_samples:]
                    elif accumulated_audio is not None:
                        context_audio = accumulated_audio[-context_samples:]
                    else:
                        context_audio = section_audio if section_audio is not None else None

                    if context_audio is None or len(context_audio) < int(0.5 * sample_rate):
                        # Fallback: generate without context
                        gen_duration = min(remaining, max_chunk_duration, 30.0)
                        inputs = processor(
                            text=[full_prompt],
                            padding=True,
                            return_tensors="pt",
                        )
                        has_context = False
                        add_log(f"  Chunk {chunk_num}: generating {gen_duration:.1f}s (no context)")
                    else:
                        # With context: request enough to get desired new audio after stripping context
                        input_duration = len(context_audio) / sample_rate
                        # We want 'remaining' new audio, but limited by what fits in 30s window
                        max_total = 30.0 - 1.0  # 1s safety margin
                        desired_new = min(remaining, max_chunk_duration)
                        gen_duration = min(desired_new, max_total - input_duration)

                        # Ensure minimum progress
                        if gen_duration < 1.0:
                            gen_duration = min(remaining, max_total - input_duration, 5.0)

                        inputs = processor(
                            audio=context_audio,
                            sampling_rate=sample_rate,
                            text=[full_prompt],
                            padding=True,
                            return_tensors="pt",
                        )
                        add_log(f"  Chunk {chunk_num}: {input_duration:.1f}s context + {gen_duration:.1f}s new")

                inputs = {k: prepare_input(v) for k, v in inputs.items()}
                gen_kwargs["max_new_tokens"] = int(gen_duration * frame_rate)

                with torch.no_grad():
                    audio_values = model.generate(**inputs, **gen_kwargs)

                new_audio = audio_values[0, 0].cpu().numpy()
                actual_duration = len(new_audio) / sample_rate

                if is_first_chunk_overall:
                    section_audio = new_audio
                    section_generated = actual_duration
                    add_log(f"    Got {actual_duration:.1f}s")
                else:
                    # The output includes the context, so strip it
                    if has_context and len(new_audio) > context_samples:
                        new_portion = new_audio[context_samples:]
                    else:
                        new_portion = new_audio

                    new_portion_duration = len(new_portion) / sample_rate

                    if section_audio is None:
                        section_audio = new_portion
                    else:
                        # Crossfade within section
                        inner_crossfade = min(int(0.3 * sample_rate), len(new_portion), len(section_audio))
                        if inner_crossfade > 0 and len(new_portion) > inner_crossfade:
                            fade_out = np.linspace(1, 0, inner_crossfade)
                            fade_in = np.linspace(0, 1, inner_crossfade)
                            section_audio[-inner_crossfade:] *= fade_out
                            new_portion[:inner_crossfade] *= fade_in
                            section_audio[-inner_crossfade:] += new_portion[:inner_crossfade]
                            section_audio = np.concatenate([section_audio, new_portion[inner_crossfade:]])
                        else:
                            section_audio = np.concatenate([section_audio, new_portion])

                    section_generated = len(section_audio) / sample_rate
                    add_log(f"    Added {new_portion_duration:.1f}s -> total {section_generated:.1f}s / {section_duration:.0f}s")

            if chunk_num >= max_chunks:
                add_log(f"  WARNING: Hit max chunks limit for section '{section.name}'")

            # Now merge section_audio into accumulated_audio
            if accumulated_audio is None:
                accumulated_audio = section_audio
                add_log(f"  Section complete: {len(section_audio) / sample_rate:.1f}s")
            else:
                # Apply crossfade between sections
                actual_crossfade = min(crossfade_samples, len(section_audio), len(accumulated_audio))
                if actual_crossfade > 0:
                    fade_out = np.linspace(1, 0, actual_crossfade)
                    fade_in = np.linspace(0, 1, actual_crossfade)
                    accumulated_audio[-actual_crossfade:] *= fade_out
                    section_audio[:actual_crossfade] *= fade_in
                    accumulated_audio[-actual_crossfade:] += section_audio[:actual_crossfade]
                    accumulated_audio = np.concatenate([accumulated_audio, section_audio[actual_crossfade:]])
                else:
                    accumulated_audio = np.concatenate([accumulated_audio, section_audio])

                add_log(f"  Section complete. Total: {len(accumulated_audio) / sample_rate:.1f}s")

        generated_audio = accumulated_audio
        gen_time = time.perf_counter() - t0
        final_duration = len(generated_audio) / sample_rate

        add_log(f"Structured generation complete: {final_duration:.1f}s in {gen_time:.1f}s")

        audio_b64 = base64.b64encode(accumulated_audio.astype(np.float32).tobytes()).decode('utf-8')

        return {
            "success": True,
            "audio_b64": audio_b64,
            "sample_rate": sample_rate,
            "duration": final_duration,
            "generation_time": gen_time,
            "sections_generated": total_sections,
        }

    except Exception as e:
        last_error = str(e)
        add_log(f"ERROR during structured generation: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/save_audio")
async def save_audio(filename: str, output_dir: str = None):
    global generated_audio, sample_rate

    if generated_audio is None:
        return {"success": False, "error": "No audio to save"}

    try:
        # Use provided output_dir or fall back to user paths
        if not output_dir or output_dir == "." or output_dir == "music_output":
            output_dir = get_generated_music_path()

        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, filename)

        # Normalize to int16 range
        audio_int16 = (generated_audio * 32767).astype(np.int16)

        num_channels = 1
        bits_per_sample = 16
        sr = int(sample_rate)
        num_samples = int(audio_int16.shape[0])

        byte_rate = sr * num_channels * bits_per_sample // 8
        block_align = num_channels * bits_per_sample // 8
        subchunk2_size = num_samples * num_channels * bits_per_sample // 8
        chunk_size = 36 + subchunk2_size

        with open(filepath, "wb") as f:
            f.write(b"RIFF")
            f.write(struct.pack("<I", chunk_size))
            f.write(b"WAVE")
            f.write(b"fmt ")
            f.write(struct.pack("<I", 16))
            f.write(struct.pack("<H", 1))
            f.write(struct.pack("<H", num_channels))
            f.write(struct.pack("<I", sr))
            f.write(struct.pack("<I", byte_rate))
            f.write(struct.pack("<H", block_align))
            f.write(struct.pack("<H", bits_per_sample))
            f.write(b"data")
            f.write(struct.pack("<I", subchunk2_size))
            f.write(audio_int16.tobytes())

        add_log(f"Audio saved to: {filepath}")
        return {"success": True, "path": filepath}

    except Exception as e:
        add_log(f"ERROR saving audio: {e}")
        return {"success": False, "error": str(e)}


@app.get("/logs")
async def get_logs():
    """Get server logs."""
    global agent_log
    return {"success": True, "logs": agent_log}


@app.post("/clear_logs")
async def clear_logs():
    """Clear server logs."""
    global agent_log
    agent_log = []
    add_log("Logs cleared")
    return {"success": True}


@app.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server"""
    add_log("Shutdown requested...")
    # Schedule shutdown after response is sent
    import asyncio
    asyncio.get_event_loop().call_later(0.5, lambda: os._exit(0))
    return {"success": True, "message": "Server shutting down"}


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    add_log(f"Starting MusicGen server on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port)
