import Link from "next/link";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtIst } from "@/lib/clock";

export default async function TosList() {
  await requireSuperAdmin();
  const versions = await db.tosVersion.findMany({ orderBy: { version: "desc" }, include: { _count: { select: { acceptances: true } } } });
  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>Terms of Service</h1>
        <span className="spacer" />
        <Link className="btn" href="/admin/tos/new">
          New draft
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Publishing a version makes every active employee re-accept it before they can use their portal. Published versions can&apos;t be edited.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Status</th>
              <th>Published</th>
              <th className="num">Acceptances</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link href={`/admin/tos/${v.id}`}>v{v.version}</Link>
                </td>
                <td>{v.isCurrent ? <span className="badge ok">current</span> : v.publishedAt ? <span className="badge neutral">superseded</span> : <span className="badge warn">draft</span>}</td>
                <td>{fmtIst(v.publishedAt)}</td>
                <td className="num">{v._count.acceptances}</td>
                <td>
                  <code className="small">{v.contentHash.slice(0, 12)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
