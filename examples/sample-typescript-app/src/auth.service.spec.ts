import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "./auth.service.js";
import { UserRepository } from "./user.repository.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
test("login rejects unknown accounts", () => {
  const auth = new AuthService(
    new UserRepository(),
    new PasswordService(),
    new TokenService(),
  );
  assert.throws(
    () => auth.login("missing@example.test", "wrong"),
    /Invalid credentials/,
  );
});
