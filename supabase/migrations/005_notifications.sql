create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  event_id bigint,
  device_id bigint not null,
  type text not null,
  title text not null,
  message text not null,
  status text not null default 'unread'
    check (status in ('unread', 'read')),
  event_time timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_unread_created_idx
  on public.notifications (status, created_at desc);

create unique index if not exists notifications_event_idx
  on public.notifications (event_id)
  where event_id is not null;

alter table public.notifications enable row level security;

drop policy if exists "Developer and owner can read notifications" on public.notifications;
create policy "Developer and owner can read notifications"
  on public.notifications for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_profiles
      where app_profiles.user_id = auth.uid()
        and app_profiles.role in ('developer', 'owner')
    )
  );

drop policy if exists "Assigned users can read notifications" on public.notifications;
create policy "Assigned users can read notifications"
  on public.notifications for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_devices
      where user_devices.user_id = auth.uid()
        and user_devices.traccar_device_id = notifications.device_id
    )
  );
