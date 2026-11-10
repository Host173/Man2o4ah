# Course labs vs. what this project does

The six labs teach the concepts the oral defense asks about, but several code samples are outdated or unsafe. When lab code and this skill differ, use this skill and be ready to explain why (the "why" column is the answer).

## Lab 1: MERN recap
| Lab shows | We do | Why |
|---|---|---|
| Express routes and `express.Router` | NestJS controllers | Required stack |
| "Controller = where business logic is written" | Controllers do HTTP only; logic goes in services | Project PDF §1.1 and NestJS convention: keeps logic testable and reusable |
| React with Vite + React Router (`BrowserRouter`, `<Outlet>`, `useNavigate`, `useParams`) | Next.js file routing, `layout.tsx`, `next/link`, `next/navigation` | Required stack; layouts replace `<Outlet>` |
| `localStorage` via `useEffect` | Never for tokens or user data | ACC-19: httpOnly cookies only |
| Axios in `useEffect` for page data | Server Components fetch page data; `apiFetch` for user actions | Less client JS, no loading waterfalls, works with SSR/ISR |
| Backend `npm start` | `npm run start:dev` | Watch mode during development |
| "don't forget CORS" | Next rewrites `/api` (same origin) + `enableCors` for tools | Cookies stay first-party |

## Lab 2: Figma, Swagger, TypeScript
| Lab shows | We do | Why |
|---|---|---|
| Swagger from a hand-written `openapi.yaml` with `swagger-ui-express` + `yamljs` (Express) | `@nestjs/swagger` generated from DTOs and decorators, CLI plugin, `/api/docs` | Docs can't drift from code; Milestone 1 is graded in this UI |
| `tsc --v`, global installs | `tsc -v`; prefer local deps / `npx` | Typo in slide; global versions differ across teammates |
| Figma design system | Recorded in `DESIGN.md` for agents | Agents can't read Figma; one source of UI truth |

## Lab 3: AI workflow
Good guidance, and still valid: design first, agent instruction files, small slices, verify, PR template, AI log, hooks. Our version: `AGENTS.example.md` + this skill (committed), personal agent files gitignored, per-member prompt logs in `ai-prompts/`.
Differences: the lab says "NestJS 11" (current is 12). Its monorepo (`apps/api`, `apps/web`, `packages/shared-types`) differs from the project PDF's `backend/` + `frontend/`; we follow the PDF and share types by generating them from OpenAPI. The lab says Spec Kit files from the first two weeks are graded, so check with your TA if that applies to your team.

## Lab 4: Decorators + NestJS intro
| Lab shows | We do | Why |
|---|---|---|
| `MongooseModule.forRoot('mongodb://localhost:27017/…')` hardcoded | `forRootAsync` + `ConfigService` + `MONGODB_URI` (Atlas) | Shared Atlas DB, no secrets in code (PDF §8.11) |
| Decorator theory (class/method/property/parameter, execution order) | Same (Nest uses these legacy TS decorators) | Defense material: know how `@Roles` metadata + `Reflector` work |

## Lab 5: NestJS CRUD + auth
| Lab shows | We do | Why |
|---|---|---|
| `@Prop() id: string` manual id | Use Mongo `_id` | Avoids duplicate ids and broken refs |
| Lowercase classes, `mongoose.Model<course>` | `class Course`, `Model<Course>`, `HydratedDocument<Course>` | TS conventions, correct typing |
| DTOs without validators | class-validator on every DTO + global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` | GEN-13 server-side validation; blocks mass assignment (e.g. `role`) |
| `PUT` for partial updates | `PATCH` + `PartialType` | REST semantics; matches the PDF endpoint list |
| `npm start` or `node src/main.js` | `npm run start:dev` | `src` is TypeScript; node can't run it directly |
| `console.log` of password and hash | Never log secrets | Security; leaks into terminals and logs |
| Login: `NotFoundException('User not found')` | `401 INVALID_CREDENTIALS` "Invalid email or password" | ACC-04; stops account enumeration |
| JWT payload `{ userid, role }` | `{ sub, role, sid }` | `sub` is the standard claim; `sid` enables logout and idle expiry |
| One `token` cookie, 1 h, `secure` only in prod, no `sameSite` | `access_token` 15 min + server-side session with `refresh_token`; httpOnly + Secure + SameSite=Lax | ACC-06, ACC-19 |
| `JwtModule.register({ secret: process.env... })` | `registerAsync` with `ConfigService` | env may not be loaded at import time |
| Controller `try/catch` returning `{ statusCode, message }` | Throw HTTP exceptions; a global filter formats them | Correct HTTP status codes; consistent error shape |
| Roles guard throws `UnauthorizedException` | `ForbiddenException` (403) | 401 = not logged in, 403 = not allowed |
| `@UseGuards` per controller | Global `APP_GUARD`s + `@Public()` opt-out | New endpoints are protected by default |
| Installs `@nestjs/passport` but doesn't use it | No Passport | Fewer moving parts; the custom guard is what the lab actually teaches |

## Lab 6: Next.js
Mostly current for Next 16: `proxy.ts` replaces `middleware.ts`, `params`/`searchParams` are Promises, Server vs Client rules, `error.tsx` must be a client component, `global-error.tsx` needs `<html><body>`, metadata only in Server Components.
Extra notes: in Next 16 every parallel-route slot **must** have `default.tsx` or the build fails. We don't need parallel or intercepting routes for this project, so don't add them without a feature that needs them. Route handlers (`route.ts`) aren't where our API lives; the API is NestJS. Node requirement is 20.9+ (we use 26 LTS).
