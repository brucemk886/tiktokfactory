import json
import os
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

MAX_BYTES = 300 * 1024 * 1024
ALLOWED_HOSTS = {"tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}


def valid_tiktok_url(value):
    try:
        parsed = urlparse(str(value))
        return parsed.scheme == "https" and parsed.hostname in ALLOWED_HOSTS and not parsed.username and not parsed.password
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/download":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length < 2 or length > 8192:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length))
            url = payload.get("url", "")
            if not valid_tiktok_url(url):
                self._json_error(400, "Only public TikTok video URLs are accepted.")
                return
            self._download(url)
        except (ValueError, json.JSONDecodeError) as error:
            self._json_error(400, str(error))
        except subprocess.TimeoutExpired:
            self._json_error(504, "TikTok download timed out.")
        except Exception as error:
            self._json_error(502, str(error)[:800])

    def _download(self, url):
        folder = tempfile.mkdtemp(prefix="tiktok-")
        try:
            output = os.path.join(folder, "source.%(ext)s")
            command = [
                "yt-dlp", "--no-playlist", "--no-progress", "--no-warnings",
                "--max-filesize", str(MAX_BYTES),
                "--format", "best[ext=mp4]/best",
                "--output", output,
                "--print", "after_move:filepath",
                url,
            ]
            result = subprocess.run(command, capture_output=True, text=True, timeout=600, check=False)
            if result.returncode != 0:
                detail = (result.stderr or result.stdout or "TikTok download failed.").strip()
                raise RuntimeError(detail[-1000:])
            candidates = [line.strip() for line in result.stdout.splitlines() if line.strip()]
            path = next((item for item in reversed(candidates) if os.path.isfile(item)), "")
            if not path:
                files = [os.path.join(folder, name) for name in os.listdir(folder)]
                path = next((item for item in files if os.path.isfile(item)), "")
            if not path:
                raise RuntimeError("Downloader did not create a video file.")
            size = os.path.getsize(path)
            if size < 1024:
                raise RuntimeError("Downloaded video is empty.")
            if size > MAX_BYTES:
                raise RuntimeError("Downloaded video exceeds 300 MB.")
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(size))
            self.send_header("X-Video-Filename", "source.mp4")
            self.end_headers()
            with open(path, "rb") as source:
                shutil.copyfileobj(source, self.wfile, length=1024 * 1024)
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def _json_error(self, status, message):
        body = json.dumps({"error": message}, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("tiktok-downloader", fmt % args, flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
