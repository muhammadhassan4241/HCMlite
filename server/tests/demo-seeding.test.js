import assert from "node:assert/strict";
import { test } from "node:test";
import { seedDemoAccounts } from "../scripts/seedDemoAccounts.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

const passwords = {
  Admin: "admin-demo-password",
  HR: "human-resources-demo-password",
  Employee: "employee-demo-password"
};

function createUserModel(initialUsers = []) {
  const users = new Map(initialUsers.map((user) => [user.email, user]));
  return {
    users,
    findOne: async ({ email }) => users.get(email) ?? null,
    create: async (user) => {
      users.set(user.email, user);
      return user;
    }
  };
}

test("provisions three demo accounts with bcrypt hashes and supported roles", async () => {
  const userModel = createUserModel();
  const results = await seedDemoAccounts({
    passwords,
    userModel,
    hash: (password) => hashPassword(password, 4)
  });

  assert.deepEqual(results.map(({ status }) => status), ["created", "created", "created"]);
  assert.deepEqual([...userModel.users.values()].map(({ role }) => role), [
    "Admin",
    "HR",
    "Employee"
  ]);
  for (const user of userModel.users.values()) {
    assert.match(user.passwordHash, /^\$2[aby]\$/);
    assert.equal("password" in user, false);
    assert.equal(await verifyPassword(passwords[user.role], user.passwordHash), true);
  }
});

test("leaves existing demo accounts and their passwords and roles unchanged", async () => {
  const existing = {
    name: "Existing account",
    email: "demo.admin@hcm-lite.local",
    role: "Employee",
    passwordHash: "unchanged-hash",
    status: "inactive"
  };
  const userModel = createUserModel([existing]);
  let hashesCreated = 0;

  const results = await seedDemoAccounts({
    passwords,
    userModel,
    hash: async () => {
      hashesCreated += 1;
      return "new-hash";
    }
  });

  assert.equal(results[0].status, "exists");
  assert.equal(userModel.users.get(existing.email), existing);
  assert.equal(hashesCreated, 2);
  assert.equal(existing.role, "Employee");
  assert.equal(existing.passwordHash, "unchanged-hash");
});

test("rejects missing or weak passwords before creating any account", async () => {
  const userModel = createUserModel();
  await assert.rejects(
    seedDemoAccounts({
      passwords: { ...passwords, HR: "short" },
      userModel
    }),
    /DEMO_HR_PASSWORD/
  );
  assert.equal(userModel.users.size, 0);
});
