"""
MCP Agent FastAPI Server
AI-driven agent using local Qwen models with MCP tool integration.

Features:
- Qwen 2.5 14B GGUF (Q4_K_M) for reasoning and tool calling
- Qwen3-VL family for vision/screenshots
- Streaming with <tool_call>...</tool_call> XML tag detection
- Tool execution via MCP registry
- Editable system prompts
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Tuple
import uvicorn
import torch
import gc
import time
import os
import sys
import asyncio
import json
import base64
import io
from pathlib import Path
from datetime import datetime

# Suppress HuggingFace symlinks warning on Windows
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'

# Add shared path for tool_client SDK
shared_path = os.path.join(os.path.dirname(__file__), '..', '_shared')
sys.path.insert(0, shared_path)

try:
    from tool_client import ToolClient
except ImportError:
    print("[MCPAgent] Warning: tool_client not found in _shared folder")
    ToolClient = None

app = FastAPI(title="MCP Agent Server")

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


# ============================================
# Global State
# ============================================

# Text Model State (GGUF via llama-cpp-python)
text_model = None
text_model_name = ""
text_model_ready = False
text_model_loading = False

# Vision Model State (HuggingFace transformers)
vision_model = None
vision_processor = None
vision_model_name = ""
vision_model_ready = False
vision_model_loading = False

# System State
models_cache = get_models_cache_path()

# MCP Tool Registry
REGISTRY_URL = "http://127.0.0.1:8800"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
tool_client = ToolClient("mcp_agent", port=PORT, registry_url=REGISTRY_URL) if ToolClient else None

# Discovered tools cache
discovered_tools: List[Dict[str, Any]] = []
enabled_namespaces: List[str] = []  # Empty means all namespaces enabled

# Conversation history (sliding window)
recent_messages: List[Dict[str, str]] = []
MAX_RECENT_MESSAGES = 20

# System prompts
PROMPTS_FILE = Path(__file__).parent / "system_prompts.json"
system_prompts: Dict[str, Any] = {}
active_prompt_name: str = "default"

# Last captured image for vision
last_image_b64: Optional[str] = None


def add_log(message: str):
    """Add timestamped log entry."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    print(entry, flush=True)


# ============================================
# System Prompt Management
# ============================================

def load_system_prompts() -> Dict[str, Any]:
    """Load system prompts from JSON file."""
    global system_prompts
    if PROMPTS_FILE.exists():
        try:
            system_prompts = json.loads(PROMPTS_FILE.read_text(encoding='utf-8'))
            add_log(f"Loaded {len(system_prompts)} system prompts")
            return system_prompts
        except Exception as e:
            add_log(f"Error loading prompts: {e}")
    return get_default_prompts()


def get_default_prompts() -> Dict[str, Any]:
    """Return default system prompts."""
    return {
        "default": {
            "name": "Default Agent",
            "description": "General purpose agent with MCP tool access",
            "system_prompt": """You are an AI agent with access to tools via MCP.

## Available Tools
{tools_json}

## Tool Usage
<tool_call>
{"name": "tool_name", "arguments": {"arg": "value"}}
</tool_call>

Wait for the result, then continue your response."""
        }
    }


def save_system_prompts():
    """Save system prompts to JSON file."""
    global system_prompts
    try:
        PROMPTS_FILE.write_text(json.dumps(system_prompts, indent=2), encoding='utf-8')
        add_log("System prompts saved")
    except Exception as e:
        add_log(f"Error saving prompts: {e}")


def get_active_system_prompt() -> str:
    """Get the active system prompt with tools injected."""
    global system_prompts, active_prompt_name

    prompt_config = system_prompts.get(active_prompt_name, system_prompts.get("default", {}))
    template = prompt_config.get("system_prompt", "You are a helpful assistant.")

    # Inject discovered tools into prompt
    tools_for_prompt = get_tools_for_prompt()
    tools_json = json.dumps(tools_for_prompt, indent=2)

    try:
        return template.format(tools_json=tools_json)
    except KeyError:
        # Template doesn't have {tools_json} placeholder
        return template


# ============================================
# Tool Discovery and Execution
# ============================================

async def discover_all_tools() -> List[Dict[str, Any]]:
    """Discover all tools from MCP registry."""
    global discovered_tools, tool_client

    if tool_client is None:
        add_log("Tool client not available")
        return []

    try:
        await tool_client.connect()
        tools = await tool_client.discover_tools()
        discovered_tools = tools
        add_log(f"Discovered {len(tools)} tools from registry")
        return tools
    except Exception as e:
        add_log(f"Tool discovery failed: {e}")
        return []


def get_tools_for_prompt() -> List[Dict[str, Any]]:
    """Get tools formatted for the LLM prompt."""
    tools = []
    for tool in discovered_tools:
        # Filter by enabled namespaces if any are set
        ns = tool.get("namespace", "")
        if enabled_namespaces and ns not in enabled_namespaces:
            continue
        tools.append({
            "name": tool.get("name", ""),
            "namespace": ns,
            "description": tool.get("description", ""),
            "parameters": tool.get("inputSchema", {})
        })
    return tools


async def execute_tool(tool_call: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a tool via the MCP registry."""
    global tool_client, last_image_b64

    name = tool_call.get("name", "")
    args = tool_call.get("arguments", {})

    add_log(f"Executing tool: {name} with args: {json.dumps(args)[:200]}")

    if tool_client is None:
        return {"success": False, "error": "Tool client not available"}

    try:
        # Find the tool's namespace
        namespace = None
        for tool in discovered_tools:
            if tool.get("name") == name:
                namespace = tool.get("namespace")
                break

        result = await tool_client.execute_tool(
            tool_name=name,
            arguments=args,
            namespace=namespace
        )

        result_dict = result.to_dict()

        # Handle image results (store for vision analysis)
        if result_dict.get("success") and result_dict.get("data"):
            data = result_dict.get("data", {})
            if isinstance(data, dict) and data.get("image_b64"):
                last_image_b64 = data["image_b64"]
                # Return without the large base64 string
                return {
                    "success": True,
                    "message": data.get("message", f"Executed {name}"),
                    "has_image": True,
                    **{k: v for k, v in data.items() if k != "image_b64"}
                }

        return result_dict
    except Exception as e:
        add_log(f"Tool execution error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# Vision Analysis
# ============================================

async def analyze_with_vision(image_b64: str, prompt: str) -> Dict[str, Any]:
    """Analyze image using Qwen3-VL model."""
    global vision_model, vision_processor

    if not vision_model_ready:
        return {"success": False, "error": "Vision model not loaded"}

    try:
        from PIL import Image
        from qwen_vl_utils import process_vision_info

        # Decode image
        image_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_bytes))
        if image.mode != 'RGB':
            image = image.convert('RGB')

        device = next(vision_model.parameters()).device

        # Build message for Qwen-VL
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt}
                ]
            }
        ]

        text = vision_processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )

        image_inputs, video_inputs = process_vision_info(messages)

        inputs = vision_processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        ).to(device)

        model_dtype = next(vision_model.parameters()).dtype
        if 'pixel_values' in inputs:
            inputs['pixel_values'] = inputs['pixel_values'].to(dtype=model_dtype)

        with torch.no_grad():
            generated_ids = vision_model.generate(
                **inputs,
                max_new_tokens=512,
            )

        generated_ids_trimmed = [
            out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
        ]

        result_text = vision_processor.batch_decode(
            generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )[0]

        return {"success": True, "analysis": result_text.strip()}

    except Exception as e:
        add_log(f"Vision analysis error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# Tool Call Parser
# ============================================

class ToolCallParser:
    """State machine to detect <tool_call>...</tool_call> in streaming output."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.buffer = ""
        self.in_tool_call = False
        self.tool_call_buffer = ""

    def feed(self, token: str) -> Tuple[str, Optional[Dict]]:
        """
        Feed a token and return (display_text, tool_call_or_none).

        Returns:
            - (token, None) - Normal text, display it
            - ("", None) - Buffering tool call, don't display
            - ("", {"name": ..., "arguments": ...}) - Complete tool call detected
        """
        self.buffer += token

        # Check for tool call start
        if not self.in_tool_call:
            if "<tool_call>" in self.buffer:
                self.in_tool_call = True
                parts = self.buffer.split("<tool_call>", 1)
                display_text = parts[0]
                self.tool_call_buffer = parts[1] if len(parts) > 1 else ""
                self.buffer = ""
                return (display_text, None)
            return (token, None)

        # In tool call mode - accumulate until </tool_call>
        self.tool_call_buffer += token

        if "</tool_call>" in self.tool_call_buffer:
            parts = self.tool_call_buffer.split("</tool_call>", 1)
            tool_call_json = parts[0].strip()
            remaining = parts[1] if len(parts) > 1 else ""

            try:
                tool_call = json.loads(tool_call_json)
                self.in_tool_call = False
                self.tool_call_buffer = ""
                self.buffer = remaining
                return ("", tool_call)
            except json.JSONDecodeError as e:
                # Invalid JSON - return as text
                add_log(f"Invalid tool call JSON: {e}")
                self.in_tool_call = False
                text = f"<tool_call>{tool_call_json}</tool_call>{remaining}"
                self.tool_call_buffer = ""
                self.buffer = ""
                return (text, None)

        # Still accumulating tool call
        return ("", None)


# ============================================
# Streaming Agent Loop
# ============================================

async def agent_stream_with_tools(
    user_message: str,
    max_tool_iterations: int = 10,
    max_tokens_per_response: int = 2048,
    temperature: float = 0.7,
):
    """
    Stream agent response with automatic tool calling.

    Yields SSE events:
    - {"type": "start"}
    - {"type": "token", "content": "..."}
    - {"type": "tool_call", "tool": {...}}
    - {"type": "tool_result", "result": {...}}
    - {"type": "image", "image_b64": "..."}
    - {"type": "done", "full_response": "..."}
    - {"type": "error", "error": "..."}
    """
    global text_model, recent_messages, last_image_b64

    if not text_model_ready or text_model is None:
        yield {"type": "error", "error": "Text model not loaded"}
        return

    yield {"type": "start"}

    # Build system prompt with tools
    system_prompt = get_active_system_prompt()

    # Build message list
    messages = [{"role": "system", "content": system_prompt}]

    # Add recent conversation context (sliding window)
    for msg in recent_messages[-10:]:
        messages.append(msg)

    # Add current user message
    messages.append({"role": "user", "content": user_message})

    full_response = ""
    tool_iterations = 0

    while tool_iterations < max_tool_iterations:
        tool_iterations += 1

        # Format prompt for ChatML (Qwen format)
        prompt = ""
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            prompt += f"<|im_start|>{role}\n{content}<|im_end|>\n"
        prompt += "<|im_start|>assistant\n"

        # Estimate tokens for context check
        prompt_tokens = len(prompt) // 4
        if prompt_tokens > 6000:
            add_log(f"Warning: Large prompt ({prompt_tokens} est. tokens)")

        # Create parser
        parser = ToolCallParser()
        round_response = ""
        tool_detected = None

        # Stream generation
        try:
            for chunk in text_model(
                prompt,
                max_tokens=max_tokens_per_response,
                temperature=max(0.01, temperature),
                top_p=0.9,
                stop=["<|im_end|>", "<|im_start|>"],
                stream=True
            ):
                token = chunk["choices"][0]["text"]
                display_text, tool_call = parser.feed(token)

                if display_text:
                    round_response += display_text
                    full_response += display_text
                    yield {"type": "token", "content": display_text}

                if tool_call:
                    tool_detected = tool_call
                    break  # Stop generation to execute tool

                await asyncio.sleep(0)

        except Exception as e:
            add_log(f"Generation error: {e}")
            yield {"type": "error", "error": str(e)}
            return

        if tool_detected:
            yield {"type": "tool_call", "tool": tool_detected}

            # Execute the tool
            result = await execute_tool(tool_detected)
            yield {"type": "tool_result", "result": result}

            # If we got an image, send it
            if result.get("has_image") and last_image_b64:
                yield {"type": "image", "image_b64": last_image_b64}

            # Format result for context injection
            result_text = json.dumps(result, indent=2)

            # Add to messages for next iteration
            tool_msg = f"{round_response}<tool_call>\n{json.dumps(tool_detected)}\n</tool_call>"
            messages.append({"role": "assistant", "content": tool_msg})
            messages.append({
                "role": "user",
                "content": f"Tool result:\n```json\n{result_text}\n```\n\nContinue with your response."
            })

            # Continue generation
            continue
        else:
            # No more tool calls, generation complete
            break

    # Update conversation history
    recent_messages.append({"role": "user", "content": user_message})
    recent_messages.append({"role": "assistant", "content": full_response})

    # Trim to max
    if len(recent_messages) > MAX_RECENT_MESSAGES:
        recent_messages[:] = recent_messages[-MAX_RECENT_MESSAGES:]

    yield {"type": "done", "full_response": full_response}


# ============================================
# Request/Response Models
# ============================================

class TextModelConfig(BaseModel):
    model_name: str = "bartowski/Qwen2.5-14B-Instruct-GGUF"
    n_gpu_layers: int = -1
    n_ctx: int = 8192


class VisionModelConfig(BaseModel):
    model_name: str = "Qwen/Qwen3-VL-2B-Instruct"
    use_fp16: bool = True


class ChatRequest(BaseModel):
    message: str
    max_tool_iterations: int = 10
    temperature: float = 0.7


class PromptUpdateRequest(BaseModel):
    name: str
    content: Dict[str, Any]


class PromptSelectRequest(BaseModel):
    name: str


class NamespaceEnableRequest(BaseModel):
    namespaces: List[str]


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
# Startup/Shutdown Events
# ============================================

@app.on_event("startup")
async def startup():
    """Initialize on startup."""
    add_log("Starting MCP Agent Server...")
    load_system_prompts()
    await discover_all_tools()


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    add_log("Shutting down MCP Agent Server...")
    if tool_client:
        await tool_client.disconnect()


# ============================================
# API Endpoints - Health/Status
# ============================================

@app.get("/")
async def root():
    return {"status": "online", "service": "MCP Agent Server"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "text_model_ready": text_model_ready,
        "vision_model_ready": vision_model_ready,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/status")
async def status():
    vram = get_vram_stats()

    # Check registry connection
    registry_connected = False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{REGISTRY_URL}/health")
            registry_connected = resp.status_code == 200
    except Exception:
        pass

    return {
        "text_model_ready": text_model_ready,
        "text_model_loading": text_model_loading,
        "text_model_name": text_model_name,
        "vision_model_ready": vision_model_ready,
        "vision_model_loading": vision_model_loading,
        "vision_model_name": vision_model_name,
        "registry_url": REGISTRY_URL,
        "registry_connected": registry_connected,
        "discovered_tools": len(discovered_tools),
        "enabled_namespaces": enabled_namespaces,
        "active_prompt": active_prompt_name,
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "recent_messages": len(recent_messages),
    }


# ============================================
# API Endpoints - Model Loading
# ============================================

@app.post("/load_text_model")
async def load_text_model(config: TextModelConfig):
    """Load the Qwen 2.5 GGUF text model."""
    global text_model, text_model_name, text_model_ready, text_model_loading

    if text_model_loading:
        return {"success": False, "error": "Model is already loading"}

    text_model_loading = True

    try:
        if text_model is not None:
            add_log("Unloading existing text model...")
            del text_model
            text_model = None
            clear_cuda()

        text_model_name = config.model_name
        add_log(f"Loading text model: {text_model_name}")

        # Import llama-cpp-python
        from llama_cpp import Llama

        # Check for GPU support
        import llama_cpp
        gpu_supported = False
        llama_version = getattr(llama_cpp, "__version__", "")
        if "+cu" in llama_version:
            gpu_supported = True
        try:
            if llama_cpp.llama_supports_gpu_offload():
                gpu_supported = True
        except (AttributeError, Exception):
            pass

        add_log(f"GPU support: {gpu_supported}")

        # Download GGUF if needed
        cache_dir = str(models_cache)

        if "/" in config.model_name and not config.model_name.endswith(".gguf"):
            add_log(f"Downloading from HuggingFace: {config.model_name}")
            from huggingface_hub import hf_hub_download, list_repo_files

            files = list_repo_files(config.model_name)
            gguf_files = [f for f in files if f.endswith(".gguf")]

            if not gguf_files:
                return {"success": False, "error": "No GGUF files found in repository"}

            # Prefer Q4_K_M
            gguf_file = None
            for preferred in ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q8_0"]:
                for f in gguf_files:
                    if preferred in f:
                        gguf_file = f
                        break
                if gguf_file:
                    break

            if not gguf_file:
                gguf_file = gguf_files[0]

            add_log(f"Downloading: {gguf_file}")
            model_path = hf_hub_download(
                repo_id=config.model_name,
                filename=gguf_file,
                cache_dir=cache_dir
            )
        else:
            model_path = config.model_name

        add_log(f"Loading model from: {model_path}")

        n_gpu_layers = config.n_gpu_layers if gpu_supported else 0

        text_model = Llama(
            model_path=model_path,
            n_gpu_layers=n_gpu_layers,
            n_ctx=config.n_ctx,
            verbose=False,
        )

        text_model_ready = True
        add_log(f"Text model loaded (GPU layers: {n_gpu_layers})")

        return {"success": True, "model_name": text_model_name, "gpu_layers": n_gpu_layers}

    except Exception as e:
        text_model_ready = False
        add_log(f"Model load error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        text_model_loading = False


@app.post("/load_vision_model")
async def load_vision_model(config: VisionModelConfig):
    """Load the Qwen3-VL vision model."""
    global vision_model, vision_processor, vision_model_name, vision_model_ready, vision_model_loading

    if vision_model_loading:
        return {"success": False, "error": "Vision model is already loading"}

    vision_model_loading = True

    try:
        if vision_model is not None:
            add_log("Unloading existing vision model...")
            vision_model.to("cpu")
            del vision_model
            vision_model = None
            del vision_processor
            vision_processor = None
            clear_cuda()

        vision_model_name = config.model_name
        add_log(f"Loading vision model: {vision_model_name}")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        cache_dir = str(models_cache)
        dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

        # Try Qwen2VL first, then fall back to AutoModel
        try:
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
        except Exception as e:
            add_log(f"Qwen2VL import failed, trying AutoModel: {e}")
            from transformers import AutoModelForVision2Seq, AutoProcessor

            vision_processor = AutoProcessor.from_pretrained(
                vision_model_name,
                cache_dir=cache_dir,
                trust_remote_code=True
            )

            vision_model = AutoModelForVision2Seq.from_pretrained(
                vision_model_name,
                torch_dtype=dtype,
                cache_dir=cache_dir,
                low_cpu_mem_usage=True,
                trust_remote_code=True
            )

        vision_model.to(device)
        vision_model.eval()
        vision_model_ready = True

        add_log(f"Vision model loaded on {device}")
        return {"success": True, "model_name": vision_model_name, "device": device}

    except Exception as e:
        vision_model_ready = False
        add_log(f"Vision model load error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        vision_model_loading = False


@app.post("/unload_text_model")
async def unload_text_model():
    """Unload text model."""
    global text_model, text_model_ready, text_model_name

    if text_model is not None:
        del text_model
        text_model = None

    text_model_ready = False
    text_model_name = ""
    clear_cuda()

    add_log("Text model unloaded")
    return {"success": True}


@app.post("/unload_vision_model")
async def unload_vision_model():
    """Unload vision model."""
    global vision_model, vision_processor, vision_model_ready, vision_model_name

    if vision_model is not None:
        vision_model.to("cpu")
        del vision_model
        vision_model = None
        del vision_processor
        vision_processor = None

    vision_model_ready = False
    vision_model_name = ""
    clear_cuda()

    add_log("Vision model unloaded")
    return {"success": True}


# ============================================
# API Endpoints - Tool Management
# ============================================

@app.get("/tools")
async def get_tools():
    """Get all discovered tools."""
    return {
        "success": True,
        "tools": discovered_tools,
        "enabled_namespaces": enabled_namespaces,
        "total_count": len(discovered_tools)
    }


@app.post("/tools/refresh")
async def refresh_tools():
    """Re-discover tools from registry."""
    tools = await discover_all_tools()
    return {
        "success": True,
        "tool_count": len(tools),
        "tools": [t.get("name") for t in tools]
    }


@app.get("/tools/namespaces")
async def get_namespaces():
    """Get available tool namespaces."""
    namespaces = set()
    for tool in discovered_tools:
        ns = tool.get("namespace")
        if ns:
            namespaces.add(ns)
    return {"success": True, "namespaces": sorted(list(namespaces))}


@app.post("/tools/namespaces/enable")
async def enable_namespaces(request: NamespaceEnableRequest):
    """Enable specific namespaces for tool usage."""
    global enabled_namespaces
    enabled_namespaces = request.namespaces
    add_log(f"Enabled namespaces: {enabled_namespaces}")
    return {"success": True, "enabled_namespaces": enabled_namespaces}


# ============================================
# API Endpoints - Prompt Management
# ============================================

@app.get("/prompts")
async def get_prompts():
    """Get all available prompts."""
    return {
        "success": True,
        "prompts": system_prompts,
        "active": active_prompt_name
    }


@app.get("/prompts/{prompt_name}")
async def get_prompt(prompt_name: str):
    """Get a specific prompt."""
    if prompt_name not in system_prompts:
        return {"success": False, "error": f"Prompt not found: {prompt_name}"}
    return {"success": True, "prompt": system_prompts[prompt_name]}


@app.post("/prompts")
async def save_prompt(request: PromptUpdateRequest):
    """Save/update a prompt."""
    global system_prompts
    system_prompts[request.name] = request.content
    save_system_prompts()
    return {"success": True, "name": request.name}


@app.delete("/prompts/{prompt_name}")
async def delete_prompt(prompt_name: str):
    """Delete a prompt."""
    global system_prompts
    if prompt_name not in system_prompts:
        return {"success": False, "error": f"Prompt not found: {prompt_name}"}
    if prompt_name == "default":
        return {"success": False, "error": "Cannot delete default prompt"}
    del system_prompts[prompt_name]
    save_system_prompts()
    return {"success": True}


@app.post("/prompts/active")
async def set_active_prompt(request: PromptSelectRequest):
    """Set the active prompt."""
    global active_prompt_name
    if request.name not in system_prompts:
        return {"success": False, "error": f"Prompt not found: {request.name}"}
    active_prompt_name = request.name
    add_log(f"Active prompt set to: {active_prompt_name}")
    return {"success": True, "active": active_prompt_name}


# ============================================
# API Endpoints - Chat
# ============================================

@app.post("/agent/chat/stream")
async def agent_chat_stream(request: ChatRequest):
    """Streaming agent chat with tool calling."""
    async def generate():
        async for event in agent_stream_with_tools(
            request.message,
            request.max_tool_iterations,
            temperature=request.temperature
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/agent/chat")
async def agent_chat(request: ChatRequest):
    """Non-streaming agent chat (collects full response)."""
    events = []
    full_response = ""

    async for event in agent_stream_with_tools(
        request.message,
        request.max_tool_iterations,
        temperature=request.temperature
    ):
        events.append(event)
        if event.get("type") == "done":
            full_response = event.get("full_response", "")

    return {
        "success": True,
        "response": full_response,
        "events": events
    }


@app.post("/clear_history")
async def clear_history():
    """Clear conversation history."""
    global recent_messages, last_image_b64
    recent_messages = []
    last_image_b64 = None
    add_log("Conversation history cleared")
    return {"success": True}


@app.get("/last_image")
async def get_last_image():
    """Get the last captured/received image."""
    if last_image_b64:
        return {"success": True, "image_b64": last_image_b64}
    return {"success": False, "error": "No image available"}


# ============================================
# API Endpoints - Vision
# ============================================

@app.post("/vision/analyze")
async def vision_analyze(request: Dict[str, Any]):
    """Analyze an image with the vision model."""
    image_b64 = request.get("image_b64") or last_image_b64
    prompt = request.get("prompt", "Describe what you see in this image.")

    if not image_b64:
        return {"success": False, "error": "No image provided and no cached image available"}

    result = await analyze_with_vision(image_b64, prompt)
    return result


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

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
    print(f"Starting MCP Agent server on port {port}...")
    print(f"Models cache path: {models_cache}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
