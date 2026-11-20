# Travel Platform

A platform to plan, book and share trips.

## Stack

- NestJS (backend API)
- MongoDB Atlas with Mongoose
- Next.js (App Router) frontend
- TypeScript

## Repository structure

```
project-root/
├── backend/            NestJS app
├── frontend/           Next.js app
├── docs/
│   ├── ai/             AI skills: skills/travel-platform/ (coding agents), chat-skill/ (chat assistants)
│   ├── requirements/
│   ├── api/
│   ├── database/       data model, class and ER diagrams
│   └── DECISIONS.md    every project decision
├── ai-prompts/         one AI prompt log per member
├── AGENTS.example.md   template for your own (gitignored) agent file
├── AI_PROMPTS.txt      pointer to ai-prompts/
├── README.md
├── .env.example
├── .gitignore
├── .gitattributes
└── .nvmrc
```

There is no root `package.json`. Each app has its own.

## Prerequisites

- Node.js: the version in `.nvmrc` (`nvm use`)
- npm

## Setup

1. Clone the repository.
2. Copy the `backend/.env` values from `.env.example` into `backend/.env` and fill in `MONGODB_URI` (get it from the team leader) and `JWT_ACCESS_SECRET` (any long random string; `.env.example` shows how to generate one).
3. Copy the frontend values from `.env.example` into `frontend/.env.local`.
4. Run `npm install` in `backend/` and in `frontend/`.

## Run

- Backend: `npm run start:dev` in `backend/`
- Backend with Stripe test payments: `npm run dev:stripe` in `backend/`
  - Runs `npm run start:dev` and the Stripe CLI webhook forwarder (`stripe listen`) in one terminal, so test payments confirm bookings. It passes the listener's webhook secret to the backend for you.
  - Needs the [Stripe CLI](https://docs.stripe.com/stripe-cli) installed (`winget install Stripe.StripeCLI` on Windows) and `stripe login` run once.
  - `STRIPE_SECRET_KEY` (an `sk_test_` key) still comes from `backend/.env`.
  - Not testing payments? Plain `npm run start:dev` is enough.
- Frontend: `npm run dev` in `frontend/`

## URLs

- API: http://localhost:4000/api
- Swagger: http://localhost:4000/api/docs
- Frontend: http://localhost:3000

## Workflow

- `main` holds milestone releases; `develop` is for integration.
- Branch, commit and pull request rules: see [Team rules](#team-rules).
- Open PRs into `develop`; the team leader reviews them.
- Commits use Conventional Commits, for example `feat(flights): ...`.
- Never commit `.env` files.
- AI prompts are logged per member: see [AI setup](#ai-setup).

## Quality gates

Every pull request into `develop` or `main`, and every push to those branches, runs the CI pipeline (`.github/workflows/ci.yml`). Only the app(s) you changed are checked.

| Gate | Backend | Frontend |
| --- | --- | --- |
| Format | Prettier check, never writes | Prettier check, never writes |
| Lint | `oxlint`, 0 errors | ESLint, 0 errors |
| Typecheck | `npm run typecheck` | `npm run typecheck` |
| Tests and coverage | all tests pass; at least 80% line coverage on `src/modules/**/*.service.ts` | no tests yet |
| Build | `npm run build` | `npm run build` |
| Security | `npm audit --omit=dev --audit-level=high` | same |

Checks on the whole repository, on pull requests only:

- The branch name is `<type>/<ID>-<description>`, with type one of `feature`, `fix`, `chore`, `docs`, `test`, `refactor`.
- The PR title contains a requirement ID.
- No secret is found in the PR's history (gitleaks).
- The author's prompt log (`ai-prompts/<first name>.txt`) has at least one new entry, and no existing line in `ai-prompts/` is removed or changed (the logs are append-only).

A PR from `develop` into `main` (a milestone release) is exempt from the branch name and title rules.

**Run `npm run verify` in each app you changed before pushing.** It runs the same gates as CI, in the same order, and stops at the first failure. Use `npm run format` to fix formatting.

Branch and PR title example:

- Branch: `feature/FLT-22-seat-hold`
- Title: `FLT-22: seat hold`

**Each PR is linked to its issue automatically.** A workflow reads the ticket key from the branch name (or the PR title) and adds `Closes #<issue>` to the PR description, so the PR shows on the issue and the issue closes when the PR is merged into `develop`. If no issue matches, it leaves a comment instead.

**AI review.** Copilot reviews every PR automatically against the project's rules (`.github/copilot-instructions.md`); read its comments and fix what's real. For an important PR (contracts, inventory, holds, payments), the team leader can ask for a deeper review by commenting `@claude review this` on it. Claude reads the project skill first and posts its review on the PR; it never pushes commits.

**A PR merges only when CI is green and the team leader approves.**

## Team rules

These rules bind every change, by a person or an agent. The details are in the project skill (`docs/ai/skills/travel-platform/`), and every decision is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

### Ownership
- Each package (one per member) owns whole modules, backend and pages. You only change modules your package owns; another module's data is reached through its service, a port or an event. See the skill's `references/modules.md`.
- The data model in [`docs/database/`](docs/database/) is frozen. A change goes through the team leader as its own PR (doc, diagram, schema and index test together).
- If something isn't decided, ask the team leader. Don't guess.

### Git
1. Branch from the latest `develop`, one ticket per branch: `<type>/<ID>-<description>` (type: `feature`, `fix`, `chore`, `docs`, `test`, `refactor`), e.g. `feature/FLT-22-seat-hold`.
2. Never commit or push to `develop` or `main` directly.
3. Never branch from another ticket's branch. If you need another ticket's code, start after it's merged; if you only need its interface, start now against a fake.
4. Keep your branch current by merging `develop` into it (no rebase, no force-push).
5. Push your branch at least once a day.
6. Commits: Conventional Commits ending in the requirement ID, e.g. `feat(flights): add seat hold (FLT-22)`.
7. PRs target `develop`, titled `<ID>: <description>`, with the template filled in. They merge when CI is green and the team leader approves, with a merge commit (not squash). Delete the branch afterwards.
8. At each milestone the team leader merges `develop` into `main` and tags `m1` / `m2`.

### Tests
- No PR without tests. The ticket lists the levels it needs: unit, integration (in-memory MongoDB), API (Supertest), E2E.
- Test first (test commit before code commit) where the ticket says **TDD: required**: pricing, refunds, status changes, inventory, budgets, lockout, and every bug fix.
- Tests never touch Atlas. Never weaken, skip or delete a test to make a suite pass.

### AI
- Copy `AGENTS.example.md` to your own tool's file (see "AI setup" below).
- Every prompt is logged in your own file in `ai-prompts/` (your agent does it). Never paste secrets, tokens or connection strings into an AI tool.

## AI setup

1. **Instructions:** copy `AGENTS.example.md` to your tool's file at the repo root (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex, Cursor, Copilot agents and most others, `GEMINI.md` for Gemini CLI) and fill in "About me". These files are gitignored, so they're yours.
2. **Project skill:** `docs/ai/skills/travel-platform/`. Your agent reads `SKILL.md` first (your instruction file tells it to). Claude Code users can also install it as a native skill:
   - Windows (cmd, repo root): `mkdir .claude\skills` then `mklink /J .claude\skills\travel-platform docs\ai\skills\travel-platform`
   - macOS/Linux (repo root): `mkdir -p .claude/skills && ln -s ../../docs/ai/skills/travel-platform .claude/skills/travel-platform`
3. **Prompt log:** `ai-prompts/<your first name>.txt`. Your agent appends one entry per prompt. For chat tools without access to the repo, add material prompts by hand.
4. **Chat assistants** (Claude, ChatGPT, Gemini): use the chat skill `docs/ai/chat-skill/SKILL.md`, one file with all the project knowledge. Paste `docs/ai/chat-skill/chat-instructions.txt` into the tool's instructions field (custom GPT, Gemini Gem, Claude project) and upload `SKILL.md` as knowledge. On Claude you can also add it as a skill.

## Database

- The data model lives in `docs/database/` (`data-model.md` is the source of truth; class and ER diagrams are next to it). Mongoose schemas in `backend/src/modules/*/schemas/` are written from it, and `backend/test/db/indexes.spec.ts` fails if a collection's indexes drift from it.
- Seed the reference data (countries, cities, airports, attractions, currencies) from `backend/seed-data/*.csv`: with `MONGODB_URI` set in `backend/.env`, run `npm run seed:reference` in `backend/`. It validates every reference before writing and is safe to re-run.
- Tests use an in-memory MongoDB replica set and never touch Atlas. The first test run downloads a MongoDB binary, so it can take a few minutes.
