import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { fmtIst } from "@/lib/clock";
import { clearState, setState } from "@/lib/settings";
import { fakeFireStatus } from "@/lib/unipile/fake";
import { reconcile } from "@/lib/monitoring/reconciler";
import { TopBar } from "../../ui";
import { requireDevFake } from "../guard";

export const dynamic = "force-dynamic";

const STATUSES = ["OK", "CREDENTIALS", "ERROR", "STOPPED", "CONNECTING", "DELETED"];

async function fire(form: FormData) {
  "use server";
  requireDevFake();
  await fakeFireStatus(String(form.get("id")), String(form.get("status")));
  revalidatePath("/dev/unipile-console");
}

async function setSilently(form: FormData) {
  "use server";
  requireDevFake();
  // Change the remote status without a webhook, to test the reconciler.
  await db.fakeUnipileAccount.update({ where: { id: String(form.get("id")) }, data: { status: String(form.get("status")) } });
  revalidatePath("/dev/unipile-console");
}

async function runReconciler() {
  "use server";
  requireDevFake();
  await reconcile();
  revalidatePath("/dev/unipile-console");
}

async function toggleDown(form: FormData) {
  "use server";
  requireDevFake();
  if (form.get("down") === "1") await setState("fake.unipileDown", true);
  else await clearState("fake.unipileDown");
  revalidatePath("/dev/unipile-console");
}

export default async function UnipileConsole() {
  requireDevFake();
  const accounts = await db.fakeUnipileAccount.findMany({ orderBy: { createdAt: "desc" } });
  const local = new Map(
    (await db.linkedInAccount.findMany({ include: { person: { select: { id: true, fullName: true, status: true } } } })).map((a) => [a.unipileAccountId, a]),
  );
  const down = !!(await db.setting.findUnique({ where: { key: "fake.unipileDown" } }));

  return (
    <>
      <TopBar links={[{ href: "/admin/team", label: "Admin" }]} />
      <main className="container">
        <h1>Fake Unipile console</h1>
        <div className="row" style={{ marginBottom: 16 }}>
          <form action={runReconciler}>
            <button type="submit">Run reconciler now</button>
          </form>
          <form action={toggleDown}>
            <input type="hidden" name="down" value={down ? "0" : "1"} />
            <button type="submit" className={down ? "danger" : "secondary"}>
              {down ? "Unipile API is DOWN (click to restore)" : "Simulate Unipile API outage"}
            </button>
          </form>
        </div>
        <p className="muted small">
          &quot;Fire&quot; sets the status and calls the real webhook endpoint with the secret. &quot;Silent&quot; changes it without a webhook (a missed webhook) so the reconciler has to find it.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Person</th>
                <th>Remote status</th>
                <th>Local</th>
                <th>Fire webhook</th>
                <th>Silent change</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No fake accounts yet. Connect LinkedIn from the apply flow.
                  </td>
                </tr>
              )}
              {accounts.map((a) => {
                const l = local.get(a.id);
                return (
                  <tr key={a.id}>
                    <td>
                      <code className="small">{a.id}</code>
                      <div className="muted small">
                        {a.name} · {fmtIst(a.createdAt)}
                      </div>
                    </td>
                    <td>{l ? <Link href={`/admin/people/${l.person.id}`}>{l.person.fullName ?? l.person.id}</Link> : <span className="badge warn">orphan</span>}</td>
                    <td>
                      <code>{a.status}</code>
                    </td>
                    <td>{l ? `${l.status} (${l.person.status})` : "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {STATUSES.map((s) => (
                          <form key={s} action={fire}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="status" value={s} />
                            <button type="submit" className="secondary small" style={{ padding: "3px 8px" }} aria-label={`Fire ${s}`}>
                              {s}
                            </button>
                          </form>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {["OK", "CREDENTIALS", "ERROR"].map((s) => (
                          <form key={s} action={setSilently}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="status" value={s} />
                            <button type="submit" className="link small" aria-label={`Set ${s} silently`}>
                              {s}
                            </button>
                          </form>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
