import assert from "node:assert/strict";
import { test } from "node:test";
import { getLoginErrorMessage } from "./loginErrors.js";

test("invalid credentials get a clear normal-login message", () => {
  assert.equal(
    getLoginErrorMessage({
      response: { status: 401, data: { error: { code: "INVALID_CREDENTIALS" } } }
    }),
    "Email or password is incorrect. Check your credentials and try again."
  );
});

test("demo-login errors are not displayed as normal-login errors", () => {
  assert.equal(
    getLoginErrorMessage({
      response: { status: 404, data: { error: { code: "DEMO_LOGIN_DISABLED" } } }
    }),
    "The sign-in service is unavailable. Please try again later."
  );
});

test("network, server, and invalid-input failures get accurate messages", () => {
  assert.match(getLoginErrorMessage(new Error("network error")), /Cannot reach/);
  assert.match(
    getLoginErrorMessage({ response: { status: 503 } }),
    /temporarily unavailable/
  );
  assert.match(
    getLoginErrorMessage({
      response: { status: 400, data: { error: { code: "INVALID_INPUT" } } }
    }),
    /valid email address and password/
  );
});
