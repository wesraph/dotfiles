---
name: pr-review
description: Check out a GitHub PR into a throwaway worktree, run fresh-context review passes (report-only — never edit, never commit), tell the user what's wrong, and on approval post the findings plus suggested fix diffs as a PR comment, then remove the worktree and quit. Use when the user asks to review a PR and comment on it (e.g. "review PR 42").
---

# PR Review

Full PR review lifecycle, hands-off: checkout → review loop → report → ask →
comment → cleanup → quit. The PR branch is **never modified**: no edits, no
commits, no pushes. Proposed fixes exist only as diffs inside the posted
comment.

## When to use

- "Review PR 42", "review and comment on this PR"
- Auditing someone else's PR without touching their branch

**Do not use** for: reviewing your own local branch (use `review-loop`), or
when the user wants fixes committed/pushed to the PR. This skill never writes
to the PR.

## Hard rules

- **Never edit, commit, or push anything in the PR worktree.** The tree stays
  byte-identical to the PR head. Build/test runs may create untracked
  artifacts — that's the only tolerated change, and the worktree is deleted
  anyway.
- **Review passes run only in fresh `reviewer` subagents** (same rule as
  `review-loop`). The main session orchestrates; it never reviews.
- The only write actions allowed: creating/removing the worktree + its local
  branch, writing `.pi/scratch/pr-review/<N>/`, and posting the comment
  **after explicit user approval**.
- Cleanup runs exactly once, at the end, on every exit path — comment posted
  or declined.

## Workflow

### Step 1 — Parse the PR

Accept a PR number, URL, or branch name from the user. Resolve metadata:

```bash
gh pr view <N> --json number,title,body,url,headRefName,baseRefName,author
```

The PR title and body feed the reviewer's intent model. If `gh` is missing or
unauthenticated, stop and tell the user — posting comments is a hard
requirement of this skill.

### Step 2 — Checkout into a worktree

Worktrees live under `./worktrees/` (house rule). Fetch the PR ref and create
a named local branch so cleanup can delete it:

```bash
git fetch origin pull/<N>/head
git worktree add -b pr-<N>-review ./worktrees/pr-<N> FETCH_HEAD
```

This works for same-repo PRs and forks alike. Never `gh pr checkout` in the
main worktree — the review must not touch the user's checkout.

Record the change surface for the reviewers:

```bash
cd ./worktrees/pr-<N>
git fetch origin <baseRefName>
BASE=$(git merge-base HEAD origin/<baseRefName>)
```

### Step 3 — Review loop (report-only)

Maintain `.pi/scratch/pr-review/<N>/notes.md` in the MAIN repo, rewritten
(never appended) after each pass: confirmed issues, refuted hypotheses (with
the proof that killed them), pass count.

Each pass: spawn one `reviewer` subagent with `context: "fresh"`
(synchronous). Its prompt contains ONLY:

- the worktree path and the change surface (`git diff $BASE..HEAD`),
- PR title + body (intent model input),
- prior passes' confirmed findings (to independently reconfirm or refute)
  and refuted hypotheses (so they aren't re-reported),
- the instruction to load and run `branch-review` verbatim:

  ```text
  read(/home/raph/.pi/agent/skills/branch-review/SKILL.md)
  ```

- two report-only additions: **never edit any file in the worktree**, and for
  every **CONFIRMED** issue include a **proposed fix diff** — a unified diff
  (or GitHub ```suggestion block when it maps to a single file+range of the
  PR) drafted against the live code, labeled as *suggested, not applied*.

Loop: after each pass, spawn the next fresh reviewer with updated notes.
Terminate when a pass surfaces **no new confirmed issues**, or at the cap of
**3 passes**. Fixes are never applied, so each pass is an independent
adversarial re-review of the same diff — the value is second and third
opinions converging, not convergence toward a fixed tree.

### Step 4 — Report to the user

Summarize in chat: intent model, confirmed issues (each with its proof and
severity), false positives/refuted leads, grade, verdict
(APPROVE / COMMENT / REQUEST CHANGES per `branch-review`'s rubric), and the
pass history (e.g. `4 → 5 (1 refuted) → 0 new`). State plainly when nothing
is wrong.

### Step 5 — Ask before posting

Compose the comment body into `.pi/scratch/pr-review/<N>/comment.md`:

- Header: PR title/number, verdict, grade, pass count.
- Per confirmed issue: title, severity, proof snippet, **suggested fix diff**.
- False positives worth mentioning (briefly), and a footer noting this is an
  automated review and the diffs are suggestions, not applied.

Then ask with the `ask_user_question` tool — one question:

> Post this review as a comment on PR #N?

Options: "Yes, post it" (attach the full comment body as the option's
`preview` so the user reads exactly what will be posted) / "No, skip".

### Step 6 — Post the comment

```bash
gh pr comment <N> --body-file .pi/scratch/pr-review/<N>/comment.md
```

If `gh` fails (often token scopes), fall back to the API — token from
`~/.config/gh/hosts.yml` (prefer `gho_` over `ghp_`):

```bash
curl -s -X POST "https://api.github.com/repos/<owner>/<repo>/issues/<N>/comments" \
  -H "Authorization: token <TOKEN>" \
  -H "Accept: application/vnd.github+json" \
  -d @<(jq -Rs '{body: .}' .pi/scratch/pr-review/<N>/comment.md)
```

Verify the response contains an `html_url` and show it to the user. If
posting fails on both channels, do NOT clean up silently — show the error,
keep the comment file, and let the user retry.

### Step 7 — Cleanup and quit

On every exit path after Step 5 (posted or declined):

```bash
git worktree remove --force ./worktrees/pr-<N>
git branch -D pr-<N>-review
```

Then call the `quit` tool (reason: `PR #<N> review done`). Exception: if the
user has given other tasks in this session in the meantime, ask before
quitting instead of quitting blindly.

## Constraints

- Zero writes to the PR worktree. If a fix seems too good to keep to
  yourself, it goes in the comment as a diff — nowhere else.
- One loop at a time, one reviewer per pass, always fresh context.
- Never post without the explicit Step 5 approval. Never re-ask after a
  "No" — the report stays in the chat.
- The worktree's uncommitted-artifact tolerance (Step 2 of `branch-review`
  runs builds/tests) is not a license to fix anything.
