import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import Company from "../models/Company.js";
import User from "../models/User.js";

class SetupCompanyError extends Error {}

export async function setupCompany({
  adminEmail,
  companyName,
  userModel = User,
  companyModel = Company
}) {
  if (typeof adminEmail !== "string" || !adminEmail.trim()) {
    throw new SetupCompanyError("ADMIN_EMAIL must identify the existing Admin account");
  }
  if (typeof companyName !== "string" || !companyName.trim() || companyName.trim().length > 120) {
    throw new SetupCompanyError("COMPANY_NAME is required and must be at most 120 characters");
  }

  const admins = await userModel.find({
    email: adminEmail.trim().toLowerCase(),
    role: "Admin"
  }).select("_id companyId");
  if (admins.length !== 1) {
    throw new SetupCompanyError(
      admins.length === 0
        ? "No existing Admin matches ADMIN_EMAIL"
        : "Multiple Admin accounts match ADMIN_EMAIL; no company was created"
    );
  }

  const admin = admins[0];
  if (admin.companyId) {
    const associatedCompany = await companyModel.findById(admin.companyId).select("name");
    if (!associatedCompany) {
      throw new SetupCompanyError("Admin has a company association that does not exist");
    }
    return { company: associatedCompany, status: "already-associated" };
  }

  const companyCount = await companyModel.countDocuments();
  if (companyCount > 1) {
    throw new SetupCompanyError(
      "Multiple companies exist; assign the Admin to the intended company before setup"
    );
  }

  let company = companyCount === 1
    ? await companyModel.findOne().select("_id name")
    : null;
  let createdCompany = false;
  if (!company) {
    company = await companyModel.create({
      name: companyName.trim(),
      slug: "hcm-lite-primary-company",
      timeZone: "UTC",
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      openingTime: "09:00",
      closingTime: "17:00"
    });
    createdCompany = true;
  }

  const result = await userModel.updateOne(
    { _id: admin._id, role: "Admin", companyId: null },
    { $set: { companyId: company._id } }
  );
  if (result.matchedCount !== 1) {
    if (createdCompany) await companyModel.deleteOne({ _id: company._id });
    throw new SetupCompanyError("Admin association changed during setup; no change was made");
  }

  for (const [email, role] of [
    ["demo.admin@hcm-lite.local", "Admin"],
    ["demo.hr@hcm-lite.local", "HR"],
    ["demo.employee@hcm-lite.local", "Employee"]
  ]) {
    await userModel.updateOne(
      { email, role, companyId: null },
      { $set: { companyId: company._id } }
    );
  }

  return { company, status: createdCompany ? "created-and-associated" : "associated-existing" };
}

async function run() {
  if (!process.env.MONGODB_URI?.trim()) {
    throw new SetupCompanyError("MONGODB_URI is required");
  }
  if (!process.argv.slice(2).includes("--confirm")) {
    throw new SetupCompanyError("No changes made. Rerun with the explicit --confirm flag");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const result = await setupCompany({
      adminEmail: process.env.ADMIN_EMAIL,
      companyName: process.env.COMPANY_NAME
    });
    console.info(`Company setup ${result.status}.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    const message = error instanceof SetupCompanyError
      ? error.message
      : "Database operation failed; connection details were not logged";
    console.error(`Company setup failed: ${message}`);
    process.exitCode = 1;
  });
}
