#!/usr/bin/env python3
"""Render a PR title/body bundle plus metadata for GitHub publication."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_MILESTONE = None
TRIAGE_LABELS = {
    "needs-triage",
    "needs-info",
    "ready-for-agent",
    "ready-for-human",
    "wontfix",
}


def run_cmd(cmd: list[str]) -> str:
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def try_run_cmd(cmd: list[str]) -> str | None:
    try:
        return run_cmd(cmd)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def run_git(args: list[str]) -> str:
    return run_cmd(["git", *args])


def try_run_git(args: list[str]) -> str | None:
    return try_run_cmd(["git", *args])


def try_run_gh(args: list[str]) -> str | None:
    return try_run_cmd(["gh", *args])


def normalize_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def meaningful_tokens(text: str) -> set[str]:
    stopwords = {
        "a",
        "an",
        "and",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "in",
        "into",
        "is",
        "it",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
        "issue",
        "ticket",
        "task",
        "subissue",
        "feat",
        "fix",
        "chore",
        "refactor",
        "docs",
        "test",
        "backend",
        "frontend",
    }
    return {token for token in normalize_text(text).split() if len(token) >= 3 and token not in stopwords}


def detect_issue_ref(*texts: str) -> str | None:
    patterns = [
        re.compile(r"#(\d+)\b"),
        re.compile(r"\b(?:issue|ticket|task|subissue)[-_/:\s]+(\d+)\b", re.IGNORECASE),
        re.compile(r"\b(?:fix|feat|chore|refactor|docs|test)\((?:[^)]*?)#(\d+)\)"),
        re.compile(r"\b(?:issue|ticket|task|subissue)[-_/:\s]*#?(\d+)\b", re.IGNORECASE),
    ]
    for text in texts:
        for pattern in patterns:
            match = pattern.search(text)
            if match:
                return f"#{match.group(1)}"
    return None


def infer_issue_ref_from_open_issues(*texts: str) -> str | None:
    issue_json = try_run_gh(
        [
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,body,url",
        ]
    )
    if not issue_json:
        return None

    try:
        issues = json.loads(issue_json)
    except json.JSONDecodeError:
        return None

    context_text = " ".join(texts)
    context_tokens = meaningful_tokens(context_text)
    context_norm = normalize_text(context_text)
    if not context_tokens and not context_norm:
        return None

    best_issue_ref: str | None = None
    best_score = 0

    for issue in issues:
        number = issue.get("number")
        title = str(issue.get("title") or "")
        body = str(issue.get("body") or "")
        issue_text = f"{title} {body}"
        issue_tokens = meaningful_tokens(issue_text)
        if not issue_tokens:
            continue

        overlap = len(context_tokens & issue_tokens)
        if overlap == 0:
            continue

        score = overlap * 2
        title_norm = normalize_text(title)
        if title_norm and title_norm in context_norm:
            score += 5
        elif context_norm and context_norm in title_norm:
            score += 3

        issue_phrase = " ".join(sorted(issue_tokens))
        if issue_phrase and issue_phrase in context_norm:
            score += 2

        if score > best_score:
            best_score = score
            best_issue_ref = f"#{number}"

    if best_score < 4:
        return None
    return best_issue_ref


def format_files(files: list[str]) -> str:
    if not files:
        return "- No file list could be derived from git."
    return "\n".join(f"- `{path}`" for path in files)


def build_title(title: str | None, issue_ref: str | None, commit_subject: str) -> str:
    base_title = title or commit_subject
    if issue_ref and issue_ref not in base_title:
        return f"{base_title} ({issue_ref})"
    return base_title


def load_repo_name() -> str | None:
    return try_run_gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])


def load_current_login() -> str | None:
    return try_run_gh(["api", "user", "--jq", ".login"])


def lookup_issue_metadata(issue_ref: str | None) -> dict[str, object] | None:
    if not issue_ref:
        return None

    issue_json = try_run_gh(
        [
            "issue",
            "view",
            issue_ref.lstrip("#"),
            "--json",
            "number,title,url,labels,milestone,assignees",
        ]
    )
    if not issue_json:
        return None

    try:
        data = json.loads(issue_json)
    except json.JSONDecodeError:
        return None

    labels = []
    for label in data.get("labels") or []:
        if isinstance(label, dict) and label.get("name"):
            labels.append(str(label["name"]))
        elif label:
            labels.append(str(label))

    assignees = []
    for assignee in data.get("assignees") or []:
        login = assignee.get("login") if isinstance(assignee, dict) else None
        if login:
            assignees.append(str(login))

    milestone = data.get("milestone") or {}
    milestone_title = milestone.get("title") if isinstance(milestone, dict) else None

    return {
        "number": f"#{data['number']}" if data.get("number") is not None else issue_ref,
        "title": str(data.get("title") or ""),
        "url": str(data.get("url") or ""),
        "labels": labels,
        "milestone": str(milestone_title) if milestone_title else None,
        "assignees": assignees,
    }


def classify_issue_labels(label_names: list[str]) -> dict[str, list[str]]:
    buckets = {
        "Ownership": [],
        "Dependencies": [],
        "Risk": [],
        "Priority": [],
        "Scope": [],
        "Status": [],
        "Type": [],
        "Area": [],
        "Other": [],
    }

    prefix_to_bucket = {
        "owner": "Ownership",
        "assignee": "Ownership",
        "team": "Ownership",
        "accountable": "Ownership",
        "dependency": "Dependencies",
        "depends-on": "Dependencies",
        "blocked-by": "Dependencies",
        "blocker": "Dependencies",
        "blocking": "Dependencies",
        "related-to": "Dependencies",
        "risk": "Risk",
        "priority": "Priority",
        "scope": "Scope",
        "status": "Status",
        "type": "Type",
        "area": "Area",
    }

    plain_keyword_to_bucket = {
        "blocked": "Dependencies",
        "blocking": "Dependencies",
        "dependency": "Dependencies",
        "dependencies": "Dependencies",
        "high-risk": "Risk",
        "low-risk": "Risk",
        "medium-risk": "Risk",
        "critical": "Risk",
        "urgent": "Priority",
    }

    for raw_label in label_names:
        label = str(raw_label).strip()
        if not label:
            continue

        normalized = label.lower()
        if normalized in plain_keyword_to_bucket:
            buckets[plain_keyword_to_bucket[normalized]].append(label)
            continue

        if ":" in label or "/" in label:
            separator = ":" if ":" in label else "/"
            bucket_key, value = label.split(separator, 1)
            bucket_name = prefix_to_bucket.get(bucket_key.strip().lower())
            value = value.strip()
            if bucket_name and value:
                if bucket_name == "Dependencies" and value.isdigit():
                    value = f"#{value}"
                buckets[bucket_name].append(value)
            else:
                buckets["Other"].append(label)
            continue

        buckets["Other"].append(label)

    return {name: sorted(values) for name, values in buckets.items() if values}


def derive_pr_labels(issue_meta: dict[str, object] | None) -> list[str]:
    if not issue_meta:
        return []
    labels = [str(label) for label in issue_meta.get("labels") or []]
    return sorted(label for label in labels if label.lower() not in TRIAGE_LABELS)


def looks_like_bot(login: str) -> bool:
    normalized = login.lower()
    return normalized.endswith("[bot]") or normalized.startswith("app/") or normalized.endswith("-bot")


def discover_other_collaborator(repo_name: str | None, current_login: str | None, excluded: set[str]) -> str | None:
    if not repo_name:
        return None
    collaborators_json = try_run_gh(["api", f"repos/{repo_name}/collaborators?per_page=100"])
    if not collaborators_json:
        return None

    try:
        collaborators = json.loads(collaborators_json)
    except json.JSONDecodeError:
        return None

    for collaborator in collaborators:
        login = str(collaborator.get("login") or "")
        if not login or looks_like_bot(login):
            continue
        if current_login and login == current_login:
            continue
        if login in excluded:
            continue
        return login
    return None


def resolve_reviewers(
    repo_name: str | None,
    current_login: str | None,
) -> tuple[list[str], list[str]]:
    warnings: list[str] = []
    reviewers: list[str] = []

    excluded = set(reviewers)
    other_collaborator = discover_other_collaborator(repo_name, current_login, excluded)
    if other_collaborator:
        reviewers.append(other_collaborator)
    else:
        warnings.append("No secondary human collaborator could be resolved for reviewer assignment.")

    return reviewers, warnings


def build_body(
    title: str,
    issue_ref: str | None,
    issue_meta: dict[str, object] | None,
    notes: str | None,
    validation: str | None,
) -> str:
    branch = run_git(["branch", "--show-current"]) or "(detached HEAD)"
    commit_sha = run_git(["rev-parse", "--short", "HEAD"])

    changed_files_raw = try_run_git(["show", "--pretty=", "--name-only", "HEAD"]) or ""
    changed_files = [line.strip() for line in changed_files_raw.splitlines() if line.strip()]

    diff_check = try_run_git(["diff", "--check", "HEAD^..HEAD"])
    validation_lines = []
    if diff_check is not None:
        validation_lines.append("- `git diff --check HEAD^..HEAD`")
    if validation:
        validation_lines.append(f"- {validation}")
    if not validation_lines:
        validation_lines.append("- Not run")

    notes_lines = [notes] if notes else ["One commit per subissue. Open PR intentionally created without draft mode."]

    issue_details_lines = []
    if issue_ref:
        issue_details_lines.append(f"- Related issue: `{issue_ref}`")
    if issue_meta:
        issue_title = str(issue_meta.get("title") or "")
        issue_url = str(issue_meta.get("url") or "")
        issue_number = str(issue_meta.get("number") or issue_ref or "")
        issue_labels = [str(label) for label in issue_meta.get("labels") or []]
        if issue_title:
            issue_details_lines.append(f"- Issue title: {issue_title}")
        if issue_url:
            issue_details_lines.append(f"- Issue URL: {issue_url}")
        elif issue_number:
            issue_details_lines.append(f"- Issue reference: `{issue_number}`")
        if issue_labels:
            issue_details_lines.append("- Issue labels:")
            for group_name, values in classify_issue_labels(issue_labels).items():
                issue_details_lines.append(f"  - {group_name}: {', '.join(values)}")

    development_section = ""
    if issue_ref:
        development_section = f"\n## Development\nCloses {issue_ref}\n"

    files_section = format_files(changed_files)

    return (
        "## Summary\n"
        f"{title}\n\n"
        "## Why\n"
        f"This branch publishes the completed subissue from `{branch}` as an open pull request.\n\n"
        "## Impact\n"
        f"- Commit: `{commit_sha}`\n"
        f"- Branch: `{branch}`\n\n"
        "## Files Changed\n"
        f"{files_section}\n\n"
        "## Validation\n" + "\n".join(validation_lines) + "\n\n"
        "## Notes\n"
        + "\n".join(f"- {line}" for line in notes_lines)
        + development_section
        + ("\n## Issue Traceability\n" + "\n".join(issue_details_lines) if issue_details_lines else "")
        + "\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", help="PR title to echo in the summary.")
    parser.add_argument("--issue", help="Explicit issue reference such as #72. Overrides auto-detection.")
    parser.add_argument("--validation", help="Additional validation text to include in the body.")
    parser.add_argument("--notes", help="Optional notes or follow-up text.")
    parser.add_argument(
        "--allow-draft-fallback",
        action="store_true",
        help="Mark the bundle so the publisher may retry as a draft PR when GitHub rejects the open PR path.",
    )
    parser.add_argument("--output", help="Write the rendered body to this path instead of stdout.")
    parser.add_argument("--title-output", help="Write the rendered title to this path instead of stdout.")
    parser.add_argument("--metadata-output", help="Write PR metadata JSON to this path.")
    parser.add_argument("--default-milestone", default=DEFAULT_MILESTONE)
    args = parser.parse_args()

    branch = run_git(["branch", "--show-current"]) or ""
    commit_subject = run_git(["log", "-1", "--pretty=%s"])
    commit_body = try_run_git(["log", "-1", "--pretty=%B"]) or ""

    issue_ref = (
        args.issue
        or detect_issue_ref(branch, commit_subject, commit_body)
        or infer_issue_ref_from_open_issues(branch, commit_subject, commit_body)
    )
    issue_meta = lookup_issue_metadata(issue_ref)
    rendered_title = build_title(args.title, issue_ref, commit_subject)
    body = build_body(rendered_title, issue_ref, issue_meta, args.notes, args.validation)

    repo_name = load_repo_name()
    current_login = load_current_login()
    reviewers, warnings = resolve_reviewers(repo_name, current_login)

    milestone = (
        str(issue_meta.get("milestone")) if issue_meta and issue_meta.get("milestone") else args.default_milestone
    )
    labels = derive_pr_labels(issue_meta)
    metadata = {
        "title": rendered_title,
        "issue": issue_ref,
        "milestone": milestone,
        "assignee": current_login or "@me",
        "reviewers": reviewers,
        "labels": labels,
        "warnings": warnings,
        "allowDraftFallback": bool(args.allow_draft_fallback),
    }

    if args.title_output:
        Path(args.title_output).write_text(rendered_title, encoding="utf-8")
    if args.output:
        Path(args.output).write_text(body, encoding="utf-8")
    else:
        sys.stdout.write(body)
    if args.metadata_output:
        Path(args.metadata_output).write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
