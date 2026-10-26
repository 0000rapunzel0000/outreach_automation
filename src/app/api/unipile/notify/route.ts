import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { safeEqual } from "@/lib/crypto";
import { rateLimit } from "@/lib/ratelimit";
import { handleHostedAuthNotify, notifyBody } from "@/lib/monitoring/notifyCallback";

/** Unipile hosted-auth notify_url (§4.1). The ?s= secret gates it; getAccount() confirms the body. */
export async function POST(req: NextRequest) {
  const s = req.nextUrl.searchParams.get("s") ?? "";
  if (!safeEqual(s, env().UNIPILE_NOTIFY_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await rateLimit("notify:unipile", 120, 60))) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const parsed = notifyBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const r = await handleHostedAuthNotify(parsed.data);
    if (!r.ok) log.warn("hosted-auth notify rejected", { reason: r.reason, account_id: parsed.data.account_id });
    return NextResponse.json(r);
  } catch (e) {
    log.error("hosted-auth notify failed", { err: e });
    return NextResponse.json({ ok: false }, { status: 500 }); // let Unipile retry
  }
}
