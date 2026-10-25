import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { Router } from "express";
import Company from "../models/Company.js";
import Department from "../models/Department.js";
import Designation from "../models/Designation.js";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { requireCompanyContext } from "../middleware/companyContext.js";

const employeeStatuses = ["Active", "Inactive", "On Leave"];
const employmentTypes = ["Full-time", "Part-time", "Contract", "Temporary", "Intern"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const writableFields = [
  "firstName", "lastName", "workEmail", "phone", "photoUrl",
  "departmentId", "designationId", "joiningDate", "employmentType", "status", "userId"
];

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function validObjectId(value) {
  return typeof value === "string" && mongoose.isObjectIdOrHexString(value);
}

function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function employeeId() {
  return `EMP-${randomBytes(12).toString("hex").toUpperCase()}`;
}

function employeeData(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "INVALID_INPUT", "An employee object is required");
  }
  if (Object.keys(body).some((key) => !writableFields.includes(key))) {
    fail(400, "INVALID_INPUT", "Employee data contains unsupported fields");
  }

  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) {
    fail(400, "INVALID_INPUT", "First and last names are required and must be at most 80 characters");
  }

  if (body.workEmail != null && typeof body.workEmail !== "string") {
    fail(400, "INVALID_INPUT", "Enter a valid work email address");
  }
  const workEmail = typeof body.workEmail === "string" ? body.workEmail.trim().toLowerCase() : "";
  if (workEmail && (workEmail.length > 254 || !emailPattern.test(workEmail))) {
    fail(400, "INVALID_INPUT", "Enter a valid work email address");
  }
  const phone = body.phone ?? "";
  if (typeof phone !== "string" || phone.length > 32) {
    fail(400, "INVALID_INPUT", "Phone must be at most 32 characters");
  }

  const photoUrl = body.photoUrl ?? "";
  if (typeof photoUrl !== "string" || photoUrl.length > 2048) {
    fail(400, "INVALID_INPUT", "Profile photo URL is invalid");
  }
  if (photoUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(photoUrl);
    } catch {
      fail(400, "INVALID_INPUT", "Profile photo URL must use HTTPS");
    }
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
      fail(400, "INVALID_INPUT", "Profile photo URL must use HTTPS");
    }
  }

  if (!validDate(body.joiningDate)) {
    fail(400, "INVALID_INPUT", "Joining date must be a valid calendar date in YYYY-MM-DD format");
  }
  if (!employmentTypes.includes(body.employmentType)) {
    fail(400, "INVALID_INPUT", "Choose a valid employment type");
  }
  const status = body.status ?? "Active";
  if (!employeeStatuses.includes(status)) {
    fail(400, "INVALID_INPUT", "Choose a valid employment status");
  }

  function referenceId(field) {
    const value = body[field] ?? "";
    if (!value) return null;
    if (!validObjectId(value)) fail(400, "INVALID_REFERENCE", `${field} must be a valid id`);
    return new mongoose.Types.ObjectId(value);
  }

  return {
    firstName,
    lastName,
    ...(workEmail ? { workEmail } : {}),
    phone: phone.trim(),
    photoUrl: photoUrl.trim(),
    departmentId: referenceId("departmentId"),
    designationId: referenceId("designationId"),
    joiningDate: new Date(`${body.joiningDate}T00:00:00.000Z`),
    employmentType: body.employmentType,
    status,
    ...(body.userId ? { userId: referenceId("userId") } : {})
  };
}

async function validateReferences(data, { companyId, departmentModel, designationModel, userModel, employeeModel, employeeRecordId }) {
  if (data.departmentId) {
    const department = await departmentModel.findOne({
      _id: data.departmentId,
      companyId,
      active: true
    }).select("_id");
    if (!department) fail(400, "INVALID_REFERENCE", "Department must be active and belong to this company");
  }
  if (data.designationId) {
    const designation = await designationModel.findOne({
      _id: data.designationId,
      companyId,
      active: true
    }).select("_id departmentId");
    if (!designation) fail(400, "INVALID_REFERENCE", "Designation must be active and belong to this company");
    if (designation.departmentId &&
      (!data.departmentId || String(designation.departmentId) !== String(data.departmentId))) {
      fail(400, "INVALID_REFERENCE", "The selected designation belongs to a different department");
    }
  }
  if (data.userId) {
    const user = await userModel.findOne({
      _id: data.userId,
      companyId,
      role: "Employee",
      status: "active"
    }).select("_id");
    if (!user) fail(400, "INVALID_REFERENCE", "Linked account must be an active Employee in this company");
    const linkedEmployee = await employeeModel.exists({
      companyId,
      userId: data.userId,
      ...(employeeRecordId ? { _id: { $ne: employeeRecordId } } : {})
    });
    if (linkedEmployee) fail(409, "DUPLICATE_EMPLOYEE_ACCOUNT", "This account is already linked to an employee");
  }
}

function paginationValue(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? parsed : null;
}

export function createEmployeeRouter({
  jwtSecret,
  userModel = User,
  companyModel = Company,
  employeeModel = Employee,
  departmentModel = Department,
  designationModel = Designation
}) {
  const router = Router();
  router.use(authenticateToken(jwtSecret, userModel));
  router.use(requireCompanyContext(companyModel));

  router.get("/options", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    try {
      if (req.query.employeeId !== undefined && !validObjectId(req.query.employeeId)) {
        fail(400, "INVALID_ID", "A valid employee id is required");
      }
      const [departments, designations, users, linkedEmployees] = await Promise.all([
        departmentModel.find({ companyId: req.companyId, active: true }).select("_id name").sort({ name: 1 }).lean(),
        designationModel.find({ companyId: req.companyId, active: true }).select("_id name departmentId").sort({ name: 1 }).lean(),
        userModel.find({ companyId: req.companyId, role: "Employee", status: "active" }).select("_id name email").sort({ name: 1 }).lean(),
        employeeModel.find({ companyId: req.companyId, userId: { $exists: true } }).select("_id userId").lean()
      ]);
      const linkedIds = new Set(linkedEmployees.map((employee) => String(employee.userId)));
      const editableEmployee = req.query.employeeId
        ? await employeeModel.findOne({
          _id: req.query.employeeId,
          companyId: req.companyId
        }).select("userId")
        : null;
      if (editableEmployee?.userId) linkedIds.delete(String(editableEmployee.userId));
      const availableUsers = users.filter((user) => !linkedIds.has(String(user._id)));
      if (editableEmployee?.userId && !availableUsers.some(
        (user) => String(user._id) === String(editableEmployee.userId)
      )) {
        const currentUser = await userModel.findOne({
          _id: editableEmployee.userId,
          companyId: req.companyId,
          role: "Employee",
          status: "active"
        }).select("_id name email");
        if (currentUser) availableUsers.push(currentUser);
      }
      return res.json({
        success: true,
        data: {
          departments,
          designations,
          users: availableUsers
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me", async (req, res, next) => {
    try {
      const employee = await employeeModel.findOne({
        companyId: req.companyId,
        userId: req.user._id,
        status: { $ne: "Inactive" }
      }).populate("departmentId", "name").populate("designationId", "name").lean();
      if (!employee) {
        return res.status(404).json({
          success: false,
          error: { code: "EMPLOYEE_PROFILE_NOT_FOUND", message: "No active employee profile is linked to this account" }
        });
      }
      const { companyId, userId, ...profile } = employee;
      return res.json({ success: true, data: { employee: profile } });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    try {
      const page = paginationValue(req.query.page, 1, 100000);
      const limit = paginationValue(req.query.limit, 20, 100);
      if (!page || !limit) fail(400, "INVALID_PAGINATION", "Page must be positive and limit must be between 1 and 100");
      const filter = { companyId: req.companyId };
      const { search, departmentId, designationId, status } = req.query;
      if (typeof search === "string" && search.trim()) {
        const tokens = search.trim().slice(0, 100).split(/\s+/).filter(Boolean);
        filter.$and = tokens.map((token) => {
          const expression = new RegExp(escapeRegex(token), "i");
          return { $or: [
            { employeeId: expression },
            { firstName: expression },
            { lastName: expression },
            { workEmail: expression }
          ] };
        });
      }
      if (departmentId !== undefined) {
        if (!validObjectId(departmentId)) fail(400, "INVALID_FILTER", "Department filter must be a valid id");
        filter.departmentId = departmentId;
      }
      if (designationId !== undefined) {
        if (!validObjectId(designationId)) fail(400, "INVALID_FILTER", "Designation filter must be a valid id");
        filter.designationId = designationId;
      }
      if (status !== undefined) {
        if (!employeeStatuses.includes(status)) fail(400, "INVALID_FILTER", "Status filter is invalid");
        filter.status = status;
      }
      const [employees, total] = await Promise.all([
        employeeModel.find(filter)
          .populate("departmentId", "name")
          .populate("designationId", "name")
          .sort({ lastName: 1, firstName: 1, _id: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        employeeModel.countDocuments(filter)
      ]);
      return res.json({
        success: true,
        data: { employees, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    try {
      const data = employeeData(req.body);
      if (data.status === "Inactive" && data.userId) {
        fail(400, "INVALID_INPUT", "Create linked employees as Active, then deactivate the employee record to disable the account");
      }
      await validateReferences(data, {
        companyId: req.companyId,
        departmentModel,
        designationModel,
        userModel,
        employeeModel
      });
      if (data.workEmail && await employeeModel.exists({
        companyId: req.companyId,
        workEmail: data.workEmail
      })) {
        return res.status(409).json({
          success: false,
          error: { code: "DUPLICATE_WORK_EMAIL", message: "An employee with this work email already exists in this company" }
        });
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const employee = await employeeModel.create({
            ...data,
            companyId: req.companyId,
            employeeId: employeeId()
          });
          return res.status(201).json({ success: true, data: { employee } });
        } catch (error) {
          if (error.code === "DUPLICATE_EMPLOYEE_ACCOUNT") {
            return res.status(409).json({
              success: false,
              error: { code: error.code, message: error.message }
            });
          }
          if (error.code === 11000) {
            if (error.keyPattern?.workEmail || error.keyValue?.workEmail || error.keyPattern?.userId || error.keyValue?.userId) {
              const duplicateAccount = Boolean(error.keyPattern?.userId || error.keyValue?.userId);
              return res.status(409).json({
                success: false,
                error: {
                  code: duplicateAccount ? "DUPLICATE_EMPLOYEE_ACCOUNT" : "DUPLICATE_WORK_EMAIL",
                  message: duplicateAccount
                    ? "This account is already linked to an employee"
                    : "An employee with this work email already exists in this company"
                }
              });
            }
            continue;
          }
          throw error;
        }
      }
      return res.status(503).json({
        success: false,
        error: { code: "EMPLOYEE_ID_GENERATION_FAILED", message: "Could not generate a unique employee ID. Please retry." }
      });
    } catch (error) {
      if (error.code === "DUPLICATE_EMPLOYEE_ACCOUNT") {
        return res.status(409).json({
          success: false,
          error: { code: error.code, message: error.message }
        });
      }
      return next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_ID", message: "A valid employee id is required" }
      });
    }
    try {
      const filter = { _id: req.params.id, companyId: req.companyId };
      if (req.auth.role === "Employee") {
        filter.userId = req.user._id;
        filter.status = { $ne: "Inactive" };
      } else if (!["Admin", "HR"].includes(req.auth.role)) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "You do not have permission to access this resource" }
        });
      }
      const employee = await employeeModel.findOne(filter)
        .populate("departmentId", "name")
        .populate("designationId", "name")
        .lean();
      if (!employee) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "The employee was not found" }
        });
      }
      if (req.auth.role === "Employee") {
        const { companyId, userId, ...profile } = employee;
        return res.json({ success: true, data: { employee: profile } });
      }
      return res.json({ success: true, data: { employee } });
    } catch (error) {
      return next(error);
    }
  });

  router.put("/:id", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_ID", message: "A valid employee id is required" }
      });
    }
    try {
      const data = employeeData(req.body);
      const existing = await employeeModel.findOne({
        _id: req.params.id,
        companyId: req.companyId
      }).select("status");
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "The employee was not found" }
        });
      }
      if (data.status !== existing.status) {
        return res.status(400).json({
          success: false,
          error: { code: "USE_EMPLOYEE_STATUS_ENDPOINT", message: "Change employment status using the employee status action" }
        });
      }
      await validateReferences(data, {
        companyId: req.companyId,
        departmentModel,
        designationModel,
        userModel,
        employeeModel,
        employeeRecordId: req.params.id
      });
      const update = { $set: data };
      const unset = {};
      if (!data.workEmail) unset.workEmail = 1;
      if (!data.userId) unset.userId = 1;
      if (Object.keys(unset).length) update.$unset = unset;
      const employee = await employeeModel.findOneAndUpdate(
        { _id: req.params.id, companyId: req.companyId },
        update,
        { new: true, runValidators: true }
      );
      if (!employee) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "The employee was not found" }
        });
      }
      return res.json({ success: true, data: { employee } });
    } catch (error) {
      if (error.code === "DUPLICATE_EMPLOYEE_ACCOUNT") {
        return res.status(409).json({
          success: false,
          error: { code: error.code, message: error.message }
        });
      }
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          error: { code: "DUPLICATE_EMPLOYEE", message: "This work email or account is already assigned to another employee" }
        });
      }
      return next(error);
    }
  });

  router.patch("/:id/status", authorizeRoles("Admin", "HR"), async (req, res, next) => {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_ID", message: "A valid employee id is required" }
      });
    }
    if (!req.body || Object.keys(req.body).length !== 1 || !employeeStatuses.includes(req.body.status)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "A valid employee status is required" }
      });
    }
    try {
      const existing = await employeeModel.findOne({
        _id: req.params.id,
        companyId: req.companyId
      }).select("+accountDeactivatedByEmployee _id status userId");
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "The employee was not found" }
        });
      }

      let accountDeactivatedByEmployee = existing.accountDeactivatedByEmployee === true;
      let accountStatusChanged = false;
      let previousAccountStatus;
      if (existing.userId && req.body.status === "Inactive" && !accountDeactivatedByEmployee) {
        const accountUpdate = await userModel.updateOne(
          {
            _id: existing.userId,
            companyId: req.companyId,
            role: "Employee",
            status: "active"
          },
          { $set: { status: "inactive" } }
        );
        accountStatusChanged = accountUpdate.matchedCount === 1;
        accountDeactivatedByEmployee = accountStatusChanged;
        previousAccountStatus = "active";
      } else if (existing.userId && req.body.status !== "Inactive" && accountDeactivatedByEmployee) {
        const accountUpdate = await userModel.updateOne(
          {
            _id: existing.userId,
            companyId: req.companyId,
            role: "Employee",
            status: "inactive"
          },
          { $set: { status: "active" } }
        );
        accountStatusChanged = accountUpdate.matchedCount === 1;
        accountDeactivatedByEmployee = false;
        previousAccountStatus = "inactive";
      }

      let employee;
      try {
        employee = await employeeModel.findOneAndUpdate(
          { _id: req.params.id, companyId: req.companyId },
          { $set: {
            status: req.body.status,
            accountDeactivatedByEmployee
          } },
          { new: true, runValidators: true }
        );
      } catch (error) {
        if (accountStatusChanged) {
          const rollbackStatus = previousAccountStatus === "active" ? "inactive" : "active";
          await userModel.updateOne(
            {
              _id: existing.userId,
              companyId: req.companyId,
              role: "Employee",
              status: rollbackStatus
            },
            { $set: { status: previousAccountStatus } }
          );
        }
        throw error;
      }
      if (!employee) {
        if (accountStatusChanged) {
          const rollbackStatus = previousAccountStatus === "active" ? "inactive" : "active";
          await userModel.updateOne(
            {
              _id: existing.userId,
              companyId: req.companyId,
              role: "Employee",
              status: rollbackStatus
            },
            { $set: { status: previousAccountStatus } }
          );
        }
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "The employee was not found" }
        });
      }
      return res.json({ success: true, data: { employee } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
