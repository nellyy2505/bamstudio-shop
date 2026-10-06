-- 0019_name_charm_photos.sql - take the plain row of name charms off the shop
--
-- Apply after 0018_pricing_model.sql.
--
-- On 6 October 2026 the owner asked that the photo of name charms laid out flat
-- in rows (IMG_1243, shipped as /products/custom-name-charm/1.jpg) appear
-- nowhere on the site. It was the name charm's first photo, so it showed on the
-- product page and faded in on hover over the card. The file itself is deleted
-- in the same commit; this removes it from the product's photo list so nothing
-- points at a missing image.
--
-- Also dropped: 3.jpg, a near-duplicate of 2.jpg (same BAM charm, same angle).
-- The tray of sorted letter keycaps (4.jpg) moves to the front, as she asked.
--
-- Edits the list rather than replacing it, so a photo added in the studio since
-- 0017 is kept. Safe to re-run: removing an absent path and re-ordering an
-- already-ordered list are both no-ops. On an empty database (the harness) the
-- row does not exist and the update touches nothing.

update public.products p
   set photos = (
     select coalesce(jsonb_agg(elem order by
              case when elem->>'path' = '/products/custom-name-charm/4.jpg' then 0 else 1 end,
              ord), '[]'::jsonb)
       from jsonb_array_elements(p.photos) with ordinality as t(elem, ord)
      where elem->>'path' not in ('/products/custom-name-charm/1.jpg',
                                  '/products/custom-name-charm/3.jpg')
   )
 where p.slug = 'custom-name-charm'
   and jsonb_typeof(p.photos) = 'array';
