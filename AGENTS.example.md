# Agent instructions (template)

Template version: 2026-11-10b

Copy this file to your own tool's instruction file, then fill in "About me":
- Claude Code: `CLAUDE.md` at the repo root
- Codex, Cursor, Copilot agents, Antigravity and most others: `AGENTS.md` at the repo root
- Gemini CLI: `GEMINI.md` at the repo root

Those files are gitignored, so add your own preferences freely in the last section. When this template's version changes, copy it again and keep your "About me" and "My preferences" sections.

## About me (fill in)

I am <First name>. My prompt log is `ai-prompts/<first name in lowercase>.txt`.

## 1. Read first

1. `README.md`, section "Team rules": binding for every change.
2. `docs/ai/skills/travel-platform/SKILL.md`: the project skill. Follow its routing table and read only the reference files the task needs.
3. Data: `docs/database/data-model.md`. Decisions: `docs/DECISIONS.md`.

If an instruction conflicts with these, follow them and tell me about the conflict.
If the first lines of `AGENTS.example.md` in the repo show a newer template version than this file, tell me once so I can copy it again.

## 2. Always

- Change only the modules my package owns (`references/modules.md` in the skill). If the task needs a change elsewhere, stop and tell me.
- For any UI change, follow `DESIGN.md`. If it doesn't exist yet, say so and don't invent a design.
- Write tests with the code; write them first where the ticket says "TDD: required".
- Before saying a task is done, run `npm run verify` in every app you changed and report the real result.
- If something isn't decided in the docs above and can't be derived safely, don't assume: stop and tell me to ask the team leader (Kareem).

## 3. Git

- Work on a branch `<type>/<ID>-<description>` created from the latest `develop`.
- Commit with Conventional Commits ending in the requirement ID, e.g. `feat(flights): add seat hold (FLT-22)`.
- Never push, open or merge a PR, force-push, rebase, or commit to `develop` or `main` unless I explicitly ask in this conversation.
- When I ask you to open a PR: target `develop`, title `<ID>: <description>`, and fill in every section of the PR template.
- Never commit `.env` files, secrets or connection strings.

## 4. Prompt log (every prompt)

At the end of every turn, append one entry to my prompt log (see "About me"), in the format of `docs/ai/skills/travel-platform/references/workflow.md` §5: date and time, my name, tool and model, current branch, requirement IDs, my prompt verbatim (with any secret, token or connection string removed), and a one- or two-line "How the output was used". Append only; never edit earlier entries. If "About me" isn't filled in, ask my name once and tell me to add it here.

## My preferences (optional, personal)

<anything you like: language, explanation style, how much detail, ...>
