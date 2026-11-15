// Tests for .claude/hooks/block_large_reads.js
// Run from the project folder with:  node --test tests/
// Each test runs the hook exactly as Claude Code would: JSON in, JSON (or nothing) out.

"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOOK = path.join(__dirname, "..", ".claude", "hooks", "block_large_reads.js");
let dir, big, small, png;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooktest-"));
  big = path.join(dir, "big.py");
  small = path.join(dir, "small.py");
  png = path.join(dir, "pic.png");
  fs.writeFileSync(big, Array.from({ length: 1000 }, (_, i) => `line ${i + 1}\n`).join(""));
  fs.writeFileSync(small, Array.from({ length: 50 }, (_, i) => `line ${i + 1}\n`).join(""));
  fs.writeFileSync(png, Buffer.concat([Buffer.from("\x89PNG\r\n"), Buffer.alloc(5000, 10)]));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function runHook(payload, env = {}, raw) {
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("BULK_READ_")));
  const input = raw !== undefined ? raw : JSON.stringify(payload);
  return spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { ...cleanEnv, ...env } });
}

function blocked(proc) {
  assert.strictEqual(proc.status, 0, proc.stderr);
  if (!proc.stdout.trim()) return false;
  return JSON.parse(proc.stdout).hookSpecificOutput.permissionDecision === "deny";
}

function read(file, toolExtra = {}, top = {}) {
  return { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: file, ...toolExtra }, ...top };
}

test("whole big file is blocked", () => {
  const proc = runHook(read(big));
  assert.ok(blocked(proc));
  assert.match(proc.stdout, /bulk-reader/);
});
test("small file allowed", () => assert.ok(!blocked(runHook(read(small)))));
test("ranged read allowed", () => assert.ok(!blocked(runHook(read(big, { offset: 200, limit: 300 })))));
test("oversized range blocked", () => assert.ok(blocked(runHook(read(big, { offset: 1, limit: 900 })))));
test("offset near end allowed", () => assert.ok(!blocked(runHook(read(big, { offset: 700 })))));
test("bulk-reader subagent allowed", () =>
  assert.ok(!blocked(runHook(read(big, {}, { agent_id: "a1", agent_type: "bulk-reader" })))));
test("other subagents still blocked", () =>
  assert.ok(blocked(runHook(read(big, {}, { agent_id: "a2", agent_type: "general-purpose" })))));
test("images allowed", () => assert.ok(!blocked(runHook(read(png)))));
test("BULK_READ_MAX_LINES raises the limit", () =>
  assert.ok(!blocked(runHook(read(big), { BULK_READ_MAX_LINES: "2000" }))));
test("BULK_READ_CHUNK_LIMIT lowers the chunk size", () =>
  assert.ok(blocked(runHook(read(big, { limit: 300 }), { BULK_READ_CHUNK_LIMIT: "100" }))));
test("other tools ignored", () => assert.ok(!blocked(runHook({ tool_name: "Bash", tool_input: { command: "ls" } }))));
test("missing file allowed", () => assert.ok(!blocked(runHook(read("/no/such/file.txt")))));
test("bad input does not crash", () => assert.ok(!blocked(runHook(null, {}, "not json at all"))));
