"""
Habakkuk v1 orchestrator.

Single entry: `python -m habakkuk.run --branch <branch> [--base main] [--repo .]`

Chains: PLAN → COMPRESS → FAN-OUT (parallel) → VERIFY → RANK → PRESENT.

Memory hand-off pattern (Anthropic multi-agent doctrine):
  - Every stage reads/writes from <run_dir> on disk.
  - No data is passed between stages in memory.
  - Restartable from any stage by pointing --resume-run-id at the existing
    run dir (any stage's outputs that already exist are skipped).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import subprocess
import sys
import time
import uuid
from typing import Any

from .shared.config import RUNS_DIR, ensure_dirs
from .shared.diff_utils import build_plan_input, list_diff_files
from .shared.llm import flush_langfuse, langfuse_status, langfuse_trace_url
from .stages.compress import compress
from .stages.fanout import run_fanout
from .stages.plan import run_plan
from .stages.present import run_present
from .stages.rank import run_rank
from .stages.verify import run_verify


def _git_ref(repo: pathlib.Path) -> str:
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=str(repo), text=True
        ).strip()
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=str(repo), text=True
        ).strip()
        return f"{branch}@{sha[:12]}"
    except subprocess.CalledProcessError:
        return "(uncommitted)"


def _make_run_dir(branch: str, head_sha: str) -> pathlib.Path:
    ts = dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    safe_branch = branch.replace("/", "-").replace(" ", "_")[:60]
    name = f"{ts}-{safe_branch}-{head_sha[:8]}-{uuid.uuid4().hex[:6]}"
    p = RUNS_DIR / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="habakkuk", description="CRG multi-agent code review")
    ap.add_argument("--branch", required=True, help="Branch to review (head)")
    ap.add_argument("--base", default="main", help="Base branch (default: main)")
    ap.add_argument(
        "--repo", default=".", type=pathlib.Path,
        help="Path to git repo containing the branch (default: cwd)",
    )
    ap.add_argument(
        "--title", default="",
        help="Optional PR-style title (defaults to branch name)",
    )
    ap.add_argument(
        "--no-docx", action="store_true",
        help="Skip .docx conversion (still produces brief.md)",
    )
    ap.add_argument(
        "--resume-run-dir", default=None, type=pathlib.Path,
        help="Resume from an existing run dir (skips stages whose outputs exist)",
    )
    args = ap.parse_args(argv)

    repo = args.repo.resolve()
    if not (repo / ".git").exists():
        print(f"ERROR: --repo {repo} is not a git repository", file=sys.stderr)
        return 2

    ensure_dirs()
    habakkuk_repo = pathlib.Path(__file__).resolve().parent.parent
    habakkuk_ref = _git_ref(habakkuk_repo)

    print(f"\n[habakkuk] start  branch={args.branch}  base={args.base}  repo={repo}")
    print(f"[habakkuk] habakkuk-ref={habakkuk_ref}")
    lf = langfuse_status()
    print(f"[habakkuk] langfuse={lf['available']} host={lf.get('host')}")

    t_start = time.time()

    # ---- 1. Build plan input (Python only) -------------------------------
    plan_input = build_plan_input(
        branch=args.branch, base=args.base, repo=repo, title=args.title or args.branch,
    )
    print(f"[habakkuk] diff: {plan_input.file_count} files, "
          f"+{plan_input.additions}/-{plan_input.deletions}")

    # ---- run dir ---------------------------------------------------------
    run_dir = args.resume_run_dir or _make_run_dir(args.branch, plan_input.head_sha)
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"[habakkuk] run_dir={run_dir}")

    trace_id = str(uuid.uuid4())
    overall_meta: dict[str, Any] = {
        "branch": args.branch,
        "base": args.base,
        "head_sha": plan_input.head_sha,
        "base_sha": plan_input.base_sha,
        "file_count": plan_input.file_count,
        "additions": plan_input.additions,
        "deletions": plan_input.deletions,
        "trace_id": trace_id,
        "habakkuk_git_ref": habakkuk_ref,
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    (run_dir / "run.meta.json").write_text(
        json.dumps(overall_meta, indent=2), encoding="utf-8"
    )

    stage_metas: dict[str, Any] = {}

    # ---- 2. PLAN ---------------------------------------------------------
    if (run_dir / "plan.md").exists():
        print("[habakkuk] PLAN — resumed from disk")
        stage_metas["plan"] = json.loads((run_dir / "plan.meta.json").read_text())
    else:
        t = time.time()
        stage_metas["plan"] = run_plan(plan_input=plan_input, run_dir=run_dir, trace_id=trace_id)
        print(f"[habakkuk] PLAN done ({time.time()-t:.1f}s)")

    plan_text = (run_dir / "plan.md").read_text(encoding="utf-8")

    # ---- 3. COMPRESS -----------------------------------------------------
    if (run_dir / "bundles" / "manifest.json").exists():
        print("[habakkuk] COMPRESS — resumed from disk")
        manifest = json.loads((run_dir / "bundles" / "manifest.json").read_text())
        # Reconstruct minimal Bundle objects from manifest + bundle file text
        from .stages.compress import Bundle
        bundles = {}
        for area, m in manifest.items():
            text = pathlib.Path(m["path"]).read_text(encoding="utf-8")
            bundles[area] = Bundle(
                area=area,
                file_paths=m["files_included"],
                deleted_files=m["deleted"],
                binary_files=m["binary"],
                truncated_files=m.get("truncated", []),
                text=text,
                token_estimate=m["token_estimate"],
            )
    else:
        t = time.time()
        diff_files = list_diff_files(args.base, args.branch, repo)
        bundles = compress(files=diff_files, run_dir=run_dir)
        print(f"[habakkuk] COMPRESS done ({time.time()-t:.1f}s) "
              f"max_bundle_tokens={max(b.token_estimate for b in bundles.values())}")
    stage_metas["compress"] = {
        area: {"tokens": b.token_estimate, "files": len(b.file_paths)}
        for area, b in bundles.items()
    }

    # ---- 4. FAN-OUT (parallel) -------------------------------------------
    findings_dir = run_dir / "findings"
    if findings_dir.exists() and all(
        (findings_dir / f"{a}.json").exists() for a in bundles.keys()
    ):
        print("[habakkuk] FAN-OUT — resumed from disk")
        stage_metas["fanout"] = json.loads((run_dir / "fanout.meta.json").read_text())
    else:
        t = time.time()
        stage_metas["fanout"] = run_fanout(
            bundles=bundles, plan_text=plan_text, run_dir=run_dir, trace_id=trace_id,
        )
        kept = sum(m.get("findings_kept", 0) for m in stage_metas["fanout"])
        print(f"[habakkuk] FAN-OUT done ({time.time()-t:.1f}s) findings_raw={kept}")

    # ---- 5. VERIFY -------------------------------------------------------
    if (run_dir / "verified.json").exists():
        print("[habakkuk] VERIFY — resumed from disk")
        stage_metas["verify"] = json.loads((run_dir / "verify.meta.json").read_text())
    else:
        t = time.time()
        stage_metas["verify"] = run_verify(repo=repo, run_dir=run_dir, trace_id=trace_id)
        print(f"[habakkuk] VERIFY done ({time.time()-t:.1f}s) "
              f"survivors={stage_metas['verify']['output_count']}/{stage_metas['verify']['input_count']}")

    # ---- 6. RANK ---------------------------------------------------------
    if (run_dir / "ranked.json").exists():
        print("[habakkuk] RANK — resumed from disk")
        stage_metas["rank"] = json.loads((run_dir / "rank.meta.json").read_text())
    else:
        t = time.time()
        stage_metas["rank"] = run_rank(run_dir=run_dir, trace_id=trace_id)
        print(f"[habakkuk] RANK done ({time.time()-t:.1f}s) "
              f"deduped={stage_metas['rank']['deduped_count']} "
              f"blockers={stage_metas['rank']['blockers']}")

    # ---- 7. PRESENT ------------------------------------------------------
    wall = time.time() - t_start
    if (run_dir / "brief.md").exists() and not args.resume_run_dir:
        print("[habakkuk] PRESENT — already exists, regenerating")
    t = time.time()
    stage_metas["present"] = run_present(
        run_dir=run_dir,
        branch=args.branch,
        base=args.base,
        head_sha=plan_input.head_sha,
        base_sha=plan_input.base_sha,
        file_count=plan_input.file_count,
        additions=plan_input.additions,
        deletions=plan_input.deletions,
        wall_time_s=wall,
        habakkuk_git_ref=habakkuk_ref,
        trace_id=trace_id,
    )
    print(f"[habakkuk] PRESENT done ({time.time()-t:.1f}s)")

    overall_meta["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    overall_meta["wall_time_s"] = wall
    overall_meta["stages"] = stage_metas
    overall_meta["langfuse_trace_url"] = langfuse_trace_url(trace_id)
    (run_dir / "run.meta.json").write_text(
        json.dumps(overall_meta, indent=2), encoding="utf-8"
    )

    flush_langfuse()

    print(f"\n[habakkuk] DONE  total_wall={wall:.1f}s")
    print(f"[habakkuk] brief: {run_dir/'brief.md'}")
    docx = stage_metas["present"].get("docx_path")
    if docx:
        print(f"[habakkuk] docx:  {docx}")
    print(f"[habakkuk] trace: {overall_meta['langfuse_trace_url']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
