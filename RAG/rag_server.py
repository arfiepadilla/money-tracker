import os
import sys
import pickle
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from pydantic import BaseModel
from typing import List, Optional
import torch

# Types
class LoadModelRequest(BaseModel):
    model_name: str
    use_fp16: bool = False

class Document(BaseModel):
    name: str
    content: str

class IndexRequest(BaseModel):
    chunk_size: int = 200

class QueryRequest(BaseModel):
    query: str
    top_k: int = 3
    temperature: float = 0.7
    max_new_tokens: int = 256
    relevance_threshold: float = 0.35
    use_rag: bool = True  # 新增字段：控制是否使用 RAG

# Initialize FastAPI
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State
class RAGState:
    def __init__(self):
        self.embed_model = None
        self.embed_tokenizer = None
        self.embed_model_name = ""
        self.gen_model = None
        self.gen_tokenizer = None
        self.gen_model_name = ""

        self.documents = {} # name -> content
        self.chunks = [] # (text, doc_name)
        self.embeddings = None # numpy array

state = RAGState()

print(f"DEBUG: Python Executable: {sys.executable}")
print(f"DEBUG: Working Directory: {os.getcwd()}")
try:
    import fitz
    print(f"DEBUG: PyMuPDF (fitz) imported successfully. Version: {fitz.VersionBind}")
except ImportError as e:
    print(f"DEBUG: Failed to import PyMuPDF: {e}")

try:
    import pypdf
    print(f"DEBUG: pypdf imported successfully. Version: {pypdf.__version__}")
except ImportError as e:
    print(f"DEBUG: Failed to import pypdf: {e}")


def mean_pooling(model_output, attention_mask):
    """Mean pooling - take average of all tokens"""
    token_embeddings = model_output[0]  # First element is last_hidden_state
    input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(input_mask_expanded.sum(1), min=1e-9)


def encode_texts(texts: List[str]) -> np.ndarray:
    """Encode texts using the loaded embedding model"""
    device = get_device()
    all_embeddings = []

    # Process in batches to avoid OOM
    batch_size = 32
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i + batch_size]

        # Tokenize
        encoded = state.embed_tokenizer(
            batch_texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors='pt'
        )
        encoded = {k: v.to(device) for k, v in encoded.items()}

        # Get embeddings
        with torch.no_grad():
            model_output = state.embed_model(**encoded)
            embeddings = mean_pooling(model_output, encoded['attention_mask'])
            # Normalize
            embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
            all_embeddings.append(embeddings.cpu().numpy())

    return np.vstack(all_embeddings)


def extract_text_from_pdf_pypdf2(pdf_content: bytes) -> dict:
    """
    Extract text from PDF bytes using PyPDF2
    Returns dict with: success, text, error, method, page_count
    """
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
        
        # Convert bytes to file-like object
        pdf_file = BytesIO(pdf_content)
        
        # Read PDF
        reader = PdfReader(pdf_file)
        result["page_count"] = len(reader.pages)
        
        # Extract text from all pages
        text_parts = []
        empty_pages = 0
        
        for page_num, page in enumerate(reader.pages, 1):
            try:
                page_text = page.extract_text()
                
                if page_text and page_text.strip():
                    # Check if text looks valid
                    printable = sum(c.isprintable() or c.isspace() for c in page_text)
                    ratio = printable / len(page_text) if len(page_text) > 0 else 0
                    
                    if ratio > 0.8:  # At least 80% printable characters
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
    """
    Extract text from PDF bytes using pypdf (newer version)
    Returns dict with: success, text, error, method, page_count
    """
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
        
        # Convert bytes to file-like object
        pdf_file = BytesIO(pdf_content)
        
        # Read PDF
        reader = PdfReader(pdf_file)
        result["page_count"] = len(reader.pages)
        
        # Extract text from all pages
        text_parts = []
        empty_pages = 0
        
        for page_num, page in enumerate(reader.pages, 1):
            try:
                page_text = page.extract_text()
                
                if page_text and page_text.strip():
                    # Check if text looks valid
                    printable = sum(c.isprintable() or c.isspace() for c in page_text)
                    ratio = printable / len(page_text) if len(page_text) > 0 else 0
                    
                    if ratio > 0.8:  # At least 80% printable characters
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
    """
    Extract text from PDF bytes using PyMuPDF (fitz)
    Returns dict with: success, text, error, method, page_count
    """
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
        
        # Open PDF from bytes
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
    """
    Try multiple PDF libraries in order of preference
    """
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


# Utils
def get_device():
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"

def get_vram_info():
    if torch.cuda.is_available():
        try:
            total = torch.cuda.get_device_properties(0).total_memory
            reserved = torch.cuda.memory_reserved(0)
            allocated = torch.cuda.memory_allocated(0)
            free = total - reserved
            return {"total": total, "free": free, "used": reserved}
        except:
            return None
    return None

# Endpoints

@app.get("/")
def root():
    return {"status": "online", "service": "RAG Server with PDF Support (pypdf/PyPDF2)"}

@app.get("/status")
def status():
    return {
        "embed_loaded": state.embed_model is not None,
        "embed_loading": False,
        "embed_status": state.embed_model_name if state.embed_model else "Not loaded",
        "gen_loaded": state.gen_model is not None,
        "gen_loading": False,
        "gen_status": state.gen_model_name if state.gen_model else "Not loaded",
        "gen_model_name": state.gen_model_name,
        "documents_count": len(state.documents),
        "documents_indexed": state.embeddings is not None and len(state.chunks) > 0,
        "chunks_count": len(state.chunks),
        "chunk_size": 0,
        "top_k": 3,
        "device": get_device(),
        "cuda_available": torch.cuda.is_available(),
        "vram": get_vram_info()
    }

@app.post("/embed/load")
def load_embed_model(req: LoadModelRequest):
    try:
        from transformers import AutoModel, AutoTokenizer

        # Unload existing if any
        state.embed_model = None
        state.embed_tokenizer = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        print(f"Loading embedding model: {req.model_name}")
        device = get_device()

        state.embed_tokenizer = AutoTokenizer.from_pretrained(req.model_name, trust_remote_code=True)
        state.embed_model = AutoModel.from_pretrained(req.model_name, trust_remote_code=True)
        state.embed_model.to(device)
        state.embed_model.eval()
        state.embed_model_name = req.model_name

        return {"success": True, "device": device}
    except Exception as e:
        print(f"Error loading embed model: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/embed/unload")
def unload_embed(req: dict = None):
    state.embed_model = None
    state.embed_tokenizer = None
    state.embed_model_name = ""
    state.embeddings = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return {"success": True}

@app.post("/gen/load")
def load_gen_model(req: LoadModelRequest):
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        
        # Unload existing
        state.gen_model = None
        state.gen_tokenizer = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            
        print(f"Loading generation model: {req.model_name}")
        device = get_device()
        torch_dtype = torch.float16 if req.use_fp16 and device == "cuda" else torch.float32
        
        state.gen_tokenizer = AutoTokenizer.from_pretrained(req.model_name, trust_remote_code=True)
        state.gen_model = AutoModelForCausalLM.from_pretrained(
            req.model_name, 
            torch_dtype=torch_dtype,
            device_map="auto" if device == "cuda" else None,
            trust_remote_code=True
        )
        
        if device == "cpu":
            state.gen_model.to("cpu")
            
        state.gen_model_name = req.model_name
        return {"success": True, "model_name": req.model_name}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/gen/unload")
def unload_gen(req: dict = None):
    state.gen_model = None
    state.gen_tokenizer = None
    state.gen_model_name = ""
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return {"success": True}

@app.get("/documents")
def list_documents():
    docs = []
    for name, content in state.documents.items():
        docs.append({
            "name": name,
            "char_count": len(content),
            "indexed": state.embeddings is not None and len(state.chunks) > 0
        })
    return {"documents": docs}

@app.post("/documents/add")
def add_document(doc: Document):
    state.documents[doc.name] = doc.content
    # Invalidate index
    state.embeddings = None
    state.chunks = []
    return {"success": True}

@app.post("/documents/add-pdf")
def add_pdf_document(request: dict):
    """
    Add a PDF document by providing base64 encoded PDF data
    Expected format: {"name": "filename.pdf", "pdf_base64": "base64_string"}
    """
    try:
        import base64
        
        name = request.get("name")
        pdf_base64 = request.get("pdf_base64")
        
        if not name or not pdf_base64:
            return {"success": False, "error": "Missing 'name' or 'pdf_base64' in request"}
        
        # Decode base64 to bytes
        try:
            pdf_bytes = base64.b64decode(pdf_base64)
        except Exception as e:
            return {"success": False, "error": f"Invalid base64 encoding: {str(e)}"}
        
        # Extract text from PDF
        print(f"Extracting text from PDF: {name} ({len(pdf_bytes)} bytes)")
        extraction_result = extract_text_from_pdf(pdf_bytes)
        
        if not extraction_result["success"]:
            return {
                "success": False, 
                "error": extraction_result["error"],
                "warnings": extraction_result.get("warnings", []),
                "page_count": extraction_result.get("page_count", 0)
            }
        
        text_content = extraction_result["text"]
        
        if not text_content or not text_content.strip():
            return {
                "success": False, 
                "error": "No text could be extracted from the PDF.",
                "warnings": extraction_result.get("warnings", []),
                "page_count": extraction_result.get("page_count", 0)
            }
        
        # Store the extracted text
        state.documents[name] = text_content
        
        # Invalidate index
        state.embeddings = None
        state.chunks = []
        
        print(f"Successfully extracted {len(text_content)} characters from {name} using {extraction_result['method']}")
        return {
            "success": True,
            "char_count": len(text_content),
            "page_count": extraction_result["page_count"],
            "method": extraction_result["method"],
            "warnings": extraction_result.get("warnings", []),
            "message": f"Extracted {len(text_content)} characters from {extraction_result['page_count']} pages using {extraction_result['method']}"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.delete("/documents/{name}")
def remove_document(name: str):
    if name in state.documents:
        del state.documents[name]
        state.embeddings = None
        state.chunks = []
        return {"success": True}
    return {"success": False, "error": "Document not found"}

@app.post("/documents/clear")
def clear_documents():
    state.documents = {}
    state.chunks = []
    state.embeddings = None
    return {"success": True}

@app.post("/documents/index")
def index_documents(req: IndexRequest):
    if not state.documents:
        return {"success": False, "error": "No documents to index"}
    if not state.embed_model:
        return {"success": False, "error": "Embedding model not loaded"}
        
    try:
        # Simple chunking
        chunks = []
        for name, content in state.documents.items():
            # Split by chunks (approx)
            words = content.split()
            current_chunk = []
            current_len = 0
            
            for word in words:
                current_chunk.append(word)
                current_len += len(word) + 1
                
                if current_len >= req.chunk_size:
                    chunks.append((" ".join(current_chunk), name))
                    current_chunk = []
                    current_len = 0
            
            if current_chunk:
                chunks.append((" ".join(current_chunk), name))
        
        state.chunks = chunks

        # Embed using our encode_texts function
        texts = [c[0] for c in chunks]
        print(f"Encoding {len(texts)} chunks...")
        state.embeddings = encode_texts(texts)
        
        return {
            "success": True, 
            "documents_count": len(state.documents),
            "chunks_count": len(chunks)
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/documents/unindex")
def unindex_documents():
    state.chunks = []
    state.embeddings = None
    return {"success": True}

@app.post("/query")
def query_rag(req: QueryRequest):
    if not state.gen_model or not state.gen_tokenizer:
        return {"success": False, "error": "Generation model not loaded"}
    
    # Retrieval logic
    retrieved_context = ""
    retrieved_chunks_info = []
    
    # Check if RAG is requested AND possible (embeddings exist)
    should_do_rag = req.use_rag and state.embeddings is not None and len(state.chunks) > 0 and state.embed_model
    
    if should_do_rag:
        try:
            # Embed query using our encode_texts function
            query_emb = encode_texts([req.query])[0]

            # Compute similarities using numpy (cosine similarity)
            # Since embeddings are already normalized, just use dot product
            sims = np.dot(state.embeddings, query_emb)
            
            # Get top k
            top_indices = np.argsort(sims)[-req.top_k:][::-1]
            
            context_parts = []
            for idx in top_indices:
                # Check threshold if desired
                if sims[idx] < req.relevance_threshold and req.relevance_threshold > 0:
                     continue

                chunk_text, doc_name = state.chunks[idx]
                context_parts.append(chunk_text)
                retrieved_chunks_info.append(f"[{doc_name}] ...{chunk_text[:50]}...")
            
            retrieved_context = "\n\n".join(context_parts)
        except Exception as e:
            print(f"Retrieval error (falling back to LLM-only): {e}")
            # Fallback to empty context if retrieval fails
            retrieved_context = ""

    # Generation
    try:
        # Construct Prompt based on Mode
        if retrieved_context:
            # RAG Prompt
            system_prompt = "You are a helpful assistant. Answer the user's question based on the context provided below. If the answer is not in the context, you may use your own knowledge but mention that it is not from the documents."
            user_content = f"Context:\n{retrieved_context}\n\nQuestion: {req.query}"
        else:
            # LLM Chat Prompt (No context)
            if should_do_rag and not retrieved_context:
                # Wanted RAG but nothing found
                system_prompt = "You are a helpful assistant. The user asked a question about documents, but no relevant information was found. Answer to the best of your ability."
                user_content = req.query
            else:
                # Pure LLM Chat
                system_prompt = "You are a helpful, intelligent assistant. Engage in a conversation with the user."
                user_content = req.query
            
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ]
        
        text = state.gen_tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True
        )
        
        model_inputs = state.gen_tokenizer([text], return_tensors="pt").to(state.gen_model.device)
        
        generated_ids = state.gen_model.generate(
            model_inputs.input_ids,
            max_new_tokens=req.max_new_tokens,
            temperature=req.temperature,
            do_sample=True
        )
        
        generated_ids = [
            output_ids[len(input_ids):] for input_ids, output_ids in zip(model_inputs.input_ids, generated_ids)
        ]
        
        response = state.gen_tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0]
        
        return {
            "success": True,
            "response": response,
            "retrieved_chunks": retrieved_chunks_info,
            "generation_time": 0.0
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/chat/clear")
def clear_chat():
    return {"success": True}

@app.get("/debug_info")
def debug_info():
    import sys
    import importlib.util
    
    debug_data = {
        "executable": sys.executable,
        "cwd": os.getcwd(),
        "packages": {}
    }
    
    # Check key packages
    for pkg in ["fitz", "pymupdf", "pypdf", "PyPDF2"]:
        try:
            spec = importlib.util.find_spec(pkg)
            debug_data["packages"][pkg] = str(spec.origin) if spec else "Not found"
        except Exception as e:
            debug_data["packages"][pkg] = f"Error: {e}"
            
    return debug_data

@app.get("/shutdown")
def shutdown():
    os.kill(os.getpid(), 9)
    return {"success": True}

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("port", type=int, default=8000)
    args = parser.parse_args()
    
    uvicorn.run(app, host="127.0.0.1", port=args.port)