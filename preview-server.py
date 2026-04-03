"""
Local static preview. Serves the repo root.
If RETTMARK_PREVIEW_AUTOMATE=1: bind only RETTMARK_PREVIEW_PORT (default 8080), no scan.
Otherwise: try successive ports if busy.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os
import socket
import sys
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT_TRIES = 20


def _configure_stdio():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _automate():
    return os.environ.get("RETTMARK_PREVIEW_AUTOMATE", "").lower() in ("1", "true", "yes")


def _probe_loopback(port, bind_host):
    """Ensure TCP accept works before telling the IDE to open Simple Browser (-102 = connection refused)."""
    connect_host = "127.0.0.1" if bind_host in ("0.0.0.0", "::") else bind_host
    for _ in range(60):
        try:
            c = socket.create_connection((connect_host, port), timeout=0.25)
            c.close()
            return
        except OSError:
            time.sleep(0.05)


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Simple Browser / Chromium webviews cache static files aggressively without this.
        self.send_header("Cache-Control", "no-store, max-age=0, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))


def _maybe_open_browser(url):
    if os.environ.get("RETTMARK_OPEN_BROWSER", "").lower() not in ("1", "true", "yes"):
        return

    def _open():
        time.sleep(0.5)
        if os.name == "nt":
            try:
                os.startfile(url)
                print("Opened preview in your default browser.", flush=True)
                return
            except OSError:
                pass
        try:
            import webbrowser
            webbrowser.open(url)
            print("Opened preview in your default browser.", flush=True)
        except Exception:
            print("Open this URL manually: %s" % url, flush=True)

    threading.Thread(target=_open, daemon=True).start()


def _write_preview_url_file(url):
    path = os.path.join(ROOT, ".vscode", "preview-url.txt")
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="ascii") as f:
            f.write(url.strip() + "\n")
    except OSError:
        pass


def main():
    _configure_stdio()

    # 127.0.0.1 avoids some IPv6/localhost (::1) vs IPv4-only listener mismatches on Windows.
    host = os.environ.get("RETTMARK_PREVIEW_BIND", "127.0.0.1")
    base = int(os.environ.get("RETTMARK_PREVIEW_PORT", "8080"))

    if _automate():
        port_candidates = [base]
    else:
        port_candidates = list(range(base, base + PORT_TRIES))

    httpd = None
    port = None
    for p in port_candidates:
        try:
            httpd = ThreadingHTTPServer((host, p), PreviewHandler)
            port = p
            break
        except OSError:
            continue

    if httpd is None:
        if _automate():
            print("Could not bind port %s (is another preview already running?)" % base, flush=True)
        else:
            print("Could not bind any port in range %s-%s." % (base, base + PORT_TRIES - 1), flush=True)
        sys.exit(1)

    _probe_loopback(port, host)

    url = "http://127.0.0.1:%s/" % port
    _write_preview_url_file(url)

    print("", flush=True)
    print("*** Preview server is running ***", flush=True)
    print("URL: %s" % url, flush=True)
    print("RETTMARK_PREVIEW_READY", flush=True)
    print("", flush=True)

    _maybe_open_browser(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)


if __name__ == "__main__":
    main()
