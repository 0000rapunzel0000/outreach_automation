import { execSync } from "node:child_process";
import { TEST_DB } from "./env";

export default function setup() {
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: "pipe" });
}
