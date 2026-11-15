#!/usr/bin/env python3
"""PreToolUse hook: stop the main Claude session from reading big files whole.

Claude Code runs this script before every Read call and sends details about the
call as JSON on standard input. If the read would pull in too many lines, the
script answers "deny" and tells Claude to use the bulk-reader subagent or to
read only the section it needs. Anything unexpected results in "allow", so a bug
here never stops Claude from working.

Settings (environment variables):
  BULK_READ_MAX_LINES    Files with at most this many lines are always allowed. Default 400.
  BULK_READ_CHUNK_LIMIT  Largest number of lines one read may return from a bigger file. Default 400.
  BULK_READ_AGENT        Name of the subagent that may read freely. Default "bulk-reader".
"""

import json
import os
import sys

# Claude's Read tool returns at most this many lines when no limit is given.
READ_TOOL_DEFAULT_LIMIT = 2000

# File types the Read tool handles specially; never block these.
SKIP_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tiff",
    ".pdf", ".ipynb",
}


def env_int(name, default):
    try:
        value = int(os.environ.get(name, default))
        return value if value > 0 else default
    except ValueError:
        return default


def count_lines(path):
    """Count lines without loading the whole file into memory. None if unreadable."""
    try:
        count = 0
        last = b"\n"
        with open(path, "rb") as f:
            while True:
                block = f.read(1 << 20)
                if not block:
                    break
                if b"\0" in block:
                    return None  # binary file; let the Read tool deal with it
                count += block.count(b"\n")
                last = block[-1:]
        if last != b"\n":
            count += 1  # last line has no trailing newline
        return count
    except OSError:
        return None


def is_bulk_reader(data, agent_name):
    """True if the read comes from the bulk-reader subagent.

    Newer Claude Code versions send agent_type (and agent_id) when a subagent
    makes the call. Older versions send neither; then this returns False and
    the subagent still gets through because it reads in small chunks.
    """
    for key in ("agent_type", "agent_name", "subagent_type"):
        if str(data.get(key) or "").strip().lower() == agent_name.lower():
            return True
    return False


def decide(data):
    """Return None to allow the read, or a message explaining why it is blocked."""
    if data.get("tool_name") != "Read":
        return None

    max_lines = env_int("BULK_READ_MAX_LINES", 400)
    chunk_limit = env_int("BULK_READ_CHUNK_LIMIT", 400)
    agent_name = os.environ.get("BULK_READ_AGENT", "bulk-reader")

    if is_bulk_reader(data, agent_name):
        return None

    tool_input = data.get("tool_input") or {}
    path = tool_input.get("file_path")
    if not path or not isinstance(path, str):
        return None
    if not os.path.isabs(path):
        path = os.path.join(data.get("cwd") or os.getcwd(), path)
    if os.path.splitext(path)[1].lower() in SKIP_EXTENSIONS:
        return None
    if not os.path.isfile(path):
        return None

    total = count_lines(path)
    if total is None or total <= max_lines:
        return None

    try:
        offset = max(int(tool_input.get("offset") or 1), 1)
        limit = int(tool_input.get("limit") or READ_TOOL_DEFAULT_LIMIT)
    except (TypeError, ValueError):
        return None

    lines_returned = max(0, min(limit, total - offset + 1))
    if lines_returned <= chunk_limit:
        return None

    return (
        f"Blocked: this read would load {lines_returned} lines of {path} "
        f"({total} lines in total) into the main conversation. Instead, either:\n"
        f"  1. Ask the '{agent_name}' subagent (Task tool) your question about this file. "
        f"It reads the file separately and replies with a short answer and line numbers, or\n"
        f"  2. Use Grep to find the right spot, then Read with offset and limit "
        f"(at most {chunk_limit} lines) to read only that section."
    )


def main():
    try:
        data = json.load(sys.stdin)
        reason = decide(data) if isinstance(data, dict) else None
    except Exception:
        return 0  # never break Claude because of a hook problem

    if reason:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
