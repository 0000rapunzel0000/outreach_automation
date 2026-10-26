import Link from "next/link";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { fmtDuration, fmtIst, now } from "@/lib/clock";
import { currentIstMonth, monthlyUptime } from "@/lib/monitoring/uptime";
import { firstNameOf } from "@/lib/notify";
import { Flash, flashFrom, LinkBadge, PersonBadge } from "../ui";
import { reconnectLinkedIn } from "./actions";
import { requireEmployee } from "./guard";

export default async function Portal({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { error, ok, params, one } = await flashFrom(searchParams);
  const user = await currentUser();
  if (user?.role !== "EMPLOYEE" && (one(params.reconnected) || one(params.reconnect_error))) {
    // Back from Unipile via a WhatsApp link, not logged in here. Nothing private on this page.
    const done = !!one(params.reconnected);
    return (
      <>
        <h1>{done ? "Thanks, you're reconnected" : "The reconnection didn't complete"}</h1>
        <div className="card">
          <p>
            {done
              ? "We're confirming your LinkedIn connection now. You can close this page."
              : "Please tap the link in your WhatsApp message again, or log in and use the Reconnect LinkedIn button."}
          </p>
          <p>
            <Link href="/login">Log in to your portal</Link>
          </p>
        </div>
      </>
    );
  }
  const { person } = await requireEmployee();
  const p = await db.person.findUniqueOrThrow({
    where: { id: person.id },
    include: {
      linkedin: true,
      incidents: { where: { resolvedAt: null }, take: 1 },
      tosAcceptances: { include: { tosVersion: true }, orderBy: { acceptedAt: "desc" }, take: 1 },
    },
  });
  const open = p.incidents[0];
  const connected = p.linkedin?.status === "CONNECTED";
  const { year, month } = currentIstMonth();
  const up = await monthlyUptime(p.id, year, month);
  const tos = p.tosAcceptances[0];

  return (
    <>
      <h1>Hi {firstNameOf(p.fullName)}</h1>
      <Flash
        error={error ?? (one(params.reconnect_error) ? "The reconnection didn't complete. Please try again." : null)}
        ok={ok ?? (one(params.reconnected) ? "Thanks! We're confirming your LinkedIn connection now." : null)}
      />

      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>LinkedIn</h2>
          <LinkBadge status={p.linkedin?.status} />
          <span className="spacer" />
          <PersonBadge status={p.status} />
        </div>
        <p style={{ marginTop: 12 }}>
          {p.linkedin?.profileUrl ? <a href={p.linkedin.profileUrl}>{p.linkedin.displayName ?? "Your profile"}</a> : p.linkedin?.displayName}
        </p>
        {!connected && p.linkedin && (
          <>
            <p className="alert warn">
              Your LinkedIn is disconnected{open ? ` (for ${fmtDuration(now().getTime() - open.startedAt.getTime())})` : ""}. Outreach is paused
              until you reconnect.
            </p>
            <form action={reconnectLinkedIn}>
              <button type="submit" className="btn-big">
                Reconnect LinkedIn
              </button>
            </form>
          </>
        )}
        {connected && <p className="muted">All good. We&apos;ll message you on WhatsApp if it ever disconnects.</p>}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>This month</h2>
        <p>
          LinkedIn uptime: <strong>{up.uptimePct == null ? "—" : `${up.uptimePct}%`}</strong>
        </p>
        {/* The existing payroll view plugs in here (D8). */}
        <p className="muted small">Your payroll details are shown in the payroll section of the dashboard.</p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Terms of Service</h2>
        <p>
          {tos ? (
            <>
              You accepted v{tos.tosVersion.version} on {fmtIst(tos.acceptedAt)}.{" "}
              <Link href={`/portal/terms?v=${tos.tosVersion.version}`}>View the version you accepted</Link>
            </>
          ) : (
            "—"
          )}
        </p>
      </section>
    </>
  );
}
