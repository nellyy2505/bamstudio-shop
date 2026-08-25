#!/usr/bin/env bash
#
# Runs supabase/verify.sql against a real PostgreSQL 16 from a clean database.
#
# CLAUDE.md describes doing this in Docker. Docker is not available in every
# environment this repo gets checked out into, so this script drives a locally
# installed PostgreSQL 16 (`apt install postgresql-16`) instead. The contract is
# the same one CLAUDE.md sets: apply the migration and the seed, run verify.sql,
# and every row it prints must be `t`.
#
# Supabase's SQL editor is not vanilla Postgres — the migration leans on things
# the hosted platform provides (the `anon`/`authenticated`/`service_role` roles,
# `auth.users`, `auth.uid()`). Those are recreated below as local stand-ins, in
# a heredoc rather than a separate .sql file so this script stays the single
# thing you have to copy to reproduce a run.
#
#   ./scripts/verify-sql.sh
#
# Exits non-zero if any assertion is not `t`, so it can gate a release.

set -euo pipefail

# Everything the harness owns lives outside the repo: the cluster is disposable
# scaffolding, not a project artefact, and must never end up in a commit.
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGWORK="${PGWORK:-/root/pgwork}"
PGDATA="${PGDATA:-$PGWORK/data}"
PGSOCK="${PGSOCK:-$PGWORK/run}"
PGPORT="${PGPORT:-5433}"
DBNAME="${DBNAME:-bamstudio_verify}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_DIR="$REPO_ROOT/supabase"

# The server refuses to run as root, so every server-side command is handed to
# the `postgres` system user. When the script is already running as postgres,
# `su` would prompt for a password — call through directly in that case.
as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then
    su postgres -c "$1"
  else
    bash -c "$1"
  fi
}

psql_run() {
  # client_min_messages=warning drops the wall of NOTICEs the migration's
  # `if not exists` / `drop ... if exists` idempotency guards emit on a fresh
  # database. They are noise, and they bury the output that matters; warnings
  # and errors still come through, and ON_ERROR_STOP still aborts the run.
  as_postgres "PGOPTIONS='-c client_min_messages=warning' $PGBIN/psql -h '$PGSOCK' -p '$PGPORT' -U postgres -v ON_ERROR_STOP=1 $*"
}

# ---------------------------------------------------------------- cluster
# initdb only on a genuinely missing data directory: re-running this script
# must not silently destroy a cluster someone is using for something else.
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "==> initdb $PGDATA"
  mkdir -p "$PGDATA" "$PGSOCK"
  chown -R postgres:postgres "$PGWORK"
  # trust auth over a unix socket only — the socket lives in $PGWORK, not
  # /var/run, so this cluster is not reachable by anything else on the box.
  as_postgres "$PGBIN/initdb -D '$PGDATA' -U postgres --auth=trust -E UTF8 --locale=C" >/dev/null
fi

mkdir -p "$PGSOCK"
chown -R postgres:postgres "$PGWORK"

if ! as_postgres "$PGBIN/pg_ctl -D '$PGDATA' status" >/dev/null 2>&1; then
  echo "==> starting PostgreSQL on port $PGPORT"
  # -h '' disables TCP: nothing outside this container needs to reach it.
  as_postgres "$PGBIN/pg_ctl -D '$PGDATA' -l '$PGWORK/server.log' -o \"-k '$PGSOCK' -h '' -p $PGPORT\" -w start" >/dev/null
fi

SERVER_VERSION="$(psql_run "-Atc 'show server_version'")"
case "$SERVER_VERSION" in
  16.*) ;;
  # verify.sql asserts things whose behaviour is version-sensitive (generated
  # columns, websearch_to_tsquery ranking). A pass on 15 or 17 would not be
  # evidence about the database this schema actually ships to.
  *) echo "ERROR: expected PostgreSQL 16, found $SERVER_VERSION" >&2; exit 2 ;;
esac
echo "==> PostgreSQL $SERVER_VERSION"

# ---------------------------------------------------------------- database
# Dropped and recreated every run. verify.sql wraps itself in begin/rollback so
# it leaves no trace, but the migration and seed do not — a baseline has to
# start from nothing or a stale object could mask a missing one.
echo "==> recreating database $DBNAME"
psql_run "-d postgres -Atc 'drop database if exists $DBNAME'" >/dev/null
psql_run "-d postgres -Atc 'create database $DBNAME'" >/dev/null

# ------------------------------------------------------------ Supabase shims
# Only what 0001_init.sql actually references. Roles are cluster-wide, so they
# survive the drop above and are created idempotently.
echo "==> applying Supabase prerequisites"
PREREQ_SQL=$(cat <<'SQL'
-- Supabase's three PostgREST roles. nologin is enough: nothing here connects
-- as them, the assertions only ask what they are *granted*.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- gen_random_uuid() is core in 16, but gen_random_bytes() — used by
-- next_order_number() for the anti-enumeration suffix — is not.
create extension if not exists pgcrypto;
-- Hosted Supabase puts extensions in their own schema and some SQL written
-- against it is qualified `extensions.`; create it so such a reference resolves.
create schema if not exists extensions;

-- auth.users stand-in. The migration references exactly two columns: `id`
-- (FK target from profiles/reviews/addresses/favourites/orders) and
-- `raw_user_meta_data` (read by the handle_new_user trigger). `email` is
-- carried too so the trigger can be exercised realistically by hand.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- STAND-IN, not the real thing. On Supabase auth.uid() reads the verified JWT;
-- here it reads a GUC any session can set, so RLS policies can be driven from
-- psql (`set local request.jwt.claim.sub = '<uuid>'`). Unset means anonymous,
-- which is why the nullif() matters: current_setting(..., true) returns '' for
-- a GUC that was set and then cleared, and ''::uuid would raise instead of
-- returning null the way the real function does.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
SQL
)

printf '%s\n' "$PREREQ_SQL" | psql_run "-d $DBNAME -q -f -" >/dev/null

echo "==> applying supabase/migrations/0001_init.sql"
# NB: CLAUDE.md and WORKLOG.md both say to pipe `schema.sql` — no such file
# exists. The migration IS the schema; that is what gets applied here.
psql_run "-d $DBNAME -q -f '$SQL_DIR/migrations/0001_init.sql'" >/dev/null

# 0002 adds the shipping columns and the rate cache. verify.sql asserts against
# both migrations, so skipping this one makes the harness fail on
# `products.weight_grams` rather than on anything real.
echo "==> applying supabase/migrations/0002_shipping.sql"
psql_run "-d $DBNAME -q -f '$SQL_DIR/migrations/0002_shipping.sql'" >/dev/null

echo "==> applying supabase/seed.sql"
psql_run "-d $DBNAME -q -f '$SQL_DIR/seed.sql'" >/dev/null

# ---------------------------------------------------------------- assertions
echo "==> running supabase/verify.sql"
# Unaligned pipe-separated output so the pass column can be tested exactly;
# the pretty table is rebuilt below from the same rows, so what gets printed
# and what gets judged can never drift apart.
RAW="$(psql_run "-d $DBNAME -q -A -t -F '|' -f '$SQL_DIR/verify.sql'")"

# psql still emits command tags (BEGIN/INSERT 0 1/ROLLBACK) for the statements
# verify.sql runs between its selects; assertion rows are the ones shaped
# `label|t` or `label|f`.
ROWS="$(printf '%s\n' "$RAW" | grep -E '\|[tf]$' || true)"

if [ -z "$ROWS" ]; then
  echo "ERROR: verify.sql produced no assertion rows" >&2
  printf '%s\n' "$RAW" >&2
  exit 1
fi

printf '\n%-40s  %s\n' "assertion" "pass"
printf '%-40s  %s\n' "----------------------------------------" "----"
printf '%s\n' "$ROWS" | while IFS='|' read -r label pass; do
  printf '%-40s  %s\n' "$label" "$pass"
done

TOTAL="$(printf '%s\n' "$ROWS" | wc -l | tr -d ' ')"
FAILED="$(printf '%s\n' "$ROWS" | grep -c '|f$' || true)"

echo
if [ "$FAILED" -gt 0 ]; then
  echo "FAIL: $FAILED of $TOTAL assertions did not return t"
  exit 1
fi
echo "OK: all $TOTAL assertions returned t"
