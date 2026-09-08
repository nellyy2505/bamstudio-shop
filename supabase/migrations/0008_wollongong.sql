-- 0008_wollongong.sql - the studio moved from Sydney to Wollongong
--
-- Apply after 0007_lucky_scoop.sql.
--
-- WHY THIS IS A MIGRATION AND NOT A SEED EDIT.
--
-- `supabase/seed.sql` was updated in the same commit, but a seed only runs
-- into an empty database. Every product row on the live shop was inserted
-- weeks ago and carries the old sentence, so the seed edit alone would leave
-- the deployed catalogue naming a city the studio no longer prints in - and
-- the origin postcode used to price postage (`lib/shipping/dimensions.ts`,
-- now 2500) would disagree with the description on the page next to it.
--
-- WHAT IT TOUCHES, AND WHAT IT DELIBERATELY DOES NOT.
--
-- Only the phrase "in our Sydney studio", in `description` and in the
-- `details` JSON that repeats it. Ten product rows carry it; the other
-- thirty-four never mentioned a city at all.
--
-- It does NOT touch:
--   * `price` - prices are the Studio's to set, and a migration that quietly
--     repriced a product would be a number nobody could trace to a decision.
--   * anything on `orders` - an order placed while the studio was in Sydney
--     was fulfilled from Sydney. Rewriting history to match today's address
--     would falsify a record a customer may still be holding.
--   * the privacy page's "Fly.io ... Sydney region", which is in code and is
--     about where the SERVER runs. That really is Sydney and must stay so.
--
-- Written as a plain string replace rather than a rewrite of each row, so it
-- is idempotent: running it twice finds nothing to change the second time,
-- and a row edited in the Studio since is left alone unless it still carries
-- the exact old phrase.

begin;

update public.products
   set description = replace(description, 'in our Sydney studio', 'in our Wollongong studio')
 where description like '%in our Sydney studio%';

update public.products
   set details = replace(details::text, 'in our Sydney studio', 'in our Wollongong studio')::jsonb
 where details::text like '%in our Sydney studio%';

commit;
