import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

if (existsSync(".env")) process.loadEnvFile(".env"); // test code reads the DB and the seeded admin login

// Needs the dev DB seeded, UNIPILE_FAKE=true and WA_DISABLED=true in .env.
// Starts the web app and the worker itself (or reuses ones already running).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: [
    { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run worker", url: "http://localhost:3000/api/health/worker", reuseExistingServer: true, timeout: 120_000 },
  ],
});
