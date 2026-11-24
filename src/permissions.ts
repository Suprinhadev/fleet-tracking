import type { LiveMessage } from "./types.js";

export type PermissionUser = {
  role: string;
  deviceIds: number[];
};

export function isAdministrator(role: string) {
  return role === "developer" || role === "owner";
}

export function canViewDevice(appUser: PermissionUser, deviceId: number) {
  return isAdministrator(appUser.role) || appUser.deviceIds.includes(deviceId);
}

export function filterAllowedDevices<T extends { id: number }>(
  appUser: PermissionUser,
  devices: T[],
): T[] {
  if (isAdministrator(appUser.role)) return devices;
  return devices.filter((device) => appUser.deviceIds.includes(device.id));
}

function getNumericField(value: unknown, field: "id" | "deviceId"): number | null {
  if (typeof value !== "object" || value === null) return null;
  const fieldValue = Reflect.get(value, field);
  return typeof fieldValue === "number" && Number.isSafeInteger(fieldValue)
    ? fieldValue
    : null;
}

export function filterLiveMessageForUser(
  appUser: PermissionUser,
  message: LiveMessage,
): LiveMessage {
  if (isAdministrator(appUser.role)) return message;

  const filterItems = (items: unknown[] | undefined, field: "id" | "deviceId") =>
    items?.filter((item) => {
      const deviceId = getNumericField(item, field);
      return deviceId !== null && canViewDevice(appUser, deviceId);
    });

  return {
    ...(message.devices === undefined ? {} : { devices: filterItems(message.devices, "id") }),
    ...(message.positions === undefined ? {} : { positions: filterItems(message.positions, "deviceId") }),
    ...(message.events === undefined ? {} : { events: filterItems(message.events, "deviceId") }),
  };
}
