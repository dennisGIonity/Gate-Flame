"""Authenticating reverse proxy in front of the real fleet server.

The dashboard is behind HTTP Basic Auth, and the browser pane will not accept
credentials embedded in a URL. Rather than weaken the real server's auth to
look at it, this proxies every request through to 8091 with the admin header
attached, so what gets rendered is the ACTUAL application - same API, same
data, same code paths - not a mock of it.

Loopback only, port 8092, throwaway.
"""
import base64
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ENV = Path(r"C:\Users\DGMic\Downloads\GF Files\gateflame-fleet\fleet.env.ps1").read_text(encoding="utf-8-sig")
USER = re.search(r'ADMIN_USER\s*=\s*"([^"]+)"', ENV).group(1)
PW = re.search(r'ADMIN_PASSWORD\s*=\s*"([^"]+)"', ENV).group(1)
AUTH = "Basic " + base64.b64encode(f"{USER}:{PW}".encode()).decode()
UPSTREAM = "http://127.0.0.1:8091"


class Proxy(BaseHTTPRequestHandler):
    def _forward(self, method):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(
            UPSTREAM + self.path, data=body, method=method,
            headers={
                "Authorization": AUTH,
                "Content-Type": self.headers.get("Content-Type", "application/json"),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data, status, ctype = r.read(), r.status, r.headers.get("Content-Type", "text/plain")
        except urllib.error.HTTPError as e:
            data, status, ctype = e.read(), e.code, "application/json"
        except Exception as e:  # upstream down
            data, status, ctype = str(e).encode(), 502, "text/plain"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if data:
            self.wfile.write(data)

    def do_GET(self):
        self._forward("GET")

    def do_POST(self):
        self._forward("POST")

    def do_PUT(self):
        self._forward("PUT")

    def log_message(self, *a):
        pass


print("preview proxy on http://127.0.0.1:8092/ -> " + UPSTREAM)
HTTPServer(("127.0.0.1", 8092), Proxy).serve_forever()
