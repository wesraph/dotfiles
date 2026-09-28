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
behavior. The reviewed tree is never edited; the only code changes allowed are
throwaway mutants in a scratch worktree (Phase 2b).

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
`--stat`. Test files in the diff get reviewed as carefully as logic files — a
weak test is a finding, not noise.

**Step 2 — Run build/lint.**

```bash
make build   # if Makefile exists
make verify  # if Makefile exists
go test ./...  # or project's test command
```

If these fail, note the failures — they're real issues, no verification needed.

**Step 2b — Bloat signal.** Measure added comment density:

```bash
git diff $BASE..HEAD | grep '^+[^+]' | grep -cE '^\+\s*(//|#|/\*|\*|--)'  # added comment lines
git diff $BASE..HEAD | grep -c '^+[^+]'                                       # added lines total
```

If more than ~15% of added lines are comments, or any comment block has more
than 3 lines, check every added comment one by one in Step 3.

**Step 2c — Skipped tests count as not run.** Run the tests verbosely and list
skips:

```bash
go test -v ./... 2>&1 | grep -E -- '--- (SKIP|FAIL)'   # or the project's equivalent
```

- If the env a skipped test needs exists (local DB, DSN var, local stack), rerun
  with it and report the real result.
- A test that skips because it relies on data already present in the DB or
  fixtures, instead of seeding its own like its siblings, is CONFIRMED.
- If a changed production line's only guard is a skipped test, that is
  CONFIRMED "untested: <line>".

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
- **Test coverage**: for each changed production branch/query/condition, name
  the test that fails if it breaks. None, or only skipped ones → finding.
  Tests that no longer match behavior → finding.
- **Test gate**: every added or changed test must answer all four; a missing
  answer is a finding (quote the test):
  1. What observable behavior or contract does it protect?
  2. What credible regression makes it fail?
  3. Why doesn't existing coverage catch it? Each contract has ONE owner test
     at the strongest boundary; another layer needs a distinct risk the owner
     can't reach.
  4. Does it need a production seam (export, flag, hook) no production caller
     uses?
- **Junk tests**: flag any added/changed test that matches:
  - constant echo: asserts a tuning value (`timeout == 300ms`,
    `interval == 6s`) — catches no behavior change, forces a second edit on
    retune
  - name or fixture promises more than it asserts ("RunsLexicalOnly" that
    only proves a width guard passes)
  - negative control that passes for an unrelated reason (an offline DB
    returns `context.Canceled` by itself, so the cancel check never runs)
  - weak assertion (`> 0`, `!= nil`) where the exact value is computable
  - duplicate invocations of one contract: N tests, same inputs, each checks
    one field — fix is one table checking every field per case
  - wrong-layer test: exercises a concern the package doesn't know about,
    already covered at the owning layer — delete it
  - expected value produced by the helper under test; mock that implements
    the asserted behavior
  - test-only export or seam with no production caller
  - assertion-free probes, self-comparisons, copied fixtures, source greps
- **Retention bar**: don't over-delete. Keep a test that independently guards
  a public API, protocol, config, storage, security, or user-facing default
  (a documented default is a contract; a tuning constant is not). "Static",
  "slow", or "looks like implementation" is not proof of redundancy. A kept
  seam or duplicate is fine when its reason is stated (e.g. "fake can't reach
  the unexported option without it").
  A test finding is CONFIRMED only with: test name + location, what it can
  actually detect, the mutant it caught or missed (Phase 2b), the stronger
  owner test that remains, and what removing it unlocks. Missing field →
  "needs verification".
- **Comments**: every added/changed comment must describe what the code does
  (or why) — nothing else. Flag any comment that references the session,
  the change, or history ("byte-identical to what it was before", "the old
  behaviour…", "previously", "now does X", "unchanged from before", "fix
  for…") and any comment that contradicts the code it sits on. These are
  CONFIRMED by quoting the comment (and the code, for contradictions) — no
  call-chain trace needed. Fix: rewrite to describe current behavior, or delete.
- **Verbose comments**: flag any added comment that:
  - restates the code (`// increment counter` above `i++`, a docstring that
    repeats the signature)
  - narrates obvious steps (`// Step 1: ...`, `// Now we ...`)
  - is a multi-line essay where one line (or nothing) would do
  - is a section banner, or explains language basics
  Keep comments that give a non-obvious *why*: a business rule, a gotcha, or
  a constraint. CONFIRMED by quoting the comment and the line it describes.
  Fix: delete it or shrink it to one line (write the shortened version).
- **Useless code (bloat)**: every added line must be needed. Flag:
  - **Single-use abstractions**: a new helper, interface, class, factory, or
    wrapper with exactly one caller that adds nothing. Prove with a
    references/grep count.
  - **Impossible-case handling**: nil/empty/error checks that an upstream
    guard already makes unreachable. Prove by tracing the guard, like any
    other claim.
  - **Reinvented stdlib/deps**: hand-written code that duplicates a stdlib
    function or an already-installed dependency. Prove by naming the exact
    function and showing it is available (import or go.mod/package.json).
  - **Speculative flexibility**: config knobs, options, params, or generics
    that no caller uses. Prove that every call site passes the same value or
    the default.
  - **Dead code**: new functions, vars, branches, or exports with zero
    readers. Prove with a zero-reference grep/LSP result.
  - **Redundant intermediates**: variables assigned and returned right away,
    duplicated logic, defensive copies that nothing mutates.
  - **Unrequested scope**: features, logging, or refactors of untouched code
    that don't serve the branch's stated goal (check commit messages / PR
    title).
  CONFIRMED only when you write the smaller replacement (or say "delete
  lines X–Y") **and** prove it keeps the same behavior. Taste alone ("I'd
  write it differently") is not a finding.

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

### Phase 2b — Mutation Check

Prove each test catches the regression it claims. For every fix or guard the
branch adds, and the test(s) claimed to cover it:

1. `git worktree add ./worktrees/review-mutants HEAD` — never mutate the
   reviewed tree.
2. Inject ONE mutant: revert the fix, flip the condition, force a switch both
   ways (always / never), drop the call, change the constant.
3. Run only the claimed test(s). It must fail **for the intended reason** —
   read the failure message, not just the exit code.
4. `git -C ./worktrees/review-mutants checkout -- .`, next mutant.
5. When done: `git worktree remove --force ./worktrees/review-mutants`.

A surviving mutant is CONFIRMED: "test X passes without Y". Cap at ~20
mutants, focused on new branches, conditions, and queries.

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

### Bloat (N lines removable)
1. **[Title]** — file:lines. Proof: [ref count / guard trace / stdlib fn].
   Replacement: [shorter code or "delete"].

Comment density: X added comment lines / Y added lines.

### Test audit
Skipped: [test → reason → covered elsewhere? y/n]
Mutants: N injected / K caught / S survived → [survivors: test X passes without Y]
LOC: production +A/−B, tests +C/−D (git diff --numstat)

### Grade: X/100
```

A surviving mutant on changed code, or a changed line guarded only by a
skipped test, caps the grade at 85.

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

Claim: "newRetryPolicy() + RetryOptions struct is a single-use abstraction"
Trace: grep newRetryPolicy → 1 caller (client.go:42), passes defaults only.
       RetryOptions fields MaxJitter/OnRetry are never set by any caller.
Verdict: CONFIRMED (bloat) — inline as `for i := 0; i < maxRetries; i++`
         at client.go:42; delete retry.go (38 lines).

Claim: "12-line doc comment on parseID restates the signature"
Trace: comment says "parseID takes a string and returns an int and an error";
       nothing in it is non-obvious.
Verdict: CONFIRMED (verbose comment) — delete, or keep a single line:
         `// parseID accepts legacy "u-" prefixed IDs.`

Claim: "TestRetrieveLexicalOnly_Live guards the lexical-only SQL"
Trace: go test -v with RAG_TEST_DSN → --- SKIP (no chunks in DB). Siblings
       seed their own tenant. Mutant "always run vector query" in
       ./worktrees/review-mutants → every test passes.
Verdict: CONFIRMED — lexical-only query is untested; the live test must seed
         its own chunk and assert the exact score (1/61 lexical, 2/61 both).
```

## Constraints

- **Diff is the only review surface.** Every issue must originate from a changed
  line. Pre-existing bugs in untouched code found while tracing are listed at
  most as "pre-existing, out of scope" notes — never as confirmed issues,
  never graded.
- **Never edit the reviewed tree.** Use `read`, `bash`, `grep`,
  `lsp_navigation`, `ast_grep_search` — never `edit` or `write` on it (except
  for task list). Mutants live only in the throwaway `./worktrees/review-mutants`
  worktree, removed at the end.
- **Never report speculative bugs.** If you can't prove it by tracing, mark it
  "needs verification" or skip it.
- **One task at a time.** Don't batch verification. Trace one claim fully before
  moving to the next.
- **Keep the issue list short.** 3-8 issues. Quality over quantity. A review
  with 0 confirmed issues is a valid result. Bloat, verbose-comment, and
  junk-test findings don't count toward this limit; group the same pattern into one
  finding (e.g. "9 restating comments in handler.go").
- **Bloat lowers the grade.** Bloat is never a correctness bug, but every
  confirmed bloat finding costs points. A diff that works but could be 40%
  smaller should not score above 85.
