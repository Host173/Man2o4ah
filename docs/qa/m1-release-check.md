# Milestone 1 release check (PLT-07)

Run on 2026-11-22 on branch `chore/PLT-07-milestone-1-release`, based on `origin/develop` at `572c1a0` (merge of #234, TST-02). Backend version `1.0.0`.

**Summary:** ✅ 10 · ❌ 3 (R4, R6, R13) · manual 1 (R14).

| # | Check | Result | Evidence |
|---|---|---|---|
| R1 | Every mandatory requirement is implemented and visible in Swagger | ✅ | `npm run test:audit`: 2/2 files pass; `coverage.json` 732 checks, 0 failed; `smoke.json` 539 probes, 0 failed. The failures listed in `swagger-audit-report.md` (HTL-08 stub, malformed ids, …) were fixed in #234. |
| R2 | No stubs left | ✅ | `git grep -n "implemented in [A-Z]\+-[0-9]" -- backend/src`: empty. |
| R3 | No CRITICAL/HIGH stress finding open | ✅ | `npm run test:stress`: 20/20 files, 75 passed, 2 skipped (`F6`, `G5`: clone-image probes, not findings). All of `test/stress/findings/S-01…S-11` pass, including CRITICAL S-01, S-07 and HIGH S-03, S-04, S-08. |
| R4 | All tests pass | ❌ | `npm run verify`: format, lint (0 errors), typecheck and `test:cov` pass (see R4 note); **`test:e2e` fails 1 of 48**: `itinerary-to-clone.e2e-spec.ts` › "reorders and deletes days…" expects `PATCH /api/itineraries/{id}/days/reorder` with a list missing a day (`[c, a, b]` of 4 days) to answer 400, and gets 200. Reproduced alone. Cause: `54f0a34 fix(itineraries): accept a reorder list that predates an overlapping add (ITN-08)` (in #234) made a shorter list valid; the TST-01 journey (#224) still expects 400. CI does not run E2E, so `develop` went red unnoticed. **Kareem's decision (2026-11-22): keep the new behaviour.** The journey is updated on `test/ITN-08-e2e-reorder-partial-list` (from `develop`; E2E 48/48 pass there). R4 turns ✅ once that branch is merged into `develop`. |
| R5 | OpenAPI exported and current | ✅ | `npm run openapi:export` then `git status --porcelain docs/api`: empty, run twice (also in the fresh clone). 131 operations, `info.version` 1.0.0. |
| R6 | Swagger UI loads and cookie login works | ❌ | Built app (`node dist/main`) on an in-memory replica set, admin created with `seed:admin`: `GET /api/health` 200, `GET /api/docs` 200, `POST /api/auth/login` 200, `GET /api/auth/me` with the cookie 200. **`/api/docs-json` ≠ `docs/api/openapi.json`** (same 108 paths, same operations), for two reasons that come from the compiler, not the export: (1) parameter order differs on 9 operations (`nest build`/tsc vs Vitest's transform); (2) in the production build, 7 path parameters typed `Types.ObjectId` with `ParseObjectIdPipe` and no `@ApiParam` show in Swagger UI as a `Function` object schema instead of a string: `GET /api/payments/{id}`, `POST /api/payments/{id}/retry`, `GET /api/refunds/{id}`, `POST /api/hotel-bookings/{id}/review`, `GET /api/hotels/{id}/reviews`, `PATCH`/`DELETE /api/reviews/{id}`. The audit runs under Vitest too, so it never saw (2). Fix (product code, not in PLT-07): `@ApiParam({ name: 'id', type: String })` on those 7 handlers. |
| R7 | Every endpoint has a REQ-ID summary and a tag | ✅ | From `docs/api/openapi.json`: 131 operations, 0 without a summary starting with an ID or without a tag. |
| R8 | No secrets in the repository | ✅ | The secrets `git grep` (outside `*.md`): empty. `git ls-files \| grep -E "(^\|/)\.env$"`: empty. |
| R9 | Dependencies | ✅ | `npm audit --omit=dev --audit-level=high` in `backend/`: 0 vulnerabilities. |
| R10 | Team contributions visible | ✅ | `git shortlog -sne --no-merges origin/develop` (commits by git identity → member): Kareem 189 (`kareem sayed` 177, `Kareem` 12), Aya 139 (`Hestias-space`), Aisha 101, Pierre 89, Mostafa 73 (`M-Elsheshtawy` 72, `mostafa-elsahy` 1), Mokhtar 62 (`moham`), Jana 38 (`janaelmenshawy` 27, `Jana` 11), plus 44 by `Claude` (agent commits, mostly logged in `kareem.txt`). Every member appears. |
| R11 | Every member's prompt log present and current | ✅ | `AI_PROMPTS.txt` index: all 7 members have a file with entries, last entries 2026-11-20 to 2026-11-22. Course fields: one entry in `aisha.txt` (ACC-05, 2026-11-15) has no `Date`/`Student`/`Tool` lines; reported, not edited. Entry counts are `Prompt:` lines, so a few pasted prompts that contain their own `Prompt:` line count twice. |
| R12 | Requirement traceability | ✅ | `gh pr list --state merged --base develop --limit 300`: 108 PRs, 1 without a requirement ID: #156 "kareems prompt to test the full system". |
| R13 | README proven | ❌ | Fresh `git clone` of the branch, in `backend/`: `npm ci` ✅, `npm run build` ✅, `npm test` ✅, `npm run openapi:export` ✅ (no diff), `npm run test:e2e` ❌ and `npm run verify` ❌ (the R4 failure). Every command and path in the README ran as written; only the R4 test fails. Needs Atlas/Stripe, for Kareem (R14): `seed:reference`, `seed:admin`, `seed:demo`, `start:dev`, `start:prod`, `dev:stripe`. |
| R14 | Atlas integration | manual | Kareem: see "Kareem's release steps" below. |

R4 note: in the fresh clone, `test:cov` once failed on a 20 s timeout in `itinerary-pdf.api.spec.ts` (Chromium PDF) while another suite was running on the same machine. Run alone, `npm run verify` passes format, lint, typecheck and `test:cov` (211 files, 3460 tests, coverage thresholds met) and stops at `test:e2e` (1 failed, 47 passed), so `build` is not reached by `verify`; `npm run build` passes on its own.

## Kareem's release steps (after the PLT-07 PR is merged)

1. With the real `backend/.env` (it now also needs `DEMO_PASSWORD` and the `SEED_ADMIN_*` variables for `seed:demo`): `cd backend && npm ci && npm run build && npm run seed:reference && npm run seed:admin && npm run seed:demo`, then `npm run start:prod`; open `/api/docs`, log in as the admin and a demo user, try one booking. This is R14.
2. `gh pr create --base main --head develop --title "Release m1: Milestone 1 backend" --body "<this report's summary>"`, wait for CI green.
3. `gh pr merge <n> --merge` (merge commit).
4. `git fetch origin && git tag -a m1 origin/main -m "Milestone 1: backend and API" && git push origin m1`
5. Optional: `gh release create m1 --title "Milestone 1" --notes-file docs/qa/m1-release-check.md`
6. Close #91; keep `develop` as the default branch.

Before step 2: merge `test/ITN-08-e2e-reorder-partial-list` (R4, R13) and, ideally, fix R6 (7 `@ApiParam`).
