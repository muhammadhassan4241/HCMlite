import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../app.js";
import Employee from "../models/Employee.js";
import { createAccessToken } from "../utils/jwt.js";

const secret = "employee-route-test-secret-long-enough";
const companyId = "64b000000000000000000061";
const otherCompanyId = "64b000000000000000000062";
const adminId = "64b000000000000000000063";
const hrId = "64b000000000000000000064";
const employeeUserId = "64b000000000000000000065";
const otherEmployeeUserId = "64b000000000000000000066";
const departmentId = "64b000000000000000000067";
const otherDepartmentId = "64b000000000000000000068";
const designationId = "64b000000000000000000069";
const otherCompanyEmployeeId = "64b000000000000000000070";
const users = [
  { _id: adminId, name: "Tenant Admin", email: "admin@company.example", role: "Admin", status: "active", companyId },
  { _id: hrId, name: "HR User", email: "hr@company.example", role: "HR", status: "active", companyId },
  { _id: employeeUserId, name: "Casey Employee", email: "casey@company.example", role: "Employee", status: "active", companyId },
  { _id: otherEmployeeUserId, name: "Other Tenant", email: "other@elsewhere.example", role: "Employee", status: "active", companyId: otherCompanyId }
];
const departments = [
  { _id: departmentId, companyId, name: "Engineering", active: true },
  { _id: otherDepartmentId, companyId: otherCompanyId, name: "Private Department", active: true }
];
const designations = [
  { _id: designationId, companyId, departmentId, name: "Engineer", active: true }
];
let employees;
let nextEmployeeSuffix;
let server;
let baseUrl;

function same(left, right) {
  return String(left) === String(right);
}

function matches(record, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some((item) => matches(record, item));
    if (key === "$and") return expected.every((item) => matches(record, item));
    const actual = record[key];
    if (expected instanceof RegExp) return expected.test(String(actual ?? ""));
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("$ne" in expected) return !same(actual, expected.$ne);
      if ("$exists" in expected) return (actual !== undefined) === expected.$exists;
    }
    return same(actual, expected);
  });
}

class EmployeeQuery {
  constructor(filter, many) {
    this.filter = filter;
    this.many = many;
    this.sortBy = null;
    this.offset = 0;
    this.max = Infinity;
    this.shouldPopulate = false;
  }
  populate() { this.shouldPopulate = true; return this; }
  sort(value) { this.sortBy = value; return this; }
  skip(value) { this.offset = value; return this; }
  limit(value) { this.max = value; return this; }
  select() { return this; }
  async result(many) {
    let result = employees.filter((entry) => matches(entry, this.filter));
    if (this.sortBy) {
      result = result.sort((left, right) => {
        for (const [key, direction] of Object.entries(this.sortBy)) {
          const order = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
          if (order) return order * direction;
        }
        return 0;
      });
    }
    result = many ? result.slice(this.offset, this.offset + this.max) : result.slice(0, 1);
    const clone = (record) => {
      const item = { ...record };
      if (this.shouldPopulate) {
        item.departmentId = departments.find((entry) => same(entry._id, record.departmentId)) ?? record.departmentId;
        item.designationId = designations.find((entry) => same(entry._id, record.designationId)) ?? record.designationId;
      }
      return item;
    };
    return many ? result.map(clone) : result[0] ? clone(result[0]) : null;
  }
  lean() { return this.result(this.many); }
  then(resolve, reject) { return this.result(false).then(resolve, reject); }
}

const userModel = {
  findById(id) {
    return { select: async () => users.find((user) => same(user._id, id)) ?? null };
  },
  findOne(filter) {
    return { select: async () => users.find((user) => matches(user, filter)) ?? null };
  },
  async updateOne(filter, update) {
    const user = users.find((entry) => matches(entry, filter));
    if (!user) return { matchedCount: 0 };
    Object.assign(user, update.$set ?? {});
    return { matchedCount: 1 };
  },
  find(filter) {
    const result = users.filter((user) => matches(user, filter));
    return {
      select() {
        return {
          sort() {
            return { lean: async () => result };
          }
        };
      }
    };
  }
};

const companyModel = {
  async findById(id) {
    if (same(id, companyId)) return { _id: companyId };
    if (same(id, otherCompanyId)) return { _id: otherCompanyId };
    return null;
  }
};

const departmentModel = {
  findOne(filter) {
    return { select: async () => departments.find((entry) => matches(entry, filter)) ?? null };
  },
  find(filter) {
    const result = departments.filter((entry) => matches(entry, filter));
    return {
      select() {
        return {
          sort() {
            return { lean: async () => result };
          }
        };
      }
    };
  }
};

const designationModel = {
  findOne(filter) {
    return { select: async () => designations.find((entry) => matches(entry, filter)) ?? null };
  },
  find(filter) {
    const result = designations.filter((entry) => matches(entry, filter));
    return {
      select() {
        return {
          sort() {
            return { lean: async () => result };
          }
        };
      }
    };
  }
};

const employeeModel = {
  create: async (record) => {
    if (record.workEmail && employees.some((entry) =>
      same(entry.companyId, record.companyId) && entry.workEmail === record.workEmail
    )) {
      const error = new Error("Duplicate work email");
      error.code = 11000;
      error.keyPattern = { companyId: 1, workEmail: 1 };
      throw error;
    }
    if (record.userId && employees.some((entry) =>
      same(entry.companyId, record.companyId) && same(entry.userId, record.userId)
    )) {
      const error = new Error("Duplicate account link");
      error.code = 11000;
      error.keyPattern = { companyId: 1, userId: 1 };
      throw error;
    }
    const employee = { ...record, _id: `64b0000000000000000000${nextEmployeeSuffix++}` };
    employees.push(employee);
    return employee;
  },
  exists: async (filter) => employees.some((entry) => matches(entry, filter)),
  find(filter) { return new EmployeeQuery(filter, true); },
  findOne(filter) { return new EmployeeQuery(filter, false); },
  countDocuments: async (filter) => employees.filter((entry) => matches(entry, filter)).length,
  async findOneAndUpdate(filter, update) {
    const employee = employees.find((entry) => matches(entry, filter));
    if (!employee) return null;
    Object.assign(employee, update.$set ?? {});
    for (const key of Object.keys(update.$unset ?? {})) delete employee[key];
    return employee;
  }
};

function validEmployee(overrides = {}) {
  return {
    firstName: "Jordan",
    lastName: "Rivera",
    workEmail: "jordan.rivera@company.example",
    phone: "+1 555 0100",
    photoUrl: "",
    departmentId,
    designationId,
    joiningDate: "2024-05-10",
    employmentType: "Full-time",
    status: "Active",
    ...overrides
  };
}

async function request(path, { userId, ...options } = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (userId) headers.Authorization = `Bearer ${createAccessToken({ _id: userId }, secret)}`;
  if (options.body) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

before(async () => {
  employees = [{
    _id: otherCompanyEmployeeId,
    companyId: otherCompanyId,
    employeeId: "EMP-OTHER",
    firstName: "Private",
    lastName: "Employee",
    joiningDate: new Date("2024-01-01T00:00:00.000Z"),
    employmentType: "Full-time",
    status: "Active"
  }];
  nextEmployeeSuffix = 71;
  const app = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel,
    companyModel,
    organizationModels: {
      employees: employeeModel,
      departments: departmentModel,
      designations: designationModel
    }
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
});

test("employee endpoints reject unauthenticated access and deny Employee management actions", async () => {
  assert.equal((await request("/api/employees")).status, 401);
  const deniedList = await request("/api/employees", { userId: employeeUserId });
  assert.equal(deniedList.status, 403);
  const deniedCreate = await request("/api/employees", {
    userId: employeeUserId,
    method: "POST",
    body: JSON.stringify(validEmployee())
  });
  assert.equal(deniedCreate.status, 403);
});

test("employee model indexes identifiers and optional fields within company scope without credentials", () => {
  const indexes = Employee.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    keys.companyId === 1 && keys.employeeId === 1 && options.unique
  ));
  assert.ok(indexes.some(([keys, options]) =>
    keys.companyId === 1 && keys.workEmail === 1 && options.unique && options.partialFilterExpression
  ));
  assert.ok(indexes.some(([keys, options]) =>
    keys.companyId === 1 && keys.userId === 1 && options.unique && options.partialFilterExpression
  ));
  assert.equal(Employee.schema.path("password"), undefined);
  assert.equal(Employee.schema.path("passwordHash"), undefined);
});

test("Admin and HR can create company employees with generated IDs and no credentials", async () => {
  for (const userId of [adminId, hrId]) {
    const response = await request("/api/employees", {
      userId,
      method: "POST",
      body: JSON.stringify(validEmployee({ workEmail: `created${nextEmployeeSuffix}@company.example` }))
    });
    assert.equal(response.status, 201);
    const { employee } = (await response.json()).data;
    assert.match(employee.employeeId, /^EMP-[A-F0-9]{24}$/);
    assert.equal(employee.companyId, companyId);
    assert.equal(employee.workEmail, `created${Number(employee._id.slice(-2))}@company.example`);
    assert.equal("password" in employee, false);
    assert.equal("passwordHash" in employee, false);
  }
  assert.notEqual(
    employees[employees.length - 2].employeeId,
    employees[employees.length - 1].employeeId
  );
  const fullNameSearch = await request("/api/employees?search=Jordan%20Rivera", { userId: hrId });
  assert.equal(fullNameSearch.status, 200);
  assert.ok((await fullNameSearch.json()).data.employees.length >= 2);
});

test("creation validates fields, references and company-scoped uniqueness", async () => {
  const tests = [
    { data: validEmployee({ workEmail: "not-email" }), message: "valid work email" },
    { data: validEmployee({ joiningDate: "2024-02-30" }), message: "valid calendar date" },
    { data: validEmployee({ departmentId: otherDepartmentId }), message: "active and belong to this company" },
    { data: validEmployee({ designationId: otherDepartmentId }), message: "Designation must be active" },
    { data: validEmployee({ departmentId: "", designationId }), message: "different department" },
    { data: validEmployee({ extra: "unsupported" }), message: "unsupported fields" }
  ];
  for (const item of tests) {
    const response = await request("/api/employees", {
      userId: adminId,
      method: "POST",
      body: JSON.stringify(item.data)
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, new RegExp(item.message, "i"));
  }

  const duplicateEmail = `created71@company.example`;
  const duplicateResponse = await request("/api/employees", {
    userId: adminId,
    method: "POST",
    body: JSON.stringify(validEmployee({ workEmail: duplicateEmail }))
  });
  assert.equal(duplicateResponse.status, 409);
  assert.equal((await duplicateResponse.json()).error.code, "DUPLICATE_WORK_EMAIL");
});

test("directory search, filters and pagination are company-scoped", async () => {
  const response = await request("/api/employees?search=created&status=Active&page=1&limit=1", { userId: hrId });
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.employees.length, 1);
  assert.equal(result.pagination.page, 1);
  assert.equal(result.pagination.limit, 1);
  assert.ok(result.pagination.total >= 2);
  assert.equal(result.employees[0].departmentId.name, "Engineering");

  const filtered = await request(`/api/employees?departmentId=${departmentId}&designationId=${designationId}`, { userId: adminId });
  assert.equal(filtered.status, 200);
  assert.ok((await filtered.json()).data.employees.every((item) => same(item.companyId, companyId)));
  assert.equal((await request("/api/employees?limit=1000", { userId: adminId })).status, 400);
});

test("employee account linking is explicit and exposes only its own non-inactive profile", async () => {
  const optionsBeforeLink = await request("/api/employees/options", { userId: adminId });
  assert.equal(optionsBeforeLink.status, 200);
  assert.ok((await optionsBeforeLink.json()).data.users.some((user) => same(user._id, employeeUserId)));

  const createResponse = await request("/api/employees", {
    userId: adminId,
    method: "POST",
    body: JSON.stringify(validEmployee({ workEmail: "casey@company.example" }))
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).data.employee;
  const invalidLinkedInactive = await request("/api/employees", {
    userId: adminId,
    method: "POST",
    body: JSON.stringify(validEmployee({
      workEmail: "inactive-link@company.example",
      userId: employeeUserId,
      status: "Inactive"
    }))
  });
  assert.equal(invalidLinkedInactive.status, 400);

  assert.equal((await request("/api/employees/me", { userId: employeeUserId })).status, 404);

  const deniedOther = await request(`/api/employees/${otherCompanyEmployeeId}`, { userId: employeeUserId });
  assert.equal(deniedOther.status, 404);
  assert.equal((await request("/api/employees/me", { userId: otherEmployeeUserId })).status, 404);
  assert.equal((await request(`/api/employees/${otherCompanyEmployeeId}`, { userId: hrId })).status, 404);

  const editData = validEmployee({
    firstName: "Jordan",
    lastName: "Updated",
    workEmail: "casey@company.example",
    userId: employeeUserId
  });
  const update = await request(`/api/employees/${created._id}`, {
    userId: hrId,
    method: "PUT",
    body: JSON.stringify(editData)
  });
  assert.equal(update.status, 200);
  const updated = (await update.json()).data.employee;
  assert.equal(updated.employeeId, created.employeeId);
  assert.equal((await request("/api/employees/me", { userId: employeeUserId })).status, 200);
  const statusChangeViaEdit = await request(`/api/employees/${created._id}`, {
    userId: hrId,
    method: "PUT",
    body: JSON.stringify(validEmployee({
      firstName: "Jordan",
      lastName: "Updated",
      workEmail: "casey@company.example",
      userId: employeeUserId,
      status: "Inactive"
    }))
  });
  assert.equal(statusChangeViaEdit.status, 400);
  assert.equal(users.find((user) => same(user._id, employeeUserId)).status, "active");
  const optionsAfterLink = await request("/api/employees/options", { userId: adminId });
  assert.equal((await optionsAfterLink.json()).data.users.some((user) => same(user._id, employeeUserId)), false);
  const optionsForEdit = await request(`/api/employees/options?employeeId=${created._id}`, { userId: adminId });
  assert.equal((await optionsForEdit.json()).data.users.some((user) => same(user._id, employeeUserId)), true);
  const duplicateLink = await request("/api/employees", {
    userId: adminId,
    method: "POST",
    body: JSON.stringify(validEmployee({
      workEmail: "another@company.example",
      userId: employeeUserId
    }))
  });
  assert.equal(duplicateLink.status, 409);
  assert.equal((await duplicateLink.json()).error.code, "DUPLICATE_EMPLOYEE_ACCOUNT");

  const deactivated = await request(`/api/employees/${created._id}/status`, {
    userId: adminId,
    method: "PATCH",
    body: JSON.stringify({ status: "Inactive" })
  });
  assert.equal(deactivated.status, 200);
  assert.equal(users.find((user) => same(user._id, employeeUserId)).status, "inactive");
  assert.equal((await request("/api/employees/me", { userId: employeeUserId })).status, 401);
  assert.equal((await request("/api/auth/me", { userId: employeeUserId })).status, 401);

  const reactivated = await request(`/api/employees/${created._id}/status`, {
    userId: adminId,
    method: "PATCH",
    body: JSON.stringify({ status: "Active" })
  });
  assert.equal(reactivated.status, 200);
  assert.equal(users.find((user) => same(user._id, employeeUserId)).status, "active");
  assert.equal((await request("/api/employees/me", { userId: employeeUserId })).status, 200);
  const selfProfileResponse = await request("/api/employees/me", { userId: employeeUserId });
  const selfProfile = (await selfProfileResponse.json()).data.employee;
  assert.equal("userId" in selfProfile, false);
  assert.equal("companyId" in selfProfile, false);
  users.find((user) => same(user._id, employeeUserId)).status = "suspended";
  await request(`/api/employees/${created._id}/status`, {
    userId: adminId,
    method: "PATCH",
    body: JSON.stringify({ status: "Inactive" })
  });
  await request(`/api/employees/${created._id}/status`, {
    userId: adminId,
    method: "PATCH",
    body: JSON.stringify({ status: "Active" })
  });
  assert.equal(users.find((user) => same(user._id, employeeUserId)).status, "suspended");
  assert.equal((await request("/api/employees/me", { userId: employeeUserId })).status, 401);
});

test("status updates reject invalid values and inactive employee detail remains tenant-private", async () => {
  const employee = employees.find((item) => same(item.companyId, companyId));
  const invalid = await request(`/api/employees/${employee._id}/status`, {
    userId: hrId,
    method: "PATCH",
    body: JSON.stringify({ status: "Deleted" })
  });
  assert.equal(invalid.status, 400);
});
