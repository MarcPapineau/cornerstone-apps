"""
Structural dedupe tests — the architectural fix for ultrareview.

Two agents producing the SAME claim about the SAME line of the SAME file
MUST collide on the deterministic key. No LLM consolidation needed.
"""

from __future__ import annotations

import unittest

from habakkuk.shared.schema import (
    claim_hash, make_finding_id, validate_finding,
)
from habakkuk.stages.rank import _structural_dedupe


def _f(file: str, ls: int, claim: str, area: str, sev: str = "Major", conf: float = 0.85) -> dict:
    return {
        "id": make_finding_id(file, ls, claim, area),
        "severity": sev,
        "area": area,
        "file": file,
        "line_start": ls,
        "line_end": ls + 2,
        "snippet": "snippet text",
        "claim": claim,
        "suggested_fix": "fix it",
        "confidence": conf,
    }


class TestDeterministicKeys(unittest.TestCase):
    def test_same_file_line_claim_same_id(self):
        a = make_finding_id("a.js", 10, "missing null check", "security")
        b = make_finding_id("a.js", 10, "missing null check", "security")
        self.assertEqual(a, b)

    def test_diff_area_diff_id(self):
        # Cross-area dedupe is by claim_hash (no area), so finding ids
        # differ but claim_hashes match. That's exactly how Rank merges.
        a = make_finding_id("a.js", 10, "missing null check", "security")
        b = make_finding_id("a.js", 10, "missing null check", "data-integrity")
        self.assertNotEqual(a, b)
        self.assertEqual(
            claim_hash("a.js", 10, "missing null check"),
            claim_hash("a.js", 10, "missing null check"),
        )

    def test_case_and_whitespace_normalized(self):
        a = make_finding_id("a.js", 10, "  Missing Null Check ", "security")
        b = make_finding_id("a.js", 10, "missing null check", "security")
        self.assertEqual(a, b)


class TestStructuralDedupe(unittest.TestCase):
    def test_two_agents_same_claim_collapse(self):
        findings = [
            _f("a.js", 10, "race condition on save", "security", "Major", 0.85),
            _f("a.js", 10, "race condition on save", "data-integrity", "Blocker", 0.92),
        ]
        out = _structural_dedupe(findings)
        self.assertEqual(len(out), 1)
        # Highest severity wins — Blocker > Major.
        self.assertEqual(out[0]["severity"], "Blocker")
        # Other area surfaces in `also_areas`.
        self.assertIn("security", out[0].get("also_areas", []))
        self.assertEqual(out[0]["dedupe_size"], 2)

    def test_distinct_findings_preserved(self):
        findings = [
            _f("a.js", 10, "race condition", "security"),
            _f("a.js", 11, "different bug", "security"),
            _f("b.js", 10, "race condition", "security"),
        ]
        out = _structural_dedupe(findings)
        self.assertEqual(len(out), 3)

    def test_higher_confidence_wins_within_severity(self):
        findings = [
            _f("a.js", 10, "claim", "security", "Major", 0.7),
            _f("a.js", 10, "claim", "perf", "Major", 0.9),
        ]
        out = _structural_dedupe(findings)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["confidence"], 0.9)


class TestValidate(unittest.TestCase):
    def test_validate_finding_accepts_good(self):
        f = _f("a.js", 5, "claim", "perf")
        ok, _ = validate_finding(f)
        self.assertTrue(ok)

    def test_validate_finding_rejects_bad_severity(self):
        f = _f("a.js", 5, "c", "perf", sev="Catastrophic")
        ok, why = validate_finding(f)
        self.assertFalse(ok)
        self.assertIn("severity", why)

    def test_validate_finding_rejects_bad_lines(self):
        f = _f("a.js", 5, "c", "perf")
        f["line_end"] = 2
        ok, why = validate_finding(f)
        self.assertFalse(ok)
        self.assertIn("line_end", why)

    def test_validate_finding_rejects_out_of_range_confidence(self):
        f = _f("a.js", 5, "c", "perf")
        f["confidence"] = 1.5
        ok, _ = validate_finding(f)
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
