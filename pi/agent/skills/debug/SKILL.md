---
name: debug
description: Debugs a runtime issue from a user-reported symptom. Searches the codebase, emits multiple root-cause hypotheses, then verifies each with a reproduction test or traced execution path (tracked in a task list). Loops back to hypotheses if none confirm. Once the root cause is proven, writes the fix plus a regression test. Use for bugs, crashes, wrong output, or unexpected behavior.
---

# Debug

A loop-driven debugging workflow: **capture** the symptom, **recon** the relevant
code, **hypothesize** root causes, then **verify** each one by reproducing it
(tracing the execution path or writing a failing test). Only fixes a cause it has
proven. Re-hypothesizes when every lead is dead.

## When to use

- A bug, crash, panic, wrong output, or unexpected runtime behavior
- A failing test with an unclear cause
- "It worked before, now it doesn't" regressions

**Do not use** for: reviewing a diff (use `branch-review`), implementing a
feature (use `pi-counsil` or a `worker`), or pure "how does X work" questions
(use `scout`). This skill is for **finding and fixing a proven defect**.

## Core principles

1. **A symptom is not a cause.** The user reports what they observe; the root
   cause is downstream. Never patch the symptom.
2. **Prove before fixing.** Don't apply a fix until a hypothesis is **CONFIRMED**
   with evidence — a failing repro test or a fully traced execution path that
   reaches the defect.
3. **Reproduce first.** The strongest proof is a failing test that reproduces the
   symptom. If you can write one, the fix is almost done (flip it green).
4. **Loop, don't guess.** If no hypothesis confirms, the bug is elsewhere. Go
   back to recon and hypothesize again — broader, deeper, or a different layer.
   Bounded to **3 rounds** before escalating to the user.
5. **One fix, one regression test.** The fix ships with a test that would fail
   without it. No repro test = no confidence the fix works or stays fixed.

## Workflow

### Phase 1 — Capture the symptom

Write down exactly what the user reported, in their words plus your extraction.
Distinguish **fact** from **assumption**.

Collect (ask the user if missing — use `ask_user_question` once, batched):

- **Symptom**: the observable wrong behavior (error message, panic, wrong value,
  hang, log line). Quote exact strings.
- **Trigger / repro steps**: what action or input causes it. The smallest
  reliable reproduction wins.
- **Expected vs. actual**: what should happen vs. what does.
- **Environment**: version/branch, OS, config, input data, request payload.
- **Artifacts on hand**: stack trace, logs, panic dump, failing test name,
  HTTP response, DB row state. Paste the decisive lines, not the whole dump.
- **When it started**: last known-good commit/dep version, if known.

If the symptom is ambiguous ("it's broken"), **stop and ask** before recon.
Debugging a fuzzy target wastes the whole loop.

Write a one-paragraph **Problem Statement** you'll re-read every phase:

```
Problem: <observable symptom> occurs when <trigger>.
Expected: <correct behavior>. Actual: <observed behavior>.
Repro: <minimal steps or test name>.
Evidence: <stack trace / log line / failing assertion>.
```

### Phase 2 — Recon the codebase

Find the code the symptom points at. Prefer `scout` for broad discovery; use
direct `ffgrep` / `lsp_navigation` / `ast_grep_search` when you have a concrete
string or symbol to chase (error message, function name, stack frame).

**Recon techniques (pick by what you have):**

- **Error string / log line** → `ffgrep(pattern: "<exact substring>")`. Find
  where it's emitted; that's near the defect.
- **Stack frame / function name** → `lsp_navigation(operation: "definition",
  filePath, line)` to jump, `references` to find all callers.
- **Panic line** → read the file:line from the trace; trace the values reaching
  that line.
- **Failing test** → read the test, run it in isolation, read what it exercises.
- **Wrong output field** → `ast_grep_search` for where the field is set, then
  trace backward to its source.
- **Behavioral regression** → `git log -p -- <suspect file>` or
  `git bisect` between last-known-good and bad.

Map the **suspect surface**: the files, functions, and data flow most likely to
contain the defect. Cite exact paths + line ranges. Keep it tight — 3-8 files,
not the whole repo.

Read the live code at the key points. Don't theorize from names.

### Phase 3 — Hypothesize root causes

List **multiple** candidate root causes (aim for 3-6). Each hypothesis is a
**lead, not a verdict** — it must be verified in Phase 4.

For each hypothesis, write:

- **Hypothesis**: one sentence. "X happens because <mechanism>."
- **Why it fits**: which symptom/evidence it explains.
- **How to confirm**: the test you'd write or the trace you'd run to prove it.
- **How to falsify**: what result would rule it out.
- **Likelihood**: high / medium / low (be honest; low-likelihood leads still get
  checked if the obvious ones fail).

Hypothesis categories to scan:

- **Nil / unchecked error**: ignored `err`, discarded `ok` bool, missing nil
  guard, unchecked type assertion
- **Off-by-one / boundary**: `<` vs `<=`, empty slice, zero vs nil map, first/
  last element
- **Wrong variable / shadowing**: `dst` vs `src`, loop var capture, shadowed
  receiver
- **Concurrency**: data race, missing lock, goroutine leak, TOCTOU, send on
  closed channel
- **Resource lifecycle**: unclosed resource, double-close, use after Close,
  connection pool exhaustion
- **Input validation**: unchecked external input, encoding mismatch, locale/
  timezone, integer overflow
- **State / ordering**: init order, stale cache, migration not applied, feature
  flag default
- **Integration boundary**: wrong API version, malformed request, auth scope,
  upstream changed contract
- **Environment / config**: missing env var, default differs per env, path
  resolution
- **Test bug, not code bug**: the test itself is wrong or flaky — verify before
  blaming production code

Write the hypothesis list. Order by likelihood × ease-of-confirmation; check the
cheap high-likelihood ones first.

### Phase 4 — Verify each hypothesis (task list)

Create a **task list**, one task per hypothesis. Process them **one at a time** —
trace fully before moving on.

```
todo(action: "create",
     subject: "Verify: <hypothesis one-liner>",
     description: "Confirm via: <test or trace>. Falsify via: <result>.")
```

For each task: mark `in_progress`, then **confirm or falsify** with evidence.

**Two ways to confirm (prefer the first):**

1. **Reproduction test (strongest).** Write a test that reproduces the symptom
   using the project's existing test framework and conventions. Run it. A **red**
   test that fails for the exact reported reason = CONFIRMED. This test becomes
   the regression test in Phase 6 — write it in the real test suite, not a scratch
   file. If it surprisingly passes, the hypothesis is likely wrong (FALSIFIED) or
   your repro doesn't match the real trigger — refine and retry once before
   dropping the hypothesis.

2. **Traced execution path.** When a test isn't feasible (timing, external
   state, prod-only), trace the full call chain from trigger to defect:
   - Follow each function caller → callee with `lsp_navigation(references)`.
   - At each step, state what value is guaranteed and why.
   - Check upstream guards — would an earlier check prevent the bad value from
     reaching the defect site?
   - Check all call sites — does every caller satisfy (or violate) the
     precondition?
   - Read the **live** code, not your memory of it.
   A hypothesis is CONFIRMED only when you can point to the exact line where the
   defect occurs and show the bad value reaching it. Speculation = FALSIFIED or
   "needs more evidence."

**Tracing toolbox:**

- `lsp_navigation(operation: "references", filePath, line)` — all callers
- `lsp_navigation(operation: "definition", filePath, line)` — jump to source
- `lsp_navigation(operation: "hover", filePath, line)` — type / nullability
- `ast_grep_search(pattern: "$E.Close()", lang: "go")` — all call sites of a shape
- `ffgrep(pattern: "<error substring>")` — locate emit sites
- `read(path, offset, limit)` — read the live code at the defect
- `bash` — run the repro test, `cast` for blockchain state, `curl` for HTTP

**Query production state (read-only).** If the symptom is prod-only and you have
read-only prod access (see project `AGENTS.md`), inspect live state to confirm or
refute a hypothesis — query the endpoint, read the row, check the log. **Never
perform state-changing operations** to reproduce; synthesize the condition in a
test instead.

Mark each task `completed` with a verdict:

- **CONFIRMED** — proven, with the failing test or traced line as evidence.
  Proceed to Phase 6.
- **FALSIFIED** — ruled out, with the evidence that rules it out.
- **INCONCLUSIVE** — couldn't prove or rule out. Note what's missing; may revisit
  next round.

**Only one hypothesis needs to confirm** to move to the fix. But if two
confirm, fix the root one (the other is usually a downstream symptom).

### Phase 5 — Loop back (if nothing confirmed)

If every hypothesis is FALSIFIED or INCONCLUSIVE: **do not guess a fix.** Go back
to Phase 2 (recon) and Phase 3 (hypothesize) with what you now know:

- **Broaden recon.** You eliminated the obvious suspects — look at adjacent
  layers (caller's caller, the framework, the build/CI, the dep version, the
  config loader, the migration runner).
- **Re-read the symptom.** Did you misread the stack trace? Was the "expected"
  behavior actually never the contract? Re-check artifacts you skimmed.
- **Challenge assumptions.** Re-examine each "fact" from Phase 1. Was it
  verified, or just asserted? Ask the user to confirm repro steps or provide
  more artifacts (logs at debug level, the exact request body).
- **Get a reproduction.** If you have no repro at all, the loop can't converge.
  Ask the user for one, or build a minimal harness that mimics the trigger.

Track the **round counter**. Cap at **3 recon→hypothesize→verify rounds**.

- **Round < 3 and you have new leads:** re-run Phase 2-4.
- **Round == 3 and still nothing:** stop. Report to the user: the confirmed-dead
  hypotheses, the inconclusive ones, the artifacts you'd need next (a live repro,
  a debug build, access to a specific env), and your best remaining guess clearly
  labeled as **unproven**. Do not ship a speculative fix.

### Phase 6 — Write the fix + regression test

You have a CONFIRMED root cause and (ideally) a failing repro test from Phase 4.

1. **Write the fix.** Surgical — touch only what the confirmed cause requires.
   Follow existing patterns. Don't refactor adjacent code. Match style.
2. **Flip the repro test green.** The test you wrote in Phase 4 should now pass.
   If it was an `INCONCLUSIVE`-trace confirmation (no test), **write the
   regression test now** — it must fail without your fix and pass with it.
3. **Name the fix after the cause, not the symptom.** The commit message and any
   comment should reference the root cause. A `// ponytail:` note is fine for a
   deliberate simplification; otherwise let the code and test speak.
4. **Clean up debugging scaffolding.** Remove any temporary prints, debug logs,
   scratch files, or `fmt.Println` you added while tracing. The only artifact
   left behind is the regression test.

If the fix touches a trust boundary (auth, input parsing, money, data
durability), have a `reviewer` subagent (fresh context) or a colleague check it
before declaring done.

### Phase 7 — Validate

Run the full validation, not just the new test:

```bash
make build     # if Makefile exists
make verify    # if Makefile exists — runs the test suite with the right tags
go test ./...  # or the project's test command
# Go: also staticcheck + go vet
```

Confirm:

- The **regression test passes** with the fix.
- The **regression test fails** if you revert the fix (temporarily; verify
  mentally or by stashing if cheap — proves the test actually guards the fix).
- **No other tests broke.** If something red, that's a new hypothesis — don't
  ignore it. Either it's a real regression from your fix (fix it) or a
  pre-existing failure (note it, don't own it).
- **No debug scaffolding leaked** into the diff.

## Report

```
## Debug: <one-line symptom>

### Root cause (CONFIRMED)
<mechanism>, at <file:line>. Proven by: <failing test / traced path>.

### Fix
<what changed, file:line>. Why this addresses the root cause and not the symptom.

### Regression test
<test name / file:line>. Fails without the fix, passes with it.

### Hypotheses ruled out (N)
1. <hypothesis> — FALSIFIED because <evidence>.

### Validation
make build: ✓ / ✗
make verify: ✓ / ✗ (N tests, including the new regression test)

### Follow-ups (optional)
- <related risk, unproven lead, or hardening suggestion>
```

If you hit the round cap without a confirmed cause, report the dead hypotheses
and what you need to proceed instead of inventing a fix.

## Example

```
Symptom: "GET /videos returns 500 for user 42, works for everyone else."

Round 1 — Recon + Hypothesize:
  - ffgrep "user 42" → only in a seed file, not the path.
  - ffgrep "GET /videos" → handler videoList at api/videos.go:88.
  - read api/videos.go:88-130 → calls store.ListForUser(userID).
  - Hypotheses:
    H1 (high): store.ListForUser panics on user 42's row (nil field).
        Confirm: repro test calling ListForUser(42). Falsify: test passes.
    H2 (med): userID parsed wrong from JWT (string vs int).
        Confirm: log the parsed userID in handler. Falsify: it's 42.
    H3 (low): DB connection pool exhausted for this user's shard.
        Confirm: check pool metrics. Falsify: other users on same shard work.

Round 1 — Verify:
  H2: add temp log, curl as user 42 → parsed userID is 42. FALSIFIED.
  H3: query prod (read-only) → pool healthy, other shard-2 users work. FALSIFIED.
  H1: write test_videos_test.go TestListForUser42 → PANICS at store.go:57,
      dereferencing row.ThumbnailURL on a NULL column. CONFIRMED.

Fix: store.go:57 — guard nil before deref (load ThumbnailURL into *string,
default to "" when NULL). Test now passes.
Validate: make verify → all green, new test included.
Revert fix locally → test fails again. Good.
Clean up: remove temp log added for H2.

Report: root cause = NULL ThumbnailURL deref at store.go:57, proven by
TestListForUser42. Fix + regression test shipped.
```

## Constraints

- **Never fix an unproven cause.** If you can't confirm with a repro test or a
  fully traced path, it's not a fix — it's a guess. Loop or escalate.
- **One task at a time in Phase 4.** Trace one hypothesis fully before the next.
  Don't batch verification.
- **Repro tests live in the real test suite.** No scratch files, no `/tmp`
  scripts, no ad-hoc `main()` to "just check". The regression test is the
  deliverable.
- **Read-only prod access only.** Never mutate production state to reproduce a
  bug. Synthesize the condition in a test.
- **Keep hypotheses bounded.** 3-6 per round. Quality over quantity — a long
  list of vague guesses is worse than three sharp ones.
- **Cap the loop at 3 rounds.** If you haven't confirmed a cause by round 3,
  report and escalate. Don't grind forever, and don't ship a speculative fix.
- **Clean up your own mess.** Temp logs, debug prints, scratch harnesses — all
  gone before you report done. Only the fix and the regression test remain.
