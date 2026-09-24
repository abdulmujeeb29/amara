"""Local Phase 1 design-preview server, not the production Django application."""
import argparse
from collections import deque, OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from threading import Lock
from time import monotonic
from urllib.error import HTTPError
from urllib.parse import urlsplit, urlencode
from urllib.request import Request, urlopen

from check_azure import load_config

ROOT = Path(__file__).resolve().parents[1] / "design" / "preview"
VENDOR_URLS = {
    "/vendor/map-engine.js": ("https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.js", "application/javascript"),
    "/vendor/map-engine.css": ("https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.css", "text/css"),
    "/vendor/map-compat.js": ("https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js", "application/javascript"),
    "/vendor/motion.js": ("https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js", "application/javascript"),
}
VENDOR_CACHE = {}
VENDOR_LOCK = Lock()
DIAGNOSTICS = deque(maxlen=30)
DIAGNOSTIC_LOCK = Lock()
TILE_CACHE = OrderedDict()
TILE_LOCK = Lock()


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        tile_match = re.fullmatch(r"/raster/(\d{1,2})/(\d{1,7})/(\d{1,7})\.png", path)
        if tile_match:
            z, x, y = map(int, tile_match.groups())
            if not (0 <= z <= 19 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
                self.send_error(400, "Invalid map tile")
                return
            with TILE_LOCK:
                cached = TILE_CACHE.get(path)
            if cached and monotonic() - cached[0] < 300:
                body, content_type = cached[1:]
            else:
                token = load_config().get("MAPBOX_PUBLIC_TOKEN", "").strip()
                if not token.startswith("pk."):
                    self.send_error(503, "Map token unavailable")
                    return
                url = "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{}/{}/{}?{}".format(z, x, y, urlencode({"access_token": token}))
                try:
                    request = Request(url, headers={"Referer": "http://localhost:{}/".format(self.server.server_port)})
                    with urlopen(request, timeout=12) as response:
                        content_type = response.headers.get_content_type()
                        if not content_type.startswith("image/"):
                            raise ValueError("Invalid tile content")
                        body = response.read(2 * 1024 * 1024)
                    with TILE_LOCK:
                        TILE_CACHE[path] = (monotonic(), body, content_type)
                        TILE_CACHE.move_to_end(path)
                        while len(TILE_CACHE) > 128:
                            TILE_CACHE.popitem(last=False)
                except HTTPError as error:
                    self.send_error(error.code if error.code in (401, 403, 404, 429) else 502, "Map tile unavailable")
                    return
                except (OSError, ValueError):
                    self.send_error(502, "Map tile unavailable")
                    return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if path in VENDOR_URLS:
            url, content_type = VENDOR_URLS[path]
            try:
                with VENDOR_LOCK:
                    body = VENDOR_CACHE.get(path)
                if body is None:
                    with urlopen(url, timeout=25) as response:
                        body = response.read()
                    with VENDOR_LOCK:
                        VENDOR_CACHE[path] = body
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (OSError, ValueError):
                self.send_error(502, "Preview renderer could not be downloaded")
            return
        if path == "/map-diagnostics":
            with DIAGNOSTIC_LOCK:
                body = json.dumps(list(DIAGNOSTICS)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/config.json":
            token = load_config().get("MAPBOX_PUBLIC_TOKEN", "").strip()
            # Only the provider-designated public token may reach the browser.
            token = token if token.startswith("pk.") else ""
            body = json.dumps({"mapboxToken": token}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path not in ("/", "/index.html", "/styles.css", "/calm.css", "/app.js", "/raster-map.js"):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/map-diagnostics":
            self.send_error(404)
            return
        # Local, bounded diagnostics: codes/booleans only, never raw errors or URLs.
        if self.headers.get("Origin") not in (None, "http://localhost:{}".format(self.server.server_port), "http://127.0.0.1:{}".format(self.server.server_port)):
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            clean = {}
            for key in ("run_id", "code", "renderer", "fallback_reason"):
                value = payload.get(key, "")
                if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{0,64}", value):
                    raise ValueError()
                clean[key] = value
            for key in ("sdk_loaded", "webgl_supported", "token_configured"):
                clean[key] = payload.get(key) if isinstance(payload.get(key), bool) else None
            with DIAGNOSTIC_LOCK:
                DIAGNOSTICS.append(clean)
            self.send_response(204)
            self.end_headers()
        except (ValueError, TypeError, AttributeError):
            self.send_error(400)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler)
    print("Amara design preview: http://localhost:{}/".format(args.port), flush=True)
    server.serve_forever()
