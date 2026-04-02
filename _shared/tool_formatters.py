"""
Tool Formatters for Local Models

Different local models (Qwen, Llama, Mistral) expect tools in different formats.
This module provides adapters to convert MCP-compatible tool schemas to
model-specific formats.

Supported formats:
- Qwen 2.5 (Hermes): <tool_call>{"name": "...", "arguments": {...}}</tool_call>
- Llama 3.1/3.2: <|python_tag|>{"name": "...", "parameters": {...}}
- Mistral: [TOOL_CALLS][{"name": "...", "arguments": {...}}]
- Claude-style: <function_calls><invoke name="...">
- OpenAI: Standard JSON function calling

Usage:
    from tool_formatters import ToolFormatter, ModelFormat

    formatter = ToolFormatter(ModelFormat.QWEN_HERMES)

    # Format tools for system prompt
    tools = await tool_client.discover_tools()
    tool_prompt = formatter.format_tools_for_prompt(tools)

    # Parse tool calls from model output
    tool_call = formatter.parse_tool_call(model_output)

    # Format tool results
    result_str = formatter.format_tool_result(result)
"""

import json
import re
from enum import Enum
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass


class ModelFormat(Enum):
    """Supported model tool-calling formats."""
    QWEN_HERMES = "qwen_hermes"      # Qwen 2.5 with Hermes format
    LLAMA_NATIVE = "llama_native"    # Llama 3.1/3.2 native format
    MISTRAL = "mistral"              # Mistral function calling
    CLAUDE_XML = "claude_xml"        # Claude-style XML tags
    OPENAI_JSON = "openai_json"      # OpenAI function calling format
    GENERIC = "generic"              # Generic JSON format


@dataclass
class ParsedToolCall:
    """Parsed tool call from model output."""
    name: str
    arguments: Dict[str, Any]
    raw_match: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "arguments": self.arguments
        }


class ToolFormatter:
    """
    Format converter for tool calling with different local models.

    Handles:
    - Converting tool definitions to model-specific prompt format
    - Parsing tool calls from model output
    - Formatting tool results for context injection
    """

    def __init__(self, model_format: ModelFormat):
        self.format = model_format

    # ============================================
    # Format Tools for System Prompt
    # ============================================

    def format_tools_for_prompt(self, tools: List[Dict[str, Any]]) -> str:
        """
        Convert tool definitions to model's expected format in system prompt.

        Args:
            tools: List of tool definitions (MCP format)

        Returns:
            Formatted string to include in system prompt
        """
        if self.format == ModelFormat.QWEN_HERMES:
            return self._format_qwen_hermes(tools)
        elif self.format == ModelFormat.LLAMA_NATIVE:
            return self._format_llama_native(tools)
        elif self.format == ModelFormat.MISTRAL:
            return self._format_mistral(tools)
        elif self.format == ModelFormat.CLAUDE_XML:
            return self._format_claude_xml(tools)
        elif self.format == ModelFormat.OPENAI_JSON:
            return self._format_openai_json(tools)
        else:
            return self._format_generic(tools)

    def _format_qwen_hermes(self, tools: List[Dict[str, Any]]) -> str:
        """
        Qwen 2.5 Hermes format.

        Tools are defined as JSON functions, calls are wrapped in <tool_call> tags.
        """
        lines = ["You have access to the following tools:\n"]

        for tool in tools:
            tool_json = {
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("inputSchema", {"type": "object", "properties": {}})
                }
            }
            lines.append(json.dumps(tool_json))

        lines.append("\nTo use a tool, output in this exact format:")
        lines.append("<tool_call>")
        lines.append('{"name": "tool_name", "arguments": {"arg1": "value1"}}')
        lines.append("</tool_call>")
        lines.append("\nAfter using a tool, wait for the result before continuing.")

        return "\n".join(lines)

    def _format_llama_native(self, tools: List[Dict[str, Any]]) -> str:
        """
        Llama 3.1/3.2 native tool calling format.

        Uses <|python_tag|> for tool definitions and calls.
        """
        lines = ["You have access to the following functions:\n"]

        for tool in tools:
            func_def = {
                "name": tool.get("name", ""),
                "description": tool.get("description", ""),
                "parameters": tool.get("inputSchema", {"type": "object", "properties": {}})
            }
            lines.append(f"<|python_tag|>{json.dumps(func_def)}")

        lines.append("\nTo call a function, output:")
        lines.append('<|python_tag|>{"name": "function_name", "parameters": {"param": "value"}}')

        return "\n".join(lines)

    def _format_mistral(self, tools: List[Dict[str, Any]]) -> str:
        """
        Mistral function calling format.

        Uses [AVAILABLE_TOOLS] and [TOOL_CALLS] markers.
        """
        tool_defs = []
        for tool in tools:
            tool_defs.append({
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("inputSchema", {"type": "object", "properties": {}})
                }
            })

        lines = [
            "[AVAILABLE_TOOLS]",
            json.dumps(tool_defs),
            "[/AVAILABLE_TOOLS]",
            "",
            "To call a tool, use this format:",
            '[TOOL_CALLS][{"name": "tool_name", "arguments": {"key": "value"}}]'
        ]

        return "\n".join(lines)

    def _format_claude_xml(self, tools: List[Dict[str, Any]]) -> str:
        """
        Claude-style XML format.

        Tools defined with XML tags, calls use <function_calls>.
        """
        lines = ["You have access to the following tools:\n"]

        for tool in tools:
            lines.append(f"<tool name=\"{tool.get('name', '')}\" description=\"{tool.get('description', '')}\">")

            schema = tool.get("inputSchema", {})
            properties = schema.get("properties", {})
            required = schema.get("required", [])

            for param_name, param_def in properties.items():
                req = "required" if param_name in required else "optional"
                param_type = param_def.get("type", "string")
                param_desc = param_def.get("description", "")
                lines.append(f"  <parameter name=\"{param_name}\" type=\"{param_type}\" {req}>{param_desc}</parameter>")

            lines.append("</tool>")

        lines.append("\nTo use a tool, output:")
        lines.append("<function_calls>")
        lines.append("<invoke name=\"tool_name\">")
        lines.append("<parameter name=\"param_name\">value</parameter>")
        lines.append("</invoke>")
        lines.append("</function_calls>")

        return "\n".join(lines)

    def _format_openai_json(self, tools: List[Dict[str, Any]]) -> str:
        """
        OpenAI function calling format (text representation).

        Standard JSON schema format.
        """
        lines = ["You have access to the following functions:\n"]

        for tool in tools:
            func = {
                "name": tool.get("name", ""),
                "description": tool.get("description", ""),
                "parameters": tool.get("inputSchema", {"type": "object", "properties": {}})
            }
            lines.append(json.dumps({"type": "function", "function": func}, indent=2))
            lines.append("")

        lines.append("To call a function, respond with JSON in this format:")
        lines.append('{"function_call": {"name": "function_name", "arguments": {"key": "value"}}}')

        return "\n".join(lines)

    def _format_generic(self, tools: List[Dict[str, Any]]) -> str:
        """Generic format for unknown models."""
        lines = ["Available tools:\n"]

        for tool in tools:
            name = tool.get("name", "")
            desc = tool.get("description", "")
            schema = tool.get("inputSchema", {})
            params = schema.get("properties", {})

            lines.append(f"- {name}: {desc}")
            if params:
                lines.append("  Parameters:")
                for p_name, p_def in params.items():
                    p_type = p_def.get("type", "any")
                    p_desc = p_def.get("description", "")
                    lines.append(f"    - {p_name} ({p_type}): {p_desc}")

        lines.append("\nTo call a tool, output JSON:")
        lines.append('{"tool": "tool_name", "args": {"key": "value"}}')

        return "\n".join(lines)

    # ============================================
    # Parse Tool Calls from Model Output
    # ============================================

    def parse_tool_call(self, model_output: str) -> Optional[ParsedToolCall]:
        """
        Extract tool call from model's output.

        Args:
            model_output: Raw text output from the model

        Returns:
            ParsedToolCall if found, None otherwise
        """
        if self.format == ModelFormat.QWEN_HERMES:
            return self._parse_qwen_hermes(model_output)
        elif self.format == ModelFormat.LLAMA_NATIVE:
            return self._parse_llama_native(model_output)
        elif self.format == ModelFormat.MISTRAL:
            return self._parse_mistral(model_output)
        elif self.format == ModelFormat.CLAUDE_XML:
            return self._parse_claude_xml(model_output)
        elif self.format == ModelFormat.OPENAI_JSON:
            return self._parse_openai_json(model_output)
        else:
            return self._parse_generic(model_output)

    def parse_all_tool_calls(self, model_output: str) -> List[ParsedToolCall]:
        """
        Extract all tool calls from model output (for multi-tool responses).

        Args:
            model_output: Raw text output from the model

        Returns:
            List of ParsedToolCall objects
        """
        calls = []

        if self.format == ModelFormat.QWEN_HERMES:
            # Find all <tool_call>...</tool_call> blocks
            pattern = r'<tool_call>\s*({.*?})\s*</tool_call>'
            for match in re.finditer(pattern, model_output, re.DOTALL):
                try:
                    data = json.loads(match.group(1))
                    calls.append(ParsedToolCall(
                        name=data.get("name", ""),
                        arguments=data.get("arguments", {}),
                        raw_match=match.group(0)
                    ))
                except json.JSONDecodeError:
                    pass

        elif self.format == ModelFormat.MISTRAL:
            # Find all tool calls in [TOOL_CALLS][...] format
            pattern = r'\[TOOL_CALLS\]\s*\[(.*?)\]'
            match = re.search(pattern, model_output, re.DOTALL)
            if match:
                try:
                    tool_list = json.loads(f"[{match.group(1)}]")
                    for data in tool_list:
                        calls.append(ParsedToolCall(
                            name=data.get("name", ""),
                            arguments=data.get("arguments", {}),
                            raw_match=match.group(0)
                        ))
                except json.JSONDecodeError:
                    pass

        else:
            # For other formats, just get the first call
            call = self.parse_tool_call(model_output)
            if call:
                calls.append(call)

        return calls

    def _parse_qwen_hermes(self, output: str) -> Optional[ParsedToolCall]:
        """Parse <tool_call>...</tool_call> from Qwen output."""
        pattern = r'<tool_call>\s*({.*?})\s*</tool_call>'
        match = re.search(pattern, output, re.DOTALL)

        if match:
            try:
                data = json.loads(match.group(1))
                return ParsedToolCall(
                    name=data.get("name", ""),
                    arguments=data.get("arguments", {}),
                    raw_match=match.group(0)
                )
            except json.JSONDecodeError:
                pass

        return None

    def _parse_llama_native(self, output: str) -> Optional[ParsedToolCall]:
        """Parse <|python_tag|>{...} from Llama output."""
        pattern = r'<\|python_tag\|>\s*({.*?})'
        match = re.search(pattern, output, re.DOTALL)

        if match:
            try:
                data = json.loads(match.group(1))
                return ParsedToolCall(
                    name=data.get("name", ""),
                    arguments=data.get("parameters", data.get("arguments", {})),
                    raw_match=match.group(0)
                )
            except json.JSONDecodeError:
                pass

        return None

    def _parse_mistral(self, output: str) -> Optional[ParsedToolCall]:
        """Parse [TOOL_CALLS][...] from Mistral output."""
        pattern = r'\[TOOL_CALLS\]\s*\[({.*?})\]'
        match = re.search(pattern, output, re.DOTALL)

        if match:
            try:
                data = json.loads(match.group(1))
                return ParsedToolCall(
                    name=data.get("name", ""),
                    arguments=data.get("arguments", {}),
                    raw_match=match.group(0)
                )
            except json.JSONDecodeError:
                pass

        return None

    def _parse_claude_xml(self, output: str) -> Optional[ParsedToolCall]:
        """Parse <function_calls><invoke>...</invoke></function_calls> from output."""
        # Find invoke block
        invoke_pattern = r'<invoke\s+name="([^"]+)">(.*?)</invoke>'
        match = re.search(invoke_pattern, output, re.DOTALL)

        if match:
            name = match.group(1)
            params_block = match.group(2)

            # Parse parameters
            arguments = {}
            param_pattern = r'<parameter\s+name="([^"]+)">([^<]*)</parameter>'
            for param_match in re.finditer(param_pattern, params_block):
                param_name = param_match.group(1)
                param_value = param_match.group(2)

                # Try to parse as JSON, otherwise use string
                try:
                    arguments[param_name] = json.loads(param_value)
                except (json.JSONDecodeError, ValueError):
                    arguments[param_name] = param_value

            return ParsedToolCall(
                name=name,
                arguments=arguments,
                raw_match=match.group(0)
            )

        return None

    def _parse_openai_json(self, output: str) -> Optional[ParsedToolCall]:
        """Parse {"function_call": {...}} from output."""
        pattern = r'\{\s*"function_call"\s*:\s*({.*?})\s*\}'
        match = re.search(pattern, output, re.DOTALL)

        if match:
            try:
                data = json.loads(match.group(1))
                args = data.get("arguments", {})

                # Handle string arguments (OpenAI sometimes returns stringified JSON)
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        args = {}

                return ParsedToolCall(
                    name=data.get("name", ""),
                    arguments=args,
                    raw_match=match.group(0)
                )
            except json.JSONDecodeError:
                pass

        return None

    def _parse_generic(self, output: str) -> Optional[ParsedToolCall]:
        """Parse generic JSON tool call."""
        # Try various patterns
        patterns = [
            r'\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*({.*?})\s*\}',
            r'\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*({.*?})\s*\}',
        ]

        for pattern in patterns:
            match = re.search(pattern, output, re.DOTALL)
            if match:
                try:
                    name = match.group(1)
                    args = json.loads(match.group(2))
                    return ParsedToolCall(
                        name=name,
                        arguments=args,
                        raw_match=match.group(0)
                    )
                except json.JSONDecodeError:
                    pass

        return None

    # ============================================
    # Format Tool Results
    # ============================================

    def format_tool_result(
        self,
        tool_name: str,
        result: Dict[str, Any],
        include_in_context: bool = True
    ) -> str:
        """
        Format tool result for injection back into context.

        Args:
            tool_name: Name of the tool that was called
            result: Result from tool execution
            include_in_context: Whether this will be added to conversation

        Returns:
            Formatted string for the model
        """
        if self.format == ModelFormat.QWEN_HERMES:
            return self._format_result_qwen_hermes(tool_name, result)
        elif self.format == ModelFormat.LLAMA_NATIVE:
            return self._format_result_llama_native(tool_name, result)
        elif self.format == ModelFormat.MISTRAL:
            return self._format_result_mistral(tool_name, result)
        elif self.format == ModelFormat.CLAUDE_XML:
            return self._format_result_claude_xml(tool_name, result)
        else:
            return self._format_result_generic(tool_name, result)

    def _format_result_qwen_hermes(self, tool_name: str, result: Dict[str, Any]) -> str:
        """Format result for Qwen."""
        if result.get("success"):
            return f"<tool_response>\nTool '{tool_name}' returned:\n{json.dumps(result.get('data', {}), indent=2)}\n</tool_response>"
        else:
            return f"<tool_response>\nTool '{tool_name}' failed: {result.get('error', 'Unknown error')}\n</tool_response>"

    def _format_result_llama_native(self, tool_name: str, result: Dict[str, Any]) -> str:
        """Format result for Llama."""
        return f"<|python_tag|>Result of {tool_name}: {json.dumps(result)}"

    def _format_result_mistral(self, tool_name: str, result: Dict[str, Any]) -> str:
        """Format result for Mistral."""
        return f"[TOOL_RESULTS]{json.dumps({'name': tool_name, 'result': result})}[/TOOL_RESULTS]"

    def _format_result_claude_xml(self, tool_name: str, result: Dict[str, Any]) -> str:
        """Format result for Claude-style."""
        if result.get("success"):
            return f"<function_results>\n<result name=\"{tool_name}\">\n{json.dumps(result.get('data', {}), indent=2)}\n</result>\n</function_results>"
        else:
            return f"<function_results>\n<error name=\"{tool_name}\">{result.get('error', 'Unknown error')}</error>\n</function_results>"

    def _format_result_generic(self, tool_name: str, result: Dict[str, Any]) -> str:
        """Format result generically."""
        return f"Tool '{tool_name}' result:\n{json.dumps(result, indent=2)}"


# ============================================
# Auto-Detection
# ============================================

def detect_model_format(model_name: str) -> ModelFormat:
    """
    Guess the appropriate format based on model name.

    Args:
        model_name: Name of the model (e.g., "Qwen2.5-14B-Instruct")

    Returns:
        Best-guess ModelFormat
    """
    name_lower = model_name.lower()

    if "qwen" in name_lower:
        return ModelFormat.QWEN_HERMES
    elif "llama" in name_lower:
        return ModelFormat.LLAMA_NATIVE
    elif "mistral" in name_lower or "mixtral" in name_lower:
        return ModelFormat.MISTRAL
    elif "claude" in name_lower:
        return ModelFormat.CLAUDE_XML
    elif "gpt" in name_lower or "openai" in name_lower:
        return ModelFormat.OPENAI_JSON
    else:
        return ModelFormat.GENERIC


def create_formatter_for_model(model_name: str) -> ToolFormatter:
    """
    Create a ToolFormatter for a given model.

    Args:
        model_name: Name of the model

    Returns:
        Configured ToolFormatter
    """
    format_type = detect_model_format(model_name)
    return ToolFormatter(format_type)


# ============================================
# Streaming Tool Call Parser
# ============================================

class StreamingToolCallParser:
    """
    State machine for detecting tool calls in streaming output.

    Usage:
        parser = StreamingToolCallParser(ModelFormat.QWEN_HERMES)

        for token in stream:
            display_text, tool_call = parser.feed(token)
            if tool_call:
                # Execute tool and inject result
                result = await execute_tool(tool_call)
                context.append(formatter.format_tool_result(tool_call.name, result))
            else:
                # Display token to user
                print(display_text, end="")
    """

    def __init__(self, model_format: ModelFormat):
        self.format = model_format
        self.formatter = ToolFormatter(model_format)
        self.buffer = ""
        self.in_tool_call = False
        self.tool_start_marker = self._get_start_marker()
        self.tool_end_marker = self._get_end_marker()

    def _get_start_marker(self) -> str:
        markers = {
            ModelFormat.QWEN_HERMES: "<tool_call>",
            ModelFormat.LLAMA_NATIVE: "<|python_tag|>",
            ModelFormat.MISTRAL: "[TOOL_CALLS]",
            ModelFormat.CLAUDE_XML: "<function_calls>",
            ModelFormat.OPENAI_JSON: '{"function_call"',
        }
        return markers.get(self.format, '{"tool"')

    def _get_end_marker(self) -> str:
        markers = {
            ModelFormat.QWEN_HERMES: "</tool_call>",
            ModelFormat.LLAMA_NATIVE: "\n",
            ModelFormat.MISTRAL: "]",
            ModelFormat.CLAUDE_XML: "</function_calls>",
            ModelFormat.OPENAI_JSON: "}",
        }
        return markers.get(self.format, "}")

    def feed(self, token: str) -> Tuple[str, Optional[ParsedToolCall]]:
        """
        Feed a token and return (display_text, tool_call_or_none).

        Args:
            token: Next token from model output

        Returns:
            Tuple of (text to display, ParsedToolCall if complete)
        """
        self.buffer += token

        # Check for tool call start
        if not self.in_tool_call:
            if self.tool_start_marker in self.buffer:
                self.in_tool_call = True
                # Return text before the marker
                idx = self.buffer.find(self.tool_start_marker)
                display_text = self.buffer[:idx]
                self.buffer = self.buffer[idx:]
                return (display_text, None)
            else:
                # Check if we might be starting a marker
                for i in range(1, len(self.tool_start_marker)):
                    if self.buffer.endswith(self.tool_start_marker[:i]):
                        # Hold back potential marker start
                        display_text = self.buffer[:-i]
                        self.buffer = self.buffer[-i:]
                        return (display_text, None)

                # Safe to display everything
                display_text = self.buffer
                self.buffer = ""
                return (display_text, None)

        # In tool call - look for end
        if self.tool_end_marker in self.buffer:
            # Tool call complete
            idx = self.buffer.find(self.tool_end_marker) + len(self.tool_end_marker)
            tool_text = self.buffer[:idx]
            self.buffer = self.buffer[idx:]
            self.in_tool_call = False

            # Parse the tool call
            tool_call = self.formatter.parse_tool_call(tool_text)
            return ("", tool_call)

        # Still in tool call, don't display anything
        return ("", None)

    def reset(self):
        """Reset parser state."""
        self.buffer = ""
        self.in_tool_call = False


# ============================================
# Testing
# ============================================

if __name__ == "__main__":
    # Test parsing
    test_outputs = {
        ModelFormat.QWEN_HERMES: '''Let me capture the screen for you.
<tool_call>
{"name": "capture_screen", "arguments": {"monitor": 1, "subdivisions": 8}}
</tool_call>
I'll analyze the result.''',

        ModelFormat.LLAMA_NATIVE: '''I'll help you with that.
<|python_tag|>{"name": "capture_screen", "parameters": {"monitor": 1}}
Done.''',

        ModelFormat.MISTRAL: '''Let me check.
[TOOL_CALLS][{"name": "capture_screen", "arguments": {"monitor": 1}}]
''',
    }

    print("Testing tool formatters:\n")

    for format_type, output in test_outputs.items():
        formatter = ToolFormatter(format_type)
        result = formatter.parse_tool_call(output)

        print(f"{format_type.value}:")
        if result:
            print(f"  Parsed: {result.to_dict()}")
        else:
            print("  Failed to parse")
        print()

    # Test auto-detection
    print("\nTesting auto-detection:")
    test_models = [
        "Qwen2.5-14B-Instruct-GGUF",
        "llama-3.1-8b-instruct",
        "Mistral-7B-Instruct-v0.3",
        "claude-3-sonnet",
        "gpt-4o",
        "unknown-model"
    ]

    for model in test_models:
        detected = detect_model_format(model)
        print(f"  {model} -> {detected.value}")
