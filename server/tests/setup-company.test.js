import assert from "node:assert/strict";
import { test } from "node:test";
import { setupCompany } from "../scripts/setupCompany.js";

const adminId = "64b000000000000000000031";
const companyId = "64b000000000000000000032";

function setupModels({ admins = [{ _id: adminId, companyId: null }], initialCompanies = [] } = {}) {
  const users = [...admins];
  const companies = [...initialCompanies];
  const userUpdates = [];
  return {
    users,
    companies,
    userUpdates,
    userModel: {
      find() {
        return { select: async () => users };
      },
      async updateOne(filter, update) {
        userUpdates.push({ filter, update });
        const user = users.find((entry) => String(entry._id) === String(filter._id));
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
