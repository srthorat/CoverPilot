"""Unit tests for BM25 knowledge retrieval (no network, no models)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from coverpilot.knowledge import Chunk, KnowledgeBase  # noqa: E402


@pytest.fixture(scope="module")
def kb() -> KnowledgeBase:
    return KnowledgeBase()


def test_loads_chunks_from_all_knowledge_files(kb: KnowledgeBase):
    sources = {c.source for c in kb.chunks}
    assert len(kb.chunks) > 0
    assert {"Policy Terms", "Nomination And Trust", "Faq"} <= sources


def test_every_chunk_has_text_and_label(kb: KnowledgeBase):
    for c in kb.chunks:
        assert c.text.strip()
        assert c.label.startswith(c.source)


def test_grace_period_question_retrieves_grace_clause(kb: KnowledgeBase):
    hits = kb.search("what is the grace period for premium", k=3)
    assert hits, "expected at least one hit"
    assert "grace" in hits[0][1].heading.lower()


def test_nominee_for_son_retrieves_minor_nominee_chunk(kb: KnowledgeBase):
    labels = [c.label for _, c in kb.search("nominate my son", k=4)]
    assert any("Minor" in label or "minor" in label.lower() for label in labels)


def test_hindi_premium_query_expands_to_english_terms(kb: KnowledgeBase):
    hits = kb.search("मला हप्ता कधी भरावा लागेल", k=2)
    assert hits
    assert "grace" in hits[0][1].heading.lower()


def test_search_scores_are_sorted_descending(kb: KnowledgeBase):
    scores = [s for s, _ in kb.search("premium grace period nominee", k=4)]
    assert scores == sorted(scores, reverse=True)


def test_search_respects_k(kb: KnowledgeBase):
    assert len(kb.search("premium", k=1)) <= 1


def test_irrelevant_query_returns_nothing(kb: KnowledgeBase):
    assert kb.search("xylophone banana spaceship", k=4) == []


def test_empty_query_returns_nothing(kb: KnowledgeBase):
    assert kb.search("   ", k=4) == []


def test_matched_terms_show_synonym_expansion(kb: KnowledgeBase):
    query = "मला हप्ता कधी भरावा लागेल"
    _, chunk = kb.search(query, k=1)[0]
    terms = kb.matched_terms(query, chunk)
    assert "हप्ता→premium" in terms
    assert "हप्ता→grace" in terms


def test_matched_terms_plain_english_words_are_not_arrowed(kb: KnowledgeBase):
    query = "grace period"
    _, chunk = kb.search(query, k=1)[0]
    terms = kb.matched_terms(query, chunk)
    assert "grace" in terms and "period" in terms
    assert not any("→" in t for t in terms if t in ("grace", "period"))


def test_matched_terms_empty_when_chunk_shares_no_terms(kb: KnowledgeBase):
    chunk = kb.chunks[0]
    assert kb.matched_terms("xylophone banana", chunk) == []


def test_hits_to_context_respects_char_budget(kb: KnowledgeBase):
    hits = kb.search("premium grace period nominee claim", k=4)
    context = kb.hits_to_context(hits, max_chars=300)
    assert len(context) <= 300


def test_hits_to_context_labels_each_block(kb: KnowledgeBase):
    hits = kb.search("grace period", k=1)
    context = kb.hits_to_context(hits)
    assert context.startswith(f"[{hits[0][1].label}]")


def test_hits_to_context_empty_input():
    kb = KnowledgeBase(directory=Path("/nonexistent-dir"))
    assert kb.chunks == []
    assert kb.hits_to_context([]) == ""


def test_chunks_split_on_level_two_headings(tmp_path: Path):
    (tmp_path / "sample-doc.md").write_text(
        "# Title\nintro line\n## First\nalpha beta\n## Second\ngamma delta\n", encoding="utf-8"
    )
    kb = KnowledgeBase(directory=tmp_path)
    assert [c.heading for c in kb.chunks] == ["", "First", "Second"]
    assert kb.chunks[0].text == "intro line"
    assert kb.chunks[1].source == "Sample Doc"
    assert kb.chunks[1].text == "alpha beta"


def test_empty_sections_are_dropped(tmp_path: Path):
    (tmp_path / "x.md").write_text("## Empty\n\n## Full\nsome text\n", encoding="utf-8")
    kb = KnowledgeBase(directory=tmp_path)
    assert [c.heading for c in kb.chunks] == ["Full"]


def test_chunk_label_without_heading():
    assert Chunk(source="Faq", heading="", text="x").label == "Faq"
