"""
Local LLM Chat FastAPI Server
Provides chat endpoints using a Hugging Face model.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, AsyncGenerator
import uvicorn
import torch
import gc
import time
import os
import asyncio
import json

app = FastAPI(title="Local LLM Chat Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# User Paths (from ContextUI environment variables)
# ============================================
def get_models_cache_path() -> str:
    """Get models cache path from env var or fallback to default HuggingFace cache."""
    env_path = os.environ.get('CONTEXTUI_MODELS_PATH')
    if env_path:
        return os.path.join(env_path, "huggingface")
    # Fallback: use default HuggingFace cache (None means default)
    return None


# Global state
model = None
tokenizer = None
model_name = ""
model_ready = False
model_loading = False
chat_history = []
last_error = None
models_cache = get_models_cache_path()


class ModelConfig(BaseModel):
    model_name: str = "microsoft/Phi-3-mini-4k-instruct"  # Default medium-sized model
    device: str = "auto"
    use_fp16: bool = True
    max_length: int = 2048
    use_cpu_offload: bool = False  # CPU offload requires accelerate library


class ChatRequest(BaseModel):
    message: str
    temperature: float = 0.7
    max_new_tokens: int = 512
    top_k: int = 50
    top_p: float = 0.9
    system_prompt: Optional[str] = None
    use_history: bool = True


class StreamChatRequest(BaseModel):
    message: str
    temperature: float = 0.7
    max_new_tokens: int = 512
    top_k: int = 50
    top_p: float = 0.9
    system_prompt: Optional[str] = None
    use_history: bool = True


class ClearHistoryRequest(BaseModel):
    pass


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


@app.get("/")
async def root():
    return {"status": "online", "service": "Local LLM Chat Server"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_ready": model_ready,
        "model_loading": model_loading,
        "model_name": model_name,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/status")
async def status():
    global model_ready, model_loading, model_name, last_error, chat_history

    vram = get_vram_stats()

    return {
        "model_ready": model_ready,
        "model_loading": model_loading,
        "model_name": model_name,
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "error": last_error,
        "chat_history_length": len(chat_history),
    }


@app.post("/load_model")
async def load_model(config: ModelConfig):
    global model, tokenizer, model_name, model_ready, model_loading, last_error

    if model_loading:
        return {"success": False, "error": "Model is already loading"}

    model_loading = True
    last_error = None

    try:
        # Unload existing model first
        if model is not None:
            model.to("cpu")
            del model
            model = None
            del tokenizer
            tokenizer = None
            clear_cuda()

        model_name = config.model_name
        print(f"Loading LLM model: {model_name}")
        if models_cache:
            print(f"Using cache directory: {models_cache}")

        # Import transformers
        from transformers import AutoTokenizer, AutoModelForCausalLM

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

        # Load tokenizer
        print("Loading tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            trust_remote_code=True,
            cache_dir=models_cache
        )

        # Some models need a padding token
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        # Load model
        print(f"Loading model on {device}...")
        dtype = torch.float16 if (config.use_fp16 and device == "cuda") else torch.float32

        # Load with explicit device settings to avoid auto CPU offload
        if config.use_cpu_offload and device == "cuda":
            # Use CPU offload (requires accelerate library)
            model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=dtype,
                trust_remote_code=True,
                low_cpu_mem_usage=True,
                device_map="auto",  # Auto device mapping with offload
                cache_dir=models_cache
            )
        else:
            # Load directly to device without offload
            model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=dtype,
                trust_remote_code=True,
                low_cpu_mem_usage=True,
                cache_dir=models_cache
            )
            # Manually move to device
            model.to(device)

        model.eval()
        model_ready = True

        print(f"Model {model_name} loaded successfully on {device}")

        return {"success": True, "device": device, "model_name": model_name}

    except Exception as e:
        last_error = str(e)
        model_ready = False
        print(f"Error loading model: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        model_loading = False


@app.post("/unload_model")
async def unload_model():
    global model, tokenizer, model_ready, model_name

    print("Unloading LLM model...")

    if model is not None:
        try:
            model.to("cpu")
            if torch.cuda.is_available():
                torch.cuda.synchronize()
        except Exception as e:
            print(f"Error moving model to CPU: {e}")

    model = None
    tokenizer = None
    model_ready = False
    model_name = ""

    for _ in range(5):
        gc.collect()

    clear_cuda()
    print("LLM model unloaded")

    return {"success": True}


@app.post("/chat")
async def chat(request: ChatRequest):
    global model, tokenizer, model_ready, chat_history, last_error, model_name

    if not model_ready or model is None or tokenizer is None:
        return {"success": False, "error": "Model not loaded"}

    if not request.message.strip():
        return {"success": False, "error": "Please enter a message"}

    last_error = None

    try:
        print(f"Chat request: '{request.message[:50]}...'")
        t0 = time.perf_counter()

        # Build conversation context
        messages = []

        # Add system prompt if provided
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})

        # Add chat history if enabled
        if request.use_history:
            messages.extend(chat_history)

        # Add current user message
        messages.append({"role": "user", "content": request.message})

        # Format the conversation using the tokenizer's chat template
        try:
            # Try to use the model's chat template
            formatted_prompt = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True
            )
        except Exception as e:
            # Fallback to simple format if chat template not available
            print(f"Chat template not available, using simple format: {e}")
            formatted_prompt = ""
            for msg in messages:
                role = msg["role"]
                content = msg["content"]
                if role == "system":
                    formatted_prompt += f"System: {content}\n\n"
                elif role == "user":
                    formatted_prompt += f"User: {content}\n\n"
                elif role == "assistant":
                    formatted_prompt += f"Assistant: {content}\n\n"
            formatted_prompt += "Assistant:"

        # Tokenize
        inputs = tokenizer(
            formatted_prompt,
            return_tensors="pt",
            truncation=True,
            max_length=4096
        )

        device = next(model.parameters()).device
        inputs = {k: v.to(device) for k, v in inputs.items()}

        # Generate response
        gen_kwargs = {
            "max_new_tokens": int(request.max_new_tokens),
            "do_sample": True,
            "temperature": max(0.01, float(request.temperature)),
            "top_k": int(request.top_k) if request.top_k > 0 else None,
            "top_p": float(request.top_p) if request.top_p > 0 else None,
            "pad_token_id": tokenizer.pad_token_id,
            "eos_token_id": tokenizer.eos_token_id,
        }

        with torch.no_grad():
            outputs = model.generate(**inputs, **gen_kwargs)

        # Decode response
        generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

        # Extract only the assistant's response (remove the prompt)
        response = generated_text[len(formatted_prompt):].strip()

        # If response is empty, use the full generated text
        if not response:
            response = generated_text.strip()

        gen_time = time.perf_counter() - t0
        print(f"Chat response generated in {gen_time:.2f}s")

        # Update chat history if enabled
        if request.use_history:
            chat_history.append({"role": "user", "content": request.message})
            chat_history.append({"role": "assistant", "content": response})

            # Keep only last 10 exchanges (20 messages)
            if len(chat_history) > 20:
                chat_history = chat_history[-20:]

        return {
            "success": True,
            "response": response,
            "generation_time": gen_time,
            "history_length": len(chat_history),
        }

    except Exception as e:
        last_error = str(e)
        print(f"Chat error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/chat/stream")
async def chat_stream(request: StreamChatRequest):
    """Streaming chat endpoint that yields tokens as they're generated."""
    global model, tokenizer, model_ready, chat_history, last_error, model_name

    if not model_ready or model is None or tokenizer is None:
        async def error_generator():
            yield f"data: {json.dumps({'error': 'Model not loaded'})}\n\n"
        return StreamingResponse(error_generator(), media_type="text/event-stream")

    if not request.message.strip():
        async def error_generator():
            yield f"data: {json.dumps({'error': 'Please enter a message'})}\n\n"
        return StreamingResponse(error_generator(), media_type="text/event-stream")

    async def generate_stream() -> AsyncGenerator[str, None]:
        global chat_history
        last_error_local = None
        full_response = ""

        try:
            print(f"Stream chat request: '{request.message[:50]}...'")
            t0 = time.perf_counter()

            # Build conversation context
            messages = []

            # Add system prompt if provided
            if request.system_prompt:
                messages.append({"role": "system", "content": request.system_prompt})

            # Add chat history if enabled
            if request.use_history:
                messages.extend(chat_history)

            # Add current user message
            messages.append({"role": "user", "content": request.message})

            # Format the conversation using the tokenizer's chat template
            try:
                formatted_prompt = tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True
                )
            except Exception as e:
                print(f"Chat template not available, using simple format: {e}")
                formatted_prompt = ""
                for msg in messages:
                    role = msg["role"]
                    content = msg["content"]
                    if role == "system":
                        formatted_prompt += f"System: {content}\n\n"
                    elif role == "user":
                        formatted_prompt += f"User: {content}\n\n"
                    elif role == "assistant":
                        formatted_prompt += f"Assistant: {content}\n\n"
                formatted_prompt += "Assistant:"

            # Tokenize
            inputs = tokenizer(
                formatted_prompt,
                return_tensors="pt",
                truncation=True,
                max_length=4096
            )

            device = next(model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}
            input_length = inputs["input_ids"].shape[1]

            # Import TextIteratorStreamer for streaming generation
            from transformers import TextIteratorStreamer
            from threading import Thread

            # Create streamer
            streamer = TextIteratorStreamer(
                tokenizer,
                skip_prompt=True,
                skip_special_tokens=True
            )

            # Generation kwargs
            gen_kwargs = {
                "max_new_tokens": int(request.max_new_tokens),
                "do_sample": True,
                "temperature": max(0.01, float(request.temperature)),
                "top_k": int(request.top_k) if request.top_k > 0 else None,
                "top_p": float(request.top_p) if request.top_p > 0 else None,
                "pad_token_id": tokenizer.pad_token_id,
                "eos_token_id": tokenizer.eos_token_id,
                "streamer": streamer,
                **inputs
            }

            # Send start event
            yield f"data: {json.dumps({'type': 'start'})}\n\n"

            # Run generation in a separate thread
            thread = Thread(target=lambda: model.generate(**gen_kwargs))
            thread.start()

            # Stream tokens as they're generated
            for text in streamer:
                if text:
                    full_response += text
                    yield f"data: {json.dumps({'type': 'token', 'content': text})}\n\n"
                    await asyncio.sleep(0)  # Allow other tasks to run

            thread.join()

            gen_time = time.perf_counter() - t0
            print(f"Stream response generated in {gen_time:.2f}s")

            # Update chat history if enabled
            if request.use_history:
                chat_history.append({"role": "user", "content": request.message})
                chat_history.append({"role": "assistant", "content": full_response})

                # Keep only last 10 exchanges (20 messages)
                if len(chat_history) > 20:
                    chat_history = chat_history[-20:]

            # Send completion event
            yield f"data: {json.dumps({'type': 'done', 'generation_time': gen_time, 'history_length': len(chat_history)})}\n\n"

        except Exception as e:
            last_error_local = str(e)
            print(f"Stream chat error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/clear_history")
async def clear_history():
    global chat_history

    chat_history = []
    print("Chat history cleared")

    return {"success": True, "message": "Chat history cleared"}


@app.get("/history")
async def get_history():
    global chat_history

    return {
        "success": True,
        "history": chat_history,
        "length": len(chat_history)
    }


@app.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server"""
    print("Shutdown requested...")
    import asyncio
    asyncio.get_event_loop().call_later(0.5, lambda: os._exit(0))
    return {"success": True, "message": "Server shutting down"}


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8888
    print(f"Starting Local LLM Chat server on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port)
