---
name: pi-counsil
description: Multi-agent "council" workflow for implementing non-trivial coding features. 3 concurrent agents gather context by slice (each finding its own read/write files) and one merges it, 3 concurrent planners debate a plan to consensus (up to 3 rounds), one writer implements it, then 3 concurrent reviewers check quality with a fix loop (up to 3 rounds). Use for features where correctness and quality matter more than speed.
---

# Pi Counsil

A deliberative, multi-agent feature-implementation workflow. Instead of one agent
doing everything, a **council** of agents gathers, plans, debates, implements, and
reviews — with bounded loops that force convergence without endless cycling.

> You are the **parent orchestrator**. You drive every phase with `subagent(...)`
> calls. Child agents do the focused work; you keep decision authority and run the
> loops. Children must **not** run this skill or spawn their own subagents.

## When to use

Use pi-counsil for **non-trivial feature work** where you want high quality:

- New features spanning multiple files
- Refactors with real design tradeoffs
- Changes where regressions or edge cases are costly

**Do not use** for: trivial one-line fixes, pure questions, read-only research, or
when the user needs speed above quality. For those, use a single `scout`,
`worker`, or `reviewer` directly.

## Prerequisites

- The `pi-subagents` skill (or knowledge of the `subagent(...)` tool).
- These builtin agents: `context-builder`, `planner`, `worker`, `reviewer`. The
  `big-brain` agent is optional for hard reconciliations.

If any agent is missing, run `subagent({ action: "list" })` to check, or
`subagent({ action: "doctor" })` for diagnostics.

## Core principles

1. **You are the council chair.** You launch agents, read their outputs, judge
   consensus, apply fixes, and decide when to stop. Never hand the whole flow to
   one child.
2. **Single writer.** Only one agent ever edits code at a time — the `worker` in
   Phase 4, or you in Phase 6. Reviewers and planners are review/plan-only.
3. **Fresh context for independent thinkers.** Planners, reviewers, and the
   reconciler run with `context: "fresh"` so each forms an independent view from
   the shared files, not from your chat history.
4. **Bounded loops.** Both the planning-consensus loop and the review-fix loop run
   **at most 3 times**. After the cap, converge by executive decision or escalate
   to the user — never loop forever.
5. **Each agent finds its own files.** Do not pre-bake a file list for the
   children. In Phase 1 the three gatherers each discover the read/write files
   for their slice; downstream agents consume the merged `gather.md` as the file
   map and verify/extend it themselves. You provide the feature, constraints,
   and role — agents inspect the codebase. Never be the file authority yourself.

## Working directory

Pick a short `slug` from the feature (e.g. `add-rate-limiter`). All council
artifacts live under:

```
.pi/scratch/pi-counsil/<slug>/
├── gather/                        # Phase 1 parallel gather (3 agents)
│   ├── code-structure.md          #   code files to R/W, types, data flow
│   ├── tests-validation.md        #   test files to R/W, validation setup
│   └── external-docs.md           #   deps, APIs, external docs
├── gather.md                      # Phase 1 merged handoff (synthesis agent)
├── plans/
│   ├── minimal.md                 # Phase 2 plan A
│   ├── robust.md                  # Phase 2 plan B
│   └── architectural.md           # Phase 2 plan C
├── round-N/                       # dissent feedback for planning round N>1 (optional)
└── consensus.md                   # Phase 3 unified plan (reconciler)
```

> `.pi/scratch/` is project-local scratch space. Add `.pi/scratch/` to `.gitignore`
> if it is not already ignored. Never write council artifacts outside the project.

Set `WORK="{project root}/.pi/scratch/pi-counsil/<slug>"` and reuse it in every
task. Relative `output` paths resolve against the current working directory.

---

## The six phases

### Phase 1 — Gather (3 parallel agents + 1 synthesis)

Gather a shared factual baseline so the planners don't each rediscover the
basics. **File discovery is parallel and divided by concern** — no single agent
(not you, not one child) is the file authority. Each gather agent owns finding
the files to read/write in its slice; a synthesis agent then merges them into
`gather.md`, which downstream phases consume.

If the request is ambiguous (unclear goal, missing constraints, undefined
scope), **ask the user clarifying questions first** with `ask_user_question`.
Resolve scope, acceptance criteria, and non-goals before gathering.

**Step 1a — parallel gather.** Launch three `context-builder` agents with fresh
context and distinct slices. Each must find the files to READ and WRITE in its
area (cite exact paths + line ranges), follow imports/callers/tests/docs, and do
web research where its slice depends on external sources.

```typescript
const WORK = ".pi/scratch/pi-counsil/<slug>";

const GATHER_TASK = (slice, outputFile) =>
`You are the "${slice}" gatherer in a 3-way parallel gather. The other two
agents cover the slices you do NOT — stay in your lane and go deep.

Feature:
<feature>
<PASTE THE USER'S FEATURE REQUEST HERE, VERBATIM>
</feature>

Clarified requirements / constraints / non-goals (if any):
<LIST THEM, OR "none yet">

${GATHER_BRIEF[slice]}

You MUST discover and cite the exact files to READ and WRITE for your slice
(paths + line ranges), following imports/callers/tests/docs/config. Do web
research where your slice depends on external sources. Do not edit any code.
Write your slice handoff to ${outputFile}.`;

const GATHER_BRIEF = {
  "code-structure":   `CODE & IMPLEMENTATION SURFACE. Find the code files that
                       will be READ and WRITTEN to implement this feature:
                       entry points, key types/interfaces/functions, data flow,
                       call sites, config, and the likely edit targets. This is
                       the core "what code do we touch" map.`,
  "tests-validation": `TESTS & VALIDATION. Find the test files that will be READ
                       and WRITTEN: existing tests for the affected code, test
                       fixtures/helpers, test conventions, CI config, and how to
                       run build/test/lint. Map where new tests should go.`,
  "external-docs":    `EXTERNAL DEPS & DOCS. Find the external dependencies and
                       docs that matter: third-party libraries/APIs used by the
                       affected code, where they're imported, version
                       constraints, and current official docs/best practices
                       (web research). Map which deps constrain the design.`
};

subagent({
  tasks: [
    { agent: "context-builder", context: "fresh", output: `${WORK}/gather/code-structure.md`,
      outputMode: "file-only", task: GATHER_TASK("code-structure",   `${WORK}/gather/code-structure.md`) },
    { agent: "context-builder", context: "fresh", output: `${WORK}/gather/tests-validation.md`,
      outputMode: "file-only", task: GATHER_TASK("tests-validation", `${WORK}/gather/tests-validation.md`) },
    { agent: "context-builder", context: "fresh", output: `${WORK}/gather/external-docs.md`,
      outputMode: "file-only", task: GATHER_TASK("external-docs",    `${WORK}/gather/external-docs.md`) }
  ],
  concurrency: 3
});
```

**Step 1b — synthesis.** One `context-builder` reads the three slices and merges
them into a single handoff. It consolidates the per-slice file lists into one
`Files to Read` / `Files to Write` map and writes the unified meta-prompt. It
does NOT re-do discovery — the three gatherers already found the files.

```typescript
subagent({
  agent: "context-builder",
  context: "fresh",
  output: `${WORK}/gather.md`,
  outputMode: "file-only",
  task: `Merge three parallel gather slices into one unified handoff. The slices
already did the file discovery — consolidate, do NOT re-discover.

Slices to read:
- ${WORK}/gather/code-structure.md
- ${WORK}/gather/tests-validation.md
- ${WORK}/gather/external-docs.md

Produce the standard Context + Meta-Prompt format, and include a consolidated:
  ## Files to Read   (union of all slices' read files)
  ## Files to Write  (union of all slices' write files)
Write it to ${WORK}/gather.md.`
});
```

After synthesis returns, `read` the compact summary. If the gather surfaced
blocking open questions, resolve them with the user before planning.

**Lighter alternative:** for small features, collapse Phase 1 to a single
`context-builder` (the original one-agent gather) or use `scout`. Don't run
three gatherers for a one-file change. You can also swap the `external-docs`
slice to `researcher` when heavy web research is needed.

---

### Phase 2 — Plan (3 concurrent agents)

Launch **three planners in parallel**, each with a distinct angle. They all read
the same `gather.md` but must produce independent plans. Use `context: "fresh"`
and distinct `output` paths.

```typescript
const PLAN_TASK = (angle, outputFile) =>
`You are planner "${angle}" in a 3-planner council debating how to implement a feature.

Shared context: read ${WORK}/gather.md first, then inspect any additional code
you need to make your plan concrete.

YOUR ASSIGNED ANGLE — argue it forcefully but honestly:
${ANGLE_BRIEF[angle]}

Produce a concrete implementation plan (files to change, new files, ordered tasks,
acceptance criteria, risks). Name exact files. Prefer small actionable tasks.
If you disagree with the likely "obvious" approach, say so and propose your own.
${ROUND_FEEDBACK /* appended on rounds >1, see Phase 3 */}

Write your plan to ${outputFile}. Do not edit any code — planning only.`;

const ANGLE_BRIEF = {
  minimal:       `MINIMALIST. Find the smallest correct change: fewest files, least
                  surface area, the least clever mechanism that fully satisfies the
                  requirements. Challenge every "nice to have". Ask: are we over-building?`,
  robust:        `ROBUSTNESS. Hunt for failure modes, edge cases, concurrency, error
                  handling, input validation, security, and hidden quirks in the code
                  this touches. Ask: what breaks, and what does the minimal plan miss?`,
  architectural: `ARCHITECTURE. Optimize for fit with existing patterns, naming,
                  layering, test conventions, and long-term maintainability. Ask:
                  does this change belong here, and does it match how the codebase
                  already solves similar problems?`
};

subagent({
  tasks: [
    { agent: "planner", context: "fresh", output: `${WORK}/plans/minimal.md`,
      outputMode: "file-only", task: PLAN_TASK("minimal",       `${WORK}/plans/minimal.md`) },
    { agent: "planner", context: "fresh", output: `${WORK}/plans/robust.md`,
      outputMode: "file-only", task: PLAN_TASK("robust",        `${WORK}/plans/robust.md`) },
    { agent: "planner", context: "fresh", output: `${WORK}/plans/architectural.md`,
      outputMode: "file-only", task: PLAN_TASK("architectural", `${WORK}/plans/architectural.md`) }
  ],
  concurrency: 3
});
```

The three angles are deliberately adversarial: minimal vs. robust pull in
opposite directions, and architectural judges both against the codebase. This
tension is what makes Phase 3 meaningful.

---

### Phase 3 — Reconcile + consensus loop (≤ 3 rounds)

One **reconciler** reads all three plans and judges whether the council reached
consensus. Use `planner` (fresh) by default; use `big-brain` when the plans
genuinely conflict on hard architecture/correctness tradeoffs.

```typescript
subagent({
  agent: "planner",           // or "big-brain" for hard reconciliations
  context: "fresh",
  task: `You are the council RECONCILER. Read these three plans and reconcile them.

Plans to read:
- ${WORK}/plans/minimal.md
- ${WORK}/plans/robust.md
- ${WORK}/plans/architectural.md

Shared context: ${WORK}/gather.md

Step 1 — Judge consensus. Consensus means the three plans AGREE on the CORE
approach: the main files to change, the primary mechanism, and the scope — even
if they differ on details. Differing task ordering or minor naming is NOT a
failure of consensus. Differing core mechanism, scope, or risk acceptance IS.

Step 2 — Decide:
  (A) CONSENSUS REACHED → merge into one unified plan. Write it to
      ${WORK}/consensus.md. Include: goal, ordered tasks with exact files,
      acceptance criteria, risks, and validation steps.

  (B) NO CONSENSUS → do NOT write consensus.md. Instead return a DISSENT MAP:
      for each of the 3 planners, list the specific opposing arguments from the
      OTHER TWO that it must address. Be concrete: cite the disagreement
      (mechanism/scope/risk) and which plan holds which view.

Return inline (not a file) a verdict block as the FIRST thing in your response:

VERDICT: CONSENSUS | NO-CONSENSUS
`
});
```

**Loop control (you, the parent):**

- Parse the reconciler's `VERDICT`.
- **If `CONSENSUS`:** `read ${WORK}/consensus.md`, sanity-check it, and proceed
  to **Phase 4**.
- **If `NO-CONSENSUS` and the current round < 3:** take the reconciler's dissent
  map and re-run **Phase 2**, appending a `ROUND_FEEDBACK` block to each
  planner's task telling it the specific opposing arguments it must answer. For
  example, the minimalist gets the robust + architectural counter-arguments; the
  robustness planner gets the minimal + architectural ones; etc. Then re-run
  Phase 3.
- **If `NO-CONSENSUS` and round == 3 (cap reached):** do not loop again. Either
  - make an **executive decision**: pick the approach best supported by evidence,
    write `consensus.md` yourself, note the unresolved dissent inside it, and
    proceed; or
  - if the disagreement is a **product or architecture** choice you should not
    make alone, **ask the user** with `ask_user_question`, then proceed.

Track the round counter. The planning debate runs **at most 3 times**.

---

### Phase 4 — Implement (1 agent)

Hand the consensus plan to a single `worker`. It is the only writer. Give it the
plan path, the clarified requirements, and the validation expected.

```typescript
subagent({
  agent: "worker",
  context: "fresh",
  task: `Implement the approved council plan.

Plan (read it in full): ${WORK}/consensus.md
Shared context:        ${WORK}/gather.md

<feature>
<PASTE THE USER'S FEATURE REQUEST HERE>
</feature>

Clarified requirements / non-goals:
<LIST THEM>

Implement the smallest correct change that satisfies the plan. Follow existing
patterns. Do not add speculative scope. Run the project's build/test/lint to
validate (e.g. \`make build\`, \`make verify\`, or the existing test command; for Go
also run \`staticcheck\` and \`go vet\`). If you hit an unapproved product or
architecture decision, stop and report it instead of guessing.

Report back: files changed, validation run + results, and any open risks.`
});
```

After the worker returns, optionally stage or inspect the diff (`git diff`) so
the reviewers focus on the real change.

**Anti-anchor arm (high-risk features only).** If the feature is high-risk or
the council debated a close call, also spawn ONE `context: "fresh"` `worker`
with the raw feature request only — no `gather.md`, no `consensus.md` — in
parallel with the main worker (separate worktree or scratch dir). Compare its
approach against the consensus implementation before merging anything.
This guards against the council having talked itself out of the right design,
which is the documented failure mode of deliberative planning: an early
wrong-but-confident framing anchors every downstream step.

---

### Phase 5 — Review (3 concurrent agents)

Launch **three reviewers in parallel**, each with a distinct angle, fresh
context, and `output: false` (review-only — they must not edit). Each inspects
the actual diff/changed files directly.

```typescript
const REVIEW_TASK = (angle) =>
`Review the current uncommitted change (the diff) for the feature in
${WORK}/consensus.md. Inspect changed files directly with read/git-diff.

YOUR ASSIGNED REVIEW ANGLE — report only evidence-backed findings with file:line
references. Do not invent issues. Do not edit any files (review-only).
${REVIEW_BRIEF[angle]}

Output format:
## Review
- Correct: what is already good (with evidence)
- Blocker: critical issue that MUST be fixed before this ships
- Issue: real problem worth fixing now (file:line, why, suggested fix)
- Note: optional observation / follow-up
If everything is sound, say so plainly.`;

const REVIEW_BRIEF = {
  correctness: `CORRECTNESS & REGRESSIONS. Logic bugs, unhandled cases, broken
                callers, type errors, side effects, and anything that would
                regress existing behavior.`,
  validation:  `TESTS & VALIDATION. Are the changes covered by tests? Do new tests
                exist for the new behavior? Do build/tests/lint actually pass?
                Run the validation commands and report real results.`,
  quality:     `SIMPLICITY & QUALITY. Over-engineering, dead code, readability,
                consistency with codebase conventions, and whether the diff is
                minimal and focused. Flag anything a senior engineer would call
                sloppy.`
};

subagent({
  tasks: [
    { agent: "reviewer", context: "fresh", output: false, task: REVIEW_TASK("correctness") },
    { agent: "reviewer", context: "fresh", output: false, task: REVIEW_TASK("validation") },
    { agent: "reviewer", context: "fresh", output: false, task: REVIEW_TASK("quality") }
  ],
  concurrency: 3
});
```

Synthesize the three reviews into: **blockers**, **fixes worth doing now**,
**optional/defer**, and **ignore**.

---

### Phase 6 — Fix + re-review loop (≤ 3 rounds)

- **No blockers and no "fix now" issues:** candidate exit — but only a
  *candidate*. Confirm with a green run: build + tests + lint executed by you,
  decisive output lines recorded. A red suite reopens the loop with the
  failures as findings, regardless of reviewer synthesis. Reviews are
  opinion; the suite is ground truth.
- **Blockers or "fix now" issues found, and round < 3:** apply the fixes, then
  re-run **Phase 5**. Increment the round counter.
- **Stalled (two rounds, no new issues resolved):** before burning the last
  round on more polish, spawn one fresh-context `planner` with the stuck diff,
  the fixes already attempted, and `WORK/notes.md`, instructed: "the current
  approach keeps failing — propose a genuinely different approach". Spend the
  final round on that if it differs materially.
- **Issues remain at round == 3 (cap reached):** stop looping. Report remaining
  issues to the user with severity and a recommendation. Do not keep cycling.

Maintain `${WORK}/notes.md`, **rewritten** (never appended) after each round:
confirmed findings (fixed / open), refuted ones (with proof), approaches
tried, what remains. Cap ~800 words. Whatever you omit is gone — the next
round starts from curated memory, not the full report pile.

**Who fixes?** The user's design is that **the main agent (you) fixes it
directly** using your `edit`/`write`/`bash` tools — you have the full review
synthesis and the code in front of you. Keep each fix surgical and traceable to a
reviewer finding.

```text
// Pseudocode for the parent
round = 1
loop:
    run Phase 5 (3 reviewers)
    synthesize findings
    if no blockers and no fix-now issues:
        if validation green (output quoted): break   # done
        else: failures become findings; continue loop
    if round == 3: report remaining issues to user; break
    apply synthesized fixes directly (edit/write)  # or delegate to one worker
    round += 1
    goto loop
```

If a fix is large or risky, delegate it to a single `worker` instead of editing
inline (still one writer at a time). If a reviewer raised an **unapproved product
or architecture** concern, ask the user before changing scope.

---

## Finalize

Once review converges (or you've stopped at the cap):

1. Run the project's full validation yourself: `make build`, `make verify`, the
   test suite, and (for Go) `staticcheck` + `go vet`. Fix anything still red.
2. Confirm no debug/test scaffolding you wrote leaked into the diff.
3. Summarize for the user: what changed, which files, how it was validated, and
   any unresolved issues from a capped loop.
4. Optionally update docs/changelog if the project keeps them.

---

## Quick reference

| Phase | Agents | Context | Output | Loop cap |
|-------|--------|---------|--------|----------|
| 1 Gather | 3× `context-builder` (slices) → 1× `context-builder` merge | fresh | `gather/*.md` → `gather.md` | 1 |
| 2 Plan | 3× `planner` (minimal / robust / architectural) | fresh | `plans/*.md` | — |
| 3 Reconcile | 1× `planner` (or `big-brain`) | fresh | `consensus.md` + verdict | ≤3 rounds (2+3) |
| 4 Implement | 1× `worker` | fresh | code | 1 |
| 5 Review | 3× `reviewer` (correctness / validation / quality) | fresh | inline findings | — |
| 6 Fix + re-review | you (or 1× `worker`) + re-run Phase 5 | — | code | ≤3 rounds |

## Customization

- **Planner/reviewer angles:** the three angles above are defaults. Swap them to
  fit the domain (e.g. add a `security` reviewer for auth code, or a `perf`
  planner for hot paths). Keep them **distinct and adversarial**.
- **Models / thinking:** override per-agent via `subagents.agentOverrides` in
  `~/.pi/settings.json` (user) or `.pi/settings.json` (project), or inline with
  the `model` field on a task.
- **Loop caps:** 3 is the hard default. Lower them for speed, never raise past 3
  (that defeats convergence).
- **Reconciler model:** use `big-brain` instead of `planner` when the plans
  conflict on genuinely hard tradeoffs.
- **Single-agent fallback:** if a phase is trivial (e.g. the feature is tiny),
  skip the council and use one `worker` directly. Don't invoke the council for
  one-line changes.

## Constraints & gotchas

- **Children never run this skill.** Builtin agents have `inheritSkills: false`,
  so they won't inherit it — keep it that way. Don't paste orchestration logic
  into child tasks; give them their role-specific contract only.
- **Distinct output paths in parallel tasks.** Never let two concurrent agents
  write the same file. Use the `plans/*.md` layout.
- **`output: false` ≠ file-only.** `false` means no file at all. For large
  artifacts use `outputMode: "file-only"` with an `output` path; for review-only
  use `output: false`.
- **Fresh context needs persisted nothing.** `context: "fresh"` does not require
  a persisted parent session (unlike `fork`). Use fresh for all council children
  unless you specifically want a child to inherit your chat history.
- **One writer at a time.** Planners and reviewers are plan/review-only. Only the
  worker (Phase 4) and you (Phase 6) edit code.
- **Don't end on a question mid-loop.** If a loop needs a user decision, ask it;
  otherwise drive the loops to completion yourself.
