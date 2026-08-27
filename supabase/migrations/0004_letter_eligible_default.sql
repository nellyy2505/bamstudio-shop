-- 0004_letter_eligible_default.sql — products.letter_eligible defaults to false
--
-- Apply after 0003_admin.sql.
--
-- THE DEFECT THIS CLOSES.
--
-- 0002_shipping.sql added `letter_eligible boolean not null default true`.
-- The code that reads the column says the opposite. `lib/shipping/weights.ts`
-- documents the contract in as many words — "**Absent means false.** An
-- unmeasured product is quoted as a parcel" — and `lib/shipping/select.ts`
-- rule 1 only counts a line as letter-eligible when the value is exactly
-- `true`. So the schema hands out, by default, the one answer the quoting
-- engine was written never to assume.
--
-- What that costs: a product row typed into the Supabase table editor arrives
-- claiming Large Letter eligibility. Large Letter is $3.40, untracked and
-- uninsured; the parcel it should have been quoted as is about $10.20 and
-- tracked. The undercharge is paid by the studio on every order until someone
-- reconciles a postage bill, and a lost letter is a reprint and a repost at
-- the studio's cost with nothing for the customer to look up. `letter_eligible`
-- is not a measurement, it is a judgement — flat enough, robust enough, not
-- something a sorting machine would crush — and a default is a judgement
-- nobody made.
--
-- Every estimate in `lib/shipping/dimensions.ts` rounds toward the shop
-- paying. This default was the one place in the schema that rounded the other
-- way.
--
-- WHY A NEW FILE AND NOT AN EDIT TO 0002.
--
-- 0002 has been applied. Editing an applied migration leaves the repo and the
-- live schema disagreeing with no way to tell which is right, which is a
-- worse defect than the one being fixed. Note also that the copy of 0002 in
-- this repo now reads `default false` while WORKLOG.md §6, HANDOFF.md item 9
-- and CLAUDE.md all still describe it as `default true` — the two cannot both
-- be describing the database that was actually pushed. This file is written
-- to be correct either way: on a database that already carries `false` the
-- repair below does not fire and the `set default` is a no-op.
--
-- Like 0001 and 0002, safe to re-run.

-- ------------------------------------------------------- the existing rows
--
-- ARE THEY WRONG, OR ONLY UNTRUSTWORTHY? Untrustworthy. A row holding `true`
-- because nobody typed anything is not a bad judgement, it is an absent one —
-- the item may well be letter-safe, and nothing here can tell. But an absent
-- judgement recorded as `true` is precisely what weights.ts's "absent means
-- false" rule exists to stop, and it is absent in the undercharging
-- direction. So it resolves to false.
--
-- The awkward part, stated plainly: the column records no provenance, so a
-- `true` the default wrote and a `true` the owner deliberately ticked are the
-- same byte. A blanket `update ... set letter_eligible = false` would undo the
-- owner's decisions as silently as the default made them.
--
-- Hence the gate. The repair runs only while the column's own default is
-- still `true` — that is, only on a database where the defect has actually
-- been live and nothing has fixed it yet. It therefore fires at most once,
-- before the `set default` below, and a re-run after that cannot touch a row
-- again. Ticks the owner makes from tomorrow are safe from this file forever.
--
-- On the shop as it stands the gate costs nothing either way: seed.sql writes
-- `false` explicitly for all 44 products (see scripts/generate-seed.mjs), and
-- WORKLOG.md §6 records enabling Large Letter as a business decision the owner
-- has not made, so no deliberate `true` exists yet. If one did, the cost of
-- clearing it is that the item goes back to quoting as a tracked parcel:
-- visible on the next cart, recoverable with one tick, and in the direction
-- the shop pays. The cost of leaving an accidental `true` is an untracked,
-- uninsured, undercharged delivery nobody notices.
do $$
declare
  default_expr text;
  repaired integer;
begin
  select pg_get_expr(d.adbin, d.adrelid)
    into default_expr
    from pg_attrdef d
    join pg_attribute a
      on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.products'::regclass
     and a.attname = 'letter_eligible';

  if default_expr = 'true' then
    update public.products
       set letter_eligible = false
     where letter_eligible;
    get diagnostics repaired = row_count;
    -- A warning, not a notice: verify-sql.sh runs with
    -- client_min_messages=warning, and a run that silently repaired rows is
    -- exactly the run someone needs to see afterwards.
    raise warning
      '0004: products.letter_eligible defaulted to true; cleared it on % row(s)',
      repaired;
  end if;
end
$$;

-- ------------------------------------------------------------- the default
-- Idempotent as written: setting a default that is already false changes
-- nothing. verify.sql asserts both this and the behaviour it produces, so a
-- future migration that flips it back cannot pass unnoticed.
alter table public.products
  alter column letter_eligible set default false;

-- The column comment in 0002 already describes the flag as the owner's manual
-- override. Restated here so the table editor, which is where the row gets
-- typed, also says what happens when the box is left alone.
comment on column public.products.letter_eligible is
  'Owner''s manual override: false forces this item to be quoted as a parcel '
  'however small the stored measurements look. It exists because bulk is not '
  'always captured by a bounding box — a bowl or a phone stand is rigid and '
  'awkward, and Large Letter is untracked and uninsured, so shipping one that '
  'way is a loss the studio wears. DEFAULTS TO FALSE: a new row is quoted as a '
  'parcel until someone has actually judged the item, which is what '
  'lib/shipping/weights.ts assumes. Ticking it is a per-product decision and '
  'needs the tracking wording checked with it — see WORKLOG.md §6.';
