from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.e2e_scheduler.evidence_expectations import (
    EvidenceExpectationError,
    SemanticEvidenceIdentity,
    parse_evidence_expectations,
    parse_semantic_evidence_expectations,
)


def test_empty_expectation_journal_means_zero_expected_evidence(
    tmp_path: Path,
) -> None:
    path = tmp_path / "expectations.jsonl"
    _ = path.write_text("", encoding="utf-8")

    assert parse_evidence_expectations(path) == ()


def test_expectation_journal_parses_exact_screenshot_names(tmp_path: Path) -> None:
    path = tmp_path / "expectations.jsonl"
    _ = path.write_text(
        "\n".join(
            (
                '{"version":1,"kind":"screenshot","filename":"first.png"}',
                '{"version":1,"kind":"screenshot","filename":"second.png"}',
                "",
            )
        ),
        encoding="utf-8",
    )

    assert parse_evidence_expectations(path) == ("first.png", "second.png")


def test_semantic_expectation_journal_preserves_capture_multiset(
    tmp_path: Path,
) -> None:
    path = tmp_path / "expectations.jsonl"
    _ = path.write_text(
        "\n".join(
            (
                json.dumps(
                    {
                        "version": 2,
                        "kind": "screenshot",
                        "filename": "one.png",
                        "test_id": "desktop::auth.spec.js:1::logs in",
                        "capture_label": "ready",
                    }
                ),
                json.dumps(
                    {
                        "version": 2,
                        "kind": "screenshot",
                        "filename": "two.png",
                        "test_id": "desktop::auth.spec.js:1::logs in",
                        "capture_label": "ready",
                    }
                ),
                "",
            )
        ),
        encoding="utf-8",
    )

    assert parse_evidence_expectations(path) == ("one.png", "two.png")
    assert parse_semantic_evidence_expectations(path) == (
        SemanticEvidenceIdentity(
            "desktop::auth.spec.js:1::logs in",
            "ready",
        ),
        SemanticEvidenceIdentity(
            "desktop::auth.spec.js:1::logs in",
            "ready",
        ),
    )


def test_semantic_expectation_parser_rejects_legacy_identity(tmp_path: Path) -> None:
    path = tmp_path / "expectations.jsonl"
    _ = path.write_text(
        '{"version":1,"kind":"screenshot","filename":"legacy.png"}\n',
        encoding="utf-8",
    )

    with pytest.raises(EvidenceExpectationError, match="semantic identity"):
        _ = parse_semantic_evidence_expectations(path)


@pytest.mark.parametrize(
    "content",
    [
        None,
        "{\n",
        "\n".join(
            (
                '{"version":1,"kind":"screenshot","filename":"same.png"}',
                '{"version":1,"kind":"screenshot","filename":"same.png"}',
                "",
            )
        ),
        '{"version":1,"kind":"screenshot","filename":"../escape.png"}\n',
    ],
)
def test_expectation_journal_fails_closed(
    tmp_path: Path,
    content: str | None,
) -> None:
    path = tmp_path / "expectations.jsonl"
    if content is not None:
        _ = path.write_text(content, encoding="utf-8")

    with pytest.raises(EvidenceExpectationError):
        _ = parse_evidence_expectations(path)
