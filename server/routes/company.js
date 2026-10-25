import { Router } from "express";
import mongoose from "mongoose";
import Company from "../models/Company.js";
import User from "../models/User.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { requireCompanyContext } from "../middleware/companyContext.js";

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const addressFields = ["line1", "line2", "city", "region", "postalCode", "country"];
const primaryCompanySlug = "hcm-lite-primary-company";
const companyFields = [
  "name", "logoUrl", "email", "phone", "address", "timeZone",
  "workingDays", "openingTime", "closingTime"
];

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function validateCompanySettings(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalid("A company settings object is required");
  }
  if (Object.keys(body).some((key) => !companyFields.includes(key))) {
    invalid("Company settings contain unsupported fields");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) invalid("Company name is required and must be at most 120 characters");

  const logoUrl = typeof body.logoUrl === "string" ? body.logoUrl.trim() : "";
  if (logoUrl) {
    let parsedLogoUrl;
    try {
      parsedLogoUrl = new URL(logoUrl);
    } catch {
      invalid("Company logo must be a valid HTTPS URL");
    }
    if (parsedLogoUrl.protocol !== "https:" || parsedLogoUrl.username || parsedLogoUrl.password) {
      invalid("Company logo must be a valid HTTPS URL");
    }
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email && (email.length > 254 || !emailPattern.test(email))) {
    invalid("Company email must be a valid email address");
  }
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (phone.length > 32) invalid("Company phone must be at most 32 characters");

  const timeZone = typeof body.timeZone === "string" ? body.timeZone.trim() : "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    invalid("A valid IANA time zone is required");
  }

  if (!Array.isArray(body.workingDays) ||
    body.workingDays.length === 0 ||
    body.workingDays.some((day) => !dayNames.includes(day)) ||
    new Set(body.workingDays).size !== body.workingDays.length) {
    invalid("Select one or more unique valid working days");
  }
  if (!timePattern.test(body.openingTime) || !timePattern.test(body.closingTime) ||
    body.openingTime >= body.closingTime) {
    invalid("Opening and closing times must be valid 24-hour times and closing must be later");
  }
  if (!body.address || typeof body.address !== "object" || Array.isArray(body.address) ||
    Object.keys(body.address).some((key) => !addressFields.includes(key))) {
    invalid("A valid company address object is required");
  }

  const address = Object.fromEntries(addressFields.map((field) => {
    const value = body.address[field] ?? "";
    if (typeof value !== "string" || value.length > (field === "line1" || field === "line2" ? 160 : 100)) {
      invalid(`Address ${field} is invalid`);
    }
    return [field, value.trim()];
  }));

  return {
    name,
    logoUrl,
    email,
    phone,
    address,
    timeZone,
    workingDays: dayNames.filter((day) => body.workingDays.includes(day)),
    openingTime: body.openingTime,
    closingTime: body.closingTime
  };
}

export function createCompanyRouter({
  jwtSecret,
  userModel = User,
  companyModel = Company
}) {
  const router = Router();
  router.use(authenticateToken(jwtSecret, userModel));
  router.use(authorizeRoles("Admin"));

  router.get("/setup", async (req, res, next) => {
    try {
      if (req.user.companyId) {
        if (!mongoose.isObjectIdOrHexString(req.user.companyId)) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_ASSIGNMENT_INVALID", message: "The Admin account has an invalid company assignment. Contact an administrator to resolve it." }
          });
        }
        const company = await companyModel.findById(req.user.companyId);
        if (!company) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_ASSIGNMENT_INVALID", message: "The Admin account references a company that does not exist. Contact an administrator to resolve it." }
          });
        }
        return res.json({ success: true, data: { status: "ready" } });
      }

      const count = await companyModel.countDocuments();
      if (count === 0) {
        return res.json({ success: true, data: { status: "uninitialized" } });
      }
      if (count > 1) {
        return res.json({ success: true, data: { status: "ambiguous" } });
      }

      const company = await companyModel.findOne().select("_id name");
      if (!company) {
        return res.json({ success: true, data: { status: "uninitialized" } });
      }
      return res.json({
        success: true,
        data: {
          status: "assignment-required",
          company: { id: String(company._id), name: company.name }
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/setup", async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        invalid("A company setup action is required");
      }

      if (req.user.companyId) {
        if (!mongoose.isObjectIdOrHexString(req.user.companyId)) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_ASSIGNMENT_INVALID", message: "The Admin account has an invalid company assignment. Contact an administrator to resolve it." }
          });
        }
        const assignedCompany = await companyModel.findById(req.user.companyId);
        if (!assignedCompany) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_ASSIGNMENT_INVALID", message: "The Admin account references a company that does not exist. Contact an administrator to resolve it." }
          });
        }
        return res.json({ success: true, data: { company: assignedCompany } });
      }

      if (req.body.action === "create") {
        if (Object.keys(req.body).some((key) => key !== "action" && key !== "settings")) {
          invalid("Company setup contains unsupported fields");
        }
        const settings = validateCompanySettings(req.body.settings);
        if (await companyModel.countDocuments() !== 0) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_SETUP_CONFLICT", message: "A company already exists. Review the setup page and explicitly confirm its assignment instead." }
          });
        }

        let company;
        try {
          company = await companyModel.create({ ...settings, slug: primaryCompanySlug });
        } catch (error) {
          if (error.code === 11000) {
            return res.status(409).json({
              success: false,
              error: { code: "COMPANY_SETUP_CONFLICT", message: "Company setup was completed concurrently. Reload the page to continue." }
            });
          }
          throw error;
        }
        const result = await userModel.updateOne(
          { _id: req.user._id, role: "Admin", companyId: null },
          { $set: { companyId: company._id } }
        );
        if (result.matchedCount !== 1) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_ASSIGNMENT_CONFLICT", message: "The Admin account changed during setup. Reload the page before continuing." }
          });
        }
        return res.status(201).json({ success: true, data: { company } });
      }

      if (req.body.action === "assign") {
        if (Object.keys(req.body).some((key) => key !== "action" && key !== "companyId") ||
          !mongoose.isObjectIdOrHexString(req.body.companyId)) {
          invalid("A valid company id is required to confirm assignment");
        }
        if (await companyModel.countDocuments() !== 1) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_SETUP_CONFLICT", message: "Company assignment is available only when exactly one company exists." }
          });
        }
        const company = await companyModel.findById(req.body.companyId);
        if (!company) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_SETUP_CONFLICT", message: "The selected company is no longer available. Reload the page and confirm the current company." }
          });
        }
        const result = await userModel.updateOne(
          { _id: req.user._id, role: "Admin", companyId: null },
          { $set: { companyId: company._id } }
        );
        if (result.matchedCount !== 1) {
          return res.status(409).json({
            success: false,
            error: { code: "COMPANY_ASSIGNMENT_CONFLICT", message: "The Admin account changed during setup. Reload the page before continuing." }
          });
        }
        return res.json({ success: true, data: { company } });
      }

      invalid("Choose a supported company setup action");
    } catch (error) {
      return next(error);
    }
  });

  router.use(requireCompanyContext(companyModel));

  router.get("/settings", (req, res) => {
    res.json({ success: true, data: { company: req.company } });
  });

  router.put("/settings", async (req, res, next) => {
    try {
      const settings = validateCompanySettings(req.body);
      const company = await companyModel.findOneAndUpdate(
        { _id: req.companyId },
        { $set: settings },
        { new: true, runValidators: true }
      );
      return res.json({ success: true, data: { company } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export { validateCompanySettings };
