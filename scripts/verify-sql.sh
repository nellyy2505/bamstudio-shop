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
#
# ---------------------------------------------------------------------------
# TWO MODES
# ---------------------------------------------------------------------------
#
#   ./scripts/verify-sql.sh
#       The original one, unchanged. Builds a database from nothing, applies
#       every migration with psql, applies the seed, runs the assertions. This
#       answers "is the schema, as a whole, correct?"
#
#   ./scripts/verify-sql.sh --rehearse
#       REHEARSAL. Answers a different and more urgent question: "will the
#       thing that runs against the live shop work?" It builds a database
#       shaped like production — only the migrations that have actually been
#       applied there, and no ledger — and then hands it to `scripts/migrate.sh`,
#       the exact script GitHub runs on every deploy. That script does the
#       baselining, applies whatever is pending, and runs the assertions
#       itself.
#
#       Use this before a migration ever touches the real database. Nothing
#       leaves your machine and there is nothing to break.
#
#       Which migrations count as "already applied in production" is the
#       PROD_APPLIED list below. It is a fact about the live database, not
#       about this repo, so it is written down here rather than derived —
#       and it only ever needs touching again if someone applies a migration
#       by hand outside this system, which is the practice all of this exists
#       to end.
#
#       Needs the Supabase CLI (`npm install -g supabase`).

set -euo pipefail

# --------------------------------------------------------------- arguments
REHEARSE=0
for arg in "$@"; do
  case "$arg" in
    --rehearse) REHEARSE=1 ;;
    -h|--help)
      echo "usage: verify-sql.sh [--rehearse]"
      echo "  (no flags)  build the schema from nothing and run the assertions"
      echo "  --rehearse  rehearse the real deploy-time migration against a"
      echo "              production-shaped copy, using scripts/migrate.sh"
      exit 0 ;;
    *) echo "verify-sql.sh: unknown option '$arg' (try --help)" >&2; exit 2 ;;
  esac
done

# The migrations the LIVE Supabase project has had pasted into it by hand,
# before scripts/migrate.sh existed. Used only by --rehearse, to make the
# throwaway database look like the real one before the real runner is pointed
# at it. Baselining against an empty database would prove nothing: the
# interesting question is whether the runner correctly leaves these alone.
PROD_APPLIED=(0001 0002 0003 0004)

# Everything the harness owns lives outside the repo: the cluster is disposable
# scaffolding, not a project artefact, and must never end up in a commit.
#
# BOTH $PGWORK AND THE CHECKOUT MUST BE REACHABLE BY THE `postgres` USER.
# Every server-side command runs as `postgres` (see as_postgres below), and the
# migrations are read by the *server process*, not by the caller. A checkout
# under a 0700 home directory — /root on a stock container is exactly that —
# fails with a bare "Permission denied" on the first `psql -f`, which reads
# like a missing file and is not. Either check the repo out somewhere
# traversable, or `chmod o+x` the directories above it and set
# `PGWORK=/var/tmp/pgwork`.
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

-- THE TRAP THIS LINE EXISTS TO REPRODUCE.
--
-- On hosted Supabase, every table created in `public` is granted to anon and
-- authenticated the moment it is created, by a default privilege the platform
-- sets up. That is why 0002 and 0003 revoke explicitly instead of relying on
-- "we never granted it": without the revoke, a private table is readable with
-- the key that ships in the browser bundle.
--
-- Vanilla PostgreSQL has no such default. So a harness without this line
-- reports "anon cannot read staff" as PASS whether or not the revoke is there
-- — it is measuring the absence of a grant that Supabase would have made. Every
-- privacy assertion in verify.sql is worthless without it, and worse than
-- worthless, because it reads as evidence.
--
-- Verified by deleting a revoke from 0003 and watching the matching assertion
-- go red. If you change this, do that again.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- Hosted Supabase does NOT put extensions in `public` — it puts them in a
-- schema called `extensions`. Reproducing that here is the whole point: this
-- shim used to install pgcrypto into `public`, where it sat on the default
-- search_path and every SECURITY DEFINER function could see it. The harness
-- printed 29/29 while 0001_init.sql could not be applied to a real Supabase
-- project at all, because `next_order_number()` pins
-- `search_path = public` and could not resolve `gen_random_bytes`.
-- A green run has to mean the migration works on the database it ships to.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- gen_random_uuid() is core in 16, but gen_random_bytes() — used by
-- next_order_number() for the anti-enumeration suffix — is not.
create extension if not exists pgcrypto with schema extensions;

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

# ------------------------------------------------------------- migrations
# Every .sql in supabase/migrations/, in filename order, with no list to keep
# in step. The list used to be written out here by hand, and it fell behind
# twice: `0002_shipping.sql` sat unapplied for two rounds while `verify.sql`
# asserted against it, so the run stopped at `products.weight_grams` and the
# 29 shipping assertions were never executed. A hand-maintained list makes
# adding a migration a two-file change, and the file nobody remembers is this
# one — the failure is silent because a migration that is never applied cannot
# fail, it just takes its assertions with it.
#
# NB: CLAUDE.md and WORKLOG.md both say to pipe `schema.sql` — no such file
# exists. The migrations ARE the schema; that is what gets applied here.
#
# Numeric prefixes and `LC_ALL=C` together make the order the same everywhere:
# a glob sorts by the collation in force, and en_US.UTF-8 does not sort ASCII
# the way C does. Order is not cosmetic here — 0002 and 0003 both ALTER tables
# 0001 creates.
# nullglob so an empty directory yields an empty array rather than the literal
# pattern. The glob is collected into an array first and only then piped to
# sort: piping the unexpanded glob straight into `printf` would print one blank
# line when it matched nothing, the read loop would take that blank line for a
# migration, and the empty-directory check below would pass on a list holding
# one empty filename.
shopt -s nullglob
MIGRATION_FILES=("$SQL_DIR"/migrations/*.sql)
shopt -u nullglob

MIGRATIONS=()
if [ "${#MIGRATION_FILES[@]}" -gt 0 ]; then
  while IFS= read -r m; do
    MIGRATIONS+=("$m")
  done < <(printf '%s\n' "${MIGRATION_FILES[@]}" | LC_ALL=C sort)
fi

# An empty migrations directory means a bad checkout or a wrong path, not a
# database with nothing in it. Applying the seed on top of no schema would
# fail confusingly several steps later.
if [ "${#MIGRATIONS[@]}" -eq 0 ]; then
  echo "ERROR: no migrations found in $SQL_DIR/migrations" >&2
  exit 2
fi

if [ "$REHEARSE" = 1 ]; then
  # ---------------------------------------------------------- rehearsal
  # Apply ONLY what production has already had applied to it, exactly the way
  # production got it — by hand, with no record kept. Everything after this
  # point is scripts/migrate.sh doing what it will do to the real shop.
  for v in "${PROD_APPLIED[@]}"; do
    found=""
    for m in "${MIGRATIONS[@]}"; do
      case "$(basename "$m")" in "${v}_"*) found="$m" ;; esac
    done
    if [ -z "$found" ]; then
      echo "ERROR: PROD_APPLIED lists $v but supabase/migrations/ has no ${v}_*.sql" >&2
      echo "       Either the file was renamed — which it must not be, production has run it —" >&2
      echo "       or PROD_APPLIED at the top of this script is out of date." >&2
      exit 2
    fi
    echo "==> [as production did, by hand] $(basename "$found")"
    psql_run "-d $DBNAME -q -f '$found'" >/dev/null
  done

  echo "==> applying supabase/seed.sql (production has the catalogue in it)"
  psql_run "-d $DBNAME -q -f '$SQL_DIR/seed.sql'" >/dev/null

  echo
  echo "=========================================================================="
  echo " The throwaway database now looks like the live shop: ${PROD_APPLIED[*]}"
  echo " applied, and no record anywhere that they were. Handing it to"
  echo " scripts/migrate.sh — the same script GitHub runs on every deploy."
  echo "=========================================================================="
  echo

  # A unix-socket URL. Tested: the Supabase CLI and psql both accept this
  # form, so the rehearsal needs no TCP port open and nothing is reachable
  # from outside this machine.
  REHEARSAL_DB_URL="postgresql://postgres@localhost/$DBNAME?host=$PGSOCK&port=$PGPORT&sslmode=disable"

  # MIGRATE_ACK_BACKUP=yes: there is nothing here to back up, the database is
  # deleted and rebuilt on the next run. This is the ONE place that answer is
  # automatic, and it is safe precisely because the database is disposable.
  #
  # The baseline is passed on purpose. Watching migrate.sh apply only 0005 and
  # 0006 — and leave 0001-0004 alone — is the whole point of the rehearsal.
  echo "==> scripts/migrate.sh --baseline ${PROD_APPLIED[*]}"
  MIGRATE_ACK_BACKUP=yes \
  SUPABASE_DB_URL="$REHEARSAL_DB_URL" \
    "$REPO_ROOT/scripts/migrate.sh" --baseline "${PROD_APPLIED[@]}"

  echo
  echo "=========================================================================="
  echo " REHEARSAL PASSED. What just happened is what will happen to the live"
  echo " database on the next deploy, assuming the live one really is at"
  echo " ${PROD_APPLIED[*]}. Run migrate.sh --dry-run against the real one to"
  echo " confirm that before you trust it."
  echo "=========================================================================="
  exit 0
fi

for m in "${MIGRATIONS[@]}"; do
  echo "==> applying supabase/migrations/$(basename "$m")"
  psql_run "-d $DBNAME -q -f '$m'" >/dev/null
done

# Printed so a run says out loud how many migrations it applied. A drop in
# this number between two runs is the signature of the failure above.
echo "==> applied ${#MIGRATIONS[@]} migration(s)"

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
