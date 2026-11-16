---
name: weekly-update
description: Write the weekly "Update CW<nn>" status comments on the voiceable/ionflux project epic issues (tracked on github.com/orgs/voiceable/projects/1), from MERGED PRs only. Use when asked to write or post the weekly update, the weekly status, or "what should I write this week" for the ionflux projects.
---

# Weekly update (CW comments on project epics)

Every week (Monday evening, for the weekly meeting) each owner posts a
`Update CW<nn>:` comment on the epic issues they own in `voiceable/ionflux`.
The GitHub project board (https://github.com/orgs/voiceable/projects/1,
id `PVT_kwDODlhoY84BKtJ5`) only tracks the epics — the updates themselves are
**issue comments on the epic issues**, never board fields.

Epics owned by wesraph (do not touch others): #499 Knowledge Base,
#1344 Booking Manager, #987 LLM serving / GPU gateway, #456 Core Quality.
(#1971 Assistant = lmittmann, #1343 App MVP and #547 E-Mail Agent = dre1992,
#1651 PCA = tessa-fl.) Re-check ownership via the last status comment's author
before writing on an epic not in this list.

## Steps

1. **Week and window.** CW = `date +%V`. Window = merged since the Monday of
   the previous week by default; tighten it to the date of the owner's last
   `Update CW` comment per epic when one exists.

2. **Merged PRs ONLY** (the rule the user insists on):

   ```bash
   gh pr list --repo voiceable/ionflux --author wesraph --state merged \
     --search "merged:>=YYYY-MM-DD" --json number,title,mergedAt
   ```

   A PR counts as done **only if `state=MERGED`** — verify with
   `gh pr view <n> --repo voiceable/ionflux --json state,mergedAt` before
   claiming anything. Never trust local branches or `git log --all`: they
   contain open-PR work. Open PRs may appear only as `Open: ...` next-step
   lines, never as done work.

3. **Map each merged PR to its epic** (by topic; PR titles/bodies usually name
   the epic, e.g. "(#1344)"). A PR with no fitting epic is skipped.

4. **Draft one comment per epic** in house style:

   ```
   Update CW<nn>:
   - <what shipped, concrete and plain, with (#PR number)>
   - <next meaningful line>
   - Open: <open PRs by number, nothing else>
   ```

   - Short dash bullets, English, plain sentences, no marketing.
   - Every done-bullet carries its PR number in parentheses.
   - If last week's update promised something that shipped differently, add an
     explicit correction line — unexplained deviations get asked in the weekly.
   - Small cleanups (CI, log levels) usually do not make the cut.

5. **Show the drafts to the user first.** Post only after approval, one
   comment per epic:

   ```bash
   gh issue comment <epic> --repo voiceable/ionflux --body "<draft>"
   ```

   Then report the four comment links.
