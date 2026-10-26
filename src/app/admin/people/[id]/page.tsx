import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fmtDuration, fmtIst, now } from "@/lib/clock";
import { currentIstMonth, monthlyUptime, previousIstMonth } from "@/lib/monitoring/uptime";
import { Flash, flashFrom } from "../../../ui";
import { nudgeNow, offboardPerson, reactivatePerson, suspendPerson } from "../../actions";
import { loadPersonForAdmin } from "../../loadPerson";
import { PersonProfile } from "../../PersonProfile";

const MONTH = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

function UptimeCell({ label, u }: { label: string; u: Awaited<ReturnType<typeof monthlyUptime>> }) {
  return (
    <div className="counter">
      <div className="n">{u.uptimePct == null ? "—" : `${u.uptimePct}%`}</div>
      <div className="l">
        {label} · down {fmtDuration(u.downSeconds * 1000)}
      </div>
    </div>
  );
}

export default async function PersonDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const { error, ok, params: sp } = await flashFrom(searchParams);
  const { p, canReveal, reveal } = await loadPersonForAdmin(id, viewer, sp.reveal === "1");

  const cur = currentIstMonth();
  const prev = previousIstMonth();
  const [upCur, upPrev, incidents, notifications, events, audits] = await Promise.all([
    monthlyUptime(id, cur.year, cur.month),
    monthlyUptime(id, prev.year, prev.month),
    db.incident.findMany({ where: { personId: id }, orderBy: { startedAt: "desc" }, take: 50 }),
    db.notification.findMany({ where: { personId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    p.linkedin ? db.connectionEvent.findMany({ where: { accountId: p.linkedin.id }, orderBy: { receivedAt: "desc" }, take: 100 }) : [],
    db.auditLog.findMany({ where: { targetType: "person", targetId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const actorIds = [...new Set(audits.map((a) => a.actorId).filter(Boolean))] as string[];
  const actors = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const base = `/admin/people/${id}`;
  const hidden = <input type="hidden" name="personId" value={id} />;

  return (
    <>
      <p className="small">
        <Link href="/admin/team">← Team</Link>
      </p>
      <Flash error={error} ok={ok} />
      <PersonProfile p={p} reveal={reveal} canReveal={canReveal} basePath={base} />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Actions</h2>
        <div className="row">
          {p.linkedin && p.linkedin.status !== "CONNECTED" && ["ACTIVE", "PENDING_REVIEW"].includes(p.status) && (
            <form action={nudgeNow}>
              {hidden}
              <button type="submit">Send nudge now</button>
            </form>
          )}
          {p.status === "ACTIVE" && (
            <form action={suspendPerson}>
              {hidden}
              <button type="submit" className="secondary">
                Suspend
              </button>
            </form>
          )}
          {p.status === "SUSPENDED" && (
            <form action={reactivatePerson}>
              {hidden}
              <button type="submit">Reactivate</button>
            </form>
          )}
        </div>
        {viewer.role === "SUPER_ADMIN" && ["ACTIVE", "SUSPENDED"].includes(p.status) && (
          <form action={offboardPerson} className="row" style={{ marginTop: 16, alignItems: "flex-end" }}>
            {hidden}
            <div>
              <label htmlFor="confirm">Offboard: removes their LinkedIn from Unipile. Type OFFBOARD to confirm.</label>
              <input id="confirm" name="confirm" autoComplete="off" />
            </div>
            <button type="submit" className="danger">
              Offboard
            </button>
          </form>
        )}
      </section>

      <div className="counters">
        <UptimeCell label={MONTH.format(new Date(Date.UTC(cur.year, cur.month - 1, 15)))} u={upCur} />
        <UptimeCell label={MONTH.format(new Date(Date.UTC(prev.year, prev.month - 1, 15)))} u={upPrev} />
      </div>

      <h2>Incidents</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Ended</th>
              <th>Duration</th>
              <th>Cause</th>
              <th className="num">Nudges</th>
              <th>Escalated</th>
            </tr>
          </thead>
          <tbody>
            {incidents.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No incidents.
                </td>
              </tr>
            )}
            {incidents.map((i) => (
              <tr key={i.id}>
                <td>{fmtIst(i.startedAt)}</td>
                <td>{i.resolvedAt ? fmtIst(i.resolvedAt) : <span className="badge bad">open</span>}</td>
                <td>{fmtDuration((i.resolvedAt ?? now()).getTime() - i.startedAt.getTime())}</td>
                <td>
                  <code>{i.cause}</code>
                </td>
                <td className="num">{i.nudgeCount}</td>
                <td>{i.escalatedAt ? fmtIst(i.escalatedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Notifications</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Channel</th>
              <th>Template</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {notifications.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  None.
                </td>
              </tr>
            )}
            {notifications.map((n) => (
              <tr key={n.id}>
                <td>{fmtIst(n.createdAt)}</td>
                <td>{n.channel}</td>
                <td>
                  <code>{n.templateKey}</code>
                </td>
                <td>
                  <span className={`badge ${n.status === "sent" ? "ok" : n.status === "failed" ? "bad" : n.status === "skipped" ? "neutral" : "warn"}`}>
                    {n.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td>{fmtIst(n.sentAt)}</td>
                <td className="small muted">{n.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Connection events (last 100)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Raw</th>
              <th>Normalised</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  None.
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id}>
                <td>{fmtIst(e.receivedAt)}</td>
                <td>
                  <code>{e.rawStatus}</code>
                </td>
                <td>{e.normalized}</td>
                <td>{e.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Audit</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {audits.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  None.
                </td>
              </tr>
            )}
            {audits.map((a) => (
              <tr key={a.id}>
                <td>{fmtIst(a.createdAt)}</td>
                <td>{a.actorId ? (actors.get(a.actorId) ?? a.actorId) : "system"}</td>
                <td>
                  <code>{a.action}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
