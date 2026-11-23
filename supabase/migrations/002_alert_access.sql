create table if not exists public.app_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('developer', 'owner', 'manager', 'dispatcher', 'viewer')),
  display_name text,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  traccar_device_id bigint not null,
  primary key (user_id, traccar_device_id)
);

alter table public.alerts add column if not exists organization_id uuid;

alter table public.app_profiles enable row level security;
alter table public.user_devices enable row level security;

create policy "Users can read own profile"
  on public.app_profiles for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can read own vehicle assignments"
  on public.user_devices for select
  to authenticated
  using (auth.uid() = user_id);
