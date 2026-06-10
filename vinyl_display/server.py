from __future__ import annotations

import json
import mimetypes
import ssl
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.audd import AudDClient
from vinyl_display.clients.shazam import ShazamClient
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.config import Config, load_config


def build_app(config: Config) -> VinylDisplayApp:
    store = CatalogStore(config.database_path)
    discogs = DiscogsClient(config.discogs_user, config.discogs_user_agent)
    if config.rapidapi_shazam_key:
        recognizer = ShazamClient(config.rapidapi_shazam_key, config.rapidapi_shazam_host)
        print("[SERVER] Using Shazam (via RapidAPI) for music recognition.")
    else:
        recognizer = AudDClient(config.audd_api_token)
        print("[SERVER] Using AudD for music recognition.")
    return VinylDisplayApp(store, discogs, recognizer)



class VinylRequestHandler(SimpleHTTPRequestHandler):
    app: VinylDisplayApp
    static_dir: Path

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self._json({"status": "ok"})
            return
        if path == "/api/state":
            self._json(self.app.state())
            return
        if path == "/":
            self._send_static("index.html")
            return
        if path.startswith("/static/"):
            self._send_static(path.removeprefix("/static/"))
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/sync":
            self._json(self.app.sync_collection())
            return
        if path == "/api/recognize":
            length = int(self.headers.get("Content-Length", "0"))
            audio_bytes = self.rfile.read(length)
            filename = self.headers.get("X-Clip-Filename", "clip.webm")
            self._json(self.app.recognize_audio(audio_bytes, filename=filename))
            return
        if path == "/api/playback/next":
            self.app.playback.skip_next()
            self._json(self.app.state())
            return
        if path == "/api/playback/prev":
            self.app.playback.skip_prev()
            self._json(self.app.state())
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _send_static(self, relative_path: str) -> None:
        target = (self.static_dir / relative_path).resolve()
        static_root = self.static_dir.resolve()
        if static_root not in target.parents and target != static_root:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(config: Config | None = None) -> None:
    config = config or load_config()
    app = build_app(config)

    class Handler(VinylRequestHandler):
        pass

    Handler.app = app
    Handler.static_dir = config.static_dir

    server = ThreadingHTTPServer((config.host, config.port), Handler)
    if config.cert_file and config.key_file:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(config.cert_file, config.key_file)
        server.socket = context.wrap_socket(server.socket, server_side=True)

    scheme = "https" if config.cert_file and config.key_file else "http"
    print(f"Serving Vinyl Display at {scheme}://{config.host}:{config.port}")
    server.serve_forever()


if __name__ == "__main__":
    serve()
