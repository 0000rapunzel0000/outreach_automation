import "server-only";
import { notFound } from "next/navigation";
import { env, isProd } from "@/lib/env";

/** Dev routes 404 in production and when the fake Unipile client isn't on (§12). */
export function requireDevFake() {
  if (isProd() || !env().UNIPILE_FAKE) notFound();
}
