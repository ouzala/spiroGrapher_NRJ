from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


PROJECT_ROOT = Path(__file__).resolve().parent


HOST = "127.0.0.1"
PORT = 8000


class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def _current_build_stamp(self):
        latest_mtime = max(
            path.stat().st_mtime
            for path in PROJECT_ROOT.rglob("*")
            if path.is_file() and ".git" not in path.parts
        )
        return str(int(latest_mtime))

    def _render_index_html(self):
        index_path = PROJECT_ROOT / "index.html"
        content = index_path.read_text(encoding="utf-8")
        version = self._current_build_stamp()
        content = content.replace("?v=20260408b", f"?v={version}")
        content = content.replace("__BUILD_STAMP__", version)
        return content.encode("utf-8")

    def _serve_dynamic_index(self):
        body = self._render_index_html()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path in ("/", "/index.html"):
            return self._serve_dynamic_index()

        # Force a fresh response instead of allowing conditional 304 handling.
        self.headers["If-Modified-Since"] = ""
        super().do_GET()

    def do_HEAD(self):
        parsed = urlsplit(self.path)
        if parsed.path in ("/", "/index.html"):
            body = self._render_index_html()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return

        self.headers["If-Modified-Since"] = ""
        super().do_HEAD()

    def end_headers(self):
        # Disable browser caching during local development so refreshes always
        # fetch the latest HTML, JS, and CSS files.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Last-Modified", "0")
        super().end_headers()


def main():
    server = ThreadingHTTPServer((HOST, PORT), NoCacheHTTPRequestHandler)
    print(f"Serving no-cache dev server at http://{HOST}:{PORT}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
