import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Flash, flashFrom } from "../../../ui";
import { approveApplication, rejectApplication } from "../../actions";
import { loadPersonForAdmin } from "../../loadPerson";
import { PersonProfile } from "../../PersonProfile";

export default async function ApplicationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const { error, ok, params: sp } = await flashFrom(searchParams);
  const { p, canReveal, reveal } = await loadPersonForAdmin(id, viewer, sp.reveal === "1");
  const base = `/admin/applications/${id}`;

  return (
    <>
      <p className="small">
        <Link href="/admin/applications">← Applications</Link>
      </p>
      <h1>Application</h1>
      <Flash error={error} ok={ok} />
      <PersonProfile p={p} reveal={reveal} canReveal={canReveal} basePath={base} />

      {p.status === "PENDING_REVIEW" ? (
        <div className="grid grid-2">
          <form action={approveApplication} className="card">
            <h2 style={{ marginTop: 0 }}>Approve</h2>
            <p className="muted small">They become active, join payroll from today and their LinkedIn connection is monitored.</p>
            <input type="hidden" name="personId" value={p.id} />
            <button type="submit">Approve</button>
          </form>
          <form action={rejectApplication} className="card">
            <h2 style={{ marginTop: 0 }}>Reject</h2>
            <label htmlFor="reason">Reason (internal, not shown to the applicant)</label>
            <input id="reason" name="reason" required />
            <input type="hidden" name="personId" value={p.id} />
            <p className="muted small">Their LinkedIn is removed from Unipile and their data is deleted after the retention period.</p>
            <button type="submit" className="danger">
              Reject
            </button>
          </form>
        </div>
      ) : (
        p.status !== "DRAFT" &&
        p.status !== "REJECTED" && (
          <p>
            <Link href={`/admin/people/${p.id}`}>Open employee page →</Link>
          </p>
        )
      )}
    </>
  );
}
