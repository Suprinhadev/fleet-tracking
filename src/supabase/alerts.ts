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
    ) {
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
