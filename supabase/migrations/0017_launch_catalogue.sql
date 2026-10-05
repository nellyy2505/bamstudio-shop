-- 0017_launch_catalogue.sql - the catalogue the shop launches with
--
-- Apply after 0016_drop_theme_suffix.sql.
--
-- The owner photographed everything the studio actually makes today (5 October
-- 2026) and asked for exactly that to be on sale, with real photos and nothing
-- else showing. This migration:
--
--   1. hides every product that is not in the launch set (active = false, so
--      nothing is deleted and any of them can be switched back on in Studio);
--   2. adds the five new pieces that were photographed and had no row;
--   3. adds the bakery box and its ten fillings, and sets the box up
--      (colours, the one lid design that exists, the filling pool);
--   4. points every launch product at its photos, which ship with the site
--      under public/products/ (photos.path starting "/" is served from the
--      site itself, see lib/photos.ts).
--
-- PRICES. New rows are inserted at the owner's prices from 3D_Planner.xlsx,
-- Products column Z ("My price"), as she supplied them on 5 October. Prices on
-- rows that already existed are set in 0018, which says where each came from.
-- SKUs match the workbook's Products column B so the two can be reconciled.
--
-- The skull-and-bone hair pin (ACC-001) is listed under a generic name only.
-- The workbook records that it was restyled away from the licensed character
-- it was first modelled on, by the owner's decision of 5 October; it must not
-- be listed under that character's name.
--
-- Safe to re-run: inserts are `on conflict (sku) do nothing` or `do update` on
-- copy and photo columns only; prices on existing rows are never touched.

/* ---------------------------------- 0. let the shop read the fillings */

-- Fillings are products with active = false (sold only inside a box), and the
-- only read policy on products is `active = true`. So the anon key could not
-- see a single filling: /bakery always reported the box as not ready, and
-- checkout refused every box as "withdrawn". This second policy (policies are
-- OR'd) exposes exactly the rows in the live filling pool and nothing else.
drop policy if exists "box fillings are readable" on public.products;
create policy "box fillings are readable" on public.products
  for select using (
    exists (
      select 1 from public.bakery_fillings f
       where f.product_id = products.id and f.active
    )
  );

-- Runs only against a database that already holds the catalogue. A fresh
-- database (scripts/verify-sql.sh builds one from nothing, then loads
-- seed.sql) has no products yet, and inserting rows here would collide with
-- the seed. Production has the catalogue, so this always runs there.
do $launch$
begin
if exists (select 1 from public.products where slug = 'macaron') then

/* -------------------------------------------- 1. hide everything else */

update public.products
   set active = false
 where slug not in (
   'macaron',
   'matcha-set',
   'pancake-stack-in-frying-pan',
   'custom-name-charm',
   'heart-waffle',
   'love-cactus-planters',
   'moon-book-box',
   'perpetual-desk-calendar',
   'bakery-box',
   'skull-bone-hair-pin'
 )
   and active;

/* ----------------------------------------------- 2. the new pieces */

insert into public.products
  (sku, slug, name, short_name, category, theme, description, price, art, tint,
   colours, attachments, weight_grams, length_mm, width_mm, thickness_mm,
   is_new, active)
values
  ('CLK-080', 'heart-waffle', 'Heart waffle', 'Heart waffle',
   'Clicker keychain', 'Food',
   'A heart-shaped waffle sandwich with a swirl of cream in the middle. Pick classic brown or matcha green.',
   649,  -- workbook Products Z9
   'macaron', 'butter',
   '[{"name":"Brown","hex":"#8B5E3C"},{"name":"Matcha Green","hex":"#A9BC7F"}]'::jsonb,
   coalesce((select attachments from public.products where slug = 'macaron'), '[]'::jsonb),
   30, 60, 60, 25, true, true),

  ('CLK-081', 'love-cactus-planters', 'LOVE cactus planters', 'LOVE cactus planters',
   'Desk & home', 'Plants & flowers',
   'Four pink cacti in knitted-look pots that spell out LOVE, each topped with a tiny flower, on their own brown tray. Decorative, not for real plants.',
   1200, -- workbook Products Z18
   'tulip', 'blush',
   '[]'::jsonb, '[]'::jsonb,
   160, 180, 60, 90, true, true),

  ('BOX-001', 'moon-book-box', 'Moon book trinket box', 'Moon book trinket box',
   'Desk & home', 'Gifts',
   'A little spellbook box with a crescent moon on the cover. It opens to hold rings and small treasures. Choose black or baby blue.',
   800,  -- workbook Products Z20
   'macaron', 'sky',
   '[{"name":"Black","hex":"#2B2B2B"},{"name":"Baby Blue","hex":"#BCD3E8"}]'::jsonb,
   '[]'::jsonb,
   90, 80, 80, 60, true, true),

  ('DSK-001', 'perpetual-desk-calendar', 'Perpetual desk calendar', 'Perpetual desk calendar',
   'Desk & home', 'Desk',
   'Move the three round markers to the weekday, date and month. It works every year, so you never need a new one.',
   1500, -- workbook Products Z21
   'stand', 'cream',
   '[]'::jsonb, '[]'::jsonb,
   280, 160, 70, 150, true, true),

  ('ACC-001', 'skull-bone-hair-pin', 'Skull and bone hair pin', 'Skull and bone hair pin',
   'Hair & accessories', 'Accessories',
   'A speckled stone-grey skull with a bone-shaped pin. Twist your hair up, then slide the bone through the skull to hold it in place.',
   1000, -- workbook Products Z19
   'macaron', 'cream',
   '[]'::jsonb, '[]'::jsonb,
   60, 140, 50, 50, true, true)
on conflict (sku) do nothing;

/* --------------------------------------------- 3. the bakery box */

insert into public.products
  (sku, slug, name, short_name, category, theme, description, price, art, tint,
   colours, attachments, weight_grams, length_mm, width_mm, thickness_mm,
   personalisation_mode, is_personalised, bakery_piece_count, is_new, active)
values
  ('BAK-B04', 'bakery-box', 'Mini cake box', 'Mini cake box',
   'Bakery box', 'Food',
   'A tiny bakery box with a gingham frame and a clear window, on a keychain clip. Choose the box colour, then fill all four spots with mini pastries.',
   1200, -- workbook Products Z17, and the bakery_box rung in 0015
   'macaron', 'blush',
   '[]'::jsonb, '[]'::jsonb,
   70, 70, 70, 40,
   'bakery', true, 4, true, true)
on conflict (sku) do nothing;

-- The ten pieces. Sold inside a box, not on their own, so active = false
-- (0015's rule: the filling pool reads bakery_fillings, not products.active).
-- Price is not what a box charges; it is only there because the column needs
-- one, and is set so a filling switched on by mistake is not sold at $0.
insert into public.products
  (sku, slug, name, short_name, category, theme, description, price, art, tint,
   weight_grams, length_mm, width_mm, thickness_mm, active)
values
  ('BAK-101', 'filling-pink-sprinkle-donut',      'Pink sprinkle donut',      'Pink sprinkle donut',      'Bakery box', 'Food', 'Pink icing with chocolate and vanilla sprinkles.', 300, 'macaron', 'blush', 8, 25, 25, 10, false),
  ('BAK-102', 'filling-strawberry-donut',         'Strawberry donut',         'Strawberry donut',         'Bakery box', 'Food', 'A classic donut with smooth strawberry icing.',    300, 'macaron', 'blush', 8, 25, 25, 10, false),
  ('BAK-103', 'filling-vanilla-concha',           'Vanilla concha',           'Vanilla concha',           'Bakery box', 'Food', 'A sweet bun with a crackled vanilla topping.',     300, 'macaron', 'butter', 8, 25, 25, 12, false),
  ('BAK-104', 'filling-cookies-and-cream-concha', 'Cookies and cream concha', 'Cookies and cream concha', 'Bakery box', 'Food', 'Chocolate concha with a white crumb topping.',     300, 'macaron', 'cream', 8, 25, 25, 12, false),
  ('BAK-105', 'filling-strawberry-drizzle-donut', 'Strawberry drizzle donut', 'Strawberry drizzle donut', 'Bakery box', 'Food', 'Strawberry icing with a vanilla drizzle.',         300, 'macaron', 'blush', 8, 25, 25, 10, false),
  ('BAK-106', 'filling-chocolate-cruller',        'Chocolate cruller',        'Chocolate cruller',        'Bakery box', 'Food', 'A twisted cruller dipped in chocolate.',           300, 'macaron', 'cream', 8, 25, 25, 12, false),
  ('BAK-107', 'filling-chocolate-sprinkle-donut', 'Chocolate sprinkle donut', 'Chocolate sprinkle donut', 'Bakery box', 'Food', 'Chocolate icing with white sprinkles.',            300, 'macaron', 'cream', 8, 25, 25, 10, false),
  ('BAK-108', 'filling-butter-swirl-cookie',      'Butter swirl cookie',      'Butter swirl cookie',      'Bakery box', 'Food', 'A piped butter cookie swirl.',                     300, 'macaron', 'butter', 8, 25, 25, 10, false),
  ('BAK-109', 'filling-cream-tart',               'Cream tart',               'Cream tart',               'Bakery box', 'Food', 'A chocolate tart shell with a whipped cream top.', 300, 'macaron', 'cream', 8, 25, 25, 12, false),
  ('BAK-110', 'filling-iced-cinnamon-bun',        'Iced cinnamon bun',        'Iced cinnamon bun',        'Bakery box', 'Food', 'A cinnamon bun with a white icing drizzle.',       300, 'macaron', 'butter', 8, 25, 25, 12, false)
on conflict (sku) do nothing;

insert into public.bakery_fillings (product_id, sort_order, active)
select p.id, v.ord, true
  from (values
    ('filling-pink-sprinkle-donut', 10),
    ('filling-strawberry-donut', 20),
    ('filling-strawberry-drizzle-donut', 30),
    ('filling-chocolate-sprinkle-donut', 40),
    ('filling-vanilla-concha', 50),
    ('filling-cookies-and-cream-concha', 60),
    ('filling-chocolate-cruller', 70),
    ('filling-butter-swirl-cookie', 80),
    ('filling-cream-tart', 90),
    ('filling-iced-cinnamon-bun', 100)
  ) as v(slug, ord)
  join public.products p on p.slug = v.slug
on conflict (product_id) do nothing;

-- Box colours: the two that were photographed.
insert into public.bakery_box_colours (colour_id, sort_order, active)
select c.id, v.ord, true
  from (values ('Brown', 10), ('Baby Pink', 20)) as v(name, ord)
  join public.colours c on c.name = v.name
on conflict (colour_id) do update set active = true, sort_order = excluded.sort_order;

-- Lid designs: only the gingham frame with a window exists. The two seeded
-- placeholders (0015) are switched off rather than deleted.
update public.bakery_box_designs
   set name = 'Gingham window',
       blurb = 'A checked gingham frame around a clear window, so the pastries show.',
       has_window = true,
       active = true,
       sort_order = 10
 where slug = 'gingham';
update public.bakery_box_designs set active = false where slug in ('plain', 'window');

/* -------------------------------------------- 4. copy and photos */

-- Descriptions for the launch products that already existed.
update public.products
   set colours = '[{"name":"Brown","hex":"#8B5E3C"},{"name":"Matcha Green","hex":"#A9BC7F"},{"name":"Baby Pink","hex":"#F6CFD8"}]'::jsonb,
       description = 'A macaron keychain with a soft, satisfying click. Choose brown, matcha green or pink and clip it to your keys or bag.'
 where slug = 'macaron';
update public.products
   set description = 'A tiny speckled matcha bowl with a green top and its own whisk, on a ball chain. Made for matcha lovers.'
 where slug = 'matcha-set';
update public.products
   set description = 'A stack of fluffy pancakes in a little frying pan, finished with a pat of butter. Breakfast you can take anywhere.'
 where slug = 'pancake-stack-in-frying-pan';
update public.products
   set description = 'Spell a name, initials or a little word in clicky letter keycaps. Pick a colourway and clip it to your keys or bag.'
 where slug = 'custom-name-charm';

-- Product colours that were filament lists, not customer choices. Left as
-- they were, they showed a colour picker with options that do not exist.
update public.products set colours = '[]'::jsonb
 where slug in ('matcha-set', 'pancake-stack-in-frying-pan');

-- Photos, and which pieces lead the shop.
update public.products p
   set photos = v.photos::jsonb,
       is_bestseller = v.best,
       active = true
  from (values
    ('macaron',
     '[{"path": "/products/macaron/1.jpg", "alt": "Brown, matcha green and pink macaron keychains"}, {"path": "/products/macaron/2.jpg", "alt": "Pink macaron keychain with brown and green macarons"}, {"path": "/products/macaron/3.jpg", "alt": "Three macaron keychains on a desk"}, {"path": "/products/macaron/4.jpg", "alt": "Pink macaron keychain close up"}]',
     true),
    ('matcha-set',
     '[{"path": "/products/matcha-set/1.jpg", "alt": "Matcha bowl keychain with a whisk on the lid"}, {"path": "/products/matcha-set/2.jpg", "alt": "Three matcha bowl keychains from above"}, {"path": "/products/matcha-set/3.jpg", "alt": "Matcha bowl keychain on a ball chain"}, {"path": "/products/matcha-set/4.jpg", "alt": "Two matcha bowl keychains on a desk"}, {"path": "/products/matcha-set/5.jpg", "alt": "Matcha bowl keychains on a desk"}]',
     true),
    ('pancake-stack-in-frying-pan',
     '[{"path": "/products/pancake-stack-in-frying-pan/1.jpg", "alt": "Three pancake stack keychains in little black frying pans"}, {"path": "/products/pancake-stack-in-frying-pan/2.jpg", "alt": "Pancake keychains with a pat of butter on top"}, {"path": "/products/pancake-stack-in-frying-pan/3.jpg", "alt": "Pancake keychains on ball chains"}]',
     true),
    ('custom-name-charm',
     '[{"path": "/products/custom-name-charm/1.jpg", "alt": "Name keychains spelling BAM, FINN, CS and XO in different colourways"}, {"path": "/products/custom-name-charm/2.jpg", "alt": "BAM name charm and an A heart charm"}, {"path": "/products/custom-name-charm/3.jpg", "alt": "BAM name charm on a keyring clip with other charms"}, {"path": "/products/custom-name-charm/4.jpg", "alt": "Trays of printed letter keycaps sorted A to Z"}]',
     true),
    ('heart-waffle',
     '[{"path": "/products/heart-waffle/1.jpg", "alt": "Brown and matcha green heart waffle keychains"}, {"path": "/products/heart-waffle/2.jpg", "alt": "Brown heart waffle close up"}, {"path": "/products/heart-waffle/3.jpg", "alt": "Heart waffles with a swirl of cream"}]',
     false),
    ('love-cactus-planters',
     '[{"path": "/products/love-cactus-planters/1.jpg", "alt": "Four pink cacti in white pots spelling LOVE on a brown tray"}]',
     false),
    ('moon-book-box',
     '[{"path": "/products/moon-book-box/1.jpg", "alt": "Black book box with a white crescent moon on the lid"}, {"path": "/products/moon-book-box/2.jpg", "alt": "Baby blue and black moon book boxes, one open"}, {"path": "/products/moon-book-box/3.jpg", "alt": "Moon book boxes with a ring and necklace"}, {"path": "/products/moon-book-box/4.jpg", "alt": "Moon book boxes side by side"}]',
     false),
    ('perpetual-desk-calendar',
     '[{"path": "/products/perpetual-desk-calendar/1.jpg", "alt": "White perpetual calendar with day and month buttons on a grey stand"}, {"path": "/products/perpetual-desk-calendar/2.jpg", "alt": "Desk calendar next to small succulents"}, {"path": "/products/perpetual-desk-calendar/3.jpg", "alt": "Perpetual calendar front view"}, {"path": "/products/perpetual-desk-calendar/4.jpg", "alt": "Perpetual calendar close up"}]',
     false),
    ('bakery-box',
     '[{"path": "/products/bakery-box/1.jpg", "alt": "Open brown mini cake box holding four pastries"}, {"path": "/products/bakery-box/2.jpg", "alt": "Brown and pink cake boxes with mini pastries around them"}, {"path": "/products/bakery-box/3.jpg", "alt": "Mini cake box filled with four pastries"}]',
     true),
    ('skull-bone-hair-pin',
     '[{"path": "/products/skull-bone-hair-pin/1.jpg", "alt": "Grey skull and bone hair pin"}, {"path": "/products/skull-bone-hair-pin/2.jpg", "alt": "Skull and bone hair pin side view"}]',
     false)
  ) as v(slug, photos, best)
 where p.slug = v.slug;

-- The product page shows `details` as its accordion, with "Item details"
-- first, so it is rebuilt from the description above for every launch piece.
update public.products p
   set details = jsonb_build_array(
         jsonb_build_object('title', 'Item details', 'body', p.description),
         jsonb_build_object('title', 'Materials & care', 'body',
           case when p.category in ('Desk & home', 'Hair & accessories')
             then 'PLA bioplastic, printed in our Wollongong studio. Decorative, not food-safe. Dust with a soft brush and keep out of direct sun and hot cars.'
             else 'PLA bioplastic, printed in our Wollongong studio. Keep it out of hot cars and dishwashers. A wipe with a damp cloth is all it needs.'
           end),
         jsonb_build_object('title', 'Shipping & returns', 'body',
           case when p.is_personalised
             then 'Printed to order in 2–4 business days, then standard post (3–7 days) or express (1–3 days). Made just for you, so returnable only if faulty.'
             else 'Printed to order in 2–4 business days, then standard post (3–7 days) or express (1–3 days). 30-day returns on unused items.'
           end))
 where p.slug in ('macaron', 'matcha-set', 'pancake-stack-in-frying-pan',
                  'custom-name-charm', 'heart-waffle', 'love-cactus-planters',
                  'moon-book-box', 'perpetual-desk-calendar', 'bakery-box',
                  'skull-bone-hair-pin');

-- No reviews exist. products.rating defaults to 5.0 (0001), so every row
-- added above would otherwise carry five stars nobody gave it, which is what
-- verify.sql's 'no fabricated ratings' check exists to catch.
update public.products
   set rating = 0, review_count = 0
 where sku in ('CLK-080', 'CLK-081', 'BOX-001', 'DSK-001', 'ACC-001', 'BAK-B04')
    or sku like 'BAK-1%';

-- Filling photos: one top-down shot each.
update public.products p
   set photos = jsonb_build_array(jsonb_build_object(
         'path', '/products/' || p.slug || '/1.jpg',
         'alt', p.name))
 where p.sku like 'BAK-1%';

end if;
end
$launch$;
