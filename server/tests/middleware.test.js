import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { errorHandler } from "../middleware/errorHandler.js";

function runMiddleware(middleware, auth) {
  const result = { nextCalled: false, status: null, body: null };
  const req = { auth };
  const res = {
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };
  middleware(req, res, () => { result.nextCalled = true; });
  return result;
}

test("role middleware allows a matching authenticated role", () => {
  const result = runMiddleware(authorizeRoles("HR"), { userId: "hr-1", role: "HR" });
  assert.equal(result.nextCalled, true);
  assert.equal(result.status, null);
});

test("role middleware returns forbidden for a different authenticated role", () => {
  const result = runMiddleware(authorizeRoles("Admin"), { userId: "hr-1", role: "HR" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, "FORBIDDEN");
});

test("role middleware rejects unauthenticated requests", () => {
  const result = runMiddleware(authorizeRoles("Employee"), undefined);
  assert.equal(result.nextCalled, false);
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, "UNAUTHENTICATED");
});

test("role middleware rejects invalid role configuration", () => {
  assert.throws(() => authorizeRoles("Superuser"), /valid application roles/);
});

test("error handler preserves safe application error codes for client errors", () => {
  const result = { status: null, body: null };
  const response = {
    headersSent: false,
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };
  errorHandler(
    Object.assign(new Error("A check-in already exists"), { status: 409, code: "DUPLICATE_CHECK_IN" }),
    {},
    response,
    () => {}
  );
  assert.equal(result.status, 409);
  assert.deepEqual(result.body.error, {
    code: "DUPLICATE_CHECK_IN",
    message: "A check-in already exists"
  });
});
