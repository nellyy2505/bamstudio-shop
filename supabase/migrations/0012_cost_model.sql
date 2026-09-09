-- The rest of the pricing model: waste, overhead, the channel costs, and the
-- printer-hour bar.
--
-- Everything here already exists in 3D_Planner.xlsx and was decided over eight
-- passes on 5 and 6 September 2026 (claude/planner-workbook-fixes.md). The
-- studio has been costing pieces with the workbook as it stood BEFORE those
-- passes: filament, machine time, accessory and packaging, and nothing else.
-- That understates every unit cost in the shop, which means it understates
-- every suggested price, which is the number a catalogue gets repriced from.
--
-- The three-level architecture the workbook settled on, and which the columns
-- below are grouped by:
--
--   1. Direct per-unit    filament and machine time, BOTH multiplied by waste,
--                         plus accessory and packaging.       -> products
--   2. Fixed, allocated   annual costs divided by expected units per year.
--                         Lands inside UNIT COST.             -> here
--   3. Channel, % of price  postage absorbed online, stall cut at a market.
--                         NEVER inside UNIT COST, because the suggested price
--                         is derived from unit cost and a percentage of the
--                         answer cannot be one of the inputs. -> here
--
-- Mixing those three was the underlying error in every earlier version of the
-- workbook, so the columns are commented with which level they belong to.
--
-- WHAT IS DELIBERATELY NOT HERE: labour. The workbook models it at $30/hr for
-- 3 minutes a unit and leaves it switched OFF (Settings!C105 = No), and Nelly
-- confirmed on 8 September that her time is not to be charged into unit cost.
-- So there is no labour column and no toggle to forget the state of. The one
-- consequence worth keeping in view is that every margin the studio shows is
-- optimistic by about $1.50 a unit, which is why the cost breakdown screen says
-- so in words rather than leaving it to be rediscovered.
--
-- The existing target_margin and card_fee_rate are NOT touched. The workbook
-- has since settled on 67% and 1.7%, but those two columns are hers to set in
-- the Studio and may already hold whatever she typed there; a migration that
-- overwrote them would silently reprice the catalogue behind her. They are
-- flagged on the Settings screen instead.

alter table public.shop_settings
  -- Level 3. Stripe AU is 1.7% + A$0.30; the rate is already stored as
  -- card_fee_rate and the fixed half has never been modelled at all. It is the
  -- reason a cheap piece cannot be priced from a percentage alone: 30c on a
  -- $2.50 sale is 12%. Workbook Settings!C21.
  add column if not exists card_fee_fixed_cents numeric(10,4) not null default 30,

  -- Level 1. Failed and scrapped prints (8%) plus test and colour-swap prints
  -- (4%). Multiplies filament AND machine time, because a failed print burns
  -- both, and nothing else: a scrapped print does not consume a keyring or a
  -- bag. The prime tower is deliberately NOT in here, the slicer already counts
  -- it in the grams that get typed in. Workbook Settings!C87.
  add column if not exists waste_rate numeric(5,4) not null default 0.1200
                             check (waste_rate >= 0 and waste_rate < 1),

  -- Level 2. Insurance, permits, website and anything else that is paid once a
  -- year whether one piece sells or a thousand do. Workbook Settings!C47 to
  -- C50, totalled. $300 is the cheapest AU $10M public liability cover found in
  -- September 2026 and is still a placeholder.
  add column if not exists annual_fixed_cost_cents integer not null default 30000
                             check (annual_fixed_cost_cents >= 0),

  -- Level 2. Equipment bought once and used for years, spread over its life:
  -- dehumidifier $120 over 5 years plus media gear $30 over 3 is $34 a year.
  -- THE PRINTER IS DELIBERATELY EXCLUDED. It is already paid for through
  -- machine cost per hour, and adding it here would charge it twice. Workbook
  -- Settings!C98.
  add column if not exists annual_depreciation_cents integer not null default 3400
                             check (annual_depreciation_cents >= 0),

  -- Level 2, the denominator. Both pools above divide by this, so it is the
  -- single most leveraged number on the screen: at 1,500 units a year overhead
  -- is 22c a piece, at 500 it is 67c. Workbook Settings!C52.
  add column if not exists expected_units_per_year integer not null default 1500
                             check (expected_units_per_year > 0),

  -- Level 3. What a parcel actually costs to send. The share of a price the
  -- studio absorbs is this over the free-postage threshold, which is the worst
  -- case: the order that only just crosses it earns free postage and pays the
  -- whole parcel. The thresholds themselves are NOT stored here, they live in
  -- SHIPPING in lib/config.ts where the cart and /api/checkout both read them,
  -- and a second copy is a second answer. Workbook Settings!C56.
  add column if not exists parcel_cost_cents integer not null default 1000
                             check (parcel_cost_cents >= 0),

  -- Level 3, the other channel. A stall fee is not per unit, it scales with
  -- market days, so loading it into unit cost would tax online sales to pay for
  -- market days. It is a share of a day's takings instead. Workbook C67 / C68.
  add column if not exists stall_fee_cents integer not null default 5000
                             check (stall_fee_cents >= 0),
  add column if not exists market_day_takings_cents integer not null default 60000
                             check (market_day_takings_cents > 0),

  -- The bar. Machine time, not price, is what limits the year: there are only
  -- so many printer hours in it. Hours she can really run divided into the
  -- contribution she wants from them gives dollars per printer-hour, and every
  -- product is judged on it alongside margin.
  --
  -- Deliberately set from the business and NOT from another product's price.
  -- When the macaron was cut from $9.00 to $6.49 a product-derived bar would
  -- have quietly lowered the standard for everything else at the same moment.
  -- Workbook Settings!C109 to C111.
  add column if not exists printer_hours_per_year integer not null default 2400
                             check (printer_hours_per_year > 0),
  add column if not exists annual_contribution_target_cents integer not null default 800000
                             check (annual_contribution_target_cents >= 0);

comment on column public.shop_settings.waste_rate is
  'Uplift on filament and machine time only. 0.12 = +12%.';
comment on column public.shop_settings.parcel_cost_cents is
  'Divided by SHIPPING.freeThreshold in lib/config.ts to get the absorbed share.';
comment on column public.shop_settings.annual_depreciation_cents is
  'Assets only. The printer is excluded, it is paid for through machine cost per hour.';
