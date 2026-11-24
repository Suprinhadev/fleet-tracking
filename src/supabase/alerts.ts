import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

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
        .upsert(rows, { onConflict: "event_id" })
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
        .select("device_id")
        .eq("event_id", eventId)
        .maybeSingle();
      const existing = await query;
      if (existing.error) throw existing.error;
      if (!existing.data) throw new Error("Alerta não encontrado");
      if (allowedDeviceIds && !allowedDeviceIds.includes(Number(existing.data.device_id))) {
        throw new Error("Acesso negado ao veículo");
      }

      const { data, error } = await supabase
        .from("alerts")
        .update({
          status: update.status,
          notes: update.notes ?? null,
          acknowledged_by: userId,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("event_id", eventId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
  };
}
