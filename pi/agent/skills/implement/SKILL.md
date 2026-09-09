---
name: implement
description: Full feature-implementation pipeline with adversarial quality gates. Scout the code, analyze the approach (existing libs, testability, behavior impact), stress-test the idea through a 3-critic council until unanimous agreement, implement with tests, then loop graded reviews (side-effects, necessity, scope, library fit) — each backed by proof — fixing until every score is at least 98/100. Use for non-trivial features where correctness and minimalism matter.
---

# Implement

A staged pipeline: **scout → analyze → council → implement → review loop**.
You (the parent) are the sole orchestrator and the sole code writer. Subagents
gather, criticize, and grade — they never edit code.

## When to use

- New features or non-trivial changes where design choices and regressions matter
- Any task invoked via `/implement`

**Do not use** for: trivial one-liners, pure questions, read-only reviews
(use `branch-review`), or debugging a known failure (use `debug`).

## Prerequisites

- Builtin agents: `scout`, `reviewer`. Check with `subagent({ action: "list" })`.
- Children must NOT run this skill or spawn their own subagents. You drive every
  `subagent(...)` call.

## Working directory

Pick a short `slug` from the feature. All artifacts live under:

```
.pi/scratch/implement/<slug>/
├── scout.md              # Phase 1 handoff (if run)
├── analysis.md           # Phase 2 answers
├── idea-r1.md            # idea as submitted to council round 1
├── council-r1/           # per-critic verdicts per round
│   ├── correctness.md
│   ├── necessity.md
│   └── integration.md
├── consensus.md          # final agreed idea (council passed)
└── review-r1/            # graded reports per review round
    ├── side-effects.md
    ├── necessity.md
    ├── unrelated-changes.md
    └── library-fit.md
```

Never write artifacts outside the project directory.

## Loop safety (hard rule)

Every loop has a cap: **council ≤ 4 rounds**, **review ≤ 5 rounds**. On cap,
STOP and escalate to the user with `ask_user_question`: show the remaining
disagreements / sub-98 scores, the blocking findings, and ask whether to keep
looping, accept as-is, or take over manually. Never loop forever; never
silently give up.

---

## Phase 0 — Restate the request

Rewrite the user's request as a precise spec: goal, inputs/outputs, acceptance
criteria, non-goals, and every assumption you are making. If anything material
is ambiguous (scope, expected behavior, edge cases), ask the user NOW with
`ask_user_question` — later phases are expensive to redo.

Create a task list with one task per phase.

## Phase 1 — Scout (only if needed)

Spawn `scout` **only if** you cannot already name the exact files, functions,
and call sites this feature touches from the current session. If you can, skip
to Phase 2 and write what you know into `analysis.md` sources.

```typescript
subagent({
  agent: "scout",
  context: "fresh",
  output: `${WORK}/scout.md`,
  outputMode: "file-only",
  task: `Recon for this feature request (do NOT edit code):

<feature>
<PASTE THE RESTATED SPEC>
</feature>

Find and cite (paths + line ranges):
1. The code this feature touches: entry points, types, functions, call sites
2. Existing tests for that code + the project's test conventions and commands
3. Libraries already in the dependency tree that overlap with this feature
4. Any code that already does something similar (reusable patterns/helpers)
Write the handoff to ${WORK}/scout.md.`
});
```

Then `read` the handoff.

## Phase 2 — Analyze (you, before any council)

Answer these questions in `${WORK}/analysis.md`, citing file:line evidence from
the scout handoff or your own reads — never guesses:

1. **Is this the right way?** Sketch the approach. What's the simplest mechanism
   that satisfies the spec? What alternatives exist in the codebase already?
2. **Is there a lib we already use that could do this?** Search the dependency
   tree (go.mod / package.json / imports). Stdlib and already-imported deps
   always beat new ones.
3. **Is there a lib worth importing?** Only if (1) and (2) come up short AND the
   problem is genuinely hard (parsing, crypto, protocols). Name it, its license,
   and what it replaces. Default answer is "no".
4. **How do we test this?** Identify the test seam: can the logic be isolated
   behind an interface/function so tests don't need network, DB, or Twilio?
   If the current design isn't testable, redesign until it is.
5. **Does this modify existing behavior?** List every behavior change beyond the
   feature itself (signatures, defaults, error paths, call sites). Each one must
   be justified or designed away.

Write `${WORK}/idea-r1.md`: the implementation idea derived from these answers
(approach, files to touch, new tests, libs, behavior changes, test plan).

## Phase 3 — Council (3 critics, loop to unanimous agreement)

Launch **3 fresh-context `reviewer` agents in parallel**, each with a distinct
attack angle. Their job is to BREAK the idea, not to praise it.

```typescript
const CRITIC_TASK = (angle, outputFile) =>
`You are critic "${angle}" on a 3-critic council. Your mission: try to BREAK
this implementation idea. Finding nothing wrong is a valid outcome only after
genuine effort.

Idea: read ${WORK}/idea-rN.md
Evidence: ${WORK}/scout.md and ${WORK}/analysis.md (if they exist), plus any
code you need to read in the repo.

YOUR ANGLE:
${ANGLE[angle]}

Rules:
- Every claim needs PROOF: file:line, a traced call chain, or a concrete
  failure scenario. No speculative "might be slow" without evidence.
- You may not edit code. Analysis only.

Verdict format — your response MUST end with:

VERDICT: AGREE | DISAGREE
REASONS: <if DISAGREE, numbered blocking criticisms; if AGREE, residual
non-blocking notes or "none">

Write your report to ${outputFile}.`;

const ANGLE = {
  correctness: `Correctness & edge cases. Attack: broken invariants, error
                paths, concurrency/races, nil/zero-value handling, resource
                leaks, off-by-one, protocol/format mismatches.`,
  necessity:   `Necessity & simplicity. Attack: overkill, speculative
                abstractions, code that exists "for later", reinvented wheels
                (stdlib or existing dep already covers it), unnecessary new
                dependencies.`,
  integration: `Integration & compatibility. Attack: silent changes to existing
                behavior, broken call sites, violation of codebase patterns,
                testability gaps (is the test seam real?), wrong library
                choice for this codebase.`
};

subagent({
  context: "fresh",
  concurrency: 3,
  tasks: [
    { agent: "reviewer", task: CRITIC_TASK("correctness", `${WORK}/council-rN/correctness.md`),
      output: `${WORK}/council-rN/correctness.md`, outputMode: "file-only" },
    { agent: "reviewer", task: CRITIC_TASK("necessity",   `${WORK}/council-rN/necessity.md`),
      output: `${WORK}/council-rN/necessity.md`,   outputMode: "file-only" },
    { agent: "reviewer", task: CRITIC_TASK("integration", `${WORK}/council-rN/integration.md`),
      output: `${WORK}/council-rN/integration.md`, outputMode: "file-only" }
  ]
});
```

**Loop control (you):**

- Parse all three `VERDICT:` lines.
- **All 3 AGREE** → copy the final idea to `${WORK}/consensus.md` and proceed
  to Phase 4.
- **Any DISAGREE** → you (not a subagent) revise the idea: address every
  blocking criticism — either change the design or rebut it with proof in the
  idea document itself. Write `${WORK}/idea-r(N+1).md` and resubmit all three
  critics, including in each task a short digest of the round-N criticisms it
  raised and how the new revision answers them.
- Round count > 4 → escalate (see Loop safety).

A criticism you can rebut with proof is resolved; one you can't is a design
change. Never paper over a blocking criticism to force agreement.

## Phase 4 — Implement (you, single writer)

1. Implement the feature exactly per `consensus.md`. You write all code.
2. Write tests for the new behavior using the project's existing test
   conventions and the test seam from the analysis. Include edge cases the
   council confirmed.
3. Run the project's validation until green:

   ```bash
   make build    # if target exists
   make test     # or the project's test command
   make verify   # if target exists
   ```

4. All tests pass → Phase 5. Any test failure → fix, re-run. Do not enter the
   review phase with red tests.

## Phase 5 — Review loop (4 graders, fix until all ≥ 98/100)

Launch **4 fresh-context `reviewer` agents in parallel**, one per question.
They grade the **current diff** and must return proof, not opinions.

```bash
# Reviewers need the diff surface; capture it first
git diff $(git merge-base HEAD main 2>/dev/null || echo HEAD~1)..HEAD --stat
git diff                       # plus uncommitted changes, if any
```

```typescript
const REVIEW_TASK = (question, outputFile) =>
`You are grader "${question}" in a 4-grader review panel. You review ONLY the
current changes of this feature (diff scope above); read the live code around
every hunk before judging.

YOUR QUESTION — answer it with evidence:
${QUESTION[question]}

Rules:
- Every finding needs PROOF: file:line + the traced call chain or code snippet
  that demonstrates it. No speculative findings — if you cannot prove it,
  don't report it.
- You may not edit code. Review only.

Response format — your response MUST start with:

SCORE: <0-100>/100

Then numbered findings (if any), each as: SEVERITY | file:line | claim | PROOF |
suggested fix. Score 98-100 means: proven findings are at most trivial nits.
Score what you can prove, not what you suspect.

Write your report to ${outputFile}.`;

const QUESTION = {
  "side-effects":     `Does this code have unexpected side effects? Any code
                       smells (dead code, shadowing, leaked resources, races,
                       swallowed errors)?`,
  "necessity":        `Is all of this code necessary and not overkill? Flag
                       speculative abstractions, redundant variables, comments
                       that are too verbose or restate the code, anything that
                       could be deleted with no behavior change.`,
  "unrelated-changes":`Does the diff change behavior UNRELATED to this feature?
                       For every unrelated change: is it strictly necessary?
                       Unnecessary drive-by changes are findings.`,
  "library-fit":      `If a library is used (new or existing): is it the right
                       one? Could stdlib or code already in this repo replace
                       it? Flag redundant new dependencies and reinvented
                       wheels.`
};

subagent({
  context: "fresh",
  concurrency: 4,
  tasks: [
    { agent: "reviewer", task: REVIEW_TASK("side-effects",      `${WORK}/review-rN/side-effects.md`),
      output: `${WORK}/review-rN/side-effects.md`,      outputMode: "file-only" },
    { agent: "reviewer", task: REVIEW_TASK("necessity",        `${WORK}/review-rN/necessity.md`),
      output: `${WORK}/review-rN/necessity.md`,        outputMode: "file-only" },
    { agent: "reviewer", task: REVIEW_TASK("unrelated-changes", `${WORK}/review-rN/unrelated-changes.md`),
      output: `${WORK}/review-rN/unrelated-changes.md`, outputMode: "file-only" },
    { agent: "reviewer", task: REVIEW_TASK("library-fit",       `${WORK}/review-rN/library-fit.md`),
      output: `${WORK}/review-rN/library-fit.md`,       outputMode: "file-only" }
  ]
});
```

**Loop control (you):**

1. Parse the four `SCORE:` lines. Record them.
2. **All ≥ 98** → done. Run the full validation once more (`make test`,
   `make verify` if they exist), then report the final scorecard to the user.
3. **Any score < 98** → **you** write the fixes for every proven finding from
   all four reports. A finding you believe is a false positive must be rebutted
   in writing (with proof) inside the round's fix notes — not silently ignored.
   Re-run tests, then launch round N+1 with the same four graders, including
   your fix notes and rebuttals so graders can re-judge in context.
4. Round count > 5 → escalate (see Loop safety).

The loop exits ONLY on all-≥98 scores, user intervention, or the cap.

## Final report

```
## Implement: <feature>

Phases: scout <skipped|done> · analysis · council <N rounds> ·
implementation · review <N rounds>

### Final scores
| Grader            | Score |
|-------------------|-------|
| side-effects      | x/100 |
| necessity         | x/100 |
| unrelated-changes | x/100 |
| library-fit       | x/100 |

### Validation
<exact test/build commands run + decisive output lines>

### Changes
<files touched, one line each>

### Council escalations / unresolved notes (if any)
```

## Constraints

- **Single writer.** Only you edit code. Subagents read, criticize, grade.
- **Proof or silence.** Every reported finding, from you or a child, carries
  file:line evidence or a traced scenario. Speculative findings are discarded.
- **Never enter Phase 5 with failing tests.** Never declare done with a score
  below 98 without explicit user sign-off.
- **Respect the caps.** Council ≤ 4 rounds, review ≤ 5 rounds, then escalate.
- Keep a task list current: one task per phase, marked in_progress/completed
  as you go; add a task per proven review finding during fix rounds.
