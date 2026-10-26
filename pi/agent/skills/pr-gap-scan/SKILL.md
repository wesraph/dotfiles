---
name: pr-gap-scan
description: Fast, high-level scan of a large PR or branch for missing functions and likely high-level bugs (rollout order, migrations, infra, missing lifecycle ops, cost/abuse limits, auth, scale). Reads design docs and the change surface, not every line. Use when asked "what could be missing / what are the high-level bugs in this PR". For line-level proof use branch-review.
---

# PR Gap Scan

Answers two questions about a big change: **what high-level capability is
missing**, and **what high-level bugs are likely**. It is a triage pass: output
is ranked leads with evidence, not verified verdicts. Report-only: never edit
the reviewed tree. For proven findings follow up with `branch-review`.

## When to use

- A PR/branch too large to read line by line (dozens to hundreds of files).
- The user asks "what's missing", "what could break", "high-level bugs".

**Do not use** for: small diffs (use `branch-review`), implementing fixes, or
debugging a runtime failure.

## Workflow

### 1. Frame the change

```bash
git branch --show-current
git log --oneline <base>..HEAD | head -40
git diff --stat=140 <base>...HEAD | tail -80        # shape of the change
gh pr view --json number,title,body                 # intent + claimed proof
```

Use `origin/<base>` after `git fetch`. Note what the PR says it does, what it
claims it tested, and what it says it did **not** test.

### 2. Read the intent, not the code

Read the design/spec docs the PR ships or links (`specs/**`, README of the
touched area, implementation plan). Extract:

- the decisions and invariants it claims,
- every "deferred", "follow-up", "open question", "not built", "later" line:
  these are pre-confirmed gaps,
- the rollout/deploy-order section, if any.

```bash
grep -n -i -E "not built|todo|follow-up|out of scope|deferred|open question|not yet|later" <docs>
```

### 3. Walk the lifecycle and risk checklist

For each new capability, ask which of these is absent or unproven. Check each
with a targeted grep or a read of the one decisive file, not a full read.

**Missing functions (lifecycle gaps)**
- Create exists: do **remove / disconnect / stop / disable** exist (API, UI, assistant tools)?
- Is there an owner-visible way to pause, retry, roll back or undo?
- Periodic/background work: can it be turned off per tenant? Is it idempotent across instances?
- Cleanup: purge/delete paths cover every new table, queue, object store and derived data?
- Every writer of a shared record (config, DB row): do all go through the same validation/check?

**Cost, abuse and scale**
- Per-tenant / per-day limits or cooldown on expensive triggers (LLM, browser, embeddings).
- Unchanged-work reuse (hashes, caching) vs full redo on every refresh.
- Priority separation between background and live (call/chat) traffic on shared model endpoints.
- Memory/CPU limits vs what runs in the process (browsers, workers per instance x max instances).
- Multi-instance safety of in-process workers/schedulers.

**Rollout and ops**
- Migration ordering: new migration timestamps vs the base branch's newest (`ls supabase/migrations | tail`); `git diff --name-only HEAD origin/<base> -- <migrations dir>`. Out-of-order files are rejected by `db push`.
- Squashed/renamed migrations: idempotent if an older version was already applied?
- Deploy order: does code read schema that a migration creates first? Do later migrations break the already-deployed code?
- Service split/rename: URLs, env vars, scheduler jobs, DNS, IAM, secrets, monitoring/alerts moved with the code? Old clients/tabs still calling removed routes?
- Scaling changes (min instances, CPU allocation) that contradict comments about background work.
- Every new env/flag wired in infra (grep the flag name in `infra/`).

**Security**
- Every new route authenticated and authorised on the owned resource (open the router file plus the shared authorize helper; check the fail-closed path).
- SSRF / user-supplied URL handling, trust boundaries, secrets in config.
- Is an inherited pattern (e.g. optional auth middleware) now guarding something more sensitive?

**Tests and proof**
- Which proofs are gated/live-only and which run in plain `go test`/CI?
- Does the PR text's "Not tested" list hide a high-risk path?

### 4. Beware concurrent edits

Before concluding something is missing or wrong, check the working tree and
`git status`: another session may be changing it right now (e.g. a migration
squash already in progress). Say so instead of reporting a stale finding.

### 5. Report

Caveman-short, ranked, grouped as:

1. **Likely bug** (with the file/command that shows it)
2. **Missing high-level functions**
3. **Potential bugs and risks** (mark speculative ones as such)
4. One line: scope of the pass (what was and was not read) and the offer to run `branch-review` on any lead.

Rules:
- Each item: claim + evidence (quote the file, command output, or doc line). No evidence → say "needs verification".
- Never present a lead as a verdict. Separate "verified in code" from "from the design doc".
- Do not claim a finding that came from another session; attribute or omit.
- No edits, no commits.
