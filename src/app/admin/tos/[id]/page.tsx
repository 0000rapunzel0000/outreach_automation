import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtIst } from "@/lib/clock";
import { renderTos } from "@/lib/tos";
import { Flash, flashFrom } from "../../../ui";
import { publishTos, saveTosDraft } from "../../actions";

export default async function TosVersionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const v = await db.tosVersion.findUnique({ where: { id } });
  if (!v) notFound();
  const { error, ok } = await flashFrom(searchParams);
  const draft = !v.publishedAt;

  return (
    <>
      <p className="small">
        <Link href="/admin/tos">← Terms</Link>
      </p>
      <h1>
        Terms v{v.version} {v.isCurrent ? <span className="badge ok">current</span> : draft ? <span className="badge warn">draft</span> : <span className="badge neutral">superseded</span>}
      </h1>
      <Flash error={error} ok={ok} />
      {!draft && <p className="muted">Published {fmtIst(v.publishedAt)}. Published versions are immutable.</p>}

      <div className="grid grid-2">
        {draft && (
          <form action={saveTosDraft} className="card">
            <input type="hidden" name="id" value={v.id} />
            <label htmlFor="contentMd">Markdown</label>
            <textarea id="contentMd" name="contentMd" defaultValue={v.contentMd} />
            <p style={{ marginTop: 12 }}>
              <button type="submit" className="secondary">
                Save draft &amp; refresh preview
              </button>
            </p>
          </form>
        )}
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Preview</h2>
          <div className="tos" dangerouslySetInnerHTML={{ __html: renderTos(v.contentMd) }} />
        </section>
      </div>

      {draft && (
        <form action={publishTos} className="card">
          <input type="hidden" name="id" value={v.id} />
          <p>Publishing makes this the current version and sends every active employee a message asking them to accept it.</p>
          <button type="submit">Publish v{v.version}</button>
        </form>
      )}
    </>
  );
}
