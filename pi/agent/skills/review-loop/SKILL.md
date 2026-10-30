---
name: review-loop
description: Continuously review a branch (or master) and fix every proven issue, looping until a review pass finds nothing left. Wraps the branch-review skill in a review → fix → re-review cycle.
---

# Review Loop

Iterative quality loop: run `branch-review` on the current changes, **fix every
confirmed issue**, then review again. Repeat until a pass returns zero confirmed
issues — or the safety cap is hit.

Fixing one issue can introduce or reveal another, so a single pass is
never enough.

## When to use

- After finishing a feature or refactor, before merge
- Hardening a branch that keeps accumulating small bugs
- Polishing `master`/`main` itself (latest commit or working tree)

**Do not use** for: open-ended feature work, greenfield implementation, or
debugging a known runtime failure. This skill consumes a
diff and drives it toward zero review findings.

## Hard rule — review passes run in a subagent

Every review pass MUST run inside a `reviewer` subagent spawned with
`context: "fresh"`. The main session NEVER performs the review itself: it
does not read the diff or trace code to hunt for issues. Its job is to
orchestrate — detect the change surface, spawn the reviewer, receive the
report, apply fixes to confirmed issues, run validation, and loop.

- Fresh `reviewer`s for every pass (one, or one per area on a large diff —
  Step 2). Never resume or reuse a previous pass's reviewer: each pass must
  judge the current diff without inherited bias.
- The reviewer never edits the reviewed tree (throwaway mutants in
  `branch-review-deep`'s mutation worktree are allowed, when that variant is
  used). Fixes are applied in the main session (or a
  single `worker`), then a NEW fresh reviewer grades the updated diff.
- The main session may read code only to apply a fix to an issue the
  reviewer CONFIRMED — never to generate or verify hypotheses.

## Prerequisites

This skill **requires** the `branch-review` skill. The reviewer subagent runs
it — the main session does not. By default the loop uses `branch-review`;
for branches that also need mutation-proven test coverage, tell the reviewer
to load the `branch-review-deep` variant instead (same workflow plus a
mutation check, roughly double the time per pass):

```
read(/home/raph/.pi/agent/skills/branch-review/SKILL.md)
```

and follow its workflow exactly during the pass.

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

Also maintain `.pi/scratch/review-loop/notes.md`, **rewritten** (never
appended) after every pass: confirmed issues (fixed / open), refuted
hypotheses (with the proof that killed them), approaches tried, what remains.
Cap it around 800 words — whatever you omit is gone, and that is the point:
each pass starts from curated memory, not from an ever-growing pile of reports.
File refuted hypotheses by area. The notes never tell a reviewer where to
look: no "focus on", no list of the code the last fixes touched as a hint.
A reviewer steered toward the latest fix re-reviews the fix and misses the
rest of the branch.

### Step 2 — Review pass (in fresh subagents)

**Size the pass first.** Count the change surface
(`git diff --shortstat $BASE..HEAD`).

- **Up to ~3000 changed lines:** one `reviewer` covers the whole diff.
- **Over ~3000 changed lines:** one reviewer cannot cover it — it reports
  the first few things it finds and the rest of the branch goes unread.
  Split the diff into areas (one per service/command, shared package,
  schema/migrations, web app, mobile app, infra; merge tiny ones, split any
  area still over ~3000 lines) and spawn, in the same pass:
  - one reviewer **per area**, scoped to that area's changes (effects
    traced anywhere, as always);
  - **cross-cutting** reviewers over the whole diff, limited to the
    branch-review categories that cross areas, split in five from the
    start (one reviewer cannot cover them all on a large diff and marks
    them ⚠️):
    1. schema rules reach every existing writer, every writer of a shared
       row, parity with replaced code;
    2. new deployable vs its closest sibling (with its pools and clients),
       production configuration;
    3. realistic external input, every implementation of a guard,
       product promises and factual claims;
    4. threat model: the trust-boundary artifact (untrusted input →
       privileged sink, credentials per workload, sandbox escapes, files a
       sandboxed process writes that its supervisor trusts);
    5. spec and setup-doc conformance: every spec requirement and every
       value a README/prompt names, checked against the code.
  Lenses 4 and 5 also run as their own reviewers on diffs **under** ~3000
  lines when the branch adds a service, sandbox, credential, LLM session
  or spec: a per-area reviewer sees only one half of a path whose input
  and sink sit in different areas, and grades its half clean.
  Reviewers are read-only, so they run in parallel (`workflow:
  "parallel"`); the fixes wait for all of them. Merge their reports,
  dedupe findings, and treat the pass grade as the **lowest** reviewer
  grade. A finding reported by several reviewers keeps the **highest**
  severity any of them gave it, with the union of their evidence.
- **Before grading a split pass:**
  - a reviewer that returned no report (timeout, crash) is re-spawned for
    its area; it is never graded as clean. Give split-pass reviewers an
    explicit timeout of at least 60 min and tell them to write the report
    before the last 10;
  - collect every "Declined to judge" / "outside this area" item; any
    that no report confirmed or refuted goes to one more fresh reviewer;
  - a cross-cutting category marked ⚠️ is re-run by another reviewer on
    that category alone.
- **Live tests in parallel:** reviewers that run live tests on one shared
  database collide (shared rows, duplicate keys). Give each its own
  database, or run the scoped suite once yourself and pass the result:
  reviewers then run only their own repro and mutant tests.

Spawn each `reviewer` subagent with `context: "fresh"` (synchronous — the
fixes depend on its result). Its prompt contains only:

- the repo path (and worktree path, if working in one),
- the change surface from Step 0 (base commit / exact diff command),
- any user scope constraints (e.g. "only this PR's diff"). These narrow
  which **changes** are reviewed, never their **effects**: never write
  "review only this diff" or anything that keeps the reviewer from tracing
  into untouched code (triggers, readers, dashboards, pools, other services),
- its area (or "cross-cutting" with its categories), when the diff is split,
- the scoped suite result (log path, failing and skipped tests) when you
  ran it once for a split pass, and the path its report must be written to,
- the current `notes.md` (refuted hypotheses, so it does not re-report them).
  Refuted hypotheses only — never pass "tests X/Y are fine" or a prior
  grade: a test verdict is re-earned every pass (by the per-test mutants,
  when running the `branch-review-deep` variant),
- the instruction to load and run `branch-review` verbatim, never edit the
  reviewed tree, and return the Phase 3 report (confirmed issues with proof,
  false positives, grade).

No conversation context beyond that. The subagent runs the **full
`branch-review` workflow** (with `branch-review-deep`, its mutation check
too), and only CONFIRMED issues with proof count. Never weaken its tracing
rules: a fix aimed at a false positive is wasted work and often a new bug.

### Step 3 — Fix every confirmed issue

For each **CONFIRMED** issue from the pass:

1. Re-read the live code around the issue (not just the diff).
2. Write the minimal fix that resolves the proven scenario.
3. Add or update a test that would have caught it, when feasible. The test
   must pass `branch-review`'s test gate and junk-test checks, and must fail
   on the pre-fix code for the intended reason: revert the fix, run the test,
   read the failure, restore the fix. A test that passes without the fix
   doesn't count. One test at the owner boundary, not one per layer. Live
   tests seed their own data. Never assert tuning constants.
4. Verify the fix locally — `make build`, `make verify`, then tests scoped to
   the changed packages (branch-review Step 2), never the whole suite.
5. A reported junk test is a symptom of its file. Record every test file a
   fix touched in `notes.md`: the next pass's reviewer audits EVERY test in
   those files (overlap matrix; per-test mutants with `branch-review-deep`),
   not only the changed hunks, so siblings with the same defect are not
   waved through.

**Fix order matters:** resolve issues that other fixes depend on first (e.g.,
fix a nil-returning helper before fixing the caller that dereferences it).
Otherwise order by severity.

Do not fix false positives or N/A items. Note them and move on.

**Design findings go to the user, not straight into code.** A design finding
(Phase 2c) usually changes the branch's scope (move data, reuse another
subsystem, split the PR). Present it with the confirmed issues it explains
and the alternatives (`ask_user_question`), then apply the chosen direction.
Record the decision in `notes.md`.

**Never relay the reviewer's ungraded notes as "accepted tradeoffs".** A
note, "declined to judge" item or side effect with a concrete cost (failure,
load, data exposure, metric skew) is an open question: send it back to the
next reviewer as a lead, or put it to the user. Never write "accepted",
"tradeoff" or "follow-up" into code, README or PR text on the reviewer's
word alone — only after the user accepted it.

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

In every pass after the first, tell the reviewer which test files the fixes
touched; the whole file is in scope for its test audit, not only the
changed hunks.

### Step 5 — Termination

Stop the loop when **any** of these is true:

- **Clean pass is not done.** Zero confirmed issues is a *candidate* exit, not
  an exit. Before stopping, run the project's validation commands yourself
  (`make verify` and the scoped `go test $PKGS` from branch-review Step 2 —
  whatever applies) and paste the
  decisive output lines into the final report. A red suite **invalidates** the
  clean pass: the loop continues with the failures as confirmed issues,
  regardless of what the review found. Reviewers miss things in both
  directions; the test run is ground truth and overrides any review verdict.
  An unresolved design finding also blocks the clean exit, unless the user
  explicitly accepted it (recorded in `notes.md`).
  On a split diff (Step 2), a clean pass means **every** area reviewer and
  every cross-cutting reviewer came back with zero confirmed issues and no
  area or category marked ⚠️/❌ in their Coverage tables. One reviewer's
  100/100 says that reviewer found nothing new, not that the branch is
  covered. Confirm it with a **second clean pass** in which the areas are
  regrouped differently and the cross-cutting categories are grouped
  differently; only then exit.
- **Safety cap.** The loop hits a maximum number of passes (default **5**). If
  you reach the cap without a clean pass, stop, report what remains, and flag
  that the cap was hit — the branch likely needs human judgement, not more
  iterations.
- **No progress.** Two consecutive passes confirm the same set of issues
  without any being resolved. Before stopping: spawn one fresh-context
  `planner` subagent with the stuck diff, the fixes already attempted, and the
  instruction "the current approach keeps failing — propose a genuinely
  different approach" (feed it `notes.md`). Run ONE more pass with it if it
  differs materially. If that pass still confirms the same issues — stop.
  You're stuck, not iterating; surface the blocker.

When the loop terminates, summarize every pass: issues found, issues fixed,
grade. A clean run looks like `3 → 1 → 0`. A capped run looks like
`4 → 2 → 2 → 1 → 1 (cap)`.

## Constraints

- **Review only in a fresh `reviewer` subagent.** A pass performed in the
  main session does not count and must be redone in a subagent.
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
- **Fixed reviewer count is not a budget.** On a large diff the per-area
  reviewers are the minimum, not an upgrade: skipping them to save tokens
  turns the loop into a review of the last fix.
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
