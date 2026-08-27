/**
 * A fake `@/lib/supabase/server` for scripts/check-observability.mjs.
 *
 * Only what `app/api/track/route.ts` touches: `createAdminClient().rpc(...)`.
 * Deliberately much smaller than scripts/webhook-harness/fake-supabase.mjs —
 * that one models a query builder because the webhook writes; this route only
 * ever calls one RPC and the interesting cases are the two failure modes.
 */

export const store = {
  /** Every rpc call, in order, as { name, args }. */
  rpc: [],
  /** Set to a PostgrestError-shaped object to make the next rpc fail. */
  failWith: null,
  /** Set to an Error to make the next rpc throw rather than return an error. */
  throwWith: null,
  /** Rows the rpc returns when it succeeds. */
  rows: [],
};

export function resetStore() {
  store.rpc = [];
  store.failWith = null;
  store.throwWith = null;
  store.rows = [];
}

export function createAdminClient() {
  return {
    rpc: async (name, args) => {
      store.rpc.push({ name, args });
      if (store.throwWith) throw store.throwWith;
      if (store.failWith) return { data: null, error: store.failWith };
      return { data: store.rows, error: null };
    },
  };
}

export async function createClient() {
  return createAdminClient();
}
