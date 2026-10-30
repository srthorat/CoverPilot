"""Which threads of the voice agent are busy? Prints the top threads by CPU over a few seconds.

The agent runs every session on one asyncio event loop (the main thread), so that thread reaching 100% is the
practical limit of one container: past it, messages and audio frames queue up and turns stop being answered.

  docker cp scripts/loadtest/thread_cpu.py <container>:/tmp/thread_cpu.py
  docker exec <container> /app/voice-agent-py/.venv/bin/python /tmp/thread_cpu.py 4
"""

import os
import sys
import time

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 4
tick = os.sysconf("SC_CLK_TCK")


def agent_pid():
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                if "bot.py" in open("/proc/%s/cmdline" % pid).read():
                    return pid
            except Exception:
                pass


def times(pid):
    out = {}
    for tid in os.listdir("/proc/%s/task" % pid):
        try:
            raw = open("/proc/%s/task/%s/stat" % (pid, tid)).read()
            name = raw[raw.index("(") + 1 : raw.rindex(")")]
            f = raw[raw.rindex(")") + 2 :].split()
            out[tid] = (name, int(f[11]) + int(f[12]))
        except Exception:
            pass
    return out


pid = agent_pid()
a = times(pid)
time.sleep(secs)
b = times(pid)
rows = sorted(((100.0 * (b[t][1] - a[t][1]) / tick / secs, b[t][0], t) for t in b if t in a), reverse=True)
print("agent pid", pid, "threads", len(b), "total cpu %.0f%%" % sum(r[0] for r in rows))
for cpu, name, tid in rows[:6]:
    print("  %5.1f%%  %s%s" % (cpu, name, "  (main thread = the event loop)" if tid == pid else ""))
