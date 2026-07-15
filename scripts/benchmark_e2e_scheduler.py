#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2"]
# ///
# ─── How to run ───
# uv run python scripts/benchmark_e2e_scheduler.py --mode legacy --runs 3 -- npm run e2e:matrix -- -- --legacy-runner

from __future__ import annotations

from pathlib import Path
import sys

if __package__ in {None, ""}:
    repository_path = str(Path(__file__).resolve().parents[1])
    if repository_path not in sys.path:
        sys.path.insert(0, repository_path)

from scripts.e2e_scheduler.benchmark_cli import (  # noqa: E402
    BenchmarkOptionError,
    parse_benchmark_options,
)
from scripts.e2e_scheduler.benchmark import BenchmarkAcceptanceError  # noqa: E402
from scripts.e2e_scheduler.benchmark_collect_models import (  # noqa: E402
    BenchmarkCollectionError,
)
from scripts.e2e_scheduler.benchmark_io import BenchmarkDocumentError  # noqa: E402
from scripts.e2e_scheduler.benchmark_report import BenchmarkReportError  # noqa: E402
from scripts.e2e_scheduler.evidence_expectations import (  # noqa: E402
    EvidenceExpectationError,
)
from scripts.e2e_scheduler.benchmark_harness import (  # noqa: E402
    execute_benchmark,
)
from scripts.e2e_scheduler.benchmark_process import (  # noqa: E402
    BenchmarkExecutionError,
)


def main(argv: list[str] | None = None) -> int:
    try:
        options = parse_benchmark_options(list(argv or sys.argv[1:]))
        return execute_benchmark(options, Path(__file__).resolve().parents[1])
    except (
        BenchmarkAcceptanceError,
        BenchmarkCollectionError,
        BenchmarkDocumentError,
        BenchmarkExecutionError,
        BenchmarkOptionError,
        BenchmarkReportError,
        EvidenceExpectationError,
    ) as error:
        print(f"[e2e-benchmark] {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
