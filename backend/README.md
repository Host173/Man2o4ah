# Backend

NestJS 12 (ESM) API with Mongoose 9 on MongoDB Atlas. Every route starts with `/api`; Swagger UI is at `http://localhost:4000/api/docs`.

Team rules, setup and the `.env` values are in the [root README](../README.md). How the code is organised (modules, contracts, data model, tests) is in the coding skill: [`docs/ai/skills/travel-platform/`](../docs/ai/skills/travel-platform/SKILL.md).

## Commands

```bash
npm install                # once
npm run start:dev          # run with watch mode (port 4000)
npm run seed:reference     # load the reference data (countries, cities, airports, attractions, currencies)
npm test                   # all tests (in-memory MongoDB, never Atlas)
npm run test:cov           # tests with coverage
npm run verify             # what CI runs: format check, lint, typecheck, tests with coverage, build
npm run format             # fix formatting
```

## Where contracts are documented

A module's contract (the methods other modules may call) is documented **in the code**: the types and the comment on each method, plus its fake in `test/fakes/`. Cross-module calls, ports and events are in [`docs/database/data-model.md`](../docs/database/data-model.md) §6. Don't copy contracts or feature descriptions into README files: a copy goes stale the first time the code changes.
