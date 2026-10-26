import { redirect } from "next/navigation";
import { randomToken } from "@/lib/crypto";
import { fakeHostedAuthSucceed } from "@/lib/unipile/fake";
import { TopBar } from "../../ui";
import { requireDevFake } from "../guard";

export const dynamic = "force-dynamic";

async function succeed(form: FormData) {
  "use server";
  requireDevFake();
  const type = form.get("type") === "reconnect" ? "reconnect" : "create";
  await fakeHostedAuthSucceed({
    type,
    name: String(form.get("name")),
    account: String(form.get("account") ?? "") || undefined,
    linkedinId: String(form.get("linkedinId")),
    displayName: String(form.get("displayName")),
  });
  redirect(String(form.get("success")));
}

async function failAuth(form: FormData) {
  "use server";
  requireDevFake();
  redirect(String(form.get("failure")));
}

/** Stand-in for Unipile's hosted auth page. */
export default async function FakeUnipile({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  requireDevFake();
  const sp = await searchParams;
  const hidden = ["type", "name", "account", "success", "failure"].map((k) => <input key={k} type="hidden" name={k} value={sp[k] ?? ""} />);
  return (
    <>
      <TopBar links={[]} />
      <main className="container narrow">
        <div className="alert warn">Fake Unipile (UNIPILE_FAKE=true). Nothing here talks to LinkedIn.</div>
        <h1>{sp.type === "reconnect" ? "Reconnect your LinkedIn" : "Log in to LinkedIn"}</h1>
        <form action={succeed} className="card">
          {hidden}
          {sp.type !== "reconnect" && (
            <>
              <label htmlFor="displayName">LinkedIn display name</label>
              <input id="displayName" name="displayName" defaultValue="Test Person" />
              <label htmlFor="linkedinId">LinkedIn identity (reuse one to test the duplicate check)</label>
              <input id="linkedinId" name="linkedinId" defaultValue={`test-${randomToken(4).toLowerCase()}`} />
            </>
          )}
          {sp.type === "reconnect" && (
            <>
              <input type="hidden" name="displayName" value="" />
              <input type="hidden" name="linkedinId" value="" />
              <p>Account {sp.account}</p>
            </>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button type="submit">Succeed</button>
            <button type="submit" formAction={failAuth} className="danger">
              Fail
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
