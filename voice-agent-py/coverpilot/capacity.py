"""How many voice sessions one agent process takes, and what happens past that.

Every session runs on the agent's single asyncio event loop. Measured on a 5-core container (docs/LOAD_TEST.md): up to
8 fully active sessions answer in about 8 s at the median, 10 still answer, and at 12 the turns stop being answered at all.
So the agent refuses new connections past MAX_SESSIONS (default 8) with a clear 503 instead of letting every caller
hang. A refused visitor sees the "busy" message and can try again in a moment; sessions already running are untouched.

SessionCap is plain logic (testable without a server); CapMiddleware applies it to POST /api/offer for new
connections only, so an ICE restart or renegotiation of a running session is never refused.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable

DEFAULT_MAX_SESSIONS = 8
PENDING_TTL_SECONDS = 20.0  # an accepted offer whose bot never started stops counting after this long

BUSY_MESSAGE = "The voice assistant is busy with other visitors right now. Please try again in a minute."


def max_sessions_from_env(env: dict | None = None) -> int:
    raw = (env if env is not None else os.environ).get("MAX_SESSIONS", "")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_MAX_SESSIONS
    return value if value > 0 else DEFAULT_MAX_SESSIONS


class SessionCap:
    def __init__(self, limit: int = DEFAULT_MAX_SESSIONS, *, now: Callable[[], float] = time.monotonic):
        self.limit = limit
        self._now = now
        self.active = 0
        self._pending: list[float] = []  # accepted offers whose session has not started yet

    def _live_pending(self) -> int:
        cutoff = self._now() - PENDING_TTL_SECONDS
        self._pending = [t for t in self._pending if t > cutoff]
        return len(self._pending)

    def try_admit(self) -> bool:
        """Called for a new connection's offer. True reserves a slot until the session starts (or the reservation expires)."""
        if self.active + self._live_pending() >= self.limit:
            return False
        self._pending.append(self._now())
        return True

    def release_pending(self) -> None:
        """The offer was accepted but failed before a session started: give the reservation back."""
        if self._pending:
            self._pending.pop()

    def started(self) -> None:
        if self._pending:
            self._pending.pop(0)
        self.active += 1

    def finished(self) -> None:
        self.active = max(0, self.active - 1)

    def snapshot(self) -> dict:
        return {"active": self.active, "pending": self._live_pending(), "limit": self.limit}

    def status(self) -> dict:
        """What GET /api/capacity returns: the numbers, and whether a new session would be refused right now."""
        s = self.snapshot()
        return {**s, "busy": s["active"] + s["pending"] >= self.limit}


class CapMiddleware:
    """Pure ASGI middleware: refuse a *new* WebRTC offer with 503 when the agent is at its session limit."""

    def __init__(self, app, cap: SessionCap):
        self.app = app
        self.cap = cap

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") != "POST" or not str(scope.get("path", "")).endswith("/api/offer"):
            return await self.app(scope, receive, send)

        # Read the (small) offer body so we can tell a new connection from a renegotiation, then replay it.
        chunks: list[bytes] = []
        more = True
        total = 0
        while more:
            message = await receive()
            if message["type"] != "http.request":
                break
            body = message.get("body", b"")
            total += len(body)
            if total > 256 * 1024:  # an SDP offer is a few KB; let the app reject anything silly
                break
            chunks.append(body)
            more = message.get("more_body", False)
        raw = b"".join(chunks)
        replayed = False

        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": raw, "more_body": False}
            return await receive()

        try:
            parsed = json.loads(raw or b"{}")
        except Exception:
            parsed = {}
        is_new = isinstance(parsed, dict) and not (parsed.get("pc_id") or parsed.get("pcId"))
        if not is_new:
            return await self.app(scope, replay, send)

        if not self.cap.try_admit():
            payload = json.dumps({"error": BUSY_MESSAGE, "busy": True, **self.cap.snapshot()}).encode()
            await send({"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"application/json"), (b"retry-after", b"15"), (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": payload})
            return

        status = {"code": 0}

        async def watch(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, replay, watch)
        except Exception:
            self.cap.release_pending()
            raise
        if status["code"] != 200:
            self.cap.release_pending()  # the offer failed, so no session will start for it
