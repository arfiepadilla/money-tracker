"""
Image-to-Text FastAPI Server
Provides endpoints for analyzing images using vision-language models.
Supports multiple models including Florence-2, BLIP-2, and others.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
import io
from pathlib import Path
from datetime import datetime
from PIL import Image

# Suppress HuggingFace symlinks warning on Windows
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'

app = FastAPI(title="Image-to-Text Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# User Paths (from ContextUI environment variables)
# ============================================

def get_models_cache_path() -> Path:
    """Get HuggingFace models cache path from env var or fallback to default."""
    env_path = os.environ.get('CONTEXTUI_MODELS_PATH')
    if env_path:
        return Path(env_path) / "huggingface"
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
vision_model = None
vision_processor = None
vit_gpt2_tokenizer = None  # Separate tokenizer for ViT-GPT2 models
vision_model_name = ""
vision_ready = False
vision_loading = False
model_type = ""  # "blip", "blip2", "git", "vit-gpt2", "qwen-vl", or "other"

# System State
models_cache = get_models_cache_path()
analysis_history: List[Dict[str, Any]] = []


def add_log(message: str):
    """Add timestamped log entry."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    print(entry, flush=True)


# ============================================
# Download Progress Tracking
# ============================================

def setup_download_progress():
    """Setup HuggingFace download progress logging."""
    try:
        from huggingface_hub import hf_hub_download
        from huggingface_hub.file_download import _hf_hub_download_to_cache_dir
        import huggingface_hub.file_download as fd

        # Enable progress bars
        os.environ['HF_HUB_ENABLE_HF_TRANSFER'] = '1'

        # Custom progress callback using tqdm hook
        from tqdm import tqdm

        class DownloadProgressCallback:
            """Track download progress and log updates."""
            def __init__(self):
                self.current_file = None
                self.last_logged_percent = -10  # Log every 10%

            def __call__(self, progress_info):
                """Called by HuggingFace during downloads."""
                if hasattr(progress_info, 'filename'):
                    filename = progress_info.filename
                    if hasattr(progress_info, 'downloaded') and hasattr(progress_info, 'total'):
                        downloaded = progress_info.downloaded
                        total = progress_info.total
                        if total > 0:
                            percent = (downloaded / total) * 100
                            if percent - self.last_logged_percent >= 10:
                                self.last_logged_percent = int(percent // 10) * 10
                                add_log(f"Downloading {filename}: {percent:.0f}% ({downloaded / 1024 / 1024:.1f}MB / {total / 1024 / 1024:.1f}MB)")

        return DownloadProgressCallback()
    except Exception as e:
        add_log(f"Could not setup download progress: {e}")
        return None


def log_download_progress(filename: str, current: int, total: int):
    """Log download progress for a file."""
    if total > 0:
        percent = (current / total) * 100
        current_mb = current / 1024 / 1024
        total_mb = total / 1024 / 1024
        # Create a simple progress bar
        bar_length = 20
        filled = int(bar_length * current / total)
        bar = '=' * filled + '-' * (bar_length - filled)
        add_log(f"Downloading: [{bar}] {percent:.1f}% ({current_mb:.1f}/{total_mb:.1f} MB) - {filename}")


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


def create_thumbnail(image: Image.Image, max_size: int = 100) -> str:
    """Create a base64 thumbnail from PIL Image."""
    thumb = image.copy()
    thumb.thumbnail((max_size, max_size))
    buffer = io.BytesIO()
    thumb.save(buffer, format='JPEG', quality=70)
    return f"data:image/jpeg;base64,{base64.b64encode(buffer.getvalue()).decode()}"


# ============================================
# Request/Response Models
# ============================================

class VisionModelConfig(BaseModel):
    model_name: str = "microsoft/Florence-2-base"
    device: str = "auto"
    use_fp16: bool = True


class AnalyzeRequest(BaseModel):
    image_b64: str  # Base64 encoded image (primary, for single-image models)
    images_b64: Optional[List[str]] = None  # Multiple images (for Qwen-VL multi-image)
    prompt: Optional[str] = None  # Optional prompt for the analysis
    max_new_tokens: int = 512


# ============================================
# Image Processing
# ============================================

def decode_image(image_b64: str) -> Image.Image:
    """Decode base64 image to PIL Image."""
    try:
        image_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_bytes))
        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')
        return image
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")


# ============================================
# Model-Specific Analysis Functions
# ============================================

def analyze_with_blip(image: Image.Image, prompt: Optional[str] = None, max_new_tokens: int = 512) -> tuple[str, str]:
    """Analyze image using BLIP (not BLIP-2) model for captioning.
    Returns tuple of (result, actual_prompt_used)."""
    global vision_model, vision_processor

    device = next(vision_model.parameters()).device

    # BLIP captioning models only support unconditional captioning
    # Prompts are ignored as they just get echoed back
    # Always do unconditional captioning for best results
    inputs = vision_processor(images=image, return_tensors="pt").to(device)

    # Handle dtype
    model_dtype = next(vision_model.parameters()).dtype
    if 'pixel_values' in inputs:
        inputs['pixel_values'] = inputs['pixel_values'].to(dtype=model_dtype)

    with torch.no_grad():
        generated_ids = vision_model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            num_beams=3,
        )

    generated_text = vision_processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

    # If a prompt was provided, note that BLIP doesn't support it
    if prompt:
        add_log("Note: BLIP captioning models don't support custom prompts, using unconditional captioning")

    actual_prompt = "(Model doesn't support prompts - using image captioning)"
    return (generated_text.strip(), actual_prompt)


def analyze_with_git(image: Image.Image, prompt: Optional[str] = None, max_new_tokens: int = 512) -> tuple[str, str]:
    """Analyze image using Microsoft GIT model.
    Returns tuple of (result, actual_prompt_used)."""
    global vision_model, vision_processor

    device = next(vision_model.parameters()).device

    # GIT models take pixel values directly
    inputs = vision_processor(images=image, return_tensors="pt").to(device)

    # Handle dtype
    model_dtype = next(vision_model.parameters()).dtype
    if 'pixel_values' in inputs:
        inputs['pixel_values'] = inputs['pixel_values'].to(dtype=model_dtype)

    with torch.no_grad():
        generated_ids = vision_model.generate(
            pixel_values=inputs['pixel_values'],
            max_new_tokens=max_new_tokens,
        )

    generated_text = vision_processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

    if prompt:
        add_log("Note: GIT models don't support custom prompts, using image captioning")

    actual_prompt = "(Model doesn't support prompts - using image captioning)"
    return (generated_text.strip(), actual_prompt)


def analyze_with_vit_gpt2(image: Image.Image, prompt: Optional[str] = None, max_new_tokens: int = 512) -> tuple[str, str]:
    """Analyze image using ViT-GPT2 model.
    Returns tuple of (result, actual_prompt_used)."""
    global vision_model, vision_processor, vit_gpt2_tokenizer

    device = next(vision_model.parameters()).device

    # ViT-GPT2 takes pixel values
    inputs = vision_processor(images=image, return_tensors="pt").to(device)

    # Handle dtype - ViT-GPT2 may need float32
    if 'pixel_values' in inputs:
        inputs['pixel_values'] = inputs['pixel_values'].to(device)

    with torch.no_grad():
        generated_ids = vision_model.generate(
            inputs['pixel_values'],
            max_new_tokens=max_new_tokens,
            num_beams=4,
        )

    # Use the tokenizer to decode, not the image processor
    generated_text = vit_gpt2_tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0]

    if prompt:
        add_log("Note: ViT-GPT2 models don't support custom prompts, using unconditional captioning")

    actual_prompt = "(Model doesn't support prompts - using image captioning)"
    return (generated_text.strip(), actual_prompt)


def analyze_with_blip2(image: Image.Image, prompt: Optional[str] = None, max_new_tokens: int = 512) -> tuple[str, str]:
    """Analyze image using BLIP-2 model.
    Returns tuple of (result, actual_prompt_used)."""
    global vision_model, vision_processor

    device = next(vision_model.parameters()).device

    # BLIP-2 works best with question format for prompts
    if prompt:
        # Format as a question if it doesn't end with ?
        question = prompt if prompt.strip().endswith('?') else f"Question: {prompt} Answer:"
        inputs = vision_processor(images=image, text=question, return_tensors="pt").to(device)
        actual_prompt = prompt
    else:
        # For captioning without prompt, just pass the image
        inputs = vision_processor(images=image, return_tensors="pt").to(device)
        actual_prompt = "Describe this image."

    # Handle dtype
    model_dtype = next(vision_model.parameters()).dtype
    if 'pixel_values' in inputs:
        inputs['pixel_values'] = inputs['pixel_values'].to(dtype=model_dtype)

    with torch.no_grad():
        # For BLIP-2, we need to generate from the model directly
        generated_ids = vision_model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            num_beams=5,
            do_sample=False,
            min_length=10,
        )

    # Decode - skip input tokens for prompted generation
    if prompt and 'input_ids' in inputs:
        # Only decode the newly generated tokens
        generated_text = vision_processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        # Remove the prompt from the output if it's echoed
        if generated_text.startswith(prompt):
            generated_text = generated_text[len(prompt):].strip()
        # Also check for "Question:" format
        if "Answer:" in generated_text:
            generated_text = generated_text.split("Answer:")[-1].strip()
    else:
        generated_text = vision_processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

    return (generated_text.strip(), actual_prompt)


def analyze_with_qwen_vl(images: List[Image.Image], prompt: Optional[str] = None, max_new_tokens: int = 512) -> tuple[str, str]:
    """Analyze image(s) using Qwen2-VL model. Supports multiple images.
    Returns tuple of (result, actual_prompt_used)."""
    global vision_model, vision_processor

    device = next(vision_model.parameters()).device

    # Default prompt based on number of images
    if prompt:
        text_prompt = prompt
    elif len(images) > 1:
        text_prompt = "Compare these images and describe the differences and similarities."
    else:
        text_prompt = "Describe this image in detail."

    # Qwen2-VL uses a specific message format - supports multiple images
    content = []
    for img in images:
        content.append({"type": "image", "image": img})
    content.append({"type": "text", "text": text_prompt})

    messages = [
        {
            "role": "user",
            "content": content,
        }
    ]

    add_log(f"Qwen-VL processing {len(images)} image(s) with prompt: {text_prompt[:50]}...")

    # Apply chat template
    text = vision_processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )

    # Process inputs
    from qwen_vl_utils import process_vision_info
    image_inputs, video_inputs = process_vision_info(messages)

    inputs = vision_processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    ).to(device)

    # Handle dtype
    model_dtype = next(vision_model.parameters()).dtype
    if 'pixel_values' in inputs:
        inputs['pixel_values'] = inputs['pixel_values'].to(dtype=model_dtype)

    with torch.no_grad():
        generated_ids = vision_model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
        )

    # Trim input tokens from output
    generated_ids_trimmed = [
        out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]

    generated_text = vision_processor.batch_decode(
        generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
    )[0]

    return (generated_text.strip(), text_prompt)


def analyze_with_generic(image: Image.Image, prompt: Optional[str] = None, max_new_tokens: int = 512) -> tuple[str, str]:
    """Analyze image using a generic vision-language model.
    Returns tuple of (result, actual_prompt_used)."""
    global vision_model, vision_processor

    device = next(vision_model.parameters()).device

    # Try to use the processor in a generic way
    if prompt:
        inputs = vision_processor(images=image, text=prompt, return_tensors="pt").to(device)
        actual_prompt = prompt
    else:
        inputs = vision_processor(images=image, return_tensors="pt").to(device)
        actual_prompt = "Describe this image."

    # Handle dtype
    model_dtype = next(vision_model.parameters()).dtype
    if 'pixel_values' in inputs:
        inputs['pixel_values'] = inputs['pixel_values'].to(dtype=model_dtype)

    with torch.no_grad():
        generated_ids = vision_model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
        )

    generated_text = vision_processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
    return (generated_text.strip(), actual_prompt)


async def analyze_image(
    images: List[Image.Image],
    prompt: Optional[str] = None,
    max_new_tokens: int = 512
) -> Dict[str, Any]:
    """Analyze image(s) using the loaded vision model."""
    global vision_model, vision_processor, vision_ready, model_type

    if not vision_ready or vision_model is None:
        raise HTTPException(status_code=503, detail="Vision model not loaded")

    if not images:
        raise HTTPException(status_code=400, detail="No images provided")

    try:
        start_time = time.time()

        # Route to appropriate handler based on model type
        # All handlers now return tuple of (description, actual_prompt_used)
        if model_type == "qwen-vl":
            # Qwen-VL supports multiple images
            description, prompt_used = analyze_with_qwen_vl(images, prompt, max_new_tokens)
        elif model_type == "blip2":
            # Single image models - use first image only
            if len(images) > 1:
                add_log(f"Note: BLIP-2 only supports single image, using first of {len(images)} images")
            description, prompt_used = analyze_with_blip2(images[0], prompt, max_new_tokens)
        elif model_type == "blip":
            if len(images) > 1:
                add_log(f"Note: BLIP only supports single image, using first of {len(images)} images")
            description, prompt_used = analyze_with_blip(images[0], prompt, max_new_tokens)
        elif model_type == "git":
            if len(images) > 1:
                add_log(f"Note: GIT only supports single image, using first of {len(images)} images")
            description, prompt_used = analyze_with_git(images[0], prompt, max_new_tokens)
        elif model_type == "vit-gpt2":
            if len(images) > 1:
                add_log(f"Note: ViT-GPT2 only supports single image, using first of {len(images)} images")
            description, prompt_used = analyze_with_vit_gpt2(images[0], prompt, max_new_tokens)
        else:
            if len(images) > 1:
                add_log(f"Note: This model only supports single image, using first of {len(images)} images")
            description, prompt_used = analyze_with_generic(images[0], prompt, max_new_tokens)

        processing_time = time.time() - start_time

        add_log(f"Analysis complete in {processing_time:.2f}s: {description[:100]}...")

        return {
            "description": description,
            "processing_time": processing_time,
            "model": vision_model_name,
            "prompt": prompt,
            "prompt_used": prompt_used,  # The actual prompt used (including auto-generated defaults)
            "images_count": len(images),
        }

    except Exception as e:
        add_log(f"Analysis error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Analysis error: {e}")


# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    return {"status": "online", "service": "Image-to-Text Server"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_ready": vision_ready,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/status")
async def status():
    vram = get_vram_stats()
    return {
        "model_ready": vision_ready,
        "model_loading": vision_loading,
        "model_name": vision_model_name,
        "model_type": model_type,
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "models_cache_path": str(models_cache),
        "analysis_count": len(analysis_history),
    }


# ============================================
# Model Loading Endpoints
# ============================================

@app.post("/load_model")
async def load_model(config: VisionModelConfig):
    """Load the vision-language model."""
    global vision_model, vision_processor, vit_gpt2_tokenizer, vision_model_name, vision_ready, vision_loading, model_type

    if vision_loading:
        return {"success": False, "error": "Model is already loading"}

    vision_loading = True

    try:
        if vision_model is not None:
            add_log("Unloading existing vision model...")
            vision_model.to("cpu")
            del vision_model
            vision_model = None
            del vision_processor
            vision_processor = None
            if vit_gpt2_tokenizer is not None:
                del vit_gpt2_tokenizer
                vit_gpt2_tokenizer = None
            clear_cuda()

        vision_model_name = config.model_name
        add_log(f"Loading vision model: {vision_model_name}")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        if config.device != "auto":
            device = config.device

        # Use shared model cache path
        cache_dir = str(models_cache)
        add_log(f"Using model cache: {cache_dir}")

        dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

        # Setup download progress logging
        try:
            from huggingface_hub import logging as hf_logging
            hf_logging.set_verbosity_info()
            # Enable tqdm progress bars
            os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '0'
        except Exception:
            pass

        # Detect model type and load appropriately
        model_name_lower = vision_model_name.lower()

        if "blip2" in model_name_lower or "blip-2" in model_name_lower:
            model_type = "blip2"
            add_log("Detected BLIP-2 model...")
            from transformers import Blip2Processor, Blip2ForConditionalGeneration

            vision_processor = Blip2Processor.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir
            )

            vision_model = Blip2ForConditionalGeneration.from_pretrained(
                vision_model_name,
                torch_dtype=dtype,
                cache_dir=cache_dir,
                low_cpu_mem_usage=True
            )

        elif "blip" in model_name_lower and "captioning" in model_name_lower:
            model_type = "blip"
            add_log("Detected BLIP captioning model...")
            from transformers import BlipProcessor, BlipForConditionalGeneration

            vision_processor = BlipProcessor.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir
            )

            vision_model = BlipForConditionalGeneration.from_pretrained(
                vision_model_name,
                torch_dtype=dtype,
                cache_dir=cache_dir,
                low_cpu_mem_usage=True
            )

        elif "git" in model_name_lower:
            model_type = "git"
            add_log("Detected Microsoft GIT model...")
            from transformers import AutoProcessor, AutoModelForCausalLM

            vision_processor = AutoProcessor.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir
            )

            vision_model = AutoModelForCausalLM.from_pretrained(
                vision_model_name,
                torch_dtype=dtype,
                cache_dir=cache_dir,
                low_cpu_mem_usage=True
            )

        elif "qwen2-vl" in model_name_lower or "qwen-vl" in model_name_lower:
            model_type = "qwen-vl"
            add_log("Detected Qwen2-VL model...")
            from transformers import Qwen2VLForConditionalGeneration, AutoProcessor

            vision_processor = AutoProcessor.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir
            )

            vision_model = Qwen2VLForConditionalGeneration.from_pretrained(
                vision_model_name,
                torch_dtype=dtype,
                cache_dir=cache_dir,
                low_cpu_mem_usage=True
            )

        elif "vit-gpt2" in model_name_lower or "vit_gpt2" in model_name_lower:
            model_type = "vit-gpt2"
            add_log("Detected ViT-GPT2 model...")
            from transformers import VisionEncoderDecoderModel, ViTImageProcessor, AutoTokenizer

            vision_processor = ViTImageProcessor.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir
            )

            # ViT-GPT2 needs a separate tokenizer for decoding text
            vit_gpt2_tokenizer = AutoTokenizer.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir
            )

            vision_model = VisionEncoderDecoderModel.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir,
                low_cpu_mem_usage=True
            )
            # ViT-GPT2 works better with float32
            dtype = torch.float32

        else:
            model_type = "other"
            add_log("Using generic AutoProcessor/AutoModelForVision2Seq...")
            from transformers import AutoProcessor, AutoModelForVision2Seq

            vision_processor = AutoProcessor.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir,
                trust_remote_code=True
            )

            vision_model = AutoModelForVision2Seq.from_pretrained(
                vision_model_name,
                torch_dtype=dtype,
                cache_dir=cache_dir,
                trust_remote_code=True,
                low_cpu_mem_usage=True
            )

        vision_model.to(device)
        vision_model.eval()
        vision_ready = True

        add_log(f"Vision model loaded on {device} (type: {model_type})")
        return {"success": True, "device": device, "model_name": vision_model_name, "model_type": model_type}

    except Exception as e:
        vision_ready = False
        add_log(f"Model load error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        vision_loading = False


@app.post("/unload_model")
async def unload_model():
    """Unload the vision model to free VRAM."""
    global vision_model, vision_processor, vit_gpt2_tokenizer, vision_ready, vision_model_name, model_type

    add_log("Unloading vision model...")

    if vision_model is not None:
        vision_model.to("cpu")
        del vision_model
        vision_model = None
        del vision_processor
        vision_processor = None
        if vit_gpt2_tokenizer is not None:
            del vit_gpt2_tokenizer
            vit_gpt2_tokenizer = None

    vision_ready = False
    vision_model_name = ""
    model_type = ""

    for _ in range(5):
        gc.collect()

    clear_cuda()

    add_log("Vision model unloaded")
    return {"success": True}


# ============================================
# Analysis Endpoints
# ============================================

@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    """Analyze image(s). Supports multiple images for Qwen-VL."""
    # Decode images - use images_b64 if provided, otherwise fall back to single image_b64
    images = []
    if request.images_b64 and len(request.images_b64) > 0:
        for i, img_b64 in enumerate(request.images_b64):
            img = decode_image(img_b64)
            images.append(img)
            add_log(f"Received image {i+1}: {img.size[0]}x{img.size[1]}")
    else:
        image = decode_image(request.image_b64)
        images.append(image)
        add_log(f"Received image: {image.size[0]}x{image.size[1]}")

    # Analyze
    result = await analyze_image(
        images,
        prompt=request.prompt,
        max_new_tokens=request.max_new_tokens
    )

    # Create thumbnail for history (use first image)
    thumbnail = create_thumbnail(images[0])

    # Add to history
    analysis_history.append({
        "timestamp": datetime.now().isoformat(),
        "description": result["description"],
        "processing_time": result["processing_time"],
        "prompt": request.prompt,
        "prompt_used": result.get("prompt_used"),
        "thumbnail": thumbnail,
    })

    # Keep history manageable
    if len(analysis_history) > 100:
        analysis_history[:] = analysis_history[-100:]

    return {"success": True, **result}


# ============================================
# History Endpoints
# ============================================

@app.get("/history")
async def get_history(limit: int = 50):
    """Get analysis history."""
    return {
        "success": True,
        "history": analysis_history[-limit:],
        "total": len(analysis_history)
    }


@app.post("/history/clear")
async def clear_history():
    """Clear analysis history."""
    global analysis_history
    analysis_history = []
    add_log("History cleared")
    return {"success": True}


# ============================================
# Cached Models Browser
# ============================================

@app.get("/cached_models")
async def get_cached_models():
    """Scan the HuggingFace cache directory and return list of downloaded vision models."""
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

        # Filter to vision-related models
        vision_keywords = ['florence', 'blip', 'clip', 'vit', 'vision', 'image', 'llava', 'cogvlm', 'qwen-vl', 'internlm-xcomposer']
        vision_models = [m for m in models if any(kw in m.lower() for kw in vision_keywords)]

        # Sort models alphabetically
        vision_models.sort()

        add_log(f"Found {len(vision_models)} vision models in cache")
        return {"success": True, "models": vision_models, "cache_path": str(cache_path)}

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

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8785
    print(f"Starting Image-to-Text server on port {port}...")
    print(f"Models cache path: {models_cache}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
