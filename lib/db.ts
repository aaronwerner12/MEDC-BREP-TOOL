import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Single Neon HTTP client, shared across routes and the ingester.
// `sql` is a tagged template: sql`select ...` returns the result rows.
// Interpolated values are sent as bound parameters, never string-concatenated.
//
// The client is created lazily on first query, not at import time, so that a
// build (Vercel, CI) can import route modules without DATABASE_URL present.
// Missing config surfaces as a clear error only when a query actually runs.
let cached: NeonQueryFunction<false, false> | undefined;

function client(): NeonQueryFunction<false, false> {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = neon(url);
  }
  return cached;
}

// Forward tagged-template calls and any property access (.query, .transaction)
// to the lazily-created client.
export const sql: NeonQueryFunction<false, false> = new Proxy(
  (() => undefined) as unknown as NeonQueryFunction<false, false>,
  {
    apply(_target, _thisArg, args: unknown[]) {
      return (client() as (...a: unknown[]) => unknown)(...args);
    },
    get(_target, prop, receiver) {
      return Reflect.get(client() as object, prop, receiver);
    },
  }
);
