#!/usr/bin/env bash
#
# Runs supabase/verify.sql against a real PostgreSQL from a clean database.
#
# ---------------------------------------------------------------------------
# WHICH PostgreSQL, AND WHY IT IS 17
# ---------------------------------------------------------------------------
#
# It targets **PostgreSQL 17 by default, because that is what the live Supabase
# project runs.** `scripts/migrate.sh` prints the live server's version on every
# run; on 2026-08-27 it printed `PostgreSQL 17.6`.
#
# DEFECT THIS CLOSES. This harness stood up PostgreSQL **16** and hard-refused
# anything else, so all 126 assertions had only ever been proved on a major
# version the shop does not use. Nobody chose that; 16 was simply what was
# installed the day it was written, and the version gate then froze the mistake
# in place and made it look deliberate.
#
# It is the same trap this file already carries two scars from — a stand-in for
# the hosted platform that failed to reproduce the platform's shape, and so
# printed green about a database the schema does not ship to. The `extensions`
# schema comment further down is one; the `alter default privileges` comment is
# the other. This is the third, and the rule the repo drew from the first two is
# assume the next stand-in is wrong too. So the version is no longer a constant
# buried at line 130:
#
#   * it is **named at the top of every run**, next to what production runs, so
#     drift is one line of output rather than an archaeology exercise;
#   * it is a **parameter** (`--pg-version 16`), so checking the other version
#     is a command rather than an edit;
#   * `--both` runs 16 and 17 back to back for exactly that check;
#   * an unavailable version is a **hard error naming how to install it**, never
#     a silent fall back to whatever happens to be on the box — falling back is
#     how this started.
#
# WHAT WAS FOUND WHEN 17 WAS FIRST RUN (2026-08-27): nothing. All 126 assertions
# returned `t` on both, with identical labels in identical order; the seven
# migrations, the seed and verify.sql emitted byte-identical NOTICE/WARNING
# output on both (none); and the two constructs this file used to name as
# version-sensitive — the stored generated `search_vector` and
# `websearch_to_tsquery` + `ts_rank` ordering in `search_products` — produced
# byte-identical tsvectors, parses and orderings on 16.13 and 17.11. The harness
# targets 17 anyway. Matching production is not a thing you do only once a
# difference has already cost you something.
#
# The container this was proved in is Ubuntu 24.04, whose own repositories stop
# at PostgreSQL 16 — 17 comes from PGDG. See the install hint below, and SETUP.md.
#
# CLAUDE.md describes doing this in Docker. Docker is not available in every
# environment this repo gets checked out into, so this script drives a locally
# installed PostgreSQL instead. The contract is the same one CLAUDE.md sets:
# apply the migration and the seed, run verify.sql, and every row it prints
# must be `t`.
#
# Supabase's SQL editor is not vanilla Postgres — the migration leans on things
# the hosted platform provides (the `anon`/`authenticated`/`service_role` roles,
# `auth.users`, `auth.uid()`). Those are recreated below as local stand-ins, in
# a heredoc rather than a separate .sql file so this script stays the single
# thing you have to copy to reproduce a run.
#
#   ./scripts/verify-sql.sh                 # PostgreSQL 17, what production runs
#   ./scripts/verify-sql.sh --pg-version 16 # the old target, for a comparison
#   ./scripts/verify-sql.sh --both          # 16 then 17, one after the other
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
#
#   Both modes take `--pg-version` and both refuse to run if that version is
#   not installed.

set -euo pipefail

# ------------------------------------------------- what production actually is
# Not a guess and not a default: `scripts/migrate.sh` prints the live server's
# version every time it connects, and on 2026-08-27 it printed `PostgreSQL
# 17.6`. This constant is the one place that fact is written down, and it is
# what an unqualified run of this script targets. If migrate.sh ever prints a
# different major against the live database, change this line and nothing else.
PROD_PG_MAJOR=17

# The pair `--both` runs, oldest first. 16 is here only so the version this
# harness used to be pinned to can still be compared against on demand; it is
# not a version anything ships to.
BOTH_PG_MAJORS=(16 17)

# --------------------------------------------------------------- arguments
REHEARSE=0
RUN_BOTH=0
PG_MAJOR="${PG_MAJOR:-$PROD_PG_MAJOR}"

while [ $# -gt 0 ]; do
  case "$1" in
    --rehearse) REHEARSE=1; shift ;;
    --both)     RUN_BOTH=1; shift ;;
    --pg-version)
      [ $# -ge 2 ] || { echo "verify-sql.sh: --pg-version needs a number, e.g. --pg-version 16" >&2; exit 2; }
      PG_MAJOR="$2"; shift 2 ;;
    --pg-version=*) PG_MAJOR="${1#*=}"; shift ;;
    -h|--help)
      echo "usage: verify-sql.sh [--rehearse] [--pg-version N | --both]"
      echo "  (no flags)      build the schema from nothing and run the assertions,"
      echo "                  against PostgreSQL $PROD_PG_MAJOR — the major the live"
      echo "                  Supabase database runs"
      echo "  --rehearse      rehearse the real deploy-time migration against a"
      echo "                  production-shaped copy, using scripts/migrate.sh"
      echo "  --pg-version N  test against major version N instead (must be installed)"
      echo "  --both          run the whole thing against ${BOTH_PG_MAJORS[*]}, in that order"
      exit 0 ;;
    *) echo "verify-sql.sh: unknown option '$1' (try --help)" >&2; exit 2 ;;
  esac
done

case "$PG_MAJOR" in
  ''|*[!0-9]*) echo "verify-sql.sh: --pg-version wants a major version number like 16 or 17, not '$PG_MAJOR'" >&2; exit 2 ;;
esac

# --both is a loop over the single-version path rather than a second code path
# through it. Re-running the whole script per version means the two runs cannot
# share a cluster, a database, a port or a stale variable, which is the only way
# "it passed on both" means anything.
if [ "$RUN_BOTH" = 1 ]; then
  PASSTHROUGH=()
  [ "$REHEARSE" = 1 ] && PASSTHROUGH+=(--rehearse)
  for v in "${BOTH_PG_MAJORS[@]}"; do
    echo
    echo "##########################################################################"
    echo "# PostgreSQL $v"
    echo "##########################################################################"
    # Each pass gets its own environment: the PG* variables below are derived
    # from the major, but an inherited PGDATA or PGPORT from the caller would
    # otherwise point both passes at the same cluster.
    env -u PGBIN -u PGWORK -u PGDATA -u PGSOCK -u PGPORT -u DBNAME -u PG_MAJOR \
      "${BASH_SOURCE[0]}" --pg-version "$v" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
  done
  echo
  echo "=========================================================================="
  echo " Both ${BOTH_PG_MAJORS[*]} finished. Production runs $PROD_PG_MAJOR."
  echo "=========================================================================="
  exit 0
fi

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
#
# PGBIN is LOOKED UP FROM THE MAJOR VERSION rather than defaulted to one path.
# A wrong-but-present binary is exactly the failure this whole file is about:
# whatever is first on $PATH is not evidence about anything.
if [ -z "${PGBIN:-}" ]; then
  for candidate in \
    "/usr/lib/postgresql/$PG_MAJOR/bin" \
    "/usr/pgsql-$PG_MAJOR/bin" \
    "/opt/homebrew/opt/postgresql@$PG_MAJOR/bin" \
    "/usr/local/opt/postgresql@$PG_MAJOR/bin"
  do
    if [ -x "$candidate/initdb" ]; then PGBIN="$candidate"; break; fi
  done
fi

if [ -z "${PGBIN:-}" ] || [ ! -x "$PGBIN/initdb" ]; then
  cat >&2 <<MSG
ERROR: PostgreSQL $PG_MAJOR is not installed here, and this script will not
       quietly test against a different one.

  Ubuntu/Debian:
    # Ubuntu's own repositories stop at 16 — 17 comes from PostgreSQL's:
    sudo apt-get install -y curl ca-certificates
    sudo install -d /usr/share/postgresql-common/pgdg
    sudo curl -fsS -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \\
      https://www.postgresql.org/media/keys/ACCC4CF8.asc
    . /etc/os-release && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt \$VERSION_CODENAME-pgdg main" \\
      | sudo tee /etc/apt/sources.list.d/pgdg.list
    sudo apt-get update && sudo apt-get install -y postgresql-$PG_MAJOR

  macOS:
    brew install postgresql@$PG_MAJOR

  Or point PGBIN at it yourself:  PGBIN=/path/to/pg$PG_MAJOR/bin $0
  Or test against a version you do have:  $0 --pg-version 16
MSG
  exit 2
fi

# Every path below carries the major version. Two majors cannot share a data
# directory — a 17 server refuses to start on a 16 one and says so obscurely —
# and they must not share a port either, or `--both` would find the first pass's
# server still listening and test 16 twice while printing 17.
PGWORK="${PGWORK:-/root/pgwork-pg$PG_MAJOR}"
PGDATA="${PGDATA:-$PGWORK/data}"
PGSOCK="${PGSOCK:-$PGWORK/run}"
PGPORT="${PGPORT:-$((5400 + PG_MAJOR))}"
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

# The server is asked what it is; the answer is not assumed from the path the
# binary was found at. Debian's `show server_version` answers
# `17.11 (Ubuntu 17.11-1.pgdg24.04+2)` while Supabase's answers a bare `17.6`,
# so only the leading major number is compared.
SERVER_VERSION="$(psql_run "-Atc 'show server_version'")"
SERVER_MAJOR="${SERVER_VERSION%%.*}"

if [ "$SERVER_MAJOR" != "$PG_MAJOR" ]; then
  # verify.sql asserts things whose behaviour could be version-sensitive
  # (generated columns, websearch_to_tsquery ranking). A pass on a version
  # nobody asked for is not evidence about anything, and silently accepting one
  # is the defect at the top of this file.
  echo "ERROR: asked for PostgreSQL $PG_MAJOR, but the server in $PGBIN is $SERVER_VERSION." >&2
  echo "       Refusing to report a result about a version you did not ask for." >&2
  echo "       (A stale cluster in $PGDATA from an older run is the usual cause —" >&2
  echo "        delete that directory and run this again.)" >&2
  exit 2
fi

echo "==> PostgreSQL $SERVER_VERSION  [testing against major $PG_MAJOR]"
if [ "$PG_MAJOR" = "$PROD_PG_MAJOR" ]; then
  echo "==> this is the major the live Supabase database runs. A green run here is"
  echo "    evidence about the database the shop actually ships to."
else
  echo "!!! NOTE: production runs PostgreSQL $PROD_PG_MAJOR, not $PG_MAJOR."
  echo "    A green run here is a COMPARISON, not evidence about the live database."
  echo "    Run ./scripts/verify-sql.sh with no --pg-version for that."
fi

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

-- gen_random_uuid() is core in 13+ (16 and 17 both), but gen_random_bytes() — used by
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
  echo " REHEARSAL PASSED, on PostgreSQL $SERVER_VERSION."
  echo
  echo " What just happened is what will happen to the live"
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
  echo "FAIL: $FAILED of $TOTAL assertions did not return t  (PostgreSQL $SERVER_VERSION)"
  exit 1
fi
# The version is repeated here on purpose. The first line of a run scrolls away;
# the last line is the one that gets pasted into a message saying "it passed",
# and "it passed" is worth nothing without "on what".
echo "OK: all $TOTAL assertions returned t  (PostgreSQL $SERVER_VERSION)"
