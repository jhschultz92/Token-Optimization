# Token Optimization for Claude Code

A small, standalone setup that keeps Claude Code from loading big files into your
main conversation. Big files use up context (tokens) fast. With this setup, Claude
hands that reading to a cheaper helper ("subagent") that replies with just the answer.

No accounts, servers or outside services are needed. It's three files plus Python.

## What's inside

| File | What it does |
|---|---|
| `.claude/agents/bulk-reader.md` | The **subagent**. Runs on the Haiku model, can only read and search, and replies briefly with file paths and line numbers. |
| `.claude/hooks/block_large_reads.py` | The **hook**. Before every file read, it checks the size. If the main session tries to read more than 400 lines of a big file at once, it blocks the read and tells Claude to use `bulk-reader` or read a smaller section. Images, PDFs and notebooks are never blocked. |
| `.claude/settings.json` | Tells Claude Code to run the hook before every Read. |
| `tests/test_block_large_reads.py` | Automatic checks that the hook behaves correctly. |

## Setup, step by step

You need **Claude Code** and **Python 3** installed.
To check Python, open a terminal and type `python3 --version`. You should see a version number.

### Option A: Use it in one project

1. Download this repo. On GitHub, click the green **Code** button, then **Download ZIP**, and unzip it.
2. Find the `.claude` folder inside. It's hidden on Mac and Linux: press `Cmd+Shift+.` in Finder to show hidden files.
3. Copy the `.claude` folder into the top level of your own project folder.
   - **If your project already has a `.claude` folder:** copy `agents/bulk-reader.md` and
     `hooks/block_large_reads.py` into it. Then open your existing `.claude/settings.json`
     and add the `"hooks": { ... }` section from this repo's `settings.json`. Don't
     replace your whole file.
4. Restart Claude Code in that project.
5. Type `/agents`. You should see `bulk-reader` in the list.
6. Type `/hooks`. You should see a `PreToolUse` hook for `Read`.

### Option B: Use it in every project

1. Copy `bulk-reader.md` to `~/.claude/agents/`, and `block_large_reads.py` to `~/.claude/hooks/`.
   (`~` means your home folder.)
2. Put the `hooks` section in `~/.claude/settings.json`, and change
   `$CLAUDE_PROJECT_DIR` to `$HOME` in the command line.
3. Restart Claude Code.

## Check that it works

From this repo's folder, run:

```
python3 -m unittest discover tests -v
```

Every line should end in `ok`.

To try it live, ask Claude Code to "read the whole file X" for a file over 400 lines.
You should see the read get blocked, and Claude should switch to the `bulk-reader` subagent.

## Settings you can change

Set these as environment variables (for example in the `"env"` section of `settings.json`):

| Variable | Default | Meaning |
|---|---|---|
| `BULK_READ_MAX_LINES` | 400 | Files this size or smaller are always allowed. |
| `BULK_READ_CHUNK_LIMIT` | 400 | Largest number of lines one read may return from a bigger file. |
| `BULK_READ_AGENT` | bulk-reader | Name of the subagent that may read freely. |

## Good to know

- If the hook itself fails (bad input, unreadable file), it **allows** the read, so it can never lock Claude up.
- Newer Claude Code versions tell the hook which subagent is reading. Older ones don't.
  Either way, `bulk-reader` gets through, because it reads in chunks of 400 lines or fewer.
- The main session can still read a big file in many small chunks. If you see that
  happening a lot, lower `BULK_READ_CHUNK_LIMIT`.
