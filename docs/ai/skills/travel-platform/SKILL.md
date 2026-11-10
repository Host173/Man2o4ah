---
name: travel-platform
description: Project knowledge for the GIU Software Project I "Travel Planning and Booking Platform" (NestJS 12 ESM + Mongoose 9 on MongoDB Atlas, Next.js 16 App Router, Stripe test mode, FXRatesAPI). Use for any coding, testing, review, planning or question about this repository - modules, ownership, endpoints, schemas, seeding, auth, holds, bookings, payments, refunds, itineraries, budgets, blog, moderation, admin, frontend pages, CI, git and PR rules - or whenever a requirement ID such as ACC-01, FLT-22, HTL-18, PAY-01, ITN-14, BLG-09 or GEN-11 appears.
---

# Travel Platform: project skill

A web platform where travelers search and book flights and hotels, plan day-by-day itineraries with budgets, and write blog posts. Airline and hotel moderators manage their one assigned provider; admins manage accounts, bookings and content.

The course grades it. Milestone 1 (backend + Swagger, due 20 Nov) is judged in Swagger UI with the course datasets. Milestone 2 (Next.js frontend + integration, due 11 Dec) is judged on working role workflows. Students must explain every line in an oral defense, so write code a student can explain: plain, conventional, no clever tricks.

## 0. Sources of truth (in this order)

1. `references/requirements.md`: the official requirements, verbatim.
2. `docs/DECISIONS.md` (repo): every decision the team has locked.
3. `docs/database/data-model.md` (repo): every collection, field, index and cross-module contract.
4. This skill: how we build on top of them.

If two sources conflict, follow the higher one and **mention the conflict** in your answer or report. Never resolve a conflict silently.

## 1. Two ways to use this skill

- **Coding task:** follow §5. Read only the reference files §3 routes you to.
- **A question** (from a teammate or yourself): answer from these files and the repo docs, and name the file you used. If the answer isn't there and can't be derived safely, **don't guess**: say it isn't decided and that the team leader (Kareem) must decide.

## 2. Fixed stack (do not substitute)

| Area | Use |
|---|---|
| Runtime | Node.js 26 LTS (`.nvmrc`) |
| Backend | NestJS 12, **ESM**, Vitest, oxlint, Prettier |
| Database | MongoDB Atlas (one shared team DB) via `@nestjs/mongoose` + Mongoose 9 |
| Tests | Vitest + `@nestjs/testing` + `mongodb-memory-server` (replica set) + Supertest |
| Validation | `class-validator` + `class-transformer` DTOs, global `ValidationPipe` |
| API docs | `@nestjs/swagger` at `/api/docs` |
| Auth | `@nestjs/jwt` + bcrypt, httpOnly cookies, custom guards (no Passport) |
| Events, jobs | `@nestjs/event-emitter`, `@nestjs/schedule` |
| Payments | `stripe` (backend), `@stripe/stripe-js` + `@stripe/react-stripe-js` (frontend), test mode only |
| Exchange rates | FXRatesAPI, called by the backend only |
| Time zones | `luxon` (backend), `Intl.DateTimeFormat` (frontend) |
| Frontend | Next.js 16 App Router, TypeScript, `src/`, ESLint, Prettier, **no Tailwind or UI kit until `DESIGN.md` decides** |
| Forms | `react-hook-form` + `zod` (UX only; the backend is the authority) |

Ports: backend `4000`, frontend `3000`. Every backend route starts with `/api`. Packages beyond this list need a reason in the PR and the team leader's approval.

## 3. Route your task: read only what you need

| If the task touches… | Read |
|---|---|
| A requirement ID | `grep -n "<ID>" references/requirements.md` |
| Which module owns what, who owns which package, cross-module calls, ports, events | `references/modules.md` |
| A collection, field, index, schema file | `references/data-model.md` (then the repo's `docs/database/data-model.md`) |
| A NestJS module, controller, service, DTO, guard, job, upload | `references/backend.md` |
| Which endpoint, method, role, module | `references/endpoints.md` |
| Login, cookies, sessions, roles, ownership, moderator scope | `references/auth.md` |
| Holds, booking lifecycle, Stripe, refunds, expiry jobs | `references/bookings-payments.md` |
| Itineraries, FX, flights/hotels management and search, blog, reports, notifications, admin | `references/domain-rules.md` |
| Writing or running tests, TDD, test design | `references/testing.md` |
| A Next.js page, layout, component, form, rendering choice | `references/frontend.md` |
| Anything crossing frontend↔backend (rewrites, errors, pagination, types, env vars) | `references/api-contract.md` |
| Branches, commits, PRs, CI gates, AI prompt log, definition of done | `references/workflow.md` |
| Lab code that differs from ours, oral-defense "why" answers | `references/lab-notes.md` |

Typical bundles: backend feature = modules + backend + data-model + endpoints + testing (+ auth or bookings-payments). Frontend feature = frontend + api-contract (+ `DESIGN.md`). Review = this file + workflow + the files for the area.

## 4. Non-negotiable rules

1. **Requirements win** (§0).
2. **Stay in your module.** Only change modules your package owns (`references/modules.md`). Another module's data is reached only through its exported service, a port or an event. No cross-module `populate`, no `ref` in schemas.
3. **Backend enforces everything** (GEN-13): validation, business rules, roles, ownership. Frontend checks are UX only.
4. **Layers:** controllers do HTTP only; services hold business rules and DB access. Never query a model from a controller.
5. **Tokens only in httpOnly cookies** (ACC-19). Never `localStorage`/`sessionStorage` for tokens or user data.
6. **Money** is integer minor units (`priceMinor`, `amountMinor`). Bookings, payments and refunds use the platform currency `USD` (PAY-04). Never trust a price from the client; compute it on the server.
7. **Time:** instants are UTC `Date`s; calendar dates are `DateOnly` (UTC midnight). Flight times are entered and shown in each airport's IANA zone.
8. **Inventory** changes only through `SeatInventory` (flights) and `RoomNightInventory` (hotels). Never read-then-write inventory.
9. **Status changes** are conditional updates on the old status (GEN-11).
10. **Errors** use the shared shape and codes from `common/errors/error-codes.ts` (`references/api-contract.md` §3).
11. **Tests ship with the code**, TDD first where the ticket says so (`references/testing.md`).
12. **Secrets** live only in `.env` (gitignored). Never print, commit or paste them. Add every new variable name to `.env.example`.
13. **Stay in scope:** one ticket per branch. No bonus (`[B]`) work unless the ticket asks.
14. **Use current APIs.** Next 16: `await params`, `await searchParams`, `await cookies()`, `proxy.ts`. NestJS 12 / Mongoose 9: check `node_modules` or current docs (Context7) when unsure; don't copy outdated tutorials. For Next.js, prefer the version-matched docs in `frontend/node_modules/next/` (see `frontend/AGENTS.md`).

## 5. How to work a coding task

1. Identify the requirement IDs; read their exact text (grep). Read the ticket's acceptance criteria and its test plan.
2. Read the routed files (§3), then look at one existing module/page in the repo and copy its pattern.
3. Plan in a few lines: files to touch (inside your modules only), endpoints, edge cases from the requirement text, tests.
4. Build in small steps. Backend: tests for the rule (TDD where required) → DTOs → service → controller → Swagger check. Frontend: data function → server page → interactive pieces → loading/empty/error states.
5. Verify with the definition of done (`references/workflow.md` §6): `npm run verify` in every app you changed.
6. Commit with the convention. Log the prompt (see `AGENTS.example.md`).

## 6. Ask, don't guess

Stop and tell the user to ask the team leader when:
- a requirement is ambiguous in a way that changes data, money or a status,
- the change would alter a shared contract (data model, DTOs another module uses, error codes, auth cookies, ports, events, `DESIGN.md`, `common/`),
- the task needs a package, env variable, collection or module not described here,
- the task needs a change in a module your package doesn't own.
