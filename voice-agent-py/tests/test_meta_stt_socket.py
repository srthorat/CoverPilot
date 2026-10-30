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
