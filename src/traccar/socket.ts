import WebSocket from "ws";
import type { TraccarClient } from "./client.js";

export type TraccarSocketMessage = {
  devices?: unknown[];
  positions?: unknown[];
  events?: Array<{
    id: number;
    type: string;
    deviceId: number;
    positionId?: number;
    eventTime: string;
    attributes?: Record<string, unknown>;
  }>;
};

export async function connectTraccarSocket(
  client: TraccarClient,
  socketUrl: string,
  onMessage: (message: TraccarSocketMessage) => Promise<void>,
): Promise<void> {
  const cookie = await client.createSession();

  const connect = () => {
    const socket = new WebSocket(socketUrl, {
      headers: { Cookie: cookie },
    });

    socket.on("message", (raw) => {
      void onMessage(JSON.parse(raw.toString()) as TraccarSocketMessage).catch(
        (error) => console.error("Failed to process Traccar event:", error),
      );
    });

    socket.on("close", () => {
      console.warn("Traccar WebSocket closed; reconnecting in 5 seconds");
      setTimeout(connect, 5000);
    });

    socket.on("error", (error) => {
      console.error("Traccar WebSocket error:", error.message);
    });
  };

  connect();
}
