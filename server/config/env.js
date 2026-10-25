const requiredVariables = ["MONGODB_URI", "JWT_SECRET", "FRONTEND_URL", "PORT"];

export function loadConfig(environment = process.env) {
  const missing = requiredVariables.filter((name) => !environment[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const port = Number(environment.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  if (environment.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }

  let frontendUrl;
  try {
    frontendUrl = new URL(environment.FRONTEND_URL).origin;
  } catch {
    throw new Error("FRONTEND_URL must be a valid URL");
  }

  return {
    mongoUri: environment.MONGODB_URI,
    jwtSecret: environment.JWT_SECRET,
    frontendUrl,
    port,
    demoLoginEnabled: environment.DEMO_LOGIN_ENABLED === "true",
    demoPasswords: {
      Admin: environment.DEMO_ADMIN_PASSWORD,
      HR: environment.DEMO_HR_PASSWORD,
      Employee: environment.DEMO_EMPLOYEE_PASSWORD
    }
  };
}
