import mongoose from "mongoose";
import { Router } from "express";
import Company from "../models/Company.js";
import CompanyHoliday from "../models/CompanyHoliday.js";
import Department from "../models/Department.js";
import Designation from "../models/Designation.js";
import LeaveType from "../models/LeaveType.js";
import User from "../models/User.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { requireCompanyContext } from "../middleware/companyContext.js";

const namePattern = /^.{1,120}$/u;
const descriptionMaxLength = 1000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function fail(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function bodyObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "A request body object is required", "INVALID_INPUT");
  }
}

function validateKeys(body, allowed) {
  bodyObject(body);
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    fail(400, "The request contains unsupported fields", "INVALID_INPUT");
  }
}

function cleanName(body) {
  if (typeof body.name !== "string" || !namePattern.test(body.name.trim())) {
    fail(400, "Name is required and must be at most 120 characters", "INVALID_INPUT");
  }
  return body.name.trim();
}

function cleanDescription(body) {
  const description = body.description ?? "";
  if (typeof description !== "string" || description.length > descriptionMaxLength) {
    fail(400, "Description must be at most 1000 characters", "INVALID_INPUT");
  }
  return description.trim();
}

function normalizedName(name) {
  return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function validObjectId(value) {
  return typeof value === "string" && mongoose.isObjectIdOrHexString(value);
}

async function departmentData(body, { companyId, userModel, departmentModel }) {
  validateKeys(body, ["name", "description", "departmentHeadId"]);
  const name = cleanName(body);
  const description = cleanDescription(body);
  let departmentHeadId = null;
  if (body.departmentHeadId) {
    if (!validObjectId(body.departmentHeadId)) {
      fail(400, "Department head must be a valid user id", "INVALID_REFERENCE");
    }
    const head = await userModel.findOne({
      _id: body.departmentHeadId,
      companyId,
      status: "active"
    }).select("_id");
    if (!head) {
      fail(400, "Department head must be an active user in this company", "INVALID_REFERENCE");
    }
    departmentHeadId = head._id;
  }
  return {
    name,
    normalizedName: normalizedName(name),
    description,
    departmentHeadId
  };
}

async function designationData(body, { companyId, departmentModel }) {
  validateKeys(body, ["name", "description", "departmentId"]);
  const name = cleanName(body);
  const description = cleanDescription(body);
  let departmentId = null;
  if (body.departmentId) {
    if (!validObjectId(body.departmentId)) {
      fail(400, "Department must be a valid id", "INVALID_REFERENCE");
    }
    const department = await departmentModel.findOne({
      _id: body.departmentId,
      companyId,
      active: true
    }).select("_id");
    if (!department) {
      fail(400, "Department must be active and belong to this company", "INVALID_REFERENCE");
    }
    departmentId = department._id;
  }
  return { name, normalizedName: normalizedName(name), description, departmentId };
}

function leaveTypeData(body) {
  validateKeys(body, ["name", "description", "annualQuota", "paid"]);
  const name = cleanName(body);
  const description = cleanDescription(body);
  if (typeof body.annualQuota !== "number" ||
    !Number.isFinite(body.annualQuota) ||
    body.annualQuota < 0 ||
    body.annualQuota > 366) {
    fail(400, "Annual quota must be a number between 0 and 366", "INVALID_INPUT");
  }
  if (typeof body.paid !== "boolean") {
    fail(400, "Paid status must be true or false", "INVALID_INPUT");
  }
  return {
    name,
    normalizedName: normalizedName(name),
    description,
    annualQuota: body.annualQuota,
    paid: body.paid
  };
}

function holidayData(body) {
  validateKeys(body, ["name", "description", "date", "recurringAnnually"]);
  const name = cleanName(body);
  const description = cleanDescription(body);
  if (!validDate(body.date)) {
    fail(400, "Holiday date must be a valid calendar date in YYYY-MM-DD format", "INVALID_INPUT");
  }
  if (typeof body.recurringAnnually !== "boolean") {
    fail(400, "Annual recurrence must be true or false", "INVALID_INPUT");
  }
  return {
    name,
    normalizedName: normalizedName(name),
    description,
    date: body.date,
    recurringAnnually: body.recurringAnnually
  };
}

const resourceDefinitions = {
  departments: {
    model: Department,
    prepare: departmentData
  },
  designations: {
    model: Designation,
    prepare: designationData
  },
  "leave-types": {
    model: LeaveType,
    prepare: leaveTypeData
  },
  holidays: {
    model: CompanyHoliday,
    prepare: holidayData
  }
};

function duplicateFilter(data, companyId, id) {
  const filter = {
    companyId,
    normalizedName: data.normalizedName,
    active: true
  };
  if (data.date) filter.date = data.date;
  if (Object.hasOwn(data, "departmentId")) filter.departmentId = data.departmentId;
  if (id) filter._id = { $ne: id };
  return filter;
}

export function createOrganizationRouter({
  jwtSecret,
  userModel = User,
  companyModel = Company,
  models = {}
}) {
  const router = Router();
  router.use(authenticateToken(jwtSecret, userModel));
  router.use(authorizeRoles("Admin"));
  router.use(requireCompanyContext(companyModel));

  router.get("/members", async (req, res, next) => {
    try {
      const members = await userModel.find({
        companyId: req.companyId,
        status: "active"
      }).select("_id name email role").sort({ name: 1 }).lean();
      return res.json({ success: true, data: { members } });
    } catch (error) {
      return next(error);
    }
  });

  for (const [resource, definition] of Object.entries(resourceDefinitions)) {
    const model = models[resource] || definition.model;

    router.get(`/${resource}`, async (req, res, next) => {
      try {
        const items = await model.find({ companyId: req.companyId }).sort({ name: 1 }).lean();
        return res.json({ success: true, data: { items } });
      } catch (error) {
        return next(error);
      }
    });

    router.post(`/${resource}`, async (req, res, next) => {
      try {
        const data = await definition.prepare(req.body, {
          companyId: req.companyId,
          userModel,
          departmentModel: models.departments || Department
        });
        if (await model.exists(duplicateFilter(data, req.companyId))) {
          return res.status(409).json({
            success: false,
            error: { code: "DUPLICATE_RESOURCE", message: "A matching record already exists" }
          });
        }
        const item = await model.create({
          ...data,
          companyId: req.companyId,
          active: true
        });
        return res.status(201).json({ success: true, data: { item } });
      } catch (error) {
        return next(error);
      }
    });

    router.get(`/${resource}/:id`, async (req, res, next) => {
      if (!validObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_ID", message: "A valid record id is required" }
        });
      }
      try {
        const item = await model.findOne({ _id: req.params.id, companyId: req.companyId }).lean();
        if (!item) {
          return res.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "The record was not found" }
          });
        }
        return res.json({ success: true, data: { item } });
      } catch (error) {
        return next(error);
      }
    });

    router.put(`/${resource}/:id`, async (req, res, next) => {
      if (!validObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_ID", message: "A valid record id is required" }
        });
      }
      try {
        const data = await definition.prepare(req.body, {
          companyId: req.companyId,
          userModel,
          departmentModel: models.departments || Department
        });
        if (await model.exists(duplicateFilter(data, req.companyId, req.params.id))) {
          return res.status(409).json({
            success: false,
            error: { code: "DUPLICATE_RESOURCE", message: "A matching record already exists" }
          });
        }
        const item = await model.findOneAndUpdate(
          { _id: req.params.id, companyId: req.companyId },
          { $set: data },
          { new: true, runValidators: true }
        );
        if (!item) {
          return res.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "The record was not found" }
          });
        }
        return res.json({ success: true, data: { item } });
      } catch (error) {
        return next(error);
      }
    });

    router.patch(`/${resource}/:id/status`, async (req, res, next) => {
      if (!validObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_ID", message: "A valid record id is required" }
        });
      }
      if (typeof req.body?.active !== "boolean" ||
        Object.keys(req.body).some((key) => key !== "active")) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_INPUT", message: "An active boolean is required" }
        });
      }
      try {
        const existing = await model.findOne({
          _id: req.params.id,
          companyId: req.companyId
        }).select("_id name normalizedName date departmentId active");
        if (!existing) {
          return res.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "The record was not found" }
          });
        }

        if (req.body.active) {
          const duplicate = await model.exists({
            companyId: req.companyId,
            normalizedName: existing.normalizedName,
            active: true,
            ...(existing.date ? { date: existing.date } : {}),
            ...(Object.hasOwn(existing, "departmentId") ? { departmentId: existing.departmentId } : {}),
            _id: { $ne: existing._id }
          });
          if (duplicate) {
            return res.status(409).json({
              success: false,
              error: { code: "DUPLICATE_RESOURCE", message: "A matching record already exists" }
            });
          }
        }

        const item = await model.findOneAndUpdate(
          { _id: req.params.id, companyId: req.companyId },
          { $set: { active: req.body.active } },
          { new: true, runValidators: true }
        );
        if (!item) {
          return res.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "The record was not found" }
          });
        }
        return res.json({ success: true, data: { item } });
      } catch (error) {
        return next(error);
      }
    });
  }

  return router;
}

export { validDate };
