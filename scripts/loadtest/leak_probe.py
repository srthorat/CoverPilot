"""Which per-session objects keep memory after the session is gone?

Creates and drops the heavy per-session objects the agent builds (Silero VAD and Smart Turn ONNX sessions) in a loop and
prints the process's memory after each round, with and without gc and malloc_trim. A steady climb that malloc_trim
cannot give back is a real retention; a climb that falls after malloc_trim is allocator fragmentation.

  docker cp scripts/loadtest/leak_probe.py <container>:/tmp/leak_probe.py
  docker exec <container> /app/voice-agent-py/.venv/bin/python /tmp/leak_probe.py
"""

import ctypes
import gc
import os
import re
import sys


def rss_mb():
    with open("/proc/self/status") as f:
        return int(re.search(r"VmRSS:\s+(\d+)", f.read()).group(1)) / 1024.0


def trim():
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def make_vad():
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADParams

    a = SileroVADAnalyzer(params=VADParams(confidence=0.8))
    a.set_sample_rate(16000)
    return a


def make_turn():
    from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3

    return LocalSmartTurnAnalyzerV3()


def probe(name, factory, rounds=8):
    print(f"\n{name}")
    gc.collect()
    trim()
    base = rss_mb()
    print(f"  start {base:.0f} MB")
    for i in range(1, rounds + 1):
        obj = factory()
        held = rss_mb()
        del obj
        gc.collect()
        after_gc = rss_mb()
        trim()
        after_trim = rss_mb()
        print(f"  round {i}: holding {held:.0f} MB, after gc {after_gc:.0f}, after malloc_trim {after_trim:.0f}  (net {after_trim - base:+.0f})")
    return rss_mb() - base


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    out = {}
    if which in ("both", "vad"):
        out["silero"] = probe("Silero VAD analyzer create and drop", make_vad)
    if which in ("both", "turn"):
        out["smart_turn"] = probe("Smart Turn v3 analyzer create and drop", make_turn)
    print("\nnet growth after 8 rounds, after gc and malloc_trim:", {k: round(v) for k, v in out.items()}, "MB")
