import Link from "next/link";
import type { PersonStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fmtIst } from "@/lib/clock";
import { LinkBadge, PersonBadge } from "../../ui";

const FILTERS: { key: string; label: string; statuses: PersonStatus[] }[] = [
  { key: "pending", label: "Pending review", statuses: ["PENDING_REVIEW"] },
  { key: "draft", label: "In progress", statuses: ["DRAFT"] },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"] },
  { key: "approved", label: "Approved", statuses: ["ACTIVE", "SUSPENDED", "OFFBOARDED"] },
];

export default async function Applications({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status } = await searchParams;
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const people = await db.person.findMany({
    where: { status: { in: filter.statuses } },
    include: { user: true, linkedin: true },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    take: 200,
  });

  return (
    <>
      <h1>Applications</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/applications?status=${f.key}`} className={`btn ${f.key === filter.key ? "" : "secondary"}`}>
            {f.label}
          </Link>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>LinkedIn</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing here.
                </td>
              </tr>
            )}
            {people.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/applications/${p.id}`}>{p.fullName ?? "(no name yet)"}</Link>
                </td>
                <td>{p.user.email}</td>
                <td>
                  <PersonBadge status={p.status} />
                </td>
                <td>
                  {p.linkedin?.displayName ?? "—"} {p.linkedin && <LinkBadge status={p.linkedin.status} />}
                </td>
                <td>{fmtIst(p.submittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
