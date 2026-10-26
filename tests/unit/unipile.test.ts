import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clock, MIN } from "@/lib/clock";
import type { MemoryQueue } from "@/lib/queue";
import { extractRawStatus, hostedAuthBody } from "@/lib/unipile/client";
import { normalize } from "@/lib/monitoring/normalize";
import { applyStatus } from "@/lib/monitoring/applyStatus";
import { makePerson, sentTemplates, setupWorld } from "../helpers";

describe("hosted-auth request body (developer.unipile.com, 2026-10-26)", () => {
  it("create: providers LINKEDIN, name = personId, our redirect + notify URLs", () => {
    const b = hostedAuthBody({ type: "create", personId: "p_123" });
    expect(b).toMatchObject({
      type: "create",
      providers: ["LINKEDIN"],
      name: "p_123",
      success_redirect_url: "http://localhost:3999/apply/linkedin/done",
      failure_redirect_url: "http://localhost:3999/apply/linkedin?error=1",
    });
    expect(String(b.notify_url)).toMatch(/^http:\/\/localhost:3999\/api\/unipile\/notify\?s=/);
    expect(b).not.toHaveProperty("reconnect_account");
    expect(new Date(String(b.expiresOn)).toISOString()).toBe(b.expiresOn);
  });

  it("reconnect: reconnect_account set and no providers (the reconnection schema has none)", () => {
    const b = hostedAuthBody({ type: "reconnect", personId: "p_123", reconnectAccountId: "acc_9" });
    expect(b).toMatchObject({ type: "reconnect", reconnect_account: "acc_9", success_redirect_url: "http://localhost:3999/portal?reconnected=1" });
    expect(b).not.toHaveProperty("providers");
  });

  it("reconnect without an account id is a programming error", () => {
    expect(() => hostedAuthBody({ type: "reconnect", personId: "p" })).toThrow();
  });
});

describe("account wire shape", () => {
  it("reads status from sources[].status, worst first", () => {
    expect(extractRawStatus({ id: "a", type: "LINKEDIN", sources: [{ status: "OK" }] })).toBe("OK");
    expect(extractRawStatus({ id: "a", type: "LINKEDIN", sources: [{ status: "OK" }, { status: "CREDENTIALS" }] })).toBe("CREDENTIALS");
    expect(extractRawStatus({ id: "a", type: "LINKEDIN", sources: [] })).toBe("UNKNOWN");
  });

  it("PERMISSIONS (documented by Unipile, not in the spec) needs the user", () => {
    expect(normalize("PERMISSIONS")).toBe("NEEDS_RECONNECT");
  });
});

describe("unknown statuses don't get stuck", () => {
  let q: MemoryQueue;
  beforeEach(async () => {
    ({ q } = await setupWorld());
  });

  it("an unknown status still present after the grace period is promoted and nudged", async () => {
    const { person, acct } = await makePerson();
    await db.fakeUnipileAccount.update({ where: { id: acct.unipileAccountId }, data: { status: "SOMETHING_NEW" } });
    await applyStatus(acct.id, "SOMETHING_NEW", "webhook");
    expect((await db.linkedInAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("TRANSIENT_ERROR");
    clock.advance(10 * MIN);
    await q.runDue();
    expect((await db.linkedInAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("NEEDS_RECONNECT");
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
  });
});
