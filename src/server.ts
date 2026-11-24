import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { config } from "./config.js";
import { requireRole, requireUser } from "./auth.js";
import { canViewDevice, filterAllowedDevices } from "./permissions.js";
import { getEngineStopSafetyError } from "./commands.js";
import { AlertStoreError } from "./alert-status.js";
import { TraccarClient } from "./traccar/client.js";
import { connectTraccarSocket } from "./traccar/socket.js";
import { createAlertStore } from "./supabase/alerts.js";
import type { LiveMessage } from "./types.js";
import {
  addLiveClient,
  broadcastLive,
  invalidateLiveClientsForUser,
  removeLiveClient,
} from "./live.js";
import { createClient } from "@supabase/supabase-js";
import {
  sendNotificationWebhooks,
  type NotificationEvent,
} from "./notifications.js";
import { getNotificationDeliveryFailureUpdate } from "./notification-delivery.js";
import {
  positionQuerySchema,
  reportRangeQuerySchema,
  summaryQuerySchema,
} from "./report-queries.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin(origin, callback) {
      const localPreview = /^http:\/\/localhost:\d+$/.test(origin || "");
      const vercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin || "");
      if (
        !origin ||
        localPreview ||
        vercelPreview ||
        config.corsOrigins.includes(origin)
      ) callback(null, true);
      else callback(new Error("Origin is not allowed"));
    },
  }),
);

const traccar = new TraccarClient(
  config.traccarUrl,
  config.traccarEmail,
  config.traccarPassword,
);
const alertStore = createAlertStore();
const supabaseAdmin = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
);
const reportCache = new Map<string, { expiresAt: number; value: unknown }>();
const notificationDeliveryBatchSize = 25;
const notificationDeliveryLeaseMs = 30_000;
let notificationDeliveryWorkerRunning = false;

function getCachedReport(key: string) {
  const cached = reportCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) reportCache.delete(key);
  return undefined;
}

function setCachedReport(key: string, value: unknown) {
  reportCache.set(key, { expiresAt: Date.now() + 15_000, value });
  if (reportCache.size > 100) {
    const oldest = reportCache.keys().next().value;
    if (oldest) reportCache.delete(oldest);
  }
}

function reportCacheKey(path: string, params: Record<string, unknown>) {
  return `${path}:${JSON.stringify(params)}`;
}

async function createNotifications(events: NotificationEvent[]) {
  if (!events.length) return;
  const uniqueEvents = Array.from(
    new Map(events.map((event) => [event.id, event])).values(),
  );
  const rows = uniqueEvents.map((event) => ({
    event_id: event.id,
    device_id: event.deviceId,
    type: event.type,
    title: event.type === "deviceOnline"
      ? "Dispositivo conectado"
      : event.type === "deviceOffline"
        ? "Dispositivo desconectado"
        : "Novo alerta",
    message: `Evento ${event.type} recebido para o veículo ${event.deviceId}.`,
    status: "unread",
    event_time: event.eventTime,
  }));
  const { error } = await supabaseAdmin
    .from("notifications")
    .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true });
  if (error) throw error;

  const channels: Array<"email" | "whatsapp"> = [];
  if (config.notificationEmailWebhookUrl) channels.push("email");
  if (config.notificationWhatsAppWebhookUrl) channels.push("whatsapp");
  if (!channels.length) return;

  const deliveries = uniqueEvents.flatMap((event) =>
    channels.map((channel) => ({ event_id: event.id, channel })),
  );
  const { error: deliveryError } = await supabaseAdmin
    .from("notification_deliveries")
    .upsert(deliveries, {
      onConflict: "event_id,channel",
      ignoreDuplicates: true,
    });
  if (deliveryError) throw deliveryError;

  void processNotificationDeliveries();
}

async function updateDeliveryJob(
  jobId: number,
  update: Record<string, unknown>,
) {
  const { data, error } = await supabaseAdmin
    .from("notification_deliveries")
    .update(update)
    .eq("id", jobId)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Notification delivery lease was lost");
}

async function processNotificationDeliveries() {
  if (notificationDeliveryWorkerRunning) return;
  notificationDeliveryWorkerRunning = true;

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const { error: recoveryError } = await supabaseAdmin
      .from("notification_deliveries")
      .update({
        status: "pending",
        lease_expires_at: null,
        updated_at: nowIso,
      })
      .eq("status", "processing")
      .lte("lease_expires_at", nowIso);
    if (recoveryError) throw recoveryError;

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("notification_deliveries")
      .select("id, event_id, channel, attempts")
      .eq("status", "pending")
      .lte("next_attempt_at", nowIso)
      .order("next_attempt_at", { ascending: true })
      .limit(notificationDeliveryBatchSize);
    if (jobsError) throw jobsError;
    if (!jobs?.length) return;

    const eventIds = Array.from(new Set(jobs.map((job) => Number(job.event_id))));
    const { data: notificationRows, error: notificationsError } = await supabaseAdmin
      .from("notifications")
      .select("event_id, type, device_id, event_time")
      .in("event_id", eventIds);
    if (notificationsError) throw notificationsError;

    const eventsById = new Map<number, NotificationEvent>(
      (notificationRows || []).map((row) => [
        Number(row.event_id),
        {
          id: Number(row.event_id),
          type: row.type,
          deviceId: Number(row.device_id),
          eventTime: row.event_time,
        },
      ]),
    );

    for (const job of jobs) {
      const claimTime = new Date();
      const attempts = Number(job.attempts) + 1;
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from("notification_deliveries")
        .update({
          status: "processing",
          attempts,
          last_attempt_at: claimTime.toISOString(),
          lease_expires_at: new Date(
            claimTime.getTime() + notificationDeliveryLeaseMs,
          ).toISOString(),
          updated_at: claimTime.toISOString(),
        })
        .eq("id", Number(job.id))
        .eq("status", "pending")
        .lte("next_attempt_at", claimTime.toISOString())
        .select("id, event_id, channel")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;

      const jobId = Number(claimed.id);
      const eventId = Number(claimed.event_id);
      const channel = claimed.channel;
      const event = eventsById.get(eventId);
      if (!event) {
        await updateDeliveryJob(jobId, {
          status: "failed",
          last_error: "notification_source_missing",
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        });
        console.error(
          `Notification delivery failed permanently (${channel}, event ${eventId}): source missing`,
        );
        continue;
      }

      if (channel !== "email" && channel !== "whatsapp") {
        await updateDeliveryJob(jobId, {
          status: "failed",
          last_error: "unsupported_channel",
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        });
        console.error(
          `Notification delivery failed permanently (event ${eventId}): unsupported channel`,
        );
        continue;
      }

      const webhookUrl = channel === "email"
        ? config.notificationEmailWebhookUrl
        : config.notificationWhatsAppWebhookUrl;
      if (!webhookUrl) {
        await updateDeliveryJob(jobId, {
          status: "failed",
          last_error: "webhook_not_configured",
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        });
        console.error(
          `Notification delivery failed permanently (${channel}, event ${eventId}): webhook not configured`,
        );
        continue;
      }

      const failures = await sendNotificationWebhooks([event], {
        emailUrl: channel === "email" ? webhookUrl : "",
        whatsappUrl: channel === "whatsapp" ? webhookUrl : "",
      });
      const failure = failures[0];
      if (failure) {
        const errorMessage = failure.status
          ? `${failure.reason}:http_${failure.status}`
          : failure.reason;
        const failedAt = new Date();
        const update = getNotificationDeliveryFailureUpdate(
          attempts,
          failedAt,
          errorMessage,
        );
        await updateDeliveryJob(jobId, update);
        const outcome = update.status === "failed" ? "failed permanently" : "will retry";
        console.error(
          `Notification delivery ${outcome} (${channel}, event ${eventId}, attempt ${attempts}): ${errorMessage}`,
        );
        continue;
      }

      const deliveredAt = new Date().toISOString();
      await updateDeliveryJob(jobId, {
        status: "delivered",
        delivered_at: deliveredAt,
        lease_expires_at: null,
        last_error: null,
        updated_at: deliveredAt,
      });
    }
  } catch (error) {
    console.error("Notification delivery worker failed:", (error as Error).message);
  } finally {
    notificationDeliveryWorkerRunning = false;
  }
}

async function auditAction(
  action: string,
  entityType: string,
  entityId: string | number | null,
  userId: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await supabaseAdmin
    .from("action_audit")
    .insert({
      action,
      entity_type: entityType,
      entity_id: entityId === null ? null : String(entityId),
      user_id: userId,
      details,
    });
  if (error) console.error("Audit write failed:", error.message);
}


app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/notifications/channels", requireUser, async (_req, res) => {
  res.json({
    inApp: true,
    browser: true,
    email: Boolean(config.notificationEmailWebhookUrl),
    whatsapp: Boolean(config.notificationWhatsAppWebhookUrl),
  });
});

app.get("/api/devices", requireUser, async (_req, res) => {
  try {
    const devices = await traccar.get<Array<{ id: number; name: string; uniqueId?: string }>>("/api/devices");
    const allowedDevices = filterAllowedDevices(res.locals.appUser, devices);
    const deviceIds = allowedDevices.map((device) => device.id);
    if (!deviceIds.length) return res.json([]);

    const { data: vehicleData, error } = await supabaseAdmin
      .from("fleet_vehicles")
      .select("*")
      .in("traccar_device_id", deviceIds);
    if (error) throw error;

    const metadataById = new Map(
      (vehicleData || []).map((vehicle) => [Number(vehicle.traccar_device_id), vehicle]),
    );
    res.json(
      allowedDevices.map((device) => {
        const metadata = metadataById.get(device.id);
        return {
          ...device,
          name: metadata?.name || device.name,
          plate: metadata?.plate || null,
          brand: metadata?.brand || null,
          model: metadata?.model || null,
          year: metadata?.year || null,
          vehicleType: metadata?.vehicle_type || null,
          imei: metadata?.imei || device.uniqueId || null,
          ownerName: metadata?.owner_name || null,
          color: metadata?.color || null,
          photoUrl: metadata?.photo_url || null,
        };
      }),
    );
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
  },
);

app.post("/api/devices", requireUser, requireRole("developer", "owner"), async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(100),
      plate: z.string().trim().max(30).optional(),
      brand: z.string().trim().max(50).optional(),
      model: z.string().trim().max(50).optional(),
      year: z.coerce.number().int().min(1900).max(2100).optional(),
      vehicleType: z.string().trim().max(50).optional(),
      imei: z.string().trim().min(8).max(30),
      ownerName: z.string().trim().max(100).optional(),
      color: z.string().trim().max(30).optional(),
      photoUrl: z.string().trim().url().optional().or(z.literal("")),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error.flatten());

  try {
    const traccarDevice = await traccar.post<{ id: number } & Record<string, unknown>>(
      "/api/devices",
      {
        name: body.data.name,
        uniqueId: body.data.imei,
        category: body.data.vehicleType || "car",
      },
    );

    const { error } = await supabaseAdmin
      .from("fleet_vehicles")
      .insert({
        traccar_device_id: traccarDevice.id,
        name: body.data.name,
        plate: body.data.plate || null,
        brand: body.data.brand || null,
        model: body.data.model || null,
        year: body.data.year || null,
        vehicle_type: body.data.vehicleType || null,
        imei: body.data.imei,
        owner_name: body.data.ownerName || null,
        color: body.data.color || null,
        photo_url: body.data.photoUrl || null,
      });
    if (error) throw error;

    await auditAction(
      "vehicle_created",
      "vehicle",
      traccarDevice.id,
      res.locals.authUser.id,
      { name: body.data.name, imei: body.data.imei, plate: body.data.plate || null },
    );

    res.status(201).json({
      id: traccarDevice.id,
      uniqueId: body.data.imei,
      ...body.data,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put("/api/devices/:deviceId", requireUser, requireRole("developer", "owner"), async (req, res) => {
  const deviceId = z.coerce.number().int().positive().safeParse(req.params.deviceId);
  const body = z
    .object({
      name: z.string().trim().min(2).max(100).optional(),
      plate: z.string().trim().max(30).optional(),
      brand: z.string().trim().max(50).optional(),
      model: z.string().trim().max(50).optional(),
      year: z.coerce.number().int().min(1900).max(2100).optional(),
      vehicleType: z.string().trim().max(50).optional(),
      imei: z.string().trim().min(8).max(30).optional(),
      ownerName: z.string().trim().max(100).optional(),
      color: z.string().trim().max(30).optional(),
      photoUrl: z.string().trim().url().optional().or(z.literal("")).optional(),
    })
    .safeParse(req.body);
  if (!deviceId.success || !body.success) {
    return res.status(400).json({ error: "Dados do veículo inválidos" });
  }

  try {
    const id = deviceId.data;
    const traccarDevice = await traccar.get<{ id: number; name: string; uniqueId: string; category?: string }>(
      `/api/devices/${id}`,
    );
    const traccarUpdate = {
      ...traccarDevice,
      name: body.data.name ?? traccarDevice.name,
      uniqueId: body.data.imei ?? traccarDevice.uniqueId,
      category: body.data.vehicleType ?? traccarDevice.category,
    };
    await traccar.put(`/api/devices/${id}`, traccarUpdate);

    const metadataUpdate: Record<string, unknown> = {};
    if (body.data.name !== undefined) metadataUpdate.name = body.data.name;
    if (body.data.plate !== undefined) metadataUpdate.plate = body.data.plate || null;
    if (body.data.brand !== undefined) metadataUpdate.brand = body.data.brand || null;
    if (body.data.model !== undefined) metadataUpdate.model = body.data.model || null;
    if (body.data.year !== undefined) metadataUpdate.year = body.data.year;
    if (body.data.vehicleType !== undefined) metadataUpdate.vehicle_type = body.data.vehicleType;
    if (body.data.imei !== undefined) metadataUpdate.imei = body.data.imei;
    if (body.data.ownerName !== undefined) metadataUpdate.owner_name = body.data.ownerName || null;
    if (body.data.color !== undefined) metadataUpdate.color = body.data.color || null;
    if (body.data.photoUrl !== undefined) metadataUpdate.photo_url = body.data.photoUrl || null;
    metadataUpdate.updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from("fleet_vehicles")
      .upsert({ traccar_device_id: id, name: traccarUpdate.name, ...metadataUpdate });
    if (error) throw error;

    await auditAction(
      "vehicle_updated",
      "vehicle",
      id,
      res.locals.authUser.id,
      body.data,
    );
    res.json({ id, ...body.data, name: traccarUpdate.name, uniqueId: traccarUpdate.uniqueId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete("/api/devices/:deviceId", requireUser, requireRole("developer", "owner"), async (req, res) => {
  const deviceId = z.coerce.number().int().positive().safeParse(req.params.deviceId);
  if (!deviceId.success) return res.status(400).json({ error: "Veículo inválido" });

  try {
    const id = deviceId.data;
    await traccar.delete(`/api/devices/${id}`);
    await supabaseAdmin.from("fleet_vehicles").delete().eq("traccar_device_id", id);
    await supabaseAdmin.from("user_devices").delete().eq("traccar_device_id", id);

    await auditAction(
      "vehicle_deleted",
      "vehicle",
      id,
      res.locals.authUser.id,
    );
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/geofences", requireUser, requireRole("developer", "owner", "manager"), async (_req, res) => {
  try {
    res.json(await traccar.get("/api/geofences"));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.post("/api/geofences", requireUser, requireRole("developer", "owner"), async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(100),
      description: z.string().trim().max(500).optional(),
      area: z.string().trim().min(8).max(10000),
      calendarId: z.coerce.number().int().positive().optional(),
      deviceIds: z.array(z.number().int().positive()).min(1),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error.flatten());

  try {
    const geofence = await traccar.post<{ id: number } & Record<string, unknown>>(
      "/api/geofences",
      {
        name: body.data.name,
        description: body.data.description || "",
        area: body.data.area,
        calendarId: body.data.calendarId,
        attributes: {},
      },
    );

    try {
      await traccar.post("/api/permissions", body.data.deviceIds.map((deviceId) => ({
        deviceId,
        geofenceId: geofence.id,
      })));
    } catch {
      try {
        await traccar.delete(`/api/geofences/${geofence.id}`);
      } catch (cleanupError) {
        console.error("Geofence cleanup failed after assignment error:", cleanupError);
        return res.status(502).json({
          error: "A geocerca pode ter sido criada sem atribuição. Verifique a lista antes de tentar novamente.",
        });
      }
      return res.status(502).json({
        error: "Não foi possível atribuir a geocerca aos veículos; a criação foi revertida.",
      });
    }
    await auditAction(
      "geofence_created",
      "geofence",
      geofence.id,
      res.locals.authUser.id,
      { name: body.data.name, deviceIds: body.data.deviceIds },
    );
    res.status(201).json(geofence);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete("/api/geofences/:geofenceId", requireUser, requireRole("developer", "owner"), async (req, res) => {
  const parsed = z.coerce.number().int().positive().safeParse(req.params.geofenceId);
  if (!parsed.success) return res.status(400).json({ error: "Geocerca inválida" });
  try {
    await traccar.delete(`/api/geofences/${parsed.data}`);
    await auditAction(
      "geofence_deleted",
      "geofence",
      parsed.data,
      res.locals.authUser.id,
    );
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/geofences/:geofenceId/devices", requireUser, requireRole("developer", "owner"), async (req, res) => {
  const geofenceId = z.coerce.number().int().positive().safeParse(req.params.geofenceId);
  const body = z.object({
    deviceIds: z.array(z.number().int().positive()).min(1),
  }).safeParse(req.body);
  if (!geofenceId.success || !body.success) {
    return res.status(400).json({ error: "Dados de atribuição inválidos" });
  }
  try {
    await traccar.post("/api/permissions", body.data.deviceIds.map((deviceId) => ({
      deviceId,
      geofenceId: geofenceId.data,
    })));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/devices/:deviceId/commands", requireUser, requireRole("developer", "owner"), async (req, res) => {
  const deviceId = z.coerce.number().int().positive().safeParse(req.params.deviceId);
  const body = z
    .object({
      type: z.enum(["engineStop", "engineResume"]),
      confirmation: z.literal("CONFIRMAR"),
    })
    .safeParse(req.body);
  if (!deviceId.success || !body.success) {
    return res.status(400).json({ error: "Comando ou confirmação inválidos" });
  }

  try {
    if (body.data.type === "engineStop") {
      const now = new Date();
      const positions = await traccar.get<Array<{
        fixTime?: string;
        speed?: number;
        attributes?: Record<string, unknown>;
      }>>("/api/positions", {
        deviceId: deviceId.data,
        from: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
        to: now.toISOString(),
      });
      const latestPosition = positions
        .filter((position) => Number.isFinite(Date.parse(position.fixTime || "")))
        .sort((a, b) => Date.parse(b.fixTime || "") - Date.parse(a.fixTime || ""))[0] || null;
      const safetyError = getEngineStopSafetyError(latestPosition, now.getTime());
      if (safetyError) return res.status(409).json({ error: safetyError });
    }

    const command = await traccar.post<{ id?: number } & Record<string, unknown>>(
      "/api/commands/send",
      {
        deviceId: deviceId.data,
        type: body.data.type,
        attributes: {},
      },
    );
    await auditAction(
      body.data.type === "engineStop"
        ? "remote_engine_stop"
        : "remote_engine_resume",
      "vehicle",
      deviceId.data,
      res.locals.authUser.id,
      { confirmed: true },
    );
    res.status(201).json({
      id: command.id,
      deviceId: deviceId.data,
      type: body.data.type,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/positions", requireUser, async (req, res) => {
  const parsed = positionQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    const appUser = res.locals.appUser;
    const positions = await traccar.get<Array<{ deviceId: number }>>(
      "/api/positions",
      parsed.data,
    );
    if (appUser.role === "developer" || appUser.role === "owner") {
      return res.json(positions);
    }
    res.json(
      positions.filter((position) => appUser.deviceIds.includes(position.deviceId)),
    );
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/reports/route", requireUser, async (req, res) => {
  const parsed = reportRangeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  if (!canViewDevice(res.locals.appUser, parsed.data.deviceId)) {
    return res.status(403).json({ error: "Acesso negado ao veículo" });
  }
  try {
    res.json(await traccar.get("/api/reports/route", parsed.data));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/events", requireUser, async (req, res) => {
  const parsed = reportRangeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  if (!canViewDevice(res.locals.appUser, parsed.data.deviceId)) {
    return res.status(403).json({ error: "Acesso negado ao veículo" });
  }
  try {
    res.json(await traccar.get("/api/events", parsed.data));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/reports/trips", requireUser, async (req, res) => {
  const parsed = reportRangeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  if (!canViewDevice(res.locals.appUser, parsed.data.deviceId)) {
    return res.status(403).json({ error: "Acesso negado ao veículo" });
  }
  try {
    const key = reportCacheKey("/api/reports/trips", parsed.data);
    const cached = getCachedReport(key);
    if (cached !== undefined) {
      res.setHeader("Cache-Control", "private, max-age=15");
      return res.json(cached);
    }
    const value = await traccar.get("/api/reports/trips", parsed.data);
    setCachedReport(key, value);
    res.setHeader("Cache-Control", "private, max-age=15");
    res.json(value);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/reports/stops", requireUser, async (req, res) => {
  const parsed = reportRangeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  if (!canViewDevice(res.locals.appUser, parsed.data.deviceId)) {
    return res.status(403).json({ error: "Acesso negado ao veículo" });
  }
  try {
    const key = reportCacheKey("/api/reports/stops", parsed.data);
    const cached = getCachedReport(key);
    if (cached !== undefined) {
      res.setHeader("Cache-Control", "private, max-age=15");
      return res.json(cached);
    }
    const value = await traccar.get("/api/reports/stops", parsed.data);
    setCachedReport(key, value);
    res.setHeader("Cache-Control", "private, max-age=15");
    res.json(value);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/reports/summary", requireUser, async (req, res) => {
  const parsed = summaryQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  if (!canViewDevice(res.locals.appUser, parsed.data.deviceId)) {
    return res.status(403).json({ error: "Acesso negado ao veículo" });
  }
  try {
    res.json(await traccar.get("/api/reports/summary", parsed.data));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/alerts", requireUser, async (_req, res) => {
  try {
    const appUser = res.locals.appUser;
    const deviceIds =
      appUser.role === "developer" || appUser.role === "owner"
        ? undefined
        : appUser.deviceIds;
    res.json(await alertStore.list(deviceIds));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post(
  "/api/alerts/:eventId/ack",
  requireUser,
  requireRole("developer", "owner", "manager"),
  async (req, res) => {
    const eventId = z.coerce.number().int().positive().safeParse(req.params.eventId);
    if (!eventId.success) return res.status(400).json({ error: "Alerta inválido" });
    const body = z
      .object({
        status: z.enum(["acknowledged", "resolved"]),
        notes: z.string().max(2000).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());

    try {
      const appUser = res.locals.appUser;
      const allowedDeviceIds =
        appUser.role === "developer" || appUser.role === "owner"
          ? undefined
          : appUser.deviceIds;
      const updatedAlert = await alertStore.updateStatus(
        eventId.data,
        body.data,
        res.locals.authUser.id,
        allowedDeviceIds,
      );
      await auditAction(
        `alert_${body.data.status}`,
        "alert",
        eventId.data,
        res.locals.authUser.id,
        { notes: body.data.notes || null },
      );
      res.json(updatedAlert);
    } catch (error) {
      if (error instanceof AlertStoreError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

app.get("/api/audit", requireUser, requireRole("developer", "owner"), async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("action_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/notifications", requireUser, async (_req, res) => {
  try {
    const appUser = res.locals.appUser;
    let query = supabaseAdmin
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (appUser.role !== "developer" && appUser.role !== "owner") {
      if (!appUser.deviceIds.length) return res.json([]);
      query = query.in("device_id", appUser.deviceIds);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/notifications/:notificationId/read", requireUser, async (req, res) => {
  const notificationId = z.coerce.number().int().positive().safeParse(req.params.notificationId);
  if (!notificationId.success) return res.status(400).json({ error: "Notificação inválida" });

  try {
    const appUser = res.locals.appUser;
    const existing = await supabaseAdmin
      .from("notifications")
      .select("device_id, status")
      .eq("id", notificationId.data)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return res.status(404).json({ error: "Notificação não encontrada" });
    const deviceId = Number(existing.data.device_id);
    if (!canViewDevice(appUser, deviceId)) {
      return res.status(403).json({ error: "Acesso negado à notificação" });
    }

    if (existing.data.status !== "read") {
      const { data, error } = await supabaseAdmin
        .from("notifications")
        .update({ status: "read" })
        .eq("id", notificationId.data)
        .eq("device_id", deviceId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Notificação não encontrada" });
    }

    res.json({ id: notificationId.data, status: "read" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/live", requireUser, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");

  addLiveClient(res, res.locals.appUser);
  req.on("close", () => removeLiveClient(res));
});

app.get(
  "/api/access/me",
  requireUser,
  async (_req, res) => {
    res.json(res.locals.appUser);
  },
);

app.get(
  "/api/access/users",
  requireUser,
  requireRole("developer", "owner"),
  async (_req, res) => {
    try {
      const [{ data: authUsers, error: authError }, { data: profiles, error: profilesError }, { data: assignments, error: assignmentsError }] =
        await Promise.all([
          supabaseAdmin.auth.admin.listUsers(),
          supabaseAdmin
            .from("app_profiles")
            .select("user_id, role, display_name, disabled, created_at"),
          supabaseAdmin
            .from("user_devices")
            .select("user_id, traccar_device_id"),
        ]);
      if (authError) throw authError;
      if (profilesError) throw profilesError;
      if (assignmentsError) throw assignmentsError;

      const profileMap = new Map(
        (profiles || []).map((profile) => [profile.user_id, profile]),
      );
      const users = (authUsers?.users || []).map((user) => {
        const profile = profileMap.get(user.id) as
          | {
              role: string;
              display_name: string | null;
              disabled: boolean;
              created_at: string;
            }
          | undefined;
        return {
          id: user.id,
          email: user.email,
          displayName: profile?.display_name || null,
          role: profile?.role || "viewer",
          disabled: profile?.disabled || false,
          createdAt: profile?.created_at || user.created_at,
          deviceIds: (assignments || [])
            .filter((assignment) => assignment.user_id === user.id)
            .map((assignment) => Number(assignment.traccar_device_id)),
        };
      });
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

app.post(
  "/api/access/users",
  requireUser,
  requireRole("developer", "owner"),
  async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(12).max(128),
        displayName: z.string().trim().min(2).max(100),
        role: z.enum(["owner", "manager", "dispatcher", "viewer"]),
        deviceIds: z.array(z.number().int().positive()).default([]),
      })
      .safeParse(req.body);

    if (!body.success) return res.status(400).json(body.error.flatten());

    try {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: body.data.email,
        password: body.data.password,
        email_confirm: true,
        user_metadata: {
          displayName: body.data.displayName,
          role: body.data.role,
        },
      });
      if (error || !data.user) {
        return res.status(400).json({ error: error?.message || "User creation failed" });
      }

      const profile = await supabaseAdmin
        .from("app_profiles")
        .insert({
          user_id: data.user.id,
          role: body.data.role,
          display_name: body.data.displayName,
          disabled: false,
        });
      if (profile.error) throw profile.error;

      if (body.data.deviceIds.length) {
        const assignments = await supabaseAdmin
          .from("user_devices")
          .insert(
            body.data.deviceIds.map((deviceId) => ({
              user_id: data.user.id,
              traccar_device_id: deviceId,
            })),
          );
        if (assignments.error) throw assignments.error;
      }

      res.status(201).json({
        id: data.user.id,
        email: data.user.email,
        displayName: body.data.displayName,
        role: body.data.role,
        deviceIds: body.data.deviceIds,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

app.put(
  "/api/access/users/:userId",
  requireUser,
  requireRole("developer", "owner"),
  async (req, res) => {
    const parsedUserId = z.string().uuid().safeParse(req.params.userId);
    const body = z
      .object({
        displayName: z.string().trim().min(2).max(100).optional(),
        role: z.enum(["owner", "manager", "dispatcher", "viewer"]).optional(),
        disabled: z.boolean().optional(),
        deviceIds: z.array(z.number().int().positive()).optional(),
      })
      .safeParse(req.body);
    if (!parsedUserId.success || !body.success) {
      return res.status(400).json({ error: "Dados de utilizador inválidos" });
    }

    const userId = parsedUserId.data;
    try {
      const profileUpdate: Record<string, unknown> = {};
      if (body.data.displayName !== undefined) profileUpdate.display_name = body.data.displayName;
      if (body.data.role !== undefined) profileUpdate.role = body.data.role;
      if (body.data.disabled !== undefined) profileUpdate.disabled = body.data.disabled;

      if (Object.keys(profileUpdate).length) {
        const { error } = await supabaseAdmin
          .from("app_profiles")
          .update(profileUpdate)
          .eq("user_id", userId);
        if (error) throw error;
      }

      if (body.data.deviceIds !== undefined) {
        const { error: deleteError } = await supabaseAdmin
          .from("user_devices")
          .delete()
          .eq("user_id", userId);
        if (deleteError) throw deleteError;

        if (body.data.deviceIds.length) {
          const { error: insertError } = await supabaseAdmin
            .from("user_devices")
            .insert(
              body.data.deviceIds.map((deviceId) => ({
                user_id: userId,
                traccar_device_id: deviceId,
              })),
            );
          if (insertError) throw insertError;
        }
      }

      await auditAction(
        "user_updated",
        "user",
        userId,
        res.locals.authUser.id,
        body.data,
      );
      invalidateLiveClientsForUser(userId, body.data.disabled === true);
      res.json({ id: userId, ...body.data });
    } catch (error) {
      invalidateLiveClientsForUser(userId, false);
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

const socketUrl = `${config.traccarUrl.replace(/^http/, "ws")}/api/socket`;

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Fleet API listening on port ${config.port}`);
});

void processNotificationDeliveries();
setInterval(() => {
  void processNotificationDeliveries();
}, 15_000);

void connectTraccarSocket(traccar, socketUrl, async (message) => {
  broadcastLive(message as LiveMessage);
  if (message.events?.length) {
    await alertStore.createFromEvents(message.events);
    await createNotifications(message.events);
  }
}).catch((error) => {
  console.error(
    "Traccar WebSocket unavailable; REST API remains active:",
    error.message,
  );
});
