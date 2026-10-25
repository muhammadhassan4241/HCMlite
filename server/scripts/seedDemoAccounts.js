import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import Company from "../models/Company.js";
import User from "../models/User.js";
import { hashPassword } from "../utils/password.js";

const demoAccounts = [
  { name: "Demo Admin", email: "demo.admin@hcm-lite.local", role: "Admin", passwordKey: "Admin" },
  { name: "Demo HR", email: "demo.hr@hcm-lite.local", role: "HR", passwordKey: "HR" },
  {
    name: "Demo Employee",
    email: "demo.employee@hcm-lite.local",
    role: "Employee",
    passwordKey: "Employee"
  }
];

class DemoSeedError extends Error {}

function validatePasswords(passwords) {
  for (const account of demoAccounts) {
    const password = passwords?.[account.passwordKey];
    if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
      throw new DemoSeedError(
        `DEMO_${account.passwordKey.toUpperCase()}_PASSWORD must be between 12 and 1024 characters`
      );
    }
  }
}

export async function seedDemoAccounts({
  passwords,
  companyId = null,
  userModel = User,
  hash = hashPassword
}) {
  validatePasswords(passwords);
  const results = [];

  for (const account of demoAccounts) {
    const existingUser = await userModel.findOne({ email: account.email });
    if (existingUser) {
      results.push({ email: account.email, status: "exists" });
      continue;
    }

    await userModel.create({
      name: account.name,
      email: account.email,
      passwordHash: await hash(passwords[account.passwordKey]),
      role: account.role,
      status: "active",
      ...(companyId ? { companyId } : {})
    });
    results.push({ email: account.email, status: "created" });
  }

  return results;
}

async function run() {
  const { MONGODB_URI } = process.env;
  if (!MONGODB_URI?.trim()) {
    throw new DemoSeedError("MONGODB_URI is required");
  }
  if (!process.argv.slice(2).includes("--confirm")) {
    throw new DemoSeedError("No changes made. Rerun with the explicit --confirm flag");
  }

  const passwords = {
    Admin: process.env.DEMO_ADMIN_PASSWORD,
    HR: process.env.DEMO_HR_PASSWORD,
    Employee: process.env.DEMO_EMPLOYEE_PASSWORD
  };
  validatePasswords(passwords);

  await mongoose.connect(MONGODB_URI);
  try {
    let companyId = null;
    if (process.env.ADMIN_EMAIL) {
      const admin = await User.findOne({
        email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
        role: "Admin"
      }).select("companyId");
      if (admin?.companyId) {
        const company = await Company.findById(admin.companyId).select("_id");
        if (company) companyId = company._id;
      }
      if (!companyId) {
        throw new DemoSeedError(
          "Run setup:company and associate the configured Admin before provisioning demo users"
        );
      }
    }
    const results = await seedDemoAccounts({ passwords, companyId });
    for (const result of results) {
      console.info(`${result.email}: ${result.status}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    const message = error instanceof DemoSeedError
      ? error.message
      : "Database operation failed; credentials and connection details were not logged";
    console.error(`Demo account seeding failed: ${message}`);
    process.exitCode = 1;
  });
}
