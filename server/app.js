import cors from "cors";
import express from "express";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import Company from "./models/Company.js";
import CompanyHoliday from "./models/CompanyHoliday.js";
import Department from "./models/Department.js";
import Designation from "./models/Designation.js";
import Employee from "./models/Employee.js";
import Attendance from "./models/Attendance.js";
import LeaveType from "./models/LeaveType.js";
import User from "./models/User.js";
import { createCompanyRouter } from "./routes/company.js";
import healthRouter from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { createOrganizationRouter } from "./routes/organization.js";
import { createEmployeeRouter } from "./routes/employees.js";
import { createAttendanceRouter } from "./routes/attendance.js";

export function createApp({
  frontendUrl,
  jwtSecret,
  userModel,
  companyModel = Company,
  organizationModels,
  attendanceModels,
  demoLoginEnabled,
  demoPasswords
}) {
  if (!frontendUrl || !jwtSecret) {
    throw new TypeError("Frontend URL and JWT secret are required to configure the API");
  }

  const app = express();

  app.use(cors({ origin: frontendUrl }));
  app.use(express.json());
  app.use("/api/health", healthRouter);
  app.use("/api/company", createCompanyRouter({
    jwtSecret,
    userModel,
    companyModel
  }));
  app.use("/api/organization", createOrganizationRouter({
    jwtSecret,
    userModel,
    companyModel,
    models: {
      departments: organizationModels?.departments || Department,
      designations: organizationModels?.designations || Designation,
      "leave-types": organizationModels?.["leave-types"] || LeaveType,
      holidays: organizationModels?.holidays || CompanyHoliday
    }
  }));
  app.use("/api/employees", createEmployeeRouter({
    jwtSecret,
    userModel,
    companyModel,
    employeeModel: organizationModels?.employees || Employee,
    departmentModel: organizationModels?.departments || Department,
    designationModel: organizationModels?.designations || Designation
  }));
  app.use("/api/attendance", createAttendanceRouter({
    jwtSecret,
    userModel,
    companyModel,
    employeeModel: organizationModels?.employees || Employee,
    attendanceModel: attendanceModels?.attendance || Attendance,
    holidayModel: attendanceModels?.holidays || CompanyHoliday,
    departmentModel: organizationModels?.departments || Department,
    now: attendanceModels?.now
  }));
  app.use("/api/auth", createAuthRouter({
    jwtSecret,
    userModel,
    demoLoginEnabled,
    demoPasswords
  }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
