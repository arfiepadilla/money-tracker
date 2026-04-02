"""
Model Manager FastAPI Server
Provides endpoints for managing HuggingFace models - scanning, downloading, and deleting.
Includes GPU detection for model recommendations.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uvicorn
import os
import gc
import time
import json
import shutil
import asyncio
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import threading
import subprocess
import re

app = FastAPI(title="Model Manager Server")


# ============================================
# GPU Detection
# ============================================
def detect_gpu_info() -> Dict[str, Any]:
    """Detect GPU information including VRAM."""
    gpu_info = {
        "available": False,
        "gpus": [],
        "total_vram_gb": 0,
        "driver_version": None,
        "cuda_version": None,
        "recommendation_tier": "cpu",  # cpu, low, medium, high, ultra, datacenter
    }

    try:
        import torch
        if torch.cuda.is_available():
            gpu_info["available"] = True
            gpu_info["cuda_version"] = torch.version.cuda

            total_vram = 0
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                vram_gb = props.total_memory / (1024**3)
                total_vram += vram_gb

                gpu_info["gpus"].append({
                    "index": i,
                    "name": props.name,
                    "vram_gb": round(vram_gb, 1),
                    "compute_capability": f"{props.major}.{props.minor}",
                })

            gpu_info["total_vram_gb"] = round(total_vram, 1)

            # Determine recommendation tier based on total VRAM
            if total_vram >= 80:
                gpu_info["recommendation_tier"] = "datacenter"
            elif total_vram >= 40:
                gpu_info["recommendation_tier"] = "ultra"
            elif total_vram >= 20:
                gpu_info["recommendation_tier"] = "high"
            elif total_vram >= 10:
                gpu_info["recommendation_tier"] = "medium"
            elif total_vram >= 6:
                gpu_info["recommendation_tier"] = "low"
            else:
                gpu_info["recommendation_tier"] = "cpu"

    except ImportError:
        pass

    # Try nvidia-smi for driver info
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            gpu_info["driver_version"] = result.stdout.strip().split('\n')[0]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return gpu_info


# Cache GPU info (detected once at startup)
_gpu_info_cache = None

def get_gpu_info() -> Dict[str, Any]:
    """Get cached GPU info or detect if not cached."""
    global _gpu_info_cache
    if _gpu_info_cache is None:
        _gpu_info_cache = detect_gpu_info()
    return _gpu_info_cache

def refresh_gpu_info() -> Dict[str, Any]:
    """Force refresh GPU info."""
    global _gpu_info_cache
    _gpu_info_cache = detect_gpu_info()
    return _gpu_info_cache

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
    # Fallback: use default HuggingFace cache
    hf_home = os.environ.get('HF_HOME', os.path.expanduser('~/.cache/huggingface'))
    return Path(hf_home) / "hub"


def get_sdxl_models_path() -> Path:
    """Get SDXL models path from env var or fallback."""
    env_path = os.environ.get('CONTEXTUI_MODELS_PATH')
    if env_path:
        return Path(env_path) / "SDXL"
    return Path(__file__).parent.parent / "models" / "SDXL"


def get_all_model_paths() -> Dict[str, Path]:
    """Get all model storage paths."""
    return {
        "huggingface": get_models_cache_path(),
        "sdxl": get_sdxl_models_path(),
    }


# Global state
server_log: List[str] = []
download_progress: Dict[str, Dict[str, Any]] = {}
active_downloads: Dict[str, bool] = {}
executor = ThreadPoolExecutor(max_workers=2)


def add_log(message: str):
    """Add timestamped entry to server log."""
    global server_log
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    server_log.append(entry)
    if len(server_log) > 200:
        server_log = server_log[-200:]
    print(entry)


# ============================================
# Model Catalog - Organized by category with VRAM requirements
# vram_gb: minimum VRAM needed to run the model comfortably (with some headroom)
# Tiers: cpu (<6GB), low (6-10GB), medium (10-20GB), high (20-40GB), ultra (40-80GB), datacenter (80GB+)
# ============================================
MODEL_CATALOG = {
    "llm": {
        "name": "Large Language Models",
        "description": "Text generation and chat models",
        "models": [
            # ===== TINY (< 4GB VRAM) =====
            {
                "id": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
                "name": "TinyLlama 1.1B Chat",
                "description": "Ultra-compact chat model, runs on minimal hardware",
                "size": "~2.2GB",
                "size_bytes": 2200000000,
                "vram_gb": 3,
                "type": "huggingface",
                "tags": ["chat", "tiny", "cpu-friendly"],
                "tier": "cpu"
            },
            {
                "id": "microsoft/phi-1_5",
                "name": "Phi-1.5 (1.3B)",
                "description": "Microsoft's compact reasoning model",
                "size": "~2.8GB",
                "size_bytes": 2800000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["reasoning", "tiny", "cpu-friendly"],
                "tier": "cpu"
            },
            {
                "id": "stabilityai/stablelm-2-zephyr-1_6b",
                "name": "StableLM 2 Zephyr 1.6B",
                "description": "Stability AI's efficient chat model",
                "size": "~3.2GB",
                "size_bytes": 3200000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["chat", "tiny", "cpu-friendly"],
                "tier": "cpu"
            },
            # ===== SMALL (4-8GB VRAM) =====
            {
                "id": "google/gemma-2-2b-it",
                "name": "Gemma 2 2B Instruct",
                "description": "Google's efficient instruction-tuned model",
                "size": "~5GB",
                "size_bytes": 5000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["chat", "instruct", "efficient"],
                "tier": "low"
            },
            {
                "id": "Qwen/Qwen2.5-1.5B-Instruct",
                "name": "Qwen2.5 1.5B Instruct",
                "description": "Compact Qwen with strong capabilities",
                "size": "~3GB",
                "size_bytes": 3000000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["chat", "multilingual", "efficient"],
                "tier": "cpu"
            },
            {
                "id": "Qwen/Qwen2.5-3B-Instruct",
                "name": "Qwen2.5 3B Instruct",
                "description": "Compact multilingual model with strong reasoning",
                "size": "~6GB",
                "size_bytes": 6000000000,
                "vram_gb": 7,
                "type": "huggingface",
                "tags": ["chat", "multilingual", "balanced"],
                "tier": "low"
            },
            {
                "id": "meta-llama/Llama-3.2-1B-Instruct",
                "name": "Llama 3.2 1B Instruct",
                "description": "Meta's smallest Llama 3.2 model",
                "size": "~2.5GB",
                "size_bytes": 2500000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["chat", "instruct", "tiny"],
                "tier": "cpu"
            },
            {
                "id": "meta-llama/Llama-3.2-3B-Instruct",
                "name": "Llama 3.2 3B Instruct",
                "description": "Meta's compact Llama 3.2 model",
                "size": "~6GB",
                "size_bytes": 6000000000,
                "vram_gb": 7,
                "type": "huggingface",
                "tags": ["chat", "instruct", "balanced"],
                "tier": "low"
            },
            {
                "id": "microsoft/Phi-3-mini-4k-instruct",
                "name": "Phi-3 Mini 4K (3.8B)",
                "description": "Microsoft's efficient instruction model",
                "size": "~7.6GB",
                "size_bytes": 7600000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["chat", "instruct", "efficient"],
                "tier": "low"
            },
            {
                "id": "microsoft/Phi-3.5-mini-instruct",
                "name": "Phi-3.5 Mini (3.8B)",
                "description": "Latest Phi with improved capabilities",
                "size": "~7.6GB",
                "size_bytes": 7600000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["chat", "instruct", "efficient"],
                "tier": "low"
            },
            # ===== MEDIUM (8-16GB VRAM) =====
            {
                "id": "Qwen/Qwen2.5-7B-Instruct",
                "name": "Qwen2.5 7B Instruct",
                "description": "Powerful multilingual model, great for complex tasks",
                "size": "~14GB",
                "size_bytes": 14000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["chat", "multilingual", "powerful"],
                "tier": "medium"
            },
            {
                "id": "mistralai/Mistral-7B-Instruct-v0.3",
                "name": "Mistral 7B Instruct v0.3",
                "description": "High-quality general-purpose instruction model",
                "size": "~14GB",
                "size_bytes": 14000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["chat", "instruct", "popular"],
                "tier": "medium"
            },
            {
                "id": "meta-llama/Meta-Llama-3-8B-Instruct",
                "name": "Llama 3 8B Instruct",
                "description": "Meta's Llama 3 with strong instruction following",
                "size": "~16GB",
                "size_bytes": 16000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["chat", "instruct", "powerful"],
                "tier": "medium"
            },
            {
                "id": "meta-llama/Llama-3.1-8B-Instruct",
                "name": "Llama 3.1 8B Instruct",
                "description": "Latest Llama 3.1 with extended context",
                "size": "~16GB",
                "size_bytes": 16000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["chat", "instruct", "powerful", "long-context"],
                "tier": "medium"
            },
            {
                "id": "google/gemma-2-9b-it",
                "name": "Gemma 2 9B Instruct",
                "description": "Google's powerful 9B instruction model",
                "size": "~18GB",
                "size_bytes": 18000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["chat", "instruct", "powerful"],
                "tier": "medium"
            },
            {
                "id": "microsoft/Phi-3-medium-4k-instruct",
                "name": "Phi-3 Medium (14B)",
                "description": "Microsoft's larger Phi model",
                "size": "~28GB",
                "size_bytes": 28000000000,
                "vram_gb": 16,
                "type": "huggingface",
                "tags": ["chat", "instruct", "powerful"],
                "tier": "medium"
            },
            # ===== LARGE (16-24GB VRAM) =====
            {
                "id": "Qwen/Qwen2.5-14B-Instruct",
                "name": "Qwen2.5 14B Instruct",
                "description": "Large Qwen model with excellent reasoning",
                "size": "~28GB",
                "size_bytes": 28000000000,
                "vram_gb": 18,
                "type": "huggingface",
                "tags": ["chat", "multilingual", "powerful"],
                "tier": "high"
            },
            {
                "id": "mistralai/Mixtral-8x7B-Instruct-v0.1",
                "name": "Mixtral 8x7B Instruct",
                "description": "Mixture-of-experts model with great performance",
                "size": "~93GB",
                "size_bytes": 93000000000,
                "vram_gb": 24,
                "type": "huggingface",
                "tags": ["chat", "moe", "powerful"],
                "tier": "high"
            },
            {
                "id": "OpenSourceAI/gpt-oss-20b",
                "name": "GPT-OSS 20B",
                "description": "Open-source GPT-style model with excellent reasoning",
                "size": "~40GB",
                "size_bytes": 40000000000,
                "vram_gb": 24,
                "type": "huggingface",
                "tags": ["chat", "gpt", "powerful"],
                "tier": "high"
            },
            {
                "id": "OpenSourceAI/gpt-oss-20b-instruct",
                "name": "GPT-OSS 20B Instruct",
                "description": "Instruction-tuned GPT-OSS 20B for chat",
                "size": "~40GB",
                "size_bytes": 40000000000,
                "vram_gb": 24,
                "type": "huggingface",
                "tags": ["chat", "gpt", "instruct"],
                "tier": "high"
            },
            # ===== EXTRA LARGE (24-48GB VRAM) =====
            {
                "id": "Qwen/Qwen2.5-32B-Instruct",
                "name": "Qwen2.5 32B Instruct",
                "description": "Very large Qwen with excellent capabilities",
                "size": "~65GB",
                "size_bytes": 65000000000,
                "vram_gb": 36,
                "type": "huggingface",
                "tags": ["chat", "multilingual", "very-powerful"],
                "tier": "ultra"
            },
            {
                "id": "google/gemma-2-27b-it",
                "name": "Gemma 2 27B Instruct",
                "description": "Google's largest Gemma 2 model",
                "size": "~54GB",
                "size_bytes": 54000000000,
                "vram_gb": 32,
                "type": "huggingface",
                "tags": ["chat", "instruct", "very-powerful"],
                "tier": "ultra"
            },
            {
                "id": "meta-llama/Meta-Llama-3-70B-Instruct",
                "name": "Llama 3 70B Instruct",
                "description": "Meta's flagship 70B model",
                "size": "~140GB",
                "size_bytes": 140000000000,
                "vram_gb": 44,
                "type": "huggingface",
                "tags": ["chat", "instruct", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "meta-llama/Llama-3.1-70B-Instruct",
                "name": "Llama 3.1 70B Instruct",
                "description": "Latest 70B Llama with extended context",
                "size": "~140GB",
                "size_bytes": 140000000000,
                "vram_gb": 44,
                "type": "huggingface",
                "tags": ["chat", "instruct", "flagship", "long-context"],
                "tier": "ultra"
            },
            # ===== DATACENTER (80GB+ VRAM) =====
            {
                "id": "Qwen/Qwen2.5-72B-Instruct",
                "name": "Qwen2.5 72B Instruct",
                "description": "Qwen's flagship model with top-tier performance",
                "size": "~145GB",
                "size_bytes": 145000000000,
                "vram_gb": 80,
                "type": "huggingface",
                "tags": ["chat", "multilingual", "flagship"],
                "tier": "datacenter"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b",
                "name": "GPT-OSS 120B",
                "description": "Flagship GPT-OSS model with exceptional reasoning",
                "size": "~240GB",
                "size_bytes": 240000000000,
                "vram_gb": 140,
                "type": "huggingface",
                "tags": ["chat", "gpt", "flagship"],
                "tier": "datacenter"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-instruct",
                "name": "GPT-OSS 120B Instruct",
                "description": "Instruction-tuned GPT-OSS 120B for advanced tasks",
                "size": "~240GB",
                "size_bytes": 240000000000,
                "vram_gb": 140,
                "type": "huggingface",
                "tags": ["chat", "gpt", "instruct", "flagship"],
                "tier": "datacenter"
            },
            {
                "id": "mistralai/Mixtral-8x22B-Instruct-v0.1",
                "name": "Mixtral 8x22B Instruct",
                "description": "Massive MoE model with exceptional performance",
                "size": "~262GB",
                "size_bytes": 262000000000,
                "vram_gb": 100,
                "type": "huggingface",
                "tags": ["chat", "moe", "flagship"],
                "tier": "datacenter"
            },
            {
                "id": "meta-llama/Llama-3.1-405B-Instruct",
                "name": "Llama 3.1 405B Instruct",
                "description": "Meta's largest open model - requires multi-GPU",
                "size": "~810GB",
                "size_bytes": 810000000000,
                "vram_gb": 400,
                "type": "huggingface",
                "tags": ["chat", "instruct", "largest"],
                "tier": "datacenter"
            },
        ]
    },
    "code": {
        "name": "Code Models",
        "description": "Specialized models for programming tasks",
        "models": [
            # ===== SMALL =====
            {
                "id": "bigcode/tiny_starcoder_py",
                "name": "Tiny StarCoder Python",
                "description": "Ultra-compact Python code model",
                "size": "~300MB",
                "size_bytes": 300000000,
                "vram_gb": 2,
                "type": "huggingface",
                "tags": ["code", "python", "tiny"],
                "tier": "cpu"
            },
            {
                "id": "bigcode/starcoderbase-1b",
                "name": "StarCoder Base 1B",
                "description": "Compact multi-language code model",
                "size": "~2GB",
                "size_bytes": 2000000000,
                "vram_gb": 3,
                "type": "huggingface",
                "tags": ["code", "completion", "tiny"],
                "tier": "cpu"
            },
            {
                "id": "Qwen/Qwen2.5-Coder-1.5B-Instruct",
                "name": "Qwen2.5 Coder 1.5B",
                "description": "Compact code model with instruction following",
                "size": "~3GB",
                "size_bytes": 3000000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["code", "instruct", "tiny"],
                "tier": "cpu"
            },
            {
                "id": "deepseek-ai/deepseek-coder-1.3b-instruct",
                "name": "DeepSeek Coder 1.3B",
                "description": "Efficient code generation model",
                "size": "~2.6GB",
                "size_bytes": 2600000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["code", "instruct", "tiny"],
                "tier": "cpu"
            },
            # ===== MEDIUM =====
            {
                "id": "bigcode/starcoder2-3b",
                "name": "StarCoder2 3B",
                "description": "Efficient code completion model",
                "size": "~6GB",
                "size_bytes": 6000000000,
                "vram_gb": 7,
                "type": "huggingface",
                "tags": ["code", "completion", "efficient"],
                "tier": "low"
            },
            {
                "id": "Qwen/Qwen2.5-Coder-3B-Instruct",
                "name": "Qwen2.5 Coder 3B",
                "description": "Balanced code model",
                "size": "~6GB",
                "size_bytes": 6000000000,
                "vram_gb": 7,
                "type": "huggingface",
                "tags": ["code", "instruct", "balanced"],
                "tier": "low"
            },
            {
                "id": "codellama/CodeLlama-7b-Instruct-hf",
                "name": "CodeLlama 7B Instruct",
                "description": "Meta's code-specialized Llama variant",
                "size": "~14GB",
                "size_bytes": 14000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["code", "instruct", "popular"],
                "tier": "medium"
            },
            {
                "id": "bigcode/starcoder2-7b",
                "name": "StarCoder2 7B",
                "description": "Open-source code completion model",
                "size": "~14GB",
                "size_bytes": 14000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["code", "completion", "popular"],
                "tier": "medium"
            },
            {
                "id": "Qwen/Qwen2.5-Coder-7B-Instruct",
                "name": "Qwen2.5 Coder 7B",
                "description": "Powerful code generation with instruction following",
                "size": "~14GB",
                "size_bytes": 14000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["code", "instruct", "powerful"],
                "tier": "medium"
            },
            {
                "id": "deepseek-ai/deepseek-coder-6.7b-instruct",
                "name": "DeepSeek Coder 6.7B",
                "description": "Strong code generation with instruction following",
                "size": "~13GB",
                "size_bytes": 13000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["code", "instruct", "powerful"],
                "tier": "medium"
            },
            # ===== LARGE =====
            {
                "id": "codellama/CodeLlama-13b-Instruct-hf",
                "name": "CodeLlama 13B Instruct",
                "description": "Larger CodeLlama for complex code tasks",
                "size": "~26GB",
                "size_bytes": 26000000000,
                "vram_gb": 16,
                "type": "huggingface",
                "tags": ["code", "instruct", "powerful"],
                "tier": "medium"
            },
            {
                "id": "bigcode/starcoder2-15b",
                "name": "StarCoder2 15B",
                "description": "Large code completion model",
                "size": "~30GB",
                "size_bytes": 30000000000,
                "vram_gb": 18,
                "type": "huggingface",
                "tags": ["code", "completion", "powerful"],
                "tier": "high"
            },
            {
                "id": "Qwen/Qwen2.5-Coder-14B-Instruct",
                "name": "Qwen2.5 Coder 14B",
                "description": "Large code model with excellent accuracy",
                "size": "~28GB",
                "size_bytes": 28000000000,
                "vram_gb": 18,
                "type": "huggingface",
                "tags": ["code", "instruct", "powerful"],
                "tier": "high"
            },
            {
                "id": "deepseek-ai/deepseek-coder-33b-instruct",
                "name": "DeepSeek Coder 33B",
                "description": "Large code model with strong performance",
                "size": "~66GB",
                "size_bytes": 66000000000,
                "vram_gb": 40,
                "type": "huggingface",
                "tags": ["code", "instruct", "very-powerful"],
                "tier": "ultra"
            },
            # ===== EXTRA LARGE =====
            {
                "id": "codellama/CodeLlama-34b-Instruct-hf",
                "name": "CodeLlama 34B Instruct",
                "description": "Largest CodeLlama for complex programming",
                "size": "~68GB",
                "size_bytes": 68000000000,
                "vram_gb": 40,
                "type": "huggingface",
                "tags": ["code", "instruct", "very-powerful"],
                "tier": "ultra"
            },
            {
                "id": "Qwen/Qwen2.5-Coder-32B-Instruct",
                "name": "Qwen2.5 Coder 32B",
                "description": "Flagship Qwen code model",
                "size": "~65GB",
                "size_bytes": 65000000000,
                "vram_gb": 40,
                "type": "huggingface",
                "tags": ["code", "instruct", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "codellama/CodeLlama-70b-Instruct-hf",
                "name": "CodeLlama 70B Instruct",
                "description": "Massive CodeLlama for enterprise use",
                "size": "~140GB",
                "size_bytes": 140000000000,
                "vram_gb": 80,
                "type": "huggingface",
                "tags": ["code", "instruct", "flagship"],
                "tier": "datacenter"
            },
        ]
    },
    "image": {
        "name": "Image Generation",
        "description": "Stable Diffusion and image models",
        "models": [
            # ===== SD 1.5 (Low VRAM) =====
            {
                "id": "runwayml/stable-diffusion-v1-5",
                "name": "Stable Diffusion 1.5",
                "description": "Classic SD model, very compatible",
                "size": "~4GB",
                "size_bytes": 4000000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["image", "sd15", "classic"],
                "tier": "cpu"
            },
            {
                "id": "prompthero/openjourney-v4",
                "name": "OpenJourney v4",
                "description": "Midjourney-style SD 1.5 fine-tune",
                "size": "~2GB",
                "size_bytes": 2000000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["image", "sd15", "artistic"],
                "tier": "cpu"
            },
            # ===== SD 2.x =====
            {
                "id": "stabilityai/stable-diffusion-2-1",
                "name": "Stable Diffusion 2.1",
                "description": "Improved SD with 768px output",
                "size": "~5GB",
                "size_bytes": 5000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["image", "sd21"],
                "tier": "low"
            },
            # ===== SDXL =====
            {
                "id": "stabilityai/stable-diffusion-xl-base-1.0",
                "name": "SDXL Base 1.0",
                "description": "High-quality 1024x1024 image generation",
                "size": "~6.5GB",
                "size_bytes": 6500000000,
                "vram_gb": 8,
                "type": "sdxl",
                "filename": "sd_xl_base_1.0_0.9vae.safetensors",
                "tags": ["image", "sdxl", "base"],
                "tier": "low"
            },
            {
                "id": "stabilityai/sdxl-turbo",
                "name": "SDXL Turbo",
                "description": "Fast SDXL with 1-4 step generation",
                "size": "~6.5GB",
                "size_bytes": 6500000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["image", "sdxl", "fast"],
                "tier": "low"
            },
            {
                "id": "SG161222/RealVisXL_V5.0",
                "name": "RealVisXL V5.0",
                "description": "Photorealistic SDXL fine-tune",
                "size": "~6.5GB",
                "size_bytes": 6500000000,
                "vram_gb": 8,
                "type": "sdxl",
                "filename": "RealVisXL_V5.0_fp16.safetensors",
                "tags": ["image", "sdxl", "realistic"],
                "tier": "low"
            },
            {
                "id": "Lykon/dreamshaper-xl-1-0",
                "name": "DreamShaper XL 1.0",
                "description": "Versatile artistic SDXL model",
                "size": "~6.5GB",
                "size_bytes": 6500000000,
                "vram_gb": 8,
                "type": "sdxl",
                "filename": "dreamshaperXL_v21TurboDPMSDE.safetensors",
                "tags": ["image", "sdxl", "artistic"],
                "tier": "low"
            },
            {
                "id": "playgroundai/playground-v2.5-1024px-aesthetic",
                "name": "Playground v2.5",
                "description": "High aesthetic quality SDXL model",
                "size": "~6.5GB",
                "size_bytes": 6500000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["image", "sdxl", "aesthetic"],
                "tier": "low"
            },
            # ===== SD3 / Flux =====
            {
                "id": "stabilityai/stable-diffusion-3-medium-diffusers",
                "name": "Stable Diffusion 3 Medium",
                "description": "Latest SD3 with improved text rendering",
                "size": "~11GB",
                "size_bytes": 11000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["image", "sd3", "text-rendering"],
                "tier": "medium"
            },
            {
                "id": "black-forest-labs/FLUX.1-schnell",
                "name": "FLUX.1 Schnell",
                "description": "Fast high-quality image generation",
                "size": "~23GB",
                "size_bytes": 23000000000,
                "vram_gb": 16,
                "type": "huggingface",
                "tags": ["image", "flux", "fast"],
                "tier": "medium"
            },
            {
                "id": "black-forest-labs/FLUX.1-dev",
                "name": "FLUX.1 Dev",
                "description": "Development version of FLUX",
                "size": "~23GB",
                "size_bytes": 23000000000,
                "vram_gb": 16,
                "type": "huggingface",
                "tags": ["image", "flux", "quality"],
                "tier": "medium"
            },
        ]
    },
    "audio": {
        "name": "Audio & Music",
        "description": "Music generation and audio synthesis",
        "models": [
            # ===== TINY =====
            {
                "id": "facebook/musicgen-small",
                "name": "MusicGen Small",
                "description": "Fast music generation, 300M parameters",
                "size": "~1.2GB",
                "size_bytes": 1200000000,
                "vram_gb": 3,
                "type": "huggingface",
                "tags": ["audio", "music", "fast"],
                "tier": "cpu"
            },
            {
                "id": "suno/bark-small",
                "name": "Bark Small",
                "description": "Compact text-to-speech with voices",
                "size": "~1GB",
                "size_bytes": 1000000000,
                "vram_gb": 3,
                "type": "huggingface",
                "tags": ["audio", "tts", "tiny"],
                "tier": "cpu"
            },
            # ===== MEDIUM =====
            {
                "id": "facebook/musicgen-medium",
                "name": "MusicGen Medium",
                "description": "Balanced quality/speed music generation",
                "size": "~3.5GB",
                "size_bytes": 3500000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["audio", "music", "balanced"],
                "tier": "low"
            },
            {
                "id": "suno/bark",
                "name": "Bark",
                "description": "Text-to-speech with emotions and voices",
                "size": "~5GB",
                "size_bytes": 5000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["audio", "tts", "expressive"],
                "tier": "low"
            },
            {
                "id": "openai/whisper-medium",
                "name": "Whisper Medium",
                "description": "Speech recognition - balanced",
                "size": "~1.5GB",
                "size_bytes": 1500000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["audio", "transcription", "balanced"],
                "tier": "cpu"
            },
            # ===== LARGE =====
            {
                "id": "facebook/musicgen-large",
                "name": "MusicGen Large",
                "description": "High quality music generation",
                "size": "~7GB",
                "size_bytes": 7000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["audio", "music", "quality"],
                "tier": "medium"
            },
            {
                "id": "facebook/musicgen-melody",
                "name": "MusicGen Melody",
                "description": "Music generation with melody conditioning",
                "size": "~7GB",
                "size_bytes": 7000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["audio", "music", "melody"],
                "tier": "medium"
            },
            {
                "id": "facebook/musicgen-melody-large",
                "name": "MusicGen Melody Large",
                "description": "Large melody-conditioned music model",
                "size": "~14GB",
                "size_bytes": 14000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["audio", "music", "melody", "quality"],
                "tier": "medium"
            },
            {
                "id": "openai/whisper-large-v3",
                "name": "Whisper Large v3",
                "description": "Best quality speech recognition",
                "size": "~3GB",
                "size_bytes": 3000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["audio", "transcription", "best"],
                "tier": "low"
            },
            # ===== EXTRA LARGE =====
            {
                "id": "cvssp/audioldm2-large",
                "name": "AudioLDM2 Large",
                "description": "Text-to-audio generation",
                "size": "~8GB",
                "size_bytes": 8000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["audio", "generation", "large"],
                "tier": "medium"
            },
            {
                "id": "facebook/audiogen-medium",
                "name": "AudioGen Medium",
                "description": "General audio generation",
                "size": "~3.5GB",
                "size_bytes": 3500000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["audio", "generation", "balanced"],
                "tier": "low"
            },
        ]
    },
    "embedding": {
        "name": "Embedding Models",
        "description": "Text embeddings for RAG and semantic search",
        "models": [
            # ===== TINY =====
            {
                "id": "sentence-transformers/all-MiniLM-L6-v2",
                "name": "MiniLM L6 v2",
                "description": "Fast sentence embeddings, great for RAG",
                "size": "~90MB",
                "size_bytes": 90000000,
                "vram_gb": 1,
                "type": "huggingface",
                "tags": ["embedding", "tiny", "fast"],
                "tier": "cpu"
            },
            {
                "id": "sentence-transformers/paraphrase-MiniLM-L3-v2",
                "name": "MiniLM L3 v2",
                "description": "Ultra-fast embeddings for simple tasks",
                "size": "~60MB",
                "size_bytes": 60000000,
                "vram_gb": 1,
                "type": "huggingface",
                "tags": ["embedding", "tiny", "fastest"],
                "tier": "cpu"
            },
            # ===== SMALL =====
            {
                "id": "BAAI/bge-small-en-v1.5",
                "name": "BGE Small English",
                "description": "High-quality compact embeddings",
                "size": "~130MB",
                "size_bytes": 130000000,
                "vram_gb": 1,
                "type": "huggingface",
                "tags": ["embedding", "small", "quality"],
                "tier": "cpu"
            },
            {
                "id": "thenlper/gte-small",
                "name": "GTE Small",
                "description": "Efficient general text embeddings",
                "size": "~130MB",
                "size_bytes": 130000000,
                "vram_gb": 1,
                "type": "huggingface",
                "tags": ["embedding", "small", "general"],
                "tier": "cpu"
            },
            # ===== MEDIUM =====
            {
                "id": "BAAI/bge-base-en-v1.5",
                "name": "BGE Base English",
                "description": "Balanced embedding model",
                "size": "~440MB",
                "size_bytes": 440000000,
                "vram_gb": 2,
                "type": "huggingface",
                "tags": ["embedding", "balanced"],
                "tier": "cpu"
            },
            {
                "id": "thenlper/gte-base",
                "name": "GTE Base",
                "description": "General text embeddings - balanced",
                "size": "~440MB",
                "size_bytes": 440000000,
                "vram_gb": 2,
                "type": "huggingface",
                "tags": ["embedding", "balanced"],
                "tier": "cpu"
            },
            {
                "id": "sentence-transformers/all-mpnet-base-v2",
                "name": "MPNet Base v2",
                "description": "High-quality sentence embeddings",
                "size": "~420MB",
                "size_bytes": 420000000,
                "vram_gb": 2,
                "type": "huggingface",
                "tags": ["embedding", "quality"],
                "tier": "cpu"
            },
            # ===== LARGE =====
            {
                "id": "BAAI/bge-large-en-v1.5",
                "name": "BGE Large English",
                "description": "High-quality large embeddings",
                "size": "~1.3GB",
                "size_bytes": 1300000000,
                "vram_gb": 3,
                "type": "huggingface",
                "tags": ["embedding", "large", "quality"],
                "tier": "cpu"
            },
            {
                "id": "thenlper/gte-large",
                "name": "GTE Large",
                "description": "Large general text embeddings",
                "size": "~1.3GB",
                "size_bytes": 1300000000,
                "vram_gb": 3,
                "type": "huggingface",
                "tags": ["embedding", "large"],
                "tier": "cpu"
            },
            {
                "id": "intfloat/e5-large-v2",
                "name": "E5 Large v2",
                "description": "Excellent retrieval embeddings",
                "size": "~1.3GB",
                "size_bytes": 1300000000,
                "vram_gb": 3,
                "type": "huggingface",
                "tags": ["embedding", "large", "retrieval"],
                "tier": "cpu"
            },
            # ===== MULTILINGUAL =====
            {
                "id": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                "name": "Multilingual MiniLM L12",
                "description": "Fast multilingual embeddings",
                "size": "~470MB",
                "size_bytes": 470000000,
                "vram_gb": 2,
                "type": "huggingface",
                "tags": ["embedding", "multilingual", "fast"],
                "tier": "cpu"
            },
            {
                "id": "intfloat/multilingual-e5-large",
                "name": "Multilingual E5 Large",
                "description": "High-quality multilingual embeddings",
                "size": "~2.2GB",
                "size_bytes": 2200000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["embedding", "multilingual", "large"],
                "tier": "cpu"
            },
            {
                "id": "BAAI/bge-m3",
                "name": "BGE M3",
                "description": "Multi-lingual, multi-granularity embeddings",
                "size": "~2.3GB",
                "size_bytes": 2300000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["embedding", "multilingual", "versatile"],
                "tier": "cpu"
            },
        ]
    },
    "vision": {
        "name": "Vision & Multimodal",
        "description": "Image understanding and vision-language models",
        "models": [
            # ===== TINY =====
            {
                "id": "openai/clip-vit-base-patch32",
                "name": "CLIP ViT Base",
                "description": "Image-text matching baseline",
                "size": "~600MB",
                "size_bytes": 600000000,
                "vram_gb": 2,
                "type": "huggingface",
                "tags": ["vision", "clip", "tiny"],
                "tier": "cpu"
            },
            {
                "id": "google/vit-base-patch16-224",
                "name": "ViT Base",
                "description": "Vision Transformer for image classification",
                "size": "~350MB",
                "size_bytes": 350000000,
                "vram_gb": 2,
                "type": "huggingface",
                "tags": ["vision", "classification", "tiny"],
                "tier": "cpu"
            },
            # ===== SMALL =====
            {
                "id": "Salesforce/blip2-opt-2.7b",
                "name": "BLIP-2 OPT 2.7B",
                "description": "Image captioning and VQA",
                "size": "~8GB",
                "size_bytes": 8000000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["vision", "captioning", "vqa"],
                "tier": "low"
            },
            {
                "id": "microsoft/Florence-2-base",
                "name": "Florence-2 Base",
                "description": "Unified vision model for multiple tasks",
                "size": "~1GB",
                "size_bytes": 1000000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["vision", "unified", "efficient"],
                "tier": "cpu"
            },
            # ===== MEDIUM =====
            {
                "id": "llava-hf/llava-1.5-7b-hf",
                "name": "LLaVA 1.5 7B",
                "description": "Vision-language model for image chat",
                "size": "~14GB",
                "size_bytes": 14000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["vision", "chat", "multimodal"],
                "tier": "medium"
            },
            {
                "id": "Salesforce/blip2-opt-6.7b",
                "name": "BLIP-2 OPT 6.7B",
                "description": "Larger image understanding model",
                "size": "~16GB",
                "size_bytes": 16000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["vision", "captioning", "powerful"],
                "tier": "medium"
            },
            {
                "id": "microsoft/Florence-2-large",
                "name": "Florence-2 Large",
                "description": "Larger unified vision model",
                "size": "~1.5GB",
                "size_bytes": 1500000000,
                "vram_gb": 4,
                "type": "huggingface",
                "tags": ["vision", "unified", "quality"],
                "tier": "cpu"
            },
            # ===== LARGE =====
            {
                "id": "llava-hf/llava-1.5-13b-hf",
                "name": "LLaVA 1.5 13B",
                "description": "Larger vision-language model",
                "size": "~26GB",
                "size_bytes": 26000000000,
                "vram_gb": 18,
                "type": "huggingface",
                "tags": ["vision", "chat", "powerful"],
                "tier": "high"
            },
            {
                "id": "Qwen/Qwen2-VL-7B-Instruct",
                "name": "Qwen2-VL 7B",
                "description": "Qwen's vision-language model",
                "size": "~16GB",
                "size_bytes": 16000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["vision", "chat", "powerful"],
                "tier": "medium"
            },
            # ===== EXTRA LARGE =====
            {
                "id": "llava-hf/llava-v1.6-34b-hf",
                "name": "LLaVA 1.6 34B",
                "description": "Large vision-language model",
                "size": "~68GB",
                "size_bytes": 68000000000,
                "vram_gb": 44,
                "type": "huggingface",
                "tags": ["vision", "chat", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "Qwen/Qwen2-VL-72B-Instruct",
                "name": "Qwen2-VL 72B",
                "description": "Qwen's flagship vision-language model",
                "size": "~145GB",
                "size_bytes": 145000000000,
                "vram_gb": 80,
                "type": "huggingface",
                "tags": ["vision", "chat", "flagship"],
                "tier": "datacenter"
            },
        ]
    },
    "video": {
        "name": "Video Generation",
        "description": "AI video generation and animation models",
        "models": [
            # ===== SMALL =====
            {
                "id": "ali-vilab/text-to-video-ms-1.7b",
                "name": "ModelScope T2V 1.7B",
                "description": "Text-to-video generation, compact model",
                "size": "~7GB",
                "size_bytes": 7000000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["video", "text-to-video", "efficient"],
                "tier": "low"
            },
            {
                "id": "cerspense/zeroscope_v2_576w",
                "name": "ZeroScope v2 576w",
                "description": "Text-to-video, 576x320 output",
                "size": "~9GB",
                "size_bytes": 9000000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["video", "text-to-video", "low-res"],
                "tier": "low"
            },
            {
                "id": "cerspense/zeroscope_v2_XL",
                "name": "ZeroScope v2 XL",
                "description": "Text-to-video upscaler, 1024x576 output",
                "size": "~9GB",
                "size_bytes": 9000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["video", "upscaler", "high-res"],
                "tier": "medium"
            },
            # ===== MEDIUM =====
            {
                "id": "stabilityai/stable-video-diffusion-img2vid",
                "name": "Stable Video Diffusion",
                "description": "Image-to-video animation from Stability AI",
                "size": "~10GB",
                "size_bytes": 10000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["video", "img2vid", "animation"],
                "tier": "medium"
            },
            {
                "id": "stabilityai/stable-video-diffusion-img2vid-xt",
                "name": "SVD-XT (25 frames)",
                "description": "Extended SVD for longer video clips",
                "size": "~10GB",
                "size_bytes": 10000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["video", "img2vid", "extended"],
                "tier": "medium"
            },
            {
                "id": "guoyww/animatediff-motion-adapter-v1-5-2",
                "name": "AnimateDiff v1.5.2",
                "description": "Motion adapter for SD 1.5 animation",
                "size": "~1.8GB",
                "size_bytes": 1800000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["video", "animation", "sd15"],
                "tier": "low"
            },
            {
                "id": "ByteDance/AnimateDiff-Lightning",
                "name": "AnimateDiff Lightning",
                "description": "Fast 4-step AnimateDiff variant",
                "size": "~1.8GB",
                "size_bytes": 1800000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["video", "animation", "fast"],
                "tier": "low"
            },
            # ===== LARGE =====
            {
                "id": "THUDM/CogVideoX-2b",
                "name": "CogVideoX 2B",
                "description": "Tsinghua's text-to-video model",
                "size": "~10GB",
                "size_bytes": 10000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["video", "text-to-video", "quality"],
                "tier": "medium"
            },
            {
                "id": "THUDM/CogVideoX-5b",
                "name": "CogVideoX 5B",
                "description": "Larger CogVideo for better quality",
                "size": "~20GB",
                "size_bytes": 20000000000,
                "vram_gb": 18,
                "type": "huggingface",
                "tags": ["video", "text-to-video", "quality"],
                "tier": "high"
            },
            {
                "id": "Lightricks/LTX-Video",
                "name": "LTX-Video",
                "description": "Fast text/image-to-video generation",
                "size": "~10GB",
                "size_bytes": 10000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["video", "fast", "quality"],
                "tier": "medium"
            },
            # ===== EXTRA LARGE =====
            {
                "id": "genmo/mochi-1-preview",
                "name": "Mochi 1 Preview",
                "description": "High-quality text-to-video by Genmo",
                "size": "~20GB",
                "size_bytes": 20000000000,
                "vram_gb": 24,
                "type": "huggingface",
                "tags": ["video", "text-to-video", "high-quality"],
                "tier": "high"
            },
            {
                "id": "black-forest-labs/FLUX.1-Canny-dev",
                "name": "FLUX Canny (Video)",
                "description": "FLUX-based video with edge control",
                "size": "~23GB",
                "size_bytes": 23000000000,
                "vram_gb": 20,
                "type": "huggingface",
                "tags": ["video", "controlnet", "flux"],
                "tier": "high"
            },
        ]
    },
    "quantized": {
        "name": "Quantized LLMs",
        "description": "Run larger models on smaller GPUs with GGUF/AWQ/GPTQ quantization",
        "models": [
            # ===== 4-bit Quantized (Run on 8GB GPUs) =====
            {
                "id": "TheBloke/Llama-2-7B-Chat-GGUF",
                "name": "Llama 2 7B Chat (GGUF Q4)",
                "description": "4-bit quantized Llama 2, runs on 8GB GPU",
                "size": "~4GB",
                "size_bytes": 4000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["llm", "gguf", "4-bit", "llama"],
                "tier": "low"
            },
            {
                "id": "TheBloke/Llama-2-13B-chat-GGUF",
                "name": "Llama 2 13B Chat (GGUF Q4)",
                "description": "4-bit quantized Llama 2 13B, runs on 10GB GPU",
                "size": "~7.5GB",
                "size_bytes": 7500000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["llm", "gguf", "4-bit", "llama"],
                "tier": "low"
            },
            {
                "id": "TheBloke/Mistral-7B-Instruct-v0.2-GGUF",
                "name": "Mistral 7B v0.2 (GGUF Q4)",
                "description": "4-bit quantized Mistral, excellent quality",
                "size": "~4GB",
                "size_bytes": 4000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["llm", "gguf", "4-bit", "mistral"],
                "tier": "low"
            },
            {
                "id": "TheBloke/CodeLlama-7B-Instruct-GGUF",
                "name": "CodeLlama 7B (GGUF Q4)",
                "description": "4-bit quantized CodeLlama for coding",
                "size": "~4GB",
                "size_bytes": 4000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["code", "gguf", "4-bit"],
                "tier": "low"
            },
            {
                "id": "TheBloke/CodeLlama-13B-Instruct-GGUF",
                "name": "CodeLlama 13B (GGUF Q4)",
                "description": "4-bit quantized larger CodeLlama",
                "size": "~7.5GB",
                "size_bytes": 7500000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["code", "gguf", "4-bit"],
                "tier": "low"
            },
            # ===== AWQ Quantized (Better quality than GGUF) =====
            {
                "id": "TheBloke/Llama-2-7B-Chat-AWQ",
                "name": "Llama 2 7B Chat (AWQ)",
                "description": "AWQ 4-bit, better quality than GGUF",
                "size": "~4GB",
                "size_bytes": 4000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "llama"],
                "tier": "low"
            },
            {
                "id": "TheBloke/Llama-2-13B-chat-AWQ",
                "name": "Llama 2 13B Chat (AWQ)",
                "description": "AWQ 4-bit 13B Llama",
                "size": "~7.5GB",
                "size_bytes": 7500000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "llama"],
                "tier": "low"
            },
            {
                "id": "TheBloke/Mistral-7B-Instruct-v0.2-AWQ",
                "name": "Mistral 7B v0.2 (AWQ)",
                "description": "AWQ quantized Mistral",
                "size": "~4GB",
                "size_bytes": 4000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "mistral"],
                "tier": "low"
            },
            # ===== Larger Quantized Models (12-16GB GPUs) =====
            {
                "id": "TheBloke/Llama-2-70B-Chat-GGUF",
                "name": "Llama 2 70B Chat (GGUF Q4)",
                "description": "70B model quantized to run on 24GB GPU",
                "size": "~40GB",
                "size_bytes": 40000000000,
                "vram_gb": 20,
                "type": "huggingface",
                "tags": ["llm", "gguf", "4-bit", "70b"],
                "tier": "high"
            },
            {
                "id": "TheBloke/CodeLlama-34B-Instruct-GGUF",
                "name": "CodeLlama 34B (GGUF Q4)",
                "description": "34B code model quantized for 16GB GPU",
                "size": "~20GB",
                "size_bytes": 20000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["code", "gguf", "4-bit", "34b"],
                "tier": "medium"
            },
            {
                "id": "TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF",
                "name": "Mixtral 8x7B (GGUF Q4)",
                "description": "MoE model quantized for 16GB GPU",
                "size": "~26GB",
                "size_bytes": 26000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["llm", "gguf", "moe", "4-bit"],
                "tier": "medium"
            },
            # ===== Qwen Quantized =====
            {
                "id": "Qwen/Qwen2.5-7B-Instruct-AWQ",
                "name": "Qwen2.5 7B (AWQ)",
                "description": "AWQ quantized Qwen 2.5 7B",
                "size": "~4.5GB",
                "size_bytes": 4500000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "qwen"],
                "tier": "low"
            },
            {
                "id": "Qwen/Qwen2.5-14B-Instruct-AWQ",
                "name": "Qwen2.5 14B (AWQ)",
                "description": "AWQ quantized Qwen 2.5 14B",
                "size": "~8GB",
                "size_bytes": 8000000000,
                "vram_gb": 8,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "qwen"],
                "tier": "low"
            },
            {
                "id": "Qwen/Qwen2.5-32B-Instruct-AWQ",
                "name": "Qwen2.5 32B (AWQ)",
                "description": "AWQ quantized Qwen 2.5 32B for 16GB GPU",
                "size": "~18GB",
                "size_bytes": 18000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "qwen"],
                "tier": "medium"
            },
            {
                "id": "Qwen/Qwen2.5-72B-Instruct-AWQ",
                "name": "Qwen2.5 72B (AWQ)",
                "description": "AWQ quantized Qwen 2.5 72B for 24GB GPU",
                "size": "~40GB",
                "size_bytes": 40000000000,
                "vram_gb": 22,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "qwen", "flagship"],
                "tier": "high"
            },
            # ===== Code Quantized =====
            {
                "id": "Qwen/Qwen2.5-Coder-7B-Instruct-AWQ",
                "name": "Qwen2.5 Coder 7B (AWQ)",
                "description": "AWQ quantized Qwen Coder",
                "size": "~4.5GB",
                "size_bytes": 4500000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["code", "awq", "4-bit", "qwen"],
                "tier": "low"
            },
            {
                "id": "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
                "name": "Qwen2.5 Coder 32B (AWQ)",
                "description": "Flagship code model quantized for 16GB GPU",
                "size": "~18GB",
                "size_bytes": 18000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["code", "awq", "4-bit", "flagship"],
                "tier": "medium"
            },
            # ===== GPTQ Quantized =====
            {
                "id": "TheBloke/Llama-2-7B-Chat-GPTQ",
                "name": "Llama 2 7B Chat (GPTQ)",
                "description": "GPTQ 4-bit quantized Llama 2",
                "size": "~4GB",
                "size_bytes": 4000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["llm", "gptq", "4-bit", "llama"],
                "tier": "low"
            },
            {
                "id": "TheBloke/Mistral-7B-Instruct-v0.2-GPTQ",
                "name": "Mistral 7B v0.2 (GPTQ)",
                "description": "GPTQ quantized Mistral",
                "size": "~4GB",
                "size_bytes": 4000000000,
                "vram_gb": 6,
                "type": "huggingface",
                "tags": ["llm", "gptq", "4-bit", "mistral"],
                "tier": "low"
            },
            # ===== GPT-OSS-20B Quantized =====
            {
                "id": "OpenSourceAI/gpt-oss-20b-GGUF",
                "name": "GPT-OSS 20B (GGUF Q4)",
                "description": "4-bit GGUF quantized GPT-OSS 20B for 12GB GPU",
                "size": "~12GB",
                "size_bytes": 12000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["llm", "gguf", "4-bit", "gpt-oss"],
                "tier": "medium"
            },
            {
                "id": "OpenSourceAI/gpt-oss-20b-GGUF-Q5",
                "name": "GPT-OSS 20B (GGUF Q5)",
                "description": "5-bit GGUF quantized GPT-OSS 20B, better quality",
                "size": "~14GB",
                "size_bytes": 14000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["llm", "gguf", "5-bit", "gpt-oss"],
                "tier": "medium"
            },
            {
                "id": "OpenSourceAI/gpt-oss-20b-GGUF-Q8",
                "name": "GPT-OSS 20B (GGUF Q8)",
                "description": "8-bit GGUF quantized GPT-OSS 20B, near full quality",
                "size": "~22GB",
                "size_bytes": 22000000000,
                "vram_gb": 18,
                "type": "huggingface",
                "tags": ["llm", "gguf", "8-bit", "gpt-oss"],
                "tier": "high"
            },
            {
                "id": "OpenSourceAI/gpt-oss-20b-instruct-AWQ",
                "name": "GPT-OSS 20B Instruct (AWQ)",
                "description": "AWQ 4-bit quantized GPT-OSS 20B Instruct",
                "size": "~12GB",
                "size_bytes": 12000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "gpt-oss"],
                "tier": "medium"
            },
            {
                "id": "OpenSourceAI/gpt-oss-20b-instruct-GPTQ",
                "name": "GPT-OSS 20B Instruct (GPTQ)",
                "description": "GPTQ 4-bit quantized GPT-OSS 20B Instruct",
                "size": "~12GB",
                "size_bytes": 12000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["llm", "gptq", "4-bit", "gpt-oss"],
                "tier": "medium"
            },
            # ===== GPT-OSS-120B Quantized =====
            {
                "id": "OpenSourceAI/gpt-oss-120b-GGUF-Q2",
                "name": "GPT-OSS 120B (GGUF Q2)",
                "description": "2-bit GGUF quantized GPT-OSS 120B for 24GB GPU",
                "size": "~35GB",
                "size_bytes": 35000000000,
                "vram_gb": 22,
                "type": "huggingface",
                "tags": ["llm", "gguf", "2-bit", "gpt-oss", "extreme"],
                "tier": "high"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-GGUF-Q3",
                "name": "GPT-OSS 120B (GGUF Q3)",
                "description": "3-bit GGUF quantized GPT-OSS 120B for 32GB GPU",
                "size": "~50GB",
                "size_bytes": 50000000000,
                "vram_gb": 28,
                "type": "huggingface",
                "tags": ["llm", "gguf", "3-bit", "gpt-oss"],
                "tier": "ultra"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-GGUF-Q4",
                "name": "GPT-OSS 120B (GGUF Q4)",
                "description": "4-bit GGUF quantized GPT-OSS 120B for 48GB GPU",
                "size": "~70GB",
                "size_bytes": 70000000000,
                "vram_gb": 40,
                "type": "huggingface",
                "tags": ["llm", "gguf", "4-bit", "gpt-oss", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-GGUF-Q5",
                "name": "GPT-OSS 120B (GGUF Q5)",
                "description": "5-bit GGUF quantized GPT-OSS 120B, better quality",
                "size": "~85GB",
                "size_bytes": 85000000000,
                "vram_gb": 48,
                "type": "huggingface",
                "tags": ["llm", "gguf", "5-bit", "gpt-oss", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-GGUF-Q6",
                "name": "GPT-OSS 120B (GGUF Q6)",
                "description": "6-bit GGUF quantized GPT-OSS 120B, high quality",
                "size": "~100GB",
                "size_bytes": 100000000000,
                "vram_gb": 56,
                "type": "huggingface",
                "tags": ["llm", "gguf", "6-bit", "gpt-oss", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-GGUF-Q8",
                "name": "GPT-OSS 120B (GGUF Q8)",
                "description": "8-bit GGUF quantized GPT-OSS 120B, near full quality",
                "size": "~130GB",
                "size_bytes": 130000000000,
                "vram_gb": 72,
                "type": "huggingface",
                "tags": ["llm", "gguf", "8-bit", "gpt-oss", "flagship"],
                "tier": "datacenter"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-instruct-AWQ",
                "name": "GPT-OSS 120B Instruct (AWQ)",
                "description": "AWQ 4-bit quantized GPT-OSS 120B Instruct",
                "size": "~70GB",
                "size_bytes": 70000000000,
                "vram_gb": 40,
                "type": "huggingface",
                "tags": ["llm", "awq", "4-bit", "gpt-oss", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-instruct-GPTQ",
                "name": "GPT-OSS 120B Instruct (GPTQ)",
                "description": "GPTQ 4-bit quantized GPT-OSS 120B Instruct",
                "size": "~70GB",
                "size_bytes": 70000000000,
                "vram_gb": 40,
                "type": "huggingface",
                "tags": ["llm", "gptq", "4-bit", "gpt-oss", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-instruct-exl2-4bpw",
                "name": "GPT-OSS 120B Instruct (EXL2 4bpw)",
                "description": "EXL2 4-bit quantized, optimized for exllamav2",
                "size": "~70GB",
                "size_bytes": 70000000000,
                "vram_gb": 40,
                "type": "huggingface",
                "tags": ["llm", "exl2", "4-bit", "gpt-oss", "flagship"],
                "tier": "ultra"
            },
            {
                "id": "OpenSourceAI/gpt-oss-120b-instruct-exl2-6bpw",
                "name": "GPT-OSS 120B Instruct (EXL2 6bpw)",
                "description": "EXL2 6-bit quantized, higher quality for exllamav2",
                "size": "~100GB",
                "size_bytes": 100000000000,
                "vram_gb": 56,
                "type": "huggingface",
                "tags": ["llm", "exl2", "6-bit", "gpt-oss", "flagship"],
                "tier": "ultra"
            },
        ]
    },
    "moe": {
        "name": "Mixture of Experts",
        "description": "Efficient large models using sparse MoE architecture",
        "models": [
            # ===== SMALL MoE =====
            {
                "id": "mistralai/Mixtral-8x7B-v0.1",
                "name": "Mixtral 8x7B Base",
                "description": "Mistral's MoE model, 8 experts x 7B params each",
                "size": "~93GB",
                "size_bytes": 93000000000,
                "vram_gb": 24,
                "type": "huggingface",
                "tags": ["llm", "moe", "mistral"],
                "tier": "high"
            },
            {
                "id": "mistralai/Mixtral-8x7B-Instruct-v0.1",
                "name": "Mixtral 8x7B Instruct",
                "description": "Instruction-tuned Mixtral MoE",
                "size": "~93GB",
                "size_bytes": 93000000000,
                "vram_gb": 24,
                "type": "huggingface",
                "tags": ["llm", "moe", "instruct"],
                "tier": "high"
            },
            {
                "id": "Qwen/Qwen1.5-MoE-A2.7B",
                "name": "Qwen1.5 MoE 2.7B Active",
                "description": "Efficient MoE with 2.7B active params",
                "size": "~16GB",
                "size_bytes": 16000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["llm", "moe", "efficient", "qwen"],
                "tier": "medium"
            },
            {
                "id": "Qwen/Qwen1.5-MoE-A2.7B-Chat",
                "name": "Qwen1.5 MoE Chat",
                "description": "Chat-tuned Qwen MoE",
                "size": "~16GB",
                "size_bytes": 16000000000,
                "vram_gb": 10,
                "type": "huggingface",
                "tags": ["llm", "moe", "chat", "qwen"],
                "tier": "medium"
            },
            # ===== MEDIUM MoE =====
            {
                "id": "databricks/dbrx-base",
                "name": "DBRX Base",
                "description": "Databricks 132B MoE model",
                "size": "~264GB",
                "size_bytes": 264000000000,
                "vram_gb": 80,
                "type": "huggingface",
                "tags": ["llm", "moe", "databricks", "large"],
                "tier": "datacenter"
            },
            {
                "id": "databricks/dbrx-instruct",
                "name": "DBRX Instruct",
                "description": "Instruction-tuned DBRX",
                "size": "~264GB",
                "size_bytes": 264000000000,
                "vram_gb": 80,
                "type": "huggingface",
                "tags": ["llm", "moe", "instruct", "large"],
                "tier": "datacenter"
            },
            # ===== LARGE MoE =====
            {
                "id": "mistralai/Mixtral-8x22B-v0.1",
                "name": "Mixtral 8x22B Base",
                "description": "Massive MoE, 8 experts x 22B each",
                "size": "~262GB",
                "size_bytes": 262000000000,
                "vram_gb": 100,
                "type": "huggingface",
                "tags": ["llm", "moe", "flagship"],
                "tier": "datacenter"
            },
            {
                "id": "mistralai/Mixtral-8x22B-Instruct-v0.1",
                "name": "Mixtral 8x22B Instruct",
                "description": "Instruction-tuned massive MoE",
                "size": "~262GB",
                "size_bytes": 262000000000,
                "vram_gb": 100,
                "type": "huggingface",
                "tags": ["llm", "moe", "instruct", "flagship"],
                "tier": "datacenter"
            },
            # ===== Quantized MoE (for smaller GPUs) =====
            {
                "id": "TheBloke/Mixtral-8x7B-v0.1-GGUF",
                "name": "Mixtral 8x7B (GGUF Q4)",
                "description": "Quantized MoE for 16GB GPU",
                "size": "~26GB",
                "size_bytes": 26000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["llm", "moe", "gguf", "4-bit"],
                "tier": "medium"
            },
            {
                "id": "TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ",
                "name": "Mixtral 8x7B Instruct (AWQ)",
                "description": "AWQ quantized MoE",
                "size": "~26GB",
                "size_bytes": 26000000000,
                "vram_gb": 14,
                "type": "huggingface",
                "tags": ["llm", "moe", "awq", "4-bit"],
                "tier": "medium"
            },
            # ===== DeepSeek MoE =====
            {
                "id": "deepseek-ai/deepseek-moe-16b-base",
                "name": "DeepSeek MoE 16B Base",
                "description": "DeepSeek's efficient MoE model",
                "size": "~32GB",
                "size_bytes": 32000000000,
                "vram_gb": 18,
                "type": "huggingface",
                "tags": ["llm", "moe", "deepseek"],
                "tier": "high"
            },
            {
                "id": "deepseek-ai/deepseek-moe-16b-chat",
                "name": "DeepSeek MoE 16B Chat",
                "description": "Chat-tuned DeepSeek MoE",
                "size": "~32GB",
                "size_bytes": 32000000000,
                "vram_gb": 18,
                "type": "huggingface",
                "tags": ["llm", "moe", "chat", "deepseek"],
                "tier": "high"
            },
            # ===== Code MoE =====
            {
                "id": "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct",
                "name": "DeepSeek Coder V2 Lite",
                "description": "MoE code model, 2.4B active params",
                "size": "~32GB",
                "size_bytes": 32000000000,
                "vram_gb": 12,
                "type": "huggingface",
                "tags": ["code", "moe", "efficient"],
                "tier": "medium"
            },
            {
                "id": "deepseek-ai/DeepSeek-Coder-V2-Instruct",
                "name": "DeepSeek Coder V2",
                "description": "Full MoE code model, 21B active params",
                "size": "~480GB",
                "size_bytes": 480000000000,
                "vram_gb": 160,
                "type": "huggingface",
                "tags": ["code", "moe", "flagship"],
                "tier": "datacenter"
            },
        ]
    },
}


# ============================================
# Helper Functions
# ============================================
def get_dir_size(path: Path) -> int:
    """Get total size of directory in bytes."""
    total = 0
    try:
        for entry in path.rglob('*'):
            if entry.is_file():
                total += entry.stat().st_size
    except (PermissionError, OSError):
        pass
    return total


def format_size(size_bytes: int) -> str:
    """Format bytes to human readable string."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def parse_hf_model_id(folder_name: str) -> Optional[str]:
    """Parse HuggingFace model ID from cache folder name."""
    # HF cache folders are named like: models--org--model-name
    if folder_name.startswith("models--"):
        parts = folder_name[8:].split("--")
        if len(parts) >= 2:
            return "/".join(parts)
    return None


def scan_huggingface_models() -> List[Dict[str, Any]]:
    """Scan HuggingFace cache for downloaded models."""
    models = []
    cache_path = get_models_cache_path()

    # Paths to scan for models:
    # 1. The configured huggingface path (CONTEXTUI_MODELS_PATH/huggingface)
    # 2. A "hub" subfolder that HuggingFace might have created in the parent
    #    (for backwards compatibility with older downloads)
    paths_to_scan = [cache_path]

    # Check for legacy hub folder in parent (models/hub instead of models/huggingface)
    legacy_hub_path = cache_path.parent / "hub"
    if legacy_hub_path.exists() and legacy_hub_path != cache_path:
        paths_to_scan.append(legacy_hub_path)

    for scan_path in paths_to_scan:
        if not scan_path.exists():
            continue

        try:
            for item in scan_path.iterdir():
                if item.is_dir() and item.name.startswith("models--"):
                    model_id = parse_hf_model_id(item.name)
                    if model_id:
                        # Skip if we already found this model
                        if any(m["id"] == model_id for m in models):
                            continue

                        size = get_dir_size(item)
                        # Get modification time
                        try:
                            mtime = max(f.stat().st_mtime for f in item.rglob('*') if f.is_file())
                            last_used = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")
                        except (ValueError, OSError):
                            last_used = "Unknown"

                        models.append({
                            "id": model_id,
                            "name": model_id.split("/")[-1],
                            "type": "huggingface",
                            "size": size,
                            "size_formatted": format_size(size),
                            "path": str(item),
                            "last_used": last_used,
                        })
        except (PermissionError, OSError) as e:
            add_log(f"Error scanning HuggingFace cache at {scan_path}: {e}")

    return models


def scan_sdxl_models() -> List[Dict[str, Any]]:
    """Scan SDXL models folder for downloaded models."""
    models = []
    sdxl_path = get_sdxl_models_path()

    if not sdxl_path.exists():
        return models

    try:
        for item in sdxl_path.iterdir():
            if item.is_file() and item.suffix in ['.safetensors', '.ckpt', '.pt']:
                size = item.stat().st_size
                mtime = item.stat().st_mtime
                last_used = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")

                # Try to match with catalog entry
                model_id = None
                for cat_models in MODEL_CATALOG.values():
                    for m in cat_models.get("models", []):
                        if m.get("filename") == item.name:
                            model_id = m["id"]
                            break

                models.append({
                    "id": model_id or item.stem,
                    "name": item.stem,
                    "type": "sdxl",
                    "size": size,
                    "size_formatted": format_size(size),
                    "path": str(item),
                    "filename": item.name,
                    "last_used": last_used,
                })
    except (PermissionError, OSError) as e:
        add_log(f"Error scanning SDXL models: {e}")

    return models


def is_model_downloaded(model_id: str, model_type: str) -> bool:
    """Check if a model is already downloaded."""
    if model_type == "sdxl":
        # Check for SDXL single-file model
        sdxl_path = get_sdxl_models_path()
        for cat_models in MODEL_CATALOG.values():
            for m in cat_models.get("models", []):
                if m.get("id") == model_id and m.get("filename"):
                    filepath = sdxl_path / m["filename"]
                    return filepath.exists()
        return False
    else:
        # Check HuggingFace cache in both current and legacy locations
        cache_path = get_models_cache_path()
        folder_name = "models--" + model_id.replace("/", "--")

        # Check primary location (CONTEXTUI_MODELS_PATH/huggingface)
        model_path = cache_path / folder_name
        if model_path.exists():
            return True

        # Check legacy location (CONTEXTUI_MODELS_PATH/hub)
        legacy_hub_path = cache_path.parent / "hub" / folder_name
        if legacy_hub_path.exists():
            return True

        return False


# ============================================
# Request/Response Models
# ============================================
class DownloadRequest(BaseModel):
    model_id: str
    model_type: str = "huggingface"
    hf_token: Optional[str] = None  # HuggingFace token for gated models


class DeleteRequest(BaseModel):
    model_id: str
    model_type: str
    path: str


# ============================================
# API Endpoints
# ============================================
@app.get("/")
async def root():
    return {"status": "online", "service": "Model Manager Server"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/gpu")
async def gpu_info():
    """Get GPU information for model recommendations."""
    info = get_gpu_info()

    # Add recommendation text based on tier
    tier_recommendations = {
        "cpu": "You can run small models (1-3B parameters) on CPU. Consider upgrading your GPU for better performance.",
        "low": "You can run models up to ~7B parameters comfortably. Good for basic chat, code completion, and image generation.",
        "medium": "You can run models up to ~13B parameters. Good for most tasks including SDXL and quality LLMs.",
        "high": "You can run large models up to ~32B parameters. Excellent for complex tasks and high-quality outputs.",
        "ultra": "You can run very large models up to 70B+ parameters. Near-datacenter capabilities.",
        "datacenter": "You have datacenter-class hardware. You can run the largest open-source models available.",
    }

    info["recommendation_text"] = tier_recommendations.get(info["recommendation_tier"], "")

    # Add max recommended model size
    tier_max_vram = {
        "cpu": 4,
        "low": 10,
        "medium": 20,
        "high": 40,
        "ultra": 80,
        "datacenter": 1000,
    }
    info["max_recommended_vram"] = tier_max_vram.get(info["recommendation_tier"], 4)

    return {"success": True, "gpu": info}


@app.post("/gpu/refresh")
async def gpu_refresh():
    """Force refresh GPU info."""
    info = refresh_gpu_info()
    return {"success": True, "gpu": info}


@app.get("/status")
async def status():
    paths = get_all_model_paths()
    total_size = 0
    for path in paths.values():
        if path.exists():
            total_size += get_dir_size(path)

    return {
        "huggingface_path": str(paths["huggingface"]),
        "sdxl_path": str(paths["sdxl"]),
        "total_size": total_size,
        "total_size_formatted": format_size(total_size),
        "active_downloads": len(active_downloads),
    }


# Known gated model prefixes that require HuggingFace authentication
# These are models that require accepting terms of service on HuggingFace before access
GATED_MODEL_PREFIXES = [
    "meta-llama/",      # All Meta Llama models require license acceptance
    "mistralai/",       # Mistral models require authentication
    "google/gemma",     # Google Gemma models are gated
    "codellama/",       # CodeLlama models (Meta) are gated
]


def is_gated_model(model_id: str) -> bool:
    """Check if a model requires HuggingFace authentication (gated model)."""
    model_id_lower = model_id.lower()
    for prefix in GATED_MODEL_PREFIXES:
        if model_id_lower.startswith(prefix.lower()):
            return True
    return False


@app.get("/catalog")
async def get_catalog():
    """Get the model catalog with download status and GPU recommendations."""
    catalog_with_status = {}
    gpu = get_gpu_info()
    user_vram = gpu["total_vram_gb"]
    user_tier = gpu["recommendation_tier"]

    # Map tiers to numeric values for comparison
    tier_order = {"cpu": 0, "low": 1, "medium": 2, "high": 3, "ultra": 4, "datacenter": 5}
    user_tier_value = tier_order.get(user_tier, 0)

    for category, data in MODEL_CATALOG.items():
        models_with_status = []
        for model in data["models"]:
            model_copy = model.copy()
            model_copy["downloaded"] = is_model_downloaded(model["id"], model.get("type", "huggingface"))

            # Check if model is gated (requires HuggingFace token)
            model_copy["gated"] = is_gated_model(model["id"])

            # Add recommendation status based on user's GPU
            model_vram = model.get("vram_gb", 0)
            model_tier = model.get("tier", "cpu")
            model_tier_value = tier_order.get(model_tier, 0)

            if model_vram <= user_vram * 0.85:  # Leave 15% headroom
                model_copy["can_run"] = True
                model_copy["recommendation"] = "recommended"
            elif model_vram <= user_vram:
                model_copy["can_run"] = True
                model_copy["recommendation"] = "possible"  # Tight fit
            else:
                model_copy["can_run"] = False
                model_copy["recommendation"] = "too_large"

            # Add helpful note
            if model_copy["recommendation"] == "recommended":
                model_copy["recommendation_note"] = "Good fit for your GPU"
            elif model_copy["recommendation"] == "possible":
                model_copy["recommendation_note"] = "May work but tight on VRAM"
            else:
                needed = model_vram - user_vram
                model_copy["recommendation_note"] = f"Needs ~{needed:.0f}GB more VRAM"

            models_with_status.append(model_copy)

        catalog_with_status[category] = {
            "name": data["name"],
            "description": data["description"],
            "models": models_with_status,
        }

    return {
        "success": True,
        "catalog": catalog_with_status,
        "gpu_tier": user_tier,
        "gpu_vram": user_vram
    }


@app.get("/downloaded")
async def get_downloaded_models():
    """Get list of all downloaded models."""
    hf_models = scan_huggingface_models()
    sdxl_models = scan_sdxl_models()

    all_models = hf_models + sdxl_models
    total_size = sum(m["size"] for m in all_models)

    return {
        "success": True,
        "models": all_models,
        "total_count": len(all_models),
        "total_size": total_size,
        "total_size_formatted": format_size(total_size),
    }


@app.post("/download")
async def download_model(request: DownloadRequest):
    """Start downloading a model."""
    global download_progress, active_downloads

    model_id = request.model_id
    model_type = request.model_type

    # Check if already downloading
    if model_id in active_downloads:
        return {"success": False, "error": "Model is already being downloaded"}

    # Check if already downloaded
    if is_model_downloaded(model_id, model_type):
        return {"success": False, "error": "Model is already downloaded"}

    add_log(f"Starting download: {model_id}")

    # Initialize progress tracking
    download_progress[model_id] = {
        "status": "starting",
        "progress": 0,
        "message": "Initializing download...",
        "started": time.time(),
    }
    active_downloads[model_id] = True

    # Get the token for this download
    hf_token = request.hf_token

    # Start download in background
    def run_download():
        try:
            if model_type == "sdxl":
                download_sdxl_model(model_id)
            else:
                download_huggingface_model(model_id, hf_token=hf_token)
        except Exception as e:
            download_progress[model_id] = {
                "status": "error",
                "progress": 0,
                "message": str(e),
            }
            add_log(f"Download error for {model_id}: {e}")
        finally:
            if model_id in active_downloads:
                del active_downloads[model_id]

    executor.submit(run_download)

    return {"success": True, "message": f"Download started for {model_id}"}


def download_huggingface_model(model_id: str, hf_token: Optional[str] = None):
    """Download a HuggingFace model.

    Args:
        model_id: The HuggingFace model ID (e.g., "meta-llama/Llama-3.2-1B")
        hf_token: Optional HuggingFace access token for gated/private models
    """
    global download_progress

    try:
        download_progress[model_id]["status"] = "downloading"
        download_progress[model_id]["message"] = "Downloading from HuggingFace..."

        # Use huggingface_hub for downloading
        from huggingface_hub import snapshot_download

        cache_path = get_models_cache_path()
        cache_path.mkdir(parents=True, exist_ok=True)

        # Download with progress callback
        def progress_callback(progress):
            download_progress[model_id]["progress"] = progress * 100

        # Build download kwargs
        # Note: HuggingFace hub expects the cache_dir to be the folder where it creates
        # its "models--org--name" structure. We use cache_path directly so models go
        # into CONTEXTUI_MODELS_PATH/huggingface/models--org--name/
        download_kwargs = {
            "repo_id": model_id,
            "cache_dir": str(cache_path),
            "local_dir_use_symlinks": False,
        }

        # Add token if provided (required for gated models like Llama, Mistral, etc.)
        if hf_token:
            download_kwargs["token"] = hf_token
            add_log(f"Using HuggingFace token for authentication")

        snapshot_download(**download_kwargs)

        download_progress[model_id] = {
            "status": "complete",
            "progress": 100,
            "message": "Download complete!",
        }
        add_log(f"Download complete: {model_id}")

    except Exception as e:
        download_progress[model_id] = {
            "status": "error",
            "progress": 0,
            "message": str(e),
        }
        add_log(f"Download failed for {model_id}: {e}")
        raise


def download_sdxl_model(model_id: str):
    """Download an SDXL single-file model."""
    global download_progress

    try:
        import requests

        # Find the model in catalog to get filename
        filename = None
        for cat_data in MODEL_CATALOG.values():
            for m in cat_data.get("models", []):
                if m.get("id") == model_id:
                    filename = m.get("filename")
                    break

        if not filename:
            raise ValueError(f"Unknown SDXL model: {model_id}")

        sdxl_path = get_sdxl_models_path()
        sdxl_path.mkdir(parents=True, exist_ok=True)

        local_path = sdxl_path / filename

        download_progress[model_id]["status"] = "downloading"
        download_progress[model_id]["message"] = f"Downloading {filename}..."

        # Download from HuggingFace
        url = f"https://huggingface.co/{model_id}/resolve/main/{filename}"

        response = requests.get(url, stream=True, allow_redirects=True)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0

        with open(local_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192 * 1024):
                if model_id not in active_downloads:
                    # Download was cancelled
                    f.close()
                    local_path.unlink(missing_ok=True)
                    raise Exception("Download cancelled")

                f.write(chunk)
                downloaded += len(chunk)

                if total_size > 0:
                    progress = (downloaded / total_size) * 100
                    download_progress[model_id]["progress"] = progress
                    download_progress[model_id]["message"] = f"Downloading... {format_size(downloaded)} / {format_size(total_size)}"

        download_progress[model_id] = {
            "status": "complete",
            "progress": 100,
            "message": "Download complete!",
        }
        add_log(f"Download complete: {model_id}")

    except Exception as e:
        download_progress[model_id] = {
            "status": "error",
            "progress": 0,
            "message": str(e),
        }
        add_log(f"Download failed for {model_id}: {e}")
        raise


@app.get("/download/progress/{model_id:path}")
async def get_download_progress(model_id: str):
    """Get download progress for a model."""
    if model_id in download_progress:
        return {"success": True, **download_progress[model_id]}
    return {"success": False, "error": "No active download for this model"}


@app.post("/download/cancel/{model_id:path}")
async def cancel_download(model_id: str):
    """Cancel an active download."""
    if model_id in active_downloads:
        del active_downloads[model_id]
        download_progress[model_id] = {
            "status": "cancelled",
            "progress": 0,
            "message": "Download cancelled",
        }
        add_log(f"Download cancelled: {model_id}")
        return {"success": True, "message": "Download cancelled"}
    return {"success": False, "error": "No active download for this model"}


@app.post("/delete")
async def delete_model(request: DeleteRequest):
    """Delete a downloaded model."""
    model_id = request.model_id
    model_type = request.model_type
    path = Path(request.path)

    if not path.exists():
        return {"success": False, "error": "Model path does not exist"}

    try:
        add_log(f"Deleting model: {model_id}")

        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()

        # Clear from progress tracking if present
        if model_id in download_progress:
            del download_progress[model_id]

        add_log(f"Deleted: {model_id}")
        return {"success": True, "message": f"Deleted {model_id}"}

    except Exception as e:
        add_log(f"Delete error for {model_id}: {e}")
        return {"success": False, "error": str(e)}


@app.get("/log")
async def get_log():
    """Get server log."""
    return {"success": True, "log": server_log}


@app.post("/log/clear")
async def clear_log():
    """Clear server log."""
    global server_log
    server_log = []
    return {"success": True}


@app.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server."""
    add_log("Shutdown requested...")
    asyncio.get_event_loop().call_later(0.5, lambda: os._exit(0))
    return {"success": True, "message": "Server shutting down"}


if __name__ == "__main__":
    import sys
    import logging

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
    print(f"Starting Model Manager server on port {port}...")
    print(f"HuggingFace cache: {get_models_cache_path()}")
    print(f"SDXL models: {get_sdxl_models_path()}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
