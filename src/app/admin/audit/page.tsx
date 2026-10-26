import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtIst } from "@/lib/clock";

const PAGE = 50;

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ action?: string; target?: string; page?: string }> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.action ? { action: { startsWith: sp.action } } : {}),
    ...(sp.target ? { targetId: sp.target } : {}),
  };
  const [rows, total, actions] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
  const actors = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `/admin/audit?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), ...(sp.target ? { target: sp.target } : {}), page: String(p) })}`;

  return (
    <>
      <h1>Audit log</h1>
      <form className="row card" style={{ alignItems: "flex-end" }}>
        <div>
          <label htmlFor="action">Action</label>
          <select id="action" name="action" defaultValue={sp.action ?? ""}>
            <option value="">All</option>
            {actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="target">Target id</label>
          <input id="target" name="target" defaultValue={sp.target ?? ""} />
        </div>
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtIst(r.createdAt)}</td>
                <td>{r.actorId ? (actors.get(r.actorId) ?? r.actorId) : "system"}</td>
                <td>
                  <code>{r.action}</code>
                </td>
                <td>
                  {r.targetType === "person" && r.targetId ? <Link href={`/admin/people/${r.targetId}`}>{r.targetId}</Link> : `${r.targetType} ${r.targetId ?? ""}`}
                </td>
                <td className="small muted">
                  <code>{r.metadata ? JSON.stringify(r.metadata).slice(0, 160) : ""}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        {page > 1 && <Link href={qs(page - 1)}>← Newer</Link>}
        <span className="muted small">
          Page {page} of {pages} · {total} entries
        </span>
        {page < pages && <Link href={qs(page + 1)}>Older →</Link>}
      </div>
    </>
  );
}
