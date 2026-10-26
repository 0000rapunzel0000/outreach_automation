import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getBoss, JOBS, queue, stopBoss } from "@/lib/queue";

// The real pg-boss adapter against the test database (the other suites use MemoryQueue).
// Each test file has its own module registry, so queue() here is the default PgBossQueue.
describe("pg-boss queue adapter", () => {
  beforeAll(async () => {
    await getBoss("worker"); // migrates the pgboss schema and creates the queues
  });
  afterAll(async () => {
    await stopBoss();
  });

  it("accepts sends with optional fields left undefined", async () => {
    const id = await queue().send(JOBS.deliverNotification, { notificationId: "x" }, { startAfter: undefined, priority: undefined, retryLimit: undefined });
    expect(id).toBeTruthy();
  });

  it("singleton rungs dedupe, and cancelByPrefix cancels them", async () => {
    const at = new Date(Date.now() + 3600_000);
    const prefix = `incident:test-${Date.now()}:`;
    const a = await queue().send(JOBS.nudge, { incidentId: "i", rung: 2 }, { startAfter: at, singletonKey: `${prefix}rung2` });
    const b = await queue().send(JOBS.nudge, { incidentId: "i", rung: 2 }, { startAfter: at, singletonKey: `${prefix}rung2` });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    expect(await queue().cancelByPrefix(prefix)).toBe(1);
    const rows = await db.$queryRaw<{ state: string }[]>`SELECT state::text FROM pgboss.job WHERE singleton_key = ${`${prefix}rung2`}`;
    expect(rows.map((r) => r.state)).toEqual(["cancelled"]);
  });
});
