import Link from "next/link";
import type { LinkStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fmtDuration, fmtIst, now } from "@/lib/clock";
import { getState } from "@/lib/settings";
import { currentIstMonth, monthlyUptime } from "@/lib/monitoring/uptime";
import { LinkBadge, PersonBadge } from "../../ui";
import { AutoRefresh } from "../AutoRefresh";
import { resolveFlag } from "../actions";

export const dynamic = "force-dynamic";

const RANK: Record<LinkStatus | "NONE", number> = { NEEDS_RECONNECT: 1, DELETED: 1, TRANSIENT_ERROR: 2, CONNECTING: 3, NONE: 3, CONNECTED: 4 };

export default async function TeamBoard() {
  await requireAdmin();
  const people = await db.person.findMany({
    where: { status: { in: ["ACTIVE", "SUSPENDED"] } },
    include: { linkedin: true, incidents: { where: { resolvedAt: null }, take: 1 } },
  });
  const { year, month } = currentIstMonth();
  const rows = await Promise.all(
    people.map(async (p) => {
      const open = p.incidents[0] ?? null;
      return { p, open, up: await monthlyUptime(p.id, year, month) };
    }),
  );
  // Worst first: escalated -> needs reconnect -> transient -> connected.
  rows.sort((a, b) => {
    const ea = a.open?.escalatedAt ? 0 : RANK[a.p.linkedin?.status ?? "NONE"];
    const eb = b.open?.escalatedAt ? 0 : RANK[b.p.linkedin?.status ?? "NONE"];
    if (ea !== eb) return ea - eb;
    return (a.open?.startedAt.getTime() ?? Infinity) - (b.open?.startedAt.getTime() ?? Infinity);
  });

  const connected = rows.filter((r) => r.p.linkedin?.status === "CONNECTED").length;
  const escalated = rows.filter((r) => r.open?.escalatedAt).length;
  const orphans = await getState<{ count: number }>("unipile.orphans");
  const wa = await getState<{ status: string; at: string }>("wa.status");
  const heartbeat = await getState<string>("worker.heartbeat");
  const flags = await db.adminFlag.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 20 });
  const pending = await db.person.count({ where: { status: "PENDING_REVIEW" } });
  const workerStale = !heartbeat || now().getTime() - new Date(heartbeat).getTime() > 30 * 60_000;

  return (
    <>
      <AutoRefresh seconds={30} />
      <div className="row">
        <h1 style={{ margin: 0 }}>Team status</h1>
        <span className="spacer" />
        <span className="muted small">Refreshes every 30 s · {fmtIst(now())}</span>
      </div>

      <div className="counters" style={{ marginTop: 16 }}>
        <div className="counter">
          <div className="n">{connected}</div>
          <div className="l">Connected</div>
        </div>
        <div className="counter">
          <div className="n">{rows.length - connected}</div>
          <div className="l">Disconnected</div>
        </div>
        <div className="counter">
          <div className="n">{escalated}</div>
          <div className="l">Escalated</div>
        </div>
        <div className="counter">
          <div className="n">{orphans?.count ?? "—"}</div>
          <div className="l">Orphan Unipile accounts</div>
        </div>
        <div className="counter">
          <div className="n" style={{ fontSize: "1.1rem", paddingTop: 6 }}>{wa?.status ?? "unknown"}</div>
          <div className="l">WhatsApp sender</div>
        </div>
      </div>

      {workerStale && <div className="alert error">The worker hasn&apos;t checked in for over 30 minutes. Nudges and the reconciler aren&apos;t running.</div>}
      {pending > 0 && (
        <div className="alert info">
          {pending} application{pending > 1 ? "s" : ""} waiting for review. <Link href="/admin/applications">Review now</Link>
        </div>
      )}
      {flags.map((f) => (
        <div key={f.id} className="alert warn row">
          <span>
            {f.message} {f.personId && <Link href={`/admin/people/${f.personId}`}>Open</Link>}
          </span>
          <span className="spacer" />
          <form action={resolveFlag}>
            <input type="hidden" name="flagId" value={f.id} />
            <button className="link small">Dismiss</button>
          </form>
        </div>
      ))}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>WhatsApp</th>
              <th>LinkedIn</th>
              <th>Down for</th>
              <th className="num">Nudges</th>
              <th>Escalated</th>
              <th className="num">Uptime (month)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No active employees yet.
                </td>
              </tr>
            )}
            {rows.map(({ p, open, up }) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/people/${p.id}`}>{p.fullName ?? "(no name)"}</Link>{" "}
                  {p.status !== "ACTIVE" && <PersonBadge status={p.status} />}
                </td>
                <td>{p.whatsappE164 ?? "—"}</td>
                <td>
                  <LinkBadge status={p.linkedin?.status} />
                </td>
                <td>{open ? fmtDuration(now().getTime() - open.startedAt.getTime()) : "—"}</td>
                <td className="num">{open?.nudgeCount ?? 0}</td>
                <td>{open?.escalatedAt ? <span className="badge bad">yes</span> : "—"}</td>
                <td className="num">{up.uptimePct == null ? "—" : `${up.uptimePct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
