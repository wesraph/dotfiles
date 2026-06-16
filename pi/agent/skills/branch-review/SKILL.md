---
name: branch-review
description: Review a git branch against main/master. Generates a diff, hypothesizes issues, then verifies each claim by tracing the full call chain before reporting. Use before merging PRs or branches.
---

# Branch Review

A two-phase review workflow: **hypothesize** issues from the diff, then **verify**
each by tracing the actual code paths. Never reports a claim it hasn't proven.

## When to use

- Reviewing a branch before merge
- Auditing a PR for correctness
- Checking whether a refactor broke callers

**Do not use** for: implementing features, writing tests, or debugging runtime
behavior. This is a static review skill only.

## Workflow

### Phase 1 — Diff + Hypothesize

Capture the change surface, then list potential issues. Issues are **leads, not
verdicts** — every one must be verified in Phase 2.

**Step 1 — Capture the diff.**

```bash
BRANCH=$(git branch --show-current)
BASE=$(git merge-base $BRANCH main || git merge-base $BRANCH master)
git diff $BASE..HEAD --stat    # scope
git log --oneline $BASE..HEAD  # commit list
git diff $BASE..HEAD           # full diff
```

If the diff is large (>500 lines), scope it: read only the files listed in
`--stat`, prioritizing logic files over tests.

**Step 2 — Run build/lint.**

```bash
make build   # if Makefile exists
make verify  # if Makefile exists
go test ./...  # or project's test command
```

If these fail, note the failures — they're real issues, no verification needed.

**Step 3 — Hypothesize issues.**

Read the diff and list potential issues. For each, note:
- **What** changed (file:line, old → new)
- **Why** it might be wrong (the scenario that breaks)
- **What to trace** (the call chain to verify)

Issue categories to check:
- **Concurrency**: data races, missing locks, lock ordering, TOCTOU
- **Resource leaks**: unclosed connections, goroutines, files, temp state
- **Nil/missing guards**: removed nil checks, ignored bool returns
- **Behavior changes**: removed filters, changed error handling, altered semantics
- **Call site breakage**: signature changes without updating callers
- **Test coverage**: new logic without tests, tests that no longer match behavior

Write the issue list.

### Phase 2 — Verify Each Claim

Create a **task list** (one task per issue). For each task, trace the **full
execution path** from the changed code to its consumer. Mark the task:
- **CONFIRMED** — the issue is real, with proof
- **FALSE POSITIVE** — the issue doesn't materialize, with proof
- **N/A** — not applicable (dead code, unreachable path)

**Verification rules:**

1. **Trace the call chain.** Follow each function from caller to callee. Verify
   the value actually reaches the point of concern. Don't assume.

2. **Check upstream guards.** Before claiming "this will panic if nil", verify no
   earlier check prevents the nil from reaching that point.

3. **Check all call sites.** Before claiming "this function is broken", verify
   every caller and whether each one satisfies the precondition.

4. **Trace the data flow.** If a deposit routes to chain B's queue, trace from
   `drainChains` → `dispatchUpdates` → `queue.add` → `runWorker` →
   `GenerateFill` → `a.Chain(id)`. At each step, check what's guaranteed.

5. **Read the live code, not just the diff.** The diff shows what changed, not
   what exists. A removed nil check might be replaced by an earlier guard.

6. **Check startup ordering.** If `WaitForHubChain()` blocks before `Start()`,
   then hub-dependent code in `Start()` is safe. Don't flag it.

7. **Check whether a method is actually called.** If `Executor.Close()` is never
   invoked, whether it closes mempool senders is irrelevant. Use `grep` or
   `lsp_navigation(references)` to verify.

**Task list format:**

```
todo(action: "create", subject: "Verify: [issue title]", description: "Trace: [call chain]")
```

Process tasks one at a time. Mark `in_progress`, trace the code, mark
`completed` with the verdict.

**Tracing techniques:**

- `lsp_navigation(operation: "references", filePath: "...", line: N)` — find all
  callers of a function
- `lsp_navigation(operation: "definition", filePath: "...", line: N)` — jump to
  where a symbol is defined
- `ast_grep_search(pattern: "$E.Close()", lang: "go")` — find all Close() calls
- `ffgrep(pattern: "executor.Close")` — text search for method invocations
- `read(path: "...", offset: N, limit: N)` — read the live code at key points

### Phase 3 — Report

Summarize the findings:

```
## Review: <branch>

### Confirmed Issues (N)
1. **[Title]** — file:line. Proof: [trace]. Fix: [suggestion].

### False Positives (N)
1. **[Title]** — thought X, but traced Y → safe because Z.

### N/A (N)
1. **[Title]** — dead code / unreachable.

### Grade: X/100
```

Be honest about false positives. Credibility matters more than finding issues.

## Example

```
Claim: "Executor.Close() doesn't close mempool senders"
Trace: grep for executor.Close() → 0 matches. Method exists but is never called.
Verdict: FALSE POSITIVE — the method is dead code; whether it closes senders is
         irrelevant.

Claim: "GenerateFill ignores Chain() bool, nil deref possible"
Trace: GenerateFill called from processNext → runWorker → queue. Queue only
       exists for chains that initialized. Worker only starts after chain added
       to map. Source chain must be connected to emit the deposit. Both chains
       present when GenerateFill runs.
Verdict: FALSE POSITIVE — startup ordering guarantees both chains are in the map.

Claim: "drainChains removed destination chain filter"
Trace: Old code skipped deposits for missing/paused destinations. New code
       routes all deposits. dispatchUpdates checks queuesSnapshot — if no queue,
       drops at Debug. Queue pre-created for all non-paused chains in InitChains.
       Deposits for chains that never connect: dropped silently at Debug.
Verdict: CONFIRMED (minor) — deposits for permanently-failed chains are silently
         dropped. Acceptable during startup, could mask failed chains.
```

## Constraints

- **Never edit code.** This skill is read-only. Use `read`, `bash`, `grep`,
  `lsp_navigation`, `ast_grep_search` — never `edit` or `write` (except for
  task list).
- **Never report speculative bugs.** If you can't prove it by tracing, mark it
  "needs verification" or skip it.
- **One task at a time.** Don't batch verification. Trace one claim fully before
  moving to the next.
- **Keep the issue list short.** 3-8 issues. Quality over quantity. A review
  with 0 confirmed issues is a valid result.
