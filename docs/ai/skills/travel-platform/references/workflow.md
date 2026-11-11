# Workflow: git, PRs, CI, AI prompt log, definition of done

Decisions: `docs/DECISIONS.md` §13–14 (CI), §16 (prompt log), §18 (git). The README's "Team rules" section is the human-readable version of this file.

## Contents
1. Branches
2. Commits
3. Pull requests
4. CI gates
5. AI prompt log
6. Definition of done
7. Milestones

## 1. Branches

- `main` holds milestone releases only; `develop` is integration. **Never commit or push to either directly** (both are protected).
- Branch from the **latest** `develop` (`git checkout develop && git pull`), one ticket per branch: `<type>/<ID>-<description>`, type one of `feature fix chore docs test refactor`. Examples: `feature/FLT-22-seat-hold`, `fix/ACC-07a-reset`, `chore/PLT-01-ci-pipeline`.
- Never branch from another ticket's branch. If ticket B needs ticket A's **code**, start B after A is merged. If B only needs A's **interface** (already in the data model), start now against a fake.
- Keep your branch current by **merging** `develop` into it (`git merge develop`). No rebase, so no force-push. Resolve conflicts on your branch, keeping teammates' code.
- Push your branch at least once a day. Delete it after it's merged.

## 2. Commits

Conventional Commits, module as scope, requirement ID at the end (CI checks the format):
```
feat(flights): implement seat hold with atomic inventory (FLT-22)
test(flights): cover the 10-minute hold boundary (FLT-22)
fix(hotels): reject overlapping blocks (HTL-06)
refactor(payments): extract the refund tier calculator (PAY-03)
docs(api): document booking endpoints (FLT-25)
```
Types: `feat fix test refactor docs style chore ci perf build`. Never write `update`, `changes`, `final`. Commit after each working step, read the diff first. Never commit `.env`, `uploads/`, `node_modules/`, `dist/`, `coverage/`.

## 3. Pull requests

- Target `develop`. Title: `<ID>: <short description>` (CI checks the ID), e.g. `FLT-22: Seat hold`.
- Fill in the template (`.github/pull_request_template.md`): requirement IDs and summary, design decisions and why, how it was tested (including the concurrency result where relevant), AI usage, screenshots (frontend), and the checklist.
- Only related changes. Call out any change to a shared contract at the top (data model, ports, events, error codes, auth, `common/`, `DESIGN.md`).
- A PR merges when **CI is green and the team leader approves**. He merges with a **merge commit** (not squash: it keeps the test-first order and authorship in history).
- Agents never push, open PRs, force-push, or touch `develop`/`main` unless the member explicitly asks.

## 4. CI gates (every PR into `develop`/`main`)

| Gate | Rule |
|---|---|
| Format | Prettier check (never auto-fix in CI); fix locally with `npm run format` |
| Lint | 0 errors (oxlint backend, ESLint frontend); no disable comments to get through |
| Typecheck | `tsc --noEmit` over source and tests |
| Tests + coverage | all pass; each backend service file ≥ 80% lines |
| Build | both apps build |
| Commit messages | Conventional Commits |
| Branch / PR title | contain the requirement ID |
| Security | no high/critical production vulnerabilities (`npm audit`); no committed secrets (gitleaks) |

`npm run verify` in each app you changed runs the same checks locally. Run it before pushing. The required check is `ci-ok` plus the PR checks. Never silence a gate to make it pass.

## 5. AI prompt log (graded)

- One file per member in `ai-prompts/`: `kareem.txt`, `pierre.txt`, `mostafa.txt`, `aisha.txt`, `aya.txt`, `jana.txt`, `mokhtar.txt`.
- **The agent appends one entry per prompt** to the current member's file, at the end of the turn, in the course's format (PDF 11.1). **Copy, don't summarize**: the prompt is copied exactly and the other fields are mechanical, so the entry needs almost no thinking.
- **Who the current member is:** the "About me" line in the member's own agent file (`I am Pierre. My prompt log is ai-prompts/pierre.txt.`), which their tool loads at the start of every session. If it's missing, ask once and tell them to add it.
```
================================================
Date: 2026-11-12
Student: Pierre
Tool: Claude Code
Related Requirement: HTL-06

Prompt:
<the member's message, copied exactly>

How the output was used:
<one line: what this turn did, e.g. "Changed hotels.service.ts and its test; committed 3f2a1c9" or "Answer only, no files changed">
================================================
```
- **Related Requirement:** the requirement ID in the current branch name (`feature/HTL-06-room-block` → `HTL-06`). On a branch without an ID (`main`, `develop`), write `none`.
- **How the output was used:** one line stating what this turn did: files changed and the commit if any, or "Answer only, no files changed". State it; don't explain it.
- **Attached file** (e.g. an execution file): after the message, add a line `[Attached: <file name>]` and paste the file's full content, unchanged.
- **Secrets:** replace any secret, token, connection string or `.env` value with `<removed>`. Change nothing else.
- Append only; never edit earlier entries.
- Chat tools without repo access: copy material prompts in by hand, same format.

## 6. Definition of done

**Backend task:**
- [ ] Requirement text re-read; every limit and error case it names is implemented
- [ ] Only my package's modules changed (or the other owner agreed)
- [ ] DTO validation + service rules + guard/ownership checks
- [ ] Tests at the levels the ticket lists; TDD commit order where required; concurrency tests for inventory work
- [ ] `npm run verify` passes
- [ ] Endpoint in Swagger with tag and summary (requirement ID); tried there with success and failure cases, including the wrong role and another user's resource
- [ ] New env vars in `.env.example`; new error codes in the enum; contract changes called out

**Frontend task:**
- [ ] Uses `serverFetch`/`apiFetch` only; types from the generated `schema.d.ts`
- [ ] Loading, empty, error and success states; confirmation before destructive actions; field-level errors
- [ ] Follows `DESIGN.md`; works at 375 px and 1280 px
- [ ] `npm run verify` passes; clicked through the flow as the right role and as the wrong role

**Both:** prompt log entries written; commits follow §2; PR template complete.

## 7. Milestones

- **M1 (backend, 20 Nov):** NestJS backend on the shared Atlas DB; every mandatory endpoint documented and runnable in Swagger; seed for reference data and admin; README setup (env, seed, run, `stripe listen`); prompt logs; git history from every member; `docs/api/openapi.json` exported. The team leader merges `develop` → `main` and tags `m1`.
- **M2 (frontend, 11 Dec):** every mandatory workflow per role works end to end; rendering choices justified (`frontend.md` §6); final README; prompt logs; full git history; tag `m2`. Optional cloud-deploy bonus only if both apps are deployed and fully working.
