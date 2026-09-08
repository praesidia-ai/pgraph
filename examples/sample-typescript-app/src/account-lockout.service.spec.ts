import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountLockoutService } from "./account-lockout.service.js";
test("lockout expires after fifteen minutes", () => {
  const lockout = new AccountLockoutService();
  for (let attempt = 0; attempt < 5; attempt++)
    lockout.recordFailure("a@example.test", 100);
  assert.equal(lockout.isLocked("a@example.test", 101), true);
  assert.equal(lockout.isLocked("a@example.test", 900_101), false);
});
