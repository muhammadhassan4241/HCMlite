import mongoose from "mongoose";
import { Router } from "express";
import Attendance from "../models/Attendance.js";
import Company from "../models/Company.js";
import CompanyHoliday from "../models/CompanyHoliday.js";
import Department from "../models/Department.js";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { requireCompanyContext } from "../middleware/companyContext.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function localDateAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localTimeAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.hour}:${values.minute}`;
}

function localWeekday(dateString) {
  const day = new Date(`${dateString}T12:00:00.000Z`).getUTCDay();
  return weekdayNames[day];
}

export function zonedDateTimeToUtc(dateString, timeString, timeZone) {
  if (!validDate(dateString) || !timePattern.test(timeString)) {
    fail(400, "INVALID_LOCAL_TIME", "A valid company-local date and 24-hour time are required");
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let result = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observedDate = localDateAt(new Date(result), timeZone);
    const observedTime = localTimeAt(new Date(result), timeZone);
    const observed = new Date(`${observedDate}T${observedTime}:00.000Z`).getTime();
    const adjustment = target - observed;
    if (adjustment === 0) return new Date(result);
    result += adjustment;
  }
  const converted = new Date(result);
  if (localDateAt(converted, timeZone) !== dateString || localTimeAt(converted, timeZone) !== timeString) {
    fail(400, "INVALID_LOCAL_TIME", "The selected local time does not exist in the company time zone");
  }
  return converted;
}

function dateOffset(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function paginationValue(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= maximum ? number : null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameDayHolidayFilter(companyId, workDate) {
  const monthDay = workDate.slice(5);
  return {
    companyId,
    active: true,
    $or: [
      { date: workDate },
      { recurringAnnually: true, date: new RegExp(`-${monthDay}$`) }
    ]
  };
}

async function holidayForDate(holidayModel, companyId, workDate) {
  return holidayModel.findOne(sameDayHolidayFilter(companyId, workDate)).select("_id");
}

function isWorkingDay(company, workDate) {
  return Array.isArray(company.workingDays) && company.workingDays.includes(localWeekday(workDate));
}

function assertOfficeHours(company) {
  if (!timePattern.test(company.openingTime) || !timePattern.test(company.closingTime) ||
    company.closingTime <= company.openingTime) {
    fail(409, "UNSUPPORTED_OFFICE_HOURS", "Attendance requires valid same-day office hours; overnight shifts are not supported");
  }
}

async function requireEmployee(req, employeeModel) {
  const employee = await employeeModel.findOne({
    companyId: req.companyId,
    userId: req.user._id,
    status: "Active"
  }).select("_id employeeId firstName lastName departmentId");
  if (!employee) {
    fail(403, "EMPLOYEE_LINK_REQUIRED", "No active employee profile is linked to this account");
  }
  return employee;
}

function durationMinutes(checkInAt, checkOutAt) {
  return Math.max(0, Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60000));
}

function attendanceStatus(checkInAt, workDate, company) {
  const opening = zonedDateTimeToUtc(workDate, company.openingTime, company.timeZone);
  return checkInAt.getTime() > opening.getTime() ? "Late" : "Present";
}

function dateRange(query, timeZone, now) {
  const today = localDateAt(now, timeZone);
  const from = query.from ?? query.date ?? query.to ?? today;
  const to = query.to ?? query.date ?? query.from ?? today;
  if (!validDate(from) || !validDate(to) || from > to) {
    fail(400, "INVALID_DATE_RANGE", "Use valid from/to dates in YYYY-MM-DD format, with from no later than to");
  }
  if ((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000 > 365) {
    fail(400, "INVALID_DATE_RANGE", "Attendance date ranges cannot exceed 366 days");
  }
  return { from, to, today };
}

function historyDateRange(query, timeZone, now) {
  const today = localDateAt(now, timeZone);
  const from = query.from ?? query.date ?? "0001-01-01";
  const to = query.to ?? query.date ?? today;
  if (!validDate(from) || !validDate(to) || from > to) {
    fail(400, "INVALID_DATE_RANGE", "Use valid from/to dates in YYYY-MM-DD format, with from no later than to");
  }
  return { from, to };
}

async function activeHolidays(holidayModel, companyId, from, to) {
  return holidayModel.find({
    companyId,
    active: true,
    $or: [
      { date: { $gte: from, $lte: to } },
      { recurringAnnually: true }
    ]
  }).select("date recurringAnnually").lean();
}

function holidayDateSet(holidays) {
  const exact = new Set();
  const recurring = new Set();
  for (const holiday of holidays) {
    if (holiday.recurringAnnually) recurring.add(holiday.date.slice(5));
    else exact.add(holiday.date);
  }
  return (date) => exact.has(date) || recurring.has(date.slice(5));
}

export function createAttendanceRouter({
  jwtSecret,
  userModel = User,
  companyModel = Company,
  employeeModel = Employee,
  attendanceModel = Attendance,
  holidayModel = CompanyHoliday,
  departmentModel = Department,
  now = () => new Date()
}) {
  const router = Router();
  router.use(authenticateToken(jwtSecret, userModel));
  router.use(requireCompanyContext(companyModel));

  router.get("/me/today", authorizeRoles("Employee"), async (req, res, next) => {
    try {
      assertOfficeHours(req.company);
      const employee = await requireEmployee(req, employeeModel);
      const workDate = localDateAt(now(), req.company.timeZone);
      const [record, holiday] = await Promise.all([
        attendanceModel.findOne({ companyId: req.companyId, employeeId: employee._id, workDate }).lean(),
        holidayForDate(holidayModel, req.companyId, workDate)
      ]);
      return res.json({
        success: true,
        data: {
          workDate,
          workingDay: isWorkingDay(req.company, workDate),
          holiday: Boolean(holiday),
          officeStartTime: req.company.openingTime,
          officeEndTime: req.company.closingTime,
          timeZone: req.company.timeZone,
          attendance: record
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/me/check-in", authorizeRoles("Employee"), async (req, res, next) => {
    try {
      if (Object.keys(req.body ?? {}).length) {
        fail(400, "INVALID_INPUT", "Check-in does not accept client-supplied timestamps or employee identifiers");
      }
      assertOfficeHours(req.company);
      const employee = await requireEmployee(req, employeeModel);
      const checkedInAt = now();
      const workDate = localDateAt(checkedInAt, req.company.timeZone);
      if (!isWorkingDay(req.company, workDate)) {
        fail(409, "NON_WORKING_DAY", "Today is not a configured company working day");
      }
      if (await holidayForDate(holidayModel, req.companyId, workDate)) {
        fail(409, "COMPANY_HOLIDAY", "Attendance check-in is unavailable on a configured company holiday");
      }
      try {
        const record = await attendanceModel.create({
          companyId: req.companyId,
          employeeId: employee._id,
          workDate,
          checkInAt: checkedInAt,
          checkOutAt: null,
          status: "Incomplete",
          workingDurationMinutes: 0
        });
        return res.status(201).json({
          success: true,
          data: {
            attendance: record,
            message: `Checked in at ${localTimeAt(checkedInAt, req.company.timeZone)} (${req.company.timeZone})`
          }
        });
      } catch (error) {
        if (error.code === 11000) {
          return res.status(409).json({
            success: false,
            error: { code: "DUPLICATE_CHECK_IN", message: "A check-in already exists for this employee and workday" }
          });
        }
        throw error;
      }
    } catch (error) {
      return next(error);
    }
  });

  router.post("/me/check-out", authorizeRoles("Employee"), async (req, res, next) => {
    try {
      if (Object.keys(req.body ?? {}).length) {
        fail(400, "INVALID_INPUT", "Check-out does not accept client-supplied timestamps or employee identifiers");
      }
      assertOfficeHours(req.company);
      const employee = await requireEmployee(req, employeeModel);
      const checkedOutAt = now();
      const workDate = localDateAt(checkedOutAt, req.company.timeZone);
      const openRecord = await attendanceModel.findOne({
        companyId: req.companyId,
        employeeId: employee._id,
        workDate,
        checkOutAt: null
      }).lean();
      if (!openRecord) {
        fail(409, "OPEN_CHECK_IN_REQUIRED", "There is no open check-in for today");
      }
      const checkedInAt = new Date(openRecord.checkInAt);
      if (checkedOutAt.getTime() <= checkedInAt.getTime()) {
        fail(409, "INVALID_TIMESTAMP_SEQUENCE", "Check-out must be later than check-in");
      }
      const record = await attendanceModel.findOneAndUpdate(
        {
          _id: openRecord._id,
          companyId: req.companyId,
          employeeId: employee._id,
          checkOutAt: null
        },
        {
          $set: {
            checkOutAt: checkedOutAt,
            status: attendanceStatus(checkedInAt, workDate, req.company),
            workingDurationMinutes: durationMinutes(checkedInAt, checkedOutAt)
          }
        },
        { new: true, runValidators: true }
      );
      if (!record) {
        fail(409, "ALREADY_CHECKED_OUT", "This workday has already been checked out");
      }
      return res.json({
        success: true,
        data: {
          attendance: record,
          message: `Checked out at ${localTimeAt(checkedOutAt, req.company.timeZone)} (${req.company.timeZone})`
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me/history", authorizeRoles("Employee"), async (req, res, next) => {
    try {
      const employee = await requireEmployee(req, employeeModel);
      const page = paginationValue(req.query.page, 1, 100000);
      const limit = paginationValue(req.query.limit, 20, 100);
      if (!page || !limit) fail(400, "INVALID_PAGINATION", "Page must be positive and limit must be between 1 and 100");
      const { from, to } = historyDateRange(req.query, req.company.timeZone, now());
      const filter = {
        companyId: req.companyId,
        employeeId: employee._id,
        workDate: { $gte: from, $lte: to }
      };
      const [records, total] = await Promise.all([
        attendanceModel.find(filter).sort({ workDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        attendanceModel.countDocuments(filter)
      ]);
      return res.json({
        success: true,
        data: { records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/summary", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    try {
      const currentTime = now();
      const { from, to, today } = dateRange(req.query, req.company.timeZone, currentTime);
      const departmentId = req.query.departmentId;
      if (departmentId !== undefined) {
        if (!mongoose.isObjectIdOrHexString(departmentId)) {
          fail(400, "INVALID_FILTER", "Department filter must be a valid id");
        }
        const department = await departmentModel.findOne({
          _id: departmentId,
          companyId: req.companyId,
          active: true
        }).select("_id");
        if (!department) fail(400, "INVALID_FILTER", "Department must be active and belong to this company");
      }
      const employeeFilter = { companyId: req.companyId, status: "Active" };
      if (departmentId) employeeFilter.departmentId = departmentId;
      const [employees, records, holidays] = await Promise.all([
        employeeModel.find(employeeFilter).select("_id").lean(),
        attendanceModel.find({
          companyId: req.companyId,
          workDate: { $gte: from, $lte: to }
        }).lean(),
        activeHolidays(holidayModel, req.companyId, from, to)
      ]);
      const holidaysOn = holidayDateSet(holidays);
      const activeEmployeeIds = new Set(employees.map((employee) => String(employee._id)));
      const attendanceByDateEmployee = new Map();
      const daily = new Map();
      for (const record of records) {
        if (!activeEmployeeIds.has(String(record.employeeId))) continue;
        if (!attendanceByDateEmployee.has(record.workDate)) {
          attendanceByDateEmployee.set(record.workDate, new Set());
        }
        attendanceByDateEmployee.get(record.workDate).add(String(record.employeeId));
        if (!daily.has(record.workDate)) {
          daily.set(record.workDate, { Present: 0, Late: 0, Incomplete: 0, Absent: 0, workingDurationMinutes: 0 });
        }
        const totals = daily.get(record.workDate);
        if (Object.hasOwn(totals, record.status)) totals[record.status] += 1;
        totals.workingDurationMinutes += record.workingDurationMinutes || 0;
      }

      const companyDayEnd = (date) => zonedDateTimeToUtc(date, req.company.closingTime, req.company.timeZone);
      const dailySummary = [];
      for (let date = from; date <= to; date = dateOffset(date, 1)) {
        if (!isWorkingDay(req.company, date) || holidaysOn(date)) continue;
        if (!daily.has(date)) {
          daily.set(date, { Present: 0, Late: 0, Incomplete: 0, Absent: 0, workingDurationMinutes: 0 });
        }
        const totals = daily.get(date);
        const expectedDayEnded = currentTime.getTime() >= companyDayEnd(date).getTime();
        const attendedIds = attendanceByDateEmployee.get(date) || new Set();
        if (expectedDayEnded) {
          totals.Absent = Math.max(0, employees.length - attendedIds.size);
        }
        dailySummary.push({ date, ...totals, expectedEmployees: employees.length });
      }

      const summary = dailySummary.reduce((totals, item) => ({
        Present: totals.Present + item.Present,
        Late: totals.Late + item.Late,
        Incomplete: totals.Incomplete + item.Incomplete,
        Absent: totals.Absent + item.Absent,
        workingDurationMinutes: totals.workingDurationMinutes + item.workingDurationMinutes
      }), { Present: 0, Late: 0, Incomplete: 0, Absent: 0, workingDurationMinutes: 0 });
      return res.json({
        success: true,
        data: {
          from,
          to,
          today,
          timeZone: req.company.timeZone,
          summary,
          days: dailySummary
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/records", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    try {
      const page = paginationValue(req.query.page, 1, 100000);
      const limit = paginationValue(req.query.limit, 20, 100);
      if (!page || !limit) fail(400, "INVALID_PAGINATION", "Page must be positive and limit must be between 1 and 100");
      const { from, to } = dateRange(req.query, req.company.timeZone, now());
      const employeeFilter = { companyId: req.companyId };
      if (req.query.departmentId !== undefined) {
        if (!mongoose.isObjectIdOrHexString(req.query.departmentId)) {
          fail(400, "INVALID_FILTER", "Department filter must be a valid id");
        }
        employeeFilter.departmentId = req.query.departmentId;
      }
      if (typeof req.query.search === "string" && req.query.search.trim()) {
        const tokens = req.query.search.trim().slice(0, 100).split(/\s+/).filter(Boolean);
        employeeFilter.$and = tokens.map((token) => {
          const expression = new RegExp(escapeRegex(token), "i");
          return { $or: [
            { firstName: expression },
            { lastName: expression },
            { employeeId: expression }
          ] };
        });
      }
      const matchingEmployees = await employeeModel.find(employeeFilter).select("_id").lean();
      const employeeIds = matchingEmployees.map((employee) => employee._id);
      const attendanceFilter = {
        companyId: req.companyId,
        employeeId: { $in: employeeIds },
        workDate: { $gte: from, $lte: to }
      };
      if (req.query.status !== undefined) {
        if (!["Present", "Late", "Incomplete"].includes(req.query.status)) {
          fail(400, "INVALID_FILTER", "Attendance status filter is invalid");
        }
        attendanceFilter.status = req.query.status;
      }
      const [records, total] = await Promise.all([
        attendanceModel.find(attendanceFilter)
          .populate({ path: "employeeId", select: "employeeId firstName lastName departmentId", populate: { path: "departmentId", select: "name" } })
          .populate({ path: "correctionHistory.correctedBy", select: "name email" })
          .sort({ workDate: -1, checkInAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        attendanceModel.countDocuments(attendanceFilter)
      ]);
      return res.json({
        success: true,
        data: { records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/records/:id", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_ID", message: "A valid attendance record id is required" }
      });
    }
    try {
      if (!req.body || Object.keys(req.body).some((key) =>
        !["checkInAt", "checkOutAt", "reason"].includes(key)
      )) {
        fail(400, "INVALID_INPUT", "Only check-in, check-out, and correction reason can be provided");
      }
      if (typeof req.body.reason !== "string" || !req.body.reason.trim() || req.body.reason.trim().length > 500) {
        fail(400, "CORRECTION_REASON_REQUIRED", "A correction reason of at most 500 characters is required");
      }
      if (!Object.hasOwn(req.body, "checkInAt") || !Object.hasOwn(req.body, "checkOutAt")) {
        fail(400, "INVALID_INPUT", "Both check-in and check-out timestamps must be provided; check-out may be null");
      }
      if (typeof req.body.checkInAt !== "string" || !isoTimestampPattern.test(req.body.checkInAt) ||
        !Number.isFinite(Date.parse(req.body.checkInAt))) {
        fail(400, "INVALID_INPUT", "Check-in correction must be an ISO 8601 timestamp with timezone");
      }
      const checkInAt = new Date(req.body.checkInAt);
      let checkOutAt = null;
      if (req.body.checkOutAt !== null) {
        if (typeof req.body.checkOutAt !== "string" || !isoTimestampPattern.test(req.body.checkOutAt) ||
          !Number.isFinite(Date.parse(req.body.checkOutAt))) {
          fail(400, "INVALID_INPUT", "Check-out correction must be null or an ISO 8601 timestamp with timezone");
        }
        checkOutAt = new Date(req.body.checkOutAt);
        if (checkOutAt.getTime() <= checkInAt.getTime()) {
          fail(400, "INVALID_TIMESTAMP_SEQUENCE", "Check-out must be later than check-in");
        }
      }
      const record = await attendanceModel.findOne({
        _id: req.params.id,
        companyId: req.companyId
      }).select("+correctionHistory");
      if (!record) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "The attendance record was not found" }
        });
      }
      if (localDateAt(checkInAt, req.company.timeZone) !== record.workDate ||
        (checkOutAt && localDateAt(checkOutAt, req.company.timeZone) !== record.workDate)) {
        fail(400, "INVALID_WORK_DATE", "Corrected timestamps must remain within the recorded company-local work date");
      }
      const status = checkOutAt
        ? attendanceStatus(checkInAt, record.workDate, req.company)
        : "Incomplete";
      const nextSnapshot = {
        checkInAt,
        checkOutAt,
        status,
        workingDurationMinutes: checkOutAt ? durationMinutes(checkInAt, checkOutAt) : 0
      };
      const previousSnapshot = {
        checkInAt: record.checkInAt,
        checkOutAt: record.checkOutAt,
        status: record.status,
        workingDurationMinutes: record.workingDurationMinutes
      };
      record.correctionHistory.push({
        correctedAt: now(),
        correctedBy: req.user._id,
        reason: req.body.reason.trim(),
        before: previousSnapshot,
        after: nextSnapshot
      });
      Object.assign(record, nextSnapshot);
      await record.save();
      return res.json({ success: true, data: { attendance: record } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export { validDate, attendanceStatus, durationMinutes };
