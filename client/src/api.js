import axios from "axios";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  timeout: 5000,
  headers: { "Content-Type": "application/json" }
});

export async function getApiHealth() {
  const response = await apiClient.get("/health");
  return response.data;
}

export async function demoLogin(role) {
  const response = await apiClient.post("/auth/demo-login", { role });
  return response.data;
}

export async function getCompanySettings() {
  const response = await apiClient.get("/company/settings");
  return response.data.data.company;
}

export async function getCompanySetupStatus() {
  const response = await apiClient.get("/company/setup");
  return response.data.data;
}

export async function initializeCompanySetup(setup) {
  const response = await apiClient.post("/company/setup", setup);
  return response.data.data.company;
}

export async function saveCompanySettings(settings) {
  const response = await apiClient.put("/company/settings", settings);
  return response.data.data.company;
}

export async function getOrganizationRecords(resource) {
  const response = await apiClient.get(`/organization/${resource}`);
  return response.data.data.items;
}

export async function getOrganizationMembers() {
  const response = await apiClient.get("/organization/members");
  return response.data.data.members;
}

export async function saveOrganizationRecord(resource, recordId, values) {
  const url = recordId
    ? `/organization/${resource}/${recordId}`
    : `/organization/${resource}`;
  const response = await apiClient[recordId ? "put" : "post"](url, values);
  return response.data.data.item;
}

export async function setOrganizationRecordActive(resource, recordId, active) {
  const response = await apiClient.patch(
    `/organization/${resource}/${recordId}/status`,
    { active }
  );
  return response.data.data.item;
}
