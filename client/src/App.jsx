import React, { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getApiHealth } from "./api.js";
import { useAuth } from "./auth/AuthContext.jsx";
import OrganizationSettings from "./admin/OrganizationSettings.jsx";
import { EmployeeDetails, EmployeeDirectory, EmployeeForm } from "./employees/EmployeeManagement.jsx";
import { AttendanceDashboardPage, EmployeeAttendancePage } from "./attendance/AttendancePages.jsx";

const rolePaths = { Admin: "/admin", HR: "/hr", Employee: "/employee" };

function getDemoLoginErrorMessage(requestError) {
  const code = requestError.response?.data?.error?.code;
  const messages = {
    DEMO_LOGIN_DISABLED:
      "Demo login is disabled. Set DEMO_LOGIN_ENABLED=true in server/.env and restart the API for local development.",
    DEMO_CREDENTIALS_NOT_CONFIGURED:
      "Demo passwords are not configured on the server. Set all three DEMO_*_PASSWORD values in server/.env and restart the API.",
    DEMO_ACCOUNT_NOT_PROVISIONED:
      "This demo account has not been provisioned. Run the explicit demo-account seed command from the server directory.",
    INVALID_CREDENTIALS:
      "This demo account is inactive or its configured password does not match. Check local demo setup.",
    NOT_FOUND:
      "The running API does not provide the demo login route. Restart the API and try again."
  };

  if (messages[code]) return messages[code];
  if (!requestError.response) {
    return "Cannot reach the HCM Lite API. Check that the API is running and try again.";
  }
  if (requestError.response.status >= 500) {
    return "The demo login service is temporarily unavailable. Check the API and try again.";
  }
  return requestError.response.data?.error?.message ||
    "Demo login failed. Check the local demo setup and try again.";
}

function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="HCM Lite home">
          <span className="brand-mark">H</span>
          <span>hcm<span className="brand-light">lite</span></span>
        </Link>
        <nav className="authenticated-nav" aria-label="Main navigation">
          {user ? (
            <>
              <Link to={rolePaths[user.role]}>{user.role} workspace</Link>
              {user.role === "Admin" && <Link to="/admin/company">Company setup</Link>}
              {(user.role === "Admin" || user.role === "HR") && <Link to="/employees">Employees</Link>}
              {(user.role === "Admin" || user.role === "HR") && <Link to="/attendance">Attendance</Link>}
              {user.role === "Employee" && <Link to="/employee/attendance">Attendance</Link>}
              {user.role === "Employee" && <Link to="/employees/me">My profile</Link>}
              <span className="nav-user">{user.name}</span>
              <button className="text-button" onClick={handleLogout}>Log out</button>
            </>
          ) : (
            <Link className="sign-in-link" to="/login">Sign in</Link>
          )}
        </nav>
      </header>
      <main>{children}</main>
      <footer className="footer">HCM Lite <span>·</span> People operations, made simpler</footer>
    </div>
  );
}

function HomePage() {
  const [health, setHealth] = useState({ state: "checking", message: "Checking API…" });
  const { user } = useAuth();

  useEffect(() => {
    let active = true;
    getApiHealth()
      .then(() => {
        if (active) setHealth({ state: "online", message: "API connected" });
      })
      .catch(() => {
        if (active) setHealth({ state: "offline", message: "API unavailable" });
      });
    return () => { active = false; };
  }, []);

  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">A clearer way to work</p>
        <h1>People are at the heart of every <span>great team.</span></h1>
        <p className="hero-description">HCM Lite is the simple starting point for bringing your people operations together.</p>
        <Link className="primary-button" to={user ? rolePaths[user.role] : "/login"}>
          {user ? "Open your workspace" : "Sign in"} <span aria-hidden="true">→</span>
        </Link>
        <div className={`health-status health-${health.state}`} role="status">
          <span className="health-dot" />{health.message}
        </div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="art-card">
          <div className="card-heading"><span className="art-avatar">H</span><span className="art-lines"><i /><i /></span></div>
          <div className="art-content"><span /><span /><span /></div>
          <div className="art-footer"><i /><i /><i /></div>
        </div>
        <span className="sparkle sparkle-one">✳</span><span className="sparkle sparkle-two">✦</span>
      </div>
    </section>
  );
}

function LoginPage() {
  const { user, login, loginDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoRoleLoading, setDemoRoleLoading] = useState("");

  if (user) return <Navigate to={rolePaths[user.role]} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !password) {
      setError("Enter a valid email address and password.");
      return;
    }

    setLoading(true);
    try {
      const authenticatedUser = await login(email.trim(), password);
      const requestedPath = location.state?.from;
      navigate(requestedPath || rolePaths[authenticatedUser.role], { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(role) {
    setError("");
    setLoading(true);
    setDemoRoleLoading(role);
    try {
      const authenticatedUser = await loginDemo(role);
      navigate(rolePaths[authenticatedUser.role], { replace: true });
    } catch (requestError) {
      setError(getDemoLoginErrorMessage(requestError));
    } finally {
      setLoading(false);
      setDemoRoleLoading("");
    }
  }

  return (
    <section className="placeholder-card login-card">
      <p className="eyebrow">Welcome to HCM Lite</p>
      <h1>Sign in to your account</h1>
      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="username" value={email}
          onChange={(event) => setEmail(event.target.value)} required disabled={loading} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" value={password}
          onChange={(event) => setPassword(event.target.value)} required disabled={loading} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button login-submit" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="demo-login-section">
        <div className="demo-login-heading">
          <span />
          <h2>Try Demo Accounts</h2>
          <span />
        </div>
        <div className="demo-login-buttons">
          <button
            className="demo-login-button demo-admin"
            type="button"
            onClick={() => handleDemoLogin("Admin")}
            disabled={loading}
          >
            <span className="demo-role-mark">A</span>
            <span>{demoRoleLoading === "Admin" ? "Opening Admin…" : "Demo Admin"}</span>
          </button>
          <button
            className="demo-login-button demo-hr"
            type="button"
            onClick={() => handleDemoLogin("HR")}
            disabled={loading}
          >
            <span className="demo-role-mark">H</span>
            <span>{demoRoleLoading === "HR" ? "Opening HR…" : "Demo HR"}</span>
          </button>
          <button
            className="demo-login-button demo-employee"
            type="button"
            onClick={() => handleDemoLogin("Employee")}
            disabled={loading}
          >
            <span className="demo-role-mark">E</span>
            <span>{demoRoleLoading === "Employee" ? "Opening Employee…" : "Demo Employee"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function RequireAuth({ children, roles }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/access-denied" replace />;
  return children;
}

function DashboardPlaceholder({ role }) {
  const { user } = useAuth();
  return (
    <section className="placeholder-card">
      <p className="eyebrow">{role} workspace</p>
      <h1>Welcome, {user.name}.</h1>
      <p>{role === "Admin"
        ? "Manage company settings and organization configuration."
        : `Your ${role} dashboard will be added in a later phase.`}</p>
      {role === "Admin" && (
        <div className="admin-workspace-links">
          <Link className="primary-button" to="/admin/company">Open company setup</Link>
          <Link className="text-link" to="/employees">Employee directory</Link>
          <Link className="text-link" to="/attendance">Attendance dashboard</Link>
          <Link className="text-link" to="/admin/departments">Manage departments</Link>
          <Link className="text-link" to="/admin/designations">Manage designations</Link>
          <Link className="text-link" to="/admin/leave-types">Configure leave types</Link>
          <Link className="text-link" to="/admin/holidays">Manage holidays</Link>
        </div>
      )}
      {role === "HR" && (
        <div className="admin-workspace-links">
          <Link className="primary-button" to="/employees">Employee directory</Link>
          <Link className="text-link" to="/attendance">Attendance dashboard</Link>
        </div>
      )}
      {role === "Employee" && (
        <div className="admin-workspace-links">
          <Link className="primary-button" to="/employees/me">View my employee profile</Link>
          <Link className="text-link" to="/employee/attendance">Check in or view attendance</Link>
        </div>
      )}
    </section>
  );
}

function AccessDeniedPage() {
  return (
    <section className="placeholder-card">
      <p className="eyebrow">Access denied</p>
      <h1>You don't have permission to view this page.</h1>
      <p>Your account role does not allow access to this workspace.</p>
      <Link className="text-link" to="/">Return home</Link>
    </section>
  );
}

function NotFoundPage() {
  return <section className="placeholder-card"><h1>Page not found</h1><Link className="text-link" to="/">Return home</Link></section>;
}

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<RequireAuth roles={["Admin"]}><DashboardPlaceholder role="Admin" /></RequireAuth>} />
        <Route path="/admin/company" element={<RequireAuth roles={["Admin"]}><OrganizationSettings section="company" /></RequireAuth>} />
        <Route path="/admin/departments" element={<RequireAuth roles={["Admin"]}><OrganizationSettings section="departments" /></RequireAuth>} />
        <Route path="/admin/designations" element={<RequireAuth roles={["Admin"]}><OrganizationSettings section="designations" /></RequireAuth>} />
        <Route path="/admin/leave-types" element={<RequireAuth roles={["Admin"]}><OrganizationSettings section="leave-types" /></RequireAuth>} />
        <Route path="/admin/holidays" element={<RequireAuth roles={["Admin"]}><OrganizationSettings section="holidays" /></RequireAuth>} />
        <Route path="/employees" element={<RequireAuth roles={["Admin", "HR"]}><EmployeeDirectory /></RequireAuth>} />
        <Route path="/employees/new" element={<RequireAuth roles={["Admin", "HR"]}><EmployeeForm /></RequireAuth>} />
        <Route path="/employees/me" element={<RequireAuth roles={["Employee"]}><EmployeeDetails ownProfile /></RequireAuth>} />
        <Route path="/employees/:id/edit" element={<RequireAuth roles={["Admin", "HR"]}><EmployeeForm edit /></RequireAuth>} />
        <Route path="/employees/:id" element={<RequireAuth><EmployeeDetails /></RequireAuth>} />
        <Route path="/attendance" element={<RequireAuth roles={["Admin", "HR"]}><AttendanceDashboardPage /></RequireAuth>} />
        <Route path="/employee/attendance" element={<RequireAuth roles={["Employee"]}><EmployeeAttendancePage /></RequireAuth>} />
        <Route path="/hr" element={<RequireAuth roles={["HR"]}><DashboardPlaceholder role="HR" /></RequireAuth>} />
        <Route path="/employee" element={<RequireAuth roles={["Employee"]}><DashboardPlaceholder role="Employee" /></RequireAuth>} />
        <Route path="/access-denied" element={<RequireAuth><AccessDeniedPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppLayout>
  );
}
