-- 0016_drop_theme_suffix.sql - take the "Theme: Food." tag off descriptions
--
-- Apply after 0015_bakery_box.sql.
--
-- scripts/generate-seed.mjs ended every description with "Theme: <theme>.",
-- which reads like an internal label on the shopfront ("...finished by hand.
-- Theme: Food."). The theme is already a filter on /shop, so the sentence adds
-- nothing for a customer. The generator no longer writes it; this removes it
-- from rows already in the database. Only a trailing "Theme: ...." is touched,
-- so a description the owner has rewritten by hand is left exactly as it is.

update public.products
   set description = regexp_replace(description, '\s*Theme: [^.]*\.\s*$', '')
 where description ~ 'Theme: [^.]*\.\s*$';

-- The "Item details" accordion holds a copy of the same text.
update public.products p
   set details = (
     select coalesce(jsonb_agg(
              case
                when d ? 'body' and (d->>'body') ~ 'Theme: [^.]*\.\s*$'
                  then jsonb_set(d, '{body}', to_jsonb(regexp_replace(d->>'body', '\s*Theme: [^.]*\.\s*$', '')))
                else d
              end
              order by ord), '[]'::jsonb)
       from jsonb_array_elements(p.details) with ordinality as t(d, ord)
   )
 where p.details::text ~ 'Theme: ';
