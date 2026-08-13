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


def status_errors(payload) -> list:
    """Collect the error entries the router buries inside a 200 response.

    KeeneticOS answers a rejected or misspelled command with HTTP 200 and a
    nested `status` array:

        {"system": {"status": [{"status": "error", "code": "1179781",
                                "message": "not found: \"system/foo\"..."}]}}

    So the HTTP code says nothing about whether the command ran, and anything
    that checks only the transport reads a rejection as a success. Verified
    against the site's router on 2026-08-13.
    """
    found = []

    def walk(node):
        if isinstance(node, dict):
            entries = node.get("status")
            if isinstance(entries, list):
                found.extend(e for e in entries
                             if isinstance(e, dict)
                             and e.get("status") in ("error", "critical"))
            for key, value in node.items():
                if key != "status":
                    walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(payload)
    return found


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

    def command(self, body: dict, expect_disconnect: bool = False):
        """POST /rci/ to *run* a CLI command.

        `get()` only ever reads: GET /rci/<path> returns the configuration node
        at that path and executes nothing. Asking it for `system/reboot`
        therefore returns `{}` and reboots nothing, which is how the WAN
        watchdog spent a night armed on an action that did absolutely nothing
        while reporting success (DMI-49). Commands are a nested object:

            command({"system": {"reboot": {}}})

        Raises RciError when the router reports an error status, so a path that
        stops working fails loudly rather than quietly doing nothing.

        With `expect_disconnect`, a transport failure returns None instead of
        raising -- a router executing `reboot` has nobody left to answer with.
        That tolerance is deliberately opt-in and narrow: it covers silence,
        never a rejection.
        """
        data = json.dumps(body).encode()
        with self._lock:
            for attempt in (1, 2):
                request = urllib.request.Request(
                    f"{self.base}/rci/", data=data,
                    headers={"Content-Type": "application/json"}, method="POST")
                try:
                    with self._opener.open(request, timeout=self.timeout) as response:
                        payload = json.loads(response.read().decode("utf-8", "replace"))
                except urllib.error.HTTPError as exc:
                    if exc.code == 401 and attempt == 1:
                        self._authenticate()
                        continue
                    raise RciError(f"command failed: HTTP {exc.code}") from exc
                except json.JSONDecodeError as exc:
                    # As in get(): an unauthenticated request comes back as an
                    # HTML redirect stub rather than a 401.
                    if attempt == 1:
                        self._authenticate()
                        continue
                    raise RciError("command returned non-JSON") from exc
                except OSError as exc:
                    if expect_disconnect:
                        logger.info("router closed the connection without "
                                    "answering (%s)", exc)
                        return None
                    raise RciError(f"command failed: {exc}") from exc

                errors = status_errors(payload)
                if errors:
                    raise RciError("router rejected the command: " + "; ".join(
                        str(e.get("message") or e) for e in errors))
                return payload
        raise RciError("command failed after re-authentication")


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
