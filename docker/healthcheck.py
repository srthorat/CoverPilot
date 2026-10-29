"""Healthy when the web app answers and the voice agent's offer endpoint is up (GET -> 405)."""

import os
import sys
import urllib.error
import urllib.request


def status(url: str) -> int | None:
    try:
        return urllib.request.urlopen(url, timeout=3).status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


web = f"http://127.0.0.1:{os.environ.get('PORT', '3000')}/api/ice-servers"
agent = f"http://127.0.0.1:{os.environ.get('AGENT_PORT', '7860')}/api/offer"
sys.exit(0 if status(web) == 200 and status(agent) == 405 else 1)
