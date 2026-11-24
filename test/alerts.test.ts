import assert from "node:assert/strict";
import test from "node:test";
import { getAlertStatusConflict } from "../src/alert-status.js";

test("allows valid alert acknowledgement and resolution transitions", () => {
  assert.equal(getAlertStatusConflict("open", "acknowledged"), null);
  assert.equal(getAlertStatusConflict("open", "resolved"), null);
  assert.equal(getAlertStatusConflict("acknowledged", "resolved"), null);
  assert.equal(getAlertStatusConflict("resolved", "resolved"), null);
});

test("prevents a resolved alert from being reopened", () => {
  assert.equal(
    getAlertStatusConflict("resolved", "acknowledged"),
    "Um alerta resolvido não pode ser reaberto.",
  );
});
