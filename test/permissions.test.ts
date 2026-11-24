import assert from "node:assert/strict";
import test from "node:test";
import {
  canViewDevice,
  filterAllowedDevices,
  isAdministrator,
} from "../src/permissions.js";

test("developer and owner can view every device", () => {
  for (const role of ["developer", "owner"]) {
    assert.equal(isAdministrator(role), true);
    assert.equal(canViewDevice({ role, deviceIds: [] }, 42), true);
  }
});

test("assigned manager can view only assigned devices", () => {
  const appUser = { role: "manager", deviceIds: [1, 7] };
  assert.equal(canViewDevice(appUser, 7), true);
  assert.equal(canViewDevice(appUser, 8), false);
});

test("viewer cannot view devices outside assignments", () => {
  const appUser = { role: "viewer", deviceIds: [3] };
  assert.equal(canViewDevice(appUser, 3), true);
  assert.equal(canViewDevice(appUser, 4), false);
});

test("device filtering preserves objects and assignments", () => {
  const devices = [
    { id: 1, name: "A" },
    { id: 2, name: "B" },
    { id: 3, name: "C" },
  ];

  assert.deepEqual(
    filterAllowedDevices({ role: "dispatcher", deviceIds: [2] }, devices),
    [{ id: 2, name: "B" }],
  );
  assert.deepEqual(
    filterAllowedDevices({ role: "owner", deviceIds: [] }, devices),
    devices,
  );
});
