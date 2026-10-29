import json

from bot import load_policy_document
from coverpilot.session import SessionState

PAGES = {
    "name": "sample.pdf",
    "pages": [
        {"page": 1, "text": "Policy schedule. Sum assured 1,00,00,000 rupees. Monthly premium 1050 rupees. Term 30 years."},
        {"page": 3, "text": "Free-look period. You may cancel within thirty days of receiving this policy and the premium is refunded after deducting the proportionate risk premium, the medical examination cost and stamp duty."},
        {"page": 4, "text": "Grace period. Thirty days for quarterly, half-yearly and annual premiums and fifteen days for monthly premiums."},
    ],
}


def test_document_is_indexed_by_page_and_found():
    s = SessionState()
    info = load_policy_document(s, json.dumps(PAGES))
    assert info == {"ok": True, "name": "sample.pdf", "pages": 3, "passages": 3}
    hits = s.policy_doc.search("how long do I have to cancel the policy and get a refund", k=3, min_score=0.3)
    assert hits and hits[0][1].heading == "page 3"
    grace = s.policy_doc.search("what is the grace period for monthly premium", k=1, min_score=0.3)
    assert grace[0][1].heading == "page 4"


def test_empty_or_broken_documents_are_rejected():
    s = SessionState()
    assert load_policy_document(s, "not json")["ok"] is False
    assert load_policy_document(s, json.dumps({"name": "x.pdf", "pages": [{"page": 1, "text": "   "}]}))["ok"] is False
    assert s.policy_doc is None
