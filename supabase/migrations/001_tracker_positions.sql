create table if not exists public.alerts (
  event_id bigint primary key,
  device_id bigint not null,
  type text not null,
  event_time timestamptz not null,
  position_id bigint,
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved')),
  notes text,
  attributes jsonb not null default '{}'::jsonb,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists alerts_device_event_idx
  on public.alerts (device_id, event_time desc);

create index if not exists alerts_status_event_idx
  on public.alerts (status, event_time desc);

alter table public.alerts enable row level security;
