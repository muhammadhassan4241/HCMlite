# HCM Lite

HCM Lite is a lightweight human capital management application. This phase adds login and role-based access control to the React/Vite client and Express/Mongoose API. Dashboard routes are placeholders; employee management and other HR features are out of scope.

## Requirements

- Node.js 20 or newer
- npm
- MongoDB running locally or a MongoDB connection URI

## Environment setup

From the project root, copy the example file to the server environment:

```powershell
Copy-Item .env.example server/.env
```

Configure these values in `server/.env`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string for the HCM Lite database |
| `JWT_SECRET` | Secret used to sign access tokens; use a random value of at least 32 characters |
| `FRONTEND_URL` | Browser origin allowed by CORS, normally `http://localhost:5173` |
| `PORT` | API port, normally `5000` |
| `COMPANY_NAME` | Display name used when setting up the first company |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Temporary seed-script credentials; choose a unique password of at least 12 characters |
| `DEMO_LOGIN_ENABLED` | Set to `true` only for an explicitly enabled local demo; defaults to disabled |
| `DEMO_ADMIN_PASSWORD`, `DEMO_HR_PASSWORD`, `DEMO_EMPLOYEE_PASSWORD` | Server-only demo account passwords; each must be at least 12 characters |

The values in `.env.example` are placeholders. Keep `server/.env` private and never put `JWT_SECRET` or database credentials in client configuration. Client's optional `client/.env` only needs the public API base URL `VITE_API_URL` (example: `http://localhost:5000/api`); copy it from `client/.env.example` only when using a non-default URL.

## Create the initial Admin

The seed script is a one-time administrative command, not a public registration route. Set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the ignored `server/.env`, ensure MongoDB is running, and run:

```powershell
cd server
npm.cmd run seed:admin
```

The script hashes the password with bcrypt and refuses to create an Admin if one already exists. Remove the `ADMIN_PASSWORD` value from the local environment file after seeding. There is no unrestricted Admin registration endpoint.

## Provision and enable local demo accounts

Demo accounts are provisioned only by an explicit seed command. Set the three `DEMO_*_PASSWORD` values in the ignored `server/.env` to unique passwords of at least 12 characters. Keep these values server-side; never put them in `client/.env`, source files, or chat. Then run:

```powershell
cd server
npm.cmd run seed:demo -- --confirm
```

The script creates `demo.admin@hcm-lite.local` (Admin), `demo.hr@hcm-lite.local` (HR), and `demo.employee@hcm-lite.local` (Employee), hashing each password with bcrypt. Existing records at those emails are reported and left unchanged. When `ADMIN_EMAIL` is set, the configured Admin must first be associated with a company; newly created demo users share that company.

Set `DEMO_LOGIN_ENABLED=true` in `server/.env` and restart the API to enable the login-page buttons. Demo login defaults to disabled (`false`). Buttons call a server-side endpoint that selects the fixed demo account by role and verifies its configured password using the same bcrypt-backed authentication and JWT session flow as normal login; no demo password is sent to or bundled in the browser. The API still loads the account role from MongoDB for authorization.

**Do not enable demo login on a public deployment unless you explicitly accept that anyone can obtain sessions for the demo Admin, HR, and Employee accounts.** Use isolated, non-production demo data and keep the flag disabled in production by default.

## Initial company and organization setup

Company settings and organization records are scoped to the authenticated Admin's company. Sign in using the existing Admin account and open **Company setup**. If no company exists, the page offers an explicit first-time setup form that creates the company and associates only the signed-in Admin. If exactly one company already exists, the page requires the Admin to explicitly confirm assignment. Ambiguous multiple-company setups and broken existing assignments are not changed automatically.

The explicit CLI setup remains available. Configure `COMPANY_NAME` and ensure `ADMIN_EMAIL` in `server/.env` matches the existing Admin. From the server directory, run:

```powershell
npm.cmd run setup:company -- --confirm
```

The explicit setup command creates the initial company if none exists and assigns the configured existing Admin. It reuses a sole existing company, refuses ambiguous multi-company setups, and may associate existing demo accounts only when their expected role matches and they have no company assignment. It never changes account credentials or roles. If multiple companies already exist, assign the Admin's `companyId` to the intended company before using this command.

After setup, sign in as that Admin. Company settings, departments, designations, leave types, and holidays are available from the Admin workspace. Records are company-scoped and deactivated rather than deleted. Holiday `YYYY-MM-DD` values are business-calendar dates in the configured company time zone. Leave requests and approval workflows are not included in this phase.

## Employee management

Admin and HR users can open **Employees** from the main navigation to search the company-scoped employee directory, add or edit records, view employee details, and deactivate/reactivate records. Employee IDs are generated by the API and unique within the company. Department and designation selections must be active and belong to the same company.

Employee records do not create login accounts or credentials. Admin and HR may explicitly link an existing active Employee account from the same company; matching by email is never automatic. A linked Employee can view only their own non-inactive profile at **My profile**. Deactivating a linked employee also deactivates that account; reactivation restores it only when the employee module performed the deactivation. Profile photos, when used, are HTTPS URLs because this project has no file-upload/storage service. Attendance, leave requests, and payroll are not included.

## Reset an existing Admin password

Use this only when the existing Admin account needs a password reset. The reset script never creates users and requires an explicit `--confirm` flag. It updates a password only when exactly one Admin matches `RESET_ADMIN_EMAIL`; it will not affect HR or Employee accounts. The new password must be 12–1024 characters.

In PowerShell, from the project root, enter the existing Admin email and new password when prompted, then run the confirmed reset:

```powershell
$env:RESET_ADMIN_EMAIL = Read-Host "Existing Admin email"
$resetPassword = Read-Host "New Admin password" -AsSecureString
$env:RESET_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $resetPassword).Password
cd server
npm.cmd run reset:admin-password -- --confirm
Remove-Item Env:RESET_ADMIN_EMAIL, Env:RESET_ADMIN_PASSWORD
Remove-Variable resetPassword
```

The script reads `MONGODB_URI` from `server/.env` and the reset values from the current PowerShell process environment. It never prints passwords, hashes, JWT secrets, or the MongoDB connection string. Do not run the command until you have set the intended email and new password.

## Run the application

In one terminal, start the API:

```powershell
cd server
npm.cmd install
npm.cmd run dev
```

In another terminal, start the client:

```powershell
cd client
npm.cmd install
npm.cmd run dev
```

Vite prints the client URL. The API health endpoint is `http://localhost:5000/api/health`. If the client URL or API URL changes, keep `FRONTEND_URL` and `VITE_API_URL` aligned with those origins.

## Authentication and roles

- `POST /api/auth/login` accepts an email and password and returns a 15-minute JWT access token with a safe user profile.
- `POST /api/auth/demo-login` accepts only one of the supported demo roles, and is disabled unless `DEMO_LOGIN_ENABLED=true`; demo passwords remain server-side.
- `GET /api/auth/me` requires `Authorization: Bearer <token>` and returns the user's current profile.
- `/api/auth/protected/admin`, `/api/auth/protected/hr`, and `/api/auth/protected/employee` are small protected endpoints demonstrating server-side role checks.
- Authentication verifies the JWT signature and expiration, then loads the account from MongoDB. The current database role and active status—not client-supplied claims—control access. Inactive, suspended, or deleted accounts are rejected.
- The User model stores only `passwordHash`; API profiles never include it. The seed script hashes the initial Admin password.
- The client keeps the bearer token in memory only. This avoids persisting it in `localStorage` or `sessionStorage`, but does not eliminate XSS risks while the app is open: malicious same-origin script could still use an in-memory token. Reloading the page clears the token, so the user must sign in again.
- Logout clears the client-held token. With stateless bearer JWTs there is no server-side token revocation; a copied token can remain usable until its 15-minute expiration, unless the account is disabled. A later session strategy can add revocation if needed.
- Protected client routes and role-aware navigation provide UX only; the API independently enforces identity and role permissions.

## Tests and build

Run all server tests:

```powershell
cd server
npm.cmd test
```

Build the client:

```powershell
cd client
npm.cmd run build
```

Tests cover login and credential validation, demo provisioning and login, disabled demo access, inactive accounts, safe profile responses, missing/malformed/invalid/expired tokens, all three role permissions, and password hashing.
