import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { currentTos } from "@/lib/tos";
import { Flash, flashFrom } from "../../../ui";
import { createTosDraft } from "../../actions";

export default async function NewTos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireSuperAdmin();
  const cur = await currentTos();
  const { error } = await flashFrom(searchParams);
  return (
    <>
      <p className="small">
        <Link href="/admin/tos">← Terms</Link>
      </p>
      <h1>New Terms draft</h1>
      <Flash error={error} />
      <form action={createTosDraft} className="card">
        <label htmlFor="contentMd">Markdown (starts from the current version)</label>
        <textarea id="contentMd" name="contentMd" defaultValue={cur?.contentMd ?? ""} required />
        <p style={{ marginTop: 12 }}>
          <button type="submit">Save draft</button>
        </p>
      </form>
    </>
  );
}
