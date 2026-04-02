"""
Shared Python SDK for ContextUI Workflows

This package provides:
- tool_client: SDK for registering and executing tools with the central registry
- tool_formatters: Adapters for different local model tool-calling formats

Example usage:
    from _shared.tool_client import ToolClient, create_tool_router
    from _shared.tool_formatters import ToolFormatter, ModelFormat

See example_tool_server.py for a complete working example.
"""

from .tool_client import ToolClient, ToolResult, ToolDefinition, create_tool_router
from .tool_formatters import ToolFormatter, ModelFormat, detect_model_format, create_formatter_for_model

__all__ = [
    # Tool Client
    'ToolClient',
    'ToolResult',
    'ToolDefinition',
    'create_tool_router',
    # Tool Formatters
    'ToolFormatter',
    'ModelFormat',
    'detect_model_format',
    'create_formatter_for_model',
]
