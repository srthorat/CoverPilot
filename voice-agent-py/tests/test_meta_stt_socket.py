"""The Meta ASR socket: a rotation or language change while the receive loop is reading must leave exactly one live socket."""

import asyncio

from websockets.protocol import State

from coverpilot.meta_stt import MetaRealtimeSTTService


class FakeWs:
    def __init__(self, name: int):
        self.name = name
        self.q: asyncio.Queue = asyncio.Queue()
        self.state = State.OPEN
        self.closed = False
        self.close_code = None
        self.sent: list = []

    async def send(self, data):
        self.sent.append(data)

    async def close(self):
        self.state = State.CLOSED
        self.closed = True
        self.q.put_nowait(None)

    def end_remotely(self):
        """Meta ends the session (time limit): the socket is closed and the reader's iteration stops."""
        self.state = State.CLOSED
        self.closed = True
        self.q.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.q.get()
        if item is None:
            raise StopAsyncIteration
        return item


def make_service():
    svc = MetaRealtimeSTTService(api_key="test-key", sample_rate=16000)
    sockets: list[FakeWs] = []

    async def fake_connect(url):
        ws = FakeWs(len(sockets))
        sockets.append(ws)
        return ws

    async def noop(*a, **k):
        return None

    svc._websocket_connect = fake_connect
    svc._call_event_handler = noop
    svc.push_error = noop
    return svc, sockets


def live(sockets):
    return [s for s in sockets if not s.closed]


async def _rotation_scenario(replace):
    svc, sockets = make_service()
    await svc._connect_websocket()
    recv = asyncio.create_task(svc._receive_messages())
    await asyncio.sleep(0.05)
    await replace(svc)
    await asyncio.sleep(0.15)
    # The receive loop saw the OLD socket end, but must not have cleared or replaced the new one.
    assert len(sockets) == 2, f"expected exactly two sockets ever opened, got {len(sockets)}"
    assert sockets[0].closed and not sockets[1].closed
    assert live(sockets) == [sockets[1]] and svc._websocket is sockets[1]
    # The live session ends on its own (Meta's time limit): exactly one reconnect follows.
    sockets[1].end_remotely()
    await asyncio.sleep(0.15)
    assert len(sockets) == 3 and svc._websocket is sockets[2] and len(live(sockets)) == 1
    svc._disconnecting = True
    await svc._disconnect_websocket()
    await asyncio.wait_for(recv, 2)
    assert live(sockets) == []


def test_rotation_while_the_loop_is_reading_leaves_one_live_socket():
    asyncio.run(_rotation_scenario(lambda svc: svc._replace_websocket()))


def test_language_change_while_the_loop_is_reading_leaves_one_live_socket():
    asyncio.run(_rotation_scenario(lambda svc: svc.set_language_bias(["Hindi", "English"])))


def test_a_failed_reopen_keeps_the_loop_alive_until_meta_is_back(monkeypatch):
    """Meta ends the session and the reopen fails twice: the receive loop stays in charge (no exception for
    Pipecat's reconnect to pick up), retries with a pause, and reads the next socket when the reopen works."""
    from coverpilot import meta_stt

    monkeypatch.setattr(meta_stt, "RECONNECT_MIN_WAIT_S", 0.02)
    monkeypatch.setattr(meta_stt, "RECONNECT_MAX_WAIT_S", 0.05)

    async def main():
        svc, sockets = make_service()
        assert svc._reconnect_on_error is False  # Pipecat's own reconnect stays out of it
        good_connect = svc._websocket_connect
        failures = {"left": 2, "seen": 0}

        async def flaky_connect(url):
            if failures["left"] > 0:
                failures["left"] -= 1
                failures["seen"] += 1
                raise OSError("Meta unreachable")
            return await good_connect(url)

        await svc._connect_websocket()
        recv = asyncio.create_task(svc._receive_messages())
        await asyncio.sleep(0.05)
        svc._websocket_connect = flaky_connect
        sockets[0].end_remotely()
        await asyncio.sleep(0.3)
        assert not recv.done(), recv.exception() if recv.done() and not recv.cancelled() else None
        assert failures["seen"] == 2 and len(sockets) == 2 and svc._websocket is sockets[1] and not sockets[1].closed
        svc._disconnecting = True
        await svc._disconnect_websocket()
        await asyncio.wait_for(recv, 2)
        assert live(sockets) == []

    asyncio.run(main())


def test_an_unexpected_read_error_reopens_instead_of_ending_the_loop():
    class BrokenWs(FakeWs):
        async def __anext__(self):
            item = await self.q.get()
            if item is None:
                raise StopAsyncIteration
            if item == "boom":
                self.state = State.CLOSED
                self.closed = True
                raise RuntimeError("transport error")
            return item

    async def main():
        svc, sockets = make_service()
        good_connect = svc._websocket_connect

        async def broken_first(url):
            if not sockets:
                ws = BrokenWs(0)
                sockets.append(ws)
                return ws
            return await good_connect(url)

        svc._websocket_connect = broken_first
        await svc._connect_websocket()
        recv = asyncio.create_task(svc._receive_messages())
        await asyncio.sleep(0.05)
        sockets[0].q.put_nowait("boom")
        await asyncio.sleep(0.15)
        assert not recv.done() and len(sockets) == 2 and svc._websocket is sockets[1]
        svc._disconnecting = True
        await svc._disconnect_websocket()
        await asyncio.wait_for(recv, 2)

    asyncio.run(main())


def test_concurrent_replaces_never_open_extra_sockets():
    async def main():
        svc, sockets = make_service()
        await svc._connect_websocket()
        recv = asyncio.create_task(svc._receive_messages())
        await asyncio.sleep(0.05)
        await asyncio.gather(svc._replace_websocket(), svc._replace_websocket(), svc.set_language_bias(["Marathi"]))
        await asyncio.sleep(0.2)
        assert len(live(sockets)) == 1 and svc._websocket in sockets and not svc._websocket.closed
        svc._disconnecting = True
        await svc._disconnect_websocket()
        await asyncio.wait_for(recv, 2)
        assert live(sockets) == []

    asyncio.run(main())
