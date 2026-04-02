"""
Text Transposer Server

Provides text transposition functionality - converts text arranged in rows
and columns into a transposed format (rows become columns, columns become rows).

Run this server to make transposition tools available to other workflows.

Usage:
    python text_transposer_server.py

Requires:
    pip install fastapi uvicorn httpx
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, List
import uvicorn
import sys
import os

# Add _shared directory to path to import tool_client
shared_path = os.path.join(os.path.dirname(__file__), '..', '_shared')
sys.path.insert(0, shared_path)
from tool_client import ToolClient, create_tool_router

# ============================================
# Server Setup
# ============================================

app = FastAPI(title="Text Transposer Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Server configuration
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8796
SERVER_NAME = "text_transposer"

# Create tool client
tool_client = ToolClient(SERVER_NAME, port=PORT)

# ============================================
# Tool Implementations
# ============================================

def transpose_text(text: str, delimiter: str = "\n") -> str:
    """
    Transpose text by treating each line as a row.
    
    Example:
        Input:  "ABC\nDEF"
        Output: "AD\nBE\nCF"
    """
    lines = text.strip().split(delimiter)
    if not lines or not lines[0]:
        return ""
    
    # Find the maximum length
    max_len = max(len(line) for line in lines) if lines else 0
    
    # Pad lines to same length
    padded_lines = [line.ljust(max_len) for line in lines]
    
    # Transpose
    transposed = []
    for col_idx in range(max_len):
        column = "".join(line[col_idx] for line in padded_lines)
        transposed.append(column)
    
    return "\n".join(transposed)


def transpose_words(text: str) -> str:
    """
    Transpose text by treating each word as a column.
    
    Example:
        Input:  "hello world"
        Output: "h w\ne o\nl r\nl l\no d"
    """
    words = text.split()
    if not words:
        return ""
    
    max_len = max(len(word) for word in words)
    padded_words = [word.ljust(max_len) for word in words]
    
    transposed = []
    for char_idx in range(max_len):
        row = " ".join(word[char_idx] for word in padded_words)
        transposed.append(row)
    
    return "\n".join(transposed)


# ============================================
# Tool Handlers
# ============================================

async def transpose_lines_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handle text transposition by lines"""
    try:
        text = args.get("text", "")
        if not text:
            return {"success": False, "error": "No text provided"}
        result = transpose_text(text)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def transpose_words_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handle text transposition by words"""
    try:
        text = args.get("text", "")
        if not text:
            return {"success": False, "error": "No text provided"}
        result = transpose_words(text)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# Register Tools
# ============================================

tool_client.register_tool(
    name="transpose_by_lines",
    namespace="text",
    description="Transpose text by treating each line as a row. Converts rows to columns and columns to rows.",
    parameters={
        "properties": {
            "text": {
                "type": "string",
                "description": "The text to transpose"
            }
        },
        "required": ["text"]
    },
    handler=transpose_lines_handler
)

tool_client.register_tool(
    name="transpose_by_words",
    namespace="text",
    description="Transpose text by treating each word as a column.",
    parameters={
        "properties": {
            "text": {
                "type": "string",
                "description": "The text to transpose (space-separated words)"
            }
        },
        "required": ["text"]
    },
    handler=transpose_words_handler
)


# ============================================
# Routes
# ============================================

# Add tool routes from SDK (provides /tools and /tools/{name}/execute)
app.include_router(create_tool_router(tool_client))


@app.get("/")
async def root():
    """Server info."""
    return {
        "server": SERVER_NAME,
        "port": PORT,
        "tools": tool_client.get_registered_tools(),
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "server": SERVER_NAME}


# ============================================
# Startup / Shutdown
# ============================================

@app.on_event("startup")
async def startup():
    """Register tools with central registry on startup."""
    print(f"[{SERVER_NAME}] Starting server on port {PORT}...", flush=True)

    # Connect to registry and publish tools
    await tool_client.connect()
    success = await tool_client.publish_tools_to_registry()

    if success:
        print(f"[{SERVER_NAME}] Tools registered with central registry", flush=True)
    else:
        print(f"[{SERVER_NAME}] Warning: Could not register with registry (is ContextUI running?)", flush=True)


@app.on_event("shutdown")
async def shutdown():
    """Unregister tools on shutdown."""
    print(f"[{SERVER_NAME}] Shutting down...", flush=True)
    await tool_client.unregister_from_registry()
    await tool_client.disconnect()


if __name__ == "__main__":
    print(f"Starting {SERVER_NAME} on port {PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT)
