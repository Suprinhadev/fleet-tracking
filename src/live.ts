import type { Response } from "express";
import type { AppUser } from "./auth.js";
import { filterLiveMessageForUser } from "./permissions.js";
import type { LiveMessage } from "./types.js";

type LiveUser = Pick<AppUser, "id" | "role" | "deviceIds">;

const clients = new Map<Response, LiveUser>();

export function addLiveClient(res: Response, appUser: LiveUser) {
  clients.set(res, {
    id: appUser.id,
    role: appUser.role,
    deviceIds: [...appUser.deviceIds],
  });
  res.on("close", () => clients.delete(res));
}

export function removeLiveClient(res: Response) {
  clients.delete(res);
}

export function invalidateLiveClientsForUser(userId: string, accessRevoked: boolean) {
  const message: LiveMessage = accessRevoked
    ? { accessRevoked: true }
    : { accessChanged: true };
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const [response, appUser] of clients) {
    if (appUser.id !== userId) continue;
    response.write(payload);
    response.end();
    clients.delete(response);
  }
}

export function broadcastLive(message: LiveMessage) {
  for (const [client, appUser] of clients) {
    const filteredMessage = filterLiveMessageForUser(appUser, message);
    client.write(`data: ${JSON.stringify(filteredMessage)}\n\n`);
  }
}
