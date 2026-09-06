#!/usr/bin/env python3
"""Static server for the H&K try-on demo.

    python3 serve.py            http on 127.0.0.1:5173
    python3 serve.py --https    https on 0.0.0.0:5173, self-signed

getUserMedia only runs in a secure context. localhost counts as secure, so plain
http is fine on this machine; a phone hitting the LAN address needs --https.
"""
import argparse, base64, hashlib, http.server, json, mimetypes, os, socket, ssl, subprocess, sys
from pathlib import Path

mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".task")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")

HERE = Path(__file__).resolve().parent
CERT, KEY = HERE / ".cert.pem", HERE / ".key.pem"
CACHE = HERE / ".tryon-cache"

def load_dotenv():
    """Walk up for the repo-root .env and fill anything not already in os.environ.

    The key lives in the repo-root .env alongside every other credential; making
    the operator re-pass it on the command line is how you end up with a demo
    that silently does nothing."""
    for d in [HERE, *HERE.parents]:
        f = d / ".env"
        if not f.exists():
            continue
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))
        return f
    return None


DOTENV = load_dotenv()

OPENAI_URL = "https://api.openai.com/v1/images/edits"
# Overridable, so a model rename never needs a code edit at 3am.
OPENAI_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")

PROMPT = (
    "Dress the person in the second image in the hoodie shown in the first image. "
    "Keep their face, hair, skin tone, body proportions, pose and the background "
    "exactly as they are — change only their upper-body clothing. Match the "
    "hoodie's {colour} colour, oversized cut, ribbed cuffs and hem faithfully. "
    "Photographic, natural lighting consistent with the original photo."
)


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip: str) -> None:
    if CERT.exists() and KEY.exists():
        return
    print("generating a self-signed certificate for %s ..." % ip)
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365",
         "-keyout", str(KEY), "-out", str(CERT),
         "-subj", "/CN=opentra-fit",
         "-addext", "subjectAltName=IP:%s,IP:127.0.0.1,DNS:localhost" % ip],
        check=True, capture_output=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "application/javascript",
        ".js": "application/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    # ---- try-on render -------------------------------------------------
    #
    # The canvas composite is instant and always works; this is the
    # photoreal version of the same idea. It is cosmetic only — the SIZE
    # still comes from the pose maths, so a failure here costs a picture,
    # never the measurement.
    #
    # Results are cached on disk because generation takes 15-30s and doing
    # that live, on venue wifi, in front of judges, is a lost pitch. Warm
    # it during rehearsal with the photo you will actually upload.

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.split("?")[0] != "/api/tryon":
            return self._json(404, {"error": "no such endpoint"})

        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "expected JSON"})

        photo = (req.get("photo") or "").split(",")[-1]
        colour = req.get("colour") or "offwhite"
        if not photo:
            return self._json(400, {"error": "photo required"})

        CACHE.mkdir(exist_ok=True)
        key = hashlib.sha256((colour + photo).encode()).hexdigest()[:32]
        hit = CACHE / (key + ".txt")
        if hit.exists():
            return self._json(200, {"image": "data:image/png;base64," + hit.read_text(),
                                    "cached": True})

        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            return self._json(503, {"error":
                "OPENAI_API_KEY is not set — start the server with it in the "
                "environment or in the repo-root .env"})

        garment = HERE / "assets" / (colour + ".jpg")
        if not garment.exists():
            garment = HERE / "assets" / "garment.png"

        try:
            import requests
            files = [
                ("image[]", ("garment.jpg", garment.read_bytes(), "image/jpeg")),
                ("image[]", ("person.png", base64.b64decode(photo), "image/png")),
            ]
            res = requests.post(
                OPENAI_URL,
                headers={"Authorization": "Bearer " + api_key},
                data={"model": OPENAI_MODEL,
                      "prompt": PROMPT.format(colour=colour),
                      "size": "1024x1536", "n": "1"},
                files=files,
                timeout=180,
            )
            out = res.json()
            if res.status_code != 200:
                msg = (out.get("error") or {}).get("message") or "generation failed"
                return self._json(res.status_code, {"error": msg})

            b64 = (out.get("data") or [{}])[0].get("b64_json")
            if not b64:
                return self._json(502, {"error": "no image returned"})

            hit.write_text(b64)
            return self._json(200, {"image": "data:image/png;base64," + b64, "cached": False})
        except Exception as e:                                  # noqa: BLE001
            return self._json(500, {"error": str(e)})

    def end_headers(self):
        # never cache during a demo; a stale fit.js is a confusing failure
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "200" not in fmt % args:
            super().log_message(fmt, *args)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--https", action="store_true", help="serve TLS so phones can use the camera")
    ap.add_argument("--port", type=int, default=5174)
    args = ap.parse_args()

    ip = lan_ip()
    host = "0.0.0.0" if args.https else "127.0.0.1"
    try:
        httpd = http.server.ThreadingHTTPServer((host, args.port), Handler)
    except OSError as e:
        if e.errno != 98:
            raise
        print("\n  Port %d is already in use — something else is serving there." % args.port)
        print("  Find it:  ss -ltnp | grep :%d" % args.port)
        print("  Free it:  kill $(ss -ltnp | grep :%d | grep -oP 'pid=\\K[0-9]+')" % args.port)
        print("  Or:       python3 serve.py --port %d\n" % (args.port + 1))
        return 1

    if args.https:
        try:
            ensure_cert(ip)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print("could not generate a certificate (%s). openssl is required for --https." % e)
            return 1
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"
        print("\n  H&K store   %s://%s:%d/" % (scheme, ip, args.port))
        print("\n  The certificate is self-signed, so the phone shows a warning once:")
        print("  Advanced -> Proceed. The camera will not start until you do.\n")
    else:
        print("\n  H&K store   http://127.0.0.1:%d/" % args.port)
        key = os.environ.get("OPENAI_API_KEY", "").strip()
        print("  try-on      %s  (%s)" % (
            "ready, model " + OPENAI_MODEL if key else "DISABLED - no OPENAI_API_KEY",
            ("loaded %s" % DOTENV) if DOTENV else "no .env found"))
        print("\n  localhost is a secure context, so the camera works here.")
        print("  For a phone on the same wifi, restart with --https.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
