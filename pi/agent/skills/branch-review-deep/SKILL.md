---
name: branch-review-deep
description: The thorough branch-review variant - same hypothesize-then-verify workflow, plus mutation testing that proves every test kills the regression it claims. Slow. Use when merging critical branches or auditing test quality; use branch-review for everyday reviews.
---

# Branch Review (Deep)

`branch-review` plus mutation testing: every guard the branch adds, and every
test, is proven by injecting mutants in a throwaway worktree. Use it when test
quality matters as much as code correctness (critical branches, test-suite
audits, pre-release). It roughly doubles the review time; for everyday reviews
use `branch-review`.

## How to run

1. Read `/home/raph/.pi/agent/skills/branch-review/SKILL.md` and follow its
   whole workflow, report format, grading rubric and constraints. All of it
   applies here.
2. Apply the additions below on top of it. Where they conflict, this file wins.

## Additions

### Mutants are the only allowed code change

The reviewed tree is still never edited. Mutants live only in the throwaway
`./worktrees/review-mutants` worktree, removed at the end of Phase 2m.

### Phase 2m — Mutation check

Runs after Phase 2 (verify each claim) and before Phase 2b (re-derivation).
Surviving mutants are CONFIRMED issues and go through Phase 2b and Phase 2c
like any other.

Prove each test catches the regression it claims. For every fix or guard the
branch adds, and the test(s) claimed to cover it:

1. `git worktree add ./worktrees/review-mutants HEAD` — never mutate the
   reviewed tree.
2. Inject ONE mutant from the operator set (PIT/Stryker defaults): negate a
   conditional (`==`↔`!=`), boundary flip (`<`↔`<=`), logical swap (`&&`↔`||`),
   boolean literal flip, empty string literal, return-value tampering
   (zero-value/`nil`/`false`), block-body removal, side-effect call deletion,
   constant tweak — or revert the whole fix.
3. Run only the claimed test(s). It must fail **for the intended reason** —
   read the failure message, not just the exit code.
4. `git -C ./worktrees/review-mutants checkout -- .`, next mutant.
5. When done: `git worktree remove --force ./worktrees/review-mutants`.

A surviving mutant is CONFIRMED: "test X passes without Y". Cap at ~20
mutants per pass A, focused on new branches, conditions, and queries.

Run the mutants in two directions:

- **A — per guard**: every new branch, condition, query, and constant has at
  least one test that fails.
- **B — per test**: every in-scope test AND subtest/table case names the
  mutant it exists to kill (its gate answer 2). Run ONLY that test with the
  mutant: `go test -run '^TestX$/^case_name$'` (or the project's
  equivalent). A test that stays green is CONFIRMED junk, even when another
  test catches the same mutant — it is a negative control passing for an
  unrelated reason, or its name promises more than it asserts. "Some test
  failed" in pass A never vouches for the other tests that claim the same
  guard. No cap on pass B: one run per in-scope test/case.

  The named mutant must pass two checks, or the row has no mutant:
  - **Credible**: it is a mistake a developer could plausibly write in that
    exact code — the pre-fix code, a reordered return, a dropped guard, a
    flipped condition. A degenerate mutant does not count: one that wraps a
    nil error (`%!w(<nil>)`), returns a value no code path could produce,
    or breaks the function in a way any test would catch. For a guard the
    branch adds, the credible mutant is removing or reordering that guard.
  - **Unique kill**: run the row's mutant against its SIBLING rows and the
    owner test too. If any of them also fails on it, and the row kills no
    other credible mutant they miss, the row is redundant → CONFIRMED
    "duplicate invocations"; fix = delete the row (name the sibling that
    keeps the guard). A row survives only by killing at least one credible
    mutant that nothing else in scope kills.

  Record both in the Test gate table: the mutant, why it is credible, and
  which rows/tests also kill it.

**Classify every non-killed mutant** — they are not the same finding:

- **survived** — code covered, assertion missing → "untested: <line>".
- **no coverage** — mutant never executed → the behavior has no test path at
  all; worse, and a different fix.
- **timeout** — counts as caught (CI would hang).
- **suppressed** — logging-only lines and behavior-identical (equivalent)
  mutants: skip them and say why. Most raw mutants are noise; spend the
  budget on logic lines.

**Survivor remediation, both options always:** (A) the test that kills it,
(B) the code simplification that removes the mutation axis. Equivalent
mutant (the mutant IS the simpler form) → apply it to the source. Unkillable
= no test can kill it AND the mutant can't be applied — say so explicitly.

**Before writing the finding, check why it survived:** only one branch value
tested; collection has one element; test data uses identical values where
the code distinguishes; default parameter never exercised (every test passes
it explicitly). The cause is the fix.

**Anti-cheat:** never recommend deleting a mutation axis (syntax rewrite)
when the expression lacks coverage — hiding the axis is not proving
correctness.

**Fix suggestions that add a test must be red-green proven**: run the
suggested test against the mutant worktree (fix reverted) — it must fail for
the intended reason, or don't suggest it.

### Test audit changes

- **Retention bar**: a CONFIRMED test finding must also name the mutant it
  caught or missed (Phase 2m). Besides the duplicate row pair in the overlap
  matrix, a test (or subtest) that survives its own mutant (Phase 2m, pass B)
  is CONFIRMED on its own.
- **Test gate table**: add three columns after the base ones:

  ```
  | own mutant (pass B): killed? | credible? why | also killed by (must be none) |
  ```

- **Report, Test audit section**: add the line
  `Mutants: N injected / K caught / S survived → [survivors: test X passes without Y]`.

### Grading changes

- Extra cap: a surviving mutant on changed code → **85**.
- Score from executable evidence first (suite result **and mutants**), traced
  findings second, everything else last.

### Example

```
Claim: "TestRetrieveLexicalOnly_Live guards the lexical-only SQL"
Trace: go test -v with RAG_TEST_DSN → --- SKIP (no chunks in DB). Siblings
       seed their own tenant. Mutant "always run vector query" in
       ./worktrees/review-mutants → every test passes.
Verdict: CONFIRMED — lexical-only query is untested; the live test must seed
         its own chunk and assert the exact score (1/61 lexical, 2/61 both).
```
