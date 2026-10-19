---
name: branch-test
description: Test the functionalities added on the current branch, end-to-end. Lists every new feature from the branch diff, verifies each one live via a task list (CloakBrowser MCP for web UIs, bash for CLIs, curl for APIs), and reports a working/broken table with evidence. Use after implementing a feature branch to prove it actually works before commit, PR, or merge.
---

# Branch Test

Three phases: **enumerate** what the branch adds, **verify live** each
functionality one at a time (task list), **report** a table of what works.

Core principle: verdicts come from **observed behavior**, never from reading
code. "Looks right in the diff" is not a result. Every ✅ needs something you
saw — snapshot text, HTTP status, command output, screenshot.

## When to use

- A feature branch is implemented and needs proof the features work
- Before opening a PR / merging: smoke-check the user-visible behavior
- User asks "does my branch actually work?"

**Do not use** for: code review (`branch-review`), PR commenting (`pr-review`),
or mutation coverage (`branch-review-deep`). This skill is report-only — it
never fixes. Fixes are a follow-up; rerun after fixing to confirm.

## Phase 1 — Enumerate functionalities

```bash
BRANCH=$(git branch --show-current)
BASE=$(git merge-base $BRANCH main || git merge-base $BRANCH master)
git log --oneline $BASE..HEAD   # what was done
git diff $BASE..HEAD --stat     # scope
git diff $BASE..HEAD            # full diff — read it
```

Build the **feature list**: user-visible behaviors, not files. Sources: commit
messages, PR description, and the diff itself. Examples: "user can filter
table by status", "export-to-CSV button", "dark mode toggle", "`pi stats`
prints token usage".

For each feature record:

- **What** — one independently observable behavior
- **Entry point** — route, UI element, command, or endpoint
- **How to verify** — browser / CLI / curl / existing test
- **Pass criteria** — the observable outcome that means "working"

Rules:

- One row per behavior the user could notice. Group siblings ("5 new filter
  options" = one row, sub-checks inside). Target 3–10 rows.
- Internal refactor with no user-visible change → single row "no user-visible
  change expected"; verify = build passes + app still boots + one existing
  happy path works.
- A feature promised in the commit message but absent from the diff is itself
  a finding: ❌ BROKEN (not implemented).

## Phase 2 — Bring up + task list

### 2a — Build and start

```bash
make build    # if Makefile exists
```

Start the dev server with `bg_run` (never `bash`), then ONE bounded readiness
wait — the URL/port comes from the diff, package.json, or Makefile:

```bash
timeout 60 bash -c 'until curl -sf localhost:3000/ >/dev/null 2>&1; do sleep 0.2; done' && echo READY
```

- CLI / library branch (no server)? Skip the server; verify per feature via
  bash.
- Browser: CloakBrowser MCP is headless by default (`PLAYWRIGHT_MCP_HEADLESS`)
  — keep it headless. Screenshots and artifacts land in `.playwright-mcp/`.
- App needs auth? Check the README for seeded test users first. Real
  credentials only if the user provides them; otherwise that feature is
  NOT TESTABLE, not a failure.

### 2b — Task list

One task per feature from Phase 1:

```text
TaskCreate(subject: "Verify: <feature>",
           description: "Entry: <route/command/element>. Pass: <criteria>. How: <browser|bash|curl>")
```

Work them ONE at a time: `in_progress` → verify → `completed` with the
verdict + evidence in the task. Never batch. If one feature blocks another
(e.g. login before everything), order the tasks so blockers come first.

### 2c — Verify a feature (browser)

CloakBrowser MCP exposes Playwright-compatible tools: `browser_navigate`,
`browser_snapshot`, `browser_click`, `browser_fill_form`, `browser_type`,
`browser_select_option`, `browser_press_key`, `browser_wait_for`,
`browser_take_screenshot`, `browser_console_messages`,
`browser_network_requests`, `browser_evaluate`, `browser_tabs`.

Per UI feature:

1. **Find it** — navigate to the entry route, `browser_snapshot`, confirm the
   element/text actually renders.
2. **Exercise it** — click / fill / submit the real user flow.
   `browser_wait_for` the expected outcome (text, element, or fixed delay for
   animations).
3. **Assert the effect** — `browser_snapshot` shows the expected state (new
   row, toast, changed view). `browser_take_screenshot` for the report.
4. **Check for silent breakage** — `browser_console_messages` (no new JS
   errors) and `browser_network_requests` (the API call fired, status 2xx).

A page that renders is not success — the feature's **effect** must be
observed. If a filter can be applied AND cleared, test both directions.

Non-UI features:

- **CLI**: run the command; assert exit code AND output content.
- **API**: `curl -sS -w '%{http_code}'` — assert status + body. Or read it
  from `browser_network_requests` while exercising the UI path.
- **New tests on the branch**: run them scoped to the changed code (never the
  whole suite). A green suite supplements — never replaces — observation.

### Verdicts

- ✅ **WORKING** — pass criteria observed. Quote it: snapshot text, status
  code, output line.
- ⚠️ **PARTIAL** — main path works, but console errors, a broken edge case,
  or a visual defect was observed alongside.
- ❌ **BROKEN** — error observed: crash, 5xx, exception, blank render, wrong
  output. Quote the error.
- ⏭️ **NOT TESTABLE** — blocked (missing env, external service, real
  credentials). State exactly what's missing. Never silently skip.

Safety while testing:

- State-changing actions: create disposable data only (prefix `test-` or a
  timestamp); never delete or modify real-looking records.
- Never run destructive commands (drop, rm, purge, force) against a real
  environment.

## Phase 3 — Report

```text
## Branch Test: <branch> (<n> commits, BASE..HEAD)

Environment: <how started — e.g. `make dev` on :3000, headless CloakBrowser>

| # | Feature | How verified | Verdict | Evidence |
|---|---------|--------------|---------|----------|
| 1 | Filter by status | browser: /orders → select "paid" | ✅ | snapshot shows 2/2 rows filtered; 0 console errors |
| 2 | Export CSV | browser: click Export | ❌ | console: `TypeError: rows.map is not a function` (export.png) |
| 3 | Stripe webhook | curl POST /webhook | ⏭️ | needs Stripe signing secret — not provided |

Summary: N ✅ / N ⚠️ / N ❌ / N ⏭️

Details (⚠️/❌): what happened, exact error, repro steps, suspected area
(file:line if obvious from the trace).

Follow-ups: fix tasks proposed — ask user before fixing anything.
```

Cleanup: kill the dev server (`bg_kill`), `browser_close` if a browser was
opened. Mention leftover artifacts (`.playwright-mcp/`) if any.

## Constraints

- **Report-only** — never edit app code during verification.
- **Every verdict carries evidence.** No observation → no verdict (it's
  NOT TESTABLE).
- **One feature at a time** in the task list; blockers first.
- **Don't hide failures** — finding a broken feature is this skill working,
  not failing. An all-green report nobody can reproduce is worthless.
- **No whole-suite runs** — scoped tests only, as a supplement to live
  observation.
