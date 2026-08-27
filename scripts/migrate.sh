#!/usr/bin/env bash
#
# ===========================================================================
# migrate.sh — bring a database up to date with supabase/migrations/, then
# prove it, and fail if either half did not work.
# ===========================================================================
#
# THIS IS THE THING THAT REPLACES PASTING SQL INTO THE SUPABASE EDITOR.
#
# It does four things, in this order, and stops at the first one that fails:
#
#   1. Checks the migration files are named the way the tool can read.
#   2. Asks the database which migrations it has already run, and prints the
#      ones it has not.
#   3. Runs the missing ones, oldest first, each inside its own transaction.
#   4. Runs supabase/verify.sql against the database and fails if ANY
#      assertion comes back false — naming the ones that failed.
#
# It is safe to run twice. Step 2 is the reason: the database keeps a list of
# which files it has run, in a table called
# `supabase_migrations.schema_migrations`. A file already on that list is not
# run again, no matter how many times you run this script. That list is the
# whole point — "these files are safe to re-run" is not good enough, because
# 0004 contains a one-shot data repair and seed.sql would duplicate the
# catalogue.
#
# ---------------------------------------------------------------------------
# HOW YOU RUN IT
# ---------------------------------------------------------------------------
#
# Normally you do NOT. GitHub runs it for you on every deploy, and there is a
# "Run migrations" button in the repo's Actions tab for the days you want to
# run it without deploying. This section is for when you are at your own
# computer with a terminal open.
#
#   export SUPABASE_DB_URL='postgresql://postgres.abcd...:PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'
#   ./scripts/migrate.sh --dry-run     # says what it WOULD run, changes nothing
#   ./scripts/migrate.sh               # actually runs it
#
# To rehearse against a throwaway database on your own machine, with no cloud
# and nothing at risk:
#
#   ./scripts/verify-sql.sh --rehearse
#
# ---------------------------------------------------------------------------
# THE ONE SETTING: SUPABASE_DB_URL
# ---------------------------------------------------------------------------
#
# Supabase dashboard → your project → **Connect** (top of the page) →
# **Session pooler** → copy the URI. Replace `[YOUR-PASSWORD]` with your
# database password (Project Settings → Database → Reset database password if
# you do not have it written down).
#
# USE THE SESSION POOLER, NOT "DIRECT CONNECTION". The direct host answers on
# IPv6 only; GitHub's build machines have IPv4 only, so a direct URL works from
# your laptop and then fails in GitHub with a confusing "network unreachable".
# The pooler answers on both.
#
# If your database password contains any of  : / ? # [ ] @  then reset it to
# one without them. Those characters have a meaning inside a URL and the
# connection will fail in a way that looks like a wrong password.
#
# ---------------------------------------------------------------------------
# FLAGS
# ---------------------------------------------------------------------------
#
#   --dry-run            Print what would be applied. Touches nothing.
#   --baseline A B C     One-time only. Tell the database "these files have
#                        already been run, do not run them again" — for a
#                        database that was migrated by hand before this script
#                        existed. See BASELINING below.
#   --verify-only        Skip the migrating, just run the assertions.
#   --skip-verify        Migrate without running the assertions. Only for a
#                        half-broken database you are repairing by hand.
#
# ---------------------------------------------------------------------------
# BASELINING — read this once, do it once, never again
# ---------------------------------------------------------------------------
#
# The live database has had 0001, 0002, 0003 and 0004 pasted into it by hand.
# It has no record of that. If this script is pointed at it as-is, it sees an
# empty list and re-runs all four.
#
# So the FIRST run against the live database must be:
#
#   ./scripts/migrate.sh --baseline 0001 0002 0003 0004
#
# which writes those four onto the list without running them, and then goes on
# to run 0005 and 0006, which genuinely have not run. Every run after that is
# a plain `./scripts/migrate.sh`.
#
# In GitHub this is the "Baseline" box on the Run migrations workflow. Tick it
# once, ever.
#
# ---------------------------------------------------------------------------
# THE BACKUP GATE
# ---------------------------------------------------------------------------
#
# There are no undo files in this repo. A migration that does the wrong thing
# is undone by restoring a backup, and nothing else. So the first time this
# script runs against a database that has never been migrated by it — no list
# table yet — it REFUSES, and prints how to take a snapshot first. Set
# MIGRATE_ACK_BACKUP=yes (the "I have taken a backup" box in GitHub) to say you
# have done it.
#
# It only asks once. After the list table exists, later runs proceed without
# nagging, because by then every run is a small, known, forward step.
#
# ---------------------------------------------------------------------------
# WHY THE SUPABASE CLI AND NOT SOMETHING HAND-WRITTEN
# ---------------------------------------------------------------------------
#
# Because it was tested and it works with these exact filenames. Supabase
# documents its migrations as `<timestamp>_name.sql` and this repo has
# `0001_init.sql`, so the obvious worry was that adopting the official tool
# would force a rename of four files the live database has already run —
# which would be trading a small problem for a much worse one.
#
# Tested on a real PostgreSQL 16 and, since 2026-08-27, on a real PostgreSQL 17
# — the major the live Supabase project runs — with supabase CLI 2.116.0:
# `migration list`, `db push`, `db push --dry-run` and `migration repair` all
# read `0001_init.sql` correctly and record it on the list as version `0001`.
# No rename is needed and none is made.
#
# THE ONE SHARP EDGE, and the reason for the filename check below: the CLI
# reads the number before the first underscore and it must be DIGITS ONLY. A
# file called `0003b_fix.sql` or `0007-fix.sql` is not an error — it is
# **silently skipped**, and `db push` still exits 0 and still says "up to
# date". A migration that is never applied cannot fail; it just quietly is not
# there. So this script checks every filename itself, first, and refuses to go
# on if one would be skipped.
#
# Next migration file: `0007_something.sql`. Digits, underscore, lower case.
#
# ---------------------------------------------------------------------------
# WHEN IT REFUSES — a REQUEST is not a FAILURE
# ---------------------------------------------------------------------------
#
# This script stops for two very different reasons, and it now says out loud
# which one it is, in the first thing you see.
#
#   ACTION NEEDED (a request).  Nothing is wrong and nothing was changed. The
#   script is waiting on something only you can give it: a backup confirmed, or
#   a setting added. In GitHub it prints a blue notice and a "Action needed"
#   panel at the top of the run page. Do the one step it names and run it
#   again.
#
#   FAILED (a failure).  Something IS wrong — a migration file is misnamed, the
#   database cannot be reached, or an assertion the shop depends on came back
#   false. In GitHub it prints a red error and a "Migration failed" panel, and
#   the panel says whether the database had already been changed before it
#   stopped.
#
# BOTH exit non-zero, so both stop the deploy and both show a red cross in
# GitHub's list of runs. That is deliberate: `deploy.yml` will not roll out code
# unless this finishes green, and a green tick next to "nothing was migrated"
# is precisely how a schema and a deploy drift apart. The cross is not the
# message; the panel at the top of the run page is.

set -euo pipefail

# ---------------------------------------------------------------------------
# NOTHING IN THIS SCRIPT MAY PRINT $SUPABASE_DB_URL. It contains the database
# password. GitHub masks registered secrets in logs, but a URL assembled or
# echoed by hand is exactly how one escapes. Every command below either takes
# it as "$SUPABASE_DB_URL" or reads it from the environment.
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
VERIFY_SQL="$REPO_ROOT/supabase/verify.sql"

DRY_RUN=0
VERIFY_ONLY=0
SKIP_VERIFY=0
BASELINE_VERSIONS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)     DRY_RUN=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    --baseline)
      shift
      while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do
        BASELINE_VERSIONS+=("$1"); shift
      done
      ;;
    -h|--help)
      sed -n '2,158p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "migrate.sh: unknown option '$1'" >&2
      echo "Valid options: --dry-run --baseline <versions...> --verify-only --skip-verify" >&2
      exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# HOW A STOP IS REPORTED
# ---------------------------------------------------------------------------
#
# DEFECT THIS CLOSES — 2026-08-27, the owner's first real run against the live
# Supabase project. The backup gate below did exactly what it was built to do:
# it stopped before touching anything, and printed a page explaining how to take
# a snapshot first. It also exited non-zero — correctly, because the deploy must
# not proceed — so GitHub showed a red cross indistinguishable from the one a
# broken migration shows, with the reason forty lines down inside a collapsed
# log. It was reported as "error when push". A safety stop that reads as a
# breakage is a safety stop that eventually gets routed around, so the REASON
# now has to be the first thing on the run page, not the last thing in the log.
#
# Mechanism, from GitHub's workflow-commands documentation:
#   * $GITHUB_STEP_SUMMARY names a file — unique to each step — whose
#     GitHub-Flavored Markdown is rendered on the run page ABOVE the logs.
#     Written by appending (>>). 1 MiB per step; up to 20 step summaries shown.
#   * `::notice title=T::message` and `::error title=T::message` are echoed on
#     stdout and become the annotations in the run's header. One line each: a
#     newline ends the command and the rest prints as ordinary log text.
#
# NEITHER EXISTS ON HER LAPTOP. $GITHUB_STEP_SUMMARY is unset outside Actions,
# and a bare `::notice::` line in a terminal is noise. Every function here is a
# no-op when it is not running in Actions, and the local text is printed
# unchanged either way — the terminal output of this script is the same as it
# has always been, byte for byte.
# ---------------------------------------------------------------------------

# Where the workflow can read back what kind of stop this was, so its own
# summary step does not append a second panel contradicting this one.
MIGRATE_OUTCOME_FILE="${MIGRATE_OUTCOME_FILE:-}"
if [ -z "$MIGRATE_OUTCOME_FILE" ] && [ -n "${RUNNER_TEMP:-}" ]; then
  MIGRATE_OUTCOME_FILE="$RUNNER_TEMP/migrate-outcome"
fi

in_actions() { [ "${GITHUB_ACTIONS:-}" = "true" ]; }

# Reporting must never be able to fail the run it is reporting on — a read-only
# $RUNNER_TEMP or a full disk would otherwise turn a clean, explained stop back
# into the mystery this whole section exists to end. Hence the `|| true`s.
record_outcome() {
  [ -n "$MIGRATE_OUTCOME_FILE" ] || return 0
  printf '%s\n' "$1" > "$MIGRATE_OUTCOME_FILE" 2>/dev/null || true
}

annotate() { # annotate notice|error <title> <message>
  in_actions || return 0
  printf '::%s title=%s::%s\n' "$1" "$2" "$(printf '%s' "$3" | tr '\n' ' ')"
}

summary() { # GitHub-Flavored Markdown on stdin
  if [ -z "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat >/dev/null      # consume stdin so the caller's heredoc is not orphaned
    return 0
  fi
  cat >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || true
}

# stop <request|failure> <headline> <what happened to the database> <next step>
#
# The full operator-facing text is read from STDIN and printed to stderr
# unchanged. The four arguments are the short, scannable version, and they are
# what GitHub shows at the top of the page; the text from stdin is folded into a
# <details> block underneath it so the run page opens short and the whole
# message is still one click away.
#
# The body is fenced with FOUR backticks so a message containing a three-backtick
# fence could not break out of it.
stop() {
  local kind="$1" headline="$2" db_state="$3" next="$4"
  local body
  body="$(cat)"

  # Unchanged local output: the same text, on stderr, that this script has
  # always printed. Everything below this line is invisible outside Actions.
  printf '%s\n\n' "$body" >&2

  if [ "$kind" = request ]; then
    record_outcome request
    annotate notice "Action needed - nothing was changed" "$headline Next: $next"
    summary <<MD
## ⏸️ Action needed — nothing in your database was changed

**$headline**

$db_state

### Do this next

$next

---

**This run is marked ✗ on purpose, and nothing is broken.** The ✗ is what stops
the new code being rolled out against a database it has not been allowed to
update yet. It is the safety system working. Do the step above, run it again,
and it goes green.

<details><summary>The full message, exactly as printed in the log</summary>

\`\`\`\`text
$body
\`\`\`\`

</details>
MD
  else
    record_outcome failure
    annotate error "Migration FAILED - $headline" "$headline Next: $next"
    summary <<MD
## ❌ Migration failed — $headline

$db_state

### Do this next

$next

---

**Nothing was deployed.** The shop is still serving the version it was serving
before this run started.

<details><summary>The full message, exactly as printed in the log</summary>

\`\`\`\`text
$body
\`\`\`\`

</details>
MD
  fi
  exit 1
}

# A missing tool, a missing file, a database that will not answer. Always a
# FAILURE and never a request: it is not something anybody can fix by ticking a
# box, and nothing has been changed because nothing has run yet.
fail() {
  local msg="$*"
  stop failure "${msg%%$'\n'*}" \
    "Your database was **not** changed — this run stopped before it could apply anything." \
    "Read the message below. It names exactly what is missing and how to supply it." <<MSG

ERROR: $msg
MSG
}

# ---------------------------------------------------------------- the tools
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  # A REQUEST, not a failure: the code and the database are both fine, the
  # script simply has not been told which database to talk to.
  stop request \
    "The setting that says which database to use has not been filled in yet." \
    "Nothing was changed — without this setting there is nothing to connect to." \
    "Add a repository **secret** named \`SUPABASE_DB_URL\`, then run this again. Settings → Secrets and variables → Actions → Secrets. Get the value from Supabase: your project → Connect → **Session pooler** → copy the URI, and paste your database password where it says \`[YOUR-PASSWORD]\`." <<'MSG'

ERROR: SUPABASE_DB_URL is not set.

  In GitHub:  Settings -> Secrets and variables -> Actions -> Secrets tab,
              a secret named SUPABASE_DB_URL.
  On your own computer:
              export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres'

  Get the value from the Supabase dashboard: your project -> Connect ->
  Session pooler -> copy the URI, and put your database password where it
  says [YOUR-PASSWORD].

MSG
fi

SUPABASE_BIN="${SUPABASE_BIN:-supabase}"
command -v "$SUPABASE_BIN" >/dev/null 2>&1 || fail \
  "the 'supabase' command is not installed.
  Install it with:  npm install -g supabase
  or see https://supabase.com/docs/guides/local-development/cli/getting-started
  (GitHub installs it automatically; this message is for your own computer.)"

command -v psql >/dev/null 2>&1 || fail \
  "the 'psql' command is not installed — it is what runs supabase/verify.sql.
  Ubuntu/Debian:  sudo apt-get install -y postgresql-client
  macOS:          brew install libpq && brew link --force libpq"

[ -d "$MIGRATIONS_DIR" ] || fail "no such directory: $MIGRATIONS_DIR"
[ -f "$VERIFY_SQL" ]     || fail "no such file: $VERIFY_SQL"

echo "==> supabase CLI $("$SUPABASE_BIN" --version 2>/dev/null | tail -1)"

# ------------------------------------------------- 1. check the file names
#
# See "THE ONE SHARP EDGE" above. A filename the CLI cannot parse is skipped
# without an error, so this is checked here rather than discovered later by a
# customer.
shopt -s nullglob
ALL_FILES=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

[ "${#ALL_FILES[@]}" -gt 0 ] || fail \
  "no .sql files in $MIGRATIONS_DIR — this is a broken checkout, not an empty schema."

BAD=()
for f in "${ALL_FILES[@]}"; do
  base="$(basename "$f")"
  # digits, underscore, anything, .sql — exactly what the CLI's parser accepts.
  [[ "$base" =~ ^[0-9]+_.+\.sql$ ]] || BAD+=("$base")
done

if [ "${#BAD[@]}" -gt 0 ]; then
  # A FAILURE: a file in this repo is named in a way that would be ignored.
  # Somebody has to rename a file; no amount of ticking boxes fixes it.
  BAD_LIST=""
  for b in "${BAD[@]}"; do BAD_LIST="$BAD_LIST  - $b"$'\n'; done
  stop failure \
    "A migration file is named in a way the tool silently ignores." \
    "Your database was **not** changed. This is the check that stops a file being skipped without anybody noticing." \
    "Rename the file(s) listed below to \`<digits>_<description>.sql\` — for example \`0008_add_gift_notes.sql\` — and push again. **Do not rename a file that has already been applied to the live database.**" <<MSG

ERROR: these migration files would be SILENTLY SKIPPED, not applied:
$BAD_LIST
  The name must be digits, then an underscore, then a description, then .sql
  — for example 0007_add_gift_notes.sql. Letters or dashes in the number part
  ("0003b_", "0007-fix") make the tool ignore the file while still reporting
  success, which is worse than an error: the code goes live against a schema
  that was never changed.

  Rename the file(s) above and run this again. Do NOT rename anything that
  has already been applied to the live database.

MSG
fi
echo "==> ${#ALL_FILES[@]} migration file(s), all correctly named"

# ------------------------------------------------------ psql plumbing
# ON_ERROR_STOP so a failed statement aborts rather than carrying on to the
# next one; client_min_messages=warning to drop the wall of NOTICEs the
# `if not exists` guards emit. Errors and warnings still come through.
psql_q() { PGOPTIONS='-c client_min_messages=warning' psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"; }

echo "==> connecting to the database"
SERVER_VERSION="$(psql_q -Atc 'show server_version' 2>/dev/null)" || fail \
  "could not connect to the database.
  Check SUPABASE_DB_URL is the SESSION POOLER URI (not 'Direct connection'),
  and that the password in it is current. Supabase dashboard -> Connect."
echo "==> PostgreSQL $SERVER_VERSION"

LEDGER="$(psql_q -Atc "select to_regclass('supabase_migrations.schema_migrations')" || true)"

# ------------------------------------------------------ 2. the backup gate
#
# Only on a database that has never been migrated by this script. See
# THE BACKUP GATE above.
if [ -z "$LEDGER" ] && [ "$VERIFY_ONLY" = 0 ] && [ "$DRY_RUN" = 0 ]; then
  if [ "${MIGRATE_ACK_BACKUP:-}" != "yes" ]; then
    # THE ONE THAT WAS MISREAD AS A BREAKAGE. A REQUEST: everything works, the
    # script is asking a person to confirm a backup exists before it does
    # something that has no undo. Quoted heredoc — the body contains the literal
    # string $SUPABASE_DB_URL inside a command she is meant to copy, and it must
    # stay literal and unexpanded. See the no-printing-the-URL rule at the top.
    stop request \
      "This database has never been migrated by this system, and there is no undo. It is asking you to take a backup first." \
      "**Nothing has been changed.** This run stopped before touching the database." \
      "Take a backup (a minute — the log below tells you where the button is), then open **Actions → Run migrations → Run workflow**, tick **I have taken a backup**, put \`0001 0002 0003 0004\` in the baseline box, and run it. It only ever asks once." <<'MSG'

  ========================================================================
  STOP — TAKE A BACKUP FIRST. This is the first time migrations have been
  run against this database automatically, and there is no way to undo one.
  ========================================================================

  There are no "down" migrations in this repo. If a migration does something
  you did not want, the only way back is a backup you took before it ran.
  It takes about a minute.

  HOW TO TAKE ONE (Supabase dashboard, your project):

    Paid plans (Pro and up)
      Database -> Backups -> Point in Time -> confirm PITR is ON, and note
      the time right now. That is the moment you can rewind to.
      Or: Database -> Backups -> Scheduled backups -> check today's is there.

    Free plan — there are NO automatic backups at all, so do this:
      Either  Database -> Backups -> download the latest daily backup,
      or, from your own computer with the Supabase CLI installed:

        supabase db dump --db-url "$SUPABASE_DB_URL" -f backup-before-migration.sql

      Keep that file somewhere that is not this folder.

  WHEN YOU HAVE DONE IT:

    In GitHub — re-run the "Run migrations" workflow with the
      "I have taken a backup" box ticked.
    On your own computer —
      MIGRATE_ACK_BACKUP=yes ./scripts/migrate.sh --baseline 0001 0002 0003 0004

  Nothing has been changed. This run stopped before touching the database.

MSG
  fi
  echo "==> backup confirmed by the person running this (MIGRATE_ACK_BACKUP=yes)"
fi

# --------------------------------------------------------- 3. baselining
if [ "${#BASELINE_VERSIONS[@]}" -gt 0 ]; then
  if [ "$DRY_RUN" = 1 ]; then
    echo "==> --dry-run: would mark as already-applied: ${BASELINE_VERSIONS[*]}"
  else
    echo "==> marking as already-applied WITHOUT running them: ${BASELINE_VERSIONS[*]}"
    echo "    (this is the one-time baseline for a database migrated by hand)"
    "$SUPABASE_BIN" migration repair --yes --status applied "${BASELINE_VERSIONS[@]}" \
      --workdir "$REPO_ROOT" --db-url "$SUPABASE_DB_URL" --output-format text
  fi
fi

# ------------------------------------------------ 4. what is still pending
if [ "$VERIFY_ONLY" = 0 ]; then
  echo
  echo "==> migrations this database has run, and has not:"
  "$SUPABASE_BIN" migration list --workdir "$REPO_ROOT" --db-url "$SUPABASE_DB_URL" --output-format text || true
  echo

  if [ "$DRY_RUN" = 1 ]; then
    echo "==> --dry-run: these would be applied, and nothing else:"
    "$SUPABASE_BIN" db push --yes --dry-run --skip-vault --workdir "$REPO_ROOT" --db-url "$SUPABASE_DB_URL" --output-format text
    echo
    echo "Dry run finished. Nothing was changed."
    record_outcome ok
    summary <<'MD'
## ✅ Dry run finished — nothing was changed

This run only *reported* what it would do. The list of migrations it would apply
is in the **Migrate and verify** step below.

To actually apply them, run it again with **Just tell me what would happen**
unticked.
MD
    exit 0
  fi

  # ------------------------------------------------------- 5. apply them
  #
  # Each file runs inside its own transaction. Tested: a migration that
  # raises leaves nothing behind — the half-created table was rolled back,
  # the file was NOT added to the list, and the command exited 1. `set -e`
  # turns that into a stopped deploy, which is the whole requirement: code
  # must never go live against a schema that did not migrate.
  #
  # `--yes` because `db push` otherwise stops and asks "[Y/n]". On GitHub
  # there is nobody there to answer and the job would hang until it timed out.
  # What is about to run has already been printed above.
  echo "==> applying pending migrations"
  "$SUPABASE_BIN" db push --yes --skip-vault --workdir "$REPO_ROOT" --db-url "$SUPABASE_DB_URL" --output-format text
  echo "==> migrations applied"
fi

# ------------------------------------------------------- 6. the assertions
if [ "$SKIP_VERIFY" = 1 ]; then
  echo
  echo "WARNING: --skip-verify was passed. The schema was NOT checked."
  record_outcome ok
  # A warning, not a notice: the run is green and the schema was never checked,
  # which is the one green result in this system that does not mean what green
  # normally means here.
  if in_actions; then
    printf '::warning title=Schema was NOT checked::--skip-verify was passed, so the 126 assertions did not run. This green tick does not mean the database is correct.\n'
  fi
  summary <<'MD'
## ⚠️ Migrations applied, but the schema was **not** checked

`--skip-verify` was passed, so `supabase/verify.sql` did not run. This run is
green, and green here does **not** mean the database is correct — nothing looked.

Run **Actions → Run migrations** again without that flag to get a real answer.
MD
  exit 0
fi

echo
echo "==> running supabase/verify.sql against the database"
echo "    (it writes a few throwaway rows inside a transaction it rolls back,"
echo "     so it changes nothing and is safe against the live shop)"

# Unaligned, pipe-separated, so the pass column can be tested exactly. The
# pretty table printed below is rebuilt from the same rows, so what is shown
# and what is judged cannot drift apart.
set +e
RAW="$(psql_q -q -A -t -F '|' -f "$VERIFY_SQL" 2>&1)"
PSQL_STATUS=$?
set -e

# psql also emits command tags (BEGIN / INSERT 0 1 / ROLLBACK) between the
# selects verify.sql runs. Assertion rows are the ones shaped `label|t` or
# `label|f`.
ROWS="$(printf '%s\n' "$RAW" | grep -E '\|[tf]$' || true)"

if [ "$PSQL_STATUS" -ne 0 ] || [ -z "$ROWS" ]; then
  # A FAILURE. Note the database state below is NOT "unchanged": by this point
  # the migrations have run. It is the code rollout that has been stopped.
  stop failure \
    "The schema check could not run at all." \
    "The migrations **were** applied. What has been stopped is the rollout of the new code — the shop is still serving the previous version." \
    "Read the error in the block below. If it names something that does not exist — a table, a column, a function — then a migration did not do what it was supposed to, and the deploy has been stopped before the new code could run against a database that cannot serve it." <<MSG

ERROR: verify.sql did not complete.

$RAW

  READ THE ERROR ABOVE. If it names something that does not exist — a table,
  a column, a function — then a migration has not been applied, and this
  deploy has been stopped before the new code could run against a database
  that cannot serve it. That is the system working.

MSG
fi

printf '\n%-44s  %s\n' "assertion" "pass"
printf '%-44s  %s\n'  "--------------------------------------------" "----"
printf '%s\n' "$ROWS" | while IFS='|' read -r label pass; do
  printf '%-44s  %s\n' "$label" "$pass"
done

TOTAL="$(printf '%s\n' "$ROWS" | wc -l | tr -d ' ')"
FAILURES="$(printf '%s\n' "$ROWS" | grep '|f$' | cut -d'|' -f1 || true)"

echo
if [ -n "$FAILURES" ]; then
  FAILED_COUNT="$(printf '%s\n' "$FAILURES" | wc -l | tr -d ' ')"
  FAILED_LIST="$(printf '%s\n' "$FAILURES" | sed 's/^/  ✗ /')"
  # THE ONE THAT MUST READ AS A GENUINE FAILURE. The database HAS been changed
  # and a guarantee the shop depends on is not being kept. Red, and the headline
  # names the count so it is legible from the run list.
  stop failure \
    "$FAILED_COUNT of $TOTAL schema checks came back false." \
    "Your database **was** migrated. What has been stopped is the code rollout — the shop is still serving the previous version, so customers are unaffected." \
    "Each failing line below is a guarantee the shop depends on and the database is not currently keeping. These are the failures that otherwise only show up in production — a missing grant here means a customer can pay and no order is ever recorded. The schema needs fixing, then re-run." <<MSG

FAILED — $FAILED_COUNT of $TOTAL assertions came back false:
$FAILED_LIST

  Each line above is a guarantee the shop depends on and the database is not
  currently keeping. These are the failures that otherwise only show up in
  production — a missing grant here means a customer can pay and no order is
  ever recorded.

  The deploy has been stopped. The database HAS been migrated; it is the code
  rollout that did not happen, so the shop is still serving the previous
  version. Fix the schema, then re-run.

MSG
fi

echo "OK — all $TOTAL assertions passed."
echo
echo "A note on the count: verify.sql should return 126 rows as of 0007. A"
echo "SHORTER table is not a better result — it means an older copy of"
echo "verify.sql that never looked at part of the schema."

record_outcome ok
summary <<MD
## ✅ Database is up to date and all $TOTAL checks passed

Every migration this database had not run has been applied, and all $TOTAL
assertions in \`supabase/verify.sql\` came back true.

There should be **126** of them as of \`0007\`. A *shorter* table is not a better
result — it means an older copy of \`verify.sql\` that never looked at part of
the schema.
MD
