import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getCompanySetupStatus,
  getCompanySettings,
  getOrganizationMembers,
  getOrganizationRecords,
  initializeCompanySetup,
  saveCompanySettings,
  saveOrganizationRecord,
  setOrganizationRecordActive
} from "../api.js";
import "./OrganizationSettings.css";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const resourceConfigurations = {
  departments: {
    title: "Departments",
    singular: "department",
    description: "Organize people into company departments.",
    searchLabel: "Search departments",
    fields: [
      { name: "name", label: "Department name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      { name: "departmentHeadId", label: "Department head", type: "member", optional: true }
    ]
  },
  designations: {
    title: "Designations",
    singular: "designation",
    description: "Define job titles and their associated departments.",
    searchLabel: "Search designations",
    fields: [
      { name: "name", label: "Designation name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      { name: "departmentId", label: "Department", type: "department", optional: true }
    ]
  },
  "leave-types": {
    title: "Leave types",
    singular: "leave type",
    description: "Set annual leave quotas and paid status for future leave workflows.",
    searchLabel: "Search leave types",
    fields: [
      { name: "name", label: "Leave type name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      { name: "annualQuota", label: "Annual quota (days)", type: "number", required: true, min: 0, step: 0.5 },
      { name: "paid", label: "Paid leave", type: "checkbox" }
    ]
  },
  holidays: {
    title: "Company holidays",
    singular: "holiday",
    description: "Maintain company holidays using local calendar dates in the configured time zone.",
    searchLabel: "Search holidays",
    fields: [
      { name: "name", label: "Holiday name", type: "text", required: true },
      { name: "date", label: "Date", type: "date", required: true },
      { name: "description", label: "Notes", type: "textarea" },
      { name: "recurringAnnually", label: "Repeats annually", type: "checkbox" }
    ]
  }
};

function requestError(error) {
  return error.response?.data?.error?.message ||
    (error.response
      ? "The request could not be completed. Check your entries and try again."
      : "Cannot reach the HCM Lite API. Check that the server is running.");
}

function emptyDraft(config) {
  return Object.fromEntries(config.fields.map((field) => [
    field.name,
    field.type === "checkbox" ? false : field.name === "annualQuota" ? 0 : ""
  ]));
}

function draftFromRecord(config, record) {
  return Object.fromEntries(config.fields.map((field) => [
    field.name,
    record[field.name] == null
      ? (field.type === "checkbox" ? false : "")
      : field.type === "checkbox"
        ? Boolean(record[field.name])
        : String(record[field.name])
  ]));
}

function ResourceManager({ resource }) {
  const config = resourceConfigurations[resource];
  const [records, setRecords] = useState([]);
  const [members, setMembers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [draft, setDraft] = useState(() => emptyDraft(config));
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadRecords() {
    setLoading(true);
    setError("");
    try {
      const [items, companyMembers, companyDepartments] = await Promise.all([
        getOrganizationRecords(resource),
        resource === "departments" ? getOrganizationMembers() : Promise.resolve([]),
        resource === "designations" ? getOrganizationRecords("departments") : Promise.resolve([])
      ]);
      setRecords(items);
      setMembers(companyMembers);
      setDepartments(companyDepartments);
    } catch (loadError) {
      setError(requestError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRecords();
  }, [resource]);

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return records.filter((record) =>
      !term || `${record.name} ${record.description || ""}`.toLocaleLowerCase().includes(term)
    );
  }, [records, search]);

  function startEdit(record) {
    setEditingId(record._id);
    setDraft(draftFromRecord(config, record));
    setSuccess("");
    setError("");
  }

  function resetForm() {
    setEditingId("");
    setDraft(emptyDraft(config));
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const values = Object.fromEntries(config.fields.map((field) => {
      let value = draft[field.name];
      if (field.type === "number") value = Number(value);
      if (field.type === "checkbox") value = Boolean(value);
      return [field.name, value];
    }));
    try {
      await saveOrganizationRecord(resource, editingId, values);
      resetForm();
      setSuccess(`${config.singular[0].toUpperCase()}${config.singular.slice(1)} ${editingId ? "updated" : "created"}.`);
      await loadRecords();
    } catch (saveError) {
      setError(requestError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(record) {
    setError("");
    setSuccess("");
    try {
      await setOrganizationRecordActive(resource, record._id, !record.active);
      setSuccess(`${config.singular} ${record.active ? "deactivated" : "activated"}.`);
      await loadRecords();
    } catch (statusError) {
      setError(requestError(statusError));
    }
  }

  function renderField(field) {
    if (field.type === "checkbox") {
      return (
        <label className="org-checkbox" key={field.name}>
          <input
            type="checkbox"
            checked={Boolean(draft[field.name])}
            onChange={(event) => setDraft({ ...draft, [field.name]: event.target.checked })}
          />
          <span>{field.label}</span>
        </label>
      );
    }

    let control;
    if (field.type === "textarea") {
      control = <textarea id={field.name} value={draft[field.name]} maxLength={1000}
        onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })} />;
    } else if (field.type === "member" || field.type === "department") {
      const options = field.type === "member" ? members : departments.filter((item) => item.active);
      control = (
        <select id={field.name} value={draft[field.name]}
          onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })}>
          <option value="">No {field.type === "member" ? "department head" : "department"}</option>
          {options.map((option) => (
            <option key={option._id} value={option._id}>
              {field.type === "member" ? `${option.name} (${option.role})` : option.name}
            </option>
          ))}
        </select>
      );
    } else {
      control = (
        <input
          id={field.name}
          type={field.type}
          value={draft[field.name]}
          required={field.required}
          min={field.min}
          step={field.step}
          maxLength={field.type === "text" ? 120 : undefined}
          onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })}
        />
      );
    }
    return (
      <label className="org-field" htmlFor={field.name} key={field.name}>
        <span>{field.label}{field.optional ? " (optional)" : ""}</span>
        {control}
      </label>
    );
  }

  function details(record) {
    if (resource === "departments") {
      const head = members.find((member) => member._id === record.departmentHeadId);
      return head ? `Head: ${head.name}` : record.description;
    }
    if (resource === "designations") {
      const department = departments.find((item) => item._id === record.departmentId);
      return department?.name || record.description || "No department";
    }
    if (resource === "leave-types") {
      return `${record.annualQuota} days · ${record.paid ? "Paid" : "Unpaid"}`;
    }
    return `${record.date}${record.recurringAnnually ? " · Annual" : ""}`;
  }

  return (
    <section className="organization-page">
      <div className="organization-heading">
        <div>
          <p className="eyebrow">Company setup</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
      </div>
      <div className="organization-grid">
        <form className="organization-panel organization-form" onSubmit={handleSave}>
          <h2>{editingId ? `Edit ${config.singular}` : `Add ${config.singular}`}</h2>
          {config.fields.map(renderField)}
          {error && <p className="org-feedback org-error" role="alert">{error}</p>}
          {success && <p className="org-feedback org-success" role="status">{success}</p>}
          <div className="org-form-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : `Create ${config.singular}`}
            </button>
            {editingId && <button className="org-secondary-button" type="button" onClick={resetForm}>Cancel</button>}
          </div>
        </form>
        <section className="organization-panel organization-list">
          <div className="org-list-heading">
            <h2>All {config.title.toLowerCase()}</h2>
            <span>{records.length}</span>
          </div>
          <label className="org-search">
            <span className="visually-hidden">{config.searchLabel}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder={config.searchLabel} />
          </label>
          {loading ? <p className="org-muted">Loading {config.title.toLowerCase()}…</p> :
            filteredRecords.length === 0 ? (
              <p className="org-muted">{records.length ? "No matching records." : `No ${config.title.toLowerCase()} yet.`}</p>
            ) : (
              <div className="org-record-list">
                {filteredRecords.map((record) => (
                  <article className={`org-record ${record.active ? "" : "org-record-inactive"}`} key={record._id}>
                    <div>
                      <strong>{record.name}</strong>
                      <span>{details(record) || "—"}</span>
                    </div>
                    <div className="org-record-actions">
                      <span className={`org-status ${record.active ? "is-active" : "is-inactive"}`}>
                        {record.active ? "Active" : "Inactive"}
                      </span>
                      <button type="button" className="org-link-button" onClick={() => startEdit(record)}>Edit</button>
                      <button type="button" className="org-link-button"
                        onClick={() => toggleActive(record)}>
                        {record.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
        </section>
      </div>
    </section>
  );
}

function CompanySettings() {
  const [settings, setSettings] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let current = true;
    async function loadSettings() {
      try {
        const status = await getCompanySetupStatus();
        if (!current) return;
        setSetupStatus(status);
        if (status.status === "ready") {
          const company = await getCompanySettings();
          if (current) setSettings(company);
        } else if (status.status === "uninitialized") {
          setSettings({
            name: "",
            logoUrl: "",
            email: "",
            phone: "",
            address: {},
            timeZone: "UTC",
            workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            openingTime: "09:00",
            closingTime: "17:00"
          });
        }
      } catch (loadError) {
        if (current) setError(requestError(loadError));
      }
      if (current) setLoading(false);
    }
    loadSettings();
    return () => { current = false; };
  }, []);

  if (loading) return <section className="organization-page"><p className="org-muted">Loading company settings…</p></section>;
  if (setupStatus?.status === "assignment-required") {
    return (
      <section className="organization-page">
        <p className="eyebrow">Company setup</p>
        <h1>Confirm company assignment</h1>
        <div className="organization-panel company-settings-form">
          <p>Your Admin account is not assigned to a company. A single existing company was found:</p>
          <strong>{setupStatus.company.name}</strong>
          <p>Confirm only if this is the company your account should manage.</p>
          {error && <p className="org-feedback org-error" role="alert">{error}</p>}
          {success && <p className="org-feedback org-success" role="status">{success}</p>}
          <button className="primary-button" type="button" disabled={saving} onClick={handleAssignExisting}>
            {saving ? "Assigning…" : `Assign Admin to ${setupStatus.company.name}`}
          </button>
        </div>
      </section>
    );
  }
  if (setupStatus?.status === "ambiguous") {
    return (
      <section className="organization-page">
        <p className="eyebrow">Company setup</p>
        <h1>Company assignment needs review</h1>
        <p className="org-feedback org-error" role="alert">
          Multiple companies exist and this Admin is unassigned. For safety, ask an administrator to assign this account to the intended company.
        </p>
      </section>
    );
  }
  if (!settings) {
    return (
      <section className="organization-page">
        <p className="eyebrow">Company setup</p>
        <h1>Company settings</h1>
        <p className="org-feedback org-error" role="alert">{error || "Company settings could not be loaded."}</p>
      </section>
    );
  }

  function change(name, value) {
    setSettings({ ...settings, [name]: value });
  }

  function changeAddress(name, value) {
    setSettings({ ...settings, address: { ...settings.address, [name]: value } });
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const values = {
        name: settings.name,
        logoUrl: settings.logoUrl || "",
        email: settings.email || "",
        phone: settings.phone || "",
        address: settings.address,
        timeZone: settings.timeZone,
        workingDays: settings.workingDays,
        openingTime: settings.openingTime,
        closingTime: settings.closingTime
      };
      const saved = setupStatus?.status === "uninitialized"
        ? await initializeCompanySetup({ action: "create", settings: values })
        : await saveCompanySettings(values);
      setSettings(saved);
      setSetupStatus({ status: "ready" });
      setSuccess(setupStatus?.status === "uninitialized"
        ? "Company created and this Admin account was assigned."
        : "Company settings saved.");
    } catch (saveError) {
      setError(requestError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignExisting() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const company = await initializeCompanySetup({
        action: "assign",
        companyId: setupStatus.company.id
      });
      setSettings(company);
      setSetupStatus({ status: "ready" });
      setSuccess(`Your Admin account is assigned to ${company.name}.`);
    } catch (assignError) {
      setError(requestError(assignError));
    } finally {
      setSaving(false);
    }
  }

  function textField(name, label, type = "text", required = false) {
    return (
      <label className="org-field" htmlFor={`company-${name}`} key={name}>
        <span>{label}</span>
        <input id={`company-${name}`} type={type} value={settings[name] || ""}
          required={required} maxLength={type === "url" ? 2048 : undefined}
          onChange={(event) => change(name, event.target.value)} />
      </label>
    );
  }

  return (
    <section className="organization-page">
      <div className="organization-heading">
        <div>
          <p className="eyebrow">Company setup</p>
          <h1>Company settings</h1>
          <p>{setupStatus?.status === "uninitialized"
            ? "Create the initial company and associate your Admin account to begin setup."
            : "Manage company identity, working hours, and the calendar time zone."}</p>
        </div>
      </div>
      <form className="organization-panel company-settings-form" onSubmit={handleSave}>
        <h2>Company profile</h2>
        <div className="org-form-grid">
          {textField("name", "Company name", "text", true)}
          {textField("email", "Company email", "email")}
          {textField("phone", "Company phone", "tel")}
          {textField("logoUrl", "Logo URL (HTTPS)", "url")}
          {textField("timeZone", "IANA time zone", "text", true)}
        </div>
        <h2>Address</h2>
        <div className="org-form-grid">
          {["line1", "line2", "city", "region", "postalCode", "country"].map((field) => (
            <label className="org-field" htmlFor={`address-${field}`} key={field}>
              <span>{{ line1: "Address line 1", line2: "Address line 2", city: "City", region: "State / region", postalCode: "Postal code", country: "Country" }[field]}</span>
              <input id={`address-${field}`} value={settings.address?.[field] || ""}
                maxLength={field.startsWith("line") ? 160 : 100}
                onChange={(event) => changeAddress(field, event.target.value)} />
            </label>
          ))}
        </div>
        <h2>Working schedule</h2>
        <div className="org-form-grid">
          <label className="org-field" htmlFor="opening-time"><span>Opening time</span>
            <input id="opening-time" type="time" required value={settings.openingTime}
              onChange={(event) => change("openingTime", event.target.value)} /></label>
          <label className="org-field" htmlFor="closing-time"><span>Closing time</span>
            <input id="closing-time" type="time" required value={settings.closingTime}
              onChange={(event) => change("closingTime", event.target.value)} /></label>
        </div>
        <fieldset className="org-weekdays">
          <legend>Standard working days</legend>
          <div>{weekdays.map((day) => (
            <label key={day}>
              <input type="checkbox" checked={settings.workingDays.includes(day)}
                onChange={(event) => change("workingDays", event.target.checked
                  ? [...settings.workingDays, day]
                  : settings.workingDays.filter((item) => item !== day))} />
              <span>{day.slice(0, 3)}</span>
            </label>
          ))}</div>
        </fieldset>
        {error && <p className="org-feedback org-error" role="alert">{error}</p>}
        {success && <p className="org-feedback org-success" role="status">{success}</p>}
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? "Saving…" : setupStatus?.status === "uninitialized"
            ? "Create company and assign Admin"
            : "Save company settings"}
        </button>
      </form>
    </section>
  );
}

export default function OrganizationSettings({ section }) {
  return (
    <div className="organization-shell">
      <nav className="organization-nav" aria-label="Company configuration">
        <Link to="/admin/company">Company</Link>
        <Link to="/admin/departments">Departments</Link>
        <Link to="/admin/designations">Designations</Link>
        <Link to="/admin/leave-types">Leave types</Link>
        <Link to="/admin/holidays">Holidays</Link>
      </nav>
      {section === "company"
        ? <CompanySettings />
        : <ResourceManager resource={section} />}
    </div>
  );
}
