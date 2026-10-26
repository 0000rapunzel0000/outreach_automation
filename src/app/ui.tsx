import Link from "next/link";
import type { LinkStatus, PersonStatus } from "@prisma/client";
import { STATUS_LABEL } from "@/lib/monitoring/normalize";

export function TopBar({ links, who }: { links: { href: string; label: string }[]; who?: string }) {
  return (
    <header className="topbar">
      <div className="inner">
        <Link href="/" className="brand">
          Outreach Team
        </Link>
        <nav>
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
        {who && (
          <span className="who">
            {who} ·{" "}
            <form action="/logout" method="post" className="inline">
              <button className="link small" type="submit">
                Log out
              </button>
            </form>
          </span>
        )}
      </div>
    </header>
  );
}

export function Flash({ error, ok, info }: { error?: string | null; ok?: string | null; info?: string | null }) {
  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {ok && <div className="alert ok">{ok}</div>}
      {info && <div className="alert info">{info}</div>}
    </>
  );
}

const LINK_TONE: Record<LinkStatus, string> = {
  CONNECTED: "ok",
  CONNECTING: "neutral",
  TRANSIENT_ERROR: "warn",
  NEEDS_RECONNECT: "bad",
  DELETED: "bad",
};

export function LinkBadge({ status }: { status?: LinkStatus | null }) {
  if (!status) return <span className="badge neutral">Not connected</span>;
  return <span className={`badge ${LINK_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

const PERSON_TONE: Record<PersonStatus, string> = {
  DRAFT: "neutral",
  PENDING_REVIEW: "warn",
  ACTIVE: "ok",
  REJECTED: "bad",
  SUSPENDED: "warn",
  OFFBOARDED: "neutral",
};

export function PersonBadge({ status }: { status: PersonStatus }) {
  return <span className={`badge ${PERSON_TONE[status]}`}>{status.replace("_", " ").toLowerCase()}</span>;
}

/** Read ?error= / ?ok= flash params from searchParams. */
export async function flashFrom(sp: Promise<Record<string, string | string[] | undefined>>) {
  const p = await sp;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  return { error: one(p.error), ok: one(p.ok), params: p, one };
}
