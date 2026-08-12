"""
Minimal client for the KeeneticOS RCI HTTP API.

The router exposes its whole CLI as JSON under /rci/. Authentication is a
challenge scheme of Keenetic's own -- Basic and Digest both return 401:

    1. GET /auth -> 401 carrying X-NDM-Realm and X-NDM-Challenge
    2. md5 = MD5("<login>:<realm>:<password>")
       sha = SHA256(challenge + md5)
    3. POST /auth with {"login": ..., "password": sha}, keeping the session cookie

Preferred over telnet or SSH for automation: no shell, no interactive login, and
none of the lockout risk that `ip ssh lockout-policy` imposes on repeated failures.
"""

import hashlib
import http.cookiejar
import json
import logging
import os
import threading
import urllib.error
import urllib.request

logger = logging.getLogger("router-exporter.rci")

ROUTER_HOST = os.environ.get("ROUTER_HOST", "192.168.2.1")
ROUTER_USER = os.environ.get("ROUTER_USER", "admin")
ROUTER_PASSWORD = os.environ.get("ROUTER_PASSWORD", "")
TIMEOUT = int(os.environ.get("ROUTER_RCI_TIMEOUT", "15"))


class RciError(RuntimeError):
    pass


class RciClient:
    def __init__(self, host: str, user: str, password: str, timeout: int = TIMEOUT):
        if not password:
            raise RciError("ROUTER_PASSWORD is not set")
        self.base = f"http://{host}"
        self.user = user
        self.password = password
        self.timeout = timeout
        self._lock = threading.Lock()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def _authenticate(self) -> None:
        """Establish a session. A live session makes GET /auth return 200."""
        try:
            self._opener.open(f"{self.base}/auth", timeout=self.timeout)
            return
        except urllib.error.HTTPError as exc:
            if exc.code != 401:
                raise RciError(f"unexpected status from /auth: {exc.code}") from exc
            realm = exc.headers.get("X-NDM-Realm")
            challenge = exc.headers.get("X-NDM-Challenge")

        if not realm or not challenge:
            raise RciError("/auth did not return a challenge")

        md5 = hashlib.md5(f"{self.user}:{realm}:{self.password}".encode()).hexdigest()
        sha = hashlib.sha256((challenge + md5).encode()).hexdigest()
        request = urllib.request.Request(
            f"{self.base}/auth",
            data=json.dumps({"login": self.user, "password": sha}).encode(),
            headers={"Content-Type": "application/json"})
        try:
            self._opener.open(request, timeout=self.timeout)
        except urllib.error.HTTPError as exc:
            # Never log the password or the derived hashes.
            raise RciError(f"authentication rejected: {exc.code}") from exc

    def get(self, path: str):
        """GET /rci/<path>, re-authenticating once if the session has lapsed."""
        with self._lock:
            for attempt in (1, 2):
                try:
                    with self._opener.open(f"{self.base}/rci/{path}", timeout=self.timeout) as response:
                        return json.loads(response.read().decode("utf-8", "replace"))
                except urllib.error.HTTPError as exc:
                    if exc.code == 401 and attempt == 1:
                        self._authenticate()
                        continue
                    raise RciError(f"GET {path} failed: {exc.code}") from exc
                except json.JSONDecodeError as exc:
                    # An unauthenticated request is answered with an HTML redirect
                    # stub rather than a 401, so a decode failure means the same thing.
                    if attempt == 1:
                        self._authenticate()
                        continue
                    raise RciError(f"GET {path} returned non-JSON") from exc
        raise RciError(f"GET {path} failed after re-authentication")


_client = None
_client_lock = threading.Lock()


def client() -> RciClient:
    """Process-wide client, so the session cookie is reused across scrapes."""
    global _client
    with _client_lock:
        if _client is None:
            _client = RciClient(ROUTER_HOST, ROUTER_USER, ROUTER_PASSWORD)
            _client._authenticate()
        return _client
