grant usage on schema public to service_role;

grant all privileges on table
  public.app_profiles,
  public.user_devices,
  public.fleet_vehicles,
  public.action_audit,
  public.notifications,
  public.alerts
to service_role;

grant usage, select on sequence
  public.action_audit_id_seq,
  public.notifications_id_seq
to service_role;
