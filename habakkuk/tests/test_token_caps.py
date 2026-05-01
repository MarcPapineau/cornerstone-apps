"""
Hard-fail tests for the 32K prompt cap.

Run with: python -m unittest habakkuk.tests.test_token_caps
"""

from __future__ import annotations

import pathlib
import unittest

from habakkuk.shared.config import (
    BUNDLE_TOKEN_CAP, PROMPT_TOKEN_CAP, assert_under_cap, estimate_tokens,
)
from habakkuk.shared.prompts import (
    common_preamble, load_anti_drift_block, load_wku_block,
)
from habakkuk.stages.compress import _build_one_bundle
from habakkuk.shared.diff_utils import DiffFile


class TestPromptTokenCaps(unittest.TestCase):
    def test_anti_drift_block_loads(self):
        text = load_anti_drift_block()
        self.assertIn("seven hard rules", text.lower())
        # The block itself must fit comfortably so it never alone blows
        # the cap when combined with rubric + bundle + plan.
        # Soft cap: block + WKU + identity must fit comfortably alongside
        # rubric (~2K) + plan (~600) + bundle (24K) inside the 32K hard cap.
        self.assertLess(estimate_tokens(text), 800,
            "Anti-Drift block too large; trim to keep room for bundle.")

    def test_wku_block_loads(self):
        text = load_wku_block()
        self.assertIn("Wisdom", text)
        self.assertIn("Knowledge", text)
        self.assertIn("Understanding", text)
        self.assertLess(estimate_tokens(text), 800)

    def test_common_preamble_under_2k_tokens(self):
        # Anti-Drift + WKU + identity must fit cleanly.
        for stage in ("plan", "fanout", "verify", "rank", "present"):
            preamble = common_preamble(stage, area="security" if stage == "fanout" else None)
            tok = estimate_tokens(preamble)
            self.assertLess(tok, 2000,
                f"Preamble for {stage} estimated {tok} tokens — too large.")

    def test_assert_under_cap_raises(self):
        big = "a" * (PROMPT_TOKEN_CAP * 4 * 2)  # ~2x cap
        with self.assertRaises(RuntimeError) as ctx:
            assert_under_cap(big, label="test")
        self.assertIn("HABAKKUK_TOKEN_CAP_EXCEEDED", str(ctx.exception))

    def test_assert_under_cap_passes(self):
        small = "x" * 1000
        n = assert_under_cap(small, label="test")
        self.assertGreater(n, 0)
        self.assertLess(n, PROMPT_TOKEN_CAP)


class TestBundleTokenCap(unittest.TestCase):
    """COMPRESS stage must NEVER produce a bundle > BUNDLE_TOKEN_CAP."""

    def _make_diff_file(self, path: str, additions: int, lang: str) -> DiffFile:
        body = "\n".join(f"+ line {i}" for i in range(additions))
        diff = f"diff --git a/{path} b/{path}\n+++ b/{path}\n{body}\n"
        return DiffFile(
            path=path, status="M", additions=additions, deletions=0,
            is_binary=False, diff_text=diff, language=lang,
        )

    def test_normal_bundle(self):
        files = [self._make_diff_file(f"src/file_{i}.js", 50, "js") for i in range(20)]
        bundle = _build_one_bundle("ux-a11y", files, cap_tokens=BUNDLE_TOKEN_CAP)
        self.assertLessEqual(bundle.token_estimate, BUNDLE_TOKEN_CAP)

    def test_oversize_input_truncates_or_drops(self):
        # 50 huge files would be ~50K tokens uncompressed; bundle MUST cap.
        files = [self._make_diff_file(f"src/big_{i}.js", 500, "js") for i in range(50)]
        bundle = _build_one_bundle("ux-a11y", files, cap_tokens=BUNDLE_TOKEN_CAP)
        self.assertLessEqual(bundle.token_estimate, BUNDLE_TOKEN_CAP,
            f"Bundle overflowed cap: {bundle.token_estimate} > {BUNDLE_TOKEN_CAP}")
        # Some files were either truncated or dropped — that's the fix.
        self.assertTrue(
            len(bundle.truncated_files) > 0 or len(bundle.file_paths) < 50,
            "Compress should have truncated or dropped files to stay under cap",
        )

    def test_empty_input_produces_empty_bundle(self):
        bundle = _build_one_bundle("perf", [], cap_tokens=BUNDLE_TOKEN_CAP)
        self.assertEqual(len(bundle.file_paths), 0)
        self.assertLessEqual(bundle.token_estimate, BUNDLE_TOKEN_CAP)


class TestRubricsAreSmall(unittest.TestCase):
    """Each rubric must fit under 500 words and must NOT itself contain
    the Anti-Drift block (the orchestrator injects it, so duplicating it
    would double the budget)."""

    def test_rubrics_within_word_budget(self):
        rubric_dir = pathlib.Path(__file__).resolve().parents[1] / "rubrics"
        for area in ("security", "perf", "ux-a11y", "data-integrity", "api-contracts", "tests-coverage"):
            p = rubric_dir / f"{area}.md"
            self.assertTrue(p.exists(), f"Missing rubric: {p}")
            words = len(p.read_text(encoding="utf-8").split())
            self.assertLessEqual(words, 500,
                f"{area} rubric is {words} words — over the 500-word cap.")


if __name__ == "__main__":
    unittest.main()
