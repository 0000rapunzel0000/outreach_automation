import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user?.person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = await db.person.findUniqueOrThrow({ where: { id: user.person.id }, include: { linkedin: true } });
  if (p.linkedinError === "duplicate_linkedin") return NextResponse.json({ state: "duplicate" });
  if (p.linkedin) return NextResponse.json({ state: "connected", status: p.linkedin.status });
  return NextResponse.json({ state: "pending" });
}
