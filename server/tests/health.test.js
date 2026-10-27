import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../app.js";

let server;
let baseUrl;

before(async () => {
  const app = createApp({
    frontendUrl: "https://hc-mlite.vercel.app",
    jwtSecret: "test-only-secret-that-is-long-enough"
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("GET /api/health responds with the healthy API status", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, status: "ok" });
});

test("CORS permits the production frontend origin", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://hc-mlite.vercel.app" }
  });
  assert.equal(response.headers.get("access-control-allow-origin"), "https://hc-mlite.vercel.app");
});

test("GET / describes the API and points to its health endpoint", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    service: "HCM Lite API",
    status: "ok",
    health: "/api/health"
  });
});

test("unknown routes use the consistent API error shape", async () => {
  const response = await fetch(`${baseUrl}/api/not-found`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    success: false,
    error: { code: "NOT_FOUND", message: "The requested resource was not found" }
  });
});
