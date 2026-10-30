---
name: branch-review
description: Review a git branch against main/master. Generates a diff, hypothesizes issues, then verifies each claim by tracing the full call chain before reporting. Use before merging PRs or branches. For mutation-proven test coverage use branch-review-deep.
---

# Branch Review

Two phases: **hypothesize** issues from the diff, then **verify** each by
tracing the real code paths. Never report a claim you haven't proven.

**Use for:** reviewing a branch before merge, auditing a PR, checking a
refactor's callers. **Not for:** implementing, writing tests, debugging
runtime behaviour. The reviewed tree is never edited. For mutation-proven
test coverage use `branch-review-deep` (adds a mutation pass, ~2× the time).

## Phase 1 — Diff + hypothesize

Issues are **leads, not verdicts**: every one is verified in Phase 2.

### Step 1 — Diff and areas

```bash
BRANCH=$(git branch --show-current)
BASE=$(git merge-base $BRANCH main || git merge-base $BRANCH master)
git diff $BASE..HEAD --stat; git log --oneline $BASE..HEAD; git diff $BASE..HEAD
```

- Test files are reviewed as carefully as logic: a weak test is a finding.
- Past ~400 changed lines effectiveness drops: say so, recommend a split.
  Past ~2000, review per-file batches with one running findings list.
- **Areas:** split the change surface into areas (one per service/command,
  shared package, schema, web app, mobile app, infra) with line counts.
  Every Step 3 category applies to every area; an area not reached is ❌.

### Step 1b — Intent model

Read commits, PR description, linked issue, and the repo's specs/design
docs and setup docs (README install/deploy steps, job prompts) the branch
implements. Write 2–3 sentences: what the branch claims to do. It goes in
the report. Then:

- **Spec conformance:** every spec requirement maps to code or to a
  decision the PR records. Missing command/feature/behaviour, or code
  doing something else → CONFIRMED "spec gap: <spec file:line>".
- **Docs match code:** every value a setup doc or prompt names (callback
  path, service name, env var, API to enable, space/channel ID) is the
  one the code uses; names of things in another repo are checked against
  that repo's source when available. Placeholder IDs in shipped config with
  no startup validation and no setup step → CONFIRMED.

- A promised behaviour needs code **and** a test; a promise with no code is
  a lead (omissions only surface here). Diff not serving the intent is an
  "unrequested scope" lead.
- **Claims are leads, never exemptions.** Statements in the PR, README,
  spec, UI copy, tool descriptions and **code comments** ("redirects to
  another host are dropped", "latched on purpose", "the window is tiny",
  "accepted tradeoff", "follow-up") are checked on every path that reaches
  them. True on one path only → CONFIRMED "claim holds only for <path>".
  For a declared side effect, check it doesn't undo an earlier deliberate
  fix (`git log -S'<symbol>'`): bringing a fixed failure back is a
  regression.
- **Completeness of a fix:** list every way the original problem shows up
  (trigger, path, idle/edge case) and the code covering each. Uncovered →
  CONFIRMED "fix incomplete: <case>".

### Step 2 — Build, lint, scoped tests

```bash
make build; make verify          # if the Makefile has them
PKGS=$(git diff --name-only $BASE..HEAD | grep -E '\.go$' | xargs -n1 dirname | sort -u | sed 's|^|./|')
go test -v $PKGS 2>&1 | grep -E -- '--- (SKIP|FAIL)'   # or the project's equivalent
```

- Never the whole suite. Add packages of direct dependents of changed
  exported symbols (`lsp_navigation references` / `ffgrep`). `-race` only
  when the diff touches concurrency in those packages.
- An orchestrator-provided suite result (split pass) replaces this run: run
  only your own repro and mutant tests.
- Live/repro tests seed their own rows (own tenant, or a rolled-back tx).
  Never change, delete or "restore" rows you did not create; polluted
  shared data is reported, not fixed.
- Failures are real issues, no verification needed. Can't run at all →
  `test_blocked` + reason (grade capped). Never present an unrun suite as
  green.
- **Skips count as not run.** If the needed env exists (local DB, DSN,
  stack), rerun with it. A test skipping because it relies on pre-existing
  data instead of seeding its own → CONFIRMED. A changed line guarded only
  by a skipped test → CONFIRMED "untested: <line>".
- **Debris:** `git diff $BASE..HEAD | grep -nE '^\+.*(fmt\.Print|console\.log|println\(|debugger|dbg\.|TODO|FIXME|XXX)'`
  — debug prints, markers, commented-out code are CONFIRMED by quoting.
- **Comment density:** added comment lines / added lines. Over ~15%, or
  any block over 3 lines → check every added comment in Step 3.

### Step 3 — Hypothesize

For each lead note **what** changed (file:line, old → new), **why** it may
break (the scenario), **what to trace**. Work through every category below.

**Required written artifacts.** These categories are not ✅ without their
table or case written in the report — they are the checks most often
ticked without being done:

| category | artifact |
|---|---|
| Parity with replaced code | *old behaviour → new code → verdict*, every item, "n/a" included |
| Every path of a guard | *guard → each implementation/path → bound line or measurement* |
| Partial results | *outcome × position → (result, err) → what the caller does* |
| Writers of a shared row | every writer (by grep) + the **longest** staleness window of each blind one |
| Keys | *key → each caller or grouping step → where its key comes from → verdict* |
| Batches | the two-item case: A and B both edited; A replaced by C |
| Tests | test gate table + overlap matrix (Step 3b) |
| Trust boundaries | *untrusted input → each privileged sink it reaches → mediating line → verdict* (Security, C) |
| Spec conformance | *requirement (spec file:line) → code or recorded decision → verdict* (Step 1b) |

#### A. Runtime and lifecycle

- **Concurrency:** races, locks and ordering, TOCTOU, goroutine leaks or
  premature exit, cancellation, shutdown/init order. For async work, play
  out each state change: the side effect fails, times out, runs out of
  order, is dropped at shutdown. Is local state advanced before the side
  effect is confirmed? Can a panic crash the process?
- **New deployable or worker vs its siblings — per capability.** For each
  thing it does (retrieval, crawling, queue draining, JWT routes), find the
  existing service that already does it and compare that capability's
  setup item by item (a service moved out of another is compared with its
  origin for what moved, and with the services that already do the rest):
  - shutdown: signals, drain, in-flight work on kill (message handed back?
    attempt counted before or after the work?);
  - boot-time dependency failure: retried, or latched until the next deploy
    (`sync.Once` keeping an error). A latch is CONFIRMED unless you name
    the code that retries it; check what keeps the broken instance alive
    (probe not touching the dependency, min-instances ≥ 1);
  - pool options and session settings; body-size and memory caps per unit
    of work.
- **Shared resources and new callers.** Name each limited resource a new
  operation uses (pool, row locks, rate limits, quotas) and its limit in
  code. For each new pool/handle, list the queries that run on it and
  compare its setup with the pools that already run them. When changed
  code uses an existing function/store/client in a new place, read the
  callee's doc for preconditions ("call Close", "needs setting Y") —
  including what it needs from its connection (session settings,
  `search_path`, timeouts, extensions) — and compare with other callers.
- **Frequency × fan-out:** how often it runs (per request/call/turn/item)
  × per-element repetition. "Correct but runs N times" is a finding when N
  grows with input.
- **Production configuration:** derive which branches run in production
  from the infra env; flag defaults and missing keys (a fallback without
  its key configured does not exist). Judge every lead under that config.

#### B. Data and state

- **Writes and their readers:** for each new or more frequent write (row,
  cache, queue, file, external API), list what reads or reacts to it:
  triggers, history tables, other services, dashboards/SQL panels, CAS
  checks, sync jobs, grants. Each reader is a lead.
- **Schema rules reach every writer:** for each new FK, NOT NULL, CHECK,
  unique index or trigger, grep the whole repo for every write on the
  table and trace each against the rule (classic failure: an `UPDATE ...
  SET <tenant key>` moving rows a new FK ties to rows it does not move).
  For each new tenant/user/item-scoped table, check every lifecycle
  operation of that scope: create, move/merge/re-scope, delete, export,
  copy.
- **Writers of a shared row or document:** list every writer by grepping
  the write call and the table — other services, UI saves (a form saving
  the whole document is a writer even if it doesn't edit the new field),
  other tabs/devices. A blind whole-value writer next to another writer
  loses updates. "A narrow window" is decided by the longest staleness
  bound (poll caps, navigation, idle tab, other devices, other services),
  never asserted.
- **Keys (upsert, natural, dedup):** across every entry point (API, UI,
  LLM tools, accept paths, batch jobs): can two things land on one key
  (overwrite)? Can one thing get two keys (duplicate)? A caller holding the
  stored key but sending a freshly typed one → CONFIRMED "duplicate key". A
  group written under one member's key (`first(...)`): trace a group whose
  members carry different keys — each written, or only the first while all
  are marked done?
- **Batches:** any save submitting several items at once (UI Save,
  multi-select, import, sync). For each per-item check (conflict,
  validation, uniqueness, rename), name what it compares against: stored
  state or the batch's new state.
- **Partial results:** a loop that can return what it has so far — a
  cut-short run reported as success is CONFIRMED.
- **Caps between producer and consumer:** for each size/count limit, every
  producer and every consumer path (accept, pin, edit, export). Unbounded
  on one side, capped on the other = stuck state (endless retry, a save
  that can never succeed).

#### C. Inputs, guards, replaced code

- **Parity with replaced code:** read the deleted code (`git show
  $BASE:<path>`); list each behaviour — normalisation/encoding (IDN →
  punycode), redirect following, size caps, retries, timeouts, error
  mapping, accepted content types, TLS policy. Missing →
  CONFIRMED "regression: <behaviour> lost from <old file:line>".
- **Every path of a guard:** a guarantee (size cap, timeout, address
  check, redirect rule, content type, retry) enforced on one
  implementation/path is checked on every other (test fakes excluded),
  production path first. Absent on the path production runs → CONFIRMED.
  "n/a", "the platform bounds it" (browser, OS, a timeout) and "no failure
  shown" are not verdicts: name the line bounding the **same** resource, or
  run it. A bound on another resource doesn't count (a timeout doesn't
  bound memory; a page count doesn't bound page size).
- **Realistic external input,** run (test or trace) against:
  - URLs: IDN, redirect to another host, apex ↔ `www.`, explicit port, IP
    literal, trailing dot, mixed case — each also combined with a redirect;
  - HTTP: 403/429/503 on the first page and mid-run, redirect chains,
    oversized body, non-HTML type, a challenge/captcha widget inside an
    ordinary page;
  - text: empty, very long, non-ASCII, markup, prompt injection.
  A whitelist/blacklist of markers or statuses is checked for what else
  matches it.
- **Security:** input validation, injection sinks (query/HTML/shell),
  authn/authz, crypto, logging → new vectors, weakened controls, trust
  boundaries crossed, hardcoded secrets, sensitive data in logs. A stored
  or moved secret: list every copy (logs, traces, audit tables, backups,
  analytics) and who can read each (`GRANT`, IAM).
- **Threat model (trust-boundary artifact).** List untrusted inputs (user,
  chat or meeting text, PR bodies, logs, alerts, web pages, files a
  sandboxed process can write, notes/memories/summaries another run
  persisted) and privileged sinks (tokens, DSNs, command-running tools or
  LLM sessions with tools, open egress, shared state, prompts of more
  privileged sessions). Trace each input → sink across packages, processes
  and containers:
  - least privilege per caller: a read-only workload holding a
    write-capable credential → CONFIRMED;
  - deny lists, prompt rules and unsetting env vars are not boundaries:
    find the bypass (`gh api graphql`, `curl $TOKEN`, another binary, a
    same-uid child reading /proc, profile dirs or keyring/DBus sockets).
    The control must be server-side (scoped token, ruleset, DB role,
    network policy);
  - text persisted by one session and injected into another's prompt is
    untrusted unless a human confirmed it: wrapped or left out when the
    reader holds more privilege than the writer's sources;
  - a sandboxed process must not write files its supervisor parses and
    acts on (status, rate-limit events, results): play the forged value;
  - egress allowlist and metadata-server block in place before containers
    start, including those Docker restarts at boot;
  - "addressed to me" checks compare against the service's own id;
    redirect targets are validated after URL resolution (origin compare).

#### D. Behaviour and contracts

- **Behaviour changes:** removed filters, changed error handling, altered
  semantics. **Text matching:** substring checks on words or commands
  (`Contains("resolved")` matches "unresolved"), a prefix (bot name)
  stripped by one parser but not its siblings. **Error paths:** swallowed errors, wrong wrapping,
  partial-failure states, panics where errors used to return. **Nil
  guards:** removed checks, ignored bool returns. **Boundaries:**
  off-by-one, zero/empty/nil, max, first/last. **Resource leaks:**
  connections, goroutines, files, temp state.
- **Call sites and contracts:** signature changes without updated callers;
  exported API, serialization, schema or config formats breaking existing
  consumers.
- **Performance:** hot-path regressions, O(n²), N+1, unbounded growth.
- **Dependencies:** each new dep — license, CVEs, pinning, needed at all.
- **Docs:** build/test/run/release changes reflected in README/docs;
  deleted code's docs deleted.
- **Fix at source:** a workaround for a shared defect in one place (a
  private client to get a timeout) when fixing the source is small →
  CONFIRMED "fix at source: <file:line>".
- **Project rules:** check added lines against `CLAUDE.md`/`AGENTS.md`
  rules; CONFIRMED by quoting rule and line. **Naming:** names must not lie.
  **CL hygiene:** reformat hunks mixed with behaviour; intermediate
  commits that don't build (spot-check only when cheap).

#### E. Tests

- **Coverage:** for each changed branch/query/condition, name the test that
  fails if it breaks. None, or only skipped ones → finding. Tests no longer
  matching behaviour → finding.
- **Scope:** every added/changed test function and every subtest/table
  case, plus every test in a touched test file whose subject overlaps.
- **Test gate** — each in-scope test answers all five; a missing answer is
  a finding: (1) what behaviour/contract it protects; (2) what credible
  regression fails it; (3) why the owner test (ONE per contract, strongest
  boundary) doesn't already; (4) does it need a seam no production caller
  uses; (5) is the expected value right by the **intent**, not the code (a
  test locking in a bad behaviour turns the bug into a contract).
- **Junk tests:** constant echo (asserts a tuning value); name/fixture
  promising more than it asserts; negative control passing for an
  unrelated reason; weak assertion (`> 0`, `!= nil`) where the value is
  computable; N tests with the same inputs each checking one field (merge
  into one table); wrong-layer test already covered at the owner;
  expected value computed by the code under test, or a mock implementing
  the asserted behaviour; test-only seam; assertion-free probes,
  self-comparisons, copied fixtures, source greps.
- **Retention bar:** keep a test that independently guards a public API,
  protocol, config, storage, security or user-facing default (a documented
  default is a contract; a tuning constant is not). "Static" or "slow" is
  not redundancy. A test finding is CONFIRMED with: name + location, what
  it can detect, the owner test that remains, what removing it unlocks.
  Missing field → "needs verification", except a duplicate pair in the
  overlap matrix, which is CONFIRMED on its own.

#### F. Comments and bloat

- **Comments:** an added comment says what the code does or why — nothing
  else. History/session references ("previously", "now does X", "fix
  for…", "unchanged from before") and comments contradicting their code →
  CONFIRMED by quoting. **Verbose:** restating code, narrating steps,
  essays where one line does, banners → CONFIRMED with the shortened
  version. Keep non-obvious *why*: business rules, gotchas, constraints.
- **Bloat** — every added line must be needed: single-use abstraction
  (prove the reference count); impossible-case handling (trace the guard);
  reinvented stdlib/dependency (name the function); reinvented in-repo
  subsystem (search the concept and open branches — a design finding);
  speculative knobs every caller sets the same; dead code (zero
  references); redundant intermediates; semantic duplication of a
  neighbour; code with no effect on output; unrequested scope. CONFIRMED
  only with the smaller replacement (or "delete lines X–Y") **and** proof
  it behaves the same. Taste is not a finding.

### Step 3b — Test overlap matrix

Per package, one row per in-scope test/subtest:
`test | entry point | inputs (fixture, stub, ctx, options) | fields asserted`

- Same entry point, equivalent inputs, different fields → CONFIRMED
  "duplicate invocations"; write the merged table.
- Inputs differing only by a value the package can't distinguish →
  CONFIRMED "same case twice".
- Name claims an outcome no assertion checks → CONFIRMED "name promises
  more than it asserts".

## Phase 2 — Verify each claim

One task per lead; trace the full path from the changed code to its
consumer; mark **CONFIRMED** (with proof), **FALSE POSITIVE** (with proof)
or **N/A** (dead/unreachable). One at a time.

1. Follow the call chain caller → callee; check the value really reaches
   the point of concern.
2. Check upstream guards before "panics if nil".
3. Check every call site before "this function is broken".
4. Trace data flow step by step, noting what each step guarantees.
5. Read the live code, not just the diff.
6. Check startup ordering (a blocking wait before `Start()` makes
   dependent code safe).
7. Check the method is called at all (`ffgrep`, `lsp_navigation
   references`).

Tools: `lsp_navigation` (references, definition), `ast_grep_search`,
`ffgrep`, `read` with offset/limit.

**Phase 2b — Re-derivation.** For each CONFIRMED issue, re-derive it from
the diff and cited lines only, not your earlier reasoning. Ask what guard,
caller or ordering kills it. Not re-derivable → FALSE POSITIVE (unproven).

**Phase 2c — Root cause.** Two or more confirmed issues stemming from one
design decision (where data lives, who owns a resource, sync vs async) →
one **design** finding (important) with them as evidence and the
alternative that removes them.

## Phase 3 — Report

Severity follows evidence: failing test > traced + guard-checked >
plausible pattern. **blocking** (correctness, security, data loss),
**important**, **nit**. A user-visible failure the user cannot recover from
(data loss, an operation that can never succeed, an error on every retry)
is at least important.

```
## Review: <branch>
Intent: [Step 1b]

### Design findings (N)
1. **[Decision]** — important. Causes: [#s]. Alternative: [design, in-repo example].

### Confirmed issues (N)
1. **[Title]** — [blocking|important|nit] (evidence: failing-test|traced) — file:line.
   Proof: [trace]. Repro: [for blocking]. Fix: [suggestion].

### False positives (N)
1. **[Title]** — thought X, traced Y → safe because Z.

### N/A (N)

### Bloat (N lines removable)
1. **[Title]** — file:lines. Proof. Replacement.
Comment density: X / Y added lines.

### Required artifacts
[the tables and cases from the Step 3 artifact list]

### Test audit
| test/case | 1. behaviour | 2. regression | 3. why not the owner | 4. seam? | 5. intent? |
Overlap matrix · Skipped (test → reason → covered elsewhere?) · LOC prod +A/−B, tests +C/−D

### Coverage
One row per Step 3 category and per area: ✅ / ⚠️ / ❌, with what was read.
Declined to judge: [items set aside, with reason; "none" is valid]
Done well: [1–3 items]

### Verdict: APPROVE | COMMENT | REQUEST CHANGES
### Grade: X/100
```

**Declined to judge** cannot hold an item with a concrete cost (failure,
load, data exposure, metric skew): confirm or refute it. A resource lead
(memory, size, time, connections) is refuted only by a measurement or a
bound on that same resource, never by an argument about another.
**Done well** items may not contradict any Step 3 rule — re-check them.

APPROVE = no confirmed blocking/important. COMMENT = nits only. REQUEST
CHANGES otherwise.

**Grading:** 100, minus 20 per blocking, 10 per important, 3 per nit, 2 per
bloat/verbose-comment/junk-test finding (bloat total capped at −15). Caps
after deductions: a line guarded only by a skipped test → 85; confirmed
security issue → 75; diff could be ≥40% smaller → 85; `test_blocked` → 80;
unresolved design finding → 85; any area or category ⚠️/❌ → 85. Score from
executable evidence first, traced findings second.

**Dismissal memory:** before Step 1, read project memory for refuted
hypotheses; don't re-report them unless the diff changed the facts. After
the report, persist new refuted hypotheses.

Credibility over volume: be honest about false positives.

## Examples

```
Claim: "Executor.Close() doesn't close mempool senders"
Trace: grep executor.Close() → 0 matches; never called.
Verdict: FALSE POSITIVE — dead method.

Claim: "drainChains removed the destination filter"
Trace: deposits for missing chains reach dispatchUpdates, no queue → dropped at Debug.
Verdict: CONFIRMED (nit) — deposits for permanently failed chains vanish silently.

Claim: "newRetryPolicy() is a single-use abstraction"
Trace: 1 caller (client.go:42), defaults only; MaxJitter/OnRetry never set.
Verdict: CONFIRMED (bloat) — inline a loop at client.go:42, delete retry.go (38 lines).

Claim: "TestRetrieveLexicalOnly_Live guards the lexical-only SQL"
Trace: go test -v with the DSN → SKIP (no chunks); siblings seed their own tenant.
Verdict: CONFIRMED — untested query; seed a chunk, assert the exact score.
```

## Constraints

- **Issues start in the diff; effects do not stop there.** Consequences in
  untouched code (triggers, readers, dashboards, pools, other services)
  are in scope and graded. Pre-existing bugs in untouched code are at most
  "pre-existing, out of scope" notes, never graded.
- **Never hand a lead to another area.** "Belongs to X" is not a verdict:
  trace it yourself. A lead you still set aside goes under "Declined to
  judge", where the orchestrator picks it up.
- **Never edit the reviewed tree** (read, bash, grep, LSP, ast-grep only).
- **Never report speculative bugs:** unproven → "needs verification".
- **No quota, either way:** report every CONFIRMED issue, never stop after
  a handful, never pad. Zero is a valid result. Group one pattern into one
  finding.
