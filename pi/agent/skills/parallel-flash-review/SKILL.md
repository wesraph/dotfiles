---
name: parallel-flash-review
description: Review a git branch or repo by fanning out 5-10 glm-5.3-flash subagents. Same process as branch-review - hypothesize issues from the diff, then verify each claim by tracing the full call chain before reporting. Use before merging PRs or branches, or for repo-wide audits.
---

# Parallel Flash Review

A fan-out variant of **branch-review**: identical process (**hypothesize → verify →
report**), but 5-10 cheap, fast `glm-5.3-flash` subagents do the legwork in
parallel while the parent orchestrates. Never reports a claim that a subagent
hasn't proven — and the parent spot-checks every CONFIRMED verdict itself.

## When to use

- Reviewing a branch before merge (same cases as branch-review)
- Auditing a whole repo (no diff — see "Repo mode" below)
- When you want breadth: many eyes on many angles for low cost

**Do not use** for: implementing features, writing tests, or debugging runtime
behavior. This is a static review skill only. If you need one strong reviewer
instead of many fast ones, use `branch-review` directly.

## Hard model rule

Every subagent in this skill runs **`zai-renaud/glm-5.3-flash`** — set
`model: "zai-renaud/glm-5.3-flash"` on every task. No exceptions, no
inheritance. The parent keeps its own model for orchestration and synthesis.

## Workflow

You are the **parent orchestrator**. Children do focused read-only work; you
capture the diff, run builds, dedupe, audit verdicts, and write the report.
Children must not spawn subagents.

### Phase 0 — Scope

Determine what is under review:

**Branch mode** (default):

```bash
BRANCH=$(git branch --show-current)
BASE=$(git merge-base $BRANCH main || git merge-base $BRANCH master)
git diff $BASE..HEAD --stat    # scope
git log --oneline $BASE..HEAD  # commit list
```

**Repo mode** (no base branch / user said "review this repo"): the change
surface is the repo itself. List files grouped by subsystem
(`git ls-files`), excluding vendored/generated/test fixtures from *priority*.
Review focus = live logic files.

Run build/lint yourself (real failures are confirmed issues, no verification
needed):

```bash
make build   # if Makefile exists
make verify  # if Makefile exists
```

Sizing rule for the hypothesis wave (5-10 agents):

| Diff size | Agents |
|-----------|--------|
| < 500 changed lines | 5 (core angles) |
| 500-2000 changed lines | 7 (core + 2 extended) |
| > 2000 changed lines or repo mode | 10 (all angles) |

### Phase 1 — Hypothesize (fan out 5-10 flash agents)

Launch fresh-context `reviewer` agents, one per angle, all on
`zai-renaud/glm-5.3-flash`. The **core 5 angles** (always used):

1. **Concurrency** — data races, missing locks, lock ordering, TOCTOU
2. **Resource leaks** — unclosed connections, goroutines, files, temp state
3. **Nil/missing guards** — removed nil checks, ignored bool/error returns
4. **Behavior changes** — removed filters, changed error handling, altered semantics
5. **Call-site breakage** — signature changes without updated callers
6. **Sloppy code/comments** - code that is not required, comments that are too verbose
7. **Bad tests** - Tests that are testing nothing, that don't show anything

**Extended angles** (add up to 10 total):

6. **Test coverage** — new logic without tests, tests that no longer match behavior
7. **Boundary conditions** — off-by-one, zero/empty/nil inputs, max values
8. **Error paths** — swallowed errors, wrong wrap/annotate, partial-failure states
9. **Contract/API consistency** — serialization, config/schema compat, exported signatures
10. **Performance** — hot-path regressions, accidental O(n²), unbounded growth

For **repo mode**, replace or blend angles with subsystem splits (one agent per
subsystem group) so every logic file has an owner.

Launch shape:

```typescript
subagent({
  tasks: [
    { agent: "reviewer", model: "zai-renaud/glm-5.3-flash", output: false,
      task: "<hypothesizer prompt for angle 1>" },
    { agent: "reviewer", model: "zai-renaud/glm-5.3-flash", output: false,
      task: "<hypothesizer prompt for angle 2>" }
    // ... one per angle
  ],
  concurrency: 5,
  context: "fresh"
})
```

**Hypothesizer prompt template** (fill in per angle):

```
Goal: hypothesize potential issues of category <ANGLE> in the diff
<BASE>..HEAD of this repo (cwd: <repo path>). Read-only review — never edit.

Context: run `git diff <BASE>..HEAD --stat` for scope, then read the diff
for the files relevant to your angle (prioritize logic over tests). Read the
live files around changed hunks — the diff shows what changed, not what exists.

Success criteria: a list of 0-5 candidate issues. Issues are LEADS, not
verdicts — do not claim anything is confirmed. 0 issues is a valid result.

For each issue report:
- WHAT: file:line, old → new
- WHY: the concrete scenario that breaks
- TRACE: the call chain / data flow a verifier should follow
- CONFIDENCE: high | medium | low

Hard constraints: no edits, no subagents, no speculative "might" issues —
every issue must name a concrete failure scenario. Stop after covering the
changed files once; do not enumerate the whole repo.
```

**Parent synthesis:** collect all issues, dedupe overlaps, drop ones with no
concrete scenario. Target 3-15 candidate issues (branch-review's quality bar:
quality over quantity). If more, keep highest-confidence per file.

### Phase 2 — Verify (fan out flash verifiers)

Create a **task list** (one task per issue). Batch issues into at most
min(N_issues, 10) groups — group by file/subsystem so each verifier has local
context. Launch verifiers in parallel, all `zai-renaud/glm-5.3-flash`:

```typescript
subagent({
  tasks: [
    { agent: "reviewer", model: "zai-renaud/glm-5.3-flash", output: false,
      task: "<verifier prompt with issue batch 1>" }
    // ... one per batch
  ],
  concurrency: 5,
  context: "fresh"
})
```

**Verifier prompt template:**

```
Goal: verify each candidate issue below by tracing the ACTUAL code path.
Read-only — never edit. Repo cwd: <repo path>.

Issues:
<issue list: WHAT / WHY / TRACE / CONFIDENCE for each>

For each issue, mark exactly one verdict:
- CONFIRMED — real, with proof: quoted lines (file:line) showing the full
  chain from change to breakage
- FALSE POSITIVE — doesn't materialize, with proof: the guard, call site,
  or ordering that prevents it
- N/A — dead code / unreachable path, with proof

Verification rules (follow all):
1. Trace the call chain caller → callee; verify the value reaches the point
   of concern. Don't assume.
2. Check upstream guards before claiming nil/missing panics.
3. Check ALL call sites before claiming a function is broken.
4. Read live code, not just the diff — a removed check may be replaced by an
   earlier guard.
5. Check startup/ordering guarantees that make the concern unreachable.
6. Check whether the method is even called (grep references).
7. No proof → verdict is FALSE POSITIVE with "unproven" noted, never CONFIRMED.

Output per issue: verdict, 2-6 line proof trace with file:line citations.
Hard constraints: no edits, no subagents, one verdict per issue.
```

Process the task list as batches complete: mark each task `completed` with its
verdict.

**Parent audit (mandatory):** flash models are cheap but error-prone. Before
reporting, you personally re-check **every CONFIRMED verdict** by reading the
cited lines and following the cited chain. Downgrade to FALSE POSITIVE any
verdict whose proof doesn't hold. Sample 1-2 FALSE POSITIVE verdicts per batch
for trust calibration; if a batch's verifications look sloppy, re-run that
batch's CONFIRMED claims through a second verifier.

### Phase 3 — Report

Same format as branch-review:

```
## Review: <branch | repo>

### Confirmed Issues (N)
1. **[Title]** — file:line. Proof: [trace]. Fix: [suggestion].

### False Positives (N)
1. **[Title]** — thought X, but traced Y → safe because Z.

### N/A (N)
1. **[Title]** — dead code / unreachable.

### Agent fan-out: N hypothesizers + M verifiers (all glm-5.3-flash)

### Grade: X/100
```

Be honest about false positives. Credibility matters more than finding issues.
A review with 0 confirmed issues is a valid result.

## Constraints

- **Never edit code.** You and every child are read-only. Children use
  `read`, `bash` (read-only git/grep), `ffgrep`, `lsp_navigation`,
  `ast_grep_search` — never `edit` or `write`.
- **5-10 subagents per wave, all `zai-renaud/glm-5.3-flash`.** Hypothesis wave
  sized by the table above; verification wave batched to ≤ 10.
- **Never report speculative bugs.** No CONFIRMED without proof, and no report
  entry you haven't audited yourself.
- **Children get fresh context** (`context: "fresh"`), distinct angles/batches,
  and never spawn their own subagents.
- **One task list, kept current.** One task per issue; verdict recorded on
  completion.
- **Quality over quantity.** 0 confirmed issues is a valid outcome; don't
  push flash agents to invent findings.
