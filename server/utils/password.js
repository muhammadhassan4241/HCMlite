import bcrypt from "bcryptjs";

export async function hashPassword(password, rounds = 12) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("Password must be a non-empty string");
  }

  return bcrypt.hash(password, rounds);
}

export async function verifyPassword(password, passwordHash) {
  if (typeof password !== "string" || typeof passwordHash !== "string") {
    throw new TypeError("Password and password hash must be strings");
  }

  return bcrypt.compare(password, passwordHash);
}
