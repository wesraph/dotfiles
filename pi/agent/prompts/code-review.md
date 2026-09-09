---
description: Multi-agent code review of current changes — 5 parallel reviewers + per-issue confidence scoring, report in chat
argument-hint: "[focus-area]"
---

Run a multi-agent code review of the current changes (diff vs main/master, including uncommitted changes). Report in chat only. Never post to GitHub. Never edit code.

Optional user focus: ${ARGUMENTS:-none}

## Setup

1. Make a todo list: one task per phase below.
2. Resolve the current conversation model and the diff base:

```bash
echo "$PI_PROVIDER/$PI_MODEL"
BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)
echo $BASE
git diff $BASE --stat
git log --oneline $BASE..HEAD
```

- Remember MODEL (e.g. llamacpp/qwen3.8-27b) and BASE — every child task must include both, because children run in fresh context.
- If MODEL is empty, omit the model field from all subagent calls (children inherit the default).
- If git diff BASE is empty: say there is nothing to review and stop.

## Phase 1 — Eligibility

One fresh-context agent decides whether this change is worth a review:

```typescript
subagent({
  agent: "delegate",
  context: "fresh",
  model: MODEL,
  output: false,
  task: `Eligibility check for a code review.
Run: git diff <BASE> --stat and git log --oneline <BASE>..HEAD
Answer SKIP or PROCEED.
SKIP if the diff is trivial or automated: lockfiles, version bumps, generated files, renames-only, or no meaningful logic changes.
PROCEED otherwise, with a one-line reason.`
})
```

If SKIP, report the reason and stop.

## Phase 2 — Context (2 parallel agents)

```typescript
subagent({
  context: "fresh",
  concurrency: 2,
  tasks: [
    {
      agent: "delegate",
      model: MODEL,
      output: false,
      task: `List the project convention files relevant to reviewing git diff <BASE>: the root AGENTS.md and CLAUDE.md (if they exist), plus any AGENTS.md/CLAUDE.md in directories of files the diff touches. Run git diff <BASE> --name-only yourself. Return file paths only, no contents.`
    },
    {
      agent: "delegate",
      model: MODEL,
      output: false,
      task: `Summarize the change in git diff <BASE> (run it yourself): what it does, which components it touches, intended behavior. 5-10 lines.`
    }
  ]
})
```

## Phase 3 — 5 parallel reviewers

Launch 5 fresh-context reviewer agents in parallel (concurrency 5). Each runs git diff <BASE> itself. All are review-only: no edits, no writes, no builds, no tests, no typecheckers. Each returns a numbered list of issues — per issue: file:line, what is wrong, category (convention / bug / history / prior-review / code-comment), and the evidence — or "no issues".

Include these common rules in every reviewer task:

- Review only the changes in the diff (plus minimal surrounding context). Pre-existing issues on lines the diff did not touch are out of scope.
- Large, real issues only. No nitpicks, no style, no issues a linter/typechecker/compiler would catch (imports, formatting, types).
- Ignore things that look like bugs but are not, and issues explicitly silenced in code (lint-ignore comments).
- Changes that are likely intentional or directly related to the broader change are not issues.
- User focus (weight findings toward it): ${ARGUMENTS:-none}

The 5 angles (one task each):

1. Convention compliance — read the convention files listed in Phase 2 and check the diff against them. Only flag violations the file explicitly states.
2. Shallow bug scan — read the diff and look for obvious bugs: logic errors, wrong or inverted conditions, off-by-one, missing error handling in new code. Avoid reading extra context beyond the changes.
3. History context — git blame and git log -p on the changed lines. Flag bugs in light of history: reintroduced previously-fixed bugs, violated past decisions, invariants from commit messages.
4. Prior review context — find prior commits (and, only if gh is available and this is a GitHub repo, prior merged PRs via read-only gh commands) that touched the same files. Check whether their messages or comments flag concerns that also apply to this diff. Never post anything.
5. Code-comment compliance — read comments in the changed files (TODOs, invariants, doc comments, "do not" notes) and check the diff complies with them.

```typescript
subagent({
  context: "fresh",
  concurrency: 5,
  tasks: [
    { agent: "reviewer", model: MODEL, output: false, task: "Angle 1 (convention compliance): ...common rules... BASE=<BASE>" },
    { agent: "reviewer", model: MODEL, output: false, task: "Angle 2 (shallow bug scan): ...common rules... BASE=<BASE>" },
    { agent: "reviewer", model: MODEL, output: false, task: "Angle 3 (history context): ...common rules... BASE=<BASE>" },
    { agent: "reviewer", model: MODEL, output: false, task: "Angle 4 (prior review context): ...common rules... BASE=<BASE>" },
    { agent: "reviewer", model: MODEL, output: false, task: "Angle 5 (code-comment compliance): ...common rules... BASE=<BASE>" }
  ]
})
```

Fill each task with: the angle description above, the common rules, and BASE.

## Phase 4 — Confidence scoring (1 agent per issue)

Dedupe issues across the 5 reviewers (same file:line + same root cause = one issue). For each unique issue, launch one fresh-context scorer in parallel:

```typescript
subagent({
  context: "fresh",
  concurrency: 5,
  tasks: [
    // one entry per unique issue
    {
      agent: "delegate",
      model: MODEL,
      output: false,
      task: `Score this code-review issue. Diff scope: git diff <BASE> (run it yourself). Read the live code and trace the call chain before scoring.
Issue: <file:line, description, category, evidence from the reviewer>
Convention files: <paths from Phase 2>
Return a single integer 0-100 using this rubric verbatim:
0: Not confident at all. False positive that doesn't stand up to light scrutiny, or a pre-existing issue.
25: Somewhat confident. Might be real, might be false positive; you could not verify it. Stylistic issues not explicitly called out in a convention file score here.
50: Moderately confident. Verified real, but a nitpick or rare in practice; not very important relative to the rest of the change.
75: Highly confident. Double-checked; very likely real and will be hit in practice. The current approach is insufficient. Directly impacts functionality, or is directly mentioned in a convention file.
100: Absolutely certain. Double-checked; definitely real, happens frequently. Evidence directly confirms it.
For convention-file issues, verify the file actually calls out this specific issue.
Output: the score and one line of justification.`
    }
  ]
})
```

## Phase 5 — Filter + report

Drop every issue scoring below 80.

If none remain, report:

```
### Code review

No issues found. Checked for bugs, convention compliance, and history context.
(N issues filtered as low-confidence.)
```

Otherwise report in chat:

```
### Code review

Found N issues:

1. <brief description> (<category> — <one-line reason>)

<file>:<start>-<end> — <one-line proof from your trace>

2. ...
```

Rules:

- Cite every issue with file:line and a one-line proof (what you traced).
- Brief. No emojis.
- Never report an issue you could not trace to live code.
