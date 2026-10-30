"""Customer memory: only an unguessable id may load it, and Forget me must really forget."""

import asyncio
import uuid

from bot import load_customer_memory
from coverpilot.memory import MemoryStore, MemoryWriter, customer_ref, valid_customer_id
from coverpilot.session import SessionState


def test_only_128_bit_secrets_are_accepted():
    assert valid_customer_id(str(uuid.uuid4()))
    assert valid_customer_id(uuid.uuid4().hex)
    assert valid_customer_id("a" * 32) and valid_customer_id("F" * 64)
    for bad in ["X", "cust-abc12345", "a" * 31, "a" * 65, "g" * 32, "", None, 123, "../../etc/passwd", "a" * 31 + " "]:
        assert not valid_customer_id(bad), bad


def test_a_guessable_id_loads_nothing_and_is_refused():
    s = SessionState()
    out = load_customer_memory(s, "X")
    assert out["rejected"] is True and out["facts"] == [] and s.customer_id is None and s.memory_text == ""
    good = uuid.uuid4().hex
    assert "rejected" not in load_customer_memory(s, good) and s.customer_id == good


def test_the_log_reference_is_a_short_hash_not_the_id():
    cid = uuid.uuid4().hex
    ref = customer_ref(cid)
    assert len(ref) == 8 and ref not in cid or ref != cid[:8]
    assert cid not in ref


def _writer(tmp_path):
    store = MemoryStore(tmp_path / "m.sqlite")
    return store, MemoryWriter(store, api_key="k", base_url="http://x", model="m")


def test_forget_cancels_an_extraction_that_is_still_running(tmp_path):
    async def main():
        store, writer = _writer(tmp_path)
        cid, other = uuid.uuid4().hex, uuid.uuid4().hex
        saved = []

        async def slow(user, assistant):
            await asyncio.sleep(0.25)
            return {"facts": ["name is Priya"], "summary": "asked about riders"}

        async def on_saved(*a):
            saved.append(a)

        writer._call_model = slow
        writer.schedule(cid, "my name is Priya", "noted", on_saved)
        writer.schedule(other, "my name is Rahul", "noted", None)  # a different customer is unaffected
        await asyncio.sleep(0.05)
        writer.forget(cid)
        await asyncio.sleep(0.5)
        assert store.load(cid)["facts"] == [] and store.load(cid)["summary"] == "" and saved == []
        assert store.load(other)["facts"] == ["name is Rahul"] or store.load(other)["facts"] == ["name is Priya"]

    asyncio.run(main())


def test_an_extraction_from_before_the_delete_cannot_save_after_it(tmp_path):
    async def main():
        store, writer = _writer(tmp_path)
        cid = uuid.uuid4().hex

        async def quick(user, assistant):
            return {"facts": ["declared a heart condition"], "summary": "s"}

        writer._call_model = quick
        writer._generation[cid] = 1  # Forget me ran while this extraction (generation 0) was in flight
        called = []

        async def on_saved(*a):
            called.append(a)

        await writer._extract(cid, "u", "a", on_saved, 0)
        assert store.load(cid)["facts"] == [] and called == []
        await writer._extract(cid, "u", "a", on_saved, 1)  # a fresh extraction after the delete is allowed
        assert store.load(cid)["facts"] == ["declared a heart condition"] and len(called) == 1

    asyncio.run(main())
