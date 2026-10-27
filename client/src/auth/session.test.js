import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuthSession } from "./session.js";

test("extracts a normal or demo session from the API response envelope", () => {
  const session = {
    accessToken: "test-token",
    user: { id: "user-1", role: "HR", companyId: "company-1" }
  };
  assert.deepEqual(getAuthSession({ success: true, data: session }), session);
});

test("rejects malformed authentication responses", () => {
  assert.throws(
    () => getAuthSession({ success: true }),
    /invalid session/
  );
});
