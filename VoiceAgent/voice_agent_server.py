"""
Voice-Controlled Multi-Service Agent Server
A sophisticated voice-controlled agent system using a two-model architecture:
- Router Model (small, 1-3B): Fast intent classification
- Main Model (medium, 13-14B): Reasoning, planning, execution, conversation

Coordinates with multiple remote services and tools, handles async jobs,
and provides real-time voice input/output.
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, AsyncGenerator, Any, Literal
import uvicorn
import torch
import gc
import time
import os
import asyncio
import json
import re
import sys
import subprocess
from pathlib import Path
from datetime import datetime
from threading import Thread
from dataclasses import dataclass, field
from enum import Enum
import uuid
import base64
import wave
import io
import tempfile
import numpy as np

app = FastAPI(title="Voice Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# User Paths (from ContextUI environment variables)
# Following the same pattern as SDXL and ModelManager
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


def get_workflows_path() -> Path:
    """Get workflows path from env var."""
    env_path = os.environ.get('CONTEXTUI_PROFILE_PATH')
    if env_path:
        return Path(env_path) / "workflows"
    return Path.home() / "ContextUI" / "default" / "workflows"


# ============================================
# Enums and Data Classes
# ============================================

class OperationalMode(str, Enum):
    PLANNING = "planning"
    EXECUTION = "execution"
    CONVERSATION = "conversation"


class JobStatus(str, Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ServiceType(str, Enum):
    MUSIC_GENERATION = "music_generation"
    IMAGE_GENERATION = "image_generation"
    SPREADSHEET = "spreadsheet"
    CALENDAR = "calendar"
    RAG = "rag"
    CAD = "cad"
    DOCUMENT = "document"
    CHAT = "chat"
    WORKFLOW = "workflow"


@dataclass
class Job:
    """Represents an async job submitted to a service."""
    id: str
    service_type: ServiceType
    parameters: Dict[str, Any]
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    estimated_duration: Optional[float] = None
    can_modify: bool = True
    description: str = ""

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "service_type": self.service_type.value,
            "parameters": self.parameters,
            "status": self.status.value,
            "progress": self.progress,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "result": self.result,
            "error": self.error,
            "estimated_duration": self.estimated_duration,
            "can_modify": self.can_modify,
            "description": self.description,
        }


@dataclass
class ServiceEndpoint:
    """Represents a remote service endpoint."""
    name: str
    service_type: ServiceType
    base_url: str
    port: int
    is_available: bool = False
    last_check: float = 0.0
    capabilities: List[str] = field(default_factory=list)


# ============================================
# Global State
# ============================================

# Router Model State
router_model = None
router_tokenizer = None
router_model_name = ""
router_ready = False
router_loading = False
router_model_type = "transformers"  # "transformers" or "gguf"

# Main Model State
main_model = None
main_tokenizer = None
main_model_name = ""
main_ready = False
main_loading = False
main_model_type = "transformers"  # "transformers" or "gguf"

# Speech Models State
stt_model = None  # Speech-to-Text (Whisper)
stt_ready = False
stt_loading = False

tts_model = None  # Text-to-Speech
tts_ready = False
tts_loading = False

# System State
models_cache = get_models_cache_path()
conversation_history: List[Dict[str, str]] = []
active_jobs: Dict[str, Job] = {}
service_registry: Dict[str, ServiceEndpoint] = {}
current_mode: OperationalMode = OperationalMode.CONVERSATION
last_subject: Optional[str] = None  # For pronoun resolution
agent_log: List[str] = []

# WebSocket connections for real-time updates
websocket_connections: List[WebSocket] = []


def add_log(message: str):
    """Add timestamped entry to agent log."""
    global agent_log
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    agent_log.append(entry)
    if len(agent_log) > 500:
        agent_log = agent_log[-500:]
    # Print with error handling for Windows console encoding issues
    try:
        print(entry, flush=True)
    except (UnicodeEncodeError, UnicodeDecodeError):
        # Fallback: print ASCII-safe version
        safe_entry = entry.encode('ascii', errors='replace').decode('ascii')
        print(safe_entry, flush=True)
    except Exception:
        # Last resort: just skip printing but keep in log
        pass


# ============================================
# System Prompts - Simplified for Periodic Table Demo
# ============================================

# Router model: Handles conversation AND delegates to main model
ROUTER_SYSTEM_PROMPT = """You are a friendly voice assistant with access to a Periodic Table.

When the user asks about elements or wants to see them on the periodic table, respond conversationally AND output a TASK block.

TASK format (only when needed):
<TASK>select_element:SYMBOL</TASK>

Examples:
- User: "What is gold?" → Talk about gold, then <TASK>select_element:Au</TASK>
- User: "Show me iron" → Say you'll show iron, then <TASK>select_element:Fe</TASK>
- User: "Hello" → Just respond, no TASK needed
- User: "What's the weather?" → Just respond, no TASK needed

Keep responses short and natural for speech."""

# Main model: Executes tasks silently (user doesn't see this)
MAIN_MODEL_PROMPT = """Execute the task. Output ONLY a tool call, nothing else.

Tools:
- select_periodic_element: Select an element. Args: symbol (e.g. "Fe", "Au", "H")

Output format:
```tool
{{"tool": "select_periodic_element", "arguments": {{"symbol": "SYMBOL"}}}}
```

Task: {task}"""

# Legacy prompts (kept for compatibility, simplified)
PLANNING_SYSTEM_PROMPT = """You are a planning agent. Break down the request into steps.
Available services: {services}
Active jobs: {active_jobs}"""

EXECUTION_SYSTEM_PROMPT = """Execute tools to complete the task.

Tools:
{tools}

Output tool calls as:
```tool
{{"tool": "name", "arguments": {{...}}}}
```"""

CONVERSATION_SYSTEM_PROMPT = """You are a helpful voice assistant. Keep responses brief and natural.
Current time: {current_time}
Active jobs: {active_jobs}"""


# ============================================
# Router Model Logic (Conversation + Task Delegation)
# ============================================

ROUTER_EXAMPLES = """You are a friendly voice assistant. You can have normal conversations about any topic. You also have access to a Periodic Table - if the user asks about a chemical element, include <TASK>select_element:SYMBOL</TASK> at the end to highlight it.

User: Hey, how are you?
Assistant: I'm doing great, thanks for asking! How can I help you today?

User: What's the weather like?
Assistant: I don't have access to weather data, but I hope it's nice where you are!

User: Tell me a joke
Assistant: Why don't scientists trust atoms? Because they make up everything!

User: What's 2 plus 2?
Assistant: That's 4!

User: Show me gold
Assistant: Gold is element 79, a beautiful yellow metal prized for jewelry and electronics!
<TASK>select_element:Au</TASK>

User: What is iron used for?
Assistant: Iron is element 26, symbol Fe. It's essential for making steel, which is used in buildings, cars, and tools. It's also vital for your blood - hemoglobin contains iron!
<TASK>select_element:Fe</TASK>

User: Tell me about hydrogen
Assistant: Hydrogen is the lightest element, number 1 on the periodic table. It makes up most of the universe and is used in fuel cells!
<TASK>select_element:H</TASK>

User: {user_message}
Assistant:"""


# ============================================
# Request/Response Models
# ============================================

class RouterModelConfig(BaseModel):
    model_name: str = "Qwen/Qwen2.5-3B-Instruct-GPTQ-Int4"
    device: str = "auto"
    use_fp16: bool = True
    model_type: str = "transformers"  # "transformers" or "gguf"
    # GGUF-specific options
    gguf_file: Optional[str] = None  # Specific .gguf file to load (for HF repos with multiple files)
    n_gpu_layers: int = -1  # -1 = all layers on GPU
    n_ctx: int = 4096  # Context window size


class MainModelConfig(BaseModel):
    model_name: str = "Qwen/Qwen2.5-14B-Instruct-GPTQ-Int4"
    device: str = "auto"
    use_fp16: bool = True
    model_type: str = "transformers"  # "transformers" or "gguf"
    # GGUF-specific options
    gguf_file: Optional[str] = None  # Specific .gguf file to load (for HF repos with multiple files)
    n_gpu_layers: int = -1  # -1 = all layers on GPU
    n_ctx: int = 8192  # Context window size


class STTConfig(BaseModel):
    model_name: str = "openai/whisper-base"
    device: str = "auto"
    use_fp16: bool = True


class TTSConfig(BaseModel):
    model_name: str = "kokoro"  # Changed from microsoft/speecht5_tts to kokoro
    device: str = "auto"
    voice: str = "af_heart"  # Default Kokoro voice


class VoiceInput(BaseModel):
    audio_b64: str  # Base64 encoded audio
    sample_rate: int = 16000
    format: str = "wav"
    fast_chat: bool = False  # Use router model for faster responses
    skip_tts: bool = False  # Skip TTS for even faster responses


class AgentRequest(BaseModel):
    message: str
    force_mode: Optional[OperationalMode] = None
    temperature: float = 0.7
    max_new_tokens: int = 1024


class JobSubmitRequest(BaseModel):
    service_type: str
    parameters: Dict[str, Any]
    description: str = ""


class JobModifyRequest(BaseModel):
    job_id: str
    parameters: Dict[str, Any]


class ServiceRegisterRequest(BaseModel):
    name: str
    service_type: str
    base_url: str
    port: int
    capabilities: List[str] = []


class DepsCheckRequest(BaseModel):
    packages: List[str]


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
async def env_check_deps(req: DepsCheckRequest):
    """Check whether the listed packages are installed in this environment using `pip show`."""
    results: Dict[str, Dict[str, Any]] = {}
    for pkg in req.packages:
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


@app.get("/env/cuda_status")
async def env_cuda_status():
    """Check CUDA availability, auto-gptq CUDA kernel status, and llama-cpp-python GPU support.
    This endpoint performs actual runtime checks to verify CUDA acceleration works."""
    result = {
        "torch_cuda_available": torch.cuda.is_available(),
        "torch_version": torch.__version__,
        "torch_cuda_version": None,
        "torch_has_cuda_build": "+cu" in torch.__version__,  # e.g., "2.5.1+cu121"
        "auto_gptq_cuda_available": False,
        "auto_gptq_version": None,
        "auto_gptq_has_cuda_build": False,  # Version string check
        "auto_gptq_cuda_kernels": False,    # Runtime import check
        "llama_cpp_available": False,
        "llama_cpp_version": None,
        "llama_cpp_gpu_support": False,     # True if GPU offload is supported
        "cuda_device_name": None,
        "cuda_device_count": 0,
        "errors": []
    }

    # Check torch CUDA
    if torch.cuda.is_available():
        try:
            result["cuda_device_count"] = torch.cuda.device_count()
            result["cuda_device_name"] = torch.cuda.get_device_name(0)
            result["torch_cuda_version"] = torch.version.cuda
        except Exception as e:
            result["errors"].append(f"torch cuda info: {e}")

    # Check auto-gptq installation and CUDA kernel availability
    try:
        import auto_gptq
        version = getattr(auto_gptq, "__version__", "unknown")
        result["auto_gptq_version"] = version
        result["auto_gptq_has_cuda_build"] = "+cu" in version  # e.g., "0.7.1+cu118"

        # Try to check if CUDA kernels are actually available at runtime
        # auto_gptq has different backends: cuda, triton, exllama, etc.
        # Note: importing auto_gptq_cuda will print "CUDA extension not installed" if not available
        try:
            # Check for exllama/exllamav2 (preferred CUDA backend for auto-gptq)
            try:
                from auto_gptq_cuda import exllama_set_max_input_length
                result["auto_gptq_cuda_kernels"] = True
                result["auto_gptq_cuda_available"] = True
            except ImportError:
                pass

            # Check for basic CUDA extension
            if not result["auto_gptq_cuda_kernels"]:
                try:
                    import auto_gptq_cuda
                    result["auto_gptq_cuda_kernels"] = True
                    result["auto_gptq_cuda_available"] = True
                except ImportError:
                    pass

            # Check for exllamav2
            if not result["auto_gptq_cuda_kernels"]:
                try:
                    from exllamav2_kernels import make_q_matrix
                    result["auto_gptq_cuda_kernels"] = True
                    result["auto_gptq_cuda_available"] = True
                except ImportError:
                    pass

        except ImportError as e:
            result["errors"].append(f"auto_gptq import utils: {e}")

        # If version says CUDA but kernels don't load, note the discrepancy
        if result["auto_gptq_has_cuda_build"] and not result["auto_gptq_cuda_kernels"]:
            result["errors"].append("auto-gptq has CUDA version but kernels failed to load")

    except ImportError:
        result["errors"].append("auto-gptq not installed")
    except Exception as e:
        result["errors"].append(f"auto_gptq check: {e}")

    # Check llama-cpp-python installation and GPU support
    try:
        import llama_cpp
        result["llama_cpp_available"] = True
        llama_version = getattr(llama_cpp, "__version__", "unknown")
        result["llama_cpp_version"] = llama_version

        # Check if GPU offload is supported
        # Method 1: Try the llama_supports_gpu_offload function (newer versions)
        # Method 2: Check if version string contains +cu (CUDA build indicator)
        # Method 3: Fall back to False
        gpu_support = False

        # Check version string for CUDA indicator (e.g., "0.2.26+cu121")
        if "+cu" in llama_version:
            gpu_support = True
            print(f"llama-cpp-python CUDA build detected from version: {llama_version}")

        # Also try the function if available (may give more accurate result)
        try:
            gpu_offload_func = llama_cpp.llama_supports_gpu_offload()
            print(f"llama_cpp.llama_supports_gpu_offload() returned: {gpu_offload_func}")
            if gpu_offload_func:
                gpu_support = True
        except AttributeError:
            # Function doesn't exist in older versions - that's OK, rely on version check
            print(f"llama_supports_gpu_offload() not available in this version")
        except Exception as e:
            print(f"llama_supports_gpu_offload() error: {e}")

        result["llama_cpp_gpu_support"] = gpu_support

    except ImportError:
        pass  # llama-cpp-python not installed, not an error
    except Exception as e:
        result["errors"].append(f"llama_cpp check: {e}")

    return {"success": True, **result}


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


def get_active_jobs_summary() -> str:
    """Get a brief summary of active jobs for prompts."""
    if not active_jobs:
        return "No active jobs"

    summaries = []
    for job_id, job in active_jobs.items():
        if job.status in [JobStatus.QUEUED, JobStatus.IN_PROGRESS]:
            summaries.append(f"- {job.service_type.value}: {job.description} ({job.status.value}, {job.progress:.0%})")

    return "\n".join(summaries) if summaries else "No active jobs"


def get_recent_context(n: int = 3) -> str:
    """Get recent conversation context."""
    if not conversation_history:
        return "No prior context"

    recent = conversation_history[-n*2:]  # Last n exchanges
    return "\n".join([f"{m['role']}: {m['content'][:100]}..." for m in recent])


# ============================================
# Router Model Functions
# ============================================

async def classify_intent(user_message: str) -> OperationalMode:
    """Use router model to classify user intent into operational mode."""
    global router_model, router_tokenizer, router_ready, current_mode, last_subject, router_model_type

    if not router_ready or router_model is None:
        # Fallback to heuristic classification
        return heuristic_classify(user_message)

    try:
        # Build classification prompt
        prompt = ROUTER_EXAMPLES.format(
            active_jobs=get_active_jobs_summary(),
            last_subject=last_subject or "None",
            recent_context=get_recent_context(),
            user_message=user_message
        )

        t0 = time.perf_counter()

        if router_model_type == "gguf":
            # GGUF model inference using llama-cpp-python
            output = router_model(
                prompt,
                max_tokens=10,
                temperature=0.0,
                stop=["\n", "User:", "Mode:"],
            )
            response = output["choices"][0]["text"].strip().lower()
        else:
            # Transformers model inference
            inputs = router_tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)
            device = next(router_model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}

            input_length = inputs['input_ids'].shape[1]
            with torch.no_grad():
                outputs = router_model.generate(
                    **inputs,
                    max_new_tokens=10,
                    do_sample=False,
                    pad_token_id=router_tokenizer.pad_token_id,
                )

            # Decode only the new tokens (not the prompt)
            new_token_ids = outputs[0][input_length:]
            response = router_tokenizer.decode(new_token_ids, skip_special_tokens=True).strip().lower()

        classification_time = (time.perf_counter() - t0) * 1000
        add_log(f"Router classified '{user_message[:30]}...' as '{response}' in {classification_time:.0f}ms")

        # Map to mode
        if "planning" in response:
            return OperationalMode.PLANNING
        elif "execution" in response:
            return OperationalMode.EXECUTION
        else:
            return OperationalMode.CONVERSATION

    except Exception as e:
        add_log(f"Router error: {e}, using heuristic")
        return heuristic_classify(user_message)


def heuristic_classify(message: str) -> OperationalMode:
    """Fallback heuristic classification when router model unavailable."""
    message_lower = message.lower()

    # Execution indicators
    execution_keywords = [
        "status", "cancel", "stop", "pause", "resume", "modify", "change",
        "make it", "update", "what's happening", "is it done", "how long",
        "search", "find", "get", "show", "open", "close", "run",
        "periodic table", "element", "select"
    ]

    # Planning indicators
    planning_keywords = [
        "create", "generate", "build", "design", "plan", "analyze",
        "and then", "after that", "first", "then", "finally"
    ]

    # References to active jobs
    job_references = ["it", "that", "this", "the job", "the task"]

    # Check for job references with active jobs
    if any(ref in message_lower for ref in job_references) and active_jobs:
        return OperationalMode.EXECUTION

    # Check for execution keywords
    if any(kw in message_lower for kw in execution_keywords):
        return OperationalMode.EXECUTION

    # Check for complex multi-step requests
    if any(kw in message_lower for kw in planning_keywords):
        if " and " in message_lower or "," in message:
            return OperationalMode.PLANNING
        return OperationalMode.EXECUTION

    # Default to conversation
    return OperationalMode.CONVERSATION


# ============================================
# Tool Definitions and Execution
# ============================================

TOOL_DEFINITIONS = {
    "submit_job": {
        "description": "Submit a new job to a service",
        "parameters": {
            "service_type": "string (music_generation, image_generation, spreadsheet, etc.)",
            "parameters": "object with service-specific parameters",
            "description": "string describing the job"
        }
    },
    "get_job_status": {
        "description": "Get status of a job by ID or most recent",
        "parameters": {
            "job_id": "string (optional, uses most recent if not provided)"
        }
    },
    "modify_job": {
        "description": "Modify parameters of a running job",
        "parameters": {
            "job_id": "string",
            "parameters": "object with parameters to modify"
        }
    },
    "cancel_job": {
        "description": "Cancel a running job",
        "parameters": {
            "job_id": "string"
        }
    },
    "list_active_jobs": {
        "description": "List all active jobs",
        "parameters": {}
    },
    "call_service": {
        "description": "Make a direct call to a service",
        "parameters": {
            "service": "string (name of the service)",
            "action": "string (API action to call)",
            "data": "object with request data"
        }
    },
    "search_workflows": {
        "description": "Search available workflows",
        "parameters": {
            "query": "string search query"
        }
    },
    "launch_workflow": {
        "description": "Launch a workflow window",
        "parameters": {
            "workflow_name": "string name of the workflow"
        }
    },
    "select_periodic_element": {
        "description": "Select an element in the Periodic Table workflow to display its details and 3D atom model",
        "parameters": {
            "symbol": "string (optional) element symbol e.g. 'H', 'He', 'Fe'",
            "number": "integer (optional) atomic number e.g. 1, 2, 26",
            "name": "string (optional) element name e.g. 'Hydrogen', 'Iron'"
        }
    }
}


async def execute_tool(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a tool and return the result."""
    global active_jobs, last_subject

    add_log(f"Executing tool: {tool_name} with {arguments}")

    try:
        if tool_name == "submit_job":
            return await submit_job_tool(arguments)
        elif tool_name == "get_job_status":
            return get_job_status_tool(arguments)
        elif tool_name == "modify_job":
            return await modify_job_tool(arguments)
        elif tool_name == "cancel_job":
            return await cancel_job_tool(arguments)
        elif tool_name == "list_active_jobs":
            return list_active_jobs_tool()
        elif tool_name == "call_service":
            return await call_service_tool(arguments)
        elif tool_name == "search_workflows":
            return search_workflows_tool(arguments)
        elif tool_name == "launch_workflow":
            return launch_workflow_tool(arguments)
        elif tool_name == "select_periodic_element":
            return select_periodic_element_tool(arguments)
        else:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}
    except Exception as e:
        add_log(f"Tool error: {str(e)}")
        return {"success": False, "error": str(e)}


async def submit_job_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Submit a new job to a service."""
    global active_jobs, last_subject

    service_type_str = args.get("service_type", "")
    parameters = args.get("parameters", {})
    description = args.get("description", "Untitled job")

    try:
        service_type = ServiceType(service_type_str)
    except ValueError:
        return {"success": False, "error": f"Unknown service type: {service_type_str}"}

    # Create job
    job_id = str(uuid.uuid4())[:8]
    job = Job(
        id=job_id,
        service_type=service_type,
        parameters=parameters,
        description=description,
        estimated_duration=estimate_duration(service_type, parameters)
    )

    active_jobs[job_id] = job
    last_subject = f"job:{job_id}"

    # In a real implementation, this would submit to the actual service
    # For now, simulate job start
    asyncio.create_task(simulate_job_execution(job_id))

    add_log(f"Submitted job {job_id}: {description}")

    return {
        "success": True,
        "job_id": job_id,
        "message": f"Job submitted: {description}",
        "estimated_duration": job.estimated_duration
    }


def get_job_status_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get status of a job."""
    job_id = args.get("job_id")

    if not job_id:
        # Get most recent job
        if active_jobs:
            job_id = list(active_jobs.keys())[-1]
        else:
            return {"success": False, "error": "No active jobs"}

    job = active_jobs.get(job_id)
    if not job:
        return {"success": False, "error": f"Job {job_id} not found"}

    return {
        "success": True,
        "job": job.to_dict()
    }


async def modify_job_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Modify a running job."""
    job_id = args.get("job_id")
    parameters = args.get("parameters", {})

    job = active_jobs.get(job_id)
    if not job:
        return {"success": False, "error": f"Job {job_id} not found"}

    if not job.can_modify:
        return {"success": False, "error": f"Job {job_id} cannot be modified at this stage"}

    # Update parameters
    job.parameters.update(parameters)
    add_log(f"Modified job {job_id}: {parameters}")

    return {
        "success": True,
        "message": f"Job {job_id} modified",
        "updated_parameters": job.parameters
    }


async def cancel_job_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Cancel a job."""
    job_id = args.get("job_id")

    job = active_jobs.get(job_id)
    if not job:
        return {"success": False, "error": f"Job {job_id} not found"}

    job.status = JobStatus.CANCELLED
    job.completed_at = time.time()

    add_log(f"Cancelled job {job_id}")

    return {
        "success": True,
        "message": f"Job {job_id} cancelled"
    }


def list_active_jobs_tool() -> Dict[str, Any]:
    """List all active jobs."""
    jobs = [job.to_dict() for job in active_jobs.values()]
    return {
        "success": True,
        "jobs": jobs,
        "count": len(jobs)
    }


async def call_service_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Make a direct call to a service."""
    service_name = args.get("service")
    action = args.get("action")
    data = args.get("data", {})

    service = service_registry.get(service_name)
    if not service:
        return {"success": False, "error": f"Service {service_name} not registered"}

    if not service.is_available:
        return {"success": False, "error": f"Service {service_name} is not available"}

    # In a real implementation, make HTTP call to service
    # For now, return placeholder
    return {
        "success": True,
        "message": f"Called {service_name}.{action}",
        "data": data
    }


def search_workflows_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search available workflows."""
    query = args.get("query", "").lower()
    workflows_path = get_workflows_path()

    if not workflows_path.exists():
        return {"success": False, "error": "Workflows path not available"}

    results = []
    for root, dirs, files in os.walk(workflows_path):
        for file in files:
            if file.endswith(('.tsx', '.jsx')):
                name = file.replace('.tsx', '').replace('.jsx', '')
                if query in name.lower() or query in file.lower():
                    results.append({
                        "name": name,
                        "file": file,
                        "path": os.path.join(root, file)
                    })

    return {
        "success": True,
        "workflows": results[:10],  # Limit results
        "count": len(results)
    }


def launch_workflow_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Launch a workflow (returns instruction for UI to handle)."""
    workflow_name = args.get("workflow_name")

    return {
        "success": True,
        "action": "launch_workflow",
        "workflow_name": workflow_name,
        "message": f"Launching workflow: {workflow_name}"
    }


def select_periodic_element_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Select an element in the Periodic Table workflow.
    Returns instruction for UI to publish EventBus event."""
    symbol = args.get("symbol")
    number = args.get("number")
    name = args.get("name")

    # Build element identifier for message
    identifier = symbol or name or (f"element {number}" if number else "unknown")

    return {
        "success": True,
        "action": "select_periodic_element",
        "element": {
            "symbol": symbol,
            "number": number,
            "name": name
        },
        "message": f"Selecting {identifier} in the Periodic Table"
    }


def estimate_duration(service_type: ServiceType, parameters: Dict) -> float:
    """Estimate job duration based on service type and parameters."""
    base_times = {
        ServiceType.MUSIC_GENERATION: 120,  # 2 minutes
        ServiceType.IMAGE_GENERATION: 30,   # 30 seconds
        ServiceType.SPREADSHEET: 10,        # 10 seconds
        ServiceType.CALENDAR: 2,            # 2 seconds
        ServiceType.RAG: 5,                 # 5 seconds
        ServiceType.CAD: 60,                # 1 minute
        ServiceType.DOCUMENT: 15,           # 15 seconds
        ServiceType.CHAT: 5,                # 5 seconds
        ServiceType.WORKFLOW: 1,            # 1 second
    }
    return base_times.get(service_type, 30)


async def simulate_job_execution(job_id: str):
    """Simulate job execution for testing."""
    job = active_jobs.get(job_id)
    if not job:
        return

    job.status = JobStatus.IN_PROGRESS
    job.started_at = time.time()

    duration = job.estimated_duration or 10
    steps = 10

    for i in range(steps):
        await asyncio.sleep(duration / steps)
        job.progress = (i + 1) / steps

        if job.status == JobStatus.CANCELLED:
            return

        # Broadcast progress update
        await broadcast_update({
            "type": "job_progress",
            "job_id": job_id,
            "progress": job.progress
        })

    job.status = JobStatus.COMPLETE
    job.completed_at = time.time()
    job.result = {"message": f"Job {job_id} completed successfully"}

    # Broadcast completion
    await broadcast_update({
        "type": "job_complete",
        "job_id": job_id,
        "result": job.result
    })


async def broadcast_update(data: Dict):
    """Broadcast update to all connected WebSocket clients."""
    for ws in websocket_connections:
        try:
            await ws.send_json(data)
        except Exception:
            pass


# ============================================
# Quick Response (Router Model for Fast Chat)
# ============================================

async def generate_quick_response(user_message: str, max_tokens: int = 128) -> str:
    """Generate a quick conversational response using the router model.
    Much faster than main model, suitable for simple chat."""
    global router_model, router_tokenizer, router_ready, conversation_history, router_model_type
    import time

    add_log(f"[Router] Starting response for: {user_message[:50]}...")

    if not router_ready or router_model is None:
        add_log("[Router] Router not ready!")
        return {"response": "I'm not able to respond right now. Please load a model.", "task": None, "full_output": ""}

    try:
        t0 = time.perf_counter()

        # Use the new few-shot prompt format
        formatted_prompt = ROUTER_EXAMPLES.format(user_message=user_message)

        if router_model_type == "gguf":
            add_log(f"[Router] GGUF prompt ({len(formatted_prompt)} chars)")

            t2 = time.perf_counter()
            output = router_model(
                formatted_prompt,
                max_tokens=max_tokens,
                temperature=0.7,
                top_p=0.9,
                stop=["User:", "<|endoftext|>", "<|im_end|>"],
            )

            full_output = output["choices"][0]["text"].strip()
            gen_time = (time.perf_counter() - t2) * 1000
            tokens_generated = output.get("usage", {}).get("completion_tokens", len(full_output.split()))
            add_log(f"[Router] Generated ~{tokens_generated} tokens in {gen_time:.0f}ms ({tokens_generated/(gen_time/1000):.1f} tok/s)")

        else:
            # Transformers model inference
            add_log(f"[Router] Transformers prompt ({len(formatted_prompt)} chars)")

            inputs = router_tokenizer(formatted_prompt, return_tensors="pt", truncation=True, max_length=1024)
            device = next(router_model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}

            t2 = time.perf_counter()
            with torch.no_grad():
                outputs = router_model.generate(
                    **inputs,
                    max_new_tokens=max_tokens,
                    do_sample=True,
                    temperature=0.7,
                    top_p=0.9,
                    pad_token_id=router_tokenizer.pad_token_id,
                    eos_token_id=router_tokenizer.eos_token_id,
                )
            gen_time = (time.perf_counter() - t2) * 1000
            input_length = inputs['input_ids'].shape[1]
            new_tokens = outputs.shape[1] - input_length
            add_log(f"[Router] Generated {new_tokens} tokens in {gen_time:.0f}ms")

            new_token_ids = outputs[0][input_length:]
            full_output = router_tokenizer.decode(new_token_ids, skip_special_tokens=True).strip()

        # Parse response and task from output
        response = full_output
        task = None

        # Extract first TASK block if present
        task_match = re.search(r'<TASK>(.+?)</TASK>', full_output)
        if task_match:
            task = task_match.group(1).strip()
            add_log(f"[Router] Found task: {task}")

        # Clean up response for user:
        # 1. Remove ALL task blocks
        response = re.sub(r'\s*<TASK>.+?</TASK>\s*', '', full_output, flags=re.DOTALL)
        # 2. Remove any "Assistant:" prefix the model might have added
        response = re.sub(r'^Assistant:\s*', '', response, flags=re.IGNORECASE)
        # 3. Remove any duplicate content (model sometimes repeats)
        lines = response.split('\n')
        seen = set()
        unique_lines = []
        for line in lines:
            line_clean = line.strip()
            if line_clean and line_clean not in seen:
                seen.add(line_clean)
                unique_lines.append(line)
        response = '\n'.join(unique_lines).strip()

        # Update conversation history (without task block)
        conversation_history.append({"role": "user", "content": user_message})
        conversation_history.append({"role": "assistant", "content": response})

        total_time = (time.perf_counter() - t0) * 1000
        add_log(f"[Router] Complete in {total_time:.0f}ms")

        return {
            "response": response,
            "task": task,
            "full_output": full_output
        }

    except Exception as e:
        add_log(f"[Router] Error: {e}")
        import traceback
        traceback.print_exc()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return {"response": f"Sorry, I encountered an error: {e}", "task": None, "full_output": ""}


# ============================================
# Task Execution (Main Model - Silent)
# ============================================

async def execute_task_silent(task: str) -> Dict[str, Any]:
    """Execute a task using the main model silently (user doesn't see output).
    Returns the result for debug logging."""
    global main_model, main_ready, main_model_type
    import time

    add_log(f"[MainModel] Executing task: {task}")

    if not main_ready or main_model is None:
        add_log("[MainModel] Main model not ready, executing task directly")
        # Parse task and execute directly without main model
        return await execute_task_directly(task)

    try:
        t0 = time.perf_counter()

        # Simple prompt for main model
        prompt = MAIN_MODEL_PROMPT.format(task=task)

        if main_model_type == "gguf":
            output = main_model(
                prompt,
                max_tokens=100,
                temperature=0.1,  # Low temp for deterministic tool calls
                stop=["```\n", "<|endoftext|>", "<|im_end|>"],
            )
            full_output = output["choices"][0]["text"].strip()
        else:
            # Transformers
            inputs = main_tokenizer(prompt, return_tensors="pt", truncation=True, max_length=512)
            device = next(main_model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = main_model.generate(
                    **inputs,
                    max_new_tokens=100,
                    do_sample=False,
                    pad_token_id=main_tokenizer.pad_token_id,
                )
            input_length = inputs['input_ids'].shape[1]
            new_token_ids = outputs[0][input_length:]
            full_output = main_tokenizer.decode(new_token_ids, skip_special_tokens=True).strip()

        gen_time = (time.perf_counter() - t0) * 1000
        add_log(f"[MainModel] Generated in {gen_time:.0f}ms: {full_output[:100]}...")

        # Parse and execute tool calls
        tool_results = await parse_and_execute_tools(full_output)

        return {
            "success": True,
            "full_output": full_output,
            "tool_results": tool_results,
            "gen_time_ms": gen_time
        }

    except Exception as e:
        add_log(f"[MainModel] Error: {e}")
        return {"success": False, "error": str(e), "full_output": ""}


async def execute_task_directly(task: str) -> Dict[str, Any]:
    """Execute a task directly without using main model (fallback)."""
    add_log(f"[Direct] Executing task directly: {task}")

    # Parse task format: "select_element:SYMBOL"
    if task.startswith("select_element:"):
        symbol = task.split(":", 1)[1].strip()
        result = select_periodic_element_tool({"symbol": symbol})
        return {
            "success": True,
            "full_output": f"Direct execution: select_element:{symbol}",
            "tool_results": [{"tool": "select_periodic_element", **result}],
            "gen_time_ms": 0
        }

    return {"success": False, "error": f"Unknown task format: {task}", "full_output": ""}


# ============================================
# Main Model Generation (Legacy - for streaming)
# ============================================

async def generate_response(user_message: str, mode: OperationalMode, temperature: float = 0.7, max_tokens: int = 1024) -> AsyncGenerator[str, None]:
    """Generate a response using the main model in the specified mode."""
    global main_model, main_tokenizer, main_ready, conversation_history, last_subject, main_model_type

    if not main_ready or main_model is None:
        yield "Main model not loaded. Please load a model first."
        return

    try:
        # Build system prompt based on mode
        if mode == OperationalMode.PLANNING:
            system_prompt = PLANNING_SYSTEM_PROMPT.format(
                services=", ".join([s.name for s in service_registry.values()]),
                active_jobs=get_active_jobs_summary()
            )
        elif mode == OperationalMode.EXECUTION:
            system_prompt = EXECUTION_SYSTEM_PROMPT.format(
                tools=json.dumps(TOOL_DEFINITIONS, indent=2),
                active_jobs=get_active_jobs_summary(),
                last_subject=last_subject or "None"
            )
        else:
            system_prompt = CONVERSATION_SYSTEM_PROMPT.format(
                active_jobs=get_active_jobs_summary(),
                current_time=datetime.now().strftime("%I:%M %p")
            )

        # Build messages
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(conversation_history[-10:])  # Last 5 exchanges
        messages.append({"role": "user", "content": user_message})

        full_response = ""

        if main_model_type == "gguf":
            # GGUF model generation using llama-cpp-python
            # Format as simple chat prompt
            formatted_prompt = f"System: {system_prompt}\n\n"
            for msg in messages[1:]:
                role = msg['role'].capitalize()
                formatted_prompt += f"{role}: {msg['content']}\n\n"
            formatted_prompt += "Assistant:"

            add_log(f"[GGUF Main] Starting generation (max {max_tokens} tokens)...")
            t0 = time.perf_counter()

            # GGUF streaming generation
            for chunk in main_model(
                formatted_prompt,
                max_tokens=max_tokens,
                temperature=max(0.01, temperature),
                top_p=0.9,
                stop=["User:", "\n\nUser:", "<|endoftext|>", "<|im_end|>"],
                stream=True,
            ):
                text = chunk["choices"][0]["text"]
                if text:
                    full_response += text
                    yield text
                await asyncio.sleep(0)

            gen_time = (time.perf_counter() - t0) * 1000
            add_log(f"[GGUF Main] Generated {len(full_response.split())} words in {gen_time:.0f}ms")

        else:
            # Transformers model generation
            # Format prompt
            try:
                formatted_prompt = main_tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True
                )
            except Exception:
                # Fallback formatting
                formatted_prompt = f"System: {system_prompt}\n\n"
                for msg in messages[1:]:
                    formatted_prompt += f"{msg['role'].capitalize()}: {msg['content']}\n\n"
                formatted_prompt += "Assistant:"

            # Tokenize
            inputs = main_tokenizer(formatted_prompt, return_tensors="pt", truncation=True, max_length=8192)
            device = next(main_model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}

            # Use streaming generation
            from transformers import TextIteratorStreamer

            streamer = TextIteratorStreamer(main_tokenizer, skip_prompt=True, skip_special_tokens=True)

            gen_kwargs = {
                "max_new_tokens": max_tokens,
                "do_sample": True,
                "temperature": max(0.01, temperature),
                "top_k": 50,
                "top_p": 0.9,
                "pad_token_id": main_tokenizer.pad_token_id,
                "eos_token_id": main_tokenizer.eos_token_id,
                "streamer": streamer,
                **inputs
            }

            # Run generation in thread
            thread = Thread(target=lambda: main_model.generate(**gen_kwargs))
            thread.start()

            for text in streamer:
                if text:
                    full_response += text
                    yield text
                await asyncio.sleep(0)

            thread.join()

        # Parse and execute tool calls if in execution mode
        if mode == OperationalMode.EXECUTION:
            tool_results = await parse_and_execute_tools(full_response)
            if tool_results:
                yield "\n\n"
                for result in tool_results:
                    yield f"Tool {result['tool']}: {result.get('message', 'Done')}\n"
                    # Emit action event for client-side actions (like EventBus events)
                    if result.get('action'):
                        yield f"__ACTION__:{json.dumps(result)}"

        # Update conversation history
        conversation_history.append({"role": "user", "content": user_message})
        conversation_history.append({"role": "assistant", "content": full_response})

        # Keep history manageable
        if len(conversation_history) > 20:
            conversation_history = conversation_history[-20:]

        # Update last subject from response
        update_last_subject(full_response)

    except Exception as e:
        add_log(f"Generation error: {e}")
        yield f"Error generating response: {str(e)}"


async def parse_and_execute_tools(response: str) -> List[Dict]:
    """Parse tool calls from response and execute them."""
    results = []

    # Look for tool blocks
    tool_pattern = r'```tool\s*\n?(\{[^`]+\})\s*\n?```'
    matches = re.findall(tool_pattern, response, re.DOTALL)

    for match in matches:
        try:
            tool_json = json.loads(match.strip())
            if "tool" in tool_json:
                tool_name = tool_json["tool"]
                arguments = tool_json.get("arguments", {})
                result = await execute_tool(tool_name, arguments)
                results.append({
                    "tool": tool_name,
                    "arguments": arguments,
                    **result
                })
        except json.JSONDecodeError:
            continue

    return results


def update_last_subject(response: str):
    """Update last subject for pronoun resolution."""
    global last_subject

    # Look for job references in response
    job_match = re.search(r'job[_\s]?([a-f0-9]+)', response.lower())
    if job_match:
        last_subject = f"job:{job_match.group(1)}"
        return

    # Look for service references
    for service_type in ServiceType:
        if service_type.value in response.lower():
            last_subject = f"service:{service_type.value}"
            return


# ============================================
# Speech-to-Text Functions
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
        add_log(f"Resampling: {orig_sr}Hz -> {target_sr}Hz, {len(audio_array)} -> {num_samples} samples")
        resampled = signal.resample(audio_array, num_samples)
        return resampled.astype(np.float32)
    except ImportError:
        pass

    # Fallback: use pydub for resampling (converts through AudioSegment)
    try:
        from pydub import AudioSegment

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


def decode_audio_bytes(audio_data: bytes, format_hint: str = "wav") -> tuple:
    """Decode audio bytes to numpy array. Returns (audio_array, sample_rate)."""
    import numpy as np

    add_log(f"Decoding {len(audio_data)} bytes of audio (format hint: {format_hint})")

    detected_sample_rate = 16000
    audio_array = None

    # Try pydub first for webm/opus formats (common browser formats)
    if format_hint in ['webm', 'opus', 'ogg'] or audio_data[:4] != b'RIFF':
        try:
            from pydub import AudioSegment

            # Determine the format for pydub
            pydub_format = format_hint
            if format_hint == 'webm' or audio_data[:4] == b'\x1a\x45\xdf\xa3':  # WebM magic bytes
                pydub_format = 'webm'

            add_log(f"Using pydub to decode {pydub_format} audio...")

            # Write to temp file since pydub needs file path for some formats
            with tempfile.NamedTemporaryFile(suffix=f'.{pydub_format}', delete=False) as tmp:
                tmp.write(audio_data)
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

                add_log(f"Pydub decoded: {detected_sample_rate}Hz, {audio_segment.channels}ch, {sample_width}B/sample, {len(audio_array)} samples")
            finally:
                # Clean up temp file
                os.unlink(tmp_path)

        except Exception as pydub_error:
            add_log(f"Pydub failed ({pydub_error}), trying WAV...")

    # Try to parse as WAV file
    if audio_array is None:
        try:
            with wave.open(io.BytesIO(audio_data), 'rb') as wav_file:
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
            audio_array, detected_sample_rate = sf.read(io.BytesIO(audio_data))
            # Convert to mono if stereo
            if len(audio_array.shape) > 1:
                audio_array = audio_array.mean(axis=1)
            audio_array = audio_array.astype(np.float32)
            add_log(f"Soundfile decoded: {detected_sample_rate}Hz, {len(audio_array)} samples")
        except Exception as sf_error:
            add_log(f"Soundfile also failed: {sf_error}")
            raise ValueError(f"Cannot decode audio. Tried pydub, wav, soundfile. Error: {sf_error}")

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

    return audio_array, target_sr


async def transcribe_audio(audio_data: bytes, sample_rate: int = 16000, format_hint: str = "wav") -> str:
    """Transcribe audio to text using Whisper."""
    global stt_model, stt_ready

    add_log(f"transcribe_audio called: {len(audio_data)} bytes, format={format_hint}")

    if not stt_ready or stt_model is None:
        add_log("STT model not loaded!")
        return "[STT model not loaded]"

    try:
        import numpy as np

        # Decode audio using robust decoder (handles webm, opus, wav, etc.)
        try:
            add_log("Decoding audio...")
            audio_array, actual_sample_rate = decode_audio_bytes(audio_data, format_hint)
            add_log(f"Audio decoded: {len(audio_array)} samples at {actual_sample_rate}Hz")
        except ValueError as e:
            add_log(f"Audio decode error: {e}")
            return f"[Audio decode error: {e}]"

        # Ensure audio is float32 and 1D
        audio_array = np.asarray(audio_array, dtype=np.float32)
        if len(audio_array.shape) > 1:
            audio_array = audio_array.mean(axis=1)

        # Process with Whisper
        processor = stt_model["processor"]
        model = stt_model["model"]

        # Get model device and dtype
        device = next(model.parameters()).device
        model_dtype = next(model.parameters()).dtype
        add_log(f"Running Whisper on {device} with dtype {model_dtype}...")

        # Process audio features (always use 16kHz for Whisper)
        inputs = processor(audio_array, sampling_rate=16000, return_tensors="pt")
        input_features = inputs.input_features.to(device=device, dtype=model_dtype)

        add_log("Generating transcription...")
        with torch.no_grad():
            predicted_ids = model.generate(input_features)

        transcription = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

        add_log(f"Transcribed: {transcription[:50]}...")
        return transcription.strip()

    except Exception as e:
        add_log(f"Transcription error: {e}")
        import traceback
        traceback.print_exc()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return f"[Transcription error: {e}]"


# ============================================
# Text-to-Speech Functions
# ============================================

async def synthesize_speech(text: str) -> bytes:
    """Synthesize speech from text."""
    global tts_model, tts_ready

    if not tts_ready or tts_model is None:
        return b""

    try:
        import numpy as np

        # Check TTS model type
        if tts_model.get("type") == "kokoro":
            # Kokoro TTS synthesis
            model = tts_model["model"]
            pipelines = tts_model["pipelines"]
            voice = tts_model.get("voice", "af_heart")
            speed = 1.0

            # Select pipeline based on voice
            pipeline = pipelines[voice[0]]
            pack = pipeline.load_voice(voice)

            # Generate audio
            audio_chunks = []
            for _, ps, _ in pipeline(text, voice, speed):
                ref_s = pack[len(ps)-1]
                with torch.no_grad():
                    audio = model(ps, ref_s, speed)
                audio_chunks.append(audio.cpu().numpy())

            # Concatenate all audio chunks
            if audio_chunks:
                audio_data = np.concatenate(audio_chunks)
            else:
                return b""

            # Create WAV file in memory (Kokoro outputs at 24kHz)
            buffer = io.BytesIO()
            with wave.open(buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(24000)  # Kokoro uses 24kHz
                wav_file.writeframes((audio_data * 32767).astype(np.int16).tobytes())

            return buffer.getvalue()

        else:
            # SpeechT5 TTS synthesis (legacy)
            model = tts_model["model"]
            processor = tts_model["processor"]
            vocoder = tts_model.get("vocoder")
            speaker_embeddings = tts_model.get("speaker_embeddings")

            inputs = processor(text=text, return_tensors="pt")
            device = next(model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items() if k != "input_ids"}
            inputs["input_ids"] = inputs.get("input_ids", processor(text=text, return_tensors="pt")["input_ids"]).to(device)

            if speaker_embeddings is not None:
                inputs["speaker_embeddings"] = speaker_embeddings.to(device)

            with torch.no_grad():
                speech = model.generate_speech(inputs["input_ids"], speaker_embeddings, vocoder=vocoder)

            # Convert to bytes
            audio_data = speech.cpu().numpy()

            # Create WAV file in memory
            buffer = io.BytesIO()
            with wave.open(buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(16000)
                wav_file.writeframes((audio_data * 32767).astype(np.int16).tobytes())

            return buffer.getvalue()

    except Exception as e:
        add_log(f"TTS error: {e}")
        return b""


# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    return {"status": "online", "service": "Voice Agent Server"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "router_ready": router_ready,
        "main_ready": main_ready,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/status")
async def status():
    vram = get_vram_stats()
    return {
        "router": {
            "ready": router_ready,
            "loading": router_loading,
            "model_name": router_model_name,
        },
        "main": {
            "ready": main_ready,
            "loading": main_loading,
            "model_name": main_model_name,
        },
        "stt": {
            "ready": stt_ready,
            "loading": stt_loading,
        },
        "tts": {
            "ready": tts_ready,
            "loading": tts_loading,
        },
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "active_jobs": len(active_jobs),
        "registered_services": len(service_registry),
        "current_mode": current_mode.value,
        "conversation_length": len(conversation_history),
        "models_cache_path": str(models_cache),
    }


@app.get("/log")
async def get_log():
    return {"log": agent_log[-100:]}


# ============================================
# Model Loading Endpoints
# ============================================

@app.post("/load_router")
async def load_router(config: RouterModelConfig):
    """Load the router model for intent classification."""
    global router_model, router_tokenizer, router_model_name, router_ready, router_loading, router_model_type

    if router_loading:
        return {"success": False, "error": "Router model is already loading"}

    router_loading = True

    try:
        if router_model is not None:
            add_log("Unloading existing router model...")
            if router_model_type == "gguf":
                del router_model
            else:
                router_model.to("cpu")
                del router_model
            router_model = None
            if router_tokenizer is not None:
                del router_tokenizer
                router_tokenizer = None
            clear_cuda()

        router_model_name = config.model_name
        router_model_type = config.model_type
        add_log(f"Loading router model: {router_model_name} (type: {router_model_type})")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        if config.device != "auto":
            device = config.device

        # Use shared model cache path
        cache_dir = str(models_cache)
        add_log(f"Using model cache: {cache_dir}")

        if config.model_type == "gguf":
            # Load GGUF model using llama-cpp-python
            try:
                from llama_cpp import Llama
            except ImportError:
                return {"success": False, "error": "llama-cpp-python not installed. Install with: pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121"}

            # Check GPU support - try function first, then check version for +cu indicator
            import llama_cpp
            gpu_supported = False
            llama_version = getattr(llama_cpp, "__version__", "")

            # Check version string for CUDA indicator (e.g., "0.2.26+cu121")
            if "+cu" in llama_version:
                gpu_supported = True

            # Also try the function if available
            try:
                if llama_cpp.llama_supports_gpu_offload():
                    gpu_supported = True
            except (AttributeError, Exception):
                pass

            n_gpu_layers = config.n_gpu_layers if gpu_supported else 0
            add_log(f"Loading GGUF model (GPU layers: {n_gpu_layers}, GPU supported: {gpu_supported}, version: {llama_version})...")

            # For HuggingFace repos, download the model first
            if "/" in config.model_name and not config.model_name.endswith(".gguf"):
                from huggingface_hub import hf_hub_download, list_repo_files

                # Find the .gguf file to download
                gguf_file = config.gguf_file
                if not gguf_file:
                    # List files and find a suitable .gguf file
                    files = list_repo_files(config.model_name)
                    gguf_files = [f for f in files if f.endswith(".gguf")]
                    if not gguf_files:
                        return {"success": False, "error": f"No .gguf files found in {config.model_name}"}
                    # Prefer Q4_K_M or similar common quantization
                    for preferred in ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q8_0"]:
                        for f in gguf_files:
                            if preferred in f:
                                gguf_file = f
                                break
                        if gguf_file:
                            break
                    if not gguf_file:
                        gguf_file = gguf_files[0]  # Use first available

                add_log(f"Downloading GGUF file: {gguf_file}")
                model_path = hf_hub_download(
                    repo_id=config.model_name,
                    filename=gguf_file,
                    cache_dir=cache_dir
                )
            else:
                model_path = config.model_name

            add_log(f"Loading GGUF from: {model_path}")
            router_model = Llama(
                model_path=model_path,
                n_gpu_layers=n_gpu_layers,
                n_ctx=config.n_ctx,
                verbose=False,
            )
            router_tokenizer = None  # GGUF models handle tokenization internally
            router_ready = True

            add_log(f"GGUF router model loaded (GPU layers: {n_gpu_layers})")
            return {"success": True, "device": "gpu" if n_gpu_layers > 0 else "cpu", "model_name": router_model_name, "model_type": "gguf", "gpu_layers": n_gpu_layers}

        else:
            # Load transformers model (GPTQ or FP16)
            from transformers import AutoTokenizer

            router_tokenizer = AutoTokenizer.from_pretrained(
                router_model_name,
                trust_remote_code=True,
                cache_dir=cache_dir
            )

            if router_tokenizer.pad_token is None:
                router_tokenizer.pad_token = router_tokenizer.eos_token

            # Check if this is a GPTQ quantized model
            is_gptq = "gptq" in router_model_name.lower() or "GPTQ" in router_model_name

            from transformers import AutoModelForCausalLM

            if is_gptq:
                add_log("Loading GPTQ quantized router model via transformers...")
                router_model = AutoModelForCausalLM.from_pretrained(
                    router_model_name,
                    device_map="auto" if device == "cuda" else None,
                    trust_remote_code=True,
                    cache_dir=cache_dir
                )
            else:
                add_log("Loading FP16/FP32 router model...")
                dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

                router_model = AutoModelForCausalLM.from_pretrained(
                    router_model_name,
                    torch_dtype=dtype,
                    trust_remote_code=True,
                    low_cpu_mem_usage=True,
                    cache_dir=cache_dir
                )
                router_model.to(device)

            router_model.eval()
            router_ready = True

            add_log(f"Router model loaded on {device} (GPTQ: {is_gptq})")
            return {"success": True, "device": device, "model_name": router_model_name, "model_type": "transformers", "is_gptq": is_gptq}

    except Exception as e:
        router_ready = False
        add_log(f"Router load error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        router_loading = False


@app.post("/load_main")
async def load_main(config: MainModelConfig):
    """Load the main model for reasoning and generation."""
    global main_model, main_tokenizer, main_model_name, main_ready, main_loading, main_model_type

    if main_loading:
        return {"success": False, "error": "Main model is already loading"}

    main_loading = True

    try:
        if main_model is not None:
            add_log("Unloading existing main model...")
            if main_model_type == "gguf":
                del main_model
            else:
                main_model.to("cpu")
                del main_model
            main_model = None
            if main_tokenizer is not None:
                del main_tokenizer
                main_tokenizer = None
            clear_cuda()

        main_model_name = config.model_name
        main_model_type = config.model_type
        add_log(f"Loading main model: {main_model_name} (type: {main_model_type})")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        if config.device != "auto":
            device = config.device

        # Use shared model cache path
        cache_dir = str(models_cache)
        add_log(f"Using model cache: {cache_dir}")

        if config.model_type == "gguf":
            # Load GGUF model using llama-cpp-python
            try:
                from llama_cpp import Llama
            except ImportError:
                return {"success": False, "error": "llama-cpp-python not installed. Install with: pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121"}

            # Check GPU support - try function first, then check version for +cu indicator
            import llama_cpp
            gpu_supported = False
            llama_version = getattr(llama_cpp, "__version__", "")

            # Check version string for CUDA indicator (e.g., "0.2.26+cu121")
            if "+cu" in llama_version:
                gpu_supported = True

            # Also try the function if available
            try:
                if llama_cpp.llama_supports_gpu_offload():
                    gpu_supported = True
            except (AttributeError, Exception):
                pass

            n_gpu_layers = config.n_gpu_layers if gpu_supported else 0
            add_log(f"Loading GGUF model (GPU layers: {n_gpu_layers}, GPU supported: {gpu_supported}, version: {llama_version})...")

            # For HuggingFace repos, download the model first
            if "/" in config.model_name and not config.model_name.endswith(".gguf"):
                from huggingface_hub import hf_hub_download, list_repo_files

                # Find the .gguf file to download
                gguf_file = config.gguf_file
                if not gguf_file:
                    # List files and find a suitable .gguf file
                    files = list_repo_files(config.model_name)
                    gguf_files = [f for f in files if f.endswith(".gguf")]
                    if not gguf_files:
                        return {"success": False, "error": f"No .gguf files found in {config.model_name}"}
                    # Prefer Q4_K_M or similar common quantization
                    for preferred in ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q8_0"]:
                        for f in gguf_files:
                            if preferred in f:
                                gguf_file = f
                                break
                        if gguf_file:
                            break
                    if not gguf_file:
                        gguf_file = gguf_files[0]  # Use first available

                add_log(f"Downloading GGUF file: {gguf_file}")
                model_path = hf_hub_download(
                    repo_id=config.model_name,
                    filename=gguf_file,
                    cache_dir=cache_dir
                )
            else:
                model_path = config.model_name

            add_log(f"Loading GGUF from: {model_path}")
            main_model = Llama(
                model_path=model_path,
                n_gpu_layers=n_gpu_layers,
                n_ctx=config.n_ctx,
                verbose=False,
            )
            main_tokenizer = None  # GGUF models handle tokenization internally
            main_ready = True

            add_log(f"GGUF main model loaded (GPU layers: {n_gpu_layers})")
            return {"success": True, "device": "gpu" if n_gpu_layers > 0 else "cpu", "model_name": main_model_name, "model_type": "gguf", "gpu_layers": n_gpu_layers}

        else:
            # Load transformers model (GPTQ or FP16)
            from transformers import AutoTokenizer

            main_tokenizer = AutoTokenizer.from_pretrained(
                main_model_name,
                trust_remote_code=True,
                cache_dir=cache_dir
            )

            if main_tokenizer.pad_token is None:
                main_tokenizer.pad_token = main_tokenizer.eos_token

            # Check if this is a GPTQ quantized model
            is_gptq = "gptq" in main_model_name.lower() or "GPTQ" in main_model_name

            from transformers import AutoModelForCausalLM

            if is_gptq:
                add_log("Loading GPTQ quantized main model via transformers...")
                main_model = AutoModelForCausalLM.from_pretrained(
                    main_model_name,
                    device_map="auto" if device == "cuda" else None,
                    trust_remote_code=True,
                    cache_dir=cache_dir
                )
            else:
                add_log("Loading FP16/FP32 main model...")
                dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

                main_model = AutoModelForCausalLM.from_pretrained(
                    main_model_name,
                    torch_dtype=dtype,
                    trust_remote_code=True,
                    low_cpu_mem_usage=True,
                    cache_dir=cache_dir
                )
                main_model.to(device)

            main_model.eval()
            main_ready = True

            add_log(f"Main model loaded on {device} (GPTQ: {is_gptq})")
            return {"success": True, "device": device, "model_name": main_model_name, "model_type": "transformers", "is_gptq": is_gptq}

    except Exception as e:
        main_ready = False
        add_log(f"Main model load error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        main_loading = False


@app.post("/load_stt")
async def load_stt(config: STTConfig):
    """Load the speech-to-text model (Whisper)."""
    global stt_model, stt_ready, stt_loading

    if stt_loading:
        return {"success": False, "error": "STT model is already loading"}

    stt_loading = True

    try:
        add_log(f"Loading STT model: {config.model_name}")

        from transformers import WhisperProcessor, WhisperForConditionalGeneration

        device = "cuda" if torch.cuda.is_available() else "cpu"
        if config.device != "auto":
            device = config.device

        # Use shared model cache path
        cache_dir = str(models_cache)
        add_log(f"Using model cache: {cache_dir}")

        processor = WhisperProcessor.from_pretrained(config.model_name, cache_dir=cache_dir)

        # Use fp16 for GPU to reduce VRAM usage
        dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

        model = WhisperForConditionalGeneration.from_pretrained(
            config.model_name,
            torch_dtype=dtype,
            cache_dir=cache_dir,
            low_cpu_mem_usage=True
        )
        model.to(device)
        model.eval()

        stt_model = {
            "processor": processor,
            "model": model
        }
        stt_ready = True

        add_log(f"STT model loaded on {device} with dtype {dtype}")
        return {"success": True, "device": device, "model_name": config.model_name}

    except Exception as e:
        stt_ready = False
        add_log(f"STT load error: {e}")
        return {"success": False, "error": str(e)}
    finally:
        stt_loading = False


def get_speaker_embeddings(cache_dir: str) -> torch.Tensor:
    """
    Get speaker embeddings for TTS. Downloads and caches a pre-computed embedding
    instead of using the deprecated datasets library.
    """
    import numpy as np

    embeddings_path = Path(cache_dir) / "speaker_embeddings"
    embeddings_path.mkdir(parents=True, exist_ok=True)
    cached_file = embeddings_path / "cmu_arctic_slt.npy"

    if cached_file.exists():
        add_log("Loading cached speaker embeddings...")
        xvector = np.load(str(cached_file))
        return torch.tensor(xvector).unsqueeze(0)

    add_log("Downloading speaker embeddings from HuggingFace Hub...")

    # Try to fetch from huggingface_hub directly (parquet file)
    try:
        from huggingface_hub import hf_hub_download

        # Download the parquet file from the dataset
        parquet_path = hf_hub_download(
            repo_id="Matthijs/cmu-arctic-xvectors",
            filename="data/validation-00000-of-00001.parquet",
            repo_type="dataset",
            cache_dir=cache_dir
        )

        # Read parquet and extract the xvector
        import pyarrow.parquet as pq
        table = pq.read_table(parquet_path)
        df = table.to_pandas()

        # Use index 7306 (same as original code) or first available
        idx = min(7306, len(df) - 1)
        xvector = np.array(df.iloc[idx]['xvector'])

        # Cache for next time
        np.save(str(cached_file), xvector)
        add_log(f"Speaker embeddings cached to {cached_file}")

        return torch.tensor(xvector).unsqueeze(0)

    except Exception as e:
        add_log(f"Could not load from parquet: {e}, using default embeddings")

        # Fallback: create a default speaker embedding (512-dim for SpeechT5)
        # This is a neutral embedding that will still work
        default_embedding = np.zeros(512, dtype=np.float32)
        default_embedding[0] = 1.0  # Simple non-zero embedding

        np.save(str(cached_file), default_embedding)
        return torch.tensor(default_embedding).unsqueeze(0)


@app.post("/load_tts")
async def load_tts(config: TTSConfig):
    """Load the text-to-speech model."""
    global tts_model, tts_ready, tts_loading

    if tts_loading:
        return {"success": False, "error": "TTS model is already loading"}

    tts_loading = True

    try:
        add_log(f"Loading TTS model: {config.model_name}")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        if config.device != "auto":
            device = config.device

        # Check if using Kokoro TTS
        if config.model_name == "kokoro":
            from kokoro import KModel, KPipeline

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
            tts_ready = True
            add_log(f"Kokoro TTS loaded on {device} with voice {config.voice}")
            return {"success": True, "device": device, "type": "kokoro"}

        else:
            # Legacy SpeechT5 support (if needed)
            from transformers import SpeechT5Processor, SpeechT5ForTextToSpeech, SpeechT5HifiGan

            cache_dir = str(models_cache)
            processor = SpeechT5Processor.from_pretrained(config.model_name, cache_dir=cache_dir)
            model = SpeechT5ForTextToSpeech.from_pretrained(config.model_name, cache_dir=cache_dir)
            vocoder = SpeechT5HifiGan.from_pretrained("microsoft/speecht5_hifigan", cache_dir=cache_dir)

            model.to(device)
            vocoder.to(device)

            # Load speaker embeddings using our custom loader (avoids deprecated datasets API)
            speaker_embeddings = get_speaker_embeddings(cache_dir)

            tts_model = {
                "type": "speecht5",
                "processor": processor,
                "model": model,
                "vocoder": vocoder,
                "speaker_embeddings": speaker_embeddings
            }
            tts_ready = True
            add_log(f"SpeechT5 TTS model loaded on {device}")
            return {"success": True, "device": device, "type": "speecht5"}

    except Exception as e:
        tts_ready = False
        add_log(f"TTS load error: {e}")
        return {"success": False, "error": str(e)}
    finally:
        tts_loading = False


@app.post("/unload_all")
async def unload_all():
    """Unload all models to free VRAM."""
    global router_model, router_tokenizer, router_ready, router_model_name
    global main_model, main_tokenizer, main_ready, main_model_name
    global stt_model, stt_ready, tts_model, tts_ready

    add_log("Unloading all models...")

    if router_model is not None:
        router_model.to("cpu")
        del router_model
        router_model = None
        del router_tokenizer
        router_tokenizer = None

    if main_model is not None:
        main_model.to("cpu")
        del main_model
        main_model = None
        del main_tokenizer
        main_tokenizer = None

    if stt_model is not None:
        if "model" in stt_model:
            stt_model["model"].to("cpu")
        stt_model = None

    if tts_model is not None:
        if "model" in tts_model:
            tts_model["model"].to("cpu")
        if "vocoder" in tts_model:
            tts_model["vocoder"].to("cpu")
        tts_model = None

    router_ready = False
    router_model_name = ""
    main_ready = False
    main_model_name = ""
    stt_ready = False
    tts_ready = False

    for _ in range(5):
        gc.collect()

    clear_cuda()

    add_log("All models unloaded")
    return {"success": True}


# ============================================
# Agent Interaction Endpoints
# ============================================

@app.post("/agent/chat")
async def agent_chat(request: AgentRequest):
    """Process a text message through the agent."""
    global current_mode

    if not main_ready:
        return {"success": False, "error": "Main model not loaded"}

    # Classify intent
    if request.force_mode:
        mode = request.force_mode
    else:
        mode = await classify_intent(request.message)

    current_mode = mode
    add_log(f"Mode: {mode.value} | Message: {request.message[:50]}...")

    # Generate response
    full_response = ""
    async for chunk in generate_response(
        request.message,
        mode,
        request.temperature,
        request.max_new_tokens
    ):
        full_response += chunk

    return {
        "success": True,
        "mode": mode.value,
        "response": full_response,
    }


@app.post("/agent/stream")
async def agent_chat_stream(request: AgentRequest):
    """Stream a response from the agent using router model."""
    global current_mode

    if not router_ready:
        async def error_gen():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Router model not loaded'})}\n\n"
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    async def generate():
        yield f"data: {json.dumps({'type': 'start'})}\n\n"

        # Use router model for conversation + task detection
        router_result = await generate_quick_response(request.message)

        response = router_result["response"]
        task = router_result.get("task")
        full_output = router_result.get("full_output", "")

        # Stream the response to user
        yield f"data: {json.dumps({'type': 'token', 'content': response})}\n\n"

        # Execute task if detected
        task_result = None
        tool_actions = []
        if task:
            task_result = await execute_task_silent(task)
            if task_result.get("tool_results"):
                for result in task_result["tool_results"]:
                    if result.get("action"):
                        tool_actions.append(result)
                        # Send action to frontend
                        yield f"data: {json.dumps({'type': 'action', 'action': result})}\n\n"

        # Send debug info
        yield f"data: {json.dumps({'type': 'debug', 'data': {'router_full_output': full_output, 'task': task, 'task_result': task_result}})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/agent/voice")
async def agent_voice(voice_input: VoiceInput):
    """Process voice input through the agent."""
    import time
    import traceback

    pipeline_start = time.perf_counter()
    timings = {}

    add_log(f"=== VOICE PIPELINE START ===")

    try:
        # 1. Decode base64
        t0 = time.perf_counter()
        try:
            audio_bytes = base64.b64decode(voice_input.audio_b64)
        except Exception as e:
            add_log(f"Base64 decode error: {e}")
            return {"success": False, "error": f"Invalid audio data: {e}"}
        timings['decode_b64'] = (time.perf_counter() - t0) * 1000
        add_log(f"[1/5] Base64 decode: {timings['decode_b64']:.0f}ms ({len(audio_bytes)} bytes)")

        # 2. Transcribe (STT)
        t0 = time.perf_counter()
        transcription = await transcribe_audio(audio_bytes, voice_input.sample_rate, voice_input.format)
        timings['stt'] = (time.perf_counter() - t0) * 1000
        trans_preview = transcription[:50] if transcription else "(empty)"
        add_log(f"[2/5] STT: {timings['stt']:.0f}ms - \"{trans_preview}...\"")

        if transcription.startswith("["):
            return {"success": False, "error": transcription}

        # 3. Router: Generate conversational response + detect tasks
        t0 = time.perf_counter()
        router_result = await generate_quick_response(transcription)
        timings['router'] = (time.perf_counter() - t0) * 1000

        full_response = router_result["response"]
        task = router_result.get("task")
        router_full_output = router_result.get("full_output", "")

        add_log(f"[3/5] Router: {timings['router']:.0f}ms - response: {len(full_response)} chars, task: {task or 'none'}")

        # 4. If task detected, execute silently with main model (or directly)
        task_result = None
        tool_actions = []
        if task:
            t0 = time.perf_counter()
            task_result = await execute_task_silent(task)
            timings['task'] = (time.perf_counter() - t0) * 1000
            add_log(f"[4/5] Task: {timings['task']:.0f}ms - {task_result.get('success', False)}")

            # Collect tool actions for frontend
            if task_result.get("tool_results"):
                for result in task_result["tool_results"]:
                    if result.get("action"):
                        tool_actions.append(result)
        else:
            timings['task'] = 0
            add_log(f"[4/5] Task: skipped (no task)")

        # 5. TTS (skip if requested or not available)
        t0 = time.perf_counter()
        audio_b64 = ""
        if voice_input.skip_tts:
            timings['tts'] = 0
            add_log(f"[5/5] TTS: skipped (requested)")
        elif tts_ready:
            audio_response = await synthesize_speech(full_response)
            audio_b64 = base64.b64encode(audio_response).decode() if audio_response else ""
            timings['tts'] = (time.perf_counter() - t0) * 1000
            add_log(f"[5/5] TTS: {timings['tts']:.0f}ms ({len(audio_b64)} chars)")
        else:
            timings['tts'] = 0
            add_log(f"[5/5] TTS: skipped (not loaded)")

        total_time = (time.perf_counter() - pipeline_start) * 1000
        add_log(f"=== PIPELINE COMPLETE: {total_time:.0f}ms total ===")

        return {
            "success": True,
            "transcription": transcription,
            "response": full_response,
            "audio_b64": audio_b64,
            "timings": timings,
            "total_ms": total_time,
            # Tool actions for frontend to execute (e.g., EventBus events)
            "tool_actions": tool_actions,
            # Debug info
            "debug": {
                "router_full_output": router_full_output,
                "task": task,
                "task_result": task_result,
            }
        }

    except Exception as e:
        error_msg = f"Voice pipeline error: {str(e)}"
        add_log(f"ERROR: {error_msg}")
        traceback.print_exc()
        # Try to clean up CUDA memory on error
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return {"success": False, "error": error_msg}


@app.post("/transcribe")
async def transcribe(voice_input: VoiceInput):
    """Transcribe audio without processing through agent."""
    try:
        audio_bytes = base64.b64decode(voice_input.audio_b64)
    except Exception as e:
        return {"success": False, "error": f"Invalid audio data: {e}"}

    # Pass format hint from request
    transcription = await transcribe_audio(audio_bytes, voice_input.sample_rate, voice_input.format)
    return {"success": True, "transcription": transcription}


@app.post("/synthesize")
async def synthesize(text: str):
    """Synthesize speech from text."""
    audio = await synthesize_speech(text)
    audio_b64 = base64.b64encode(audio).decode() if audio else ""
    return {"success": True, "audio_b64": audio_b64}


# ============================================
# Job Management Endpoints
# ============================================

@app.post("/jobs/submit")
async def submit_job(request: JobSubmitRequest):
    """Submit a new job to a service."""
    result = await submit_job_tool({
        "service_type": request.service_type,
        "parameters": request.parameters,
        "description": request.description
    })
    return result


@app.get("/jobs")
async def list_jobs():
    """List all jobs."""
    return {
        "success": True,
        "jobs": [job.to_dict() for job in active_jobs.values()],
        "count": len(active_jobs)
    }


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Get a specific job."""
    job = active_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"success": True, "job": job.to_dict()}


@app.post("/jobs/{job_id}/modify")
async def modify_job(job_id: str, request: JobModifyRequest):
    """Modify a job's parameters."""
    result = await modify_job_tool({
        "job_id": job_id,
        "parameters": request.parameters
    })
    return result


@app.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a job."""
    result = await cancel_job_tool({"job_id": job_id})
    return result


# ============================================
# Service Registry Endpoints
# ============================================

@app.post("/services/register")
async def register_service(request: ServiceRegisterRequest):
    """Register a new service endpoint."""
    try:
        service_type = ServiceType(request.service_type)
    except ValueError:
        return {"success": False, "error": f"Unknown service type: {request.service_type}"}

    service = ServiceEndpoint(
        name=request.name,
        service_type=service_type,
        base_url=request.base_url,
        port=request.port,
        capabilities=request.capabilities,
        is_available=True,
        last_check=time.time()
    )

    service_registry[request.name] = service
    add_log(f"Registered service: {request.name} ({service_type.value})")

    return {"success": True, "service": request.name}


@app.get("/services")
async def list_services():
    """List all registered services."""
    services = []
    for name, service in service_registry.items():
        services.append({
            "name": name,
            "service_type": service.service_type.value,
            "base_url": service.base_url,
            "port": service.port,
            "is_available": service.is_available,
            "capabilities": service.capabilities
        })
    return {"success": True, "services": services}


@app.delete("/services/{name}")
async def unregister_service(name: str):
    """Unregister a service."""
    if name in service_registry:
        del service_registry[name]
        add_log(f"Unregistered service: {name}")
        return {"success": True}
    return {"success": False, "error": f"Service {name} not found"}


# ============================================
# Prompts/System Configuration
# ============================================

@app.get("/prompts")
async def get_prompts():
    """Get all system prompts and router examples for debugging."""
    return {
        "success": True,
        "router_examples": ROUTER_EXAMPLES,
        "planning_prompt": PLANNING_SYSTEM_PROMPT,
        "execution_prompt": EXECUTION_SYSTEM_PROMPT,
        "conversation_prompt": CONVERSATION_SYSTEM_PROMPT,
        "tool_definitions": TOOL_DEFINITIONS,
        "current_state": {
            "active_jobs": get_active_jobs_summary(),
            "last_subject": last_subject,
            "recent_context": get_recent_context(),
            "registered_services": [s.name for s in service_registry.values()]
        }
    }


class PromptUpdate(BaseModel):
    prompt_type: str  # "router", "planning", "execution", "conversation"
    content: str


@app.post("/prompts/update")
async def update_prompt(update: PromptUpdate):
    """Update a system prompt at runtime."""
    global ROUTER_EXAMPLES, PLANNING_SYSTEM_PROMPT, EXECUTION_SYSTEM_PROMPT, CONVERSATION_SYSTEM_PROMPT

    if update.prompt_type == "router":
        ROUTER_EXAMPLES = update.content
        add_log(f"Router prompt updated ({len(update.content)} chars)")
    elif update.prompt_type == "planning":
        PLANNING_SYSTEM_PROMPT = update.content
        add_log(f"Planning prompt updated ({len(update.content)} chars)")
    elif update.prompt_type == "execution":
        EXECUTION_SYSTEM_PROMPT = update.content
        add_log(f"Execution prompt updated ({len(update.content)} chars)")
    elif update.prompt_type == "conversation":
        CONVERSATION_SYSTEM_PROMPT = update.content
        add_log(f"Conversation prompt updated ({len(update.content)} chars)")
    else:
        return {"success": False, "error": f"Unknown prompt type: {update.prompt_type}"}

    return {"success": True, "message": f"{update.prompt_type} prompt updated"}


# ============================================
# Conversation Management
# ============================================

@app.post("/conversation/clear")
async def clear_conversation():
    """Clear conversation history and free VRAM from KV cache."""
    global conversation_history, last_subject
    conversation_history = []
    last_subject = None

    # Clear CUDA cache to free KV cache memory
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()

    add_log("Conversation cleared and CUDA cache freed")
    return {"success": True}


@app.get("/conversation")
async def get_conversation():
    """Get conversation history."""
    return {
        "success": True,
        "history": conversation_history,
        "length": len(conversation_history)
    }


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
        # Look for model directories
        for item in cache_path.iterdir():
            if item.is_dir():
                name = item.name

                # Parse HuggingFace cache format: models--org--name
                if name.startswith("models--"):
                    parts = name.replace("models--", "").split("--")
                    if len(parts) >= 2:
                        model_id = "/".join(parts)
                        models.append(model_id)
                # Also check for direct model folders (org/model format)
                elif (item / "config.json").exists() or (item / "pytorch_model.bin").exists() or (item / "model.safetensors").exists():
                    models.append(name)
                # Check subdirectories for org/model structure
                else:
                    for sub in item.iterdir():
                        if sub.is_dir():
                            if (sub / "config.json").exists() or (sub / "pytorch_model.bin").exists() or (sub / "model.safetensors").exists():
                                models.append(f"{name}/{sub.name}")

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

        # Sort models alphabetically
        models.sort()

        add_log(f"Found {len(models)} cached models")
        return {"success": True, "models": models, "cache_path": str(cache_path)}

    except Exception as e:
        add_log(f"Error scanning cache: {e}")
        return {"success": False, "error": str(e), "models": []}


# ============================================
# WebSocket for Real-time Updates
# ============================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    await websocket.accept()
    websocket_connections.append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming WebSocket messages if needed
            message = json.loads(data)

            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        websocket_connections.remove(websocket)
    except Exception:
        if websocket in websocket_connections:
            websocket_connections.remove(websocket)


# ============================================
# Shutdown
# ============================================

@app.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server."""
    add_log("Shutdown requested...")
    asyncio.get_event_loop().call_later(0.5, lambda: os._exit(0))
    return {"success": True, "message": "Server shutting down"}


if __name__ == "__main__":
    import logging
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
    print(f"Starting Voice Agent server on port {port}...")
    print(f"Models cache path: {models_cache}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
