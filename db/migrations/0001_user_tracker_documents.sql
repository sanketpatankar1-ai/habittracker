-- Each authenticated user owns exactly one JSON document containing the
-- original tracker records/preferences. Analytics remain derived in the app.
create table if not exists public.user_tracker_documents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.user_tracker_documents
  add column if not exists revision bigint not null default 1 check (revision > 0);

create index if not exists user_tracker_documents_updated_at_idx
  on public.user_tracker_documents (updated_at desc);

alter table public.user_tracker_documents enable row level security;
alter table public.user_tracker_documents force row level security;

revoke all on table public.user_tracker_documents from anon;
grant select, insert, update, delete on table public.user_tracker_documents to authenticated;

drop policy if exists "Users can read their own tracker" on public.user_tracker_documents;
create policy "Users can read their own tracker"
  on public.user_tracker_documents for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own tracker" on public.user_tracker_documents;
create policy "Users can create their own tracker"
  on public.user_tracker_documents for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own tracker" on public.user_tracker_documents;
create policy "Users can update their own tracker"
  on public.user_tracker_documents for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own tracker" on public.user_tracker_documents;
create policy "Users can delete their own tracker"
  on public.user_tracker_documents for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Compare-and-save prevents an older browser tab/device from silently
-- overwriting a newer cloud document. The user ID always comes from the JWT.
create or replace function public.save_my_tracker_document(p_data jsonb, p_expected_revision bigint)
returns setof public.user_tracker_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_revision bigint;
  v_exists boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Tracker data must be a JSON object.' using errcode = '22023';
  end if;

  select doc.revision into v_revision
    from public.user_tracker_documents as doc
    where doc.user_id = v_user_id
    for update;
  v_exists := found;

  if not v_exists then
    if p_expected_revision is distinct from 0 then
      raise exception 'Tracker revision conflict. Refresh and merge local changes.' using errcode = '40001';
    end if;
    insert into public.user_tracker_documents (user_id, data, revision)
      values (v_user_id, p_data, 1)
      on conflict (user_id) do nothing;
    if not found then
      raise exception 'Tracker revision conflict. Refresh and merge local changes.' using errcode = '40001';
    end if;
  else
    if p_expected_revision is distinct from v_revision then
      raise exception 'Tracker revision conflict. Refresh and merge local changes.' using errcode = '40001';
    end if;
    update public.user_tracker_documents as doc
      set data = p_data, revision = doc.revision + 1
      where doc.user_id = v_user_id;
  end if;

  return query select doc.* from public.user_tracker_documents as doc where doc.user_id = v_user_id;
end;
$$;

revoke all on function public.save_my_tracker_document(jsonb, bigint) from public, anon;
grant execute on function public.save_my_tracker_document(jsonb, bigint) to authenticated;

create or replace function public.touch_user_tracker_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists user_tracker_documents_touch_updated_at on public.user_tracker_documents;
create trigger user_tracker_documents_touch_updated_at
  before update on public.user_tracker_documents
  for each row execute function public.touch_user_tracker_document();
