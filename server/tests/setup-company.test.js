import assert from "node:assert/strict";
import { test } from "node:test";
import { setupCompany } from "../scripts/setupCompany.js";

const adminId = "64b000000000000000000031";
const companyId = "64b000000000000000000032";

function setupModels({ admins = [{ _id: adminId, companyId: null }], initialCompanies = [] } = {}) {
  const users = [
    ...admins.map((admin) => ({ email: "admin@example.com", role: "Admin", ...admin })),
    { _id: "demo-admin", email: "demo.admin@hcm-lite.local", role: "Admin", companyId: null },
    { _id: "demo-hr", email: "demo.hr@hcm-lite.local", role: "HR", companyId: null },
    { _id: "demo-employee", email: "demo.employee@hcm-lite.local", role: "Employee", companyId: null }
  ];
  const companies = [...initialCompanies];
  const userUpdates = [];
  return {
    users,
    companies,
    userUpdates,
    userModel: {
      find(filter) {
        return { select: async () => users.filter((entry) =>
          entry.role === filter.role && entry.email === filter.email
        ) };
      },
      async updateOne(filter, update) {
        userUpdates.push({ filter, update });
        const user = users.find((entry) =>
          (filter._id ? String(entry._id) === String(filter._id) : entry.email === filter.email) &&
          (!filter.role || entry.role === filter.role)
        );
        if (!user || (filter.companyId === null && user.companyId != null)) {
          return { matchedCount: 0 };
        }
        Object.assign(user, update.$set);
        return { matchedCount: 1 };
      }
    },
    companyModel: {
      countDocuments: async () => companies.length,
      findOne() {
        return { select: async () => companies[0] ?? null };
      },
      findById(id) {
        return { select: async () => companies.find((entry) => String(entry._id) === String(id)) ?? null };
      },
      async create(data) {
        const company = { ...data, _id: companyId };
        companies.push(company);
        return company;
      },
      async deleteOne({ _id }) {
        const index = companies.findIndex((entry) => String(entry._id) === String(_id));
        if (index >= 0) companies.splice(index, 1);
      }
    }
  };
}

test("initial company setup creates a company and associates the existing Admin", async () => {
  const models = setupModels();
  const result = await setupCompany({
    adminEmail: " ADMIN@example.com ",
    companyName: "Example Company",
    ...models
  });

  assert.equal(result.status, "created-and-associated");
  assert.equal(models.companies.length, 1);
  assert.equal(models.users[0].companyId, companyId);
  assert.equal(models.userUpdates.length, 4);
  assert.equal(models.companies[0].slug, "hcm-lite-primary-company");
});

test("company setup refuses multiple company choices without changing the Admin", async () => {
  const models = setupModels({
    initialCompanies: [
      { _id: "64b000000000000000000041", name: "One" },
      { _id: "64b000000000000000000042", name: "Two" }
    ]
  });

  await assert.rejects(
    setupCompany({ adminEmail: "admin@example.com", companyName: "Example", ...models }),
    /Multiple companies exist/
  );
  assert.equal(models.users[0].companyId, null);
  assert.equal(models.userUpdates.length, 0);
});

test("company setup refuses when the configured Admin is not unique", async () => {
  const models = setupModels({ admins: [] });
  await assert.rejects(
    setupCompany({ adminEmail: "admin@example.com", companyName: "Example", ...models }),
    /No existing Admin/
  );
  assert.equal(models.companies.length, 0);
});

test("confirmed setup repairs only unassigned demo accounts when the Admin already has a company", async () => {
  const company = { _id: companyId, name: "Existing company" };
  const models = setupModels({
    admins: [{ _id: adminId, email: "admin@example.com", role: "Admin", companyId }],
    initialCompanies: [company]
  });
  const result = await setupCompany({
    adminEmail: "admin@example.com",
    ...models
  });

  assert.equal(result.status, "already-associated");
  assert.equal(models.users[0].companyId, companyId);
  assert.ok(models.users.slice(1).every((user) => user.companyId === companyId));
  assert.equal(models.companies.length, 1);
  assert.equal(models.userUpdates.length, 3);
});
