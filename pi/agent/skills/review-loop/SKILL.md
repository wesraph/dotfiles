---
name: review-loop
description: Continuously review a branch (or master) and fix every proven issue, looping until a review pass finds nothing left. Wraps the branch-review skill in a review → fix → re-review cycle.
---

# Review Loop

Iterative quality loop: run `branch-review` on the current changes, **fix every
confirmed issue**, then review again. Repeat until a pass returns zero confirmed
issues — or the safety cap is hit.

The core insight: fixing one issue can introduce or reveal another. A single
pass is never enough. This skill automates the "review, fix, re-review" cycle a
careful engineer does manually.

## When to use

- After finishing a feature or refactor, before merge
- Hardening a branch that keeps accumulating small bugs
- Polishing `master`/`main` itself (latest commit or working tree)

**Do not use** for: open-ended feature work, greenfield implementation, or
debugging a known runtime failure (use `debug` instead). This skill consumes a
diff and drives it toward zero review findings.

## Prerequisites

This skill **requires** the `branch-review` skill. Load it first:

```
read(/home/raph/.pi/agent/skills/branch-review/SKILL.md)
```

Follow its workflow exactly during each review pass.

## Workflow

### Step 0 — Detect the change surface

Determine what to review. This depends on where you are.

```bash
BRANCH=$(git branch --show-current)
```

- **On a feature branch** (`$BRANCH` is not `main`/`master`): diff the branch
  against its merge-base, exactly as `branch-review` does.

  ```bash
  BASE=$(git merge-base $BRANCH main || git merge-base $BRANCH master)
  git diff $BASE..HEAD
  ```

- **On `main` / `master`** (or a detached HEAD): there is no branch to diff
  against. Review the latest commit and any uncommitted changes instead:

  ```bash
  git diff HEAD~1..HEAD        # last commit
  git diff                     # uncommitted working-tree changes (staged + unstaged)
  ```

  If both are empty, there is nothing to review — stop and say so.

Record which mode you're in. The rest of the loop is identical either way.

### Step 1 — Track the loop

Create a task list to track iterations. One task per loop pass.

```
todo(action: "create", subject: "Review loop pass 1", description: "Run branch-review, fix confirmed issues")
```

This makes the cycle visible and gives a natural place to record the verdict of
each pass.

### Step 2 — Review pass

Run the **full `branch-review` workflow**:

1. Phase 1 — capture diff + hypothesize issues.
2. Phase 2 — verify each claim by tracing the call chain. Only **CONFIRMED**
   issues with proof count.
3. Phase 3 — report: confirmed issues, false positives, grade.

Use `branch-review`'s tracing rules verbatim. Do not weaken them — a fix
targeting a false positive is wasted work (and often introduces a real bug).

### Step 3 — Fix every confirmed issue

For each **CONFIRMED** issue from the pass:

1. Re-read the live code around the issue (not just the diff).
2. Write the minimal fix that resolves the proven scenario.
3. Add or update a test that would have caught it, when feasible.
4. Verify the fix locally — `make build`, `make verify`, `go test ./...`, or the
   project's equivalent.

**Fix order matters:** resolve issues that other fixes depend on first (e.g.,
fix a nil-returning helper before fixing the caller that dereferences it).
Otherwise order by severity.

Do not fix false positives or N/A items. Note them and move on.

### Step 4 — Re-review (the loop)

After all confirmed issues from this pass are fixed, **start a new review
pass** on the updated diff (same change surface as Step 0).

```
todo(action: "create", subject: "Review loop pass 2", description: "Re-review after fixes from pass 1")
```

This is the heart of the skill: fixes are themselves changes, and changes get
reviewed. A fix can:

- **Introduce** a new issue (a regression in adjacent code, a missed call site).
- **Reveal** a previously-hidden issue (a guard you removed exposes a latent
  nil path; a signature change breaks a caller you didn't grep).
- **Resolve** issues transitively (fixing the root cause makes two downstream
  symptoms disappear).

Only a fresh review pass, on the current diff, can detect these.

### Step 5 — Termination

Stop the loop when **any** of these is true:

- **Clean pass.** A review pass finds **zero confirmed issues**. This is the
  goal. Report the final grade and stop.
- **Safety cap.** The loop hits a maximum number of passes (default **5**). If
  you reach the cap without a clean pass, stop, report what remains, and flag
  that the cap was hit — the branch likely needs human judgement, not more
  iterations.
- **No progress.** Two consecutive passes confirm the same set of issues
  without any being resolved. Stop — you're stuck, not iterating. Surface the
  blocker.

When the loop terminates, summarize every pass: issues found, issues fixed,
grade. A clean run looks like `3 → 1 → 0`. A capped run looks like
`4 → 2 → 2 → 1 → 1 (cap)`.

## Constraints

- **Reuse `branch-review` verbatim** for the review phase. Do not invent a
  lighter review. The whole point is proven, traced findings.
- **Fix only confirmed issues.** Never act on false positives or unverified
  hypotheses — that's how regressions enter.
- **One loop at a time.** Finish a pass (review + all fixes) before starting
  the next. Don't interleave.
- **Re-run build/tests after every fix**, not just at the end. A fix that
  breaks the build is not a fix.
- **Respect the safety cap.** A loop that never converges is a signal to stop
  and escalate, not to grind forever.
- **Master mode reviews only recent changes.** When on `main`/`master`, do not
  attempt to review the entire history — scope to `HEAD~1..HEAD` plus the
  working tree.

## Example

```
Pass 1 — branch `feat/forward-call`
  Confirmed (3):
    1. dial-callback ignores error from Resume() → dead air on failure.
    2. forwardCall() missing SIP fallback when PSTN busy.
    3. new Contact.Phone field not normalized → E.164 mismatch.
  Fixed all three. Build green, tests green.

Pass 2 — re-review on updated diff
  Confirmed (1):
    1. Fix #2 from pass 1 introduced a goroutine leak in the SIP retry path.
  Fixed. Build green.

Pass 3 — re-review
  Confirmed (0). Grade: 96/100.

Loop complete. 3 → 1 → 0. Converged in 3 passes.
```

Note how pass 2 found an issue *introduced by* the pass-1 fix — exactly what
the loop exists to catch. A single-pass review would have shipped the leak.
