import { db } from "@/lib/db";
import { fmtIst } from "@/lib/clock";
import { currentTos, renderTos } from "@/lib/tos";
import { AgreeForm } from "../../AgreeForm";
import { Flash, flashFrom } from "../../ui";
import { reacceptTerms } from "../actions";
import { requireEmployee } from "../guard";

export default async function PortalTerms({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { person, mustAccept } = await requireEmployee({ tosPage: true });
  const { error, params, one } = await flashFrom(searchParams);
  const cur = await currentTos();
  const v = Number(one(params.v));

  // Viewing a version they accepted.
  if (!mustAccept && v) {
    const acc = await db.tosAcceptance.findFirst({ where: { personId: person.id, tosVersion: { version: v } }, include: { tosVersion: true } });
    if (acc)
      return (
        <>
          <h1>Terms of Service v{acc.tosVersion.version}</h1>
          <p className="muted">Accepted {fmtIst(acc.acceptedAt)}</p>
          <div className="card tos" dangerouslySetInnerHTML={{ __html: renderTos(acc.tosVersion.contentMd) }} />
        </>
      );
  }

  if (!cur) return <h1>No Terms published</h1>;
  return (
    <>
      <h1>{mustAccept ? "Our Terms of Service have been updated" : `Terms of Service v${cur.version}`}</h1>
      {mustAccept && <p>Please review and accept the new version to keep using your portal. Your LinkedIn monitoring isn&apos;t affected.</p>}
      <Flash error={error} />
      <div className="card">
        <div className="tos" dangerouslySetInnerHTML={{ __html: renderTos(cur.contentMd) }} />
        {mustAccept && <AgreeForm action={reacceptTerms} tosVersionId={cur.id} version={cur.version} buttonLabel="Agree" />}
      </div>
    </>
  );
}
