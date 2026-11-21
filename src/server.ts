import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { config } from "./config.js";
import { requireUser } from "./auth.js";
import { TraccarClient } from "./traccar/client.js";
import { connectTraccarSocket } from "./traccar/socket.js";
import { createAlertStore } from "./supabase/alerts.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
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

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/devices", requireUser, async (_req, res) => {
  try {
    res.json(await traccar.get("/api/devices"));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

const positionQuery = z.object({
  deviceId: z.coerce.number().int().positive().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

app.get("/api/positions", requireUser, async (req, res) => {
  const parsed = positionQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    res.json(await traccar.get("/api/positions", parsed.data));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

const routeQuery = z.object({
  deviceId: z.coerce.number().int().positive(),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

app.get("/api/reports/route", requireUser, async (req, res) => {
  const parsed = routeQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    res.json(await traccar.get("/api/reports/route", parsed.data));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/events", requireUser, async (req, res) => {
  const parsed = z
    .object({
      deviceId: z.coerce.number().int().positive(),
      from: z.string().datetime(),
      to: z.string().datetime(),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  try {
    res.json(await traccar.get("/api/events", parsed.data));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.post("/api/alerts/:eventId/ack", requireUser, async (req, res) => {
  const eventId = z.coerce.number().int().positive().safeParse(req.params.eventId);
  if (!eventId.success) return res.status(400).json({ error: "Invalid eventId" });
  const body = z
    .object({
      status: z.enum(["acknowledged", "resolved"]),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error.flatten());

  try {
    res.json(
      await alertStore.updateStatus(eventId.data, body.data, res.locals.user.id),
    );
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

const socketUrl = `${config.traccarUrl.replace(/^http/, "ws")}/api/socket`;
void connectTraccarSocket(traccar, socketUrl, async (message) => {
  if (message.events?.length) {
    await alertStore.createFromEvents(message.events);
  }
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Fleet API listening on port ${config.port}`);
});
