## Reading large files

To save context, follow these rules when reading files:

- Before reading a file you haven't seen, check its size (for example with Grep or Glob).
- If a file is longer than about 400 lines, do NOT read it whole in this conversation.
  Instead, either:
  1. Ask the `bulk-reader` subagent your question about the file. It reads it separately
     and replies with a short answer and line numbers, or
  2. Use Grep to find the right spot, then Read with `offset` and `limit` (at most 400 lines).
- Images, PDFs and notebooks are fine to read normally.
