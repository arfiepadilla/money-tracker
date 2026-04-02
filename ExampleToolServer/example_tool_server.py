"""
Example Tool Server - Reference Implementation

This demonstrates how to use the tool_client SDK to register tools
with the central registry and handle tool execution requests.

Run this server to see how tools appear in the Tool Manager UI
and become available to other workflows.

Usage:
    python example_tool_server.py

Requires:
    pip install fastapi uvicorn httpx
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional
import uvicorn
import asyncio
import sys
import os

# Add _shared directory to path to import tool_client
shared_path = os.path.join(os.path.dirname(__file__), '..', '_shared')
sys.path.insert(0, shared_path)
from tool_client import ToolClient, create_tool_router

# ============================================
# Server Setup
# ============================================

app = FastAPI(title="Example Tool Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Server configuration
# Port can be passed as command-line argument, defaults to 8795
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8795
SERVER_NAME = "example_tools"

# Create tool client
tool_client = ToolClient(SERVER_NAME, port=PORT)


# ============================================
# Tool Handlers
# ============================================

async def greet_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Simple greeting tool."""
    name = args.get("name", "World")
    greeting = args.get("greeting", "Hello")
    return {
        "message": f"{greeting}, {name}!",
        "timestamp": asyncio.get_event_loop().time()
    }


async def calculate_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Simple calculator tool."""
    operation = args.get("operation", "add")
    a = args.get("a", 0)
    b = args.get("b", 0)

    if operation == "add":
        result = a + b
    elif operation == "subtract":
        result = a - b
    elif operation == "multiply":
        result = a * b
    elif operation == "divide":
        if b == 0:
            return {"success": False, "error": "Division by zero"}
        result = a / b
    else:
        return {"success": False, "error": f"Unknown operation: {operation}"}

    return {
        "operation": operation,
        "a": a,
        "b": b,
        "result": result
    }


def echo_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Echo tool (sync handler example)."""
    return {"echo": args.get("message", "")}


async def delay_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Async tool that demonstrates delayed response."""
    seconds = min(args.get("seconds", 1), 10)  # Cap at 10 seconds
    await asyncio.sleep(seconds)
    return {
        "delayed": seconds,
        "message": f"Waited {seconds} seconds"
    }


# ============================================
# Register Tools
# ============================================

# Register greeting tool
tool_client.register_tool(
    name="greet",
    namespace="example",
    description="Generate a personalized greeting",
    parameters={
        "properties": {
            "name": {
                "type": "string",
                "description": "Name to greet",
                "default": "World"
            },
            "greeting": {
                "type": "string",
                "description": "Greeting phrase",
                "default": "Hello"
            }
        },
        "required": []
    },
    handler=greet_handler
)

# Register calculator tool
tool_client.register_tool(
    name="calculate",
    namespace="example",
    description="Perform basic arithmetic operations",
    parameters={
        "properties": {
            "operation": {
                "type": "string",
                "enum": ["add", "subtract", "multiply", "divide"],
                "description": "Arithmetic operation to perform"
            },
            "a": {
                "type": "number",
                "description": "First operand"
            },
            "b": {
                "type": "number",
                "description": "Second operand"
            }
        },
        "required": ["operation", "a", "b"]
    },
    handler=calculate_handler
)

# Register echo tool (sync handler)
tool_client.register_tool(
    name="echo",
    namespace="example",
    description="Echo back the provided message",
    parameters={
        "properties": {
            "message": {
                "type": "string",
                "description": "Message to echo"
            }
        },
        "required": ["message"]
    },
    handler=echo_handler
)

# Register delay tool
tool_client.register_tool(
    name="delay",
    namespace="example",
    description="Wait for a specified number of seconds (async example)",
    parameters={
        "properties": {
            "seconds": {
                "type": "number",
                "description": "Seconds to wait (max 10)",
                "default": 1
            }
        },
        "required": []
    },
    handler=delay_handler
)


# ============================================
# API Routes
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


@app.get("/status")
async def status():
    """Health check endpoint."""
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


# ============================================
# Main
# ============================================

if __name__ == "__main__":
    print(f"""
================================================================
              Example Tool Server
----------------------------------------------------------------
  This server demonstrates the ContextUI tool registry.
  Port: {PORT}
  Tools registered:
    - example:greet     - Generate greetings
    - example:calculate - Basic arithmetic
    - example:echo      - Echo messages
    - example:delay     - Async delay example

  Open ContextUI's Tool Manager to see these tools.
  Other workflows can discover and use them via the registry.
================================================================
    """, flush=True)

    uvicorn.run(app, host="127.0.0.1", port=PORT)
