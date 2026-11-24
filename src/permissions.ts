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
