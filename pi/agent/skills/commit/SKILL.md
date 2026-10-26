---
name: commit
description: Commit staged or pending work in the "area: sentence" style — a subject that states the new behaviour as a fact, and a body in plain prose that says what was wrong, why, and what the code does now. Use when the user asks to commit, to write a commit message, or says "commit in our style".
---

# Commit

Write commits that read like a changelog of behaviour. A reader of `git log`
learns what the system does now and why it changed, without opening the
diff.

## The format

```
<area>: <what is true now, as a plain sentence>

<What was wrong or missing, and why — the mechanism, not the symptom
alone.> <What the code does now.> <Anything else the commit carries,
one clause each: tests, docs, renames.>
```

Example:

```
knowledge: a decline is remembered for the website, and a crawl of an earlier URL writes no topics

Declining held topics settled each topic/knowledge pair, which outlived a
URL change and let the new site's same topic through unasked; the decline
now deletes the findings and is remembered by the website and the
wording alone, which the URL change clears. rag.source_versions records
the URL a crawl was asked for, and a fill or Refill of a crawl of a URL the
owner changed since writes nothing (Refill answers 409).
```

### Subject
- `<area>` is the service or directory the change lives in, as the repo
  names it: `knowledge`, `assistant`, `web`, `supabase`, `infra/gcp/cloudrun`,
  `internal/crawl`, `ci`. Two areas in one commit: `assistant: …; web: …`.
- The sentence states the **result** as a fact about the system, present
  tense, lower-case start, no period: "a fill whose URL changes during it
  writes nothing", "the review card names held topics as such".
- Not an imperative ("fix", "add", "update"), not a ticket number, not
  "WIP". Name the behaviour, not the edit.
- Long is fine when it carries meaning (up to ~100 chars); join two results
  with ", and".

### Body
- Wrap at ~72 columns. Plain prose, no bullet lists, no headings, no
  markdown emphasis.
- First: **what was wrong and why** — trace the mechanism ("X read Y by
  leaf, but the service keys it by top-level category, so every leaf showed
  nothing"). Then **what it does now**.
- Then one clause per extra thing the commit carries: the tests that cover
  it ("Tests cover …"), docs moved with it, comments corrected.
- Use the code's own names in backticks-free form (identifiers, tables,
  routes, flags): `rag.topic_reviews`, `POST /crawl`, `stillHeld`.
- Omit the body only for a one-line change whose subject says everything
  (a doc wording, a `go fix`).
- Never: AI co-author lines, "Generated with …", emoji, references to the
  chat or session ("as requested", "per review"), test-plan sections.

## Procedure

1. Check the project's own rules first: `git log -15 --format='%s%n%b'`,
   `.commitlintrc*`, `commitlint.config.*`, husky hooks, CONTRIBUTING. If the
   project mandates another format (conventional commits, sign-off,
   ticket prefixes), follow it and keep only this skill's body style.
2. See exactly what goes in: `git status --short` and `git diff --cached`
   (or `git diff` if nothing is staged). Stage only files that belong to
   this change, by path — never `git add -A` blindly, never local test
   overrides, scratch files or `.env`.
3. One concern per commit. If the diff mixes unrelated changes, split it
   and commit each with its own message.
4. Write the message from the diff and what you know of the why. If the why
   is not known, ask rather than invent it.
5. Commit with a heredoc so the body keeps its line breaks:
   ```bash
   git commit -q -F - <<'EOF'
   area: subject

   Body…
   EOF
   ```
   If commit signing is configured but unavailable, ask before using
   `-c commit.gpgsign=false`.
6. Show `git log -1 --format='%h %s'` and stop. Do not push unless asked.

## Self-check before committing
- Does the subject say what the system does now, not what you did?
- Would someone who never saw the bug understand from the body why it
  happened?
- Is every file in the commit part of this one change?
- No co-author, no emoji, no session references?
