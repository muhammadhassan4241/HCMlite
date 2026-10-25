import "dotenv/config";
import { createApp } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { loadConfig } from "./config/env.js";
import Attendance from "./models/Attendance.js";
import LeaveRequest from "./models/LeaveRequest.js";

async function startServer() {
  const config = loadConfig();
  await connectDatabase(config.mongoUri);
  await Attendance.createIndexes();
  await LeaveRequest.createIndexes();

  const app = createApp({
    frontendUrl: config.frontendUrl,
    jwtSecret: config.jwtSecret,
    demoLoginEnabled: config.demoLoginEnabled,
    demoPasswords: config.demoPasswords
  });
  app.listen(config.port, () => {
    console.info(`HCM Lite API listening on port ${config.port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start HCM Lite API:", error);
  process.exitCode = 1;
});
