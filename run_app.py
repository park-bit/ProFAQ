"""
ProFAQ Windows Native Desktop Application Runner.
Runs embedded FastAPI backend and opens native Edge WebView2 window.
Zero dependencies or cache on C: drive. All data isolated to ./data.
"""
from __future__ import annotations

import os
import pathlib
import sys
import threading
import time

import socket
import traceback

# Set Windows AppUserModelID so taskbar groups properly and displays the application icon
try:
    import ctypes
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("ProFAQ.AcademicRAG.Desktop.1.0")
except Exception:
    pass

# Guarantee root directory and python paths
ROOT_DIR = pathlib.Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
BACKEND_DIR = ROOT_DIR / "backend"
LOG_FILE = DATA_DIR / "app.log"

# Ensure isolated directories exist
for sub in ["hf_cache", "torch_cache", "tmp", "uploads", "qdrant", "webview2_data", ".cache", "tiktoken_cache"]:
    (DATA_DIR / sub).mkdir(parents=True, exist_ok=True)

# Direct stdout/stderr to log file if running headless or under pythonw.exe
try:
    log_fp = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
    if not sys.stdout or not hasattr(sys.stdout, "isatty") or not sys.stdout.isatty():
        sys.stdout = log_fp
        sys.stderr = log_fp
except Exception:
    pass

sys.path.insert(0, str(BACKEND_DIR))

# Strict environment variable isolation - ZERO MB on C: drive
os.environ["HF_HOME"] = str((DATA_DIR / "hf_cache").resolve())
os.environ["TRANSFORMERS_CACHE"] = str((DATA_DIR / "hf_cache" / "hub").resolve())
os.environ["TORCH_HOME"] = str((DATA_DIR / "torch_cache").resolve())
os.environ["WEBVIEW2_USER_DATA_FOLDER"] = str((DATA_DIR / "webview2_data").resolve())
os.environ["XDG_CACHE_HOME"] = str((DATA_DIR / ".cache").resolve())
os.environ["TIKTOKEN_CACHE_DIR"] = str((DATA_DIR / "tiktoken_cache").resolve())
os.environ["TEMP"] = str((DATA_DIR / "tmp").resolve())
os.environ["TMP"] = str((DATA_DIR / "tmp").resolve())

import httpx
import uvicorn
import webview
from app.main import app

def find_available_port(start_port=8000, max_port=8050):
    for port in range(start_port, max_port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start_port

PORT = find_available_port()
HOST = "127.0.0.1"


def run_server(server: uvicorn.Server):
    server.run()


def wait_for_server(url: str, timeout: float = 30.0) -> bool:
    start_time = time.monotonic()
    while time.monotonic() - start_time < timeout:
        try:
            with httpx.Client(timeout=1.0) as client:
                res = client.get(url)
                if res.status_code == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def main():
    config = uvicorn.Config(
        app,
        host=HOST,
        port=PORT,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=run_server, args=(server,), daemon=True)
    server_thread.start()

    ready = wait_for_server(f"http://{HOST}:{PORT}/health", timeout=30.0)
    if not ready:
        print("[ProFAQ] Failed to start backend server within 30 seconds.")
        server.should_exit = True
        sys.exit(1)

    if "--test-only" in sys.argv:
        print("[ProFAQ] Native app and backend verified healthy.")
        server.should_exit = True
        server_thread.join(timeout=3.0)
        return

    # Configure native pywebview window
    webview.settings["ALLOW_DOWNLOADS"] = True
    window = webview.create_window(
        title="ProFAQ",
        url=f"http://{HOST}:{PORT}",
        width=1320,
        height=860,
        min_size=(960, 600),
        background_color="#000000",
        text_select=True,
    )

    def on_window_shown():
        try:
            import ctypes
            if hasattr(window, "native") and hasattr(window.native, "Handle"):
                hwnd = window.native.Handle.ToInt64()
                # DWMWA_USE_IMMERSIVE_DARK_MODE = 20 (Windows 10 20H1+ and Windows 11)
                dark_mode = ctypes.c_int(1)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(dark_mode), 4)

                # DWMWA_CAPTION_COLOR = 35 (Windows 11 title bar background) -> 0x00000000 (pure #000000)
                caption_color = ctypes.c_int(0x00000000)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(caption_color), 4)

                # DWMWA_TEXT_COLOR = 36 (Windows 11 title text color) -> 0x00ffffff
                text_color = ctypes.c_int(0x00ffffff)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 36, ctypes.byref(text_color), 4)

                # Set WinForms icon for titlebar and taskbar
                ico_path = ROOT_DIR / "app_icon.ico"
                if ico_path.exists():
                    try:
                        import clr
                        clr.AddReference("System.Drawing")
                        from System.Drawing import Icon
                        window.native.Icon = Icon(str(ico_path.resolve()))
                    except Exception:
                        pass

                    # Win32 explicit WM_SETICON for small (titlebar) and big (taskbar/Alt+Tab)
                    try:
                        WM_SETICON = 0x0080
                        ICON_SMALL = 0
                        ICON_BIG = 1
                        IMAGE_ICON = 1
                        LR_LOADFROMFILE = 0x00000010
                        h_small = ctypes.windll.user32.LoadImageW(
                            0, str(ico_path.resolve()), IMAGE_ICON, 16, 16, LR_LOADFROMFILE
                        )
                        h_big = ctypes.windll.user32.LoadImageW(
                            0, str(ico_path.resolve()), IMAGE_ICON, 32, 32, LR_LOADFROMFILE
                        )
                        if h_small:
                            ctypes.windll.user32.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, h_small)
                        if h_big:
                            ctypes.windll.user32.SendMessageW(hwnd, WM_SETICON, ICON_BIG, h_big)
                    except Exception:
                        pass
        except Exception:
            pass

    window.events.shown += on_window_shown

    # Deferred thread to re-assert icon after Edge WebView2 initializes
    def apply_icon_deferred():
        time.sleep(0.5)
        on_window_shown()

    threading.Thread(target=apply_icon_deferred, daemon=True).start()

    try:
        # Starts native Windows WebView2 GUI
        webview.start(gui="edgechromium", debug=False)
    finally:
        # On window close, cleanly terminate uvicorn backend
        server.should_exit = True
        server_thread.join(timeout=3.0)


if __name__ == "__main__":
    main()
