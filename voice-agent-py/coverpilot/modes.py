"""Which model answers after a `set_mode` message.

The two agents share one session and one LLMSwitcher: the OmniCB co-browse agent answers with Muse Spark, the
Integrity Guardian with Muse Spark Open. GUARDIAN_PROVIDER=spark (the same switch the web review uses) runs the
Guardian on Muse Spark instead; that is an explicit setting, never a silent fallback. Kept apart from bot.py so
the decision is testable without a pipeline.
"""

from __future__ import annotations

from typing import Any

GUARDIAN_NEEDS_OPEN = "Integrity Guardian needs Muse Spark Open: set GUARDIAN_OPEN_BASE_URL and GUARDIAN_OPEN_API_KEY (or GUARDIAN_PROVIDER=spark)"


def plan_mode_switch(
    mode: str,
    *,
    spark_service: Any,
    open_service: Any | None,
    spark_model: str,
    guardian_model: str,
    provider: str = "spark-open",
) -> tuple[str, Any]:
    """Return (model name, service to switch to) for the requested agent.

    Raises RuntimeError when the Guardian is asked for on Muse Spark Open and it is not configured, so the caller
    can refuse the switch before the session changes.
    """
    if mode == "guardian" and provider != "spark":
        if open_service is None:
            raise RuntimeError(GUARDIAN_NEEDS_OPEN)
        return guardian_model, open_service
    return spark_model, spark_service
