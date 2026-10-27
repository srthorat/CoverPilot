"""Customer memory across sessions (SQLite).

What the customer has told the agent before (name, family, decisions, worries) is
kept per customer id and placed in the prompt when they return. Facts are
extracted by Muse Spark in the background after each completed turn, so the
spoken path never waits on it. Nothing is stored unless a customer id is given.
"""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

import aiohttp
from loguru import logger

_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "memory.sqlite"

_EXTRACT_PROMPT = """You maintain a short memory for an insurance advisor about one customer. From the latest exchange, extract durable facts worth remembering next time: name, date of birth, income band, family members and nominees, health disclosures the customer volunteered (never infer), riders or cover they chose or declined, preferences (language, pace), and open questions. Reply ONLY with JSON: {"facts": ["<one short factual sentence>", ...], "summary": "<one sentence on where the customer is in the proposal>"}. Return an empty facts list if nothing new and durable was said. Never store card numbers, Aadhaar, PAN, bank or phone numbers."""


class MemoryStore:
    def __init__(self, path: Path = _DB_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.execute("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, summary TEXT, updated_at REAL)")
        self._conn.execute("CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, fact TEXT, created_at REAL, UNIQUE(customer_id, fact))")
        self._conn.commit()

    def load(self, customer_id: str, limit: int = 25) -> dict[str, Any]:
        row = self._conn.execute("SELECT summary, updated_at FROM customers WHERE id=?", (customer_id,)).fetchone()
        facts = [r[0] for r in self._conn.execute("SELECT fact FROM facts WHERE customer_id=? ORDER BY created_at DESC LIMIT ?", (customer_id, limit))]
        return {"summary": row[0] if row else "", "updated_at": row[1] if row else None, "facts": list(reversed(facts))}

    def save(self, customer_id: str, facts: list[str], summary: str | None) -> int:
        added = 0
        now = time.time()
        for f in facts:
            f = f.strip()
            if not f or len(f) > 240:
                continue
            try:
                self._conn.execute("INSERT INTO facts (customer_id, fact, created_at) VALUES (?,?,?)", (customer_id, f, now))
                added += 1
            except sqlite3.IntegrityError:
                pass
        if summary:
            self._conn.execute("INSERT INTO customers (id, summary, updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary, updated_at=excluded.updated_at", (customer_id, summary.strip()[:400], now))
        self._conn.commit()
        return added

    def forget(self, customer_id: str) -> None:
        self._conn.execute("DELETE FROM facts WHERE customer_id=?", (customer_id,))
        self._conn.execute("DELETE FROM customers WHERE id=?", (customer_id,))
        self._conn.commit()

    @staticmethod
    def render(memory: dict[str, Any]) -> str:
        if not memory.get("facts") and not memory.get("summary"):
            return ""
        lines = ["CUSTOMER MEMORY (from earlier sessions; use naturally, do not recite):"]
        if memory.get("summary"):
            lines.append(f"- Last time: {memory['summary']}")
        lines += [f"- {f}" for f in memory.get("facts", [])]
        return "\n".join(lines)


class MemoryWriter:
    """Background fact extraction with Muse Spark after each completed turn."""

    def __init__(self, store: MemoryStore, *, api_key: str, base_url: str, model: str):
        self._store = store
        self._api_key = api_key
        self._base_url = base_url
        self._model = model
        self._tasks: set[asyncio.Task] = set()

    def schedule(self, customer_id: str | None, user_text: str, assistant_text: str, on_saved=None) -> None:
        if not customer_id or not user_text.strip():
            return
        task = asyncio.create_task(self._extract(customer_id, user_text, assistant_text, on_saved))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _extract(self, customer_id: str, user_text: str, assistant_text: str, on_saved) -> None:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as http:
                async with http.post(
                    f"{self._base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json={
                        "model": self._model,
                        "temperature": 0,
                        "reasoning_effort": "low",
                        "messages": [
                            {"role": "system", "content": _EXTRACT_PROMPT},
                            {"role": "user", "content": f"CUSTOMER SAID: {user_text}\nADVISOR REPLIED: {assistant_text}"},
                        ],
                    },
                ) as res:
                    if res.status != 200:
                        logger.warning(f"[memory] HTTP {res.status}: {(await res.text())[:200]}")
                        return
                    data = await res.json()
            raw = (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
            cleaned = re.sub(r"```(?:json)?", "", raw, flags=re.I).replace("```", "").strip()
            s, e = cleaned.find("{"), cleaned.rfind("}")
            parsed = json.loads(cleaned[s : e + 1]) if s >= 0 and e > s else {}
            facts = [str(f) for f in parsed.get("facts") or [] if isinstance(f, str)]
            added = self._store.save(customer_id, facts, parsed.get("summary") if isinstance(parsed.get("summary"), str) else None)
            if on_saved:
                await on_saved(added, facts, parsed.get("summary"))
        except Exception as e:
            logger.warning(f"[memory] extraction failed: {e}")
