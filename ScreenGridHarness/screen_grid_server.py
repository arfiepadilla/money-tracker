"""
Screen Grid Harness Server
Provides native OS-level screenshot capture and input simulation for AI-driven automation.
Overlays coordinate grids on screenshots for precise location referencing.

Now integrated with the MCP tool registry for cross-workflow tool discovery and execution.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Tuple
import uvicorn
import base64
import io
import os
import sys
import re
import time
from pathlib import Path
from datetime import datetime

# Screen capture
import mss
import mss.tools
from PIL import Image, ImageDraw, ImageFont

# Native input simulation
import pyautogui

# Add _shared directory to path to import tool_client
shared_path = os.path.join(os.path.dirname(__file__), '..', '_shared')
sys.path.insert(0, shared_path)
from tool_client import ToolClient, create_tool_router

# Disable pyautogui failsafe (mouse to corner stops script)
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.02  # Small delay between actions

# Server configuration
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
SERVER_NAME = "screen_grid_harness"

app = FastAPI(title="Screen Grid Harness Server")

# Create tool client for MCP registry integration
tool_client = ToolClient(SERVER_NAME, port=PORT)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# Grid Configuration
# ============================================

class GridConfig:
    """Grid overlay configuration."""
    def __init__(self):
        self.density = "medium"  # coarse, medium, fine, ultra, custom
        self.cell_width = 50
        self.cell_height = 50
        self.show_labels = True
        self.label_frequency = 2  # Show label every N cells
        self.grid_color = (255, 100, 100, 120)  # RGBA - semi-transparent red
        self.label_color = (255, 255, 255, 230)  # RGBA - white
        self.label_bg_color = (0, 0, 0, 180)  # RGBA - dark background
        self.line_width = 1

    def apply_density(self, density: str):
        """Apply a density preset."""
        self.density = density
        presets = {
            "coarse": (100, 100),
            "medium": (50, 50),
            "fine": (25, 25),
            "ultra": (10, 10),
        }
        if density in presets:
            self.cell_width, self.cell_height = presets[density]


class ImageScaleConfig:
    """Image scaling configuration for AI-friendly output."""
    def __init__(self):
        self.max_dimension = 680   # Sweet spot for readability + token limits
        self.auto_scale = True     # Automatically scale large images
        self.quality = 70          # Good balance of quality and size
        self.format = "JPEG"       # JPEG is much smaller than PNG


# Global state
image_scale_config = ImageScaleConfig()
grid_config = GridConfig()
action_history: List[Dict[str, Any]] = []
last_screenshot: Optional[Image.Image] = None
last_screenshot_with_grid: Optional[Image.Image] = None
last_scale_factor: float = 1.0
last_original_size: Optional[Tuple[int, int]] = None

# Zoom state for hierarchical reduction
class ZoomState:
    """Track the current zoom/reduction state."""
    def __init__(self):
        self.reset()

    def reset(self):
        """Reset to full screen view."""
        self.level = 0  # 0 = full screen, 1+ = zoomed levels
        self.region_stack: List[Dict[str, int]] = []  # Stack of {left, top, width, height}
        self.current_region: Optional[Dict[str, int]] = None
        self.monitor_index = 1
        self.monitor_offset = {"left": 0, "top": 0}  # Monitor position offset

    def push_region(self, cell: str, cell_width: int, cell_height: int):
        """Zoom into a cell, making it the new viewport."""
        # Parse cell reference
        cell_match = re.match(r'^([A-Za-z]+)(\d+)$', cell)
        if not cell_match:
            raise ValueError(f"Invalid cell reference: {cell}")

        col = letters_to_column(cell_match.group(1))
        row = int(cell_match.group(2)) - 1

        # Calculate the region in current coordinate space
        if self.current_region:
            # Relative to current zoomed region
            base_left = self.current_region["left"]
            base_top = self.current_region["top"]
        else:
            # Relative to monitor
            base_left = self.monitor_offset["left"]
            base_top = self.monitor_offset["top"]

        new_region = {
            "left": base_left + col * cell_width,
            "top": base_top + row * cell_height,
            "width": cell_width,
            "height": cell_height,
        }

        # Save current region to stack
        if self.current_region:
            self.region_stack.append(self.current_region)

        self.current_region = new_region
        self.level += 1

        return new_region

    def pop_region(self) -> Optional[Dict[str, int]]:
        """Zoom out one level."""
        if self.region_stack:
            self.current_region = self.region_stack.pop()
            self.level -= 1
            return self.current_region
        else:
            self.current_region = None
            self.level = 0
            return None

    def get_absolute_coordinates(self, local_x: int, local_y: int) -> Tuple[int, int]:
        """Convert local coordinates (within current region) to absolute screen coordinates."""
        if self.current_region:
            return (
                self.current_region["left"] + local_x,
                self.current_region["top"] + local_y
            )
        else:
            return (
                self.monitor_offset["left"] + local_x,
                self.monitor_offset["top"] + local_y
            )

zoom_state = ZoomState()


def add_log(message: str):
    """Add timestamped log entry."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    print(entry, flush=True)


# ============================================
# Coordinate Translation
# ============================================

def column_to_letters(col: int) -> str:
    """Convert column number (0-indexed) to spreadsheet-style letters (A, B, ..., Z, AA, AB, ...)."""
    result = ""
    col += 1  # 1-indexed
    while col > 0:
        col -= 1
        result = chr(ord('A') + (col % 26)) + result
        col //= 26
    return result


def letters_to_column(letters: str) -> int:
    """Convert spreadsheet-style letters to column number (0-indexed)."""
    result = 0
    for char in letters.upper():
        result = result * 26 + (ord(char) - ord('A') + 1)
    return result - 1


def parse_coordinate(coord: str, image_width: int, image_height: int) -> Tuple[int, int]:
    """
    Parse a coordinate string and return (x, y) pixel coordinates.

    Supports formats:
    - "A1", "B4", "AA15" - Grid cell reference (returns center of cell)
    - "320,150" or "320, 150" - Direct pixel coordinates
    - "(320, 150)" - Direct pixel coordinates with parentheses
    """
    coord = coord.strip()

    # Try direct pixel coordinates: "320,150" or "(320, 150)"
    pixel_match = re.match(r'\(?\s*(\d+)\s*,\s*(\d+)\s*\)?', coord)
    if pixel_match:
        x = int(pixel_match.group(1))
        y = int(pixel_match.group(2))
        return (x, y)

    # Try grid cell reference: "A1", "B4", "AA15"
    cell_match = re.match(r'^([A-Za-z]+)(\d+)$', coord)
    if cell_match:
        col_letters = cell_match.group(1)
        row_num = int(cell_match.group(2))

        col = letters_to_column(col_letters)
        row = row_num - 1  # Convert to 0-indexed

        # Calculate center of cell
        x = col * grid_config.cell_width + grid_config.cell_width // 2
        y = row * grid_config.cell_height + grid_config.cell_height // 2

        return (x, y)

    raise ValueError(f"Invalid coordinate format: {coord}")


def get_cell_at_pixel(x: int, y: int) -> str:
    """Get the grid cell reference for a pixel coordinate."""
    col = x // grid_config.cell_width
    row = y // grid_config.cell_height
    return f"{column_to_letters(col)}{row + 1}"


# ============================================
# Screenshot Capture
# ============================================

def capture_screen(monitor_index: int = 0, region: Optional[Dict[str, int]] = None) -> Image.Image:
    """Capture screenshot of a monitor or region."""
    with mss.mss() as sct:
        if region:
            capture_area = region
        else:
            # monitor_index 0 = all monitors combined, 1+ = individual monitors
            monitors = sct.monitors
            if monitor_index >= len(monitors):
                monitor_index = 1  # Default to primary
            capture_area = monitors[monitor_index]

        screenshot = sct.grab(capture_area)
        # Convert to PIL Image (RGB)
        img = Image.frombytes('RGB', screenshot.size, screenshot.bgra, 'raw', 'BGRX')
        return img


def get_monitors() -> List[Dict[str, Any]]:
    """Get list of available monitors."""
    with mss.mss() as sct:
        monitors = []
        for i, mon in enumerate(sct.monitors):
            if i == 0:
                name = "All Monitors"
            else:
                name = f"Monitor {i}"
            monitors.append({
                "index": i,
                "name": name,
                "left": mon["left"],
                "top": mon["top"],
                "width": mon["width"],
                "height": mon["height"],
            })
        return monitors


def scale_image_for_ai(image: Image.Image, max_dimension: int = 1568) -> Tuple[Image.Image, float]:
    """
    Scale image to fit within AI-friendly dimensions.

    Args:
        image: PIL Image to scale
        max_dimension: Maximum pixels on longest side

    Returns:
        Tuple of (scaled_image, scale_factor)
    """
    width, height = image.size
    longest_side = max(width, height)

    if longest_side <= max_dimension:
        return image, 1.0  # No scaling needed

    scale_factor = max_dimension / longest_side
    new_width = int(width * scale_factor)
    new_height = int(height * scale_factor)

    # Use LANCZOS for high-quality downscaling
    scaled = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
    return scaled, scale_factor


# ============================================
# Grid Rendering
# ============================================

def render_grid_overlay(image: Image.Image) -> Image.Image:
    """Render coordinate grid overlay on an image."""
    # Create a copy with alpha channel
    img = image.convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    width, height = img.size
    cell_w = grid_config.cell_width
    cell_h = grid_config.cell_height

    # Try to load a font for labels
    try:
        # Try common font paths
        font_size = max(8, min(cell_w, cell_h) // 4)
        font_paths = [
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/consola.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
        font = None
        for fp in font_paths:
            if os.path.exists(fp):
                font = ImageFont.truetype(fp, font_size)
                break
        if font is None:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    # Draw vertical lines
    col = 0
    for x in range(0, width, cell_w):
        # Main grid line
        draw.line([(x, 0), (x, height)], fill=grid_config.grid_color, width=grid_config.line_width)
        col += 1

    # Draw horizontal lines
    row = 0
    for y in range(0, height, cell_h):
        draw.line([(0, y), (width, y)], fill=grid_config.grid_color, width=grid_config.line_width)
        row += 1

    # Draw labels if enabled
    if grid_config.show_labels:
        col = 0
        for x in range(0, width, cell_w):
            row = 0
            for y in range(0, height, cell_h):
                # Only show labels at specified frequency
                if col % grid_config.label_frequency == 0 and row % grid_config.label_frequency == 0:
                    label = f"{column_to_letters(col)}{row + 1}"

                    # Get text bounding box
                    bbox = draw.textbbox((0, 0), label, font=font)
                    text_w = bbox[2] - bbox[0]
                    text_h = bbox[3] - bbox[1]

                    # Position label in top-left of cell with padding
                    label_x = x + 2
                    label_y = y + 2

                    # Draw background rectangle
                    padding = 1
                    draw.rectangle(
                        [label_x - padding, label_y - padding,
                         label_x + text_w + padding, label_y + text_h + padding],
                        fill=grid_config.label_bg_color
                    )

                    # Draw label text
                    draw.text((label_x, label_y), label, fill=grid_config.label_color, font=font)

                row += 1
            col += 1

    # Composite overlay onto image
    result = Image.alpha_composite(img, overlay)
    return result.convert('RGB')


def image_to_base64(image: Image.Image, format: str = "PNG", quality: int = 85) -> str:
    """
    Convert PIL Image to base64 string.

    Args:
        image: PIL Image to convert
        format: Output format ("PNG" or "JPEG")
        quality: JPEG quality (1-100), ignored for PNG
    """
    buffer = io.BytesIO()

    if format.upper() == "JPEG":
        # JPEG doesn't support alpha channel
        if image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info):
            image = image.convert('RGB')
        image.save(buffer, format="JPEG", quality=quality, optimize=True)
    else:
        image.save(buffer, format="PNG", optimize=True)

    return base64.b64encode(buffer.getvalue()).decode()


# ============================================
# Native Input Simulation
# ============================================

def click_at(x: int, y: int, button: str = 'left', clicks: int = 1) -> Dict[str, Any]:
    """Click at screen coordinates."""
    try:
        pyautogui.click(x, y, clicks=clicks, button=button)
        add_log(f"Clicked at ({x}, {y}) with {button} button, {clicks} click(s)")
        return {"success": True, "x": x, "y": y, "button": button, "clicks": clicks}
    except Exception as e:
        add_log(f"Click error: {e}")
        return {"success": False, "error": str(e)}


def move_to(x: int, y: int, duration: float = 0.1) -> Dict[str, Any]:
    """Move mouse to coordinates."""
    try:
        pyautogui.moveTo(x, y, duration=duration)
        add_log(f"Moved to ({x}, {y})")
        return {"success": True, "x": x, "y": y}
    except Exception as e:
        add_log(f"Move error: {e}")
        return {"success": False, "error": str(e)}


def drag_to(start_x: int, start_y: int, end_x: int, end_y: int, duration: float = 0.3, button: str = 'left') -> Dict[str, Any]:
    """Drag from start to end coordinates."""
    try:
        pyautogui.moveTo(start_x, start_y)
        pyautogui.drag(end_x - start_x, end_y - start_y, duration=duration, button=button)
        add_log(f"Dragged from ({start_x}, {start_y}) to ({end_x}, {end_y})")
        return {"success": True, "start": {"x": start_x, "y": start_y}, "end": {"x": end_x, "y": end_y}}
    except Exception as e:
        add_log(f"Drag error: {e}")
        return {"success": False, "error": str(e)}


def type_text(text: str, interval: float = 0.02) -> Dict[str, Any]:
    """Type text at current cursor position."""
    try:
        pyautogui.write(text, interval=interval)
        add_log(f"Typed: {text[:50]}{'...' if len(text) > 50 else ''}")
        return {"success": True, "text": text}
    except Exception as e:
        add_log(f"Type error: {e}")
        return {"success": False, "error": str(e)}


def press_key(key_combination: str) -> Dict[str, Any]:
    """Press a key combination (e.g., 'ctrl+c', 'alt+tab', 'enter')."""
    try:
        keys = key_combination.lower().replace(' ', '').split('+')
        if len(keys) == 1:
            pyautogui.press(keys[0])
        else:
            pyautogui.hotkey(*keys)
        add_log(f"Pressed: {key_combination}")
        return {"success": True, "keys": key_combination}
    except Exception as e:
        add_log(f"Key press error: {e}")
        return {"success": False, "error": str(e)}


def scroll_at(x: int, y: int, clicks: int) -> Dict[str, Any]:
    """Scroll at position. Positive = up, negative = down."""
    try:
        pyautogui.moveTo(x, y)
        pyautogui.scroll(clicks)
        add_log(f"Scrolled {clicks} at ({x}, {y})")
        return {"success": True, "x": x, "y": y, "clicks": clicks}
    except Exception as e:
        add_log(f"Scroll error: {e}")
        return {"success": False, "error": str(e)}


# ============================================
# MCP Tool Handlers
# ============================================

async def capture_screenshot_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for capture_screenshot tool."""
    global last_screenshot, last_screenshot_with_grid, last_scale_factor, last_original_size

    monitor_index = args.get("monitor_index", 1)
    render_grid = args.get("render_grid", True)

    # Scaling parameters
    max_dimension = args.get("max_dimension", image_scale_config.max_dimension)
    auto_scale = args.get("auto_scale", image_scale_config.auto_scale)
    output_format = args.get("format", image_scale_config.format)
    quality = args.get("quality", image_scale_config.quality)

    try:
        # Capture at full resolution
        image = capture_screen(monitor_index)
        original_size = image.size
        last_original_size = original_size

        # Scale if needed
        scale_factor = 1.0
        if auto_scale and max_dimension > 0:
            image, scale_factor = scale_image_for_ai(image, max_dimension)
        last_scale_factor = scale_factor
        last_screenshot = image

        if render_grid:
            image_with_grid = render_grid_overlay(image)
            last_screenshot_with_grid = image_with_grid
            result_image = image_with_grid
        else:
            last_screenshot_with_grid = None
            result_image = image

        image_b64 = image_to_base64(result_image, format=output_format, quality=quality)

        return {
            "image_b64": image_b64,
            "width": result_image.size[0],
            "height": result_image.size[1],
            "original_width": original_size[0],
            "original_height": original_size[1],
            "scale_factor": scale_factor,
            "scaled": scale_factor != 1.0,
            "grid_applied": render_grid,
            "format": output_format,
            "grid_config": {
                "density": grid_config.density,
                "cell_width": grid_config.cell_width,
                "cell_height": grid_config.cell_height,
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def translate_coordinate_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for translate_coordinate tool."""
    coordinate = args.get("coordinate", "")

    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        x, y = parse_coordinate(coordinate, width, height)
        cell = get_cell_at_pixel(x, y)

        return {"coordinate": coordinate, "x": x, "y": y, "cell": cell}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def click_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for click tool."""
    coordinate = args.get("coordinate", "")
    button = args.get("button", "left")
    clicks = args.get("clicks", 1)

    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        x, y = parse_coordinate(coordinate, width, height)

        # Scale coordinates back to original screen space if image was scaled
        if last_scale_factor != 1.0 and last_original_size is not None:
            x = int(x / last_scale_factor)
            y = int(y / last_scale_factor)

        result = click_at(x, y, button, clicks)

        if result["success"]:
            action_history.append({
                "action": "click",
                "coordinate": coordinate,
                "x": x, "y": y,
                "button": button,
                "clicks": clicks,
                "scale_factor": last_scale_factor,
                "timestamp": datetime.now().isoformat(),
            })

        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


async def move_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for move tool."""
    coordinate = args.get("coordinate", "")
    duration = args.get("duration", 0.1)

    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        x, y = parse_coordinate(coordinate, width, height)

        # Scale coordinates back to original screen space if image was scaled
        if last_scale_factor != 1.0 and last_original_size is not None:
            x = int(x / last_scale_factor)
            y = int(y / last_scale_factor)

        result = move_to(x, y, duration)

        if result["success"]:
            action_history.append({
                "action": "move",
                "coordinate": coordinate,
                "x": x, "y": y,
                "scale_factor": last_scale_factor,
                "timestamp": datetime.now().isoformat(),
            })

        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


async def drag_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for drag tool."""
    start_coordinate = args.get("start_coordinate", "")
    end_coordinate = args.get("end_coordinate", "")
    duration = args.get("duration", 0.3)
    button = args.get("button", "left")

    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        start_x, start_y = parse_coordinate(start_coordinate, width, height)
        end_x, end_y = parse_coordinate(end_coordinate, width, height)

        # Scale coordinates back to original screen space if image was scaled
        if last_scale_factor != 1.0 and last_original_size is not None:
            start_x = int(start_x / last_scale_factor)
            start_y = int(start_y / last_scale_factor)
            end_x = int(end_x / last_scale_factor)
            end_y = int(end_y / last_scale_factor)

        result = drag_to(start_x, start_y, end_x, end_y, duration, button)

        if result["success"]:
            action_history.append({
                "action": "drag",
                "start_coordinate": start_coordinate,
                "end_coordinate": end_coordinate,
                "start": {"x": start_x, "y": start_y},
                "end": {"x": end_x, "y": end_y},
                "scale_factor": last_scale_factor,
                "timestamp": datetime.now().isoformat(),
            })

        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


async def type_text_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for type_text tool."""
    text = args.get("text", "")
    interval = args.get("interval", 0.02)

    result = type_text(text, interval)

    if result["success"]:
        action_history.append({
            "action": "type",
            "text": text,
            "timestamp": datetime.now().isoformat(),
        })

    return result


async def press_key_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for press_key tool."""
    keys = args.get("keys", "")

    result = press_key(keys)

    if result["success"]:
        action_history.append({
            "action": "key",
            "keys": keys,
            "timestamp": datetime.now().isoformat(),
        })

    return result


async def scroll_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for scroll tool."""
    coordinate = args.get("coordinate", "")
    clicks = args.get("clicks", 3)

    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        x, y = parse_coordinate(coordinate, width, height)

        # Scale coordinates back to original screen space if image was scaled
        if last_scale_factor != 1.0 and last_original_size is not None:
            x = int(x / last_scale_factor)
            y = int(y / last_scale_factor)

        result = scroll_at(x, y, clicks)

        if result["success"]:
            action_history.append({
                "action": "scroll",
                "coordinate": coordinate,
                "x": x, "y": y,
                "clicks": clicks,
                "scale_factor": last_scale_factor,
                "timestamp": datetime.now().isoformat(),
            })

        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


async def get_mouse_position_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for get_mouse_position tool."""
    try:
        x, y = pyautogui.position()
        cell = get_cell_at_pixel(x, y)
        return {"x": x, "y": y, "cell": cell}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def get_monitors_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for get_monitors tool."""
    try:
        monitors = get_monitors()
        return {"monitors": monitors}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def get_grid_config_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for get_grid_config tool."""
    return {
        "density": grid_config.density,
        "cell_width": grid_config.cell_width,
        "cell_height": grid_config.cell_height,
        "show_labels": grid_config.show_labels,
        "label_frequency": grid_config.label_frequency,
    }


async def set_grid_config_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for set_grid_config tool."""
    density = args.get("density")
    cell_width = args.get("cell_width")
    cell_height = args.get("cell_height")
    show_labels = args.get("show_labels")
    label_frequency = args.get("label_frequency")

    if density:
        grid_config.apply_density(density)
    if cell_width is not None:
        grid_config.cell_width = cell_width
        grid_config.density = "custom"
    if cell_height is not None:
        grid_config.cell_height = cell_height
        grid_config.density = "custom"
    if show_labels is not None:
        grid_config.show_labels = show_labels
    if label_frequency is not None:
        grid_config.label_frequency = label_frequency

    return await get_grid_config_handler({})


async def get_scale_config_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for get_scale_config tool."""
    return {
        "max_dimension": image_scale_config.max_dimension,
        "auto_scale": image_scale_config.auto_scale,
        "quality": image_scale_config.quality,
        "format": image_scale_config.format,
    }


async def set_scale_config_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for set_scale_config tool."""
    max_dimension = args.get("max_dimension")
    auto_scale = args.get("auto_scale")
    quality = args.get("quality")
    output_format = args.get("format")

    if max_dimension is not None:
        image_scale_config.max_dimension = max_dimension
    if auto_scale is not None:
        image_scale_config.auto_scale = auto_scale
    if quality is not None:
        image_scale_config.quality = max(1, min(100, quality))
    if output_format is not None:
        image_scale_config.format = output_format.upper()

    return await get_scale_config_handler({})


async def zoom_capture_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for zoom_capture tool."""
    global last_screenshot, last_screenshot_with_grid, last_scale_factor, last_original_size

    monitor_index = args.get("monitor_index", 1)
    subdivisions = args.get("subdivisions", 8)

    # Scaling parameters - use larger max for zoomed views since regions are smaller
    max_dimension = args.get("max_dimension", image_scale_config.max_dimension)
    auto_scale = args.get("auto_scale", image_scale_config.auto_scale)
    output_format = args.get("format", image_scale_config.format)
    quality = args.get("quality", image_scale_config.quality)

    try:
        if zoom_state.level == 0:
            monitors = get_monitors()
            if monitor_index < len(monitors):
                mon = monitors[monitor_index]
                zoom_state.monitor_offset = {"left": mon["left"], "top": mon["top"]}
                zoom_state.monitor_index = monitor_index

        if zoom_state.current_region:
            region = zoom_state.current_region
        else:
            monitors = get_monitors()
            if monitor_index >= len(monitors):
                monitor_index = 1
            mon = monitors[monitor_index]
            region = {
                "left": mon["left"],
                "top": mon["top"],
                "width": mon["width"],
                "height": mon["height"],
            }

        image = capture_screen(region=region)
        original_size = image.size
        last_original_size = original_size

        # Scale if needed
        scale_factor = 1.0
        if auto_scale and max_dimension > 0:
            image, scale_factor = scale_image_for_ai(image, max_dimension)
        last_scale_factor = scale_factor
        last_screenshot = image

        cell_width = image.size[0] // subdivisions
        cell_height = image.size[1] // subdivisions

        old_cell_w, old_cell_h, old_freq = grid_config.cell_width, grid_config.cell_height, grid_config.label_frequency
        grid_config.cell_width = cell_width
        grid_config.cell_height = cell_height
        grid_config.label_frequency = 1

        image_with_grid = render_grid_overlay(image)
        last_screenshot_with_grid = image_with_grid

        grid_config.cell_width, grid_config.cell_height, grid_config.label_frequency = old_cell_w, old_cell_h, old_freq

        image_b64 = image_to_base64(image_with_grid, format=output_format, quality=quality)

        return {
            "image_b64": image_b64,
            "width": image.size[0],
            "height": image.size[1],
            "original_width": original_size[0],
            "original_height": original_size[1],
            "scale_factor": scale_factor,
            "scaled": scale_factor != 1.0,
            "zoom_level": zoom_state.level,
            "region": region,
            "format": output_format,
            "grid": {
                "subdivisions": subdivisions,
                "cell_width": cell_width,
                "cell_height": cell_height,
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def zoom_in_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for zoom_in tool."""
    global last_screenshot, last_screenshot_with_grid, last_scale_factor, last_original_size

    cell = args.get("cell", "")
    subdivisions = args.get("subdivisions", 8)

    # Scaling parameters
    max_dimension = args.get("max_dimension", image_scale_config.max_dimension)
    auto_scale = args.get("auto_scale", image_scale_config.auto_scale)
    output_format = args.get("format", image_scale_config.format)
    quality = args.get("quality", image_scale_config.quality)

    try:
        if last_screenshot is None:
            return {"success": False, "error": "No screenshot captured. Call capture_screenshot first."}

        # Use original size for cell calculation if image was scaled
        if last_original_size is not None and last_scale_factor != 1.0:
            cell_width = last_original_size[0] // subdivisions
            cell_height = last_original_size[1] // subdivisions
        else:
            cell_width = last_screenshot.size[0] // subdivisions
            cell_height = last_screenshot.size[1] // subdivisions

        new_region = zoom_state.push_region(cell, cell_width, cell_height)

        image = capture_screen(region=new_region)
        original_size = image.size
        last_original_size = original_size

        # Scale if needed
        scale_factor = 1.0
        if auto_scale and max_dimension > 0:
            image, scale_factor = scale_image_for_ai(image, max_dimension)
        last_scale_factor = scale_factor
        last_screenshot = image

        new_cell_width = image.size[0] // subdivisions
        new_cell_height = image.size[1] // subdivisions

        old_cell_w, old_cell_h, old_freq = grid_config.cell_width, grid_config.cell_height, grid_config.label_frequency
        grid_config.cell_width = new_cell_width
        grid_config.cell_height = new_cell_height
        grid_config.label_frequency = 1

        image_with_grid = render_grid_overlay(image)
        last_screenshot_with_grid = image_with_grid

        grid_config.cell_width, grid_config.cell_height, grid_config.label_frequency = old_cell_w, old_cell_h, old_freq

        image_b64 = image_to_base64(image_with_grid, format=output_format, quality=quality)

        return {
            "image_b64": image_b64,
            "width": image.size[0],
            "height": image.size[1],
            "original_width": original_size[0],
            "original_height": original_size[1],
            "scale_factor": scale_factor,
            "scaled": scale_factor != 1.0,
            "zoom_level": zoom_state.level,
            "region": new_region,
            "cell_selected": cell,
            "format": output_format,
            "grid": {
                "subdivisions": subdivisions,
                "cell_width": new_cell_width,
                "cell_height": new_cell_height,
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def zoom_out_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for zoom_out tool."""
    global last_screenshot, last_screenshot_with_grid, last_scale_factor, last_original_size

    subdivisions = args.get("subdivisions", 8)

    # Scaling parameters
    max_dimension = args.get("max_dimension", image_scale_config.max_dimension)
    auto_scale = args.get("auto_scale", image_scale_config.auto_scale)
    output_format = args.get("format", image_scale_config.format)
    quality = args.get("quality", image_scale_config.quality)

    try:
        if zoom_state.level == 0:
            return {"success": False, "error": "Already at top level (full screen)"}

        parent_region = zoom_state.pop_region()

        if parent_region:
            region = parent_region
        else:
            monitors = get_monitors()
            mon = monitors[zoom_state.monitor_index]
            region = {
                "left": mon["left"],
                "top": mon["top"],
                "width": mon["width"],
                "height": mon["height"],
            }

        image = capture_screen(region=region)
        original_size = image.size
        last_original_size = original_size

        # Scale if needed
        scale_factor = 1.0
        if auto_scale and max_dimension > 0:
            image, scale_factor = scale_image_for_ai(image, max_dimension)
        last_scale_factor = scale_factor
        last_screenshot = image

        cell_width = image.size[0] // subdivisions
        cell_height = image.size[1] // subdivisions

        old_cell_w, old_cell_h, old_freq = grid_config.cell_width, grid_config.cell_height, grid_config.label_frequency
        grid_config.cell_width = cell_width
        grid_config.cell_height = cell_height
        grid_config.label_frequency = 1

        image_with_grid = render_grid_overlay(image)
        last_screenshot_with_grid = image_with_grid

        grid_config.cell_width, grid_config.cell_height, grid_config.label_frequency = old_cell_w, old_cell_h, old_freq

        image_b64 = image_to_base64(image_with_grid, format=output_format, quality=quality)

        return {
            "image_b64": image_b64,
            "width": image.size[0],
            "height": image.size[1],
            "original_width": original_size[0],
            "original_height": original_size[1],
            "scale_factor": scale_factor,
            "scaled": scale_factor != 1.0,
            "zoom_level": zoom_state.level,
            "region": region,
            "format": output_format,
            "grid": {
                "subdivisions": subdivisions,
                "cell_width": cell_width,
                "cell_height": cell_height,
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def zoom_click_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for zoom_click tool."""
    cell = args.get("cell", "")
    button = args.get("button", "left")
    clicks = args.get("clicks", 1)

    try:
        if last_screenshot is None:
            return {"success": False, "error": "No screenshot captured. Call capture_screenshot first."}

        cell_match = re.match(r'^([A-Za-z]+)(\d+)$', cell)
        if not cell_match:
            return {"success": False, "error": f"Invalid cell reference: {cell}"}

        col = letters_to_column(cell_match.group(1))
        row = int(cell_match.group(2)) - 1

        subdivisions = 8

        # Use original size for cell calculation if image was scaled
        if last_original_size is not None and last_scale_factor != 1.0:
            cell_width = last_original_size[0] // subdivisions
            cell_height = last_original_size[1] // subdivisions
        else:
            cell_width = last_screenshot.size[0] // subdivisions
            cell_height = last_screenshot.size[1] // subdivisions

        local_x = col * cell_width + cell_width // 2
        local_y = row * cell_height + cell_height // 2

        abs_x, abs_y = zoom_state.get_absolute_coordinates(local_x, local_y)

        result = click_at(abs_x, abs_y, button, clicks)

        if result["success"]:
            action_history.append({
                "action": "zoom_click",
                "cell": cell,
                "zoom_level": zoom_state.level,
                "local_x": local_x,
                "local_y": local_y,
                "absolute_x": abs_x,
                "absolute_y": abs_y,
                "button": button,
                "clicks": clicks,
                "timestamp": datetime.now().isoformat(),
            })
            result["local"] = {"x": local_x, "y": local_y}
            result["absolute"] = {"x": abs_x, "y": abs_y}
            result["cell"] = cell
            result["zoom_level"] = zoom_state.level

        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


async def zoom_reset_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for zoom_reset tool."""
    zoom_state.reset()
    return {"level": 0, "message": "Zoom reset to full screen"}


async def get_history_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for get_history tool."""
    limit = args.get("limit", 50)
    return {"history": action_history[-limit:], "total": len(action_history)}


async def clear_history_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for clear_history tool."""
    global action_history
    action_history = []
    return {"message": "History cleared"}


# ============================================
# Register MCP Tools
# ============================================

# Screenshot and capture tools
tool_client.register_tool(
    name="grid_capture_screenshot",
    namespace="screen",
    description="Capture a screenshot with optional coordinate grid overlay. Images are automatically scaled to AI-friendly dimensions (max 1568px by default).",
    parameters={
        "properties": {
            "monitor_index": {"type": "integer", "description": "Monitor index (1 = primary)", "default": 1},
            "render_grid": {"type": "boolean", "description": "Whether to render grid overlay", "default": True},
            "max_dimension": {"type": "integer", "description": "Max pixels on longest side (default: 1568, set 0 to disable scaling)", "default": 1568},
            "format": {"type": "string", "enum": ["PNG", "JPEG"], "description": "Output image format", "default": "PNG"},
            "quality": {"type": "integer", "description": "JPEG quality if format is JPEG (1-100)", "default": 85}
        },
        "required": []
    },
    handler=capture_screenshot_handler
)

tool_client.register_tool(
    name="grid_translate_coordinate",
    namespace="screen",
    description="Convert a cell reference (A1, B4) or pixel coordinate to screen position",
    parameters={
        "properties": {
            "coordinate": {"type": "string", "description": "Cell reference (A1, B4, AA15) or pixel coords (320,150)"}
        },
        "required": ["coordinate"]
    },
    handler=translate_coordinate_handler
)

# Input simulation tools
tool_client.register_tool(
    name="grid_click",
    namespace="screen",
    description="Click at a coordinate (cell reference or pixels)",
    parameters={
        "properties": {
            "coordinate": {"type": "string", "description": "Cell reference or pixel coordinate"},
            "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
            "clicks": {"type": "integer", "description": "Number of clicks", "default": 1}
        },
        "required": ["coordinate"]
    },
    handler=click_handler
)

tool_client.register_tool(
    name="grid_move",
    namespace="screen",
    description="Move mouse cursor to a coordinate",
    parameters={
        "properties": {
            "coordinate": {"type": "string", "description": "Cell reference or pixel coordinate"},
            "duration": {"type": "number", "description": "Movement duration in seconds", "default": 0.1}
        },
        "required": ["coordinate"]
    },
    handler=move_handler
)

tool_client.register_tool(
    name="grid_drag",
    namespace="screen",
    description="Drag from one coordinate to another",
    parameters={
        "properties": {
            "start_coordinate": {"type": "string", "description": "Starting position"},
            "end_coordinate": {"type": "string", "description": "Ending position"},
            "duration": {"type": "number", "description": "Drag duration in seconds", "default": 0.3},
            "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"}
        },
        "required": ["start_coordinate", "end_coordinate"]
    },
    handler=drag_handler
)

tool_client.register_tool(
    name="grid_type_text",
    namespace="screen",
    description="Type text at the current cursor position",
    parameters={
        "properties": {
            "text": {"type": "string", "description": "Text to type"},
            "interval": {"type": "number", "description": "Interval between keystrokes", "default": 0.02}
        },
        "required": ["text"]
    },
    handler=type_text_handler
)

tool_client.register_tool(
    name="grid_press_key",
    namespace="screen",
    description="Press a key or key combination (e.g., 'ctrl+c', 'enter', 'alt+tab')",
    parameters={
        "properties": {
            "keys": {"type": "string", "description": "Key combination to press"}
        },
        "required": ["keys"]
    },
    handler=press_key_handler
)

tool_client.register_tool(
    name="grid_scroll",
    namespace="screen",
    description="Scroll at a coordinate (positive = up, negative = down)",
    parameters={
        "properties": {
            "coordinate": {"type": "string", "description": "Cell reference or pixel coordinate"},
            "clicks": {"type": "integer", "description": "Scroll amount (positive=up, negative=down)", "default": 3}
        },
        "required": ["coordinate"]
    },
    handler=scroll_handler
)

# Status and configuration tools
tool_client.register_tool(
    name="grid_get_mouse_position",
    namespace="screen",
    description="Get the current mouse cursor position",
    parameters={"properties": {}, "required": []},
    handler=get_mouse_position_handler
)

tool_client.register_tool(
    name="grid_get_monitors",
    namespace="screen",
    description="List available monitors and their dimensions",
    parameters={"properties": {}, "required": []},
    handler=get_monitors_handler
)

tool_client.register_tool(
    name="grid_get_grid_config",
    namespace="screen",
    description="Get the current grid configuration",
    parameters={"properties": {}, "required": []},
    handler=get_grid_config_handler
)

tool_client.register_tool(
    name="grid_set_grid_config",
    namespace="screen",
    description="Update grid configuration (density, cell size, labels)",
    parameters={
        "properties": {
            "density": {"type": "string", "enum": ["coarse", "medium", "fine", "ultra"], "description": "Grid density preset"},
            "cell_width": {"type": "integer", "description": "Custom cell width in pixels"},
            "cell_height": {"type": "integer", "description": "Custom cell height in pixels"},
            "show_labels": {"type": "boolean", "description": "Whether to show cell labels"},
            "label_frequency": {"type": "integer", "description": "Show label every N cells"}
        },
        "required": []
    },
    handler=set_grid_config_handler
)

# Image scaling configuration tools
tool_client.register_tool(
    name="grid_get_scale_config",
    namespace="screen",
    description="Get current image scaling configuration",
    parameters={"properties": {}, "required": []},
    handler=get_scale_config_handler
)

tool_client.register_tool(
    name="grid_set_scale_config",
    namespace="screen",
    description="Configure image scaling for AI-friendly output",
    parameters={
        "properties": {
            "max_dimension": {"type": "integer", "description": "Maximum pixels on longest side (default: 1568, set 0 to disable)", "default": 1568},
            "auto_scale": {"type": "boolean", "description": "Automatically scale large images", "default": True},
            "format": {"type": "string", "enum": ["PNG", "JPEG"], "description": "Output format", "default": "PNG"},
            "quality": {"type": "integer", "description": "JPEG quality (1-100)", "default": 85}
        },
        "required": []
    },
    handler=set_scale_config_handler
)

# Zoom/hierarchical tools
tool_client.register_tool(
    name="grid_zoom_capture",
    namespace="screen",
    description="Capture the current zoom region with a subdivided grid. Images are automatically scaled to AI-friendly dimensions.",
    parameters={
        "properties": {
            "monitor_index": {"type": "integer", "description": "Monitor index", "default": 1},
            "subdivisions": {"type": "integer", "description": "Grid subdivisions per axis", "default": 8},
            "max_dimension": {"type": "integer", "description": "Max pixels on longest side (default: 1568)", "default": 1568},
            "format": {"type": "string", "enum": ["PNG", "JPEG"], "description": "Output image format", "default": "PNG"},
            "quality": {"type": "integer", "description": "JPEG quality if format is JPEG (1-100)", "default": 85}
        },
        "required": []
    },
    handler=zoom_capture_handler
)

tool_client.register_tool(
    name="grid_zoom_in",
    namespace="screen",
    description="Zoom into a specific cell, making it the new viewport. Images are automatically scaled to AI-friendly dimensions.",
    parameters={
        "properties": {
            "cell": {"type": "string", "description": "Cell to zoom into (e.g., 'B3')"},
            "subdivisions": {"type": "integer", "description": "Grid subdivisions for zoomed view", "default": 8},
            "max_dimension": {"type": "integer", "description": "Max pixels on longest side (default: 1568)", "default": 1568},
            "format": {"type": "string", "enum": ["PNG", "JPEG"], "description": "Output image format", "default": "PNG"},
            "quality": {"type": "integer", "description": "JPEG quality if format is JPEG (1-100)", "default": 85}
        },
        "required": ["cell"]
    },
    handler=zoom_in_handler
)

tool_client.register_tool(
    name="grid_zoom_out",
    namespace="screen",
    description="Zoom out one level to the parent region. Images are automatically scaled to AI-friendly dimensions.",
    parameters={
        "properties": {
            "subdivisions": {"type": "integer", "description": "Grid subdivisions", "default": 8},
            "max_dimension": {"type": "integer", "description": "Max pixels on longest side (default: 1568)", "default": 1568},
            "format": {"type": "string", "enum": ["PNG", "JPEG"], "description": "Output image format", "default": "PNG"},
            "quality": {"type": "integer", "description": "JPEG quality if format is JPEG (1-100)", "default": 85}
        },
        "required": []
    },
    handler=zoom_out_handler
)

tool_client.register_tool(
    name="grid_zoom_click",
    namespace="screen",
    description="Click at a cell within the current zoom level",
    parameters={
        "properties": {
            "cell": {"type": "string", "description": "Cell to click within zoomed view"},
            "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
            "clicks": {"type": "integer", "description": "Number of clicks", "default": 1}
        },
        "required": ["cell"]
    },
    handler=zoom_click_handler
)

tool_client.register_tool(
    name="grid_zoom_reset",
    namespace="screen",
    description="Reset zoom to full screen view",
    parameters={"properties": {}, "required": []},
    handler=zoom_reset_handler
)

# History tools
tool_client.register_tool(
    name="grid_get_history",
    namespace="screen",
    description="Get the action history log",
    parameters={
        "properties": {
            "limit": {"type": "integer", "description": "Maximum number of entries to return", "default": 50}
        },
        "required": []
    },
    handler=get_history_handler
)

tool_client.register_tool(
    name="grid_clear_history",
    namespace="screen",
    description="Clear the action history log",
    parameters={"properties": {}, "required": []},
    handler=clear_history_handler
)

# Add tool router for MCP endpoints
app.include_router(create_tool_router(tool_client))


# ============================================
# Request/Response Models
# ============================================

class GridConfigUpdate(BaseModel):
    density: Optional[str] = None
    cell_width: Optional[int] = None
    cell_height: Optional[int] = None
    show_labels: Optional[bool] = None
    label_frequency: Optional[int] = None
    grid_color: Optional[List[int]] = None  # RGBA
    label_color: Optional[List[int]] = None  # RGBA


class CaptureRequest(BaseModel):
    monitor_index: int = 1  # Default to primary monitor
    region: Optional[Dict[str, int]] = None  # {left, top, width, height}
    render_grid: bool = True


class CoordinateRequest(BaseModel):
    coordinate: str  # "A1", "B4", "320,150", etc.


class ClickRequest(BaseModel):
    coordinate: str
    button: str = "left"  # left, right, middle
    clicks: int = 1


class MoveRequest(BaseModel):
    coordinate: str
    duration: float = 0.1


class DragRequest(BaseModel):
    start_coordinate: str
    end_coordinate: str
    duration: float = 0.3
    button: str = "left"


class TypeRequest(BaseModel):
    text: str
    interval: float = 0.02


class KeyRequest(BaseModel):
    keys: str  # e.g., "ctrl+c", "enter", "alt+tab"


class ScrollRequest(BaseModel):
    coordinate: str
    clicks: int  # Positive = up, negative = down


class ZoomInRequest(BaseModel):
    cell: str  # Cell to zoom into (e.g., "B3")
    subdivisions: int = 8  # How many cells to divide the zoomed region into (per axis)


class ZoomClickRequest(BaseModel):
    cell: str  # Cell to click within current zoom level
    button: str = "left"
    clicks: int = 1


# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    return {"status": "online", "service": "Screen Grid Harness Server"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/status")
async def status():
    return {
        "grid_config": {
            "density": grid_config.density,
            "cell_width": grid_config.cell_width,
            "cell_height": grid_config.cell_height,
            "show_labels": grid_config.show_labels,
            "label_frequency": grid_config.label_frequency,
        },
        "action_count": len(action_history),
        "has_screenshot": last_screenshot is not None,
    }


@app.get("/monitors")
async def get_monitor_list():
    """Get list of available monitors."""
    try:
        monitors = get_monitors()
        return {"success": True, "monitors": monitors}
    except Exception as e:
        add_log(f"Error getting monitors: {e}")
        return {"success": False, "error": str(e)}


@app.get("/grid_config")
async def get_grid_config():
    """Get current grid configuration."""
    return {
        "density": grid_config.density,
        "cell_width": grid_config.cell_width,
        "cell_height": grid_config.cell_height,
        "show_labels": grid_config.show_labels,
        "label_frequency": grid_config.label_frequency,
        "grid_color": list(grid_config.grid_color),
        "label_color": list(grid_config.label_color),
    }


@app.post("/grid_config")
async def update_grid_config(config: GridConfigUpdate):
    """Update grid configuration."""
    if config.density:
        grid_config.apply_density(config.density)
    if config.cell_width is not None:
        grid_config.cell_width = config.cell_width
        grid_config.density = "custom"
    if config.cell_height is not None:
        grid_config.cell_height = config.cell_height
        grid_config.density = "custom"
    if config.show_labels is not None:
        grid_config.show_labels = config.show_labels
    if config.label_frequency is not None:
        grid_config.label_frequency = config.label_frequency
    if config.grid_color is not None:
        grid_config.grid_color = tuple(config.grid_color)
    if config.label_color is not None:
        grid_config.label_color = tuple(config.label_color)

    add_log(f"Grid config updated: {grid_config.density} ({grid_config.cell_width}x{grid_config.cell_height})")
    return {"success": True, "config": await get_grid_config()}


@app.post("/capture")
async def capture(request: CaptureRequest):
    """Capture screenshot with optional grid overlay."""
    global last_screenshot, last_screenshot_with_grid

    try:
        add_log(f"Capturing screen (monitor {request.monitor_index})...")

        # Capture screenshot
        image = capture_screen(request.monitor_index, request.region)
        last_screenshot = image

        # Apply grid if requested
        if request.render_grid:
            image_with_grid = render_grid_overlay(image)
            last_screenshot_with_grid = image_with_grid
            result_image = image_with_grid
        else:
            last_screenshot_with_grid = None
            result_image = image

        # Convert to base64
        image_b64 = image_to_base64(result_image)

        add_log(f"Captured {image.size[0]}x{image.size[1]} screenshot")

        return {
            "success": True,
            "image_b64": image_b64,
            "width": image.size[0],
            "height": image.size[1],
            "grid_applied": request.render_grid,
            "grid_config": {
                "density": grid_config.density,
                "cell_width": grid_config.cell_width,
                "cell_height": grid_config.cell_height,
            }
        }
    except Exception as e:
        add_log(f"Capture error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/translate")
async def translate_coordinate(request: CoordinateRequest):
    """Translate a coordinate reference to pixel coordinates."""
    try:
        if last_screenshot is None:
            # Use a default screen size if no screenshot
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        x, y = parse_coordinate(request.coordinate, width, height)
        cell = get_cell_at_pixel(x, y)

        return {
            "success": True,
            "coordinate": request.coordinate,
            "x": x,
            "y": y,
            "cell": cell,
        }
    except Exception as e:
        add_log(f"Translation error: {e}")
        return {"success": False, "error": str(e)}


@app.post("/click")
async def click(request: ClickRequest):
    """Click at a coordinate."""
    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        x, y = parse_coordinate(request.coordinate, width, height)
        result = click_at(x, y, request.button, request.clicks)

        if result["success"]:
            action_history.append({
                "action": "click",
                "coordinate": request.coordinate,
                "x": x,
                "y": y,
                "button": request.button,
                "clicks": request.clicks,
                "timestamp": datetime.now().isoformat(),
            })

        return result
    except Exception as e:
        add_log(f"Click error: {e}")
        return {"success": False, "error": str(e)}


@app.post("/move")
async def move(request: MoveRequest):
    """Move mouse to a coordinate."""
    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        x, y = parse_coordinate(request.coordinate, width, height)
        result = move_to(x, y, request.duration)

        if result["success"]:
            action_history.append({
                "action": "move",
                "coordinate": request.coordinate,
                "x": x,
                "y": y,
                "timestamp": datetime.now().isoformat(),
            })

        return result
    except Exception as e:
        add_log(f"Move error: {e}")
        return {"success": False, "error": str(e)}


@app.post("/drag")
async def drag(request: DragRequest):
    """Drag from one coordinate to another."""
    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        start_x, start_y = parse_coordinate(request.start_coordinate, width, height)
        end_x, end_y = parse_coordinate(request.end_coordinate, width, height)

        result = drag_to(start_x, start_y, end_x, end_y, request.duration, request.button)

        if result["success"]:
            action_history.append({
                "action": "drag",
                "start_coordinate": request.start_coordinate,
                "end_coordinate": request.end_coordinate,
                "start": {"x": start_x, "y": start_y},
                "end": {"x": end_x, "y": end_y},
                "timestamp": datetime.now().isoformat(),
            })

        return result
    except Exception as e:
        add_log(f"Drag error: {e}")
        return {"success": False, "error": str(e)}


@app.post("/type")
async def type_text_endpoint(request: TypeRequest):
    """Type text at current cursor position."""
    result = type_text(request.text, request.interval)

    if result["success"]:
        action_history.append({
            "action": "type",
            "text": request.text,
            "timestamp": datetime.now().isoformat(),
        })

    return result


@app.post("/key")
async def press_key_endpoint(request: KeyRequest):
    """Press a key or key combination."""
    result = press_key(request.keys)

    if result["success"]:
        action_history.append({
            "action": "key",
            "keys": request.keys,
            "timestamp": datetime.now().isoformat(),
        })

    return result


@app.post("/scroll")
async def scroll(request: ScrollRequest):
    """Scroll at a coordinate."""
    try:
        if last_screenshot is None:
            width, height = 1920, 1080
        else:
            width, height = last_screenshot.size

        x, y = parse_coordinate(request.coordinate, width, height)
        result = scroll_at(x, y, request.clicks)

        if result["success"]:
            action_history.append({
                "action": "scroll",
                "coordinate": request.coordinate,
                "x": x,
                "y": y,
                "clicks": request.clicks,
                "timestamp": datetime.now().isoformat(),
            })

        return result
    except Exception as e:
        add_log(f"Scroll error: {e}")
        return {"success": False, "error": str(e)}


@app.get("/history")
async def get_history(limit: int = 50):
    """Get action history."""
    return {
        "success": True,
        "history": action_history[-limit:],
        "total": len(action_history),
    }


@app.post("/history/clear")
async def clear_history():
    """Clear action history."""
    global action_history
    action_history = []
    add_log("History cleared")
    return {"success": True}


@app.get("/mouse_position")
async def get_mouse_position():
    """Get current mouse position."""
    try:
        x, y = pyautogui.position()
        cell = get_cell_at_pixel(x, y)
        return {
            "success": True,
            "x": x,
            "y": y,
            "cell": cell,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# Hierarchical Zoom/Reduction Endpoints
# ============================================

@app.get("/zoom/status")
async def zoom_status():
    """Get current zoom state."""
    return {
        "success": True,
        "level": zoom_state.level,
        "current_region": zoom_state.current_region,
        "stack_depth": len(zoom_state.region_stack),
        "monitor_index": zoom_state.monitor_index,
    }


@app.post("/zoom/reset")
async def zoom_reset():
    """Reset zoom to full screen view."""
    zoom_state.reset()
    add_log("Zoom reset to full screen")
    return {"success": True, "level": 0}


@app.post("/zoom/capture")
async def zoom_capture(monitor_index: int = 1, subdivisions: int = 8):
    """
    Capture the current zoom region (or full screen if level 0) with a grid overlay.
    The grid will have `subdivisions` cells per axis.
    """
    global last_screenshot, last_screenshot_with_grid

    try:
        # Set monitor offset if at level 0
        if zoom_state.level == 0:
            monitors = get_monitors()
            if monitor_index < len(monitors):
                mon = monitors[monitor_index]
                zoom_state.monitor_offset = {"left": mon["left"], "top": mon["top"]}
                zoom_state.monitor_index = monitor_index

        # Determine capture region
        if zoom_state.current_region:
            region = zoom_state.current_region
            add_log(f"Capturing zoomed region level {zoom_state.level}: {region}")
        else:
            # Full monitor capture
            monitors = get_monitors()
            if monitor_index >= len(monitors):
                monitor_index = 1
            mon = monitors[monitor_index]
            region = {
                "left": mon["left"],
                "top": mon["top"],
                "width": mon["width"],
                "height": mon["height"],
            }
            add_log(f"Capturing full monitor {monitor_index}: {region['width']}x{region['height']}")

        # Capture the region
        image = capture_screen(region=region)
        last_screenshot = image

        # Calculate cell size for this capture
        cell_width = image.size[0] // subdivisions
        cell_height = image.size[1] // subdivisions

        # Temporarily set grid config for this capture
        old_cell_w = grid_config.cell_width
        old_cell_h = grid_config.cell_height
        old_freq = grid_config.label_frequency

        grid_config.cell_width = cell_width
        grid_config.cell_height = cell_height
        grid_config.label_frequency = 1  # Label every cell for zoom view

        # Render grid
        image_with_grid = render_grid_overlay(image)
        last_screenshot_with_grid = image_with_grid

        # Restore grid config
        grid_config.cell_width = old_cell_w
        grid_config.cell_height = old_cell_h
        grid_config.label_frequency = old_freq

        # Convert to base64
        image_b64 = image_to_base64(image_with_grid)

        return {
            "success": True,
            "image_b64": image_b64,
            "width": image.size[0],
            "height": image.size[1],
            "zoom_level": zoom_state.level,
            "region": region,
            "grid": {
                "subdivisions": subdivisions,
                "cell_width": cell_width,
                "cell_height": cell_height,
                "columns": subdivisions,
                "rows": subdivisions,
            }
        }
    except Exception as e:
        add_log(f"Zoom capture error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/zoom/in")
async def zoom_in(request: ZoomInRequest):
    """
    Zoom into a specific cell, making it the new viewport.
    Returns a new capture of just that cell with a fresh grid.
    """
    global last_screenshot, last_screenshot_with_grid

    try:
        # Get current image dimensions to calculate cell size
        if last_screenshot is None:
            return {"success": False, "error": "No screenshot captured. Call /zoom/capture first."}

        # Calculate current cell dimensions based on last capture
        # We need to know how many subdivisions were used
        # For now, assume standard subdivisions of 8
        subdivisions = request.subdivisions
        cell_width = last_screenshot.size[0] // subdivisions
        cell_height = last_screenshot.size[1] // subdivisions

        # Push the new region onto the zoom stack
        new_region = zoom_state.push_region(request.cell, cell_width, cell_height)

        add_log(f"Zoomed into cell {request.cell} -> level {zoom_state.level}, region: {new_region}")

        # Capture the new zoomed region
        image = capture_screen(region=new_region)
        last_screenshot = image

        # Calculate new cell size for the zoomed view
        new_cell_width = image.size[0] // subdivisions
        new_cell_height = image.size[1] // subdivisions

        # Temporarily set grid config
        old_cell_w = grid_config.cell_width
        old_cell_h = grid_config.cell_height
        old_freq = grid_config.label_frequency

        grid_config.cell_width = new_cell_width
        grid_config.cell_height = new_cell_height
        grid_config.label_frequency = 1

        # Render grid
        image_with_grid = render_grid_overlay(image)
        last_screenshot_with_grid = image_with_grid

        # Restore grid config
        grid_config.cell_width = old_cell_w
        grid_config.cell_height = old_cell_h
        grid_config.label_frequency = old_freq

        # Convert to base64
        image_b64 = image_to_base64(image_with_grid)

        return {
            "success": True,
            "image_b64": image_b64,
            "width": image.size[0],
            "height": image.size[1],
            "zoom_level": zoom_state.level,
            "region": new_region,
            "cell_selected": request.cell,
            "grid": {
                "subdivisions": subdivisions,
                "cell_width": new_cell_width,
                "cell_height": new_cell_height,
            }
        }
    except Exception as e:
        add_log(f"Zoom in error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/zoom/out")
async def zoom_out(subdivisions: int = 8):
    """
    Zoom out one level. Returns capture of the parent region.
    """
    global last_screenshot, last_screenshot_with_grid

    try:
        if zoom_state.level == 0:
            return {"success": False, "error": "Already at top level (full screen)"}

        # Pop the zoom stack
        parent_region = zoom_state.pop_region()

        if parent_region:
            add_log(f"Zoomed out to level {zoom_state.level}, region: {parent_region}")
            region = parent_region
        else:
            # Back to full screen
            add_log(f"Zoomed out to full screen (level 0)")
            monitors = get_monitors()
            mon = monitors[zoom_state.monitor_index]
            region = {
                "left": mon["left"],
                "top": mon["top"],
                "width": mon["width"],
                "height": mon["height"],
            }

        # Capture the region
        image = capture_screen(region=region)
        last_screenshot = image

        # Calculate cell size
        cell_width = image.size[0] // subdivisions
        cell_height = image.size[1] // subdivisions

        # Temporarily set grid config
        old_cell_w = grid_config.cell_width
        old_cell_h = grid_config.cell_height
        old_freq = grid_config.label_frequency

        grid_config.cell_width = cell_width
        grid_config.cell_height = cell_height
        grid_config.label_frequency = 1

        # Render grid
        image_with_grid = render_grid_overlay(image)
        last_screenshot_with_grid = image_with_grid

        # Restore grid config
        grid_config.cell_width = old_cell_w
        grid_config.cell_height = old_cell_h
        grid_config.label_frequency = old_freq

        # Convert to base64
        image_b64 = image_to_base64(image_with_grid)

        return {
            "success": True,
            "image_b64": image_b64,
            "width": image.size[0],
            "height": image.size[1],
            "zoom_level": zoom_state.level,
            "region": region,
            "grid": {
                "subdivisions": subdivisions,
                "cell_width": cell_width,
                "cell_height": cell_height,
            }
        }
    except Exception as e:
        add_log(f"Zoom out error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/zoom/click")
async def zoom_click(request: ZoomClickRequest):
    """
    Click at a cell within the current zoom level.
    Translates the cell reference to absolute screen coordinates and clicks.
    """
    try:
        if last_screenshot is None:
            return {"success": False, "error": "No screenshot captured. Call /zoom/capture first."}

        # Parse cell reference
        cell_match = re.match(r'^([A-Za-z]+)(\d+)$', request.cell)
        if not cell_match:
            return {"success": False, "error": f"Invalid cell reference: {request.cell}"}

        col = letters_to_column(cell_match.group(1))
        row = int(cell_match.group(2)) - 1

        # Calculate cell dimensions from last screenshot (assume 8 subdivisions default)
        subdivisions = 8
        cell_width = last_screenshot.size[0] // subdivisions
        cell_height = last_screenshot.size[1] // subdivisions

        # Calculate local coordinates (center of cell)
        local_x = col * cell_width + cell_width // 2
        local_y = row * cell_height + cell_height // 2

        # Convert to absolute screen coordinates
        abs_x, abs_y = zoom_state.get_absolute_coordinates(local_x, local_y)

        add_log(f"Zoom click: cell {request.cell} -> local ({local_x}, {local_y}) -> absolute ({abs_x}, {abs_y})")

        # Perform the click
        result = click_at(abs_x, abs_y, request.button, request.clicks)

        if result["success"]:
            action_history.append({
                "action": "zoom_click",
                "cell": request.cell,
                "zoom_level": zoom_state.level,
                "local_x": local_x,
                "local_y": local_y,
                "absolute_x": abs_x,
                "absolute_y": abs_y,
                "button": request.button,
                "clicks": request.clicks,
                "timestamp": datetime.now().isoformat(),
            })
            result["local"] = {"x": local_x, "y": local_y}
            result["absolute"] = {"x": abs_x, "y": abs_y}
            result["cell"] = request.cell
            result["zoom_level"] = zoom_state.level

        return result
    except Exception as e:
        add_log(f"Zoom click error: {e}")
        return {"success": False, "error": str(e)}


# ============================================
# Startup / Shutdown Events
# ============================================

@app.on_event("startup")
async def startup():
    """Register tools with central registry on startup."""
    add_log(f"Starting {SERVER_NAME} on port {PORT}...")

    # Connect to registry and publish tools
    await tool_client.connect()
    success = await tool_client.publish_tools_to_registry()

    if success:
        add_log(f"Tools registered with central registry ({len(tool_client.registered_tools)} tools)")
    else:
        add_log("Warning: Could not register with registry (is ContextUI running?)")


@app.on_event("shutdown")
async def on_shutdown():
    """Unregister tools on shutdown."""
    add_log("Shutting down...")
    await tool_client.unregister_from_registry()
    await tool_client.disconnect()


@app.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server."""
    add_log("Shutdown requested...")
    import asyncio
    asyncio.get_event_loop().call_later(0.5, lambda: os._exit(0))
    return {"success": True, "message": "Server shutting down"}


if __name__ == "__main__":
    import logging
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    print(f"Starting Screen Grid Harness server on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
