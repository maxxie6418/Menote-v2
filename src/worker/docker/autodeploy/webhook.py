"""Queue publication on verified push events for the production branch."""
import hashlib
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile

SECRET = (Path(os.environ["CREDENTIALS_DIRECTORY"]) / "github-webhook").read_bytes().strip()
STATE = Path(os.environ["STATE_DIRECTORY"])
REPO_ID = 1440393752
ROUTE = "/_ops/menote-github-push"
MAX_BODY = 5 * 1024 * 1024


class Webhook(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(10)
        super().setup()

    def reply(self, status):
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if self.path != ROUTE:
            self.reply(404)
            return
        if not self.headers.get("X-Hub-Signature-256", "").startswith("sha256="):
            self.reply(401)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_BODY:
            self.reply(413)
            return
        body = self.rfile.read(length)
        signature = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature.encode(), self.headers["X-Hub-Signature-256"].encode()):
            self.reply(401)
            return
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError):
            self.reply(400)
            return
        repo = payload.get("repository") if isinstance(payload, dict) else None
        if not isinstance(repo, dict) or repo.get("id") != REPO_ID:
            self.reply(403)
            return
        if self.headers.get("X-GitHub-Event") != "push" or payload.get("ref") != "refs/heads/main" or payload.get("deleted"):
            self.reply(204)
            return
        # The deploy service resolves main directly from GitHub. Duplicate or late
        # deliveries cannot roll it back to the commit named in the payload.
        with tempfile.NamedTemporaryFile(dir=STATE, delete=False) as pending:
            pending.write(b"main\n")
        os.replace(pending.name, STATE / "pending")
        self.reply(202)


if len(SECRET) < 32:
    raise SystemExit("Missing webhook secret")
ThreadingHTTPServer(("127.0.0.1", 3082), Webhook).serve_forever()
