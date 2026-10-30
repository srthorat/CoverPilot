"""Opens N concurrent WebRTC voice sessions against the agent and sends text turns, like the web app does.

Runs inside the app image (it uses the agent's own aiortc), usually in a separate throwaway container so
the client's CPU is not charged to the container under test. See scripts/loadtest/voice_ramp.py.

Each session: POST the SDP offer to /voice-agent/api/offer, open the RTVI data channel, send client-ready, wait for
bot-ready, stream silent microphone audio (so the server runs VAD and speech recognition like a live call), then send
text turns and time the answers. Prints one JSON object with per-session and overall numbers.

  python voice_client.py --base http://host.docker.internal:3014 --sessions 3 --turns 2 --hold 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
import uuid

import aiohttp
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import AudioStreamTrack

QUESTIONS = [
    "What is the grace period for a monthly premium?",
    "What does the free-look period mean?",
    "Is the premium for a term plan tax free?",
    "What happens if I miss a payment in month two?",
    "Who can I name as a nominee?",
    "What is a waiver of premium rider?",
]


def msg(kind: str, data: dict) -> str:
    return json.dumps({"label": "rtvi-ai", "type": kind, "id": uuid.uuid4().hex[:8], "data": data})


class Session:
    def __init__(self, idx: int, base: str, turns: int, hold: float, turn_timeout: float, think: float):
        self.idx, self.base, self.turns, self.hold, self.turn_timeout, self.think = idx, base, turns, hold, turn_timeout, think
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        self.channel = None
        self.bot_ready = asyncio.Event()
        self.events: asyncio.Queue = asyncio.Queue()
        self.audio_frames = 0
        self.first_audio_after: float | None = None
        self.mark_audio: float | None = None
        self.result: dict = {"session": idx, "connect_ms": None, "ready_ms": None, "turns": [], "errors": []}

    async def connect(self) -> None:
        t0 = time.perf_counter()
        self.pc.addTrack(AudioStreamTrack())  # silent microphone
        self.channel = self.pc.createDataChannel("chat", ordered=True)

        @self.channel.on("open")
        def _open():
            self.channel.send(msg("client-ready", {"version": "2.2.0", "about": {"library": "loadtest"}}))

        @self.channel.on("message")
        def _message(raw):
            try:
                m = json.loads(raw)
            except Exception:
                return
            if m.get("type") == "bot-ready":
                self.bot_ready.set()
            elif m.get("type") == "server-message":
                self.events.put_nowait((time.perf_counter(), m.get("data") or {}))
            elif m.get("type") == "error":
                self.result["errors"].append(f"rtvi error: {str((m.get('data') or {}).get('error'))[:120]}")

        @self.pc.on("track")
        def _track(track):
            async def drain():
                try:
                    while True:
                        frame = await track.recv()
                        self.audio_frames += 1
                        # The bot streams silence between answers, so only a frame with real signal counts as speech.
                        if self.mark_audio is not None and self.first_audio_after is None and int(abs(frame.to_ndarray()).max()) > 800:
                            self.first_audio_after = time.perf_counter() - self.mark_audio
                except Exception:
                    pass

            asyncio.ensure_future(drain())

        await self.pc.setLocalDescription(await self.pc.createOffer())
        body = {
            "sdp": self.pc.localDescription.sdp,
            "type": self.pc.localDescription.type,
            "requestData": {"lang": "en", "persona": "veena", "accent": "in", "customerId": None, "autoWelcome": False, "ttsProvider": "google", "priorTurns": []},
        }
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as http:
            async with http.post(f"{self.base}/voice-agent/api/offer", json=body) as res:
                if res.status != 200:
                    raise RuntimeError(f"offer HTTP {res.status}: {(await res.text())[:150]}")
                answer = await res.json()
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
        self.result["connect_ms"] = round((time.perf_counter() - t0) * 1000)
        await asyncio.wait_for(self.bot_ready.wait(), timeout=45)
        self.result["ready_ms"] = round((time.perf_counter() - t0) * 1000)

    async def ask(self, text: str) -> dict:
        while not self.events.empty():
            self.events.get_nowait()
        self.audio_frames, self.first_audio_after = 0, None
        t_send = time.perf_counter()
        self.mark_audio = t_send
        self.channel.send(msg("client-message", {"t": "text", "d": {"text": text}}))
        first_ack = first_text = done = None
        chars = 0
        deadline = t_send + self.turn_timeout
        error = None
        while time.perf_counter() < deadline:
            try:
                at, data = await asyncio.wait_for(self.events.get(), timeout=max(0.1, deadline - time.perf_counter()))
            except asyncio.TimeoutError:
                break
            kind = data.get("type")
            if kind == "agent_ack" and first_ack is None:
                first_ack = at - t_send
            elif kind == "agent_text":
                if first_text is None:
                    first_text = at - t_send
                chars += len(data.get("delta") or "")
            elif kind == "agent_done":
                done = at - t_send
                break
            elif kind == "error":
                error = str(data.get("message"))[:120]
                break
        for _ in range(60):  # up to 6 s for the first spoken frame (the speech starts while the text is still arriving)
            if self.first_audio_after is not None:
                break
            await asyncio.sleep(0.1)
        return {
            "question": text[:40],
            "ack_s": None if first_ack is None else round(first_ack, 2),
            "first_text_s": None if first_text is None else round(first_text, 2),
            "done_s": None if done is None else round(done, 2),
            "first_audio_s": None if self.first_audio_after is None else round(self.first_audio_after, 2),
            "chars": chars,
            "ok": done is not None and chars > 0 and error is None,
            "error": error,
        }

    async def run(self, start_gate: asyncio.Event) -> dict:
        try:
            await self.connect()
            await start_gate.wait()  # all sessions connected first, then the load starts together
            await asyncio.sleep(self.hold)
            for i in range(self.turns):
                self.result["turns"].append(await self.ask(QUESTIONS[(self.idx + i) % len(QUESTIONS)]))
                await asyncio.sleep(self.think)
        except Exception as e:  # noqa: BLE001
            self.result["errors"].append(f"{type(e).__name__}: {str(e)[:150]}")
        finally:
            try:
                await self.pc.close()
            except Exception:  # noqa: BLE001
                pass
        return self.result


def summarize(results: list[dict]) -> dict:
    turns = [t for r in results for t in r["turns"]]
    ok = [t for t in turns if t["ok"]]

    def stat(key: str):
        vals = [t[key] for t in ok if t.get(key) is not None]
        if not vals:
            return None
        vals.sort()
        return {"p50": vals[len(vals) // 2], "max": vals[-1], "n": len(vals)}

    return {
        "sessions": len(results),
        "sessions_connected": sum(1 for r in results if r["ready_ms"] is not None),
        "connect_ms_max": max([r["connect_ms"] for r in results if r["connect_ms"] is not None] or [None]),
        "ready_ms_p50": statistics.median([r["ready_ms"] for r in results if r["ready_ms"] is not None] or [0]),
        "ready_ms_max": max([r["ready_ms"] for r in results if r["ready_ms"] is not None] or [None]),
        "turns_sent": len(turns),
        "turns_ok": len(ok),
        "first_text_s": stat("first_text_s"),
        "done_s": stat("done_s"),
        "first_audio_s": stat("first_audio_s"),
        "errors": [e for r in results for e in r["errors"]][:8],
        "turn_errors": [t["error"] for t in turns if t.get("error")][:5],
    }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--sessions", type=int, default=1)
    ap.add_argument("--turns", type=int, default=2)
    ap.add_argument("--hold", type=float, default=5, help="seconds all sessions sit connected before the first turn")
    ap.add_argument("--think", type=float, default=4, help="seconds between turns in one session")
    ap.add_argument("--turn-timeout", type=float, default=60)
    ap.add_argument("--turn-sessions", type=int, default=0, help="only the first K sessions send turns (0 = all); the others stay connected and idle")
    ap.add_argument("--stagger", type=float, default=0.5, help="seconds between session starts")
    args = ap.parse_args()

    gate = asyncio.Event()
    sessions = [Session(i, args.base, args.turns if (not args.turn_sessions or i < args.turn_sessions) else 0, args.hold, args.turn_timeout, args.think) for i in range(args.sessions)]
    tasks = []
    for s in sessions:
        tasks.append(asyncio.create_task(s.run(gate)))
        await asyncio.sleep(args.stagger)
    # Wait until every session that can connect has, then release them together.
    for _ in range(100):
        if all(s.bot_ready.is_set() or t.done() for s, t in zip(sessions, tasks)):
            break
        await asyncio.sleep(0.5)
    print("CONNECTED", sum(1 for s in sessions if s.bot_ready.is_set()), flush=True)
    gate.set()
    results = await asyncio.gather(*tasks)
    print("RESULT " + json.dumps({"summary": summarize(results), "sessions": results}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
