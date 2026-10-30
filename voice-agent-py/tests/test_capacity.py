import asyncio
import json
import threading
import time

from coverpilot.capacity import BUSY_MESSAGE, DEFAULT_MAX_SESSIONS, PENDING_TTL_SECONDS, CapMiddleware, SessionCap, max_sessions_from_env
from coverpilot.diag import start_memory_trim, task_summary


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_limit_from_env():
    assert max_sessions_from_env({}) == DEFAULT_MAX_SESSIONS == 8
    assert max_sessions_from_env({"MAX_SESSIONS": "5"}) == 5
    assert max_sessions_from_env({"MAX_SESSIONS": "0"}) == DEFAULT_MAX_SESSIONS
    assert max_sessions_from_env({"MAX_SESSIONS": "-3"}) == DEFAULT_MAX_SESSIONS
    assert max_sessions_from_env({"MAX_SESSIONS": "many"}) == DEFAULT_MAX_SESSIONS


def test_admits_up_to_the_limit_counting_sessions_that_have_not_started_yet():
    cap = SessionCap(2, now=Clock())
    assert cap.try_admit() and cap.try_admit()
    assert not cap.try_admit(), "two accepted offers whose bots are still starting already fill the cap"
    cap.started()
    cap.started()
    assert cap.snapshot() == {"active": 2, "pending": 0, "limit": 2}
    assert not cap.try_admit()
    cap.finished()
    assert cap.try_admit(), "a finished session frees its slot"


def test_status_reports_busy_exactly_when_a_new_session_would_be_refused():
    cap = SessionCap(2, now=Clock())
    assert cap.status() == {"active": 0, "pending": 0, "limit": 2, "busy": False}
    cap.started()
    assert cap.status()["busy"] is False
    assert cap.try_admit()  # one running and one accepted but not yet started
    assert cap.status() == {"active": 1, "pending": 1, "limit": 2, "busy": True}
    assert cap.try_admit() is False, "the status and the admission decision agree"


def test_a_reservation_that_never_becomes_a_session_expires():
    clock = Clock()
    cap = SessionCap(1, now=clock)
    assert cap.try_admit()
    assert not cap.try_admit()
    clock.t += PENDING_TTL_SECONDS + 1
    assert cap.try_admit(), "an offer whose bot never started must not block the cap for ever"


def test_finished_never_goes_negative_and_release_gives_the_slot_back():
    cap = SessionCap(1, now=Clock())
    cap.finished()
    assert cap.active == 0
    assert cap.try_admit()
    cap.release_pending()
    assert cap.try_admit()


def _call(app, body: bytes, path="/api/offer", method="POST"):
    sent = []

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(app({"type": "http", "method": method, "path": path, "headers": []}, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    payload = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], payload


def _inner(status=200, seen=None):
    async def app(scope, receive, send):
        msg = await receive()
        if seen is not None:
            seen.append(msg["body"])
        await send({"type": "http.response.start", "status": status, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    return app


def test_middleware_refuses_a_new_offer_at_the_limit_with_a_readable_503():
    cap = SessionCap(1, now=Clock())
    cap.started()  # one session is running
    status, payload = _call(CapMiddleware(_inner(), cap), json.dumps({"sdp": "x", "type": "offer"}).encode())
    assert status == 503
    body = json.loads(payload)
    assert body["error"] == BUSY_MESSAGE and body["busy"] is True and body["limit"] == 1


def test_middleware_lets_a_renegotiation_of_a_running_session_through_at_the_limit():
    cap = SessionCap(1, now=Clock())
    cap.started()
    seen = []
    status, _ = _call(CapMiddleware(_inner(seen=seen), cap), json.dumps({"sdp": "x", "type": "offer", "pc_id": "abc"}).encode())
    assert status == 200 and json.loads(seen[0])["pc_id"] == "abc", "the app still receives the full body"


def test_middleware_reserves_a_slot_for_an_accepted_offer_and_returns_it_when_the_offer_fails():
    cap = SessionCap(1, now=Clock())
    body = json.dumps({"sdp": "x", "type": "offer"}).encode()
    assert _call(CapMiddleware(_inner(200), cap), body)[0] == 200
    assert cap.snapshot()["pending"] == 1 and not cap.try_admit()
    cap2 = SessionCap(1, now=Clock())
    assert _call(CapMiddleware(_inner(500), cap2), body)[0] == 500
    assert cap2.snapshot()["pending"] == 0, "a failed offer starts no session, so it keeps no reservation"


def test_middleware_ignores_other_routes_and_methods():
    cap = SessionCap(1, now=Clock())
    cap.started()
    mw = CapMiddleware(_inner(), cap)
    assert _call(mw, b"{}", path="/api/health", method="GET")[0] == 200
    assert _call(mw, b"{}", method="PATCH")[0] == 200


def test_task_summary_groups_pending_tasks_without_any_data():
    async def waiter(ev):
        secret = "do not print me"  # noqa: F841 - a local that must never reach the dump
        await ev.wait()

    async def main():
        ev = asyncio.Event()
        tasks = [asyncio.create_task(waiter(ev)) for _ in range(3)]
        await asyncio.sleep(0)
        lines = task_summary()
        ev.set()
        await asyncio.gather(*tasks)
        return lines

    lines = asyncio.run(main())
    assert "pending" in lines[0]
    joined = "\n".join(lines)
    assert "do not print me" not in joined
    # The chain is followed down to where the tasks really wait (Event.wait on a future), and three identical waiters are one line.
    assert any(line.strip().startswith("3") and "in wait awaiting Future" in line for line in lines), joined


def test_release_is_scheduled_once_for_sessions_that_end_together_and_can_be_scheduled_again():
    import coverpilot.diag as diag

    runs = []

    async def main():
        loop = asyncio.get_running_loop()
        first = diag.schedule_release(0.05, loop=loop, release=lambda: runs.append(1) or 1.0)
        second = diag.schedule_release(0.05, loop=loop, release=lambda: runs.append(2) or 1.0)
        await asyncio.sleep(0.2)
        third = diag.schedule_release(0.01, loop=loop, release=lambda: runs.append(3) or 1.0)
        await asyncio.sleep(0.1)
        return first, second, third

    assert asyncio.run(main()) == (True, False, True)
    assert runs == [1, 3], "two sessions ending together share one run; a later session gets its own"


def test_release_memory_returns_its_duration_and_frees_cycles():
    import gc as _gc

    from coverpilot.diag import release_memory

    class Node:
        pass

    a, b = Node(), Node()
    a.other, b.other = b, a  # a reference cycle, like a finished session's objects
    import weakref

    ref = weakref.ref(a)
    del a, b
    _gc.disable()
    try:
        assert ref() is not None, "the cycle survives until a collection runs"
        ms = release_memory()
        assert ref() is None and ms >= 0
    finally:
        _gc.enable()


def test_memory_trim_thread_calls_trim_repeatedly_and_stops():
    calls = []
    done = threading.Event()

    def fake_trim():
        calls.append(time.time())
        if len(calls) >= 3:
            done.set()
        return True

    t = start_memory_trim(0.01, trim=fake_trim)
    assert done.wait(2), "the trim thread should call trim every interval"
    t.stop_event.set()
    t.join(1)
    assert not t.is_alive()
