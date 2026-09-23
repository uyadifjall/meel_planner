-- CookFlow: 写真アップロード（②）と Realtime 同期（⑦）のためのセットアップ
-- Supabase ダッシュボード → SQL Editor に貼り付けて1回実行してください。
-- 既存テーブルのデータには一切触れません（何度実行しても安全です）。

-- ─────────────────────────────────────────────
-- ② Storage: recipe-photos バケット（公開読み取り・5MBまで・画像のみ）
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

-- このアプリは Supabase Auth を使わず anon キーでアクセスするため、anon にも操作を許可する
drop policy if exists "recipe-photos: read"   on storage.objects;
drop policy if exists "recipe-photos: insert" on storage.objects;
drop policy if exists "recipe-photos: update" on storage.objects;
drop policy if exists "recipe-photos: delete" on storage.objects;

create policy "recipe-photos: read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'recipe-photos');

create policy "recipe-photos: insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'recipe-photos');

create policy "recipe-photos: update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'recipe-photos')
  with check (bucket_id = 'recipe-photos');

create policy "recipe-photos: delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'recipe-photos');

-- ─────────────────────────────────────────────
-- ⑦ Realtime: users テーブルの変更（shopping_checks）を配信する
-- ─────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'users'
  ) then
    alter publication supabase_realtime add table public.users;
  end if;
end $$;

-- ALTER TABLE は不要です（shopping_checks 列は既存のもの、
-- レシピの photoPath・履歴の recipeId は data(JSON) 内に追加されるだけです）。
