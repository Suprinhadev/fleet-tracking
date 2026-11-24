import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { AlertStoreError, getAlertStatusConflict } from "../alert-status.js";

type TraccarEvent = {
  id: number;
  type: string;
  deviceId: number;
  positionId?: number;
  eventTime: string;
  attributes?: Record<string, unknown>;
};

export function createAlertStore() {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  return {
    async list(deviceIds?: number[]) {
      if (deviceIds && deviceIds.length === 0) return [];
      let query = supabase
        .from("alerts")
        .select("*")
        .order("event_time", { ascending: false })
        .limit(200);
      if (deviceIds) query = query.in("device_id", deviceIds);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    async createFromEvents(events: TraccarEvent[]) {
      if (!events.length) return [];

      const rows = events.map((event) => ({
        event_id: event.id,
        device_id: event.deviceId,
        type: event.type,
        event_time: event.eventTime,
        position_id: event.positionId ?? null,
        status: "open",
        attributes: event.attributes || {},
      }));

      const { data, error } = await supabase
        .from("alerts")
        .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true })
        .select();

      if (error) throw error;
      return data;
    },

    async updateStatus(
      eventId: number,
      update: { status: "acknowledged" | "resolved"; notes?: string },
      userId: string,
      allowedDeviceIds?: number[],
    ) {
      let query = supabase
        .from("alerts")
        .select("device_id, status")
        .eq("event_id", eventId)
        .maybeSingle();
      const existing = await query;
      if (existing.error) throw existing.error;
      if (!existing.data) throw new AlertStoreError(404, "Alerta não encontrado");
      if (allowedDeviceIds && !allowedDeviceIds.includes(Number(existing.data.device_id))) {
        throw new AlertStoreError(403, "Acesso negado ao veículo");
      }
      const transitionConflict = getAlertStatusConflict(
        existing.data.status,
        update.status,
      );
      if (transitionConflict) throw new AlertStoreError(409, transitionConflict);

      const updateFields = {
        status: update.status,
        ...(update.status === "acknowledged" && existing.data.status === "open"
          ? {
              acknowledged_by: userId,
              acknowledged_at: new Date().toISOString(),
            }
          : {}),
        ...(update.notes === undefined ? {} : { notes: update.notes }),
      };
      const { data, error } = await supabase
        .from("alerts")
        .update(updateFields)
        .eq("event_id", eventId)
        .eq("device_id", existing.data.device_id)
        .eq("status", existing.data.status)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new AlertStoreError(409, "O alerta foi alterado; atualize a lista e tente novamente.");
      }
      return data;
    },
  };
}
