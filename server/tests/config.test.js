import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../config/env.js";

const baseEnvironment = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/hcm-lite",
  JWT_SECRET: "test-only-secret-that-is-long-enough",
  FRONTEND_URL: "http://localhost:5173",
  PORT: "5000"
};

test("demo login is disabled unless explicitly enabled in server configuration", () => {
  assert.equal(loadConfig(baseEnvironment).demoLoginEnabled, false);
  assert.equal(
    loadConfig({ ...baseEnvironment, DEMO_LOGIN_ENABLED: "false" }).demoLoginEnabled,
    false
  );
  assert.equal(
    loadConfig({ ...baseEnvironment, DEMO_LOGIN_ENABLED: "true" }).demoLoginEnabled,
    true
  );
});

test("demo credentials remain optional server-side configuration", () => {
  assert.deepEqual(loadConfig(baseEnvironment).demoPasswords, {
    Admin: undefined,
    HR: undefined,
    Employee: undefined
  });
  assert.deepEqual(
    loadConfig({
      ...baseEnvironment,
      DEMO_ADMIN_PASSWORD: "admin-demo-password",
      DEMO_HR_PASSWORD: "human-resources-demo-password",
      DEMO_EMPLOYEE_PASSWORD: "employee-demo-password"
    }).demoPasswords,
    {
      Admin: "admin-demo-password",
      HR: "human-resources-demo-password",
      Employee: "employee-demo-password"
    }
  );
});
