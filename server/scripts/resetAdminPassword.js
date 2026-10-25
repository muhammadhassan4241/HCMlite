import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import User from "../models/User.js";
import { hashPassword } from "../utils/password.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ResetAdminPasswordError extends Error {}

export async function resetAdminPassword({
  email,
  password,
  confirmed,
  userModel = User,
  hash = hashPassword
}) {
  if (!confirmed) {
    throw new ResetAdminPasswordError("Password reset requires the --confirm flag");
  }

  if (typeof email !== "string" || !emailPattern.test(email.trim())) {
    throw new ResetAdminPasswordError("RESET_ADMIN_EMAIL must be a valid email address");
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new ResetAdminPasswordError("RESET_ADMIN_PASSWORD must be between 12 and 1024 characters");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const admins = await userModel
    .find({ email: normalizedEmail, role: "Admin" })
    .select("_id");

  if (admins.length !== 1) {
    throw new ResetAdminPasswordError(
      admins.length === 0
        ? "No Admin account matches RESET_ADMIN_EMAIL"
        : "Multiple Admin accounts match RESET_ADMIN_EMAIL; no password was changed"
    );
  }

  const passwordHash = await hash(password);
  const result = await userModel.updateOne(
    { _id: admins[0]._id, email: normalizedEmail, role: "Admin" },
    { $set: { passwordHash } }
  );

  if (result.matchedCount !== 1) {
    throw new ResetAdminPasswordError(
      "The matching Admin account changed before reset; no password was changed"
    );
  }
}

async function run() {
  const { MONGODB_URI, RESET_ADMIN_EMAIL, RESET_ADMIN_PASSWORD } = process.env;
  if (!MONGODB_URI?.trim()) {
    throw new ResetAdminPasswordError("MONGODB_URI is required");
  }
  if (!process.argv.slice(2).includes("--confirm")) {
    throw new ResetAdminPasswordError("No changes made. Rerun with the explicit --confirm flag");
  }

  await mongoose.connect(MONGODB_URI);
  try {
    await resetAdminPassword({
      email: RESET_ADMIN_EMAIL,
      password: RESET_ADMIN_PASSWORD,
      confirmed: true
    });
    console.info("Admin password reset successfully.");
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    const message = error instanceof ResetAdminPasswordError
      ? error.message
      : "Database operation failed; credentials and connection details were not logged";
    console.error(`Admin password reset failed: ${message}`);
    process.exitCode = 1;
  });
}
