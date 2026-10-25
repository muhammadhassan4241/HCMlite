import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccessToken, verifyAccessToken } from "../utils/jwt.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

const secret = "test-only-secret-that-is-long-enough";

test("access tokens carry a verified user id without an authorization role claim", () => {
  const token = createAccessToken({ _id: "user-123", role: "HR" }, secret);
  assert.deepEqual(verifyAccessToken(token, secret), { userId: "user-123" });
});

test("access token verification rejects a token signed with another secret", () => {
  const token = createAccessToken({ _id: "user-123", role: "Employee" }, secret);
  assert.throws(() => verifyAccessToken(token, "another-test-secret"));
});

test("password hashing verifies the password without storing its plaintext", async () => {
  const password = "test-password";
  const passwordHash = await hashPassword(password, 4);
  assert.notEqual(passwordHash, password);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("incorrect-password", passwordHash), false);
});
