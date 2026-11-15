# Token Optimization for Claude Code

A small, standalone setup that keeps Claude Code from loading big files into your
main conversation. Big files use up context (tokens) fast. With this setup, Claude
hands that reading to a cheaper helper ("subagent") that replies with just the answer.

No accounts, servers, outside services or Python needed.

## Pick your path

First, check whether your computer has **Node.js**. Open a terminal (Mac: the **Terminal**
app; Windows: **PowerShell**), type this and press Enter:

```
node --version
```

- **If you see a version number like `v20.11.0`**, use **Path A**. It strictly enforces the rule.
- **If you see "command not found" or "not recognized"**, use **Path B**. It needs no
  programs at all, but works by instruction, so Claude follows it most of the time
  rather than every time.

## What's inside

| File | What it does | Used in |
|---|---|---|
| `.claude/agents/bulk-reader.md` | The **subagent**. Runs on the Haiku model, can only read and search, and replies briefly with file paths and line numbers. | A and B |
| `.claude/hooks/block_large_reads.js` | The **hook**. Before every file read, it checks the size. If the main session tries to read more than 400 lines of a big file at once, it blocks the read and points Claude to `bulk-reader`. Images, PDFs and notebooks are never blocked. | A |
| `.claude/settings.json` | Tells Claude Code to run the hook before every Read. | A |
| `no-code-option/CLAUDE.md` | Plain-English rules telling Claude to use `bulk-reader` for big files. | B |
| `tests/block_large_reads.test.js` | Automatic checks that the hook behaves correctly. | A (optional) |

## Download

1. On GitHub, open this repo and choose this branch in the branch dropdown (top left).
2. Click the green **Code** button, then **Download ZIP**, and unzip it.
3. The `.claude` folder is hidden. On Mac, press `Cmd+Shift+.` in Finder to show it.
   On Windows, in File Explorer choose **View**, then **Show**, then **Hidden items**.

## Path A: hook + subagent (needs Node.js)

1. Copy the whole `.claude` folder into the top level of your own project folder.
   - **If your project already has a `.claude` folder:** copy `agents/bulk-reader.md` and
     `hooks/block_large_reads.js` into the matching folders. Then open your existing
     `.claude/settings.json` and add the `"hooks": { ... }` section from this repo's
     `settings.json`. Don't replace your whole file.
2. Restart Claude Code in that project.
3. Type `/agents`. You should see `bulk-reader`.
4. Type `/hooks`. You should see a `PreToolUse` hook for `Read`.

## Path B: subagent + instructions (no programs needed)

1. In your project folder, make a folder called `.claude`, and inside it a folder called `agents`.
2. Copy `.claude/agents/bulk-reader.md` into `your-project/.claude/agents/`.
   (Do **not** copy `settings.json` or the `hooks` folder. They need Node.js.)
3. Copy the text from `no-code-option/CLAUDE.md`:
   - If your project has no `CLAUDE.md` file at its top level, copy this file there.
   - If it already has one, paste the text at the end of your existing file.
4. Restart Claude Code in that project and type `/agents`. You should see `bulk-reader`.

## Check that it works

Ask Claude Code to "read the whole file X" for a file over 400 lines.
- **Path A:** the read gets blocked, and Claude switches to `bulk-reader`.
- **Path B:** Claude should use `bulk-reader` or read only a section, without being blocked.

For Path A, you can also run the automatic tests from this repo's folder with `node --test`.
Every test should pass.

## Settings you can change (Path A)

Set these in the `"env"` section of `settings.json`, for example `"env": { "BULK_READ_MAX_LINES": "600" }`:

| Variable | Default | Meaning |
|---|---|---|
| `BULK_READ_MAX_LINES` | 400 | Files this size or smaller are always allowed. |
| `BULK_READ_CHUNK_LIMIT` | 400 | Largest number of lines one read may return from a bigger file. |
| `BULK_READ_AGENT` | bulk-reader | Name of the subagent that may read freely. |

## Good to know

- If the hook itself fails (bad input, unreadable file), it **allows** the read, so it can never lock Claude up.
- Newer Claude Code versions tell the hook which subagent is reading. Older ones don't.
  Either way, `bulk-reader` gets through, because it reads in chunks of 400 lines or fewer.
- The main session can still read a big file in many small chunks. If that happens a lot,
  lower `BULK_READ_CHUNK_LIMIT`.
