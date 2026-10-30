"""Summarise a language-results JSON written by e2e/language.spec.ts: python3 summarize-language.py <file> [more files]"""
import json
import statistics
import sys

for path in sys.argv[1:]:
    rows = json.load(open(path))
    print(f"== {path}: {len(rows)} questions")
    groups = {}
    for r in rows:
        groups.setdefault((r.get("scenario", "screen"), r["agent"], r["lang"]), []).append(r)
    for (scenario, agent, lang), rs in groups.items():
        ok = sum(1 for r in rs if r["replyOk"])
        ms = statistics.median(r["replyMs"] for r in rs)
        print(f"{scenario:8} {agent:9} {lang}: {ok}/{len(rs)} in the right language, median first-text {ms:.0f} ms, median length {statistics.median(len(r['reply']) for r in rs):.0f} chars")
    for r in rows:
        if not r["replyOk"]:
            print(f"  MISS {r.get('scenario', 'screen')} {r['agent']} {r['lang']} [{r['replyWhy']}] len={len(r['reply'])}: {r['reply'][:160]}")
