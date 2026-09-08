-- 0009_collection_charm_product.sql - a colourway's charm becomes a real product
--
-- Apply after 0008_wollongong.sql.
--
-- WHY.
--
-- `collections` described its charm with `charm_art` and `charm_name` - a
-- picture and a label. That was enough while the charm was included in the
-- builder's bundle price and dropping it took a flat dollar off: the charm had
-- no price of its own because it was never priced.
--
-- The pricing decision of 7 September changes that. Letter caps are now sold on
-- their own ($3.99 for the first, $1.49 for each after), the charm is an opt-in
-- extra, and it is priced as **the charm's own retail price less
-- BUILDER_CHARM_BUNDLE_DISCOUNT**. A price expressed relative to another
-- product's price needs a pointer to that product; a copy of the number would
-- drift the first time a charm is repriced in the Studio, and it would drift
-- silently, in the studio's favour or the customer's depending on which way the
-- charm moved.
--
-- So the pointer is the column, and the price stays in exactly one place.
--
-- WHY A SLUG AND NOT AN id.
--
-- `products.slug` is unique and is already the key the checkout route, the cart
-- and the webhook's rebuild path all pass around; `id` appears in none of those
-- payloads. A real foreign key on it gets the referential guarantee without
-- introducing a second way to name a product. `on delete restrict` is the point
-- of the constraint: deleting a product that a live colourway sells as its
-- charm should fail loudly, not leave a colourway pointing at nothing on the
-- one page where a customer is choosing.
--
-- NULLABLE, deliberately. A colourway with no charm product is a colourway that
-- cannot offer the add-on - the builder hides the option rather than guessing a
-- price. That is the honest failure, and it is also what a newly inserted
-- colourway looks like before anyone has chosen its charm.

begin;

alter table public.collections
  add column if not exists charm_slug text
    references public.products(slug) on delete restrict;

comment on column public.collections.charm_slug is
  'The product sold as this colourway''s add-on charm. Its price, less '
  'BUILDER_CHARM_BUNDLE_DISCOUNT, is what the builder charges. Null = this '
  'colourway offers no charm.';

-- The six seeded colourways, matched to the clicker each one already named in
-- `charm_name`. Written as a lookup rather than six statements so a colourway
-- added later is left alone, and so re-running finds nothing to do.
update public.collections as c
   set charm_slug = v.slug
  from (values
    ('retro-key',       'tiramisu-cake'),
    ('strawberry-milk', 'ice-cream-cone'),
    ('matcha-latte',    'matcha-set'),
    ('blueberry',       'macaron'),
    ('mono',            's-mores'),
    ('butter-toast',    'butter')
  ) as v(collection_slug, slug)
 where c.slug = v.collection_slug
   and c.charm_slug is distinct from v.slug
   and exists (select 1 from public.products p where p.slug = v.slug);

commit;
