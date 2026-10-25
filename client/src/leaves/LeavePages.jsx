import React, { useEffect, useState } from "react";
import {
  cancelLeaveRequest,
  getEmployeeOptions,
  getLeaveRequests,
  getLeaveTypes,
  getMyLeaveBalances,
  getMyLeaveRequests,
  reviewLeaveRequest,
  submitLeaveRequest
} from "../api.js";
import "./LeavePages.css";

function apiError(error) {
  return error.response?.data?.error?.message ||
    (error.response
      ? "The request could not be completed. Review the details and try again."
      : "Cannot reach the HCM Lite API. Check that the server is running.");
}

function displayDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function RequestStatus({ status }) {
  return <span className={`leave-status leave-${status.toLowerCase()}`}>{status}</span>;
}

export function EmployeeLeavePage() {
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [requests, setRequests] = useState({ requests: [], pagination: { page: 1, pages: 0, total: 0 } });
  const [form, setForm] = useState({ leaveTypeId: "", startDate: "", endDate: "", reason: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [unlinked, setUnlinked] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [availableTypes, balanceData, requestData] = await Promise.all([
        getLeaveTypes(),
        getMyLeaveBalances(),
        getMyLeaveRequests({ page, limit: 10 })
      ]);
      setTypes(availableTypes);
      setBalances(balanceData.balances);
      setRequests(requestData);
      setUnlinked(false);
    } catch (loadError) {
      if (loadError.response?.data?.error?.code === "EMPLOYEE_LINK_REQUIRED") {
        setUnlinked(true);
      } else {
        setError(apiError(loadError));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [page]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!form.leaveTypeId || !form.startDate || !form.endDate || !form.reason.trim()) {
      setError("Choose a leave type, enter the date range, and provide a reason.");
      return;
    }
    if (form.endDate < form.startDate) {
      setError("The end date cannot be before the start date.");
      return;
    }
    setSaving(true);
    try {
      await submitLeaveRequest({ ...form, reason: form.reason.trim() });
      setSuccess("Your leave request was submitted for review.");
      setForm({ leaveTypeId: "", startDate: "", endDate: "", reason: "" });
      setPage(1);
      await load();
    } catch (submitError) {
      setError(apiError(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function cancel(requestId) {
    setError("");
    setSuccess("");
    try {
      await cancelLeaveRequest(requestId);
      setSuccess("The pending leave request was cancelled.");
      await load();
    } catch (cancelError) {
      setError(apiError(cancelError));
    }
  }

  return (
    <section className="leave-page">
      <div className="leave-heading">
        <div><p className="eyebrow">People</p><h1>My leave</h1>
          <p>Submit a request and follow its review status.</p></div>
      </div>
      {error && <p className="leave-feedback leave-error" role="alert">{error}</p>}
      {success && <p className="leave-feedback leave-success" role="status">{success}</p>}
      {loading ? <p className="leave-muted">Loading your leave information…</p> : unlinked ? (
        <div className="leave-empty"><h2>Employee profile required</h2>
          <p>Your account does not have an active employee profile linked. Contact your HR team to arrange a verified link.</p></div>
      ) : (
        <>
          <section className="leave-balance-grid" aria-label="Annual leave balances">
            {balances.length ? balances.map(({ leaveType, annualQuota, used, remaining }) => (
              <article className="leave-balance-card" key={leaveType._id}>
                <span>{leaveType.name} · {annualQuota} days per year</span>
                <strong>{remaining} <small>remaining</small></strong>
                <p>{used} approved working days used</p>
              </article>
            )) : <p className="leave-muted">No active leave types are configured.</p>}
          </section>
          <div className="leave-content-grid">
            <form className="leave-panel leave-request-form" onSubmit={submit}>
              <p className="eyebrow">New request</p><h2>Apply for leave</h2>
              <label><span>Leave type</span><select required value={form.leaveTypeId}
                onChange={(event) => setForm({ ...form, leaveTypeId: event.target.value })}>
                <option value="">Select leave type</option>
                {types.map((type) => <option value={type._id} key={type._id}>{type.name} · {type.annualQuota} days/year</option>)}
              </select></label>
              <div className="leave-date-fields">
                <label><span>Start date</span><input type="date" required value={form.startDate}
                  onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
                <label><span>End date</span><input type="date" required min={form.startDate || undefined} value={form.endDate}
                  onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
              </div>
              <label><span>Reason</span><textarea required maxLength={1000} value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
              <p className="leave-hint">Working days are calculated using your company's workweek and holiday calendar. Requests remain pending until reviewed.</p>
              <button className="primary-button" type="submit" disabled={saving || !types.length}>
                {saving ? "Submitting…" : "Submit request"}
              </button>
            </form>
            <section className="leave-panel leave-history-panel">
              <div className="leave-panel-heading"><div><p className="eyebrow">Your records</p><h2>Request history</h2></div>
                <span>{requests.pagination.total} requests</span></div>
              {requests.requests.length === 0 ? <div className="leave-empty compact"><p>You have not submitted any leave requests.</p></div> :
                <div className="leave-request-list">{requests.requests.map((request) => (
                  <article className="leave-request-item" key={request._id}>
                    <div className="leave-request-title"><strong>{request.leaveTypeId?.name || "Leave"}</strong>
                      <RequestStatus status={request.status} /></div>
                    <p>{displayDate(request.startDate)} – {displayDate(request.endDate)} · {request.requestedDays} working day{request.requestedDays === 1 ? "" : "s"}</p>
                    <p className="leave-reason">{request.reason}</p>
                    {request.reviewComment && <p className="leave-review-comment">Review: {request.reviewComment}</p>}
                    {request.status === "Pending" && <button className="leave-link-button" type="button"
                      onClick={() => cancel(request._id)}>Cancel request</button>}
                  </article>
                ))}</div>}
              {requests.pagination.pages > 1 && <div className="leave-pagination">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {page} of {requests.pagination.pages}</span>
                <button disabled={page >= requests.pagination.pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

export function LeaveInboxPage() {
  const [requests, setRequests] = useState({ requests: [], pagination: { page: 1, pages: 0, total: 0 } });
  const [filters, setFilters] = useState({
    status: "Pending",
    from: "",
    to: "",
    departmentId: "",
    search: ""
  });
  const [departments, setDepartments] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reviewing, setReviewing] = useState("");
  const [comments, setComments] = useState({});

  async function load() {
    setLoading(true);
    setError("");
    if (filters.from && filters.to && filters.from > filters.to) {
      setError("The start of the filter range cannot be after its end.");
      setLoading(false);
      return;
    }
    try {
      setRequests(await getLeaveRequests({
        page,
        limit: 10,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters.search.trim() ? { search: filters.search.trim() } : {})
      }));
    } catch (loadError) {
      setError(apiError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    getEmployeeOptions()
      .then((options) => { if (active) setDepartments(options.departments); })
      .catch((optionsError) => { if (active) setError(apiError(optionsError)); });
    return () => { active = false; };
  }, []);

  useEffect(() => { load(); }, [page, filters]);

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  async function review(requestId, decision) {
    setError("");
    setSuccess("");
    const comment = comments[requestId] || "";
    if (decision === "Rejected" && !comment.trim()) {
      setError("Enter a comment before rejecting a request.");
      return;
    }
    setReviewing(requestId);
    try {
      await reviewLeaveRequest(requestId, decision, comment);
      setSuccess(`Leave request ${decision.toLowerCase()}.`);
      setComments((current) => ({ ...current, [requestId]: "" }));
      await load();
    } catch (reviewError) {
      setError(apiError(reviewError));
    } finally {
      setReviewing("");
    }
  }

  return (
    <section className="leave-page">
      <div className="leave-heading">
        <div><p className="eyebrow">People operations</p><h1>Leave requests</h1>
          <p>Review leave requests for employees in your company.</p></div>
      </div>
      {error && <p className="leave-feedback leave-error" role="alert">{error}</p>}
      {success && <p className="leave-feedback leave-success" role="status">{success}</p>}
      <div className="leave-inbox-toolbar">
        <label><span>Request status</span><select value={filters.status} onChange={(event) => changeFilter("status", event.target.value)}>
          <option value="Pending">Pending</option><option value="">All statuses</option>
          <option value="Approved">Approved</option><option value="Rejected">Rejected</option><option value="Cancelled">Cancelled</option>
        </select></label>
        <label><span>From</span><input type="date" value={filters.from}
          onChange={(event) => changeFilter("from", event.target.value)} /></label>
        <label><span>To</span><input type="date" value={filters.to}
          onChange={(event) => changeFilter("to", event.target.value)} /></label>
        <label><span>Department</span><select value={filters.departmentId}
          onChange={(event) => changeFilter("departmentId", event.target.value)}>
          <option value="">All departments</option>
          {departments.map((department) => <option value={department._id} key={department._id}>{department.name}</option>)}
        </select></label>
        <label><span>Employee</span><input value={filters.search} placeholder="Name or employee ID"
          onChange={(event) => changeFilter("search", event.target.value)} /></label>
        <span>{requests.pagination.total} request{requests.pagination.total === 1 ? "" : "s"}</span>
      </div>
      <section className="leave-panel leave-inbox-panel">
        {loading ? <p className="leave-muted">Loading leave requests…</p> :
          requests.requests.length === 0 ? <div className="leave-empty"><h2>No requests found</h2>
            <p>{filters.status === "Pending" ? "There are no pending leave requests to review." : "No leave requests match these filters."}</p></div> :
            <div className="leave-inbox-list">{requests.requests.map((request) => (
              <article className="leave-inbox-item" key={request._id}>
                <div className="leave-request-title">
                  <div><strong>{request.employeeId?.firstName} {request.employeeId?.lastName}</strong>
                    <span>{request.employeeId?.employeeId} · {request.employeeId?.departmentId?.name || "No department"}</span></div>
                  <RequestStatus status={request.status} />
                </div>
                <div className="leave-inbox-meta">
                  <span>{request.leaveTypeId?.name || "Leave"}</span>
                  <span>{displayDate(request.startDate)} – {displayDate(request.endDate)}</span>
                  <span>{request.requestedDays} working days</span>
                </div>
                <p className="leave-reason">{request.reason}</p>
                {request.reviewedAt && <p className="leave-hint">Reviewed {new Date(request.reviewedAt).toLocaleString()} by {request.reviewedBy?.name || request.reviewedBy?.email || "reviewer"}{request.reviewComment ? ` · ${request.reviewComment}` : ""}</p>}
                {request.status === "Pending" && <div className="leave-review-actions">
                  <label><span>Review comment (required to reject)</span><textarea maxLength={1000}
                    value={comments[request._id] || ""}
                    onChange={(event) => setComments((current) => ({ ...current, [request._id]: event.target.value }))} /></label>
                  <div><button className="primary-button" type="button" disabled={Boolean(reviewing)}
                    onClick={() => review(request._id, "Approved")}>{reviewing === request._id ? "Saving…" : "Approve"}</button>
                    <button className="leave-reject-button" type="button" disabled={Boolean(reviewing)}
                      onClick={() => review(request._id, "Rejected")}>Reject</button></div>
                </div>}
              </article>
            ))}</div>}
        {requests.pagination.pages > 1 && <div className="leave-pagination">
          <button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {requests.pagination.pages}</span>
          <button disabled={page >= requests.pagination.pages || loading} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
      </section>
    </section>
  );
}
