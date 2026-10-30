#!/usr/bin/env python3
"""Ramps concurrent voice sessions against one container and records what it costs.

Host-side driver (Python 3.9+, standard library only). For each level it starts the client in a throwaway container
from the same image (scripts/loadtest/voice_client.py), samples the container under test every few seconds
(docker stats for CPU and memory, plus the agent's and the web server's own memory, threads and open files read from
/proc), and then prints a summary. It also waits after each level and samples again, which is how leaks show up:
after every session has closed, memory, threads and open files should come back near the starting point.

  python3 scripts/loadtest/voice_ramp.py --container coverpilot-fork-d --image coverpilot:fork-d --port 3014 \
      --levels 1,3,5 --turns 2 --hold 15

Soak mode opens and closes short sessions in a loop for a number of minutes:
  python3 scripts/loadtest/voice_ramp.py --container coverpilot-fork-d --image coverpilot:fork-d --port 3014 --soak-minutes 5
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time

PROC_SCRIPT = r"""
import json, os, re
out = {}
for pid in os.listdir('/proc'):
    if not pid.isdigit():
        continue
    try:
        cmd = open('/proc/%s/cmdline' % pid).read().replace('\0', ' ')
        name = 'agent' if 'bot.py' in cmd else ('web' if ('server.mjs' in cmd or 'next' in cmd.split(' ')[0] or cmd.startswith('node')) else None)
        if not name:
            continue
        st = open('/proc/%s/status' % pid).read()
        rss = int(re.search(r'VmRSS:\s+(\d+)', st).group(1)) / 1024.0
        thr = int(re.search(r'Threads:\s+(\d+)', st).group(1))
        fds = len(os.listdir('/proc/%s/fd' % pid))
    except Exception:
        continue
    o = out.setdefault(name, {'rss_mb': 0.0, 'threads': 0, 'fds': 0})
    o['rss_mb'] += rss; o['threads'] += thr; o['fds'] += fds
data = '/app/voice-agent-py/data'
files = nbytes = 0
for root, _, names in os.walk(data):
    for n in names:
        files += 1
        try:
            nbytes += os.path.getsize(os.path.join(root, n))
        except Exception:
            pass
out['data'] = {'files': files, 'kb': round(nbytes / 1024.0)}
print(json.dumps(out))
"""


def sh(args, timeout=120):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def docker_stats(container):
    r = sh(["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", container], 30)
    try:
        cpu, mem = r.stdout.strip().split("|")
        used = mem.split("/")[0].strip()
        mb = float(used.replace("MiB", "")) if "MiB" in used else float(used.replace("GiB", "")) * 1024
        return float(cpu.strip("%")), mb
    except Exception:
        return None, None


def proc_stats(container):
    r = sh(["docker", "exec", container, "/app/voice-agent-py/.venv/bin/python", "-c", PROC_SCRIPT], 30)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return {}


def snapshot(container):
    cpu, mb = docker_stats(container)
    p = proc_stats(container)
    return {
        "t": time.time(),
        "cpu_pct": cpu,
        "container_mb": mb,
        "agent_rss_mb": round(p.get("agent", {}).get("rss_mb", 0), 1),
        "agent_threads": p.get("agent", {}).get("threads"),
        "agent_fds": p.get("agent", {}).get("fds"),
        "web_rss_mb": round(p.get("web", {}).get("rss_mb", 0), 1),
        "web_fds": p.get("web", {}).get("fds"),
        "data_files": p.get("data", {}).get("files"),
        "data_kb": p.get("data", {}).get("kb"),
    }


class Sampler(threading.Thread):
    def __init__(self, container, every=3.0):
        super().__init__(daemon=True)
        self.container, self.every, self.samples, self._stop_ev = container, every, [], threading.Event()

    def run(self):
        while not self._stop_ev.is_set():
            self.samples.append(snapshot(self.container))
            self._stop_ev.wait(self.every)

    def stop(self):
        self._stop_ev.set()
        self.join(timeout=30)


def client_cmd(args, sessions, turns, hold, think):
    return [
        "docker", "run", "--rm", "--add-host", "host.docker.internal:host-gateway",
        "-v", os.path.abspath(os.path.dirname(__file__)) + ":/lt:ro",
        "--entrypoint", "/app/voice-agent-py/.venv/bin/python", args.image, "/lt/voice_client.py",
        "--base", "http://host.docker.internal:%d" % args.port,
        "--sessions", str(sessions), "--turns", str(turns), "--hold", str(hold), "--think", str(think),
    ]


def run_client(args, sessions, turns, hold, think, timeout):
    p = subprocess.run(client_cmd(args, sessions, turns, hold, think), capture_output=True, text=True, timeout=timeout)
    for line in p.stdout.splitlines():
        if line.startswith("RESULT "):
            return json.loads(line[7:])
    return {"summary": {"error": (p.stderr or p.stdout)[-400:]}, "sessions": []}


def peak(samples, key):
    vals = [s[key] for s in samples if s.get(key) is not None]
    return max(vals) if vals else None


def level(args, n):
    print("\n=== %d concurrent session(s) ===" % n, flush=True)
    before = snapshot(args.container)
    sampler = Sampler(args.container)
    sampler.start()
    t0 = time.time()
    res = run_client(args, n, args.turns, args.hold, args.think, timeout=600)
    sampler.stop()
    time.sleep(args.settle)
    after = snapshot(args.container)
    s = res["summary"]
    row = {
        "sessions": n,
        "wall_s": round(time.time() - t0),
        "connected": s.get("sessions_connected"),
        "ready_ms_max": s.get("ready_ms_max"),
        "turns": "%s/%s" % (s.get("turns_ok"), s.get("turns_sent")),
        "first_text_s": s.get("first_text_s"),
        "done_s": s.get("done_s"),
        "first_audio_s": s.get("first_audio_s"),
        "cpu_pct_peak": peak(sampler.samples, "cpu_pct"),
        "container_mb_peak": peak(sampler.samples, "container_mb"),
        "agent_rss_mb": {"before": before["agent_rss_mb"], "peak": peak(sampler.samples, "agent_rss_mb"), "after": after["agent_rss_mb"]},
        "agent_fds": {"before": before["agent_fds"], "peak": peak(sampler.samples, "agent_fds"), "after": after["agent_fds"]},
        "agent_threads": {"before": before["agent_threads"], "peak": peak(sampler.samples, "agent_threads"), "after": after["agent_threads"]},
        "errors": s.get("errors"),
        "turn_errors": s.get("turn_errors"),
    }
    print(json.dumps(row, indent=1), flush=True)
    return row


def soak(args):
    print("\n=== soak: %d minutes of sessions opening and closing ===" % args.soak_minutes, flush=True)
    start = snapshot(args.container)
    samples = [start]
    end = time.time() + args.soak_minutes * 60
    cycles = ok_turns = sent = failed_connect = 0
    while time.time() < end:
        res = run_client(args, args.soak_sessions, 1 if cycles % 2 == 0 else 0, 2, 1, timeout=180)
        s = res["summary"]
        cycles += 1
        sent += s.get("turns_sent") or 0
        ok_turns += s.get("turns_ok") or 0
        failed_connect += (s.get("sessions") or args.soak_sessions) - (s.get("sessions_connected") or 0)
        samples.append(snapshot(args.container))
        last = samples[-1]
        print("cycle %d: agent %.0f MB, %s fds, %s threads, web %.0f MB, container %.0f MB" % (cycles, last["agent_rss_mb"], last["agent_fds"], last["agent_threads"], last["web_rss_mb"], last["container_mb"] or 0), flush=True)
    time.sleep(args.settle)
    final = snapshot(args.container)
    out = {"minutes": args.soak_minutes, "cycles": cycles, "sessions_per_cycle": args.soak_sessions, "turns_ok": "%d/%d" % (ok_turns, sent), "failed_connects": failed_connect, "start": start, "final": final}
    print(json.dumps(out, indent=1), flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--container", required=True)
    ap.add_argument("--image", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--levels", default="1,3,5")
    ap.add_argument("--turns", type=int, default=2)
    ap.add_argument("--hold", type=float, default=15)
    ap.add_argument("--think", type=float, default=4)
    ap.add_argument("--settle", type=float, default=20)
    ap.add_argument("--soak-minutes", type=float, default=0)
    ap.add_argument("--soak-sessions", type=int, default=2)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    out = {"levels": [], "soak": None}
    if args.soak_minutes:
        out["soak"] = soak(args)
    else:
        for n in [int(x) for x in args.levels.split(",") if x]:
            out["levels"].append(level(args, n))
    if args.out:
        with open(args.out, "w") as f:
            json.dump(out, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
