import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/User.js";
import { hashPassword } from "../utils/password.js";

async function seedAdmin() {
  const { MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  const missing = ["MONGODB_URI", "ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"]
    .filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL.trim())) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }
  if (ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.length > 1024) {
    throw new Error("ADMIN_PASSWORD must be between 12 and 1024 characters");
  }

  await mongoose.connect(MONGODB_URI);
  try {
    if (await User.exists({ role: "Admin" })) {
      throw new Error("An Admin account already exists; refusing to create another seed Admin");
    }

    await User.create({
      name: ADMIN_NAME.trim(),
      email: ADMIN_EMAIL.trim().toLowerCase(),
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      role: "Admin",
      status: "active"
    });
    console.info("Initial Admin account created.");
  } finally {
    await mongoose.disconnect();
  }
}

seedAdmin().catch((error) => {
  console.error("Failed to seed Admin:", error.message);
  process.exitCode = 1;
});
