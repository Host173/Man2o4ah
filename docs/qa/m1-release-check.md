# Milestone 1 release check (PLT-07)

Run on 2026-11-22 on branch `chore/PLT-07-milestone-1-release`. It is stacked on `origin/develop` (`572c1a0`) and three fix branches found by this check, merged in this order: `test/ITN-08-e2e-reorder-partial-list` (#235), `chore/TST-01-e2e-in-ci`, `fix/TST-02-swagger-objectid-params`. Backend version `1.0.0`.

**Summary:** ✅ 13 · manual 1 (R14). R4, R6 and R13 failed on `develop` and pass with the three fix branches below.

| # | Check | Result | Evidence |
|---|---|---|---|
| R1 | Every mandatory requirement is implemented and visible in Swagger | ✅ | `npm run test:audit`: 2/2 files pass; `coverage.json` 732 checks, 0 failed; `smoke.json` 539 probes, 0 failed. The failures listed in `swagger-audit-report.md` (HTL-08 stub, malformed ids, …) were fixed in #234. |
| R2 | No stubs left | ✅ | `git grep -n "implemented in [A-Z]\+-[0-9]" -- backend/src`: empty. |
| R3 | No CRITICAL/HIGH stress finding open | ✅ | `npm run test:stress`: 20/20 files, 75 passed, 2 skipped (`F6`, `G5`: clone-image probes, not findings). All of `test/stress/findings/S-01…S-11` pass, including CRITICAL S-01, S-07 and HIGH S-03, S-04, S-08. |
| R4 | All tests pass | ✅ | `npm run verify` on this branch: format, lint (0 errors), typecheck, `test:cov` (coverage thresholds met), `test:e2e` and build pass (211 test files, 3460 tests; E2E 8 files, 48 tests). On `develop` alone the itinerary E2E journey failed: since `54f0a34` (#234) a reorder list that omits only trailing days is accepted, and the TST-01 journey still expected 400. Kareem kept the new behaviour; the journey is updated in #235. CI did not run E2E, so it went red unnoticed: `chore/TST-01-e2e-in-ci` adds the step. |
| R5 | OpenAPI exported and current | ✅ | `npm run openapi:export` then `git status --porcelain docs/api`: empty, run twice (also in the fresh clone). 131 operations, `info.version` 1.0.0. |
| R6 | Swagger UI loads and cookie login works | ✅ | Built app (`node dist/main`) on an in-memory replica set, admin created with `seed:admin`: `GET /api/health` 200, `GET /api/docs` 200, `POST /api/auth/login` 200, `GET /api/auth/me` with the cookie 200, and `/api/docs-json` deep-equals `docs/api/openapi.json` (only the order of object keys differs). Two fixes were needed: (1) 7 path params typed `Types.ObjectId` with no `@ApiParam` showed as a `Function` object in the production Swagger UI and were missing under Vitest (payments, retry, refunds, hotel review, hotel reviews, PATCH/DELETE reviews): `fix/TST-02-swagger-objectid-params`; (2) the parameter order Swagger reads depends on the compiler (tsc lists `{id}` first, Vitest last): `buildOpenApiDocument` now lists path params first in URL order, as the production build already did. |
| R7 | Every endpoint has a REQ-ID summary and a tag | ✅ | From `docs/api/openapi.json`: 131 operations, 0 without a summary starting with an ID or without a tag. |
| R8 | No secrets in the repository | ✅ | The secrets `git grep` (outside `*.md`): empty. `git ls-files \| grep -E "(^\|/)\.env$"`: empty. |
| R9 | Dependencies | ✅ | `npm audit --omit=dev --audit-level=high` in `backend/`: 0 vulnerabilities. |
| R10 | Team contributions visible | ✅ | `git shortlog -sne --no-merges origin/develop` (commits by git identity → member): Kareem 189 (`kareem sayed` 177, `Kareem` 12), Aya 139 (`Hestias-space`), Aisha 101, Pierre 89, Mostafa 73 (`M-Elsheshtawy` 72, `mostafa-elsahy` 1), Mokhtar 62 (`moham`), Jana 38 (`janaelmenshawy` 27, `Jana` 11), plus 44 by `Claude` (agent commits, mostly logged in `kareem.txt`). Every member appears. |
| R11 | Every member's prompt log present and current | ✅ | `AI_PROMPTS.txt` index: all 7 members have a file with entries, last entries 2026-11-20 to 2026-11-22. Course fields: one entry in `aisha.txt` (ACC-05, 2026-11-15) has no `Date`/`Student`/`Tool` lines; reported, not edited. Entry counts are `Prompt:` lines, so a few pasted prompts that contain their own `Prompt:` line count twice. |
| R12 | Requirement traceability | ✅ | `gh pr list --state merged --base develop --limit 300`: 108 PRs, 1 without a requirement ID: #156 "kareems prompt to test the full system". |
| R13 | README proven | ✅ | Fresh `git clone` of the branch, in `backend/`: `npm ci`, `npm run build`, `npm test`, `npm run openapi:export` (no diff) pass as written; `npm run test:e2e` and `npm run verify` failed only on the R4 journey, fixed by #235 (re-run on this branch: R4). Needs Atlas/Stripe, for Kareem (R14): `seed:reference`, `seed:admin`, `seed:demo`, `start:dev`, `start:prod`, `dev:stripe`. |
| R14 | Atlas integration | manual | Kareem: see "Kareem's release steps" below. |

R4 note: in the fresh clone, `test:cov` once failed on a 20 s timeout in `itinerary-pdf.api.spec.ts` (Chromium PDF) while another suite was running on the same machine; run alone it passes.

## Kareem's release steps (after the PLT-07 PR is merged)

1. With the real `backend/.env` (it now also needs `DEMO_PASSWORD` and the `SEED_ADMIN_*` variables for `seed:demo`): `cd backend && npm ci && npm run build && npm run seed:reference && npm run seed:admin && npm run seed:demo`, then `npm run start:prod`; open `/api/docs`, log in as the admin and a demo user, try one booking. This is R14.
2. `gh pr create --base main --head develop --title "Release m1: Milestone 1 backend" --body "<this report's summary>"`, wait for CI green.
3. `gh pr merge <n> --merge` (merge commit).
4. `git fetch origin && git tag -a m1 origin/main -m "Milestone 1: backend and API" && git push origin m1`
5. Optional: `gh release create m1 --title "Milestone 1" --notes-file docs/qa/m1-release-check.md`
6. Close #91; keep `develop` as the default branch.

Before step 2: merge, in order, #235 (ITN-08 journey), the TST-01 E2E-in-CI PR, the TST-02 Swagger params PR, then this PR.
