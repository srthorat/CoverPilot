"""Knowledge base: product clauses, rules and FAQ, retrieved per turn.

The static system prompt keeps only the core rules. Each turn, the most relevant
knowledge chunks for the customer's words are attached to the prompt, so the
base can grow (full policy wording, FAQ, regulatory circulars) without growing
every request. Chunks live in ``knowledge/*.md`` as ``## Heading`` sections and
are ranked with BM25 (no embedding service needed).
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

_KB_DIR = Path(__file__).resolve().parent.parent / "knowledge"
_TOKEN = re.compile(r"[\wऀ-ॿ]+", re.UNICODE)
_STOP = set("a an the is are to of in on for and or with my i you we it this that what how do does can please about me".split())


# Light normalisation so "nominate my son" finds the nominee/minor chunks and Hindi
# or Marathi questions reach the English knowledge. Extend as the base grows.
_SYNONYMS: dict[str, list[str]] = {
    "nominate": ["nominee", "nomination"], "nominees": ["nominee"], "nomination": ["nominee"],
    "son": ["child", "children", "minor"], "daughter": ["child", "children", "minor"], "kid": ["child", "minor"],
    "boy": ["child", "minor"], "girl": ["child", "minor"], "wife": ["spouse"], "husband": ["spouse"],
    "smoke": ["tobacco", "smoker"], "smoking": ["tobacco", "smoker"], "cigarette": ["tobacco"],
    "cancel": ["free", "look", "refund"], "cancellation": ["free", "look", "refund"], "freelook": ["free", "look"],
    "salary": ["income"], "ctc": ["income"], "earn": ["income"], "earning": ["income"],
    "birthday": ["date", "birth"], "dob": ["date", "birth"], "age": ["date", "birth"],
    "miss": ["grace", "lapse"], "missed": ["grace", "lapse"], "late": ["grace"],
    "money": ["premium", "payout"], "pay": ["premium"], "cost": ["premium"], "price": ["premium"],
    "guardian": ["appointee"], "trust": ["mwpa"], "creditor": ["mwpa"], "loan": ["mwpa", "creditor"],
    "cancer": ["critical", "illness"], "heart": ["critical", "illness", "cardiac"], "disease": ["illness", "disclosure"],
    "accident": ["accidental", "atpd"], "disability": ["atpd", "accidental"], "waiver": ["waiver", "premium"],
    "cash": ["hospital", "daily", "cash"], "daily": ["hospital", "cash"], "hospitalisation": ["hospital", "daily", "cash"],
    "hospitalise": ["hospital", "daily", "cash"], "admitted": ["hospital", "daily"],
    "claim": ["claim", "settlement"], "death": ["sum", "assured", "nominee"],
    "lie": ["misrepresentation", "disclosure", "wrongly"], "lied": ["misrepresentation", "disclosure"], "lying": ["misrepresentation", "disclosure"],
    "hide": ["disclosure", "misrepresentation"], "hiding": ["disclosure", "misrepresentation"], "false": ["misrepresentation", "wrongly"], "wrong": ["wrongly", "misrepresentation"],
    "declare": ["declared", "disclosure"], "declared": ["disclosure"], "declaring": ["declared", "disclosure"], "misdeclare": ["misrepresentation", "wrongly"],
    "happen": ["consequence", "repudiate", "claim"], "happens": ["consequence", "repudiate", "claim"], "consequence": ["repudiate", "claim"], "caught": ["investigated", "repudiate"],
    "reject": ["repudiate"], "rejected": ["repudiate"], "rejection": ["repudiate"], "discount": ["discount", "non-smoker", "smoker"],
    "alcohol": ["alcohol", "drink"], "drink": ["alcohol"], "drinking": ["alcohol"], "job": ["occupation"], "work": ["occupation"], "hobby": ["hazardous", "activity"],
    "स्मोकर": ["smoker", "tobacco"], "स्मोकिंग": ["smoker", "tobacco"], "होगा": ["consequence", "repudiate", "claim"], "होईल": ["consequence", "repudiate", "claim"],
    "डिस्काउंट": ["discount", "non-smoker"], "सूट": ["discount"], "इनकम": ["income"], "सैलरी": ["income", "salary"], "नॉमिनी": ["nominee"],
    "झूठ": ["misrepresentation", "disclosure"], "गलत": ["wrongly", "misrepresentation"], "छुपा": ["disclosure", "misrepresentation"], "खोटे": ["misrepresentation", "wrongly"], "लपव": ["disclosure", "misrepresentation"],
    # Hindi / Marathi -> English
    "नॉमिनी": ["nominee"], "नामांकन": ["nominee", "nomination"], "वारस": ["nominee"], "वारसदार": ["nominee"],
    "पत्नी": ["spouse"], "पति": ["spouse"], "बेटा": ["child", "minor"], "बेटी": ["child", "minor"], "बच्चा": ["child", "minor"], "मुलगा": ["child", "minor"], "मुलगी": ["child", "minor"],
    "प्रीमियम": ["premium"], "हप्ता": ["premium", "grace"], "किस्त": ["premium", "grace"],
    "टैक्स": ["tax"], "कर": ["tax"], "आयकर": ["tax"], "आय": ["income"], "आमदनी": ["income"], "उत्पन्न": ["income"], "वेतन": ["income", "salary"], "पगार": ["income", "salary"],
    "क्लेम": ["claim"], "दावा": ["claim"], "कवर": ["cover", "sum", "assured"], "बीमा": ["insurance", "policy"], "पॉलिसी": ["policy"],
    "रद्द": ["free", "look", "refund", "cancel"], "रिफंड": ["refund"], "छूट": ["discount", "grace"], "सवलत": ["discount", "grace"],
    "जन्म": ["date", "birth"], "जन्मतिथि": ["date", "birth"], "जन्मतारीख": ["date", "birth"], "उम्र": ["date", "birth"], "वय": ["date", "birth"],
    "धूम्रपान": ["tobacco", "smoker"], "तंबाकू": ["tobacco", "smoker"], "सिगरेट": ["tobacco"],
    "गंभीर": ["critical", "illness"], "बीमारी": ["illness", "critical"], "आजार": ["illness", "critical"], "दुर्घटना": ["accidental", "atpd"], "अपघात": ["accidental", "atpd"],
    "धारा": ["section"], "कलम": ["section"], "नियम": ["terms", "clause"], "शर्त": ["terms", "clause"], "अटी": ["terms", "clause"],
    # Process, claims, grievance and cover-choice vocabulary
    "complaint": ["grievance", "ombudsman"], "complain": ["grievance", "ombudsman"], "grievance": ["complaint", "ombudsman"],
    "ombudsman": ["complaint", "grievance"], "irdai": ["ombudsman", "grievance"], "escalate": ["grievance", "ombudsman"],
    "esign": ["signature", "consent"], "signature": ["esign", "consent"], "sign": ["esign", "signature"], "otp": ["esign", "consent"],
    "kyc": ["identity", "documents", "aadhaar"], "aadhaar": ["kyc", "identity"], "pan": ["kyc", "identity"], "passport": ["kyc", "identity"],
    "gst": ["tax", "exempt"], "taxable": ["tax", "benefits", "payout"], "deduction": ["tax", "benefits"], "payment": ["paying", "premium"], "upi": ["paying", "premium"], "autopay": ["paying", "premium"],
    "revive": ["revival", "lapse"], "revival": ["lapse", "revive"], "lapse": ["grace", "revival"], "lapsed": ["grace", "revival"],
    "documents": ["claim", "documents"], "settle": ["claim", "settlement"], "settled": ["claim", "settlement"], "interest": ["claim", "late"],
    "sibling": ["nominee", "collector"], "brother": ["nominee", "collector"], "sister": ["nominee", "collector"], "parent": ["nominee", "parents"],
    "mother": ["nominee", "parents"], "father": ["nominee", "parents"], "second": ["another", "nominee"], "another": ["nominee", "shares"],
    "share": ["shares", "nominee"], "split": ["shares", "nominee"], "appointee": ["minor", "appointee"],
    "term": ["term", "years"], "tenure": ["term", "years"], "duration": ["term", "years"],
    "rider": ["riders", "premium"], "riders": ["rider"], "endowment": ["savings", "pure", "term"], "savings": ["pure", "term"],
    "maturity": ["pure", "term"], "surrender": ["pure", "term"], "medical": ["test", "examination"], "checkup": ["test", "examination"],
    "scam": ["licensed", "irdai", "safe"], "safe": ["licensed", "irdai", "solvency"],
    "शिकायत": ["complaint", "grievance", "ombudsman"], "तक्रार": ["complaint", "grievance", "ombudsman"],
    "भुगतान": ["paying", "premium"], "पेमेंट": ["paying", "premium"], "भरणा": ["paying", "premium"],
    "हस्ताक्षर": ["esign", "signature"], "सही": ["esign", "signature"],
    "दस्तावेज": ["documents", "claim"], "कागदपत्रे": ["documents", "claim"], "मृत्यू": ["death", "claim"], "मृत्यु": ["death", "claim"],
}


def _stem(t: str) -> str:
    for suf in ("ing", "ies", "es", "ed", "s"):
        if len(t) > 4 and t.endswith(suf):
            return t[: -len(suf)] + ("y" if suf == "ies" else "")
    return t


def _tokens(text: str, expand: bool = False) -> list[str]:
    out: list[str] = []
    for w in (w.lower() for w in _TOKEN.findall(text)):
        if w in _STOP or len(w) < 2:
            continue
        out.append(w)
        st = _stem(w)
        if st != w:
            out.append(st)
        if expand:
            out.extend(_SYNONYMS.get(w, []))
    return out


@dataclass(frozen=True)
class Chunk:
    source: str
    heading: str
    text: str

    @property
    def label(self) -> str:
        return f"{self.source} › {self.heading}" if self.heading else self.source


class KnowledgeBase:
    def __init__(self, directory: Path = _KB_DIR):
        self.chunks: list[Chunk] = []
        self._load(directory)
        self._index()

    # ----------------------------------------------------------- loading
    def _load(self, directory: Path) -> None:
        if not directory.exists():
            return
        for path in sorted(directory.glob("*.md")):
            source = path.stem.replace("-", " ").replace("_", " ").title()
            heading, buf = "", []
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.startswith("## "):
                    self._flush(source, heading, buf)
                    heading, buf = line[3:].strip(), []
                elif line.startswith("# "):
                    continue
                else:
                    buf.append(line)
            self._flush(source, heading, buf)

    def _flush(self, source: str, heading: str, buf: list[str]) -> None:
        text = "\n".join(buf).strip()
        if text:
            self.chunks.append(Chunk(source=source, heading=heading, text=text))

    # ----------------------------------------------------------- BM25
    def _index(self) -> None:
        self._docs = [_tokens(f"{c.heading} {c.heading} {c.text}") for c in self.chunks]
        self._avgdl = (sum(len(d) for d in self._docs) / len(self._docs)) if self._docs else 1.0
        df: Counter[str] = Counter()
        for d in self._docs:
            df.update(set(d))
        n = len(self._docs)
        self._idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self._tf = [Counter(d) for d in self._docs]

    def search(self, query: str, k: int = 4, min_score: float = 0.5) -> list[tuple[float, Chunk]]:
        q = _tokens(query, expand=True)
        if not q or not self.chunks:
            return []
        k1, b = 1.5, 0.75
        scored: list[tuple[float, Chunk]] = []
        for i, chunk in enumerate(self.chunks):
            tf, dl = self._tf[i], len(self._docs[i])
            s = 0.0
            for t in q:
                if t not in tf:
                    continue
                f = tf[t]
                s += self._idf.get(t, 0.0) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / self._avgdl))
            if s >= min_score:
                scored.append((s, chunk))
        scored.sort(key=lambda x: -x[0])
        return scored[:k]

    def matched_terms(self, query: str, chunk: "Chunk") -> list[str]:
        tf = self._tf[self.chunks.index(chunk)]
        out: list[str] = []
        for w in (w.lower() for w in _TOKEN.findall(query)):
            if w in _STOP or len(w) < 2:
                continue
            for t in [w, _stem(w), *_SYNONYMS.get(w, [])]:
                if t in tf:
                    shown = t if t == w else f"{w}→{t}"
                    if shown not in out:
                        out.append(shown)
        return out

    def context_for(self, query: str, k: int = 4, max_chars: int = 2400) -> str:
        return self.hits_to_context(self.search(query, k=k), max_chars=max_chars)

    def hits_to_context(self, hits: list[tuple[float, "Chunk"]], max_chars: int = 2400) -> str:
        parts, used = [], 0
        for _score, chunk in hits:
            block = f"[{chunk.label}]\n{chunk.text}"
            if used + len(block) > max_chars:
                break
            parts.append(block)
            used += len(block)
        return "\n\n".join(parts)
