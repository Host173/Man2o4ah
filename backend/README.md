<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Hotels contract (CTR-03)

[HotelsService](src/modules/hotels/hotels.service.ts) provides hotel/room data,
inclusive room-night lookups, search, rating-summary updates, and provider
activation. [RoomNightInventory](src/modules/hotels/room-night-inventory.ts)
provides reserve, release, block, unblock, availability updates, deactivate, and
delete. Both are exported by `HotelsModule`; models remain private.

These are Sprint 1 stubs: calling them throws `NotImplementedException`.
Database-backed behavior ships in the corresponding Sprint 2 tickets. There are
no new HTTP endpoints in CTR-03.

For another module's unit tests, import `FakeHotelsService` and
`FakeRoomNightInventory` from `test/fakes/index.ts`. Seed the hotel fake with a
`HotelDataset` (`hotels`, `rooms`, `roomNights`), then construct the inventory fake
with that same hotel fake. They share in-memory state, so reservations and blocks
immediately affect search and room-night lookups. Fixtures are cloned per instance.

App IDs are strings, amounts are integer minor units, and dates are UTC `DateOnly`
values from `common/dates`. Stays exclude check-out; availability and block ranges
include both endpoints. Failed multi-room holds leave all requested rooms unchanged.
Lookup of an unknown hotel returns `null`; hotel updates and room inventory edits
throw `NOT_FOUND` for missing IDs. Reserve rejects unavailable rooms with
`ROOMS_UNAVAILABLE`. Search returns the shared paginated shape with a
`pricePerNightMinor` field on each matching hotel.

Pass `{ session }` as the final argument to hotel reads and inventory writes made
inside a booking transaction. The fakes accept this argument for compatibility but
do not emulate database transactions or rollback across multiple service calls.
They do not expire holds themselves: hotel-bookings calls `release(reservationId)`.

Run the contract tests with:

```powershell
npm test -- hotels.contract.spec.ts hotels.fake.spec.ts
```

Run `npm run verify` before handing off changes.

## Community contract (CTR-07)

[ReportableContent](src/modules/moderation/ports/reportable-content.port.ts)
defines the port (`targetType`, `exists(id)`, `hide(id)`, `delete(id)`) that
content-owning modules (`blog` for `post` and `comment`, `hotel-bookings` for
`review`, `itineraries` for `itinerary`) implement for content reporting
(`GEN-09`) and report resolution (`GEN-10`).
[ReportableContentRegistry](src/modules/moderation/ports/reportable-content.registry.ts)
is exported by `ModerationModule` so each content module can register its
provider in `onModuleInit` without creating circular imports.

`BlogModule` (`BlogService`), `ModerationModule` (`ModerationService`,
`ReportableContentRegistry`), and `AdminModule` (`AdminService`) provide Sprint 1
module skeletons; database-backed workflows ship in Sprint 3 (`BLG-01..09`,
`GEN-06`, `GEN-09`, `GEN-10`, `ACC-07a`, `ACC-09..11`, `ACC-13..15`).

For unit and contract tests in `HTL-23`, `ITN-20`, `BLG-01`, `GEN-09`, and
`GEN-10`, import `FakeReportableContent` from `test/fakes/index.ts`. Seed IDs in
the constructor or with `add(id)` / `set(id)`; `exists(id)` returns `true` for
seeded items (including hidden ones) and `false` for unknown or deleted IDs,
`hide(id)` marks an item hidden (`isHidden(id) === true`) idempotently and throws
404 `NOT_FOUND` for missing IDs, and `delete(id)` removes the item and throws 404
`NOT_FOUND` when missing or already deleted.

Run the community contract tests with:

```bash
npm test -- src/modules/moderation src/modules/blog src/modules/admin test/fakes/reportable-content.fake.spec.ts
```

## Bookings contract (CTR-04)

[FlightBookingsService](src/modules/flight-bookings/flight-bookings.service.ts)
and [HotelBookingsService](src/modules/hotel-bookings/hotel-bookings.service.ts)
each provide `listForAdmin(query)` for the admin booking list (`ACC-17`). They are
exported by `FlightBookingsModule` and `HotelBookingsModule`; models remain
private. Both are read-only.

These are Sprint 1 stubs: calling them throws `NotImplementedException`. The
database-backed list ships in `ACC-11`. There are no new HTTP endpoints in
CTR-04; `GET /api/admin/bookings` belongs to the admin module.

The query takes `page` and `limit`, and optionally `status` and a `from`/`to`
range on the booking's `createdAt` (both ends inclusive). Each service returns
the shared paginated shape, newest `createdAt` first. Rows
([FlightBookingAdminView](src/modules/flight-bookings/flight-bookings.types.ts),
[HotelReservationAdminView](src/modules/hotel-bookings/hotel-bookings.types.ts))
carry `bookingType` (`'flight'` or `'hotel'`), `bookingId`, `reference` (absent
until confirmed), `userId`, `providerId` (the outbound airline or the hotel),
`startAt`/`endAt` (flight departures, or hotel check-in/check-out as UTC
`DateOnly` values), `totalMinor`, `currency`, `status` and `createdAt`. IDs are
strings and amounts are integer minor units. To list both types, call both
services and merge by `createdAt`.

For other modules' tests (`ACC-17`), import `FakeFlightBookingsService` and
`FakeHotelBookingsService` from `test/fakes/index.ts` and pass the admin views
to the constructor. The fakes filter, sort and paginate like the contract above.
Fixtures and results are copied, so tests cannot change each other's data.

Run the bookings contract tests with:

```bash
npm test -- src/modules/flight-bookings src/modules/hotel-bookings test/fakes/flight-bookings.fake.spec.ts test/fakes/hotel-bookings.fake.spec.ts
```

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It installs `@nestjs/observe`, wires it into `AppModule` and `main.ts`, and writes the app key and secret into `.env`, which every `nest start` script (`start`, `start:dev`, `start:debug`) then loads. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/sdk) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
