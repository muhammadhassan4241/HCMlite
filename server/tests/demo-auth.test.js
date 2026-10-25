import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../app.js";
import { createAccessToken } from "../utils/jwt.js";
import { hashPassword } from "../utils/password.js";

const secret = "test-only-secret-that-is-long-enough";
const passwords = {
  Admin: "admin-demo-password",
  HR: "human-resources-demo-password",
  Employee: "employee-demo-password"
};
const accountData = [
  { id: "demo-admin", email: "demo.admin@hcm-lite.local", role: "Admin", passwordKey: "Admin" },
  { id: "demo-hr", email: "demo.hr@hcm-lite.local", role: "HR", passwordKey: "HR" },
  {
    id: "demo-employee",
    email: "demo.employee@hcm-lite.local",
    role: "Employee",
    passwordKey: "Employee"
  }
];
const users = new Map();
let server;
let baseUrl;

const userModel = {
  findOne({ email, role }) {
    return {
      select: async () => [...users.values()].find((user) =>
        user.email === email && (!role || user.role === role)
      ) ?? null
    };
  },
  findById(id) {
    return { select: async () => users.get(String(id)) ?? null };
  }
};

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }
  });
}

before(async () => {
  users.clear();
  for (const account of accountData) {
    users.set(account.id, {
      _id: account.id,
      name: `Demo ${account.role}`,
      email: account.email,
      role: account.role,
      status: "active",
      companyId: null,
      passwordHash: await hashPassword(passwords[account.passwordKey], 4)
    });
  }

  const app = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel,
    demoLoginEnabled: true,
    demoPasswords: passwords
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("demo login authenticates each configured role through the API", async () => {
  for (const { role } of accountData) {
    const response = await request("/api/auth/demo-login", {
      method: "POST",
      body: JSON.stringify({ role })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.user.role, role);
    assert.equal(typeof body.data.accessToken, "string");
    assert.equal("passwordHash" in body.data.user, false);

    const endpointRole = role.toLowerCase();
    const protectedResponse = await request(`/api/auth/protected/${endpointRole}`, {
      headers: { Authorization: `Bearer ${body.data.accessToken}` }
    });
    assert.equal(protectedResponse.status, 200);
    assert.equal((await protectedResponse.json()).data.permittedRole, role);
  }
});

test("demo login rejects invalid configured credentials", async () => {
  const invalidCredentialsApp = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel,
    demoLoginEnabled: true,
    demoPasswords: { ...passwords, Admin: "incorrect-admin-password" }
  });
  const invalidCredentialsServer = invalidCredentialsApp.listen(0);
  await new Promise((resolve) => invalidCredentialsServer.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${invalidCredentialsServer.address().port}/api/auth/demo-login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "Admin" })
      }
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "INVALID_CREDENTIALS");
  } finally {
    await new Promise((resolve, reject) => {
      invalidCredentialsServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("demo login reports when the selected account has not been provisioned", async () => {
  const emptyUserModel = {
    findOne() {
      return { select: async () => null };
    }
  };
  const missingAccountApp = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel: emptyUserModel,
    demoLoginEnabled: true,
    demoPasswords: passwords
  });
  const missingAccountServer = missingAccountApp.listen(0);
  await new Promise((resolve) => missingAccountServer.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${missingAccountServer.address().port}/api/auth/demo-login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "Admin" })
      }
    );
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "DEMO_ACCOUNT_NOT_PROVISIONED");
  } finally {
    await new Promise((resolve, reject) => {
      missingAccountServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("demo login reports missing server-side passwords", async () => {
  const missingPasswordsApp = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel,
    demoLoginEnabled: true
  });
  const missingPasswordsServer = missingPasswordsApp.listen(0);
  await new Promise((resolve) => missingPasswordsServer.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${missingPasswordsServer.address().port}/api/auth/demo-login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "Admin" })
      }
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "DEMO_CREDENTIALS_NOT_CONFIGURED");
  } finally {
    await new Promise((resolve, reject) => {
      missingPasswordsServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("demo login is disabled by default", async () => {
  const disabledApp = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel,
    demoPasswords: passwords
  });
  const disabledServer = disabledApp.listen(0);
  await new Promise((resolve) => disabledServer.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${disabledServer.address().port}/api/auth/demo-login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "Admin" })
      }
    );
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "DEMO_LOGIN_DISABLED");
  } finally {
    await new Promise((resolve, reject) => {
      disabledServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("demo login does not accept a client-selected unsupported role", async () => {
  const response = await request("/api/auth/demo-login", {
    method: "POST",
    body: JSON.stringify({ role: "SuperAdmin" })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_DEMO_ROLE");
});

test("demo sessions use the account role from the database for authorization", async () => {
  const token = createAccessToken({ _id: "demo-hr", role: "Admin" }, secret);
  const response = await request("/api/auth/protected/admin", {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 403);
});
