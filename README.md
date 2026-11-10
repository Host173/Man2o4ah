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
│   ├── requirements/
│   └── api/
├── AI_PROMPTS.txt
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
2. Copy the `backend/.env` values from `.env.example` into `backend/.env` and fill in `MONGODB_URI` (get it from the team leader).
3. Copy the frontend values from `.env.example` into `frontend/.env.local`.
4. Run `npm install` in `backend/` and in `frontend/`.

## Run

- Backend: `npm run start:dev` in `backend/`
- Frontend: `npm run dev` in `frontend/`

## URLs

- API: http://localhost:4000/api
- Swagger: http://localhost:4000/api/docs
- Frontend: http://localhost:3000

## Workflow

- `main` holds milestone releases; `develop` is for integration.
- Work on `feature/<requirement-id>-<description>` branches created from `develop`.
- Open PRs into `develop`; the team leader reviews them.
- Commits use Conventional Commits, for example `feat(flights): ...`.
- Never commit `.env` files.
- Log material AI prompts in `AI_PROMPTS.txt`.

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

- Every commit follows Conventional Commits.
- The branch name is `<type>/<ID>-<description>`, with type one of `feature`, `fix`, `chore`, `docs`, `test`, `refactor`.
- The PR title contains a requirement ID.
- No secret is found in the PR's history (gitleaks).

A PR from `develop` into `main` (a milestone release) is exempt from the branch name and title rules.

**Run `npm run verify` in each app you changed before pushing.** It runs the same gates as CI, in the same order, and stops at the first failure. Use `npm run format` to fix formatting.

Branch and PR title example:

- Branch: `feature/FLT-22-seat-hold`
- Title: `FLT-22: seat hold`

**A PR merges only when CI is green and the team leader approves.**

## Database

- The data model lives in `docs/database/` (`data-model.md` is the source of truth; class and ER diagrams are next to it). Mongoose schemas in `backend/src/modules/*/schemas/` are written from it, and `backend/test/db/indexes.spec.ts` fails if a collection's indexes drift from it.
- Seed the reference data (countries, cities, airports, attractions, currencies) from `backend/seed-data/*.csv`: with `MONGODB_URI` set in `backend/.env`, run `npm run seed:reference` in `backend/`. It validates every reference before writing and is safe to re-run.
- Tests use an in-memory MongoDB replica set and never touch Atlas. The first test run downloads a MongoDB binary, so it can take a few minutes.
