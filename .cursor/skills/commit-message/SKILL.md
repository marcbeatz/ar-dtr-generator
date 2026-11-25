---
name: commit-message
description: >-
  Draft git commit messages from the working tree by reading status, diff, and
  recent log. Use when the user asks for a commit message, to write a commit,
  to summarize changes for a commit, or says "commit message".
---

# Commit message

Draft the message from the diff. Create the commit only when the user explicitly asks to commit.

## Inspect

Run these in parallel from the repo root:

- `git status`
- `git diff` and `git diff --cached`
- `git log -8 --format='%s%n%b'`

Write from the diff, not from the branch name or the file list alone. Leave out `.env`, credentials, and other secrets. If those files are changed, say so and do not stage them.

## Format

Match this repository:

- Imperative mood. No conventional-commit prefix (`feat:`, `fix:`).
- Subject: one sentence on what the change does.
- Body: one sentence on why, only when the subject is not enough.
- Say why the change exists. Do not list files.

## Output

If the user asked only for the message, reply with the message in a fenced block. Do not commit.

If the user asked to commit, use that message with the git commit workflow.

## Example

```
Gate the app behind a site password and pick DTR periods from a date range.

Visitors must unlock with SITE_PASSWORD before using the generator, and period entry is a calendar range instead of separate month, cutoff, and year fields.
```
