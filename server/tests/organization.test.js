import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { validateCompanySettings } from "../routes/company.js";
import { validDate } from "../routes/organization.js";

const secret = "test-secret-long-enough-123";
const companyId = "64b000000000000000000001";

function createResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function createUserModel(users) {
  return {
    findById(id) {
      const user = users.find((entry) => String(entry._id) === String(id));
      return {
        select() {
          return user ? { ...user, passwordHash: undefined } : null;
        }
      };
    },
    find() {
      return {
        select() {
          return {
            sort() {
              return {
                lean: async () => users
                  .filter((user) => user.companyId === companyId && user.status === "active")
                  .sort((a, b) => a.name.localeCompare(b.name))
              };
            }
          };
        }
      };
    },
    async findOne(filter) {
      return users.find((user) => Object.entries(filter).every(([key, value]) => String(user[key]) === String(value))) ?? null;
    }
  };
}

function createCompanyModel(company) {
  return {
    async findById(id) {
      return String(company._id) === String(id) ? company : null;
    },
    async findOneAndUpdate(filter, update) {
      if (String(company._id) !== String(filter._id) && filter._id != null) return null;
      Object.assign(company, update.$set ?? {});
      return company;
    }
  };
}

test("company settings validation accepts a valid payload and rejects invalid configuration", () => {
  const validCompany = {
    name: "Acme Labs",
    logoUrl: "https://cdn.example.com/logo.png",
    email: "hello@acme.com",
    phone: "+1 555 123 4567",
    address: {
      line1: "123 Main St",
      line2: "",
      city: "Boston",
      region: "MA",
      postalCode: "02116",
      country: "US"
    },
    timeZone: "America/New_York",
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    openingTime: "09:00",
    closingTime: "17:00"
  };

  assert.deepEqual(validateCompanySettings(validCompany), {
    name: "Acme Labs",
    logoUrl: "https://cdn.example.com/logo.png",
    email: "hello@acme.com",
    phone: "+1 555 123 4567",
    address: {
      line1: "123 Main St",
      line2: "",
      city: "Boston",
      region: "MA",
      postalCode: "02116",
      country: "US"
    },
    timeZone: "America/New_York",
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    openingTime: "09:00",
    closingTime: "17:00"
  });

  assert.throws(
    () => validateCompanySettings({ ...validCompany, openingTime: "17:00", closingTime: "17:00" }),
    /closing must be later/i
  );
  assert.throws(
    () => validateCompanySettings({ ...validCompany, workingDays: [] }),
    /Select one or more unique valid working days/i
  );
});

test("role middleware enforces unauthenticated and admin-only access", () => {
  const unauthenticated = createResponse();
  authorizeRoles("Admin")({}, unauthenticated, () => {
    throw new Error("next should not be called");
  });
  assert.equal(unauthenticated.statusCode, 401);

  const forbidden = createResponse();
  authorizeRoles("Admin")({ auth: { role: "HR" } }, forbidden, () => {
    throw new Error("next should not be called");
  });
  assert.equal(forbidden.statusCode, 403);

  const allowed = createResponse();
  let called = false;
  authorizeRoles("Admin")({ auth: { role: "Admin" } }, allowed, () => {
    called = true;
  });
  assert.equal(called, true);
});

test("organization date validation accepts valid date strings and rejects invalid ones", () => {
  assert.equal(typeof validDate("2024-02-29"), "boolean");
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2024-02-30"), false);
  assert.equal(validDate("invalid-date"), false);
});
