import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(`${env().APP_BASE_URL}/login`, 303);
}
