export type NotificationEvent = {
  id: number;
  type: string;
  deviceId: number;
  eventTime: string;
  positionId?: number;
  attributes?: Record<string, unknown>;
};

export type NotificationWebhookFailure = {
  channel: "email" | "whatsapp";
  reason: "http" | "network" | "timeout";
  status?: number;
};

type WebhookConfig = {
  emailUrl: string;
  whatsappUrl: string;
};

async function postWebhook(
  channel: NotificationWebhookFailure["channel"],
  url: string,
  payload: unknown,
  idempotencyKey: string,
  fetcher: typeof fetch,
): Promise<NotificationWebhookFailure | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    await response.body?.cancel();
    return response.ok
      ? null
      : { channel, reason: "http", status: response.status };
  } catch {
    return {
      channel,
      reason: controller.signal.aborted ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendNotificationWebhooks(
  events: NotificationEvent[],
  config: WebhookConfig,
  fetcher: typeof fetch = fetch,
): Promise<NotificationWebhookFailure[]> {
  if (!events.length) return [];

  const deliveries: Array<{
    channel: NotificationWebhookFailure["channel"];
    url: string;
    payload: unknown;
    idempotencyKey: string;
  }> = [];
  const eventKey = events.map((event) => event.id).sort((a, b) => a - b).join(",");
  if (config.emailUrl) {
    deliveries.push({
      channel: "email",
      url: config.emailUrl,
      payload: { events },
      idempotencyKey: `email:${eventKey}`,
    });
  }
  if (config.whatsappUrl) {
    deliveries.push({
      channel: "whatsapp",
      url: config.whatsappUrl,
      payload: {
        channel: "whatsapp",
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          deviceId: event.deviceId,
          eventTime: event.eventTime,
        })),
      },
      idempotencyKey: `whatsapp:${eventKey}`,
    });
  }

  const results = await Promise.all(
    deliveries.map(({ channel, url, payload, idempotencyKey }) =>
      postWebhook(channel, url, payload, idempotencyKey, fetcher),
    ),
  );
  return results.filter(
    (result): result is NotificationWebhookFailure => result !== null,
  );
}
