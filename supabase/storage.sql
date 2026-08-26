-- storage.sql — the bucket product photographs live in.
--
-- NOT a migration, and deliberately not applied by scripts/verify-sql.sh.
--
-- Storage is a Supabase feature, not a PostgreSQL one: the `storage` schema and
-- the `storage.objects` table are created by the platform. The verification
-- harness runs vanilla PostgreSQL 16, where none of that exists. This could be
-- folded into 0003 behind an `if exists (select 1 ... where schema_name =
-- 'storage')` guard, and then the harness would apply the file, skip this half
-- of it silently, and print a full row of green ticks about a bucket it never
-- created. A separate file that has to be run on purpose is worth more than a
-- guard that turns "not tested" into something that looks like "tested".
--
-- Run this ONCE, in the Supabase SQL editor, after 0003_admin.sql.
--
--   Dashboard → SQL Editor → New query → paste → Run
--
-- Then check Dashboard → Storage: a bucket called `product-photos` should be
-- listed, and it should say Public.

-- The bucket. Public read, because these are pictures of things that are for
-- sale on a public web page — the shop renders them straight from the CDN URL
-- and there is nothing to protect. 5 MB and an explicit type list, because
-- "public bucket the staff area can write to" is the shape of an open file
-- host if it will accept anything of any size.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-photos',
  'product-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read an object in this bucket. That is the point of a shop.
drop policy if exists "product photos are public" on storage.objects;
create policy "product photos are public"
  on storage.objects for select
  using (bucket_id = 'product-photos');

-- Nobody may write one with a browser key. Uploads go through the staff area,
-- which is server-side and holds the service-role key, and which has already
-- checked that the person asking is staff.
--
-- There is deliberately NO insert/update/delete policy here. RLS on
-- storage.objects denies by default, and the service-role key bypasses RLS
-- entirely, so the only way a file lands in this bucket is through code that
-- called requireStaff() first. Adding an "authenticated users can upload"
-- policy — the shape most tutorials show — would let any customer account with
-- the anon key write files into a bucket the shop serves publicly.
drop policy if exists "product photos are staff-written" on storage.objects;
