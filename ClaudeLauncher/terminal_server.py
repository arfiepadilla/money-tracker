"""
Terminal Server - PTY WebSocket Bridge
Provides a WebSocket interface to a pseudo-terminal for shell access.
"""

import asyncio
import os
import sys
import json
import signal
import subprocess
import threading
import queue
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# For Windows, we need to use a different approach since PTY isn't available
IS_WINDOWS = sys.platform == 'win32'

app = FastAPI(title="Terminal Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active terminal sessions
terminals = {}


class WindowsTerminal:
    """Windows terminal using pywinpty for proper ConPTY support."""

    def __init__(self, shell: str = None, cwd: str = None, env: dict = None, venv_path: str = None):
        self.shell = shell or 'cmd'
        self.cwd = cwd
        self.env = env  # Custom environment variables
        self.venv_path = venv_path  # Path to Python venv to activate
        self.pty = None
        self.running = False
        self.cols = 120
        self.rows = 30
        self.output_queue = queue.Queue()
        self.reader_thread = None

    async def start(self):
        """Start the shell process with ConPTY."""
        # Try to import winpty - structure varies between versions
        global WinPtyProcess
        WinPtyProcess = None

        try:
            from winpty import PtyProcess as WinPtyProcess
        except ImportError:
            raise RuntimeError("pywinpty PtyProcess is required - install with: pip install pywinpty")

        # Build command - use shell directly, not wrapped in cmd /c
        if self.shell == 'powershell' or 'powershell' in self.shell.lower():
            # Use PowerShell with execution policy and conda hook if available
            cmd = 'powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass'
        elif self.shell == 'bash':
            cmd = 'wsl.exe bash -l'
        elif self.shell == 'cmd':
            cmd = 'cmd.exe /k'  # /k keeps the session open
        else:
            # Default to cmd for better conda compatibility
            cmd = 'cmd.exe /k'

        try:
            # Build environment - start with current env, add custom vars
            spawn_env = os.environ.copy()
            if self.env:
                spawn_env.update(self.env)

            # If venv_path is provided, modify PATH and set VIRTUAL_ENV
            if self.venv_path:
                venv_scripts = os.path.join(self.venv_path, 'Scripts')
                print(f"Checking venv Scripts path: {venv_scripts}")
                if os.path.exists(venv_scripts):
                    # Prepend venv Scripts to PATH
                    spawn_env['PATH'] = venv_scripts + os.pathsep + spawn_env.get('PATH', '')
                    spawn_env['VIRTUAL_ENV'] = self.venv_path
                    # Remove PYTHONHOME if set (can interfere with venv)
                    spawn_env.pop('PYTHONHOME', None)
                    print(f"Activating venv: {self.venv_path}")
                    print(f"  VIRTUAL_ENV={spawn_env['VIRTUAL_ENV']}")
                    print(f"  PATH starts with: {spawn_env['PATH'][:200]}...")
                    # Verify python.exe exists
                    python_exe = os.path.join(venv_scripts, 'python.exe')
                    print(f"  python.exe exists: {os.path.exists(python_exe)}")
                else:
                    print(f"WARNING: venv Scripts folder not found: {venv_scripts}")

            # Spawn PTY with dimensions (rows, cols) and environment
            self.pty = WinPtyProcess.spawn(cmd, dimensions=(self.rows, self.cols),
                                           cwd=self.cwd, env=spawn_env)
            self.running = True
            print(f"Started PTY shell: {cmd}")

            # Start reader thread (like your OpenGL version)
            self.reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
            self.reader_thread.start()

        except Exception as e:
            print(f"Failed to start PTY: {e}")
            raise

    def _reader_loop(self):
        """Background thread to read PTY output."""
        try:
            while self.running and self.pty and self.pty.isalive():
                try:
                    # Read from PTY (this blocks until data available)
                    data = self.pty.read(1024)
                    if data:
                        self.output_queue.put(data)
                    else:
                        import time
                        time.sleep(0.01)
                except EOFError:
                    break
                except Exception as e:
                    print(f"PTY read error: {e}")
                    break
        finally:
            self.running = False
            self.output_queue.put(None)  # Signal end

    async def read(self) -> str:
        """Read output from the queue (non-blocking)."""
        if not self.running:
            return ""

        output = ""
        try:
            # Get all available data from queue
            while True:
                try:
                    data = self.output_queue.get_nowait()
                    if data is None:
                        self.running = False
                        return output + "\r\n[Terminal closed]\r\n"
                    output += data
                except queue.Empty:
                    break
            return output
        except Exception as e:
            print(f"Read error: {e}")
            return ""

    async def write(self, data: str):
        """Write input to PTY."""
        if not self.pty or not self.running:
            return
        try:
            # Write character by character like your OpenGL version does
            for ch in data:
                self.pty.write(ch)
        except Exception as e:
            print(f"Error writing to PTY: {e}")

    def resize(self, cols: int, rows: int):
        """Resize the PTY."""
        self.cols = cols
        self.rows = rows
        if self.pty:
            try:
                self.pty.setwinsize(rows, cols)
            except Exception as e:
                print(f"Error resizing PTY: {e}")

    def terminate(self):
        """Terminate the PTY."""
        self.running = False
        if self.pty:
            try:
                self.pty.terminate(force=True)
            except:
                pass


class UnixTerminal:
    """Unix terminal using PTY."""

    def __init__(self, shell: str = None):
        self.shell = shell or os.environ.get('SHELL', '/bin/bash')
        self.master_fd = None
        self.pid = None
        self.running = False

    async def start(self):
        """Start the shell with PTY."""
        import pty
        import termios
        import struct
        import fcntl

        self.pid, self.master_fd = pty.fork()

        if self.pid == 0:
            # Child process
            os.execvp(self.shell, [self.shell])
        else:
            # Parent process
            self.running = True
            # Set non-blocking
            import fcntl
            flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
            fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    async def read(self) -> str:
        """Read output from PTY."""
        if not self.running or self.master_fd is None:
            return ""
        try:
            data = os.read(self.master_fd, 4096)
            return data.decode('utf-8', errors='replace')
        except BlockingIOError:
            return ""
        except OSError:
            self.running = False
            return "\r\n[Terminal closed]\r\n"

    async def write(self, data: str):
        """Write input to PTY."""
        if not self.running or self.master_fd is None:
            return
        try:
            os.write(self.master_fd, data.encode('utf-8'))
        except OSError as e:
            print(f"Error writing to PTY: {e}")

    def resize(self, cols: int, rows: int):
        """Resize the PTY."""
        if self.master_fd is None:
            return
        try:
            import struct
            import fcntl
            import termios
            winsize = struct.pack('HHHH', rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
        except Exception as e:
            print(f"Error resizing PTY: {e}")

    def terminate(self):
        """Terminate the shell."""
        self.running = False
        if self.pid:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except:
                pass
        if self.master_fd:
            try:
                os.close(self.master_fd)
            except:
                pass


def create_terminal(shell: str = None, cwd: str = None, env: dict = None, venv_path: str = None):
    """Create a terminal appropriate for the platform."""
    if IS_WINDOWS:
        return WindowsTerminal(shell, cwd=cwd, env=env, venv_path=venv_path)
    else:
        return UnixTerminal(shell)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "platform": sys.platform}


@app.websocket("/ws/terminal")
async def terminal_websocket(websocket: WebSocket):
    """WebSocket endpoint for terminal communication."""
    await websocket.accept()

    terminal = None
    session_id = id(websocket)

    try:
        # Wait for initial config
        init_data = await websocket.receive_text()
        config = json.loads(init_data)

        shell = config.get('shell')
        cols = config.get('cols', 80)
        rows = config.get('rows', 24)
        cwd = config.get('cwd')  # Working directory
        env = config.get('env')  # Custom environment variables
        venv_path = config.get('venvPath')  # Path to Python venv to activate

        print(f"Terminal config received: shell={shell}, cols={cols}, rows={rows}")
        print(f"  cwd={cwd}, venv_path={venv_path}")

        # Create and start terminal
        terminal = create_terminal(shell, cwd=cwd, env=env, venv_path=venv_path)
        await terminal.start()
        terminal.resize(cols, rows)
        terminals[session_id] = terminal

        await websocket.send_text(json.dumps({
            "type": "connected",
            "message": f"Terminal started ({sys.platform})\r\n"
        }))

        # Start reading loop
        async def read_loop():
            while terminal.running:
                try:
                    output = await terminal.read()
                    if output:
                        await websocket.send_text(json.dumps({
                            "type": "output",
                            "data": output
                        }))
                    await asyncio.sleep(0.05)
                except Exception as e:
                    print(f"Read loop error: {e}")
                    break

        read_task = asyncio.create_task(read_loop())

        # Handle incoming messages
        try:
            while True:
                message = await websocket.receive_text()
                data = json.loads(message)

                if data.get('type') == 'input':
                    await terminal.write(data.get('data', ''))
                elif data.get('type') == 'resize':
                    terminal.resize(data.get('cols', 80), data.get('rows', 24))
                elif data.get('type') == 'ping':
                    await websocket.send_text(json.dumps({"type": "pong"}))

        except WebSocketDisconnect:
            print(f"WebSocket disconnected: {session_id}")
        finally:
            read_task.cancel()

    except Exception as e:
        print(f"Terminal error: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": str(e)
            }))
        except:
            pass
    finally:
        if terminal:
            terminal.terminate()
        if session_id in terminals:
            del terminals[session_id]


@app.on_event("shutdown")
async def shutdown():
    """Clean up terminals on shutdown."""
    for terminal in terminals.values():
        terminal.terminate()
    terminals.clear()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8780)
    parser.add_argument('--host', type=str, default='127.0.0.1')
    # Also accept positional port for compatibility with ContextUI
    parser.add_argument('port_positional', nargs='?', type=int, default=None)
    args = parser.parse_args()

    # Use positional port if provided, otherwise use --port
    port = args.port_positional if args.port_positional else args.port
    host = args.host

    print(f"Starting Terminal Server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")
