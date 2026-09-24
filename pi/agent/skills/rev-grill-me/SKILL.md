---
name: rev-grill-me
description: Reverse grilling. Explore a branch (or diff), extract every new or changed behaviour, then put each one to the user with the question tool ("is this the change you intended?") so they can spot what was built wrong. Collect the verdicts into a fix list. Stores asked questions and answers in .pi/scratch so a later session first re-checks the code against past answers, then asks only new questions. Use when the user wants to validate a branch's behaviour against their intent, or says "rev-grill-me" / "reverse grill" / "ask me about each change".
---

# Reverse Grill

The user grills the code, through you. You read the branch, describe every behaviour it changed in plain terms, and ask the user, one change at a time, whether that behaviour is what they meant. The user holds the intent and you hold the facts. Getting the facts is your job, and judging them is theirs.

The output is a verdict per change and a fix list. **Do not fix anything during the skill.** Fixing starts only when the user asks for it.

## Hard rule: every question goes through `ask_user_question`

Everything the user has to answer is asked by calling the `ask_user_question` tool. This covers the verdict questions, the follow-ups, clarifications, open decisions and the final "should I fix these?". Never end a message with a question, choice or "let me know" in plain text that the user has to type an answer to. Before sending any message, check it: if it asks the user anything, that part must be a tool call instead. Plain text is only for facts you present (proof, the report); every decision in it still gets asked through the tool.

## 0. Load the grill log

Every question asked and every answer given is stored in the project scratchpad, so a later session re-checks the code against those answers instead of asking again:

```text
.pi/scratch/rev-grill-me/<branch-slug>/grill-log.md
```

`<branch-slug>` is the current branch name with `/` replaced by `-`. `.pi/scratch/` is project-local; add it to `.gitignore` if it is not already ignored. Never write the log outside the project.

The log has a header (branch, base, HEAD sha at the last session, date) and one entry per behaviour:

```markdown
## B7 — Retry cap (header)
- Behaviour: <the exact statement that was asked, with values>
- Proof: <file:line anchors + short quoted snippet the behaviour rests on>
- Verdict: intended | wrong | partial
- Direction: <what the user wants instead, for wrong/partial; follow-up answers included>
- Status: confirmed | to-fix | fixed | needs-verification
- Asked: <date>, HEAD <short sha>
```

If the log does not exist, start at step 1. If it exists, run step 0b first.

### 0b. Re-validate the previous answers

Before any new question, check that the code still matches every stored answer:

1. Create a task list with one task per logged behaviour (`Re-check B7 — Retry cap`). Mark each `in_progress` when you start it and `completed` when it has a result.
2. For each behaviour, run `git diff <logged sha>..HEAD` on its proof anchors and read the live code. Trace it again with the same rules as step 1.3, then classify it:
   - **Still holds:** an `intended` behaviour is unchanged, or a `wrong` one still waits for its fix.
   - **Fixed:** a `wrong`/`partial` behaviour now does what the Direction says. Prove it (file:line, and the test that pins it if there is one).
   - **Broken:** an `intended` behaviour changed, or a fix went a different way than the Direction.
   - **Changed:** the code moved so much that the stored question no longer describes it. It gets asked again in step 3, as a new question.
   - **Gone:** the code was removed.
3. Present the result as plain-text facts (behaviour number, class, proof). Send every **Broken** item to the user with `ask_user_question` ("B7 was confirmed as X; the code now does Y. Intended?") in the first round of step 3.
4. Update each entry's Status and proof anchors in the log.

Then continue with steps 1 and 2 as usual. In step 2, match each extracted behaviour against the log: a behaviour already logged with a verdict that still holds is **not asked again**. Only new behaviours, **Changed** ones and **Broken** ones become questions. If nothing is left to ask, go straight to the report.

## 1. Explore the branch

1. Find the base: `git merge-base HEAD main` (or `master`). List the commits (`git log --oneline base..HEAD`) and the files (`git diff --stat base...HEAD`). Note uncommitted changes (`git status --short`).
2. Read the **whole** diff (`git diff base...HEAD`), and the live code around it where the diff alone is ambiguous: callers, constructors, flag defaults, infra.
3. For every claim you will put to the user, trace it until you can prove it. Follow the rules in AGENTS.md: *Never Assume a Value's Final State from Its Source* and *Code Review — Verify Before Reporting*. A behaviour you cannot prove does not become a question. It becomes "needs verification" in the report.

## 2. Extract behaviours, not diffs

Turn the diff into a numbered list of **behaviour changes**, each stated as something observable: who is affected, under what trigger, and what happens now versus before. Put related hunks together into one behaviour, and split a hunk that changes two things.

Look especially for changes the author may not have meant:

- **Blast radius:** a shared constructor or helper whose change reaches consumers outside the feature. For example, a client hardening meant for one service that also changes another service using the same constructor.
- **Stacking:** two mechanisms that combine into more than either intends, like a retry in the library plus a retry in the caller.
- **Defaults and deploy values:** the binary default versus the value infra actually deploys, and startup behaviour (refusing to start versus warning).
- **Scope:** which call paths are in and which are deliberately out, such as calls versus chat, or the live path versus the background path.
- **Out-of-band prerequisites:** secrets, config objects or IAM the change needs that no code creates.
- **Observability:** new metrics, labels, alerts and their thresholds.
- **Docs and comments** that now contradict the code, including stale sections the branch did not touch.
- Internal-only refactors: list them briefly, so the user can confirm they carry no behaviour.

## 3. Ask, change by change

Call the `ask_user_question` tool for every question, with no exceptions (see the hard rule). Work in rounds of **up to 4 questions per call**, ordered from most to least consequential. Number the questions globally (`1/15`, `2/15`, …) so the user can see progress.

For each question:

- `header`: at most 12 characters, naming the change.
- `question`: a self-contained statement covering file or function, trigger, new behaviour, the old behaviour where it differs, defaults and the deployed value, ending in "Intended?". Quote exact values (timeouts, fractions, thresholds, status codes).
- `options`: `Yes, intended` plus `No / wrong` with a description naming the likely alternative. Add a third option when a partial answer is plausible (e.g. "Engine only" for a change that also hits other consumers). No "(Recommended)" label: you are asking about intent, not recommending.
- Don't author "Other" or "Type something." options; the tool adds them.

After each round:

- A **free-text or "No / wrong" answer without a direction** goes into a follow-up question in the next round, with concrete options for what the behaviour should be instead.
- An answer that is itself a **question** ("how is it done for X?") gets a direct answer with proof (file:line, a quoted snippet) in plain text. The follow-up decision is then asked in the same turn with `ask_user_question`, never left as a text question.
- Keep asking until every behaviour has a verdict and every "wrong" has a direction.
- Write the round's questions and answers to the grill log (step 0) straight away, before the next round, so an interrupted session loses nothing. Set the header's HEAD sha to the current HEAD.

## 4. Report

Finish with a short report:

- **Re-validated** (only when step 0b ran): counts per class, plus each Fixed, Broken, Changed and Gone item, one line each.
- **Confirmed:** the behaviour numbers marked intended, one line each.
- **To fix:** each wrong behaviour, what it does now and what the user wants instead, as concrete as possible (files, functions, the test that should pin it).
- **Out-of-band actions:** secrets, config or deploys the user must handle outside the code.

Then call `ask_user_question` one last time. Ask every open decision still unanswered, each with concrete options, plus "Fix the listed items now?" (options: fix all / fix a subset / not now). Never list open decisions as text for the user to answer. When the user says to fix, move the list into a task list and implement it, with a regression test per fix. After each fix, set that entry's Status to `fixed` in the grill log, with the new proof anchors.
