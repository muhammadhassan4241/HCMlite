import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.js";
import { createAccessToken } from "../utils/jwt.js";

const secret = "company-setup-test-secret-long-enough";
const adminId = "64b000000000000000000051";
const hrId = "64b000000000000000000052";
const employeeId = "64b000000000000000000053";
const companyId = "64b000000000000000000054";
const validSettings = {
  name: "Acme Company",
  logoUrl: "",
  email: "hello@acme.example",
  phone: "",
  address: {},
  timeZone: "UTC",
  workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  openingTime: "09:00",
  closingTime: "17:00"
};

async function startApp({ companies = [], adminCompanyId = null } = {}) {
  const users = [
    { _id: adminId, role: "Admin", status: "active", companyId: adminCompanyId },
    { _id: hrId, role: "HR", status: "active", companyId: null },
    { _id: employeeId, role: "Employee", status: "active", companyId: null }
  ];
  const companyRecords = [...companies];
  const userModel = {
    findById(id) {
      return {
        select: async () => users.find((user) => String(user._id) === String(id)) ?? null
      };
    },
    async updateOne(filter, update) {
      const user = users.find((entry) =>
        String(entry._id) === String(filter._id) &&
        entry.role === filter.role &&
        (filter.companyId !== null || entry.companyId === null)
      );
      if (!user) return { matchedCount: 0 };
      Object.assign(user, update.$set);
      return { matchedCount: 1 };
    }
  };
  const companyModel = {
    countDocuments: async () => companyRecords.length,
    findOne() {
      return { select: async () => companyRecords[0] ?? null };
    },
    async findById(id) {
      return companyRecords.find((company) => String(company._id) === String(id)) ?? null;
    },
    async create(data) {
      const company = { ...data, _id: companyId };
      companyRecords.push(company);
      return company;
    },
    async findOneAndUpdate(filter, update) {
      const company = companyRecords.find((entry) => String(entry._id) === String(filter._id));
      if (!company) return null;
      Object.assign(company, update.$set);
      return company;
    }
  };
  const app = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel,
    companyModel
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    companies: companyRecords,
    users,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()))
  };
}

async function request(app, path, { userId, ...options } = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (userId) headers.Authorization = `Bearer ${createAccessToken({ _id: userId }, secret)}`;
  if (options.body) headers["Content-Type"] = "application/json";
  return fetch(`${app.baseUrl}${path}`, { ...options, headers });
}

test("unauthenticated and non-Admin users cannot inspect or perform company setup", async () => {
  const app = await startApp();
  try {
    assert.equal((await request(app, "/api/company/setup")).status, 401);
    assert.equal((await request(app, "/api/company/setup", {
      method: "POST",
      body: JSON.stringify({ action: "create", settings: validSettings })
    })).status, 401);
    for (const userId of [hrId, employeeId]) {
      assert.equal((await request(app, "/api/company/setup", { userId })).status, 403);
      assert.equal((await request(app, "/api/company/setup", {
        userId,
        method: "POST",
        body: JSON.stringify({ action: "create", settings: validSettings })
      })).status, 403);
    }
  } finally {
    await app.close();
  }
});

test("Admin initializes the first company once and receives assigned company settings access", async () => {
  const app = await startApp();
  try {
    const statusResponse = await request(app, "/api/company/setup", { userId: adminId });
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).data.status, "uninitialized");

    const createResponse = await request(app, "/api/company/setup", {
      userId: adminId,
      method: "POST",
      body: JSON.stringify({ action: "create", settings: validSettings })
    });
    assert.equal(createResponse.status, 201);
    assert.equal(app.companies.length, 1);
    assert.equal(String(app.users[0].companyId), companyId);
    assert.equal(app.users[1].companyId, null);
    assert.equal(app.users[2].companyId, null);

    const retryResponse = await request(app, "/api/company/setup", {
      userId: adminId,
      method: "POST",
      body: JSON.stringify({ action: "create", settings: validSettings })
    });
    assert.equal(retryResponse.status, 200);
    assert.equal(app.companies.length, 1);

    const settingsResponse = await request(app, "/api/company/settings", { userId: adminId });
    assert.equal(settingsResponse.status, 200);
    assert.equal((await settingsResponse.json()).data.company.name, validSettings.name);
  } finally {
    await app.close();
  }
});

test("unassigned Admin explicitly confirms the sole existing company before assignment", async () => {
  const existingCompany = { _id: companyId, name: "Existing Company" };
  const app = await startApp({ companies: [existingCompany] });
  try {
    const statusResponse = await request(app, "/api/company/setup", { userId: adminId });
    const status = await statusResponse.json();
    assert.equal(status.data.status, "assignment-required");
    assert.equal(status.data.company.id, companyId);

    const createResponse = await request(app, "/api/company/setup", {
      userId: adminId,
      method: "POST",
      body: JSON.stringify({ action: "create", settings: validSettings })
    });
    assert.equal(createResponse.status, 409);
    assert.equal(app.users[0].companyId, null);

    const assignResponse = await request(app, "/api/company/setup", {
      userId: adminId,
      method: "POST",
      body: JSON.stringify({ action: "assign", companyId })
    });
    assert.equal(assignResponse.status, 200);
    assert.equal(String(app.users[0].companyId), companyId);
    assert.equal(app.companies.length, 1);
    assert.equal((await request(app, "/api/company/settings", { userId: adminId })).status, 200);
  } finally {
    await app.close();
  }
});

test("an Admin with a missing company reference is not silently assigned elsewhere", async () => {
  const app = await startApp({ adminCompanyId: companyId });
  try {
    const response = await request(app, "/api/company/setup", { userId: adminId });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "COMPANY_ASSIGNMENT_INVALID");
    assert.equal(app.companies.length, 0);
    assert.equal(String(app.users[0].companyId), companyId);
  } finally {
    await app.close();
  }
});

test("setup refuses to choose among multiple existing companies", async () => {
  const app = await startApp({
    companies: [
      { _id: companyId, name: "Company One" },
      { _id: "64b000000000000000000055", name: "Company Two" }
    ]
  });
  try {
    const statusResponse = await request(app, "/api/company/setup", { userId: adminId });
    assert.equal((await statusResponse.json()).data.status, "ambiguous");

    const assignResponse = await request(app, "/api/company/setup", {
      userId: adminId,
      method: "POST",
      body: JSON.stringify({ action: "assign", companyId })
    });
    assert.equal(assignResponse.status, 409);
    assert.equal(app.users[0].companyId, null);
  } finally {
    await app.close();
  }
});
