import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createEmployee,
  getEmployee,
  getEmployeeOptions,
  getEmployees,
  getMyEmployeeProfile,
  updateEmployee,
  updateEmployeeStatus
} from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import "./EmployeeManagement.css";

const employmentTypes = ["Full-time", "Part-time", "Contract", "Temporary", "Intern"];
const statuses = ["Active", "Inactive", "On Leave"];

function apiError(error) {
  return error.response?.data?.error?.message ||
    (error.response
      ? "The request could not be completed. Check the employee details and try again."
      : "Cannot reach the HCM Lite API. Check that the server is running.");
}

function displayDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

export function EmployeeDirectory() {
  const [data, setData] = useState({ employees: [], pagination: { page: 1, pages: 0, total: 0 } });
  const [options, setOptions] = useState({ departments: [], designations: [] });
  const [filters, setFilters] = useState({ search: "", departmentId: "", designationId: "", status: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");

  useEffect(() => {
    let active = true;
    getEmployeeOptions()
      .then((result) => { if (active) setOptions(result); })
      .catch((requestError) => { if (active) setOptionsError(apiError(requestError)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      getEmployees({
        page,
        limit: 10,
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters.designationId ? { designationId: filters.designationId } : {}),
        ...(filters.status ? { status: filters.status } : {})
      }).then((result) => {
        if (active) setData(result);
      }).catch((requestError) => {
        if (active) setError(apiError(requestError));
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, filters.search ? 250 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filters, page]);

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  return (
    <section className="employee-page">
      <div className="employee-heading">
        <div>
          <p className="eyebrow">People</p>
          <h1>Employee directory</h1>
          <p>Search and manage employee records for your company.</p>
        </div>
        <Link className="primary-button" to="/employees/new">Add employee</Link>
      </div>
      <div className="employee-filters">
        <label className="employee-search">
          <span className="visually-hidden">Search by employee ID, name, or work email</span>
          <input value={filters.search} onChange={(event) => changeFilter("search", event.target.value)}
            placeholder="Search ID, name, or work email" />
        </label>
        <label><span className="visually-hidden">Department</span>
          <select value={filters.departmentId} onChange={(event) => changeFilter("departmentId", event.target.value)}>
            <option value="">All departments</option>
            {options.departments.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}
          </select>
        </label>
        <label><span className="visually-hidden">Designation</span>
          <select value={filters.designationId} onChange={(event) => changeFilter("designationId", event.target.value)}>
            <option value="">All designations</option>
            {options.designations.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}
          </select>
        </label>
        <label><span className="visually-hidden">Employment status</span>
          <select value={filters.status} onChange={(event) => changeFilter("status", event.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
      </div>
      {optionsError && <p className="employee-feedback employee-error" role="alert">{optionsError}</p>}
      {error && <p className="employee-feedback employee-error" role="alert">{error}</p>}
      {loading ? <p className="employee-muted">Loading employees…</p> :
        data.employees.length === 0 ? (
          <div className="employee-empty">
            <h2>No employees found</h2>
            <p>{filters.search || filters.departmentId || filters.designationId || filters.status
              ? "Try adjusting the search or filters."
              : "Add your first employee to start building the directory."}</p>
            <Link className="text-link" to="/employees/new">Add an employee</Link>
          </div>
        ) : (
          <>
            <div className="employee-table-wrap">
              <table className="employee-table">
                <thead><tr><th>Employee</th><th>Department</th><th>Designation</th><th>Joining date</th><th>Status</th><th /></tr></thead>
                <tbody>{data.employees.map((employee) => (
                  <tr key={employee._id}>
                    <td>
                      <Link className="employee-name" to={`/employees/${employee._id}`}>
                        {employee.firstName} {employee.lastName}
                      </Link>
                      <span className="employee-subline">{employee.employeeId} · {employee.workEmail || "No work email"}</span>
                    </td>
                    <td>{employee.departmentId?.name || "—"}</td>
                    <td>{employee.designationId?.name || "—"}</td>
                    <td>{displayDate(employee.joiningDate)}</td>
                    <td><span className={`employee-status status-${employee.status.toLowerCase().replace(" ", "-")}`}>{employee.status}</span></td>
                    <td><Link className="employee-row-link" to={`/employees/${employee._id}`}>View</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="employee-pagination">
              <span>{data.pagination.total} employee{data.pagination.total === 1 ? "" : "s"}</span>
              <div>
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {data.pagination.page} of {Math.max(data.pagination.pages, 1)}</span>
                <button type="button" disabled={page >= data.pagination.pages || loading} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
    </section>
  );
}

const blankEmployee = {
  firstName: "", lastName: "", workEmail: "", phone: "", photoUrl: "",
  departmentId: "", designationId: "", joiningDate: "", employmentType: "Full-time",
  status: "Active", userId: ""
};

export function EmployeeForm({ edit = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(blankEmployee);
  const [options, setOptions] = useState({ departments: [], designations: [], users: [] });
  const [loading, setLoading] = useState(edit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const record = edit ? await getEmployee(id) : null;
        if (!active) return;
        if (record) {
          setEmployee({
            ...blankEmployee,
            ...record,
            departmentId: record.departmentId?._id || record.departmentId || "",
            designationId: record.designationId?._id || record.designationId || "",
            joiningDate: record.joiningDate ? new Date(record.joiningDate).toISOString().slice(0, 10) : "",
            userId: record.userId || ""
          });
        }
        try {
          setOptions(await getEmployeeOptions(edit ? id : undefined));
        } catch (optionsRequestError) {
          if (active) setError(apiError(optionsRequestError));
        }
      } catch (requestError) {
        if (active) setError(apiError(requestError));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [edit, id]);

  function change(name, value) {
    setEmployee((current) => {
      if (name !== "departmentId") return { ...current, [name]: value };
      const designation = options.designations.find((item) => item._id === current.designationId);
      return {
        ...current,
        departmentId: value,
        ...(designation?.departmentId && String(designation.departmentId) !== value
          ? { designationId: "" }
          : {})
      };
    });
    setError("");
    setSuccess("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const values = {
      firstName: employee.firstName,
      lastName: employee.lastName,
      workEmail: employee.workEmail,
      phone: employee.phone,
      photoUrl: employee.photoUrl,
      departmentId: employee.departmentId,
      designationId: employee.designationId,
      joiningDate: employee.joiningDate,
      employmentType: employee.employmentType,
      status: employee.status,
      userId: employee.userId
    };
    try {
      const saved = edit ? await updateEmployee(id, values) : await createEmployee(values);
      setSuccess(edit ? "Employee details saved." : "Employee added.");
      navigate(`/employees/${saved._id}`, { replace: true, state: { success: edit ? "Employee details saved." : "Employee added." } });
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="employee-page"><p className="employee-muted">Loading employee…</p></section>;
  if (edit && error && !employee._id) {
    return <section className="employee-page">
      <p className="eyebrow">People</p><h1>Employee unavailable</h1>
      <p className="employee-feedback employee-error" role="alert">{error}</p>
      <Link className="text-link" to="/employees">Back to directory</Link>
    </section>;
  }

  const input = (key, label, type = "text", required = false) => (
    <label className="employee-field" key={key}>
      <span>{label}</span>
      <input type={type} value={employee[key] || ""} required={required} maxLength={key === "photoUrl" ? 2048 : undefined}
        onChange={(event) => change(key, event.target.value)} />
    </label>
  );

  return (
    <section className="employee-page">
      <div className="employee-heading">
        <div><p className="eyebrow">People</p><h1>{edit ? "Edit employee" : "Add employee"}</h1>
          <p>{edit ? `Update ${employee.firstName} ${employee.lastName}'s employment record.` : "Create a company-scoped employee record. Employee ID is generated automatically."}</p></div>
      </div>
      <form className="employee-form" onSubmit={handleSubmit}>
        <div className="employee-form-grid">
          {input("firstName", "First name", "text", true)}
          {input("lastName", "Last name", "text", true)}
          {input("workEmail", "Work email", "email")}
          {input("phone", "Phone", "tel")}
          {input("photoUrl", "Profile photo URL (HTTPS)", "url")}
          <label className="employee-field"><span>Joining date</span><input type="date" value={employee.joiningDate} required
            onChange={(event) => change("joiningDate", event.target.value)} /></label>
          <label className="employee-field"><span>Employment type</span><select value={employee.employmentType}
            onChange={(event) => change("employmentType", event.target.value)}>
            {employmentTypes.map((type) => <option key={type}>{type}</option>)}
          </select></label>
          <label className="employee-field"><span>Department</span><select value={employee.departmentId}
            onChange={(event) => change("departmentId", event.target.value)}>
            <option value="">No department</option>
            {options.departments.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}
          </select></label>
          <label className="employee-field"><span>Designation</span><select value={employee.designationId}
            onChange={(event) => change("designationId", event.target.value)}>
            <option value="">No designation</option>
            {options.designations.filter((item) =>
              !item.departmentId || (employee.departmentId && String(item.departmentId) === employee.departmentId)
            ).map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}
          </select></label>
          <label className="employee-field employee-field-wide"><span>Link existing Employee login (optional)</span>
            <select value={employee.userId} onChange={(event) => change("userId", event.target.value)}>
              <option value="">No login account linked</option>
              {options.users.map((user) => <option value={user._id} key={user._id}>{user.name} ({user.email})</option>)}
            </select>
            <small>Only active Employee accounts in this company are listed. Accounts are never matched by email or created here.</small>
          </label>
        </div>
        {error && <p className="employee-feedback employee-error" role="alert">{error}</p>}
        {success && <p className="employee-feedback employee-success" role="status">{success}</p>}
        <div className="employee-actions">
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : edit ? "Save changes" : "Add employee"}</button>
          <button className="employee-secondary" type="button" onClick={() => navigate(edit ? `/employees/${id}` : "/employees")}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

export function EmployeeDetails({ ownProfile = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const canManage = !ownProfile && ["Admin", "HR"].includes(user.role);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(location.state?.success || "");
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => {
    let active = true;
    const request = ownProfile ? getMyEmployeeProfile() : getEmployee(id);
    request.then((record) => { if (active) setEmployee(record); })
      .catch((requestError) => { if (active) setError(apiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, ownProfile]);

  async function changeStatus(status) {
    setSavingStatus(true);
    setError("");
    try {
      await updateEmployeeStatus(employee._id, status);
      setEmployee((current) => ({ ...current, status }));
      setSuccess(`Employee status changed to ${status}.`);
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setSavingStatus(false);
    }
  }

  if (loading) return <section className="employee-page"><p className="employee-muted">Loading employee…</p></section>;
  if (!employee) return <section className="employee-page">
    <p className="eyebrow">Employee profile</p><h1>Profile unavailable</h1>
    <p className="employee-feedback employee-error" role="alert">{error || "The employee profile could not be loaded."}</p>
    {!ownProfile && <Link className="text-link" to="/employees">Back to directory</Link>}
  </section>;

  return (
    <section className="employee-page">
      <div className="employee-heading employee-detail-heading">
        <div className="employee-identity">
          {employee.photoUrl
            ? <img className="employee-avatar" src={employee.photoUrl} alt="" />
            : <span className="employee-avatar employee-avatar-fallback">{employee.firstName[0]}{employee.lastName[0]}</span>}
          <div><p className="eyebrow">{employee.employeeId}</p><h1>{employee.firstName} {employee.lastName}</h1>
            <p>{employee.workEmail || "No work email"}{employee.phone ? ` · ${employee.phone}` : ""}</p></div>
        </div>
        {canManage && <div className="employee-actions">
          <Link className="primary-button" to={`/employees/${employee._id}/edit`}>Edit employee</Link>
          <label className="employee-status-control"><span>Employment status</span>
            <select value={employee.status} disabled={savingStatus}
              onChange={(event) => changeStatus(event.target.value)}>
              {statuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </div>}
      </div>
      {error && <p className="employee-feedback employee-error" role="alert">{error}</p>}
      {success && <p className="employee-feedback employee-success" role="status">{success}</p>}
      <div className="employee-detail-grid">
        <section className="employee-card"><h2>Employment</h2>
          <dl>
            <div><dt>Status</dt><dd><span className={`employee-status status-${employee.status.toLowerCase().replace(" ", "-")}`}>{employee.status}</span></dd></div>
            <div><dt>Department</dt><dd>{employee.departmentId?.name || "—"}</dd></div>
            <div><dt>Designation</dt><dd>{employee.designationId?.name || "—"}</dd></div>
            <div><dt>Joining date</dt><dd>{displayDate(employee.joiningDate)}</dd></div>
            <div><dt>Employment type</dt><dd>{employee.employmentType}</dd></div>
          </dl>
        </section>
        {!ownProfile && <section className="employee-card"><h2>Contact</h2>
          <dl><div><dt>Work email</dt><dd>{employee.workEmail || "—"}</dd></div>
            <div><dt>Phone</dt><dd>{employee.phone || "—"}</dd></div></dl>
        </section>}
      </div>
      <button className="employee-back-link" type="button" onClick={() => navigate(ownProfile ? "/employee" : "/employees")}>
        {ownProfile ? "Back to workspace" : "Back to directory"}
      </button>
    </section>
  );
}
