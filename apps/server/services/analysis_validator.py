"""Anti-hallucination / semantic validator for shot-analysis output (K4 server parity).

Mirror of validateAgainstFacts in apps/web/src/lib/analysisLint.ts — keep rules identical.
High precision: only flag clear contradictions of the deterministic ShotFacts.
"""

from __future__ import annotations

import re

from analysis_schema import REQUIRED_ANALYSIS_SECTIONS

_EARLY_EXIT_PATTERNS = [
    re.compile(r"terminat\w*\s+early", re.I),
    re.compile(r"\bearly\s+terminat", re.I),
    re.compile(r"ended?\s+(too\s+)?(early|prematurely)", re.I),
    re.compile(r"\bcut\s+short\b", re.I),
    re.compile(r"stopped?\s+before\s+reaching", re.I),
]
_CHANNELING_ASSERTION = re.compile(r"\bchannel(?:ing|ed|s)?\b", re.I)
_CHANNELING_NEGATION = re.compile(
    r"\b(no|not|without|absence of|isn'?t|wasn'?t)\b[^.]{0,30}channel", re.I
)


def validate_against_facts(text: str, facts: dict) -> dict:
    """Return {'valid': bool, 'issues': list[str]}."""
    issues: list[str] = []
    body = text or ""
    stages = facts.get("stages", [])

    has_targeted_weight_exit = any(
        s.get("reached")
        and s.get("trigger_type") == "weight"
        and (s.get("trigger_class") or {}).get("kind") == "targeted"
        for s in stages
    )
    if has_targeted_weight_exit and any(p.search(body) for p in _EARLY_EXIT_PATTERNS):
        issues.append("mischaracterized-targeted-exit")

    any_channeling = any((s.get("channeling") or {}).get("channeling") for s in stages)
    if (
        not any_channeling
        and _CHANNELING_ASSERTION.search(body)
        and not _CHANNELING_NEGATION.search(body)
    ):
        issues.append("unsupported-channeling")

    return {"valid": len(issues) == 0, "issues": issues}


def check_structure(text: str) -> dict:
    """Verify the analysis contains each required section title (L1)."""
    body = (text or "").lower()
    missing = [s for s in REQUIRED_ANALYSIS_SECTIONS if s.lower() not in body]
    return {"valid": not missing, "issues": ["missing-sections"] if missing else []}
