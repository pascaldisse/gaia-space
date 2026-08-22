#!/usr/bin/env python3
"""Count parity status rows from the canonical reports/parity ledger."""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import re
import sys

STATUSES = ("done", "partial", "stub", "missing")
REPORTS = (
    "01-git-code-review.md", "02-issues-boards.md", "03-packages-cicd.md",
    "04-collab.md", "05-auth-permissions.md", "06-personal-org.md",
    "07-devenv-api.md", "08-video-calls.md",
)
TOTALS_RE = re.compile(
    r"TOTALS \(8/8 audited, (?P<rows>\d+) rows\): done (?P<done>\d+) · "
    r"partial (?P<partial>\d+) · stub (?P<stub>\d+) · missing (?P<missing>\d+)\."
)
SECTION_RE = re.compile(r"^## (?P<index>\d{2}) .*\brows: reports/parity/(?P<report>[^ );]+)")
SECTION_TOTALS_RE = re.compile(r"^(?P<rows>\d+) rows — (?P<statuses>.+)\.$")
SECTION_STATUS_RE = re.compile(r"(?P<status>done|partial|stub|missing) (?P<count>\d+)")


def rows(path: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    for line in path.read_text(encoding="utf-8").splitlines():
        cells = line.split("|")
        # Markdown table: empty leading cell, feature, source, status, evidence, note.
        if len(cells) >= 5 and cells[3].strip() in STATUSES:
            counts[cells[3].strip()] += 1
    return counts


def section_errors(parity: str, counts: list[Counter[str]]) -> list[str]:
    lines = parity.splitlines()
    sections = [(number + 1, found) for number, line in enumerate(lines)
                if (found := SECTION_RE.match(line))]
    if len(sections) != len(REPORTS):
        return [f"PARITY.md section headings: expected {len(REPORTS)}, got {len(sections)}"]

    errors = []
    for position, ((line_number, heading), count) in enumerate(zip(sections, counts), start=1):
        expected_report = REPORTS[position - 1]
        if heading["index"] != f"{position:02}" or heading["report"] != expected_report:
            errors.append(
                f"PARITY.md section heading line {line_number}: expected {position:02} / {expected_report}, "
                f"got {heading['index']} / {heading['report']}"
            )
            continue
        summary = SECTION_TOTALS_RE.match(lines[line_number]) if line_number < len(lines) else None
        expected = {"rows": sum(count.values()), **{status: count[status] for status in STATUSES}}
        actual = {"rows": int(summary["rows"])} if summary else None
        if actual is not None:
            actual.update({status: 0 for status in STATUSES})
            actual.update({match["status"]: int(match["count"])
                           for match in SECTION_STATUS_RE.finditer(summary["statuses"])})
        if actual != expected:
            errors.append(
                f"PARITY.md section totals after line {line_number}: expected {expected}, got {actual}"
            )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="also validate PARITY.md totals and section headings")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    report_paths = [root / "reports/parity" / name for name in REPORTS]
    missing = [str(path.relative_to(root)) for path in report_paths if not path.is_file()]
    if missing:
        parser.error("missing canonical report(s): " + ", ".join(missing))
    stray = sorted(
        path.name
        for path in (root / "reports/parity").glob("*.md")
        if path.name not in REPORTS
    )
    if stray:
        parser.error("non-canonical ledger file(s) in reports/parity: " + ", ".join(stray))

    total: Counter[str] = Counter()
    section_counts = []
    for path in report_paths:
        count = rows(path)
        section_counts.append(count)
        total.update(count)
        print(f"{path.relative_to(root)}: rows {sum(count.values())} · " + " · ".join(f"{s} {count[s]}" for s in STATUSES))
    rendered = f"rows {sum(total.values())} · " + " · ".join(f"{s} {total[s]}" for s in STATUSES)
    print(f"TOTAL: {rendered}")
    if not args.check:
        return 0

    parity = (root / "PARITY.md").read_text(encoding="utf-8")
    found = TOTALS_RE.search(parity)
    expected = {"rows": sum(total.values()), **{status: total[status] for status in STATUSES}}
    actual = {key: int(value) for key, value in found.groupdict().items()} if found else None
    if actual != expected:
        print(f"PARITY.md TOTALS mismatch: expected {expected}, got {actual}", file=sys.stderr)
        return 1
    errors = section_errors(parity, section_counts)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
