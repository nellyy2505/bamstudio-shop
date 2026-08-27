/**
 * A fake `@/lib/supabase/server` for scripts/check-webhook.mjs.
 *
 * Enough of PostgREST's query builder for the Stripe webhook and the checkout
 * route to run against real data, in memory, with every call recorded. It is
 * NOT a Postgres: it does not enforce constraints and it does not pretend to.
 * The schema's own guarantees are proved by supabase/verify.sql against a real
 * PostgreSQL 16; what this proves is the thing that file cannot — which calls
 * the route makes, in which order, and what status it returns.
 *
 * One deliberate exception: the mutual-exclusion rule on `order_items` IS
 * enforced here, because a route writing a line that carries both a product id
 * and a tier id is exactly the defect this harness exists to catch, and a fake
 * that silently accepted it would report a pass.
 */

export const store = {
  tables: { orders: [], order_items: [], payment_incidents: [], products: [] },
  rpc: [],
  /** Every terminal operation, in order, as `table.op`. */
  calls: [],
  /** Set a table name here to make its next insert fail. */
  failNextInsert: null,
  /** Set a table name here to make its next select fail. */
  failNextSelect: null,
  orderNumberSeq: 1000,
};

export function resetStore() {
  store.tables = {
    orders: [],
    order_items: [],
    payment_incidents: [],
    products: [],
  };
  store.rpc = [];
  store.calls = [];
  store.failNextInsert = null;
  store.failNextSelect = null;
  store.orderNumberSeq = 1000;
}

let idSeq = 0;
const nextId = (prefix) => `${prefix}-${++idSeq}`;

/**
 * Column defaults the real schema applies and a JavaScript object does not.
 *
 * `orders.stock_applied` is `not null default false` (0001_init.sql), and the
 * webhook's stock claim is a compare-and-set on exactly that value:
 * `.eq("stock_applied", false)`. Without the default an inserted row carries
 * `undefined` there, the claim matches nothing, and the rebuild path silently
 * moves no stock at all — a fake reporting a defect the schema does not have.
 */
const DEFAULTS = {
  orders: {
    stock_applied: false,
    order_number: null,
    confirmation_email_sent_at: null,
    tracking_number: null,
  },
  order_items: { variant_label: "" },
};

/** `select("a, b, c")` — plus the embedded `order_items(...)` PostgREST form. */
function parseColumns(columns) {
  if (!columns || columns === "*") return { fields: null, embeds: [] };
  const embeds = [];
  const stripped = columns.replace(/(\w+)\(([^()]*)\)/g, (_, table, inner) => {
    embeds.push({ table, fields: inner.split(",").map((f) => f.trim()) });
    return "";
  });
  const fields = stripped
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  return { fields: fields.length > 0 ? fields : null, embeds };
}

function project(row, { fields, embeds }, table) {
  const out = fields === null ? { ...row } : {};
  for (const field of fields ?? []) out[field] = row[field];
  for (const embed of embeds) {
    if (embed.table === "order_items" && table === "orders") {
      out.order_items = store.tables.order_items
        .filter((item) => item.order_id === row.id)
        .map((item) => {
          const picked = {};
          for (const field of embed.fields) picked[field] = item[field];
          return picked;
        });
    }
  }
  return out;
}

class Builder {
  constructor(table) {
    this.table = table;
    this.op = "select";
    this.columns = "*";
    this.filters = [];
    this.payload = null;
    this.mode = null;
  }

  select(columns = "*") {
    if (this.op === "select") this.columns = columns;
    else this.returning = columns;
    return this;
  }
  insert(payload) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload, options) {
    this.op = "upsert";
    this.payload = payload;
    this.options = options;
    return this;
  }
  update(payload) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column, value) {
    this.filters.push(["eq", column, value]);
    return this;
  }
  is(column, value) {
    this.filters.push(["is", column, value]);
    return this;
  }
  in(column, values) {
    this.filters.push(["in", column, values]);
    return this;
  }
  limit() {
    return this;
  }
  order() {
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }

  matches(row) {
    return this.filters.every(([kind, column, value]) => {
      if (kind === "eq") return row[column] === value;
      // `.is(column, null)` must match a column that was never supplied.
      // Postgres stores an omitted column as NULL; a JavaScript object stores it
      // as `undefined`, and taking those for different things made every
      // rebuilt order look as though a concurrent delivery had numbered it.
      if (kind === "is") return (row[column] ?? null) === value;
      if (kind === "in") return value.includes(row[column]);
      return false;
    });
  }

  run() {
    const rows = store.tables[this.table] ?? [];
    store.calls.push(`${this.table}.${this.op}`);

    if (this.op === "select") {
      if (store.failNextSelect === this.table) {
        store.failNextSelect = null;
        return { data: null, error: { message: "simulated read failure" } };
      }
      const shape = parseColumns(this.columns);
      const found = rows
        .filter((row) => this.matches(row))
        .map((row) => project(row, shape, this.table));
      if (this.mode === "maybeSingle") return { data: found[0] ?? null, error: null };
      if (this.mode === "single") {
        return found[0]
          ? { data: found[0], error: null }
          : { data: null, error: { message: "no rows" } };
      }
      return { data: found, error: null };
    }

    if (this.op === "insert" || this.op === "upsert") {
      if (store.failNextInsert === this.table) {
        store.failNextInsert = null;
        return { data: null, error: { message: "simulated write failure" } };
      }
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];

      // PostgREST refuses a bulk insert whose objects do not all carry the same
      // keys ("All object keys must match"). A mixed basket is exactly where
      // that bites, so the fake refuses it too.
      if (incoming.length > 1) {
        const shape = Object.keys(incoming[0]).sort().join(",");
        for (const row of incoming) {
          if (Object.keys(row).sort().join(",") !== shape) {
            return {
              data: null,
              error: { message: "All object keys must match" },
            };
          }
        }
      }

      const written = [];
      for (const row of incoming) {
        if (
          this.table === "order_items" &&
          row.product_id != null &&
          row.scoop_tier_id != null
        ) {
          return {
            data: null,
            error: {
              message:
                'new row violates check constraint "order_items_scoop_or_product_check"',
            },
          };
        }
        if (this.op === "upsert" && this.options?.ignoreDuplicates) {
          const key = this.options.onConflict;
          if (rows.some((existing) => existing[key] === row[key])) continue;
        }
        const stored = {
          id: nextId(this.table),
          ...(DEFAULTS[this.table] ?? {}),
          ...row,
        };
        rows.push(stored);
        written.push(stored);
      }
      store.tables[this.table] = rows;
      if (this.mode === "single") {
        return written[0]
          ? { data: written[0], error: null }
          : { data: null, error: { message: "nothing inserted" } };
      }
      return { data: written, error: null };
    }

    if (this.op === "update") {
      const changed = [];
      for (const row of rows) {
        if (!this.matches(row)) continue;
        Object.assign(row, this.payload);
        changed.push(row);
      }
      return { data: changed, error: null };
    }

    if (this.op === "delete") {
      const kept = rows.filter((row) => !this.matches(row));
      store.tables[this.table] = kept;
      return { data: null, error: null };
    }

    return { data: null, error: { message: `unsupported op ${this.op}` } };
  }

  then(resolve, reject) {
    try {
      resolve(this.run());
    } catch (error) {
      reject(error);
    }
  }
}

export function createAdminClient() {
  return {
    from: (table) => new Builder(table),
    rpc: async (name, args) => {
      store.rpc.push({ name, args });
      store.calls.push(`rpc.${name}`);
      if (name === "next_order_number") {
        return { data: `BS-${++store.orderNumberSeq}`, error: null };
      }
      if (name === "decrement_stock") {
        return { data: 0, error: null };
      }
      return { data: null, error: null };
    },
  };
}

export async function createClient() {
  return createAdminClient();
}

export async function getUser() {
  return null;
}
