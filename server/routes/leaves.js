import mongoose from "mongoose";
import { Router } from "express";
import Company from "../models/Company.js";
import CompanyHoliday from "../models/CompanyHoliday.js";
import Employee from "../models/Employee.js";
import LeaveRequest from "../models/LeaveRequest.js";
import LeaveType from "../models/LeaveType.js";
import User from "../models/User.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { requireCompanyContext } from "../middleware/companyContext.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
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

function offsetDate(value, amount) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function calendarDates(startDate, endDate) {
  const dates = [];
  for (let date = startDate; date <= endDate; date = offsetDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function validObjectId(value) {
  return typeof value === "string" && mongoose.isObjectIdOrHexString(value);
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

function isHoliday(date, holidays) {
  return holidays.some((holiday) =>
    holiday.active !== false &&
    (holiday.date === date ||
      (holiday.recurringAnnually && holiday.date.slice(5) === date.slice(5)))
  );
}

function calculateWorkingDates(startDate, endDate, company, holidays) {
  return calendarDates(startDate, endDate).filter((date) => {
    const weekday = weekdayNames[new Date(`${date}T12:00:00.000Z`).getUTCDay()];
    return company.workingDays.includes(weekday) && !isHoliday(date, holidays);
  });
}

function currentCompanyDate(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function linkedEmployee(req, employeeModel) {
  const employee = await employeeModel.findOne({
    companyId: req.companyId,
    userId: req.user._id,
    status: "Active"
  }).select("_id employeeId firstName lastName departmentId");
  if (!employee) fail(403, "EMPLOYEE_LINK_REQUIRED", "No active employee profile is linked to this account");
  return employee;
}

async function holidaysInRange(holidayModel, companyId, startDate, endDate) {
  return holidayModel.find({
    companyId,
    active: true,
    $or: [
      { date: { $gte: startDate, $lte: endDate } },
      { recurringAnnually: true }
    ]
  }).select("date recurringAnnually active").lean();
}

export function createLeaveRouter({
  jwtSecret,
  userModel = User,
  companyModel = Company,
  employeeModel = Employee,
  leaveTypeModel = LeaveType,
  leaveRequestModel = LeaveRequest,
  holidayModel = CompanyHoliday,
  now = () => new Date()
}) {
  const router = Router();
  router.use(authenticateToken(jwtSecret, userModel));
  router.use(requireCompanyContext(companyModel));

  router.get("/types", authorizeRoles("Admin", "HR", "Employee"), async (req, res, next) => {
    try {
      const items = await leaveTypeModel.find({
        companyId: req.companyId,
        active: true
      }).sort({ name: 1 }).lean();
      return res.json({ success: true, data: { items } });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me/balances", authorizeRoles("Employee"), async (req, res, next) => {
    try {
      const employee = await linkedEmployee(req, employeeModel);
      const year = currentCompanyDate(now(), req.company.timeZone).slice(0, 4);
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const [types, approvedRequests, holidays] = await Promise.all([
        leaveTypeModel.find({ companyId: req.companyId, active: true }).sort({ name: 1 }).lean(),
        leaveRequestModel.find({
          companyId: req.companyId,
          employeeId: employee._id,
          status: "Approved",
          startDate: { $lte: yearEnd },
          endDate: { $gte: yearStart }
        }).lean(),
        holidaysInRange(holidayModel, req.companyId, yearStart, yearEnd)
      ]);
      const balances = types.map((type) => {
        const used = approvedRequests
          .filter((request) => String(request.leaveTypeId) === String(type._id))
          .reduce((total, request) => {
            const startDate = request.startDate < yearStart ? yearStart : request.startDate;
            const endDate = request.endDate > yearEnd ? yearEnd : request.endDate;
            return total + calculateWorkingDates(startDate, endDate, req.company, holidays).length;
          }, 0);
        return {
          leaveType: type,
          annualQuota: type.annualQuota,
          used,
          remaining: Math.max(0, type.annualQuota - used)
        };
      });
      return res.json({ success: true, data: { year: Number(year), balances } });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me/requests", authorizeRoles("Employee"), async (req, res, next) => {
    try {
      const employee = await linkedEmployee(req, employeeModel);
      const page = paginationValue(req.query.page, 1, 100000);
      const limit = paginationValue(req.query.limit, 20, 100);
      if (!page || !limit) fail(400, "INVALID_PAGINATION", "Page must be positive and limit must be between 1 and 100");
      const filter = { companyId: req.companyId, employeeId: employee._id };
      const [requests, total] = await Promise.all([
        leaveRequestModel.find(filter)
          .populate("leaveTypeId", "name paid")
          .populate("reviewedBy", "name email")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        leaveRequestModel.countDocuments(filter)
      ]);
      return res.json({
        success: true,
        data: { requests, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/me/requests", authorizeRoles("Employee"), async (req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["leaveTypeId", "startDate", "endDate", "reason"].includes(key))) {
        fail(400, "INVALID_INPUT", "Provide a leave type, start date, end date, and reason");
      }
      if (!validObjectId(body.leaveTypeId)) fail(400, "INVALID_LEAVE_TYPE", "Select a valid leave type");
      if (!validDate(body.startDate) || !validDate(body.endDate) || body.endDate < body.startDate) {
        fail(400, "INVALID_DATE_RANGE", "Use valid dates in YYYY-MM-DD format and ensure the end date is not before the start date");
      }
      const dates = calendarDates(body.startDate, body.endDate);
      if (dates.length > 366) fail(400, "DATE_RANGE_TOO_LONG", "A leave request cannot exceed 366 calendar days");
      if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 1000) {
        fail(400, "REASON_REQUIRED", "A reason of at most 1000 characters is required");
      }
      const employee = await linkedEmployee(req, employeeModel);
      const [leaveType, holidays] = await Promise.all([
        leaveTypeModel.findOne({
          _id: body.leaveTypeId,
          companyId: req.companyId,
          active: true
        }).select("_id name annualQuota paid"),
        holidaysInRange(holidayModel, req.companyId, body.startDate, body.endDate)
      ]);
      if (!leaveType) fail(400, "INVALID_LEAVE_TYPE", "The selected leave type is inactive or unavailable");
      const requestedDates = calculateWorkingDates(body.startDate, body.endDate, req.company, holidays);
      if (!requestedDates.length) fail(400, "NO_WORKING_DAYS", "The requested period contains no company working days");
      const request = await leaveRequestModel.create({
        companyId: req.companyId,
        employeeId: employee._id,
        leaveTypeId: leaveType._id,
        startDate: body.startDate,
        endDate: body.endDate,
        requestedDays: requestedDates.length,
        reason: body.reason.trim(),
        status: "Pending",
        activeDates: dates
      });
      return res.status(201).json({ success: true, data: { request } });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          error: { code: "OVERLAPPING_LEAVE_REQUEST", message: "This request overlaps a pending or approved leave request" }
        });
      }
      return next(error);
    }
  });

  router.patch("/me/requests/:id/cancel", authorizeRoles("Employee"), async (req, res, next) => {
    try {
      if (!validObjectId(req.params.id)) fail(400, "INVALID_ID", "A valid leave request id is required");
      if (Object.keys(req.body ?? {}).length) fail(400, "INVALID_INPUT", "Cancellation does not accept request fields");
      const employee = await linkedEmployee(req, employeeModel);
      const request = await leaveRequestModel.findOneAndUpdate(
        {
          _id: req.params.id,
          companyId: req.companyId,
          employeeId: employee._id,
          status: "Pending"
        },
        {
          $set: { status: "Cancelled", cancelledAt: now(), activeDates: [] }
        },
        { new: true, runValidators: true }
      );
      if (!request) fail(409, "REQUEST_NOT_CANCELLABLE", "Only your pending leave requests can be cancelled");
      return res.json({ success: true, data: { request } });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/requests", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    try {
      const page = paginationValue(req.query.page, 1, 100000);
      const limit = paginationValue(req.query.limit, 20, 100);
      if (!page || !limit) fail(400, "INVALID_PAGINATION", "Page must be positive and limit must be between 1 and 100");
      const filter = { companyId: req.companyId };
      if (req.query.status !== undefined) {
        if (!["Pending", "Approved", "Rejected", "Cancelled"].includes(req.query.status)) {
          fail(400, "INVALID_STATUS", "The leave request status filter is invalid");
        }
        filter.status = req.query.status;
      }
      if (req.query.from !== undefined || req.query.to !== undefined) {
        const from = req.query.from;
        const to = req.query.to;
        if ((from !== undefined && !validDate(from)) || (to !== undefined && !validDate(to)) ||
          (from && to && from > to)) {
          fail(400, "INVALID_DATE_RANGE", "Use valid from/to dates in YYYY-MM-DD format");
        }
        if (to) filter.startDate = { $lte: to };
        if (from) filter.endDate = { $gte: from };
      }
      const employeeFilter = { companyId: req.companyId };
      if (req.query.departmentId !== undefined) {
        if (!validObjectId(req.query.departmentId)) fail(400, "INVALID_FILTER", "Department id is invalid");
        employeeFilter.departmentId = req.query.departmentId;
      }
      if (req.query.employeeId !== undefined) {
        if (!validObjectId(req.query.employeeId)) fail(400, "INVALID_FILTER", "Employee id is invalid");
        employeeFilter._id = req.query.employeeId;
      }
      if (typeof req.query.search === "string" && req.query.search.trim()) {
        const expression = new RegExp(escapeRegex(req.query.search.trim().slice(0, 100)), "i");
        employeeFilter.$or = [
          { firstName: expression },
          { lastName: expression },
          { employeeId: expression }
        ];
      }
      const matchingEmployees = await employeeModel.find(employeeFilter).select("_id").lean();
      filter.employeeId = { $in: matchingEmployees.map((employee) => employee._id) };
      const [requests, total] = await Promise.all([
        leaveRequestModel.find(filter)
          .populate({ path: "employeeId", select: "employeeId firstName lastName departmentId", populate: { path: "departmentId", select: "name" } })
          .populate("leaveTypeId", "name paid annualQuota")
          .populate("reviewedBy", "name email")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        leaveRequestModel.countDocuments(filter)
      ]);
      return res.json({
        success: true,
        data: { requests, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/requests/:id/review", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    try {
      if (!validObjectId(req.params.id)) fail(400, "INVALID_ID", "A valid leave request id is required");
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["decision", "comment"].includes(key))) {
        fail(400, "INVALID_INPUT", "Provide a decision and optional review comment");
      }
      if (!["Approved", "Rejected"].includes(body.decision)) {
        fail(400, "INVALID_DECISION", "Decision must be Approved or Rejected");
      }
      const comment = body.comment ?? "";
      if (typeof comment !== "string" || comment.trim().length > 1000 ||
        (body.decision === "Rejected" && !comment.trim())) {
        fail(400, "REVIEW_COMMENT_REQUIRED", "A rejection comment of at most 1000 characters is required");
      }
      const pendingRequest = await leaveRequestModel.findOne({
        _id: req.params.id,
        companyId: req.companyId,
        status: "Pending"
      }).populate("employeeId", "userId");
      if (!pendingRequest) fail(409, "REQUEST_ALREADY_REVIEWED", "This leave request is no longer pending");
      if (pendingRequest.employeeId?.userId &&
        String(pendingRequest.employeeId.userId) === String(req.user._id)) {
        fail(403, "SELF_REVIEW_FORBIDDEN", "You cannot review your own leave request");
      }
      const request = await leaveRequestModel.findOneAndUpdate(
        {
          _id: req.params.id,
          companyId: req.companyId,
          status: "Pending"
        },
        {
          $set: {
            status: body.decision,
            reviewComment: comment.trim(),
            reviewedBy: req.user._id,
            reviewedAt: now(),
            ...(body.decision === "Rejected" ? { activeDates: [] } : {})
          }
        },
        { new: true, runValidators: true }
      );
      if (!request) fail(409, "REQUEST_ALREADY_REVIEWED", "This leave request was already reviewed");
      return res.json({ success: true, data: { request } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export { calculateWorkingDates, currentCompanyDate, validDate };
