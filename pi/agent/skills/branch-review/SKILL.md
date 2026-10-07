---
name: branch-review
description: Review a git branch against main/master. Generates a diff, hypothesizes issues, then verifies each claim by tracing the full call chain before reporting. Use before merging PRs or branches. For mutation-proven test coverage use branch-review-deep.
---

# Branch Review

A two-phase review workflow: **hypothesize** issues from the diff, then **verify**
each by tracing the actual code paths. Never reports a claim it hasn't proven.

## When to use

- Reviewing a branch before merge
- Auditing a PR for correctness
- Checking whether a refactor broke callers

**Do not use** for: implementing features, writing tests, or debugging runtime
behavior. The reviewed tree is never edited. When a review needs
mutation-proven test coverage (every test kills its claimed regression), use
`branch-review-deep` instead — it adds a mutation pass that roughly doubles
the review time.

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
weak test is a finding, not noise. Past ~400 changed lines, review
effectiveness drops sharply — note it in the report and recommend a split;
past ~2000, review in per-file batches with one running findings list.

**Step 1b — Intent model.** Read the commit messages, PR description, and any
linked issue. Write 2–3 sentences: what this branch claims to do. Then:

- Every promised behavior must have code **and** a test. A promise with no
  code is a lead — omissions are invisible in the diff, so the intent model
  is the only place they surface.
- Anything in the diff not serving that intent is an "unrequested scope"
  lead (see bloat below).
- The intent model goes in the report, so a reader can check code against
  intent, not just code against tests.
- **The branch's own claims are leads, not exemptions.** "Accepted
  tradeoff", "follow-up", "known limitation" in a README, comment or PR
  description is graded like any other finding. For each declared side
  effect, check whether it undoes an earlier deliberate decision: read the
  comments around the affected code and run `git log -S'<symbol>'`. Bringing
  back a failure someone fixed on purpose is a behaviour regression.
- **Completeness.** For a fix, list every way the original problem shows up
  (each trigger, path, idle or edge case) and name the code that covers each.
  An uncovered case is CONFIRMED "fix incomplete: <case>".

**Step 2 — Run build/lint, then tests scoped to the changed code.**

```bash
make build     # if Makefile exists
make verify    # if Makefile exists
```

Never run the whole suite. Derive the affected packages from the diff and
run only those:

```bash
PKGS=$(git diff --name-only $BASE..HEAD | grep -E '\.go$' | xargs -n1 dirname | sort -u | sed 's|^|./|')
go test $PKGS   # or the project's equivalent, scoped to the changed dirs/files
```

If an exported function/interface changed, also include its direct
dependents: find them with `lsp_navigation("references")` or `ffgrep` on the
changed symbols and add those packages to `$PKGS`.

`-race` is off by default — it is slow. Add it ONLY when the diff touches
concurrency primitives in the changed packages: `go` statements, channels,
`sync.*`/`atomic.*`, `select`, worker pools, shared caches. Then run
`go test -race $PKGS` on exactly those packages, not the whole module.

If these fail, note the failures — they're real issues, no verification needed.
If the tests cannot run at all (no env, no runner), record it: `test_blocked`
plus the blocking reason — the grade is capped and the residual risk stated.
Never present an unrun suite as a green one.

**Step 2b — Bloat signal.** Measure added comment density:

```bash
git diff $BASE..HEAD | grep '^+[^+]' | grep -cE '^\+\s*(//|#|/\*|\*|--)'  # added comment lines
git diff $BASE..HEAD | grep -c '^+[^+]'                                       # added lines total
```

If more than ~15% of added lines are comments, or any comment block has more
than 3 lines, check every added comment one by one in Step 3.

**Step 2c — Skipped tests count as not run.** Run the scoped tests verbosely
and list skips:

```bash
go test -v $PKGS 2>&1 | grep -E -- '--- (SKIP|FAIL)'   # or the project's equivalent
```

- If the env a skipped test needs exists (local DB, DSN var, local stack), rerun
  with it and report the real result.
- A test that skips because it relies on data already present in the DB or
  fixtures, instead of seeding its own like its siblings, is CONFIRMED.
- If a changed production line's only guard is a skipped test, that is
  CONFIRMED "untested: <line>".

**Step 2d — Debug leftovers.** Grep added lines for debug debris:

```bash
git diff $BASE..HEAD | grep -nE '^\+.*(fmt\.Print|console\.log|println\(|debugger|dbg\.|TODO|FIXME|XXX)'
```

Debug prints, leftover markers, and commented-out code in added lines are
CONFIRMED by quoting the line — no trace needed.

**Step 3 — Hypothesize issues.**

Read the diff and list potential issues. For each, note:

- **What** changed (file:line, old → new)
- **Why** it might be wrong (the scenario that breaks)
- **What to trace** (the call chain to verify)

Issue categories to check:

- **Concurrency**: data races, missing locks, lock ordering, TOCTOU,
  goroutine lifecycle (leaks, premature exit), context cancellation,
  shutdown/initialization ordering. For background/async work, play out each
  state change: what if the side effect fails, times out, runs out of order,
  or is dropped at shutdown? Is local state advanced **before** the side
  effect is confirmed? Can a panic in it crash the process (no recover, no
  errgroup)?
- **Writes and their readers**: for every new or more frequent write (DB
  row, cache, queue, file, external API), list everything that reads or reacts
  to it: triggers, audit/history tables, other services, dashboards and SQL
  panels, version/CAS checks, sync jobs, permission grants on the target. Each
  reader is a hypothesis to trace.
  - **Shared resources**: name the limited resources each new operation uses
    (connection pool, row locks, rate limits, quotas) and find their limits in
    the code (`MaxOpenConns`, etc.).
  - **Frequency × fan-out**: how often does it run (per request / call / turn
    / item)? Multiply by any per-element repetition. "Correct but runs N
    times" is a finding when N grows with input.
- **Resource leaks**: unclosed connections, goroutines, files, temp state
- **Nil/missing guards**: removed nil checks, ignored bool returns
- **Behavior changes**: removed filters, changed error handling, altered semantics
- **Call site breakage**: signature changes without updating callers
- **Boundary conditions**: off-by-one (`<` vs `<=`), zero/empty/nil inputs,
  max values, first/last element
- **Error paths**: swallowed errors, wrong wrap/annotation, partial-failure
  states, panics on paths that used to return errors
- **Performance**: hot-path regressions, accidental O(n²), N+1 queries,
  unbounded growth
- **API/contract compatibility**: exported signature changes, breaking
  serialization/schema/config formats for existing consumers
- **Security**: diff touches input validation, query/HTML/shell construction
  (injection sinks), authn/authz, crypto, or logging → check for new attack
  vectors, weakened existing controls, trust boundaries crossed by new data
  flows, hardcoded secrets (scan the diff), sensitive data in logs/errors.
  When the diff stores or moves a secret, list every place a copy lands
  (logs, traces, audit tables, backups, replicas, analytics) and who can read
  each (`GRANT`, IAM). Keeping a secret out of one place while copying it
  into another is a finding.
  Security regressions are traced like any behavior change — never assumed.
- **Dependency changes**: go.mod/package.json/lockfiles in the diff → for each
  new dep: license, known CVEs, version pinning, whether it's needed at all
- **Docs consistency**: changes to how users build/test/run/release → README
  and docs updated? Deleted/deprecated code → its docs deleted?
- **Fix at source**: when the diff works around a shared defect for one case
  only (bypassing a tracing plugin, a private client to get a timeout), check
  whether fixing it at the source is small. If so, CONFIRMED "fix at source:
  <file:line>".
- **Project rules**: read the coding rules in the repo's `CLAUDE.md` /
  `AGENTS.md` (DB access, concurrency, error handling, logging) and check
  every added line against them. CONFIRMED by quoting the rule and the line.
- **Naming**: names must not lie (`Get*` that mutates, plural naming a single
  thing).
- **CL hygiene**: reformat-only hunks mixed into behavior changes;
  intermediate commits that don't build (spot-check with
  `git rebase --exec 'make build' $BASE` only when cheap).
- **Test coverage**: for each changed production branch/query/condition, name
  the test that fails if it breaks. None, or only skipped ones → finding.
  Tests that no longer match behavior → finding.
- **Test gate**: every added or changed test must answer all five; a missing
  answer is a finding (quote the test):
  1. What observable behavior or contract does it protect?
  2. What credible regression makes it fail?
  3. Why doesn't existing coverage catch it? Each contract has ONE owner test
     at the strongest boundary; another layer needs a distinct risk the owner
     can't reach.
  4. Does it need a production seam (export, flag, hook) no production caller
     uses?
  5. Is the expected value right according to the **intent**, not just the
     code? A test that locks in a bad behaviour turns a bug into a contract.
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
  A test finding is CONFIRMED with: test name + location, what it can
  actually detect, the stronger owner test that remains, and what removing it
  unlocks. Missing field → "needs verification" — EXCEPT a duplicate row
  pair in the overlap matrix (Step 3b), which is CONFIRMED on its own.
- **Scope of the test audit**: every test function AND every subtest/table
  case the diff adds or changes, plus every other test in a test file the
  diff touches whose subject overlaps them. A table case is a test: audit it
  like one.
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
  - **Reinvented in-repo subsystem**: new infrastructure (token storage,
    retry, outbox, cache, credential store) when the repo or an open branch
    already has one. Search the concept (`ffgrep`, `git branch -a`) before
    accepting it. Not using the existing one is a design finding.
  - **Speculative flexibility**: config knobs, options, params, or generics
    that no caller uses. Prove that every call site passes the same value or
    the default.
  - **Dead code**: new functions, vars, branches, or exports with zero
    readers. Prove with a zero-reference grep/LSP result.
  - **Redundant intermediates**: variables assigned and returned right away,
    duplicated logic, defensive copies that nothing mutates.
  - **Semantic duplication**: two blocks with different syntax but equal
    intent (a second, working hand-rolled sort next to the existing one).
    Grep won't find it — compare each new logic block against neighbors with
    the same responsibility.
  - **Semantic dead code**: code that executes but affects no output —
    computed, correct, and pointless.
  - **Unrequested scope**: features, logging, or refactors of untouched code
    that don't serve the branch's stated goal (check commit messages / PR
    title).
  CONFIRMED only when you write the smaller replacement (or say "delete
  lines X–Y") **and** prove it keeps the same behavior. Taste alone ("I'd
  write it differently") is not a finding.

Write the issue list.

**Step 3b — Test overlap matrix.** Junk tests are judged against each
other, not one at a time. For each package, list every in-scope test and
subtest as a row:

```
test/subtest | entry point called | inputs (fixture, stub, ctx, options) | fields asserted
```

- Two rows with the same entry point and equivalent inputs that assert
  different fields → CONFIRMED "duplicate invocations". Write the merged
  table (cases × every asserted field).
- A row whose inputs differ only by a value the package cannot distinguish
  (e.g. two budgets both above the cap, a "voice"/"chat" split in a package
  that has no channels) → CONFIRMED "wrong-layer / same case twice".
- A row whose name claims an outcome no assertion in the row checks (name
  says "RunsLexicalOnly", fields asserted say only "reached the query
  stage") → CONFIRMED "name promises more than it asserts".

The matrix goes in the Phase 3 report.

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

### Phase 2b — Re-derivation pass

For every CONFIRMED issue, re-derive it from the diff and the cited lines
**only** — no access to your Phase 1/2 reasoning trail. Reading your own
narrative again re-manufactures its hallucinations; the point of this pass is
to disprove. For each issue ask: what guard, caller, or ordering kills this?
Anything you can't re-derive from the evidence alone is downgraded to FALSE
POSITIVE (unproven).

### Phase 2c — Root cause

Group the surviving CONFIRMED issues by the design decision they stem from
(where data lives, who owns a resource, sync vs async). Two or more sharing
one decision → one **design** finding (important), with those issues as
evidence and the alternative that removes them. The proof is the confirmed
issues themselves, not taste.

### Phase 3 — Report

Summarize the findings. Severity is derived from evidence, not opinion —
**proven by failing test** > **traced call chain + guard-checked** >
plausible pattern. Labels: **blocking** (correctness, security, data loss —
must fix), **important** (should fix), **nit** (polish). Not everything is
blocking.

```
## Review: <branch>

Intent: [Step 1b intent model, 2-3 sentences]

### Design findings (N)
1. **[Decision]** — important. Causes: [confirmed issue numbers].
   Alternative: [design that removes them, existing in-repo example if any].

### Confirmed Issues (N)
1. **[Title]** — [blocking|important|nit] (evidence: failing-test|traced)
   — file:line. Proof: [trace]. Repro: [command/scenario, for blocking].
   Fix: [suggestion].

### False Positives (N)
1. **[Title]** — thought X, but traced Y → safe because Z.

### N/A (N)
1. **[Title]** — dead code / unreachable.

### Bloat (N lines removable)
1. **[Title]** — file:lines. Proof: [ref count / guard trace / stdlib fn].
   Replacement: [shorter code or "delete"].

Comment density: X added comment lines / Y added lines.

### Test audit
Test gate (one row per in-scope test AND subtest/table case — an empty or
hand-waved cell is itself a finding):

| test/case | 1. behavior protected | 2. regression that fails it | 3. why the owner test doesn't | 4. prod seam? | 5. expected value matches intent? |
|---|---|---|---|---|---|

Overlap matrix: [Step 3b rows; duplicates marked]
Skipped: [test → reason → covered elsewhere? y/n]
LOC: production +A/−B, tests +C/−D (git diff --numstat)

### Coverage
One row per Step 3 category: ✅ reviewed / ⚠️ shallow / ❌ not covered.
Declined to judge: [each item considered and set aside, with reason —
"none" is a valid answer. An item with a concrete cost (failure, load, data
exposure, metric skew) cannot sit here: confirm it or refute it with proof]

Done well: [1-3 things worth keeping]

### Verdict: APPROVE | COMMENT | REQUEST CHANGES

### Grade: X/100
```

APPROVE = no confirmed blocking/important issues. COMMENT = nits only.
REQUEST CHANGES otherwise.

**Grading rubric** (applied identically to every branch): grade = 100, then
deduct per confirmed issue — blocking −20, important −10, nit −3; each
confirmed bloat/verbose-comment/junk-test finding −2 (total bloat deduction
capped at −15). Caps applied after deductions:

- a changed line guarded only by a skipped test → **85**
- confirmed security issue → **75**
- a diff that could be ≥40% smaller → **85**
- tests never ran at all (`test_blocked`) → **80**, stated in the report
- unresolved design finding → **85**

Score from executable evidence first (suite result), traced
findings second, everything else last.

**Dismissal memory:** before Step 1, read project memory for previously
refuted hypotheses and dismissed finding types — don't re-report what an
earlier pass disproved unless the diff changed the facts. After the report,
persist new refuted hypotheses (memory tool) so the next pass starts from
them.

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
       seed their own tenant; this test relies on data already present
       instead of seeding its own.
Verdict: CONFIRMED — lexical-only query is untested; the live test must seed
         its own chunk and assert the exact score (1/61 lexical, 2/61 both).
```

## Constraints

- **Issues start in the diff; effects do not stop there.** Every issue must
  originate from a changed line, but its consequences in untouched code
  (triggers, readers, dashboards, pools, other services) are in scope and
  graded. Bugs that predate the branch in untouched code are listed at most
  as "pre-existing, out of scope" notes — never as confirmed issues, never
  graded.
- **Never edit the reviewed tree.** Use `read`, `bash`, `grep`,
  `lsp_navigation`, `ast_grep_search` — never `edit` or `write` on it (except
  for task list).
- **Never report speculative bugs.** If you can't prove it by tracing, mark it
  "needs verification" or skip it.
- **One task at a time.** Don't batch verification. Trace one claim fully before
  moving to the next.
- **Keep the issue list short.** 3-8 issues. Quality over quantity. A review
  with 0 confirmed issues is a valid result. Bloat, verbose-comment, and
  junk-test findings don't count toward this limit; group the same pattern into one
  finding (e.g. "9 restating comments in handler.go").
- **Bloat lowers the grade.** Bloat is never a correctness bug — the Phase 3
  rubric deducts for every confirmed bloat finding and caps a diff that could
  be ≥40% smaller at 85.
