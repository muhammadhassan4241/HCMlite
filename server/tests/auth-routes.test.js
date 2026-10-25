import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../app.js";
import { hashPassword } from "../utils/password.js";
import { createAccessToken } from "../utils/jwt.js";

const secret = "test-only-secret-that-is-long-enough";
const userRecords = new Map();
let server;
let baseUrl;

const fakeUserModel = {
  findOne({ email }) {
    return { select: async () => [...userRecords.values()].find((user) => user.email === email) ?? null };
  },
  findById(id) {
    return { select: async () => userRecords.get(String(id)) ?? null };
  }
};

async function addUser({ id, name, email, role, status = "active", password = "correct horse battery staple" }) {
  const user = {
    _id: id,
    name,
    email,
    role,
    status,
    companyId: null,
    passwordHash: await hashPassword(password, 4)
  };
  userRecords.set(id, user);
  return user;
}

async function request(path, { token, ...options } = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

before(async () => {
  userRecords.clear();
  await addUser({ id: "admin-1", name: "Admin User", email: "admin@example.com", role: "Admin" });
  await addUser({ id: "hr-1", name: "HR User", email: "hr@example.com", role: "HR" });
  await addUser({ id: "employee-1", name: "Employee User", email: "employee@example.com", role: "Employee" });
  await addUser({
    id: "inactive-1", name: "Inactive User", email: "inactive@example.com",
    role: "Employee", status: "inactive"
  });

  const app = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel: fakeUserModel
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

test("valid login returns a bearer token and a safe user profile", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ADMIN@example.com", password: "correct horse battery staple" })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.user.role, "Admin");
  assert.equal(body.data.user.email, "admin@example.com");
  assert.equal("passwordHash" in body.data.user, false);
  assert.equal(typeof body.data.accessToken, "string");
});

test("invalid credentials and inactive accounts are rejected", async () => {
  for (const credentials of [
    { email: "admin@example.com", password: "wrong password" },
    { email: "missing@example.com", password: "correct horse battery staple" },
    { email: "inactive@example.com", password: "correct horse battery staple" }
  ]) {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials)
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "INVALID_CREDENTIALS");
  }
});

test("login validates malformed and missing input", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "" })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_INPUT");
});

test("authenticated /me returns current database role and no password hash", async () => {
  const token = createAccessToken({ _id: "admin-1" }, secret);
  const response = await request("/api/auth/me", { token });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.user, {
    id: "admin-1",
    name: "Admin User",
    email: "admin@example.com",
    role: "Admin",
    status: "active",
    companyId: null
  });
});

test("missing, malformed, invalid, and expired bearer tokens are rejected", async () => {
  const missing = await request("/api/auth/me");
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error.code, "UNAUTHENTICATED");

  for (const token of [
    "not-a-jwt",
    createAccessToken({ _id: "admin-1" }, "another-test-secret-that-is-long-enough"),
    createAccessToken({ _id: "admin-1" }, secret, "-1s")
  ]) {
    const response = await request("/api/auth/me", { token });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "INVALID_TOKEN");
  }
});

test("tokens cannot authenticate inactive or deleted accounts", async () => {
  const inactiveToken = createAccessToken({ _id: "inactive-1" }, secret);
  const inactiveResponse = await request("/api/auth/me", { token: inactiveToken });
  assert.equal(inactiveResponse.status, 401);

  const missingUserToken = createAccessToken({ _id: "deleted-user" }, secret);
  const missingUserResponse = await request("/api/auth/me", { token: missingUserToken });
  assert.equal(missingUserResponse.status, 401);
});

test("protected role endpoints permit only their matching current database role", async () => {
  const users = [
    { id: "admin-1", role: "Admin" },
    { id: "hr-1", role: "HR" },
    { id: "employee-1", role: "Employee" }
  ];

  for (const endpointRole of ["admin", "hr", "employee"]) {
    for (const user of users) {
      const token = createAccessToken({ _id: user.id }, secret);
      const response = await request(`/api/auth/protected/${endpointRole}`, { token });
      const shouldPass = user.role.toLowerCase() === endpointRole;
      assert.equal(response.status, shouldPass ? 200 : 403, `${user.role} accessing ${endpointRole}`);
    }
  }
});

test("authorization ignores role values supplied when the token is created", async () => {
  const token = createAccessToken({ _id: "admin-1", role: "Employee" }, secret);
  const response = await request("/api/auth/protected/admin", { token });
  assert.equal(response.status, 200);
});

test("passwords are stored as bcrypt hashes", async () => {
  for (const user of userRecords.values()) {
    assert.match(user.passwordHash, /^\$2[aby]\$/);
    assert.notEqual(user.passwordHash, "correct horse battery staple");
  }
});
