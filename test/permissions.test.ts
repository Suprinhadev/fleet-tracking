import assert from "node:assert/strict";
import test from "node:test";
import {
  canViewDevice,
  filterLiveMessageForUser,
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

test("one user cannot view another user's assigned device", () => {
  const userA = { role: "manager", deviceIds: [7] };
  const userB = { role: "manager", deviceIds: [8] };
  const devices = [{ id: 7, name: "A" }, { id: 8, name: "B" }];

  assert.equal(canViewDevice(userB, 7), false);
  assert.deepEqual(filterAllowedDevices(userB, devices), [{ id: 8, name: "B" }]);
  assert.equal(canViewDevice(userA, 8), false);
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

test("live messages include only devices assigned to non-administrators", () => {
  const message = {
    devices: [{ id: 1 }, { id: 2 }, { name: "missing id" }],
    positions: [{ deviceId: 1 }, { deviceId: 2 }, {}],
    events: [{ deviceId: 1 }, { deviceId: 2 }, { deviceId: "2" }],
  };

  assert.deepEqual(
    filterLiveMessageForUser({ role: "viewer", deviceIds: [2] }, message),
    {
      devices: [{ id: 2 }],
      positions: [{ deviceId: 2 }],
      events: [{ deviceId: 2 }],
    },
  );
});

test("live messages omit unassigned and malformed device identifiers", () => {
  const message = {
    devices: [{ id: 1 }, { id: Number.NaN }, {}],
    positions: [{ deviceId: 1 }, { deviceId: "1" }, {}],
    events: [{ deviceId: 1 }, { deviceId: Number.MAX_SAFE_INTEGER + 1 }],
  };

  assert.deepEqual(
    filterLiveMessageForUser({ role: "viewer", deviceIds: [1] }, message),
    {
      devices: [{ id: 1 }],
      positions: [{ deviceId: 1 }],
      events: [{ deviceId: 1 }],
    },
  );
});

test("live messages remain complete for administrators", () => {
  const message = {
    devices: [{ id: 1 }, { id: 2 }],
    positions: [{ deviceId: 1 }, { deviceId: 2 }],
    events: [{ deviceId: 1 }, { deviceId: 2 }],
  };

  assert.equal(
    filterLiveMessageForUser({ role: "owner", deviceIds: [] }, message),
    message,
  );
});
