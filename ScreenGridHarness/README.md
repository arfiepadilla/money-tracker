# Screen Grid Harness

A tool for AI-driven automation of **any** application or website using native OS-level input simulation. Unlike browser automation tools (Puppeteer, Selenium), this tool is completely undetectable because it uses real mouse movements and keystrokes at the operating system level.

## How It Works

1. **Screenshot Capture** - Uses `mss` to capture the actual screen (not browser APIs)
2. **Grid Overlay** - Renders a coordinate grid on the screenshot with cell labels (A1, B4, AA15, etc.)
3. **Coordinate Reference** - Claude (or any AI) views the grid and specifies locations using cell references
4. **Native Input** - Uses `pyautogui` to send real OS-level mouse/keyboard events

## Features

- **Spreadsheet-style coordinates**: Reference cells like "A1", "B4", "AA15"
- **Direct pixel coordinates**: Use "320,150" for exact positioning
- **Multiple grid densities**: Coarse (100px), Medium (50px), Fine (25px), Ultra (10px)
- **Full input simulation**: Click, double-click, right-click, drag, type, key combinations, scroll
- **Multi-monitor support**: Capture any connected display
- **Action history**: Track all executed actions

## Dependencies

Required Python packages:
- `fastapi` - Web server
- `uvicorn` - ASGI server
- `mss` - Fast cross-platform screen capture
- `pillow` - Image processing for grid overlay
- `pyautogui` - Native mouse/keyboard simulation

## API Endpoints

### Screenshot & Grid

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/capture` | POST | Capture screenshot with optional grid overlay |
| `/monitors` | GET | List available monitors |
| `/grid_config` | GET/POST | Get or update grid configuration |
| `/translate` | POST | Translate coordinate reference to pixels |

### Input Actions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/click` | POST | Click at coordinate |
| `/move` | POST | Move mouse to coordinate |
| `/drag` | POST | Drag from one coordinate to another |
| `/type` | POST | Type text at current cursor |
| `/key` | POST | Press key combination (e.g., "ctrl+c") |
| `/scroll` | POST | Scroll at coordinate |

### Utility

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mouse_position` | GET | Get current mouse position |
| `/history` | GET | Get action history |
| `/status` | GET | Server status and config |

## Coordinate Formats

The system accepts coordinates in multiple formats:

| Format | Example | Description |
|--------|---------|-------------|
| Cell reference | `A1`, `B4`, `AA15` | Returns center of the cell |
| Pixel coordinates | `320,150` | Direct x,y position |
| With parentheses | `(320, 150)` | Also valid |

## Usage Example

```python
import requests

SERVER = "http://127.0.0.1:8790"

# 1. Configure grid density
requests.post(f"{SERVER}/grid_config", json={"density": "medium"})

# 2. Capture screenshot with grid
response = requests.post(f"{SERVER}/capture", json={
    "monitor_index": 1,
    "render_grid": True
})
# response.json()["image_b64"] contains the base64 PNG

# 3. Click using cell reference
requests.post(f"{SERVER}/click", json={
    "coordinate": "D5",
    "button": "left",
    "clicks": 1
})

# 4. Type text
requests.post(f"{SERVER}/type", json={
    "text": "Hello, World!",
    "interval": 0.02
})

# 5. Press key combination
requests.post(f"{SERVER}/key", json={"keys": "ctrl+s"})
```

## AI Integration

When used with Claude or another vision-capable AI:

1. Capture a screenshot with grid overlay
2. Send the image to Claude
3. Ask Claude to identify the target (e.g., "Where is the Sign In button?")
4. Claude responds with a cell reference (e.g., "The Sign In button is in cell E3")
5. Execute the click at that coordinate

This approach is:
- **Undetectable**: Real mouse/keyboard events, not JavaScript injection
- **Universal**: Works on any application, not just browsers
- **Reliable**: Grid references are unambiguous

## Grid Density Selection

| Density | Cell Size | Best For |
|---------|-----------|----------|
| Coarse | 100x100px | Large buttons, simple UIs |
| Medium | 50x50px | General purpose |
| Fine | 25x25px | Precision clicking |
| Ultra | 10x10px | Pixel-perfect accuracy |

For most web pages, **Medium** works well. Use **Fine** or **Ultra** when you need to click small UI elements.
