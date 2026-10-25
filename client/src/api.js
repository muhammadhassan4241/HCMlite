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

export async function getEmployeeOptions(employeeId) {
  const response = await apiClient.get("/employees/options", {
    params: employeeId ? { employeeId } : undefined
  });
  return response.data.data;
}

export async function getEmployees(params = {}) {
  const response = await apiClient.get("/employees", { params });
  return response.data.data;
}

export async function getEmployee(employeeId) {
  const response = await apiClient.get(`/employees/${employeeId}`);
  return response.data.data.employee;
}

export async function getMyEmployeeProfile() {
  const response = await apiClient.get("/employees/me");
  return response.data.data.employee;
}

export async function createEmployee(employee) {
  const response = await apiClient.post("/employees", employee);
  return response.data.data.employee;
}

export async function updateEmployee(employeeId, employee) {
  const response = await apiClient.put(`/employees/${employeeId}`, employee);
  return response.data.data.employee;
}

export async function updateEmployeeStatus(employeeId, status) {
  const response = await apiClient.patch(`/employees/${employeeId}/status`, { status });
  return response.data.data.employee;
}

export async function getMyAttendanceToday() {
  const response = await apiClient.get("/attendance/me/today");
  return response.data.data;
}

export async function checkInToAttendance() {
  const response = await apiClient.post("/attendance/me/check-in", {});
  return response.data.data;
}

export async function checkOutFromAttendance() {
  const response = await apiClient.post("/attendance/me/check-out", {});
  return response.data.data;
}

export async function getMyAttendanceHistory(params = {}) {
  const response = await apiClient.get("/attendance/me/history", { params });
  return response.data.data;
}

export async function getAttendanceSummary(params = {}) {
  const response = await apiClient.get("/attendance/summary", { params });
  return response.data.data;
}

export async function getAttendanceRecords(params = {}) {
  const response = await apiClient.get("/attendance/records", { params });
  return response.data.data;
}

export async function correctAttendanceRecord(recordId, correction) {
  const response = await apiClient.patch(`/attendance/records/${recordId}`, correction);
  return response.data.data.attendance;
}
