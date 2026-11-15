#!/usr/bin/env node
// PreToolUse hook: stop the main Claude session from reading big files whole.
//
// Claude Code runs this script before every Read call and sends details about the
// call as JSON on standard input. If the read would pull in too many lines, the
// script answers "deny" and tells Claude to use the bulk-reader subagent or to
// read only the section it needs. Anything unexpected results in "allow", so a bug
// here never stops Claude from working.
//
// Needs only Node.js (no extra packages). Settings (environment variables):
//   BULK_READ_MAX_LINES    Files with at most this many lines are always allowed. Default 400.
//   BULK_READ_CHUNK_LIMIT  Largest number of lines one read may return from a bigger file. Default 400.
//   BULK_READ_AGENT        Name of the subagent that may read freely. Default "bulk-reader".

"use strict";
const fs = require("fs");
const path = require("path");

// Claude's Read tool returns at most this many lines when no limit is given.
const READ_TOOL_DEFAULT_LIMIT = 2000;

// File types the Read tool handles specially; never block these.
const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tiff",
  ".pdf", ".ipynb",
]);

function envInt(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// Count lines without loading the whole file into memory. null if unreadable or binary.
function countLines(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(1 << 20);
    let count = 0;
    let last = 10; // "\n"
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      for (let i = 0; i < n; i++) {
        const b = buf[i];
        if (b === 0) return null; // binary file; let the Read tool deal with it
        if (b === 10) count++;
      }
      last = buf[n - 1];
    }
    if (last !== 10) count++; // last line has no trailing newline
    return count;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

// True if the read comes from the bulk-reader subagent. Newer Claude Code versions
// send agent_type when a subagent makes the call; older ones send nothing, and then
// the subagent still gets through because it reads in small chunks.
function isBulkReader(data, agentName) {
  return ["agent_type", "agent_name", "subagent_type"].some(
    (key) => String(data[key] || "").trim().toLowerCase() === agentName.toLowerCase()
  );
}

// Returns null to allow the read, or a message explaining why it is blocked.
function decide(data) {
  if (!data || typeof data !== "object" || data.tool_name !== "Read") return null;

  const maxLines = envInt("BULK_READ_MAX_LINES", 400);
  const chunkLimit = envInt("BULK_READ_CHUNK_LIMIT", 400);
  const agentName = process.env.BULK_READ_AGENT || "bulk-reader";

  if (isBulkReader(data, agentName)) return null;

  const input = data.tool_input || {};
  let file = input.file_path;
  if (!file || typeof file !== "string") return null;
  if (!path.isAbsolute(file)) file = path.join(data.cwd || process.cwd(), file);
  if (SKIP_EXTENSIONS.has(path.extname(file).toLowerCase())) return null;

  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  if (!stat.isFile()) return null;

  const total = countLines(file);
  if (total === null || total <= maxLines) return null;

  const offset = Math.max(parseInt(input.offset, 10) || 1, 1);
  const limit = parseInt(input.limit, 10) || READ_TOOL_DEFAULT_LIMIT;
  const linesReturned = Math.max(0, Math.min(limit, total - offset + 1));
  if (linesReturned <= chunkLimit) return null;

  return (
    `Blocked: this read would load ${linesReturned} lines of ${file} ` +
    `(${total} lines in total) into the main conversation. Instead, either:\n` +
    `  1. Ask the '${agentName}' subagent (Task tool) your question about this file. ` +
    `It reads the file separately and replies with a short answer and line numbers, or\n` +
    `  2. Use Grep to find the right spot, then Read with offset and limit ` +
    `(at most ${chunkLimit} lines) to read only that section.`
  );
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let reason = null;
  try { reason = decide(JSON.parse(raw)); } catch { reason = null; }
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }));
  }
  process.exit(0);
});
