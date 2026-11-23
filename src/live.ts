import type { Response } from "express";
import type { LiveMessage } from "./types.js";

const clients = new Set<Response>();

export function addLiveClient(res: Response) {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

export function removeLiveClient(res: Response) {
  clients.delete(res);
}

export function broadcastLive(message: LiveMessage) {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}
