-- 0011_unpublish_workbook_notes.sql - take the owner's working notes off the
-- shopfront
--
-- Apply after 0010_plain_dashes_and_names.sql.
--
-- WHAT WENT WRONG.
--
-- `scripts/generate-seed.mjs` appended the workbook's Notes column to every
-- product description. That column serves two masters. Some of it is customer
-- copy - "Basket is part of the product" - and some of it is the owner thinking
-- out loud. Both were published.
--
-- Live on bamstudioshop.com, on /product/custom-name-charm, an ordinary visitor
-- could read: "Their 7 base colours x 6 letter colours is a smart, cheap way to
-- look like a range." The pet bowl carried "Personalisation is where the margin
-- is." Neither is a defect a customer can see the harm in, and both are the
-- kind of sentence a competitor screenshots.
--
-- The generator now publishes an explicit per-SKU allowlist instead of the
-- column, so it fails closed: a note that is not listed does not reach a
-- customer, and adding one is a line of code rather than a cell edit. This
-- migration does the same to the rows already in the database, since a seed
-- only runs into an empty one.
--
-- WHAT IS REMOVED, AND WHAT STAYS.
--
-- Removed: the four production and margin notes below. Kept, because they tell
-- a customer something true about the object they are buying: "Basket is part
-- of the product", "Pan is part of the product", "Latte art on the surface",
-- the two dog-breed lists, "From the Valentine set", "Cube letters on a cord",
-- "Anniversary dates, 143, jersey numbers", the ball list, and "Came from a
-- custom request".
--
-- Each fragment carries its own leading space, which is how the generator
-- joined it, so removing it leaves "finished by hand. Theme: ..." with single
-- spacing and no orphaned punctuation. Idempotent: a second run matches
-- nothing.

begin;

do $$
declare
  frag text;
  frags text[] := array[
    ' Pot-based, same pot shape across the range.',
    ' Design as a potted plant, not a flat flower head.',
    ' One row per letter you stock. Copy this row down and change the SKU.',
    ' Same again: one row per number you stock.',
    ' Their 7 base colours x 6 letter colours is a smart, cheap way to look like a range.',
    ' Personalisation is where the margin is.'
  ];
begin
  foreach frag in array frags loop
    update public.products
       set description = replace(description, frag, '')
     where position(frag in description) > 0;

    update public.products
       set details = replace(details::text, frag, '')::jsonb
     where position(frag in details::text) > 0;
  end loop;
end $$;

commit;
