"""
Tool Client SDK for Python Workflows

Drop-in SDK for Python agents to:
- Register tools with the central registry
- Discover tools from other workflows
- Execute tools across workflows
- Handle tool call requests

Usage:
    from tool_client import ToolClient

    tool_client = ToolClient("my_server", port=8795)

    # Register a tool
    tool_client.register_tool(
        name="my_tool",
        namespace="my_namespace",
        description="Does something useful",
        parameters={"properties": {"input": {"type": "string"}}},
        handler=my_handler_function
    )

    # On FastAPI startup
    @app.on_event("startup")
    async def startup():
        await tool_client.publish_tools_to_registry()

    # Add tool execution endpoint
    @app.post("/tools/{tool_name}/execute")
    async def execute_tool(tool_name: str, request: dict):
        return await tool_client.handle_tool_call(tool_name, request.get("arguments", {}))
"""

import json
import asyncio
from typing import Dict, Any, List, Optional, Callable, Union
from dataclasses import dataclass, field
from enum import Enum

try:
    import httpx
except ImportError:
    httpx = None  # Will raise helpful error if used without httpx


# ============================================
# Data Classes
# ============================================

@dataclass
class ToolParameter:
    """JSON Schema compatible parameter definition."""
    type: str  # string, number, integer, boolean, object, array
    description: str = ""
    default: Any = None
    enum: List[str] = field(default_factory=list)
    required: bool = False


@dataclass
class ToolDefinition:
    """Tool definition matching MCP schema."""
    name: str
    namespace: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema format
    version: str = "1.0.0"

    def to_registry_format(self) -> Dict[str, Any]:
        """Convert to format expected by central registry."""
        return {
            "name": self.name,
            "namespace": self.namespace,
            "version": self.version,
            "description": self.description,
            "inputSchema": {
                "type": "object",
                "properties": self.parameters.get("properties", {}),
                "required": self.parameters.get("required", []),
            }
        }


@dataclass
class ToolResult:
    """Result from tool execution."""
    success: bool
    data: Any = None
    error: str = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        result = {"success": self.success}
        if self.data is not None:
            result["data"] = self.data
        if self.error:
            result["error"] = self.error
        if self.metadata:
            result["metadata"] = self.metadata
        return result


# ============================================
# Tool Client
# ============================================

class ToolClient:
    """
    Client for registering and executing tools with the central registry.

    Args:
        server_name: Unique identifier for this server
        port: Port this server is running on
        registry_url: URL of the central tool registry (default: http://127.0.0.1:8800)
    """

    def __init__(
        self,
        server_name: str,
        port: int,
        registry_url: str = "http://127.0.0.1:8800"
    ):
        self.server_name = server_name
        self.port = port
        self.registry_url = registry_url
        self.base_url = f"http://127.0.0.1:{port}"
        self.registered_tools: Dict[str, Dict[str, Any]] = {}
        self._http_client: Optional[httpx.AsyncClient] = None

    # ============================================
    # Context Manager
    # ============================================

    async def __aenter__(self):
        if httpx is None:
            raise ImportError("httpx is required for ToolClient. Install with: pip install httpx")
        self._http_client = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, *args):
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    def _ensure_client(self):
        if not self._http_client:
            raise RuntimeError(
                "ToolClient not initialized. Use 'async with tool_client:' context manager "
                "or call 'await tool_client.connect()'"
            )

    async def connect(self):
        """Manually connect (alternative to context manager)."""
        if httpx is None:
            raise ImportError("httpx is required for ToolClient. Install with: pip install httpx")
        if not self._http_client:
            self._http_client = httpx.AsyncClient(timeout=30.0)

    async def disconnect(self):
        """Manually disconnect."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    # ============================================
    # Tool Registration
    # ============================================

    def register_tool(
        self,
        name: str,
        namespace: str,
        description: str,
        parameters: Dict[str, Any],
        handler: Callable,
        version: str = "1.0.0"
    ) -> None:
        """
        Register a tool that this server provides.

        Args:
            name: Tool name (unique within namespace)
            namespace: Tool category (e.g., "screen", "vision")
            description: Human-readable description
            parameters: JSON Schema format parameters
            handler: Async or sync function to handle tool calls
            version: Semantic version string

        Example:
            tool_client.register_tool(
                name="capture_screen",
                namespace="screen",
                description="Capture a screenshot",
                parameters={
                    "properties": {
                        "monitor": {"type": "integer", "default": 1}
                    },
                    "required": []
                },
                handler=capture_screen_handler
            )
        """
        tool_def = ToolDefinition(
            name=name,
            namespace=namespace,
            description=description,
            parameters=parameters,
            version=version
        )

        self.registered_tools[name] = {
            "definition": tool_def,
            "handler": handler
        }

        print(f"[ToolClient] Registered tool: {namespace}:{name}")

    def register_tools(self, tools: List[Dict[str, Any]]) -> None:
        """
        Register multiple tools at once.

        Args:
            tools: List of tool configs with keys:
                   name, namespace, description, parameters, handler, version (optional)
        """
        for tool in tools:
            self.register_tool(
                name=tool["name"],
                namespace=tool["namespace"],
                description=tool["description"],
                parameters=tool["parameters"],
                handler=tool["handler"],
                version=tool.get("version", "1.0.0")
            )

    # ============================================
    # Publishing to Registry
    # ============================================

    async def publish_tools_to_registry(self) -> bool:
        """
        Publish all registered tools to the central registry.

        Should be called on server startup.

        Returns:
            True if successful, False otherwise
        """
        self._ensure_client()

        if not self.registered_tools:
            print("[ToolClient] No tools registered to publish")
            return True

        tools = [
            t["definition"].to_registry_format()
            for t in self.registered_tools.values()
        ]

        try:
            response = await self._http_client.post(
                f"{self.registry_url}/tools/register",
                json={
                    "serverName": self.server_name,
                    "baseUrl": self.base_url,
                    "tools": tools
                }
            )

            if response.status_code == 200:
                data = response.json()
                print(f"[ToolClient] Published {data.get('registered', 0)} tools to registry")
                return True
            else:
                print(f"[ToolClient] Failed to publish tools: HTTP {response.status_code}")
                return False

        except httpx.ConnectError:
            print(f"[ToolClient] Registry not available at {self.registry_url}")
            return False
        except Exception as e:
            print(f"[ToolClient] Error publishing tools: {e}")
            return False

    async def unregister_from_registry(self) -> bool:
        """
        Unregister all tools from this server.

        Should be called on server shutdown.
        """
        self._ensure_client()

        try:
            response = await self._http_client.post(
                f"{self.registry_url}/tools/unregister",
                json={"serverName": self.server_name}
            )
            return response.status_code == 200
        except:
            return False

    # ============================================
    # Tool Discovery
    # ============================================

    async def discover_tools(
        self,
        namespace: Optional[str] = None,
        enabled_only: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Discover available tools from the registry.

        Args:
            namespace: Filter by namespace (optional)
            enabled_only: Only return enabled tools

        Returns:
            List of tool definitions
        """
        self._ensure_client()

        try:
            params = {}
            if namespace:
                params["namespace"] = namespace
            if enabled_only:
                params["enabledOnly"] = "true"

            response = await self._http_client.get(
                f"{self.registry_url}/tools",
                params=params
            )

            if response.status_code == 200:
                data = response.json()
                return data.get("tools", [])
            return []

        except Exception as e:
            print(f"[ToolClient] Error discovering tools: {e}")
            return []

    async def get_namespaces(self) -> List[str]:
        """Get list of available tool namespaces."""
        self._ensure_client()

        try:
            response = await self._http_client.get(f"{self.registry_url}/tools")
            if response.status_code == 200:
                return response.json().get("namespaces", [])
            return []
        except:
            return []

    # ============================================
    # Tool Execution (calling other workflows)
    # ============================================

    async def execute_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        namespace: Optional[str] = None
    ) -> ToolResult:
        """
        Execute a tool from another workflow.

        Args:
            tool_name: Name of the tool to execute
            arguments: Tool arguments
            namespace: Tool namespace (optional, helps with disambiguation)

        Returns:
            ToolResult with success status and data/error
        """
        self._ensure_client()

        try:
            response = await self._http_client.post(
                f"{self.registry_url}/tools/execute",
                json={
                    "toolName": tool_name,
                    "namespace": namespace,
                    "arguments": arguments
                }
            )

            data = response.json()
            return ToolResult(
                success=data.get("success", False),
                data=data.get("data"),
                error=data.get("error"),
                metadata=data.get("metadata", {})
            )

        except httpx.ConnectError:
            return ToolResult(
                success=False,
                error="Registry not available"
            )
        except Exception as e:
            return ToolResult(
                success=False,
                error=str(e)
            )

    # ============================================
    # Handling Incoming Tool Calls
    # ============================================

    async def handle_tool_call(
        self,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Handle an incoming tool execution request.

        Use this in your FastAPI endpoint:
            @app.post("/tools/{tool_name}/execute")
            async def execute_tool(tool_name: str, request: dict):
                return await tool_client.handle_tool_call(tool_name, request.get("arguments", {}))

        Args:
            tool_name: Name of the tool to execute
            arguments: Tool arguments

        Returns:
            Dict with success, data/error, and metadata
        """
        tool_entry = self.registered_tools.get(tool_name)

        if not tool_entry:
            return ToolResult(
                success=False,
                error=f"Unknown tool: {tool_name}"
            ).to_dict()

        handler = tool_entry["handler"]

        try:
            # Handle both async and sync handlers
            if asyncio.iscoroutinefunction(handler):
                result = await handler(arguments)
            else:
                result = handler(arguments)

            # Normalize result
            if isinstance(result, ToolResult):
                return result.to_dict()
            elif isinstance(result, dict):
                if "success" in result:
                    return result
                return {"success": True, "data": result}
            else:
                return {"success": True, "data": result}

        except Exception as e:
            return ToolResult(
                success=False,
                error=str(e)
            ).to_dict()

    # ============================================
    # Utility Methods
    # ============================================

    def get_registered_tools(self) -> List[Dict[str, Any]]:
        """Get list of tools registered with this client."""
        return [
            t["definition"].to_registry_format()
            for t in self.registered_tools.values()
        ]

    def get_tool_handler(self, tool_name: str) -> Optional[Callable]:
        """Get the handler function for a registered tool."""
        entry = self.registered_tools.get(tool_name)
        return entry["handler"] if entry else None


# ============================================
# FastAPI Integration Helper
# ============================================

def create_tool_router(tool_client: ToolClient):
    """
    Create a FastAPI router with tool endpoints.

    Usage:
        from fastapi import FastAPI
        from tool_client import ToolClient, create_tool_router

        app = FastAPI()
        tool_client = ToolClient("my_server", port=8795)

        # Register tools...

        app.include_router(create_tool_router(tool_client))

    Returns:
        FastAPI APIRouter with /tools endpoints
    """
    try:
        from fastapi import APIRouter
        from pydantic import BaseModel
    except ImportError:
        raise ImportError("FastAPI and Pydantic required. Install with: pip install fastapi pydantic")

    router = APIRouter(prefix="/tools", tags=["tools"])

    class ExecuteRequest(BaseModel):
        arguments: Dict[str, Any] = {}

    @router.get("")
    async def list_tools():
        """List all tools provided by this server."""
        return {
            "success": True,
            "tools": tool_client.get_registered_tools()
        }

    @router.post("/{tool_name}/execute")
    async def execute_tool(tool_name: str, request: ExecuteRequest):
        """Execute a tool by name."""
        return await tool_client.handle_tool_call(tool_name, request.arguments)

    return router


# ============================================
# Standalone execution for testing
# ============================================

if __name__ == "__main__":
    import asyncio

    async def test():
        # Example: Create client and discover tools
        client = ToolClient("test_client", port=9999)

        async with client:
            # Discover all tools
            tools = await client.discover_tools()
            print(f"Found {len(tools)} tools:")
            for tool in tools:
                print(f"  - {tool['namespace']}:{tool['name']}: {tool['description']}")

            # Get namespaces
            namespaces = await client.get_namespaces()
            print(f"\nNamespaces: {namespaces}")

    asyncio.run(test())
