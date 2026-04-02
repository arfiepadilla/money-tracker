"""
Service Connectors for Voice Agent

This module provides integration with existing ContextUI workflows/services.
Each connector knows how to communicate with its respective service and
provides a unified interface for the Voice Agent.
"""

import aiohttp
import asyncio
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from enum import Enum
import json
import base64


class ServiceStatus(str, Enum):
    UNKNOWN = "unknown"
    AVAILABLE = "available"
    BUSY = "busy"
    UNAVAILABLE = "unavailable"


@dataclass
class ServiceResponse:
    """Unified response from any service."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    service_name: str = ""


class BaseServiceConnector:
    """Base class for service connectors."""

    def __init__(self, name: str, base_url: str, port: int):
        self.name = name
        self.base_url = base_url
        self.port = port
        self.status = ServiceStatus.UNKNOWN
        self.last_error: Optional[str] = None

    @property
    def url(self) -> str:
        return f"{self.base_url}:{self.port}"

    async def check_health(self) -> bool:
        """Check if the service is available."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.url}/health", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        self.status = ServiceStatus.AVAILABLE
                        return True
        except Exception as e:
            self.last_error = str(e)
            self.status = ServiceStatus.UNAVAILABLE
        return False

    async def get_status(self) -> Dict[str, Any]:
        """Get detailed status from the service."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.url}/status") as resp:
                    if resp.status == 200:
                        return await resp.json()
        except Exception as e:
            self.last_error = str(e)
        return {"error": self.last_error}


class MusicGenConnector(BaseServiceConnector):
    """
    Connector for MusicGen service.
    Handles music generation requests.
    """

    def __init__(self, port: int = 8765):
        super().__init__("musicgen", "http://127.0.0.1", port)
        self.capabilities = [
            "generate",           # Generate music from prompt
            "generate_extended",  # Generate longer tracks
            "save_audio",        # Save generated audio
        ]

    async def generate(
        self,
        prompt: str,
        duration: int = 10,
        temperature: float = 1.0,
        top_k: int = 250,
        guidance_scale: float = 3.0
    ) -> ServiceResponse:
        """Generate music from a text prompt."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/generate",
                    json={
                        "prompt": prompt,
                        "duration": duration,
                        "temperature": temperature,
                        "top_k": top_k,
                        "guidance_scale": guidance_scale,
                    }
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)

    async def generate_extended(
        self,
        prompt: str,
        target_duration: int = 60,
        context_seconds: int = 10,
        segment_duration: int = 20,
        **kwargs
    ) -> ServiceResponse:
        """Generate longer music tracks."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/generate_extended",
                    json={
                        "prompt": prompt,
                        "target_duration": target_duration,
                        "context_seconds": context_seconds,
                        "segment_duration": segment_duration,
                        **kwargs
                    }
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)

    async def save_audio(self, filename: str, output_dir: str = "music_output") -> ServiceResponse:
        """Save the last generated audio."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/save_audio",
                    params={"filename": filename, "output_dir": output_dir}
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)


class LocalChatConnector(BaseServiceConnector):
    """
    Connector for LocalChat service.
    Handles LLM chat interactions.
    """

    def __init__(self, port: int = 8766):
        super().__init__("localchat", "http://127.0.0.1", port)
        self.capabilities = [
            "chat",
            "chat_stream",
            "load_model",
            "unload_model",
            "clear_history",
        ]

    async def chat(
        self,
        message: str,
        temperature: float = 0.7,
        max_new_tokens: int = 512,
        system_prompt: Optional[str] = None,
        use_history: bool = True
    ) -> ServiceResponse:
        """Send a chat message."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/chat",
                    json={
                        "message": message,
                        "temperature": temperature,
                        "max_new_tokens": max_new_tokens,
                        "system_prompt": system_prompt,
                        "use_history": use_history,
                    }
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)

    async def clear_history(self) -> ServiceResponse:
        """Clear chat history."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{self.url}/clear_history") as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)


class SDXLConnector(BaseServiceConnector):
    """
    Connector for SDXL image generation service.
    """

    def __init__(self, port: int = 8767):
        super().__init__("sdxl", "http://127.0.0.1", port)
        self.capabilities = [
            "generate",
            "img2img",
            "save_image",
        ]

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        num_inference_steps: int = 30,
        guidance_scale: float = 7.5,
    ) -> ServiceResponse:
        """Generate an image from a text prompt."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/generate",
                    json={
                        "prompt": prompt,
                        "negative_prompt": negative_prompt,
                        "width": width,
                        "height": height,
                        "num_inference_steps": num_inference_steps,
                        "guidance_scale": guidance_scale,
                    }
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)


class WorkflowAgentConnector(BaseServiceConnector):
    """
    Connector for Workflow Agent service.
    Handles workflow creation and management.
    """

    def __init__(self, port: int = 8770):
        super().__init__("workflow_agent", "http://127.0.0.1", port)
        self.capabilities = [
            "agent",
            "agent_stream",
            "create_workflow",
            "list_workflows",
            "read_workflow",
            "update_workflow",
            "delete_workflow",
        ]

    async def create_workflow(self, name: str, code: str, folder: str = "") -> ServiceResponse:
        """Create a new workflow."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/execute_tool",
                    params={"tool_name": "create_workflow"},
                    json={"name": name, "code": code, "folder": folder}
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)

    async def list_workflows(self) -> ServiceResponse:
        """List all workflows."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/execute_tool",
                    params={"tool_name": "list_workflows"},
                    json={}
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)


class RAGConnector(BaseServiceConnector):
    """
    Connector for RAG (Retrieval Augmented Generation) service.
    """

    def __init__(self, port: int = 8771):
        super().__init__("rag", "http://127.0.0.1", port)
        self.capabilities = [
            "search",
            "add_document",
            "query",
        ]

    async def search(self, query: str, top_k: int = 5) -> ServiceResponse:
        """Search for relevant documents."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/search",
                    json={"query": query, "top_k": top_k}
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)

    async def query(self, question: str, context_docs: int = 3) -> ServiceResponse:
        """Query with RAG."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/query",
                    json={"question": question, "context_docs": context_docs}
                ) as resp:
                    data = await resp.json()
                    return ServiceResponse(
                        success=data.get("success", False),
                        data=data,
                        service_name=self.name
                    )
        except Exception as e:
            return ServiceResponse(success=False, error=str(e), service_name=self.name)


class ServiceRegistry:
    """
    Central registry for all service connectors.
    Manages service discovery and health monitoring.
    """

    def __init__(self):
        self.connectors: Dict[str, BaseServiceConnector] = {}
        self._default_connectors = {
            "musicgen": MusicGenConnector,
            "localchat": LocalChatConnector,
            "sdxl": SDXLConnector,
            "workflow_agent": WorkflowAgentConnector,
            "rag": RAGConnector,
        }

    def register(self, name: str, connector: BaseServiceConnector):
        """Register a service connector."""
        self.connectors[name] = connector

    def register_default(self, name: str, port: Optional[int] = None):
        """Register a default connector by name."""
        if name in self._default_connectors:
            connector_class = self._default_connectors[name]
            if port:
                connector = connector_class(port=port)
            else:
                connector = connector_class()
            self.register(name, connector)
            return True
        return False

    def get(self, name: str) -> Optional[BaseServiceConnector]:
        """Get a connector by name."""
        return self.connectors.get(name)

    def unregister(self, name: str):
        """Unregister a service."""
        if name in self.connectors:
            del self.connectors[name]

    async def check_all_health(self) -> Dict[str, bool]:
        """Check health of all registered services."""
        results = {}
        for name, connector in self.connectors.items():
            results[name] = await connector.check_health()
        return results

    def list_services(self) -> List[Dict[str, Any]]:
        """List all registered services."""
        services = []
        for name, connector in self.connectors.items():
            services.append({
                "name": name,
                "url": connector.url,
                "status": connector.status.value,
                "capabilities": getattr(connector, "capabilities", []),
                "last_error": connector.last_error,
            })
        return services

    async def discover_services(self, ports_to_check: List[int] = None):
        """
        Discover services running on common ports.
        """
        if ports_to_check is None:
            ports_to_check = [8765, 8766, 8767, 8768, 8769, 8770, 8771]

        for port in ports_to_check:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"http://127.0.0.1:{port}/",
                        timeout=aiohttp.ClientTimeout(total=2)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            service_name = data.get("service", "").lower()

                            # Try to identify and register the service
                            if "musicgen" in service_name:
                                self.register_default("musicgen", port)
                            elif "chat" in service_name or "llm" in service_name:
                                self.register_default("localchat", port)
                            elif "sdxl" in service_name or "image" in service_name:
                                self.register_default("sdxl", port)
                            elif "workflow" in service_name or "agent" in service_name:
                                self.register_default("workflow_agent", port)
                            elif "rag" in service_name:
                                self.register_default("rag", port)
            except Exception:
                pass


# Global registry instance
service_registry = ServiceRegistry()


# Convenience functions for the Voice Agent

async def call_service(service_name: str, method: str, **kwargs) -> ServiceResponse:
    """
    Universal service calling function.

    Args:
        service_name: Name of the service to call
        method: Method/action to invoke
        **kwargs: Arguments to pass to the method

    Returns:
        ServiceResponse with result or error
    """
    connector = service_registry.get(service_name)
    if not connector:
        return ServiceResponse(
            success=False,
            error=f"Service '{service_name}' not registered",
            service_name=service_name
        )

    # Check if connector has the method
    if not hasattr(connector, method):
        return ServiceResponse(
            success=False,
            error=f"Service '{service_name}' does not have method '{method}'",
            service_name=service_name
        )

    # Call the method
    try:
        method_func = getattr(connector, method)
        result = await method_func(**kwargs)
        return result
    except Exception as e:
        return ServiceResponse(
            success=False,
            error=str(e),
            service_name=service_name
        )


async def generate_music(prompt: str, duration: int = 10, **kwargs) -> ServiceResponse:
    """Convenience function to generate music."""
    return await call_service("musicgen", "generate", prompt=prompt, duration=duration, **kwargs)


async def generate_image(prompt: str, **kwargs) -> ServiceResponse:
    """Convenience function to generate an image."""
    return await call_service("sdxl", "generate", prompt=prompt, **kwargs)


async def chat_with_llm(message: str, **kwargs) -> ServiceResponse:
    """Convenience function to chat with the local LLM."""
    return await call_service("localchat", "chat", message=message, **kwargs)


async def search_documents(query: str, **kwargs) -> ServiceResponse:
    """Convenience function to search documents via RAG."""
    return await call_service("rag", "search", query=query, **kwargs)
