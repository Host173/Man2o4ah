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
