import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../app.js";
import Attendance from "../models/Attendance.js";
import { attendanceStatus, durationMinutes, localDateAt, zonedDateTimeToUtc } from "../routes/attendance.js";
import { createAccessToken } from "../utils/jwt.js";

const secret = "attendance-test-secret-with-enough-entropy";
const companyId = "64b000000000000000000081";
const otherCompanyId = "64b000000000000000000082";
const adminId = "64b000000000000000000083";
const hrId = "64b000000000000000000084";
const employeeUserId = "64b000000000000000000085";
const unlinkedUserId = "64b000000000000000000086";
const employeeId = "64b000000000000000000087";
const otherEmployeeId = "64b000000000000000000088";
const departmentId = "64b000000000000000000089";
const otherAttendanceId = "64b000000000000000000090";
const users = [
  { _id: adminId, name: "Admin", email: "admin@example.test", role: "Admin", status: "active", companyId },
  { _id: hrId, name: "HR", email: "hr@example.test", role: "HR", status: "active", companyId },
  { _id: employeeUserId, name: "Employee", email: "employee@example.test", role: "Employee", status: "active", companyId },
  { _id: unlinkedUserId, name: "Unlinked", email: "unlinked@example.test", role: "Employee", status: "active", companyId },
  { _id: "64b000000000000000000091", name: "Other Tenant", email: "other@example.test", role: "Employee", status: "active", companyId: otherCompanyId }
];
const employees = [
  { _id: employeeId, companyId, employeeId: "EMP-ATTEND-1", firstName: "Ava", lastName: "Ng", status: "Active", userId: employeeUserId, departmentId },
  { _id: unlinkedUserId, companyId, employeeId: "EMP-ATTEND-2", firstName: "No", lastName: "Link", status: "Active", departmentId },
  { _id: otherEmployeeId, companyId: otherCompanyId, employeeId: "EMP-OTHER", firstName: "Other", lastName: "Tenant", status: "Active" }
];
const departments = [{ _id: departmentId, companyId, name: "Engineering", active: true }];
let attendanceRecords;
let holidayRecords;
let currentTime;
let nextRecordId;
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
      if ("$ne" in expected && same(actual, expected.$ne)) return false;
      if ("$in" in expected && !expected.$in.some((item) => same(actual, item))) return false;
      if ("$gte" in expected && !(actual >= expected.$gte)) return false;
      if ("$lte" in expected && !(actual <= expected.$lte)) return false;
      return true;
    }
    return same(actual, expected);
  });
}

class Query {
  constructor(result, multiple = false) {
    this.value = result;
    this.multiple = multiple;
    this.offset = 0;
    this.maximum = Infinity;
    this.sorting = null;
    this.populateEmployee = false;
  }
  select() { return this; }
  populate() { this.populateEmployee = true; return this; }
  sort(value) { this.sorting = value; return this; }
  skip(value) { this.offset = value; return this; }
  limit(value) { this.maximum = value; return this; }
  lean() { return Promise.resolve(this.output()); }
  output() {
    let values = this.multiple ? [...this.value] : this.value;
    if (!this.multiple) return values ? this.transform(values) : null;
    if (this.sorting) {
      values.sort((left, right) => {
        for (const [key, direction] of Object.entries(this.sorting)) {
          const leftValue = left[key] instanceof Date ? left[key].toISOString() : String(left[key] ?? "");
          const rightValue = right[key] instanceof Date ? right[key].toISOString() : String(right[key] ?? "");
          const comparison = leftValue.localeCompare(rightValue);
          if (comparison) return comparison * direction;
        }
        return 0;
      });
    }
    return values.slice(this.offset, this.offset + this.maximum).map((item) => this.transform(item));
  }
  transform(record) {
    if (!this.populateEmployee || !record.employeeId) return record;
    const output = { ...record };
    output.employeeId = employees.find((employee) => same(employee._id, record.employeeId)) ?? record.employeeId;
    if (output.employeeId.departmentId) {
      output.employeeId = {
        ...output.employeeId,
        departmentId: departments.find((department) =>
          same(department._id, output.employeeId.departmentId)
        ) ?? output.employeeId.departmentId
      };
    }
    return output;
  }
  then(resolve, reject) { return Promise.resolve(this.output()).then(resolve, reject); }
}

const userModel = {
  findById(id) {
    return { select: async () => users.find((user) => same(user._id, id)) ?? null };
  },
  findOne(filter) {
    return { select: async () => users.find((user) => matches(user, filter)) ?? null };
  },
  async updateOne(filter, update) {
    const user = users.find((item) => matches(item, filter));
    if (!user) return { matchedCount: 0 };
    Object.assign(user, update.$set);
    return { matchedCount: 1 };
  }
};

const company = {
  _id: companyId,
  timeZone: "America/Los_Angeles",
  workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  openingTime: "09:00",
  closingTime: "17:00"
};
const companyModel = {
  async findById(id) { return same(id, companyId) ? company : null; }
};
const employeeModel = {
  findOne(filter) { return new Query(employees.find((item) => matches(item, filter)) ?? null); },
  find(filter) { return new Query(employees.filter((item) => matches(item, filter)), true); }
};
const departmentModel = {
  findOne(filter) { return new Query(departments.find((item) => matches(item, filter)) ?? null); }
};
const holidayModel = {
  findOne(filter) { return new Query(holidayRecords.find((item) => matches(item, filter)) ?? null); },
  find(filter) { return new Query(holidayRecords.filter((item) => matches(item, filter)), true); }
};
const attendanceModel = {
  async create(record) {
    if (attendanceRecords.some((item) =>
      same(item.companyId, record.companyId) &&
      same(item.employeeId, record.employeeId) &&
      item.workDate === record.workDate
    )) {
      const error = new Error("duplicate attendance");
      error.code = 11000;
      throw error;
    }
    const stored = {
      ...record,
      _id: `64b0000000000000000000${nextRecordId++}`,
      correctionHistory: [],
      async save() { return this; }
    };
    attendanceRecords.push(stored);
    return stored;
  },
  findOne(filter) { return new Query(attendanceRecords.find((item) => matches(item, filter)) ?? null); },
  find(filter) { return new Query(attendanceRecords.filter((item) => matches(item, filter)), true); },
  async findOneAndUpdate(filter, update) {
    const record = attendanceRecords.find((item) => matches(item, filter));
    if (!record) return null;
    Object.assign(record, update.$set);
    return record;
  },
  async countDocuments(filter) {
    return attendanceRecords.filter((item) => matches(item, filter)).length;
  }
};

async function request(path, { userId, ...options } = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (userId) headers.Authorization = `Bearer ${createAccessToken({ _id: userId }, secret)}`;
  if (options.body) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

function recordForDay(day, employee = employeeId, overrides = {}) {
  return {
    _id: `64b0000000000000000000${nextRecordId++}`,
    companyId,
    employeeId: employee,
    workDate: day,
    checkInAt: new Date(`${day}T17:00:00.000Z`),
    checkOutAt: new Date(`${day}T22:00:00.000Z`),
    status: "Present",
    workingDurationMinutes: 300,
    correctionHistory: [],
    async save() { return this; },
    ...overrides
  };
}

before(async () => {
  currentTime = new Date("2025-01-07T16:59:00.000Z");
  attendanceRecords = [recordForDay("2025-01-06", otherEmployeeId)];
  holidayRecords = [];
  nextRecordId = 92;
  const app = createApp({
    frontendUrl: "http://localhost:5173",
    jwtSecret: secret,
    userModel,
    companyModel,
    organizationModels: { employees: employeeModel, departments: departmentModel },
    attendanceModels: {
      attendance: attendanceModel,
      holidays: holidayModel,
      now: () => new Date(currentTime)
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

test("attendance indexes enforce one company employee record per local work date", () => {
  const indexes = Attendance.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    keys.companyId === 1 && keys.employeeId === 1 && keys.workDate === 1 && options.unique
  ));
});

test("company timezone date conversion and office lateness are deterministic", () => {
  assert.equal(localDateAt(new Date("2025-01-07T07:30:00.000Z"), "America/Los_Angeles"), "2025-01-06");
  assert.equal(localDateAt(new Date("2025-01-07T08:30:00.000Z"), "America/Los_Angeles"), "2025-01-07");
  const onTime = zonedDateTimeToUtc("2025-01-07", "09:00", "America/Los_Angeles");
  const earlyCheckIn = new Date("2025-01-07T16:59:00.000Z");
  const lateCheckIn = new Date("2025-01-07T17:01:00.000Z");
  assert.equal(attendanceStatus(earlyCheckIn, "2025-01-07", company), "Present");
  assert.equal(attendanceStatus(lateCheckIn, "2025-01-07", company), "Late");
  assert.equal(onTime.toISOString(), "2025-01-07T17:00:00.000Z");
  assert.equal(durationMinutes(new Date("2025-01-07T17:00:00.000Z"), new Date("2025-01-07T21:31:00.000Z")), 271);
});

test("employee check-in uses server time and local date, and duplicate/concurrent requests create one record", async () => {
  currentTime = new Date("2025-01-07T16:59:00.000Z");
  const payload = { checkInAt: "2000-01-01T00:00:00.000Z", employeeId: otherEmployeeId };
  const invalidPayload = await request("/api/attendance/me/check-in", {
    userId: employeeUserId,
    method: "POST",
    body: JSON.stringify(payload)
  });
  assert.equal(invalidPayload.status, 400);
  const requests = await Promise.all([
    request("/api/attendance/me/check-in", { userId: employeeUserId, method: "POST", body: JSON.stringify({}) }),
    request("/api/attendance/me/check-in", { userId: employeeUserId, method: "POST", body: JSON.stringify({}) })
  ]);
  assert.deepEqual(requests.map((response) => response.status).sort(), [201, 409]);
  const record = attendanceRecords.find((item) => item.workDate === "2025-01-07" && same(item.employeeId, employeeId));
  assert.equal(record.checkInAt.toISOString(), "2025-01-07T16:59:00.000Z");
  assert.equal(record.status, "Incomplete");
  assert.equal(record.workDate, "2025-01-07");
  assert.equal((await request("/api/attendance/me/today", { userId: employeeUserId })).status, 200);
});

test("check-out is atomic, calculates duration, and classifies late arrival from company office time", async () => {
  currentTime = new Date("2025-01-08T17:30:00.000Z");
  const create = await request("/api/attendance/me/check-in", {
    userId: employeeUserId,
    method: "POST",
    body: JSON.stringify({})
  });
  assert.equal(create.status, 201);
  currentTime = new Date("2025-01-08T18:01:00.000Z");
  const [first, second] = await Promise.all([
    request("/api/attendance/me/check-out", { userId: employeeUserId, method: "POST", body: JSON.stringify({}) }),
    request("/api/attendance/me/check-out", { userId: employeeUserId, method: "POST", body: JSON.stringify({}) })
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const record = attendanceRecords.find((item) => item.workDate === "2025-01-08" && same(item.employeeId, employeeId));
  assert.equal(record.status, "Late");
  assert.equal(record.workingDurationMinutes, 31);
  assert.equal((await request("/api/attendance/me/check-out", {
    userId: employeeUserId,
    method: "POST",
    body: JSON.stringify({})
  })).status, 409);
});

test("check-out without an open check-in and employees without linked records are rejected", async () => {
  currentTime = new Date("2025-01-09T16:00:00.000Z");
  const noCheckIn = await request("/api/attendance/me/check-out", {
    userId: employeeUserId, method: "POST", body: JSON.stringify({})
  });
  assert.equal(noCheckIn.status, 409);
  assert.equal((await noCheckIn.json()).error.code, "OPEN_CHECK_IN_REQUIRED");
  const noLink = await request("/api/attendance/me/today", { userId: unlinkedUserId });
  assert.equal(noLink.status, 403);
  assert.equal((await noLink.json()).error.code, "EMPLOYEE_LINK_REQUIRED");
});

test("non-working days and recurring company holidays block check-in", async () => {
  currentTime = new Date("2025-01-11T18:00:00.000Z");
  const weekend = await request("/api/attendance/me/check-in", {
    userId: employeeUserId, method: "POST", body: JSON.stringify({})
  });
  assert.equal(weekend.status, 409);
  assert.equal((await weekend.json()).error.code, "NON_WORKING_DAY");
  assert.equal(weekend.status, 409);

  holidayRecords.push({ companyId, date: "2024-01-13", recurringAnnually: true, active: true });
  currentTime = new Date("2025-01-13T18:00:00.000Z");
  const holiday = await request("/api/attendance/me/check-in", {
    userId: employeeUserId, method: "POST", body: JSON.stringify({})
  });
  assert.equal(holiday.status, 409);
  assert.equal(holiday.status, 409);
  assert.equal((await holiday.json()).error.code, "COMPANY_HOLIDAY");
  holidayRecords = [];
});

test("attendance rejects unsupported overnight office hours", async () => {
  company.openingTime = "22:00";
  company.closingTime = "06:00";
  const response = await request("/api/attendance/me/today", { userId: employeeUserId });
  company.openingTime = "09:00";
  company.closingTime = "17:00";
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "UNSUPPORTED_OFFICE_HOURS");
});

test("employee history is self-only and attendance reports require Admin or HR", async () => {
  currentTime = new Date("2025-01-07T20:00:00.000Z");
  attendanceRecords.push(recordForDay("2025-01-06", employeeId));
  const unauthorized = await request("/api/attendance/records", { userId: employeeUserId });
  assert.equal(unauthorized.status, 403);
  const employeeHistory = await request("/api/attendance/me/history", { userId: employeeUserId });
  assert.equal(employeeHistory.status, 200);
  const history = (await employeeHistory.json()).data.records;
  assert.ok(history.every((record) => same(record.employeeId, employeeId)));
  assert.ok(history.some((record) => record.workDate === "2025-01-06"));
  assert.equal((await request("/api/attendance/me/history")).status, 401);
  const records = await request("/api/attendance/records?from=2025-01-01&to=2025-01-31", { userId: hrId });
  assert.equal(records.status, 200);
  assert.ok((await records.json()).data.records.every((record) => same(record.companyId, companyId)));
});

test("reports do not mark absences before closing or on holidays/non-working days", async () => {
  currentTime = new Date("2025-01-07T18:00:00.000Z");
  const early = await request("/api/attendance/summary?date=2025-01-07", { userId: adminId });
  assert.equal(early.status, 200);
  assert.equal((await early.json()).data.summary.Absent, 0);

  currentTime = new Date("2025-01-08T01:00:00.000Z");
  const response = await request("/api/attendance/summary?from=2025-01-06&to=2025-01-11", { userId: adminId });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.deepEqual(data.days.map((day) => day.date), ["2025-01-06", "2025-01-07", "2025-01-08", "2025-01-09", "2025-01-10"]);
  assert.equal(data.days.find((day) => day.date === "2025-01-07").Absent, 1);
  assert.equal(data.days.find((day) => day.date === "2025-01-06").Absent, 1);
  assert.ok(data.days.filter((day) => day.date > "2025-01-07").every((day) => day.Absent === 0));
  assert.equal((await request("/api/attendance/summary?departmentId=64b000000000000000000099", { userId: hrId })).status, 400);
  assert.equal((await request("/api/attendance/summary?from=invalid", { userId: adminId })).status, 400);
});

test("Admin and HR corrections require a reason, recalculate status, and keep before/after audit snapshots", async () => {
  const record = recordForDay("2025-01-06", employeeId, {
    checkInAt: new Date("2025-01-06T17:30:00.000Z"),
    checkOutAt: new Date("2025-01-06T22:00:00.000Z"),
    status: "Late",
    workingDurationMinutes: 270
  });
  attendanceRecords.push(record);
  const noReason = await request(`/api/attendance/records/${record._id}`, {
    userId: hrId,
    method: "PATCH",
    body: JSON.stringify({
      checkInAt: "2025-01-06T17:00:00.000Z",
      checkOutAt: "2025-01-06T22:00:00.000Z"
    })
  });
  assert.equal(noReason.status, 400);

  const corrected = await request(`/api/attendance/records/${record._id}`, {
    userId: hrId,
    method: "PATCH",
    body: JSON.stringify({
      checkInAt: "2025-01-06T17:00:00Z",
      checkOutAt: "2025-01-06T22:00:00Z",
      reason: "Verified corrected punch times"
    })
  });
  assert.equal(corrected.status, 200);
  const updated = (await corrected.json()).data.attendance;
  assert.equal(updated.status, "Present");
  assert.equal(updated.workingDurationMinutes, 300);
  assert.equal(updated.correctionHistory.length, 1);
  assert.equal(updated.correctionHistory[0].reason, "Verified corrected punch times");
  assert.equal(String(updated.correctionHistory[0].correctedBy), hrId);
  assert.equal(updated.correctionHistory[0].before.workingDurationMinutes, 270);

  const employeeCorrection = await request(`/api/attendance/records/${record._id}`, {
    userId: employeeUserId,
    method: "PATCH",
    body: JSON.stringify({
      checkInAt: "2025-01-06T17:00:00Z",
      checkOutAt: "2025-01-06T22:00:00Z",
      reason: "No"
    })
  });
  assert.equal(employeeCorrection.status, 403);

  attendanceRecords.push(recordForDay("2025-01-06", otherEmployeeId, {
    _id: otherAttendanceId,
    companyId: otherCompanyId
  }));
  const crossTenant = await request(`/api/attendance/records/${otherAttendanceId}`, {
    userId: adminId,
    method: "PATCH",
    body: JSON.stringify({
      checkInAt: "2025-01-06T17:00:00Z",
      checkOutAt: "2025-01-06T22:00:00Z",
      reason: "Must not cross company"
    })
  });
  assert.equal(crossTenant.status, 404);
});
