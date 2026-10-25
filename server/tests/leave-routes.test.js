import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../app.js";
import LeaveRequest from "../models/LeaveRequest.js";
import { createAccessToken } from "../utils/jwt.js";

const secret = "leave-test-secret-with-enough-entropy";
const companyId = "64b000000000000000000101";
const otherCompanyId = "64b000000000000000000102";
const employeeUserId = "64b000000000000000000103";
const secondEmployeeUserId = "64b000000000000000000104";
const hrId = "64b000000000000000000105";
const adminId = "64b000000000000000000106";
const employeeId = "64b000000000000000000107";
const secondEmployeeId = "64b000000000000000000108";
const inactiveEmployeeId = "64b000000000000000000109";
const leaveTypeId = "64b000000000000000000110";
const inactiveLeaveTypeId = "64b000000000000000000111";
const departmentId = "64b000000000000000000112";
const otherRequestId = "64b000000000000000000113";
const users = [
  { _id: employeeUserId, name: "Ava Ng", email: "ava@example.test", role: "Employee", status: "active", companyId },
  { _id: secondEmployeeUserId, name: "Sam Lee", email: "sam@example.test", role: "Employee", status: "active", companyId },
  { _id: hrId, name: "HR Reviewer", email: "hr@example.test", role: "HR", status: "active", companyId },
  { _id: adminId, name: "Admin Reviewer", email: "admin@example.test", role: "Admin", status: "active", companyId },
  { _id: "64b000000000000000000114", name: "Other Employee", email: "other@example.test", role: "Employee", status: "active", companyId: otherCompanyId }
];
const employees = [
  { _id: employeeId, companyId, employeeId: "EMP-LEAVE-1", firstName: "Ava", lastName: "Ng", status: "Active", userId: employeeUserId, departmentId },
  { _id: secondEmployeeId, companyId, employeeId: "EMP-LEAVE-2", firstName: "Sam", lastName: "Lee", status: "Active", userId: secondEmployeeUserId, departmentId },
  { _id: inactiveEmployeeId, companyId, employeeId: "EMP-LEAVE-3", firstName: "Inactive", lastName: "Person", status: "Inactive", userId: "64b000000000000000000115", departmentId },
  { _id: "64b000000000000000000116", companyId: otherCompanyId, employeeId: "EMP-OTHER", firstName: "Other", lastName: "Company", status: "Active" }
];
const leaveTypes = [
  { _id: leaveTypeId, companyId, name: "Annual Leave", annualQuota: 20, paid: true, active: true },
  { _id: inactiveLeaveTypeId, companyId, name: "Old Leave", annualQuota: 5, paid: true, active: false }
];
const holidays = [
  { _id: "64b000000000000000000117", companyId, name: "Company Day", date: "2026-01-06", recurringAnnually: false, active: true }
];
const company = {
  _id: companyId,
  timeZone: "America/Los_Angeles",
  workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  openingTime: "09:00",
  closingTime: "17:00"
};
let leaveRequests;
let nextId;
let server;
let baseUrl;
let currentTime;

function same(left, right) {
  return String(left) === String(right);
}

function matches(record, filter) {
  if (!record) return false;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some((item) => matches(record, item));
    if (key === "$and") return expected.every((item) => matches(record, item));
    const actual = record[key];
    if (expected instanceof RegExp) return expected.test(String(actual ?? ""));
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("$in" in expected && !expected.$in.some((item) => same(actual, item))) return false;
      if ("$gte" in expected && !(actual >= expected.$gte)) return false;
      if ("$lte" in expected && !(actual <= expected.$lte)) return false;
      if ("$ne" in expected && same(actual, expected.$ne)) return false;
      return true;
    }
    return same(actual, expected);
  });
}

class Query {
  constructor(value, multiple = false) {
    this.value = value;
    this.multiple = multiple;
    this.sorting = null;
    this.offset = 0;
    this.maximum = Infinity;
    this.populates = [];
  }
  select() { return this; }
  sort(value) { this.sorting = value; return this; }
  skip(value) { this.offset = value; return this; }
  limit(value) { this.maximum = value; return this; }
  populate(path) { this.populates.push(typeof path === "string" ? path : path.path); return this; }
  lean() { return Promise.resolve(this.output()); }
  transform(record) {
    const result = { ...record };
    for (const path of this.populates) {
      if (path === "employeeId") {
        result.employeeId = employees.find((item) => same(item._id, record.employeeId)) ?? record.employeeId;
      } else if (path === "leaveTypeId") {
        result.leaveTypeId = leaveTypes.find((item) => same(item._id, record.leaveTypeId)) ?? record.leaveTypeId;
      } else if (path === "reviewedBy" && record.reviewedBy) {
        result.reviewedBy = users.find((item) => same(item._id, record.reviewedBy)) ?? record.reviewedBy;
      }
    }
    if (this.populates.includes("employeeId") && result.employeeId?.departmentId) {
      result.employeeId = {
        ...result.employeeId,
        departmentId: { _id: departmentId, name: "Engineering" }
      };
    }
    return result;
  }
  output() {
    if (!this.multiple) return this.value ? this.transform(this.value) : null;
    let values = [...this.value];
    if (this.sorting) {
      const [key, direction] = Object.entries(this.sorting)[0];
      values.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * direction);
    }
    return values.slice(this.offset, this.offset + this.maximum).map((item) => this.transform(item));
  }
  then(resolve, reject) { return Promise.resolve(this.output()).then(resolve, reject); }
}

const userModel = {
  findById(id) { return { select: async () => users.find((item) => same(item._id, id)) ?? null }; }
};
const companyModel = {
  async findById(id) { return same(id, companyId) ? company : null; }
};
const employeeModel = {
  findOne(filter) { return new Query(employees.find((item) => matches(item, filter)) ?? null); },
  find(filter) { return new Query(employees.filter((item) => matches(item, filter)), true); }
};
const leaveTypeModel = {
  findOne(filter) { return new Query(leaveTypes.find((item) => matches(item, filter)) ?? null); },
  find(filter) { return new Query(leaveTypes.filter((item) => matches(item, filter)), true); }
};
const holidayModel = {
  find(filter) { return new Query(holidays.filter((item) => matches(item, filter)), true); }
};
const leaveRequestModel = {
  async create(data) {
    const overlap = leaveRequests.some((request) =>
      same(request.companyId, data.companyId) &&
      same(request.employeeId, data.employeeId) &&
      request.activeDates.some((date) => data.activeDates.includes(date))
    );
    if (overlap) {
      const error = new Error("duplicate active leave date");
      error.code = 11000;
      throw error;
    }
    const request = {
      ...data,
      _id: `64b000000000000000000${String(nextId++).padStart(3, "0")}`,
      createdAt: new Date(currentTime),
      reviewedBy: null,
      reviewedAt: null
    };
    leaveRequests.push(request);
    return request;
  },
  findOne(filter) { return new Query(leaveRequests.find((item) => matches(item, filter)) ?? null); },
  find(filter) { return new Query(leaveRequests.filter((item) => matches(item, filter)), true); },
  async countDocuments(filter) { return leaveRequests.filter((item) => matches(item, filter)).length; },
  async findOneAndUpdate(filter, update) {
    const request = leaveRequests.find((item) => matches(item, filter));
    if (!request) return null;
    Object.assign(request, update.$set);
    return request;
  }
};

async function request(path, { userId, ...options } = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (userId) headers.Authorization = `Bearer ${createAccessToken({ _id: userId }, secret)}`;
  if (options.body) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

before(async () => {
  currentTime = new Date("2026-01-05T16:00:00.000Z");
  leaveRequests = [];
  nextId = 118;
  const app = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel,
    companyModel,
    organizationModels: {
      employees: employeeModel,
      "leave-types": leaveTypeModel,
      holidays: holidayModel
    },
    leaveModels: { requests: leaveRequestModel, now: () => new Date(currentTime) }
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("leave overlap index scopes active work dates by company and employee", () => {
  const index = LeaveRequest.schema.indexes().find(([keys]) =>
    keys.companyId === 1 && keys.employeeId === 1 && keys.activeDates === 1
  );
  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.ok(index[1].partialFilterExpression);
});

test("employees can submit self-scoped requests with server-calculated working days", async () => {
  const typeResponse = await request("/api/leaves/types", { userId: employeeUserId });
  assert.equal(typeResponse.status, 200);
  const availableTypes = (await typeResponse.json()).data.items;
  assert.equal(availableTypes.length, 1);
  assert.equal(availableTypes[0].name, "Annual Leave");
  assert.equal((await request("/api/leaves/types")).status, 401);

  const response = await request("/api/leaves/me/requests", {
    userId: employeeUserId,
    method: "POST",
    body: JSON.stringify({
      leaveTypeId,
      startDate: "2026-01-05",
      endDate: "2026-01-07",
      reason: "Personal travel"
    })
  });
  assert.equal(response.status, 201);
  const { request: created } = (await response.json()).data;
  assert.equal(created.requestedDays, 2);
  assert.equal(created.status, "Pending");
  assert.equal(String(created.employeeId), employeeId);
  assert.deepEqual(created.activeDates, ["2026-01-05", "2026-01-06", "2026-01-07"]);
});

test("invalid dates, empty working-day periods, inactive types, and inactive employees are rejected", async () => {
  const invalidDate = await request("/api/leaves/me/requests", {
    userId: employeeUserId, method: "POST",
    body: JSON.stringify({ leaveTypeId, startDate: "2026-02-30", endDate: "2026-03-01", reason: "Reason" })
  });
  assert.equal(invalidDate.status, 400);
  assert.equal((await invalidDate.json()).error.code, "INVALID_DATE_RANGE");

  const noWorkingDays = await request("/api/leaves/me/requests", {
    userId: employeeUserId, method: "POST",
    body: JSON.stringify({ leaveTypeId, startDate: "2026-01-10", endDate: "2026-01-11", reason: "Weekend" })
  });
  assert.equal((await noWorkingDays.json()).error.code, "NO_WORKING_DAYS");

  const inactiveType = await request("/api/leaves/me/requests", {
    userId: employeeUserId, method: "POST",
    body: JSON.stringify({ leaveTypeId: inactiveLeaveTypeId, startDate: "2026-01-12", endDate: "2026-01-12", reason: "Reason" })
  });
  assert.equal((await inactiveType.json()).error.code, "INVALID_LEAVE_TYPE");

  users.push({ _id: "64b000000000000000000115", name: "Inactive", role: "Employee", status: "active", companyId });
  const inactiveEmployee = await request("/api/leaves/me/requests", {
    userId: "64b000000000000000000115", method: "POST",
    body: JSON.stringify({ leaveTypeId, startDate: "2026-01-12", endDate: "2026-01-12", reason: "Reason" })
  });
  assert.equal((await inactiveEmployee.json()).error.code, "EMPLOYEE_LINK_REQUIRED");
});

test("overlapping requests conflict, cancellation releases dates, and employees see only their own requests", async () => {
  const overlap = await request("/api/leaves/me/requests", {
    userId: employeeUserId, method: "POST",
    body: JSON.stringify({ leaveTypeId, startDate: "2026-01-07", endDate: "2026-01-08", reason: "Another trip" })
  });
  assert.equal(overlap.status, 409);
  assert.equal((await overlap.json()).error.code, "OVERLAPPING_LEAVE_REQUEST");

  const ownRequests = await request("/api/leaves/me/requests", { userId: employeeUserId });
  const ownData = (await ownRequests.json()).data;
  assert.equal(ownData.pagination.total, 1);
  assert.ok(ownData.requests.every((item) => String(item.employeeId) === employeeId));
  const otherEmployeeRequests = await request("/api/leaves/me/requests", { userId: secondEmployeeUserId });
  assert.equal((await otherEmployeeRequests.json()).data.pagination.total, 0);
  assert.equal((await request("/api/leaves/requests", { userId: employeeUserId })).status, 403);
  assert.equal((await request("/api/leaves/me/requests")).status, 401);

  const concurrentRequests = await Promise.all([
    request("/api/leaves/me/requests", {
      userId: secondEmployeeUserId, method: "POST",
      body: JSON.stringify({ leaveTypeId, startDate: "2026-01-19", endDate: "2026-01-20", reason: "Concurrent request A" })
    }),
    request("/api/leaves/me/requests", {
      userId: secondEmployeeUserId, method: "POST",
      body: JSON.stringify({ leaveTypeId, startDate: "2026-01-20", endDate: "2026-01-21", reason: "Concurrent request B" })
    })
  ]);
  assert.deepEqual(concurrentRequests.map((response) => response.status).sort(), [201, 409]);

  const id = ownData.requests[0]._id;
  const cancelled = await request(`/api/leaves/me/requests/${id}/cancel`, {
    userId: employeeUserId, method: "PATCH", body: JSON.stringify({})
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).data.request.status, "Cancelled");
  const reapplication = await request("/api/leaves/me/requests", {
    userId: employeeUserId, method: "POST",
    body: JSON.stringify({ leaveTypeId, startDate: "2026-01-05", endDate: "2026-01-07", reason: "Updated plan" })
  });
  assert.equal(reapplication.status, 201);
});

test("HR can reject with a required comment and decisions are atomic and auditable", async () => {
  const own = await request("/api/leaves/me/requests", {
    userId: employeeUserId, method: "POST",
    body: JSON.stringify({ leaveTypeId, startDate: "2026-01-12", endDate: "2026-01-13", reason: "Family event" })
  });
  const ownId = (await own.json()).data.request._id;
  const missingComment = await request(`/api/leaves/requests/${ownId}/review`, {
    userId: hrId, method: "PATCH", body: JSON.stringify({ decision: "Rejected" })
  });
  assert.equal((await missingComment.json()).error.code, "REVIEW_COMMENT_REQUIRED");
  const employeeReview = await request(`/api/leaves/requests/${ownId}/review`, {
    userId: employeeUserId, method: "PATCH", body: JSON.stringify({ decision: "Approved" })
  });
  assert.equal(employeeReview.status, 403);

  const rejected = await request(`/api/leaves/requests/${ownId}/review`, {
    userId: hrId, method: "PATCH",
    body: JSON.stringify({ decision: "Rejected", comment: "Insufficient notice" })
  });
  assert.equal(rejected.status, 200);
  const rejectedRequest = (await rejected.json()).data.request;
  assert.equal(rejectedRequest.status, "Rejected");
  assert.equal(rejectedRequest.reviewComment, "Insufficient notice");
  assert.equal(String(rejectedRequest.reviewedBy), hrId);

  const duplicateDecision = await request(`/api/leaves/requests/${ownId}/review`, {
    userId: adminId, method: "PATCH",
    body: JSON.stringify({ decision: "Approved" })
  });
  assert.equal(duplicateDecision.status, 409);
  assert.equal((await duplicateDecision.json()).error.code, "REQUEST_ALREADY_REVIEWED");

  const hrEmployeeId = "64b000000000000000000119";
  employees.push({
    _id: hrEmployeeId, companyId, employeeId: "EMP-HR", firstName: "HR", lastName: "Reviewer",
    status: "Active", userId: hrId, departmentId
  });
  leaveRequests.push({
    _id: "64b000000000000000000130", companyId, employeeId: hrEmployeeId, leaveTypeId,
    startDate: "2026-05-04", endDate: "2026-05-04", requestedDays: 1, reason: "Personal",
    status: "Pending", activeDates: ["2026-05-04"], createdAt: new Date(currentTime)
  });
  const selfReview = await request("/api/leaves/requests/64b000000000000000000130/review", {
    userId: hrId, method: "PATCH", body: JSON.stringify({ decision: "Approved" })
  });
  assert.equal(selfReview.status, 403);
  assert.equal((await selfReview.json()).error.code, "SELF_REVIEW_FORBIDDEN");
});

test("Admin approval, balance calculation, and cross-company isolation are enforced", async () => {
  const submission = await request("/api/leaves/me/requests", {
    userId: secondEmployeeUserId, method: "POST",
    body: JSON.stringify({ leaveTypeId, startDate: "2026-01-05", endDate: "2026-01-07", reason: "Approved trip" })
  });
  const requestId = (await submission.json()).data.request._id;
  leaveRequests.push({
    _id: otherRequestId,
    companyId: otherCompanyId,
    employeeId: "64b000000000000000000116",
    leaveTypeId,
    startDate: "2026-01-05",
    endDate: "2026-01-07",
    requestedDays: 3,
    reason: "Other company",
    status: "Pending",
    activeDates: ["2026-01-05", "2026-01-06", "2026-01-07"],
    createdAt: new Date(currentTime)
  });
  const deniedCrossCompany = await request(`/api/leaves/requests/${otherRequestId}/review`, {
    userId: adminId, method: "PATCH", body: JSON.stringify({ decision: "Approved" })
  });
  assert.equal(deniedCrossCompany.status, 409);

  const approved = await request(`/api/leaves/requests/${requestId}/review`, {
    userId: adminId, method: "PATCH", body: JSON.stringify({ decision: "Approved" })
  });
  assert.equal(approved.status, 200);
  const balances = await request("/api/leaves/me/balances", { userId: secondEmployeeUserId });
  const annual = (await balances.json()).data.balances.find((item) => String(item.leaveType._id) === leaveTypeId);
  assert.equal(annual.used, 2);
  assert.equal(annual.remaining, 18);

  const concurrentSubmission = await request("/api/leaves/me/requests", {
    userId: employeeUserId, method: "POST",
    body: JSON.stringify({ leaveTypeId, startDate: "2026-01-26", endDate: "2026-01-26", reason: "Review race" })
  });
  const concurrentId = (await concurrentSubmission.json()).data.request._id;
  const decisions = await Promise.all([
    request(`/api/leaves/requests/${concurrentId}/review`, {
      userId: adminId, method: "PATCH", body: JSON.stringify({ decision: "Approved" })
    }),
    request(`/api/leaves/requests/${concurrentId}/review`, {
      userId: hrId, method: "PATCH", body: JSON.stringify({ decision: "Rejected", comment: "Concurrent reviewer" })
    })
  ]);
  assert.deepEqual(decisions.map((response) => response.status).sort(), [200, 409]);

  const inbox = await request("/api/leaves/requests?status=Pending", { userId: hrId });
  const inboxData = (await inbox.json()).data;
  assert.ok(inboxData.requests.every((item) => String(item.companyId) === companyId));
  assert.equal(inboxData.pagination.total, 3);
});
