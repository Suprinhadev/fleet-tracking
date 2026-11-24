create table if not exists public.notification_deliveries (
  id bigint generated always as identity primary key,
  event_id bigint not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, channel)
);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (next_attempt_at, id)
  where status = 'pending';

create index if not exists notification_deliveries_processing_idx
  on public.notification_deliveries (lease_expires_at)
  where status = 'processing';

alter table public.notification_deliveries enable row level security;

grant all privileges on table public.notification_deliveries to service_role;
grant usage, select on sequence public.notification_deliveries_id_seq to service_role;
