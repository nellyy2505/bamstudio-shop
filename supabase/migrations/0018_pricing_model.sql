-- 0018_pricing_model.sql - the owner's pricing model of 5 October 2026
--
-- Apply after 0017_launch_catalogue.sql.
--
-- Prices are normally the Studio's to set on screen, not a migration's (see
-- CLAUDE.md). This one is the exception the owner asked for: on 5 October she
-- supplied 3D_Planner.xlsx as the pricing model and asked for the shop to be
-- brought into line with it before launch. Every figure below names the cell
-- it came from, so each one traces back to her decision rather than to code.
--
-- Safe to re-run: every statement sets an absolute value.

/* ------------------------------------------------ 1. product prices */
-- Products sheet, column Z ("My price"). The four new pieces were inserted at
-- their Z prices by 0017; these are the rows that already existed.

update public.products set price = 649 where slug = 'macaron';                      -- Z6
update public.products set price = 649 where slug = 'pancake-stack-in-frying-pan';  -- Z7
update public.products set price = 649 where slug = 'matcha-set';                   -- Z8
update public.products set price = 649 where slug = 'heart-waffle';                 -- Z9
update public.products set price = 1200 where slug = 'love-cactus-planters';        -- Z18
update public.products set price = 1000 where slug = 'skull-bone-hair-pin';         -- Z19
update public.products set price = 800  where slug = 'moon-book-box';               -- Z20
update public.products set price = 1500 where slug = 'perpetual-desk-calendar';     -- Z21
update public.products set price = 1200 where slug = 'bakery-box';                  -- Z17

-- The name charm is priced by the letter ladder; its row price is the 1-letter
-- rung (Keycaps H25), which is what the shop shows as "From".
update public.products set price = 350 where slug = 'custom-name-charm';

/* -------------------------------------------------- 2. the ladders */
-- Keycaps H25:H29, and the bakery box at Products Z17.
insert into public.builder_pricing (kind, units, price_cents) values
  ('letter_caps', 1, 350),
  ('letter_caps', 2, 450),
  ('letter_caps', 3, 550),
  ('letter_caps', 4, 650),
  ('letter_caps', 5, 700),
  ('bakery_box', 4, 1200)
on conflict (kind, units) do update
  set price_cents = excluded.price_cents,
      updated_at  = now();

/* ------------------------------------------------ 3. shop settings */
-- Settings sheet. The charm bundle discount is Keycaps row 109: a macaron is
-- $6.49 alone and $5.49 on a name keychain, so $1.00 comes off.
update public.shop_settings
   set target_margin                = 0.670,   -- Settings C18
       card_fee_rate                = 0.0170,  -- Settings C19
       card_fee_fixed_cents         = 30,      -- Settings C21
       round_price_to_cents         = 50,      -- Settings C20
       default_buffer_stock         = 5,       -- Settings C23
       printer_price_cents          = 104900,  -- Settings C6
       printer_life_hours           = 10000,   -- Settings C7
       power_draw_watts             = 200,     -- Settings C9
       electricity_per_kwh_cents    = 32.7,    -- Settings C10
       filament_per_kg_cents        = 1716,    -- Settings C15
       packaging_per_unit_cents     = 42.2894, -- Settings C37
       mailer_per_order_cents       = 58.5788, -- Settings C39
       waste_rate                   = 0.1200,  -- Settings C87
       annual_fixed_cost_cents      = 28700,   -- Settings C47:C50
       annual_depreciation_cents    = 8629,    -- Settings E98
       expected_units_per_year      = 1500,    -- Settings C52
       parcel_cost_cents            = 1000,    -- Settings C56
       stall_fee_cents              = 5000,    -- Settings C67
       market_day_takings_cents     = 60000,   -- Settings C68
       printer_hours_per_year       = 2400,    -- Settings C109
       annual_contribution_target_cents = 800000, -- Settings C110
       builder_charm_discount_cents = 100;     -- Keycaps E109 - H109

/* ----------------------------------------------- 4. how pieces hang */
-- Products column H: the clickers ship on a ball chain, and Settings D32
-- records that the bag charm cord is no longer stocked. One finding, no
-- choice to make, so no price difference.
update public.products
   set attachments = '[{"id":"ballchain","label":"Ball chain","price_delta":0}]'::jsonb
 where slug in ('macaron', 'pancake-stack-in-frying-pan', 'matcha-set',
                'heart-waffle', 'custom-name-charm');

/* ------------------------------------------- 5. colourway collections */
-- Keycaps rows 5-12: each colourway's matching charm, and which are active.
-- The charm is resolved live through charm_slug (0009), so its price follows
-- the product's own price above.
update public.collections c
   set charm_slug = v.charm_slug,
       charm_name = v.charm_name,
       active     = v.active
  from (values
    ('retro-key',       'pancake-stack-in-frying-pan', 'Pancake stack', true),
    ('strawberry-milk', 'macaron',                     'Macaron',       true),
    ('matcha-latte',    'matcha-set',                  'Matcha set',    true),
    ('blueberry',       'macaron',                     'Macaron',       true),
    ('mono',            'macaron',                     'Macaron',       false),
    ('butter-toast',    'heart-waffle',                'Heart waffle',  true)
  ) as v(slug, charm_slug, charm_name, active)
 where c.slug = v.slug;

-- Caramel is Active in the workbook (Keycaps row 11) and had no row yet.
insert into public.collections
  (slug, name, cap_colour, letter_colour, holder_colour, charm_art, charm_name,
   charm_slug, tint, is_popular, sort_order, active)
select 'caramel', 'Caramel', '#B08968', '#FFFFFF', '#8B5E3C', 'pancake',
       'Pancake stack', 'pancake-stack-in-frying-pan', 'butter', false, 6, true
 where exists (select 1 from public.collections where slug = 'retro-key')
on conflict (slug) do update
  set charm_slug = excluded.charm_slug,
      charm_name = excluded.charm_name,
      active     = true;
