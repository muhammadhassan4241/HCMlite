import assert from "node:assert/strict";
import { test } from "node:test";
import { resetAdminPassword } from "../scripts/resetAdminPassword.js";

function createUserModel(admins) {
  const calls = { query: null, update: null };
  return {
    calls,
    find(query) {
      calls.query = query;
      return { select: async () => admins };
    },
    async updateOne(filter, update) {
      calls.update = { filter, update };
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

const validCredentials = {
  email: "  ADMIN@example.com ",
  password: "new secure password",
  confirmed: true
};

test("resets only the matching Admin password using the shared hash utility", async () => {
  const userModel = createUserModel([{ _id: "admin-1" }]);
  let hashedPassword;

  await resetAdminPassword({
    ...validCredentials,
    userModel,
    hash: async (password) => {
      hashedPassword = password;
      return "bcrypt-hash";
    }
  });

  assert.deepEqual(userModel.calls.query, { email: "admin@example.com", role: "Admin" });
  assert.equal(hashedPassword, validCredentials.password);
  assert.deepEqual(userModel.calls.update, {
    filter: { _id: "admin-1", email: "admin@example.com", role: "Admin" },
    update: { $set: { passwordHash: "bcrypt-hash" } }
  });
});

test("requires explicit confirmation before querying or updating", async () => {
  const userModel = createUserModel([{ _id: "admin-1" }]);

  await assert.rejects(
    resetAdminPassword({ ...validCredentials, confirmed: false, userModel }),
    /--confirm/
  );
  assert.equal(userModel.calls.query, null);
  assert.equal(userModel.calls.update, null);
});

test("does not update when no Admin matches", async () => {
  const userModel = createUserModel([]);

  await assert.rejects(
    resetAdminPassword({ ...validCredentials, userModel }),
    /No Admin account matches/
  );
  assert.equal(userModel.calls.update, null);
});

test("does not update when multiple Admin records match", async () => {
  const userModel = createUserModel([{ _id: "admin-1" }, { _id: "admin-2" }]);

  await assert.rejects(
    resetAdminPassword({ ...validCredentials, userModel }),
    /Multiple Admin accounts/
  );
  assert.equal(userModel.calls.update, null);
});

test("rejects invalid email and out-of-policy passwords without updating", async () => {
  const userModel = createUserModel([{ _id: "admin-1" }]);

  await assert.rejects(
    resetAdminPassword({ ...validCredentials, email: "invalid", userModel }),
    /RESET_ADMIN_EMAIL/
  );
  await assert.rejects(
    resetAdminPassword({ ...validCredentials, password: "short", userModel }),
    /RESET_ADMIN_PASSWORD/
  );
  assert.equal(userModel.calls.update, null);
});
