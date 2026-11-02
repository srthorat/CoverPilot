"""Operational helpers for the agent process: a diagnostics dump on demand and memory trimming.

`kill -USR2 <agent pid>` (in the container: `python -c "import os,signal;os.kill(<pid>, signal.SIGUSR2)"`, the image has no
kill binary) writes a summary of every pending asyncio task, grouped by the line it is really waiting on, and the stack of
every thread to the log, without stopping anything. It is how a stalled session is investigated in production, where no
debugger can attach. The dump contains function names and line numbers only, never message text or variables.

`start_memory_trim()` returns freed memory to the operating system now and then. Python and the ONNX runtime keep memory
they have freed (the voice-activity and turn-detection models are loaded per session, about 15 MB each), so without this
the process size only ever grows with the number of sessions served, even though nothing is leaked.
"""

from __future__ import annotations

import asyncio
import collections
import ctypes
import faulthandler
import gc
import signal
import sys
import threading
import time
from typing import Callable

from loguru import logger


def _innermost(coro):
    """Follow a coroutine's chain of awaits to the one that is actually suspended, and what it waits on."""
    waiting_on = None
    for _ in range(60):
        nxt = getattr(coro, "cr_await", None) or getattr(coro, "gi_yieldfrom", None) or getattr(coro, "ag_await", None)
        if nxt is None:
            break
        if hasattr(nxt, "cr_frame") or hasattr(nxt, "gi_frame") or hasattr(nxt, "ag_frame"):
            coro = nxt
            continue
        waiting_on = type(nxt).__name__  # a Future, an Event wait, a sleep...
        break
    frame = getattr(coro, "cr_frame", None) or getattr(coro, "gi_frame", None) or getattr(coro, "ag_frame", None)
    return frame, waiting_on


def task_summary(tasks=None, *, top: int = 14) -> list[str]:
    """Group pending asyncio tasks by the line each one is really waiting on. Returns printable lines: code positions
    and the type of the thing awaited, never data."""
    tasks = list(tasks if tasks is not None else asyncio.all_tasks())
    where = collections.Counter()
    for t in tasks:
        if t.done():
            continue
        frame, waiting_on = _innermost(t.get_coro())
        if frame is None:
            where["(not started or finished)"] += 1
            continue
        pos = f"{frame.f_code.co_filename.split('/site-packages/')[-1]}:{frame.f_lineno} in {frame.f_code.co_name}"
        where[pos + (f" awaiting {waiting_on}" if waiting_on else "")] += 1
    lines = [f"{len(tasks)} asyncio tasks, {sum(where.values())} pending"]
    lines += [f"  {n:4d}  {w}" for w, n in where.most_common(top)]
    return lines


def dump_state() -> None:
    for line in task_summary():
        logger.warning(f"[diag] {line}")
    logger.warning(f"[diag] {threading.active_count()} threads; stacks follow on stderr")
    faulthandler.dump_traceback(file=sys.stderr, all_threads=True)


def install_diag_signal(loop: asyncio.AbstractEventLoop | None = None) -> bool:
    """Make SIGUSR2 dump the process state. Returns False where signals are unavailable (not the main thread, Windows)."""
    try:
        (loop or asyncio.get_running_loop()).add_signal_handler(signal.SIGUSR2, dump_state)
        return True
    except (NotImplementedError, RuntimeError, ValueError):
        return False


def malloc_trim() -> bool:
    try:
        return bool(ctypes.CDLL("libc.so.6").malloc_trim(0))
    except Exception:  # not glibc (musl, macOS): nothing to do
        return False


def release_memory() -> float:
    """Collect cyclic garbage and give freed memory back to the OS. Returns how long it took, in milliseconds.

    A finished session leaves a graph of objects with reference cycles (the pipeline, its processors, two ONNX sessions,
    their thread pools). Python frees those only at its next full collection, which may be minutes away, so the process
    grows by about 20 MB per finished session in between (see support/docs/LOAD_TEST.md). Collecting right after sessions end
    keeps the size flat. The pause is a few tens of milliseconds on the event loop."""
    t = time.perf_counter()
    gc.collect()
    malloc_trim()
    return (time.perf_counter() - t) * 1000


_release_handle = None


def schedule_release(delay_seconds: float = 3.0, *, loop: asyncio.AbstractEventLoop | None = None, release: Callable[[], float] = release_memory) -> bool:
    """Run release_memory shortly after a session ends. Sessions that end close together share one run. Returns False when
    a run was already scheduled."""
    global _release_handle
    if _release_handle is not None:
        return False
    loop = loop or asyncio.get_running_loop()

    def run():
        global _release_handle
        _release_handle = None
        ms = release()
        logger.debug(f"[memory] released unused memory in {ms:.0f} ms")

    _release_handle = loop.call_later(delay_seconds, run)
    return True


def start_memory_trim(interval_seconds: float = 30.0, *, trim: Callable[[], bool] = malloc_trim) -> threading.Thread:
    """Trim freed memory every `interval_seconds` on a daemon thread (the call takes a few milliseconds)."""
    stop = threading.Event()

    def loop():
        while not stop.wait(interval_seconds):
            trim()

    t = threading.Thread(target=loop, name="memory-trim", daemon=True)
    t.stop_event = stop  # type: ignore[attr-defined]
    t.start()
    return t
