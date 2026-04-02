"""
Local LLM Chat FastAPI Server
Provides chat endpoints using a Hugging Face model.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, AsyncGenerator, Any
import uvicorn
import torch
import gc
import time
import os
import asyncio
import json
from pathlib import Path
import numpy as np
import pickle

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


def get_prompts_path() -> Path:
    """Get the path for storing prompt files."""
    return Path(__file__).parent / "prompts"


def get_conversations_path() -> Path:
    """Get the path for storing conversation files."""
    return Path(__file__).parent / "conversations"


def get_embeddings_path() -> Path:
    """Get the path for storing embedding files."""
    return Path(__file__).parent / "embeddings"


# Global state - Generation Model
model = None
tokenizer = None
model_name = ""
model_type = "transformers"  # Track which type of model is loaded: "transformers" or "gguf"
model_ready = False
model_loading = False
chat_history = []
last_error = None
models_cache = get_models_cache_path()
active_system_prompt = "default_system"

# Global state - RAG
embed_model = None
embed_tokenizer = None
embed_model_name = ""
embed_ready = False
embed_loading = False

# Document storage
documents = {}  # name -> content (text)
chunks = []     # List of (chunk_text, doc_name) tuples
embeddings = None  # numpy array of chunk embeddings
chunk_size = 200  # configurable chunk size


class ModelConfig(BaseModel):
    model_name: str = "microsoft/Phi-3-mini-4k-instruct"  # Default medium-sized model
    model_type: str = "transformers"  # "transformers" or "gguf"
    device: str = "auto"
    use_fp16: bool = True
    max_length: int = 2048
    use_cpu_offload: bool = False  # CPU offload requires accelerate library
    # GGUF-specific parameters
    gguf_file: Optional[str] = None  # Specific GGUF file to load (auto-detected if None)
    n_gpu_layers: int = -1  # GPU layers for GGUF (-1 = all layers on GPU)
    n_ctx: int = 8192  # Context window for GGUF models


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


# RAG-specific Pydantic models
class EmbedModelConfig(BaseModel):
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2"


class Document(BaseModel):
    name: str
    content: str


class PDFDocument(BaseModel):
    name: str
    pdf_base64: str


class IndexRequest(BaseModel):
    chunk_size: int = 200


class RAGQueryRequest(BaseModel):
    query: str
    top_k: int = 3
    temperature: float = 0.7
    max_new_tokens: int = 512
    relevance_threshold: float = 0.35
    use_rag: bool = True
    # Include existing chat params
    top_k_gen: int = 50
    top_p: float = 0.9
    system_prompt: str = ""
    use_history: bool = False


class SaveEmbeddingsRequest(BaseModel):
    filename: str = "embeddings.pkl"


class PromptUpdateRequest(BaseModel):
    name: str
    content: str


class PromptSelectRequest(BaseModel):
    name: str


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


def mean_pooling(model_output, attention_mask):
    """Mean pooling - take average of all tokens."""
    token_embeddings = model_output[0]  # First element is last_hidden_state
    input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(input_mask_expanded.sum(1), min=1e-9)


def encode_texts(texts: List[str]) -> np.ndarray:
    """Encode texts using the loaded embedding model."""
    if embed_model is None or embed_tokenizer is None:
        raise Exception("Embedding model not loaded")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    all_embeddings = []

    # Process in batches to avoid OOM
    batch_size = 32
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i + batch_size]

        # Tokenize
        encoded = embed_tokenizer(
            batch_texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors='pt'
        )
        encoded = {k: v.to(device) for k, v in encoded.items()}

        # Get embeddings
        with torch.no_grad():
            model_output = embed_model(**encoded)
            embeddings = mean_pooling(model_output, encoded['attention_mask'])
            # Normalize
            embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
            all_embeddings.append(embeddings.cpu().numpy())

    return np.vstack(all_embeddings)


# ============================================
# PDF Extraction Functions
# ============================================

def extract_text_from_pdf_pypdf2(pdf_content: bytes) -> dict:
    """Extract text from PDF bytes using PyPDF2."""
    result = {
        "success": False,
        "text": "",
        "error": None,
        "method": "PyPDF2",
        "page_count": 0,
        "warnings": []
    }

    try:
        from PyPDF2 import PdfReader
        from io import BytesIO

        pdf_file = BytesIO(pdf_content)
        reader = PdfReader(pdf_file)
        result["page_count"] = len(reader.pages)

        text_parts = []
        empty_pages = 0

        for page_num, page in enumerate(reader.pages, 1):
            try:
                page_text = page.extract_text()

                if page_text and page_text.strip():
                    printable = sum(c.isprintable() or c.isspace() for c in page_text)
                    ratio = printable / len(page_text) if len(page_text) > 0 else 0

                    if ratio > 0.8:
                        text_parts.append(f"[Page {page_num}]\n{page_text}")
                    else:
                        empty_pages += 1
                        result["warnings"].append(f"Page {page_num}: Text extraction returned garbled data")
                else:
                    empty_pages += 1
                    result["warnings"].append(f"Page {page_num}: No text found")
            except Exception as e:
                empty_pages += 1
                result["warnings"].append(f"Page {page_num}: Error extracting text - {str(e)}")

        if text_parts:
            result["text"] = "\n\n".join(text_parts)
            result["success"] = True
            if empty_pages > 0:
                result["warnings"].append(f"{empty_pages}/{result['page_count']} pages had no extractable text")
        else:
            result["error"] = f"No text could be extracted from any of the {result['page_count']} pages."

    except ImportError:
        result["error"] = "PyPDF2 is not installed. Install it with: pip install PyPDF2"
    except Exception as e:
        result["error"] = f"Failed to extract text from PDF: {str(e)}"
        import traceback
        result["error_detail"] = traceback.format_exc()

    return result


def extract_text_from_pdf_pypdf(pdf_content: bytes) -> dict:
    """Extract text from PDF bytes using pypdf (newer version)."""
    result = {
        "success": False,
        "text": "",
        "error": None,
        "method": "pypdf",
        "page_count": 0,
        "warnings": []
    }

    try:
        from pypdf import PdfReader
        from io import BytesIO

        pdf_file = BytesIO(pdf_content)
        reader = PdfReader(pdf_file)
        result["page_count"] = len(reader.pages)

        text_parts = []
        empty_pages = 0

        for page_num, page in enumerate(reader.pages, 1):
            try:
                page_text = page.extract_text()

                if page_text and page_text.strip():
                    printable = sum(c.isprintable() or c.isspace() for c in page_text)
                    ratio = printable / len(page_text) if len(page_text) > 0 else 0

                    if ratio > 0.8:
                        text_parts.append(f"[Page {page_num}]\n{page_text}")
                    else:
                        empty_pages += 1
                        result["warnings"].append(f"Page {page_num}: Text extraction returned garbled data")
                else:
                    empty_pages += 1
                    result["warnings"].append(f"Page {page_num}: No text found")
            except Exception as e:
                empty_pages += 1
                result["warnings"].append(f"Page {page_num}: Error extracting text - {str(e)}")

        if text_parts:
            result["text"] = "\n\n".join(text_parts)
            result["success"] = True
            if empty_pages > 0:
                result["warnings"].append(f"{empty_pages}/{result['page_count']} pages had no extractable text")
        else:
            result["error"] = f"No text could be extracted from any of the {result['page_count']} pages."

    except ImportError:
        result["error"] = "pypdf is not installed. Install it with: pip install pypdf"
    except Exception as e:
        result["error"] = f"Failed to extract text from PDF: {str(e)}"
        import traceback
        result["error_detail"] = traceback.format_exc()

    return result


def extract_text_from_pdf_pymupdf(pdf_content: bytes) -> dict:
    """Extract text from PDF bytes using PyMuPDF (fitz)."""
    result = {
        "success": False,
        "text": "",
        "error": None,
        "method": "PyMuPDF",
        "page_count": 0,
        "warnings": []
    }

    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_content, filetype="pdf")
        result["page_count"] = len(doc)

        text_parts = []
        empty_pages = 0

        for page_num, page in enumerate(doc, 1):
            try:
                page_text = page.get_text()

                if page_text and page_text.strip():
                     text_parts.append(f"[Page {page_num}]\n{page_text}")
                else:
                    empty_pages += 1
                    result["warnings"].append(f"Page {page_num}: No text found")
            except Exception as e:
                empty_pages += 1
                result["warnings"].append(f"Page {page_num}: Error extracting text - {str(e)}")

        if text_parts:
            result["text"] = "\n\n".join(text_parts)
            result["success"] = True
            if empty_pages > 0:
                result["warnings"].append(f"{empty_pages}/{result['page_count']} pages had no extractable text")
        else:
            result["error"] = f"No text could be extracted from any of the {result['page_count']} pages."

    except ImportError:
        result["error"] = "PyMuPDF is not installed. Install it with: pip install pymupdf"
    except Exception as e:
        result["error"] = f"Failed to extract text from PDF: {str(e)}"
        import traceback
        result["error_detail"] = traceback.format_exc()

    return result


def extract_text_from_pdf(pdf_content: bytes) -> dict:
    """Try multiple PDF libraries in order of preference."""
    errors = []

    # Try PyMuPDF first (fastest and most robust)
    try:
        result = extract_text_from_pdf_pymupdf(pdf_content)
        if result["success"]:
            return result
        errors.append(f"PyMuPDF: {result.get('error', 'Unknown error')}")
    except Exception as e:
        errors.append(f"PyMuPDF exception: {str(e)}")

    # Try pypdf second
    try:
        result = extract_text_from_pdf_pypdf(pdf_content)
        if result["success"]:
            return result
        errors.append(f"pypdf: {result.get('error', 'Unknown error')}")
    except Exception as e:
        errors.append(f"pypdf exception: {str(e)}")

    # Try PyPDF2 as fallback
    try:
        result = extract_text_from_pdf_pypdf2(pdf_content)
        if result["success"]:
            return result
        errors.append(f"PyPDF2: {result.get('error', 'Unknown error')}")
    except Exception as e:
        errors.append(f"PyPDF2 exception: {str(e)}")

    # If all failed, return error with details
    return {
        "success": False,
        "text": "",
        "error": f"PDF extraction failed. Installed libraries returned errors: {'; '.join(errors)}",
        "method": "none",
        "page_count": 0,
        "warnings": []
    }


def load_gguf_model(config: ModelConfig) -> dict:
    """Load a GGUF model using llama-cpp-python."""
    global model, tokenizer, model_name, model_ready

    try:
        from llama_cpp import Llama
    except ImportError:
        return {"success": False, "error": "llama-cpp-python not installed. Install it via Python Manager."}

    # Check GPU support
    import llama_cpp
    gpu_supported = False
    llama_version = getattr(llama_cpp, "__version__", "")

    if "+cu" in llama_version:
        gpu_supported = True
    try:
        if llama_cpp.llama_supports_gpu_offload():
            gpu_supported = True
    except Exception:
        pass

    n_gpu_layers = config.n_gpu_layers if gpu_supported else 0
    print(f"GPU layers: {n_gpu_layers}, GPU supported: {gpu_supported}")

    cache_dir = str(models_cache) if models_cache else None

    # Handle HuggingFace repo format (e.g., "bartowski/Qwen2.5-7B-Instruct-GGUF")
    if "/" in config.model_name and not config.model_name.endswith(".gguf"):
        from huggingface_hub import hf_hub_download, list_repo_files

        gguf_file = config.gguf_file
        if not gguf_file:
            # Auto-detect best GGUF file
            print(f"Scanning {config.model_name} for GGUF files...")
            files = list_repo_files(config.model_name)
            gguf_files = [f for f in files if f.endswith(".gguf")]

            if not gguf_files:
                return {"success": False, "error": f"No .gguf files found in {config.model_name}"}

            # Prefer Q4_K_M → Q4_K_S → Q5_K_M → Q8_0 (best quality/size balance)
            for preferred in ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q8_0"]:
                for f in gguf_files:
                    if preferred in f:
                        gguf_file = f
                        break
                if gguf_file:
                    break
            if not gguf_file:
                gguf_file = gguf_files[0]

        print(f"Downloading GGUF file: {gguf_file}")
        # Only pass cache_dir if it's not None
        download_kwargs = {
            "repo_id": config.model_name,
            "filename": gguf_file,
        }
        if cache_dir:
            download_kwargs["cache_dir"] = cache_dir

        model_path = hf_hub_download(**download_kwargs)
    else:
        # Direct file path
        model_path = config.model_name

    print(f"Loading GGUF from: {model_path}")
    model = Llama(
        model_path=model_path,
        n_gpu_layers=n_gpu_layers,
        n_ctx=config.n_ctx,
        verbose=False,
    )

    # GGUF models don't use a separate tokenizer
    tokenizer = None
    model_ready = True

    print(f"GGUF model loaded (GPU layers: {n_gpu_layers}, context: {config.n_ctx})")
    return {
        "success": True,
        "model_name": model_name,
        "model_type": "gguf",
        "gpu_layers": n_gpu_layers,
        "context_size": config.n_ctx
    }


def load_transformers_model(config: ModelConfig) -> dict:
    """Load a HuggingFace transformers model."""
    global model, tokenizer, model_name, model_ready

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

    return {"success": True, "device": device, "model_name": model_name, "model_type": "transformers"}


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
    global embed_ready, embed_loading, embed_model_name, documents, embeddings, chunks, chunk_size

    vram = get_vram_stats()

    return {
        "model_ready": model_ready,
        "model_loading": model_loading,
        "model_name": model_name,
        "cuda_available": torch.cuda.is_available(),
        "vram": vram,
        "error": last_error,
        "chat_history_length": len(chat_history),
        # RAG fields
        "embed_loaded": embed_model is not None,
        "embed_ready": embed_ready,
        "embed_loading": embed_loading,
        "embed_model_name": embed_model_name,
        "documents_count": len(documents),
        "documents_indexed": embeddings is not None and len(chunks) > 0,
        "chunks_count": len(chunks),
        "chunk_size": chunk_size,
    }


@app.post("/load_model")
async def load_model(config: ModelConfig):
    global model, tokenizer, model_name, model_type, model_ready, model_loading, last_error

    if model_loading:
        return {"success": False, "error": "Model is already loading"}

    model_loading = True
    last_error = None

    try:
        # Unload existing model first
        if model is not None:
            # Only call .to() for transformers models
            if model_type == "transformers":
                model.to("cpu")
            del model
            model = None
            if tokenizer is not None:
                del tokenizer
                tokenizer = None
            clear_cuda()

        model_name = config.model_name
        model_type = config.model_type

        print(f"Loading {model_type} model: {model_name}")

        # Route to appropriate loader
        if config.model_type == "gguf":
            return load_gguf_model(config)
        else:
            return load_transformers_model(config)

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
    global model, tokenizer, model_ready, model_name, model_type

    print("Unloading LLM model...")

    if model is not None:
        try:
            # Only call .to() for transformers models
            if model_type == "transformers":
                model.to("cpu")
            if torch.cuda.is_available():
                torch.cuda.synchronize()
        except Exception as e:
            print(f"Error moving model to CPU: {e}")

    model = None
    tokenizer = None
    model_ready = False
    model_name = ""
    model_type = "transformers"  # Reset to default

    for _ in range(5):
        gc.collect()

    clear_cuda()
    print("LLM model unloaded")

    return {"success": True}


# ============================================
# Embedding Model Endpoints (RAG)
# ============================================

@app.post("/embed/load")
async def load_embed_model(config: EmbedModelConfig):
    global embed_model, embed_tokenizer, embed_model_name, embed_ready, embed_loading

    if embed_loading:
        return {"success": False, "error": "Embedding model is already loading"}

    embed_loading = True

    try:
        from transformers import AutoModel, AutoTokenizer

        # Unload existing if any
        embed_model = None
        embed_tokenizer = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        print(f"Loading embedding model: {config.model_name}")
        device = "cuda" if torch.cuda.is_available() else "cpu"

        embed_tokenizer = AutoTokenizer.from_pretrained(
            config.model_name,
            trust_remote_code=True,
            cache_dir=models_cache
        )
        embed_model = AutoModel.from_pretrained(
            config.model_name,
            trust_remote_code=True,
            cache_dir=models_cache
        )
        embed_model.to(device)
        embed_model.eval()
        embed_model_name = config.model_name
        embed_ready = True

        print(f"Embedding model loaded on {device}")
        return {"success": True, "device": device, "model_name": config.model_name}

    except Exception as e:
        print(f"Error loading embedding model: {e}")
        import traceback
        traceback.print_exc()
        embed_ready = False
        return {"success": False, "error": str(e)}
    finally:
        embed_loading = False


@app.post("/embed/unload")
async def unload_embed_model():
    global embed_model, embed_tokenizer, embed_model_name, embed_ready

    print("Unloading embedding model...")

    embed_model = None
    embed_tokenizer = None
    embed_model_name = ""
    embed_ready = False

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    for _ in range(5):
        gc.collect()

    print("Embedding model unloaded")
    return {"success": True}


# ==================== Document Management ====================

@app.post("/documents/add")
async def add_document(doc: Document):
    """Add a text document to the collection."""
    global documents, embeddings, chunks

    try:
        documents[doc.name] = doc.content
        # Invalidate embeddings when documents change
        embeddings = None
        chunks = []

        char_count = len(doc.content)
        print(f"Added document '{doc.name}' ({char_count} chars)")
        return {"success": True, "name": doc.name, "char_count": char_count}
    except Exception as e:
        print(f"Error adding document: {e}")
        return {"success": False, "error": str(e)}


@app.post("/documents/add-pdf")
async def add_pdf_document(pdf_doc: PDFDocument):
    """Add a PDF document by extracting its text."""
    global documents, embeddings, chunks

    try:
        # Decode base64 PDF
        import base64
        pdf_bytes = base64.b64decode(pdf_doc.pdf_base64)

        # Extract text using the PDF extraction function
        result = extract_text_from_pdf(pdf_bytes)

        if not result["success"]:
            return {"success": False, "error": result.get("error", "Unknown error")}

        # Store the extracted text
        documents[pdf_doc.name] = result["text"]

        # Invalidate embeddings
        embeddings = None
        chunks = []

        print(f"Added PDF '{pdf_doc.name}' ({result['char_count']} chars, {result['page_count']} pages, method: {result['method']})")

        return {
            "success": True,
            "name": pdf_doc.name,
            "char_count": result["char_count"],
            "page_count": result["page_count"],
            "method": result["method"],
            "warnings": result.get("warnings", [])
        }
    except Exception as e:
        print(f"Error adding PDF: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.get("/documents")
async def list_documents():
    """List all documents in the collection."""
    global documents, embeddings, chunks

    docs_list = []
    for name, content in documents.items():
        docs_list.append({
            "name": name,
            "char_count": len(content),
            "indexed": embeddings is not None and len(chunks) > 0
        })

    return {"success": True, "documents": docs_list, "count": len(docs_list)}


@app.delete("/documents/{name}")
async def delete_document(name: str):
    """Delete a document from the collection."""
    global documents, embeddings, chunks

    if name not in documents:
        return {"success": False, "error": f"Document '{name}' not found"}

    del documents[name]
    # Invalidate embeddings
    embeddings = None
    chunks = []

    print(f"Deleted document '{name}'")
    return {"success": True, "name": name}


@app.post("/documents/clear")
async def clear_documents():
    """Clear all documents from the collection."""
    global documents, embeddings, chunks

    count = len(documents)
    documents = {}
    embeddings = None
    chunks = []

    print(f"Cleared all {count} documents")
    return {"success": True, "count": count}


# ==================== Document Indexing ====================

@app.post("/documents/index")
async def index_documents(request: IndexRequest):
    """Index all documents by chunking and embedding them."""
    global documents, chunks, embeddings, chunk_size

    if not embed_ready or embed_model is None:
        return {"success": False, "error": "Embedding model not loaded"}

    if len(documents) == 0:
        return {"success": False, "error": "No documents to index"}

    try:
        chunk_size = request.chunk_size
        chunks = []

        # Chunk all documents
        for doc_name, content in documents.items():
            # Split by words
            words = content.split()
            current_chunk = []
            current_length = 0

            for word in words:
                word_length = len(word) + 1  # +1 for space
                if current_length + word_length > chunk_size and current_chunk:
                    # Save current chunk
                    chunk_text = " ".join(current_chunk)
                    chunks.append((chunk_text, doc_name))
                    current_chunk = [word]
                    current_length = word_length
                else:
                    current_chunk.append(word)
                    current_length += word_length

            # Add last chunk if not empty
            if current_chunk:
                chunk_text = " ".join(current_chunk)
                chunks.append((chunk_text, doc_name))

        # Encode all chunks
        chunk_texts = [chunk[0] for chunk in chunks]
        embeddings = encode_texts(chunk_texts)

        print(f"Indexed {len(documents)} documents into {len(chunks)} chunks")
        return {
            "success": True,
            "documents_count": len(documents),
            "chunks_count": len(chunks),
            "chunk_size": chunk_size
        }

    except Exception as e:
        print(f"Error indexing documents: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/documents/unindex")
async def unindex_documents():
    """Clear the document index (embeddings and chunks)."""
    global chunks, embeddings

    chunks = []
    embeddings = None

    print("Cleared document index")
    return {"success": True}


# ==================== Embedding Persistence ====================

@app.post("/embeddings/save")
async def save_embeddings(request: SaveEmbeddingsRequest):
    """Save embeddings to disk."""
    global documents, chunks, embeddings, chunk_size

    if embeddings is None or len(chunks) == 0:
        return {"success": False, "error": "No embeddings to save. Index documents first."}

    try:
        # Ensure embeddings directory exists
        embeddings_dir = get_embeddings_path()
        embeddings_dir.mkdir(exist_ok=True)

        # Save to file
        filepath = embeddings_dir / request.filename
        save_data = {
            "documents": documents,
            "chunks": chunks,
            "embeddings": embeddings,
            "chunk_size": chunk_size
        }

        with open(filepath, "wb") as f:
            pickle.dump(save_data, f)

        print(f"Saved embeddings to {filepath}")
        return {
            "success": True,
            "filepath": str(filepath),
            "documents_count": len(documents),
            "chunks_count": len(chunks)
        }

    except Exception as e:
        print(f"Error saving embeddings: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/embeddings/load")
async def load_embeddings(request: SaveEmbeddingsRequest):
    """Load embeddings from disk."""
    global documents, chunks, embeddings, chunk_size

    try:
        embeddings_dir = get_embeddings_path()
        filepath = embeddings_dir / request.filename

        if not filepath.exists():
            return {"success": False, "error": f"File not found: {request.filename}"}

        with open(filepath, "rb") as f:
            save_data = pickle.load(f)

        documents = save_data["documents"]
        chunks = save_data["chunks"]
        embeddings = save_data["embeddings"]
        chunk_size = save_data["chunk_size"]

        print(f"Loaded embeddings from {filepath}")
        return {
            "success": True,
            "documents_count": len(documents),
            "chunks_count": len(chunks),
            "chunk_size": chunk_size
        }

    except Exception as e:
        print(f"Error loading embeddings: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.get("/embeddings/list")
async def list_embeddings():
    """List all saved embedding files."""
    try:
        embeddings_dir = get_embeddings_path()
        if not embeddings_dir.exists():
            return {"success": True, "files": []}

        files = []
        for filepath in embeddings_dir.glob("*.pkl"):
            stat = filepath.stat()
            files.append({
                "filename": filepath.name,
                "size": stat.st_size,
                "modified": stat.st_mtime
            })

        # Sort by modified time (newest first)
        files.sort(key=lambda x: x["modified"], reverse=True)

        return {"success": True, "files": files}

    except Exception as e:
        print(f"Error listing embeddings: {e}")
        return {"success": False, "error": str(e)}


# ==================== RAG Query ====================

@app.post("/rag/query")
async def rag_query(request: RAGQueryRequest):
    """Handle RAG query with document retrieval."""
    global embeddings, chunks, chat_history, model, tokenizer, model_name

    import time
    start_time = time.time()

    try:
        retrieved_chunks = []
        context = ""

        # Retrieve context if RAG mode is enabled and embeddings exist
        if request.use_rag and embeddings is not None and len(chunks) > 0:
            if not embed_ready or embed_model is None:
                return {"success": False, "error": "Embedding model not loaded"}

            # Encode query
            query_embedding = encode_texts([request.query])[0]

            # Compute cosine similarities
            similarities = np.dot(embeddings, query_embedding)

            # Get top-k indices
            top_indices = np.argsort(similarities)[-request.top_k:][::-1]

            # Filter by relevance threshold and build context
            context_parts = []
            for idx in top_indices:
                sim = similarities[idx]
                if sim >= request.relevance_threshold:
                    chunk_text, doc_name = chunks[idx]
                    context_parts.append(f"[From {doc_name}]\n{chunk_text}")
                    retrieved_chunks.append({
                        "text": chunk_text[:200] + "..." if len(chunk_text) > 200 else chunk_text,
                        "document": doc_name,
                        "similarity": float(sim),
                        "index": int(idx)
                    })

            if context_parts:
                context = "\n\n".join(context_parts)

        # Build prompt based on mode
        if context:
            # RAG mode with retrieved context
            system_prompt = """You are a helpful assistant. Answer the question based on the context provided below. If the context doesn't contain enough information to answer the question, say so and provide what information you can based on the context.

Context:
{context}

Question: {query}"""
            prompt = system_prompt.format(context=context, query=request.query)
        else:
            # Regular chat mode or no relevant context found
            if request.system_prompt:
                prompt = f"{request.system_prompt}\n\nUser: {request.query}\nAssistant:"
            else:
                prompt = f"You are a helpful assistant. Engage in conversation naturally.\n\nUser: {request.query}\nAssistant:"

        # Build ChatRequest object for generation
        chat_request = ChatRequest(
            message=prompt,
            temperature=request.temperature,
            max_new_tokens=request.max_new_tokens,
            top_k=request.top_k_gen,
            top_p=request.top_p,
            system_prompt="",  # Already included in prompt
            use_history=False,  # RAG queries don't use chat history by default
            stream=False
        )

        # Route to appropriate generation function
        if model_name.endswith(".gguf"):
            result = chat_gguf(chat_request)
        else:
            result = chat_transformers(chat_request)

        if not result.get("success"):
            return result

        generation_time = time.time() - start_time

        return {
            "success": True,
            "response": result["response"],
            "retrieved_chunks": retrieved_chunks,
            "generation_time": generation_time,
            "context_used": len(context) > 0
        }

    except Exception as e:
        print(f"Error in RAG query: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


def chat_gguf(request: ChatRequest) -> dict:
    """Handle chat with GGUF model."""
    global model, chat_history

    # Build conversation using ChatML format (standard for GGUF models)
    messages = []

    # Add system prompt
    system_prompt = request.system_prompt
    if not system_prompt:
        system_prompt = get_active_prompt_content()
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    # Add chat history
    if request.use_history:
        messages.extend(chat_history)

    # Add current message
    messages.append({"role": "user", "content": request.message})

    # Format using ChatML (most GGUF models support this)
    prompt = ""
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        prompt += f"<|im_start|>{role}\n{content}<|im_end|>\n"
    prompt += "<|im_start|>assistant\n"

    # Generate
    t0 = time.perf_counter()
    output = model(
        prompt,
        max_tokens=request.max_new_tokens,
        temperature=max(0.01, request.temperature),
        top_k=request.top_k if request.top_k > 0 else -1,  # -1 disables for llama.cpp
        top_p=request.top_p if request.top_p > 0 else 1.0,  # 1.0 disables for llama.cpp
        stop=["<|im_end|>", "<|im_start|>"],
    )

    response = output["choices"][0]["text"].strip()
    gen_time = time.perf_counter() - t0

    # Update history
    if request.use_history:
        chat_history.append({"role": "user", "content": request.message})
        chat_history.append({"role": "assistant", "content": response})
        if len(chat_history) > 20:
            chat_history = chat_history[-20:]

    return {
        "success": True,
        "response": response,
        "generation_time": gen_time,
        "history_length": len(chat_history),
    }


def chat_transformers(request: ChatRequest) -> dict:
    """Handle chat with HuggingFace transformers model."""
    global model, tokenizer, chat_history

    print(f"Chat request: '{request.message[:50]}...'")
    t0 = time.perf_counter()

    # Build conversation context
    messages = []

    # Use provided system prompt, or fall back to active prompt from file
    system_prompt = request.system_prompt
    if not system_prompt:
        system_prompt = get_active_prompt_content()
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

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

    # Decode only the new tokens (skip the input tokens)
    input_length = inputs['input_ids'].shape[1]
    new_tokens = outputs[0][input_length:]
    response = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

    # Fallback: if response is empty, try decoding full output and extracting
    if not response:
        generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
        # Try to find where the response starts after common assistant markers
        for marker in ['Assistant:', 'assistant:', '[/INST]', '<|assistant|>', '<|start_header_id|>assistant']:
            if marker in generated_text:
                response = generated_text.split(marker)[-1].strip()
                break
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


@app.post("/chat")
async def chat(request: ChatRequest):
    global model, tokenizer, model_ready, model_type, chat_history, last_error, model_name

    if not model_ready or model is None:
        return {"success": False, "error": "Model not loaded"}

    # GGUF models don't use tokenizer
    if model_type == "transformers" and tokenizer is None:
        return {"success": False, "error": "Model not loaded"}

    if not request.message.strip():
        return {"success": False, "error": "Please enter a message"}

    last_error = None

    try:
        # Route to appropriate chat handler based on model type
        if model_type == "gguf":
            return chat_gguf(request)
        else:
            return chat_transformers(request)

    except Exception as e:
        last_error = str(e)
        print(f"Chat error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


async def chat_stream_gguf(request: StreamChatRequest):
    """Streaming chat for GGUF models."""
    global model, chat_history

    # Build prompt (same as chat_gguf)
    messages = []
    system_prompt = request.system_prompt
    if not system_prompt:
        system_prompt = get_active_prompt_content()
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    if request.use_history:
        messages.extend(chat_history)
    messages.append({"role": "user", "content": request.message})

    prompt = ""
    for msg in messages:
        prompt += f"<|im_start|>{msg['role']}\n{msg['content']}<|im_end|>\n"
    prompt += "<|im_start|>assistant\n"

    async def generate_stream():
        global chat_history  # Need to declare global in nested function too
        full_response = ""
        t0 = time.perf_counter()

        try:
            # Send start event
            yield f"data: {json.dumps({'type': 'start'})}\n\n"

            # llama-cpp-python streaming
            for token in model(
                prompt,
                max_tokens=request.max_new_tokens,
                temperature=max(0.01, request.temperature),
                top_k=request.top_k if request.top_k > 0 else -1,
                top_p=request.top_p if request.top_p > 0 else 1.0,
                stop=["<|im_end|>", "<|im_start|>"],
                stream=True
            ):
                token_text = token["choices"][0]["text"]
                full_response += token_text
                yield f"data: {json.dumps({'type': 'token', 'content': token_text})}\n\n"
                await asyncio.sleep(0)  # Allow other tasks

            gen_time = time.perf_counter() - t0

            # Update history
            if request.use_history:
                chat_history.append({"role": "user", "content": request.message})
                chat_history.append({"role": "assistant", "content": full_response})
                if len(chat_history) > 20:
                    chat_history = chat_history[-20:]

            # Send done event
            yield f"data: {json.dumps({'type': 'done', 'generation_time': gen_time, 'history_length': len(chat_history)})}\n\n"

        except Exception as e:
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


async def chat_stream_transformers(request: StreamChatRequest):
    """Streaming chat for HuggingFace transformers models."""
    global model, tokenizer, chat_history

    async def generate_stream() -> AsyncGenerator[str, None]:
        global chat_history  # Need to declare global in nested function too
        full_response = ""

        try:
            print(f"Stream chat request: '{request.message[:50]}...'")
            t0 = time.perf_counter()

            # Build conversation context
            messages = []

            # Add system prompt if provided
            system_prompt = request.system_prompt
            if not system_prompt:
                system_prompt = get_active_prompt_content()
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})

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


@app.post("/chat/stream")
async def chat_stream(request: StreamChatRequest):
    """Streaming chat endpoint that yields tokens as they're generated."""
    global model, tokenizer, model_ready, model_type, chat_history, last_error, model_name

    if not model_ready or model is None:
        async def error_generator():
            yield f"data: {json.dumps({'error': 'Model not loaded'})}\n\n"
        return StreamingResponse(error_generator(), media_type="text/event-stream")

    # GGUF models don't use tokenizer
    if model_type == "transformers" and tokenizer is None:
        async def error_generator():
            yield f"data: {json.dumps({'error': 'Model not loaded'})}\n\n"
        return StreamingResponse(error_generator(), media_type="text/event-stream")

    if not request.message.strip():
        async def error_generator():
            yield f"data: {json.dumps({'error': 'Please enter a message'})}\n\n"
        return StreamingResponse(error_generator(), media_type="text/event-stream")

    # Route to appropriate streaming handler based on model type
    if model_type == "gguf":
        return await chat_stream_gguf(request)
    else:
        return await chat_stream_transformers(request)


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


# ============================================
# Prompts Endpoints
# ============================================

def list_prompts() -> List[str]:
    """List all available prompt files."""
    prompts_dir = get_prompts_path()
    prompts_dir.mkdir(parents=True, exist_ok=True)

    prompts = []
    for f in prompts_dir.glob("*.txt"):
        prompts.append(f.stem)

    # Ensure default exists
    if "default_system" not in prompts:
        default_content = "You are a helpful AI assistant."
        (prompts_dir / "default_system.txt").write_text(default_content, encoding='utf-8')
        prompts.append("default_system")

    return sorted(prompts)


def get_active_prompt_content() -> str:
    """Get the content of the active system prompt."""
    global active_system_prompt
    prompts_dir = get_prompts_path()
    filepath = prompts_dir / f"{active_system_prompt}.txt"

    if filepath.exists():
        return filepath.read_text(encoding='utf-8')
    return "You are a helpful AI assistant."


@app.get("/prompts")
async def get_prompts():
    """Get all available prompts and active prompt."""
    global active_system_prompt
    return {
        "success": True,
        "prompts": list_prompts(),
        "active": active_system_prompt
    }


@app.get("/prompts/{prompt_name}")
async def get_prompt_content(prompt_name: str):
    """Get content of a specific prompt file."""
    prompts_dir = get_prompts_path()
    filepath = prompts_dir / f"{prompt_name}.txt"

    if not filepath.exists():
        return {"success": False, "error": f"Prompt not found: {prompt_name}"}

    try:
        content = filepath.read_text(encoding='utf-8')
        return {"success": True, "name": prompt_name, "content": content}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/prompts")
async def save_prompt(request: PromptUpdateRequest):
    """Save or update a prompt file."""
    prompts_dir = get_prompts_path()
    prompts_dir.mkdir(parents=True, exist_ok=True)

    filepath = prompts_dir / f"{request.name}.txt"

    try:
        filepath.write_text(request.content, encoding='utf-8')
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/prompts/active")
async def set_active_prompt(request: PromptSelectRequest):
    """Set the active system prompt."""
    global active_system_prompt

    available = list_prompts()
    if request.name not in available:
        return {"success": False, "error": f"Prompt not found: {request.name}"}

    active_system_prompt = request.name
    print(f"Active prompt set to: {active_system_prompt}")
    return {"success": True, "active": active_system_prompt}


# ============================================
# Cached Models Endpoint
# ============================================

@app.get("/cached_models")
async def get_cached_models():
    """Scan the HuggingFace cache directory and return list of downloaded models."""
    try:
        cache_path = Path(models_cache) if models_cache else None

        if not cache_path or not cache_path.exists():
            # Try default HuggingFace cache locations
            default_paths = [
                Path.home() / ".cache" / "huggingface" / "hub",
                Path.home() / ".cache" / "huggingface",
            ]
            for p in default_paths:
                if p.exists():
                    cache_path = p
                    break

        if not cache_path or not cache_path.exists():
            return {"success": False, "error": "Cache path does not exist", "models": []}

        print(f"Scanning cache at: {cache_path}")
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

        models.sort()
        print(f"Found {len(models)} cached models")
        return {"success": True, "models": models, "cache_path": str(cache_path)}

    except Exception as e:
        print(f"Error scanning cache: {e}")
        return {"success": False, "error": str(e), "models": []}


# ============================================
# Conversations Endpoints
# ============================================

@app.get("/conversations")
async def list_conversations():
    """List all saved conversations."""
    conv_dir = get_conversations_path()
    conv_dir.mkdir(parents=True, exist_ok=True)

    conversations = []
    for f in conv_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
            conversations.append({
                "id": f.stem,
                "name": data.get("name", f.stem),
                "createdAt": data.get("createdAt"),
                "messageCount": len(data.get("messages", []))
            })
        except Exception as e:
            print(f"Error reading conversation {f.stem}: {e}")

    # Sort by createdAt descending
    conversations.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return {"success": True, "conversations": conversations}


@app.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    """Get a specific conversation."""
    conv_dir = get_conversations_path()
    filepath = conv_dir / f"{conv_id}.json"

    if not filepath.exists():
        return {"success": False, "error": "Conversation not found"}

    try:
        data = json.loads(filepath.read_text(encoding='utf-8'))
        return {"success": True, "conversation": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/conversations")
async def save_conversation(data: Dict[str, Any]):
    """Save a conversation."""
    conv_dir = get_conversations_path()
    conv_dir.mkdir(parents=True, exist_ok=True)

    conv_id = data.get("id") or f"conv_{int(time.time())}"
    filepath = conv_dir / f"{conv_id}.json"

    try:
        filepath.write_text(json.dumps(data, indent=2), encoding='utf-8')
        print(f"Saved conversation: {conv_id}")
        return {"success": True, "id": conv_id}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    """Delete a conversation."""
    conv_dir = get_conversations_path()
    filepath = conv_dir / f"{conv_id}.json"

    if filepath.exists():
        filepath.unlink()
        print(f"Deleted conversation: {conv_id}")
        return {"success": True}
    return {"success": False, "error": "Conversation not found"}


@app.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server"""
    global model, tokenizer, model_ready, model_type

    print("Shutdown requested...")

    # Clean up model first
    if model is not None:
        try:
            print("Unloading model before shutdown...")
            if model_type == "transformers":
                model.to("cpu")
            del model
            model = None
            if tokenizer is not None:
                del tokenizer
                tokenizer = None
            model_ready = False
            clear_cuda()
        except Exception as e:
            print(f"Error during model cleanup: {e}")

    # Schedule shutdown after cleanup
    import asyncio
    import signal

    def force_shutdown():
        print("Forcing shutdown...")
        os.kill(os.getpid(), signal.SIGTERM)

    asyncio.get_event_loop().call_later(1.0, force_shutdown)
    return {"success": True, "message": "Server shutting down"}


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f"Starting Local LLM Chat server on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port)
