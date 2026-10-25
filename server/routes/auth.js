import { Router } from "express";
import User from "../models/User.js";
import { authenticateToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { createAccessToken } from "../utils/jwt.js";
import { verifyPassword } from "../utils/password.js";

const applicationRoles = ["Admin", "HR", "Employee"];
const demoAccounts = {
  Admin: { email: "demo.admin@hcm-lite.local", passwordKey: "Admin" },
  HR: { email: "demo.hr@hcm-lite.local", passwordKey: "HR" },
  Employee: { email: "demo.employee@hcm-lite.local", passwordKey: "Employee" }
};

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    companyId: user.companyId ?? null
  };
}

export function createAuthRouter({
  jwtSecret,
  userModel = User,
  demoLoginEnabled = false,
  demoPasswords = {}
}) {
  const router = Router();
  const authenticate = authenticateToken(jwtSecret, userModel);

  async function createSession(
    res,
    next,
    {
      email,
      password,
      expectedRole,
      missingAccount,
      invalidCredentialsMessage = "Email or password is incorrect"
    }
  ) {
    try {
      const query = expectedRole ? { email, role: expectedRole } : { email };
      const user = await userModel.findOne(query).select("+passwordHash");
      const passwordMatches = user
        ? await verifyPassword(password, user.passwordHash)
        : false;

      if (!user && missingAccount) {
        return res.status(missingAccount.status).json({
          success: false,
          error: {
            code: missingAccount.code,
            message: missingAccount.message
          }
        });
      }

      if (!user || !passwordMatches || user.status !== "active" ||
        (expectedRole && user.role !== expectedRole)) {
        return res.status(401).json({
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: invalidCredentialsMessage }
        });
      }

      const accessToken = createAccessToken(user, jwtSecret);
      return res.json({ success: true, data: { accessToken, user: publicUser(user) } });
    } catch (error) {
      return next(error);
    }
  }

  router.post("/login", async (req, res, next) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body?.password;

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" ||
      password.length === 0 ||
      password.length > 1024
    ) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "A valid email and password are required" }
      });
    }

    return createSession(res, next, { email, password });
  });

  router.post("/demo-login", async (req, res, next) => {
    if (!demoLoginEnabled) {
      return res.status(404).json({
        success: false,
        error: {
          code: "DEMO_LOGIN_DISABLED",
          message: "Demo login is disabled by server configuration"
        }
      });
    }

    const role = req.body?.role;
    const demoAccount = typeof role === "string" && Object.hasOwn(demoAccounts, role)
      ? demoAccounts[role]
      : null;
    const password = demoAccount && demoPasswords[demoAccount.passwordKey];
    if (!demoAccount) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_DEMO_ROLE", message: "A valid demo role is required" }
      });
    }
    if (typeof password !== "string" || password.length === 0) {
      return res.status(503).json({
        success: false,
        error: {
          code: "DEMO_CREDENTIALS_NOT_CONFIGURED",
          message: "Demo credentials are not configured on the server"
        }
      });
    }

    return createSession(res, next, {
      email: demoAccount.email,
      password,
      expectedRole: role,
      missingAccount: {
        status: 404,
        code: "DEMO_ACCOUNT_NOT_PROVISIONED",
        message: "The requested demo account has not been provisioned"
      },
      invalidCredentialsMessage: "Demo login is unavailable. Please check the demo account setup."
    });
  });

  router.get("/me", authenticate, (req, res) => {
    res.json({ success: true, data: { user: publicUser(req.user) } });
  });

  router.get("/protected/admin", authenticate, authorizeRoles("Admin"), (req, res) => {
    res.json({ success: true, data: { permittedRole: "Admin" } });
  });
  router.get("/protected/hr", authenticate, authorizeRoles("HR"), (req, res) => {
    res.json({ success: true, data: { permittedRole: "HR" } });
  });
  router.get("/protected/employee", authenticate, authorizeRoles("Employee"), (req, res) => {
    res.json({ success: true, data: { permittedRole: "Employee" } });
  });

  return router;
}

export { applicationRoles };
