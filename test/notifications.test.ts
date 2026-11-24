import assert from "node:assert/strict";
import test from "node:test";
import {
  sendNotificationWebhooks,
  type NotificationEvent,
} from "../src/notifications.js";
import {
  getNotificationDeliveryFailureUpdate,
  MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
} from "../src/notification-delivery.js";

const sampleEvents: NotificationEvent[] = [
  { id: 11, type: "deviceOffline", deviceId: 3, eventTime: "2026-11-24T10:00:00Z" },
  { id: 12, type: "alarm", deviceId: 8, eventTime: "2026-11-24T10:01:00Z" },
];

test("schedules increasing webhook retry delays and stops after the attempt limit", () => {
  const now = new Date("2026-11-24T10:00:00.000Z");
  const firstFailure = getNotificationDeliveryFailureUpdate(1, now, "http_503");
  const fourthFailure = getNotificationDeliveryFailureUpdate(4, now, "timeout");
  const finalFailure = getNotificationDeliveryFailureUpdate(
    MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
    now,
    "network",
  );

  assert.equal(firstFailure.status, "pending");
  assert.equal(firstFailure.next_attempt_at, "2026-11-24T10:01:00.000Z");
  assert.equal(fourthFailure.status, "pending");
  assert.equal(fourthFailure.next_attempt_at, "2026-11-24T11:00:00.000Z");
  assert.equal(finalFailure.status, "failed");
  assert.equal(finalFailure.next_attempt_at, now.toISOString());
  assert.equal(finalFailure.last_error, "network");
  assert.equal(finalFailure.lease_expires_at, null);
});

test("sends configured webhook payloads to independent channels", async () => {
  const calls: Array<{ url: string; body: unknown; idempotencyKey: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      idempotencyKey: new Headers(init?.headers).get("Idempotency-Key"),
    });
    return new Response(null, { status: 202 });
  };

  const failures = await sendNotificationWebhooks(
    sampleEvents,
    {
      emailUrl: "https://mail.example.test",
      whatsappUrl: "https://whatsapp.example.test",
    },
    fetcher,
  );

  assert.deepEqual(failures, []);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.find((call) => call.url.includes("mail"))?.body, {
    events: sampleEvents,
  });
  assert.deepEqual(calls.find((call) => call.url.includes("whatsapp"))?.body, {
    channel: "whatsapp",
    events: sampleEvents.map(({ id, type, deviceId, eventTime }) => ({
      id,
      type,
      deviceId,
      eventTime,
    })),
  });
  assert.equal(
    calls.find((call) => call.url.includes("mail"))?.idempotencyKey,
    "email:11,12",
  );
  assert.equal(
    calls.find((call) => call.url.includes("whatsapp"))?.idempotencyKey,
    "whatsapp:11,12",
  );
});

test("reports HTTP and network failures without skipping the other channel", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("mail")) return new Response(null, { status: 503 });
    throw new TypeError("network failure");
  };

  const failures = await sendNotificationWebhooks(
    sampleEvents,
    {
      emailUrl: "https://mail.example.test",
      whatsappUrl: "https://whatsapp.example.test",
    },
    fetcher,
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(failures, [
    { channel: "email", reason: "http", status: 503 },
    { channel: "whatsapp", reason: "network" },
  ]);
});
