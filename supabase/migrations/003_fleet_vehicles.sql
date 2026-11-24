create table if not exists public.fleet_vehicles (
  traccar_device_id bigint primary key,
  name text not null,
  plate text,
  brand text,
  model text,
  year integer
    check (year is null or (year between 1900 and 2100)),
  vehicle_type text,
  imei text,
  owner_name text,
  color text,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fleet_vehicles_plate_idx
  on public.fleet_vehicles (lower(plate))
  where plate is not null;

create unique index if not exists fleet_vehicles_imei_idx
  on public.fleet_vehicles (imei)
  where imei is not null;

alter table public.fleet_vehicles enable row level security;

drop policy if exists "Developer and owner can read fleet metadata" on public.fleet_vehicles;
create policy "Developer and owner can read fleet metadata"
  on public.fleet_vehicles for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_profiles
      where app_profiles.user_id = auth.uid()
        and app_profiles.role in ('developer', 'owner')
    )
    or exists (
      select 1
      from public.user_devices
      where user_devices.user_id = auth.uid()
        and user_devices.traccar_device_id = fleet_vehicles.traccar_device_id
    )
  );

drop policy if exists "Developer and owner can manage fleet metadata" on public.fleet_vehicles;
create policy "Developer and owner can manage fleet metadata"
  on public.fleet_vehicles for all
  to authenticated
  using (
    exists (
      select 1
      from public.app_profiles
      where app_profiles.user_id = auth.uid()
        and app_profiles.role in ('developer', 'owner')
    )
  )
  with check (
    exists (
      select 1
      from public.app_profiles
      where app_profiles.user_id = auth.uid()
        and app_profiles.role in ('developer', 'owner')
    )
  );
