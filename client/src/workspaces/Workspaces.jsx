import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getAttendanceSummary,
  getEmployees,
  getLeaveRequests,
  getMyEmployeeProfile
} from "../api.js";
import "./Workspaces.css";

function apiError(error) {
  return error.response?.data?.error?.message ||
    (error.response
      ? "Some workspace information is unavailable."
      : "Cannot reach the HCM Lite API. Check that the server is running.");
}

function Metric({ label, value, loading, error }) {
  return <article className="workspace-metric">
    <span>{label}</span>
    <strong>{error ? "—" : loading ? "…" : value}</strong>
    {error && <small>Unavailable</small>}
  </article>;
}

export function HRWorkspace() {
  const [employeeCount, setEmployeeCount] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getEmployees({ page: 1, limit: 1, status: "Active" }),
      getAttendanceSummary(),
      getLeaveRequests({ page: 1, limit: 1, status: "Pending" })
    ]).then(([employeesResult, attendanceResult, leaveResult]) => {
      if (!active) return;
      const nextErrors = {};
      if (employeesResult.status === "fulfilled") setEmployeeCount(employeesResult.value.pagination.total);
      else nextErrors.employees = apiError(employeesResult.reason);
      if (attendanceResult.status === "fulfilled") setAttendance(attendanceResult.value.summary);
      else nextErrors.attendance = apiError(attendanceResult.reason);
      if (leaveResult.status === "fulfilled") setPending(leaveResult.value.pagination.total);
      else nextErrors.leave = apiError(leaveResult.reason);
      setErrors(nextErrors);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <section className="workspace-page">
      <div className="workspace-heading"><p className="eyebrow">HR workspace</p>
        <h1>People operations</h1><p>Review employee, attendance, and leave information for your company.</p></div>
      <div className="workspace-metrics">
        <Metric label="Employees" value={employeeCount ?? 0} loading={loading} error={errors.employees} />
        <Metric label="Present today" value={attendance?.Present ?? 0} loading={loading} error={errors.attendance} />
        <Metric label="Late today" value={attendance?.Late ?? 0} loading={loading} error={errors.attendance} />
        <Metric label="Pending leave requests" value={pending ?? 0} loading={loading} error={errors.leave} />
      </div>
      {Object.keys(errors).length > 0 && <p className="workspace-info" role="status">
        {Object.values(errors).join(" ")}
      </p>}
      <div className="workspace-links">
        <Link to="/employees"><strong>Employee directory</strong><span>Search employee records and open details</span></Link>
        <Link to="/attendance"><strong>Attendance</strong><span>View daily reports and attendance records</span></Link>
        <Link to="/leaves"><strong>Leave requests</strong><span>Review, approve, or reject employee requests</span></Link>
      </div>
    </section>
  );
}

export function EmployeeWorkspace() {
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unlinked, setUnlinked] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getMyEmployeeProfile()
      .then((profile) => { if (active) setEmployee(profile); })
      .catch((requestError) => {
        if (!active) return;
        if (["EMPLOYEE_LINK_REQUIRED", "EMPLOYEE_PROFILE_NOT_FOUND"].includes(
          requestError.response?.data?.error?.code
        )) setUnlinked(true);
        else setError(apiError(requestError));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <section className="workspace-page">
      <div className="workspace-heading"><p className="eyebrow">Employee workspace</p>
        <h1>My workspace</h1><p>Your profile and personal work tools.</p></div>
      {loading ? <p className="workspace-muted">Loading your profile…</p> : unlinked ? (
        <div className="workspace-profile workspace-unlinked">
          <h2>Employee profile not linked</h2>
          <p>Your account is not linked to an active employee record. Contact HR to arrange an explicit, verified link. Your personal leave and attendance records become available after linking.</p>
        </div>
      ) : employee ? (
        <section className="workspace-profile">
          <div><p className="eyebrow">My profile</p><h2>{employee.firstName} {employee.lastName}</h2></div>
          <dl>
            <div><dt>Employee ID</dt><dd>{employee.employeeId}</dd></div>
            <div><dt>Department</dt><dd>{employee.departmentId?.name || "—"}</dd></div>
            <div><dt>Designation</dt><dd>{employee.designationId?.name || "—"}</dd></div>
            <div><dt>Employment status</dt><dd>{employee.status}</dd></div>
          </dl>
          <Link className="workspace-text-link" to="/employees/me">View profile details</Link>
        </section>
      ) : error ? <p className="workspace-info" role="alert">{error}</p> : null}
      {error && !unlinked && <p className="workspace-info" role="alert">{error}</p>}
      <div className="workspace-links">
        <Link to="/employee/attendance"><strong>My attendance</strong><span>Check in or out and view your history</span></Link>
        <Link to="/employee/leaves"><strong>My leave</strong><span>Apply for leave and track your requests and balances</span></Link>
      </div>
    </section>
  );
}
