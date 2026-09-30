---
name: open-pull-request
description: Use when the user asks to open, create, submit or raise the pull request for the current branch of be-push-notification-tool, or asks to push the branch and make a PR.
argument-hint: "[target-branch] e.g. develop"
---

# Open Pull Request — be-push-notification-tool

## Overview

Push the current feature branch and open a pull request on **`er-datht/push-notification-tool-api`**
(this repo's `origin`), with a body built from `.github/pull_request_template.md`.

GitHub is reached **only through the GitHub MCP server `github-personal-datht`**
(`mcp__github-personal-datht__*` tools). The `gh` CLI is not authenticated on this machine — do not
use it, and do not look for another way to reach the remote.

Target/base branch: takes the branch as an optional argument (`argument-hint` above) — e.g.
`/open-pull-request develop` — or the user can name it in the request. Either way, use it as-is and
skip step 1b's detection. With no argument and nothing named, step 1b works one out, defaulting to
**`develop`** — this repo's feature PRs merge into `develop`, not `main`.

## Steps

### 0. Check the GitHub MCP server

- Load the tools if needed (tool search `github-personal-datht`):
  `mcp__github-personal-datht__list_pull_requests`, `mcp__github-personal-datht__create_pull_request`.
- If they are not available, or the first call fails with a permission/auth error, stop and report
  that the GitHub MCP server is not usable. Nothing gets pushed.

### 1. Pre-flight — read only, change nothing

- `git branch --show-current`. If the branch is `main` or `develop`, stop: a PR needs a feature branch.
- `git status --porcelain`. If anything is uncommitted, list the files and ask whether to open the PR
  without them or stop. **Never commit for the user.** Local-only files — `.env`,
  `.claude/settings.local.json`, `src/generated/prisma`, `PUSH_FILE_DIR` output — are never part
  of a PR; never stage them.
- List the open PRs once: `mcp__github-personal-datht__list_pull_requests` with
  `owner: er-datht`, `repo: push-notification-tool-api`, `state: open`. Use this one result for both checks:
  - If any PR's head branch (`head.ref`) is the current branch, it is already open. Report its URL and stop.
  - Work out the base branch (next step) from the same list.
- `git log <base>..HEAD --oneline`. These are the commits the PR will contain. If empty, stop —
  there is nothing to open a PR for.

### 1b. Work out the base branch — do not assume `develop`

If the user already named a target/base branch, use it and go to step 2.

Otherwise, work it out. Branches here can be stacked (e.g. the auto-app-push work landed as
`foundation` → `validation` → `delivery` → `endpoint`). Basing a stacked branch on `develop` puts the
parent branch's commits in this PR's diff.

- `git fetch origin` first, so `origin/develop` and the other remote refs are current.
- For each open PR's head branch (`head.ref`), test `git merge-base --is-ancestor origin/<head branch> HEAD`.
- If one passes, that branch is the parent of this work — propose it as the base.
- If several pass, propose the one with the most recent commit.
- If none pass, **default to `develop`.**

Always show the base — user-named or detected — in step 5 and let the user change it.

### 2. Build the PR body from `.github/pull_request_template.md`

Start from the template, keep every heading and checkbox, and fill only what the branch shows:

- **What Changed?** — what changed and why, in plain words, from `git log <base>..HEAD` and
  `git diff <base>...HEAD --stat`. Name the endpoints touched (`POST /api/notifications/…`) and
  the contract they follow (the FE repo's `docs/API-DOC-*.md`).
- **Screenshots/Videos** — leave the `<!-- -->` placeholder for the user. Never invent evidence.
- **Impact Area Identification** — list what the diff can reach, e.g. `src/app.ts` (middleware
  order, routers), `src/middleware/*` (every route), `src/lib/*` (shared by every module),
  `prisma/schema.prisma` (the database). Tick **Type of Impact** boxes only when the diff shows it:
  shared code for `src/lib/*` / `src/middleware/*`; **Database/Config** for `prisma/schema.prisma`,
  a new `prisma/migrations/*` folder, `src/lib/env.ts` or `.env.example`; **External integrations**
  when a request body, response body, error id or endpoint path changes (the FE console calls it).
- **Type of Change** — tick from the commit prefixes (`feat:` → new feature, `fix:` → bug fix,
  `docs:` → documentation, `refactor:`/`chore:` → none of these unless the diff says otherwise).
  Breaking change only when an already-merged endpoint's contract changed shape.
- **Related Documentation** — link the docs the branch adds or changes:
  `docs/superpowers/specs/*.md`, `README.md`, `CLAUDE.md`, and the FE contract it follows
  (`../fe-push-notification-tool/docs/API-DOC-*.md`).
- **How to Test?** — `docker compose up -d`; `yarn install`; `yarn db:migrate` and `yarn db:generate`
  when the branch adds a migration; `yarn typecheck && yarn lint && yarn test`; a `curl` example
  for each new or changed endpoint (token from `$API_TOKEN`, never a value). Name the `.env` keys a
  tester needs without values.
- **Checklist** — tick a box only for what you verified in this run with the command output in
  front of you: "No new warnings" after a clean `yarn lint`, "All tests pass locally" after
  `yarn test` shows every test passing, "Added/updated tests" when the diff adds or changes
  `*.test.ts`. Leave the rest unticked.

End the body with the PR attribution line from the session's instructions, if there is one.

### 3. Report unfilled placeholders

Grep the body for `<!--`. Name each section that still holds an empty template comment — usually
**Screenshots/Videos**. Report them and ask whether to open the PR anyway. Never fill them in yourself.

### 4. Title

Default to the newest commit's subject (`git log -1 --pretty=%s`), which follows this repo's
`feat: …` / `fix: …` / `refactor: …` / `docs: …` style. If the PR holds several commits, offer the
subject of the main `feat:` commit or a one-line summary in the same style. Show it and let the user
change it.

### 5. Confirm before touching the remote — always summarise both branches

Print this summary every run, naming both branches in full, then the body:

```
Repo:            er-datht/push-notification-tool-api
Push to remote:  <current branch>  →  origin/<current branch>
Base branch:     <base from step 1b>   (why: <user-specified | ancestor test passed | no ancestor, defaulted to develop>)
Commits in PR:   <n>  (git log <base>..HEAD)
Title:           <title from step 4>
Migrations:      <new prisma/migrations/* folders, or "none">
Unfilled:        <sections still holding <!-- --> , or "none">
```

### 5b. Ask the user to approve — straight after the summary, every run

The summary alone is not approval. Immediately after it, ask with `AskUserQuestion` whether to push
and open the PR — one question for both actions, because a push with no PR leaves the branch
half-landed. Name both branches in the question text. Offer at least:

- **Yes** — push `<branch>` to origin and open the PR against `<base>`.
- **No** — stop, push nothing, open nothing.

Add a third option when something is worth changing (a base that fell back to `develop`, unfilled
Screenshots/Videos), so the user can redirect.

Do not push on an approval given earlier in the conversation, on the original "open the PR"
request, or on silence. A "no" ends the run: report that nothing was pushed and no PR was opened.

### 6. Push

`git push -u origin <branch>`

Run it bare — no `| tail`, no `2>&1`. A pipe or redirect changes the command string the permission
rules match against, and the push gets blocked.

If the push is denied, stop. Do not retry more than once and never reach for another route to the
remote. Report that nothing was pushed and no PR exists, and offer the user two options: run the push
themselves with a leading `!` in the prompt, or allow it and retry.

### 7. Open the PR

`mcp__github-personal-datht__create_pull_request` with `owner: er-datht`,
`repo: push-notification-tool-api`, `base: <base from step 1b>`, `head: <branch>`, the title from
step 4, and the body from step 2.

If it fails, report the error as-is. The branch is already pushed, so say so, and offer to retry
or let the user open the PR on GitHub. Never use `gh`.

### 8. Report

Lead with the PR URL: `Opened: <PR URL>`. Then the head and base branches by name (the same two as
step 5), any migrations the reviewer must apply, and the sections the user still has to fill in on
GitHub.

## Red flags — stop and ask

- About to run `git commit` or `git add` — the user commits, not you.
- About to `git push --force`, or push to `main` / `develop`.
- About to write content into the Screenshots/Videos placeholder.
- About to tick a Checklist box or write "tests pass" without the `yarn test` / `yarn lint` output.
- About to push without an explicit yes to the step 5b question, asked after the step 5 summary.
- About to default the base to `develop` without running the step 1b ancestor test — or to `main`
  at all: feature PRs here go to `develop`.
- About to use the `gh` CLI — it is not authenticated here; the GitHub MCP server is the only client.
- About to stage `.env`, `.claude/settings.local.json`, `src/generated/prisma` or any other
  local-only file, or to paste a `.env` value into the PR body.
