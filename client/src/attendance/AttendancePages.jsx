import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  checkInToAttendance,
  checkOutFromAttendance,
  correctAttendanceRecord,
  getAttendanceRecords,
  getAttendanceSummary,
  getEmployeeOptions,
  getMyAttendanceHistory,
  getMyAttendanceToday
} from "../api.js";
import "./AttendancePages.css";

const statuses = ["Present", "Late", "Incomplete"];

function requestError(error) {
  return error.response?.data?.error?.message ||
    (error.response
      ? "The request could not be completed. Please review the information and try again."
      : "Cannot reach the HCM Lite API. Check that the server is running.");
}

function formattedDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formattedTime(value, timeZone) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone
  }).format(new Date(value));
}

function formattedDateTime(value, timeZone) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone
  }).format(new Date(value));
}

function formattedMinutes(value) {
  const minutes = Number(value) || 0;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function AttendanceStatus({ status }) {
  return <span className={`attendance-status attendance-status-${status.toLowerCase()}`}>{status}</span>;
}

export function EmployeeAttendancePage() {
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState({ records: [], pagination: { page: 1, pages: 0, total: 0 } });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [current, past] = await Promise.all([
        getMyAttendanceToday(),
        getMyAttendanceHistory({ page, limit: 10 })
      ]);
      setToday(current);
      setHistory(past);
    } catch (loadError) {
      setError(requestError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [page]);

  async function recordAction(action) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = action === "check-in"
        ? await checkInToAttendance()
        : await checkOutFromAttendance();
      setSuccess(result.message);
      await load();
    } catch (actionError) {
      setError(requestError(actionError));
      if (actionError.response?.status === 409) {
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  const attendance = today?.attendance;
  const hasOpenCheckIn = Boolean(attendance && !attendance.checkOutAt);
  const checkInDisabled = Boolean(attendance) || !today?.workingDay || today?.holiday;

  return (
    <section className="attendance-page">
      <div className="attendance-heading">
        <div><p className="eyebrow">People</p><h1>My attendance</h1>
          <p>Your attendance record is based on server time in your company time zone.</p></div>
      </div>
      {error && <p className="attendance-feedback attendance-error" role="alert">{error}</p>}
      {success && <p className="attendance-feedback attendance-success" role="status">{success}</p>}
      {loading && !today ? <p className="attendance-muted">Loading today's attendance…</p> : today && (
        <div className="attendance-self-layout">
          <section className="attendance-panel attendance-punch-card">
            <div className="attendance-panel-heading">
              <div><p className="eyebrow">Today · {today.timeZone}</p><h2>{formattedDate(today.workDate)}</h2></div>
              {attendance && <AttendanceStatus status={attendance.status} />}
            </div>
            <p className="attendance-work-hours">Office hours: {today.officeStartTime}–{today.officeEndTime}</p>
            {today.holiday
              ? <p className="attendance-notice">Today is a company holiday. Check-in is unavailable.</p>
              : !today.workingDay
                ? <p className="attendance-notice">Today is not a configured working day.</p>
                : attendance
                  ? <div className="attendance-punch-times">
                    <div><span>Check-in</span><strong>{formattedTime(attendance.checkInAt, today.timeZone)}</strong></div>
                    <div><span>Check-out</span><strong>{formattedTime(attendance.checkOutAt, today.timeZone)}</strong></div>
                    {attendance.checkOutAt && <div><span>Recorded work</span><strong>{formattedMinutes(attendance.workingDurationMinutes)}</strong></div>}
                  </div>
                  : <p className="attendance-notice">No check-in recorded for today.</p>}
            {today.workingDay && !today.holiday && (
              <button className="primary-button attendance-punch-button" type="button"
                disabled={saving || loading || (checkInDisabled && !hasOpenCheckIn)}
                onClick={() => recordAction(hasOpenCheckIn ? "check-out" : "check-in")}>
                {saving ? "Recording…" : hasOpenCheckIn ? "Check out" : attendance ? "Attendance complete" : "Check in"}
              </button>
            )}
            {attendance?.checkOutAt && <p className="attendance-complete">Attendance for today is complete.</p>}
          </section>
          <section className="attendance-panel attendance-history-panel">
            <div className="attendance-panel-heading"><div><p className="eyebrow">Your records</p><h2>Attendance history</h2></div>
              <span>{history.pagination.total} records</span></div>
            {loading ? <p className="attendance-muted">Loading history…</p> : history.records.length === 0
              ? <p className="attendance-muted">No attendance records yet.</p>
              : <div className="attendance-table-wrap">
                <table className="attendance-table">
                  <thead><tr><th>Date</th><th>Check-in</th><th>Check-out</th><th>Work time</th><th>Status</th></tr></thead>
                  <tbody>{history.records.map((record) => (
                    <tr key={record._id}>
                      <td>{formattedDate(record.workDate)}</td>
                      <td>{formattedTime(record.checkInAt, today?.timeZone)}</td>
                      <td>{formattedTime(record.checkOutAt, today?.timeZone)}</td>
                      <td>{formattedMinutes(record.workingDurationMinutes)}</td>
                      <td><AttendanceStatus status={record.status} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>}
            {history.pagination.pages > 1 && <div className="attendance-pagination">
              <button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {page} of {history.pagination.pages}</span>
              <button disabled={page >= history.pagination.pages || loading} onClick={() => setPage(page + 1)}>Next</button>
            </div>}
          </section>
        </div>
      )}
    </section>
  );
}

const blankCorrection = { checkInAt: "", checkOutAt: "", reason: "" };

function AttendanceCorrectionForm({ record, timeZone, onCancel, onSave }) {
  const [draft, setDraft] = useState({
    checkInAt: record.checkInAt ? new Date(record.checkInAt).toISOString() : "",
    checkOutAt: record.checkOutAt ? new Date(record.checkOutAt).toISOString() : "",
    reason: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const updated = await correctAttendanceRecord(record._id, {
        checkInAt: draft.checkInAt.trim(),
        checkOutAt: draft.checkOutAt.trim() || null,
        reason: draft.reason
      });
      await onSave(updated);
    } catch (saveError) {
      setError(requestError(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="attendance-correction" onSubmit={submit}>
      <h3>Correct attendance · {record.employeeId?.firstName} {record.employeeId?.lastName}</h3>
      <p>Enter ISO 8601 timestamps with an offset or Z. The record date is {record.workDate} ({timeZone}); timestamps must remain on that local date.</p>
      <label><span>Check-in timestamp</span><input required value={draft.checkInAt}
        placeholder="2026-10-25T09:00:00+05:00"
        onChange={(event) => setDraft({ ...draft, checkInAt: event.target.value })} /></label>
      <label><span>Check-out timestamp (blank means still open)</span><input value={draft.checkOutAt}
        placeholder="2026-10-25T17:00:00+05:00"
        onChange={(event) => setDraft({ ...draft, checkOutAt: event.target.value })} /></label>
      <label><span>Reason for correction</span><textarea required maxLength={500} value={draft.reason}
        onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      {error && <p className="attendance-feedback attendance-error" role="alert">{error}</p>}
      <div className="attendance-actions">
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save correction"}</button>
        <button className="attendance-secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function AttendanceDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
    departmentId: "",
    status: "",
    search: ""
  });
  const [options, setOptions] = useState({ departments: [] });
  const [records, setRecords] = useState({ records: [], pagination: { page: 1, pages: 0, total: 0 } });
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [correction, setCorrection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    getEmployeeOptions()
      .then((result) => { if (active) setOptions(result); })
      .catch((loadError) => { if (active) setError(requestError(loadError)); });
    return () => { active = false; };
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    const params = {
      page,
      limit: 10,
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search.trim() ? { search: filters.search.trim() } : {})
    };
    const summaryParams = {
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {})
    };
    try {
      const [recordsResult, summaryResult] = await Promise.all([
        getAttendanceRecords(params),
        getAttendanceSummary(summaryParams)
      ]);
      setRecords(recordsResult);
      setSummary(summaryResult);
      if (!filters.from && !filters.to) {
        setSearchParams({}, { replace: true });
      }
    } catch (loadError) {
      setError(requestError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [page, filters]);

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setSuccess("");
  }

  async function saveCorrection() {
    setCorrection(null);
    setSuccess("Attendance correction saved and audit history recorded.");
    await load();
  }

  const cards = summary ? [
    ["Present", summary.summary.Present],
    ["Late", summary.summary.Late],
    ["Absent", summary.summary.Absent],
    ["Incomplete", summary.summary.Incomplete]
  ] : [];

  return (
    <section className="attendance-page">
      <div className="attendance-heading">
        <div><p className="eyebrow">People operations</p><h1>Attendance dashboard</h1>
          <p>Company attendance, working-day summaries, and audited corrections.</p></div>
        <span className="attendance-timezone">{summary?.timeZone || "Company time zone"}</span>
      </div>
      {error && <p className="attendance-feedback attendance-error" role="alert">{error}</p>}
      {success && <p className="attendance-feedback attendance-success" role="status">{success}</p>}
      <div className="attendance-summary-cards">
        {cards.map(([label, value]) => <article className={`attendance-summary-card summary-${label.toLowerCase()}`} key={label}>
          <span>{label}</span><strong>{value}</strong>
        </article>)}
        <article className="attendance-summary-card summary-hours"><span>Recorded work</span>
          <strong>{formattedMinutes(summary?.summary.workingDurationMinutes)}</strong></article>
      </div>
      <div className="attendance-dashboard-filters">
        <label><span>From</span><input type="date" value={filters.from} onChange={(event) => changeFilter("from", event.target.value)} /></label>
        <label><span>To</span><input type="date" value={filters.to} onChange={(event) => changeFilter("to", event.target.value)} /></label>
        <label><span>Department</span><select value={filters.departmentId} onChange={(event) => changeFilter("departmentId", event.target.value)}>
          <option value="">All departments</option>
          {options.departments.map((department) => <option value={department._id} key={department._id}>{department.name}</option>)}
        </select></label>
        <label><span>Status</span><select value={filters.status} onChange={(event) => changeFilter("status", event.target.value)}>
          <option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}
        </select></label>
        <label className="attendance-report-search"><span>Employee</span><input value={filters.search}
          placeholder="Name or employee ID" onChange={(event) => changeFilter("search", event.target.value)} /></label>
      </div>
      {summary && <section className="attendance-panel daily-summary-panel">
        <div className="attendance-panel-heading"><div><p className="eyebrow">Business days only</p><h2>Daily summary</h2></div>
          <span>{formattedDate(summary.from)} – {formattedDate(summary.to)}</span></div>
        {summary.days.length === 0 ? <p className="attendance-muted">No company working days in this range.</p> :
          <div className="attendance-daily-list">{summary.days.map((day) => (
            <article key={day.date}>
              <strong>{formattedDate(day.date)}</strong>
              <span>Present <b>{day.Present}</b></span>
              <span>Late <b>{day.Late}</b></span>
              <span>Absent <b>{day.Absent}</b></span>
              <span>Incomplete <b>{day.Incomplete}</b></span>
            </article>
          ))}</div>}
      </section>}
      <section className="attendance-panel attendance-records-panel">
        <div className="attendance-panel-heading"><div><p className="eyebrow">Records</p><h2>Attendance history</h2></div>
          <span>{records.pagination.total} records</span></div>
        {loading ? <p className="attendance-muted">Loading attendance records…</p> : records.records.length === 0
          ? <p className="attendance-muted">No attendance records match these filters.</p>
          : <div className="attendance-table-wrap">
            <table className="attendance-table attendance-admin-table">
              <thead><tr><th>Employee</th><th>Date</th><th>Check-in</th><th>Check-out</th><th>Duration</th><th>Status</th><th>Corrections</th><th>Actions</th></tr></thead>
              <tbody>{records.records.map((record) => (
                <React.Fragment key={record._id}>
                  <tr>
                    <td><Link to={`/employees/${record.employeeId?._id}`}>{record.employeeId?.firstName} {record.employeeId?.lastName}</Link>
                      <span className="attendance-subline">{record.employeeId?.employeeId} · {record.employeeId?.departmentId?.name || "No department"}</span></td>
                    <td>{formattedDate(record.workDate)}</td>
                    <td>{formattedTime(record.checkInAt, summary?.timeZone)}</td>
                    <td>{formattedTime(record.checkOutAt, summary?.timeZone)}</td>
                    <td>{formattedMinutes(record.workingDurationMinutes)}</td>
                    <td><AttendanceStatus status={record.status} /></td>
                    <td>{record.correctionHistory?.length || 0}</td>
                    <td><button className="attendance-text-button" type="button" onClick={() => setCorrection(
                      correction?._id === record._id ? null : record
                    )}>Correct</button></td>
                  </tr>
                  {record.correctionHistory?.length > 0 && <tr className="attendance-audit-row"><td colSpan="8">
                    <details><summary>Correction audit ({record.correctionHistory.length})</summary>
                      <ul>{record.correctionHistory.map((entry) => (
                        <li key={entry._id || `${entry.correctedAt}-${entry.reason}`}>
                          {formattedDateTime(entry.correctedAt, summary?.timeZone)} ·
                          {" "}{entry.correctedBy?.name || entry.correctedBy?.email || "Authorized user"} · {entry.reason}
                          {" "}· check-in {formattedTime(entry.before.checkInAt, summary?.timeZone)} → {formattedTime(entry.after.checkInAt, summary?.timeZone)}
                          {" "}· check-out {formattedTime(entry.before.checkOutAt, summary?.timeZone)} → {formattedTime(entry.after.checkOutAt, summary?.timeZone)}
                          {" "}· {entry.before.status} → {entry.after.status}
                          {" "}· {formattedMinutes(entry.before.workingDurationMinutes)} → {formattedMinutes(entry.after.workingDurationMinutes)}
                        </li>
                      ))}</ul>
                    </details>
                  </td></tr>}
                  {correction?._id === record._id && <tr><td colSpan="8">
                    <AttendanceCorrectionForm record={record} timeZone={summary?.timeZone || ""}
                      onCancel={() => setCorrection(null)} onSave={saveCorrection} />
                  </td></tr>}
                </React.Fragment>
              ))}</tbody>
            </table>
          </div>}
        {records.pagination.pages > 1 && <div className="attendance-pagination">
          <button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {records.pagination.pages}</span>
          <button disabled={page >= records.pagination.pages || loading} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
      </section>
    </section>
  );
}
