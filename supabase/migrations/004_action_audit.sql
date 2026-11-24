create table if not exists public.action_audit (
  id bigint generated always as identity primary key,
  action text not null,
  entity_type text not null,
  entity_id text,
  user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists action_audit_created_idx
  on public.action_audit (created_at desc);

alter table public.action_audit enable row level security;

drop policy if exists "Developer and owner can read action audit" on public.action_audit;
create policy "Developer and owner can read action audit"
  on public.action_audit for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_profiles
      where app_profiles.user_id = auth.uid()
        and app_profiles.role in ('developer', 'owner')
    )
  );
