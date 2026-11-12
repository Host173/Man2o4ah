/**
 * The public members of `T` only. A fake `implements PublicApi<Service>`, so
 * it still type-checks after the real class gains private dependencies, and
 * `npm run typecheck` fails when the fake drifts from the contract.
 */
export type PublicApi<T> = { [K in keyof T]: T[K] };
