"""
SDXL FastAPI Server
Provides endpoints for SDXL image generation using diffusers.
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uvicorn
import torch
import numpy as np
import os
import gc
import time
import base64
import random
from io import BytesIO
from datetime import datetime
from pathlib import Path
import subprocess
import sys
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor


# ============================================
# User Paths (from ContextUI environment variables)
# ============================================
def get_models_path() -> Path:
    """Get models path from env var or fallback to default."""
    env_path = os.environ.get('CONTEXTUI_MODELS_PATH')
    if env_path:
        return Path(env_path) / "SDXL"
    # Fallback: relative to script location
    return Path(__file__).parent.parent / "models" / "SDXL"


def get_generated_images_path() -> Path:
    """Get generated images path from env var or fallback to default."""
    env_path = os.environ.get('CONTEXTUI_GENERATED_IMAGES_PATH')
    if env_path:
        return Path(env_path) / "SDXL"
    # Fallback: relative to script location
    return Path(__file__).parent.parent / "generated_images"


app = FastAPI(title="SDXL Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
pipeline = None
model_id = ""
model_ready = False
model_loading = False
loading_progress = 0.0
last_error = None
generated_images: List[Dict[str, Any]] = []
generating = False
generation_progress = 0.0
current_image_num = 0
total_images = 0
generation_status = ""
stop_generation_flag = False
generation_log: List[str] = []

# Thread pool for running blocking operations
executor = ThreadPoolExecutor(max_workers=1)


class ModelConfig(BaseModel):
    model_id: str = "stabilityai/stable-diffusion-xl-base-1.0"
    use_cpu_offload: bool = True
    use_fp16: bool = True
    enable_attention_slicing: bool = True
    enable_vae_tiling: bool = False


class GenerateRequest(BaseModel):
    prompt: str
    negative_prompt: str = "low quality, blurry, distorted, deformed, ugly, bad anatomy"
    num_images: int = 1
    steps: int = 30
    cfg_scale: float = 7.5
    width: int = 1024
    height: int = 1024
    seed: int = -1
    scheduler: str = "DPM++ 2M"
    output_format: str = "png"
    jpg_quality: int = 95
    auto_save: bool = True
    save_metadata: bool = True


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


def add_log(message: str, verbose: bool = False):
    """Add timestamped entry to generation log."""
    global generation_log
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    generation_log.append(entry)
    # Keep only last 100 entries
    if len(generation_log) > 100:
        generation_log = generation_log[-100:]
    # Only print important messages to reduce terminal noise
    if not verbose:
        print(entry)


@app.get("/")
async def root():
    return {"status": "online", "service": "SDXL Server"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_ready": model_ready,
        "model_loading": model_loading,
        "model_id": model_id,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/status")
async def status():
    global model_ready, model_loading, model_id, last_error, generating
    global generation_progress, current_image_num, total_images, generation_status

    vram = get_vram_stats()

    return {
        "model_ready": model_ready,
        "model_loading": model_loading,
        "loading_progress": loading_progress,
        "model_id": model_id,
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "error": last_error,
        "generating": generating,
        "generation_progress": generation_progress,
        "current_image": current_image_num,
        "total_images": total_images,
        "generation_status": generation_status,
        "has_images": len(generated_images) > 0,
        "num_images": len(generated_images),
    }


@app.get("/models")
async def get_models():
    """Get list of available models."""
    models = [
        {"id": "stabilityai/stable-diffusion-xl-base-1.0", "name": "SDXL Base 1.0", "type": "huggingface"},
        {"id": "SG161222/RealVisXL_V5.0", "name": "RealVisXL V5.0", "type": "huggingface"},
    ]
    return models


class DepsCheckRequest(BaseModel):
    packages: List[str]


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
async def env_check_deps(req: DepsCheckRequest):
    """Check whether the listed packages are installed in this environment using `pip show`."""
    results: Dict[str, Dict[str, Any]] = {}
    for pkg in req.packages:
        r = run_pip_command(["pip", "show", pkg])
        installed = r.get("returncode", -1) == 0
        version = None
        if installed:
            # parse stdout for Version:
            for line in (r.get("stdout", "") or "").splitlines():
                if line.startswith("Version:"):
                    version = line.split(":", 1)[1].strip()
                    break

        results[pkg] = {"installed": installed, "version": version, "stdout": r.get("stdout", ""), "stderr": r.get("stderr", "")} 

    return {"success": True, "results": results}


@app.post("/env/install_packages")
async def env_install_packages(req: DepsCheckRequest):
    """Install the requested packages in this environment using pip. Returns pip output."""
    if not req.packages:
        return {"success": False, "error": "No packages provided"}

    args = ["pip", "install"] + req.packages
    res = run_pip_command(args)
    if res.get("returncode", -1) == 0:
        return {"success": True, "stdout": res.get("stdout", "")}
    else:
        return {"success": False, "stdout": res.get("stdout", ""), "stderr": res.get("stderr", "")}


@app.post("/load_model")
async def load_model(config: ModelConfig):
    global pipeline, model_id, model_ready, model_loading, loading_progress, last_error

    if model_loading:
        return {"success": False, "error": "Model is already loading"}

    model_loading = True
    loading_progress = 0.0
    last_error = None

    try:
        # Unload existing model first
        if pipeline is not None:
            add_log("Unloading existing model...")
            try:
                pipeline.to("cpu")
            except:
                pass
            del pipeline
            pipeline = None
            clear_cuda()

        loading_progress = 0.1
        add_log(f"Loading model: {config.model_id}")

        from diffusers import StableDiffusionXLPipeline

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

        loading_progress = 0.2

        # Check if it's a known HuggingFace model that has single file versions
        single_file_map = {
            "stabilityai/stable-diffusion-xl-base-1.0": "sd_xl_base_1.0_0.9vae.safetensors",
            "SG161222/RealVisXL_V5.0": "RealVisXL_V5.0_fp16.safetensors",
        }

        # Create models directory using user paths
        models_dir = get_models_path()
        models_dir.mkdir(parents=True, exist_ok=True)

        if config.model_id in single_file_map:
            filename = single_file_map[config.model_id]
            local_path = models_dir / filename

            if not local_path.exists():
                add_log(f"Downloading {filename}...")
                import requests

                url = f"https://huggingface.co/{config.model_id}/resolve/main/{filename}"
                response = requests.get(url, stream=True)
                response.raise_for_status()

                total_size = int(response.headers.get('content-length', 0))
                downloaded = 0

                with open(local_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192 * 1024):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0:
                            loading_progress = 0.2 + (downloaded / total_size) * 0.5

                add_log(f"Downloaded: {local_path}")

            loading_progress = 0.7
            add_log("Loading pipeline from single file...")
            pipeline = StableDiffusionXLPipeline.from_single_file(
                str(local_path),
                torch_dtype=dtype
            )
        else:
            # Load from pretrained
            add_log("Loading pipeline from pretrained...")
            pipeline = StableDiffusionXLPipeline.from_pretrained(
                config.model_id,
                torch_dtype=dtype,
                cache_dir=str(models_dir)
            )

        loading_progress = 0.8

        # Apply optimizations
        if config.enable_attention_slicing:
            pipeline.enable_attention_slicing()
            add_log("Attention slicing enabled")

        if config.enable_vae_tiling:
            pipeline.enable_vae_tiling()
            add_log("VAE tiling enabled")

        if config.use_cpu_offload and device == "cuda":
            pipeline.enable_model_cpu_offload()
            add_log("CPU offload enabled")
        else:
            pipeline = pipeline.to(device)

        loading_progress = 1.0
        model_id = config.model_id
        model_ready = True

        add_log(f"Model loaded successfully on {device}")

        return {"success": True, "device": device, "model_id": model_id}

    except Exception as e:
        last_error = str(e)
        model_ready = False
        add_log(f"Error loading model: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        model_loading = False


@app.post("/unload_model")
async def unload_model():
    global pipeline, model_ready, model_id

    add_log("Unloading model...")

    if pipeline is not None:
        try:
            pipeline.to("cpu")
            if torch.cuda.is_available():
                torch.cuda.synchronize()
        except Exception as e:
            print(f"Error moving model to CPU: {e}")

    pipeline = None
    model_ready = False
    model_id = ""

    for _ in range(5):
        gc.collect()

    clear_cuda()
    add_log("Model unloaded")

    return {"success": True}


def _run_generation_sync(request: GenerateRequest):
    """Synchronous generation function that runs in a thread."""
    global pipeline, model_ready, generated_images, generating
    global generation_progress, current_image_num, total_images
    global generation_status, stop_generation_flag, last_error, model_id

    try:
        from diffusers import (
            DPMSolverMultistepScheduler,
            EulerDiscreteScheduler,
            EulerAncestralDiscreteScheduler,
            DDIMScheduler,
            PNDMScheduler
        )

        # Set scheduler
        scheduler_map = {
            "DPM++ 2M": DPMSolverMultistepScheduler,
            "Euler": EulerDiscreteScheduler,
            "Euler A": EulerAncestralDiscreteScheduler,
            "DDIM": DDIMScheduler,
            "PNDM": PNDMScheduler
        }

        if request.scheduler in scheduler_map:
            pipeline.scheduler = scheduler_map[request.scheduler].from_config(
                pipeline.scheduler.config
            )

        # Flat output folder - no subfolders
        output_dir = get_generated_images_path()
        output_dir.mkdir(parents=True, exist_ok=True)

        start_time = time.time()
        generation_times = []

        for i in range(request.num_images):
            if stop_generation_flag:
                add_log(f"Generation stopped by user at image {i+1}/{request.num_images}")
                generation_status = f"Stopped at image {i+1}/{request.num_images}"
                break

            current_image_num = i + 1
            generation_progress = i / request.num_images
            generation_status = f"Generating image {i+1}/{request.num_images}..."
            add_log(f"Generating image {i+1}/{request.num_images}...")

            # Seed
            if request.seed < 0:
                current_seed = random.randint(0, 2**32 - 1)
            else:
                current_seed = request.seed + i

            generator = torch.Generator(device=pipeline.device)
            generator.manual_seed(current_seed)

            img_start = time.time()

            with torch.no_grad():
                result = pipeline(
                    prompt=request.prompt,
                    negative_prompt=request.negative_prompt if request.negative_prompt else None,
                    num_inference_steps=request.steps,
                    guidance_scale=request.cfg_scale,
                    generator=generator,
                    height=request.height,
                    width=request.width
                )

            image = result.images[0]
            img_time = time.time() - img_start
            generation_times.append(img_time)

            # Save to disk if auto_save enabled - flat structure with timestamp in filename
            filepath = None
            if request.auto_save:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"sdxl_{timestamp}_s{current_seed}.{request.output_format}"
                filepath = output_dir / filename

                if request.output_format == "png":
                    image.save(filepath, format="PNG")
                elif request.output_format == "jpg":
                    image.save(filepath, format="JPEG", quality=request.jpg_quality, optimize=True)
                elif request.output_format == "webp":
                    image.save(filepath, format="WEBP", quality=90)

            # Convert to base64 for web display
            buffered = BytesIO()
            if request.output_format == "png":
                image.save(buffered, format="PNG")
                mime_type = "image/png"
            elif request.output_format == "jpg":
                image.save(buffered, format="JPEG", quality=request.jpg_quality, optimize=True)
                mime_type = "image/jpeg"
            elif request.output_format == "webp":
                image.save(buffered, format="WEBP", quality=90)
                mime_type = "image/webp"
            else:
                image.save(buffered, format="PNG")
                mime_type = "image/png"

            img_base64 = base64.b64encode(buffered.getvalue()).decode()

            generated_images.append({
                "base64": img_base64,
                "mime_type": mime_type,
                "seed": current_seed,
                "path": str(filepath) if filepath else "Not saved",
                "generation_time": round(img_time, 2),
                "width": request.width,
                "height": request.height,
            })

            add_log(f"Image {i+1}/{request.num_images} complete ({img_time:.1f}s) - seed: {current_seed}")

        total_time = time.time() - start_time
        avg_time = sum(generation_times) / len(generation_times) if generation_times else 0

        generation_progress = 1.0
        generation_status = f"Complete! Generated {len(generated_images)} images"
        add_log(f"Generation complete: {len(generated_images)} images in {total_time:.1f}s (avg: {avg_time:.1f}s/image)")

        # Clear CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        return {
            "success": True,
            "images": generated_images,
            "output_path": str(output_dir),
            "total_time": round(total_time, 2),
            "average_time": round(avg_time, 2)
        }

    except Exception as e:
        last_error = str(e)
        generation_status = f"Error: {str(e)}"
        add_log(f"Generation error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        generating = False


@app.post("/generate")
async def generate(request: GenerateRequest):
    global pipeline, model_ready, generated_images, generating
    global generation_progress, current_image_num, total_images
    global generation_status, stop_generation_flag, last_error

    if not model_ready or pipeline is None:
        return {"success": False, "error": "Model not loaded"}

    if not request.prompt.strip():
        return {"success": False, "error": "Please enter a prompt"}

    if generating:
        return {"success": False, "error": "Already generating"}

    generating = True
    generation_progress = 0.0
    generated_images = []
    stop_generation_flag = False
    last_error = None
    total_images = request.num_images
    current_image_num = 0
    generation_status = "Starting..."

    add_log(f"Starting generation: {request.num_images} images")
    add_log(f"Prompt: {request.prompt[:100]}...")

    # Run the blocking generation in a thread pool to not block the event loop
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, _run_generation_sync, request)
    return result


@app.get("/generation-status")
async def get_generation_status():
    """Get current generation status."""
    return {
        "generating": generating,
        "progress": generation_progress,
        "current_image": current_image_num,
        "total_images": total_images,
        "status": generation_status,
        "images": generated_images
    }


@app.get("/generation-log")
async def get_generation_log():
    """Get generation log."""
    return {"log": generation_log}


@app.post("/stop-generation")
async def stop_generation():
    """Request to stop the current generation."""
    global stop_generation_flag
    stop_generation_flag = True
    add_log("Stop requested")
    return {"success": True, "message": "Stop requested"}


@app.post("/clear-cache")
async def clear_cache():
    """Clear GPU cache."""
    try:
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        add_log("Cache cleared")
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/save-images")
async def save_images():
    """Manually save current generated images to disk - flat structure."""
    global generated_images
    try:
        add_log(f"Save requested - {len(generated_images)} images in memory")

        if not generated_images:
            return {"success": False, "error": "No images to save"}

        import base64

        output_dir = get_generated_images_path()
        output_dir.mkdir(parents=True, exist_ok=True)

        saved_files = []
        for i, img_data in enumerate(generated_images):
            try:
                # Decode base64 image
                img_bytes = base64.b64decode(img_data["base64"])
                mime = img_data.get("mime_type", "image/png")
                ext = "png" if "png" in mime else "jpg"
                seed = img_data.get("seed", "unknown")
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"sdxl_{timestamp}_s{seed}.{ext}"
                filepath = output_dir / filename

                with open(filepath, "wb") as f:
                    f.write(img_bytes)
                saved_files.append(str(filepath))
                add_log(f"Saved: {filename}")
            except Exception as img_err:
                add_log(f"Error saving image {i+1}: {str(img_err)}")

        if saved_files:
            add_log(f"Saved {len(saved_files)} images")
            return {
                "success": True,
                "message": f"Saved {len(saved_files)} images",
                "output_path": str(output_dir),
                "files": saved_files
            }
        else:
            return {"success": False, "error": "No images could be saved"}
    except Exception as e:
        error_msg = str(e) if str(e) else "Unknown error occurred"
        add_log(f"Save error: {error_msg}")
        return {"success": False, "error": error_msg}


@app.post("/open-folder")
async def open_folder():
    """Open output folder."""
    try:
        import platform
        import subprocess

        output_dir = get_generated_images_path()
        output_dir.mkdir(parents=True, exist_ok=True)

        system = platform.system()
        if system == "Windows":
            os.startfile(str(output_dir))
        elif system == "Darwin":
            subprocess.run(["open", str(output_dir)])
        else:
            subprocess.run(["xdg-open", str(output_dir)])

        return {"success": True, "message": "Opened output folder"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server."""
    print("Shutdown requested...")
    import asyncio
    asyncio.get_event_loop().call_later(0.5, lambda: os._exit(0))
    return {"success": True, "message": "Server shutting down"}


if __name__ == "__main__":
    import sys
    import logging

    # Reduce uvicorn logging noise
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766

    # Check for --network flag to allow network access
    allow_network = "--network" in sys.argv
    host = "0.0.0.0" if allow_network else "127.0.0.1"

    print(f"Starting SDXL server on {host}:{port}...")
    uvicorn.run(app, host=host, port=port, log_level="warning")
