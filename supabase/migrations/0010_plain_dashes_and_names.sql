-- 0010_plain_dashes_and_names.sql - product copy loses its em dashes, and its
-- category suffix
--
-- Apply after 0009_collection_charm_product.sql.
--
-- ⚠️ THIS FILE CONTAINS EM DASHES ON PURPOSE, AND MUST KEEP THEM. They are
-- the text being searched for. A sweep that 'tidies' them turns every match
-- below into a no-op, and the catalogue silently keeps the punctuation this
-- migration exists to remove.
--
-- WHY.
--
-- Two decisions, one pass over the same rows, so the catalogue is never half
-- rewritten.
--
-- 1. NO EM DASHES ANYWHERE. `supabase/seed.sql` and `lib/fallback-data.ts` were
--    rewritten in the same commit, and `scripts/generate-seed.mjs` with them so
--    a regeneration produces the same text. A seed only runs into an empty
--    database, so without this the deployed catalogue would keep the old
--    punctuation while every other surface dropped it.
--
-- 2. THE NAME LOSES ITS CATEGORY SUFFIX. Names were generated as
--    "<product> - <category>": "Macaron - Clicker keychain". The category is
--    its own column and is shown beside the name on the product page, in the
--    admin list and in the shop grid, so the suffix repeated what was already
--    on screen - and it was the em dash a customer saw most, since the name is
--    what goes to Stripe checkout and into the order email.
--
--    `short_name` already held the bare name and is untouched; this brings
--    `name` into line with it.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH.
--
--   * `orders` and `order_lines`. A line records the name the customer bought
--     under, and rewriting that would falsify a record someone may still be
--     holding a receipt for. Old orders keep the old wording; that is correct.
--   * `price`. Prices are the Studio's.
--   * Migrations 0001 to 0007. Their column comments still contain em dashes.
--     Editing a migration that has already run is the one thing this project's
--     migration convention forbids (see the header of 0004), and a COMMENT ON
--     is not copy anybody reads on the site. They stay as they were applied.
--
-- Every statement is a plain string replace and is idempotent: run it twice and
-- the second pass matches nothing. A row edited in the Studio since is left
-- alone unless it still carries the exact old text.

begin;

-- 1. The two sentences every clicker shares.
update public.products
   set description = replace(
         description,
         'spring-loaded clicker inside — the fidget you keep reaching for',
         'spring-loaded clicker inside, the fidget you keep reaching for')
 where description like '%clicker inside — the fidget%';

update public.products
   set details = replace(
         details::text,
         'spring-loaded clicker inside — the fidget you keep reaching for',
         'spring-loaded clicker inside, the fidget you keep reaching for')::jsonb
 where details::text like '%clicker inside — the fidget%';

update public.products
   set details = replace(
         details::text,
         'hot cars and dishwashers — a wipe with a damp cloth is all it needs',
         'hot cars and dishwashers. A wipe with a damp cloth is all it needs')::jsonb
 where details::text like '%dishwashers — a wipe%';

-- 2. Gallery alt text: "Macaron — front view" becomes "Macaron, front view".
update public.products
   set gallery = replace(gallery::text, ' — front view', ', front view')::jsonb
 where gallery::text like '% — front view%';

-- 3. The three sports sets, the only products whose own name carried a dash.
update public.products
   set name        = replace(name,        ' set — racket & shuttlecock', ' set: racket and shuttlecock'),
       short_name  = replace(short_name,  ' set — racket & shuttlecock', ' set: racket and shuttlecock'),
       description = replace(description, ' set — racket & shuttlecock', ' set with racket and shuttlecock'),
       details     = replace(details::text, ' set — racket & shuttlecock', ' set with racket and shuttlecock')::jsonb,
       gallery     = replace(gallery::text, ' set — racket & shuttlecock', ' set: racket and shuttlecock')::jsonb
 where slug = 'badminton-set-racket-shuttlecock';

update public.products
   set name        = replace(name,        ' set — racket & ball', ' set: racket and ball'),
       short_name  = replace(short_name,  ' set — racket & ball', ' set: racket and ball'),
       description = replace(description, ' set — racket & ball', ' set with racket and ball'),
       details     = replace(details::text, ' set — racket & ball', ' set with racket and ball')::jsonb,
       gallery     = replace(gallery::text, ' set — racket & ball', ' set: racket and ball')::jsonb
 where slug = 'tennis-set-racket-ball';

update public.products
   set name        = replace(name,        ' set — bat, ball, glove', ' set: bat, ball and glove'),
       short_name  = replace(short_name,  ' set — bat, ball, glove', ' set: bat, ball and glove'),
       description = replace(description, ' set — bat, ball, glove', ' set with bat, ball and glove'),
       details     = replace(details::text, ' set — bat, ball, glove', ' set with bat, ball and glove')::jsonb,
       gallery     = replace(gallery::text, ' set — bat, ball, glove', ' set: bat, ball and glove')::jsonb
 where slug = 'baseball-set-bat-ball-glove';

-- 4. The letter and number rows, whose description carried two more.
update public.products
   set description = replace(
         description,
         'One row per letter you stock — copy this row down and change the SKU.',
         'One row per letter you stock. Copy this row down and change the SKU.'),
       details = replace(
         details::text,
         'One row per letter you stock — copy this row down and change the SKU.',
         'One row per letter you stock. Copy this row down and change the SKU.')::jsonb
 where description like '%letter you stock —%' or details::text like '%letter you stock —%';

update public.products
   set description = replace(
         description,
         'finished by hand. Same — one row per number you stock.',
         'finished by hand. Same again: one row per number you stock.'),
       details = replace(
         details::text,
         'finished by hand. Same — one row per number you stock.',
         'finished by hand. Same again: one row per number you stock.')::jsonb
 where description like '%Same — one row per number%' or details::text like '%Same — one row per number%';

-- 5. The category suffix. Run last, so the sports sets above have already had
--    their own dash dealt with and this only ever strips the generated tail.
update public.products
   set name = left(name, position(' — ' in name) - 1)
 where position(' — ' in name) > 1;

commit;
