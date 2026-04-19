-- 040: 臨打團 Logo 上傳用 Storage bucket + RLS
-- 執行後，臨打團設定頁可將圖檔上傳至 bucket `pickup-group-logos`，並將公開 URL 寫入 pickup_group_settings.logo_url
--
-- 路徑規則：{auth.uid()}/{timestamp}-{random}.{ext}
-- 公開讀取：bucket public = true，且開放 SELECT 供匿名讀取檔案（公開報名頁顯示 Logo）

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pickup-group-logos',
  'pickup-group-logos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = coalesce(excluded.file_size_limit, storage.buckets.file_size_limit),
  allowed_mime_types = coalesce(excluded.allowed_mime_types, storage.buckets.allowed_mime_types);

drop policy if exists pickup_group_logos_select on storage.objects;
create policy pickup_group_logos_select
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'pickup-group-logos');

drop policy if exists pickup_group_logos_insert_own on storage.objects;
create policy pickup_group_logos_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pickup-group-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists pickup_group_logos_update_own on storage.objects;
create policy pickup_group_logos_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'pickup-group-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'pickup-group-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists pickup_group_logos_delete_own on storage.objects;
create policy pickup_group_logos_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'pickup-group-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
