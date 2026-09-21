---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the frontier in one round using the `ask_user_question` tool — never as plain text. Then wait for the user's answers before the next round.

**Building the call:**
- Up to 4 questions per call. If the frontier is bigger, ask the 4 most blocking questions (the ones that unblock the most downstream decisions); the rest wait for the next round.
- `question`: the full question body — what's being decided, why it matters, any context the user needs.
- `header`: a short label (max 12 chars) naming the decision.
- `options`: 2-4 concrete choices the user could make. Put your **recommended answer first** and append "(Recommended)" to its label. Each option's `description` states what choosing it means and its trade-offs.
- `multiSelect: true` when the choices are not mutually exclusive.
- Don't author "Other"/"Type something." options — the tool appends a custom-answer row automatically.

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it — don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now. The _decisions_ are the user's — put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
