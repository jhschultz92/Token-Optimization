"""Tests for .claude/hooks/block_large_reads.py.

Run from the project folder with:  python3 -m unittest discover tests -v
Each test runs the hook exactly as Claude Code would: JSON in, JSON (or nothing) out.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(__file__), "..", ".claude", "hooks", "block_large_reads.py")


def run_hook(payload, env_extra=None, raw=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("BULK_READ_")}
    env.update(env_extra or {})
    stdin = raw if raw is not None else json.dumps(payload)
    proc = subprocess.run([sys.executable, HOOK], input=stdin, capture_output=True, text=True, env=env)
    return proc


def blocked(proc):
    if not proc.stdout.strip():
        return False
    out = json.loads(proc.stdout)
    return out["hookSpecificOutput"]["permissionDecision"] == "deny"


class HookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = cls.tmp.name
        cls.big = os.path.join(d, "big.py")
        with open(cls.big, "w") as f:
            f.write("".join(f"line {i}\n" for i in range(1, 1001)))
        cls.small = os.path.join(d, "small.py")
        with open(cls.small, "w") as f:
            f.write("".join(f"line {i}\n" for i in range(1, 51)))
        cls.png = os.path.join(d, "pic.png")
        with open(cls.png, "wb") as f:
            f.write(b"\x89PNG\r\n" + b"\n" * 5000)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def read(self, path, **extra):
        tool_input = {"file_path": path}
        tool_input.update({k: v for k, v in extra.items() if k in ("offset", "limit")})
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Read", "tool_input": tool_input}
        payload.update({k: v for k, v in extra.items() if k not in ("offset", "limit")})
        return payload

    def test_whole_big_file_is_blocked(self):
        proc = run_hook(self.read(self.big))
        self.assertEqual(proc.returncode, 0)
        self.assertTrue(blocked(proc))
        self.assertIn("bulk-reader", proc.stdout)

    def test_small_file_allowed(self):
        self.assertFalse(blocked(run_hook(self.read(self.small))))

    def test_ranged_read_allowed(self):
        self.assertFalse(blocked(run_hook(self.read(self.big, offset=200, limit=300))))

    def test_oversized_range_blocked(self):
        self.assertTrue(blocked(run_hook(self.read(self.big, offset=1, limit=900))))

    def test_offset_near_end_allowed(self):
        # offset 700 with no limit returns only lines 700-1000 (301 lines)
        self.assertFalse(blocked(run_hook(self.read(self.big, offset=700))))

    def test_subagent_allowed(self):
        self.assertFalse(blocked(run_hook(self.read(self.big, agent_id="a1", agent_type="bulk-reader"))))

    def test_other_subagent_still_blocked(self):
        self.assertTrue(blocked(run_hook(self.read(self.big, agent_id="a2", agent_type="general-purpose"))))

    def test_image_allowed(self):
        self.assertFalse(blocked(run_hook(self.read(self.png))))

    def test_env_max_lines(self):
        self.assertFalse(blocked(run_hook(self.read(self.big), {"BULK_READ_MAX_LINES": "2000"})))

    def test_env_chunk_limit(self):
        self.assertTrue(blocked(run_hook(self.read(self.big, limit=300), {"BULK_READ_CHUNK_LIMIT": "100"})))

    def test_other_tools_ignored(self):
        self.assertFalse(blocked(run_hook({"tool_name": "Bash", "tool_input": {"command": "ls"}})))

    def test_missing_file_allowed(self):
        self.assertFalse(blocked(run_hook(self.read("/no/such/file.txt"))))

    def test_bad_input_does_not_crash(self):
        proc = run_hook(None, raw="not json at all")
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(blocked(proc))


if __name__ == "__main__":
    unittest.main()
